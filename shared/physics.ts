import type { Wall } from "./protocol";
import { PLAYER, TICK_DT } from "./config";
import { angleDiff } from "./geometry";

export interface MoverState {
  x: number;
  y: number;
  angle: number;
  /** Remaining boosted steps (dash / sprint). */
  boost: number;
  boostMul: number;
}

export interface MoveCtx {
  walls: Wall[];
  width: number;
  height: number;
  speed: number;
  /** Ghosts float through walls. */
  ghost: boolean;
  /** Can't move at all (caged, or seeker during scatter). */
  frozen: boolean;
  /** rad/s, Infinity = face movement direction instantly. */
  turnRate: number;
}

const EPS = 0.01;
const NUDGE_MAX = 11; // how far around a corner we auto-slide the player

function overlaps(x: number, y: number, h: number, w: Wall): boolean {
  return x + h > w.x && x - h < w.x + w.w && y + h > w.y && y - h < w.y + w.h;
}

function firstHit(x: number, y: number, h: number, walls: Wall[]): Wall | null {
  for (const w of walls) if (overlaps(x, y, h, w)) return w;
  return null;
}

/** Move along one axis, stopping flush against walls. Returns the blocking wall if any. */
function moveAxis(s: MoverState, axis: "x" | "y", delta: number, walls: Wall[]): Wall | null {
  if (delta === 0) return null;
  const h = PLAYER.hitHalf;
  let blocked: Wall | null = null;
  if (axis === "x") {
    let nx = s.x + delta;
    for (const w of walls) {
      if (!overlaps(nx, s.y, h, w)) continue;
      blocked = w;
      nx = delta > 0 ? Math.min(nx, w.x - h - EPS) : Math.max(nx, w.x + w.w + h + EPS);
    }
    s.x = nx;
  } else {
    let ny = s.y + delta;
    for (const w of walls) {
      if (!overlaps(s.x, ny, h, w)) continue;
      blocked = w;
      ny = delta > 0 ? Math.min(ny, w.y - h - EPS) : Math.max(ny, w.y + w.h + h + EPS);
    }
    s.y = ny;
  }
  return blocked;
}

/**
 * When the player pushes into a wall corner by only a few pixels, slide them
 * around it so they don't snag on corridor entrances.
 */
function nudgeAroundCorner(s: MoverState, axis: "x" | "y", wall: Wall, budget: number, walls: Wall[]) {
  const h = PLAYER.hitHalf;
  const other = axis === "x" ? "y" : "x";
  const pos = s[other];
  const lo = other === "y" ? wall.y : wall.x;
  const hi = other === "y" ? wall.y + wall.h : wall.x + wall.w;
  const overlapLow = pos + h - lo; // amount we overlap past the wall's low edge
  const overlapHigh = hi - (pos - h);
  let shift = 0;
  if (overlapLow > 0 && overlapLow <= NUDGE_MAX) shift = -Math.min(overlapLow + EPS, budget);
  else if (overlapHigh > 0 && overlapHigh <= NUDGE_MAX) shift = Math.min(overlapHigh + EPS, budget);
  if (shift === 0) return;
  const test = { ...s, [other]: pos + shift };
  if (!firstHit(test.x, test.y, h, walls)) s[other] = pos + shift;
}

/** Advance one fixed simulation step. Mutates and returns `s`. */
export function stepMover(s: MoverState, mx: number, my: number, ctx: MoveCtx): MoverState {
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }
  const moving = mag > 0.12;

  const mul = s.boost > 0 ? s.boostMul : 1;
  if (s.boost > 0) s.boost--;

  if (ctx.frozen) return s;

  if (moving) {
    const target = Math.atan2(my, mx);
    if (!Number.isFinite(ctx.turnRate)) {
      s.angle = target;
    } else {
      const d = angleDiff(target, s.angle);
      const maxTurn = ctx.turnRate * TICK_DT;
      s.angle += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
      s.angle = angleDiff(s.angle, 0);
    }
  }
  if (!moving) return s;

  const dist = ctx.speed * mul * TICK_DT;
  const dx = mx * dist;
  const dy = my * dist;
  const h = PLAYER.hitHalf;

  if (ctx.ghost) {
    s.x += dx;
    s.y += dy;
  } else {
    const bx = moveAxis(s, "x", dx, ctx.walls);
    if (bx && Math.abs(my) < 0.5) nudgeAroundCorner(s, "x", bx, Math.abs(dx), ctx.walls);
    const by = moveAxis(s, "y", dy, ctx.walls);
    if (by && Math.abs(mx) < 0.5) nudgeAroundCorner(s, "y", by, Math.abs(dy), ctx.walls);
  }

  s.x = Math.max(h, Math.min(ctx.width - h, s.x));
  s.y = Math.max(h, Math.min(ctx.height - h, s.y));
  return s;
}
