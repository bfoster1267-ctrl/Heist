// Yukon Solitaire (52 cards dealt to 7 columns, 4 foundations built A to K).
// Any face-up group can move if its root fits alternating color & descending rank.
// Pure rules shared between web app and server replay.

import { cardRank, cardRed, cardSuit, type PlayingCard } from "./solitaire";

export { cardRank, cardRed, cardSuit, type PlayingCard };

export interface YukonColumn {
  down: PlayingCard[];
  up: PlayingCard[];
}

export interface YukonState {
  cols: YukonColumn[];
  /** 4 foundations: one per suit (0 spades, 1 hearts, 2 diamonds, 3 clubs) */
  found: PlayingCard[][];
}

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

/**
 * Deal standard Yukon:
 * Col 0: 0 down, 1 up (1 card)
 * Col 1: 1 down, 5 up (6 cards)
 * Col 2: 2 down, 5 up (7 cards)
 * Col 3: 3 down, 5 up (8 cards)
 * Col 4: 4 down, 5 up (9 cards)
 * Col 5: 5 down, 5 up (10 cards)
 * Col 6: 6 down, 5 up (11 cards)
 * Total: 52 cards
 */
export function dealYukon(seed: number): YukonState {
  const r = rng(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const cols: YukonColumn[] = [];
  for (let c = 0; c < 7; c++) {
    const downCount = c;
    const upCount = c === 0 ? 1 : 5;
    const down = deck.splice(0, downCount);
    const up = deck.splice(0, upCount);
    cols.push({ down, up });
  }

  return {
    cols,
    found: [[], [], [], []],
  };
}

/** Fits descending rank with alternating color: X fits on Y if X is opposite color and rank(X) === rank(Y) - 1 */
export function fitsYukon(x: PlayingCard, y: PlayingCard): boolean {
  return cardRed(x) !== cardRed(y) && cardRank(x) === cardRank(y) - 1;
}

/** Check if card fits on top of foundation pile */
export function fitsYukonFoundation(card: PlayingCard, pile: readonly PlayingCard[]): boolean {
  const suit = cardSuit(card);
  const rank = cardRank(card);
  if (pile.length === 0) return rank === 1;
  const top = pile[pile.length - 1];
  return cardSuit(top) === suit && rank === cardRank(top) + 1;
}

/** Clone Yukon state */
function cloneYukon(s: YukonState): YukonState {
  return {
    cols: s.cols.map((c) => ({ down: [...c.down], up: [...c.up] })),
    found: s.found.map((f) => [...f]),
  };
}

/**
 * Apply a move to Yukon state:
 * - "t{c}>f": move top card of column c to foundation
 * - "t{c1}>t{c2}:{count}": move {count} cards from c1 to c2
 */
export function applyYukon(s: YukonState, move: string): YukonState {
  // Move column card to foundation: "t{c}>f"
  const mFound = /^t([0-6])>f$/.exec(move);
  if (mFound) {
    const colIdx = Number(mFound[1]);
    const col = s.cols[colIdx];
    if (col.up.length === 0) return s;
    const card = col.up[col.up.length - 1];
    const suit = cardSuit(card);
    if (!fitsYukonFoundation(card, s.found[suit])) return s;

    const next = cloneYukon(s);
    next.cols[colIdx].up.pop();
    next.found[suit].push(card);

    // Auto-turn face down card
    if (next.cols[colIdx].up.length === 0 && next.cols[colIdx].down.length > 0) {
      next.cols[colIdx].up.push(next.cols[colIdx].down.pop()!);
    }
    return next;
  }

  // Move tableau cards: "t{c1}>t{c2}" or "t{c1}>t{c2}:{count}"
  const mTab = /^t([0-6])>t([0-6])(?::(\d+))?$/.exec(move);
  if (mTab) {
    const from = Number(mTab[1]);
    const to = Number(mTab[2]);
    const count = mTab[3] !== undefined ? Number(mTab[3]) : 1;
    if (from === to || count <= 0) return s;
    const colFrom = s.cols[from];
    const colTo = s.cols[to];
    if (count > colFrom.up.length) return s;

    const movingRoot = colFrom.up[colFrom.up.length - count];

    // Check placement on destination
    if (colTo.up.length === 0) {
      // Empty column takes only King
      if (cardRank(movingRoot) !== 13) return s;
    } else {
      const topDest = colTo.up[colTo.up.length - 1];
      if (!fitsYukon(movingRoot, topDest)) return s;
    }

    const next = cloneYukon(s);
    const movingCards = next.cols[from].up.splice(next.cols[from].up.length - count, count);
    next.cols[to].up.push(...movingCards);

    // Auto-turn face down card
    if (next.cols[from].up.length === 0 && next.cols[from].down.length > 0) {
      next.cols[from].up.push(next.cols[from].down.pop()!);
    }
    return next;
  }

  return s;
}

export function yukonWon(s: YukonState): boolean {
  return s.found.reduce((sum, f) => sum + f.length, 0) === 52;
}

export interface YukonTally {
  foundations: number;
  unturned: number; // Down cards turned face up
  moves: number;
  won: boolean;
}

export function tallyYukon(seed: number, moves: readonly string[]): YukonTally {
  let s = dealYukon(seed);
  let validMoves = 0;
  for (const m of moves) {
    const next = applyYukon(s, m);
    if (next !== s) {
      validMoves++;
      s = next;
    }
  }

  const foundations = s.found.reduce((sum, f) => sum + f.length, 0);
  const remainingDown = s.cols.reduce((sum, c) => sum + c.down.length, 0);
  const unturned = 21 - remainingDown; // 21 total down cards originally (0+1+2+3+4+5+6)

  return {
    foundations,
    unturned,
    moves: validMoves,
    won: yukonWon(s),
  };
}

export const YUKON_XP = { turn: 4, foundation: 6, win: 50 };
export const YUKON_DAY_XP = 500;
export const YUKON_IDLE_S = 30;

export function tallyYukonXp(t: YukonTally): number {
  return (
    t.unturned * YUKON_XP.turn +
    t.foundations * YUKON_XP.foundation +
    (t.won ? YUKON_XP.win : 0)
  );
}

export function yukonGain(paid: YukonTally | undefined, t: YukonTally) {
  const p = paid ?? { foundations: 0, unturned: 0, moves: 0, won: false };
  const gained = {
    foundations: Math.max(0, t.foundations - p.foundations),
    unturned: Math.max(0, t.unturned - p.unturned),
    moves: Math.max(0, t.moves - p.moves),
    won: t.won && !p.won,
  };
  return {
    gained,
    paid: {
      foundations: Math.max(t.foundations, p.foundations),
      unturned: Math.max(t.unturned, p.unturned),
      moves: Math.max(t.moves, p.moves),
      won: t.won || p.won,
    },
    any: tallyYukonXp(gained) > 0,
  };
}

export function yukonPay(
  paid: YukonTally | undefined,
  paidXp: number | undefined,
  t: YukonTally,
  drain: number
) {
  const g = yukonGain(paid, t);
  const before = paidXp ?? tallyYukonXp(paid ?? { foundations: 0, unturned: 0, moves: 0, won: false });
  const pot = Math.max(0, tallyYukonXp(g.paid) - Math.max(0, drain));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}

export interface YukonHint {
  move: string;
  sourceCol: number;
  count: number;
  targetCol?: number;
  isFoundation?: boolean;
}

export function findYukonHint(s: YukonState): YukonHint | null {
  // 1. Check if any column top card can move to foundation
  for (let c = 0; c < 7; c++) {
    const col = s.cols[c];
    if (col.up.length === 0) continue;
    const card = col.up[col.up.length - 1];
    const suit = cardSuit(card);
    if (fitsYukonFoundation(card, s.found[suit])) {
      return { move: `t${c}>f`, sourceCol: c, count: 1, isFoundation: true };
    }
  }

  // 2. Check if any card can reveal a face-down card
  for (let from = 0; from < 7; from++) {
    const colFrom = s.cols[from];
    if (colFrom.down.length === 0) continue;
    // Moving the entire face-up stack reveals a down card!
    const count = colFrom.up.length;
    if (count === 0) continue;
    const root = colFrom.up[0];
    for (let to = 0; to < 7; to++) {
      if (from === to) continue;
      const colTo = s.cols[to];
      if (colTo.up.length === 0) {
        if (cardRank(root) === 13) {
          return { move: `t${from}>t${to}:${count}`, sourceCol: from, count, targetCol: to };
        }
      } else {
        const topDest = colTo.up[colTo.up.length - 1];
        if (fitsYukon(root, topDest)) {
          return { move: `t${from}>t${to}:${count}`, sourceCol: from, count, targetCol: to };
        }
      }
    }
  }

  // 3. Check any other legal tableau move
  for (let from = 0; from < 7; from++) {
    const colFrom = s.cols[from];
    for (let i = 0; i < colFrom.up.length; i++) {
      const count = colFrom.up.length - i;
      const root = colFrom.up[i];
      for (let to = 0; to < 7; to++) {
        if (from === to) continue;
        const colTo = s.cols[to];
        if (colTo.up.length === 0) {
          // Only move King to empty column if it wasn't already at index 0 with 0 down cards
          if (cardRank(root) === 13 && (i > 0 || colFrom.down.length > 0)) {
            return { move: `t${from}>t${to}:${count}`, sourceCol: from, count, targetCol: to };
          }
        } else {
          const topDest = colTo.up[colTo.up.length - 1];
          if (fitsYukon(root, topDest)) {
            return { move: `t${from}>t${to}:${count}`, sourceCol: from, count, targetCol: to };
          }
        }
      }
    }
  }

  return null;
}
