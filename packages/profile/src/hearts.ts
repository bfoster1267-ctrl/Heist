// Hearts vs bots (4-player trick-taking card game).
// Avoid taking Hearts (1 pt each) and the Queen of Spades (13 pts) — or take all 26 penalty points to Shoot the Moon!
// Deterministic seeded deal and bot AI so the server can replay and verify every game from the player's moves alone.

export type HeartsLevel = "rookie" | "pro" | "boss";
export const HEARTS_LEVELS: readonly HeartsLevel[] = ["rookie", "pro", "boss"];
export const isHeartsLevel = (x: unknown): x is HeartsLevel => x === "rookie" || x === "pro" || x === "boss";

export type HeartsSeat = 0 | 1 | 2 | 3;
export type HeartsPassDir = "left" | "right" | "across";

/**
 * Cards are numbered 0..51:
 * suit = Math.floor(card / 13): 0 = Clubs (♣), 1 = Diamonds (♦), 2 = Spades (♠), 3 = Hearts (♥)
 * rank = card % 13: 0 = 2, 1 = 3, ..., 8 = 10, 9 = J, 10 = Q, 11 = K, 12 = A
 */
export const TWO_OF_CLUBS = 0;
export const QUEEN_OF_SPADES = 2 * 13 + 10; // 36

export const heartsSuit = (card: number) => Math.floor(card / 13);
export const heartsRank = (card: number) => card % 13;

export const heartsPenalty = (card: number): number => {
  if (card === QUEEN_OF_SPADES) return 13;
  if (heartsSuit(card) === 3) return 1;
  return 0;
};

export interface HeartsTrickPlay {
  seat: HeartsSeat;
  card: number;
}

export interface HeartsCompletedTrick {
  cards: HeartsTrickPlay[];
  winner: HeartsSeat;
  points: number;
}

export interface HeartsState {
  seed: number;
  level: HeartsLevel;
  phase: "pass" | "play" | "done";
  passDir: HeartsPassDir;
  /** 4 hands of card IDs (0..51), sorted by suit then rank */
  hands: [number[], number[], number[], number[]];
  /** cards passed to you (seat 0) after the pass exchange */
  receivedPass: number[];
  /** whose action is next */
  turn: HeartsSeat;
  /** who led the current trick */
  leader: HeartsSeat;
  /** cards on the felt in the current trick (0..3 while in progress) */
  trick: HeartsTrickPlay[];
  /** the most recently completed 4-card trick */
  lastTrick: HeartsCompletedTrick | null;
  /** completed tricks count (0..13) */
  trickNo: number;
  /** whether hearts have been broken this hand */
  heartsBroken: boolean;
  /** raw penalty points taken by each seat */
  rawPoints: [number, number, number, number];
  /** final penalty points (adjusted if a player Shot the Moon) */
  points: [number, number, number, number];
  /** tricks won by each seat */
  tricksWon: [number, number, number, number];
  /** tricks won by seat 0 with 0 penalty points */
  cleanTricks: number;
  /** seat that took all 26 penalty points, if any */
  shotMoon: HeartsSeat | null;
  /** winning seat (lowest score at the end of 13 tricks; 0 if you win or tie for lowest) */
  winner: HeartsSeat | null;
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

export function newHearts(seed = 1, level: HeartsLevel = "pro"): HeartsState {
  const r = rng(seed ^ 0x48454152);
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
  const dirs: readonly HeartsPassDir[] = ["left", "right", "across"];
  const passDir = dirs[(seed >>> 0) % 3];
  return {
    seed,
    level,
    phase: "pass",
    passDir,
    hands,
    receivedPass: [],
    turn: 0,
    leader: 0,
    trick: [],
    lastTrick: null,
    trickNo: 0,
    heartsBroken: false,
    rawPoints: [0, 0, 0, 0],
    points: [0, 0, 0, 0],
    tricksWon: [0, 0, 0, 0],
    cleanTricks: 0,
    shotMoon: null,
    winner: null,
  };
}

/** Picks 3 cards for a bot (or hint) to pass. */
export function heartsBotPass(hand: readonly number[], level: HeartsLevel, seed: number, seat: number): [number, number, number] {
  const r = rng((seed ^ Math.imul(seat + 1, 0x9e3779b1)) >>> 0);
  const scored = hand.map((c) => {
    const suit = heartsSuit(c);
    const rank = heartsRank(c);
    let danger = rank;
    // Queen, King, Ace of Spades are dangerous unless holding enough spades to protect them
    if (c === QUEEN_OF_SPADES) danger += 30;
    else if (suit === 2 && rank > 10) danger += 24;
    else if (suit === 3 && rank >= 8) danger += 16 + rank;
    else if (suit !== 2 && rank >= 9) danger += 10 + rank;
    if (level === "rookie") danger += Math.floor(r() * 14) - 7;
    else if (level === "pro") danger += Math.floor(r() * 4) - 2;
    return { c, danger };
  });
  scored.sort((a, b) => b.danger - a.danger || b.c - a.c);
  return [scored[0].c, scored[1].c, scored[2].c];
}

const passTarget = (from: HeartsSeat, dir: HeartsPassDir): HeartsSeat => {
  if (dir === "left") return ((from + 1) % 4) as HeartsSeat;
  if (dir === "right") return ((from + 3) % 4) as HeartsSeat;
  return ((from + 2) % 4) as HeartsSeat;
};

export function isValidHeartsPass(s: HeartsState, cards: unknown): cards is [number, number, number] {
  if (s.phase !== "pass" || !Array.isArray(cards) || cards.length !== 3) return false;
  const [a, b, c] = cards;
  if (typeof a !== "number" || typeof b !== "number" || typeof c !== "number") return false;
  if (a === b || a === c || b === c) return false;
  const h = s.hands[0];
  return h.includes(a) && h.includes(b) && h.includes(c);
}

/** Applies seat 0's 3-card pass along with the 3 bots' passes, then transitions to play phase. */
export function applyHeartsPass(s: HeartsState, passCards: readonly number[]): HeartsState {
  if (!isValidHeartsPass(s, passCards)) return s;
  const passes: [number[], number[], number[], number[]] = [
    [...passCards],
    heartsBotPass(s.hands[1], s.level, s.seed, 1),
    heartsBotPass(s.hands[2], s.level, s.seed, 2),
    heartsBotPass(s.hands[3], s.level, s.seed, 3),
  ];
  const nextHands: [number[], number[], number[], number[]] = [
    s.hands[0].filter((c) => !passes[0].includes(c)),
    s.hands[1].filter((c) => !passes[1].includes(c)),
    s.hands[2].filter((c) => !passes[2].includes(c)),
    s.hands[3].filter((c) => !passes[3].includes(c)),
  ];
  let receivedPass: number[] = [];
  for (let seat = 0 as HeartsSeat; seat < 4; seat = ((seat + 1) as HeartsSeat)) {
    const dest = passTarget(seat, s.passDir);
    nextHands[dest].push(...passes[seat]);
    if (dest === 0) receivedPass = [...passes[seat]];
  }
  for (let i = 0; i < 4; i++) nextHands[i] = sortHand(nextHands[i]);

  let starter: HeartsSeat = 0;
  for (let i = 0 as HeartsSeat; i < 4; i = ((i + 1) as HeartsSeat)) {
    if (nextHands[i].includes(TWO_OF_CLUBS)) {
      starter = i;
      break;
    }
  }
  return {
    ...s,
    phase: "play",
    hands: nextHands,
    receivedPass: sortHand(receivedPass),
    turn: starter,
    leader: starter,
    trick: [],
  };
}

/** Legal cards for `seat` to play right now. */
export function heartsLegalPlays(s: HeartsState, seat: HeartsSeat = s.turn): number[] {
  if (s.phase !== "play" || s.turn !== seat) return [];
  const hand = s.hands[seat];
  if (!hand.length) return [];

  // Leading a trick
  if (s.trick.length === 0) {
    if (s.trickNo === 0 && hand.includes(TWO_OF_CLUBS)) {
      return [TWO_OF_CLUBS];
    }
    if (!s.heartsBroken) {
      const nonHearts = hand.filter((c) => heartsSuit(c) !== 3);
      if (nonHearts.length > 0) return nonHearts;
    }
    return [...hand];
  }

  // Following suit
  const ledSuit = heartsSuit(s.trick[0].card);
  const inSuit = hand.filter((c) => heartsSuit(c) === ledSuit);
  if (inSuit.length > 0) return inSuit;

  // Void in led suit: on first trick, cannot dump penalty cards unless holding only penalty cards
  if (s.trickNo === 0) {
    const nonPenalty = hand.filter((c) => heartsPenalty(c) === 0);
    if (nonPenalty.length > 0) return nonPenalty;
  }
  return [...hand];
}

/** Applies a single card play by `s.turn`. */
export function applyHeartsCard(s: HeartsState, card: number): HeartsState {
  if (s.phase !== "play") return s;
  const legal = heartsLegalPlays(s, s.turn);
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
  const heartsBroken = s.heartsBroken || heartsSuit(card) === 3;

  if (trick.length < 4) {
    return {
      ...s,
      hands,
      trick,
      heartsBroken,
      turn: ((seat + 1) % 4) as HeartsSeat,
    };
  }

  // Resolve 4-card trick
  const ledSuit = heartsSuit(trick[0].card);
  let winningPlay = trick[0];
  let pts = 0;
  for (const p of trick) {
    pts += heartsPenalty(p.card);
    if (heartsSuit(p.card) === ledSuit && heartsRank(p.card) > heartsRank(winningPlay.card)) {
      winningPlay = p;
    }
  }
  const winner = winningPlay.seat;
  const rawPoints: [number, number, number, number] = [...s.rawPoints];
  rawPoints[winner] += pts;
  const tricksWon: [number, number, number, number] = [...s.tricksWon];
  tricksWon[winner] += 1;
  const cleanTricks = s.cleanTricks + (winner === 0 && pts === 0 ? 1 : 0);
  const trickNo = s.trickNo + 1;
  const lastTrick: HeartsCompletedTrick = { cards: trick, winner, points: pts };

  if (trickNo < 13) {
    return {
      ...s,
      hands,
      trick: [],
      lastTrick,
      trickNo,
      heartsBroken,
      rawPoints,
      points: [...rawPoints] as [number, number, number, number],
      tricksWon,
      cleanTricks,
      leader: winner,
      turn: winner,
    };
  }

  // Hand complete (13 tricks played): check Shoot the Moon
  const moonIdx = rawPoints.findIndex((p) => p === 26);
  let shotMoon: HeartsSeat | null = null;
  let points: [number, number, number, number] = [...rawPoints];
  if (moonIdx !== -1) {
    shotMoon = moonIdx as HeartsSeat;
    points = [26, 26, 26, 26];
    points[shotMoon] = 0;
  }

  const minScore = Math.min(...points);
  // If seat 0 has or ties for the lowest score, seat 0 wins
  const gameWinner: HeartsSeat =
    points[0] === minScore ? 0 : (points.findIndex((p) => p === minScore) as HeartsSeat);

  return {
    ...s,
    phase: "done",
    hands,
    trick: [],
    lastTrick,
    trickNo,
    heartsBroken,
    rawPoints,
    points,
    tricksWon,
    cleanTricks,
    shotMoon,
    winner: gameWinner,
    leader: winner,
    turn: winner,
  };
}

/** Deterministic bot card selection for `s.turn`. */
export function heartsBotCard(s: HeartsState, level: HeartsLevel = s.level, seed: number = s.seed): number {
  const legal = heartsLegalPlays(s, s.turn);
  if (legal.length <= 1) return legal[0] ?? -1;

  const r = rng((seed ^ Math.imul(s.trickNo * 4 + s.trick.length + 1, 0x85ebca6b)) >>> 0);
  if (level === "rookie" && r() < 0.28) {
    return legal[Math.floor(r() * legal.length)];
  }

  // Leading a trick
  if (s.trick.length === 0) {
    // Boss/Pro: if Queen of Spades has not been played and we don't hold Q♠, lead a low spade (< Q) to flush it out
    if (level !== "rookie" && !s.hands[s.turn].includes(QUEEN_OF_SPADES)) {
      const lowSpades = legal.filter((c) => heartsSuit(c) === 2 && heartsRank(c) < 10);
      if (lowSpades.length > 0 && (level === "boss" || r() < 0.65)) {
        return lowSpades[lowSpades.length - 1];
      }
    }
    // Otherwise lead lowest rank card (preferring non-hearts)
    const sorted = [...legal].sort((a, b) => {
      const ha = heartsSuit(a) === 3 ? 1 : 0;
      const hb = heartsSuit(b) === 3 ? 1 : 0;
      if (ha !== hb) return ha - hb;
      return heartsRank(a) - heartsRank(b) || a - b;
    });
    return sorted[0];
  }

  const ledSuit = heartsSuit(s.trick[0].card);
  const followingSuit = heartsSuit(legal[0]) === ledSuit;

  if (followingSuit) {
    let highestRank = -1;
    let trickPts = 0;
    for (const p of s.trick) {
      trickPts += heartsPenalty(p.card);
      if (heartsSuit(p.card) === ledSuit && heartsRank(p.card) > highestRank) {
        highestRank = heartsRank(p.card);
      }
    }
    const under = legal.filter((c) => heartsRank(c) < highestRank);
    // Avoid Queen of Spades whenever possible
    const safeOver = legal.filter((c) => c !== QUEEN_OF_SPADES);

    if (under.length > 0) {
      // Play the highest card that still ducks under the current winning card
      return under[under.length - 1];
    }
    // Must go over: if last to play (trick.length === 3) and no points in trick, shed highest safe card!
    if (s.trick.length === 3 && trickPts === 0 && safeOver.length > 0) {
      return safeOver[safeOver.length - 1];
    }
    // Otherwise play lowest safe card over
    if (safeOver.length > 0) return safeOver[0];
    return legal[0];
  }

  // Void in led suit: dump Queen of Spades first, then highest Heart, then highest side card!
  if (legal.includes(QUEEN_OF_SPADES)) return QUEEN_OF_SPADES;
  const hearts = legal.filter((c) => heartsSuit(c) === 3);
  if (hearts.length > 0) return hearts[hearts.length - 1];
  const sortedHigh = [...legal].sort((a, b) => heartsRank(b) - heartsRank(a) || b - a);
  return sortedHigh[0];
}

/** Suggests a move for seat 0 (either 3 cards to pass, or 1 card to play). */
export function heartsHint(s: HeartsState): { cards: number[]; reason: string } | null {
  if (s.phase === "pass") {
    const pass = heartsBotPass(s.hands[0], "boss", s.seed, 0);
    return { cards: pass, reason: "Pass high penalty threats before the first lead." };
  }
  if (s.phase === "play" && s.turn === 0) {
    const card = heartsBotCard(s, "boss", s.seed);
    if (card < 0) return null;
    if (s.trick.length === 0 && card === TWO_OF_CLUBS) {
      return { cards: [card], reason: "The 2♣ always leads the opening trick." };
    }
    if (s.trick.length > 0 && heartsSuit(card) !== heartsSuit(s.trick[0].card)) {
      if (card === QUEEN_OF_SPADES) return { cards: [card], reason: "Dump the Queen of Spades while void in the led suit!" };
      if (heartsSuit(card) === 3) return { cards: [card], reason: "Shed a high Heart while void in the led suit." };
    }
    return { cards: [card], reason: s.trick.length === 0 ? "Lead low to keep control." : "Best tactical play for this trick." };
  }
  return null;
}

// ---- replay, tally and XP -----------------------------------------------------------------------

function advanceBots(s: HeartsState): HeartsState {
  let cur = s;
  while (cur.phase === "play" && cur.turn !== 0) {
    const c = heartsBotCard(cur, cur.level, cur.seed);
    if (c < 0) break;
    cur = applyHeartsCard(cur, c);
  }
  return cur;
}

/**
 * Replays a Hearts game from seat 0's moves:
 * - First move is `[c1, c2, c3]` (the 3 passed cards).
 * - Each subsequent move is `[cardId]` (the card seat 0 played on their turn).
 * Throws on any illegal move.
 */
export function replayHearts(seed: number, level: HeartsLevel, moves: readonly unknown[]): { state: HeartsState } {
  let s = newHearts(seed, level);
  for (const raw of moves) {
    if (s.phase === "done") break;
    if (s.phase === "pass") {
      if (!isValidHeartsPass(s, raw)) throw new Error("Illegal hearts pass");
      s = applyHeartsPass(s, raw);
      s = advanceBots(s);
    } else if (s.phase === "play") {
      if (!Array.isArray(raw) || raw.length !== 1 || typeof raw[0] !== "number") {
        throw new Error("Illegal hearts move format");
      }
      const card = raw[0];
      const legal = heartsLegalPlays(s, 0);
      if (!legal.includes(card)) throw new Error("Illegal hearts card play");
      s = applyHeartsCard(s, card);
      s = advanceBots(s);
    }
  }
  return { state: s };
}

export interface HeartsTally {
  /** tricks won by seat 0 with 0 penalty points */
  cleanTricks: number;
  /** whether seat 0 Shot the Moon */
  shotMoon: boolean;
  /** whether seat 0 won the hand (lowest score) */
  won: boolean;
  /** seat 0's final penalty score (when phase === "done") */
  score?: number;
  level: HeartsLevel;
}

export const heartsTallyOf = (s: HeartsState, level: HeartsLevel = s.level): HeartsTally => ({
  cleanTricks: s.cleanTricks,
  shotMoon: s.phase === "done" && s.shotMoon === 0,
  won: s.phase === "done" && s.winner === 0,
  score: s.phase === "done" ? s.points[0] : undefined,
  level,
});

export function tallyHearts(seed: number, level: HeartsLevel, moves: readonly unknown[]): HeartsTally & { over: boolean } {
  const { state } = replayHearts(seed, level, moves);
  return { ...heartsTallyOf(state, level), over: state.phase === "done" };
}

export const HEARTS_XP = {
  cleanTrick: 3,
  moon: 50,
  win: { rookie: 15, pro: 60, boss: 120 } as Record<HeartsLevel, number>,
};
export const HEARTS_DAY_XP = 500;
export const HEARTS_IDLE_S = 30;

const levelOf = (t: { level?: unknown }): HeartsLevel => (isHeartsLevel(t.level) ? t.level : "rookie");

export function tallyHeartsXp(t: HeartsTally): number {
  const lv = levelOf(t);
  return (
    t.cleanTricks * HEARTS_XP.cleanTrick +
    (t.shotMoon ? HEARTS_XP.moon : 0) +
    (t.won ? HEARTS_XP.win[lv] : 0)
  );
}

const NONE = (level: HeartsLevel): HeartsTally => ({ cleanTricks: 0, shotMoon: false, won: false, level });

export function heartsGain(paid: HeartsTally | undefined, t: HeartsTally) {
  const p = paid ?? NONE(t.level);
  const gained: HeartsTally = {
    cleanTricks: Math.max(0, t.cleanTricks - p.cleanTricks),
    shotMoon: t.shotMoon && !p.shotMoon,
    won: t.won && !p.won,
    score: t.score,
    level: t.level,
  };
  return {
    gained,
    paid: {
      cleanTricks: Math.max(t.cleanTricks, p.cleanTricks),
      shotMoon: t.shotMoon || p.shotMoon,
      won: t.won || p.won,
      score: t.score ?? p.score,
      level: t.level,
    },
    any: tallyHeartsXp(gained) > 0,
  };
}

export function heartsPay(paid: HeartsTally | undefined, paidXp: number | undefined, t: HeartsTally, drain: number) {
  const g = heartsGain(paid, t);
  const before = paidXp ?? tallyHeartsXp(paid ?? NONE(t.level));
  const pot = Math.max(0, tallyHeartsXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
