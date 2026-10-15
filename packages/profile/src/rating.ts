// Hidden skill rating (MMR). Never shown to players: it picks how strong their bots are, and later who
// they get matched with. Elo, played pairwise: a game against N rivals counts as N head-to-heads, each
// worth 1/N of a normal Elo game. Beating a rival who lost is a win, losing to a rival who won is a
// loss, and two winners (or two losers) don't move each other. Quitting loses to everyone.

import type { BotLevel } from "@heist/engine";

export const START_RATING = 1000;
const MIN_RATING = 100;
/** new players move faster until the rating has settled */
const PROVISIONAL_GAMES = 10;
const K_PROVISIONAL = 48;
const K = 32;

/**
 * What a bot plays like on the rating scale. Heist is mostly luck, so the levels are close: in 2,000
 * game sims a hard bot wins about 15% more often than its fair share against normal bots, an easy one
 * a few percent less.
 */
export const BOT_RATING: Record<BotLevel, number> = { easy: 970, normal: 1000, hard: 1040 };

export interface Rival {
  rating: number;
  won: boolean;
}

const expected = (me: number, them: number) => 1 / (1 + 10 ** ((them - me) / 400));

/** The new rating after one game. */
export function rate(rating: number, games: number, won: boolean, rivals: Rival[], quit = false): number {
  if (!rivals.length) return rating;
  const k = games < PROVISIONAL_GAMES ? K_PROVISIONAL : K;
  let d = 0;
  for (const r of rivals) {
    const score = quit ? 0 : won && !r.won ? 1 : !won && r.won ? 0 : null;
    if (score !== null) d += score - expected(rating, r.rating);
  }
  return Math.max(MIN_RATING, Math.round(rating + (k * d) / rivals.length));
}

/**
 * Bots for a player of this rating, one level per bot seat. Easy below about 950, normal around the
 * starting 1000, hard from about 1060; tables in between mix two levels so each step is small.
 */
export function botLevelsFor(rating: number, bots: number): BotLevel[] {
  const ladder: BotLevel[] = ["easy", "normal", "hard"];
  const h = Math.min(2, Math.max(0, (rating - 950) / 55));
  const base = Math.floor(h);
  const up = Math.round((h - base) * bots);
  return Array.from({ length: bots }, (_, i) => ladder[Math.min(2, base + (i < up ? 1 : 0))]);
}

/** One level for a whole online table, from the host's rating. */
export const botLevelFor = (rating: number): BotLevel => (rating < 975 ? "easy" : rating >= 1035 ? "hard" : "normal");
