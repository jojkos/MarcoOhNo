// End-to-end over real WebSockets: the actual server + the actual Colyseus SDK.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { createApp } from "../server/app";
import { JoinError, ROOM_NAME } from "@shared/protocol";
import type { GameState } from "@shared/schema";

const PORT = 5700 + Math.floor(Math.random() * 200);
const URL = `http://127.0.0.1:${PORT}`;
let server: ReturnType<typeof createApp>;

beforeAll(async () => {
  server = createApp({ gracefulShutdown: false });
  await server.listen(PORT, "127.0.0.1");
});
afterAll(async () => {
  await server.close();
});

async function until(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function whoami<T>(room: Room<any>, type: string): Promise<T> {
  return new Promise((resolve) => {
    room.onMessage(type, resolve);
    room.send("whoami");
  });
}

async function hostRoom() {
  const tv = await new Client(URL).create<GameState>(ROOM_NAME, { role: "tv" });
  const { hostToken } = await whoami<{ hostToken: string }>(tv, "host");
  return { tv, hostToken, code: tv.roomId };
}

async function joinPlayer(code: string, opts: Record<string, unknown>) {
  const room = await new Client(URL).joinById<GameState>(code, { role: "player", ...opts });
  const seat = await whoami<{ seatToken: string; playerId: string; name: string }>(room, "seat");
  return { room, seat };
}

describe("rooms over the network", () => {
  it("TV creates a room with a 4-letter code; the status API sees it", async () => {
    const { tv, code } = await hostRoom();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    const status = await (await fetch(`${URL}/api/rooms/${code}`)).json();
    expect(status).toMatchObject({ exists: true, phase: "lobby", joinable: true });
    expect(await (await fetch(`${URL}/api/rooms/ZZZZ`)).json()).toEqual({ exists: false });
    await tv.leave();
  });

  it("players join by code and appear in the synced state", async () => {
    const { tv, code } = await hostRoom();
    const { room, seat } = await joinPlayer(code, { name: "Alice" });
    await until(() => tv.state.players?.size === 1);
    expect(tv.state.players.get(seat.playerId)?.name).toBe("Alice");
    await room.leave();
    await tv.leave();
  });

  it("rejects unknown rooms, duplicate names and bad host tokens with clear codes", async () => {
    const { tv, code } = await hostRoom();
    await expect(new Client(URL).joinById("ZZZZ", { role: "player", name: "X" })).rejects.toMatchObject({ code: 522 });
    const a = await joinPlayer(code, { name: "Bob" });
    await expect(new Client(URL).joinById(code, { role: "player", name: "bob" })).rejects.toMatchObject({ code: JoinError.NAME_TAKEN });
    await expect(new Client(URL).joinById(code, { role: "tv" })).rejects.toMatchObject({ code: JoinError.BAD_TOKEN });
    await expect(new Client(URL).joinById(code, { role: "tv", hostToken: "nope" })).rejects.toMatchObject({ code: JoinError.BAD_TOKEN });
    await a.room.leave();
    await tv.leave();
  });

  it("a player who leaves keeps their seat and comes back with the token", async () => {
    const { tv, code } = await hostRoom();
    const first = await joinPlayer(code, { name: "Cleo" });
    await first.room.leave(); // e.g. navigated away / reloaded
    await until(() => tv.state.players.get(first.seat.playerId)?.connected === false);
    const again = await joinPlayer(code, { seatToken: first.seat.seatToken });
    expect(again.seat.playerId).toBe(first.seat.playerId);
    await until(() => tv.state.players.get(first.seat.playerId)?.connected === true);
    expect(tv.state.players.size).toBe(1);
    // Lost the token? Joining with the same name reclaims the offline seat.
    await again.room.leave();
    await until(() => tv.state.players.get(first.seat.playerId)?.connected === false);
    const byName = await joinPlayer(code, { name: "cleo" });
    expect(byName.seat.playerId).toBe(first.seat.playerId);
    await byName.room.leave();
    await tv.leave();
  });

  it("opening the same seat elsewhere moves it there and tells the old tab", async () => {
    const { tv, code } = await hostRoom();
    const a = await joinPlayer(code, { name: "Dan" });
    const kicked = new Promise<string>((resolve) => a.room.onMessage("kicked", resolve));
    // Closed for good (consented), so the old tab doesn't auto-reconnect and steal it back.
    const closed = new Promise<number>((resolve) => a.room.onLeave(resolve));
    const b = await joinPlayer(code, { seatToken: a.seat.seatToken });
    expect(await kicked).toMatch(/another tab/);
    expect(await closed).toBe(4000);
    expect(b.seat.playerId).toBe(a.seat.playerId);
    await b.room.leave();
    await tv.leave();
  });

  it("the TV can reopen its room with the host token; other screens watch", async () => {
    const { tv, code, hostToken } = await hostRoom();
    await tv.leave();
    const tv2 = await new Client(URL).joinById<GameState>(code, { role: "tv", hostToken });
    await whoami(tv2, "host");
    const watcher = await new Client(URL).joinById<GameState>(code, { role: "watch" });
    await whoami(watcher, "watching");
    await watcher.leave();
    await tv2.leave();
  });

  it("host starts a round with bots; phones' moves are validated and synced", async () => {
    const { tv, code } = await hostRoom();
    const { room, seat } = await joinPlayer(code, { name: "Eve" });
    tv.send("addBot");
    tv.send("addBot");
    await until(() => tv.state.players.size === 3);
    tv.send("start");
    await until(() => tv.state.phase === "reveal");
    await until(() => tv.state.phase === "scatter", 6000);
    const me = () => tv.state.players.get(seat.playerId)!;
    if (me().role === "runner") {
      const corrections: unknown[] = [];
      room.onMessage("correct", (c) => corrections.push(c));
      const x0 = me().x;
      const y0 = me().y;
      // A tiny legal step is accepted...
      room.send("move", { x: x0 + 3, y: y0, vx: 90, vy: 0, a: 0 });
      await until(() => Math.abs(me().x - (x0 + 3)) < 0.5);
      // ...a teleport is refused.
      room.send("move", { x: x0 + 600, y: y0, vx: 0, vy: 0, a: 0 });
      await until(() => corrections.length > 0);
      expect(Math.abs(me().x - (x0 + 3))).toBeLessThan(0.5);
    }
    await room.leave();
    await tv.leave();
  }, 15000);
});
