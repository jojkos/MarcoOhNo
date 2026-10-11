import { Room, ServerError, type Client } from "@colyseus/core";
import { PATCH_MS, RULES, TICK_RATE } from "@shared/config";
import { JoinError, type ActionSlot, type FxEvent, type JoinOptions, type MoveMsg } from "@shared/protocol";
import type { GameState } from "@shared/schema";
import { Game, newToken } from "../game/Game";
import { log } from "../log";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Live rooms by code, for the /api/rooms status endpoint. Single process. */
export const liveRooms = new Map<string, PartyRoom>();

function newCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!liveRooms.has(code)) return code;
  }
}

type Binding = { kind: "host" | "watch" } | { kind: "player"; playerId: string };

const SLOTS = new Set<ActionSlot>(["a", "b", "item", "act"]);

/**
 * One party: a TV (host), optional extra screens, and up to 8 players/bots.
 *
 * Seats outlive connections. A dropped phone gets a short automatic reconnect
 * window (Colyseus); after that the seat stays and can be reclaimed with its seat
 * token (reload, browser restart) or by joining with the same name.
 */
export class PartyRoom extends Room<{ state: GameState }> {
  game!: Game;
  private hostToken = newToken();
  private hostClaimed = false;
  private bindings = new Map<string, Binding>();
  /** playerId -> sessionId currently driving that seat. */
  private seatHolder = new Map<string, string>();
  private hostHolder: string | null = null;
  private idleMs = 0;

  maxClients = 24;
  autoDispose = false;

  onCreate() {
    const code = newCode();
    this.roomId = code;
    liveRooms.set(code, this);
    this.game = new Game(code, {
      fx: (events: FxEvent[]) => this.broadcast("fx", events),
      correct: (playerId, x, y) => this.clientFor(playerId)?.send("correct", { x, y }),
      now: () => Date.now(),
    });
    this.setState(this.game.state);
    this.setPatchRate(PATCH_MS);
    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_RATE);

    this.onMessage("move", (client, msg: MoveMsg) => {
      const b = this.bindings.get(client.sessionId);
      if (b?.kind === "player" && msg && typeof msg === "object") this.game.move(b.playerId, msg);
    });
    this.onMessage("action", (client, msg: { slot: ActionSlot }) => {
      const b = this.bindings.get(client.sessionId);
      if (b?.kind === "player" && SLOTS.has(msg?.slot)) this.game.action(b.playerId, msg.slot);
    });
    this.onMessage("start", (client) => {
      if (!this.canControl(client)) return client.send("notice", "Only the host can start");
      const err = this.game.start();
      if (err) client.send("notice", err);
    });
    this.onMessage("toLobby", (client) => this.canControl(client) && this.game.toLobby());
    this.onMessage("addBot", (client) => {
      if (this.canControl(client) && !this.game.addBot()) client.send("notice", "Can't add a bot right now");
    });
    this.onMessage("removeBot", (client) => this.canControl(client) && this.game.removeBot());
    this.onMessage("setFace", (client, msg: { face: number }) => {
      const b = this.bindings.get(client.sessionId);
      if (b?.kind === "player") this.game.setFace(b.playerId, Number(msg?.face));
    });
    this.onMessage("leaveSeat", (client) => {
      const b = this.bindings.get(client.sessionId);
      if (b?.kind !== "player") return;
      this.seatHolder.delete(b.playerId);
      this.bindings.set(client.sessionId, { kind: "watch" });
      this.game.leave(b.playerId);
    });
    // Sent by the client once its handlers are registered: tells it who it is in this room.
    this.onMessage("whoami", (client) => {
      const b = this.bindings.get(client.sessionId);
      if (b?.kind === "host") client.send("host", { hostToken: this.hostToken });
      else if (b?.kind === "player") {
        const p = this.game.player(b.playerId);
        if (p) client.send("seat", { seatToken: this.game.tokenOf(p.id), playerId: p.id, name: p.name });
      } else client.send("watching", {});
    });
    this.onMessage("ping", (client, msg: { t: number }) => client.send("pong", { t: msg?.t ?? 0, server: Date.now() }));
    log(`room ${code} created`, "game");
  }

  /** Validate the join before a seat is taken. Errors reach the client as ServerError codes. */
  onAuth(_client: Client, options: JoinOptions) {
    const role = options?.role;
    if (role === "tv") {
      if (options.hostToken ? options.hostToken !== this.hostToken : this.hostClaimed) {
        throw new ServerError(JoinError.BAD_TOKEN, "This screen isn't the host of this room");
      }
      return true;
    }
    if (role === "watch") return true;
    if (role !== "player") throw new ServerError(JoinError.BAD_NAME, "Unknown role");

    if (options.seatToken) {
      if (this.game.seatByToken(options.seatToken)) return true;
      if (!options.name) throw new ServerError(JoinError.SEAT_EXPIRED, "Your seat in this room expired. Join again.");
    }
    const name = String(options.name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12);
    if (!name) throw new ServerError(JoinError.BAD_NAME, "Enter a name");
    if (this.game.reclaimable(name)) return true;
    const err = this.game.joinError(name);
    if (err === "in_progress") throw new ServerError(JoinError.IN_PROGRESS, "A round is in progress. You can join when it ends.");
    if (err === "full") throw new ServerError(JoinError.FULL, "This room is full");
    if (err === "name_taken") throw new ServerError(JoinError.NAME_TAKEN, "Someone in this room already has that name");
    return true;
  }

  onJoin(client: Client, options: JoinOptions) {
    this.idleMs = 0;
    if (options.role === "tv") {
      this.hostClaimed = true;
      this.evict(this.hostHolder, client, "This room was opened as TV on another screen");
      this.hostHolder = client.sessionId;
      this.bindings.set(client.sessionId, { kind: "host" });
      this.state.hostConnected = true;
      return;
    }
    if (options.role === "watch") {
      this.bindings.set(client.sessionId, { kind: "watch" });
      return;
    }

    const name = String(options.name ?? "").replace(/\s+/g, " ").trim().slice(0, 12);
    let seat = options.seatToken ? this.game.seatByToken(options.seatToken) : undefined;
    seat ??= name ? this.game.reclaimable(name) : undefined;
    if (!seat) {
      seat = this.game.addPlayer(name, typeof options.face === "number" ? options.face : -1);
      log(`${name} joined ${this.roomId}`, "game");
    }
    this.evict(this.seatHolder.get(seat.id) ?? null, client, "You opened this seat in another tab or device");
    this.seatHolder.set(seat.id, client.sessionId);
    this.bindings.set(client.sessionId, { kind: "player", playerId: seat.id });
    this.game.setConnected(seat.id, true);
  }

  /** Connection lost without saying goodbye: keep the seat, allow a quick reconnect. */
  async onDrop(client: Client) {
    this.markOffline(client);
    try {
      await this.allowReconnection(client, RULES.reconnectWindowSec);
    } catch {
      // Window passed: the seat stays (offline) and can be reclaimed with its token.
    }
  }

  onReconnect(client: Client) {
    const b = this.bindings.get(client.sessionId);
    if (b?.kind === "player" && this.seatHolder.get(b.playerId) === client.sessionId) this.game.setConnected(b.playerId, true);
    if (b?.kind === "host" && this.hostHolder === client.sessionId) this.state.hostConnected = true;
  }

  /** Left on purpose (navigated away) or the reconnect window expired. */
  onLeave(client: Client) {
    this.markOffline(client);
    this.bindings.delete(client.sessionId);
  }

  onDispose() {
    liveRooms.delete(this.roomId);
    log(`room ${this.roomId} closed`, "game");
  }

  private markOffline(client: Client) {
    const b = this.bindings.get(client.sessionId);
    if (b?.kind === "player" && this.seatHolder.get(b.playerId) === client.sessionId) {
      this.game.setConnected(b.playerId, false);
    }
    if (b?.kind === "host" && this.hostHolder === client.sessionId) this.state.hostConnected = false;
  }

  private evict(sessionId: string | null, by: Client, reason: string) {
    if (!sessionId || sessionId === by.sessionId) return;
    const old = this.clients.find((c) => c.sessionId === sessionId);
    this.bindings.set(sessionId, { kind: "watch" });
    if (old) {
      old.send("kicked", reason);
      old.leave();
    }
  }

  private clientFor(playerId: string): Client | undefined {
    const sid = this.seatHolder.get(playerId);
    return sid ? this.clients.find((c) => c.sessionId === sid) : undefined;
  }

  private canControl(client: Client) {
    const b = this.bindings.get(client.sessionId);
    if (b?.kind === "host") return true;
    return b?.kind === "player" && b.playerId === this.state.vipId;
  }

  private tick(dtMs: number) {
    this.game.tick(Math.min(100, dtMs));
    // Close rooms nobody has touched in a while.
    const humansOnline = this.clients.length > 0;
    this.idleMs = humansOnline ? 0 : this.idleMs + dtMs;
    if (this.idleMs > RULES.roomIdleMs) this.disconnect();
  }
}
