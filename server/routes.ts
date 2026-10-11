import type { Express } from "express";
import type { Server } from "http";
import { networkInterfaces } from "os";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { log } from "./index";
import { Room } from "./game/room";
import { TICK_RATE, RULES } from "@shared/config";
import type { ClientToServerEvents, RoomStatus, ServerToClientEvents } from "@shared/protocol";

interface SocketData {
  code: string | null;
  playerId: string | null;
  isHost: boolean;
}

type IO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const normCode = (c: unknown) =>
  String(c ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const io: IO = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    // Notice dead phones quickly so their seat shows as reconnecting.
    pingInterval: 10000,
    pingTimeout: 8000,
  });
  const rooms = new Map<string, Room>();
  // Which socket currently owns a seat / the TV, so a stale socket's disconnect is ignored.
  const seatSockets = new Map<string, string>();
  const hostSockets = new Map<string, string>();

  // LAN addresses, so a TV opened on localhost can still show phones a reachable join link.
  app.get("/api/lan", (_req, res) => {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal)
      .map((n) => n!.address);
    res.json({ ips, port: Number(process.env.PORT || 5000) });
  });

  app.get("/api/rooms/:code", (req, res) => {
    const room = rooms.get(normCode(req.params.code));
    const status: RoomStatus = room
      ? { exists: true, phase: room.phase, players: room.playerCount(), joinable: room.joinable }
      : { exists: false };
    res.set("Cache-Control", "no-store").json(status);
  });

  function newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function createRoom(): Room {
    const code = newCode();
    const room = new Room(code, {
      room: (info) => io.to(code).emit("room", info),
      snap: (snap) => io.to(code).volatile.emit("snap", snap),
      fx: (events) => io.to(code).emit("fx", events),
    });
    rooms.set(code, room);
    log(`room ${code} created`, "game");
    return room;
  }

  /** Stop following the current room. Seats and host status are kept (marked offline). */
  function detach(socket: GameSocket) {
    const { code, playerId, isHost } = socket.data;
    if (!code) return;
    const room = rooms.get(code);
    if (room && playerId && seatSockets.get(playerId) === socket.id) {
      seatSockets.delete(playerId);
      room.setConnected(playerId, false);
    }
    if (room && isHost && hostSockets.get(code) === socket.id) {
      hostSockets.delete(code);
      room.hostConnected = false;
    }
    socket.leave(code);
    socket.data = { code: null, playerId: null, isHost: false };
  }

  // Callers reply to the client first and only then send room state, so the client
  // already knows which room it is in when that state arrives.
  function attach(socket: GameSocket, room: Room, data: SocketData) {
    detach(socket);
    socket.data = data;
    socket.join(room.code);
  }

  /** Kick whichever other socket held this seat / TV. */
  function evict(map: Map<string, string>, key: string, socket: GameSocket, reason: string) {
    const previous = map.get(key);
    if (!previous || previous === socket.id) return;
    const old = io.sockets.sockets.get(previous);
    if (old) {
      old.emit("kicked", reason);
      if (old.data.code) old.leave(old.data.code);
      old.data = { code: null, playerId: null, isHost: false };
    }
  }

  function canControl(socket: GameSocket, room: Room) {
    return socket.data.isHost || (socket.data.playerId !== null && socket.data.playerId === room.vipId);
  }

  function roomOf(socket: GameSocket) {
    return socket.data.code ? rooms.get(socket.data.code) : undefined;
  }

  io.on("connection", (socket: GameSocket) => {
    socket.data = { code: null, playerId: null, isHost: false };

    socket.on("createRoom", (cb) => {
      if (typeof cb !== "function") return;
      const room = createRoom();
      hostSockets.set(room.code, socket.id);
      room.hostConnected = true;
      attach(socket, room, { code: room.code, playerId: null, isHost: true });
      cb({ ok: true, code: room.code, hostToken: room.hostToken });
      socket.emit("room", room.info());
    });

    socket.on("hostRoom", (req, cb) => {
      if (typeof cb !== "function") return;
      const code = normCode(req?.code);
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, reason: "not_found", error: `Room ${code} has ended` });
      if (room.hostToken !== req.hostToken) return cb({ ok: false, reason: "bad_token", error: "This screen isn't the host" });
      evict(hostSockets, code, socket, "This room was opened as TV on another screen");
      hostSockets.set(code, socket.id);
      room.hostConnected = true;
      attach(socket, room, { code, playerId: null, isHost: true });
      cb({ ok: true, code, hostToken: room.hostToken });
      socket.emit("room", room.info());
    });

    socket.on("watchRoom", (req, cb) => {
      if (typeof cb !== "function") return;
      const code = normCode(req?.code);
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, reason: "not_found", error: `Room ${code} has ended` });
      attach(socket, room, { code, playerId: null, isHost: false });
      cb({ ok: true, code });
      socket.emit("room", room.info());
    });

    socket.on("join", (req, cb) => {
      if (typeof cb !== "function") return;
      const code = normCode(req?.code);
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, reason: "not_found", error: `Room ${code} doesn't exist (anymore)` });

      let seat = req.token ? room.playerByToken(String(req.token)) : undefined;
      if (!seat && req.token && !req.name) {
        return cb({ ok: false, reason: "seat_expired", error: "Your seat in this room expired. Join again." });
      }
      if (!seat) {
        const name = String(req.name ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 12);
        if (!name) return cb({ ok: false, reason: "bad_name", error: "Enter a name" });
        seat = room.reclaimableSeat(name);
        if (!seat) {
          const err = room.canJoin(name);
          if (err) return cb({ ok: false, ...err });
          seat = room.addPlayer(name);
          log(`${name} joined ${code}`, "game");
        }
      }

      evict(seatSockets, seat.id, socket, "You opened this seat in another tab or device");
      seatSockets.set(seat.id, socket.id);
      attach(socket, room, { code, playerId: seat.id, isHost: false });
      cb({ ok: true, playerId: seat.id, token: seat.token, code, name: seat.name });
      room.setConnected(seat.id, true); // broadcasts the room state, including to this socket
    });

    socket.on("detach", () => detach(socket));

    socket.on("leave", () => {
      const room = roomOf(socket);
      const { playerId } = socket.data;
      if (room && playerId) {
        seatSockets.delete(playerId);
        room.leave(playerId);
        socket.leave(room.code);
        socket.data = { code: null, playerId: null, isHost: false };
        return;
      }
      detach(socket);
    });

    socket.on("start", () => {
      const room = roomOf(socket);
      if (!room) return;
      if (!canControl(socket, room)) return void socket.emit("notice", "Only the host can start");
      const err = room.start();
      if (err) socket.emit("notice", err);
    });

    socket.on("toLobby", () => {
      const room = roomOf(socket);
      if (room && canControl(socket, room)) room.toLobby();
    });

    socket.on("input", (inputs) => {
      const { playerId } = socket.data;
      if (playerId) roomOf(socket)?.queueInputs(playerId, inputs);
    });

    socket.on("disconnect", () => detach(socket));
  });

  // One fixed-rate loop drives every room.
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(100, now - last);
    last = now;
    for (const [code, room] of Array.from(rooms)) {
      room.tick(dt);
      if (room.idleMs > RULES.roomIdleMs) {
        rooms.delete(code);
        log(`room ${code} closed (idle)`, "game");
      }
    }
  }, 1000 / TICK_RATE);

  return httpServer;
}
