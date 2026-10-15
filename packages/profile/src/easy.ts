// Coached play's deal: out of a handful of seeds, the one where a learner who follows the coach wins their
// first fight and the game, in the fewest moves. Only the seed is picked, so the game replays as usual.
import { runBots, type GameEvent } from "@heist/engine";
import { autoPick } from "./lessons";
import { createSoloGame, SOLO_SEAT } from "./solo";

export interface EasyRun {
  /** the learner, following the coach, won the game */
  won: boolean;
  /** the first fight the learner was in went their way */
  firstFight: boolean;
  /** decisions the learner made */
  moves: number;
}

/** Play a coached table out with the learner taking every one of the coach's picks. */
export function coachRun(seed: number, players: number, lesson?: number): EasyRun {
  const { game, bots } = createSoloGame(seed, players, "You", false, { gentle: true, lesson });
  let boss = -1, mark = -1, moves = 0;
  let firstFight: boolean | null = null;
  let winners: number[] = [];
  const read = (ev: GameEvent) => {
    if (ev.t === "turn") (boss = ev.seat), (mark = -1);
    else if (ev.t === "mark") (boss = ev.boss), (mark = ev.mark);
    else if (ev.t === "result" && firstFight === null && (boss === SOLO_SEAT || mark === SOLO_SEAT))
      firstFight = (ev.winner === "B") === (boss === SOLO_SEAT);
    else if (ev.t === "gameOver") winners = ev.winners;
  };
  for (let guard = 0; guard < 5000; guard++) {
    runBots(game, bots);
    for (const f of game.drainFrames()) read(f.ev);
    const ask = game.pending;
    if (!ask) break;
    moves++;
    game.answer(SOLO_SEAT, autoPick(game, ask));
  }
  for (const f of game.drainFrames()) read(f.ev);
  return { won: winners.includes(SOLO_SEAT), firstFight: firstFight === true, moves };
}

/**
 * Pick the friendliest of `tries` seeds from `next()`: a win with the first fight won beats a plain win,
 * which beats a loss; then the fewest moves. Stops early once `budgetMs` is spent.
 */
export function easySeed(next: () => number, players: number, tries = 24, budgetMs = 400, now = () => Date.now(), lesson?: number): number {
  const t0 = now();
  let best = { seed: next(), score: -Infinity };
  for (let i = 0; i < tries; i++) {
    const seed = i === 0 ? best.seed : next();
    const r = coachRun(seed, players, lesson);
    const score = (r.won ? 2000 : 0) + (r.firstFight ? 1000 : 0) - r.moves;
    if (score > best.score) best = { seed, score };
    if (now() - t0 > budgetMs) break;
  }
  return best.seed;
}
