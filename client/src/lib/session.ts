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

/** Last time anything arrived from the server (pong or state patch). */
let lastHeard = 0;

/**
 * Clock sync + connection watchdog. Browsers can't see WebSocket pings, so a socket that
 * went half-open while the phone was locked would look "connected" and frozen forever.
 * If nothing arrives for a while (and the page is visible), force the SDK to reconnect.
 */
function startClockSync(r: Room<GameState>) {
  offsets = [];
  lastHeard = performance.now();
  r.onMessage("pong", ({ t, server }: { t: number; server: number }) => {
    const now = performance.now();
    lastHeard = now;
    const rtt = now - t;
    offsets.push(server + rtt / 2 - now);
    if (offsets.length > 15) offsets.shift();
    clockOffset = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
  });
  const ping = () => room === r && r.connection?.isOpen && r.send("ping", { t: performance.now() });
  for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
  const id = setInterval(() => {
    if (room !== r) return clearInterval(id);
    ping();
    const quiet = performance.now() - lastHeard;
    if (document.visibilityState === "visible" && r.connection?.isOpen && quiet > 8000) {
      lastHeard = performance.now();
      r.connection.close(4010, "stalled"); // 4010 = "may try reconnect": the SDK reconnects
    }
  }, 2000);
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    lastHeard = Math.max(lastHeard, performance.now() - 6000); // give it ~2 s to answer
    ping();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  r.onLeave(() => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
  });
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

type Attachment = NonNullable<ReturnType<typeof useGameStore.getState>["attachment"]>;

/** An error screen stays until the user acts (retry / navigate); late events can't undo it. */
function setAttachment(patch: Partial<Attachment>, force = false) {
  const cur = useGameStore.getState().attachment;
  if (!cur) return;
  if (cur.status === "error" && patch.status !== "error" && !force) return;
  useGameStore.setState({ attachment: { ...cur, ...patch } });
}

function fail(reason: string, message: string) {
  setAttachment({ status: "error", error: { reason, message } });
}

const FATAL_CODES = new Set([523, 525, 526, JoinError.BAD_NAME]);

function codeReason(code: number | undefined): string {
  if (code !== undefined && FATAL_CODES.has(code)) return "error";
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

/** Ask the server who we are in this room. Fails if the room closes or nobody answers. */
function whoami<T>(r: Room<GameState>, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = () => {
      off();
      clearTimeout(timer);
      r.onLeave.remove(onLeave);
    };
    const off = r.onMessage(type, (msg: T) => {
      done();
      resolve(msg);
    });
    const onLeave = () => {
      done();
      reject(Object.assign(new Error("Lost the connection"), { code: 0 }));
    };
    r.onLeave(onLeave);
    const timer = setTimeout(() => {
      done();
      reject(Object.assign(new Error("The server didn't answer"), { code: 0 }));
    }, 8000);
    r.send("whoami");
  });
}

/** Colyseus says "room not found" (522) for a missing room, but a proxy can return 522 too. */
async function confirmGone(code: string): Promise<boolean> {
  const st = await roomStatus(code);
  return st.exists === false;
}

let dropTimer: ReturnType<typeof setTimeout> | null = null;
function clearDropTimer() {
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = null;
}

/** Wire a freshly joined room into the app. */
function bind(r: Room<GameState>, mode: AttachMode, isHost: boolean) {
  room = r;
  let kicked = false;
  r.reconnection.maxRetries = 12;
  r.reconnection.minUptime = 1000;
  // Don't replay a pile of stale moves after a reconnect.
  r.reconnection.maxEnqueuedMessages = 4;
  // Every handler ignores events from a room we've already moved on from.
  r.onStateChange((s) => {
    if (room !== r) return;
    lastHeard = performance.now();
    scheduleView(s);
  });
  r.onMessage("fx", (events: FxEvent[]) => room === r && fxListeners.forEach((fn) => fn(events)));
  r.onMessage("correct", (c: { x: number; y: number }) => room === r && correctListeners.forEach((fn) => fn(c)));
  r.onMessage("notice", (m: string) => room === r && toast({ title: m, duration: 3000 }));
  r.onMessage("kicked", (reason: string) => {
    if (room !== r) return;
    kicked = true;
    r.reconnection.enabled = false;
    attempt++;
    clearDropTimer();
    if (reason === "seat_expired") {
      if (target) dropSeat(target.code);
      fail("seat_expired", "Your seat in this room expired. Join again.");
    } else fail("kicked", reason);
  });
  // Brief drops are normal on phones: only say "Reconnecting" if it takes a moment.
  r.onDrop(() => {
    if (room !== r || kicked) return;
    if (!dropTimer) dropTimer = setTimeout(() => {
      dropTimer = null;
      if (room === r && !kicked) setAttachment({ status: "reconnecting" });
    }, 1500);
  });
  r.onReconnect(() => {
    if (room !== r || kicked) return;
    clearDropTimer();
    lastHeard = performance.now();
    setAttachment({ status: "attached" });
  });
  r.onLeave((code) => {
    if (room !== r) return;
    room = null;
    clearDropTimer();
    roomListeners.forEach((fn) => fn(null));
    // Consented leaves are ours (navigating away) or the server dismissing us. Anything else: get back in.
    if (!kicked && code !== 4000 && target && useGameStore.getState().attachment?.status !== "error") {
      setAttachment({ status: "reconnecting" });
      scheduleRetry(1500);
    }
  });
  startClockSync(r);
  setAttachment({ status: "attached", isHost, mode, error: undefined });
  scheduleView(r.state);
  roomListeners.forEach((fn) => fn(r));
}

let retries = 0;
function scheduleRetry(ms: number) {
  // Back off: 1.5 s, 2.5 s, … up to 15 s between tries.
  ms = Math.min(15000, ms * Math.pow(1.4, retries++));
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
      retries = 0;
      bind(r, mode, isHost);
      return;
    }

    const seat = seatFor(code);
    if (!seat) return fail("no_seat", "You haven't joined this room yet.");
    const r = await client.joinById<GameState>(code, { role: "player", seatToken: seat.token } satisfies JoinOptions);
    if (stale()) return void r.leave();
    retries = 0;
    useGameStore.setState({ playerId: seat.playerId });
    bind(r, mode, false);
    const me = await whoami<{ seatToken: string; playerId: string; name: string }>(r, "seat");
    saveSeat(code, { token: me.seatToken, name: me.name, playerId: me.playerId });
    useGameStore.setState({ playerId: me.playerId });
  } catch (e: any) {
    if (stale()) return;
    let reason = codeReason(e?.code);
    if (reason === "not_found" && !(await confirmGone(code))) reason = "network";
    if (stale()) return;
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

/** Really let go of the current room, even mid-reconnect (otherwise it lingers and interferes). */
async function leaveCurrent() {
  const r = room;
  room = null;
  clearDropTimer();
  if (!r) return;
  roomListeners.forEach((fn) => fn(null));
  r.reconnection.enabled = false;
  try {
    if (r.connection?.isOpen) await r.leave(true);
    else r.connection?.close(4000);
  } catch {
    /* already gone */
  }
  r.removeAllListeners();
}

// Hosts like Render's free tier sleep after ~15 min without HTTP requests, and WebSocket
// traffic may not count. While a room is open, touch the API now and then to stay awake.
if (typeof window !== "undefined") {
  setInterval(() => {
    if (target) fetch(`/api/rooms/${target.code}`, { cache: "no-store" }).catch(() => {});
  }, 4 * 60_000);
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
  retries = 0;
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
  retries = 0;
  setAttachment({ status: "connecting", error: undefined }, true);
  void join(target.mode, target.code);
}

// ------------------------------------------------------------------ actions

export async function createRoom(): Promise<{ code: string } | { error: string }> {
  try {
    await leaveCurrent();
    const r = await client.create<GameState>(ROOM_NAME, { role: "tv" } satisfies JoinOptions);
    let token: string;
    try {
      ({ hostToken: token } = await whoami<{ hostToken: string }>(r, "host"));
    } catch (e) {
      r.reconnection.enabled = false;
      void r.leave(true).catch(() => {});
      throw e;
    }
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
export async function joinRoom(code: string, name: string, face: number, cancelled: () => boolean = () => false): Promise<JoinOutcome> {
  try {
    await leaveCurrent();
    const r = await client.joinById<GameState>(code, { role: "player", name, face } satisfies JoinOptions);
    if (cancelled()) {
      // Left the Join page meanwhile: give the brand-new seat back.
      r.send("leaveSeat");
      void r.leave(true).catch(() => {});
      return { ok: false, reason: "cancelled", error: "" };
    }
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

/** The room no longer has our seat (dropped while we were away): say so instead of idling seatless. */
export function seatGone() {
  if (!target) return;
  dropSeat(target.code);
  attempt++;
  fail("seat_expired", "Your seat in this room expired. Join again.");
}

/** Give up the seat for good. */
export function leaveSeat() {
  const code = target?.code;
  room?.send("leaveSeat");
  if (code) dropSeat(code);
  detach();
}

/** `exists: undefined` = couldn't tell (offline, server waking up). Only `false` means gone. */
export async function roomStatus(code: string): Promise<RoomStatus> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return { exists: undefined };
    return (await res.json()) as RoomStatus;
  } catch {
    return { exists: undefined };
  }
}

export const send = {
  start: () => room?.send("start"),
  toLobby: () => room?.send("toLobby"),
  addBot: () => room?.send("addBot"),
  removeBot: () => room?.send("removeBot"),
  setFace: (face: number) => room?.send("setFace", { face }),
  action: (slot: "a" | "b" | "item" | "act") => room?.send("action", { slot }),
  // Moves only matter live; queued ones would just be replayed stale after a reconnect.
  move: (m: { x: number; y: number; vx: number; vy: number; a: number }) => room?.connection?.isOpen && room.send("move", m),
};
