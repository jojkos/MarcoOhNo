// Wire protocol between server and clients.

export interface Wall {
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Phase = "lobby" | "reveal" | "scatter" | "hunt" | "round_over";
export type Role = "seeker" | "runner";
/** Runner lifecycle: free -> caged (rescuable) -> ghost (out for good, can haunt). */
export type Status = "free" | "caged" | "ghost";

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  score: number;
  timesSeeker: number;
}

export interface RoundInfo {
  id: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  walls: Wall[];
  seekerId: string;
  orbsToWin: number;
  spawn: { x: number; y: number };
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
}

/** Low-frequency room state, sent whenever it changes. */
export interface RoomInfo {
  code: string;
  phase: Phase;
  vipId: string | null;
  players: LobbyPlayer[];
  round: RoundInfo | null;
  result: RoundResult | null;
}

export interface SnapPlayer {
  id: string;
  x: number;
  y: number;
  angle: number;
  role: Role;
  status: Status;
  /** 0..1 how close to being caught. */
  exposure: number;
  /** 0..1 rescue progress while caged. */
  rescue: number;
  /** Currently visible to the seeker (in cone or aura with line of sight). */
  lit: boolean;
  invuln: boolean;
  /** Last input sequence the server applied for this player. */
  ack: number;
  /** Remaining boosted movement steps (dash/sprint), needed for prediction replay. */
  boost: number;
  boostMul: number;
  cdA: number;
  cdB: number;
  connected: boolean;
}

export interface Orb {
  id: number;
  x: number;
  y: number;
}

/** High-frequency state, sent every tick while a round is running. */
export interface Snapshot {
  tick: number;
  phase: Phase;
  phaseLeft: number;
  players: SnapPlayer[];
  orbs: Orb[];
  collected: number;
  poloActive: boolean;
}

export type FxEvent =
  | { k: "polo"; pings: { x: number; y: number }[]; targets: string[] }
  | { k: "noise"; x: number; y: number; polo: boolean }
  | { k: "caught"; id: string; x: number; y: number; ghost: boolean }
  | { k: "freed"; id: string; by: string }
  | { k: "orb"; x: number; y: number; by: string };

export interface InputMsg {
  seq: number;
  mx: number;
  my: number;
  /** Primary ability: seeker=Polo, runner=Dash, ghost=Boo. */
  a?: 1;
  /** Secondary ability: seeker=Sprint. */
  b?: 1;
}

export type Ack<T> = (res: T) => void;

export type JoinErrorReason = "not_found" | "full" | "in_progress" | "name_taken" | "bad_name" | "seat_expired";

export type JoinResult =
  | { ok: true; playerId: string; token: string; code: string; name: string }
  | { ok: false; error: string; reason: JoinErrorReason };

export type HostResult =
  | { ok: true; code: string; hostToken: string }
  | { ok: false; error: string; reason: "not_found" | "bad_token" };

export type WatchResult = { ok: true; code: string } | { ok: false; error: string; reason: "not_found" };

/** GET /api/rooms/:code */
export interface RoomStatus {
  exists: boolean;
  phase?: Phase;
  players?: number;
  joinable?: boolean;
}

export interface ServerToClientEvents {
  room: (room: RoomInfo) => void;
  snap: (snap: Snapshot) => void;
  fx: (events: FxEvent[]) => void;
  notice: (message: string) => void;
  /** This client was detached from its room (seat opened elsewhere, room closed...). */
  kicked: (reason: string) => void;
}

export interface ClientToServerEvents {
  /** TV creates a brand new room. */
  createRoom: (cb: Ack<HostResult>) => void;
  /** TV reclaims a room it created (host token). Never creates a room implicitly. */
  hostRoom: (req: { code: string; hostToken: string }, cb: Ack<HostResult>) => void;
  /** Extra screen watching a room without controlling it. */
  watchRoom: (req: { code: string }, cb: Ack<WatchResult>) => void;
  /** Phone joins a room by name, or resumes its seat with a token. */
  join: (req: { code: string; name?: string; token?: string }, cb: Ack<JoinResult>) => void;
  /** Stop following the room but keep the seat (navigated away). */
  detach: () => void;
  /** Give up the seat for good. */
  leave: () => void;
  start: () => void;
  toLobby: () => void;
  input: (inputs: InputMsg[]) => void;
}
