// All gameplay tuning lives here. The server, the bots and every client import it,
// so a change applies to simulation, validation and rendering at once.

export const TICK_RATE = 30; // server simulation steps per second
export const PATCH_MS = 33; // state sync interval
export const MOVE_SEND_HZ = 30; // how often phones report their position

export const MAZE = {
  cell: 120,
  wall: 24,
  /** Fraction of dead ends opened into loops (the rest stay as hiding spots). */
  braidChance: 0.55,
  plazas: 2,
};

export function mazeSizeFor(players: number): { cols: number; rows: number } {
  if (players <= 3) return { cols: 9, rows: 6 };
  if (players <= 5) return { cols: 11, rows: 7 };
  return { cols: 13, rows: 8 };
}

export const PLAYER = {
  radius: 14, // collision circle
  drawRadius: 16,
  runnerSpeed: 210, // px/s
  seekerSpeed: 195, // a bit slower than runners; Sprint closes the gap
  ghostSpeed: 250,
  /** Exponential approach rates (1/s): higher = snappier. */
  accel: 16,
  decel: 20,
  seekerTurnRate: Math.PI * 4.5, // rad/s – the flashlight sweeps instead of snapping
};

export const VISION = {
  coneAngle: (72 * Math.PI) / 180,
  coneRange: 260,
  auraRadius: 56, // small glow all around the seeker
  runnerLight: 120,
  coneRays: 90,
  circleRays: 56,
  orbLight: 46,
  flareLight: 150,
};

export const RULES = {
  minPlayers: 2,
  maxPlayers: 8,
  revealMs: 4000,
  scatterMs: 10000,
  huntMs: 150000,

  exposureFillSec: 1.5, // continuous light needed for a catch
  /** Small groups get a little more slack, so two runners aren't swept in seconds. */
  exposureFillFor: (runners: number) => 1.5 + 0.4 * Math.max(0, 4 - runners),
  exposureDecaySec: 0.6,
  flareExposureScale: 0.5, // flares expose at half speed

  rescueRadius: 48,
  rescueSec: 2.2,
  lockpickSec: 30, // alone in a cage, you break out eventually
  rescueInvulnMs: 3000,

  orbRadius: 26,
  orbsToWin: (runners: number) => 3 + runners * 2,
  activeOrbs: (runners: number) => Math.min(3, 1 + Math.ceil(runners / 2)),
  orbChargeSec: 2, // stand on an orb this long to bank it
  orbChargeDecaySec: 2,
  orbRespawnMs: 5000,

  sneezeIdleMs: 10000,
  sneezeMoveThreshold: 28,

  lockerRange: 46,
  lockerMaxHideMs: 12000,
  lockerSearchMs: 900,
  lockerSearchCooldownMs: 2500,
  lockersFor: (players: number) => 3 + Math.ceil(players / 2),

  itemBoxes: 3,
  itemRespawnMs: 9000,
  itemPickupRadius: 30,

  helpCooldownMs: 6000,

  lobbyDropMs: 45000, // longer than the reconnect window, so a reconnecting phone finds its seat
  reconnectWindowSec: 40,
  seekerDropAbortMs: 30000,
  roomIdleMs: 10 * 60 * 1000,
};

export const ABILITIES = {
  polo: { cooldownMs: 18000, windowMs: 2600, jitter: 55 },
  sprint: { cooldownMs: 10000, durationMs: 2000, multiplier: 1.6 },
  dash: { cooldownMs: 6000, durationMs: 180, multiplier: 3.0 },
  boo: { cooldownMs: 7000 },
};

export const ITEMS = {
  smoke: { radius: 85, durationMs: 7000 },
  decoy: { durationMs: 5000 },
  flash: { range: 270, blindMs: 2500 },
  flare: { durationMs: 6000, throw: 70 },
  trap: { radius: 22, rootMs: 2500, lifetimeMs: 60000 },
};

export type RunnerItem = "smoke" | "decoy" | "flash";
export type SeekerItem = "flare" | "trap";
export type Item = RunnerItem | SeekerItem;
export const RUNNER_ITEMS: RunnerItem[] = ["smoke", "decoy", "flash"];
export const SEEKER_ITEMS: SeekerItem[] = ["flare", "trap"];

export const SCORING = {
  seekerCatch: 1,
  seekerWin: 3,
  runnerOrb: 1,
  runnerRescue: 2,
  runnerWin: 3,
};

/** Movement validation slack: phones report positions, the server checks them. */
export const VALIDATION = {
  speedSlack: 1.35,
  distSlack: 26,
  maxGapSec: 0.5,
  boostGraceMs: 250,
};

export const PLAYER_COLORS = ["#38bdf8", "#4ade80", "#fbbf24", "#c084fc", "#2dd4bf", "#f472b6", "#a3e635", "#fb923c"];
export const SEEKER_COLOR = "#ff3b5c";

/** Little faces players pick in the lobby (rendered on their blob). */
export const FACES = ["happy", "cool", "sly", "wow", "sleepy", "grin", "nerd", "cat"] as const;
export type Face = (typeof FACES)[number];
