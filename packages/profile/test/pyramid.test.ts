import { describe, expect, it } from "vitest";
import {
  applyPyramid, dealPyramid, isPyramidUncovered, pyramidRow,
  pyramidValue, tallyPyramid, tallyPyramidXp,
} from "../src/pyramid";

describe("Pyramid Solitaire", () => {
  it("deals 28 cards in pyramid and 24 in stock", () => {
    const s = dealPyramid(12345);
    expect(s.pyramid.length).toBe(28);
    expect(s.pyramid.every((c) => c !== null)).toBe(true);
    expect(s.stock.length).toBe(24);
    expect(s.waste.length).toBe(0);
    expect(s.won).toBe(false);
  });

  it("calculates pyramid rows and uncovered status correctly", () => {
    expect(pyramidRow(0)).toBe(0);
    expect(pyramidRow(1)).toBe(1);
    expect(pyramidRow(2)).toBe(1);
    expect(pyramidRow(21)).toBe(6);
    expect(pyramidRow(27)).toBe(6);

    const s = dealPyramid(100);
    // Row 6 cards (21..27) are always uncovered at the start
    expect(isPyramidUncovered(s.pyramid, 21)).toBe(true);
    expect(isPyramidUncovered(s.pyramid, 27)).toBe(true);

    // Row 0..5 cards are covered initially
    expect(isPyramidUncovered(s.pyramid, 0)).toBe(false);
    expect(isPyramidUncovered(s.pyramid, 15)).toBe(false);
  });

  it("draws and recycles stock into waste", () => {
    let s = dealPyramid(50);
    expect(s.stock.length).toBe(24);
    expect(s.waste.length).toBe(0);

    s = applyPyramid(s, { kind: "draw" });
    expect(s.stock.length).toBe(23);
    expect(s.waste.length).toBe(1);

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
  });

  it("clears Kings alone and pairs summing to 13", () => {
    const s = dealPyramid(1);
    // Force card at index 21 to be King (rank 13 -> e.g. card 12 = King of spades)
    s.pyramid[21] = 12;
    expect(pyramidValue(12)).toBe(13);

    const afterKing = applyPyramid(s, { kind: "king", pyramidIndex: 21 });
    expect(afterKing.pyramid[21]).toBeNull();

    // Pair Queen (12) + Ace (1) = 13
    afterKing.pyramid[22] = 11; // Queen of spades (rank 12)
    afterKing.pyramid[23] = 0;  // Ace of spades (rank 1)
    const afterPair = applyPyramid(afterKing, { kind: "pair_pyramid", idxA: 22, idxB: 23 });
    expect(afterPair.pyramid[22]).toBeNull();
    expect(afterPair.pyramid[23]).toBeNull();
  });

  it("tallies moves and calculates XP properly", () => {
    const moves = [{ kind: "draw" as const }];
    const t = tallyPyramid(12345, moves);
    expect(t.moves).toBe(1);
    expect(t.clearedCards).toBe(0);
    expect(tallyPyramidXp(t)).toBe(0);
  });
});
