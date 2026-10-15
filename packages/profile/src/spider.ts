// Spider Solitaire (2 decks, 104 cards, 10 cascades, 8 completed K->A runs to win).
// Pure rules for deal, validation, stock dealing, sequence movement, and completed run clearing.

import { cardRank, cardSuit, type PlayingCard } from "./solitaire";

export type { PlayingCard };

export type SpiderSuitMode = 1 | 2 | 4;

export interface SpiderCard {
  card: PlayingCard;
  up: boolean;
}

export interface SpiderState {
  /** 10 tableau columns */
  tableau: SpiderCard[][];
  /** Remaining stock pile (multiples of 10 cards) */
  stock: PlayingCard[];
  /** Completed King-to-Ace runs removed to foundation (0 to 8) */
  completed: number;
  /** Suit mode (1, 2, or 4 suits) */
  mode: SpiderSuitMode;
  /** Whether the game has been won (all 8 runs completed) */
  won: boolean;
}

export type SpiderMove =
  | { kind: "move"; fromCol: number; cardIndex: number; toCol: number }
  | { kind: "deal" };

/** Seeded PRNG (mulberry32) */
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
 * Deal standard Spider Solitaire (104 cards).
 * Suit mode:
 * - 1 suit: all Spades (easiest, standard casual)
 * - 2 suits: Spades and Hearts
 * - 4 suits: Spades, Hearts, Clubs, Diamonds
 */
export function dealSpider(seed: number, mode: SpiderSuitMode = 1): SpiderState {
  const r = rng(seed);
  const deck: PlayingCard[] = [];

  // Generate 104 cards based on suit mode
  if (mode === 1) {
    // 8 copies of Spades (suit 0) A-K (0..12)
    for (let c = 0; c < 8; c++) {
      for (let rank = 0; rank < 13; rank++) deck.push(rank);
    }
  } else if (mode === 2) {
    // 4 copies of Spades (0) and 4 copies of Hearts (1)
    for (let c = 0; c < 4; c++) {
      for (let rank = 0; rank < 13; rank++) {
        deck.push(rank); // Spades
        deck.push(13 + rank); // Hearts
      }
    }
  } else {
    // 2 standard 52-card decks
    for (let d = 0; d < 2; d++) {
      for (let card = 0; card < 52; card++) deck.push(card);
    }
  }

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // Deal 54 cards into 10 cascades:
  // Cols 0-3: 6 cards each (5 down, 1 up)
  // Cols 4-9: 5 cards each (4 down, 1 up)
  const tableau: SpiderCard[][] = Array.from({ length: 10 }, () => []);
  let cardIdx = 0;
  for (let col = 0; col < 10; col++) {
    const count = col < 4 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const up = i === count - 1;
      tableau[col].push({ card: deck[cardIdx++], up });
    }
  }

  const stock = deck.slice(54); // 50 cards remaining

  return {
    tableau,
    stock,
    completed: 0,
    mode,
    won: false,
  };
}

/** Check if a stack of face-up cards starting at cardIndex forms a valid descending same-suit sequence */
export function isValidSpiderSequence(col: SpiderCard[], cardIndex: number): boolean {
  if (cardIndex < 0 || cardIndex >= col.length) return false;
  for (let i = cardIndex; i < col.length; i++) {
    if (!col[i].up) return false;
    if (i > cardIndex) {
      const prev = col[i - 1].card;
      const cur = col[i].card;
      // Must be same suit and descending rank exactly by 1
      if (cardSuit(prev) !== cardSuit(cur)) return false;
      if (cardRank(prev) !== cardRank(cur) + 1) return false;
    }
  }
  return true;
}

/** Remove all completed King-to-Ace runs from the end of a column, auto-flipping exposed cards */
export function clearCompleteRuns(col: SpiderCard[]): number {
  let cleared = 0;
  while (true) {
    const runIdx = findCompleteRun(col);
    if (runIdx === null) break;
    col.splice(runIdx, 13);
    cleared++;
    if (col.length > 0) {
      col[col.length - 1].up = true;
    }
  }
  return cleared;
}

/** Check if dealing 10 cards from stock is legal */
export function canDealSpider(state: SpiderState, requireNoEmpty = false): boolean {
  if (state.won || state.stock.length < 10) return false;
  if (requireNoEmpty && state.tableau.some((c) => c.length === 0)) return false;
  return true;
}

/**
 * Check if moving the sequence starting at cardIndex from fromCol to toCol is legal:
 * - The sequence on fromCol must be valid same-suit descending.
 * - If toCol is empty, any valid sequence is accepted.
 * - If toCol is not empty, top card of toCol must have rank = sequence start card rank + 1 and be face-up.
 */
export function canMoveSpider(state: SpiderState, fromCol: number, cardIndex: number, toCol: number): boolean {
  if (state.won) return false;
  if (fromCol === toCol) return false;
  if (fromCol < 0 || fromCol >= 10 || toCol < 0 || toCol >= 10) return false;
  const source = state.tableau[fromCol];
  const dest = state.tableau[toCol];

  if (!isValidSpiderSequence(source, cardIndex)) return false;

  const movingTop = source[cardIndex].card;
  if (dest.length === 0) return true; // Empty column accepts any valid sequence

  const targetCard = dest[dest.length - 1];
  if (!targetCard.up) return false;
  return cardRank(targetCard.card) === cardRank(movingTop) + 1;
}

/** Check if a cascade ends with a complete same-suit King down to Ace (13 cards) */
export function findCompleteRun(col: SpiderCard[]): number | null {
  if (col.length < 13) return null;
  const start = col.length - 13;
  if (!col[start].up || cardRank(col[start].card) !== 13) return null; // King is rank 13
  const suit = cardSuit(col[start].card);

  for (let i = 0; i < 13; i++) {
    const item = col[start + i];
    if (!item.up) return null;
    if (cardSuit(item.card) !== suit) return null;
    if (cardRank(item.card) !== 13 - i) return null;
  }

  return start;
}

/** Apply a move to Spider state */
export function applySpider(state: SpiderState, move: SpiderMove): SpiderState {
  if (state.won) return state;

  if (move.kind === "deal") {
    if (state.stock.length < 10) return state;
    // Standard Spider allows deal as long as stock has cards
    const nextTableau = state.tableau.map((col) => [...col]);
    const nextStock = [...state.stock];

    for (let c = 0; c < 10; c++) {
      const card = nextStock.pop()!;
      nextTableau[c].push({ card, up: true });
    }

    // Check if any completed runs were formed by the deal
    let nextCompleted = state.completed;
    for (let c = 0; c < 10; c++) {
      nextCompleted += clearCompleteRuns(nextTableau[c]);
    }

    return {
      ...state,
      tableau: nextTableau,
      stock: nextStock,
      completed: nextCompleted,
      won: nextCompleted >= 8,
    };
  }

  if (move.kind === "move") {
    const { fromCol, cardIndex, toCol } = move;
    if (!canMoveSpider(state, fromCol, cardIndex, toCol)) return state;

    const nextTableau = state.tableau.map((col) => [...col]);
    const moving = nextTableau[fromCol].splice(cardIndex);
    nextTableau[toCol].push(...moving);

    // Turn up the newly exposed card on source column
    if (nextTableau[fromCol].length > 0) {
      nextTableau[fromCol][nextTableau[fromCol].length - 1].up = true;
    }

    // Check if target column or source column now has completed King->Ace runs
    let nextCompleted = state.completed;
    nextCompleted += clearCompleteRuns(nextTableau[toCol]);
    nextCompleted += clearCompleteRuns(nextTableau[fromCol]);

    return {
      ...state,
      tableau: nextTableau,
      completed: nextCompleted,
      won: nextCompleted >= 8,
    };
  }

  return state;
}

export interface SpiderTally {
  completedRuns: number;
  moves: number;
  won: boolean;
}

export function tallySpider(seed: number, moves: readonly unknown[], mode: SpiderSuitMode = 1): SpiderTally {
  let s = dealSpider(seed, mode);
  let validMoves = 0;

  for (const m of moves) {
    if (!m || typeof m !== "object") continue;
    const prev = s;
    s = applySpider(s, m as SpiderMove);
    if (s !== prev) validMoves++;
  }

  return {
    completedRuns: s.completed,
    moves: validMoves,
    won: s.won,
  };
}

export const SPIDER_XP = { run: 15, win: 30 };

export function tallySpiderXp(t: SpiderTally): number {
  return t.completedRuns * SPIDER_XP.run + (t.won ? SPIDER_XP.win : 0);
}

export function spiderGain(paid: SpiderTally | undefined, t: SpiderTally) {
  const p = paid ?? { completedRuns: 0, moves: 0, won: false };
  const gained = {
    completedRuns: Math.max(0, t.completedRuns - p.completedRuns),
    moves: Math.max(0, t.moves - p.moves),
    won: t.won && !p.won,
  };
  return {
    gained,
    paid: {
      completedRuns: Math.max(t.completedRuns, p.completedRuns),
      moves: Math.max(t.moves, p.moves),
      won: t.won || p.won,
    },
    any: tallySpiderXp(gained) > 0,
  };
}

export function spiderPay(
  paid: SpiderTally | undefined,
  paidXp: number | undefined,
  t: SpiderTally,
  drain: number
) {
  const g = spiderGain(paid, t);
  const before = paidXp ?? tallySpiderXp(paid ?? { completedRuns: 0, moves: 0, won: false });
  const pot = Math.max(0, tallySpiderXp(g.paid) - Math.max(0, drain));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
