// Bot-vs-bot games through the real engine, to check it plays like the Python balance sim.
// Run: npm run sim -- [games per player count]
import { Bot, runBots } from "./bots";
import { HeistGame } from "./game";

const games = Number(process.argv[2] ?? 500);
let failed = 0;
for (const n of [3, 4, 5, 6]) {
  let target = 0, lastCall = 0, turns = 0, frames = 0, errors = 0;
  const seatWins = new Array(n).fill(0);
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const seed = n * 100000 + i;
    try {
      const g = new HeistGame({ seed, seats: Array.from({ length: n }, (_, k) => ({ name: `Bot ${k + 1}`, bot: true })) });
      const bots = new Map(g.s.players.map((p) => [p.seat, new Bot(seed * 7 + p.seat)]));
      runBots(g, bots);
      if (!g.over) throw new Error("game did not finish");
      if (g.s.endReason === "footholds") target++;
      else lastCall++;
      turns += g.s.turn + 1;
      frames += g.frames.length;
      const order = (s: number) => (s - g.s.firstBoss + n) % n;
      for (const w of g.s.winners!) seatWins[order(w)] += 1 / g.s.winners!.length;
    } catch (e) {
      errors++;
      if (errors <= 3) console.error(n, seed, e);
    }
  }
  failed += errors;
  const ok = games - errors;
  console.log(JSON.stringify({
    players: n,
    games,
    errors,
    "ended_at_target_%": +(100 * target / ok).toFixed(1),
    "last_call_%": +(100 * lastCall / ok).toFixed(1),
    rounds_avg: +(turns / ok / n).toFixed(1),
    frames_avg: Math.round(frames / ok),
    "seat_win_%": seatWins.map((w) => +(100 * w / ok).toFixed(1)),
    ms_per_game: +((Date.now() - t0) / games).toFixed(1),
  }));
}
if (failed) process.exitCode = 1;
