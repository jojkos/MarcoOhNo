import Phaser from "phaser";
import type { FxEvent, InputMsg, Orb, RoundInfo, Snapshot, SnapPlayer } from "@shared/protocol";
import { RULES, SEEKER_COLOR, TICK_RATE, VISION } from "@shared/config";
import { abilityAllowed, abilityBoost, abilityCooldown, abilityFor, moveCtxFor } from "@shared/rules";
import { pointInPolygon, runnerLight, seekerAura, seekerCone, type Vec } from "@shared/geometry";
import { useGameStore } from "@/lib/gameStore";
import { latestSnap, onFx, onSnapshot, sendInputs, snapBuffer } from "@/lib/net";
import { exposureTone, sfx, vibrate } from "@/lib/sfx";
import { consumePresses, readMove } from "./input";
import { Predictor } from "./predictor";

export type ViewKind = "tv" | "mobile";

const STEP_MS = 1000 / TICK_RATE;
const INTERP_MS = 110;

const DEPTH = {
  floor: 0,
  walls: 5,
  cone: 40,
  fog: 1000,
  memory: 1050,
  orbs: 1080,
  // Sprite visibility is decided explicitly, so visible players draw above the fog (no clipped labels).
  players: 1090,
  caged: 1092,
  me: 1095,
  fx: 1200,
};

const COLORS = {
  bg: 0x04060b,
  floor: 0x0b1322,
  grid: 0x13203a,
  wall: 0x253a5e,
  wallEdge: 0x4a6fa5,
  memoryFill: 0x16233d,
  memoryEdge: 0x3d5a80,
  cone: 0xffe066,
  polo: 0xcc66ff,
  noise: 0xffa94d,
  caught: 0xff4444,
  freed: 0x4cd964,
  orb: 0xffd43b,
  shield: 0x66d9ff,
};

interface Sprite {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  nose: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Rectangle;
  bar: Phaser.GameObjects.Rectangle;
  cage: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
  shield: Phaser.GameObjects.Arc;
  status: string;
}

interface RenderPlayer {
  p: SnapPlayer;
  x: number;
  y: number;
  angle: number;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class GameScene extends Phaser.Scene {
  private view: ViewKind = "tv";
  private round: RoundInfo | null = null;

  private floorG!: Phaser.GameObjects.Graphics;
  private wallsG!: Phaser.GameObjects.Graphics;
  private memoryG!: Phaser.GameObjects.Graphics;
  private coneG!: Phaser.GameObjects.Graphics;
  private fog!: Phaser.GameObjects.Rectangle;
  private maskG!: Phaser.GameObjects.Graphics;

  private sprites = new Map<string, Sprite>();
  private orbSprites = new Map<number, Phaser.GameObjects.Container>();
  private remembered = new Set<number>();
  private memoryDrawn = -1;

  private predictor = new Predictor();
  private acc = 0;
  private outbox: InputMsg[] = [];
  private localCdUntil = { a: 0, b: 0 };
  private lastHeartbeat = 0;
  private lastCountdown = -1;
  private lastPhase = "";
  private unsubs: (() => void)[] = [];

  constructor() {
    super({ key: "game" });
  }

  init(data: { view: ViewKind }) {
    this.view = data.view;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.floorG = this.add.graphics().setDepth(DEPTH.floor);
    this.wallsG = this.add.graphics().setDepth(DEPTH.walls);
    this.coneG = this.add.graphics().setDepth(DEPTH.cone);
    this.memoryG = this.add.graphics().setDepth(DEPTH.memory);

    this.fog = this.add.rectangle(0, 0, 1, 1, 0x000000, this.view === "tv" ? 0.975 : 0.98);
    this.fog.setOrigin(0).setDepth(DEPTH.fog);
    this.maskG = this.make.graphics({}, false);
    const mask = this.maskG.createGeometryMask();
    mask.setInvertAlpha(true);
    this.fog.setMask(mask);

    this.unsubs.push(onFx((events) => this.handleFx(events)));
    this.unsubs.push(onSnapshot((snap) => this.handleSnap(snap)));
    this.scale.on("resize", this.layoutCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  private cleanup() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.scale.off("resize", this.layoutCamera, this);
    exposureTone(0);
  }

  // ------------------------------------------------------------ round setup

  private buildRound(round: RoundInfo) {
    this.round = round;
    this.sprites.forEach((s) => s.root.destroy());
    this.sprites.clear();
    this.orbSprites.forEach((o) => o.destroy());
    this.orbSprites.clear();
    this.remembered.clear();
    this.memoryDrawn = -1;
    this.memoryG.clear();
    this.predictor = new Predictor();
    this.acc = 0;
    this.outbox = [];
    this.lastCountdown = -1;

    const { width, height, walls } = round;
    const g = this.floorG.clear();
    g.fillStyle(COLORS.floor, 1).fillRect(0, 0, width, height);
    g.lineStyle(1, COLORS.grid, 0.6);
    for (let x = 0; x <= width; x += 40) g.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 40) g.lineBetween(0, y, width, y);

    const w = this.wallsG.clear();
    w.fillStyle(COLORS.wall, 1);
    walls.forEach((r) => w.fillRect(r.x, r.y, r.w, r.h));
    w.lineStyle(2, COLORS.wallEdge, 0.9);
    walls.forEach((r) => w.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2));

    const m = 3000;
    this.fog.setPosition(-m, -m).setSize(width + m * 2, height + m * 2);
    this.layoutCamera();
  }

  private layoutCamera() {
    if (!this.round) return;
    const cam = this.cameras.main;
    const W = this.scale.width;
    const H = this.scale.height;
    const { width, height } = this.round;
    if (this.view === "tv") {
      const top = 104;
      const bottom = 16;
      const zoom = Math.min((W - 32) / width, (H - top - bottom) / height);
      cam.setZoom(zoom);
      cam.removeBounds();
      cam.centerOn(width / 2, height / 2 - (top - bottom) / 2 / zoom);
    } else {
      const me = this.me();
      const span = me?.role === "seeker" ? 620 : me?.status === "ghost" ? 700 : 480;
      cam.setZoom(Math.min(W, H) / span);
      cam.setBounds(-160, -160, width + 320, height + 320);
    }
  }

  private me(): SnapPlayer | null {
    const id = useGameStore.getState().playerId;
    const snap = latestSnap();
    return (id && snap?.players.find((p) => p.id === id)) || null;
  }

  // ------------------------------------------------------------ network hooks

  private handleSnap(snap: Snapshot) {
    const round = this.round;
    if (!round) return;
    const me = this.view === "mobile" ? snap.players.find((p) => p.id === useGameStore.getState().playerId) : undefined;
    if (me) {
      const ctx = moveCtxFor(me.role, me.status, snap.phase, round);
      if (!this.predictor.ready) this.predictor.reset(me);
      else this.predictor.reconcile(me, ctx);
    }

    // Countdown + phase stingers.
    if (snap.phase === "scatter") {
      const sec = Math.ceil(snap.phaseLeft / 1000);
      if (sec !== this.lastCountdown && sec <= 5) sfx.tick();
      this.lastCountdown = sec;
    }
    if (snap.phase !== this.lastPhase) {
      if (snap.phase === "hunt") {
        sfx.go();
        if (me?.role === "runner") vibrate(200);
      }
      if (snap.phase === "round_over") {
        const result = useGameStore.getState().room?.result;
        if (result && result.winner !== "aborted") {
          const iWon = me ? (me.role === "seeker") === (result.winner === "seeker") : true;
          iWon ? sfx.win() : sfx.lose();
        }
      }
      this.lastPhase = snap.phase;
      this.layoutCamera();
    }
  }

  private seekerView(me: SnapPlayer | null) {
    return this.view === "tv" || me?.role === "seeker";
  }

  private handleFx(events: FxEvent[]) {
    const me = this.view === "mobile" ? this.me() : null;
    const seekerView = this.seekerView(me);
    for (const e of events) {
      switch (e.k) {
        case "polo":
          if (seekerView) {
            sfx.marco();
            e.pings.forEach((p) => this.ping(p.x, p.y, COLORS.polo, 130, 2400, "POLO!"));
          }
          if (me && e.targets.includes(me.id)) {
            sfx.polo();
            vibrate([80, 60, 80]);
            const pos = this.predictor.state;
            this.ping(pos.x, pos.y, COLORS.polo, 90, 1600, "POLO!");
          }
          break;
        case "noise":
          if (seekerView) {
            sfx.noise();
            if (e.polo) this.ping(e.x, e.y, COLORS.polo, 130, 2400, "POLO!");
            else this.ping(e.x, e.y, COLORS.noise, 90, 1600, "?");
          } else if (me?.status === "ghost") {
            this.ping(e.x, e.y, COLORS.noise, 70, 1200);
          }
          break;
        case "caught":
          if (seekerView || e.id === me?.id) sfx.caught();
          if (e.id === me?.id) vibrate([400, 100, 400]);
          this.ping(e.x, e.y, COLORS.caught, 110, 1200, e.ghost ? "OUT!" : "CAGED!");
          break;
        case "freed": {
          const p = latestSnap()?.players.find((pl) => pl.id === e.id);
          if (seekerView || e.id === me?.id || e.by === me?.id) sfx.freed();
          if (e.id === me?.id) vibrate([60, 40, 60, 40, 60]);
          if (p) this.ping(p.x, p.y, COLORS.freed, 90, 1200, "FREE!");
          break;
        }
        case "orb":
          sfx.orb();
          this.ping(e.x, e.y, seekerView ? COLORS.noise : COLORS.orb, 80, 1200, seekerView ? "?" : undefined);
          if (e.by === me?.id) vibrate(60);
          break;
      }
    }
  }

  private ping(x: number, y: number, color: number, radius: number, duration: number, label?: string) {
    for (let i = 0; i < 2; i++) {
      const ring = this.add.circle(x, y, radius * 0.25, undefined, 0).setDepth(DEPTH.fx);
      ring.setStrokeStyle(5 - i * 2, color, 1);
      this.tweens.add({
        targets: ring,
        radius,
        alpha: 0,
        delay: i * 250,
        duration: duration * 0.7,
        ease: "Cubic.easeOut",
        onComplete: () => ring.destroy(),
      });
    }
    if (label) {
      const text = this.add
        .text(x, y - 20, label, {
          fontFamily: "Orbitron",
          fontSize: "22px",
          fontStyle: "bold",
          color: "#" + color.toString(16).padStart(6, "0"),
          stroke: "#000000",
          strokeThickness: 5,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.fx);
      this.tweens.add({
        targets: text,
        y: y - 60,
        alpha: 0,
        duration,
        ease: "Cubic.easeOut",
        onComplete: () => text.destroy(),
      });
    }
  }

  // ------------------------------------------------------------ frame

  update(_time: number, delta: number) {
    const room = useGameStore.getState().room;
    if (!room?.round) return;
    if (room.round.id !== this.round?.id) this.buildRound(room.round);
    const snap = latestSnap();
    if (!snap || !this.round) return;

    const me = this.view === "mobile" ? snap.players.find((p) => p.id === useGameStore.getState().playerId) ?? null : null;
    if (me) this.simulate(me, snap, delta);

    const players = this.renderPlayers(snap, me, delta);
    this.renderOrbs(snap.orbs);
    this.renderLightsAndSprites(snap, me, players);
    this.feedback(snap, me, players);
  }

  /** Fixed-step local simulation + input sending (phones only). */
  private simulate(me: SnapPlayer, snap: Snapshot, delta: number) {
    const active = snap.phase === "reveal" || snap.phase === "scatter" || snap.phase === "hunt";
    if (!active || !this.predictor.ready) {
      consumePresses();
      return;
    }
    this.acc += delta;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < 4) {
      this.acc -= STEP_MS;
      steps++;
      const { mx, my } = readMove();
      const presses = consumePresses();
      let boost: { steps: number; mul: number } | undefined;
      const now = performance.now();
      for (const slot of ["a", "b"] as const) {
        if (!presses[slot]) continue;
        const ability = abilityFor(me.role, me.status, slot);
        const serverCd = slot === "a" ? me.cdA : me.cdB;
        if (!ability || !abilityAllowed(ability, snap.phase) || serverCd > 0 || now < this.localCdUntil[slot]) continue;
        this.localCdUntil[slot] = now + abilityCooldown(ability) - 200;
        boost = abilityBoost(ability) ?? boost;
        if (ability === "dash") sfx.dash();
      }
      const ctx = moveCtxFor(me.role, me.status, snap.phase, this.round!);
      this.outbox.push(this.predictor.step(mx, my, presses, boost, ctx));
    }
    if (this.acc > STEP_MS * 4) this.acc = 0;
    if (this.outbox.length) {
      sendInputs(this.outbox);
      this.outbox = [];
    }
  }

  /** Interpolated positions for everyone; the local player uses its prediction. */
  private renderPlayers(snap: Snapshot, me: SnapPlayer | null, delta: number): Map<string, RenderPlayer> {
    const out = new Map<string, RenderPlayer>();
    const renderAt = performance.now() - INTERP_MS;
    let older = snapBuffer[0];
    let newer = snapBuffer[snapBuffer.length - 1];
    for (let i = snapBuffer.length - 1; i > 0; i--) {
      if (snapBuffer[i - 1].at <= renderAt) {
        older = snapBuffer[i - 1];
        newer = snapBuffer[i];
        break;
      }
    }
    const span = newer.at - older.at;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderAt - older.at) / span)) : 1;

    for (const p of snap.players) {
      const a = older.snap.players.find((q) => q.id === p.id);
      const b = newer.snap.players.find((q) => q.id === p.id) ?? p;
      const from = a ?? b;
      out.set(p.id, {
        p,
        x: from.x + (b.x - from.x) * t,
        y: from.y + (b.y - from.y) * t,
        angle: lerpAngle(from.angle, b.angle, t),
      });
    }

    if (me && this.predictor.ready && snap.phase !== "round_over") {
      const pos = this.predictor.renderPos(this.acc / STEP_MS, delta);
      out.set(me.id, { p: me, x: pos.x, y: pos.y, angle: this.predictor.state.angle });
    }

    if (me) {
      const mine = out.get(me.id);
      if (mine) this.cameras.main.centerOn(mine.x, mine.y);
    }
    return out;
  }

  private renderOrbs(orbs: Orb[]) {
    const live = new Set(orbs.map((o) => o.id));
    this.orbSprites.forEach((s, id) => {
      if (!live.has(id)) {
        this.tweens.add({ targets: s, scale: 2, alpha: 0, duration: 300, onComplete: () => s.destroy() });
        this.orbSprites.delete(id);
      }
    });
    for (const orb of orbs) {
      if (this.orbSprites.has(orb.id)) continue;
      const glow = this.add.circle(0, 0, RULES.orbRadius, COLORS.orb, 0.18);
      const core = this.add.circle(0, 0, 9, COLORS.orb, 1).setStrokeStyle(3, 0xffffff, 0.9);
      const c = this.add.container(orb.x, orb.y, [glow, core]).setDepth(DEPTH.orbs);
      this.tweens.add({ targets: glow, scale: 1.5, alpha: 0.05, yoyo: true, repeat: -1, duration: 700 });
      c.setScale(0);
      this.tweens.add({ targets: c, scale: 1, duration: 300, ease: "Back.easeOut" });
      this.orbSprites.set(orb.id, c);
    }
  }

  private renderLightsAndSprites(snap: Snapshot, me: SnapPlayer | null, players: Map<string, RenderPlayer>) {
    const round = this.round!;
    const phase = snap.phase;
    const seekerView = this.seekerView(me);
    const seeker = snap.players.find((p) => p.role === "seeker");
    const seekerPos = seeker ? players.get(seeker.id) : undefined;
    const ghostView = me?.status === "ghost";

    // Which fog applies right now?
    let fogOn = phase === "scatter" || phase === "hunt";
    if (phase === "scatter" && me && me.role === "runner") fogOn = false; // runners see the lit map while hiding
    if (ghostView && phase === "hunt") fogOn = false;

    this.maskG.clear();
    this.coneG.clear();
    let runnerPoly: Vec[] | null = null;

    if (phase === "hunt" && seekerPos) {
      const cone = seekerCone(seekerPos, seekerPos.angle, round.walls);
      const aura = seekerAura(seekerPos, round.walls);
      this.coneG.fillStyle(COLORS.cone, 0.22).fillPoints(cone.points, true);
      this.coneG.fillStyle(COLORS.cone, 0.12).fillPoints(aura.points, true);
      if (seekerView) {
        this.maskG.fillStyle(0xffffff).fillPoints(cone.points, true).fillPoints(aura.points, true);
        let changed = false;
        for (const i of cone.hitWalls.concat(aura.hitWalls)) {
          if (!this.remembered.has(i)) {
            this.remembered.add(i);
            changed = true;
          }
        }
        if (changed) this.memoryDrawn = -1;
      }
    }
    if (me && me.role === "runner" && me.status !== "ghost") {
      const pos = players.get(me.id)!;
      runnerPoly = runnerLight(pos, round.walls).points;
      this.maskG.fillStyle(0xffffff).fillPoints(runnerPoly, true);
    }
    this.fog.setVisible(fogOn);

    // Map memory: runners memorised the maze while it was lit; the seeker maps it as they search.
    const memoryMode = !fogOn ? "none" : seekerView ? "seeker" : "runner";
    const memoryKey = memoryMode === "none" ? -2 : memoryMode === "runner" ? -3 : this.remembered.size;
    if (memoryKey !== this.memoryDrawn) {
      this.memoryDrawn = memoryKey;
      const g = this.memoryG.clear();
      if (memoryMode !== "none") {
        const walls = memoryMode === "runner" ? round.walls : round.walls.filter((_, i) => this.remembered.has(i));
        g.fillStyle(COLORS.memoryFill, 0.55);
        walls.forEach((r) => g.fillRect(r.x, r.y, r.w, r.h));
        g.lineStyle(1.5, COLORS.memoryEdge, 0.5);
        walls.forEach((r) => g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2));
      }
    }

    // Sprites
    const live = new Set(snap.players.map((p) => p.id));
    this.sprites.forEach((s, id) => {
      if (!live.has(id)) {
        s.root.destroy();
        this.sprites.delete(id);
      }
    });

    for (const rp of Array.from(players.values())) {
      const { p } = rp;
      let sprite = this.sprites.get(p.id);
      if (!sprite) {
        sprite = this.makeSprite(p, p.id === me?.id);
        this.sprites.set(p.id, sprite);
      }
      sprite.root.setPosition(rp.x, rp.y);
      const nose = 9;
      sprite.nose.setPosition(Math.cos(rp.angle) * nose, Math.sin(rp.angle) * nose);

      let visible: boolean;
      if (p.id === me?.id) visible = true;
      else if (phase === "reveal" || phase === "round_over") visible = true;
      else if (p.status === "ghost") visible = !!ghostView;
      else if (p.status === "caged") visible = true;
      else if (!fogOn) visible = true;
      else if (seekerView) visible = p.role === "seeker" || p.lit;
      else visible = !!runnerPoly && pointInPolygon(rp, runnerPoly);
      sprite.root.setVisible(visible);

      if (sprite.status !== p.status) {
        sprite.status = p.status;
        this.styleStatus(sprite, p);
      }
      sprite.root.setDepth(p.id === me?.id ? DEPTH.me : p.status === "caged" ? DEPTH.caged : DEPTH.players);

      const showBar = p.role === "runner" && p.status === "free" && p.exposure > 0;
      sprite.barBg.setVisible(showBar);
      sprite.bar.setVisible(showBar);
      if (showBar) sprite.bar.setScale(Math.min(1, p.exposure), 1);

      sprite.ring.clear();
      if (p.status === "caged" && p.rescue > 0) {
        sprite.ring.lineStyle(4, COLORS.freed, 1);
        sprite.ring.beginPath();
        sprite.ring.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.rescue);
        sprite.ring.strokePath();
      }
      sprite.shield.setVisible(p.invuln);
    }
  }

  private makeSprite(p: SnapPlayer, isMe: boolean): Sprite {
    const lobby = useGameStore.getState().room?.players.find((l) => l.id === p.id);
    const colorHex = p.role === "seeker" ? SEEKER_COLOR : lobby?.color ?? "#ffffff";
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const r = 15;

    const shield = this.add.circle(0, 0, r + 8, COLORS.shield, 0.12).setStrokeStyle(2, COLORS.shield, 0.8);
    const body = this.add.circle(0, 0, r, color, 1).setStrokeStyle(isMe ? 4 : 2, 0xffffff, isMe ? 1 : 0.7);
    const nose = this.add.circle(9, 0, p.role === "seeker" ? 6 : 4, p.role === "seeker" ? 0xffe066 : 0xffffff, 0.95);
    const label = this.add
      .text(0, -r - 6, lobby?.name ?? "?", {
        fontFamily: "Rajdhani",
        fontSize: this.view === "tv" ? "17px" : "15px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5, 1);
    const barBg = this.add.rectangle(0, r + 9, 40, 6, 0x000000, 0.8).setStrokeStyle(1, 0xffffff, 0.4);
    const bar = this.add.rectangle(-20, r + 9, 40, 6, COLORS.caught).setOrigin(0, 0.5);
    const cage = this.add.graphics();
    const ring = this.add.graphics();
    const root = this.add.container(p.x, p.y, [shield, body, nose, cage, ring, barBg, bar, label]);
    shield.setVisible(false);
    barBg.setVisible(false);
    bar.setVisible(false);
    const sprite: Sprite = { root, body, nose, label, barBg, bar, cage, ring, shield, status: "" };
    return sprite;
  }

  private styleStatus(s: Sprite, p: SnapPlayer) {
    s.cage.clear();
    s.root.setAlpha(1);
    if (p.status === "caged") {
      s.cage.lineStyle(3, 0xcfd8e3, 1);
      for (let x = -18; x <= 18; x += 9) s.cage.lineBetween(x, -22, x, 20);
      s.cage.strokeRect(-20, -22, 40, 42);
    } else if (p.status === "ghost") {
      s.root.setAlpha(0.45);
    }
  }

  /** Per-frame feel: heartbeat, exposure whine, danger. */
  private feedback(snap: Snapshot, me: SnapPlayer | null, players: Map<string, RenderPlayer>) {
    if (!me || me.role !== "runner" || me.status !== "free" || snap.phase !== "hunt") {
      exposureTone(0);
      return;
    }
    exposureTone(me.exposure);
    const seeker = snap.players.find((p) => p.role === "seeker");
    const mine = players.get(me.id);
    const theirs = seeker ? players.get(seeker.id) : undefined;
    if (!mine || !theirs) return;
    const d = Math.hypot(mine.x - theirs.x, mine.y - theirs.y);
    const threat = Math.max(0, Math.min(1, 1 - (d - 120) / (VISION.seekerConeRange + 150)));
    if (threat <= 0) return;
    const interval = 1100 - 750 * threat;
    const now = performance.now();
    if (now - this.lastHeartbeat > interval) {
      this.lastHeartbeat = now;
      sfx.heartbeat(threat);
      vibrate(Math.round(25 + 50 * threat));
    }
  }
}
