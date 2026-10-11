// Klondike solitaire (draw one, unlimited passes through the stock). Pure rules shared by the web app
// and the game server: the app plays it, the server replays the moves from the seed to check a win
// before paying XP, the same way vs-bot Heist games are checked.

/** 0..51: suit * 13 + (rank - 1). Suits: 0 spades, 1 hearts, 2 diamonds, 3 clubs. */
export type PlayingCard = number;
export const cardRank = (c: PlayingCard) => (c % 13) + 1;
export const cardSuit = (c: PlayingCard) => Math.floor(c / 13);
export const cardRed = (c: PlayingCard) => cardSuit(c) === 1 || cardSuit(c) === 2;

export interface Column {
  down: PlayingCard[];
  up: PlayingCard[];
}

export interface Klondike {
  stock: PlayingCard[];
  waste: PlayingCard[];
  /** one per suit, in suit order, ace first */
  found: PlayingCard[][];
  cols: Column[];
}

/**
 * A move, as a short string so a whole game is cheap to send:
 * - "d": draw a card from the stock (or turn the waste back over when the stock is empty)
 * - "w>f", "w>t3": the top waste card to its foundation or a column
 * - "t2>f": a column's top card to its foundation
 * - "t2>t5:3": the top 3 face-up cards of column 2 onto column 5
 * - "f1>t4": a foundation's top card back down onto a column
 */
export type SolMove = string;

/** Seeded shuffle (mulberry32), so the server deals the same game the player saw. */
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

export function dealKlondike(seed: number): Klondike {
  const r = rng(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const cols: Column[] = [];
  for (let c = 0; c < 7; c++) {
    const cards = deck.splice(0, c + 1);
    cols.push({ down: cards.slice(0, -1), up: cards.slice(-1) });
  }
  return { stock: deck, waste: [], found: [[], [], [], []], cols };
}

const top = <T>(a: T[]) => a[a.length - 1];

/** Can `c` go on this column (alternating colours, one rank down; only a king on an empty column)? */
export function fitsColumn(col: Column, c: PlayingCard) {
  const t = top(col.up);
  if (t === undefined) return col.down.length === 0 && cardRank(c) === 13;
  return cardRed(t) !== cardRed(c) && cardRank(t) === cardRank(c) + 1;
}

/** Can `c` go up onto its foundation? */
export const fitsFoundation = (k: Klondike, c: PlayingCard) => k.found[cardSuit(c)].length === cardRank(c) - 1;

function clone(k: Klondike): Klondike {
  return { stock: [...k.stock], waste: [...k.waste], found: k.found.map((f) => [...f]), cols: k.cols.map((c) => ({ down: [...c.down], up: [...c.up] })) };
}

/** Turn a column's new top card face up. */
function flip(col: Column) {
  if (!col.up.length && col.down.length) col.up.push(col.down.pop()!);
}

/** The state after `m`, or null when it isn't a legal move. */
export function applySol(k: Klondike, m: SolMove): Klondike | null {
  const n = clone(k);
  if (m === "d") {
    if (n.stock.length) n.waste.push(n.stock.pop()!);
    else if (n.waste.length) {
      n.stock = n.waste.reverse();
      n.waste = [];
    } else return null;
    return n;
  }
  const hit = /^(w|f[0-3]|t[0-6])>(f|t[0-6])(?::(\d+))?$/.exec(m);
  if (!hit) return null;
  const [, from, to, count] = hit;
  const many = count ? Number(count) : 1;
  if (many < 1 || (many > 1 && (from[0] !== "t" || to[0] !== "t"))) return null;
  // pick up
  let cards: PlayingCard[];
  if (from === "w") {
    if (!n.waste.length) return null;
    cards = [n.waste.pop()!];
  } else if (from[0] === "f") {
    if (to === "f") return null;
    const f = n.found[Number(from[1])];
    if (!f.length) return null;
    cards = [f.pop()!];
  } else {
    const col = n.cols[Number(from[1])];
    if (col.up.length < many) return null;
    cards = col.up.splice(col.up.length - many, many);
  }
  // put down
  if (to === "f") {
    if (cards.length !== 1 || !fitsFoundation(n, cards[0])) return null;
    n.found[cardSuit(cards[0])].push(cards[0]);
  } else {
    const dest = n.cols[Number(to[1])];
    if (from === to || !fitsColumn(dest, cards[0])) return null;
    dest.up.push(...cards);
  }
  if (from[0] === "t") flip(n.cols[Number(from[1])]);
  return n;
}

export const solWon = (k: Klondike) => k.found.every((f) => f.length === 13);

/** Everything is face up and the stock is empty: the rest plays itself. */
export const solSolved = (k: Klondike) => !k.stock.length && !k.waste.length && k.cols.every((c) => !c.down.length);

/** The next move toward the foundations when the game is solved (null when none is left). */
export function autoMove(k: Klondike): SolMove | null {
  for (let i = 0; i < 7; i++) {
    const c = top(k.cols[i].up);
    if (c !== undefined && fitsFoundation(k, c)) return `t${i}>f`;
  }
  const w = top(k.waste);
  if (w !== undefined && fitsFoundation(k, w)) return "w>f";
  return null;
}

/**
 * Where a tapped card goes: its foundation if it's the top card and fits, else the first column it
 * fits (a column with cards before an empty one). Null when it can't move.
 */
export function tapMove(k: Klondike, from: "w" | `t${number}` | `f${number}`, depth = 1): SolMove | null {
  const card = from === "w" ? top(k.waste) : from[0] === "f" ? top(k.found[Number(from[1])]) : k.cols[Number(from[1])].up[k.cols[Number(from[1])].up.length - depth];
  if (card === undefined) return null;
  if (depth === 1 && from[0] !== "f" && fitsFoundation(k, card)) return `${from}>f`;
  const order = [0, 1, 2, 3, 4, 5, 6].filter((i) => `t${i}` !== from).sort((a, b) => Number(!k.cols[a].up.length) - Number(!k.cols[b].up.length));
  for (const i of order) if (fitsColumn(k.cols[i], card)) return `${from}>t${i}${depth > 1 ? `:${depth}` : ""}`;
  return null;
}

/** Replay a game's moves from its seed; throws on an illegal move. */
export function replaySol(seed: number, moves: readonly unknown[]): Klondike {
  let k = dealKlondike(seed);
  for (const m of moves) {
    const next = typeof m === "string" ? applySol(k, m) : null;
    if (!next) throw new Error("illegal move");
    k = next;
  }
  return k;
}
