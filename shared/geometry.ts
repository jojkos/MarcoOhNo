import type { Wall } from "./protocol";
import { VISION } from "./config";

export interface Vec {
  x: number;
  y: number;
}

/**
 * Ray vs axis-aligned box (slab method). Returns the distance along the
 * (normalized) direction to the first hit, or Infinity.
 */
export function rayBox(ox: number, oy: number, dx: number, dy: number, w: Wall): number {
  let tmin = -Infinity;
  let tmax = Infinity;

  if (dx !== 0) {
    const t1 = (w.x - ox) / dx;
    const t2 = (w.x + w.w - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (ox < w.x || ox > w.x + w.w) {
    return Infinity;
  }

  if (dy !== 0) {
    const t1 = (w.y - oy) / dy;
    const t2 = (w.y + w.h - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (oy < w.y || oy > w.y + w.h) {
    return Infinity;
  }

  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin >= 0 ? tmin : 0; // origin inside box -> blocked immediately
}

export interface RayHit {
  dist: number;
  wall: number; // index into walls, -1 if nothing hit within range
}

export function castRay(o: Vec, angle: number, range: number, walls: Wall[]): RayHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = range;
  let wall = -1;
  for (let i = 0; i < walls.length; i++) {
    const t = rayBox(o.x, o.y, dx, dy, walls[i]);
    if (t < best) {
      best = t;
      wall = i;
    }
  }
  return { dist: best, wall };
}

/** True if a wall blocks the straight segment a -> b. */
export function segmentBlocked(a: Vec, b: Vec, walls: Wall[]): boolean {
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
  for (const w of walls) {
    if (w.x > maxX || w.x + w.w < minX || w.y > maxY || w.y + w.h < minY) continue;
    if (rayBox(a.x, a.y, nx, ny, w) < len - 0.5) return true;
  }
  return false;
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface LightPoly {
  points: Vec[];
  /** Indices of walls touched by the rays (used for "map memory"). */
  hitWalls: number[];
}

/** Fan of rays from origin; arc === 2π gives a full circle. */
export function lightPolygon(
  o: Vec,
  facing: number,
  arc: number,
  range: number,
  rays: number,
  walls: Wall[],
): LightPoly {
  const full = arc >= Math.PI * 2 - 1e-6;
  const points: Vec[] = full ? [] : [{ x: o.x, y: o.y }];
  const hitWalls: number[] = [];
  const start = facing - arc / 2;
  const steps = full ? rays : rays - 1;
  const step = arc / steps;
  for (let i = 0; i < rays; i++) {
    const ang = start + step * i;
    const hit = castRay(o, ang, range, walls);
    // Push slightly into walls so their faces are lit.
    const d = hit.wall >= 0 ? hit.dist + 4 : hit.dist;
    points.push({ x: o.x + Math.cos(ang) * d, y: o.y + Math.sin(ang) * d });
    if (hit.wall >= 0) hitWalls.push(hit.wall);
  }
  return { points, hitWalls };
}

export function seekerCone(o: Vec, facing: number, walls: Wall[]): LightPoly {
  return lightPolygon(o, facing, VISION.seekerConeAngle, VISION.seekerConeRange, VISION.coneRays, walls);
}

export function seekerAura(o: Vec, walls: Wall[]): LightPoly {
  return lightPolygon(o, 0, Math.PI * 2, VISION.seekerAuraRadius, VISION.auraRays, walls);
}

export function runnerLight(o: Vec, walls: Wall[]): LightPoly {
  return lightPolygon(o, 0, Math.PI * 2, VISION.runnerLightRadius, VISION.auraRays + 8, walls);
}

/**
 * Authoritative "can the seeker see this point" check, shared so the server's
 * catching and the clients' rendering agree.
 */
export function seekerSees(seeker: Vec & { angle: number }, target: Vec, walls: Wall[]): boolean {
  const dx = target.x - seeker.x;
  const dy = target.y - seeker.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= VISION.seekerAuraRadius) return !segmentBlocked(seeker, target, walls);
  if (dist > VISION.seekerConeRange) return false;
  if (Math.abs(angleDiff(Math.atan2(dy, dx), seeker.angle)) > VISION.seekerConeAngle / 2) return false;
  return !segmentBlocked(seeker, target, walls);
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
