import { z } from "zod";

export const PlayerRole = {
  NONE: "none",
  SEEKER: "seeker",
  RUNNER: "runner",
} as const;

export type PlayerRole = (typeof PlayerRole)[keyof typeof PlayerRole];

export const PlayerStatus = {
  WAITING: "waiting",
  READY: "ready",
  ALIVE: "alive",
  CAUGHT: "caught",
} as const;

export type PlayerStatus = (typeof PlayerStatus)[keyof typeof PlayerStatus];

export const GamePhase = {
  LOBBY: "lobby",
  ROLE_REVEAL: "role_reveal",
  PLAYING: "playing",
  GAME_OVER: "game_over",
} as const;

export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

export const ClientType = {
  TV: "tv",
  MOBILE: "mobile",
} as const;

export type ClientType = (typeof ClientType)[keyof typeof ClientType];

export const playerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(12),
  color: z.string(),
  role: z.enum(["none", "seeker", "runner"]),
  status: z.enum(["waiting", "ready", "alive", "caught"]),
  x: z.number(),
  y: z.number(),
  angle: z.number(),
  catchProgress: z.number().min(0).max(100),
  ripPosition: z.object({ x: z.number(), y: z.number() }).nullable(),
});

export type Player = z.infer<typeof playerSchema>;

export const gameStateSchema = z.object({
  roomCode: z.string().length(4),
  phase: z.enum(["lobby", "role_reveal", "playing", "game_over"]),
  players: z.array(playerSchema),
  hostId: z.string(),
  seekerId: z.string().nullable(),
  timeRemaining: z.number(),
  marcoCooldown: z.number(),
  marcoRevealPlayerId: z.string().nullable(),
  marcoRevealExpiry: z.number().nullable(),
  winner: z.enum(["seeker", "runners"]).nullable(),
  exploredAreas: z.array(z.object({
    x: z.number(),
    y: z.number(),
    radius: z.number(),
    source: z.enum(["seeker", "runner"]).optional()
  })),
  walls: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })),
});

export type GameState = z.infer<typeof gameStateSchema>;

export const PLAYER_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#00bcd4",
];

export const MAP_CONFIG = {
  width: 1200,
  height: 800,
  playerRadius: 16,
  seekerVisionAngle: 60,
  seekerVisionDistance: 180,
  runnerVisionRadius: 120,
  catchDuration: 2000,
  marcoCooldown: 15000,
  marcoRevealDuration: 2000,
  gameDuration: 60000,
};



export const insertPlayerSchema = playerSchema.omit({ id: true, catchProgress: true, ripPosition: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

export interface ServerToClientEvents {
  gameState: (state: GameState) => void;
  playerJoined: (player: Player) => void;
  playerLeft: (playerId: string) => void;
  gameStarted: () => void;
  roleRevealed: (role: PlayerRole) => void;
  playerCaught: (playerId: string, position: { x: number; y: number }) => void;
  marcoTriggered: (targetPlayerId: string) => void;
  gameOver: (winner: "seeker" | "runners") => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  createRoom: (clientType: ClientType, callback: (roomCode: string) => void) => void;
  joinRoom: (roomCode: string, playerName: string, clientType: ClientType, callback: (success: boolean, error?: string) => void) => void;
  startGame: () => void;
  movePlayer: (x: number, y: number, angle: number) => void;
  triggerMarco: () => void;
  leaveRoom: () => void;
  playAgain: () => void;
}

export type User = { id: string; username: string; password: string };
export type InsertUser = { username: string; password: string };
