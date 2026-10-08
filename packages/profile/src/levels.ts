// Levels and prestige. XP builds levels 1 to 50; at 50 a player can prestige: back to level 1 with a
// prestige star, a coin payout and prestige-only cosmetics. Ten prestiges, then you're a Legend for good.

export const MAX_LEVEL = 50;
export const MAX_PRESTIGE = 10;

/** XP needed to go from `level` to `level + 1`. Level 1 -> 2 is 200 XP, 49 -> 50 is 2,600. */
export function xpToNext(level: number): number {
  return 200 + 50 * (level - 1);
}

/** Total XP needed to reach `level` from level 1. */
export function xpForLevel(level: number): number {
  let t = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) t += xpToNext(l);
  return t;
}

export interface LevelInfo {
  level: number;
  /** XP into the current level */
  into: number;
  /** XP the current level needs (0 at the max level) */
  need: number;
  /** 0..1 through the current level (1 at the max level) */
  pct: number;
  maxed: boolean;
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, into: 0, need: 0, pct: 1, maxed: true };
  const need = xpToNext(level);
  return { level, into: left, need, pct: left / need, maxed: false };
}

/** Rank names shown under the player's name. Each covers five levels. */
const RANKS: [number, string][] = [
  [1, "Rookie"], [5, "Runner"], [10, "Wheelman"], [15, "Cracksman"], [20, "Con Artist"], [25, "Enforcer"],
  [30, "Lieutenant"], [35, "Underboss"], [40, "Kingpin"], [45, "Godfather"], [50, "Legend"],
];

export function rankName(level: number): string {
  let name = RANKS[0][1];
  for (const [l, n] of RANKS) if (level >= l) name = n;
  return name;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const prestigeName = (p: number) => (p > 0 ? `Prestige ${ROMAN[Math.min(p, MAX_PRESTIGE)]}` : "");

/** Coins paid out on reaching a level. */
export const levelUpCoins = (level: number) => 25 + level * 5;
/** Coins paid out for each prestige. */
export const prestigeCoins = (prestige: number) => 1000 + 250 * (prestige - 1);
