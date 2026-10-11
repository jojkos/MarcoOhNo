// Messages between clients and the PartyRoom (everything that isn't synced state).
import type { Item } from "./config";
import type { Phase, Role, Status } from "./schema";

export const ROOM_NAME = "party";

/** Options passed to client.create()/joinById(). */
export type JoinOptions =
  | { role: "tv"; hostToken?: string }
  | { role: "watch" }
  | { role: "player"; name?: string; seatToken?: string; face?: number };

/** Error codes thrown from onAuth (ServerError). The SDK surfaces them as `code`. */
export const JoinError = {
  NOT_FOUND: 4404,
  BAD_TOKEN: 4401,
  FULL: 4409,
  IN_PROGRESS: 4423,
  NAME_TAKEN: 4410,
  BAD_NAME: 4422,
  SEAT_EXPIRED: 4411,
} as const;
export type JoinErrorCode = (typeof JoinError)[keyof typeof JoinError];

// ---------------------------------------------------------------- client -> server

export interface MoveMsg {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
}

/** a = primary ability, b = secondary ability, item = use held item, act = context action (locker). */
export type ActionSlot = "a" | "b" | "item" | "act";

export interface ClientMessages {
  move: MoveMsg;
  action: { slot: ActionSlot };
  start: void;
  toLobby: void;
  addBot: void;
  removeBot: void;
  setFace: { face: number };
  ping: { t: number };
  whoami: void;
  leaveSeat: void;
}

// ---------------------------------------------------------------- server -> client

export type FxEvent =
  | { k: "polo"; pings: { x: number; y: number }[]; targets: string[] }
  | { k: "noise"; x: number; y: number; polo: boolean; why: "orb" | "sneeze" | "boo" | "locker" | "trap" }
  | { k: "caught"; id: string; by: string; x: number; y: number; ghost: boolean }
  | { k: "freed"; id: string; by: string; x: number; y: number }
  | { k: "orb"; x: number; y: number; by: string }
  | { k: "item"; id: string; item: Item; x: number; y: number }
  | { k: "use"; id: string; item: Item | "dash" | "sprint" | "boo"; x: number; y: number }
  | { k: "flash"; x: number; y: number; hit: boolean }
  | { k: "decoyPop"; x: number; y: number }
  | { k: "locker"; id: number; what: "enter" | "exit" | "search" | "empty" | "found" }
  | { k: "help"; id: string; x: number; y: number }
  | { k: "trapped"; id: string; x: number; y: number };

export interface Award {
  id: string;
  title: string;
  detail: string;
}

export interface PlayerResult {
  id: string;
  role: Role;
  status: Status;
  catches: number;
  orbs: number;
  rescues: number;
  points: number;
}

export interface RoundResult {
  winner: "seeker" | "runners" | "aborted";
  reason: string;
  players: PlayerResult[];
  awards: Award[];
}

export interface ServerMessages {
  host: { hostToken: string };
  seat: { seatToken: string; playerId: string; name: string };
  watching: {};
  fx: FxEvent[];
  /** Your reported position was rejected; snap here. */
  correct: { x: number; y: number };
  pong: { t: number; server: number };
  notice: string;
  kicked: string;
}

/** GET /api/rooms/:code */
export interface RoomStatus {
  /** undefined = couldn't tell (offline, server waking up); only false means gone. */
  exists?: boolean;
  phase?: Phase;
  players?: number;
  joinable?: boolean;
}
