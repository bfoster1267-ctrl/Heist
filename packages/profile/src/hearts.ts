// Hearts vs three of the crew: standard four-player rules. Pass three cards left, right, across, then hold;
// the 2♣ leads; no points on the first trick; hearts can't be led until one has been played; each heart is
// a point and the Q♠ is 13; take all 26 and you shoot the moon (everyone else gets 26). When anyone reaches
// 100 the lowest score wins. The bots are pure functions of their own hand and what's been played, so the
// server replays a whole game from the seed and the player's own passes and plays.

import { cardSuit, type PlayingCard } from "./solitaire";
import {
  CREW, HEARTS, QUEEN_OF_SPADES, SPADES, TWO_OF_CLUBS, dealHands, following, highest, isCard, ledSuit, lowerOut, lowest,
  newTricks, playTo, power, sortHand, suitCount, winningPlay, type CrewMember, type Seat, type TrickState,
} from "./tricks";

export type HeartsPass = "left" | "right" | "across" | "hold";
export const HEARTS_PASSES: readonly HeartsPass[] = ["left", "right", "across", "hold"];
/** who a seat passes to: seat + offset */
export const HEARTS_PASS_OFFSET: Record<HeartsPass, number> = { left: 1, across: 2, right: 3, hold: 0 };
export const HEARTS_TARGET = 100;
/** a tie for the lowest score plays on, up to this many hands */
const MAX_HANDS = 40;

/** you, then the crew clockwise */
export const HEARTS_CREW: readonly (CrewMember | null)[] = [null, CREW.lou, CREW.duchess, CREW.nails];

export interface HeartsHandResult {
  /** points each seat scored this hand (after a moon) */
  points: number[];
  /** the seat that shot the moon, if one did */
  moon: Seat | null;
  /** the hand's last trick, so the table can sweep it before the next deal */
  last: TrickState["last"];
}

export interface HeartsState {
  seed: number;
  hand: number;
  phase: "pass" | "play" | "over";
  pass: HeartsPass;
  t: TrickState;
  /** the three cards you passed and the three you got this hand */
  sent: PlayingCard[];
  received: PlayingCard[];
  broken: boolean;
  scores: number[];
  results: HeartsHandResult[];
  winner: Seat | null;
}

/** A heart is a point and the Q♠ is 13. */
export const heartsPoints = (c: PlayingCard) => (cardSuit(c) === HEARTS ? 1 : c === QUEEN_OF_SPADES ? 13 : 0);

const holderOf = (hands: PlayingCard[][], c: PlayingCard) => Math.max(0, hands.findIndex((h) => h.includes(c))) as Seat;

export function dealHearts(seed: number, hand = 0, scores: number[] = [0, 0, 0, 0], results: HeartsHandResult[] = []): HeartsState {
  const hands = dealHands(seed, hand);
  const pass = HEARTS_PASSES[hand % 4];
  return {
    seed, hand, pass,
    phase: pass === "hold" ? "play" : "pass",
    t: newTricks(hands, holderOf(hands, TWO_OF_CLUBS)),
    sent: [], received: [],
    broken: false,
    scores: [...scores],
    results: [...results],
    winner: null,
  };
}

/** The cards the seat to play may play now. */
export function heartsLegal(s: HeartsState): PlayingCard[] {
  if (s.phase !== "play") return [];
  const t = s.t;
  const hand = t.hands[t.turn];
  if (t.count === 0 && t.trick.length === 0) return hand.includes(TWO_OF_CLUBS) ? [TWO_OF_CLUBS] : [...hand];
  const led = ledSuit(t);
  if (led !== null) {
    const may = following(hand, led);
    if (cardSuit(may[0]) === led) return may;
    // shown out on the first trick: no points, unless that's all you hold
    if (t.count === 0) {
      const clean = hand.filter((c) => heartsPoints(c) === 0);
      if (clean.length) return clean;
    }
    return may;
  }
  if (!s.broken) {
    const rest = hand.filter((c) => cardSuit(c) !== HEARTS);
    if (rest.length) return rest;
  }
  return [...hand];
}

/** It's the player's move: picking a pass, or their turn to play. */
export const heartsYourMove = (s: HeartsState) => s.phase === "pass" || (s.phase === "play" && s.t.turn === 0);

/** The three cards a seat would pass: the Q♠ and the big spades, high hearts, and short suits to void. */
export function heartsPickPass(hand: readonly PlayingCard[], risk = 0): PlayingCard[] {
  const lowSpades = hand.filter((c) => cardSuit(c) === SPADES && power(c) < 12).length;
  const hasQueen = hand.includes(QUEEN_OF_SPADES);
  const danger = (c: PlayingCard) => {
    const s = cardSuit(c);
    const p = power(c);
    if (c === QUEEN_OF_SPADES) return lowSpades >= 4 ? 12 : 100;
    if (s === SPADES && p > 12) return hasQueen ? 85 : lowSpades >= 4 - risk ? 18 : 75;
    if (s === HEARTS) return p * 4 + 2;
    if (c === TWO_OF_CLUBS) return 0;
    const len = suitCount(hand, s);
    return p * 3 + (len <= 2 ? 25 - len * 5 : 0);
  };
  return [...hand].sort((a, b) => danger(b) - danger(a) || a - b).slice(0, 3);
}

/** Points each seat has taken so far this hand. */
const takenPoints = (t: TrickState) => t.taken.map((cs) => cs.reduce((n, c) => n + heartsPoints(c), 0));

/** The card a bot (or the hint, for seat 0) plays: duck under the winner, dump the Q♠ and big cards when void. */
export function heartsPickCard(s: HeartsState): PlayingCard {
  const legal = heartsLegal(s);
  if (legal.length === 1) return legal[0];
  const t = s.t;
  const seat = t.turn;
  const hand = t.hands[seat];
  const led = ledSuit(t);
  const holdsQueen = hand.includes(QUEEN_OF_SPADES);
  const queenOut = !holdsQueen && !t.played.includes(QUEEN_OF_SPADES);
  // someone else is running the table: keep them from taking every point
  const pts = takenPoints(t);
  const total = pts.reduce((a, b) => a + b, 0);
  const runner = pts.findIndex((p) => p > 0 && p === total);
  const defend = runner >= 0 && runner !== seat && total >= 10;

  if (led === null) {
    let best = legal[0];
    let bestScore = Infinity;
    for (const c of legal) {
      const su = cardSuit(c);
      const p = power(c);
      let score = p;
      if (su === SPADES) {
        if (holdsQueen) score += p >= 12 ? 40 : 4;
        else if (queenOut) score += p < 12 ? -6 : 30;
      }
      if (su === HEARTS) score += defend ? -8 : 4;
      // nobody can follow under it: whoever follows takes the trick
      if (lowerOut(t, c, hand) === 0) score -= 10;
      // a seat that's out of the suit can unload points on us
      const outs = [1, 2, 3].filter((d) => t.voids[(seat + d) % 4][su]).length;
      score += outs * (p > 8 ? 9 : 3);
      if (score < bestScore || (score === bestScore && c < best)) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  const win = winningPlay(t.trick, null).card;
  const trickPts = t.trick.reduce((n, p) => n + heartsPoints(p.card), 0);
  const last = t.trick.length === 3;

  if (cardSuit(legal[0]) === led) {
    const under = legal.filter((c) => power(c) < power(win));
    if (led === SPADES && holdsQueen && under.includes(QUEEN_OF_SPADES)) return QUEEN_OF_SPADES;
    if (defend && led === HEARTS) return highest(legal);
    const safe = legal.filter((c) => c !== QUEEN_OF_SPADES);
    if (last && trickPts === 0 && safe.some((c) => power(c) > power(win)) && !(led === SPADES && queenOut)) return highest(safe);
    if (under.length) return highest(under);
    const pool = safe.length ? safe : legal;
    if (led === SPADES && queenOut && !last) return lowest(pool);
    return highest(pool);
  }

  // shown out: unload the worst card in hand
  if (legal.includes(QUEEN_OF_SPADES) && !defend) return QUEEN_OF_SPADES;
  if (queenOut) {
    const big = legal.filter((c) => cardSuit(c) === SPADES && power(c) > 12);
    if (big.length) return highest(big);
  }
  const hearts = legal.filter((c) => cardSuit(c) === HEARTS);
  if (hearts.length && !defend) return highest(hearts);
  const rest = legal.filter((c) => cardSuit(c) !== HEARTS && c !== QUEEN_OF_SPADES);
  const pool = rest.length ? rest : legal;
  // the highest card, leaning toward suits we can soon be out of
  return pool.reduce((a, b) => {
    const sa = power(a) * 2 - suitCount(hand, cardSuit(a));
    const sb = power(b) * 2 - suitCount(hand, cardSuit(b));
    return sb > sa || (sb === sa && b < a) ? b : a;
  });
}

function play(s: HeartsState, card: PlayingCard): HeartsState {
  const t = playTo(s.t, card, null);
  const broken = s.broken || cardSuit(card) === HEARTS;
  if (t.count < 13) return { ...s, t, broken };
  // the hand is over: score it
  let points = takenPoints(t);
  const shooter = points.findIndex((p) => p === 26);
  const moon = shooter >= 0 ? (shooter as Seat) : null;
  if (moon !== null) points = points.map((_, i) => (i === moon ? 0 : 26));
  const scores = s.scores.map((n, i) => n + points[i]);
  const results = [...s.results, { points, moon, last: t.last }];
  if (Math.max(...scores) >= HEARTS_TARGET) {
    const low = Math.min(...scores);
    const leaders = scores.map((n, i) => (n === low ? i : -1)).filter((i) => i >= 0);
    if (leaders.length === 1 || s.hand + 1 >= MAX_HANDS) return { ...s, t, broken, scores, results, phase: "over", winner: leaders[0] as Seat };
  }
  return dealHearts(s.seed, s.hand + 1, scores, results);
}

/** Exchange the passes: the player's three cards and each bot's own pick. */
function exchange(s: HeartsState, mine: PlayingCard[]): HeartsState {
  const off = HEARTS_PASS_OFFSET[s.pass];
  const picks = s.t.hands.map((h, seat) => (seat === 0 ? mine : heartsPickPass(h, HEARTS_CREW[seat]?.risk ?? 0)));
  const hands = s.t.hands.map((h, seat) => {
    const from = (seat - off + 4) % 4;
    return sortHand([...h.filter((c) => !picks[seat].includes(c)), ...picks[from]]);
  });
  return {
    ...s,
    phase: "play",
    t: newTricks(hands, holderOf(hands, TWO_OF_CLUBS)),
    sent: [...mine],
    received: [...picks[(4 - off) % 4]],
  };
}

/** The player's move (three cards to pass, or a card to play); null when it isn't theirs or isn't legal. */
export function applyHearts(s: HeartsState, m: unknown): HeartsState | null {
  if (s.phase === "pass") {
    if (!Array.isArray(m) || m.length !== 3 || !m.every(isCard) || new Set(m).size !== 3) return null;
    if (!m.every((c) => s.t.hands[0].includes(c))) return null;
    return exchange(s, m as PlayingCard[]);
  }
  if (s.phase !== "play" || s.t.turn !== 0 || !isCard(m) || !heartsLegal(s).includes(m)) return null;
  return play(s, m);
}

/** One bot plays its card (nothing happens on the player's move or after the game). */
export function heartsBotStep(s: HeartsState): HeartsState {
  if (s.phase !== "play" || s.t.turn === 0) return s;
  return play(s, heartsPickCard(s));
}

/** Let the bots play until it's the player's move or the game is over. */
export function advanceHearts(s: HeartsState): HeartsState {
  let x = s;
  while (x.phase === "play" && x.t.turn !== 0) x = heartsBotStep(x);
  return x;
}

/** Replay a game from its seed and the player's moves (stopping at the first one that doesn't fit). */
export function replayHearts(seed: number, moves: readonly unknown[]): HeartsState {
  let s = advanceHearts(dealHearts(seed));
  for (const m of moves) {
    if (s.phase === "over") break;
    const n = applyHearts(s, m);
    if (!n) break;
    s = advanceHearts(n);
  }
  return s;
}

export interface HeartsTally {
  /** hands played to the end */
  hands: number;
  /** points you kept out of your pile, over every finished hand (26 a hand at most) */
  avoided: number;
  /** times you shot the moon */
  moons: number;
  won: boolean;
  /** the game is finished, won or lost */
  over: boolean;
}

export function heartsTallyOf(s: HeartsState): HeartsTally {
  return {
    hands: s.results.length,
    avoided: s.results.reduce((n, r) => n + Math.max(0, 26 - r.points[0]), 0),
    moons: s.results.filter((r) => r.moon === 0).length,
    won: s.phase === "over" && s.winner === 0,
    over: s.phase === "over",
  };
}

export const tallyHearts = (seed: number, moves: readonly unknown[]): HeartsTally => heartsTallyOf(replayHearts(seed, moves));

export const HEARTS_XP = { avoided: 1, moon: 25, win: 50 };
export const HEARTS_DAY_XP = 500;
export const HEARTS_IDLE_S = 30;

const NO_HEARTS: HeartsTally = { hands: 0, avoided: 0, moons: 0, won: false, over: false };

export function tallyHeartsXp(t: HeartsTally): number {
  return t.avoided * HEARTS_XP.avoided + t.moons * HEARTS_XP.moon + (t.won ? HEARTS_XP.win : 0);
}

export function heartsGain(paid: HeartsTally | undefined, t: HeartsTally) {
  const p = paid ?? NO_HEARTS;
  const gained: HeartsTally = {
    hands: Math.max(0, t.hands - p.hands),
    avoided: Math.max(0, t.avoided - p.avoided),
    moons: Math.max(0, t.moons - p.moons),
    won: t.won && !p.won,
    over: t.over && !p.over,
  };
  return {
    gained,
    paid: {
      hands: Math.max(t.hands, p.hands),
      avoided: Math.max(t.avoided, p.avoided),
      moons: Math.max(t.moons, p.moons),
      won: t.won || p.won,
      over: t.over || p.over,
    },
    any: tallyHeartsXp(gained) > 0,
  };
}

export function heartsPay(paid: HeartsTally | undefined, paidXp: number | undefined, t: HeartsTally, drain: number) {
  const g = heartsGain(paid, t);
  const before = paidXp ?? tallyHeartsXp(paid ?? NO_HEARTS);
  const pot = Math.max(0, tallyHeartsXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
