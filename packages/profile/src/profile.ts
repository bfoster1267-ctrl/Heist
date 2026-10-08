// What other players can see of you: your name, level, prestige, look and headline stats.

import type { EquipSlot } from "./cosmetics";
import { cosmetic } from "./cosmetics";
import { levelInfo, rankName } from "./levels";
import type { Progress } from "./progress";
import type { CareerStats } from "./stats";

/** Shown on your seat at a table. */
export interface Badge {
  level: number;
  prestige: number;
  frame: string;
  title: string | null;
  /** chat bubble and cigar ids, so other players see them */
  chat?: string;
  cigar?: string;
}

export interface PublicProfile {
  id: string;
  name: string;
  level: number;
  prestige: number;
  rank: string;
  equipped: Record<EquipSlot, string>;
  joined: number;
  stats: Pick<CareerStats, "games" | "wins" | "losses" | "winnings" | "biggestPot" | "bestStreak" | "footholds" | "byMode">;
}

export function badgeOf(p: Progress): Badge {
  return {
    level: levelInfo(p.xp).level,
    prestige: p.prestige,
    frame: p.equipped.frame,
    title: cosmetic(p.equipped.title)?.text ?? null,
    chat: p.equipped.chat,
    cigar: p.equipped.cigar,
  };
}

export function publicProfile(id: string, name: string, joined: number, p: Progress): PublicProfile {
  const level = levelInfo(p.xp).level;
  const s = p.stats;
  return {
    id, name, level, prestige: p.prestige, rank: rankName(level), equipped: p.equipped, joined,
    stats: { games: s.games, wins: s.wins, losses: s.losses, winnings: s.winnings, biggestPot: s.biggestPot, bestStreak: s.bestStreak, footholds: s.footholds, byMode: s.byMode },
  };
}
