// TriPeaks Solitaire
// Fast-paced 28-card 3-peak tableau with stock and waste.
// Pure rule engine for both web client and game server move validation/replays.

import { cardRank, type PlayingCard } from "./solitaire";

export type { PlayingCard };

export interface TriPeaksState {
  /** 28 cards in tableau (or null if card was removed) */
  tableau: (PlayingCard | null)[];
  /** which cards are face-up (row 3 starts true, others false until uncovered) */
  up: boolean[];
  /** remaining cards in the stock pile (face-down) */
  stock: PlayingCard[];
  /** waste pile (top card is last element) */
  waste: PlayingCard[];
  /** current streak of consecutive cards cleared from tableau without drawing */
  streak: number;
}

export type TpMove = "d" | `t${number}`;

/** Seeded shuffle (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Covering relationship in the 28-card 3-peak pyramid:
 * Each card index 0..17 is covered by two specific cards in the row below.
 */
export const TP_COVERS: Record<number, [number, number]> = {
  // Row 0 (3 cards) covered by Row 1
  0: [3, 4],
  1: [5, 6],
  2: [7, 8],
  // Row 1 (6 cards) covered by Row 2
  3: [9, 10],
  4: [10, 11],
  5: [12, 13],
  6: [13, 14],
  7: [15, 16],
  8: [16, 17],
  // Row 2 (9 cards) covered by Row 3 (10 cards)
  9: [18, 19],
  10: [19, 20],
  11: [20, 21],
  12: [21, 22],
  13: [22, 23],
  14: [23, 24],
  15: [24, 25],
  16: [25, 26],
  17: [26, 27],
};

/** Deal standard TriPeaks */
export function dealTriPeaks(seed: number): TriPeaksState {
  const r = rng(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const tableau: (PlayingCard | null)[] = deck.slice(0, 28);
  const waste: PlayingCard[] = [deck[28]];
  const stock: PlayingCard[] = deck.slice(29);

  // Row 3 (indices 18..27) starts face-up; rows 0..2 start face-down
  const up = Array.from({ length: 28 }, (_, i) => i >= 18);

  return {
    tableau,
    up,
    stock,
    waste,
    streak: 0,
  };
}

/** Can card `c` go on waste card `w` (one rank higher or lower, wrapping King <-> Ace)? */
export function fitsTp(c: PlayingCard, w: PlayingCard): boolean {
  const rC = cardRank(c);
  const rW = cardRank(w);
  const diff = Math.abs(rC - rW);
  // normal adjacent rank (e.g. 5 on 6 or 4) or wrapping (Ace on King, King on Ace)
  return diff === 1 || diff === 12;
}

/** Check if tableau card `idx` is uncovered (both its covering cards are removed) */
export function isTpUncovered(tableau: (PlayingCard | null)[], idx: number): boolean {
  if (tableau[idx] === null) return false;
  if (idx >= 18) return true; // bottom row is always uncovered
  const covers = TP_COVERS[idx];
  if (!covers) return true;
  return tableau[covers[0]] === null && tableau[covers[1]] === null;
}

/** Update face-up status for cards that just became uncovered */
function updateUncovered(tableau: (PlayingCard | null)[], up: boolean[]) {
  for (let i = 0; i < 18; i++) {
    if (tableau[i] !== null && !up[i] && isTpUncovered(tableau, i)) {
      up[i] = true;
    }
  }
}

/** Apply a move; returns next state, or null if illegal */
export function applyTp(state: TriPeaksState, move: TpMove): TriPeaksState | null {
  if (move === "d") {
    if (state.stock.length === 0) return null;
    const stock = [...state.stock];
    const nextCard = stock.pop()!;
    return {
      tableau: [...state.tableau],
      up: [...state.up],
      stock,
      waste: [...state.waste, nextCard],
      streak: 0, // drawing resets streak
    };
  }

  const tap = /^t(\d+)$/.exec(move);
  if (!tap) return null;
  const idx = Number(tap[1]);
  if (idx < 0 || idx >= 28) return null;

  const card = state.tableau[idx];
  if (card === null || !state.up[idx]) return null;
  if (!isTpUncovered(state.tableau, idx)) return null;

  const topWaste = state.waste[state.waste.length - 1];
  if (topWaste === undefined || !fitsTp(card, topWaste)) return null;

  const tableau = [...state.tableau];
  const up = [...state.up];
  tableau[idx] = null;
  updateUncovered(tableau, up);

  return {
    tableau,
    up,
    stock: [...state.stock],
    waste: [...state.waste, card],
    streak: state.streak + 1,
  };
}

/** TriPeaks is won when all 28 tableau cards are cleared */
export const tpWon = (state: TriPeaksState): boolean =>
  state.tableau.every((c) => c === null);

/** Check if any move is available */
export function tpHasMoves(state: TriPeaksState): boolean {
  if (state.stock.length > 0) return true;
  const topWaste = state.waste[state.waste.length - 1];
  if (topWaste === undefined) return false;
  for (let i = 0; i < 28; i++) {
    const c = state.tableau[i];
    if (c !== null && state.up[i] && isTpUncovered(state.tableau, i) && fitsTp(c, topWaste)) {
      return true;
    }
  }
  return false;
}

/** Find a valid tableau move if one exists */
export function findTpHint(state: TriPeaksState): number | null {
  const topWaste = state.waste[state.waste.length - 1];
  if (topWaste === undefined) return null;
  for (let i = 0; i < 28; i++) {
    const c = state.tableau[i];
    if (c !== null && state.up[i] && isTpUncovered(state.tableau, i) && fitsTp(c, topWaste)) {
      return i;
    }
  }
  return null;
}

/** Replay moves from seed; throws on illegal move */
export function replayTriPeaks(seed: number, moves: readonly unknown[]): TriPeaksState {
  let s = dealTriPeaks(seed);
  for (const m of moves) {
    const next = typeof m === "string" ? applyTp(s, m as TpMove) : null;
    if (!next) throw new Error("illegal move");
    s = next;
  }
  return s;
}

export interface TpTally {
  cleared: number;
  maxStreak: number;
  peaks: number;
  won: boolean;
}

/** Count how many of the 3 peak top cards (indices 0, 1, 2) have been cleared */
export function countPeaksCleared(tableau: (PlayingCard | null)[]): number {
  let p = 0;
  if (tableau[0] === null) p++;
  if (tableau[1] === null) p++;
  if (tableau[2] === null) p++;
  return p;
}

export function tallyTriPeaks(seed: number, moves: readonly unknown[]): TpTally {
  let s = dealTriPeaks(seed);
  let maxStreak = 0;
  let cleared = 0;

  for (const m of moves) {
    const next = typeof m === "string" ? applyTp(s, m as TpMove) : null;
    if (!next) throw new Error("illegal move");
    if (typeof m === "string" && m.startsWith("t")) {
      cleared++;
      if (next.streak > maxStreak) maxStreak = next.streak;
    }
    s = next;
  }

  return {
    cleared,
    maxStreak,
    peaks: countPeaksCleared(s.tableau),
    won: tpWon(s),
  };
}

export const TP_XP = { clear: 1, peak: 5, streak5: 3, streak10: 10, win: 20 };

export function tallyTpXp(t: TpTally) {
  let xp = t.cleared * TP_XP.clear + t.peaks * TP_XP.peak;
  if (t.maxStreak >= 5) xp += TP_XP.streak5;
  if (t.maxStreak >= 10) xp += TP_XP.streak10;
  if (t.won) xp += TP_XP.win;
  return xp;
}

export interface TpGainGained {
  cleared: number;
  maxStreak: number;
  peaks: number;
  won: boolean;
  streak5: boolean;
  streak10: boolean;
}

export function tpGain(paid: TpTally | undefined, t: TpTally) {
  const p = paid ?? { cleared: 0, maxStreak: 0, peaks: 0, won: false };
  const streak5 = p.maxStreak < 5 && t.maxStreak >= 5;
  const streak10 = p.maxStreak < 10 && t.maxStreak >= 10;
  const gained: TpGainGained = {
    cleared: Math.max(0, t.cleared - p.cleared),
    maxStreak: streak10 ? 10 : streak5 ? 5 : 0,
    peaks: Math.max(0, t.peaks - p.peaks),
    won: t.won && !p.won,
    streak5,
    streak10,
  };
  const paidTally: TpTally = {
    cleared: Math.max(t.cleared, p.cleared),
    maxStreak: Math.max(t.maxStreak, p.maxStreak),
    peaks: Math.max(t.peaks, p.peaks),
    won: t.won || p.won,
  };
  return {
    gained,
    paid: paidTally,
    any: tallyTpXp(paidTally) > tallyTpXp(p),
  };
}

export function tpPay(
  paid: TpTally | undefined,
  paidXp: number | undefined,
  t: TpTally,
  drain: number
) {
  const g = tpGain(paid, t);
  const before = paidXp ?? tallyTpXp(paid ?? { cleared: 0, maxStreak: 0, peaks: 0, won: false });
  const pot = Math.max(0, tallyTpXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}

export const TP_IDLE_S = 5;
