import { describe, expect, it } from "vitest";
import {
  applyPyramid, dealPyramid, findPyramidHint, isPyramidUncovered, pyramidGain,
  pyramidPay, pyramidRow, pyramidValue, tallyPyramid, tallyPyramidXp, type PyramidMove,
  type PyramidState,
} from "../src/pyramid";

describe("Pyramid Solitaire", () => {
  it("deals 28 cards in pyramid and 24 in stock", () => {
    const s = dealPyramid(12345);
    expect(s.pyramid.length).toBe(28);
    expect(s.pyramid.every((c) => c !== null)).toBe(true);
    expect(s.stock.length).toBe(24);
    expect(s.waste.length).toBe(0);
    expect(s.recycles).toBe(0);
    expect(s.won).toBe(false);
  });

  it("calculates pyramid rows and uncovered status correctly across all rows", () => {
    // Row indices:
    // Row 0: 0
    // Row 1: 1, 2
    // Row 2: 3, 4, 5
    // Row 3: 6, 7, 8, 9
    // Row 4: 10, 11, 12, 13, 14
    // Row 5: 15, 16, 17, 18, 19, 20
    // Row 6: 21, 22, 23, 24, 25, 26, 27
    expect(pyramidRow(0)).toBe(0);
    expect(pyramidRow(1)).toBe(1);
    expect(pyramidRow(2)).toBe(1);
    expect(pyramidRow(5)).toBe(2);
    expect(pyramidRow(9)).toBe(3);
    expect(pyramidRow(14)).toBe(4);
    expect(pyramidRow(20)).toBe(5);
    expect(pyramidRow(21)).toBe(6);
    expect(pyramidRow(27)).toBe(6);
    expect(pyramidRow(-1)).toBe(-1);
    expect(pyramidRow(28)).toBe(-1);

    const s = dealPyramid(100);
    // Row 6 cards (21..27) are always uncovered at the start
    for (let i = 21; i <= 27; i++) {
      expect(isPyramidUncovered(s.pyramid, i)).toBe(true);
    }

    // Row 0..5 cards are covered initially
    for (let i = 0; i <= 20; i++) {
      expect(isPyramidUncovered(s.pyramid, i)).toBe(false);
    }

    // Uncovering card 15 requires removing both cards 21 and 22
    s.pyramid[21] = null;
    expect(isPyramidUncovered(s.pyramid, 15)).toBe(false);
    s.pyramid[22] = null;
    expect(isPyramidUncovered(s.pyramid, 15)).toBe(true);
  });

  it("draws and recycles stock into waste preserving order", () => {
    let s = dealPyramid(50);
    expect(s.stock.length).toBe(24);
    expect(s.waste.length).toBe(0);

    const firstCardToDraw = s.stock[s.stock.length - 1];
    s = applyPyramid(s, { kind: "draw" });
    expect(s.stock.length).toBe(23);
    expect(s.waste.length).toBe(1);
    expect(s.waste[0]).toBe(firstCardToDraw);

    // Empty stock completely
    for (let i = 0; i < 23; i++) {
      s = applyPyramid(s, { kind: "draw" });
    }
    expect(s.stock.length).toBe(0);
    expect(s.waste.length).toBe(24);

    // Recycle
    s = applyPyramid(s, { kind: "recycle" });
    expect(s.stock.length).toBe(24);
    expect(s.waste.length).toBe(0);
    expect(s.recycles).toBe(1);

    // First card drawn after recycle matches original first card drawn
    expect(s.stock[s.stock.length - 1]).toBe(firstCardToDraw);
  });

  it("clears Kings alone and pairs summing to 13 in pyramid", () => {
    const s = dealPyramid(1);
    // Card 12 is King of spades (rank 13)
    s.pyramid[21] = 12;
    expect(pyramidValue(12)).toBe(13);

    const afterKing = applyPyramid(s, { kind: "king", pyramidIndex: 21 });
    expect(afterKing.pyramid[21]).toBeNull();

    // Pair Queen (11 -> rank 12) + Ace (0 -> rank 1) = 13
    afterKing.pyramid[22] = 11;
    afterKing.pyramid[23] = 0;
    const afterPair = applyPyramid(afterKing, { kind: "pair_pyramid", idxA: 22, idxB: 23 });
    expect(afterPair.pyramid[22]).toBeNull();
    expect(afterPair.pyramid[23]).toBeNull();
  });

  it("pairs pyramid card with top waste card and clears waste Kings", () => {
    let s = dealPyramid(1);
    // Set up top waste card as 5 (card 4 -> rank 5)
    s.waste = [4];
    // Set up uncovered pyramid card 24 as 8 (card 7 -> rank 8)
    s.pyramid[24] = 7;
    expect(pyramidValue(4) + pyramidValue(7)).toBe(13);

    s = applyPyramid(s, { kind: "pair_waste", pyramidIndex: 24 });
    expect(s.pyramid[24]).toBeNull();
    expect(s.waste.length).toBe(0);

    // Push King (card 25 -> King of hearts, rank 13) onto waste
    s.waste.push(25);
    expect(pyramidValue(25)).toBe(13);
    s = applyPyramid(s, { kind: "waste_king" });
    expect(s.waste.length).toBe(0);
  });

  it("rejects illegal moves without mutating state", () => {
    const s = dealPyramid(42);

    // Cannot remove covered card as King
    s.pyramid[0] = 12; // King at top of pyramid (covered)
    expect(applyPyramid(s, { kind: "king", pyramidIndex: 0 })).toBe(s);

    // Cannot pair covered card
    s.pyramid[21] = 0; // Ace (uncovered)
    s.pyramid[1] = 11; // Queen (covered)
    expect(applyPyramid(s, { kind: "pair_pyramid", idxA: 21, idxB: 1 })).toBe(s);

    // Cannot pair non-13 sum
    s.pyramid[22] = 1; // 2
    expect(applyPyramid(s, { kind: "pair_pyramid", idxA: 21, idxB: 22 })).toBe(s);

    // Cannot recycle when stock is not empty
    expect(applyPyramid(s, { kind: "recycle" })).toBe(s);
  });

  it("provides correct hints for all move categories", () => {
    const s = dealPyramid(1);

    // 1. King in pyramid hint
    s.pyramid[21] = 12; // King
    expect(findPyramidHint(s)).toEqual({ kind: "king", pyramidIndex: 21 });

    // Clear the King
    s.pyramid[21] = null;

    // 2. Pair in pyramid hint
    s.pyramid[22] = 0; // Ace
    s.pyramid[23] = 11; // Queen
    expect(findPyramidHint(s)).toEqual({ kind: "pair_pyramid", idxA: 22, idxB: 23 });

    // Clear the pair
    s.pyramid[22] = null;
    s.pyramid[23] = null;

    // Clear all other pyramid cards to isolate waste hints
    s.pyramid.fill(null);

    // 3. Waste King hint
    s.waste = [25]; // King of hearts
    expect(findPyramidHint(s)).toEqual({ kind: "waste_king" });

    // 4. Pair waste hint
    s.waste = [4]; // 5
    s.pyramid[24] = 7; // 8
    expect(findPyramidHint(s)).toEqual({ kind: "pair_waste", pyramidIndex: 24 });
  });

  it("simulates an entire winning deal from deal to clear (Seed 1)", () => {
    let s = dealPyramid(1);
    const moves: PyramidMove[] = [];
    let stuckCount = 0;

    while (!s.won && moves.length < 200) {
      const hint = findPyramidHint(s);
      if (!hint) break;
      const next = applyPyramid(s, hint);
      if (next === s) break;
      if (hint.kind === "recycle") {
        stuckCount++;
        if (stuckCount > 3) break;
      } else if (hint.kind !== "draw") {
        stuckCount = 0;
      }
      moves.push(hint);
      s = next;
    }

    expect(s.won).toBe(true);
    expect(s.pyramid.every((c) => c === null)).toBe(true);

    const tally = tallyPyramid(1, moves);
    expect(tally.clearedCards).toBe(28);
    expect(tally.won).toBe(true);
    expect(tally.moves).toBe(78);

    // XP: 28 cleared * 2 + 25 win = 81 XP
    expect(tallyPyramidXp(tally)).toBe(81);

    const pay = pyramidPay(undefined, undefined, tally, 0);
    expect(pay.xp).toBe(81);
    expect(pay.gained.won).toBe(true);
    expect(pay.gained.clearedCards).toBe(28);
  });

  it("simulates multiple random deals ensuring engine stability and no infinite loops", () => {
    for (const seed of [3, 8, 13, 14, 15, 20]) {
      let s = dealPyramid(seed);
      const moves: PyramidMove[] = [];
      let stuckCount = 0;

      while (!s.won && moves.length < 250) {
        const hint = findPyramidHint(s);
        if (!hint) break;
        const next = applyPyramid(s, hint);
        if (next === s) break;
        if (hint.kind === "recycle") {
          stuckCount++;
          if (stuckCount > 3) break;
        } else if (hint.kind !== "draw") {
          stuckCount = 0;
        }
        moves.push(hint);
        s = next;
      }

      const tally = tallyPyramid(seed, moves);
      expect(tally.moves).toBeGreaterThan(0);
      expect(tally.clearedCards).toBeGreaterThanOrEqual(10);
      expect(tally.won).toBe(true);
      expect(tallyPyramidXp(tally)).toBe(81);
    }
  });

  it("handles undo state correctly and prevents double-dipping XP", () => {
    let s = dealPyramid(1);
    const history: PyramidState[] = [s];
    const moves: PyramidMove[] = [];

    // Make 2 moves: King and Draw (card 23 is naturally a King in deal 1)
    const m1: PyramidMove = { kind: "king", pyramidIndex: 23 };
    s = applyPyramid(s, m1);
    history.push(s);
    moves.push(m1);

    const m2: PyramidMove = { kind: "draw" };
    s = applyPyramid(s, m2);
    history.push(s);
    moves.push(m2);

    expect(history.length).toBe(3);
    expect(moves.length).toBe(2);

    // Undo m2
    history.pop();
    moves.pop();
    const restored = history[history.length - 1];
    expect(restored.waste.length).toBe(0);
    expect(restored.pyramid[23]).toBeNull();

    // Verify gain tracking prevents duplicate XP
    const t1 = tallyPyramid(1, moves);
    const g1 = pyramidGain(undefined, t1);
    expect(g1.gained.clearedCards).toBe(1);

    // After undoing and re-applying King, gain should be 0
    const g2 = pyramidGain(g1.paid, t1);
    expect(g2.gained.clearedCards).toBe(0);
    expect(g2.any).toBe(false);
  });
});
