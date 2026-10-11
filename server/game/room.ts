import { randomBytes } from "crypto";
import type {
  FxEvent,
  InputMsg,
  LobbyPlayer,
  Orb,
  Phase,
  PlayerResult,
  Role,
  RoomInfo,
  RoundInfo,
  RoundResult,
  Snapshot,
  Status,
} from "@shared/protocol";
import { ABILITIES, PLAYER, PLAYER_COLORS, RULES, SCORING, mazeSizeFor } from "@shared/config";
import { generateMaze, cellCenter, cellOf } from "@shared/maze";
import { stepMover, type MoverState } from "@shared/physics";
import { abilityAllowed, abilityBoost, abilityCooldown, abilityFor, moveCtxFor, type Ability } from "@shared/rules";
import { dist, seekerSees } from "@shared/geometry";

export interface Broadcaster {
  room(info: RoomInfo): void;
  snap(snap: Snapshot): void;
  fx(events: FxEvent[]): void;
}

interface Seat {
  id: string;
  token: string;
  name: string;
  color: string;
  score: number;
  timesSeeker: number;
  connected: boolean;
  offlineMs: number;
  /** Explicitly left mid-round; removed when the round ends. */
  left: boolean;

  // Per-round state
  inRound: boolean;
  role: Role;
  status: Status;
  mover: MoverState;
  queue: InputMsg[];
  credits: number;
  ack: number;
  exposure: number;
  rescue: number;
  invulnMs: number;
  cdA: number;
  cdB: number;
  timesCaught: number;
  lit: boolean;
  idleMs: number;
  idleAnchor: { x: number; y: number };
  stats: { catches: number; orbs: number; rescues: number };
}

const MAX_QUEUE = 30;
const MAX_CREDITS = 4;

export function newToken(): string {
  return randomBytes(12).toString("base64url");
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export class Room {
  readonly code: string;
  readonly hostToken = newToken();
  hostConnected = true;
  idleMs = 0;

  phase: Phase = "lobby";
  private phaseLeft = 0;
  private seats: Seat[] = [];
  private round: RoundInfo | null = null;
  private result: RoundResult | null = null;
  private roundCounter = 0;
  private tickCount = 0;
  private orbs: Orb[] = [];
  private orbCounter = 0;
  private collected = 0;
  private poloLeft = 0;
  private pendingFx: FxEvent[] = [];
  private nextColor = 0;

  constructor(
    code: string,
    private out: Broadcaster,
    private rng: () => number = Math.random,
  ) {
    this.code = code;
  }

  // ---------------------------------------------------------------- lobby

  get vipId(): string | null {
    return this.seats.find((s) => s.connected && !s.left)?.id ?? null;
  }

  hasConnectedClients(): boolean {
    return this.hostConnected || this.seats.some((s) => s.connected);
  }

  playerByToken(token: string): Seat | undefined {
    return this.seats.find((s) => s.token === token && !s.left);
  }

  /** A disconnected seat with this name can be reclaimed (e.g. the phone lost its saved token). */
  reclaimableSeat(name: string): Seat | undefined {
    return this.seats.find((s) => !s.left && !s.connected && s.name.toLowerCase() === name.toLowerCase());
  }

  get joinable(): boolean {
    return (this.phase === "lobby" || this.phase === "round_over") && this.seats.filter((s) => !s.left).length < RULES.maxPlayers;
  }

  canJoin(name: string): { reason: "in_progress" | "full" | "name_taken"; error: string } | null {
    if (this.phase !== "lobby" && this.phase !== "round_over")
      return { reason: "in_progress", error: "A round is in progress. You can join when it ends." };
    if (this.seats.filter((s) => !s.left).length >= RULES.maxPlayers) return { reason: "full", error: "This room is full" };
    if (this.seats.some((s) => !s.left && s.name.toLowerCase() === name.toLowerCase()))
      return { reason: "name_taken", error: "Someone in this room already has that name" };
    return null;
  }

  playerCount(): number {
    return this.seats.filter((s) => !s.left).length;
  }

  addPlayer(name: string): Seat {
    const used = new Set(this.seats.map((s) => s.color));
    let color = PLAYER_COLORS[this.nextColor++ % PLAYER_COLORS.length];
    for (const c of PLAYER_COLORS) {
      if (!used.has(c)) {
        color = c;
        break;
      }
    }
    const seat: Seat = {
      id: newToken().slice(0, 8),
      token: newToken(),
      name,
      color,
      score: 0,
      timesSeeker: 0,
      connected: true,
      offlineMs: 0,
      left: false,
      inRound: false,
      role: "runner",
      status: "free",
      mover: { x: 0, y: 0, angle: 0, boost: 0, boostMul: 1 },
      queue: [],
      credits: 0,
      ack: 0,
      exposure: 0,
      rescue: 0,
      invulnMs: 0,
      cdA: 0,
      cdB: 0,
      timesCaught: 0,
      lit: false,
      idleMs: 0,
      idleAnchor: { x: 0, y: 0 },
      stats: { catches: 0, orbs: 0, rescues: 0 },
    };
    this.seats.push(seat);
    this.broadcastRoom();
    return seat;
  }

  setConnected(playerId: string, connected: boolean) {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    seat.connected = connected;
    seat.offlineMs = 0;
    if (connected) {
      // Inputs from the previous connection are stale.
      seat.queue = [];
    }
    this.broadcastRoom();
  }

  leave(playerId: string) {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    if (this.phase === "lobby" || this.phase === "round_over" || !seat.inRound) {
      this.seats = this.seats.filter((s) => s !== seat);
      this.broadcastRoom();
      return;
    }
    seat.left = true;
    seat.connected = false;
    if (seat.role === "seeker") {
      this.endRound("aborted", `${seat.name} (seeker) left the game`);
      return;
    }
    // A runner who quits mid-round is out for good.
    seat.status = "ghost";
    seat.exposure = 0;
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- rounds

  start(): string | null {
    if (this.phase !== "lobby" && this.phase !== "round_over") return "Round already running";
    this.seats = this.seats.filter((s) => !s.left);
    const players = this.seats.filter((s) => s.connected);
    if (players.length < RULES.minPlayers) return `Need at least ${RULES.minPlayers} players`;

    // Rotate seeker: fewest turns so far, ties broken randomly.
    const minTurns = Math.min(...players.map((s) => s.timesSeeker));
    const candidates = players.filter((s) => s.timesSeeker === minTurns);
    const seeker = candidates[Math.floor(this.rng() * candidates.length)];
    seeker.timesSeeker++;

    const { cols, rows } = mazeSizeFor(players.length);
    const maze = generateMaze(cols, rows, this.rng);
    const spawn = cellCenter(Math.floor(cols / 2), Math.floor(rows / 2));

    this.round = {
      id: ++this.roundCounter,
      width: maze.width,
      height: maze.height,
      cols,
      rows,
      walls: maze.walls,
      seekerId: seeker.id,
      orbsToWin: RULES.orbsToWin(players.length - 1),
      spawn,
    };

    for (const s of this.seats) s.inRound = false;
    for (const s of players) {
      const isSeeker = s === seeker;
      const jitter = isSeeker ? 0 : 18;
      Object.assign(s, {
        inRound: true,
        role: isSeeker ? "seeker" : "runner",
        status: "free",
        mover: {
          x: spawn.x + (this.rng() - 0.5) * jitter * 2,
          y: spawn.y + (this.rng() - 0.5) * jitter * 2,
          angle: this.rng() * Math.PI * 2,
          boost: 0,
          boostMul: 1,
        },
        queue: [],
        credits: 0,
        exposure: 0,
        rescue: 0,
        invulnMs: 0,
        cdA: 0,
        cdB: 0,
        timesCaught: 0,
        lit: false,
        idleMs: 0,
        stats: { catches: 0, orbs: 0, rescues: 0 },
      } satisfies Partial<Seat>);
      s.idleAnchor = { x: s.mover.x, y: s.mover.y };
    }

    this.result = null;
    this.orbs = [];
    this.collected = 0;
    this.poloLeft = 0;
    this.pendingFx = [];
    this.fillOrbs();
    this.setPhase("reveal", RULES.revealMs);
    return null;
  }

  toLobby() {
    if (this.phase === "lobby") return;
    if (this.phase !== "round_over") this.endRound("aborted", "Host ended the round");
    this.seats = this.seats.filter((s) => !s.left);
    for (const s of this.seats) s.inRound = false;
    this.round = null;
    this.result = null;
    this.setPhase("lobby", 0);
  }

  private setPhase(phase: Phase, ms: number) {
    this.phase = phase;
    this.phaseLeft = ms;
    this.broadcastRoom();
  }

  private get runners() {
    return this.seats.filter((s) => s.inRound && s.role === "runner");
  }

  private get seeker() {
    return this.seats.find((s) => s.inRound && s.role === "seeker");
  }

  // ---------------------------------------------------------------- input

  queueInputs(playerId: string, inputs: InputMsg[]) {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat || !seat.inRound || !Array.isArray(inputs)) return;
    if (this.phase !== "reveal" && this.phase !== "scatter" && this.phase !== "hunt") return;
    let lastSeq = seat.queue.length ? seat.queue[seat.queue.length - 1].seq : seat.ack;
    for (const inp of inputs.slice(-MAX_QUEUE)) {
      if (!inp || typeof inp.seq !== "number" || inp.seq <= lastSeq) continue;
      const mx = Number(inp.mx) || 0;
      const my = Number(inp.my) || 0;
      seat.queue.push({ seq: inp.seq, mx, my, a: inp.a ? 1 : undefined, b: inp.b ? 1 : undefined });
      lastSeq = inp.seq;
    }
    if (seat.queue.length > MAX_QUEUE) seat.queue.splice(0, seat.queue.length - MAX_QUEUE);
  }

  private applyInput(seat: Seat, inp: InputMsg) {
    if (inp.a) this.useAbility(seat, "a");
    if (inp.b) this.useAbility(seat, "b");
    stepMover(seat.mover, inp.mx, inp.my, moveCtxFor(seat.role, seat.status, this.phase, this.round!));
    seat.ack = inp.seq;
  }

  private useAbility(seat: Seat, slot: "a" | "b") {
    const ability = abilityFor(seat.role, seat.status, slot);
    if (!ability || !abilityAllowed(ability, this.phase)) return;
    const cdKey = slot === "a" ? "cdA" : "cdB";
    if (seat[cdKey] > 0) return;
    seat[cdKey] = abilityCooldown(ability);

    const boost = abilityBoost(ability);
    if (boost) {
      seat.mover.boost = boost.steps;
      seat.mover.boostMul = boost.mul;
    }
    if (ability === "polo") this.polo();
    if (ability === "boo") this.noise(seat.mover.x, seat.mover.y);
  }

  private polo() {
    const targets = this.runners.filter((r) => r.status === "free");
    const { jitter } = ABILITIES.polo;
    const pings = targets.map((r) => {
      const a = this.rng() * Math.PI * 2;
      const d = this.rng() * jitter;
      return { x: r.mover.x + Math.cos(a) * d, y: r.mover.y + Math.sin(a) * d };
    });
    this.poloLeft = ABILITIES.polo.windowMs;
    this.pendingFx.push({ k: "polo", pings, targets: targets.map((t) => t.id) });
  }

  /** A sound the seeker can hear: orb pickups, sneezes, ghost boos. */
  private noise(x: number, y: number) {
    this.pendingFx.push({ k: "noise", x, y, polo: this.poloLeft > 0 });
  }

  // ---------------------------------------------------------------- tick

  tick(dtMs: number) {
    this.tickCount++;
    this.housekeeping(dtMs);
    if (!this.round || this.phase === "lobby" || this.phase === "round_over") return;

    for (const s of this.seats) {
      if (!s.inRound) continue;
      s.credits = Math.min(s.credits + 1, MAX_CREDITS);
      while (s.queue.length && s.credits >= 1) {
        this.applyInput(s, s.queue.shift()!);
        s.credits--;
      }
      s.cdA = Math.max(0, s.cdA - dtMs);
      s.cdB = Math.max(0, s.cdB - dtMs);
    }
    this.poloLeft = Math.max(0, this.poloLeft - dtMs);

    this.phaseLeft -= dtMs;
    if (this.phase === "reveal" && this.phaseLeft <= 0) this.setPhase("scatter", RULES.scatterMs);
    else if (this.phase === "scatter" && this.phaseLeft <= 0) this.setPhase("hunt", RULES.huntMs);
    else if (this.phase === "hunt") this.huntTick(dtMs);

    if (this.pendingFx.length) {
      this.out.fx(this.pendingFx);
      this.pendingFx = [];
    }
    if (this.round) this.out.snap(this.snapshot());
  }

  private housekeeping(dtMs: number) {
    let changed = false;
    for (const s of this.seats) {
      if (s.connected) continue;
      s.offlineMs += dtMs;
      if (this.phase === "lobby" && s.offlineMs > RULES.lobbyDropMs) {
        s.left = true;
        changed = true;
      }
    }
    if (changed) {
      this.seats = this.seats.filter((s) => !s.left);
      this.broadcastRoom();
    }

    const seeker = this.seeker;
    if (
      seeker &&
      !seeker.connected &&
      seeker.offlineMs > RULES.seekerDropAbortMs &&
      (this.phase === "reveal" || this.phase === "scatter" || this.phase === "hunt")
    ) {
      this.endRound("aborted", `${seeker.name} (seeker) disconnected`);
    }

    this.idleMs = this.hasConnectedClients() ? 0 : this.idleMs + dtMs;
  }

  private huntTick(dtMs: number) {
    const dt = dtMs / 1000;
    const round = this.round!;
    const seeker = this.seeker;
    const runners = this.runners;

    for (const r of runners) {
      r.invulnMs = Math.max(0, r.invulnMs - dtMs);
      r.lit = false;
      if (r.status !== "free") continue;

      // Exposure
      const seen = !!seeker && seekerSees(seeker.mover, r.mover, round.walls);
      r.lit = seen;
      if (seen && r.invulnMs <= 0) {
        r.exposure += dt / RULES.exposureFillSec;
        if (r.exposure >= 1) this.catchRunner(r, seeker!);
      } else {
        r.exposure = Math.max(0, r.exposure - dt / RULES.exposureDecaySec);
      }
      if (r.status !== "free") continue;

      // Orbs
      for (const orb of this.orbs) {
        if (dist(orb, r.mover) <= RULES.orbRadius + PLAYER.hitHalf) {
          this.orbs = this.orbs.filter((o) => o !== orb);
          this.collected++;
          r.stats.orbs++;
          this.pendingFx.push({ k: "orb", x: orb.x, y: orb.y, by: r.id });
          this.fillOrbs();
          break;
        }
      }

      // Sneeze: campers give away their position.
      if (dist(r.mover, r.idleAnchor) > RULES.sneezeMoveThreshold) {
        r.idleAnchor = { x: r.mover.x, y: r.mover.y };
        r.idleMs = 0;
      } else {
        r.idleMs += dtMs;
        if (r.idleMs >= RULES.sneezeIdleMs) {
          r.idleMs = 0;
          this.noise(r.mover.x, r.mover.y);
        }
      }
    }

    // Rescues
    for (const caged of runners) {
      if (caged.status !== "caged") continue;
      const rescuer = runners.find(
        (r) => r.status === "free" && r !== caged && dist(r.mover, caged.mover) <= RULES.rescueRadius,
      );
      if (rescuer) {
        caged.rescue += dt / RULES.rescueSec;
        if (caged.rescue >= 1) {
          caged.status = "free";
          caged.rescue = 0;
          caged.exposure = 0;
          caged.invulnMs = RULES.rescueInvulnMs;
          caged.idleAnchor = { x: caged.mover.x, y: caged.mover.y };
          caged.idleMs = 0;
          rescuer.stats.rescues++;
          this.pendingFx.push({ k: "freed", id: caged.id, by: rescuer.id });
        }
      } else {
        caged.rescue = Math.max(0, caged.rescue - dt / RULES.rescueDecaySec);
      }
    }

    if (this.collected >= round.orbsToWin) {
      this.endRound("runners", "The runners collected every orb!");
    } else if (runners.length && !runners.some((r) => r.status === "free")) {
      this.endRound("seeker", "Every runner is caught!");
    } else if (this.phaseLeft <= 0) {
      this.endRound("seeker", "Time's up! The orbs were not collected.");
    }
  }

  private catchRunner(r: Seat, seeker: Seat) {
    r.timesCaught++;
    r.exposure = 0;
    r.rescue = 0;
    r.status = r.timesCaught >= 2 ? "ghost" : "caged";
    seeker.stats.catches++;
    this.pendingFx.push({ k: "caught", id: r.id, x: r.mover.x, y: r.mover.y, ghost: r.status === "ghost" });
  }

  private fillOrbs() {
    const round = this.round!;
    const runnerCount = this.runners.length;
    const want = Math.min(RULES.activeOrbs(runnerCount), round.orbsToWin - this.collected);
    const seeker = this.seeker;
    let attempts = 0;
    while (this.orbs.length < want && attempts++ < 200) {
      const col = Math.floor(this.rng() * round.cols);
      const row = Math.floor(this.rng() * round.rows);
      const p = cellCenter(col, row);
      const relaxed = attempts > 120;
      const spawnCell = cellOf(round.spawn.x, round.spawn.y, round.cols, round.rows);
      if (!relaxed && col === spawnCell.col && row === spawnCell.row) continue;
      if (!relaxed && seeker && this.phase === "hunt" && dist(p, seeker.mover) < 260) continue;
      if (this.orbs.some((o) => dist(o, p) < (relaxed ? 100 : 250))) continue;
      if (this.runners.some((r) => r.status === "free" && dist(r.mover, p) < 120)) continue;
      this.orbs.push({ id: ++this.orbCounter, x: p.x, y: p.y });
    }
  }

  private endRound(winner: RoundResult["winner"], reason: string) {
    const players: PlayerResult[] = [];
    for (const s of this.seats) {
      if (!s.inRound) continue;
      let points = 0;
      if (winner !== "aborted") {
        if (s.role === "seeker") {
          points = s.stats.catches * SCORING.seekerCatch + (winner === "seeker" ? SCORING.seekerWin : 0);
        } else {
          points =
            s.stats.orbs * SCORING.runnerOrb +
            s.stats.rescues * SCORING.runnerRescue +
            (winner === "runners" ? SCORING.runnerWin : 0);
        }
      }
      s.score += points;
      players.push({ id: s.id, role: s.role, status: s.status, ...s.stats, points });
    }
    this.result = { winner, reason, players };
    for (const s of this.seats) {
      s.queue = [];
      s.lit = false;
    }
    if (this.pendingFx.length) {
      this.out.fx(this.pendingFx);
      this.pendingFx = [];
    }
    this.phaseLeft = 0;
    this.phase = "round_over";
    if (this.round) this.out.snap(this.snapshot());
    this.seats = this.seats.filter((s) => !s.left);
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- output

  snapshot(): Snapshot {
    return {
      tick: this.tickCount,
      phase: this.phase,
      phaseLeft: Math.max(0, Math.round(this.phaseLeft)),
      collected: this.collected,
      orbs: this.orbs,
      poloActive: this.poloLeft > 0,
      players: this.seats
        .filter((s) => s.inRound)
        .map((s) => ({
          id: s.id,
          x: round2(s.mover.x),
          y: round2(s.mover.y),
          angle: Math.round(s.mover.angle * 1000) / 1000,
          role: s.role,
          status: s.status,
          exposure: round2(s.exposure),
          rescue: round2(s.rescue),
          lit: s.lit,
          invuln: s.invulnMs > 0,
          ack: s.ack,
          boost: s.mover.boost,
          boostMul: s.mover.boostMul,
          cdA: Math.round(s.cdA),
          cdB: Math.round(s.cdB),
          connected: s.connected,
        })),
    };
  }

  info(): RoomInfo {
    const players: LobbyPlayer[] = this.seats
      .filter((s) => !s.left)
      .map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        connected: s.connected,
        score: s.score,
        timesSeeker: s.timesSeeker,
      }));
    return {
      code: this.code,
      phase: this.phase,
      vipId: this.vipId,
      players,
      round: this.round,
      result: this.result,
    };
  }

  broadcastRoom() {
    this.out.room(this.info());
  }

  /** Test helper: direct access to a seat's mutable state. */
  _seat(id: string) {
    return this.seats.find((s) => s.id === id);
  }
}
