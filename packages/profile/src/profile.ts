// What other players can see of you: your name, level, prestige, look and headline stats.

import type { EquipSlot } from "./cosmetics";
import { cosmetic } from "./cosmetics";
import { levelInfo, rankName } from "./levels";
import type { Progress } from "./progress";
import type { CareerStats } from "./stats";
import { rankedPublic, type RankedPublic } from "./ranked";

/** Shown on your seat at a table. */
export interface Badge {
  level: number;
  prestige: number;
  frame: string;
  title: string | null;
  /** chat bubble and cigar ids, so other players see them */
  chat?: string;
  cigar?: string;
  /** Ranked rank this season ("Gold II"), once they've played a ranked game this season */
  rank?: string;
  /** Ranked MMR */
  mmr?: number;
}

export interface PublicProfile {
  id: string;
  name: string;
  level: number;
  prestige: number;
  rank: string;
  equipped: Record<EquipSlot, string>;
  joined: number;
  /** the full career: other players see everything you see on your own profile */
  stats: CareerStats;
  drinksSent: number;
  ranked: RankedPublic | null;
}

export function badgeOf(p: Progress): Badge {
  return {
    level: levelInfo(p.xp).level,
    prestige: p.prestige,
    frame: p.equipped.frame,
    title: cosmetic(p.equipped.title)?.text ?? null,
    chat: p.equipped.chat,
    cigar: p.equipped.cigar,
    ...rankBadge(p),
  };
}

function rankBadge(p: Progress): Pick<Badge, "rank" | "mmr"> {
  const r = rankedPublic(p.ranked, Date.now());
  return r && r.games ? { rank: r.label, mmr: r.mmr } : {};
}

export function publicProfile(id: string, name: string, joined: number, p: Progress): PublicProfile {
  const level = levelInfo(p.xp).level;
  return {
    id, name, level, prestige: p.prestige, rank: rankName(level), equipped: p.equipped, joined,
    stats: p.stats, drinksSent: p.drinksSent, ranked: rankedPublic(p.ranked, Date.now()),
  };
}
