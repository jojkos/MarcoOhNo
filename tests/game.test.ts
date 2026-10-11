import { describe, expect, it } from "vitest";
import { Game } from "../server/game/Game";
import type { FxEvent, RoundResult } from "@shared/protocol";
import { ITEMS, PLAYER, RULES, TICK_RATE } from "@shared/config";
import { Thing, type Player } from "@shared/schema";
import { seeded } from "./util";

const DT = 1000 / TICK_RATE;

function setup(n: number, seed = 1) {
  let now = 1_000_000;
  const fx: FxEvent[] = [];
  const corrections: { id: string; x: number; y: number }[] = [];
  const game = new Game(
    "TEST",
    { fx: (e) => fx.push(...e), correct: (id, x, y) => corrections.push({ id, x, y }), now: () => now },
    seeded(seed),
  );
  const ids = Array.from({ length: n }, (_, i) => game.addPlayer(`P${i}`).id);
  const ticks = (ms: number) => {
    for (let t = 0; t < ms; t += DT) {
      now += DT;
      game.tick(DT);
    }
  };
  const advance = (ms: number) => (now += ms);
  return { game, fx, corrections, ids, ticks, advance };
}

/** Start a round, skip to the hunt, and clear the map so positions are easy to reason about. */
function hunt(n: number, seed = 1) {
  const ctx = setup(n, seed);
  expect(ctx.game.start()).toBeNull();
  ctx.game.map!.rects.length = 0;
  ctx.game.map!.wallCount = 0;
  (ctx.game as any).shrunk = [];
  ctx.game.state.orbs.splice(0, ctx.game.state.orbs.length);
  ctx.game.state.items.splice(0, ctx.game.state.items.length);
  ctx.ticks(RULES.revealMs + RULES.scatterMs + DT * 2);
  expect(ctx.game.phase).toBe("hunt");
  const seeker = ctx.game.seeker!;
  const runners = ctx.game.runners;
  // Park everyone far apart, seeker looking away.
  place(seeker, 100, 100, Math.PI);
  runners.forEach((r, i) => place(r, 700 + i * 120, 700));
  return { ...ctx, seeker, runners };
}

function place(p: Player, x: number, y: number, angle = 0) {
  p.x = x;
  p.y = y;
  p.angle = angle;
}

const result = (g: Game) => JSON.parse(g.state.result) as RoundResult;

describe("round flow", () => {
  it("lobby -> reveal -> scatter -> hunt", () => {
    const { game, ticks } = setup(3);
    expect(game.start()).toBeNull();
    expect(game.phase).toBe("reveal");
    ticks(RULES.revealMs + DT);
    expect(game.phase).toBe("scatter");
    ticks(RULES.scatterMs + DT);
    expect(game.phase).toBe("hunt");
  });

  it("needs two players and rotates the seeker", () => {
    const { game } = setup(1);
    expect(game.start()).toMatch(/at least/);
    const four = setup(4);
    const seekers = new Set<string>();
    for (let i = 0; i < 4; i++) {
      four.game.start();
      seekers.add(four.game.state.round!.seekerId);
      four.game.toLobby();
    }
    expect(seekers.size).toBe(4);
  });

  it("prefers humans over bots as seeker", () => {
    const { game } = setup(1);
    game.addBot();
    game.addBot();
    game.start();
    expect(game.seeker!.isBot).toBe(false);
  });
});

describe("movement validation", () => {
  it("accepts plausible moves and rejects teleports and wall clipping", () => {
    const { game, corrections, advance, ids } = setup(2);
    game.start();
    (game as any).state.phase = "hunt";
    const runner = game.runners[0];
    const { x, y } = runner;
    advance(33);
    game.move(runner.id, { x: x + 5, y, vx: 150, vy: 0, a: 0 });
    expect(runner.x).toBeCloseTo(x + 5);
    advance(33);
    game.move(runner.id, { x: x + 400, y, vx: 0, vy: 0, a: 0 });
    expect(runner.x).toBeCloseTo(x + 5);
    expect(corrections.at(-1)?.id).toBe(runner.id);
    // Moving into a wall rect is refused.
    const wall = game.map!.rects[0];
    runner.x = wall.x + wall.w / 2;
    runner.y = wall.y + wall.h + PLAYER.radius + 1;
    advance(200);
    game.move(runner.id, { x: runner.x, y: wall.y + wall.h / 2, vx: 0, vy: 0, a: 0 });
    expect(runner.y).toBeGreaterThan(wall.y + wall.h);
    expect(ids.length).toBe(2);
  });

  it("allows dash speed right after a dash", () => {
    const { game, advance } = hunt(2);
    const r = game.runners[0];
    const x0 = r.x;
    game.action(r.id, "a");
    advance(100);
    game.move(r.id, { x: x0 + 55, y: r.y, vx: 600, vy: 0, a: 0 });
    expect(r.x).toBeCloseTo(x0 + 55);
  });
});

describe("catching, cages, ghosts", () => {
  it("cages after continuous exposure; a teammate frees them", () => {
    const { game, seeker, runners, ticks, fx } = hunt(3);
    const [a, b] = runners;
    place(seeker, 100, 100, 0);
    place(a, 220, 100);
    ticks(RULES.exposureFillFor(2) * 1000 + 150);
    expect(a.status).toBe("caged");
    expect(fx.some((e) => e.k === "caught" && e.id === a.id)).toBe(true);
    place(seeker, 100, 100, Math.PI);
    place(b, 240, 100);
    ticks(RULES.rescueSec * 1000 + 150);
    expect(a.status).toBe("free");
    expect(a.invuln).toBe(true);
  });

  it("exposure drains when you escape; smoke blocks the beam", () => {
    const { game, seeker, runners, ticks } = hunt(2);
    const [a] = runners;
    place(seeker, 100, 100, 0);
    place(a, 220, 100);
    ticks(600);
    expect(a.exposure).toBeGreaterThan(0.2);
    const smoke = new Thing();
    Object.assign(smoke, { id: 99, x: 170, y: 100, ttl: 5000 });
    game.state.smokes.push(smoke);
    ticks(RULES.exposureDecaySec * 1000 + 100);
    expect(a.exposure).toBe(0);
  });

  it("second catch makes a ghost; seeker wins when nobody is free", () => {
    const { game, seeker, runners, ticks } = hunt(2);
    const [a] = runners;
    (game.privOf(a.id) as any).timesCaught = 1;
    place(seeker, 100, 100, 0);
    place(a, 220, 100);
    ticks(RULES.exposureFillFor(1) * 1000 + 150);
    expect(a.status).toBe("ghost");
    expect(game.phase).toBe("round_over");
    expect(result(game).winner).toBe("seeker");
    expect(game.player(seeker.id)!.score).toBe(1 + 3);
  });

  it("seeker wins on timeout", () => {
    const { game, ticks } = hunt(2);
    ticks(RULES.huntMs + 100);
    expect(result(game).winner).toBe("seeker");
  });
});

describe("orbs and items", () => {
  it("orbs charge while you stand on them; enough orbs wins", () => {
    const { game, runners, ticks } = hunt(2);
    const [a] = runners;
    const need = game.state.round!.orbsToWin;
    const drop = (id: number) => {
      game.state.orbs.splice(0, game.state.orbs.length);
      const orb = new Thing();
      Object.assign(orb, { id, x: a.x, y: a.y });
      game.state.orbs.push(orb);
      return orb;
    };
    // Stepping off early loses the charge.
    const first = drop(400);
    ticks(RULES.orbChargeSec * 500);
    expect(first.charge).toBeGreaterThan(30);
    expect(game.state.collected).toBe(0);
    place(a, a.x + 200, a.y);
    ticks(RULES.orbChargeDecaySec * 1000 + 100);
    expect(first.charge).toBe(0);
    place(a, first.x, first.y);
    for (let i = 0; i < need; i++) {
      drop(500 + i);
      ticks(RULES.orbChargeSec * 1000 + 2 * DT);
    }
    expect(result(game).winner).toBe("runners");
  });

  it("a lone caged runner picks the lock eventually", () => {
    const { game, seeker, runners, ticks } = hunt(3);
    const [a] = runners;
    place(seeker, 100, 100, 0);
    place(a, 220, 100);
    ticks(RULES.exposureFillFor(2) * 1000 + 150);
    expect(a.status).toBe("caged");
    place(seeker, 100, 100, Math.PI);
    ticks(RULES.lockpickSec * 1000 - 1000);
    expect(a.status).toBe("caged");
    ticks(1500);
    expect(a.status).toBe("free");
  });

  it("picking up a box gives a role item; flashbang blinds a nearby seeker", () => {
    const { game, seeker, runners, ticks } = hunt(2);
    const [a] = runners;
    const box = new Thing();
    Object.assign(box, { id: 900, x: a.x, y: a.y });
    game.state.items.push(box);
    ticks(DT);
    expect(["smoke", "decoy", "flash"]).toContain(a.item);
    a.item = "flash";
    place(seeker, a.x + 100, a.y, Math.PI);
    game.action(a.id, "item");
    expect(seeker.blinded).toBe(true);
    ticks(ITEMS.flash.blindMs + 100);
    expect(seeker.blinded).toBe(false);
  });

  it("traps root runners and make noise", () => {
    const { game, seeker, runners, ticks, fx } = hunt(2);
    seeker.item = "trap";
    place(seeker, 400, 400, Math.PI);
    game.action(seeker.id, "item");
    place(seeker, 100, 100, Math.PI);
    place(runners[0], 400, 400);
    ticks(DT * 2);
    expect(runners[0].rooted).toBe(true);
    expect(fx.some((e) => e.k === "trapped")).toBe(true);
  });
});

describe("lockers", () => {
  it("hidden runners can't be seen, but a search finds them", () => {
    const { game, seeker, runners, ticks, fx } = hunt(2);
    const [a] = runners;
    const lk = game.state.round!.lockers[0];
    place(a, lk.x + 10, lk.y);
    game.action(a.id, "act");
    expect(a.locker).toBe(lk.id);
    place(seeker, lk.x - 40, lk.y, 0);
    ticks(500);
    expect(a.exposure).toBe(0);
    expect(a.status).toBe("free");
    game.action(seeker.id, "act");
    ticks(RULES.lockerSearchMs + 100);
    expect(fx.some((e) => e.k === "locker" && e.what === "found")).toBe(true);
    expect(a.status).not.toBe("free");
  });

  it("kicks you out after the max hide time, with a creak", () => {
    const { game, runners, ticks, fx } = hunt(2);
    const [a] = runners;
    const lk = game.state.round!.lockers[0];
    place(a, lk.x, lk.y);
    game.action(a.id, "act");
    ticks(RULES.lockerMaxHideMs + 200);
    expect(a.locker).toBe(-1);
    expect(fx.some((e) => e.k === "noise" && e.why === "locker")).toBe(true);
  });
});

describe("seats", () => {
  it("drops disconnected players from the lobby after a grace period", () => {
    const { game, ids, ticks } = setup(3);
    game.setConnected(ids[0], false);
    ticks(RULES.lobbyDropMs + 200);
    expect(game.player(ids[0])).toBeUndefined();
  });

  it("lets a dropped player reclaim the seat by name", () => {
    const { game, ids } = setup(2);
    expect(game.reclaimable("P0")).toBeUndefined();
    game.setConnected(ids[0], false);
    expect(game.reclaimable("p0")?.id).toBe(ids[0]);
    expect(game.joinError("P1")).toBe("name_taken");
  });
});

describe("review fixes", () => {
  it("bots can't be removed mid-round (the bot might be the seeker)", () => {
    const { game } = setup(1);
    game.addBot();
    expect(game.start()).toBeNull();
    expect(game.removeBot()).toBe(false);
    expect(game.players.length).toBe(2);
  });

  it("everyone running away isn't a seeker win", () => {
    const { game, seeker, runners, ticks } = hunt(3);
    for (const r of runners) game.leave(r.id);
    ticks(DT * 2);
    expect(game.phase).toBe("round_over");
    expect(result(game).winner).toBe("aborted");
    expect(game.player(seeker.id)!.score).toBe(0);
  });

  it("DASH while trapped doesn't burn the cooldown", () => {
    const { game, runners } = hunt(2);
    const [r] = runners;
    r.rooted = true;
    game.action(r.id, "a");
    expect(r.cdA).toBe(0);
  });

  it("never the same seeker twice in a row", () => {
    const { game } = setup(3);
    let last = "";
    for (let i = 0; i < 9; i++) {
      expect(game.start()).toBeNull();
      const s = game.state.round!.seekerId;
      expect(s).not.toBe(last);
      last = s;
      game.toLobby();
    }
  });
});

describe("bots", () => {
  it("play full matches to a result without errors", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { game, ticks } = setup(0, seed);
      for (let i = 0; i < 4; i++) game.addBot();
      expect(game.start()).toBeNull();
      ticks(RULES.revealMs + RULES.scatterMs + RULES.huntMs + 2000);
      expect(game.phase).toBe("round_over");
      const r = result(game);
      expect(["seeker", "runners"]).toContain(r.winner);
    }
  });
});
