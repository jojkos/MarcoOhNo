// All gameplay tuning lives here. Server and client both import it, so a change
// applies to simulation, prediction and rendering at once.

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE; // seconds per simulation step

export const MAZE = {
  cellSize: 120,
  wallThickness: 24,
  // Fraction of dead ends opened up into loops (rest stay as hiding spots).
  braidChance: 0.6,
  // Open 2x2 "plazas" carved into the maze for variety.
  plazas: 2,
};

/** Maze dimensions (in cells) by player count. Bigger groups get a bigger maze. */
export function mazeSizeFor(playerCount: number): { cols: number; rows: number } {
  if (playerCount <= 3) return { cols: 9, rows: 6 };
  if (playerCount <= 5) return { cols: 11, rows: 7 };
  return { cols: 13, rows: 8 };
}

export const PLAYER = {
  radius: 15,
  /** Half-size of the square collision box. Slightly smaller than radius so corners feel forgiving. */
  hitHalf: 12,
  runnerSpeed: 200, // px/s
  seekerSpeed: 185, // slower than runners; Sprint closes the gap
  ghostSpeed: 240,
  seekerTurnRate: Math.PI * 4, // rad/s; flashlight sweeps instead of snapping
};

export const VISION = {
  seekerConeAngle: (70 * Math.PI) / 180,
  seekerConeRange: 250,
  seekerAuraRadius: 55, // small 360° glow around the seeker
  runnerLightRadius: 115,
  coneRays: 72,
  auraRays: 40,
};

export const RULES = {
  minPlayers: 2,
  maxPlayers: 8,
  revealMs: 3500,
  scatterMs: 10000,
  huntMs: 150000,

  exposureFillSec: 1.6, // seconds of continuous light to catch
  exposureDecaySec: 0.6, // seconds to fully drain once out of light

  rescueRadius: 46,
  rescueSec: 2.2,
  rescueDecaySec: 3,
  rescueInvulnMs: 3000,

  orbRadius: 26,
  /** Orbs the runner team needs to win. */
  orbsToWin: (runners: number) => 2 + runners * 2,
  /** Orbs visible on the map at once. */
  activeOrbs: (runners: number) => Math.min(5, runners + 2),

  sneezeIdleMs: 10000,
  sneezeMoveThreshold: 28,

  // Grace periods for dropped connections.
  lobbyDropMs: 20000,
  seekerDropAbortMs: 25000,
  roomIdleMs: 10 * 60 * 1000,
};

export const ABILITIES = {
  polo: { cooldownMs: 18000, windowMs: 2600, jitter: 55 },
  sprint: { cooldownMs: 10000, steps: Math.round(2 * TICK_RATE), multiplier: 1.6 },
  dash: { cooldownMs: 6000, steps: 6, multiplier: 3.2 },
  boo: { cooldownMs: 7000 },
};

export const SCORING = {
  seekerCatch: 1,
  seekerWin: 3,
  runnerOrb: 1,
  runnerRescue: 2,
  runnerWin: 3,
};

export const PLAYER_COLORS = [
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#00bcd4",
  "#cddc39",
];

export const SEEKER_COLOR = "#ff3b3b";
