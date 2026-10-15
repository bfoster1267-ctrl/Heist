import { describe, expect, it } from "vitest";
import {
  applyTp, dealTriPeaks, fitsTp, isTpUncovered, replayTriPeaks, tallyTriPeaks, tallyTpXp, tpWon,
} from "../src/tripeaks";

describe("TriPeaks engine", () => {
  it("deals exactly 28 tableau cards, 1 waste, 23 stock cards", () => {
    const s = dealTriPeaks(42);
    expect(s.tableau.length).toBe(28);
    expect(s.stock.length).toBe(23);
    expect(s.waste.length).toBe(1);
    expect(s.tableau.every((c) => c !== null)).toBe(true);

    // Row 3 (18..27) is face-up, rows 0..2 are face-down
    for (let i = 0; i < 28; i++) {
      expect(s.up[i]).toBe(i >= 18);
      expect(isTpUncovered(s.tableau, i)).toBe(i >= 18);
    }
  });

  it("fits adjacent ranks with King <-> Ace wrap", () => {
    // Suit 0 rank 1 (Ace) vs rank 13 (King)
    expect(fitsTp(0, 12)).toBe(true); // Ace (0) fits King (12)
    expect(fitsTp(12, 0)).toBe(true); // King fits Ace
    expect(fitsTp(5, 6)).toBe(true);  // 6 fits 7
    expect(fitsTp(5, 4)).toBe(true);  // 6 fits 5
    expect(fitsTp(5, 7)).toBe(false); // 6 does not fit 8
  });

  it("drawing from stock moves card to waste and resets streak", () => {
    const s = dealTriPeaks(100);
    const initialWaste = s.waste.length;
    const initialStock = s.stock.length;

    const s2 = applyTp(s, "d");
    expect(s2).not.toBeNull();
    expect(s2!.waste.length).toBe(initialWaste + 1);
    expect(s2!.stock.length).toBe(initialStock - 1);
    expect(s2!.streak).toBe(0);
  });

  it("uncovers cards when both covering cards are cleared", () => {
    const s = dealTriPeaks(999);
    // Card 9 is covered by 18 and 19
    expect(isTpUncovered(s.tableau, 9)).toBe(false);

    // Artificially clear 18
    s.tableau[18] = null;
    expect(isTpUncovered(s.tableau, 9)).toBe(false);

    // Clear 19
    s.tableau[19] = null;
    expect(isTpUncovered(s.tableau, 9)).toBe(true);
  });

  it("replays and tallies moves accurately", () => {
    const s = dealTriPeaks(12345);
    const moves = ["d", "d"];
    const rep = replayTriPeaks(12345, moves);
    expect(rep.waste.length).toBe(3);

    const tally = tallyTriPeaks(12345, moves);
    expect(tally.cleared).toBe(0);
    expect(tally.won).toBe(false);
  });
});
