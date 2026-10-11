import { describe, expect, it } from "vitest";
import { Room } from "../server/game/room";
import type { FxEvent, RoomInfo, Snapshot } from "@shared/protocol";
import { RULES, TICK_RATE } from "@shared/config";
import { seeded } from "./util";

const DT = 1000 / TICK_RATE;

function setup(n: number, seed = 1) {
  const out = { rooms: [] as RoomInfo[], snaps: [] as Snapshot[], fx: [] as FxEvent[] };
  const room = new Room("TEST", {
    room: (r) => out.rooms.push(r),
    snap: (s) => out.snaps.push(s),
    fx: (e) => out.fx.push(...e),
  }, seeded(seed));
  const ids = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`).id);
  return { room, out, ids, last: () => out.rooms[out.rooms.length - 1] };
}

function ticks(room: Room, ms: number) {
  for (let t = 0; t < ms; t += DT) room.tick(DT);
}

/** Start a round and fast-forward to the hunt, on an empty map for easy positioning. */
function startHunt(n: number, seed = 1) {
  const ctx = setup(n, seed);
  expect(ctx.room.start()).toBeNull();
  const info = ctx.last();
  (ctx.room as any).round.walls = [];
  (ctx.room as any).orbs = [];
  ticks(ctx.room, RULES.revealMs + RULES.scatterMs + DT);
  expect(ctx.room.phase).toBe("hunt");
  const seekerId = info.round!.seekerId;
  const runnerIds = ctx.ids.filter((id) => id !== seekerId);
  const seeker = ctx.room._seat(seekerId)!;
  return { ...ctx, seeker, runners: runnerIds.map((id) => ctx.room._seat(id)!) };
}

function place(seat: any, x: number, y: number, angle = 0) {
  seat.mover.x = x;
  seat.mover.y = y;
  seat.mover.angle = angle;
  seat.idleAnchor = { x, y };
}

describe("room flow", () => {
  it("goes lobby -> reveal -> scatter -> hunt", () => {
    const { room } = setup(3);
    expect(room.start()).toBeNull();
    expect(room.phase).toBe("reveal");
    ticks(room, RULES.revealMs + DT);
    expect(room.phase).toBe("scatter");
    ticks(room, RULES.scatterMs + DT);
    expect(room.phase).toBe("hunt");
  });

  it("refuses to start alone", () => {
    const { room } = setup(1);
    expect(room.start()).toMatch(/at least/);
  });

  it("freezes the seeker during scatter but lets runners move", () => {
    const { room, last, ids } = setup(3);
    room.start();
    ticks(room, RULES.revealMs + DT);
    const seekerId = last().round!.seekerId;
    const runnerId = ids.find((id) => id !== seekerId)!;
    const s0 = { ...room._seat(seekerId)!.mover };
    const r0 = { ...room._seat(runnerId)!.mover };
    const inputs = Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, mx: 0, my: -1 }));
    room.queueInputs(seekerId, inputs);
    room.queueInputs(runnerId, inputs);
    ticks(room, 500);
    expect(room._seat(seekerId)!.mover.y).toBe(s0.y);
    expect(room._seat(runnerId)!.mover.y).not.toBe(r0.y);
    expect(room._seat(runnerId)!.ack).toBe(10);
  });

  it("limits how many inputs a player can apply per tick (no speed hacks)", () => {
    const { room, last, ids } = setup(2);
    room.start();
    ticks(room, RULES.revealMs + DT);
    const runnerId = ids.find((id) => id !== last().round!.seekerId)!;
    room.queueInputs(runnerId, Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, mx: 1, my: 0 })));
    room.tick(DT);
    expect(room._seat(runnerId)!.ack).toBeLessThanOrEqual(4);
  });

  it("rotates the seeker so everyone gets a turn", () => {
    const { room, last } = setup(4);
    const seekers = new Set<string>();
    for (let i = 0; i < 4; i++) {
      room.start();
      seekers.add(last().round!.seekerId);
      room.toLobby();
    }
    expect(seekers.size).toBe(4);
  });
});

describe("catching, cages and ghosts", () => {
  it("cages a runner after continuous exposure, then a teammate frees them", () => {
    const { room, seeker, runners, out } = startHunt(3);
    const [a, b] = runners;
    place(seeker, 100, 100, 0);
    place(a, 200, 100);
    place(b, 900, 900);
    ticks(room, RULES.exposureFillSec * 1000 + 100);
    expect(a.status).toBe("caged");
    expect(out.fx.some((e) => e.k === "caught" && e.id === a.id && !e.ghost)).toBe(true);

    // Seeker looks away; teammate stands next to the cage.
    place(seeker, 100, 100, Math.PI);
    place(b, 220, 100);
    ticks(room, RULES.rescueSec * 1000 + 100);
    expect(a.status).toBe("free");
    expect(a.invulnMs).toBeGreaterThan(0);
    expect(out.fx.some((e) => e.k === "freed" && e.id === a.id && e.by === b.id)).toBe(true);
  });

  it("exposure drains when the runner escapes the light", () => {
    const { room, seeker, runners } = startHunt(2);
    const [a] = runners;
    place(seeker, 100, 100, 0);
    place(a, 200, 100);
    ticks(room, 700);
    expect(a.exposure).toBeGreaterThan(0.3);
    place(a, 200, 600);
    ticks(room, RULES.exposureDecaySec * 1000 + 50);
    expect(a.exposure).toBe(0);
    expect(a.status).toBe("free");
  });

  it("a second catch makes the runner a ghost", () => {
    const { room, seeker, runners } = startHunt(3);
    const [a, b] = runners;
    place(b, 900, 900);
    a.timesCaught = 1;
    place(seeker, 100, 100, 0);
    place(a, 200, 100);
    ticks(room, RULES.exposureFillSec * 1000 + 100);
    expect(a.status).toBe("ghost");
  });

  it("seeker wins when no runner is free, and scores the catches", () => {
    const { room, seeker, runners, last } = startHunt(2);
    const [a] = runners;
    place(seeker, 100, 100, 0);
    place(a, 200, 100);
    ticks(room, RULES.exposureFillSec * 1000 + 100);
    expect(room.phase).toBe("round_over");
    const info = last();
    expect(info.result!.winner).toBe("seeker");
    const seekerScore = info.players.find((p) => p.id === seeker.id)!.score;
    expect(seekerScore).toBe(1 + 3);
  });

  it("seeker wins on timeout", () => {
    const { room, seeker, runners, last } = startHunt(2);
    place(seeker, 100, 100, Math.PI);
    place(runners[0], 900, 900);
    for (let t = 0; t < RULES.huntMs + 200; t += DT) {
      // Keep the runner wiggling so sneezes don't matter.
      room.tick(DT);
    }
    expect(room.phase).toBe("round_over");
    expect(last().result!.winner).toBe("seeker");
  });
});

describe("orbs", () => {
  it("runners win by collecting enough orbs", () => {
    const { room, seeker, runners, last } = startHunt(2);
    const [a] = runners;
    place(seeker, 900, 900, Math.PI);
    const need = last().round!.orbsToWin;
    for (let i = 0; i < need; i++) {
      (room as any).orbs = [{ id: 100 + i, x: 300, y: 300 }];
      place(a, 300, 300);
      room.tick(DT);
    }
    expect(room.phase).toBe("round_over");
    expect(last().result!.winner).toBe("runners");
    expect(last().players.find((p) => p.id === a.id)!.score).toBe(need + 3);
  });

  it("idle runners sneeze and make noise", () => {
    const { room, seeker, runners, out } = startHunt(2);
    place(seeker, 900, 900, Math.PI);
    place(runners[0], 300, 300);
    ticks(room, RULES.sneezeIdleMs + 100);
    expect(out.fx.some((e) => e.k === "noise")).toBe(true);
  });
});

describe("abilities", () => {
  it("polo pings every free runner and starts a cooldown", () => {
    const { room, seeker, runners, out } = startHunt(3);
    place(seeker, 100, 100, Math.PI);
    room.queueInputs(seeker.id, [{ seq: seeker.ack + 1, mx: 0, my: 0, a: 1 }]);
    room.tick(DT);
    const polo = out.fx.find((e) => e.k === "polo");
    expect(polo && polo.k === "polo" && polo.targets.length).toBe(runners.length);
    expect(seeker.cdA).toBeGreaterThan(0);
  });

  it("dash boosts runner movement", () => {
    const { room, runners, seeker } = startHunt(2);
    place(seeker, 900, 900, Math.PI);
    const r = runners[0];
    place(r, 300, 300);
    room.queueInputs(r.id, [{ seq: r.ack + 1, mx: 1, my: 0, a: 1 }]);
    room.tick(DT);
    expect(r.mover.x - 300).toBeGreaterThan(15);
    expect(r.cdA).toBeGreaterThan(0);
  });
});

describe("connections", () => {
  it("drops players who stay disconnected in the lobby", () => {
    const { room, ids, last } = setup(3);
    room.setConnected(ids[0], false);
    ticks(room, RULES.lobbyDropMs + 200);
    expect(last().players.map((p) => p.id)).not.toContain(ids[0]);
  });

  it("aborts the round if the seeker stays disconnected", () => {
    const { room, seeker, runners, last } = startHunt(3);
    place(seeker, 100, 100, Math.PI);
    runners.forEach((r, i) => place(r, 600 + i * 100, 600));
    room.setConnected(seeker.id, false);
    ticks(room, RULES.seekerDropAbortMs + 200);
    expect(room.phase).toBe("round_over");
    expect(last().result!.winner).toBe("aborted");
  });

  it("lets a token resume the same seat", () => {
    const { room } = setup(2);
    const seat = room.addPlayer("Zed");
    expect(room.playerByToken(seat.token)?.id).toBe(seat.id);
  });
});

describe("joining", () => {
  it("lets a dropped player reclaim their seat by name, but not steal a connected one", () => {
    const { room, ids } = setup(2);
    expect(room.reclaimableSeat("P0")).toBeUndefined(); // still connected
    expect(room.canJoin("p0")?.reason).toBe("name_taken");
    room.setConnected(ids[0], false);
    expect(room.reclaimableSeat("p0")?.id).toBe(ids[0]);
  });

  it("is only joinable between rounds and while not full", () => {
    const { room } = setup(2);
    expect(room.joinable).toBe(true);
    room.start();
    expect(room.joinable).toBe(false);
    expect(room.canJoin("New")?.reason).toBe("in_progress");
    room.toLobby();
    for (let i = room.playerCount(); i < RULES.maxPlayers; i++) room.addPlayer(`X${i}`);
    expect(room.joinable).toBe(false);
    expect(room.canJoin("Late")?.reason).toBe("full");
  });
});
