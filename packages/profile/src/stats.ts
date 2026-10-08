// Career stats: totals, rates, streaks and per-game trackers, built from the engine's event stream so
// online and vs-bot games count the same way.

import type { GameEvent, RoleId } from "@heist/engine";
import type { Rival } from "./rating";

/** What one player did in one game, read from that game's events. */
export interface GameSummary {
  role: RoleId | null;
  /** Footholds you took in rivals' hideouts */
  footholds: number;
  /** Jobs you ran as Boss, and how many you won */
  jobsLed: number;
  jobsWon: number;
  /** Jobs pulled on you as the Mark that you fought off */
  defenses: number;
  doubleCrosses: number;
  /** Loot paid to you */
  loot: number;
  bustsWon: number;
  betsWon: number;
}

export function summarize(events: GameEvent[], seat: number): GameSummary {
  const s: GameSummary = { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 };
  let boss = -1;
  let mark = -1;
  const roles = new Map<number, RoleId>();
  for (const e of events) {
    switch (e.t) {
      case "role":
        roles.set(e.seat, e.role);
        break;
      case "wildcard": {
        // the Wildcard swaps Roles with another player: follow the swap
        const a = roles.get(e.seat);
        const b = roles.get(e.target);
        if (a && b) {
          roles.set(e.seat, b);
          roles.set(e.target, a);
        }
        break;
      }
      case "mark":
        boss = e.boss;
        mark = e.mark;
        if (boss === seat) s.jobsLed++;
        break;
      case "result":
        if (e.winner === "B" && boss === seat) s.jobsWon++;
        if (e.winner === "M" && mark === seat) s.defenses++;
        break;
      case "foothold":
        if (e.seat === seat && e.owner !== seat) s.footholds++;
        break;
      case "doubleCross":
        if (e.seat === seat) s.doubleCrosses++;
        break;
      case "loot":
        if (e.to === seat) s.loot += e.amount;
        break;
      case "bustResult":
        if (e.winner === seat) s.bustsWon++;
        break;
      case "betPaid":
        if (e.seat === seat && e.won) s.betsWon++;
        break;
    }
  }
  s.role = roles.get(seat) ?? null;
  return s;
}

export type Mode = "online" | "bots";

export interface WinLoss {
  g: number;
  w: number;
}

export interface RecentGame {
  at: number;
  mode: Mode;
  won: boolean;
  players: number;
  stakes: number;
  /** chips won minus the buy-in */
  net: number;
  role: RoleId | null;
  xp: number;
  /** left before the end (counts as a loss) */
  quit?: boolean;
}

export interface CareerStats {
  games: number;
  wins: number;
  losses: number;
  /** chips won from pots, total */
  winnings: number;
  /** buy-ins lost, total */
  lost: number;
  biggestPot: number;
  /** positive = wins in a row, negative = losses in a row */
  streak: number;
  bestStreak: number;
  byMode: Record<Mode, WinLoss>;
  byPlayers: Record<string, WinLoss>;
  byRole: Partial<Record<RoleId, WinLoss>>;
  footholds: number;
  jobsLed: number;
  jobsWon: number;
  defenses: number;
  doubleCrosses: number;
  loot: number;
  bustsWon: number;
  betsWon: number;
  quits: number;
  /** last 20 games, newest first */
  recent: RecentGame[];
}

export function emptyStats(): CareerStats {
  return {
    games: 0, wins: 0, losses: 0, winnings: 0, lost: 0, biggestPot: 0, streak: 0, bestStreak: 0,
    byMode: { online: { g: 0, w: 0 }, bots: { g: 0, w: 0 } }, byPlayers: {}, byRole: {},
    footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0, quits: 0,
    recent: [],
  };
}

export interface GameResult {
  mode: Mode;
  players: number;
  stakes: number;
  won: boolean;
  /** chips paid out to this player (0 on a loss) */
  payout: number;
  summary: GameSummary;
  quit?: boolean;
  at: number;
  /** everyone else at the table, for the hidden skill rating (left out: the rating doesn't move) */
  rivals?: Rival[];
  /** the campaign stage this game was (its first win clears it) */
  campaign?: number;
  /** a coached game (doesn't count toward the rating) */
  coached?: boolean;
}

const bump = (r: WinLoss | undefined, won: boolean): WinLoss => ({ g: (r?.g ?? 0) + 1, w: (r?.w ?? 0) + (won ? 1 : 0) });

/** Add one game to the career. Returns a new object. */
export function addGame(prev: CareerStats, r: GameResult, xp: number): CareerStats {
  const s: CareerStats = structuredClone(prev);
  const sum = r.summary;
  s.games++;
  if (r.won) s.wins++;
  else s.losses++;
  if (r.won) {
    s.winnings += r.payout;
    s.biggestPot = Math.max(s.biggestPot, r.payout);
  } else s.lost += r.stakes;
  s.streak = r.won ? Math.max(0, s.streak) + 1 : Math.min(0, s.streak) - 1;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.byMode[r.mode] = bump(s.byMode[r.mode], r.won);
  s.byPlayers[r.players] = bump(s.byPlayers[r.players], r.won);
  if (sum.role) s.byRole[sum.role] = bump(s.byRole[sum.role], r.won);
  s.footholds += sum.footholds;
  s.jobsLed += sum.jobsLed;
  s.jobsWon += sum.jobsWon;
  s.defenses += sum.defenses;
  s.doubleCrosses += sum.doubleCrosses;
  s.loot += sum.loot;
  s.bustsWon += sum.bustsWon;
  s.betsWon += sum.betsWon;
  if (r.quit) s.quits++;
  const g: RecentGame = { at: r.at, mode: r.mode, won: r.won, players: r.players, stakes: r.stakes, net: r.payout - r.stakes, role: sum.role, xp };
  if (r.quit) g.quit = true;
  s.recent = [g, ...s.recent].slice(0, 20);
  return s;
}

export const winRate = (s: { games?: number; g?: number; wins?: number; w?: number }) => {
  const g = s.games ?? s.g ?? 0;
  return g ? (s.wins ?? s.w ?? 0) / g : 0;
};
