// Daily challenge and streak progression system for all 13 solo games.
// Ensures every player in the world shares the exact same daily challenge deal on any given day,
// and rewards consistent daily play with scaling multipliers and milestone bonuses.

import type { Progress } from "./progress";
import { levelInfo, levelUpCoins, MAX_LEVEL, xpForLevel } from "./levels";

export const DAILY_GAMES = [
  "solitaire",
  "freecell",
  "spider",
  "tripeaks",
  "pyramid",
  "yukon",
  "ers",
  "scoundrel",
  "hearts",
  "spades",
  "minesweeper",
  "sudoku",
  "checkers",
] as const;

export type DailyGame = (typeof DAILY_GAMES)[number];

export function isDailyGame(game: string): game is DailyGame {
  return (DAILY_GAMES as readonly string[]).includes(game);
}

/** Base bonus XP awarded for first completion of a daily challenge. */
export const DAILY_BASE_BONUS_XP = 50;
/** Base bonus coins awarded for first completion of a daily challenge. */
export const DAILY_BASE_BONUS_COINS = 15;
/** Cost in Gold Coins to equip one Streak Freeze protection item (Duolingo model). */
export const STREAK_FREEZE_COST = 200;
/** Maximum number of streak freezes a player can hold simultaneously. */
export const MAX_STREAK_FREEZES = 2;

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
 * If the player missed 1 day (diff === 2) and has an active Streak Freeze, streak is protected!
 * If more days have passed without completing a daily challenge, streak has reset to 0.
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
  // Missed exactly 1 day (diff === 2), but protected by a streak freeze!
  if (diff === 2 && (progress.daily.freezes ?? 0) > 0) {
    return current;
  }
  // Missed without freeze
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

/** Returns the featured daily game for a given date, rotating deterministically across all the daily games. */
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
  // 31 bits: the game server only accepts seeds up to 2^31 - 1, and quietly dealt a random game for
  // bigger ones (so on most days, most daily deals weren't the daily). Seeds already under that are unchanged.
  const seed = hashString(`heist-daily-seed:v1:${game.toLowerCase()}:${date}`) & 0x7fffffff;
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
  hearts: {
    title: "Daily Hearts Heist",
    description: "Today's shared deal against Lou, Duchess and Nails: dodge the hearts, duck the Queen of Spades.",
    goal: () => ({ type: "win", target: 1, description: "Finish with the lowest score" }),
  },
  spades: {
    title: "Daily Spades Syndicate",
    description: "Team up with Ledger on today's shared deal, a quick game to 250: bid tight, make your contract.",
    goal: () => ({ type: "win", target: 1, description: "Win the quick game to 250" }),
  },
  minesweeper: {
    title: "Daily Minesweeper Vault",
    description: "Crack today's shared 16x16 Intermediate minefield: 40 mines, one safe first click.",
    goal: () => ({ type: "win", target: 1, description: "Clear the Intermediate minefield" }),
  },
  sudoku: {
    title: "Daily Sudoku Safe",
    description: "Crack today's shared Medium Sudoku combination: one unique solution, three mistakes allowed.",
    goal: () => ({ type: "win", target: 1, description: "Solve the Medium Sudoku" }),
  },
  checkers: {
    title: "Daily Checkers Showdown",
    description: "Take on today's Pro bot: everyone faces the same opponent, move for move.",
    goal: () => ({ type: "win", target: 1, description: "Beat the Pro bot" }),
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

export interface DailyQuestData {
  moves: number;
  xp: number;
  challengeDone: boolean;
  vaultClaimed: boolean;
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
  /** Equippable streak freezes (Duolingo style) preventing streak loss on missed days */
  freezes?: number;
  /** Log of UTC dates when a freeze was consumed */
  usedFreezeDates?: string[];
  /** Daily quest tracking per date */
  quests?: Record<string, DailyQuestData>;
  /** Whether the Day-1 Welcome Gift (1 Free Streak Freeze + 250 Coins) has been claimed */
  welcomeClaimed?: boolean;
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
    freezes: 0,
    usedFreezeDates: [],
    quests: {},
    welcomeClaimed: false,
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
  usedFreeze?: boolean;
}

/**
 * Records a daily challenge completion for a given game on dateStr (UTC YYYY-MM-DD).
 * Updates global and per-game streak, longest streak, applies streak multipliers and milestone bonuses.
 * Automatically consumes an equipped Streak Freeze if exactly 1 day was missed.
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
  let usedFreeze = false;

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
      } else if (diff === 2 && (p.daily.freezes ?? 0) > 0) {
        // Missed yesterday, but protected by Streak Freeze!
        p.daily.freezes = (p.daily.freezes ?? 1) - 1;
        p.daily.usedFreezeDates = [...(p.daily.usedFreezeDates ?? []), today];
        usedFreeze = true;
        currentStreak += 1;
      } else if (diff > 1 || diff < 0) {
        // Missed day(s) without freeze: streak broken
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
      } else if (diff === 2 && usedFreeze) {
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
    usedFreeze,
  };

  return result;
}

/**
 * Buys and equips a Streak Freeze with Gold Coins.
 */
export function buyStreakFreeze(progress: Progress): { progress: Progress; success: boolean; error?: string } {
  const p: Progress = structuredClone(progress);
  if (!p.daily) p.daily = newDailyProgress();
  const currentFreezes = p.daily.freezes ?? 0;
  if (currentFreezes >= MAX_STREAK_FREEZES) {
    return { progress: p, success: false, error: "Maximum 2 Streak Freezes already equipped." };
  }
  if (p.coins < STREAK_FREEZE_COST) {
    return { progress: p, success: false, error: `Need ${STREAK_FREEZE_COST} Coins (you have ${p.coins}).` };
  }
  p.coins -= STREAK_FREEZE_COST;
  p.daily.freezes = currentFreezes + 1;
  return { progress: p, success: true };
}

// ---- Daily Quest Trio & Loot Vault -------------------------------------------------------------

export interface DailyQuestStatus {
  id: "moves" | "xp" | "daily";
  title: string;
  desc: string;
  icon: string;
  target: number;
  current: number;
  done: boolean;
  rewardCoins: number;
  rewardXp: number;
}

export interface DailyQuestSummary {
  date: string;
  quests: DailyQuestStatus[];
  allCompleted: boolean;
  vaultClaimed: boolean;
  vaultCoins: number;
  vaultXp: number;
}

export const DAILY_VAULT_COINS = 100;
export const DAILY_VAULT_XP = 250;

/**
 * Returns today's active 3 daily micro-quests and completion status.
 */
export function getDailyQuests(progress?: Progress | null, dateStr?: string): DailyQuestSummary {
  const today = dateStr ?? todayUtc();
  const qData = progress?.daily?.quests?.[today] ?? { moves: 0, xp: 0, challengeDone: false, vaultClaimed: false };
  const hasDailyDone = qData.challengeDone || Boolean(progress?.daily?.completedDays?.[today]?.length);

  const quests: DailyQuestStatus[] = [
    {
      id: "moves",
      title: "Tactical Execution",
      desc: "Make 30 card moves in any game",
      icon: "⚡",
      target: 30,
      current: Math.min(30, qData.moves),
      done: qData.moves >= 30,
      rewardCoins: 25,
      rewardXp: 50,
    },
    {
      id: "xp",
      title: "Heist Operative",
      desc: "Earn 200 XP across solo or table games",
      icon: "💎",
      target: 200,
      current: Math.min(200, qData.xp),
      done: qData.xp >= 200,
      rewardCoins: 35,
      rewardXp: 100,
    },
    {
      id: "daily",
      title: "Daily Specialist",
      desc: "Complete today's featured daily challenge deal",
      icon: "👑",
      target: 1,
      current: hasDailyDone ? 1 : 0,
      done: hasDailyDone,
      rewardCoins: 50,
      rewardXp: 150,
    },
  ];

  const allCompleted = quests.every((q) => q.done);
  return {
    date: today,
    quests,
    allCompleted,
    vaultClaimed: Boolean(qData.vaultClaimed),
    vaultCoins: DAILY_VAULT_COINS,
    vaultXp: DAILY_VAULT_XP,
  };
}

/**
 * Records player moves or XP towards today's daily quest goals.
 */
export function recordQuestActivity(
  prev: Progress,
  activity: { moves?: number; xp?: number; challengeDone?: boolean },
  dateStr?: string
): Progress {
  const p: Progress = structuredClone(prev);
  if (!p.daily) p.daily = newDailyProgress();
  if (!p.daily.quests) p.daily.quests = {};
  const today = dateStr ?? todayUtc();
  const existing = p.daily.quests[today] ?? { moves: 0, xp: 0, challengeDone: false, vaultClaimed: false };

  p.daily.quests[today] = {
    moves: existing.moves + (activity.moves ?? 0),
    xp: existing.xp + (activity.xp ?? 0),
    challengeDone: existing.challengeDone || Boolean(activity.challengeDone),
    vaultClaimed: existing.vaultClaimed,
  };
  return p;
}

/**
 * Cracks open and claims the Daily Loot Safe once all 3 quests are complete.
 */
export function claimDailyVault(
  prev: Progress,
  dateStr?: string
): { progress: Progress; success: boolean; coins: number; xp: number } {
  const p: Progress = structuredClone(prev);
  const today = dateStr ?? todayUtc();
  const summary = getDailyQuests(p, today);
  if (!summary.allCompleted || summary.vaultClaimed) {
    return { progress: p, success: false, coins: 0, xp: 0 };
  }
  if (!p.daily) p.daily = newDailyProgress();
  if (!p.daily.quests) p.daily.quests = {};
  const existing = p.daily.quests[today] ?? { moves: 0, xp: 0, challengeDone: false, vaultClaimed: false };
  existing.vaultClaimed = true;
  p.daily.quests[today] = existing;
  // like any other reward: XP stops at the top level, and a level reached here pays its level-up coins
  const before = levelInfo(p.xp).level;
  p.xp = Math.min(xpForLevel(MAX_LEVEL), p.xp + DAILY_VAULT_XP);
  let coins = DAILY_VAULT_COINS;
  for (let l = before + 1; l <= levelInfo(p.xp).level; l++) coins += levelUpCoins(l);
  p.coins += coins;
  return { progress: p, success: true, coins, xp: DAILY_VAULT_XP };
}

export const WELCOME_GIFT_COINS = 250;
export const WELCOME_GIFT_FREEZES = 1;

/**
 * Claims the Day-1 Welcome Gift (1 Free Streak Freeze + 250 Coins) for new players.
 * Gives immediate skin in the game & loss aversion protection for tomorrow.
 */
export function claimWelcomeGift(
  prev: Progress
): { progress: Progress; claimed: boolean; coins: number; freezes: number } {
  const p: Progress = structuredClone(prev);
  if (!p.daily) p.daily = newDailyProgress();
  if (p.daily.welcomeClaimed) {
    return { progress: p, claimed: false, coins: 0, freezes: 0 };
  }
  p.daily.welcomeClaimed = true;
  p.daily.freezes = Math.min(MAX_STREAK_FREEZES, (p.daily.freezes ?? 0) + WELCOME_GIFT_FREEZES);
  p.coins = (p.coins ?? 0) + WELCOME_GIFT_COINS;
  return { progress: p, claimed: true, coins: WELCOME_GIFT_COINS, freezes: WELCOME_GIFT_FREEZES };
}

