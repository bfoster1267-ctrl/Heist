// A player's progression: play chips, coins, XP, prestige, career stats and cosmetics, with the pure
// rules that change them. The game server stores one of these per account; the web app keeps one in
// the browser when no server is configured. Both run these same functions, so rewards always match.

import { COSMETICS, DEFAULT_EQUIPPED, cosmetic, drink, equippable, freeWith, unlocked, type EquipSlot } from "./cosmetics";
import { MAX_LEVEL, MAX_PRESTIGE, levelInfo, levelUpCoins, prestigeCoins, xpForLevel } from "./levels";
import { addGame, emptyStats, type CareerStats, type GameResult } from "./stats";
import { TIER_XP, addPassXp, passLines, type PassResult, type PassState } from "./season";
import { addCounts, type MistakeCounts } from "./coach";
import { SOL_XP, tallyXp, type SolTally } from "./solitaire";
import { FC_XP, tallyFcXp, type FcTally } from "./freecell";
import { TP_XP, tallyTpXp, type TpTally } from "./tripeaks";
import { ERS_XP, tallyErsXp, type ErsTally } from "./ers";
import { SPIDER_XP, tallySpiderXp, type SpiderTally } from "./spider";
import { PYRAMID_XP, tallyPyramidXp, type PyramidTally } from "./pyramid";
import { YUKON_XP, tallyYukonXp, type YukonTally, YUKON_DAY_XP } from "./yukon";
import { SCOUNDREL_XP, tallyScoundrelXp, type ScoundrelTally, SCOUNDREL_DAY_XP } from "./scoundrel";
import { CHECKERS_XP, tallyCheckersXp, type CheckersTally, CHECKERS_DAY_XP } from "./checkers";
import { START_RATING, rate } from "./rating";
import { stage } from "./campaign";
import { playRanked, type RankedResult, type RankedState } from "./ranked";
import {
  type DailyCompletionResult,
  type DailyProgress,
  getDailyChallenge,
  isChallengeCompleted,
  newDailyProgress,
  recordDailyCompletion,
} from "./daily";

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
  /** hidden skill rating (see rating.ts) and how many games have moved it */
  rating: number;
  ratedGames: number;
  /** campaign stages cleared */
  campaign: number;
  /** Ranked: rank points, Ranked MMR and this season's record (null before the first ranked game) */
  ranked: RankedState | null;
  /** Solitaire: games won, and XP paid today (UTC day) toward the daily ceiling */
  solitaire: { won: number; day: string | null; xp: number };
  /** FreeCell: games won, and XP paid today (UTC day) toward the daily ceiling */
  freecell?: { won: number; day: string | null; xp: number };
  /** TriPeaks: games won, and XP paid today (UTC day) toward the daily ceiling */
  tripeaks?: { won: number; day: string | null; xp: number };
  /** Egyptian Rat Screw: games won, and XP paid today (UTC day) toward the daily ceiling */
  ers?: { won: number; day: string | null; xp: number };
  /** Spider Solitaire: games won, and XP paid today (UTC day) toward the daily ceiling */
  spider?: { won: number; day: string | null; xp: number };
  /** Pyramid Solitaire: games won, and XP paid today (UTC day) toward the daily ceiling */
  pyramid?: { won: number; day: string | null; xp: number };
  /** Yukon Solitaire: games won, and XP paid today (UTC day) toward the daily ceiling */
  yukon?: { won: number; day: string | null; xp: number };
  /** Scoundrel: games won, and XP paid today (UTC day) toward the daily ceiling */
  scoundrel?: { won: number; day: string | null; xp: number };
  /** Checkers vs bot: games won, and XP paid today (UTC day) toward the daily ceiling */
  checkers?: { won: number; day: string | null; xp: number };
  /** Daily challenge and streak tracking across solo games */
  daily?: DailyProgress;
}

export function newProgress(): Progress {
  return {
    chips: START_CHIPS, coins: START_COINS, xp: 0, prestige: 0, stats: emptyStats(), owned: [],
    equipped: { ...DEFAULT_EQUIPPED }, pass: null, packsBought: 0, winBonusDay: null, dailyDay: null, drinksSent: 0, drinksReceived: 0,
    mistakes: {}, coachGames: 0,
    rating: START_RATING, ratedGames: 0, campaign: 0, ranked: null,
    solitaire: { won: 0, day: null, xp: 0 },
    freecell: { won: 0, day: null, xp: 0 },
    tripeaks: { won: 0, day: null, xp: 0 },
    ers: { won: 0, day: null, xp: 0 },
    spider: { won: 0, day: null, xp: 0 },
    pyramid: { won: 0, day: null, xp: 0 },
    yukon: { won: 0, day: null, xp: 0 },
    scoundrel: { won: 0, day: null, xp: 0 },
    checkers: { won: 0, day: null, xp: 0 },
    daily: newDailyProgress(),
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
  /** a ranked game: rank points and Ranked MMR before and after */
  ranked?: RankedResult;
  /** Daily challenge details if completed */
  daily?: DailyCompletionResult;
}

/** Ranked pays more than Casual: on top of the usual lines. */
export const RANKED_BONUS = { xp: 60, coins: 15, topHalfXp: 40 };

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
  if (r.ranked) {
    lines.push({ label: "Ranked game", xp: RANKED_BONUS.xp, coins: RANKED_BONUS.coins });
    if (r.ranked.span[0] < r.players / 2) lines.push({ label: "Top-half finish", xp: RANKED_BONUS.topHalfXp, coins: 0 });
  }
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
  // the first clear of the next campaign stage
  const cleared = r.won && !r.quit && r.campaign !== undefined && r.campaign === p.campaign + 1 ? stage(r.campaign) : undefined;
  if (cleared) {
    lines.push({ label: `Cleared ${cleared.name}`, xp: cleared.xp, coins: cleared.coins });
    p.campaign = cleared.n;
    for (const id of cleared.items ?? []) if (!p.owned.includes(id)) p.owned.push(id);
  }
  // ranked: rank points and Ranked MMR (the hidden Casual rating doesn't move)
  let ranked: RankedResult | undefined;
  if (r.ranked) {
    const g = playRanked(p.ranked, r.ranked);
    p.ranked = g.state;
    ranked = g.result;
    if (ranked.seasonReward) lines.push({ label: `Season rank: ${ranked.seasonReward.label}`, xp: 0, coins: ranked.seasonReward.coins });
  }
  let xp = lines.reduce((t, l) => t + l.xp, 0);
  let coins = lines.reduce((t, l) => t + l.coins, 0);

  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  const unlockedNow: string[] = [...(cleared?.items ?? [])];
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
  // coached games teach; they don't count toward skill
  if (r.rivals?.length && !r.coached && !r.ranked) {
    p.rating = rate(p.rating, p.ratedGames, r.won, r.rivals, r.quit);
    p.ratedGames++;
  }
  const passXp = passLines(r, firstWin).reduce((t, l) => t + l.xp, 0);
  const pass = passXp ? addPassXp(p, passXp, r.at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: r.payout,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass, ...(ranked ? { ranked } : {}),
    },
  };
}

/** Coached play pays a little XP and nothing else: no chips, coins, season XP or career stats. */
export const COACH_XP = { played: 25, won: 25 };
/** The one exception: a new player's very first hand opens season pass tier 1, so the pass is something they already have. */
export const FIRST_HAND_PASS_XP = TIER_XP;

/** Record a finished Coached play game (`firstHand` at `at`: the new player's one-hand first lesson). */
export function settleCoached(prev: Progress, won: boolean, firstHand?: { at: number }): { progress: Progress; reward: Reward } {
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
  // only ever once: their first coached game, before any season XP
  const pass = firstHand && !prev.coachGames && !prev.pass?.xp ? addPassXp(p, FIRST_HAND_PASS_XP, firstHand.at) : null;
  p.coachGames++;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
    },
  };
}

function applyDailyBonus(
  p: Progress,
  game: string,
  at: number,
  wonOrGoalMet: boolean
): { daily?: DailyCompletionResult; bonusLines: RewardLine[] } {
  if (!wonOrGoalMet) return { bonusLines: [] };
  const completion = recordDailyCompletion(p, game, day(at));
  p.daily = completion.progress.daily;
  const bonusLines: RewardLine[] = [];
  if (completion.bonusXp > 0) {
    const baseXp = Math.round(completion.baseBonusXp * completion.multiplier);
    bonusLines.push({
      label: `Daily Challenge: ${completion.challenge.title}`,
      xp: baseXp,
      coins: completion.bonusCoins - (completion.milestoneBonus?.coins ?? 0),
    });
  }
  if (completion.milestoneBonus) {
    bonusLines.push({
      label: completion.milestoneBonus.label,
      xp: completion.milestoneBonus.xp,
      coins: completion.milestoneBonus.coins,
    });
  }
  return { daily: completion, bonusLines };
}

/**
 * Record a completed daily challenge for any of the daily solo games.
 * Grants daily challenge bonus XP, streak multipliers, and streak milestone bonuses.
 */
export function settleDailyChallenge(
  prev: Progress,
  game: string,
  at: number,
  outcome: {
    won?: boolean;
    score?: number;
    roomsCleared?: number;
    peaks?: number;
    suits?: number;
  } = { won: true }
): { progress: Progress; reward: Reward; daily: DailyCompletionResult } | Fail {
  const today = day(at);
  const challenge = getDailyChallenge(game, today);
  if (!isChallengeCompleted(challenge, outcome)) {
    return { error: `Challenge goal not met: ${challenge.goal.description}` };
  }

  const p: Progress = structuredClone(prev);
  const completion = recordDailyCompletion(p, game, today);
  p.daily = completion.progress.daily;

  const lines: RewardLine[] = [];
  if (completion.bonusXp > 0) {
    const baseXp = Math.round(completion.baseBonusXp * completion.multiplier);
    lines.push({
      label: `Daily Challenge: ${challenge.title}`,
      xp: baseXp,
      coins: completion.bonusCoins - (completion.milestoneBonus?.coins ?? 0),
    });
  }
  if (completion.milestoneBonus) {
    lines.push({
      label: completion.milestoneBonus.label,
      xp: completion.milestoneBonus.xp,
      coins: completion.milestoneBonus.coins,
    });
  }
  if (lines.length === 0) {
    lines.push({
      label: `Daily Challenge: ${challenge.title} (already cleared today)`,
      xp: 0,
      coins: 0,
    });
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
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

  const pass = xp ? addPassXp(p, xp, at) : null;

  return {
    progress: p,
    reward: {
      xp,
      coins,
      lines,
      payout: 0,
      levelBefore: before.level,
      levelAfter: after.level,
      xpBefore: before.into,
      xpAfter: after.into,
      unlocked: unlockedNow,
      canPrestige: canPrestige(p),
      pass,
      daily: completion,
    },
    daily: completion,
  };
}

/**
 * Solitaire XP a day (paid the same in season XP): about two games, so Solitaire is a side snack and
 * Heist stays the game worth grinding (one Heist game pays more pass XP than this whole day).
 */
export const SOLITAIRE_DAY_XP = 500;

/** Solitaire XP still to be earned today. */
export const solitaireRoom = (p: Progress, at: number) => Math.max(0, SOLITAIRE_DAY_XP - (p.solitaire.day === day(at) ? p.solitaire.xp ?? 0 : 0));

/**
 * Speed bonus: for wins completed in under 5 minutes (300 seconds), awards 1 bonus XP per second remaining.
 */
export function speedBonus(seconds?: number, maxSecs = 300): RewardLine | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds >= maxSecs) return null;
  const s = Math.floor(seconds);
  const bonus = maxSecs - s;
  if (bonus <= 0) return null;
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return { label: `Speed bonus (${m}:${sec})`, xp: bonus, coins: 0 };
}

/** The speed bonus trimmed to the XP still left in today's room for this game (null when none is left). */
function fitSpeed(speed: RewardLine | null, left: number): RewardLine | null {
  if (!speed || left <= 0) return null;
  return speed.xp > left ? { ...speed, xp: left } : speed;
}

/**
 * Pay for Solitaire play the server has checked by replaying the moves. `gained` is what the deal
 * earned beyond what was already paid for it (see tallySol); `pay` is what it comes to after stalling
 * and hints drained some off (see solPay).
 */
export function settleSolitaire(
  prev: Progress,
  at: number,
  gained: SolTally,
  pay = tallyXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  // (saves from before the XP ceiling have no xp yet)
  const s = { ...p.solitaire, xp: p.solitaire.xp ?? 0 };
  if (s.day !== today) Object.assign(s, { day: today, xp: 0 });
  if (gained.won) s.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.moves, "new move", "new moves"), xp: gained.moves * SOL_XP.move, coins: 0 },
    { label: plural(gained.aces, "ace sent up", "aces sent up"), xp: gained.aces * SOL_XP.ace, coins: 0 },
    { label: plural(gained.stacks, "suit finished", "suits finished"), xp: gained.stacks * SOL_XP.stack, coins: 0 },
    { label: "Solitaire solved", xp: gained.won ? SOL_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);
  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play and hints", xp: total - earned, coins: 0 });
  const room = Math.max(0, SOLITAIRE_DAY_XP - s.xp);
  if (total > room) lines = [{ label: "Solitaire (daily XP limit reached)", xp: room, coins: 0 }];
  s.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.solitaire = s;

  const dailyResult = isDaily ? applyDailyBonus(p, "solitaire", at, gained.won) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    s.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

export const FREECELL_DAY_XP = 500;

/** FreeCell XP still to be earned today. */
export const freecellRoom = (p: Progress, at: number) =>
  Math.max(0, FREECELL_DAY_XP - (p.freecell?.day === day(at) ? p.freecell?.xp ?? 0 : 0));

/**
 * Pay for FreeCell play checked by replaying the moves.
 */
export function settleFreeCell(
  prev: Progress,
  at: number,
  gained: FcTally,
  pay = tallyFcXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const fc = { ...(p.freecell ?? { won: 0, day: null, xp: 0 }), xp: p.freecell?.xp ?? 0 };
  if (fc.day !== today) Object.assign(fc, { day: today, xp: 0 });
  if (gained.won) fc.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.moves, "new move", "new moves"), xp: gained.moves * FC_XP.move, coins: 0 },
    { label: plural(gained.aces, "ace sent up", "aces sent up"), xp: gained.aces * FC_XP.ace, coins: 0 },
    { label: plural(gained.stacks, "suit finished", "suits finished"), xp: gained.stacks * FC_XP.stack, coins: 0 },
    { label: "FreeCell solved", xp: gained.won ? FC_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);
  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play and hints", xp: total - earned, coins: 0 });
  const room = Math.max(0, FREECELL_DAY_XP - fc.xp);
  if (total > room) lines = [{ label: "FreeCell (daily XP limit reached)", xp: room, coins: 0 }];
  fc.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.freecell = fc;

  const dailyResult = isDaily ? applyDailyBonus(p, "freecell", at, gained.won) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    fc.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

export const TRIPEAKS_DAY_XP = 500;

/** TriPeaks XP still to be earned today. */
export const tripeaksRoom = (p: Progress, at: number) =>
  Math.max(0, TRIPEAKS_DAY_XP - (p.tripeaks?.day === day(at) ? p.tripeaks?.xp ?? 0 : 0));

/**
 * Pay for TriPeaks play checked by replaying the moves.
 */
export function settleTriPeaks(
  prev: Progress,
  at: number,
  gained: TpTally,
  pay = tallyTpXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const tp = { ...(p.tripeaks ?? { won: 0, day: null, xp: 0 }), xp: p.tripeaks?.xp ?? 0 };
  if (tp.day !== today) Object.assign(tp, { day: today, xp: 0 });
  if (gained.won) tp.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.cleared, "card cleared", "cards cleared"), xp: gained.cleared * TP_XP.clear, coins: 0 },
    { label: plural(gained.peaks, "peak cleared", "peaks cleared"), xp: gained.peaks * TP_XP.peak, coins: 0 },
    { label: "TriPeaks cleared", xp: gained.won ? TP_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);
  const hasStreak10 = "streak10" in gained ? Boolean((gained as any).streak10) : gained.maxStreak >= 10;
  const hasStreak5 = "streak5" in gained ? Boolean((gained as any).streak5) : gained.maxStreak >= 5;
  if (hasStreak10) lines.push({ label: "10-card combo streak", xp: TP_XP.streak10, coins: 0 });
  if (hasStreak5) lines.push({ label: "5-card combo streak", xp: TP_XP.streak5, coins: 0 });

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play and hints", xp: total - earned, coins: 0 });
  const room = Math.max(0, TRIPEAKS_DAY_XP - tp.xp);
  if (total > room) lines = [{ label: "TriPeaks (daily XP limit reached)", xp: room, coins: 0 }];
  tp.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.tripeaks = tp;

  const challenge = getDailyChallenge("tripeaks", today);
  const dailyResult = isDaily ? applyDailyBonus(p, "tripeaks", at, isChallengeCompleted(challenge, gained)) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    tp.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

export const ERS_DAY_XP = 500;

/** ERS XP still to be earned today. */
export const ersRoom = (p: Progress, at: number) =>
  Math.max(0, ERS_DAY_XP - (p.ers?.day === day(at) ? p.ers?.xp ?? 0 : 0));

/**
 * Pay for Egyptian Rat Screw play checked by replaying the moves.
 */
export function settleErs(
  prev: Progress,
  at: number,
  gained: ErsTally,
  pay = tallyErsXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const ers = { ...(p.ers ?? { won: 0, day: null, xp: 0 }), xp: p.ers?.xp ?? 0 };
  if (ers.day !== today) Object.assign(ers, { day: today, xp: 0 });
  if (gained.won) ers.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.slaps, "successful slap", "successful slaps"), xp: gained.slaps * ERS_XP.slap, coins: 0 },
    { label: plural(gained.faceChallengesWon, "face challenge won", "face challenges won"), xp: gained.faceChallengesWon * ERS_XP.challenge, coins: 0 },
    { label: "ERS victory", xp: gained.won ? ERS_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play penalties", xp: total - earned, coins: 0 });
  const room = Math.max(0, ERS_DAY_XP - ers.xp);
  if (total > room) lines = [{ label: "Egyptian Rat Screw (daily XP limit reached)", xp: room, coins: 0 }];
  ers.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.ers = ers;

  const dailyResult = isDaily ? applyDailyBonus(p, "ers", at, gained.won) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    ers.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

export const SPIDER_DAY_XP = 500;

/** Spider XP still to be earned today. */
export const spiderRoom = (p: Progress, at: number) =>
  Math.max(0, SPIDER_DAY_XP - (p.spider?.day === day(at) ? p.spider?.xp ?? 0 : 0));

/**
 * Pay for Spider Solitaire play checked by replaying the moves.
 */
export function settleSpider(
  prev: Progress,
  at: number,
  gained: SpiderTally,
  pay = tallySpiderXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const sp = { ...(p.spider ?? { won: 0, day: null, xp: 0 }), xp: p.spider?.xp ?? 0 };
  if (sp.day !== today) Object.assign(sp, { day: today, xp: 0 });
  if (gained.won) sp.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.completedRuns, "suit run cleared", "suit runs cleared"), xp: gained.completedRuns * SPIDER_XP.run, coins: 0 },
    { label: "Spider Solitaire solved", xp: gained.won ? SPIDER_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play penalties", xp: total - earned, coins: 0 });
  const room = Math.max(0, SPIDER_DAY_XP - sp.xp);
  if (total > room) lines = [{ label: "Spider Solitaire (daily XP limit reached)", xp: room, coins: 0 }];
  sp.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.spider = sp;

  const challenge = getDailyChallenge("spider", today);
  const dailyResult = isDaily ? applyDailyBonus(p, "spider", at, isChallengeCompleted(challenge, gained)) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    sp.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

export const PYRAMID_DAY_XP = 500;

/** Pyramid XP still to be earned today. */
export const pyramidRoom = (p: Progress, at: number) =>
  Math.max(0, PYRAMID_DAY_XP - (p.pyramid?.day === day(at) ? p.pyramid?.xp ?? 0 : 0));

/**
 * Pay for Pyramid Solitaire play checked by replaying the moves.
 */
export function settlePyramid(
  prev: Progress,
  at: number,
  gained: PyramidTally,
  pay = tallyPyramidXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const pyr = { ...(p.pyramid ?? { won: 0, day: null, xp: 0 }), xp: p.pyramid?.xp ?? 0 };
  if (pyr.day !== today) Object.assign(pyr, { day: today, xp: 0 });
  if (gained.won) pyr.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.clearedCards, "pyramid card cleared", "pyramid cards cleared"), xp: gained.clearedCards * PYRAMID_XP.clear, coins: 0 },
    { label: "Pyramid cleared", xp: gained.won ? PYRAMID_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play penalties", xp: total - earned, coins: 0 });
  const room = Math.max(0, PYRAMID_DAY_XP - pyr.xp);
  if (total > room) lines = [{ label: "Pyramid Solitaire (daily XP limit reached)", xp: room, coins: 0 }];
  pyr.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.pyramid = pyr;

  const dailyResult = isDaily ? applyDailyBonus(p, "pyramid", at, gained.won) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    pyr.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

/** Yukon XP still to be earned today. */
export const yukonRoom = (p: Progress, at: number) =>
  Math.max(0, YUKON_DAY_XP - (p.yukon?.day === day(at) ? p.yukon?.xp ?? 0 : 0));

/**
 * Pay for Yukon Solitaire play checked by replaying the moves.
 */
export function settleYukon(
  prev: Progress,
  at: number,
  gained: YukonTally,
  pay = tallyYukonXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const yk = { ...(p.yukon ?? { won: 0, day: null, xp: 0 }), xp: p.yukon?.xp ?? 0 };
  if (yk.day !== today) Object.assign(yk, { day: today, xp: 0 });
  if (gained.won) yk.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.unturned, "card turned up", "cards turned up"), xp: gained.unturned * YUKON_XP.turn, coins: 0 },
    { label: plural(gained.foundations, "card to foundation", "cards to foundation"), xp: gained.foundations * YUKON_XP.foundation, coins: 0 },
    { label: "Yukon cleared", xp: gained.won ? YUKON_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play penalties", xp: total - earned, coins: 0 });
  const room = Math.max(0, YUKON_DAY_XP - yk.xp);
  if (total > room) lines = [{ label: "Yukon Solitaire (daily XP limit reached)", xp: room, coins: 0 }];
  yk.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.yukon = yk;

  const dailyResult = isDaily ? applyDailyBonus(p, "yukon", at, gained.won) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    yk.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

/** Scoundrel XP still to be earned today. */
export const scoundrelRoom = (p: Progress, at: number) =>
  Math.max(0, SCOUNDREL_DAY_XP - (p.scoundrel?.day === day(at) ? p.scoundrel?.xp ?? 0 : 0));

/**
 * Pay for Scoundrel play checked by replaying the moves.
 */
export function settleScoundrel(
  prev: Progress,
  at: number,
  gained: ScoundrelTally,
  pay = tallyScoundrelXp(gained),
  isDaily = false,
  secondsTaken?: number
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const sc = { ...(p.scoundrel ?? { won: 0, day: null, xp: 0 }), xp: p.scoundrel?.xp ?? 0 };
  if (sc.day !== today) Object.assign(sc, { day: today, xp: 0 });
  if (gained.won) sc.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let lines: RewardLine[] = [
    { label: plural(gained.monstersSlayed, "monster slayed", "monsters slayed"), xp: gained.monstersSlayed * SCOUNDREL_XP.monster, coins: 0 },
    { label: plural(gained.roomsCleared, "room cleared", "rooms cleared"), xp: gained.roomsCleared * SCOUNDREL_XP.room, coins: 0 },
    { label: "Escaped the dungeon", xp: gained.won ? SCOUNDREL_XP.win : 0, coins: 0 },
  ].filter((l) => l.xp > 0);

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play penalties", xp: total - earned, coins: 0 });
  const room = Math.max(0, SCOUNDREL_DAY_XP - sc.xp);
  if (total > room) lines = [{ label: "Scoundrel (daily XP limit reached)", xp: room, coins: 0 }];
  sc.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.scoundrel = sc;

  const challenge = getDailyChallenge("scoundrel", today);
  const dailyResult = isDaily ? applyDailyBonus(p, "scoundrel", at, isChallengeCompleted(challenge, gained)) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  // speed XP comes out of the same daily room as the deal, so quick wins can't farm past the limit
  const speed = gained.won ? fitSpeed(speedBonus(secondsTaken), room - Math.min(total, room)) : null;
  if (speed) {
    lines.push(speed);
    sc.xp += speed.xp;
  }

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0) + (speed?.xp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
    },
  };
}

/** Checkers XP still to be earned today. */
export const checkersRoom = (p: Progress, at: number) =>
  Math.max(0, CHECKERS_DAY_XP - (p.checkers?.day === day(at) ? p.checkers?.xp ?? 0 : 0));

const CHECKERS_NAMES = { rookie: "Rookie", pro: "Pro", boss: "Boss" } as const;

/**
 * Pay for Checkers play checked by replaying your moves against the same bot.
 * No speed bonus here: a quick win over the bot is already paid by its level.
 */
export function settleCheckers(
  prev: Progress,
  at: number,
  gained: CheckersTally,
  pay = tallyCheckersXp(gained),
  isDaily = false
): { progress: Progress; reward: Reward } {
  const p: Progress = structuredClone(prev);
  const today = day(at);
  const ck = { ...(p.checkers ?? { won: 0, day: null, xp: 0 }), xp: p.checkers?.xp ?? 0 };
  if (ck.day !== today) Object.assign(ck, { day: today, xp: 0 });
  if (gained.won) ck.won++;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const bot = CHECKERS_NAMES[gained.level] ?? "Rookie";
  let lines: RewardLine[] = [
    { label: plural(gained.captures, "piece captured", "pieces captured"), xp: gained.captures * CHECKERS_XP.capture, coins: 0 },
    { label: `Beat the ${bot} bot`, xp: gained.won ? CHECKERS_XP.win[gained.level] ?? 0 : 0, coins: 0 },
    { label: `Drew the ${bot} bot`, xp: gained.drawn ? CHECKERS_XP.draw[gained.level] ?? 0 : 0, coins: 0 },
  ].filter((l) => l.xp > 0);

  const earned = lines.reduce((t, l) => t + l.xp, 0);
  const total = Math.max(0, Math.min(earned, Number.isFinite(pay) ? pay : 0));
  if (total < earned) lines.push({ label: "Slow play penalties", xp: total - earned, coins: 0 });
  const room = Math.max(0, CHECKERS_DAY_XP - ck.xp);
  if (total > room) lines = [{ label: "Checkers (daily XP limit reached)", xp: room, coins: 0 }];
  ck.xp += Math.min(total, room);
  const regularSeason = Math.min(total, room);
  p.checkers = ck;

  const challenge = getDailyChallenge("checkers", today);
  const dailyResult = isDaily ? applyDailyBonus(p, "checkers", at, isChallengeCompleted(challenge, gained)) : { bonusLines: [] };
  if (dailyResult.bonusLines.length) lines.push(...dailyResult.bonusLines);

  const xp = lines.reduce((t, l) => t + l.xp, 0);
  const before = levelInfo(p.xp);
  p.xp = Math.min(xpCap(), p.xp + xp);
  const after = levelInfo(p.xp);
  let coins = lines.reduce((t, l) => t + l.coins, 0);
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
  const seasonXp = regularSeason + (dailyResult.daily?.bonusXp ?? 0);
  const pass = seasonXp ? addPassXp(p, seasonXp, at) : null;
  return {
    progress: p,
    reward: {
      xp, coins, lines, payout: 0,
      levelBefore: before.level, levelAfter: after.level, xpBefore: before.into, xpAfter: after.into,
      unlocked: unlockedNow, canPrestige: canPrestige(p), pass,
      ...(dailyResult.daily ? { daily: dailyResult.daily } : {}),
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
  if (c.campaign) return { error: `Clear campaign stage ${c.campaign} to earn that one.` };
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

export function upgrade(p: Partial<Progress>): Progress {
  const base = newProgress();
  return {
    ...base,
    ...p,
    stats: { ...base.stats, ...p.stats },
    equipped: { ...base.equipped, ...p.equipped },
    solitaire: { ...base.solitaire, ...p.solitaire },
    freecell: { ...(base.freecell ?? { won: 0, day: null, xp: 0 }), ...p.freecell },
    tripeaks: { ...(base.tripeaks ?? { won: 0, day: null, xp: 0 }), ...p.tripeaks },
    ers: { ...(base.ers ?? { won: 0, day: null, xp: 0 }), ...p.ers },
    spider: { ...(base.spider ?? { won: 0, day: null, xp: 0 }), ...p.spider },
    pyramid: { ...(base.pyramid ?? { won: 0, day: null, xp: 0 }), ...p.pyramid },
    yukon: { ...(base.yukon ?? { won: 0, day: null, xp: 0 }), ...p.yukon },
    scoundrel: { ...(base.scoundrel ?? { won: 0, day: null, xp: 0 }), ...p.scoundrel },
    checkers: { ...(base.checkers ?? { won: 0, day: null, xp: 0 }), ...p.checkers },
    daily: p.daily
      ? {
          ...base.daily,
          ...p.daily,
          streak: { ...(base.daily?.streak ?? { current: 0, longest: 0, lastDate: null }), ...(p.daily.streak ?? {}) },
          byGame: { ...(base.daily?.byGame ?? {}), ...(p.daily.byGame ?? {}) },
          completed: { ...(base.daily?.completed ?? {}), ...(p.daily.completed ?? {}) },
          completedDays: { ...(base.daily?.completedDays ?? {}), ...(p.daily.completedDays ?? {}) },
        }
      : base.daily,
  };
}
