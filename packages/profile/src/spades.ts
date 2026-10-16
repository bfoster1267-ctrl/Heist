// Spades: you and a crew partner (across the table) against two of the crew. Everyone bids the tricks they'll
// take (0 is Nil); spades are always trump and can't be led until one has been played. Make your team's bid
// for 10 a trick plus 1 a bag (overtrick); miss it and lose 10 a trick. Nil is +100 or -100. Every 10 bags
// cost 100. First team to the target (500, or 250 for a quick game) wins; a team at -200 is out. Like Hearts,
// the bots only use their own hand and the public record, so the server replays games from the seed.

import { cardSuit, type PlayingCard } from "./solitaire";
import {
  CREW, SPADES, beats, dealHands, following, highest, isCard, isMaster, ledSuit, lowest, newTricks, nextSeat,
  partnerOf, playTo, power, suitCount, winningPlay, type CrewMember, type Seat, type TrickState,
} from "./tricks";

export const SPADES_TARGET = 500;
export const SPADES_QUICK_TARGET = 250;
/** a team this low is out of the game */
export const SPADES_FLOOR = -200;
export const SPADES_BAG_LIMIT = 10;
/** a tie at the top plays on, up to this many hands */
const MAX_HANDS = 40;

/** you, then the crew clockwise: Ledger across is your partner */
export const SPADES_CREW: readonly (CrewMember | null)[] = [null, CREW.lou, CREW.ledger, CREW.duchess];

/** team 0 is you and your partner (seats 0 and 2), team 1 the other two */
export const teamOf = (s: Seat) => (s % 2) as 0 | 1;

export interface SpadesHandResult {
  bids: number[];
  tricks: number[];
  /** points each team scored this hand (bags and their penalty included) */
  delta: [number, number];
  /** bags each team took this hand */
  bags: [number, number];
  /** a team that hit 10 bags this hand */
  bagPenalty: [boolean, boolean];
  /** whether each team made its bid (null: the team bid only Nil) */
  made: [boolean | null, boolean | null];
  last: TrickState["last"];
}

export interface SpadesState {
  seed: number;
  hand: number;
  target: number;
  phase: "bid" | "play" | "over";
  dealer: Seat;
  /** each seat's bid this hand (0 is Nil, null: not yet) */
  bids: (number | null)[];
  t: TrickState;
  broken: boolean;
  scores: [number, number];
  bags: [number, number];
  results: SpadesHandResult[];
  winner: 0 | 1 | null;
}

export function dealSpades(
  seed: number,
  target = SPADES_TARGET,
  hand = 0,
  scores: [number, number] = [0, 0],
  bags: [number, number] = [0, 0],
  results: SpadesHandResult[] = [],
): SpadesState {
  const dealer = ((3 + hand) % 4) as Seat;
  // bidding and the first lead start on the dealer's left; t.turn says whose bid or play it is
  return {
    seed, hand, target, phase: "bid", dealer,
    bids: [null, null, null, null],
    t: newTricks(dealHands(seed, hand), nextSeat(dealer)),
    broken: false,
    scores: [...scores] as [number, number],
    bags: [...bags] as [number, number],
    results: [...results],
    winner: null,
  };
}

/** The cards the seat to play may play now. */
export function spadesLegal(s: SpadesState): PlayingCard[] {
  if (s.phase !== "play") return [];
  const hand = s.t.hands[s.t.turn];
  const led = ledSuit(s.t);
  if (led !== null) return following(hand, led);
  if (!s.broken) {
    const rest = hand.filter((c) => cardSuit(c) !== SPADES);
    if (rest.length) return rest;
  }
  return [...hand];
}

export const spadesYourMove = (s: SpadesState) => s.phase !== "over" && s.t.turn === 0;

/** What a seat would bid: count sure tricks, spade length and ruffs; Nil on a hand with nothing in it. */
export function spadesPickBid(s: SpadesState, seat: Seat, risk = SPADES_CREW[seat]?.risk ?? 0): number {
  const hand = s.t.hands[seat];
  const spades = hand.filter((c) => cardSuit(c) === SPADES);
  const sp = spades.length;
  let est = 0;
  for (const c of spades) {
    const p = power(c);
    if (p === 14) est += 1;
    else if (p === 13) est += sp >= 2 ? 0.9 : 0.3;
    else if (p === 12) est += sp >= 3 ? 0.7 : 0.2;
  }
  est += Math.max(0, sp - 3) * 0.85;
  let sideHigh = 0;
  for (const su of [1, 2, 3]) {
    const cs = hand.filter((c) => cardSuit(c) === su);
    const len = cs.length;
    for (const c of cs) {
      const p = power(c);
      if (p === 14) est += len <= 6 ? 0.95 : 0.6;
      else if (p === 13) est += len >= 2 && len <= 5 ? 0.7 : len === 1 ? 0.15 : 0.35;
      else if (p === 12) est += len >= 3 && len <= 4 ? 0.3 : 0;
      if (p >= 13) sideHigh++;
    }
    if (len === 0 && sp >= 2) est += 0.85;
    else if (len === 1 && sp >= 3) est += 0.45;
    else if (len === 2 && sp >= 4) est += 0.2;
  }
  est += risk * 0.35;
  const partnerBid = s.bids[partnerOf(seat)];
  const nilOk = partnerBid !== 0 && sp <= 3 && spades.every((c) => power(c) < 11) && sideHigh === 0 && est < 1.4 + risk * 0.2;
  if (nilOk) return 0;
  let bid = Math.max(1, Math.min(13, Math.round(est)));
  if (partnerBid !== null) bid = Math.max(1, Math.min(bid, 13 - partnerBid));
  return bid;
}

/** The card a bot (or the hint, for seat 0) plays: cash winners, cover a Nil partner, duck when bags pile up. */
export function spadesPickCard(s: SpadesState): PlayingCard {
  const legal = spadesLegal(s);
  if (legal.length === 1) return legal[0];
  const t = s.t;
  const seat = t.turn;
  const hand = t.hands[seat];
  const led = ledSuit(t);
  const mate = partnerOf(seat);
  const myBid = s.bids[seat] ?? 1;
  const mateBid = s.bids[mate] ?? 1;
  const nilMe = myBid === 0;
  const nilMate = mateBid === 0;
  const contract = (nilMe ? 0 : myBid) + (nilMate ? 0 : mateBid);
  const counted = (nilMe ? 0 : t.tricks[seat]) + (nilMate ? 0 : t.tricks[mate]);
  const need = contract - counted;
  // made it already and bags are piling up: stop taking tricks
  const duck = need <= 0 && s.bags[teamOf(seat)] >= 5;
  const nonSpades = (cs: PlayingCard[]) => cs.filter((c) => cardSuit(c) !== SPADES);
  const opps = [nextSeat(seat), nextSeat(mate)];

  if (nilMe) {
    if (led === null) {
      const pool = nonSpades(legal).length ? nonSpades(legal) : legal;
      return lowest(pool);
    }
    const win = winningPlay(t.trick, SPADES).card;
    const under = legal.filter((c) => !beats(c, win, led, SPADES));
    if (under.length) {
      const off = nonSpades(under);
      return highest(off.length ? off : under);
    }
    return lowest(legal);
  }

  if (led === null) {
    if (nilMate) {
      // lead high so a Nil partner can duck underneath
      const off = nonSpades(legal);
      return highest(off.length ? off : legal);
    }
    if (duck) {
      const off = nonSpades(legal);
      return lowest(off.length ? off : legal);
    }
    const cash = legal.filter((c) => cardSuit(c) !== SPADES && isMaster(t, c, hand) && !opps.some((o) => t.voids[o][cardSuit(c)] && !t.voids[o][SPADES]));
    if (cash.length) return highest(cash);
    const mySpades = legal.filter((c) => cardSuit(c) === SPADES);
    if (s.broken && mySpades.length >= 3 && isMaster(t, highest(mySpades), hand)) return highest(mySpades);
    // a suit partner is out of (and can trump), else the longest side suit, low
    for (const su of [1, 2, 3]) {
      const cs = legal.filter((c) => cardSuit(c) === su);
      if (cs.length && t.voids[mate][su] && !t.voids[mate][SPADES]) return lowest(cs);
    }
    const off = nonSpades(legal);
    const pool = off.length ? off : legal;
    const longest = pool.reduce((a, b) => (suitCount(hand, cardSuit(b)) > suitCount(hand, cardSuit(a)) ? b : a));
    return lowest(pool.filter((c) => cardSuit(c) === cardSuit(longest)));
  }

  const best = winningPlay(t.trick, SPADES);
  const last = t.trick.length === 3;
  const winners = legal.filter((c) => beats(c, best.card, led, SPADES));
  const losers = legal.filter((c) => !beats(c, best.card, led, SPADES));
  const shed = (cs: PlayingCard[]) => {
    const off = nonSpades(cs);
    return lowest(off.length ? off : cs);
  };

  if (nilMate && best.seat === mate) return winners.length ? lowest(winners) : shed(legal);
  const mateHolds = best.seat === mate && (last || (cardSuit(best.card) === led && isMaster(t, best.card, hand)) || cardSuit(best.card) === SPADES && led !== SPADES);
  if (mateHolds) return shed(legal);
  // never trump a trick partner is already winning
  if (best.seat === mate && winners.length && cardSuit(winners[0]) !== led) return shed(losers.length ? losers : legal);
  // an opponent bid Nil and hasn't taken a trick: stay under them when we can
  const nilOpp = opps.find((o) => s.bids[o] === 0 && t.tricks[o] === 0);
  if (nilOpp !== undefined && best.seat === nilOpp && losers.length) return highest(losers);
  if (duck) return losers.length ? highest(losers) : lowest(winners);
  if (!winners.length) return shed(legal);
  if (last) return lowest(winners);
  if (cardSuit(winners[0]) !== led) return lowest(winners); // trumping in: as cheaply as possible
  if (t.trick.length === 1) {
    // second hand low, unless we hold the master
    const masters = winners.filter((c) => isMaster(t, c, hand));
    return masters.length ? lowest(masters) : lowest(legal);
  }
  const masters = winners.filter((c) => isMaster(t, c, hand));
  return masters.length ? lowest(masters) : highest(winners);
}

function scoreHand(s: SpadesState, t: TrickState): SpadesState {
  const bids = s.bids.map((b) => b ?? 0);
  const delta: [number, number] = [0, 0];
  const newBags: [number, number] = [0, 0];
  const penalty: [boolean, boolean] = [false, false];
  const made: [boolean | null, boolean | null] = [null, null];
  const bags: [number, number] = [...s.bags] as [number, number];
  for (const team of [0, 1] as const) {
    const seats = [team, team + 2];
    let contract = 0;
    let got = 0;
    for (const seat of seats) {
      if (bids[seat] === 0) {
        delta[team] += t.tricks[seat] === 0 ? 100 : -100;
        // a broken Nil's tricks don't help the partner's bid, but they're bags
        newBags[team] += t.tricks[seat];
      } else {
        contract += bids[seat];
        got += t.tricks[seat];
      }
    }
    if (contract > 0) {
      made[team] = got >= contract;
      if (got >= contract) {
        delta[team] += 10 * contract;
        newBags[team] += got - contract;
      } else delta[team] -= 10 * contract;
    }
    delta[team] += newBags[team];
    bags[team] += newBags[team];
    while (bags[team] >= SPADES_BAG_LIMIT) {
      bags[team] -= SPADES_BAG_LIMIT;
      delta[team] -= 100;
      penalty[team] = true;
    }
  }
  const scores: [number, number] = [s.scores[0] + delta[0], s.scores[1] + delta[1]];
  const results = [...s.results, { bids, tricks: [...t.tricks], delta, bags: newBags, bagPenalty: penalty, made, last: t.last }];
  const ended = scores.some((n) => n >= s.target || n <= SPADES_FLOOR);
  if (ended && (scores[0] !== scores[1] || s.hand + 1 >= MAX_HANDS)) {
    return { ...s, t, scores, bags, results, phase: "over", winner: scores[1] > scores[0] ? 1 : 0 };
  }
  return dealSpades(s.seed, s.target, s.hand + 1, scores, bags, results);
}

function bid(s: SpadesState, n: number): SpadesState {
  const seat = s.t.turn;
  const bids = s.bids.map((b, i) => (i === seat ? n : b));
  const next = nextSeat(seat);
  if (bids.every((b) => b !== null)) return { ...s, bids, phase: "play", t: { ...s.t, turn: s.t.leader } };
  return { ...s, bids, t: { ...s.t, turn: next } };
}

function play(s: SpadesState, card: PlayingCard): SpadesState {
  const t = playTo(s.t, card, SPADES);
  const broken = s.broken || cardSuit(card) === SPADES;
  if (t.count < 13) return { ...s, t, broken };
  return scoreHand({ ...s, broken }, t);
}

/** A bid move: "b0" is Nil, "b1".."b13". */
export const spadesBidMove = (n: number) => `b${n}`;
const parseBid = (m: unknown) => {
  if (typeof m !== "string") return null;
  const x = /^b(\d{1,2})$/.exec(m);
  const n = x ? Number(x[1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 13 ? n : null;
};

/** The player's move (a bid, or a card to play); null when it isn't theirs or isn't legal. */
export function applySpades(s: SpadesState, m: unknown): SpadesState | null {
  if (s.t.turn !== 0) return null;
  if (s.phase === "bid") {
    const n = parseBid(m);
    return n === null ? null : bid(s, n);
  }
  if (s.phase !== "play" || !isCard(m) || !spadesLegal(s).includes(m)) return null;
  return play(s, m);
}

/** One bot bids or plays (nothing happens on the player's move or after the game). */
export function spadesBotStep(s: SpadesState): SpadesState {
  if (s.phase === "over" || s.t.turn === 0) return s;
  if (s.phase === "bid") return bid(s, spadesPickBid(s, s.t.turn));
  return play(s, spadesPickCard(s));
}

export function advanceSpades(s: SpadesState): SpadesState {
  let x = s;
  while (x.phase !== "over" && x.t.turn !== 0) x = spadesBotStep(x);
  return x;
}

export const spadesTarget = (quick: unknown) => (quick ? SPADES_QUICK_TARGET : SPADES_TARGET);

/** Replay a game from its seed and the player's moves (stopping at the first one that doesn't fit). */
export function replaySpades(seed: number, moves: readonly unknown[], target = SPADES_TARGET): SpadesState {
  let s = advanceSpades(dealSpades(seed, target));
  for (const m of moves) {
    if (s.phase === "over") break;
    const n = applySpades(s, m);
    if (!n) break;
    s = advanceSpades(n);
  }
  return s;
}

export interface SpadesTally {
  hands: number;
  /** tricks you took yourself */
  tricks: number;
  /** bids your team made */
  contracts: number;
  /** Nils you made */
  nils: number;
  won: boolean;
  over: boolean;
}

export function spadesTallyOf(s: SpadesState): SpadesTally {
  return {
    hands: s.results.length,
    tricks: s.results.reduce((n, r) => n + (r.bids[0] === 0 ? 0 : r.tricks[0]), 0),
    contracts: s.results.filter((r) => r.made[0] === true).length,
    nils: s.results.filter((r) => r.bids[0] === 0 && r.tricks[0] === 0).length,
    won: s.phase === "over" && s.winner === 0,
    over: s.phase === "over",
  };
}

export const tallySpades = (seed: number, moves: readonly unknown[], target = SPADES_TARGET): SpadesTally =>
  spadesTallyOf(replaySpades(seed, moves, target));

export const SPADES_XP = { trick: 2, contract: 8, nil: 25, win: 50 };
export const SPADES_DAY_XP = 500;
export const SPADES_IDLE_S = 30;

const NO_SPADES: SpadesTally = { hands: 0, tricks: 0, contracts: 0, nils: 0, won: false, over: false };

export function tallySpadesXp(t: SpadesTally): number {
  return t.tricks * SPADES_XP.trick + t.contracts * SPADES_XP.contract + t.nils * SPADES_XP.nil + (t.won ? SPADES_XP.win : 0);
}

export function spadesGain(paid: SpadesTally | undefined, t: SpadesTally) {
  const p = paid ?? NO_SPADES;
  const gained: SpadesTally = {
    hands: Math.max(0, t.hands - p.hands),
    tricks: Math.max(0, t.tricks - p.tricks),
    contracts: Math.max(0, t.contracts - p.contracts),
    nils: Math.max(0, t.nils - p.nils),
    won: t.won && !p.won,
    over: t.over && !p.over,
  };
  return {
    gained,
    paid: {
      hands: Math.max(t.hands, p.hands),
      tricks: Math.max(t.tricks, p.tricks),
      contracts: Math.max(t.contracts, p.contracts),
      nils: Math.max(t.nils, p.nils),
      won: t.won || p.won,
      over: t.over || p.over,
    },
    any: tallySpadesXp(gained) > 0,
  };
}

export function spadesPay(paid: SpadesTally | undefined, paidXp: number | undefined, t: SpadesTally, drain: number) {
  const g = spadesGain(paid, t);
  const before = paidXp ?? tallySpadesXp(paid ?? NO_SPADES);
  const pot = Math.max(0, tallySpadesXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
