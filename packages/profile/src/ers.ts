// Egyptian Rat Screw (ERS / Ratslap)
// Fast-reaction card duel: turn-flipping, face card challenges (A=4, K=3, Q=2, J=1),
// and instant slaps on Doubles, Sandwiches, Marriages, Tens, and Top-Bottom.
// Pure rules for game logic, challenge progression, slap checking, and state replay.

import { cardRank, type PlayingCard } from "./solitaire";

export type { PlayingCard };

export type SlapReason = "double" | "sandwich" | "marriage" | "tens" | "topbottom" | null;

export interface ErsState {
  /** Player 0 (human) draw pile (face-down, top card is last element) */
  p0: PlayingCard[];
  /** Player 1 (bot) draw pile (face-down, top card is last element) */
  p1: PlayingCard[];
  /** Center pot pile (top card is last element) */
  pot: PlayingCard[];
  /** Whose turn it is to flip next (0 or 1) */
  turn: 0 | 1;
  /** Active challenge: who issued it, and how many chances opponent has left */
  challenge: { by: 0 | 1; chances: number } | null;
  /** Who won the game (0, 1, or null if ongoing) */
  winner: 0 | 1 | null;
  /** Last event description for HUD */
  lastEvent?: string;
}

export type ErsMove =
  | "play:0"
  | "play:1"
  | "slap:0"
  | "slap:1";

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

/** Deal standard 52-card ERS deck evenly between player 0 and player 1 */
export function dealErs(seed: number): ErsState {
  const r = rng(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return {
    p0: deck.slice(0, 26),
    p1: deck.slice(26),
    pot: [],
    turn: 0,
    challenge: null,
    winner: null,
  };
}

/** Face card challenge penalty chances: A=4, K=3, Q=2, J=1 (number cards = 0) */
export function faceChances(c: PlayingCard): number {
  const rank = cardRank(c);
  if (rank === 1) return 4;  // Ace
  if (rank === 13) return 3; // King
  if (rank === 12) return 2; // Queen
  if (rank === 11) return 1; // Jack
  return 0;
}

/**
 * Check if the current pot has a valid slap condition:
 * - Doubles: top 2 cards have identical rank
 * - Sandwich: top card and card 2 steps down have identical rank
 * - Marriage: top 2 cards are King and Queen (any order)
 * - Tens: top 2 cards sum to 10 (A=1, so 9+A, 8+2, 7+3, 6+4, 5+5)
 * - Top-Bottom: top card has same rank as the first card played in pot
 */
export function checkSlap(pot: PlayingCard[]): SlapReason {
  const len = pot.length;
  if (len < 2) return null;

  const top = pot[len - 1];
  const prev = pot[len - 2];
  const rTop = cardRank(top);
  const rPrev = cardRank(prev);

  // 1. Doubles
  if (rTop === rPrev) return "double";

  // 2. Sandwich
  if (len >= 3) {
    const prev2 = pot[len - 3];
    if (rTop === cardRank(prev2)) return "sandwich";
  }

  // 3. Marriage (K and Q)
  if ((rTop === 13 && rPrev === 12) || (rTop === 12 && rPrev === 13)) return "marriage";

  // 4. Tens (ranks sum to 10)
  if (rTop + rPrev === 10) return "tens";

  // 5. Top-Bottom
  if (len >= 3 && rTop === cardRank(pot[0])) return "topbottom";

  return null;
}

/** Apply an ERS move to the state */
export function applyErs(state: ErsState, move: ErsMove): ErsState {
  if (state.winner !== null) return state;

  const pot = [...state.pot];
  const p0 = [...state.p0];
  const p1 = [...state.p1];

  // Slap move: "slap:0" (human) or "slap:1" (bot)
  if (move === "slap:0" || move === "slap:1") {
    const who = move === "slap:0" ? 0 : 1;
    const reason = checkSlap(pot);

    if (reason !== null) {
      // Valid slap! Winner scoops the pot into the bottom of their draw pile
      const winnerPile = who === 0 ? p0 : p1;
      winnerPile.unshift(...pot);

      const winReason =
        reason === "double" ? "DOUBLES" :
        reason === "sandwich" ? "SANDWICH" :
        reason === "marriage" ? "MARRIAGE" :
        reason === "tens" ? "SUMS TO 10" : "TOP-BOTTOM";

      const nextTurn = who;
      const winner = p0.length === 52 ? 0 : p1.length === 52 ? 1 : null;

      return {
        p0,
        p1,
        pot: [],
        turn: nextTurn,
        challenge: null,
        winner,
        lastEvent: `${who === 0 ? "You" : "Bot"} slapped ${winReason}! (+${pot.length} cards)`,
      };
    } else {
      // False slap penalty: burn 1 card to the bottom of the pot
      const slapper = who === 0 ? p0 : p1;
      if (slapper.length > 0) {
        const burned = slapper.pop()!;
        pot.unshift(burned);
      }
      return {
        p0,
        p1,
        pot,
        turn: state.turn,
        challenge: state.challenge,
        winner: p0.length === 0 ? 1 : p1.length === 0 ? 0 : null,
        lastEvent: `${who === 0 ? "You" : "Bot"} false slapped! (-1 card)`,
      };
    }
  }

  // Play card move: "play:0" or "play:1"
  const who = move === "play:0" ? 0 : 1;
  const pile = who === 0 ? p0 : p1;
  if (pile.length === 0) return state;

  const card = pile.pop()!;
  pot.push(card);
  const chances = faceChances(card);

  // If a face card was played, it sets up a new challenge
  if (chances > 0) {
    const nextTurn = who === 0 ? 1 : 0;
    return {
      p0,
      p1,
      pot,
      turn: nextTurn,
      challenge: { by: who, chances },
      winner: null,
      lastEvent: `${who === 0 ? "You" : "Bot"} played a face card! (${chances} chances)`,
    };
  }

  // A number card was played during an active challenge
  if (state.challenge !== null) {
    const left = state.challenge.chances - 1;
    if (left > 0) {
      // Opponent still has remaining chances
      return {
        p0,
        p1,
        pot,
        turn: who, // Same player continues their challenge attempts
        challenge: { by: state.challenge.by, chances: left },
        winner: null,
        lastEvent: `${left} ${left === 1 ? "chance" : "chances"} left`,
      };
    } else {
      // Challenge failed! Challenger claims the pot
      const challenger = state.challenge.by;
      const claimerPile = challenger === 0 ? p0 : p1;
      claimerPile.unshift(...pot);

      const winner = p0.length === 52 ? 0 : p1.length === 52 ? 1 : null;
      return {
        p0,
        p1,
        pot: [],
        turn: challenger,
        challenge: null,
        winner,
        lastEvent: `${challenger === 0 ? "You" : "Bot"} won the challenge! (+${pot.length} cards)`,
      };
    }
  }

  // Normal turn-taking
  const nextTurn = who === 0 ? 1 : 0;
  return {
    p0,
    p1,
    pot,
    turn: nextTurn,
    challenge: null,
    winner: p0.length === 0 ? 1 : p1.length === 0 ? 0 : null,
  };
}

export interface ErsTally {
  cardsCaptured: number;
  slaps: number;
  faceChallengesWon: number;
  won: boolean;
}

export function tallyErs(seed: number, moves: readonly unknown[]): ErsTally {
  let s = dealErs(seed);
  let slaps = 0;
  let challenges = 0;

  for (const m of moves) {
    if (typeof m !== "string") continue;
    const prevLen = s.p0.length;
    s = applyErs(s, m as ErsMove);
    if (m === "slap:0" && s.p0.length > prevLen) slaps++;
    if (s.lastEvent?.includes("You won the challenge")) challenges++;
  }

  return {
    cardsCaptured: Math.max(0, s.p0.length - 26),
    slaps,
    faceChallengesWon: challenges,
    won: s.winner === 0,
  };
}

export const ERS_XP = { slap: 2, challenge: 3, win: 25 };

export function tallyErsXp(t: ErsTally): number {
  return t.slaps * ERS_XP.slap + t.faceChallengesWon * ERS_XP.challenge + (t.won ? ERS_XP.win : 0);
}

export function ersGain(paid: ErsTally | undefined, t: ErsTally) {
  const p = paid ?? { cardsCaptured: 0, slaps: 0, faceChallengesWon: 0, won: false };
  const gained = {
    cardsCaptured: Math.max(0, t.cardsCaptured - p.cardsCaptured),
    slaps: Math.max(0, t.slaps - p.slaps),
    faceChallengesWon: Math.max(0, t.faceChallengesWon - p.faceChallengesWon),
    won: t.won && !p.won,
  };
  return {
    gained,
    paid: {
      cardsCaptured: Math.max(t.cardsCaptured, p.cardsCaptured),
      slaps: Math.max(t.slaps, p.slaps),
      faceChallengesWon: Math.max(t.faceChallengesWon, p.faceChallengesWon),
      won: t.won || p.won,
    },
    any: tallyErsXp(gained) > 0,
  };
}

export function ersPay(
  paid: ErsTally | undefined,
  paidXp: number | undefined,
  t: ErsTally,
  drain: number
) {
  const g = ersGain(paid, t);
  const before = paidXp ?? tallyErsXp(paid ?? { cardsCaptured: 0, slaps: 0, faceChallengesWon: 0, won: false });
  const pot = Math.max(0, tallyErsXp(g.paid) - Math.max(0, drain));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
