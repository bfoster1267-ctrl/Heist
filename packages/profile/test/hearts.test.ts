import { describe, expect, it } from "vitest";
import {
  advanceHearts, applyHearts, dealHearts, heartsBotStep, heartsGain, heartsLegal, heartsPay, heartsPickCard, heartsPickPass, heartsPoints,
  heartsTallyOf, replayHearts, tallyHearts, tallyHeartsXp, HEARTS_TARGET, HEARTS_XP, type HeartsState,
} from "../src/hearts";
import { HEARTS, QUEEN_OF_SPADES, TWO_OF_CLUBS, cardSuit, dealHands } from "../src/tricks";

/** Play a whole game with the player taking the hint every time; returns the end state and the moves. */
function playOut(seed: number, pick: (s: HeartsState) => unknown = (s) => (s.phase === "pass" ? heartsPickPass(s.t.hands[0]) : heartsPickCard(s))) {
  let s = advanceHearts(dealHearts(seed));
  const moves: unknown[] = [];
  while (s.phase !== "over") {
    const m = pick(s);
    const n = applyHearts(s, m);
    if (!n) throw new Error(`illegal move ${JSON.stringify(m)}`);
    moves.push(m);
    s = advanceHearts(n);
  }
  return { s, moves };
}

describe("Hearts", () => {
  it("deals 13 cards to each of four seats from the seed, every card once", () => {
    const hands = dealHands(42, 0);
    expect(hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(new Set(hands.flat()).size).toBe(52);
    expect(dealHands(42, 0)).toEqual(hands);
    expect(dealHands(42, 1)).not.toEqual(hands);
  });

  it("passes left, right, across, then holds", () => {
    expect([0, 1, 2, 3, 4].map((h) => dealHearts(7, h).pass)).toEqual(["left", "right", "across", "hold", "left"]);
    expect(dealHearts(7, 3).phase).toBe("play");
    expect(dealHearts(7, 0).phase).toBe("pass");
  });

  it("swaps three cards each way on a pass, and you receive from your right on a left pass", () => {
    const s = dealHearts(99);
    const mine = s.t.hands[0].slice(0, 3);
    const n = applyHearts(s, mine)!;
    expect(n).not.toBeNull();
    expect(n.t.hands.every((h) => h.length === 13)).toBe(true);
    expect(mine.some((c) => n.t.hands[0].includes(c))).toBe(false);
    expect(mine.every((c) => n.t.hands[1].includes(c))).toBe(true);
    expect(n.received.every((c) => s.t.hands[3].includes(c))).toBe(true);
  });

  it("rejects a bad pass: wrong count, duplicates, or cards you don't hold", () => {
    const s = dealHearts(5);
    const h = s.t.hands[0];
    expect(applyHearts(s, h.slice(0, 2))).toBeNull();
    expect(applyHearts(s, [h[0], h[0], h[1]])).toBeNull();
    expect(applyHearts(s, [s.t.hands[1][0], h[0], h[1]])).toBeNull();
    expect(applyHearts(s, h[0])).toBeNull();
  });

  it("the 2 of clubs opens, and points can't go on the first trick", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let x = dealHearts(seed, 3); // a hold hand: straight to play
      expect(x.t.hands[x.t.leader].includes(TWO_OF_CLUBS)).toBe(true);
      expect(heartsLegal(x)).toEqual([TWO_OF_CLUBS]);
      while (x.t.count === 0) {
        const hand = x.t.hands[x.t.turn];
        if (x.t.trick.length && !hand.some((c) => cardSuit(c) === 3) && hand.some((c) => heartsPoints(c) === 0)) {
          expect(heartsLegal(x).every((c) => heartsPoints(c) === 0)).toBe(true);
        }
        x = x.t.turn === 0 ? applyHearts(x, heartsPickCard(x))! : heartsBotStep(x);
      }
    }
  });

  it("hearts can't be led until broken", () => {
    for (let seed = 1; seed < 40; seed++) {
      let s = advanceHearts(dealHearts(seed, 3));
      while (s.phase === "play" && s.hand === 3) {
        if (!s.broken && s.t.trick.length === 0 && s.t.count > 0) {
          const hand = s.t.hands[s.t.turn];
          if (hand.some((c) => cardSuit(c) !== HEARTS)) expect(heartsLegal(s).some((c) => cardSuit(c) === HEARTS)).toBe(false);
        }
        s = advanceHearts(applyHearts(s, heartsPickCard(s))!);
      }
    }
  });

  it("scores 26 points a hand (or a moon) and ends when someone reaches 100, lowest winning", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { s } = playOut(seed * 31);
      for (const r of s.results) {
        const sum = r.points.reduce((a, b) => a + b, 0);
        if (r.moon === null) expect(sum).toBe(26);
        else {
          expect(sum).toBe(78);
          expect(r.points[r.moon]).toBe(0);
        }
      }
      expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(HEARTS_TARGET);
      expect(s.scores[s.winner!]).toBe(Math.min(...s.scores));
    }
  });

  it("the Q♠ is worth 13", () => {
    expect(heartsPoints(QUEEN_OF_SPADES)).toBe(13);
    expect(heartsPoints(13)).toBe(1); // A♥
    expect(heartsPoints(0)).toBe(0); // A♠
  });

  it("bots dump the Q♠ on a trick they can't follow, and duck under a winning spade", () => {
    const s = dealHearts(3, 3);
    // a crafted spot: bot (seat 1) void in clubs, holding the queen, a club trick on the table
    const hands = [[1, 2, 3], [QUEEN_OF_SPADES, 14, 15], [27, 28, 29], [30, 31, 32]];
    const spot: HeartsState = {
      ...s, broken: true,
      t: { ...s.t, hands, trick: [{ seat: 0, card: 45 }], turn: 1, count: 5, voids: [0, 1, 2, 3].map(() => [false, false, false, false]) },
    };
    expect(heartsPickCard(spot)).toBe(QUEEN_OF_SPADES);
    const spot2: HeartsState = { ...spot, t: { ...spot.t, hands: [[1], [QUEEN_OF_SPADES, 3, 14], [27], [30]], trick: [{ seat: 0, card: 12 }] } };
    expect(heartsPickCard(spot2)).toBe(QUEEN_OF_SPADES); // K♠ led: the queen goes under it
  });

  it("replays the same game exactly from the seed and the player's moves", () => {
    const { s, moves } = playOut(2024);
    expect(heartsTallyOf(replayHearts(2024, moves))).toEqual(heartsTallyOf(s));
    expect(tallyHearts(2024, moves).over).toBe(true);
  });

  it("stops replaying at the first move that doesn't fit, so made-up moves earn nothing extra", () => {
    const { moves } = playOut(77);
    const forged = [...moves.slice(0, 5), 999, ...moves.slice(5)];
    const t = tallyHearts(77, forged);
    expect(t.over).toBe(false);
    expect(t.hands).toBeLessThanOrEqual(1);
    expect(tallyHearts(77, ["junk", { a: 1 }]).hands).toBe(0);
  });

  it("random legal play always reaches the end", () => {
    let r = 1;
    const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let seed = 1; seed <= 20; seed++) {
      const { s } = playOut(seed, (x) => {
        if (x.phase === "pass") return x.t.hands[0].slice(-3);
        const l = heartsLegal(x);
        return l[Math.floor(rand() * l.length)];
      });
      expect(s.phase).toBe("over");
    }
  });

  it("pays points dodged, moons and the win, once", () => {
    const t = { hands: 5, avoided: 100, moons: 1, won: true, over: true };
    expect(tallyHeartsXp(t)).toBe(100 * HEARTS_XP.avoided + HEARTS_XP.moon + HEARTS_XP.win);
    const first = heartsPay(undefined, undefined, t, 0);
    expect(first.xp).toBe(tallyHeartsXp(t));
    const again = heartsPay(first.paid, first.paidXp, t, 0);
    expect(again.xp).toBe(0);
    expect(heartsGain(first.paid, t).any).toBe(false);
    expect(heartsPay(undefined, undefined, t, 40).xp).toBe(tallyHeartsXp(t) - 40);
  });
});
