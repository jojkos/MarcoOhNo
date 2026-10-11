import type { FxEvent, InputMsg, JoinResult, RoomInfo, RoomStatus, Snapshot } from "@shared/protocol";
import { socket } from "./socket";
import { useGameStore, type AttachMode } from "./gameStore";
import { dropHost, dropSeat, hostToken, saveHost, saveSeat, seatFor } from "./storage";
import { toast } from "@/hooks/use-toast";

// ------------------------------------------------------------------ snapshots

export interface TimedSnap {
  at: number; // performance.now() when received
  snap: Snapshot;
}

/** Recent snapshots for interpolating remote players. */
export const snapBuffer: TimedSnap[] = [];
const snapListeners = new Set<(s: Snapshot) => void>();
const fxListeners = new Set<(e: FxEvent[]) => void>();

export function onSnapshot(fn: (s: Snapshot) => void) {
  snapListeners.add(fn);
  return () => void snapListeners.delete(fn);
}

export function onFx(fn: (e: FxEvent[]) => void) {
  fxListeners.add(fn);
  return () => void fxListeners.delete(fn);
}

export function latestSnap(): Snapshot | null {
  return snapBuffer.length ? snapBuffer[snapBuffer.length - 1].snap : null;
}

let lastHud = 0;
function updateHud(snap: Snapshot, force = false) {
  const now = performance.now();
  if (!force && now - lastHud < 100) return;
  lastHud = now;
  const { playerId } = useGameStore.getState();
  const me = snap.players.find((p) => p.id === playerId) ?? null;
  const seeker = snap.players.find((p) => p.role === "seeker");
  let threat = 0;
  if (me && seeker && me.role === "runner" && me.status === "free" && snap.phase === "hunt") {
    const d = Math.hypot(me.x - seeker.x, me.y - seeker.y);
    threat = Math.max(0, Math.min(1, 1 - (d - 120) / 420));
  }
  useGameStore.setState({
    hud: {
      phase: snap.phase,
      phaseLeft: snap.phaseLeft,
      collected: snap.collected,
      players: snap.players,
      me,
      danger: snap.players.some((p) => p.exposure > 0.35),
      threat,
    },
  });
}

// ------------------------------------------------------------------ attachment

/** The room this tab wants to follow. The URL decides it; reconnects re-apply it. */
let target: { mode: AttachMode; code: string } | null = null;
let attempt = 0;

function setAttachment(patch: Partial<NonNullable<ReturnType<typeof useGameStore.getState>["attachment"]>>) {
  const cur = useGameStore.getState().attachment;
  if (!cur) return;
  useGameStore.setState({ attachment: { ...cur, ...patch } });
}

function fail(reason: string, message: string) {
  setAttachment({ status: "error", error: { reason, message } });
}

function resetRoomState() {
  snapBuffer.length = 0;
  useGameStore.setState({ room: null, hud: null, playerId: null });
}

/** Follow a room as the TV (host token if we have one, otherwise as a watcher). */
export function attachTv(code: string) {
  attachTo("tv", code);
}

/** Follow a room as a player using the seat saved for it. */
export function attachPlay(code: string) {
  attachTo("play", code);
}

function attachTo(mode: AttachMode, code: string) {
  if (target?.mode === mode && target.code === code && useGameStore.getState().attachment?.status !== "error") return;
  target = { mode, code };
  resetRoomState();
  useGameStore.setState({ attachment: { mode, code, status: "connecting", isHost: false } });
  if (!socket.connected) socket.connect();
  else apply();
}

/** Stop following (navigated away). Seats are kept so you can come back. */
export function detach() {
  if (!target) return;
  target = null;
  attempt++;
  if (socket.connected) socket.emit("detach");
  resetRoomState();
  useGameStore.setState({ attachment: null });
}

function apply() {
  const t = target;
  if (!t) return;
  const id = ++attempt;
  const stale = () => id !== attempt || target !== t;

  if (t.mode === "tv") {
    const token = hostToken(t.code);
    const watch = () =>
      socket.emit("watchRoom", { code: t.code }, (res) => {
        if (stale()) return;
        if (!res.ok) return fail(res.reason, res.error);
        setAttachment({ status: "attached", isHost: false, error: undefined });
      });
    if (!token) return watch();
    socket.emit("hostRoom", { code: t.code, hostToken: token }, (res) => {
      if (stale()) return;
      if (res.ok) return setAttachment({ status: "attached", isHost: true, error: undefined });
      if (res.reason === "bad_token") {
        dropHost(t.code);
        return watch();
      }
      // Room gone: keep the token so a reload still explains what happened; Home prunes dead rooms.
      fail(res.reason, res.error);
    });
    return;
  }

  const seat = seatFor(t.code);
  if (!seat) return fail("no_seat", "You haven't joined this room yet.");
  socket.emit("join", { code: t.code, token: seat.token }, (res) => {
    if (stale()) return;
    if (!res.ok) {
      // An expired seat is useless; for an ended room keep it so a reload still says "room ended".
      if (res.reason === "seat_expired") dropSeat(t.code);
      return fail(res.reason, res.error);
    }
    useGameStore.setState({ playerId: res.playerId });
    setAttachment({ status: "attached", error: undefined });
  });
}

// ------------------------------------------------------------------ wiring

let wired = false;

export function initNet() {
  if (wired) return;
  wired = true;

  socket.on("connect", () => {
    useGameStore.setState({ connected: true });
    apply();
  });
  socket.on("disconnect", () => useGameStore.setState({ connected: false }));

  socket.on("room", (room: RoomInfo) => {
    if (!target || room.code !== target.code) return; // late message from a room we left
    const prev = useGameStore.getState().room;
    if (prev?.round?.id !== room.round?.id) {
      snapBuffer.length = 0;
      useGameStore.setState({ room, hud: null });
    } else {
      useGameStore.setState({ room });
    }
  });

  socket.on("snap", (snap) => {
    if (!target) return;
    snapBuffer.push({ at: performance.now(), snap });
    if (snapBuffer.length > 60) snapBuffer.splice(0, snapBuffer.length - 60);
    snapListeners.forEach((fn) => fn(snap));
    updateHud(snap, snap.phase === "round_over");
  });

  socket.on("fx", (events) => {
    if (target) fxListeners.forEach((fn) => fn(events));
  });

  socket.on("notice", (message) => toast({ title: message, duration: 3000 }));

  socket.on("kicked", (reason) => {
    attempt++;
    fail("kicked", reason);
  });

  socket.connect();
}

/** Try the current target again (e.g. after "took over in another tab"). */
export function retryAttach() {
  if (!target) return;
  setAttachment({ status: "connecting", error: undefined });
  if (socket.connected) apply();
  else socket.connect();
}

// ------------------------------------------------------------------ actions

export function createRoom(): Promise<{ code: string } | { error: string }> {
  return new Promise((resolve) => {
    const send = () =>
      socket.emit("createRoom", (res) => {
        if (!res.ok) return resolve({ error: res.error });
        saveHost(res.code, res.hostToken);
        // We're already attached on the server; mark it so the TV route doesn't re-host.
        target = { mode: "tv", code: res.code };
        attempt++;
        resetRoomState();
        useGameStore.setState({ attachment: { mode: "tv", code: res.code, status: "attached", isHost: true } });
        resolve({ code: res.code });
      });
    if (socket.connected) send();
    else {
      socket.once("connect", send);
      socket.connect();
    }
  });
}

/** Join a room with a new (or reclaimed) seat and remember it for this tab. */
export function joinRoom(code: string, name: string): Promise<JoinResult> {
  return new Promise((resolve) => {
    const send = () =>
      socket.emit("join", { code, name }, (res) => {
        if (res.ok) {
          saveSeat(res.code, { token: res.token, name: res.name, playerId: res.playerId });
          target = { mode: "play", code: res.code };
          attempt++;
          resetRoomState();
          useGameStore.setState({
            playerId: res.playerId,
            attachment: { mode: "play", code: res.code, status: "attached", isHost: false },
          });
        }
        resolve(res);
      });
    if (socket.connected) send();
    else {
      socket.once("connect", send);
      socket.connect();
    }
  });
}

/** Give up the seat for good. */
export function leaveSeat() {
  const code = target?.code;
  socket.emit("leave");
  if (code) dropSeat(code);
  target = null;
  attempt++;
  resetRoomState();
  useGameStore.setState({ attachment: null });
}

export async function roomStatus(code: string): Promise<RoomStatus> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    return (await res.json()) as RoomStatus;
  } catch {
    return { exists: false };
  }
}

export function startRound() {
  socket.emit("start");
}

export function backToLobby() {
  socket.emit("toLobby");
}

export function sendInputs(inputs: InputMsg[]) {
  if (inputs.length && socket.connected) socket.emit("input", inputs);
}
