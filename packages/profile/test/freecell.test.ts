import { describe, expect, it } from "vitest";
import {
  applyFc,
  autoMoveFc,
  dealFreeCell,
  fcHasMoves,
  fcWon,
  fitsFcColumn,
  fitsFcFoundation,
  isOrderedSequence,
  maxSupermove,
  replayFreeCell,
  tallyFreeCell,
  tallyFcXp,
  tapMoveFc,
  type FreeCellState,
  type FcMove,
} from "../src";

describe("freecell engine", () => {
  it("deals 52 cards across 8 columns with no duplicates", () => {
    const s = dealFreeCell(42);
    expect(s.cells).toEqual([null, null, null, null]);
    expect(s.found).toEqual([[], [], [], []]);
    expect(s.cols.length).toBe(8);

    // First 4 columns have 7 cards, last 4 have 6 cards
    expect(s.cols.slice(0, 4).map((c) => c.length)).toEqual([7, 7, 7, 7]);
    expect(s.cols.slice(4).map((c) => c.length)).toEqual([6, 6, 6, 6]);

    const allCards = s.cols.flat();
    expect(allCards.length).toBe(52);
    expect(new Set(allCards).size).toBe(52);

    // Deterministic shuffle by seed
    expect(dealFreeCell(42)).toEqual(s);
  });

  it("calculates supermove capacity correctly", () => {
    const s: FreeCellState = {
      cells: [null, null, null, null], // 4 free cells
      found: [[], [], [], []],
      cols: [[], [], [1], [2], [3], [4], [5], [6]], // 2 empty columns (0 and 1)
    };

    // Moving to non-empty column (e.g. col 2):
    // freeCells = 4, emptyCols = 2 -> (1 + 4) * 2^2 = 20
    expect(maxSupermove(s, false)).toBe(20);

    // Moving to empty column (e.g. col 0):
    // freeCells = 4, emptyCols = 1 -> (1 + 4) * 2^1 = 10
    expect(maxSupermove(s, true)).toBe(10);

    // Filling 2 free cells:
    s.cells[0] = 10;
    s.cells[1] = 20;
    // freeCells = 2, emptyCols = 2 -> (1 + 2) * 2^2 = 12
    expect(maxSupermove(s, false)).toBe(12);
  });

  it("validates ordered sequences in descending alternating colors", () => {
    // 15: 3 of Hearts (Red, rank 3)
    // 1: 2 of Spades (Black, rank 2)
    // 13: Ace of Hearts (Red, rank 1)
    // 14: 2 of Hearts (Red, rank 2)
    // Ordered: 3 of Hearts (15) -> 2 of Spades (1) -> Ace of Hearts (13)
    expect(isOrderedSequence([15, 1, 13])).toBe(true);
    // Invalid (same color: Red on Red)
    expect(isOrderedSequence([15, 14])).toBe(false);
    // Invalid (wrong rank: rank 3 to rank 1)
    expect(isOrderedSequence([15, 13])).toBe(false);
  });

  it("handles moves to/from free cells, cascades, and foundations", () => {
    const s = dealFreeCell(10);

    // Move top card of col 0 to cell 0
    const cardCol0 = s.cols[0][s.cols[0].length - 1];
    const s1 = applyFc(s, "t0>c0");
    expect(s1).not.toBeNull();
    expect(s1!.cells[0]).toBe(cardCol0);
    expect(s1!.cols[0].length).toBe(6);

    // Can't move into an already occupied cell
    expect(applyFc(s1!, "t1>c0")).toBeNull();

    // Move from cell 0 to cell 1
    const s2 = applyFc(s1!, "c0>c1");
    expect(s2).not.toBeNull();
    expect(s2!.cells[0]).toBeNull();
    expect(s2!.cells[1]).toBe(cardCol0);

    // Reject nonsense move
    expect(applyFc(s, "nonsense")).toBeNull();
  });

  it("detects win condition when all foundations have 13 cards", () => {
    const s: FreeCellState = {
      cells: [null, null, null, null],
      cols: Array.from({ length: 8 }, () => []),
      found: [
        Array.from({ length: 13 }, (_, i) => i),
        Array.from({ length: 13 }, (_, i) => i + 13),
        Array.from({ length: 13 }, (_, i) => i + 26),
        Array.from({ length: 13 }, (_, i) => i + 39),
      ],
    };
    expect(fcWon(s)).toBe(true);
  });

  it("replays moves from seed and tallies XP", () => {
    const s = dealFreeCell(5);
    const moves: FcMove[] = ["t0>c0", "t1>c1"];
    const replayed = replayFreeCell(5, moves);
    expect(replayed.cells[0]).not.toBeNull();
    expect(replayed.cells[1]).not.toBeNull();

    const tally = tallyFreeCell(5, moves);
    expect(tally.moves).toBe(2);
    expect(tallyFcXp(tally)).toBeGreaterThanOrEqual(2);
  });
});
