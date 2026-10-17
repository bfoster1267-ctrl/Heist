// The trick-taking core Hearts and Spades share: four seats, a seeded deal, following suit, who takes a
// trick, and what everyone at the table has seen (cards played, suits a seat has shown out of). Bots only
// ever read their own hand and this public record, so their play is fair and replays exactly from a seed.

import { cardRank, cardSuit, type PlayingCard } from "./solitaire";

export { cardSuit };

export type { PlayingCard };

/** 0 is you (south); play goes clockwise: 1 west (your left), 2 north (across), 3 east (your right). */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export const SPADES = 0;
export const HEARTS = 1;
export const DIAMONDS = 2;
export const CLUBS = 3;
/** Q♠ (suit 0, rank 12) */
export const QUEEN_OF_SPADES: PlayingCard = 11;
/** 2♣ (suit 3, rank 2) */
export const TWO_OF_CLUBS: PlayingCard = 40;

/** Card strength within its suit: 2 low, Ace high (14). */
export const power = (c: PlayingCard) => (cardRank(c) === 1 ? 14 : cardRank(c));
export const nextSeat = (s: Seat) => ((s + 1) % 4) as Seat;
export const partnerOf = (s: Seat) => ((s + 2) % 4) as Seat;

/** The crew at the card table: who sits where, and how boldly they play. */
export interface CrewMember {
  id: string;
  name: string;
  role: string;
  /** -1 cautious to +1 reckless: nudges passes and bids, never which cards are legal */
  risk: number;
}

export const CREW: Record<string, CrewMember> = {
  lou: { id: "lou", name: "Lou", role: "The Wheelman", risk: 1 },
  duchess: { id: "duchess", name: "Duchess", role: "The Grifter", risk: -1 },
  nails: { id: "nails", name: "Nails", role: "The Safecracker", risk: 0 },
  ledger: { id: "ledger", name: "Ledger", role: "The Fixer", risk: 0 },
};

/** mulberry32, like every other deal in the arcade */
export function trickRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hand `n` of a game gets its own shuffle, still fixed by the game's seed. */
export function handSeed(seed: number, hand: number) {
  return (seed ^ Math.imul(hand + 1, 0x9e3779b1)) >>> 0;
}

/** Suits alternate colour in a fanned hand: ♠ ♥ ♣ ♦, low to high. */
const SUIT_ORDER = [SPADES, HEARTS, CLUBS, DIAMONDS];
export function sortHand(cards: readonly PlayingCard[]): PlayingCard[] {
  return [...cards].sort((a, b) => SUIT_ORDER.indexOf(cardSuit(a)) - SUIT_ORDER.indexOf(cardSuit(b)) || power(a) - power(b));
}

/** Shuffle a full deck from the seed and deal 13 to each seat. */
export function dealHands(seed: number, hand: number): PlayingCard[][] {
  const r = trickRng(handSeed(seed, hand));
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return [0, 1, 2, 3].map((s) => sortHand(deck.slice(s * 13, s * 13 + 13)));
}

export interface Play {
  seat: Seat;
  card: PlayingCard;
}

export interface TrickState {
  hands: PlayingCard[][];
  /** the trick on the table, in the order played */
  trick: Play[];
  leader: Seat;
  turn: Seat;
  /** tricks taken this hand, per seat */
  tricks: number[];
  /** cards taken this hand, per seat */
  taken: PlayingCard[][];
  /** every card played this hand, in order (the current trick's too) */
  played: PlayingCard[];
  /** [seat][suit]: that seat has shown out of that suit this hand */
  voids: boolean[][];
  /** the last finished trick and who took it */
  last: { plays: Play[]; winner: Seat } | null;
  /** tricks finished this hand */
  count: number;
}

export function newTricks(hands: PlayingCard[][], leader: Seat): TrickState {
  return {
    hands: hands.map((h) => [...h]),
    trick: [],
    leader,
    turn: leader,
    tricks: [0, 0, 0, 0],
    taken: [[], [], [], []],
    played: [],
    voids: [0, 1, 2, 3].map(() => [false, false, false, false]),
    last: null,
    count: 0,
  };
}

export const ledSuit = (t: TrickState): number | null => (t.trick.length ? cardSuit(t.trick[0].card) : null);

/** The cards a hand may play to the led suit: follow it if you can. */
export function following(hand: readonly PlayingCard[], led: number | null): PlayingCard[] {
  if (led === null) return [...hand];
  const follow = hand.filter((c) => cardSuit(c) === led);
  return follow.length ? follow : [...hand];
}

/** Whether `c` beats `best` in a trick led in `led`, with an optional trump suit. */
export function beats(c: PlayingCard, best: PlayingCard, led: number, trump: number | null) {
  const cs = cardSuit(c);
  const bs = cardSuit(best);
  if (cs === bs) return power(c) > power(best);
  if (trump !== null && cs === trump) return true;
  if (trump !== null && bs === trump) return false;
  return cs === led && bs !== led;
}

/** The play winning a trick (so far). */
export function winningPlay(plays: readonly Play[], trump: number | null): Play {
  const led = cardSuit(plays[0].card);
  let best = plays[0];
  for (const p of plays.slice(1)) if (beats(p.card, best.card, led, trump)) best = p;
  return best;
}

/** Play `card` from the seat whose turn it is (the caller checked it's legal). A fourth card settles the trick. */
export function playTo(t: TrickState, card: PlayingCard, trump: number | null): TrickState {
  const seat = t.turn;
  const led = ledSuit(t);
  const hands = t.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h));
  const voids = t.voids.map((v) => [...v]);
  if (led !== null && cardSuit(card) !== led) voids[seat][led] = true;
  const trick = [...t.trick, { seat, card }];
  const played = [...t.played, card];
  if (trick.length < 4) return { ...t, hands, voids, trick, played, turn: nextSeat(seat) };
  const winner = winningPlay(trick, trump).seat;
  const tricks = t.tricks.map((n, i) => (i === winner ? n + 1 : n));
  const taken = t.taken.map((cs, i) => (i === winner ? [...cs, ...trick.map((p) => p.card)] : cs));
  return { ...t, hands, voids, trick: [], played, tricks, taken, leader: winner, turn: winner, last: { plays: trick, winner }, count: t.count + 1 };
}

/** No card of its suit still out (unplayed and not in `hand`) outranks `c`. */
export function isMaster(t: TrickState, c: PlayingCard, hand: readonly PlayingCard[]) {
  const s = cardSuit(c);
  for (let r = 0; r < 13; r++) {
    const o = s * 13 + r;
    if (power(o) > power(c) && !t.played.includes(o) && !hand.includes(o)) return false;
  }
  return true;
}

/** Cards of a suit still out (not played, not in `hand`) that rank below `c`. */
export function lowerOut(t: TrickState, c: PlayingCard, hand: readonly PlayingCard[]) {
  const s = cardSuit(c);
  let n = 0;
  for (let r = 0; r < 13; r++) {
    const o = s * 13 + r;
    if (power(o) < power(c) && !t.played.includes(o) && !hand.includes(o)) n++;
  }
  return n;
}

export const highest = (cs: readonly PlayingCard[]) => cs.reduce((a, b) => (power(b) > power(a) || (power(b) === power(a) && b < a) ? b : a));
export const lowest = (cs: readonly PlayingCard[]) => cs.reduce((a, b) => (power(b) < power(a) || (power(b) === power(a) && b < a) ? b : a));
export const suitCount = (hand: readonly PlayingCard[], s: number) => hand.filter((c) => cardSuit(c) === s).length;

/** A move the player sends: a card to play, three cards to pass (Hearts) or a bid like "b4" (Spades). */
export type TrickMove = PlayingCard | PlayingCard[] | string;

export const isCard = (m: unknown): m is PlayingCard => typeof m === "number" && Number.isInteger(m) && m >= 0 && m < 52;
