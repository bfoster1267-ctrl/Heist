// FreeCell solitaire (8 cascades, 4 free cells, 4 foundations).
// Pure rules shared by the web app and the game server: the app plays it,
// the server replays the moves from the seed to check a win before paying XP,
// matching the Klondike Solitaire architecture.

import { cardRank, cardRed, cardSuit, type PlayingCard } from "./solitaire";

export type { PlayingCard };

export interface FreeCellState {
  /** 4 temporary storage cells (null when empty) */
  cells: (PlayingCard | null)[];
  /** 4 foundations in suit order (0 spades, 1 hearts, 2 diamonds, 3 clubs), ace first */
  found: PlayingCard[][];
  /** 8 tableau cascades (all cards face-up in FreeCell) */
  cols: PlayingCard[][];
}

/**
 * A move string:
 * - "t0>f": top card of column 0 to foundation
 * - "c1>f": card in free cell 1 to foundation
 * - "t2>c0" or "t2>c": top card of column 2 to free cell (c picks first empty)
 * - "c0>t3": card in free cell 0 onto column 3
 * - "t1>t4": top card of column 1 onto column 4
 * - "t1>t4:3": top 3 cards of column 1 onto column 4 (supermove)
 */
export type FcMove = string;

/** Seeded shuffle (mulberry32), matching Klondike. */
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
 * Deal standard FreeCell: 52 cards dealt across 8 columns.
 * First 4 columns receive 7 cards, last 4 receive 6 cards.
 * All cards are face-up.
 */
export function dealFreeCell(seed: number): FreeCellState {
  const r = rng(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const cols: PlayingCard[][] = Array.from({ length: 8 }, () => []);
  for (let i = 0; i < 52; i++) {
    cols[i % 8].push(deck[i]);
  }

  return {
    cells: [null, null, null, null],
    found: [[], [], [], []],
    cols,
  };
}

const top = <T>(a: T[]): T | undefined => a[a.length - 1];

/** Can card `c` go on this column (alternating color, one rank lower; any card on an empty column)? */
export function fitsFcColumn(col: PlayingCard[], c: PlayingCard): boolean {
  const t = top(col);
  if (t === undefined) return true; // In standard FreeCell, any card can fill an empty cascade
  return cardRed(t) !== cardRed(c) && cardRank(t) === cardRank(c) + 1;
}

/** Can card `c` go up onto its suit foundation? */
export function fitsFcFoundation(state: FreeCellState, c: PlayingCard): boolean {
  return state.found[cardSuit(c)].length === cardRank(c) - 1;
}

/** Check if a sequence of cards in a column is ordered (alternating colors, descending rank). */
export function isOrderedSequence(cards: PlayingCard[]): boolean {
  for (let i = 0; i < cards.length - 1; i++) {
    const curr = cards[i];
    const next = cards[i + 1];
    if (cardRed(curr) === cardRed(next) || cardRank(curr) !== cardRank(next) + 1) {
      return false;
    }
  }
  return true;
}

/**
 * Maximum number of cards that can be moved as a supermove.
 * Formula: (1 + freeCells) * 2^(emptyCols), where emptyCols excludes the destination if empty.
 */
export function maxSupermove(state: FreeCellState, destIsEmpty: boolean): number {
  const emptyCells = state.cells.filter((c) => c === null).length;
  let emptyCols = state.cols.filter((c) => c.length === 0).length;
  if (destIsEmpty && emptyCols > 0) {
    emptyCols--;
  }
  return (1 + emptyCells) * Math.pow(2, emptyCols);
}

function clone(s: FreeCellState): FreeCellState {
  return {
    cells: [...s.cells],
    found: s.found.map((f) => [...f]),
    cols: s.cols.map((c) => [...c]),
  };
}

/** Apply a move to a FreeCell state; returns new state, or null if illegal. */
export function applyFc(state: FreeCellState, m: FcMove): FreeCellState | null {
  const n = clone(state);

  // 1. Cell to foundation: "c0>f"
  const c2f = /^c([0-3])>f$/.exec(m);
  if (c2f) {
    const idx = Number(c2f[1]);
    const card = n.cells[idx];
    if (card === null || !fitsFcFoundation(n, card)) return null;
    n.cells[idx] = null;
    n.found[cardSuit(card)].push(card);
    return n;
  }

  // 2. Cell to tableau: "c0>t3"
  const c2t = /^c([0-3])>t([0-7])$/.exec(m);
  if (c2t) {
    const cIdx = Number(c2t[1]);
    const tIdx = Number(c2t[2]);
    const card = n.cells[cIdx];
    if (card === null) return null;
    if (!fitsFcColumn(n.cols[tIdx], card)) return null;
    n.cells[cIdx] = null;
    n.cols[tIdx].push(card);
    return n;
  }

  // 3. Cell to cell: "c0>c1"
  const c2c = /^c([0-3])>c([0-3])$/.exec(m);
  if (c2c) {
    const from = Number(c2c[1]);
    const to = Number(c2c[2]);
    if (from === to || n.cells[from] === null || n.cells[to] !== null) return null;
    n.cells[to] = n.cells[from];
    n.cells[from] = null;
    return n;
  }

  // 4. Tableau to foundation: "t2>f"
  const t2f = /^t([0-7])>f$/.exec(m);
  if (t2f) {
    const tIdx = Number(t2f[1]);
    const col = n.cols[tIdx];
    const card = top(col);
    if (card === undefined || !fitsFcFoundation(n, card)) return null;
    col.pop();
    n.found[cardSuit(card)].push(card);
    return n;
  }

  // 5. Tableau to cell: "t2>c" or "t2>c0"
  const t2c = /^t([0-7])>c([0-3])?$/.exec(m);
  if (t2c) {
    const tIdx = Number(t2c[1]);
    const targetCell = t2c[2] !== undefined ? Number(t2c[2]) : n.cells.findIndex((c) => c === null);
    if (targetCell < 0 || targetCell > 3 || n.cells[targetCell] !== null) return null;
    const col = n.cols[tIdx];
    const card = top(col);
    if (card === undefined) return null;
    col.pop();
    n.cells[targetCell] = card;
    return n;
  }

  // 6. Tableau to tableau: "t1>t4" or "t1>t4:3"
  const t2t = /^t([0-7])>t([0-7])(?::(\d+))?$/.exec(m);
  if (t2t) {
    const fromIdx = Number(t2t[1]);
    const toIdx = Number(t2t[2]);
    const count = t2t[3] ? Number(t2t[3]) : 1;
    if (fromIdx === toIdx || count < 1) return null;

    const fromCol = n.cols[fromIdx];
    const toCol = n.cols[toIdx];
    if (fromCol.length < count) return null;

    const moving = fromCol.slice(fromCol.length - count);
    if (!isOrderedSequence(moving)) return null;

    const destIsEmpty = toCol.length === 0;
    if (!fitsFcColumn(toCol, moving[0])) return null;

    // Verify supermove capacity
    if (count > maxSupermove(state, destIsEmpty)) return null;

    fromCol.splice(fromCol.length - count, count);
    toCol.push(...moving);
    return n;
  }

  return null;
}

/** FreeCell is won when all 4 foundations hold 13 cards. */
export const fcWon = (s: FreeCellState): boolean => s.found.every((f) => f.length === 13);

/**
 * Safe auto-move to foundations:
 * A card can safely move to foundation if both opposite-color cards of rank - 1
 * are already on their foundations (so we don't trap a card needed for tableau builds).
 * Aces and Twos are always completely safe.
 */
export function isSafeFoundationMove(state: FreeCellState, c: PlayingCard): boolean {
  if (!fitsFcFoundation(state, c)) return false;
  const rank = cardRank(c);
  if (rank <= 2) return true; // Aces and Twos are always safe

  const isRed = cardRed(c);
  // Opposite suit indices: if red (1 hearts, 2 diamonds), opposite are black (0 spades, 3 clubs)
  const oppSuits = isRed ? [0, 3] : [1, 2];
  return oppSuits.every((s) => state.found[s].length >= rank - 1);
}

/** Check for safe foundation auto-move (null if none found). */
export function autoMoveFc(state: FreeCellState): FcMove | null {
  // Check cells first
  for (let i = 0; i < 4; i++) {
    const c = state.cells[i];
    if (c !== null && isSafeFoundationMove(state, c)) return `c${i}>f`;
  }
  // Check tableau tops
  for (let i = 0; i < 8; i++) {
    const c = top(state.cols[i]);
    if (c !== undefined && isSafeFoundationMove(state, c)) return `t${i}>f`;
  }
  return null;
}

/**
 * Where a tapped card goes:
 * 1. If top card and fits foundation -> >f
 * 2. If fits on a tableau column (preferring non-empty before empty) -> >t{dest}
 * 3. If single card from tableau and an empty free cell exists -> >c
 */
export function tapMoveFc(
  state: FreeCellState,
  from: `c${number}` | `t${number}`,
  depth = 1
): FcMove | null {
  if (from.startsWith("c")) {
    const idx = Number(from.slice(1));
    const card = state.cells[idx];
    if (card === null) return null;

    // 1. Foundation?
    if (fitsFcFoundation(state, card)) return `${from}>f`;

    // 2. Tableau?
    const order = [0, 1, 2, 3, 4, 5, 6, 7].sort(
      (a, b) => Number(state.cols[a].length === 0) - Number(state.cols[b].length === 0)
    );
    for (const i of order) {
      if (fitsFcColumn(state.cols[i], card)) return `${from}>t${i}`;
    }
    return null;
  }

  // From tableau
  const colIdx = Number(from.slice(1));
  const col = state.cols[colIdx];
  if (col.length < depth) return null;

  const moving = col.slice(col.length - depth);
  if (!isOrderedSequence(moving)) return null;

  // Single card to foundation?
  if (depth === 1 && fitsFcFoundation(state, moving[0])) return `${from}>f`;

  // Tableau target?
  const order = [0, 1, 2, 3, 4, 5, 6, 7]
    .filter((i) => i !== colIdx)
    .sort((a, b) => Number(state.cols[a].length === 0) - Number(state.cols[b].length === 0));

  for (const i of order) {
    const destIsEmpty = state.cols[i].length === 0;
    if (fitsFcColumn(state.cols[i], moving[0])) {
      if (depth <= maxSupermove(state, destIsEmpty)) {
        return `${from}>t${i}${depth > 1 ? `:${depth}` : ""}`;
      }
    }
  }

  // Single card to free cell?
  if (depth === 1) {
    const emptyCell = state.cells.findIndex((c) => c === null);
    if (emptyCell !== -1) return `${from}>c${emptyCell}`;
  }

  return null;
}

/** Check if any legal move is available. */
export function fcHasMoves(state: FreeCellState): boolean {
  if (autoMoveFc(state) !== null) return true;

  // Check moves from cells
  for (let i = 0; i < 4; i++) {
    if (state.cells[i] !== null && tapMoveFc(state, `c${i}`) !== null) return true;
  }

  // Check moves from columns
  for (let i = 0; i < 8; i++) {
    const col = state.cols[i];
    if (!col.length) continue;
    // Check top card
    if (tapMoveFc(state, `t${i}`, 1) !== null) return true;
    // Check multi-card sequences
    for (let depth = 2; depth <= col.length; depth++) {
      const seq = col.slice(col.length - depth);
      if (!isOrderedSequence(seq)) break;
      if (tapMoveFc(state, `t${i}`, depth) !== null) return true;
    }
  }

  return false;
}

/** A hint pointing at a card (its pile and depth). */
export type FcHint = { pile: `c${number}` | `t${number}`; depth: number } | null;

/** Find a sensible move to suggest to the player. */
export function findFcHint(state: FreeCellState): FcHint {
  // 1. Safe auto-move to foundation
  const auto = autoMoveFc(state);
  if (auto) {
    const pile = auto.slice(0, 2) as `c${number}` | `t${number}`;
    return { pile, depth: 1 };
  }

  // 2. Any move from cell to tableau
  for (let i = 0; i < 4; i++) {
    if (state.cells[i] !== null) {
      const m = tapMoveFc(state, `c${i}`);
      if (m && !m.endsWith(">f")) return { pile: `c${i}`, depth: 1 };
    }
  }

  // 3. Tableau sequence to another tableau column
  for (let i = 0; i < 8; i++) {
    const col = state.cols[i];
    if (!col.length) continue;
    for (let depth = col.length; depth >= 1; depth--) {
      const seq = col.slice(col.length - depth);
      if (!isOrderedSequence(seq)) continue;
      const m = tapMoveFc(state, `t${i}`, depth);
      if (m && !m.includes(">c")) {
        const destIdx = Number(m.split(">")[1][1]);
        if (state.cols[destIdx].length > 0 || depth < col.length) {
          return { pile: `t${i}`, depth };
        }
      }
    }
  }

  // 4. Any foundation move
  for (let i = 0; i < 4; i++) {
    if (state.cells[i] !== null && fitsFcFoundation(state, state.cells[i]!)) {
      return { pile: `c${i}`, depth: 1 };
    }
  }
  for (let i = 0; i < 8; i++) {
    const c = top(state.cols[i]);
    if (c !== undefined && fitsFcFoundation(state, c)) {
      return { pile: `t${i}`, depth: 1 };
    }
  }

  // 5. Tableau card to free cell
  for (let i = 0; i < 8; i++) {
    if (state.cols[i].length > 1 && state.cells.some((c) => c === null)) {
      return { pile: `t${i}`, depth: 1 };
    }
  }

  return null;
}

/** FreeCell is solved when all cards are arranged in descending order and no cards are locked under wrong cards. */
export function fcSolved(state: FreeCellState): boolean {
  if (state.cells.some((c) => c !== null)) return false;
  for (const col of state.cols) {
    if (col.length && !isOrderedSequence(col)) return false;
  }
  return true;
}

/** Replay a FreeCell game's moves from its seed; throws on illegal move. */
export function replayFreeCell(seed: number, moves: readonly unknown[]): FreeCellState {
  let s = dealFreeCell(seed);
  for (const m of moves) {
    const next = typeof m === "string" ? applyFc(s, m) : null;
    if (!next) throw new Error("illegal move");
    s = next;
  }
  return s;
}

export interface FcTally {
  moves: number;
  aces: number;
  stacks: number;
  won: boolean;
}

const key = (s: FreeCellState) =>
  `${s.cells.join(",")}|${s.found.map((f) => f.length).join(",")}|${s.cols.map((c) => c.join(",")).join("/")}`;

export function tallyFreeCell(seed: number, moves: readonly unknown[]): FcTally {
  let s = dealFreeCell(seed);
  const seen = new Set([key(s)]);
  const aces = new Set<number>();
  const stacks = new Set<number>();

  for (const m of moves) {
    const next = typeof m === "string" ? applyFc(s, m) : null;
    if (!next) throw new Error("illegal move");
    s = next;
    seen.add(key(s));
    s.found.forEach((f, i) => {
      if (f.length) aces.add(i);
      if (f.length === 13) stacks.add(i);
    });
  }

  return {
    moves: seen.size - 1,
    aces: aces.size,
    stacks: stacks.size,
    won: fcWon(s),
  };
}

export const FC_XP = { move: 1, ace: 2, stack: 3, win: 0 };
export const tallyFcXp = (t: FcTally) =>
  t.moves * FC_XP.move + t.aces * FC_XP.ace + t.stacks * FC_XP.stack + (t.won ? FC_XP.win : 0);

export function fcGain(paid: FcTally | undefined, t: FcTally) {
  const p = paid ?? { moves: 0, aces: 0, stacks: 0, won: false };
  const gained = {
    moves: Math.max(0, t.moves - p.moves),
    aces: Math.max(0, t.aces - p.aces),
    stacks: Math.max(0, t.stacks - p.stacks),
    won: t.won && !p.won,
  };
  return {
    gained,
    paid: {
      moves: Math.max(t.moves, p.moves),
      aces: Math.max(t.aces, p.aces),
      stacks: Math.max(t.stacks, p.stacks),
      won: t.won || p.won,
    },
    any: tallyFcXp(gained) > 0,
  };
}

export function fcPay(
  paid: FcTally | undefined,
  paidXp: number | undefined,
  t: FcTally,
  drain: number
) {
  const g = fcGain(paid, t);
  const before = paidXp ?? tallyFcXp(paid ?? { moves: 0, aces: 0, stacks: 0, won: false });
  const pot = Math.max(0, tallyFcXp(g.paid) - Math.max(0, drain));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}

export const FC_IDLE_S = 5;

