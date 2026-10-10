import { describe, expect, it } from "vitest";
import { Room } from "../server/game/room";
import { Predictor } from "../client/src/game/predictor";
import type { InputMsg, RoomInfo, Snapshot } from "@shared/protocol";
import { RULES, TICK_RATE } from "@shared/config";
import { moveCtxFor } from "@shared/rules";
import { abilityBoost } from "@shared/rules";
import { seeded } from "./util";

const DT = 1000 / TICK_RATE;

describe("client prediction against the real server", () => {
  it("stays in sync under latency, including dashes and wall collisions", () => {
    let info: RoomInfo | null = null;
    const snaps: Snapshot[] = [];
    const room = new Room("NET", { room: (r) => (info = r), snap: (s) => snaps.push(s), fx: () => {} }, seeded(5));
    const a = room.addPlayer("A");
    room.addPlayer("B");
    room.start();
    const round = info!.round!;
    const meId = round.seekerId === a.id ? info!.players.find((p) => p.id !== a.id)!.id : a.id; // a runner

    // Skip the reveal so runners can move.
    for (let t = 0; t < RULES.revealMs + DT; t += DT) room.tick(DT);
    expect(room.phase).toBe("scatter");

    const LATENCY_TICKS = 4; // ~130ms each way
    const toServer: { at: number; msgs: InputMsg[] }[] = [];
    const toClient: { at: number; snap: Snapshot }[] = [];
    const predictor = new Predictor();
    const rng = seeded(9);
    let maxErr = 0;
    let mx = 1;
    let my = 0;

    for (let tick = 0; tick < 280; tick++) {
      // Client
      const latest = snaps[snaps.length - 1];
      const meSnap = latest.players.find((p) => p.id === meId)!;
      if (!predictor.ready) predictor.reset(meSnap);
      if (tick % 15 === 0) {
        const ang = rng() * Math.PI * 2;
        mx = Math.cos(ang);
        my = Math.sin(ang);
      }
      const dash = tick % 200 === 10; // respects the 6s dash cooldown, like the real client
      const ctx = moveCtxFor("runner", meSnap.status, latest.phase, round);
      const boost = dash ? abilityBoost("dash")! : undefined;
      const msg = predictor.step(mx, my, { a: dash, b: false }, boost, ctx);
      toServer.push({ at: tick + LATENCY_TICKS, msgs: [msg] });

      // Network + server
      while (toServer.length && toServer[0].at <= tick) room.queueInputs(meId, toServer.shift()!.msgs);
      const before = snaps.length;
      room.tick(DT);
      for (let i = before; i < snaps.length; i++) toClient.push({ at: tick + LATENCY_TICKS, snap: snaps[i] });

      // Client receives snapshots
      while (toClient.length && toClient[0].at <= tick) {
        const s = toClient.shift()!.snap;
        const me = s.players.find((p) => p.id === meId)!;
        // Replaying unacked inputs from the server state must land on our own prediction.
        const predicted = { x: predictor.state.x, y: predictor.state.y };
        predictor.reconcile(me, moveCtxFor("runner", me.status, s.phase, round));
        maxErr = Math.max(maxErr, Math.hypot(predicted.x - predictor.state.x, predicted.y - predictor.state.y));
      }
    }
    // Only snapshot rounding (0.005px) and dash-cooldown timing should ever differ.
    expect(maxErr).toBeLessThan(1);
  });
});
