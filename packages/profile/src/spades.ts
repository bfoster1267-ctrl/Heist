// Spades vs bots (4-player cutthroat trick-taking card game).
// Spades are always trump. Bid the exact number of tricks you can take (or Nil = 0 for +50 pts) and outscore the table!
// Deterministic seeded deal and bot AI so the server can replay and verify every game from the player's moves alone.

export type SpadesLevel = "rookie" | "pro" | "boss";
export const SPADES_LEVELS: readonly SpadesLevel[] = ["rookie", "pro", "boss"];
export const isSpadesLevel = (x: unknown): x is SpadesLevel => x === "rookie" || x === "pro" || x === "boss";

export type SpadesSeat = 0 | 1 | 2 | 3;

/**
 * Cards are numbered 0..51:
 * suit = Math.floor(card / 13): 0 = Clubs (♣), 1 = Diamonds (♦), 2 = Hearts (♥), 3 = Spades (♠, trump!)
 * rank = card % 13: 0 = 2, 1 = 3, ..., 8 = 10, 9 = J, 10 = Q, 11 = K, 12 = A
 */
export const SPADE_SUIT = 3;

export const spadesSuit = (card: number) => Math.floor(card / 13);
export const spadesRank = (card: number) => card % 13;

export interface SpadesTrickPlay {
  seat: SpadesSeat;
  card: number;
}

export interface SpadesCompletedTrick {
  cards: SpadesTrickPlay[];
  winner: SpadesSeat;
  trumped: boolean;
}

export interface SpadesState {
  seed: number;
  level: SpadesLevel;
  phase: "bid" | "play" | "done";
  /** 4 hands of card IDs (0..51), sorted by suit then rank */
  hands: [number[], number[], number[], number[]];
  /** each seat's contract bid (0 = Nil, 1..13 = tricks; null for seat 0 before bidding) */
  bids: [number | null, number, number, number];
  /** whose action is next */
  turn: SpadesSeat;
  /** who led the current trick */
  leader: SpadesSeat;
  /** cards on the felt in the current trick (0..3 while in progress) */
  trick: SpadesTrickPlay[];
  /** the most recently completed 4-card trick */
  lastTrick: SpadesCompletedTrick | null;
  /** completed tricks count (0..13) */
  trickNo: number;
  /** whether spades have been broken this hand */
  spadesBroken: boolean;
  /** tricks won by each seat */
  tricksWon: [number, number, number, number];
  /** final score for each seat (computed as tricks progress and finalized at 13 tricks) */
  scores: [number, number, number, number];
  /** whether seat 0 made their contract (at phase === "done") */
  madeContract: boolean;
  /** winning seat (highest score at the end of 13 tricks; 0 if you make contract and win/tie for highest) */
  winner: SpadesSeat | null;
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

const sortHand = (h: readonly number[]) => [...h].sort((a, b) => a - b);

/** Estimates a hand's trick-taking strength for bidding (0..13). */
export function spadesBotBid(hand: readonly number[], level: SpadesLevel, seed: number, seat: number): number {
  const r = rng((seed ^ Math.imul(seat + 1, 0x9e3779b1)) >>> 0);
  let est = 0;
  const suitCounts = [0, 0, 0, 0];
  for (const c of hand) suitCounts[spadesSuit(c)]++;

  for (const c of hand) {
    const suit = spadesSuit(c);
    const rank = spadesRank(c);
    if (suit === SPADE_SUIT) {
      if (rank === 12) est += 1.0; // A♠
      else if (rank === 11) est += 0.9; // K♠
      else if (rank === 10) est += 0.75; // Q♠
      else if (rank === 9) est += 0.55; // J♠
      else if (suitCounts[SPADE_SUIT] >= 4) est += 0.45;
      else if (rank >= 6) est += 0.25;
    } else {
      if (rank === 12) est += 0.9; // side Ace
      else if (rank === 11 && suitCounts[suit] >= 2) est += 0.65; // protected side King
      else if (rank === 10 && suitCounts[suit] >= 3) est += 0.3; // side Queen
    }
  }
  // Short side-suit ruffing bonus when holding enough spades
  if (suitCounts[SPADE_SUIT] >= 3) {
    for (let s = 0; s < 3; s++) {
      if (suitCounts[s] === 0) est += 0.7;
      else if (suitCounts[s] === 1) est += 0.35;
    }
  }
  if (level === "rookie") est += (r() - 0.5) * 1.4;
  const rounded = Math.round(est);
  // Nil bid only if hand is very weak and has no high spades
  const highSpades = hand.filter((c) => spadesSuit(c) === SPADE_SUIT && spadesRank(c) >= 9).length;
  if (rounded <= 0 && highSpades === 0 && level !== "rookie") return 0;
  return Math.max(1, Math.min(8, rounded));
}

export function scoreSpadesSeat(bid: number, tricks: number): number {
  if (bid === 0) return tricks === 0 ? 50 : -50;
  if (tricks >= bid) return bid * 10 + (tricks - bid);
  return -bid * 10;
}

export function newSpades(seed = 1, level: SpadesLevel = "pro"): SpadesState {
  const r = rng(seed ^ 0x53504144);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  const hands: [number[], number[], number[], number[]] = [
    sortHand(deck.slice(0, 13)),
    sortHand(deck.slice(13, 26)),
    sortHand(deck.slice(26, 39)),
    sortHand(deck.slice(39, 52)),
  ];
  const bids: [number | null, number, number, number] = [
    null,
    spadesBotBid(hands[1], level, seed, 1),
    spadesBotBid(hands[2], level, seed, 2),
    spadesBotBid(hands[3], level, seed, 3),
  ];
  const starter = ((seed >>> 0) % 4) as SpadesSeat;
  return {
    seed,
    level,
    phase: "bid",
    hands,
    bids,
    turn: 0,
    leader: starter,
    trick: [],
    lastTrick: null,
    trickNo: 0,
    spadesBroken: false,
    tricksWon: [0, 0, 0, 0],
    scores: [0, 0, 0, 0],
    madeContract: false,
    winner: null,
  };
}

export function isValidSpadesBid(s: SpadesState, bid: unknown): bid is number {
  return s.phase === "bid" && typeof bid === "number" && Number.isInteger(bid) && bid >= 0 && bid <= 13;
}

export function applySpadesBid(s: SpadesState, bid: number): SpadesState {
  if (!isValidSpadesBid(s, bid)) return s;
  return {
    ...s,
    phase: "play",
    bids: [bid, s.bids[1], s.bids[2], s.bids[3]],
    turn: s.leader,
  };
}

/** Legal cards for `seat` to play right now. */
export function spadesLegalPlays(s: SpadesState, seat: SpadesSeat = s.turn): number[] {
  if (s.phase !== "play" || s.turn !== seat) return [];
  const hand = s.hands[seat];
  if (!hand.length) return [];

  // Leading a trick
  if (s.trick.length === 0) {
    if (!s.spadesBroken) {
      const nonSpades = hand.filter((c) => spadesSuit(c) !== SPADE_SUIT);
      if (nonSpades.length > 0) return nonSpades;
    }
    return [...hand];
  }

  // Following suit
  const ledSuit = spadesSuit(s.trick[0].card);
  const inSuit = hand.filter((c) => spadesSuit(c) === ledSuit);
  if (inSuit.length > 0) return inSuit;
  return [...hand];
}

const beatsSpadesCard = (candidate: number, currentBest: number, ledSuit: number): boolean => {
  const candSuit = spadesSuit(candidate);
  const bestSuit = spadesSuit(currentBest);
  if (candSuit === SPADE_SUIT && bestSuit !== SPADE_SUIT) return true;
  if (candSuit === bestSuit) return spadesRank(candidate) > spadesRank(currentBest);
  if (candSuit === ledSuit && bestSuit !== SPADE_SUIT && bestSuit !== ledSuit) return true;
  return false;
};

/** Applies a single card play by `s.turn`. */
export function applySpadesCard(s: SpadesState, card: number): SpadesState {
  if (s.phase !== "play") return s;
  const legal = spadesLegalPlays(s, s.turn);
  if (!legal.includes(card)) return s;

  const seat = s.turn;
  const hands: [number[], number[], number[], number[]] = [
    [...s.hands[0]],
    [...s.hands[1]],
    [...s.hands[2]],
    [...s.hands[3]],
  ];
  hands[seat] = hands[seat].filter((c) => c !== card);

  const trick = [...s.trick, { seat, card }];
  const spadesBroken = s.spadesBroken || spadesSuit(card) === SPADE_SUIT;

  if (trick.length < 4) {
    return {
      ...s,
      hands,
      trick,
      spadesBroken,
      turn: ((seat + 1) % 4) as SpadesSeat,
    };
  }

  // Resolve 4-card trick
  const ledSuit = spadesSuit(trick[0].card);
  let winningPlay = trick[0];
  let trumped = false;
  for (const p of trick) {
    if (spadesSuit(p.card) === SPADE_SUIT && ledSuit !== SPADE_SUIT) trumped = true;
    if (beatsSpadesCard(p.card, winningPlay.card, ledSuit)) {
      winningPlay = p;
    }
  }
  const winner = winningPlay.seat;
  const tricksWon: [number, number, number, number] = [...s.tricksWon];
  tricksWon[winner] += 1;
  const trickNo = s.trickNo + 1;
  const lastTrick: SpadesCompletedTrick = { cards: trick, winner, trumped };

  const b0 = s.bids[0] ?? 1;
  const scores: [number, number, number, number] = [
    scoreSpadesSeat(b0, tricksWon[0]),
    scoreSpadesSeat(s.bids[1], tricksWon[1]),
    scoreSpadesSeat(s.bids[2], tricksWon[2]),
    scoreSpadesSeat(s.bids[3], tricksWon[3]),
  ];

  if (trickNo < 13) {
    return {
      ...s,
      hands,
      trick: [],
      lastTrick,
      trickNo,
      spadesBroken,
      tricksWon,
      scores,
      leader: winner,
      turn: winner,
    };
  }

  const madeContract = b0 === 0 ? tricksWon[0] === 0 : tricksWon[0] >= b0;
  const maxScore = Math.max(...scores);
  const gameWinner: SpadesSeat =
    madeContract && scores[0] === maxScore ? 0 : (scores.findIndex((sc) => sc === maxScore) as SpadesSeat);

  return {
    ...s,
    phase: "done",
    hands,
    trick: [],
    lastTrick,
    trickNo,
    spadesBroken,
    tricksWon,
    scores,
    madeContract,
    winner: gameWinner,
    leader: winner,
    turn: winner,
  };
}

/** Deterministic bot card selection for `s.turn`. */
export function spadesBotCard(s: SpadesState, level: SpadesLevel = s.level, seed: number = s.seed): number {
  const legal = spadesLegalPlays(s, s.turn);
  if (legal.length <= 1) return legal[0] ?? -1;

  const r = rng((seed ^ Math.imul(s.trickNo * 4 + s.trick.length + 1, 0x9e3779b1)) >>> 0);
  if (level === "rookie" && r() < 0.25) {
    return legal[Math.floor(r() * legal.length)];
  }

  const bid = s.bids[s.turn] ?? 1;
  const won = s.tricksWon[s.turn];
  const wantsTrick = bid > 0 && (won < bid || level !== "boss");

  // Leading a trick
  if (s.trick.length === 0) {
    if (!wantsTrick) {
      // Bid Nil or already made contract on Boss: lead lowest non-spade
      const sortedLow = [...legal].sort((a, b) => {
        const sa = spadesSuit(a) === SPADE_SUIT ? 1 : 0;
        const sb = spadesSuit(b) === SPADE_SUIT ? 1 : 0;
        if (sa !== sb) return sa - sb;
        return spadesRank(a) - spadesRank(b) || a - b;
      });
      return sortedLow[0];
    }
    // Cash side-suit Aces/Kings first, otherwise lead a low card
    const sideWinners = legal.filter((c) => spadesSuit(c) !== SPADE_SUIT && spadesRank(c) >= 11);
    if (sideWinners.length > 0) return sideWinners[sideWinners.length - 1];
    const sorted = [...legal].sort((a, b) => spadesRank(a) - spadesRank(b) || a - b);
    return sorted[0];
  }

  // Following in a trick
  const ledSuit = spadesSuit(s.trick[0].card);
  let bestPlay = s.trick[0];
  for (const p of s.trick) {
    if (beatsSpadesCard(p.card, bestPlay.card, ledSuit)) bestPlay = p;
  }

  const winningCards = legal.filter((c) => beatsSpadesCard(c, bestPlay.card, ledSuit));
  const losingCards = legal.filter((c) => !beatsSpadesCard(c, bestPlay.card, ledSuit));

  if (!wantsTrick) {
    if (losingCards.length > 0) {
      // Play highest losing card to shed middle/high cards safely
      return losingCards[losingCards.length - 1];
    }
    return legal[0];
  }

  if (winningCards.length > 0) {
    // If last to act (trick.length === 3), win as cheaply as possible!
    if (s.trick.length === 3) return winningCards[0];
    // Otherwise play a strong winner (or lowest trump if ruffing)
    const trumpWinners = winningCards.filter((c) => spadesSuit(c) === SPADE_SUIT && ledSuit !== SPADE_SUIT);
    if (trumpWinners.length > 0) return trumpWinners[0];
    return winningCards[winningCards.length - 1];
  }

  // Cannot win the trick: sluff lowest non-spade first, then lowest card
  const nonSpades = legal.filter((c) => spadesSuit(c) !== SPADE_SUIT);
  const pool = nonSpades.length > 0 ? nonSpades : legal;
  const sortedLow = [...pool].sort((a, b) => spadesRank(a) - spadesRank(b) || a - b);
  return sortedLow[0];
}

/** Suggests a bid or card play for seat 0. */
export function spadesHint(s: SpadesState): { bid?: number; card?: number; reason: string } | null {
  if (s.phase === "bid") {
    const bid = spadesBotBid(s.hands[0], "boss", s.seed, 0);
    return {
      bid,
      reason: bid === 0 ? "Your hand is light — consider a bold Nil (0) bid!" : `Your high cards and spades project ${bid} ${bid === 1 ? "trick" : "tricks"}.`,
    };
  }
  if (s.phase === "play" && s.turn === 0) {
    const card = spadesBotCard(s, "boss", s.seed);
    if (card < 0) return null;
    const bid = s.bids[0] ?? 1;
    const needed = Math.max(0, bid - s.tricksWon[0]);
    return {
      card,
      reason:
        bid === 0
          ? "Play low to duck under the trick and protect your Nil bid."
          : needed > 0
            ? `Need ${needed} more ${needed === 1 ? "trick" : "tricks"} to make your ${bid}-bid contract.`
            : "Contract made! Manage overtricks carefully.",
    };
  }
  return null;
}

// ---- replay, tally and XP -----------------------------------------------------------------------

function advanceBots(s: SpadesState): SpadesState {
  let cur = s;
  while (cur.phase === "play" && cur.turn !== 0) {
    const c = spadesBotCard(cur, cur.level, cur.seed);
    if (c < 0) break;
    cur = applySpadesCard(cur, c);
  }
  return cur;
}

/**
 * Replays a Spades game from seat 0's moves:
 * - First move is `[bid]` (`0..13`).
 * - Each subsequent move is `[cardId]` (the card seat 0 played on their turn).
 * Throws on any illegal move.
 */
export function replaySpades(seed: number, level: SpadesLevel, moves: readonly unknown[]): { state: SpadesState } {
  let s = newSpades(seed, level);
  for (const raw of moves) {
    if (s.phase === "done") break;
    if (!Array.isArray(raw) || raw.length !== 1 || typeof raw[0] !== "number") {
      throw new Error("Illegal spades move format");
    }
    const val = raw[0];
    if (s.phase === "bid") {
      if (!isValidSpadesBid(s, val)) throw new Error("Illegal spades bid");
      s = applySpadesBid(s, val);
      s = advanceBots(s);
    } else if (s.phase === "play") {
      const legal = spadesLegalPlays(s, 0);
      if (!legal.includes(val)) throw new Error("Illegal spades card play");
      s = applySpadesCard(s, val);
      s = advanceBots(s);
    }
  }
  return { state: s };
}

export interface SpadesTally {
  /** tricks won by seat 0 toward their contract */
  books: number;
  /** whether seat 0 met their contract at hand end */
  madeContract: boolean;
  /** whether seat 0 won the hand (made contract + highest score) */
  won: boolean;
  /** seat 0's final score (when phase === "done") */
  score?: number;
  level: SpadesLevel;
}

export const spadesTallyOf = (s: SpadesState, level: SpadesLevel = s.level): SpadesTally => {
  const bid = s.bids[0] ?? 1;
  const books = bid === 0 ? 0 : Math.min(bid, s.tricksWon[0]);
  return {
    books,
    madeContract: s.phase === "done" && s.madeContract,
    won: s.phase === "done" && s.winner === 0,
    score: s.phase === "done" ? s.scores[0] : undefined,
    level,
  };
};

export function tallySpades(seed: number, level: SpadesLevel, moves: readonly unknown[]): SpadesTally & { over: boolean } {
  const { state } = replaySpades(seed, level, moves);
  return { ...spadesTallyOf(state, level), over: state.phase === "done" };
}

export const SPADES_XP = {
  book: 3,
  contract: 20,
  win: { rookie: 15, pro: 60, boss: 120 } as Record<SpadesLevel, number>,
};
export const SPADES_DAY_XP = 500;
export const SPADES_IDLE_S = 30;

const levelOf = (t: { level?: unknown }): SpadesLevel => (isSpadesLevel(t.level) ? t.level : "rookie");

export function tallySpadesXp(t: SpadesTally): number {
  const lv = levelOf(t);
  return (
    t.books * SPADES_XP.book +
    (t.madeContract ? SPADES_XP.contract : 0) +
    (t.won ? SPADES_XP.win[lv] : 0)
  );
}

const NONE = (level: SpadesLevel): SpadesTally => ({ books: 0, madeContract: false, won: false, level });

export function spadesGain(paid: SpadesTally | undefined, t: SpadesTally) {
  const p = paid ?? NONE(t.level);
  const gained: SpadesTally = {
    books: Math.max(0, t.books - p.books),
    madeContract: t.madeContract && !p.madeContract,
    won: t.won && !p.won,
    score: t.score,
    level: t.level,
  };
  return {
    gained,
    paid: {
      books: Math.max(t.books, p.books),
      madeContract: t.madeContract || p.madeContract,
      won: t.won || p.won,
      score: t.score ?? p.score,
      level: t.level,
    },
    any: tallySpadesXp(gained) > 0,
  };
}

export function spadesPay(paid: SpadesTally | undefined, paidXp: number | undefined, t: SpadesTally, drain: number) {
  const g = spadesGain(paid, t);
  const before = paidXp ?? tallySpadesXp(paid ?? NONE(t.level));
  const pot = Math.max(0, tallySpadesXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
