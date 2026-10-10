import { describe, expect, it } from "vitest";
import { generateMaze, cellCenter } from "@shared/maze";
import { stepMover, type MoverState, type MoveCtx } from "@shared/physics";
import { rayBox, segmentBlocked, seekerSees } from "@shared/geometry";
import { PLAYER, TICK_DT, VISION } from "@shared/config";
import type { Wall } from "@shared/protocol";
import { seeded } from "./util";

function overlapsAny(x: number, y: number, walls: Wall[]) {
  const h = PLAYER.hitHalf;
  return walls.some((w) => x + h > w.x && x - h < w.x + w.w && y + h > w.y && y - h < w.y + w.h);
}

describe("maze", () => {
  it("connects every cell and keeps cell centers free", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const maze = generateMaze(11, 7, seeded(seed));
      const seen = new Set<string>(["0,0"]);
      const queue: [number, number][] = [[0, 0]];
      while (queue.length) {
        const [c, r] = queue.shift()!;
        expect(overlapsAny(cellCenter(c, r).x, cellCenter(c, r).y, maze.walls)).toBe(false);
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= maze.cols || nr >= maze.rows || seen.has(`${nc},${nr}`)) continue;
          if (segmentBlocked(cellCenter(c, r), cellCenter(nc, nr), maze.walls)) continue;
          seen.add(`${nc},${nr}`);
          queue.push([nc, nr]);
        }
      }
      expect(seen.size).toBe(maze.cols * maze.rows);
    }
  });
});

describe("physics", () => {
  const base = (walls: Wall[]): MoveCtx => ({
    walls,
    width: 1000,
    height: 1000,
    speed: 200,
    ghost: false,
    frozen: false,
    turnRate: Infinity,
  });
  const mover = (x: number, y: number): MoverState => ({ x, y, angle: 0, boost: 0, boostMul: 1 });

  it("moves speed * dt per step", () => {
    const s = stepMover(mover(100, 100), 1, 0, base([]));
    expect(s.x).toBeCloseTo(100 + 200 * TICK_DT);
    expect(s.y).toBe(100);
  });

  it("stops flush against a wall", () => {
    const wall = { x: 200, y: 0, w: 24, h: 1000 };
    const s = mover(150, 500);
    for (let i = 0; i < 60; i++) stepMover(s, 1, 0, base([wall]));
    expect(s.x).toBeCloseTo(200 - PLAYER.hitHalf, 1);
  });

  it("never ends up inside a wall during random play", () => {
    const maze = generateMaze(9, 6, seeded(7));
    const ctx = { ...base(maze.walls), width: maze.width, height: maze.height };
    const rng = seeded(3);
    const s = mover(cellCenter(0, 0).x, cellCenter(0, 0).y);
    let mx = 1;
    let my = 0;
    for (let i = 0; i < 20000; i++) {
      if (i % 20 === 0) {
        const a = rng() * Math.PI * 2;
        mx = Math.cos(a);
        my = Math.sin(a);
      }
      if (i % 97 === 0) {
        s.boost = 6;
        s.boostMul = 3.2;
      }
      stepMover(s, mx, my, ctx);
      expect(overlapsAny(s.x, s.y, maze.walls)).toBe(false);
    }
  });

  it("is deterministic (client prediction replays match the server)", () => {
    const maze = generateMaze(9, 6, seeded(11));
    const ctx = { ...base(maze.walls), width: maze.width, height: maze.height, turnRate: PLAYER.seekerTurnRate };
    const inputs = Array.from({ length: 500 }, (_, i) => [Math.cos(i / 9), Math.sin(i / 13)] as const);
    const a = mover(cellCenter(2, 2).x, cellCenter(2, 2).y);
    const b = { ...a };
    for (const [mx, my] of inputs) stepMover(a, mx, my, ctx);
    for (const [mx, my] of inputs) stepMover(b, mx, my, ctx);
    expect(b).toEqual(a);
  });

  it("frozen players don't move; ghosts pass through walls", () => {
    const wall = { x: 200, y: 0, w: 24, h: 1000 };
    const frozen = stepMover(mover(100, 100), 1, 0, { ...base([wall]), frozen: true });
    expect(frozen.x).toBe(100);
    const g = mover(190, 500);
    for (let i = 0; i < 30; i++) stepMover(g, 1, 0, { ...base([wall]), ghost: true });
    expect(g.x).toBeGreaterThan(224);
  });
});

describe("geometry", () => {
  it("rayBox hits the near face", () => {
    expect(rayBox(0, 5, 1, 0, { x: 10, y: 0, w: 5, h: 10 })).toBeCloseTo(10);
    expect(rayBox(0, 50, 1, 0, { x: 10, y: 0, w: 5, h: 10 })).toBe(Infinity);
  });

  it("seeker sees inside the cone only, and not through walls", () => {
    const seeker = { x: 100, y: 100, angle: 0 };
    expect(seekerSees(seeker, { x: 250, y: 100 }, [])).toBe(true);
    expect(seekerSees(seeker, { x: -50, y: 100 }, [])).toBe(false); // behind
    expect(seekerSees(seeker, { x: 100 + VISION.seekerConeRange + 10, y: 100 }, [])).toBe(false);
    expect(seekerSees(seeker, { x: 130, y: 100 }, [])).toBe(true); // aura
    expect(seekerSees(seeker, { x: 250, y: 100 }, [{ x: 170, y: 0, w: 20, h: 300 }])).toBe(false);
  });
});
