// Server-side bots: fill a room for solo testing or small groups. They run through
// the same physics, rules and abilities as phones.
import { blocked, dist, seekerSees, type Vec } from "@shared/geometry";
import { cellCenter, cellGraph, cellOf } from "@shared/maze";
import { RULES } from "@shared/config";
import type { Player } from "@shared/schema";
import type { Game } from "./Game";

const key = (c: number, r: number) => `${c},${r}`;
const toPoint = (k: string) => {
  const [c, r] = k.split(",").map(Number);
  return cellCenter(c, r);
};

function bfs(g: Map<string, string[]>, from: string, to: string): string[] {
  if (from === to) return [from];
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const n of g.get(cur) ?? []) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        q.push(n);
      }
    }
  }
  if (!prev.has(to)) return [];
  const path: string[] = [];
  for (let c: string | null = to; c; c = prev.get(c) ?? null) path.unshift(c);
  return path;
}

export class BotBrain {
  private graph: Map<string, string[]> | null = null;
  private graphRound = -1;
  private wanderGoal: string | null = null;
  private thinkMs = 0;
  private hideUntil = 0;
  private stuckMs = 0;
  private last: Vec = { x: 0, y: 0 };

  constructor(
    private id: string,
    private game: Game,
  ) {}

  reset() {
    this.graph = null;
    this.wanderGoal = null;
    this.hideUntil = 0;
  }

  private get me(): Player | undefined {
    return this.game.player(this.id);
  }

  update(dt: number) {
    const me = this.me;
    const game = this.game;
    const map = game.map;
    const round = game.state.round;
    if (!me || !map || !round || !me.inRound) return;
    if (this.graphRound !== round.id || !this.graph) {
      this.graph = cellGraph(map, (a, b) => !blocked(a, b, { rects: map.rects }));
      this.graphRound = round.id;
    }
    const phase = game.state.phase;
    const now = game.state.time;
    this.thinkMs -= dt * 1000;
    const think = this.thinkMs <= 0;
    if (think) this.thinkMs = 200 + Math.random() * 200;

    let goal: Vec | null = null;
    const seeker = game.seeker;

    if (me.role === "seeker") {
      if (phase !== "hunt") return game.moveBot(me, 0, 0, dt);
      const lit = game.runners.find((r) => r.status === "free" && r.locker < 0 && r.lit);
      const heard = game.heard[game.heard.length - 1];
      if (lit) goal = lit;
      else if (heard && dist(heard, me) > 40) goal = heard;
      else goal = this.wander(me);
      if (think) {
        if (me.cdA === 0 && Math.random() < 0.06) game.action(this.id, "a");
        if (lit && me.cdB === 0) game.action(this.id, "b");
        if (me.item === "flare" && !lit && Math.random() < 0.1) game.action(this.id, "item");
        if (me.item === "trap" && Math.random() < 0.05) game.action(this.id, "item");
        // Peek into lockers on the way.
        const lk = round.lockers.find((l) => dist(l, me) <= RULES.lockerRange && !l.checked);
        if (lk && Math.random() < 0.35) game.action(this.id, "act");
      }
    } else if (me.status === "caged") {
      if (think && me.cdA === 0 && Math.random() < 0.15) game.action(this.id, "a");
      return game.moveBot(me, 0, 0, dt);
    } else if (me.status === "ghost") {
      goal = this.wander(me);
      if (think && me.cdA === 0 && Math.random() < 0.08) game.action(this.id, "a");
    } else {
      // Runner
      if (me.locker >= 0) {
        if (now > this.hideUntil || (seeker && dist(seeker, me) > 300 && Math.random() < 0.02)) game.action(this.id, "act");
        return game.moveBot(me, 0, 0, dt);
      }
      const occ = game.occluders();
      const danger = !!seeker && phase === "hunt" && dist(seeker, me) < 280 && !blocked(seeker, me, occ);
      if (danger && seeker) {
        const lk = round.lockers.find((l) => dist(l, me) <= RULES.lockerRange);
        if (think && lk && !seekerSees(seeker, me, occ) && Math.random() < 0.5) {
          this.hideUntil = now + 3000 + Math.random() * 5000;
          game.action(this.id, "act");
          return game.moveBot(me, 0, 0, dt);
        }
        const here = cellOf(me.x, me.y, map.cols, map.rows);
        const options = (this.graph.get(key(here.col, here.row)) ?? []).map(toPoint);
        goal = options.sort((a, b) => dist(b, seeker) - dist(a, seeker))[0] ?? null;
        if (think) {
          if (me.exposure > 0.3 && me.cdA === 0) game.action(this.id, "a");
          if (me.item && me.exposure > 0.2) game.action(this.id, "item");
        }
      } else if (phase === "scatter" && seeker) {
        goal = [...game.state.orbs].sort((a, b) => dist(b, seeker) - dist(a, seeker))[0] ?? this.wander(me);
      } else {
        const caged = game.runners.find((r) => r.status === "caged");
        const orb = [...game.state.orbs].sort((a, b) => dist(a, me) - dist(b, me))[0];
        const box = !me.item ? [...game.state.items].sort((a, b) => dist(a, me) - dist(b, me))[0] : undefined;
        goal = caged && (!orb || dist(caged, me) < dist(orb, me)) ? caged : orb ?? box ?? this.wander(me);
        if (box && dist(box, me) < 200) goal = box;
      }
    }

    if (!goal) return game.moveBot(me, 0, 0, dt);
    const step = me.status === "ghost" ? goal : this.nextWaypoint(me, goal);
    let ix = step.x - me.x;
    let iy = step.y - me.y;
    const len = Math.hypot(ix, iy);
    if (len < 6) {
      ix = 0;
      iy = 0;
    } else {
      ix /= len;
      iy /= len;
    }
    // Unstick: if we haven't moved for a while, jiggle.
    if (dist(me, this.last) < 1 && len > 6) this.stuckMs += dt * 1000;
    else this.stuckMs = 0;
    this.last = { x: me.x, y: me.y };
    if (this.stuckMs > 600) {
      const a = Math.random() * Math.PI * 2;
      ix = Math.cos(a);
      iy = Math.sin(a);
      this.wanderGoal = null;
      this.stuckMs = 0;
    }
    game.moveBot(me, ix, iy, dt);
  }

  private wander(me: Vec): Vec {
    const map = this.game.map!;
    const here = cellOf(me.x, me.y, map.cols, map.rows);
    if (!this.wanderGoal || this.wanderGoal === key(here.col, here.row)) {
      this.wanderGoal = key(Math.floor(Math.random() * map.cols), Math.floor(Math.random() * map.rows));
    }
    return toPoint(this.wanderGoal);
  }

  private nextWaypoint(me: Vec, goal: Vec): Vec {
    const map = this.game.map!;
    const occ = { rects: map.rects };
    if (!blocked(me, goal, occ) && dist(me, goal) < 200) return goal;
    const a = cellOf(me.x, me.y, map.cols, map.rows);
    const b = cellOf(goal.x, goal.y, map.cols, map.rows);
    const path = bfs(this.graph!, key(a.col, a.row), key(b.col, b.row));
    if (path.length < 2) return path.length ? goal : toPoint(key(a.col, a.row));
    const cur = toPoint(path[0]);
    const next = toPoint(path[1]);
    // Cut corners when the next cell is in plain sight, otherwise centre up first.
    return blocked(me, next, occ) ? cur : next;
  }
}
