
import { MAP_CONFIG } from "@shared/schema";

export interface Wall {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface Cell {
    x: number;
    y: number;
    visited: boolean;
    walls: {
        top: boolean;
        right: boolean;
        bottom: boolean;
        left: boolean;
    };
}

export function generateMaze(): Wall[] {
    const { width, height } = MAP_CONFIG;
    // Use a grid size that allows for wide corridors.
    // Map is 1200x800.
    // 100px cell size = 12x8 grid.
    // Wall thickness = 20px?
    // Playable space inside cell = 80px.

    const CELL_SIZE = 120;
    const WALL_THICKNESS = 24;

    const cols = Math.floor(width / CELL_SIZE);
    const rows = Math.floor(height / CELL_SIZE);

    const grid: Cell[] = [];

    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            grid.push({
                x: i,
                y: j,
                visited: false,
                walls: { top: true, right: true, bottom: true, left: true }
            });
        }
    }

    const stack: Cell[] = [];
    const startCell = grid[0];
    startCell.visited = true;
    stack.push(startCell);

    function getIndex(i: number, j: number) {
        if (i < 0 || j < 0 || i > cols - 1 || j > rows - 1) return -1;
        return i + j * cols;
    }

    function getUnvisitedNeighbors(cell: Cell) {
        const neighbors: Cell[] = [];

        const top = grid[getIndex(cell.x, cell.y - 1)];
        const right = grid[getIndex(cell.x + 1, cell.y)];
        const bottom = grid[getIndex(cell.x, cell.y + 1)];
        const left = grid[getIndex(cell.x - 1, cell.y)];

        if (top && !top.visited) neighbors.push(top);
        if (right && !right.visited) neighbors.push(right);
        if (bottom && !bottom.visited) neighbors.push(bottom);
        if (left && !left.visited) neighbors.push(left);

        return neighbors;
    }

    function removeWalls(a: Cell, b: Cell) {
        const x = a.x - b.x;
        if (x === 1) {
            a.walls.left = false;
            b.walls.right = false;
        } else if (x === -1) {
            a.walls.right = false;
            b.walls.left = false;
        }

        const y = a.y - b.y;
        if (y === 1) {
            a.walls.top = false;
            b.walls.bottom = false;
        } else if (y === -1) {
            a.walls.bottom = false;
            b.walls.top = false;
        }
    }

    // Recursive Backtracker
    while (stack.length > 0) {
        const current = stack[stack.length - 1]; // Peek
        const neighbors = getUnvisitedNeighbors(current);

        if (neighbors.length > 0) {
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            removeWalls(current, next);
            next.visited = true;
            stack.push(next);
        } else {
            stack.pop();
        }
    }

    // Braiding: Remove some dead ends
    // A dead end is a cell with 3 walls.
    // We can randomly remove a wall from dead ends to create loops.
    grid.forEach(cell => {
        let wallCount = 0;
        if (cell.walls.top) wallCount++;
        if (cell.walls.right) wallCount++;
        if (cell.walls.bottom) wallCount++;
        if (cell.walls.left) wallCount++;

        if (wallCount >= 3) {
            // It's a dead end (or isolated cell, but valid maze has no isolated).
            // Remove a random wall that connects to a valid neighbor (within bounds).
            const potentialWallsToRemove: string[] = [];
            if (cell.walls.top && cell.y > 0) potentialWallsToRemove.push('top');
            if (cell.walls.right && cell.x < cols - 1) potentialWallsToRemove.push('right');
            if (cell.walls.bottom && cell.y < rows - 1) potentialWallsToRemove.push('bottom');
            if (cell.walls.left && cell.x > 0) potentialWallsToRemove.push('left');

            if (potentialWallsToRemove.length > 0) {
                // 50% chance to remove a wall to creating a loop, or maybe higher since user wants zig zag easily
                // User said: "not too long corridors, so that players can zig zag seasily"
                // Removing dead ends helps movement.
                const toRemove = potentialWallsToRemove[Math.floor(Math.random() * potentialWallsToRemove.length)];
                // We also need to remove the corresponding wall of the neighbor for consistency, 
                // although we process walls -> rectangles based on cells, so we must be careful.
                // Actually, let's just modify this cell's wall property, and when we generate rects, we handle it?
                // Wait, removeWalls modifies BOTH cells. We should probably do the same here.

                if (toRemove === 'top') {
                    cell.walls.top = false;
                    const neighbor = grid[getIndex(cell.x, cell.y - 1)];
                    if (neighbor) neighbor.walls.bottom = false;
                } else if (toRemove === 'right') {
                    cell.walls.right = false;
                    const neighbor = grid[getIndex(cell.x + 1, cell.y)];
                    if (neighbor) neighbor.walls.left = false;
                } else if (toRemove === 'bottom') {
                    cell.walls.bottom = false;
                    const neighbor = grid[getIndex(cell.x, cell.y + 1)];
                    if (neighbor) neighbor.walls.top = false;
                } else if (toRemove === 'left') {
                    cell.walls.left = false;
                    const neighbor = grid[getIndex(cell.x - 1, cell.y)];
                    if (neighbor) neighbor.walls.right = false;
                }
            }
        }
    });

    // Convert to Rectangles
    const walls: Wall[] = [];

    // We will draw the walls. To avoid Double Neighbors, we can just draw Top and Left walls for each cell (and Bottom/Right for the last row/col).
    // Or just draw all walls and let them overlap? Overlap is fine for collision logic usually, but simpler to minimize.
    // Actually, standard way: Draw "posts" at corners, and fill in between?
    // Let's just create rectangles for every active wall.

    // Center the maze
    const totalMazeWidth = cols * CELL_SIZE;
    const totalMazeHeight = rows * CELL_SIZE;
    const offsetX = (width - totalMazeWidth) / 2;
    const offsetY = (height - totalMazeHeight) / 2;

    grid.forEach(cell => {
        const cx = cell.x * CELL_SIZE + offsetX;
        const cy = cell.y * CELL_SIZE + offsetY;

        // Top Wall
        if (cell.walls.top) {
            walls.push({
                x: cx + CELL_SIZE / 2,
                y: cy,
                w: CELL_SIZE + WALL_THICKNESS / 2, // Slight overlap
                h: WALL_THICKNESS
            });
        }

        // Bottom Wall (Only for last row)
        if (cell.walls.bottom && cell.y === rows - 1) {
            walls.push({
                x: cx + CELL_SIZE / 2,
                y: cy + CELL_SIZE,
                w: CELL_SIZE + WALL_THICKNESS / 2,
                h: WALL_THICKNESS
            });
        }

        // Left Wall
        if (cell.walls.left) {
            walls.push({
                x: cx,
                y: cy + CELL_SIZE / 2,
                w: WALL_THICKNESS,
                h: CELL_SIZE + WALL_THICKNESS / 2
            });
        }

        // Right Wall (Only for last col)
        if (cell.walls.right && cell.x === cols - 1) {
            walls.push({
                x: cx + CELL_SIZE,
                y: cy + CELL_SIZE / 2,
                w: WALL_THICKNESS,
                h: CELL_SIZE + WALL_THICKNESS / 2
            });
        }


    });

    return walls;
}
