import type { Wall } from "./protocol";
import { MAZE } from "./config";

export interface Maze {
  cols: number;
  rows: number;
  width: number;
  height: number;
  walls: Wall[];
}

const { cellSize: CELL, wallThickness: WT } = MAZE;

export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: WT / 2 + col * CELL + CELL / 2, y: WT / 2 + row * CELL + CELL / 2 };
}

export function cellOf(x: number, y: number, cols: number, rows: number): { col: number; row: number } {
  const col = Math.max(0, Math.min(cols - 1, Math.floor((x - WT / 2) / CELL)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor((y - WT / 2) / CELL)));
  return { col, row };
}

/**
 * Recursive-backtracker maze, partially braided into loops, with a couple of
 * open plazas. Walls are merged into long runs to keep collision/raycast cheap.
 */
export function generateMaze(cols: number, rows: number, rng: () => number = Math.random): Maze {
  // h[j][i]: horizontal wall on the top edge of row j (j = rows is the bottom border)
  // v[j][i]: vertical wall on the left edge of column i (i = cols is the right border)
  const h: boolean[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(true));
  const v: boolean[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(true));
  const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));

  const open = (c: number, r: number, dc: number, dr: number) => {
    if (dc === 1) v[r][c + 1] = false;
    else if (dc === -1) v[r][c] = false;
    else if (dr === 1) h[r + 1][c] = false;
    else if (dr === -1) h[r][c] = false;
  };
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;

  const stack: [number, number][] = [[Math.floor(rng() * cols), Math.floor(rng() * rows)]];
  visited[stack[0][1]][stack[0][0]] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const options = dirs.filter(([dc, dr]) => inside(c + dc, r + dr) && !visited[r + dr][c + dc]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dc, dr] = options[Math.floor(rng() * options.length)];
    open(c, r, dc, dr);
    visited[r + dr][c + dc] = true;
    stack.push([c + dc, r + dr]);
  }

  const wallCount = (c: number, r: number) =>
    (h[r][c] ? 1 : 0) + (h[r + 1][c] ? 1 : 0) + (v[r][c] ? 1 : 0) + (v[r][c + 1] ? 1 : 0);
  const closedDirs = (c: number, r: number) =>
    dirs.filter(([dc, dr]) => {
      if (!inside(c + dc, r + dr)) return false;
      if (dc === 1) return v[r][c + 1];
      if (dc === -1) return v[r][c];
      if (dr === 1) return h[r + 1][c];
      return h[r][c];
    });

  // Braid: open most dead ends so the seeker can be juked around loops.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (wallCount(c, r) < 3 || rng() > MAZE.braidChance) continue;
      const options = closedDirs(c, r);
      if (!options.length) continue;
      const [dc, dr] = options[Math.floor(rng() * options.length)];
      open(c, r, dc, dr);
    }
  }

  // Plazas: clear the interior of a few 2x2 blocks.
  for (let p = 0; p < MAZE.plazas; p++) {
    const c = 1 + Math.floor(rng() * Math.max(1, cols - 3));
    const r = 1 + Math.floor(rng() * Math.max(1, rows - 3));
    if (c + 1 >= cols || r + 1 >= rows) continue;
    v[r][c + 1] = false;
    v[r + 1][c + 1] = false;
    h[r + 1][c] = false;
    h[r + 1][c + 1] = false;
  }

  const walls: Wall[] = [];
  // Merge horizontal runs.
  for (let j = 0; j <= rows; j++) {
    let start = -1;
    for (let i = 0; i <= cols; i++) {
      const on = i < cols && h[j][i];
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        walls.push({ x: start * CELL, y: j * CELL, w: (i - start) * CELL + WT, h: WT });
        start = -1;
      }
    }
  }
  // Merge vertical runs.
  for (let i = 0; i <= cols; i++) {
    let start = -1;
    for (let j = 0; j <= rows; j++) {
      const on = j < rows && v[j][i];
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        walls.push({ x: i * CELL, y: start * CELL, w: WT, h: (j - start) * CELL + WT });
        start = -1;
      }
    }
  }

  return { cols, rows, width: cols * CELL + WT, height: rows * CELL + WT, walls };
}
