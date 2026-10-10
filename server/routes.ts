import type { Express } from "express";
import type { Server } from "http";
import { networkInterfaces } from "os";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { log } from "./index";
import { Room } from "./game/room";
import { TICK_RATE, RULES } from "@shared/config";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/protocol";

interface SocketData {
  code: string | null;
  playerId: string | null;
  isHost: boolean;
}

type IO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // LAN addresses, so a TV opened on localhost can still show phones a reachable join link.
  app.get("/api/lan", (_req, res) => {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal)
      .map((n) => n!.address);
    res.json({ ips, port: Number(process.env.PORT || 5000) });
  });

  const io: IO = new SocketIOServer(httpServer, { cors: { origin: "*" } });
  const rooms = new Map<string, Room>();
  // Which socket currently owns a seat / the TV, so a stale socket's disconnect is ignored.
  const seatSockets = new Map<string, string>();
  const hostSockets = new Map<string, string>();

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

  function canControl(socket: GameSocket, room: Room) {
    return socket.data.isHost || (socket.data.playerId !== null && socket.data.playerId === room.vipId);
  }

  io.on("connection", (socket: GameSocket) => {
    socket.data = { code: null, playerId: null, isHost: false };

    socket.on("host", (req, cb) => {
      if (typeof cb !== "function") return;
      detach(socket);
      let room = req?.code ? rooms.get(String(req.code).toUpperCase()) : undefined;
      if (room && room.hostToken !== req.hostToken) room = undefined;
      if (!room) room = createRoom();

      const previous = hostSockets.get(room.code);
      if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.emit("notice", "TV opened elsewhere");
      hostSockets.set(room.code, socket.id);
      room.hostConnected = true;
      socket.data = { code: room.code, playerId: null, isHost: true };
      socket.join(room.code);
      cb({ ok: true, code: room.code, hostToken: room.hostToken });
      socket.emit("room", room.info());
    });

    socket.on("join", (req, cb) => {
      if (typeof cb !== "function") return;
      const code = String(req?.code ?? "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: "Room not found" });

      let seat = req.token ? room.playerByToken(String(req.token)) : undefined;
      if (!seat) {
        if (req.token && !req.name) return cb({ ok: false, error: "Your seat expired. Join again." });
        const name = String(req.name ?? "").trim().slice(0, 12);
        if (!name) return cb({ ok: false, error: "Enter a name" });
        const err = room.canJoin(name);
        if (err) return cb({ ok: false, error: err });
        seat = room.addPlayer(name);
        log(`${name} joined ${code}`, "game");
      }

      detach(socket);
      const previous = seatSockets.get(seat.id);
      if (previous && previous !== socket.id) {
        const old = io.sockets.sockets.get(previous);
        if (old) {
          old.emit("notice", "You joined from another tab or device");
          old.leave(code);
          old.data = { code: null, playerId: null, isHost: false };
        }
      }
      seatSockets.set(seat.id, socket.id);
      socket.data = { code, playerId: seat.id, isHost: false };
      socket.join(code);
      room.setConnected(seat.id, true);
      cb({ ok: true, playerId: seat.id, token: seat.token, code });
    });

    socket.on("leave", () => {
      const { code, playerId } = socket.data;
      const room = code ? rooms.get(code) : undefined;
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
      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      if (!room) return;
      if (!canControl(socket, room)) return void socket.emit("notice", "Only the host can start");
      const err = room.start();
      if (err) socket.emit("notice", err);
    });

    socket.on("toLobby", () => {
      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      if (room && canControl(socket, room)) room.toLobby();
    });

    socket.on("input", (inputs) => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      rooms.get(code)?.queueInputs(playerId, inputs);
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
