// What this browser remembers about rooms.
//
// - Host tokens: per browser (localStorage), so the TV can be reopened from any tab.
// - Seats: per tab first (sessionStorage) so two tabs can be two different players,
//   with a per-browser fallback (localStorage) so closing and reopening the phone's
//   browser still lets you rejoin.
// - Recent rooms: shown on the home screen as "rejoin" shortcuts.

export interface Seat {
  token: string;
  name: string;
  playerId: string;
}

export interface RecentRoom {
  code: string;
  role: "host" | "player";
  name?: string;
  at: number;
}

const K = {
  hosts: "mon.hosts",
  seats: "mon.seats",
  recent: "mon.recent",
  name: "mon.name",
};

const RECENT_TTL = 1000 * 60 * 60 * 12;

function read<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(store: Storage | undefined, key: string, value: unknown) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled (private mode): reconnects just won't survive a reload.
  }
}

const local = typeof window !== "undefined" ? window.localStorage : undefined;
const session = typeof window !== "undefined" ? window.sessionStorage : undefined;

// ---- host tokens

export function hostToken(code: string): string | null {
  return read<Record<string, string>>(local, K.hosts, {})[code] ?? null;
}

export function saveHost(code: string, token: string) {
  write(local, K.hosts, { ...read<Record<string, string>>(local, K.hosts, {}), [code]: token });
  touchRecent({ code, role: "host" });
}

export function dropHost(code: string) {
  const hosts = read<Record<string, string>>(local, K.hosts, {});
  delete hosts[code];
  write(local, K.hosts, hosts);
}

// ---- seats

export function seatFor(code: string): Seat | null {
  return read<Record<string, Seat>>(session, K.seats, {})[code] ?? read<Record<string, Seat>>(local, K.seats, {})[code] ?? null;
}

export function saveSeat(code: string, seat: Seat) {
  for (const store of [session, local]) {
    write(store, K.seats, { ...read<Record<string, Seat>>(store, K.seats, {}), [code]: seat });
  }
  saveName(seat.name);
  touchRecent({ code, role: "player", name: seat.name });
}

export function dropSeat(code: string) {
  for (const store of [session, local]) {
    const seats = read<Record<string, Seat>>(store, K.seats, {});
    delete seats[code];
    write(store, K.seats, seats);
  }
}

// ---- name

export function savedName(): string {
  return read<string>(local, K.name, "");
}

export function saveName(name: string) {
  write(local, K.name, name);
}

// ---- recent rooms

export function recentRooms(): RecentRoom[] {
  const now = Date.now();
  return read<RecentRoom[]>(local, K.recent, [])
    .filter((r) => now - r.at < RECENT_TTL)
    .filter((r) => (r.role === "host" ? !!hostToken(r.code) : !!seatFor(r.code)))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
}

function touchRecent(entry: Omit<RecentRoom, "at">) {
  const list = read<RecentRoom[]>(local, K.recent, []).filter((r) => !(r.code === entry.code && r.role === entry.role));
  write(local, K.recent, [{ ...entry, at: Date.now() }, ...list].slice(0, 10));
}

export function forgetRoom(code: string) {
  dropHost(code);
  dropSeat(code);
  write(
    local,
    K.recent,
    read<RecentRoom[]>(local, K.recent, []).filter((r) => r.code !== code),
  );
}
