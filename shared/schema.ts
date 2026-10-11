// Replicated room state (Colyseus schema). The server mutates it; clients receive
// binary delta patches. One-off events travel as messages instead (see protocol.ts).
import { schema, t, type SchemaType } from "@colyseus/schema";

export type Phase = "lobby" | "reveal" | "scatter" | "hunt" | "round_over";
export type Role = "seeker" | "runner";
/** Runner lifecycle: free -> caged (rescuable) -> ghost (out for good, can haunt). */
export type Status = "free" | "caged" | "ghost";

export const Player = schema(
  {
    id: t.string().default(""),
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    face: t.uint8().default(0),
    isBot: t.boolean().default(false),
    connected: t.boolean().default(true),
    score: t.int32().default(0),
    timesSeeker: t.uint8().default(0),

    // round state
    inRound: t.boolean().default(false),
    role: t.string<Role>().default("runner"),
    status: t.string<Status>().default("free"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    angle: t.float32().default(0),
    exposure: t.float32().default(0),
    rescue: t.float32().default(0),
    lit: t.boolean().default(false),
    invuln: t.boolean().default(false),
    /** Hiding in this locker (-1 = not hiding). */
    locker: t.int8().default(-1),
    rooted: t.boolean().default(false),
    blinded: t.boolean().default(false),
    /** 0..1 progress of a locker search in progress (seeker). */
    searching: t.float32().default(0),
    /** Active speed boost multiplier (1 = none). */
    boost: t.float32().default(1),
    cdA: t.uint16().default(0),
    cdB: t.uint16().default(0),
    item: t.string().default(""),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const Rect = schema({ x: t.float32(), y: t.float32(), w: t.float32(), h: t.float32() }, "Rect");
export type Rect = SchemaType<typeof Rect>;

export const Locker = schema(
  {
    id: t.uint8().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
    dir: t.float32().default(0),
    /** Recently searched (shows a mark, can't be searched again for a moment). */
    checked: t.boolean().default(false),
  },
  "Locker",
);
export type Locker = SchemaType<typeof Locker>;

/** Generic point entity: orbs, item boxes, smoke, flares, traps. */
export const Thing = schema(
  {
    id: t.uint16().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** Remaining lifetime in ms (0 = permanent). */
    ttl: t.uint16().default(0),
    owner: t.string().default(""),
  },
  "Thing",
);
export type Thing = SchemaType<typeof Thing>;

export const Decoy = schema(
  {
    id: t.uint16().default(0),
    owner: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    ttl: t.uint16().default(0),
  },
  "Decoy",
);
export type Decoy = SchemaType<typeof Decoy>;

export const Round = schema(
  {
    id: t.uint16().default(0),
    width: t.float32().default(0),
    height: t.float32().default(0),
    cols: t.uint8().default(0),
    rows: t.uint8().default(0),
    wallCount: t.uint16().default(0),
    rects: t.array(Rect),
    lockers: t.array(Locker),
    seekerId: t.string().default(""),
    orbsToWin: t.uint8().default(0),
    spawnX: t.float32().default(0),
    spawnY: t.float32().default(0),
  },
  "Round",
);
export type Round = SchemaType<typeof Round>;

export const GameState = schema(
  {
    code: t.string().default(""),
    phase: t.string<Phase>().default("lobby"),
    /** ms left in the current phase. */
    phaseLeft: t.uint32().default(0),
    /** Server clock (ms) at the last tick – used for interpolation timing. */
    time: t.float64().default(0),
    vipId: t.string().default(""),
    hostConnected: t.boolean().default(false),
    players: t.map(Player),
    round: t.ref(Round).optional(),
    collected: t.uint8().default(0),
    poloActive: t.boolean().default(false),
    orbs: t.array(Thing),
    items: t.array(Thing),
    smokes: t.array(Thing),
    flares: t.array(Thing),
    traps: t.array(Thing),
    decoys: t.array(Decoy),
    /** JSON of the last RoundResult (see protocol.ts), "" when none. */
    result: t.string().default(""),
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;
