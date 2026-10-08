// Bot-vs-bot games through the real engine, to check it plays like the Python balance sim.
// Run: npm run sim -- [games per player count] [--rules bribes,placeCrew,openDeals] [--level easy|normal|hard]
//                     [--one hard] (one bot of that level, in a random seat, among the rest) [--patient] [--pairs]
import { Bot, type BotLevel, runBots } from "./bots";
import { HeistGame } from "./game";
import type { GameEvent, RuleOptions } from "./types";

const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const games = Number(argv.find((x) => /^\d+$/.test(x)) ?? 500);
const rules: Partial<RuleOptions> = Object.fromEntries((flag("--rules") ?? "").split(",").filter(Boolean).map((k) => [k, true]));
const level = (flag("--level") ?? "normal") as BotLevel;
const one = flag("--one") as BotLevel | undefined;
const patient = argv.includes("--patient");
const pairs = argv.includes("--pairs");
let failed = 0;

/** Per-game counts of what happened, named like the Python sim's stats so the two can be compared. */
function tally(evs: GameEvent[], c: Record<string, number>) {
  const add = (k: string, v = 1) => (c[k] = (c[k] ?? 0) + v);
  for (const e of evs) {
    switch (e.t) {
      case "target": add("hits"); break;
      case "mark": if (e.how === "wanted") add("wanted"); break;
      case "bust": add("busts"); break;
      case "result": add(e.winner === "B" ? "boss_wins" : "mark_wins"); break;
      case "bet": add("bets"); break;
      case "doubleCross": add("double_cross"); break;
      case "backup": add("backups"); break;
      case "fixerFixer": add("fixer_fixer"); break;
      case "deal": if (e.accepted) add("deals"); break;
      case "reshuffle": add("reshuffles"); break;
      case "again": add("again"); break;
      case "hire": add("hired", e.count); break;
      case "bank": add("banked", e.cardIds.length); break;
      case "cut": add("cuts_banked"); break;
      case "hacked": add("hacks"); break;
      case "forged": add("forged"); break;
      case "stuck": add("stuck"); break;
      case "pass": break;
      case "turn": add("turns"); break;
      default: {
        const t = (e as { t: string }).t;
        if (t === "bribe") add("bribes");
      }
    }
  }
}

for (const n of [3, 4, 5, 6]) {
  let target = 0, lastCall = 0, turns = 0, frames = 0, errors = 0;
  const seatWins = new Array(n).fill(0);
  let oneWins = 0, pairWins = 0;
  const counts: Record<string, number> = {};
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const seed = n * 100000 + i;
    try {
      const g = new HeistGame({ seed, rules, snapshots: false, seats: Array.from({ length: n }, (_, k) => ({ name: `Bot ${k + 1}`, bot: true })) });
      const special = seed % n;
      const pair = pairs ? [special, (special + 1 + (seed >> 3) % (n - 1)) % n] : [];
      const bots = new Map(g.s.players.map((p) => {
        const lv = one && p.seat === special ? one : level;
        const partner = pair.includes(p.seat) ? pair.find((q) => q !== p.seat)! : null;
        return [p.seat, new Bot(seed * 7 + p.seat, { level: lv, patient, partner })];
      }));
      runBots(g, bots);
      for (const w of g.s.winners!) {
        if (w === special) oneWins += 1 / g.s.winners!.length;
        if (pair.includes(w)) pairWins += 1 / g.s.winners!.length / 2;
      }
      if (!g.over) throw new Error("game did not finish");
      if (g.s.endReason === "footholds") target++;
      else lastCall++;
      turns += g.s.turn + 1;
      frames += g.frames.length;
      tally(g.frames.map((f) => f.ev), counts);
      for (const h of g.s.history) if (h.kind === "bust" && h.result === "B") counts.bust_wins = (counts.bust_wins ?? 0) + 1;
      const order = (s: number) => (s - g.s.firstBoss + n) % n;
      for (const w of g.s.winners!) seatWins[order(w)] += 1 / g.s.winners!.length;
    } catch (e) {
      errors++;
      if (errors <= 3) console.error(n, seed, e);
    }
  }
  failed += errors;
  failed += errors;
  const ok = games - errors;
  const perGame = Object.fromEntries(Object.entries(counts).sort().map(([k, v]) => [k, +(v / ok).toFixed(2)]));
  console.log(JSON.stringify({
    players: n,
    games,
    errors,
    "ended_at_target_%": +(100 * target / ok).toFixed(1),
    "last_call_%": +(100 * lastCall / ok).toFixed(1),
    rounds_avg: +(turns / ok / n).toFixed(1),
    frames_avg: Math.round(frames / ok),
    "seat_win_%": seatWins.map((w) => +(100 * w / ok).toFixed(1)),
    ...(one ? { [`${one}_bot_win_%`]: +(100 * oneWins / ok).toFixed(1) } : {}),
    ...(pairs ? { "pair_player_win_%": +(100 * pairWins / ok).toFixed(1) } : {}),
    "fair_%": +(100 / n).toFixed(1),
    ms_per_game: +((Date.now() - t0) / games).toFixed(1),
    per_game: perGame,
  }));
}
if (failed) process.exitCode = 1;
