// A player's progression: play chips, coins, XP, prestige, career stats and cosmetics, with the pure
// rules that change them. The game server stores one of these per account; the web app keeps one in
// the browser when no server is configured. Both run these same functions, so rewards always match.

import { COSMETICS, DEFAULT_EQUIPPED, cosmetic, drink, equippable, freeWith, unlocked, type EquipSlot } from "./cosmetics";
import { MAX_LEVEL, MAX_PRESTIGE, levelInfo, levelUpCoins, prestigeCoins, xpForLevel } from "./levels";
import { addGame, emptyStats, type CareerStats, type GameResult } from "./stats";
import { addPassXp, passLines, type PassResult, type PassState } from "./season";
import { addCounts, type MistakeCounts } from "./coach";

export const START_CHIPS = 10_000;
/** Enough for one cheap cosmetic straight away. */
export const START_COINS = 300;
/** Broke players can top back up to this many chips (play money only). */
export const REFILL_TO = 2_500;
/** Once a day, free chips. */
export const DAILY_CHIPS = 500;

export interface Progress {
  chips: number;
  coins: number;
  /** XP within the current prestige (level comes from levelInfo) */
  xp: number;
  prestige: number;
  stats: CareerStats;
  /** cosmetics bought with coins (free unlocks aren't listed; they're worked out from level and prestige) */
  owned: string[];
  equipped: Record<EquipSlot, string>;
  /** this season's pass (season XP and unopened free packs); null before the first season game */
  pass: PassState | null;
  packsBought: number;
  /** UTC day (YYYY-MM-DD) of the last first-win-of-the-day bonus */
  winBonusDay: string | null;
  /** UTC day of the last daily chip bonus */
  dailyDay: string | null;
  drinksSent: number;
  drinksReceived: number;
  /** rookie mistakes made in vs-bot games (coach.ts), so the coach can lean on the ones you repeat */
  mistakes: MistakeCounts;
  /** Coached play games finished (they don't count in the career stats) */
  coachGames: number;
}

export function newProgress(): Progress {
  return {
    chips: START_CHIPS, coins: START_COINS, xp: 0, prestige: 0, stats: emptyStats(), owned: [],
    equipped: { ...DEFAULT_EQUIPPED }, pass: null, packsBought: 0, winBonusDay: null, dailyDay: null, drinksSent: 0, drinksReceived: 0,
    mistakes: {}, coachGames: 0,
  };
}

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export interface RewardLine {
  label: string;
  xp: number;
  coins: number;
}

export interface Reward {
  xp: number;
  coins: number;
  lines: RewardLine[];
  /** chips paid out from the pot */
  payout: number;
  levelBefore: number;
  levelAfter: number;
  /** XP into the level, before and after, for the animated bar */
  xpBefore: number;
  xpAfter: number;
  /** cosmetics that became free with this game's level-ups */
  unlocked: string[];
  canPrestige: boolean;
  /** the season pass: XP earned, tiers reached and what they gave (null between seasons) */
  pass?: PassResult | null;
}

/** Work out XP and coins for a game. */
export function rewardLines(r: GameResult, firstWinToday: boolean): RewardLine[] {
  if (r.quit) return [{ label: "Abandoned the game", xp: 0, coins: 0 }];
  const s = r.summary;
  const lines: RewardLine[] = [{ label: "Played a game", xp: 50, coins: 5 }];
  if (r.won) lines.push({ label: "Won", xp: 100, coins: 20 });
  if (r.won && r.players > 3) lines.push({ label: `Beat a ${r.players}-player table`, xp: 15 * (r.players - 3), coins: 0 });
  if (r.mode === "online") lines.push({ label: "Online table", xp: 25, coins: 5 });
  if (s.footholds) lines.push({ label: `Footholds x${s.footholds}`, xp: 10 * Math.min(s.footholds, 8), coins: 0 });
  if (s.jobsWon) lines.push({ label: `Jobs pulled off x${s.jobsWon}`, xp: 5 * Math.min(s.jobsWon, 10), coins: 0 });
  if (s.defenses) lines.push({ label: `Jobs fought off x${s.defenses}`, xp: 5 * Math.min(s.defenses, 10), coins: 0 });
  if (r.won && firstWinToday) lines.push({ label: "First win of the day", xp: 100, coins: 25 });
  return lines;
}

const xpCap = () => xpForLevel(MAX_LEVEL);

/** Record a finished game: chips, career stats, XP, level-up coins. */
export function settle(prev: Progress, r: GameResult): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(r.at);
  const firstWin = r.won && !r.quit && p.winBonusDay !== today;
  const lines = rewardLines(r, firstWin);
  if (firstWin) p.winBonusDay = today;
  let xp = lines.reduce((t, l) => t + l.xp, 0);
  let coins = lines.reduce((t, l) => t + l.coins, 0);

  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  const unlockedNow: string[] = [];
  for (let l = before.level + 1; l <= after.level; l++) {
    const c = levelUpCoins(l);
    coins += c;
    lines.push({ label: `Reached level ${l}`, xp: 0, coins: c });
  }
  if (after.level > before.level) {
    for (const c of COSMETICS) if (freeWith(c, after.level, p.prestige) && !freeWith(c, before.level, p.prestige)) unlockedNow.push(c.id);
  }
  p.coins += coins;
  p.chips += r.payout;
  p.stats = addGame(p.stats, r, xp);
  const passXp = passLines(r, firstWin).reduce((t, l) => t + l.xp, 0);
  const pass = passXp ? addPassXp(p, passXp, r.at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: r.payout,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
    },
  };
}

/** Coached play pays a little XP and nothing else: no chips, coins, season XP or career stats. */
export const COACH_XP = { played: 25, won: 25 };

/** Record a finished Coached play game. */
export function settleCoached(prev: Progress, won: boolean): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const lines: RewardLine[] = [{ label: "Coached game", xp: COACH_XP.played, coins: 0 }];
  if (won) lines.push({ label: "Won", xp: COACH_XP.won, coins: 0 });
  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = 0;
  const unlockedNow: string[] = [];
  for (let l = before.level + 1; l <= after.level; l++) {
    const c = levelUpCoins(l);
    coins += c;
    lines.push({ label: `Reached level ${l}`, xp: 0, coins: c });
  }
  if (after.level > before.level) {
    for (const c of COSMETICS) if (freeWith(c, after.level, p.prestige) && !freeWith(c, before.level, p.prestige)) unlockedNow.push(c.id);
  }
  p.coins += coins;
  p.coachGames++;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass: null,
    },
  };
}

/** Add one game's rookie mistakes to the player's tally. */
export function addMistakes(prev: Progress, m: MistakeCounts): Progress {
  return { ...prev, mistakes: addCounts(prev.mistakes ?? {}, m) };
}

export const level = (p: Progress) => levelInfo(p.xp).level;
export const canPrestige = (p: Progress) => level(p) >= MAX_LEVEL && p.prestige < MAX_PRESTIGE;

export type Fail = { error: string };
export const failed = <T extends object>(x: T | Fail): x is Fail => "error" in x;

/** Back to level 1 with a prestige star and a coin payout. Stats and cosmetics stay. */
export function prestige(prev: Progress): { progress: Progress; coins: number; unlocked: string[] } | Fail {
  if (!canPrestige(prev)) return { error: prev.prestige >= MAX_PRESTIGE ? "You're already at the top prestige." : `Reach level ${MAX_LEVEL} to prestige.` };
  const p: Progress = structuredClone(prev);
  p.prestige++;
  p.xp = 0;
  const coins = prestigeCoins(p.prestige);
  p.coins += coins;
  const unlockedNow = COSMETICS.filter((c) => c.unlock?.prestige === p.prestige && freeWith(c, 1, p.prestige)).map((c) => c.id);
  return { progress: p, coins, unlocked: unlockedNow };
}

/** Owned: bought, or free with the player's level and prestige. */
export function owns(p: Progress, id: string): boolean {
  const c = cosmetic(id);
  if (!c) return false;
  return p.owned.includes(id) || freeWith(c, level(p), p.prestige);
}

export function buy(prev: Progress, id: string): Progress | Fail {
  const c = cosmetic(id);
  if (!c) return { error: "No such item." };
  if (owns(prev, id)) return { error: "You already own that." };
  if (!unlocked(c, level(prev), prev.prestige)) return { error: "That one's still locked." };
  if (c.season) return { error: "Season items come from the season pass and packs." };
  if (c.price <= 0) return { error: "That one isn't for sale." };
  if (prev.coins < c.price) return { error: "Not enough coins." };
  const p: Progress = structuredClone(prev);
  p.coins -= c.price;
  p.owned.push(id);
  return p;
}

export function equip(prev: Progress, id: string): Progress | Fail {
  const c = cosmetic(id);
  if (!c) return { error: "No such item." };
  if (!owns(prev, id)) return { error: "You don't own that yet." };
  if (!equippable(c)) return { error: "That one's always on: find it in your chat tray or drink menu." };
  const p: Progress = structuredClone(prev);
  p.equipped[c.slot] = id;
  return p;
}

/** Pay for a drink sent to `count` players (a round goes to everyone). */
export function payForDrink(prev: Progress, id: string, count: number): Progress | Fail {
  const d = drink(id);
  if (!d) return { error: "No such drink." };
  if (cosmetic(id)?.season && !prev.owned.includes(id)) return { error: "You haven't got that drink yet." };
  const cost = d.price * (d.round ? 1 : count);
  if (prev.coins < cost) return { error: "Not enough coins." };
  const p: Progress = structuredClone(prev);
  p.coins -= cost;
  p.drinksSent += d.round ? count : 1;
  return p;
}

/** Top up a broke player, or pay the daily bonus. */
export function refill(prev: Progress): Progress | Fail {
  if (prev.chips >= REFILL_TO) return { error: `You can top up when you're under ${REFILL_TO.toLocaleString()} chips.` };
  return { ...structuredClone(prev), chips: REFILL_TO };
}

export function daily(prev: Progress, at: number): { progress: Progress; chips: number } | Fail {
  if (prev.dailyDay === day(at)) return { error: "Come back tomorrow for more free chips." };
  return { progress: { ...structuredClone(prev), chips: prev.chips + DAILY_CHIPS, dailyDay: day(at) }, chips: DAILY_CHIPS };
}

export function buyIn(prev: Progress, stakes: number): Progress | Fail {
  if (prev.chips < stakes) return { error: "Not enough chips for that table." };
  return { ...structuredClone(prev), chips: prev.chips - stakes };
}

/** Fill in fields added after a profile was saved (old saves keep working). */
export function upgrade(p: Partial<Progress>): Progress {
  const base = newProgress();
  return { ...base, ...p, stats: { ...base.stats, ...p.stats }, equipped: { ...base.equipped, ...p.equipped } };
}
