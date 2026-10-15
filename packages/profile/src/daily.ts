// Daily challenge and streak progression system for all 8 solo card games.
// Ensures every player in the world shares the exact same daily challenge deal on any given day,
// and rewards consistent daily play with scaling multipliers and milestone bonuses.

import type { Progress } from "./progress";

export const DAILY_GAMES = [
  "solitaire",
  "freecell",
  "spider",
  "tripeaks",
  "pyramid",
  "yukon",
  "ers",
  "scoundrel",
] as const;

export type DailyGame = (typeof DAILY_GAMES)[number];

export function isDailyGame(game: string): game is DailyGame {
  return (DAILY_GAMES as readonly string[]).includes(game);
}

/** Base bonus XP awarded for first completion of a daily challenge. */
export const DAILY_BASE_BONUS_XP = 50;
/** Base bonus coins awarded for first completion of a daily challenge. */
export const DAILY_BASE_BONUS_COINS = 15;

export interface StreakMilestone {
  streak: number;
  xp: number;
  coins: number;
  label: string;
}

export const STREAK_MILESTONES: Record<number, StreakMilestone> = {
  3: { streak: 3, xp: 100, coins: 25, label: "3-Day Streak Bonus" },
  7: { streak: 7, xp: 250, coins: 75, label: "7-Day Streak Bonus" },
  14: { streak: 14, xp: 500, coins: 150, label: "14-Day Streak Bonus" },
  30: { streak: 30, xp: 1000, coins: 300, label: "30-Day Streak Bonus" },
};

export function getMilestoneBonus(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES[streak] ?? null;
}

/**
 * Daily streak multiplier: scales bonus XP as consecutive days played increases.
 * - Day 1: 1.0x
 * - Day 2: 1.1x
 * - Days 3-6: 1.25x
 * - Days 7-13: 1.5x
 * - Days 14-29: 1.75x
 * - Days 30+: 2.0x
 */
export function getStreakMultiplier(streak: number): number {
  if (streak <= 1) return 1.0;
  if (streak === 2) return 1.1;
  if (streak < 7) return 1.25;
  if (streak < 14) return 1.5;
  if (streak < 30) return 1.75;
  return 2.0;
}

/**
 * Returns the player's active daily streak.
 * If the player played yesterday or today (UTC), streak is active.
 * If more than 1 day has passed without completing a daily challenge, streak has reset to 0.
 */
export function getDailyStreak(progress?: Progress | null, timestamp?: number | Date): number {
  if (!progress?.daily) return 0;
  const current = progress.daily.current ?? progress.daily.streak?.current ?? 0;
  if (current <= 0) return 0;
  const lastDate = progress.daily.lastDate ?? progress.daily.streak?.lastDate ?? null;
  if (!lastDate) return 0;
  const today = todayUtc(timestamp);
  const diff = daysBetween(lastDate, today);
  // Active if completed today (diff === 0) or yesterday (diff === 1)
  if (diff === 0 || diff === 1) {
    return current;
  }
  // Missed at least 1 full day
  return 0;
}

/** Formats current or given timestamp as UTC YYYY-MM-DD. */
export function todayUtc(timestamp?: number | Date): string {
  const d = timestamp instanceof Date ? timestamp : timestamp !== undefined ? new Date(timestamp) : new Date();
  return d.toISOString().slice(0, 10);
}

/** Origin epoch for sequential challenge numbering (2026-01-01 = Day 1). */
export const DAILY_EPOCH_DATE = "2026-01-01";

/** Returns current challenge index starting from 1 (e.g. Day #288). */
export function formatDailyChallengeNumber(dateStr?: string): number {
  const date = dateStr ?? todayUtc();
  return Math.max(1, daysBetween(DAILY_EPOCH_DATE, date) + 1);
}

/** Returns the featured daily game for a given date, rotating deterministically across all 8 games. */
export function getFeaturedDailyGame(timestamp?: number | Date): DailyGame {
  const date = todayUtc(timestamp);
  const num = formatDailyChallengeNumber(date);
  return DAILY_GAMES[(num - 1) % DAILY_GAMES.length];
}

/** Milliseconds remaining until the next UTC midnight reset. */
export function getRemainingMsUntilNextUtcDay(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(0, next - now);
}

/** Formats milliseconds into HH:MM:SS string. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Difference in calendar days between two UTC YYYY-MM-DD date strings (b - a).
 */
export function daysBetween(dateA: string, dateB: string): number {
  const [y1, m1, d1] = dateA.split("-").map(Number);
  const [y2, m2, d2] = dateB.split("-").map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const msPerDay = 86_400_000;
  return Math.round((utc2 - utc1) / msPerDay);
}

/**
 * Deterministic 32-bit hash function combining FNV-1a and Murmur3 finalizer.
 */
function hashString(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Returns a deterministic, positive 32-bit seed for a game on a UTC date (YYYY-MM-DD).
 * Same game and date always yield the same seed; different games or dates yield distinct seeds.
 */
export function getDailySeed(game: string, dateStr?: string): number {
  const date = dateStr ?? todayUtc();
  const seed = hashString(`heist-daily-seed:v1:${game.toLowerCase()}:${date}`);
  // Ensure non-zero positive integer
  return seed || 1;
}

export type ChallengeGoalType = "win" | "score" | "rooms" | "peaks" | "suits";

export interface DailyChallengeGoal {
  type: ChallengeGoalType;
  target: number;
  description: string;
}

export interface DailyChallenge {
  game: DailyGame;
  date: string;
  seed: number;
  title: string;
  description: string;
  goal: DailyChallengeGoal;
  bonusXp: number;
  bonusCoins: number;
}

const GAME_CHALLENGE_CONFIG: Record<
  DailyGame,
  {
    title: string;
    description: string;
    goal: (seed: number) => DailyChallengeGoal;
  }
> = {
  solitaire: {
    title: "Daily Solitaire Heist",
    description: "Crack today's deterministic Klondike deal and move all 52 cards to foundations.",
    goal: () => ({ type: "win", target: 1, description: "Win the Klondike deal" }),
  },
  freecell: {
    title: "Daily FreeCell Syndicate",
    description: "Solve today's shared FreeCell deal by clearing all cards into foundations.",
    goal: () => ({ type: "win", target: 1, description: "Solve the FreeCell deal" }),
  },
  spider: {
    title: "Daily Spider Solitaire",
    description: "Weave through today's spider columns and assemble complete suit sequences.",
    goal: (seed) =>
      seed % 2 === 0
        ? { type: "win", target: 1, description: "Clear all 8 card columns (Win)" }
        : { type: "suits", target: 4, description: "Clear at least 4 suit columns" },
  },
  tripeaks: {
    title: "Daily TriPeaks Expedition",
    description: "Scale today's peaks by sequencing cards into the discard pile.",
    goal: () => ({ type: "peaks", target: 3, description: "Clear all 3 peaks" }),
  },
  pyramid: {
    title: "Daily Pyramid Vault",
    description: "Pair cards adding to 13 to dismantle today's ancient pyramid.",
    goal: () => ({ type: "win", target: 1, description: "Clear the entire pyramid" }),
  },
  yukon: {
    title: "Daily Yukon Territory",
    description: "Maneuver unblocked groups in today's rugged Yukon tableau to solve all suits.",
    goal: () => ({ type: "win", target: 1, description: "Solve the Yukon deal" }),
  },
  ers: {
    title: "Daily Egyptian Rat Screw Showdown",
    description: "Slap doubles and sandwiches to outwit bots and claim the whole deck today.",
    goal: () => ({ type: "win", target: 1, description: "Win the ERS match" }),
  },
  scoundrel: {
    title: "Daily Scoundrel Dungeon Crawler",
    description: "Survive today's treacherous 44-card dungeon and conquer monsters.",
    goal: (seed) => {
      const target = 8 + (seed % 4); // target 8 to 11 rooms
      return { type: "rooms", target, description: `Clear at least ${target} dungeon rooms` };
    },
  },
};

/**
 * Generates the daily challenge definition for a game on a specified UTC date.
 */
export function getDailyChallenge(game: string, dateStr?: string): DailyChallenge {
  const g = isDailyGame(game) ? game : "solitaire";
  const date = dateStr ?? todayUtc();
  const seed = getDailySeed(g, date);
  const cfg = GAME_CHALLENGE_CONFIG[g];
  const goal = cfg.goal(seed);

  return {
    game: g,
    date,
    seed,
    title: cfg.title,
    description: cfg.description,
    goal,
    bonusXp: DAILY_BASE_BONUS_XP,
    bonusCoins: DAILY_BASE_BONUS_COINS,
  };
}

/**
 * Checks whether game outcome meets the daily challenge goal.
 */
export function isChallengeCompleted(
  challenge: DailyChallenge,
  outcome: {
    won?: boolean;
    score?: number;
    roomsCleared?: number;
    peaks?: number;
    suits?: number;
    completedRuns?: number;
  }
): boolean {
  if (outcome.won) return true;
  switch (challenge.goal.type) {
    case "win":
      return Boolean(outcome.won);
    case "score":
      return (outcome.score ?? 0) >= challenge.goal.target;
    case "rooms":
      return (outcome.roomsCleared ?? 0) >= challenge.goal.target;
    case "peaks":
      return (outcome.peaks ?? 0) >= challenge.goal.target;
    case "suits": {
      const suits = outcome.suits ?? outcome.completedRuns ?? 0;
      return suits >= challenge.goal.target;
    }
    default:
      return Boolean(outcome.won);
  }
}

export interface DailyStreakState {
  current: number;
  longest: number;
  lastDate: string | null;
}

export interface DailyProgress {
  /** Global consecutive days played streak */
  current: number;
  /** Global longest streak ever reached */
  longest: number;
  /** Last UTC date on which any daily challenge was completed */
  lastDate: string | null;
  /** Streak state object for ergonomic access */
  streak: DailyStreakState;
  /** Per-game streak tracking */
  byGame: Record<string, DailyStreakState>;
  /** Map of "YYYY-MM-DD:game" to boolean completion */
  completed: Record<string, boolean>;
  /** Map of "YYYY-MM-DD" to list of games completed */
  completedDays: Record<string, string[]>;
}

export function newDailyProgress(): DailyProgress {
  return {
    current: 0,
    longest: 0,
    lastDate: null,
    streak: { current: 0, longest: 0, lastDate: null },
    byGame: {},
    completed: {},
    completedDays: {},
  };
}

export interface DailyCompletionResult {
  progress: Progress;
  streak: number;
  longestStreak: number;
  longest: number;
  multiplier: number;
  baseBonusXp: number;
  bonusXp: number;
  bonusCoins: number;
  milestoneBonus: StreakMilestone | null;
  milestoneBonusXp: number;
  alreadyCompletedToday: boolean;
  gameAlreadyCompleted: boolean;
  challenge: DailyChallenge;
}

/**
 * Records a daily challenge completion for a given game on dateStr (UTC YYYY-MM-DD).
 * Updates global and per-game streak, longest streak, applies streak multipliers and milestone bonuses.
 */
export function recordDailyCompletion(
  prev: Progress,
  game: string,
  dateStr?: string
): DailyCompletionResult & Progress {
  const p: Progress = structuredClone(prev);
  if (!p.daily) {
    p.daily = newDailyProgress();
  }

  const today = dateStr ?? todayUtc();
  const completionKey = `${today}:${game}`;
  const challenge = getDailyChallenge(game, today);

  const gameAlreadyCompleted = Boolean(p.daily.completed?.[completionKey]);
  const lastGlobalDate = p.daily.lastDate ?? p.daily.streak?.lastDate ?? null;
  const alreadyCompletedToday = lastGlobalDate === today;

  let currentStreak = p.daily.current ?? p.daily.streak?.current ?? 0;
  let longestStreak = p.daily.longest ?? p.daily.streak?.longest ?? 0;

  // Advance global streak if this is the first challenge completed on `today`
  if (!alreadyCompletedToday) {
    if (!lastGlobalDate) {
      // First day ever
      currentStreak = 1;
    } else {
      const diff = daysBetween(lastGlobalDate, today);
      if (diff === 1) {
        // Consecutive calendar day
        currentStreak += 1;
      } else if (diff > 1 || diff < 0) {
        // Missed day(s) or clocks went backwards: streak broken
        currentStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  // Update per-game streak tracking
  if (!p.daily.byGame) p.daily.byGame = {};
  const gameStreakState = p.daily.byGame[game] ?? { current: 0, longest: 0, lastDate: null };
  let gameCurrent = gameStreakState.current;
  let gameLongest = gameStreakState.longest;

  if (gameStreakState.lastDate !== today) {
    if (!gameStreakState.lastDate) {
      gameCurrent = 1;
    } else {
      const diff = daysBetween(gameStreakState.lastDate, today);
      if (diff === 1) {
        gameCurrent += 1;
      } else if (diff > 1 || diff < 0) {
        gameCurrent = 1;
      }
    }
    gameLongest = Math.max(gameLongest, gameCurrent);
    p.daily.byGame[game] = {
      current: gameCurrent,
      longest: gameLongest,
      lastDate: today,
    };
  }

  // Calculate bonuses
  const multiplier = getStreakMultiplier(currentStreak);
  const milestone = !alreadyCompletedToday ? getMilestoneBonus(currentStreak) : null;
  const milestoneBonusXp = milestone?.xp ?? 0;
  const milestoneBonusCoins = milestone?.coins ?? 0;

  let bonusXp = 0;
  let bonusCoins = 0;

  if (!gameAlreadyCompleted) {
    bonusXp = Math.round(DAILY_BASE_BONUS_XP * multiplier) + milestoneBonusXp;
    bonusCoins = DAILY_BASE_BONUS_COINS + milestoneBonusCoins;
  }

  // Update progress state
  if (!p.daily.completed) p.daily.completed = {};
  p.daily.completed[completionKey] = true;

  if (!p.daily.completedDays) p.daily.completedDays = {};
  if (!p.daily.completedDays[today]) p.daily.completedDays[today] = [];
  if (!p.daily.completedDays[today].includes(game)) {
    p.daily.completedDays[today].push(game);
  }

  p.daily.current = currentStreak;
  p.daily.longest = longestStreak;
  p.daily.lastDate = today;
  p.daily.streak = {
    current: currentStreak,
    longest: longestStreak,
    lastDate: today,
  };

  const result: DailyCompletionResult & Progress = {
    ...p,
    progress: p,
    streak: currentStreak,
    longestStreak,
    longest: longestStreak,
    multiplier,
    baseBonusXp: DAILY_BASE_BONUS_XP,
    bonusXp,
    bonusCoins,
    milestoneBonus: milestone,
    milestoneBonusXp,
    alreadyCompletedToday,
    gameAlreadyCompleted,
    challenge,
  };

  return result;
}
