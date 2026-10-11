import { VISION } from "./config";

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Everything that blocks light: walls/crates (rects) and smoke clouds (circles). */
export interface Occluders {
  rects: readonly Rect[];
  circles?: readonly Circle[];
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Ray vs axis-aligned box (slab method). Distance along a unit direction, or Infinity. */
export function rayRect(ox: number, oy: number, dx: number, dy: number, r: Rect): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (dx !== 0) {
    const t1 = (r.x - ox) / dx;
    const t2 = (r.x + r.w - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (ox < r.x || ox > r.x + r.w) return Infinity;
  if (dy !== 0) {
    const t1 = (r.y - oy) / dy;
    const t2 = (r.y + r.h - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (oy < r.y || oy > r.y + r.h) return Infinity;
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** Ray vs circle. Distance along a unit direction, or Infinity. Origin inside -> 0. */
export function rayCircle(ox: number, oy: number, dx: number, dy: number, c: Circle): number {
  const fx = ox - c.x;
  const fy = oy - c.y;
  const cc = fx * fx + fy * fy - c.r * c.r;
  if (cc <= 0) return 0;
  const b = fx * dx + fy * dy;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

export interface RayHit {
  dist: number;
  /** Index of the rect hit, -1 if none (or a circle stopped it). */
  rect: number;
}

export function castRay(o: Vec, angle: number, range: number, occ: Occluders): RayHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = range;
  let rect = -1;
  const rects = occ.rects;
  for (let i = 0; i < rects.length; i++) {
    const t = rayRect(o.x, o.y, dx, dy, rects[i]);
    if (t < best) {
      best = t;
      rect = i;
    }
  }
  if (occ.circles) {
    for (const c of occ.circles) {
      const t = rayCircle(o.x, o.y, dx, dy, c);
      if (t < best) {
        best = t;
        rect = -1;
      }
    }
  }
  return { dist: best, rect };
}

/** True if anything opaque lies on the segment a -> b. */
export function blocked(a: Vec, b: Vec, occ: Occluders): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const nx = dx / len;
  const ny = dy / len;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  for (const r of occ.rects) {
    if (r.x > maxX || r.x + r.w < minX || r.y > maxY || r.y + r.h < minY) continue;
    if (rayRect(a.x, a.y, nx, ny, r) < len - 0.5) return true;
  }
  if (occ.circles) {
    for (const c of occ.circles) if (rayCircle(a.x, a.y, nx, ny, c) < len - 0.5) return true;
  }
  return false;
}

export interface LightPoly {
  points: Vec[];
  /** Rect indices touched by the rays (used for the seeker's map memory). */
  hitRects: number[];
}

/** Fan of rays from `o`. `arc` >= 2π gives a full circle. */
export function lightPolygon(o: Vec, facing: number, arc: number, range: number, rays: number, occ: Occluders): LightPoly {
  const full = arc >= Math.PI * 2 - 1e-6;
  const points: Vec[] = full ? [] : [{ x: o.x, y: o.y }];
  const hitRects: number[] = [];
  const start = facing - arc / 2;
  const step = arc / (full ? rays : rays - 1);
  for (let i = 0; i < rays; i++) {
    const ang = start + step * i;
    const hit = castRay(o, ang, range, occ);
    // Push a few px into walls so their faces get lit.
    const d = hit.rect >= 0 ? Math.min(range, hit.dist + 5) : hit.dist;
    points.push({ x: o.x + Math.cos(ang) * d, y: o.y + Math.sin(ang) * d });
    if (hit.rect >= 0) hitRects.push(hit.rect);
  }
  return { points, hitRects };
}

export const seekerCone = (o: Vec, facing: number, occ: Occluders) =>
  lightPolygon(o, facing, VISION.coneAngle, VISION.coneRange, VISION.coneRays, occ);

export const circleLight = (o: Vec, radius: number, occ: Occluders, rays = VISION.circleRays) =>
  lightPolygon(o, 0, Math.PI * 2, radius, rays, occ);

/**
 * Can the seeker see this point? The single source of truth for catching, shared
 * so that what the TV draws matches what the server counts.
 */
export function seekerSees(seeker: Vec & { angle: number }, target: Vec, occ: Occluders): boolean {
  const dx = target.x - seeker.x;
  const dy = target.y - seeker.y;
  const d = Math.hypot(dx, dy);
  if (d <= VISION.auraRadius) return !blocked(seeker, target, occ);
  if (d > VISION.coneRange) return false;
  if (Math.abs(angleDiff(Math.atan2(dy, dx), seeker.angle)) > VISION.coneAngle / 2) return false;
  return !blocked(seeker, target, occ);
}

export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a rect (0 if inside). */
export function distToRect(p: Vec, r: Rect): number {
  const cx = Math.max(r.x, Math.min(p.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(p.y, r.y + r.h));
  return Math.hypot(p.x - cx, p.y - cy);
}
