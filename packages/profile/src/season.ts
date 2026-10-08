// Seasons: a side track next to career XP. Every game earns season XP; each tier of the season pass hands
// out an item, coins or a free pack. Chip packs hold three items from the season's pack pool. Season items
// can only be earned while the season runs; once it ends, players keep what they got.
//
// Packs cost play chips (never real money). A pack costs more than a top-up, and you have to keep a full
// top-up's worth of chips after buying one, so spending down to zero and refilling can't farm packs.

import { cosmetic, type Cosmetic, type Rarity } from "./cosmetics";
import type { Fail, Progress } from "./progress";
import { SEASON_1, SEASON_1_PACK_ITEMS, SEASON_1_PASS_ITEMS } from "./season1";
import type { GameResult } from "./stats";

export interface Season {
  id: number;
  name: string;
  /** UTC ms; the season runs from start up to (not including) end */
  start: number;
  end: number;
  passItems: Cosmetic[];
  packItems: Cosmetic[];
}

export const SEASONS: Season[] = [
  { id: SEASON_1, name: "Opening Night", start: Date.UTC(2026, 9, 8), end: Date.UTC(2027, 0, 5), passItems: SEASON_1_PASS_ITEMS, packItems: SEASON_1_PACK_ITEMS },
];

export const seasonAt = (at: number) => SEASONS.find((s) => at >= s.start && at < s.end) ?? null;
export const seasonById = (id: number) => SEASONS.find((s) => s.id === id) ?? null;

// ------------------------------------------------------------------ the pass

export const PASS_TIERS = 50;
/** Season XP per tier. A typical game earns 150 to 300, so the whole pass is roughly 200 games. */
export const TIER_XP = 800;
export const PACK_TIER_COINS = 150;

export type TierReward = { kind: "item"; id: string } | { kind: "coins"; coins: number } | { kind: "packs"; packs: number };

/** What each tier gives, tier 1 first. Every tenth tier is a free pack (three at the top), every fifth coins, the rest items. */
export function passTrack(s: Season): TierReward[] {
  const items = s.passItems.map((c) => c.id);
  const out: TierReward[] = [];
  for (let t = 1; t <= PASS_TIERS; t++) {
    if (t === PASS_TIERS) out.push({ kind: "packs", packs: 3 });
    else if (t % 10 === 0) out.push({ kind: "packs", packs: 1 });
    else if (t % 5 === 0 || !items.length) out.push({ kind: "coins", coins: PACK_TIER_COINS });
    else out.push({ kind: "item", id: items.shift()! });
  }
  return out;
}

/** A player's pass for one season. */
export interface PassState {
  season: number;
  xp: number;
  /** free packs from the pass, not opened yet */
  packs: number;
}

export const tierOf = (xp: number) => Math.min(PASS_TIERS, Math.floor(xp / TIER_XP));

export interface PassLine {
  label: string;
  xp: number;
}

/** Season XP for a game. Quitting earns nothing. */
export function passLines(r: GameResult, firstWinToday: boolean): PassLine[] {
  if (r.quit) return [];
  const lines: PassLine[] = [{ label: "Played", xp: 150 }];
  if (r.won) lines.push({ label: "Won", xp: 100 });
  if (r.mode === "online") lines.push({ label: "Online", xp: 50 });
  if (r.won && firstWinToday) lines.push({ label: "First win of the day", xp: 200 });
  return lines;
}

export interface PassResult {
  season: number;
  xp: number;
  tierBefore: number;
  tierAfter: number;
  /** XP into the tier, before and after */
  xpBefore: number;
  xpAfter: number;
  rewards: TierReward[];
}

/** This season's pass for the player, starting fresh when a new season has begun. */
export function currentPass(p: Progress, at: number): PassState | null {
  const s = seasonAt(at);
  if (!s) return null;
  return p.pass?.season === s.id ? p.pass : { season: s.id, xp: 0, packs: 0 };
}

/** Add season XP to `p` (changed in place) and hand out the tiers it reaches. */
export function addPassXp(p: Progress, xp: number, at: number): PassResult | null {
  const s = seasonAt(at);
  const pass = currentPass(p, at);
  if (!s || !pass) return null;
  const before = pass.xp;
  const after = Math.min(PASS_TIERS * TIER_XP, before + xp);
  const tierBefore = tierOf(before);
  const tierAfter = tierOf(after);
  const track = passTrack(s);
  const rewards = track.slice(tierBefore, tierAfter);
  p.pass = { ...pass, xp: after };
  for (const r of rewards) grant(p, r);
  return { season: s.id, xp: after - before, tierBefore, tierAfter, xpBefore: before % TIER_XP, xpAfter: tierAfter >= PASS_TIERS ? TIER_XP : after % TIER_XP, rewards };
}

function grant(p: Progress, r: TierReward) {
  if (r.kind === "coins") p.coins += r.coins;
  else if (r.kind === "packs") p.pass!.packs += r.packs;
  else if (!p.owned.includes(r.id)) p.owned.push(r.id);
}

// ------------------------------------------------------------------ packs

export const PACK_PRICE = 3_000;
export const PACK_SIZE = 3;
/** Chips you must still have after paying for a pack: the top-up amount (REFILL_TO; a test keeps them equal). */
export const PACK_KEEP = 2_500;

/** Odds by rarity. Shiny and legendary tiers come later. */
export const PACK_ODDS: Record<Rarity, number> = { common: 1 };



export interface PackResult {
  progress: Progress;
  items: string[];
  /** season XP for items you already had (only once every pack item is owned) */
  dupeXp: number;
}

/** Random whole number in [0, n). The server passes crypto randomness; tests pass a seeded one. */
export type Rand = (n: number) => number;

export const DUPE_XP = 200;

/**
 * Open a pack: a free one from the pass, or one bought with chips. Each of its items is one you don't own
 * yet while any are left; after that, a repeat turns into season XP.
 */
export function openPack(prev: Progress, at: number, rand: Rand, paid: boolean): PackResult | Fail {
  const s = seasonAt(at);
  if (!s) return { error: "No season is running right now." };
  const pass = currentPass(prev, at)!;
  if (paid) {
    if (prev.chips < PACK_PRICE + PACK_KEEP) return { error: `A pack costs ${PACK_PRICE.toLocaleString()} chips, and you need ${PACK_KEEP.toLocaleString()} left after buying.` };
  } else if (pass.packs < 1) return { error: "You don't have a free pack to open." };
  const p: Progress = structuredClone(prev);
  p.pass = { ...pass, packs: pass.packs - (paid ? 0 : 1) };
  if (paid) p.chips -= PACK_PRICE;
  const items: string[] = [];
  let dupes = 0;
  for (let i = 0; i < PACK_SIZE; i++) {
    const unowned = s.packItems.filter((c) => !p.owned.includes(c.id));
    const rarity = rollRarity(rand);
    const ofRarity = unowned.filter((c) => (c.rarity ?? "common") === rarity);
    const fresh = ofRarity.length ? ofRarity : unowned;
    if (!fresh.length) {
      dupes++;
      continue;
    }
    const c = fresh[rand(fresh.length)];
    p.owned.push(c.id);
    items.push(c.id);
  }
  const dupeXp = dupes * DUPE_XP;
  if (dupeXp) addPassXp(p, dupeXp, at);
  if (paid) p.packsBought = (p.packsBought ?? 0) + 1;
  return { progress: p, items, dupeXp };
}

function rollRarity(rand: Rand): Rarity {
  const entries = Object.entries(PACK_ODDS) as [Rarity, number][];
  const total = entries.reduce((t, [, w]) => t + w, 0);
  let roll = (rand(1_000_000) / 1_000_000) * total;
  for (const [r, w] of entries) if ((roll -= w) < 0) return r;
  return entries[0][0];
}

/** How many of a season's items the player has. */
export function seasonOwned(p: Progress, s: Season) {
  const all = [...s.passItems, ...s.packItems];
  return { have: all.filter((c) => p.owned.includes(c.id)).length, of: all.length };
}

export const isSeasonItem = (id: string) => !!cosmetic(id)?.season;
