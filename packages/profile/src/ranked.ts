// Ranked: a visible rank you grind for, next to Casual's hidden rating. Ranked tables are 6 people, no
// bots (the table-size sims found 6 seats reward skill most). You earn or lose rank points by where you
// finish at your table, so a good game that isn't a win still pays. A separate Ranked MMR, shown to
// everyone, weighs every result: losing to weaker players costs more, beating stronger ones pays more,
// and someone whose MMR is above their rank climbs faster (Siege style).
//
// Rank protection: the first 10 ranked games of a season can't drop you a tier; once you reach Bronze
// you never fall below it that season; above Bronze there's no floor.

import { seasonAt, seasonById } from "./season";

/** account level needed to queue for Ranked */
export const RANKED_LEVEL = 10;
/** seats at a ranked table */
export const RANKED_PLAYERS = 6;
export const RANKED_START_MMR = 1000;

export const TIERS = ["Copper", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion"] as const;
export type TierName = (typeof TIERS)[number];
const DIVS = 3;
const DIV_POINTS = 100;
/** Champion starts here and has no divisions */
export const CHAMPION_RP = (TIERS.length - 1) * DIVS * DIV_POINTS;
/** games at the start of a season that can't drop you a tier */
export const PROTECTED_GAMES = 10;
/** reach this tier (Bronze) and it's your floor for the season */
const FLOOR_TIER = 1;

export interface RankedState {
  /** the season these points belong to (0 between seasons) */
  season: number;
  /** rank points this season */
  rp: number;
  /** best rank points this season */
  peak: number;
  /** ranked games and wins this season */
  games: number;
  wins: number;
  /** Ranked MMR: carries over between seasons (pulled a quarter of the way back to 1000) */
  mmr: number;
  /** ranked games ever, for how fast the MMR moves */
  total: number;
  /** last season's best, kept for profiles */
  last: { season: number; peak: number } | null;
}

export function newRanked(season = 0): RankedState {
  return { season, rp: 0, peak: 0, games: 0, wins: 0, mmr: RANKED_START_MMR, total: 0, last: null };
}

export interface Rank {
  tier: number;
  name: TierName;
  /** 3, 2 or 1 (Champion: 0) */
  div: number;
  /** "Gold II", "Champion" */
  label: string;
  /** points into this division, and how many it takes (Champion: points above its start, no cap) */
  into: number;
  of: number;
}

const ROMAN = ["", "I", "II", "III"];

export function rankOf(rp: number): Rank {
  if (rp >= CHAMPION_RP) return { tier: TIERS.length - 1, name: "Champion", div: 0, label: "Champion", into: rp - CHAMPION_RP, of: 0 };
  const step = Math.floor(Math.max(0, rp) / DIV_POINTS);
  const tier = Math.floor(step / DIVS);
  const div = DIVS - (step % DIVS);
  return { tier, name: TIERS[tier], div, label: `${TIERS[tier]} ${ROMAN[div]}`, into: Math.max(0, rp) - step * DIV_POINTS, of: DIV_POINTS };
}

export const tierStart = (tier: number) => tier * DIVS * DIV_POINTS;

/** Base rank points by finishing place (index 0 = first), before MMR weighting. */
export const PLACE_POINTS: Record<number, number[]> = {
  3: [35, 0, -30],
  4: [40, 10, -10, -35],
  5: [40, 15, 0, -15, -35],
  6: [40, 20, 5, -5, -20, -35],
};
/** walking out of a ranked game costs this much on top of last place */
export const QUIT_PENALTY = 15;
const MAX_MOVE = 90;

/**
 * Places at a finished table. `scores`: higher is better for each seat (winners first, then Footholds and
 * cash); `out`: seats that abandoned, who place below everyone still there. Ties share their places.
 * Returns each seat's place as [first, last] it spans (0-based).
 */
export function places(scores: number[], out: number[] = []): [number, number][] {
  const key = (s: number) => (out.includes(s) ? -Infinity : scores[s]);
  return scores.map((_, s) => {
    const above = scores.filter((_, o) => key(o) > key(s)).length;
    const tied = scores.filter((_, o) => o !== s && key(o) === key(s)).length;
    return [above, above + tied];
  });
}

/** Base points for a place span (ties average the places they share). */
export function placePoints(n: number, span: [number, number]): number {
  const table = PLACE_POINTS[n] ?? PLACE_POINTS[6];
  let t = 0;
  for (let i = span[0]; i <= span[1]; i++) t += table[Math.min(i, table.length - 1)];
  return t / (span[1] - span[0] + 1);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The rank points an MMR "belongs" at: 700 MMR is Copper, 1000 is Gold, 1300 is Champion. */
export const mmrRp = (mmr: number) => clamp((mmr - 700) * 3, 0, CHAMPION_RP + 300);

/** Rank points for one game: base points for the place, weighted by MMR. */
export function rankDelta(o: { base: number; mmr: number; rivalsMmr: number[]; rp: number; quit?: boolean }): number {
  const avg = o.rivalsMmr.length ? o.rivalsMmr.reduce((a, b) => a + b, 0) / o.rivalsMmr.length : o.mmr;
  const base = o.base - (o.quit ? QUIT_PENALTY : 0);
  // who you played: beating a stronger table pays more, losing to a weaker one costs more
  const table = base >= 0 ? clamp(1 + (avg - o.mmr) / 400, 0.5, 1.5) : clamp(1 + (o.mmr - avg) / 400, 0.5, 1.5);
  // where your MMR says you belong: below it you climb faster and drop slower, above it the reverse
  const gap = mmrRp(o.mmr) - o.rp;
  const belong = base >= 0 ? clamp(1 + gap / 600, 0.6, 1.6) : clamp(1 - gap / 600, 0.6, 1.6);
  return Math.round(clamp(base * table * belong, -MAX_MOVE, MAX_MOVE));
}

/** Ranked MMR after a game: pairwise Elo by finishing place against everyone at the table. */
export function rankedMmr(mmr: number, total: number, myPlace: number, rivals: { mmr: number; place: number }[], quit = false): number {
  if (!rivals.length) return mmr;
  const k = total < 10 ? 48 : 32;
  let d = 0;
  for (const r of rivals) {
    const score = quit ? 0 : myPlace < r.place ? 1 : myPlace > r.place ? 0 : 0.5;
    d += score - 1 / (1 + 10 ** ((r.mmr - mmr) / 400));
  }
  return Math.max(100, Math.round(mmr + (k * d) / rivals.length));
}

/** Start a new season's climb: points back to zero, MMR a quarter of the way back to 1000. */
export function rollSeason(prev: RankedState, season: number): RankedState {
  if (prev.season === season) return prev;
  return {
    ...newRanked(season),
    mmr: Math.round(RANKED_START_MMR + (prev.mmr - RANKED_START_MMR) * 0.75),
    total: prev.total,
    last: prev.games ? { season: prev.season, peak: prev.peak } : prev.last,
  };
}

/** Coins for the best rank you reached last season, paid with your first ranked game of the next one. */
export const seasonRankCoins = (peak: number) => 100 * (rankOf(peak).tier + 1);

/** The lowest your points can go after this game, and which protection sets it. */
export function rankFloor(r: RankedState): { rp: number; by: "tier" | "floor" | null } {
  const tier = r.games < PROTECTED_GAMES ? tierStart(rankOf(r.rp).tier) : 0;
  const floor = rankOf(r.peak).tier >= FLOOR_TIER ? tierStart(FLOOR_TIER) : 0;
  if (!tier && !floor) return { rp: 0, by: null };
  return tier >= floor ? { rp: tier, by: "tier" } : { rp: floor, by: "floor" };
}

export interface RankedResult {
  season: number;
  /** finishing place, 1-based (ties show the best place shared) */
  place: number;
  players: number;
  rpBefore: number;
  rpAfter: number;
  /** what the place was worth before protection held it */
  delta: number;
  mmrBefore: number;
  mmrAfter: number;
  /** "tier": a protected early-season game held your tier; "floor": the Bronze floor held */
  held: "tier" | "floor" | null;
  /** last season's rank reward, paid now */
  seasonReward?: { season: number; label: string; coins: number };
}

export interface RankedGame {
  span: [number, number];
  players: number;
  rivals: { mmr: number; place: number }[];
  quit?: boolean;
  won: boolean;
  at: number;
}

/** Apply one ranked game. */
export function playRanked(prev: RankedState | null | undefined, g: RankedGame): { state: RankedState; result: RankedResult } {
  const season = seasonAt(g.at)?.id ?? 0;
  const before = prev ?? newRanked(season);
  let r = rollSeason(before, season);
  let seasonReward: RankedResult["seasonReward"];
  if (r !== before && before.games) {
    const old = seasonById(before.season);
    seasonReward = { season: before.season, label: `${old?.name ?? "Last season"}: ${rankOf(before.peak).label}`, coins: seasonRankCoins(before.peak) };
  }
  const base = placePoints(g.players, g.span);
  const delta = rankDelta({ base, mmr: r.mmr, rivalsMmr: g.rivals.map((x) => x.mmr), rp: r.rp, quit: g.quit });
  const floor = rankFloor(r);
  const raw = r.rp + delta;
  const rpAfter = Math.max(floor.rp, raw, 0);
  const held = raw < floor.rp ? floor.by : null;
  const mmrAfter = rankedMmr(r.mmr, r.total, g.span[0], g.rivals, g.quit);
  const result: RankedResult = {
    season, place: g.span[0] + 1, players: g.players, rpBefore: r.rp, rpAfter, delta, mmrBefore: r.mmr, mmrAfter, held, seasonReward,
  };
  r = { ...r, rp: rpAfter, peak: Math.max(r.peak, rpAfter), games: r.games + 1, wins: r.wins + (g.won && !g.quit ? 1 : 0), mmr: mmrAfter, total: r.total + 1 };
  return { state: r, result };
}

/** Rank as others see it: tier, points and MMR (nothing about Ranked is hidden). */
export interface RankedPublic {
  label: string;
  tier: number;
  rp: number;
  mmr: number;
  games: number;
  wins: number;
  peak: string;
  last: string | null;
}

export function rankedPublic(r: RankedState | null | undefined, at: number): RankedPublic | null {
  if (!r || !r.total) return null;
  const cur = rollSeason(r, seasonAt(at)?.id ?? 0);
  const rank = rankOf(cur.rp);
  const last = cur.last ? `${seasonById(cur.last.season)?.name ?? "Last season"}: ${rankOf(cur.last.peak).label}` : null;
  return { label: cur.games ? rank.label : "Unranked this season", tier: rank.tier, rp: cur.rp, mmr: cur.mmr, games: cur.games, wins: cur.wins, peak: rankOf(cur.peak).label, last };
}
