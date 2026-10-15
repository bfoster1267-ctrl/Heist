// Pyramid Solitaire (28-card pyramid in 7 rows, 24-card stock, pair cards summing to 13).
// Pure rules for deal, uncovering, pairing, stock draws, and pyramid clearing.

import { cardRank, type PlayingCard } from "./solitaire";

export type { PlayingCard };

export interface PyramidState {
  /** 28 pyramid cards: null when cleared. Cards are all face-up. */
  pyramid: (PlayingCard | null)[];
  /** Stock pile (remaining cards) */
  stock: PlayingCard[];
  /** Waste pile (drawn cards, top card is last element) */
  waste: PlayingCard[];
  /** How many times stock has been recycled */
  recycles: number;
  /** Whether the game has been won (all 28 pyramid cards cleared) */
  won: boolean;
}

export type PyramidMove =
  | { kind: "king"; pyramidIndex: number }
  | { kind: "pair_pyramid"; idxA: number; idxB: number }
  | { kind: "pair_waste"; pyramidIndex: number }
  | { kind: "waste_king" }
  | { kind: "draw" }
  | { kind: "recycle" };

/** PRNG (mulberry32) */
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

/** Deal standard 52-card Pyramid Solitaire */
export function dealPyramid(seed: number): PyramidState {
  const r = rng(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const pyramid = deck.slice(0, 28) as (PlayingCard | null)[];
  const stock = deck.slice(28);

  return {
    pyramid,
    stock,
    waste: [],
    recycles: 0,
    won: false,
  };
}

/** Get the row of a pyramid index (0 to 6) */
export function pyramidRow(idx: number): number {
  if (idx < 0 || idx >= 28) return -1;
  if (idx === 0) return 0;
  if (idx < 3) return 1;
  if (idx < 6) return 2;
  if (idx < 10) return 3;
  if (idx < 15) return 4;
  if (idx < 21) return 5;
  return 6;
}

/** Check if card at pyramid index is completely uncovered by cards in the row below it */
export function isPyramidUncovered(pyramid: readonly (PlayingCard | null)[], idx: number): boolean {
  if (idx < 0 || idx >= 28 || pyramid[idx] === null) return false;
  const row = pyramidRow(idx);
  if (row === 6) return true; // Bottom row cards are never covered

  const leftChild = idx + row + 1;
  const rightChild = idx + row + 2;

  return pyramid[leftChild] === null && pyramid[rightChild] === null;
}

/** Card value for pairing to 13: A=1, 2=2, ..., 10=10, J=11, Q=12, K=13 */
export function pyramidValue(c: PlayingCard): number {
  return cardRank(c);
}

/** Apply a move to Pyramid state */
export function applyPyramid(state: PyramidState, move: PyramidMove): PyramidState {
  if (state.won) return state;

  const nextPyr = [...state.pyramid];
  const nextStock = [...state.stock];
  const nextWaste = [...state.waste];

  if (move.kind === "draw") {
    if (nextStock.length === 0) return state;
    const card = nextStock.pop()!;
    nextWaste.push(card);
    return { ...state, stock: nextStock, waste: nextWaste };
  }

  if (move.kind === "recycle") {
    if (nextStock.length > 0 || nextWaste.length === 0) return state;
    // Turn waste back into stock
    return {
      ...state,
      stock: nextWaste.reverse(),
      waste: [],
      recycles: state.recycles + 1,
    };
  }

  if (move.kind === "king") {
    const { pyramidIndex } = move;
    if (!isPyramidUncovered(nextPyr, pyramidIndex)) return state;
    const card = nextPyr[pyramidIndex];
    if (card === null || pyramidValue(card) !== 13) return state;

    nextPyr[pyramidIndex] = null;
    const won = nextPyr.every((c) => c === null);
    return { ...state, pyramid: nextPyr, won };
  }

  if (move.kind === "pair_pyramid") {
    const { idxA, idxB } = move;
    if (idxA === idxB) return state;
    if (!isPyramidUncovered(nextPyr, idxA) || !isPyramidUncovered(nextPyr, idxB)) return state;
    const cardA = nextPyr[idxA];
    const cardB = nextPyr[idxB];
    if (cardA === null || cardB === null) return state;
    if (pyramidValue(cardA) + pyramidValue(cardB) !== 13) return state;

    nextPyr[idxA] = null;
    nextPyr[idxB] = null;
    const won = nextPyr.every((c) => c === null);
    return { ...state, pyramid: nextPyr, won };
  }

  if (move.kind === "pair_waste") {
    const { pyramidIndex } = move;
    if (!isPyramidUncovered(nextPyr, pyramidIndex)) return state;
    if (nextWaste.length === 0) return state;
    const cardA = nextPyr[pyramidIndex];
    const cardB = nextWaste[nextWaste.length - 1];
    if (cardA === null) return state;
    if (pyramidValue(cardA) + pyramidValue(cardB) !== 13) return state;

    nextPyr[pyramidIndex] = null;
    nextWaste.pop();
    const won = nextPyr.every((c) => c === null);
    return { ...state, pyramid: nextPyr, waste: nextWaste, won };
  }

  if (move.kind === "waste_king") {
    if (nextWaste.length === 0) return state;
    const card = nextWaste[nextWaste.length - 1];
    if (pyramidValue(card) !== 13) return state;
    nextWaste.pop();
    return { ...state, waste: nextWaste };
  }

  return state;
}

export interface PyramidTally {
  clearedCards: number;
  moves: number;
  won: boolean;
}

export function tallyPyramid(seed: number, moves: readonly unknown[]): PyramidTally {
  let s = dealPyramid(seed);
  let validMoves = 0;

  for (const m of moves) {
    if (!m || typeof m !== "object") continue;
    const prev = s;
    s = applyPyramid(s, m as PyramidMove);
    if (s !== prev) validMoves++;
  }

  const cleared = s.pyramid.filter((c) => c === null).length;
  return {
    clearedCards: cleared,
    moves: validMoves,
    won: s.won,
  };
}

export const PYRAMID_XP = { clear: 2, win: 25 };

export function tallyPyramidXp(t: PyramidTally): number {
  return t.clearedCards * PYRAMID_XP.clear + (t.won ? PYRAMID_XP.win : 0);
}

export function pyramidGain(paid: PyramidTally | undefined, t: PyramidTally) {
  const p = paid ?? { clearedCards: 0, moves: 0, won: false };
  const gained = {
    clearedCards: Math.max(0, t.clearedCards - p.clearedCards),
    moves: Math.max(0, t.moves - p.moves),
    won: t.won && !p.won,
  };
  return {
    gained,
    paid: {
      clearedCards: Math.max(t.clearedCards, p.clearedCards),
      moves: Math.max(t.moves, p.moves),
      won: t.won || p.won,
    },
    any: tallyPyramidXp(gained) > 0,
  };
}

export function pyramidPay(
  paid: PyramidTally | undefined,
  paidXp: number | undefined,
  t: PyramidTally,
  drain: number
) {
  const g = pyramidGain(paid, t);
  const before = paidXp ?? tallyPyramidXp(paid ?? { clearedCards: 0, moves: 0, won: false });
  const pot = Math.max(0, tallyPyramidXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}

export const PYRAMID_IDLE_S = 30;

export type PyramidHint =
  | { kind: "king"; pyramidIndex: number }
  | { kind: "waste_king" }
  | { kind: "pair_pyramid"; idxA: number; idxB: number }
  | { kind: "pair_waste"; pyramidIndex: number }
  | { kind: "draw" }
  | { kind: "recycle" };

export function findPyramidHint(state: PyramidState): PyramidHint | null {
  if (state.won) return null;
  const uncovered: number[] = [];
  for (let i = 0; i < 28; i++) {
    if (isPyramidUncovered(state.pyramid, i)) uncovered.push(i);
  }

  // 1. King in pyramid
  for (const idx of uncovered) {
    const c = state.pyramid[idx];
    if (c !== null && pyramidValue(c) === 13) {
      return { kind: "king", pyramidIndex: idx };
    }
  }

  // 2. Pairs within pyramid
  for (let i = 0; i < uncovered.length; i++) {
    const idxA = uncovered[i];
    const cardA = state.pyramid[idxA]!;
    for (let j = i + 1; j < uncovered.length; j++) {
      const idxB = uncovered[j];
      const cardB = state.pyramid[idxB]!;
      if (pyramidValue(cardA) + pyramidValue(cardB) === 13) {
        return { kind: "pair_pyramid", idxA, idxB };
      }
    }
  }

  // 3. Pair between pyramid and waste
  if (state.waste.length > 0) {
    const wasteCard = state.waste[state.waste.length - 1];
    if (pyramidValue(wasteCard) === 13) {
      return { kind: "waste_king" };
    }
    for (const idx of uncovered) {
      const cardA = state.pyramid[idx]!;
      if (pyramidValue(cardA) + pyramidValue(wasteCard) === 13) {
        return { kind: "pair_waste", pyramidIndex: idx };
      }
    }
  }

  // 4. Draw if stock has cards
  if (state.stock.length > 0) {
    return { kind: "draw" };
  }

  // 5. Recycle if waste has cards that can produce a move
  if (state.waste.length > 0) {
    for (const c of state.waste) {
      if (pyramidValue(c) === 13) return { kind: "recycle" };
      for (const idx of uncovered) {
        if (pyramidValue(state.pyramid[idx]!) + pyramidValue(c) === 13) return { kind: "recycle" };
      }
    }
  }

  return null;
}

/** Check if any legal move is available in the current state or remaining deck */
export function pyramidHasMoves(state: PyramidState): boolean {
  if (state.won) return false;

  const uncovered: number[] = [];
  for (let i = 0; i < 28; i++) {
    if (isPyramidUncovered(state.pyramid, i)) uncovered.push(i);
  }

  // 1. King in pyramid
  for (const idx of uncovered) {
    const c = state.pyramid[idx];
    if (c !== null && pyramidValue(c) === 13) return true;
  }

  // 2. Pairs within pyramid
  for (let i = 0; i < uncovered.length; i++) {
    const cardA = state.pyramid[uncovered[i]]!;
    for (let j = i + 1; j < uncovered.length; j++) {
      const cardB = state.pyramid[uncovered[j]]!;
      if (pyramidValue(cardA) + pyramidValue(cardB) === 13) return true;
    }
  }

  // 3. Waste king
  if (state.waste.length > 0 && pyramidValue(state.waste[state.waste.length - 1]) === 13) {
    return true;
  }

  // 4. Pair with current top of waste
  if (state.waste.length > 0) {
    const topW = state.waste[state.waste.length - 1];
    for (const idx of uncovered) {
      if (pyramidValue(state.pyramid[idx]!) + pyramidValue(topW) === 13) return true;
    }
  }

  // 5. Stock draws available
  if (state.stock.length > 0) return true;

  // 6. Recycle available and waste has useful cards
  if (state.waste.length > 0) {
    for (const c of state.waste) {
      if (pyramidValue(c) === 13) return true;
      for (const idx of uncovered) {
        if (pyramidValue(state.pyramid[idx]!) + pyramidValue(c) === 13) return true;
      }
    }
  }

  return false;
}

