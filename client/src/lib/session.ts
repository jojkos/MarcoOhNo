// Connection to the game server (Colyseus). The URL decides which room a tab follows;
// this module joins it, keeps it joined across drops, and exposes events and state.
import { Client, type Room } from "@colyseus/sdk";
import { JoinError, ROOM_NAME, type FxEvent, type JoinOptions, type RoomStatus, type RoundResult } from "@shared/protocol";
import type { GameState } from "@shared/schema";
import { useGameStore, type AttachMode, type PlayerView, type RoomView } from "./gameStore";
import { dropHost, dropSeat, hostToken, saveHost, saveSeat, seatFor } from "./storage";
import { toast } from "@/hooks/use-toast";

const client = new Client(window.location.origin);

let room: Room<GameState> | null = null;
let target: { mode: AttachMode; code: string } | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export const getRoom = () => room;

// ------------------------------------------------------------------ events

type Listener<T> = (v: T) => void;
const fxListeners = new Set<Listener<FxEvent[]>>();
const correctListeners = new Set<Listener<{ x: number; y: number }>>();
const roomListeners = new Set<Listener<Room<GameState> | null>>();

export function onFx(fn: Listener<FxEvent[]>) {
  fxListeners.add(fn);
  return () => void fxListeners.delete(fn);
}
export function onCorrect(fn: Listener<{ x: number; y: number }>) {
  correctListeners.add(fn);
  return () => void correctListeners.delete(fn);
}
/** Fires whenever the joined room instance changes (join, rejoin, leave). */
export function onRoomChange(fn: Listener<Room<GameState> | null>) {
  roomListeners.add(fn);
  return () => void roomListeners.delete(fn);
}

// ------------------------------------------------------------------ clock sync

/** serverTime ≈ performance.now() + offset. Median of recent ping samples. */
let offsets: number[] = [];
let clockOffset = 0;
export const serverNow = () => performance.now() + clockOffset;

function startClockSync(r: Room<GameState>) {
  offsets = [];
  r.onMessage("pong", ({ t, server }: { t: number; server: number }) => {
    const now = performance.now();
    const rtt = now - t;
    offsets.push(server + rtt / 2 - now);
    if (offsets.length > 15) offsets.shift();
    clockOffset = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
  });
  const ping = () => r.connection?.isOpen && r.send("ping", { t: performance.now() });
  for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
  const id = setInterval(ping, 2000);
  r.onLeave(() => clearInterval(id));
}

// ------------------------------------------------------------------ view (React)

let lastView = 0;
let viewTimer: ReturnType<typeof setTimeout> | null = null;

function playerView(p: any): PlayerView {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    face: p.face,
    isBot: p.isBot,
    connected: p.connected,
    score: p.score,
    inRound: p.inRound,
    role: p.role,
    status: p.status,
    exposure: p.exposure,
    rescue: p.rescue,
    invuln: p.invuln,
    locker: p.locker,
    rooted: p.rooted,
    blinded: p.blinded,
    searching: p.searching,
    cdA: p.cdA,
    cdB: p.cdB,
    item: p.item,
    x: p.x,
    y: p.y,
  };
}

function buildView(s: GameState): RoomView {
  const players: PlayerView[] = [];
  s.players.forEach((p) => players.push(playerView(p)));
  let result: RoundResult | null = null;
  if (s.result) {
    try {
      result = JSON.parse(s.result);
    } catch {
      result = null;
    }
  }
  return {
    code: s.code,
    phase: s.phase,
    phaseLeft: s.phaseLeft,
    vipId: s.vipId,
    hostConnected: s.hostConnected,
    collected: s.collected,
    players,
    round: s.round ? { id: s.round.id, seekerId: s.round.seekerId, orbsToWin: s.round.orbsToWin } : null,
    result,
    danger: players.some((p) => p.exposure > 0.35),
  };
}

function scheduleView(s: GameState) {
  if (!s?.players) return; // first full state not decoded yet
  const prev = useGameStore.getState().view;
  const urgent = !prev || prev.phase !== s.phase || prev.players.length !== s.players.size || prev.result === null !== !s.result;
  const now = performance.now();
  if (urgent || now - lastView > 100) {
    lastView = now;
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = null;
    useGameStore.setState({ view: buildView(s) });
  } else if (!viewTimer) {
    viewTimer = setTimeout(() => {
      viewTimer = null;
      if (room) scheduleView(room.state);
    }, 100 - (now - lastView));
  }
}

// ------------------------------------------------------------------ attach

function setAttachment(patch: Partial<NonNullable<ReturnType<typeof useGameStore.getState>["attachment"]>>) {
  const cur = useGameStore.getState().attachment;
  if (cur) useGameStore.setState({ attachment: { ...cur, ...patch } });
}

function fail(reason: string, message: string) {
  setAttachment({ status: "error", error: { reason, message } });
}

function codeReason(code: number | undefined): string {
  switch (code) {
    case 522:
      return "not_found";
    case JoinError.BAD_TOKEN:
      return "bad_token";
    case JoinError.SEAT_EXPIRED:
      return "seat_expired";
    case JoinError.FULL:
      return "full";
    case JoinError.IN_PROGRESS:
      return "in_progress";
    case JoinError.NAME_TAKEN:
      return "name_taken";
    default:
      return "network";
  }
}

function whoami<T>(r: Room<GameState>, type: string): Promise<T> {
  return new Promise((resolve) => {
    const off = r.onMessage(type, (msg: T) => {
      off();
      resolve(msg);
    });
    r.send("whoami");
  });
}

/** Wire a freshly joined room into the app. */
function bind(r: Room<GameState>, mode: AttachMode, isHost: boolean) {
  room = r;
  r.reconnection.maxRetries = 12;
  r.reconnection.minUptime = 1000;
  r.onStateChange((s) => scheduleView(s));
  r.onMessage("fx", (events: FxEvent[]) => fxListeners.forEach((fn) => fn(events)));
  r.onMessage("correct", (c: { x: number; y: number }) => correctListeners.forEach((fn) => fn(c)));
  r.onMessage("notice", (m: string) => toast({ title: m, duration: 3000 }));
  r.onMessage("kicked", (reason: string) => {
    r.reconnection.enabled = false;
    attempt++;
    fail("kicked", reason);
  });
  r.onDrop(() => setAttachment({ status: "reconnecting" }));
  r.onReconnect(() => setAttachment({ status: "attached" }));
  r.onLeave((code) => {
    if (room !== r) return;
    room = null;
    roomListeners.forEach((fn) => fn(null));
    // Consented leaves are ours (navigating away). Anything else: try to get back in.
    if (code !== 4000 && target && useGameStore.getState().attachment?.status !== "error") {
      setAttachment({ status: "reconnecting" });
      scheduleRetry(1500);
    }
  });
  startClockSync(r);
  setAttachment({ status: "attached", isHost, mode, error: undefined });
  scheduleView(r.state);
  roomListeners.forEach((fn) => fn(r));
}

function scheduleRetry(ms: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (target) void join(target.mode, target.code);
  }, ms);
}

async function join(mode: AttachMode, code: string) {
  const id = ++attempt;
  const stale = () => id !== attempt;
  try {
    if (mode === "tv") {
      const token = hostToken(code);
      let r: Room<GameState>;
      let isHost = !!token;
      try {
        r = await client.joinById<GameState>(code, (token ? { role: "tv", hostToken: token } : { role: "watch" }) satisfies JoinOptions);
      } catch (e: any) {
        if (e?.code !== JoinError.BAD_TOKEN || !token) throw e;
        dropHost(code);
        isHost = false;
        r = await client.joinById<GameState>(code, { role: "watch" } satisfies JoinOptions);
      }
      if (stale()) return void r.leave();
      bind(r, mode, isHost);
      return;
    }

    const seat = seatFor(code);
    if (!seat) return fail("no_seat", "You haven't joined this room yet.");
    const r = await client.joinById<GameState>(code, { role: "player", seatToken: seat.token } satisfies JoinOptions);
    if (stale()) return void r.leave();
    useGameStore.setState({ playerId: seat.playerId });
    bind(r, mode, false);
    const me = await whoami<{ seatToken: string; playerId: string; name: string }>(r, "seat");
    saveSeat(code, { token: me.seatToken, name: me.name, playerId: me.playerId });
    useGameStore.setState({ playerId: me.playerId });
  } catch (e: any) {
    if (stale()) return;
    const reason = codeReason(e?.code);
    if (reason === "seat_expired") dropSeat(code);
    if (reason === "network") {
      setAttachment({ status: "reconnecting" });
      return scheduleRetry(2500);
    }
    fail(reason, reason === "not_found" ? `Room ${code} has ended` : e?.message ?? "Couldn't join");
  }
}

function resetRoomState() {
  useGameStore.setState({ view: null, playerId: null });
}

async function leaveCurrent() {
  const r = room;
  room = null;
  if (r) {
    roomListeners.forEach((fn) => fn(null));
    try {
      await r.leave(true);
    } catch {
      /* already gone */
    }
  }
}

/** Follow a room as the TV (host if this browser owns it, otherwise watching). */
export function attachTv(code: string) {
  attachTo("tv", code);
}

/** Follow a room as a player, using the seat saved for it. */
export function attachPlay(code: string) {
  attachTo("play", code);
}

function attachTo(mode: AttachMode, code: string) {
  const cur = useGameStore.getState().attachment;
  if (target?.mode === mode && target.code === code && cur && cur.status !== "error") return;
  void leaveCurrent();
  target = { mode, code };
  resetRoomState();
  useGameStore.setState({ attachment: { mode, code, status: "connecting", isHost: false } });
  void join(mode, code);
}

/** Stop following (navigated away). The seat is kept so you can come back. */
export function detach() {
  target = null;
  attempt++;
  if (retryTimer) clearTimeout(retryTimer);
  void leaveCurrent();
  resetRoomState();
  useGameStore.setState({ attachment: null });
}

export function retryAttach() {
  if (!target) return;
  setAttachment({ status: "connecting", error: undefined });
  void join(target.mode, target.code);
}

// ------------------------------------------------------------------ actions

export async function createRoom(): Promise<{ code: string } | { error: string }> {
  try {
    await leaveCurrent();
    const r = await client.create<GameState>(ROOM_NAME, { role: "tv" } satisfies JoinOptions);
    const { hostToken: token } = await whoami<{ hostToken: string }>(r, "host");
    saveHost(r.roomId, token);
    target = { mode: "tv", code: r.roomId };
    attempt++;
    resetRoomState();
    useGameStore.setState({ attachment: { mode: "tv", code: r.roomId, status: "connecting", isHost: true } });
    bind(r, "tv", true);
    return { code: r.roomId };
  } catch (e: any) {
    return { error: e?.message ?? "Couldn't reach the server" };
  }
}

export type JoinOutcome = { ok: true; code: string } | { ok: false; reason: string; error: string };

/** Join with a new (or reclaimed) seat and remember it for this tab. */
export async function joinRoom(code: string, name: string, face: number): Promise<JoinOutcome> {
  try {
    await leaveCurrent();
    const r = await client.joinById<GameState>(code, { role: "player", name, face } satisfies JoinOptions);
    target = { mode: "play", code };
    attempt++;
    resetRoomState();
    useGameStore.setState({ attachment: { mode: "play", code, status: "connecting", isHost: false } });
    bind(r, "play", false);
    const me = await whoami<{ seatToken: string; playerId: string; name: string }>(r, "seat");
    saveSeat(code, { token: me.seatToken, name: me.name, playerId: me.playerId });
    useGameStore.setState({ playerId: me.playerId });
    return { ok: true, code };
  } catch (e: any) {
    const reason = codeReason(e?.code);
    return { ok: false, reason, error: reason === "not_found" ? `No room with code ${code}` : e?.message ?? "Couldn't join" };
  }
}

/** Give up the seat for good. */
export function leaveSeat() {
  const code = target?.code;
  room?.send("leaveSeat");
  if (code) dropSeat(code);
  detach();
}

export async function roomStatus(code: string): Promise<RoomStatus> {
  try {
    return (await (await fetch(`/api/rooms/${encodeURIComponent(code)}`)).json()) as RoomStatus;
  } catch {
    return { exists: false };
  }
}

export const send = {
  start: () => room?.send("start"),
  toLobby: () => room?.send("toLobby"),
  addBot: () => room?.send("addBot"),
  removeBot: () => room?.send("removeBot"),
  setFace: (face: number) => room?.send("setFace", { face }),
  action: (slot: "a" | "b" | "item" | "act") => room?.send("action", { slot }),
  move: (m: { x: number; y: number; vx: number; vy: number; a: number }) => room?.send("move", m),
};
