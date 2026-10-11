// Authoritative game rules. Pure logic over the synced schema state: no networking,
// so it can be unit-tested and driven by bots. PartyRoom wraps it for Colyseus.
import { randomBytes } from "crypto";
import { ArraySchema } from "@colyseus/schema";
import {
  ABILITIES,
  FACES,
  ITEMS,
  PLAYER,
  PLAYER_COLORS,
  RULES,
  RUNNER_ITEMS,
  SCORING,
  SEEKER_ITEMS,
  VALIDATION,
  VISION,
  type Item,
} from "@shared/config";
import { blocked, dist, seekerSees, type Circle, type Occluders, type Vec } from "@shared/geometry";
import { cellCenter, generateMap, type GameMap } from "@shared/maze";
import { overlapsAny, stepBody } from "@shared/physics";
import { abilityAllowed, abilityCooldown, abilityFor, baseSpeed, isFrozen } from "@shared/rules";
import { Decoy, GameState, Locker, Player, Rect, Round, Thing, type Phase } from "@shared/schema";
import type { ActionSlot, Award, FxEvent, MoveMsg, PlayerResult, RoundResult } from "@shared/protocol";
import { BotBrain } from "./bots";

export const newToken = () => randomBytes(12).toString("base64url");

interface Stats {
  catches: number;
  orbs: number;
  rescues: number;
  closeCall: number;
  peak: number;
  nearSeekerMs: number;
  lockerMs: number;
  firstCatchMs: number;
}

/** Server-only per-seat data that is never synced. */
interface Private {
  token: string;
  offlineMs: number;
  left: boolean;
  lastMoveAt: number;
  boostUntil: number;
  invulnMs: number;
  rootMs: number;
  blindMs: number;
  boostMs: number;
  searchLocker: number;
  searchMs: number;
  lockerMs: number;
  idleMs: number;
  idleAnchor: Vec;
  timesCaught: number;
  /** Rescue progress supplied by teammates (vs lockpicking), and who helped last. */
  helped: number;
  lastRescuer: string;
  stats: Stats;
}

const freshStats = (): Stats => ({
  catches: 0,
  orbs: 0,
  rescues: 0,
  closeCall: 0,
  peak: 0,
  nearSeekerMs: 0,
  lockerMs: 0,
  firstCatchMs: -1,
});

export interface GameHooks {
  fx(events: FxEvent[]): void;
  /** Tell one player their reported position was rejected. */
  correct(playerId: string, x: number, y: number): void;
  now(): number;
}

export class Game {
  readonly state = new GameState();
  map: GameMap | null = null;
  /** Walls shrunk by 2px: a body sliding along a wall face isn't "passing through" it. */
  private shrunk: { x: number; y: number; w: number; h: number }[] = [];
  private roundCounter = 0;
  private priv = new Map<string, Private>();
  private bots = new Map<string, BotBrain>();
  private pending: FxEvent[] = [];
  private nextId = 1;
  private lockerOccupant = new Map<number, string>();
  private lockerCooldown = new Map<number, number>();
  private itemRespawn: number[] = [];
  private decoyExposure = new Map<number, number>();
  private poloLeft = 0;
  private huntElapsed = 0;
  private lastSeekerId = "";
  private orbCharge = new Map<number, number>();
  private orbTimers: number[] = [];
  /** Recent noises/pings, for bots to "hear". */
  readonly heard: { x: number; y: number; at: number }[] = [];

  constructor(
    code: string,
    private hooks: GameHooks,
    readonly rng: () => number = Math.random,
  ) {
    this.state.code = code;
  }

  // ================================================================ seats

  get players(): Player[] {
    return Array.from(this.state.players.values());
  }

  player(id: string): Player | undefined {
    return this.state.players.get(id);
  }

  privOf(id: string) {
    return this.priv.get(id);
  }

  seatByToken(token: string): Player | undefined {
    for (const [id, p] of this.priv) if (p.token === token && !p.left) return this.state.players.get(id);
    return undefined;
  }

  tokenOf(id: string) {
    return this.priv.get(id)?.token ?? "";
  }

  playerCount() {
    return this.state.players.size;
  }

  get joinable() {
    return (this.state.phase === "lobby" || this.state.phase === "round_over") && this.playerCount() < RULES.maxPlayers;
  }

  /** Disconnected seat with this name – lets a player who lost their token reclaim it. */
  /**
   * A seat someone can take back by typing its name (lost token: other phone, private tab).
   * Never a seat its owner gave up, and not while that phone is still auto-reconnecting
   * (`reconnecting(id)`), so a phone that just blipped can't be hijacked.
   */
  reclaimable(name: string, reconnecting: (playerId: string) => boolean = () => false): Player | undefined {
    return this.players.find((p) => {
      const pr = this.priv.get(p.id);
      if (p.connected || p.isBot || !pr || pr.left || p.name.toLowerCase() !== name.toLowerCase()) return false;
      return pr.offlineMs > RULES.reconnectWindowSec * 1000 || !reconnecting(p.id);
    });
  }

  joinError(name: string): "in_progress" | "full" | "name_taken" | null {
    if (this.state.phase !== "lobby" && this.state.phase !== "round_over") return "in_progress";
    if (this.playerCount() >= RULES.maxPlayers) return "full";
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return "name_taken";
    return null;
  }

  addPlayer(name: string, face = -1, isBot = false): Player {
    const used = new Set(this.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.playerCount() % PLAYER_COLORS.length];
    const id = newToken().slice(0, 8);
    const p = new Player();
    p.id = id;
    p.name = name;
    p.color = color;
    p.face = face >= 0 && face < FACES.length ? face : Math.floor(this.rng() * FACES.length);
    p.isBot = isBot;
    p.connected = true;
    this.state.players.set(id, p);
    this.priv.set(id, {
      token: newToken(),
      offlineMs: 0,
      left: false,
      lastMoveAt: 0,
      boostUntil: 0,
      invulnMs: 0,
      rootMs: 0,
      blindMs: 0,
      boostMs: 0,
      searchLocker: -1,
      searchMs: 0,
      lockerMs: 0,
      idleMs: 0,
      idleAnchor: { x: 0, y: 0 },
      timesCaught: 0,
      helped: 0,
      lastRescuer: "",
      stats: freshStats(),
    });
    if (isBot) this.bots.set(id, new BotBrain(id, this));
    this.updateVip();
    return p;
  }

  addBot(): Player | null {
    if (!this.joinable) return null;
    const names = ["Robo", "Beep", "Glitch", "Pixel", "Sparky", "Bolt", "Nano", "Chip"];
    const name = names.find((n) => !this.players.some((p) => p.name === n)) ?? `Bot${this.playerCount()}`;
    return this.addPlayer(name, -1, true);
  }

  removeBot(): boolean {
    // Mid-round the bot may be the seeker or hiding in a locker: only between rounds.
    if (this.state.phase !== "lobby" && this.state.phase !== "round_over") return false;
    const bot = [...this.players].reverse().find((p) => p.isBot);
    if (!bot) return false;
    this.removeSeat(bot.id);
    return true;
  }

  setFace(id: string, face: number) {
    const p = this.player(id);
    if (p && face >= 0 && face < FACES.length) p.face = face;
  }

  setConnected(id: string, connected: boolean) {
    const p = this.player(id);
    const pr = this.priv.get(id);
    if (!p || !pr) return;
    p.connected = connected;
    pr.offlineMs = 0;
    this.updateVip();
  }

  private removeSeat(id: string) {
    const p = this.player(id);
    if (p) this.exitLocker(p, false);
    this.state.players.delete(id);
    this.priv.delete(id);
    this.bots.delete(id);
    this.updateVip();
  }

  /** Player chose to leave for good. */
  leave(id: string) {
    const p = this.player(id);
    if (!p) return;
    const phase = this.state.phase;
    if (phase === "lobby" || phase === "round_over" || !p.inRound) return this.removeSeat(id);
    this.priv.get(id)!.left = true;
    p.connected = false;
    if (p.role === "seeker") return this.endRound("aborted", `${p.name} (seeker) left the game`);
    this.exitLocker(p, false);
    p.status = "ghost";
    p.exposure = 0;
    this.updateVip();
  }

  private updateVip() {
    this.state.vipId = this.players.find((p) => p.connected && !p.isBot)?.id ?? "";
  }

  // ================================================================ rounds

  start(): string | null {
    const s = this.state;
    if (s.phase !== "lobby" && s.phase !== "round_over") return "A round is already running";
    for (const p of this.players) if (this.priv.get(p.id)?.left) this.removeSeat(p.id);
    const players = this.players.filter((p) => p.connected);
    if (players.length < RULES.minPlayers) return `Need at least ${RULES.minPlayers} players`;

    // Rotate the seeker: fewest turns so far (humans first), ties broken randomly.
    const minTurns = Math.min(...players.map((p) => p.timesSeeker));
    let pool = players.filter((p) => p.timesSeeker === minTurns);
    if (pool.some((p) => !p.isBot)) pool = pool.filter((p) => !p.isBot);
    // Never the same seeker twice in a row when there's a choice.
    const prev = this.lastSeekerId;
    if (pool.length > 1 && pool.some((p) => p.id === prev)) pool = pool.filter((p) => p.id !== prev);
    else if (pool.length === 1 && pool[0].id === prev && players.length > 1) {
      const others = players.filter((p) => p.id !== prev);
      const minOther = Math.min(...others.map((p) => p.timesSeeker));
      pool = others.filter((p) => p.timesSeeker === minOther);
      if (pool.some((p) => !p.isBot)) pool = pool.filter((p) => !p.isBot);
    }
    const seeker = pool[Math.floor(this.rng() * pool.length)];
    seeker.timesSeeker++;
    this.lastSeekerId = seeker.id;

    const map = generateMap(players.length, this.rng);
    this.map = map;
    this.shrunk = map.rects.map(shrink);
    const round = new Round();
    round.id = ++this.roundCounter;
    round.width = map.width;
    round.height = map.height;
    round.cols = map.cols;
    round.rows = map.rows;
    round.wallCount = map.wallCount;
    round.seekerId = seeker.id;
    round.orbsToWin = RULES.orbsToWin(players.length - 1);
    round.spawnX = map.spawn.x;
    round.spawnY = map.spawn.y;
    round.rects = new ArraySchema(...map.rects.map((r) => new Rect({ x: r.x, y: r.y, w: r.w, h: r.h })));
    round.lockers = new ArraySchema(
      ...map.lockers.map((l, i) => {
        const lk = new Locker();
        lk.id = i;
        lk.x = l.x;
        lk.y = l.y;
        lk.dir = l.dir;
        return lk;
      }),
    );
    s.round = round;

    for (const p of this.players) p.inRound = false;
    for (const p of players) {
      const isSeeker = p === seeker;
      const pr = this.priv.get(p.id)!;
      const jitter = isSeeker ? 0 : 20;
      Object.assign(p, {
        inRound: true,
        role: isSeeker ? "seeker" : "runner",
        status: "free",
        x: map.spawn.x + (this.rng() - 0.5) * jitter * 2,
        y: map.spawn.y + (this.rng() - 0.5) * jitter * 2,
        vx: 0,
        vy: 0,
        angle: this.rng() * Math.PI * 2,
        exposure: 0,
        rescue: 0,
        lit: false,
        invuln: false,
        locker: -1,
        rooted: false,
        blinded: false,
        searching: 0,
        boost: 1,
        cdA: 0,
        cdB: 0,
        item: "",
      });
      Object.assign(pr, {
        lastMoveAt: this.hooks.now(),
        boostUntil: 0,
        invulnMs: 0,
        rootMs: 0,
        blindMs: 0,
        boostMs: 0,
        searchLocker: -1,
        searchMs: 0,
        lockerMs: 0,
        idleMs: 0,
        idleAnchor: { x: p.x, y: p.y },
        timesCaught: 0,
        helped: 0,
        lastRescuer: "",
        stats: freshStats(),
      });
    }
    for (const b of this.bots.values()) b.reset();

    s.result = "";
    s.collected = 0;
    s.poloActive = false;
    this.clearArray(s.orbs);
    this.clearArray(s.items);
    this.clearArray(s.smokes);
    this.clearArray(s.flares);
    this.clearArray(s.traps);
    this.clearArray(s.decoys);
    this.lockerOccupant.clear();
    this.lockerCooldown.clear();
    this.decoyExposure.clear();
    this.itemRespawn = [];
    this.poloLeft = 0;
    this.huntElapsed = 0;
    this.orbCharge.clear();
    this.orbTimers = [];
    this.heard.length = 0;
    this.pending = [];
    this.fillOrbs();
    for (let i = 0; i < RULES.itemBoxes; i++) this.spawnItemBox();
    this.setPhase("reveal", RULES.revealMs);
    return null;
  }

  toLobby() {
    const s = this.state;
    if (s.phase === "lobby") return;
    if (s.phase !== "round_over") this.endRound("aborted", "The host ended the round");
    for (const p of this.players) {
      if (this.priv.get(p.id)?.left) this.removeSeat(p.id);
      else p.inRound = false;
    }
    s.round = undefined;
    this.map = null;
    s.result = "";
    this.setPhase("lobby", 0);
  }

  private setPhase(phase: Phase, ms: number) {
    this.state.phase = phase;
    this.state.phaseLeft = Math.max(0, Math.round(ms));
  }

  private clearArray(a: ArraySchema<any>) {
    a.splice(0, a.length);
  }

  get seeker(): Player | undefined {
    const id = this.state.round?.seekerId;
    return id ? this.player(id) : undefined;
  }

  get runners(): Player[] {
    return this.players.filter((p) => p.inRound && p.role === "runner");
  }

  /** Light blockers: walls, crates and smoke clouds. */
  occluders(): Occluders {
    const circles: Circle[] = [];
    for (const s of this.state.smokes) circles.push({ x: s.x, y: s.y, r: ITEMS.smoke.radius });
    return { rects: this.map?.rects ?? [], circles };
  }

  private noise(x: number, y: number, why: Extract<FxEvent, { k: "noise" }>["why"]) {
    this.pending.push({ k: "noise", x, y, polo: this.poloLeft > 0, why });
    this.heard.push({ x, y, at: this.hooks.now() });
  }

  // ================================================================ input

  maxSpeedOf(p: Player): number {
    return baseSpeed(p.role, p.status) * p.boost;
  }

  /**
   * Phones move themselves and report positions. Accept them unless they're
   * physically impossible (too fast, inside or through walls).
   */
  move(id: string, m: MoveMsg) {
    const p = this.player(id);
    const pr = this.priv.get(id);
    const map = this.map;
    if (!p || !pr || !map || !p.inRound) return;
    if (![m.x, m.y, m.vx, m.vy, m.a].every(Number.isFinite)) return;
    const now = this.hooks.now();
    p.angle = m.a;
    if (isFrozen(p, this.state.phase)) {
      if (Math.hypot(m.x - p.x, m.y - p.y) > 2) this.hooks.correct(id, p.x, p.y);
      pr.lastMoveAt = now;
      return;
    }
    const gap = Math.min(VALIDATION.maxGapSec, Math.max(0.02, (now - pr.lastMoveAt) / 1000));
    const boost = now < pr.boostUntil ? Math.max(p.boost, ABILITIES.dash.multiplier) : p.boost;
    const allowed = baseSpeed(p.role, p.status) * boost * gap * VALIDATION.speedSlack + VALIDATION.distSlack;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    const ghost = p.status === "ghost";
    const inBounds = m.x >= 0 && m.y >= 0 && m.x <= map.width && m.y <= map.height;
    const legal =
      inBounds &&
      d <= allowed &&
      (ghost || (!overlapsAny(m.x, m.y, PLAYER.radius, map.rects, 3) && !blocked(p, m, { rects: this.shrunk })));
    pr.lastMoveAt = now;
    if (!legal) {
      this.hooks.correct(id, p.x, p.y);
      return;
    }
    p.x = m.x;
    p.y = m.y;
    p.vx = m.vx;
    p.vy = m.vy;
  }

  action(id: string, slot: ActionSlot) {
    const p = this.player(id);
    const pr = this.priv.get(id);
    if (!p || !pr || !p.inRound) return;
    const phase = this.state.phase;
    if (slot === "item") return this.useItem(p);
    if (slot === "act") return this.interact(p, pr);

    const ability = abilityFor(p.role, p.status, slot);
    if (!ability || !abilityAllowed(ability, phase)) return;
    if (p.locker >= 0 && ability !== "polo") return;
    const cdKey = slot === "a" ? "cdA" : "cdB";
    if (p[cdKey] > 0) return;
    if (ability === "dash" && p.rooted) return; // don't burn the cooldown while trapped
    p[cdKey] = abilityCooldown(ability);
    const now = this.hooks.now();

    switch (ability) {
      case "dash":
        if (p.rooted) return;
        p.boost = ABILITIES.dash.multiplier;
        pr.boostMs = ABILITIES.dash.durationMs;
        pr.boostUntil = now + ABILITIES.dash.durationMs + VALIDATION.boostGraceMs + 300;
        this.pending.push({ k: "use", id, item: "dash", x: p.x, y: p.y });
        break;
      case "sprint":
        p.boost = ABILITIES.sprint.multiplier;
        pr.boostMs = ABILITIES.sprint.durationMs;
        pr.boostUntil = now + ABILITIES.sprint.durationMs + VALIDATION.boostGraceMs;
        this.pending.push({ k: "use", id, item: "sprint", x: p.x, y: p.y });
        break;
      case "polo": {
        // Hidden in a locker = silent; that's the point of hiding.
        const targets = this.runners.filter((r) => r.status === "free" && r.locker < 0);
        const { jitter } = ABILITIES.polo;
        const pings = targets.map((r) => {
          const a = this.rng() * Math.PI * 2;
          const d = this.rng() * jitter;
          return { x: r.x + Math.cos(a) * d, y: r.y + Math.sin(a) * d };
        });
        this.poloLeft = ABILITIES.polo.windowMs;
        this.state.poloActive = true;
        this.pending.push({ k: "polo", pings, targets: targets.map((t) => t.id) });
        pings.forEach((pg) => this.heard.push({ ...pg, at: now }));
        break;
      }
      case "boo":
        this.noise(p.x, p.y, "boo");
        break;
      case "help":
        this.pending.push({ k: "help", id, x: p.x, y: p.y });
        break;
    }
  }

  /** Context button: hide in / leave a locker (runner), search a locker (seeker). */
  private interact(p: Player, pr: Private) {
    const round = this.state.round;
    if (!round || this.state.phase !== "hunt") return;
    if (p.role === "runner") {
      if (p.status !== "free") return;
      if (p.locker >= 0) return this.exitLocker(p, true);
      if (p.rooted) return;
      const lk = this.nearestLocker(p);
      if (!lk || this.lockerOccupant.has(lk.id)) return;
      this.lockerOccupant.set(lk.id, p.id);
      p.locker = lk.id;
      p.x = lk.x;
      p.y = lk.y;
      p.vx = p.vy = 0;
      p.exposure = 0;
      pr.lockerMs = 0;
      this.pending.push({ k: "locker", id: lk.id, what: "enter" });
      return;
    }
    // seeker
    if (p.searching > 0) return;
    const lk = this.nearestLocker(p);
    if (!lk || (this.lockerCooldown.get(lk.id) ?? 0) > 0) return;
    pr.searchLocker = lk.id;
    pr.searchMs = 0;
    p.searching = 0.01;
    p.vx = p.vy = 0;
    this.pending.push({ k: "locker", id: lk.id, what: "search" });
  }

  private nearestLocker(p: Vec): Locker | undefined {
    const round = this.state.round;
    if (!round) return;
    let best: Locker | undefined;
    let bestD = RULES.lockerRange;
    for (const lk of round.lockers) {
      const d = dist(lk, p);
      if (d <= bestD) {
        bestD = d;
        best = lk;
      }
    }
    return best;
  }

  private exitLocker(p: Player, noisy: boolean) {
    if (p.locker < 0) return;
    const lk = this.state.round?.lockers[p.locker];
    this.lockerOccupant.delete(p.locker);
    p.locker = -1;
    if (lk) {
      const out = { x: lk.x + Math.cos(lk.dir) * 26, y: lk.y + Math.sin(lk.dir) * 26 };
      p.x = out.x;
      p.y = out.y;
      if (noisy) {
        this.pending.push({ k: "locker", id: lk.id, what: "exit" });
        this.noise(lk.x, lk.y, "locker");
      }
    }
    const pr = this.priv.get(p.id);
    if (pr) {
      pr.idleAnchor = { x: p.x, y: p.y };
      pr.idleMs = 0;
    }
  }

  private useItem(p: Player) {
    if (!p.item || this.state.phase !== "hunt" || p.locker >= 0) return;
    if (p.role === "runner" && p.status !== "free") return;
    const item = p.item as Item;
    p.item = "";
    const id = this.nextId++;
    switch (item) {
      case "smoke": {
        const s = new Thing();
        Object.assign(s, { id, x: p.x, y: p.y, ttl: ITEMS.smoke.durationMs, owner: p.id });
        this.state.smokes.push(s);
        break;
      }
      case "decoy": {
        const speed = PLAYER.runnerSpeed;
        const d = new Decoy();
        Object.assign(d, {
          id,
          owner: p.id,
          x: p.x,
          y: p.y,
          vx: Math.cos(p.angle) * speed,
          vy: Math.sin(p.angle) * speed,
          ttl: ITEMS.decoy.durationMs,
        });
        this.state.decoys.push(d);
        break;
      }
      case "flash": {
        const s = this.seeker;
        const hit = !!s && dist(s, p) <= ITEMS.flash.range && !blocked(p, s, this.occluders());
        if (hit && s) {
          s.blinded = true;
          this.priv.get(s.id)!.blindMs = ITEMS.flash.blindMs;
        }
        this.pending.push({ k: "flash", x: p.x, y: p.y, hit });
        break;
      }
      case "flare": {
        const map = this.map!;
        let fx = p.x + Math.cos(p.angle) * ITEMS.flare.throw;
        let fy = p.y + Math.sin(p.angle) * ITEMS.flare.throw;
        if (blocked(p, { x: fx, y: fy }, { rects: map.rects }) || overlapsAny(fx, fy, 6, map.rects)) {
          fx = p.x;
          fy = p.y;
        }
        const f = new Thing();
        Object.assign(f, { id, x: fx, y: fy, ttl: ITEMS.flare.durationMs, owner: p.id });
        this.state.flares.push(f);
        break;
      }
      case "trap": {
        const t = new Thing();
        Object.assign(t, { id, x: p.x, y: p.y, ttl: ITEMS.trap.lifetimeMs, owner: p.id });
        this.state.traps.push(t);
        break;
      }
    }
    this.pending.push({ k: "use", id: p.id, item, x: p.x, y: p.y });
  }

  // ================================================================ tick

  tick(dtMs: number) {
    const s = this.state;
    s.time = this.hooks.now();
    this.housekeeping(dtMs);
    if (!s.round || s.phase === "lobby" || s.phase === "round_over") return this.flush();

    const dt = dtMs / 1000;
    for (const p of this.players) {
      if (!p.inRound) continue;
      const pr = this.priv.get(p.id)!;
      p.cdA = Math.max(0, p.cdA - dtMs);
      p.cdB = Math.max(0, p.cdB - dtMs);
      if (pr.boostMs > 0) {
        pr.boostMs -= dtMs;
        if (pr.boostMs <= 0) p.boost = 1;
      }
      if (pr.rootMs > 0) {
        pr.rootMs -= dtMs;
        p.rooted = pr.rootMs > 0;
      }
      if (pr.blindMs > 0) {
        pr.blindMs -= dtMs;
        p.blinded = pr.blindMs > 0;
      }
      if (p.isBot) this.bots.get(p.id)?.update(dt);
    }

    this.poloLeft = Math.max(0, this.poloLeft - dtMs);
    s.poloActive = this.poloLeft > 0;
    s.phaseLeft = Math.max(0, s.phaseLeft - dtMs);

    if (s.phase === "reveal" && s.phaseLeft <= 0) this.setPhase("scatter", RULES.scatterMs);
    else if (s.phase === "scatter" && s.phaseLeft <= 0) this.setPhase("hunt", RULES.huntMs);
    else if (s.phase === "hunt") this.huntTick(dtMs);

    this.flush();
  }

  /** Bots move through the same physics as phones. */
  moveBot(p: Player, ix: number, iy: number, dt: number) {
    if (!this.map) return;
    const frozen = isFrozen(p, this.state.phase);
    const body = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    stepBody(body, ix, iy, dt, {
      maxSpeed: this.maxSpeedOf(p),
      ghost: p.status === "ghost",
      frozen,
      width: this.map.width,
      height: this.map.height,
      rects: this.map.rects,
    });
    p.x = body.x;
    p.y = body.y;
    p.vx = body.vx;
    p.vy = body.vy;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > 20) p.angle = Math.atan2(body.vy, body.vx);
  }

  private flush() {
    if (this.pending.length) {
      this.hooks.fx(this.pending);
      this.pending = [];
    }
    const cutoff = this.hooks.now() - 8000;
    while (this.heard.length && this.heard[0].at < cutoff) this.heard.shift();
  }

  private housekeeping(dtMs: number) {
    let changed = false;
    for (const p of this.players) {
      if (p.connected || p.isBot) continue;
      const pr = this.priv.get(p.id)!;
      pr.offlineMs += dtMs;
      if (this.state.phase === "lobby" && pr.offlineMs > RULES.lobbyDropMs) {
        this.removeSeat(p.id);
        changed = true;
      }
    }
    if (changed) this.updateVip();
    const seeker = this.seeker;
    const ph = this.state.phase;
    if (seeker && !seeker.connected && !seeker.isBot && (ph === "reveal" || ph === "scatter" || ph === "hunt")) {
      if ((this.priv.get(seeker.id)?.offlineMs ?? 0) > RULES.seekerDropAbortMs) {
        this.endRound("aborted", `${seeker.name} (seeker) disconnected`);
      }
    }
  }

  private huntTick(dtMs: number) {
    const dt = dtMs / 1000;
    const s = this.state;
    const round = s.round!;
    const seeker = this.seeker;
    const runners = this.runners;
    const occ = this.occluders();
    const now = this.hooks.now();
    this.huntElapsed += dtMs;

    // Item lifetimes
    this.ageThings(s.smokes, dtMs);
    this.ageThings(s.flares, dtMs);
    this.ageThings(s.traps, dtMs);
    this.updateDecoys(dt, dtMs, occ);
    this.updateItemBoxes(dtMs);

    // Locker search (seeker)
    if (seeker && seeker.searching > 0) {
      const pr = this.priv.get(seeker.id)!;
      pr.searchMs += dtMs;
      seeker.searching = Math.min(1, pr.searchMs / RULES.lockerSearchMs);
      if (pr.searchMs >= RULES.lockerSearchMs) {
        const lockerId = pr.searchLocker;
        const occupant = this.lockerOccupant.get(lockerId);
        seeker.searching = 0;
        pr.searchLocker = -1;
        this.lockerCooldown.set(lockerId, RULES.lockerSearchCooldownMs);
        const lk = round.lockers[lockerId];
        if (lk) lk.checked = true;
        const victim = occupant ? this.player(occupant) : undefined;
        if (victim) {
          this.pending.push({ k: "locker", id: lockerId, what: "found" });
          this.exitLocker(victim, false);
          this.catchRunner(victim, seeker);
        } else {
          this.pending.push({ k: "locker", id: lockerId, what: "empty" });
        }
      }
    }
    for (const [id, ms] of this.lockerCooldown) {
      const left = ms - dtMs;
      if (left <= 0) {
        this.lockerCooldown.delete(id);
        const lk = round.lockers[id];
        if (lk) lk.checked = false;
      } else this.lockerCooldown.set(id, left);
    }

    const onOrb = new Map<number, Player[]>();
    for (const r of runners) {
      const pr = this.priv.get(r.id)!;
      pr.invulnMs = Math.max(0, pr.invulnMs - dtMs);
      r.invuln = pr.invulnMs > 0;
      r.lit = false;
      if (r.status !== "free") continue;

      if (r.locker >= 0) {
        pr.lockerMs += dtMs;
        pr.stats.lockerMs += dtMs;
        r.exposure = 0;
        if (pr.lockerMs >= RULES.lockerMaxHideMs) this.exitLocker(r, true);
        continue;
      }

      // Exposure: the seeker's beam, or a flare (at half speed).
      const inBeam = !!seeker && !seeker.blinded && seekerSees(seeker, r, occ);
      const inFlare = !inBeam && s.flares.some((f) => dist(f, r) <= VISION.flareLight && !blocked(f, r, occ));
      r.lit = inBeam || inFlare;
      if (r.lit && !r.invuln) {
        r.exposure += (dt / RULES.exposureFillFor(runners.length)) * (inBeam ? 1 : RULES.flareExposureScale);
        pr.stats.peak = Math.max(pr.stats.peak, r.exposure);
        if (r.exposure >= 1) {
          if (seeker) {
            this.catchRunner(r, seeker);
            continue;
          }
          r.exposure = 1;
        }
      } else {
        r.exposure = Math.max(0, r.exposure - dt / RULES.exposureDecaySec);
        if (r.exposure === 0 && pr.stats.peak > 0) {
          pr.stats.closeCall = Math.max(pr.stats.closeCall, pr.stats.peak);
          pr.stats.peak = 0;
        }
      }
      if (seeker && dist(seeker, r) < 160) pr.stats.nearSeekerMs += dtMs;

      // Orbs: standing on one charges it.
      if (r.locker < 0 && !r.rooted) {
        for (const orb of s.orbs) {
          if (dist(orb, r) <= RULES.orbRadius + PLAYER.radius) {
            const on = onOrb.get(orb.id);
            if (on) on.push(r);
            else onOrb.set(orb.id, [r]);
            break;
          }
        }
      }

      // Traps
      for (let i = 0; i < s.traps.length; i++) {
        const t = s.traps[i];
        if (dist(t, r) <= ITEMS.trap.radius + PLAYER.radius) {
          s.traps.splice(i, 1);
          pr.rootMs = ITEMS.trap.rootMs;
          r.rooted = true;
          r.vx = r.vy = 0;
          this.pending.push({ k: "trapped", id: r.id, x: r.x, y: r.y });
          this.noise(r.x, r.y, "trap");
          break;
        }
      }

      // Sneeze: campers give themselves away.
      if (dist(r, pr.idleAnchor) > RULES.sneezeMoveThreshold) {
        pr.idleAnchor = { x: r.x, y: r.y };
        pr.idleMs = 0;
      } else {
        pr.idleMs += dtMs;
        if (pr.idleMs >= RULES.sneezeIdleMs) {
          pr.idleMs = 0;
          this.noise(r.x, r.y, "sneeze");
        }
      }
    }

    // Orb charging: more runners on one orb charge it faster.
    for (let i = s.orbs.length - 1; i >= 0; i--) {
      const orb = s.orbs[i];
      const on = onOrb.get(orb.id);
      let c = this.orbCharge.get(orb.id) ?? 0;
      c = on ? c + (dt / RULES.orbChargeSec) * (1 + 0.5 * (on.length - 1)) : Math.max(0, c - dt / RULES.orbChargeDecaySec);
      if (on && c >= 1) {
        s.orbs.splice(i, 1);
        this.orbCharge.delete(orb.id);
        s.collected++;
        for (const r of on) this.priv.get(r.id)!.stats.orbs++;
        this.pending.push({ k: "orb", x: orb.x, y: orb.y, by: on[0].id });
        this.heard.push({ x: orb.x, y: orb.y, at: now });
        this.orbTimers.push(RULES.orbRespawnMs);
        continue;
      }
      this.orbCharge.set(orb.id, c);
      orb.charge = Math.round(c * 100);
    }
    this.orbTimers = this.orbTimers.map((t) => t - dtMs);
    this.orbTimers = this.orbTimers.filter((t) => t > 0);
    // Top up (also retries if a spot couldn't be found earlier).
    if (Math.floor(this.huntElapsed / 1000) !== Math.floor((this.huntElapsed - dtMs) / 1000) || !s.orbs.length) this.fillOrbs();

    // Item boxes (anyone in the round can grab one if their hands are free)
    for (const p of this.players) {
      if (!p.inRound || p.item || p.locker >= 0) continue;
      if (p.role === "runner" && p.status !== "free") continue;
      for (let i = 0; i < s.items.length; i++) {
        const box = s.items[i];
        if (dist(box, p) <= RULES.itemPickupRadius + PLAYER.radius) {
          const pool: Item[] = p.role === "seeker" ? SEEKER_ITEMS : RUNNER_ITEMS;
          p.item = pool[Math.floor(this.rng() * pool.length)];
          s.items.splice(i, 1);
          this.itemRespawn.push(RULES.itemRespawnMs);
          this.pending.push({ k: "item", id: p.id, item: p.item as Item, x: box.x, y: box.y });
          break;
        }
      }
    }

    // Rescues
    for (const caged of runners) {
      if (caged.status !== "caged") continue;
      const rescuer = runners.find(
        (r) => r.status === "free" && r.locker < 0 && r !== caged && dist(r, caged) <= RULES.rescueRadius,
      );
      // A teammate frees you in seconds; alone you slowly pick the lock.
      const cpr = this.priv.get(caged.id)!;
      const step = dt / (rescuer ? RULES.rescueSec : RULES.lockpickSec);
      caged.rescue += step;
      if (rescuer) {
        cpr.helped += step;
        cpr.lastRescuer = rescuer.id;
      }
      if (caged.rescue >= 1) {
        const pr = cpr;
        // Credit a teammate only if they did a real share of the work.
        const hero = pr.helped >= 0.4 ? this.player(pr.lastRescuer) : undefined;
        pr.helped = 0;
        pr.lastRescuer = "";
        caged.cdA = 0;
        caged.status = "free";
        caged.rescue = 0;
        caged.exposure = 0;
        pr.invulnMs = RULES.rescueInvulnMs;
        caged.invuln = true;
        pr.idleAnchor = { x: caged.x, y: caged.y };
        pr.idleMs = 0;
        if (hero) this.priv.get(hero.id)!.stats.rescues++;
        this.pending.push({ k: "freed", id: caged.id, by: hero?.id ?? caged.id, x: caged.x, y: caged.y });
      }
    }

    const stillHere = runners.filter((r) => !this.priv.get(r.id)?.left);
    if (s.collected >= round.orbsToWin) this.endRound("runners", "The runners collected every orb!");
    else if (runners.length && !stillHere.length) this.endRound("aborted", "All the runners left");
    else if (!stillHere.some((r) => r.status === "free")) this.endRound("seeker", "Every runner is caught!");
    else if (s.phaseLeft <= 0) this.endRound("seeker", "Time's up! The orbs weren't collected.");
  }

  private ageThings(arr: ArraySchema<Thing>, dtMs: number) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = arr[i];
      const left = t.ttl - dtMs;
      if (left <= 0) arr.splice(i, 1);
      else t.ttl = left;
    }
  }

  private updateDecoys(dt: number, dtMs: number, occ: Occluders) {
    const s = this.state;
    const map = this.map!;
    const seeker = this.seeker;
    for (let i = s.decoys.length - 1; i >= 0; i--) {
      const d = s.decoys[i];
      const body = { x: d.x, y: d.y, vx: d.vx, vy: d.vy };
      const speed = Math.hypot(d.vx, d.vy) || PLAYER.runnerSpeed;
      stepBody(body, d.vx / speed, d.vy / speed, dt, {
        maxSpeed: PLAYER.runnerSpeed,
        ghost: false,
        frozen: false,
        width: map.width,
        height: map.height,
        rects: map.rects,
      });
      // Bumped into something: turn to a random open direction.
      if (Math.hypot(body.vx, body.vy) < speed * 0.4) {
        const a = this.rng() * Math.PI * 2;
        body.vx = Math.cos(a) * PLAYER.runnerSpeed;
        body.vy = Math.sin(a) * PLAYER.runnerSpeed;
      }
      d.x = body.x;
      d.y = body.y;
      d.vx = body.vx;
      d.vy = body.vy;
      d.ttl = Math.max(0, d.ttl - dtMs);
      const seen = !!seeker && !seeker.blinded && seekerSees(seeker, d, occ);
      const exp = (this.decoyExposure.get(d.id) ?? 0) + (seen ? dtMs : 0);
      this.decoyExposure.set(d.id, exp);
      if (d.ttl <= 0 || exp >= 500) {
        if (exp >= 500) this.pending.push({ k: "decoyPop", x: d.x, y: d.y });
        s.decoys.splice(i, 1);
        this.decoyExposure.delete(d.id);
      }
    }
  }

  private updateItemBoxes(dtMs: number) {
    for (let i = this.itemRespawn.length - 1; i >= 0; i--) {
      this.itemRespawn[i] -= dtMs;
      if (this.itemRespawn[i] <= 0) {
        this.itemRespawn.splice(i, 1);
        this.spawnItemBox();
      }
    }
  }

  private freeSpot(minFromOthers: number, avoid: Vec[]): Vec | null {
    const map = this.map!;
    const seeker = this.seeker;
    for (let attempt = 0; attempt < 200; attempt++) {
      const relaxed = attempt > 120;
      const cell = map.openCells[Math.floor(this.rng() * map.openCells.length)];
      const p = cellCenter(cell.col, cell.row);
      if (!relaxed && dist(p, map.spawn) < 130) continue;
      if (!relaxed && seeker && this.state.phase === "hunt" && dist(p, seeker) < 260) continue;
      if (avoid.some((a) => dist(a, p) < (relaxed ? 100 : minFromOthers))) continue;
      if (this.runners.some((r) => r.status === "free" && dist(r, p) < 110)) continue;
      return p;
    }
    return null;
  }

  private fillOrbs() {
    const s = this.state;
    const round = s.round!;
    const want = Math.min(RULES.activeOrbs(this.runners.length), round.orbsToWin - s.collected) - this.orbTimers.length;
    while (s.orbs.length < want) {
      const p = this.freeSpot(250, [...s.orbs, ...s.items]);
      if (!p) break;
      const orb = new Thing();
      Object.assign(orb, { id: this.nextId++, x: p.x, y: p.y });
      s.orbs.push(orb);
    }
  }

  private spawnItemBox() {
    const s = this.state;
    const p = this.freeSpot(200, [...s.orbs, ...s.items]);
    if (!p) return;
    const box = new Thing();
    Object.assign(box, { id: this.nextId++, x: p.x, y: p.y });
    s.items.push(box);
  }

  private catchRunner(r: Player, seeker: Player) {
    const pr = this.priv.get(r.id)!;
    pr.timesCaught++;
    r.exposure = 0;
    r.rescue = 0;
    r.cdA = 0; // the slot becomes HELP/BOO: start it fresh
    pr.helped = 0;
    r.rooted = false;
    pr.rootMs = 0;
    r.status = pr.timesCaught >= 2 ? "ghost" : "caged";
    r.vx = r.vy = 0;
    if (r.status === "ghost") r.item = "";
    pr.stats.peak = 0;
    const sp = this.priv.get(seeker.id)!;
    sp.stats.catches++;
    if (sp.stats.firstCatchMs < 0) sp.stats.firstCatchMs = this.huntElapsed;
    this.pending.push({ k: "caught", id: r.id, by: seeker.id, x: r.x, y: r.y, ghost: r.status === "ghost" });
  }

  endRound(winner: RoundResult["winner"], reason: string) {
    const s = this.state;
    const players: PlayerResult[] = [];
    for (const p of this.players) {
      if (!p.inRound) continue;
      const st = this.priv.get(p.id)!.stats;
      let points = 0;
      if (winner !== "aborted") {
        points =
          p.role === "seeker"
            ? st.catches * SCORING.seekerCatch + (winner === "seeker" ? SCORING.seekerWin : 0)
            : st.orbs * SCORING.runnerOrb + st.rescues * SCORING.runnerRescue + (winner === "runners" ? SCORING.runnerWin : 0);
      }
      p.score += points;
      players.push({ id: p.id, role: p.role, status: p.status, catches: st.catches, orbs: st.orbs, rescues: st.rescues, points });
      p.lit = false;
      p.searching = 0;
      p.vx = p.vy = 0;
    }
    const result: RoundResult = { winner, reason, players, awards: winner === "aborted" ? [] : this.awards() };
    s.result = JSON.stringify(result);
    s.poloActive = false;
    this.setPhase("round_over", 0);
    this.flush();
    for (const p of this.players) if (this.priv.get(p.id)?.left) this.removeSeat(p.id);
  }

  private awards(): Award[] {
    const out: Award[] = [];
    const runners = this.runners.filter((p) => !this.priv.get(p.id)!.left).map((p) => ({ p, st: this.priv.get(p.id)!.stats }));
    const best = <T>(list: T[], score: (t: T) => number, min: number) => {
      let top: T | undefined;
      let topScore = min;
      for (const t of list) {
        const sc = score(t);
        if (sc > topScore) {
          top = t;
          topScore = sc;
        }
      }
      return top;
    };
    const close = best(runners, (r) => Math.max(r.st.closeCall, r.p.status === "free" ? r.st.peak : 0), 0.6);
    if (close) out.push({ id: close.p.id, title: "Closest call", detail: `Escaped at ${Math.round(Math.max(close.st.closeCall, close.st.peak) * 100)}% exposure` });
    const orbs = best(runners, (r) => r.st.orbs, 1);
    if (orbs) out.push({ id: orbs.p.id, title: "Orb hoarder", detail: `${orbs.st.orbs} orbs collected` });
    const hero = best(runners, (r) => r.st.rescues, 0);
    if (hero) out.push({ id: hero.p.id, title: "Hero", detail: `Freed ${hero.st.rescues} caged friend${hero.st.rescues > 1 ? "s" : ""}` });
    const dare = best(runners, (r) => r.st.nearSeekerMs, 3000);
    if (dare) out.push({ id: dare.p.id, title: "Daredevil", detail: `${Math.round(dare.st.nearSeekerMs / 1000)}s within reach of the seeker` });
    const hider = best(runners, (r) => r.st.lockerMs, 5000);
    if (hider) out.push({ id: hider.p.id, title: "Locker legend", detail: `${Math.round(hider.st.lockerMs / 1000)}s hidden in lockers` });
    const seeker = this.seeker;
    if (seeker) {
      const st = this.priv.get(seeker.id)!.stats;
      if (st.catches >= 3) out.push({ id: seeker.id, title: "Exterminator", detail: `${st.catches} catches` });
      else if (st.firstCatchMs >= 0 && st.firstCatchMs < 20000)
        out.push({ id: seeker.id, title: "Eagle eye", detail: `First catch after ${Math.max(1, Math.round(st.firstCatchMs / 1000))}s` });
    }
    return out.slice(0, 4);
  }

  /** Snapshot used for persistence/debugging in tests. */
  get phase(): Phase {
    return this.state.phase;
  }
}

function shrink(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x + 2, y: r.y + 2, w: Math.max(0, r.w - 4), h: Math.max(0, r.h - 4) };
}
