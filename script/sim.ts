// Balance check: run many all-bot rounds and report outcomes.
//   npx tsx script/sim.ts [rounds] [bots]
import { Game } from "../server/game/Game";
import { RULES, TICK_RATE } from "../shared/config";
import type { RoundResult } from "../shared/protocol";

const rounds = Number(process.argv[2] ?? 40);
const bots = Number(process.argv[3] ?? 5);
const DT = 1000 / TICK_RATE;

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const tally = new Map<string, number>();
const durBy = new Map<string, number[]>();
let orbs = 0;
let catches = 0;
let duration = 0;
for (let seed = 1; seed <= rounds; seed++) {
  let now = 1_000_000;
  let endAt = 0;
  const game = new Game("SIM", { fx: () => {}, correct: () => {}, now: () => now }, seeded(seed * 7919));
  for (let i = 0; i < bots; i++) game.addBot();
  game.start();
  const limit = RULES.revealMs + RULES.scatterMs + RULES.huntMs + 2000;
  for (let t = 0; t < limit && game.phase !== "round_over"; t += DT) {
    now += DT;
    game.tick(DT);
    endAt = t;
  }
  const r = JSON.parse(game.state.result) as RoundResult;
  const key = `${r.winner}: ${r.reason}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
  orbs += game.state.collected;
  catches += r.players.reduce((n, p) => n + p.catches, 0);
  const d = Math.max(0, endAt - RULES.revealMs - RULES.scatterMs) / 1000;
  duration += d;
  durBy.set(r.winner, [...(durBy.get(r.winner) ?? []), Math.round(d)]);
}
console.log(`${rounds} rounds, ${bots} bots`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)}  ${k}`);
for (const [w, ds] of durBy) console.log(`  ${w} hunt lengths: ${ds.sort((a, b) => a - b).join(" ")}`);
console.log(`avg orbs ${(orbs / rounds).toFixed(1)}, avg catches ${(catches / rounds).toFixed(1)}, avg hunt ${(duration / rounds).toFixed(0)}s`);
