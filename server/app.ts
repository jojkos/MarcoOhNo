import express from "express";
import { createServer } from "http";
import { networkInterfaces } from "os";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, type RoomStatus } from "@shared/protocol";
import { PartyRoom, liveRooms } from "./rooms/PartyRoom";

export const HMR_PATH = "/vite-hmr";

export interface AppOptions {
  /** Called before listen() so SPA routes come after the API routes. */
  mountClient?: (app: express.Express, server: ReturnType<typeof createServer>) => Promise<void> | void;
  gracefulShutdown?: boolean;
}

/** HTTP API + Colyseus on one server. */
export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");

  // LAN addresses, so a TV opened on localhost can still show phones a reachable join link.
  app.get("/api/lan", (_req, res) => {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal)
      .map((n) => n!.address);
    res.json({ ips, port: Number(process.env.PORT || 5000) });
  });

  app.get("/api/rooms/:code", (req, res) => {
    const room = liveRooms.get(String(req.params.code).toUpperCase().slice(0, 4));
    const status: RoomStatus = room
      ? { exists: true, phase: room.game.state.phase, players: room.game.playerCount(), joinable: room.game.joinable }
      : { exists: false };
    res.set("Cache-Control", "no-store").json(status);
  });

  const httpServer = createServer(app);
  // Colyseus shares the HTTP server; Vite's hot-reload socket keeps its own path.
  const transport = new WebSocketTransport({ noServer: true });
  transport.attachToServer(httpServer, { filter: (req) => !req.url?.startsWith(HMR_PATH) });
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: opts.gracefulShutdown ?? true });
  gameServer.define(ROOM_NAME, PartyRoom);

  return {
    app,
    httpServer,
    gameServer,
    async listen(port: number, host = "0.0.0.0") {
      // Routes must exist before listen(): Colyseus mounts its matchmaking routes in
      // front of this express app and falls back to it for everything else.
      await opts.mountClient?.(app, httpServer);
      await gameServer.listen(port, host);
    },
    async close() {
      await gameServer.gracefullyShutdown(false);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
