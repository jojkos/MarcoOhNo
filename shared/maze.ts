import { MAZE, RULES, mazeSizeFor } from "./config";
import type { Rect, Vec } from "./geometry";

const { cell: CELL, wall: WT } = MAZE;

export interface LockerSpot {
  x: number;
  y: number;
  /** Direction the locker door faces (radians). */
  dir: number;
}

export interface GameMap {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Walls first, then crates (indices >= wallCount). All block movement and light. */
  rects: Rect[];
  wallCount: number;
  lockers: LockerSpot[];
  spawn: Vec;
  /** Cells that are open (no crate/locker) – where orbs and item boxes may spawn. */
  openCells: { col: number; row: number }[];
}

export function cellCenter(col: number, row: number): Vec {
  return { x: WT / 2 + col * CELL + CELL / 2, y: WT / 2 + row * CELL + CELL / 2 };
}

export function cellOf(x: number, y: number, cols: number, rows: number): { col: number; row: number } {
  return {
    col: Math.max(0, Math.min(cols - 1, Math.floor((x - WT / 2) / CELL))),
    row: Math.max(0, Math.min(rows - 1, Math.floor((y - WT / 2) / CELL))),
  };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Recursive backtracker + braiding + plazas, then crates and lockers. */
export function generateMap(players: number, rng: () => number = Math.random): GameMap {
  const { cols, rows } = mazeSizeFor(players);
  // h[j][i]: wall on the top edge of cell (i, j); j = rows is the bottom border.
  // v[j][i]: wall on the left edge of cell (i, j); i = cols is the right border.
  const h: boolean[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(true));
  const v: boolean[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(true));
  const seen: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const isClosed = (c: number, r: number, dc: number, dr: number) =>
    dc === 1 ? v[r][c + 1] : dc === -1 ? v[r][c] : dr === 1 ? h[r + 1][c] : h[r][c];
  const open = (c: number, r: number, dc: number, dr: number) => {
    if (dc === 1) v[r][c + 1] = false;
    else if (dc === -1) v[r][c] = false;
    else if (dr === 1) h[r + 1][c] = false;
    else h[r][c] = false;
  };

  const stack: [number, number][] = [[Math.floor(rng() * cols), Math.floor(rng() * rows)]];
  seen[stack[0][1]][stack[0][0]] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const options = DIRS.filter(([dc, dr]) => inside(c + dc, r + dr) && !seen[r + dr][c + dc]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dc, dr] = options[Math.floor(rng() * options.length)];
    open(c, r, dc, dr);
    seen[r + dr][c + dc] = true;
    stack.push([c + dc, r + dr]);
  }

  const closedSides = (c: number, r: number) => DIRS.filter(([dc, dr]) => isClosed(c, r, dc, dr));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (closedSides(c, r).length < 3 || rng() > MAZE.braidChance) continue;
      const options = DIRS.filter(([dc, dr]) => inside(c + dc, r + dr) && isClosed(c, r, dc, dr));
      if (options.length) {
        const [dc, dr] = options[Math.floor(rng() * options.length)];
        open(c, r, dc, dr);
      }
    }
  }

  for (let p = 0; p < MAZE.plazas; p++) {
    const c = 1 + Math.floor(rng() * Math.max(1, cols - 3));
    const r = 1 + Math.floor(rng() * Math.max(1, rows - 3));
    if (c + 1 >= cols || r + 1 >= rows) continue;
    v[r][c + 1] = false;
    v[r + 1][c + 1] = false;
    h[r + 1][c] = false;
    h[r + 1][c + 1] = false;
  }

  // Merge wall segments into long rects (fewer rects = cheaper collision and raycasts).
  const rects: Rect[] = [];
  for (let j = 0; j <= rows; j++) {
    let start = -1;
    for (let i = 0; i <= cols; i++) {
      const on = i < cols && h[j][i];
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        rects.push({ x: start * CELL, y: j * CELL, w: (i - start) * CELL + WT, h: WT });
        start = -1;
      }
    }
  }
  for (let i = 0; i <= cols; i++) {
    let start = -1;
    for (let j = 0; j <= rows; j++) {
      const on = j < rows && v[j][i];
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        rects.push({ x: i * CELL, y: start * CELL, w: WT, h: (j - start) * CELL + WT });
        start = -1;
      }
    }
  }
  const wallCount = rects.length;

  const spawnCell = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  const spawn = cellCenter(spawnCell.col, spawnCell.row);
  const used = new Set<string>([`${spawnCell.col},${spawnCell.row}`]);
  const key = (c: number, r: number) => `${c},${r}`;
  const nearSpawn = (c: number, r: number) => Math.abs(c - spawnCell.col) + Math.abs(r - spawnCell.row) <= 1;

  // Lockers: prefer dead ends (great hiding spots), pressed against the back wall.
  const lockers: LockerSpot[] = [];
  const lockerCount = RULES.lockersFor(players);
  const candidates: { c: number; r: number; back: readonly [number, number]; score: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (nearSpawn(c, r)) continue;
      const closed = closedSides(c, r);
      if (!closed.length) continue;
      for (const back of closed) candidates.push({ c, r, back, score: closed.length + rng() });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const cand of candidates) {
    if (lockers.length >= lockerCount) break;
    if (used.has(key(cand.c, cand.r))) continue;
    if (lockers.some((l) => Math.hypot(l.x - cellCenter(cand.c, cand.r).x, l.y - cellCenter(cand.c, cand.r).y) < CELL * 2.2)) continue;
    const center = cellCenter(cand.c, cand.r);
    const [dc, dr] = cand.back;
    const offset = CELL / 2 - WT / 2 - 14;
    lockers.push({ x: center.x + dc * offset, y: center.y + dr * offset, dir: Math.atan2(-dr, -dc) });
    used.add(key(cand.c, cand.r));
  }

  // Crates: small boxes in cell corners. They block light and movement but never seal a path.
  const crateCount = 4 + players;
  const CRATE = 30;
  let tries = 0;
  while (rects.length - wallCount < crateCount && tries++ < 200) {
    const c = Math.floor(rng() * cols);
    const r = Math.floor(rng() * rows);
    if (used.has(key(c, r)) || nearSpawn(c, r)) continue;
    const left = c * CELL + WT;
    const top = r * CELL + WT;
    const inner = CELL - WT;
    const corner = Math.floor(rng() * 4);
    const x = corner % 2 === 0 ? left + 2 : left + inner - CRATE - 2;
    const y = corner < 2 ? top + 2 : top + inner - CRATE - 2;
    rects.push({ x, y, w: CRATE, h: CRATE });
    used.add(key(c, r));
  }

  const openCells: { col: number; row: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!used.has(key(c, r))) openCells.push({ col: c, row: r });

  return { cols, rows, width: cols * CELL + WT, height: rows * CELL + WT, rects, wallCount, lockers, spawn, openCells };
}

/** Adjacency of cells that can see/walk straight to each other (for bots). */
export function cellGraph(map: Pick<GameMap, "cols" | "rows">, isOpen: (a: Vec, b: Vec) => boolean): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const out: string[] = [];
      for (const [dc, dr] of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
        if (isOpen(cellCenter(c, r), cellCenter(nc, nr))) out.push(`${nc},${nr}`);
      }
      g.set(`${c},${r}`, out);
    }
  }
  return g;
}
