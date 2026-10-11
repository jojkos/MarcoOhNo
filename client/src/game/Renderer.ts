import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import type { Room } from "@colyseus/sdk";
import { ITEMS, RULES, VISION } from "@shared/config";
import { blocked, circleLight, dist, pointInPolygon, seekerCone, seekerSees, type Circle, type Occluders, type Rect, type Vec } from "@shared/geometry";
import type { FxEvent } from "@shared/protocol";
import type { GameState, Player } from "@shared/schema";
import { getRoom, onCorrect, onFx, onRoomChange, serverNow } from "@/lib/session";
import { useGameStore } from "@/lib/gameStore";
import { Character } from "./Character";
import { Effects } from "./Effects";
import { INTERP_DELAY_MS, Interp } from "./Interp";
import { Lighting } from "./Lighting";
import { LocalMover } from "./LocalMover";
import { MazeView } from "./MazeView";
import { textures } from "./textures";

export type ViewKind = "tv" | "mobile";

const COLORS = {
  cone: 0xfff0c2,
  aura: 0xb8a878,
  runnerLight: 0xbcd6ff,
  orb: 0xffd23f,
  flare: 0xff8a3d,
  item: 0x38d6ff,
  polo: 0xb46bff,
  noise: 0xffa94d,
  caught: 0xff3d5a,
  freed: 0x3dffb5,
};

interface Footprint {
  s: Sprite;
  life: number;
}

/** Everything drawn on the game canvas, for both the TV and phones. */
export class GameRenderer {
  private app = new Application();
  private ready = false;
  private destroyed = false;

  // Layers
  private world = new Container();
  private floorLayer = new Container();
  private decalLayer = new Container();
  private wallLayer = new Container();
  private entityLayer = new Container();
  private overlay = new Container();
  private memoryLayer = new Container();
  private glowLayer = new Container();
  private cageLayer = new Container();
  private labelLayer = new Container();

  private lighting!: Lighting;
  private effects = new Effects();
  private interp = new Interp();
  private mover = new LocalMover();
  private maze: MazeView | null = null;
  private roundId = -1;

  private chars = new Map<string, Character>();
  private decoys = new Map<number, Character>();
  private orbs = new Map<number, { core: Sprite; glow: Sprite; ring: Graphics; t: number; charge: number }>();
  private items = new Map<number, Container>();
  private smokes = new Map<number, Container>();
  private flares = new Map<number, Container>();
  private traps = new Map<number, Graphics>();
  private lockerMarks = new Graphics();
  private footprints: Footprint[] = [];
  private printPool: Sprite[] = [];
  private lastPrint = new Map<string, { x: number; y: number; side: number }>();

  private cam = { x: 0, y: 0, zoom: 1, ready: false };
  private punch: { x: number; y: number; t: number } | null = null;
  private time = 0;
  /** Seeker's current light polygon, for deciding which effects a seeker view may see. */
  private visCone: Vec[] | null = null;
  /** Adaptive quality: slow devices drop to 1x resolution. */
  private perf = { frames: 0, slow: 0, fast: 0, checkAt: 0, low: false };
  private host: HTMLElement | null = null;
  private needsResize = true;
  private unsubs: (() => void)[] = [];
  private boundRoom: Room<GameState> | null = null;

  constructor(private view: ViewKind) {}

  async init(el: HTMLElement) {
    this.host = el;
    // Canvas text keeps whatever font exists when it's created: wait briefly for the web fonts.
    await Promise.race([
      Promise.all([document.fonts?.load('700 16px "Chakra Petch"'), document.fonts?.load('600 16px "Outfit"')]).catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    if (this.destroyed) return;
    await this.app.init({
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      background: 0x020308,
      // MSAA costs a lot of fill rate on phones; the art is soft anyway.
      antialias: this.view === "tv",
      autoDensity: true,
      // Phones: 1.5x is visually close to native and much cheaper for the GPU.
      resolution: this.targetResolution(),
      preference: "webgl",
      powerPreference: "high-performance",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    el.appendChild(this.app.canvas);
    // Resize from inside our own frame (not Pixi's resizeTo, which renders one frame before
    // the light map catches up): container size changes, rotation, and DPR changes
    // (window moved to another monitor, browser zoom).
    const ro = new ResizeObserver(() => (this.needsResize = true));
    ro.observe(el);
    this.unsubs.push(() => ro.disconnect());
    let mq: MediaQueryList | null = null;
    const watchDpr = () => {
      mq?.removeEventListener("change", onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener("change", onDpr);
    };
    const onDpr = () => {
      this.needsResize = true;
      watchDpr();
    };
    watchDpr();
    this.unsubs.push(() => mq?.removeEventListener("change", onDpr));
    // iOS drops the GPU context when you switch apps; rebuild baked art when it comes back.
    const restored = () => requestAnimationFrame(() => this.maze?.rebake());
    this.app.canvas.addEventListener("webglcontextrestored", restored);
    this.unsubs.push(() => this.app.canvas.removeEventListener("webglcontextrestored", restored));
    this.lighting = new Lighting(this.app.renderer, this.view === "tv" ? 0.5 : 0.5);

    this.world.addChild(this.floorLayer, this.decalLayer, this.wallLayer, this.entityLayer);
    this.overlay.addChild(this.memoryLayer, this.glowLayer, this.lockerMarks, this.cageLayer, this.labelLayer, this.effects.layer);
    this.app.stage.addChild(this.world, this.lighting.sprite, this.lighting.haze, this.overlay, this.effects.screen);
    this.glowLayer.blendMode = "add";

    this.unsubs.push(onFx((events) => this.handleFx(events)));
    this.unsubs.push(onCorrect(({ x, y }) => this.mover.correct(x, y)));
    this.unsubs.push(onRoomChange((r) => this.bindRoom(r)));
    this.bindRoom(getRoom());
    this.app.ticker.add((t) => this.frame(Math.min(0.1, t.deltaMS / 1000)));
    this.ready = true;
    if (import.meta.env.DEV) (window as any).__renderer = this;
  }

  destroy() {
    this.destroyed = true;
    this.unsubs.forEach((u) => u());
    this.unfeed?.();
    this.unfeed = null;
    this.boundRoom = null;
    if (!this.ready) return;
    this.clearRound();
    this.lighting.destroy();
    this.effects.destroy();
    this.app.destroy(true, { children: true });
  }

  // ------------------------------------------------------------------ state feed

  private unfeed: (() => void) | null = null;

  private bindRoom(r: Room<GameState> | null) {
    if (r === this.boundRoom) return;
    this.unfeed?.();
    this.unfeed = null;
    this.boundRoom = r;
    if (!r) return;
    const feed = (s: GameState) => {
      if (r !== this.boundRoom) return;
      const t = s.time;
      s.players.forEach((p) => this.interp.push(p.id, t, p.x, p.y, p.vx, p.vy, p.angle));
      s.decoys.forEach((d) => this.interp.push(`decoy:${d.id}`, t, d.x, d.y, d.vx, d.vy, Math.atan2(d.vy, d.vx)));
    };
    r.onStateChange(feed);
    this.unfeed = () => r.onStateChange.remove(feed);
  }

  private get me(): Player | null {
    if (this.view !== "mobile") return null;
    const id = useGameStore.getState().playerId;
    return (id && getRoom()?.state.players.get(id)) || null;
  }

  // ------------------------------------------------------------------ round setup

  private clearRound() {
    this.chars.forEach((c) => c.destroy());
    this.chars.clear();
    this.decoys.forEach((c) => c.destroy());
    this.decoys.clear();
    for (const m of [this.orbs, this.items, this.smokes, this.flares, this.traps] as Map<number, any>[]) {
      m.forEach((v) => (v.core ? (v.core.destroy(), v.glow.destroy(), v.ring?.destroy()) : v.destroy({ children: true })));
      m.clear();
    }
    this.footprints.forEach((f) => f.s.destroy());
    this.footprints = [];
    this.lastPrint.clear();
    this.maze?.destroy();
    this.maze = null;
    this.floorLayer.removeChildren();
    this.wallLayer.removeChildren();
    this.memoryLayer.removeChildren();
    this.interp.clear();
    this.mover = new LocalMover();
    this.cam.ready = false;
  }

  private buildRound(s: GameState) {
    this.clearRound();
    const round = s.round!;
    const rects: Rect[] = [];
    round.rects.forEach((r) => rects.push({ x: r.x, y: r.y, w: r.w, h: r.h }));
    const lockers: { x: number; y: number; dir: number }[] = [];
    round.lockers.forEach((l) => lockers.push({ x: l.x, y: l.y, dir: l.dir }));
    this.maze = new MazeView(
      { width: round.width, height: round.height, rects, wallCount: round.wallCount, lockers },
      this.view === "tv" ? Math.min(2, this.app.renderer.resolution) : 1,
    );
    this.floorLayer.addChild(this.maze.floor);
    this.wallLayer.addChild(this.maze.walls);
    this.memoryLayer.addChild(this.maze.memory);
    this.roundId = round.id;
    this.rects = rects;
  }

  private rects: Rect[] = [];

  // ------------------------------------------------------------------ frame

  private targetResolution() {
    const cap = this.view === "tv" ? 2 : 1.5; // phones: 1.5x looks native and costs far less
    return this.perf.low ? 1 : Math.min(window.devicePixelRatio || 1, cap);
  }

  private applySize() {
    if (!this.needsResize || !this.host) return;
    this.needsResize = false;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const res = this.targetResolution();
    const r = this.app.renderer;
    if (w !== this.app.screen.width || h !== this.app.screen.height || res !== r.resolution) r.resize(w, h, res);
  }

  /**
   * Adaptive quality: drop to 1x when the device really struggles (< ~22 fps), go back up
   * once it's comfortably smooth. A steady 30 fps cap (battery saver, some TVs) isn't "slow".
   */
  private adaptQuality(dt: number) {
    const p = this.perf;
    p.frames++;
    if (dt > 0.045) p.slow++;
    if (dt < 0.02) p.fast++;
    if (this.time < p.checkAt) return;
    p.checkAt = this.time + (p.low ? 8 : 3);
    if (p.frames > 30) {
      if (!p.low && p.slow / p.frames > 0.5 && this.app.renderer.resolution > 1) {
        p.low = true;
        this.needsResize = true;
      } else if (p.low && p.fast / p.frames > 0.9) {
        p.low = false;
        this.needsResize = true;
      }
    }
    p.frames = p.slow = p.fast = 0;
  }

  private frame(dt: number) {
    this.time += dt;
    this.adaptQuality(dt);
    this.applySize();
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const s = getRoom()?.state;
    const round = s?.round;
    if (!s || !round || s.phase === "lobby") {
      this.lighting.resize(W, H);
      this.lighting.ambient = 0x000000;
      this.lighting.haze.visible = false;
      this.lighting.begin();
      this.lighting.end(0, 0, 1);
      return;
    }
    if (round.id !== this.roundId || !this.maze) this.buildRound(s);
    const maze = this.maze!;
    const phase = s.phase;
    const me = this.me;
    const seekerView = this.view === "tv" || me?.role === "seeker";
    const ghostView = me?.status === "ghost";
    const map = { width: round.width, height: round.height, rects: this.rects };

    // Local player moves itself.
    if (me && me.inRound && phase !== "round_over") this.mover.update(dt, me, phase, map);

    // Positions to draw.
    const renderAt = serverNow() - INTERP_DELAY_MS;
    const pos = new Map<string, { x: number; y: number; vx: number; vy: number; a: number }>();
    s.players.forEach((p) => {
      if (!p.inRound) return;
      if (me && p.id === me.id && phase !== "round_over") {
        pos.set(p.id, { x: this.mover.drawX, y: this.mover.drawY, vx: this.mover.vx, vy: this.mover.vy, a: this.mover.angle });
        return;
      }
      const smp = this.interp.sample(p.id, renderAt);
      pos.set(p.id, smp ? { x: smp.x, y: smp.y, vx: smp.vx, vy: smp.vy, a: smp.a } : { x: p.x, y: p.y, vx: p.vx, vy: p.vy, a: p.angle });
    });

    this.updateCamera(dt, W, H, s, me, pos);

    // ---- lights
    const circles: Circle[] = [];
    s.smokes.forEach((sm) => circles.push({ x: sm.x, y: sm.y, r: ITEMS.smoke.radius }));
    const occ: Occluders = { rects: this.rects, circles };
    const seeker = s.players.get(round.seekerId);
    const sp = seeker ? pos.get(seeker.id) : undefined;
    this.lighting.resize(W, H);
    this.lighting.begin();

    const bright = phase === "reveal" || phase === "round_over" || (phase === "scatter" && !seekerView);
    if (bright) this.lighting.ambient = phase === "scatter" ? 0xb8bfd8 : 0x8890ac;
    else if (phase === "scatter") this.lighting.ambient = 0x000000;
    else if (ghostView) this.lighting.ambient = 0x30364a;
    else this.lighting.ambient = seekerView ? 0x000000 : 0x05070e;

    let conePoly: Vec[] | null = null;
    let myPoly: Vec[] | null = null;
    if (phase === "hunt" && seeker && sp && !seeker.blinded) {
      const cone = seekerCone(sp, sp.a, occ);
      const aura = circleLight(sp, VISION.auraRadius * 1.25, occ, 40);
      conePoly = cone.points;
      this.lighting.add({ key: "cone", center: sp, rim: cone.points.slice(1), radius: VISION.coneRange, color: COLORS.cone, alpha: seekerView ? 1 : 0.85, closed: false });
      this.lighting.add({ key: "aura", center: sp, rim: aura.points, radius: VISION.auraRadius * 1.25, color: COLORS.aura, alpha: 0.75, closed: true });
      if (seekerView) maze.remember(cone.hitRects.concat(aura.hitRects));
    }
    // In scatter the TV/seeker stays dark: lit orbs would show where runners went.
    if (phase === "hunt" || (phase === "scatter" && !seekerView)) {
      s.orbs.forEach((o) => {
        const l = circleLight(o, VISION.orbLight, occ, 24);
        this.lighting.add({ key: `orb${o.id}`, center: o, rim: l.points, radius: VISION.orbLight, color: COLORS.orb, alpha: 0.75, closed: true });
      });
      s.flares.forEach((f) => {
        const flick = 0.9 + Math.sin(this.time * 23 + f.id) * 0.06 + Math.sin(this.time * 7) * 0.04;
        const l = circleLight(f, VISION.flareLight, occ, 48);
        this.lighting.add({ key: `flare${f.id}`, center: f, rim: l.points, radius: VISION.flareLight, color: COLORS.flare, alpha: flick, closed: true });
      });
      s.items.forEach((it) => {
        const l = circleLight(it, 36, occ, 16);
        this.lighting.add({ key: `item${it.id}`, center: it, rim: l.points, radius: 36, color: COLORS.item, alpha: 0.5, closed: true });
      });
    }
    if (me && me.role === "runner" && me.status !== "ghost" && phase === "hunt") {
      const mp = pos.get(me.id)!;
      const l = circleLight(mp, VISION.runnerLight, occ);
      myPoly = l.points;
      this.lighting.add({ key: "me", center: mp, rim: l.points, radius: VISION.runnerLight, color: COLORS.runnerLight, alpha: 0.9, closed: true });
    }
    this.visCone = conePoly;
    maze.setShowAll(!seekerView && phase === "hunt");
    maze.updateMemory();
    this.memoryLayer.visible = phase === "hunt" && !ghostView;

    // ---- characters
    const live = new Set<string>();
    s.players.forEach((p) => {
      if (!p.inRound) return;
      live.add(p.id);
      const pp = pos.get(p.id)!;
      let c = this.chars.get(p.id);
      if (!c) {
        c = new Character({ name: p.name, color: p.color, face: p.face, seeker: p.role === "seeker", me: p.id === me?.id });
        this.chars.set(p.id, c);
      }
      c.setStatus(p.status);
      const caged = p.status === "caged";
      const parent = caged ? this.cageLayer : this.entityLayer;
      if (c.root.parent !== parent) parent.addChild(c.root);
      if (c.label.parent !== this.labelLayer) this.labelLayer.addChild(c.label);

      const isMe = p.id === me?.id;
      const reveal = phase === "reveal" || phase === "round_over";
      let bodyVisible = true;
      if (p.status === "ghost") bodyVisible = isMe || !!ghostView || reveal;
      else if (p.locker >= 0) bodyVisible = isMe || reveal;
      c.root.visible = bodyVisible;
      c.root.alpha = p.locker >= 0 ? 0.35 : p.status === "ghost" ? 0.45 : 1;

      let labelVisible: boolean;
      if (!bodyVisible) labelVisible = false;
      else if (isMe || reveal || caged || bright || ghostView) labelVisible = true;
      else if (p.role === "seeker") labelVisible = true; // carries its own light
      else if (seekerView) labelVisible = p.lit || (!!conePoly && pointInPolygon(pp, conePoly)) || (phase === "hunt" && this.nearLight(pp, s));
      else labelVisible = (!!myPoly && pointInPolygon(pp, myPoly)) || this.nearLight(pp, s) || (!!conePoly && pointInPolygon(pp, conePoly));
      c.label.visible = labelVisible;
      c.update(dt, pp.x, pp.y, pp.vx, pp.vy, pp.a, { exposure: p.exposure, rescue: p.rescue, invuln: p.invuln });

      if (p.role === "runner" && p.status === "free" && p.locker < 0 && phase === "hunt") this.footstep(p.id, pp);
    });
    for (const [id, c] of this.chars) {
      if (!live.has(id)) {
        c.destroy();
        this.chars.delete(id);
        this.interp.forget(id);
      }
    }

    this.syncEntities(dt, s, seekerView, occ, sp, seeker?.blinded ?? true);
    this.updateFootprints(dt);
    this.effects.update(dt, W, H);

    // ---- apply camera
    const z = this.cam.zoom;
    const left = this.cam.x - W / 2 / z;
    const top = this.cam.y - H / 2 / z;
    const ox = this.effects.offset.x;
    const oy = this.effects.offset.y;
    for (const layer of [this.world, this.overlay]) {
      layer.scale.set(z);
      layer.position.set(-left * z + ox, -top * z + oy);
    }
    // The light map always covers the screen; shake moves its camera instead of the sprite
    // (moving the sprite would uncover a strip of unlit world at the edge).
    this.lighting.sprite.position.set(0, 0);
    this.lighting.haze.position.set(0, 0);
    // Haze only where it reads as light in the dark, not over a lit lobby.
    this.lighting.haze.visible = !bright;
    this.lighting.end(left - ox / z, top - oy / z, z);
  }

  private nearLight(p: Vec, s: GameState): boolean {
    let lit = false;
    s.orbs.forEach((o) => {
      if (dist(o, p) < VISION.orbLight) lit = true;
    });
    s.flares.forEach((f) => {
      if (dist(f, p) < VISION.flareLight && !blocked(f, p, { rects: this.rects })) lit = true;
    });
    return lit;
  }

  // ------------------------------------------------------------------ camera

  private updateCamera(dt: number, W: number, H: number, s: GameState, me: Player | null, pos: Map<string, { x: number; y: number; vx: number; vy: number }>) {
    const round = s.round!;
    let tx: number;
    let ty: number;
    let tz: number;
    if (this.view === "tv") {
      const top = 108;
      const fit = Math.min((W - 40) / round.width, (H - top - 20) / round.height);
      tz = fit;
      tx = round.width / 2;
      ty = round.height / 2 - (top - 20) / 2 / fit;
      if (s.phase === "reveal") {
        // Cinematic: start close on the spawn, pull back to the whole maze.
        const k = Math.min(1, 1 - s.phaseLeft / RULES.revealMs);
        const e = k < 0.35 ? 0 : (k - 0.35) / 0.65;
        const ease = e * e * (3 - 2 * e);
        tz = fit * (2.4 - 1.4 * ease);
        tx = round.spawnX + (tx - round.spawnX) * ease;
        ty = round.spawnY + (ty - round.spawnY) * ease;
      }
      if (this.punch) {
        this.punch.t -= dt;
        if (this.punch.t <= 0) this.punch = null;
        else {
          const k = Math.sin(Math.min(1, this.punch.t / 1.2) * Math.PI);
          tz *= 1 + 0.45 * k;
          tx += (this.punch.x - tx) * 0.6 * k;
          ty += (this.punch.y - ty) * 0.6 * k;
        }
      }
    } else {
      // World px across the short side: tight enough that moving feels quick, wide enough for the cone.
      const span = me?.role === "seeker" ? 560 : me?.status === "ghost" ? 680 : 480;
      tz = Math.min(W, H) / span;
      const mp = me ? pos.get(me.id) : undefined;
      if (mp) {
        // Small lead in the direction of travel; too much makes your character drift on screen.
        const look = 0.12;
        const lx = Math.max(-40, Math.min(40, mp.vx * look));
        const ly = Math.max(-40, Math.min(40, mp.vy * look));
        tx = mp.x + lx;
        ty = mp.y + ly;
      } else {
        tx = round.width / 2;
        ty = round.height / 2;
      }
    }
    if (!this.cam.ready) {
      Object.assign(this.cam, { x: tx, y: ty, zoom: tz, ready: true });
    } else {
      const k = 1 - Math.exp(-dt * (this.view === "tv" ? 4 : 10));
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
      this.cam.zoom += (tz - this.cam.zoom) * k;
    }
  }

  // ------------------------------------------------------------------ entities

  private syncEntities(dt: number, s: GameState, seekerView: boolean, occ: Occluders, sp: Vec | undefined, blinded: boolean) {
    const tex = textures();
    const phase = s.phase;

    // Orbs: glowing gold, visible through the dark.
    const orbIds = new Set<number>();
    s.orbs.forEach((o) => {
      orbIds.add(o.id);
      let e = this.orbs.get(o.id);
      if (!e) {
        const core = new Sprite(tex.glow);
        core.anchor.set(0.5);
        core.tint = 0xffe27a;
        core.width = core.height = 22;
        const glow = new Sprite(tex.glow);
        glow.anchor.set(0.5);
        glow.tint = 0xffc21a;
        const ring = new Graphics();
        this.entityLayer.addChild(core);
        this.glowLayer.addChild(glow);
        this.labelLayer.addChild(ring);
        e = { core, glow, ring, t: Math.random() * 6, charge: 0 };
        this.orbs.set(o.id, e);
        this.effects.burst(o.x, o.y, { count: 14, color: 0xffd23f, speed: 120, life: 0.6, size: 10, texture: tex.spark });
      }
      // Charging: spins faster, flares brighter, and a ring fills up.
      const charge = o.charge / 100;
      e.charge += (charge - e.charge) * Math.min(1, dt * 12);
      e.t += dt * (1 + e.charge * 5);
      const pulse = 1 + Math.sin(e.t * 3) * 0.12 + e.charge * 0.5;
      e.core.position.set(o.x, o.y - 4 + Math.sin(e.t * 2) * 3 * (1 - e.charge));
      e.core.width = e.core.height = 22 + e.charge * 10;
      e.glow.position.copyFrom(e.core.position);
      e.glow.width = e.glow.height = 64 * pulse;
      e.glow.alpha = 0.85;
      e.ring.clear();
      if (e.charge > 0.02) {
        e.ring.position.set(o.x, o.y);
        e.ring.circle(0, 0, 30).stroke({ width: 4, color: 0x000000, alpha: 0.4 });
        e.ring.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.charge).stroke({ width: 4, color: 0xffe27a, cap: "round" });
        if (Math.random() < dt * 30 * e.charge) this.effects.burst(o.x, o.y, { count: 1, color: 0xffe27a, speed: 90, life: 0.4, size: 6, texture: tex.spark });
      }
      if (Math.random() < dt * 2) this.effects.burst(o.x, o.y - 6, { count: 1, color: 0xffe27a, speed: 25, life: 0.9, size: 5, texture: tex.spark, dir: -Math.PI / 2, spread: 1.2 });
    });
    for (const [id, e] of this.orbs) {
      if (!orbIds.has(id)) {
        e.core.destroy();
        e.glow.destroy();
        e.ring.destroy();
        this.orbs.delete(id);
      }
    }

    // Item boxes: spinning holographic crystals.
    const itemIds = new Set<number>();
    s.items.forEach((it) => {
      itemIds.add(it.id);
      let c = this.items.get(it.id);
      if (!c) {
        c = new Container();
        const glow = new Sprite(tex.glow);
        glow.anchor.set(0.5);
        glow.tint = 0x38d6ff;
        glow.width = glow.height = 56;
        glow.alpha = 0.6;
        const g = new Graphics();
        g.poly([0, -12, 10, 0, 0, 12, -10, 0]).fill({ color: 0x38d6ff, alpha: 0.25 }).stroke({ width: 2, color: 0x9ff0ff });
        g.label = "gem";
        const q = new Text({ text: "?", style: { fontFamily: "'Chakra Petch'", fontSize: 13, fontWeight: "700", fill: 0xffffff }, resolution: 3 });
        q.anchor.set(0.5);
        c.addChild(glow, g, q);
        c.position.set(it.x, it.y);
        this.overlay.addChildAt(c, this.overlay.getChildIndex(this.glowLayer) + 1);
        this.items.set(it.id, c);
      }
      const gem = c.getChildByLabel("gem");
      if (gem) gem.scale.x = Math.cos(this.time * 2.5 + it.id);
      c.y = it.y + Math.sin(this.time * 2 + it.id) * 3;
    });
    this.prune(this.items, itemIds);

    // Smoke clouds (lit only where light reaches them).
    const smokeIds = new Set<number>();
    s.smokes.forEach((sm) => {
      smokeIds.add(sm.id);
      let c = this.smokes.get(sm.id);
      if (!c) {
        c = new Container();
        for (let i = 0; i < 9; i++) {
          const p = new Sprite(tex.smoke);
          p.anchor.set(0.5);
          const a = (i / 9) * Math.PI * 2;
          const r = i === 0 ? 0 : ITEMS.smoke.radius * 0.55;
          p.position.set(Math.cos(a) * r, Math.sin(a) * r);
          p.width = p.height = ITEMS.smoke.radius * 1.5;
          p.tint = 0xcfd6e6;
          c.addChild(p);
        }
        c.position.set(sm.x, sm.y);
        this.entityLayer.addChild(c);
        this.smokes.set(sm.id, c);
      }
      const k = Math.min(1, sm.ttl / 1200);
      c.alpha = 0.9 * k;
      c.children.forEach((ch, i) => (ch.rotation += dt * (i % 2 ? 0.3 : -0.25)));
      c.scale.set(1 + (1 - Math.min(1, sm.ttl / ITEMS.smoke.durationMs)) * 0.15);
    });
    this.prune(this.smokes, smokeIds);

    // Flares
    const flareIds = new Set<number>();
    s.flares.forEach((f) => {
      flareIds.add(f.id);
      let c = this.flares.get(f.id);
      if (!c) {
        c = new Container();
        const glow = new Sprite(tex.glow);
        glow.anchor.set(0.5);
        glow.tint = 0xff8a3d;
        glow.width = glow.height = 90;
        const core = new Sprite(tex.glow);
        core.anchor.set(0.5);
        core.tint = 0xfff0d0;
        core.width = core.height = 18;
        c.addChild(glow, core);
        c.position.set(f.x, f.y);
        this.glowLayer.addChild(c);
        this.flares.set(f.id, c);
      }
      c.alpha = Math.min(1, f.ttl / 600) * (0.85 + Math.random() * 0.15);
      if (Math.random() < dt * 25) this.effects.burst(f.x, f.y, { count: 1, color: 0xffb36b, speed: 60, life: 0.5, size: 5, dir: -Math.PI / 2, spread: 1.6 });
    });
    this.prune(this.flares, flareIds);

    // Traps: only the seeker side knows where they are.
    const trapIds = new Set<number>();
    if (seekerView) {
      s.traps.forEach((t) => {
        trapIds.add(t.id);
        let g = this.traps.get(t.id);
        if (!g) {
          g = new Graphics();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8).lineTo(Math.cos(a + 0.2) * 14, Math.sin(a + 0.2) * 14);
          }
          g.stroke({ width: 2, color: 0xff3d5a });
          g.circle(0, 0, 7).stroke({ width: 2, color: 0xff3d5a });
          g.position.set(t.x, t.y);
          this.overlay.addChildAt(g, 0);
          this.traps.set(t.id, g);
        }
        g.alpha = 0.35 + Math.sin(this.time * 4) * 0.15;
      });
    }
    this.prune(this.traps, trapIds);

    // Decoys look exactly like their owner.
    const decoyIds = new Set<number>();
    const renderAt = serverNow() - INTERP_DELAY_MS;
    s.decoys.forEach((d) => {
      decoyIds.add(d.id);
      const owner = s.players.get(d.owner);
      let c = this.decoys.get(d.id);
      if (!c) {
        c = new Character({ name: owner?.name ?? "?", color: owner?.color ?? "#fff", face: owner?.face ?? 0, seeker: false, me: false });
        this.entityLayer.addChild(c.root);
        this.labelLayer.addChild(c.label);
        this.decoys.set(d.id, c);
      }
      const smp = this.interp.sample(`decoy:${d.id}`, renderAt) ?? { x: d.x, y: d.y, vx: d.vx, vy: d.vy, a: 0 };
      c.update(dt, smp.x, smp.y, smp.vx, smp.vy, Math.atan2(smp.vy, smp.vx), { exposure: 0, rescue: 0, invuln: false });
      c.label.visible = phase === "hunt" && !!sp && !blinded && seekerSees({ x: sp.x, y: sp.y, angle: s.players.get(s.round!.seekerId)?.angle ?? 0 }, smp, occ);
    });
    for (const [id, c] of this.decoys) {
      if (!decoyIds.has(id)) {
        c.destroy();
        this.decoys.delete(id);
        this.interp.forget(`decoy:${id}`);
      }
    }

    // Searched lockers get a mark for a moment.
    this.lockerMarks.clear();
    if (seekerView) {
      s.round!.lockers.forEach((l) => {
        if (!l.checked) return;
        this.lockerMarks.moveTo(l.x - 7, l.y - 7).lineTo(l.x + 7, l.y + 7).moveTo(l.x + 7, l.y - 7).lineTo(l.x - 7, l.y + 7);
        this.lockerMarks.stroke({ width: 3, color: 0xff3d5a, alpha: 0.8 });
      });
    }
  }

  private prune<T extends Container>(map: Map<number, T>, live: Set<number>) {
    for (const [id, c] of map) {
      if (!live.has(id)) {
        c.destroy({ children: true });
        map.delete(id);
      }
    }
  }

  // ------------------------------------------------------------------ footprints

  private footstep(id: string, p: Vec) {
    const last = this.lastPrint.get(id);
    if (!last) return void this.lastPrint.set(id, { x: p.x, y: p.y, side: 1 });
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 26) return;
    const a = Math.atan2(p.y - last.y, p.x - last.x);
    const side = -last.side;
    const s = this.printPool.pop() ?? new Sprite(textures().dot);
    s.anchor.set(0.5);
    s.tint = 0x9fd6ff;
    s.width = 7;
    s.height = 11;
    s.rotation = a + Math.PI / 2;
    s.position.set(p.x + Math.cos(a + Math.PI / 2) * 5 * side, p.y + Math.sin(a + Math.PI / 2) * 5 * side);
    s.alpha = 0.55;
    s.visible = true;
    this.decalLayer.addChild(s);
    this.footprints.push({ s, life: 3.5 });
    this.lastPrint.set(id, { x: p.x, y: p.y, side });
  }

  private updateFootprints(dt: number) {
    for (let i = this.footprints.length - 1; i >= 0; i--) {
      const f = this.footprints[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.s.visible = false;
        this.decalLayer.removeChild(f.s);
        this.printPool.push(f.s);
        this.footprints.splice(i, 1);
      } else f.s.alpha = 0.55 * Math.min(1, f.life / 1.5);
    }
  }

  // ------------------------------------------------------------------ fx

  /** Can a seeker view see this spot right now (cone, lights)? Runner-made effects elsewhere stay hidden. */
  private seekerCanSee(x: number, y: number): boolean {
    const s = getRoom()?.state;
    const p = { x, y };
    if (this.visCone && pointInPolygon(p, this.visCone)) return true;
    return !!s && this.nearLight(p, s);
  }

  private handleFx(events: FxEvent[]) {
    if (!this.ready) return;
    // Effects only animate on visible frames; don't pile them up while the phone is locked.
    if (document.visibilityState !== "visible") return;
    const s = getRoom()?.state;
    const me = this.me;
    const seekerView = this.view === "tv" || me?.role === "seeker";
    const fx = this.effects;
    const tex = textures();
    for (const e of events) {
      switch (e.k) {
        case "polo":
          if (seekerView)
            e.pings.forEach((p) => {
              fx.ring(p.x, p.y, COLORS.polo, 150, 1.6, 6);
              fx.ring(p.x, p.y, COLORS.polo, 90, 1.2, 3);
              fx.text(p.x, p.y, "POLO!", COLORS.polo, 24);
            });
          if (me && e.targets.includes(me.id)) {
            fx.ring(this.mover.drawX, this.mover.drawY, COLORS.polo, 110, 1.2, 5);
            fx.text(this.mover.drawX, this.mover.drawY, "POLO!", COLORS.polo, 22);
            fx.shake(6, 0.3);
          }
          break;
        case "noise":
          if (seekerView) {
            if (e.polo) {
              fx.ring(e.x, e.y, COLORS.polo, 150, 1.6, 6);
              fx.text(e.x, e.y, "POLO!", COLORS.polo, 24);
            } else {
              fx.ring(e.x, e.y, COLORS.noise, 100, 1.3, 4);
              fx.text(e.x, e.y, e.why === "locker" ? "creak" : e.why === "sneeze" ? "achoo!" : "?", COLORS.noise, 18);
            }
          } else if (me?.status === "ghost") fx.ring(e.x, e.y, COLORS.noise, 70, 1, 3);
          break;
        case "caught": {
          fx.burst(e.x, e.y, { count: 40, color: COLORS.caught, speed: 260, life: 0.8, size: 12, texture: tex.spark });
          fx.ring(e.x, e.y, COLORS.caught, 130, 0.9, 7);
          fx.text(e.x, e.y, e.ghost ? "OUT!" : "CAGED!", COLORS.caught, 26);
          if (this.view === "tv") {
            this.punch = { x: e.x, y: e.y, t: 1.2 };
            fx.flash(0xff2d4f, 0.25, 0.4);
            fx.shake(10, 0.4);
          }
          if (me?.id === e.id) {
            fx.flash(0xff2d4f, 0.6, 0.8);
            fx.shake(14, 0.5);
          }
          break;
        }
        case "freed":
          fx.burst(e.x, e.y, { count: 30, color: COLORS.freed, speed: 200, life: 0.8, size: 10, texture: tex.spark });
          fx.ring(e.x, e.y, COLORS.freed, 110, 0.9, 5);
          fx.text(e.x, e.y, "FREE!", COLORS.freed, 24);
          break;
        case "orb":
          fx.burst(e.x, e.y, { count: 26, color: 0xffd23f, speed: 220, life: 0.7, size: 11, texture: tex.spark });
          if (seekerView) {
            fx.ring(e.x, e.y, COLORS.noise, 100, 1.3, 4);
            fx.text(e.x, e.y, "?", COLORS.noise, 18);
          } else fx.text(e.x, e.y, "+1", 0xffd23f, 20);
          break;
        case "item":
          if (seekerView && me?.id !== e.id && !this.seekerCanSee(e.x, e.y)) break;
          fx.burst(e.x, e.y, { count: 18, color: COLORS.item, speed: 160, life: 0.6, size: 9 });
          if (me?.id === e.id) fx.text(e.x, e.y, e.item.toUpperCase(), COLORS.item, 20);
          break;
        case "use":
          // A runner dashing or popping smoke in the dark must not light up on the TV.
          if (seekerView && me?.id !== e.id && e.item !== "sprint" && e.item !== "flare" && e.item !== "trap" && !this.seekerCanSee(e.x, e.y)) break;
          if (e.item === "dash") fx.burst(e.x, e.y, { count: 12, color: 0xa7f3d0, speed: 140, life: 0.4, size: 9 });
          if (e.item === "sprint") fx.burst(e.x, e.y, { count: 14, color: 0xff8a3d, speed: 120, life: 0.5, size: 8 });
          if (e.item === "decoy") fx.burst(e.x, e.y, { count: 16, color: 0xb46bff, speed: 120, life: 0.5, size: 8 });
          if (e.item === "smoke") fx.burst(e.x, e.y, { count: 20, color: 0xcfd6e6, speed: 160, life: 0.7, size: 16, texture: tex.smoke });
          if (e.item === "flare" && seekerView) fx.text(e.x, e.y, "FLARE", COLORS.flare, 18);
          break;
        case "flash":
          if (seekerView && !e.hit && !this.seekerCanSee(e.x, e.y)) break;
          fx.burst(e.x, e.y, { count: 30, color: 0xffffff, speed: 320, life: 0.5, size: 14, texture: tex.spark });
          fx.ring(e.x, e.y, 0xffffff, ITEMS.flash.range, 0.6, 8);
          if (e.hit && seekerView) fx.flash(0xffffff, 0.92, 1.4);
          break;
        case "decoyPop":
          fx.burst(e.x, e.y, { count: 26, color: 0xb46bff, speed: 200, life: 0.7, size: 10, texture: tex.spark });
          fx.text(e.x, e.y, "DECOY!", 0xb46bff, 22);
          break;
        case "locker": {
          const l = s?.round?.lockers[e.id];
          if (!l) break;
          if (e.what === "found") {
            fx.text(l.x, l.y, "FOUND!", COLORS.caught, 24);
            fx.shake(8, 0.3);
          } else if (e.what === "empty" && seekerView) fx.text(l.x, l.y, "empty", 0x9aa7c7, 18);
          else if (e.what === "search" && seekerView) fx.ring(l.x, l.y, COLORS.caught, 40, RULES.lockerSearchMs / 1000, 3);
          break;
        }
        case "help":
          fx.ring(e.x, e.y, COLORS.freed, 120, 1.2, 4);
          fx.text(e.x, e.y, "HELP!", COLORS.freed, 22);
          break;
        case "trapped":
          fx.burst(e.x, e.y, { count: 20, color: COLORS.caught, speed: 140, life: 0.6, size: 9 });
          fx.text(e.x, e.y, "TRAPPED!", COLORS.caught, 22);
          if (me?.id === e.id) fx.shake(10, 0.4);
          break;
      }
    }
  }
}
