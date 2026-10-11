import { PLAYER } from "./config";
import type { Rect } from "./geometry";

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface MoveParams {
  maxSpeed: number;
  /** Ghosts float through walls. */
  ghost: boolean;
  /** Can't move at all (caged, hiding, rooted, seeker counting...). */
  frozen: boolean;
  width: number;
  height: number;
  rects: readonly Rect[];
  radius?: number;
}

const MAX_SUBSTEP_PX = 5;

/** Push a circle out of every rect it overlaps and cancel velocity into them. */
export function resolveCollisions(b: Body, r: number, rects: readonly Rect[]) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const w of rects) {
      if (b.x + r <= w.x || b.x - r >= w.x + w.w || b.y + r <= w.y || b.y - r >= w.y + w.h) continue;
      const cx = Math.max(w.x, Math.min(b.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(b.y, w.y + w.h));
      let nx = b.x - cx;
      let ny = b.y - cy;
      let d = Math.hypot(nx, ny);
      let push: number;
      if (d > 1e-6) {
        if (d >= r) continue;
        nx /= d;
        ny /= d;
        push = r - d;
      } else {
        // Centre inside the rect: leave along the shallowest axis.
        const left = b.x - w.x;
        const right = w.x + w.w - b.x;
        const top = b.y - w.y;
        const bottom = w.y + w.h - b.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) [nx, ny, push] = [-1, 0, left + r];
        else if (m === right) [nx, ny, push] = [1, 0, right + r];
        else if (m === top) [nx, ny, push] = [0, -1, top + r];
        else [nx, ny, push] = [0, 1, bottom + r];
      }
      b.x += nx * (push + 0.01);
      b.y += ny * (push + 0.01);
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= nx * vn;
        b.vy -= ny * vn;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

export function overlapsAny(x: number, y: number, r: number, rects: readonly Rect[], slack = 0): boolean {
  const rr = r - slack;
  for (const w of rects) {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    if ((x - cx) ** 2 + (y - cy) ** 2 < rr * rr) return true;
  }
  return false;
}

/**
 * Advance a body by `dt` seconds towards joystick input (ix, iy) – magnitude 0..1.
 * Smooth acceleration, sliding along walls, rounded corners (circle vs box).
 */
export function stepBody(b: Body, ix: number, iy: number, dt: number, p: MoveParams): void {
  if (p.frozen) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  const mag = Math.hypot(ix, iy);
  if (mag > 1) {
    ix /= mag;
    iy /= mag;
  }
  const tx = ix * p.maxSpeed;
  const ty = iy * p.maxSpeed;
  const speeding = tx * tx + ty * ty >= b.vx * b.vx + b.vy * b.vy;
  const k = 1 - Math.exp(-(speeding ? PLAYER.accel : PLAYER.decel) * dt);
  b.vx += (tx - b.vx) * k;
  b.vy += (ty - b.vy) * k;
  if (Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5 && mag < 0.05) {
    b.vx = 0;
    b.vy = 0;
    return;
  }

  const r = p.radius ?? PLAYER.radius;
  const travel = Math.hypot(b.vx, b.vy) * dt;
  const n = Math.max(1, Math.ceil(travel / MAX_SUBSTEP_PX));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    b.x += b.vx * h;
    b.y += b.vy * h;
    if (!p.ghost) resolveCollisions(b, r, p.rects);
  }
  b.x = Math.max(r, Math.min(p.width - r, b.x));
  b.y = Math.max(r, Math.min(p.height - r, b.y));
}

/** Turn `angle` towards `target` by at most rate*dt (radians). */
export function turnTowards(angle: number, target: number, rate: number, dt: number): number {
  let d = (target - angle) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const max = rate * dt;
  return angle + (Math.abs(d) <= max ? d : Math.sign(d) * max);
}
