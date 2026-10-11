import { describe, expect, it } from "vitest";
import { generateMap, cellCenter, cellGraph } from "@shared/maze";
import { stepBody, overlapsAny, type MoveParams } from "@shared/physics";
import { blocked, rayCircle, rayRect, seekerSees } from "@shared/geometry";
import { PLAYER, VISION } from "@shared/config";
import { seeded } from "./util";

describe("map generation", () => {
  it("keeps every cell reachable, centres free, and lockers/crates out of the way", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const players of [2, 5, 8]) {
        const map = generateMap(players, seeded(seed * 10 + players));
        const g = cellGraph(map, (a, b) => !blocked(a, b, { rects: map.rects }));
        const seen = new Set(["0,0"]);
        const q = ["0,0"];
        while (q.length) for (const n of g.get(q.shift()!)!) if (!seen.has(n)) seen.add(n), q.push(n);
        expect(seen.size).toBe(map.cols * map.rows);
        for (let r = 0; r < map.rows; r++)
          for (let c = 0; c < map.cols; c++) {
            const p = cellCenter(c, r);
            expect(overlapsAny(p.x, p.y, PLAYER.radius, map.rects)).toBe(false);
          }
        expect(map.lockers.length).toBeGreaterThan(0);
        for (const l of map.lockers) expect(overlapsAny(l.x, l.y, 8, map.rects)).toBe(false);
      }
    }
  });
});

describe("physics", () => {
  const params = (over: Partial<MoveParams> = {}): MoveParams => ({
    maxSpeed: 200,
    ghost: false,
    frozen: false,
    width: 2000,
    height: 2000,
    rects: [],
    ...over,
  });

  it("accelerates smoothly to full speed", () => {
    const b = { x: 100, y: 100, vx: 0, vy: 0 };
    stepBody(b, 1, 0, 1 / 60, params());
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(200);
    for (let i = 0; i < 60; i++) stepBody(b, 1, 0, 1 / 60, params());
    expect(b.vx).toBeGreaterThan(195);
  });

  it("slides along walls and rounds corners instead of snagging", () => {
    const wall = { x: 200, y: 0, w: 24, h: 300 };
    const b = { x: 150, y: 100, vx: 0, vy: 0 };
    // Push diagonally into the wall: should slide down along it.
    for (let i = 0; i < 120; i++) {
      stepBody(b, 1, 1, 1 / 60, params({ rects: [wall] }));
      expect(overlapsAny(b.x, b.y, PLAYER.radius, [wall], 0.05)).toBe(false);
    }
    expect(b.y).toBeGreaterThan(300); // slid down the face and around the bottom corner
    expect(b.x).toBeGreaterThan(200); // ...and kept going
  });

  it("never ends up inside a wall, even at dash speed on slow frames", () => {
    const map = generateMap(6, seeded(3));
    const rng = seeded(4);
    const start = cellCenter(0, 0);
    const b = { x: start.x, y: start.y, vx: 0, vy: 0 };
    let ix = 1;
    let iy = 0;
    for (let i = 0; i < 20000; i++) {
      if (i % 25 === 0) {
        const a = rng() * Math.PI * 2;
        ix = Math.cos(a);
        iy = Math.sin(a);
      }
      const dt = i % 50 === 0 ? 0.1 : 1 / 60; // occasional frame hitch
      stepBody(b, ix, iy, dt, params({ rects: map.rects, width: map.width, height: map.height, maxSpeed: i % 97 < 5 ? 630 : 210 }));
      expect(overlapsAny(b.x, b.y, PLAYER.radius, map.rects, 0.05)).toBe(false);
    }
  });

  it("frozen bodies stay put; ghosts pass through walls", () => {
    const wall = { x: 200, y: 0, w: 24, h: 1000 };
    const f = { x: 100, y: 100, vx: 50, vy: 0 };
    stepBody(f, 1, 0, 0.1, params({ frozen: true, rects: [wall] }));
    expect(f.x).toBe(100);
    const g = { x: 180, y: 500, vx: 0, vy: 0 };
    for (let i = 0; i < 60; i++) stepBody(g, 1, 0, 1 / 30, params({ ghost: true, rects: [wall] }));
    expect(g.x).toBeGreaterThan(224);
  });
});

describe("geometry", () => {
  it("rays hit rects and circles", () => {
    expect(rayRect(0, 5, 1, 0, { x: 10, y: 0, w: 5, h: 10 })).toBeCloseTo(10);
    expect(rayRect(0, 50, 1, 0, { x: 10, y: 0, w: 5, h: 10 })).toBe(Infinity);
    expect(rayCircle(0, 0, 1, 0, { x: 50, y: 0, r: 10 })).toBeCloseTo(40);
  });

  it("seeker sees in the cone only, not through walls or smoke", () => {
    const s = { x: 100, y: 100, angle: 0 };
    expect(seekerSees(s, { x: 250, y: 100 }, { rects: [] })).toBe(true);
    expect(seekerSees(s, { x: -50, y: 100 }, { rects: [] })).toBe(false);
    expect(seekerSees(s, { x: 100 + VISION.coneRange + 5, y: 100 }, { rects: [] })).toBe(false);
    expect(seekerSees(s, { x: 130, y: 100 }, { rects: [] })).toBe(true); // aura
    expect(seekerSees(s, { x: 250, y: 100 }, { rects: [{ x: 170, y: 0, w: 20, h: 300 }] })).toBe(false);
    expect(seekerSees(s, { x: 250, y: 100 }, { rects: [], circles: [{ x: 180, y: 100, r: 40 }] })).toBe(false);
  });
});
