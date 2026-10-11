import { BlurFilter, Container, Graphics, TilingSprite } from "pixi.js";
import type { Rect } from "@shared/geometry";
import { textures } from "./textures";

const WALL_TOP = 0x26386a;
const WALL_FACE = 0x121a34;
const NEON = 0x4d9dff;
const CRATE = 0x5a3d22;
const CRATE_EDGE = 0xffa94d;
const FACE_DEPTH = 9;

export interface MazeInput {
  width: number;
  height: number;
  rects: readonly Rect[];
  wallCount: number;
  lockers: readonly { x: number; y: number; dir: number }[];
}

/** Static level art, baked to a texture once per round. */
export class MazeView {
  readonly floor: Container;
  readonly walls: Container;
  /** Outlines of walls you remember, drawn above the darkness. */
  readonly memory = new Graphics();
  private remembered = new Set<number>();
  private memoryDirty = true;
  private showAll = false;

  constructor(private m: MazeInput) {
    const tex = textures();
    this.floor = new Container();
    const tiles = new TilingSprite({ texture: tex.floor, width: m.width, height: m.height });
    this.floor.addChild(tiles);
    // Darken the outside rim.
    const rim = new Graphics().rect(0, 0, m.width, m.height).stroke({ width: 30, color: 0x000000, alpha: 0.5 });
    this.floor.addChild(rim);
    this.floor.cacheAsTexture(true);

    this.walls = new Container();
    const glow = new Graphics();
    const faces = new Graphics();
    const tops = new Graphics();
    const edges = new Graphics();
    m.rects.forEach((r, i) => {
      const crate = i >= m.wallCount;
      faces.rect(r.x, r.y + r.h, r.w, FACE_DEPTH).fill(crate ? 0x2b1c10 : WALL_FACE);
      tops.rect(r.x, r.y, r.w, r.h).fill(crate ? CRATE : WALL_TOP);
      if (crate) {
        tops.moveTo(r.x + 4, r.y + 4).lineTo(r.x + r.w - 4, r.y + r.h - 4).moveTo(r.x + r.w - 4, r.y + 4).lineTo(r.x + 4, r.y + r.h - 4);
        tops.stroke({ width: 3, color: 0x3a2716 });
        edges.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2).stroke({ width: 2, color: CRATE_EDGE, alpha: 0.8 });
        glow.rect(r.x, r.y, r.w, r.h).stroke({ width: 8, color: CRATE_EDGE, alpha: 0.35 });
      } else {
        tops.rect(r.x + 3, r.y + 3, r.w - 6, Math.min(4, r.h - 6)).fill({ color: 0xffffff, alpha: 0.05 });
        edges.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2).stroke({ width: 2, color: NEON, alpha: 0.95 });
        glow.rect(r.x, r.y, r.w, r.h).stroke({ width: 10, color: NEON, alpha: 0.4 });
      }
    });
    glow.filters = [new BlurFilter({ strength: 8, quality: 2 })];

    const lockers = new Container();
    for (const l of m.lockers) {
      const g = new Graphics();
      // Local +x faces the opening.
      g.roundRect(-8, -19, 16, 38, 3).fill(0x2c3a5c).stroke({ width: 2, color: 0x7aa2ff, alpha: 0.9 });
      g.rect(-8, -1, 16, 2).fill(0x1a2440);
      for (const y of [-14, -10, 5, 9]) g.rect(-4, y, 8, 1.5).fill({ color: 0x0b1020, alpha: 0.8 });
      g.roundRect(5, -7, 3, 5, 1).fill(0x38d6ff);
      g.roundRect(5, 3, 3, 5, 1).fill(0x38d6ff);
      g.position.set(l.x, l.y);
      g.rotation = l.dir;
      lockers.addChild(g);
    }
    this.walls.addChild(glow, faces, tops, edges, lockers);
    this.walls.cacheAsTexture(true);
  }

  /** Seeker views remember walls their light touched; runners know the whole maze. */
  remember(indices: readonly number[]) {
    for (const i of indices) {
      if (!this.remembered.has(i)) {
        this.remembered.add(i);
        this.memoryDirty = true;
      }
    }
  }

  setShowAll(all: boolean) {
    if (all !== this.showAll) {
      this.showAll = all;
      this.memoryDirty = true;
    }
  }

  updateMemory() {
    if (!this.memoryDirty) return;
    this.memoryDirty = false;
    const g = this.memory.clear();
    this.m.rects.forEach((r, i) => {
      if (!this.showAll && !this.remembered.has(i)) return;
      g.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2).stroke({ width: 1.5, color: i >= this.m.wallCount ? 0x8a5a2a : 0x2f63b8, alpha: 0.55 });
    });
  }

  destroy() {
    this.floor.destroy({ children: true });
    this.walls.destroy({ children: true });
    this.memory.destroy();
  }
}
