// Fill a room with bots so you can playtest alone:
//   npm run bots -- ABCD 3              (3 bots into room ABCD on localhost:5000)
//   npm run bots -- ABCD 3 http://192.168.1.20:5000
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, InputMsg, RoomInfo, RoundInfo, ServerToClientEvents, Snapshot, FxEvent } from "../shared/protocol";
import { cellCenter, cellOf } from "../shared/maze";
import { segmentBlocked, dist, type Vec } from "../shared/geometry";
import { TICK_RATE } from "../shared/config";

const [code, countArg = "3", url = "http://localhost:5000"] = process.argv.slice(2);
if (!code) {
  console.log("usage: npm run bots -- ROOMCODE [count] [serverUrl]");
  process.exit(1);
}

type Graph = Map<string, string[]>;
const key = (c: number, r: number) => `${c},${r}`;

function buildGraph(round: RoundInfo): Graph {
  const g: Graph = new Map();
  for (let r = 0; r < round.rows; r++) {
    for (let c = 0; c < round.cols; c++) {
      const out: string[] = [];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= round.cols || nr >= round.rows) continue;
        if (!segmentBlocked(cellCenter(c, r), cellCenter(nc, nr), round.walls)) out.push(key(nc, nr));
      }
      g.set(key(c, r), out);
    }
  }
  return g;
}

function bfs(g: Graph, from: string, to: string): string[] {
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const n of g.get(cur) ?? []) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        q.push(n);
      }
    }
  }
  if (!prev.has(to)) return [];
  const path: string[] = [];
  for (let c: string | null = to; c; c = prev.get(c) ?? null) path.unshift(c);
  return path;
}

const toPoint = (k: string) => {
  const [c, r] = k.split(",").map(Number);
  return cellCenter(c, r);
};

class Bot {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  id = "";
  room: RoomInfo | null = null;
  graph: Graph | null = null;
  graphRound = -1;
  snap: Snapshot | null = null;
  seq = 0;
  target: Vec | null = null;
  lastHeard: Vec | null = null;
  wanderGoal: string | null = null;

  constructor(private name: string) {
    this.socket = io(url, { transports: ["websocket"] });
    this.socket.on("connect", () => {
      this.socket.emit("join", { code: code.toUpperCase(), name }, (res) => {
        if (!res.ok) {
          console.log(`${name}: ${res.error}`);
          process.exit(1);
        }
        this.id = res.playerId;
        console.log(`${name} joined ${res.code}`);
      });
    });
    this.socket.on("room", (room) => (this.room = room));
    this.socket.on("snap", (snap) => (this.snap = snap));
    this.socket.on("fx", (events: FxEvent[]) => {
      for (const e of events) {
        if (e.k === "noise" || e.k === "orb") this.lastHeard = { x: e.x, y: e.y };
        if (e.k === "polo" && e.pings.length) this.lastHeard = e.pings[Math.floor(Math.random() * e.pings.length)];
      }
    });
    setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  tick() {
    const round = this.room?.round;
    const snap = this.snap;
    if (!round || !snap || !["reveal", "scatter", "hunt"].includes(snap.phase)) return;
    if (this.graphRound !== round.id) {
      this.graph = buildGraph(round);
      this.graphRound = round.id;
      this.lastHeard = null;
    }
    const me = snap.players.find((p) => p.id === this.id);
    if (!me) return;

    const msg: InputMsg = { seq: ++this.seq, mx: 0, my: 0 };
    let goal: Vec | null = null;
    const seeker = snap.players.find((p) => p.role === "seeker");

    if (me.role === "seeker") {
      const lit = snap.players.find((p) => p.role === "runner" && p.status === "free" && p.lit);
      if (lit) goal = lit;
      else if (this.lastHeard && dist(this.lastHeard, me) > 40) goal = this.lastHeard;
      else {
        this.lastHeard = null;
        goal = this.wander(round, me);
      }
      if (me.cdA === 0 && Math.random() < 0.01) msg.a = 1;
      if (lit && me.cdB === 0) msg.b = 1;
    } else if (me.status === "free") {
      const danger = seeker && dist(seeker, me) < 260 && !segmentBlocked(seeker, me, round.walls);
      if (danger && seeker) {
        // Run to the neighbouring cell that is furthest from the seeker.
        const here = cellOf(me.x, me.y, round.cols, round.rows);
        const options = this.graph!.get(key(here.col, here.row)) ?? [];
        const best = options.map(toPoint).sort((a, b) => dist(b, seeker) - dist(a, seeker))[0];
        goal = best ?? null;
        if (me.exposure > 0.3 && me.cdA === 0) msg.a = 1;
      } else if (snap.phase === "scatter" && seeker) {
        // Get away from the spawn: head for the orb furthest from the seeker.
        goal = [...snap.orbs].sort((a, b) => dist(b, seeker) - dist(a, seeker))[0] ?? this.wander(round, me);
      } else {
        const caged = snap.players.find((p) => p.role === "runner" && p.status === "caged");
        const orb = [...snap.orbs].sort((a, b) => dist(a, me) - dist(b, me))[0];
        goal = caged && (!orb || dist(caged, me) < dist(orb, me)) ? caged : orb ?? this.wander(round, me);
      }
    } else if (me.status === "ghost") {
      goal = this.wander(round, me);
      if (me.cdA === 0 && Math.random() < 0.02) msg.a = 1;
    }

    if (goal) {
      const step = me.status === "ghost" ? goal : this.nextWaypoint(round, me, goal);
      const dx = step.x - me.x;
      const dy = step.y - me.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        msg.mx = dx / len;
        msg.my = dy / len;
      }
    }
    this.socket.emit("input", [msg]);
  }

  wander(round: RoundInfo, me: Vec): Vec {
    const here = cellOf(me.x, me.y, round.cols, round.rows);
    if (!this.wanderGoal || this.wanderGoal === key(here.col, here.row)) {
      this.wanderGoal = key(Math.floor(Math.random() * round.cols), Math.floor(Math.random() * round.rows));
    }
    return toPoint(this.wanderGoal);
  }

  nextWaypoint(round: RoundInfo, me: Vec, goal: Vec): Vec {
    if (!segmentBlocked(me, goal, round.walls)) return goal;
    const a = cellOf(me.x, me.y, round.cols, round.rows);
    const b = cellOf(goal.x, goal.y, round.cols, round.rows);
    const path = bfs(this.graph!, key(a.col, a.row), key(b.col, b.row));
    if (path.length < 2) return toPoint(path[0] ?? key(a.col, a.row));
    // Head for the centre of the current cell first if we're off-axis, then the next one.
    const cur = toPoint(path[0]);
    const next = toPoint(path[1]);
    return segmentBlocked(me, next, round.walls) ? cur : next;
  }
}

const n = Math.max(1, Math.min(7, Number(countArg) || 3));
for (let i = 0; i < n; i++) new Bot(`Bot${i + 1}`);
