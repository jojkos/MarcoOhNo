import type { FxEvent, InputMsg, RoomInfo, Snapshot } from "@shared/protocol";
import { socket } from "./socket";
import { useGameStore, type ClientKind } from "./gameStore";
import { toast } from "@/hooks/use-toast";

// ------------------------------------------------------------------ session

interface Session {
  kind: ClientKind;
  code: string;
  /** Host token for the TV, seat token for phones. */
  token: string;
  name?: string;
}

const SESSION_KEY = "marco-oh-no.session";

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode etc. Reconnect just won't survive a reload.
  }
}

export function lastName(): string {
  return loadSession()?.name ?? "";
}

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

// ------------------------------------------------------------------ wiring

let wired = false;

export function initNet() {
  if (wired) return;
  wired = true;

  socket.on("connect", () => {
    useGameStore.setState({ connected: true });
    resume();
  });
  socket.on("disconnect", () => useGameStore.setState({ connected: false }));

  socket.on("room", (room: RoomInfo) => {
    const prev = useGameStore.getState().room;
    if (prev?.round?.id !== room.round?.id) {
      snapBuffer.length = 0;
      useGameStore.setState({ room, hud: null });
    } else {
      useGameStore.setState({ room });
    }
  });

  socket.on("snap", (snap) => {
    snapBuffer.push({ at: performance.now(), snap });
    if (snapBuffer.length > 60) snapBuffer.splice(0, snapBuffer.length - 60);
    snapListeners.forEach((fn) => fn(snap));
    updateHud(snap, snap.phase === "round_over");
  });

  socket.on("fx", (events) => fxListeners.forEach((fn) => fn(events)));

  socket.on("notice", (message) => toast({ title: message, duration: 3000 }));

  if (loadSession()) useGameStore.setState({ resuming: true });
  socket.connect();
}

/** Reattach to a saved session (after reload, or after the socket reconnects). */
function resume() {
  const s = loadSession();
  if (!s) {
    useGameStore.setState({ resuming: false });
    return;
  }
  useGameStore.setState({ resuming: true });
  if (s.kind === "tv") {
    socket.emit("host", { code: s.code, hostToken: s.token }, (res) => {
      useGameStore.setState({ resuming: false });
      if (!res.ok) return forget();
      saveSession({ kind: "tv", code: res.code, token: res.hostToken });
      useGameStore.setState({ kind: "tv", playerId: null });
    });
  } else {
    socket.emit("join", { code: s.code, token: s.token }, (res) => {
      useGameStore.setState({ resuming: false });
      if (!res.ok) {
        toast({ title: res.error, duration: 3000 });
        // Land on the join form with the room code filled in.
        window.history.replaceState(null, "", `/?room=${s.code}`);
        return forget(true);
      }
      useGameStore.setState({ kind: "mobile", playerId: res.playerId });
    });
  }
}

function forget(keepName = false) {
  const name = loadSession()?.name;
  saveSession(null);
  if (keepName && name) {
    try {
      localStorage.setItem(SESSION_KEY + ".name", name);
    } catch {
      /* ignore */
    }
  }
  useGameStore.setState({ kind: null, playerId: null, room: null, hud: null, resuming: false });
}

// ------------------------------------------------------------------ actions

export function hostGame(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit("host", {}, (res) => {
      if (!res.ok) return resolve(res.error);
      saveSession({ kind: "tv", code: res.code, token: res.hostToken });
      useGameStore.setState({ kind: "tv", playerId: null });
      resolve(null);
    });
  });
}

export function joinGame(code: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit("join", { code, name }, (res) => {
      if (!res.ok) return resolve(res.error);
      saveSession({ kind: "mobile", code: res.code, token: res.token, name });
      useGameStore.setState({ kind: "mobile", playerId: res.playerId });
      resolve(null);
    });
  });
}

export function leaveGame() {
  socket.emit("leave");
  forget(true);
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

export function rememberedName(): string {
  try {
    return localStorage.getItem(SESSION_KEY + ".name") ?? lastName();
  } catch {
    return "";
  }
}
