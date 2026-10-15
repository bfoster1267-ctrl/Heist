import { describe, expect, it } from "vitest";
import {
  applyFc,
  autoMoveFc,
  dealFreeCell,
  fcHasMoves,
  fcWon,
  findFcHint,
  fitsFcColumn,
  fitsFcFoundation,
  isOrderedSequence,
  isSafeFoundationMove,
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

  it("strictly enforces supermove capacity limits during applyFc", () => {
    // 8 of Spades: card 7 (rank 8, black)
    // 7 of Diamonds: card 32 (rank 7, red)
    // 6 of Spades: card 5 (rank 6, black)
    // Ordered sequence on col 0: [7♦ (32), 6♠ (5)] -> fits on 8♠ (7) on col 1!
    expect(isOrderedSequence([32, 5])).toBe(true);

    const s: FreeCellState = {
      cells: [10, 11, 12, 13], // 0 free cells
      found: [[], [], [], []],
      cols: [
        [32, 5], // col 0 has 2 cards
        [7],     // col 1 has 8♠
        [20], [21], [22], [23], [24], [25], // other 6 columns occupied, 0 empty columns
      ],
    };

    // With 0 free cells and 0 empty columns:
    // maxSupermove(s, false) = (1 + 0) * 2^0 = 1
    expect(maxSupermove(s, false)).toBe(1);

    // Moving 2 cards exceeds capacity (2 > 1) -> must FAIL (returns null)
    expect(applyFc(s, "t0>t1:2")).toBeNull();

    // Free 1 cell:
    s.cells[0] = null;
    // With 1 free cell and 0 empty columns:
    // maxSupermove(s, false) = (1 + 1) * 2^0 = 2
    expect(maxSupermove(s, false)).toBe(2);

    // Moving 2 cards now fits within capacity (2 <= 2) -> SUCCEEDS
    const moved = applyFc(s, "t0>t1:2");
    expect(moved).not.toBeNull();
    expect(moved!.cols[1]).toEqual([7, 32, 5]);
    expect(moved!.cols[0].length).toBe(0);
  });

  it("evaluates safe foundation moves with the n-1 rule", () => {
    const s: FreeCellState = {
      cells: [null, null, null, null],
      cols: Array.from({ length: 8 }, () => []),
      found: [
        [0, 1], // Spades (suit 0): Ace (0), 2 (1) -> length 2
        [13],   // Hearts (suit 1): Ace (13) -> length 1
        [26],   // Diamonds (suit 2): Ace (26) -> length 1
        [39, 40], // Clubs (suit 3): Ace (39), 2 (40) -> length 2
      ],
    };

    // Card 2 is 3 of Spades (suit 0, black, rank 3).
    // Opposite color foundations are Hearts (1) and Diamonds (2).
    // Both are at length 1 (only Aces).
    // For 3 of Spades to be safe, both opposite foundations must reach rank - 1 = 2!
    // Since Hearts and Diamonds are only at 1, 3 of Spades is NOT safe!
    expect(fitsFcFoundation(s, 2)).toBe(true);
    expect(isSafeFoundationMove(s, 2)).toBe(false);

    // Now advance Hearts and Diamonds to 2 (Twos on foundation)
    s.found[1].push(14); // 2 of Hearts
    s.found[2].push(27); // 2 of Diamonds
    // Now both opposite foundations have length >= 2, so 3 of Spades IS safe!
    expect(isSafeFoundationMove(s, 2)).toBe(true);

    // Aces and Twos are always safe unconditionally
    const aceOfHearts = 13;
    const twoOfHearts = 14;
    const freshState: FreeCellState = {
      cells: [null, null, null, null],
      cols: Array.from({ length: 8 }, () => []),
      found: [[], [], [], []],
    };
    expect(isSafeFoundationMove(freshState, aceOfHearts)).toBe(true);
  });

  it("finds hints without crashing when a tableau top card fits foundation", () => {
    const s = dealFreeCell(1);
    s.found[0] = [0, 1]; // 2 cards in Spades
    s.found[1] = [];     // 0 cards in Hearts
    s.found[2] = [];     // 0 cards in Diamonds
    s.found[3] = [];     // 0 cards in Clubs
    s.cells = [null, null, null, null];
    // Fill all columns with Kings (rank 13)
    for (let i = 0; i < 8; i++) s.cols[i] = [12];
    // Place 3 of Spades (card 2) on col 0
    s.cols[0] = [2];

    // Card 2 (3 of Spades) fits foundation 0, but is NOT safe because red foundations are at 0.
    // findFcHint should cleanly suggest it as a foundation move without throwing a TypeError!
    expect(() => findFcHint(s)).not.toThrow();
    const hint = findFcHint(s);
    expect(hint).not.toBeNull();
    expect(hint!.pile).toBe("t0");
    expect(hint!.depth).toBe(1);
  });

  it("simulates full endgame auto-solve where sorted cascades clear into foundations", () => {
    // Construct an endgame state where all cards are arranged in descending order across columns
    const s: FreeCellState = {
      cells: [null, null, null, null],
      cols: [
        // Col 0: Spades K down to 3 (cards 12 down to 2)
        Array.from({ length: 11 }, (_, i) => 12 - i),
        // Col 1: Hearts K down to 3 (cards 25 down to 15)
        Array.from({ length: 11 }, (_, i) => 25 - i),
        // Col 2: Diamonds K down to 3 (cards 38 down to 28)
        Array.from({ length: 11 }, (_, i) => 38 - i),
        // Col 3: Clubs K down to 3 (cards 51 down to 41)
        Array.from({ length: 11 }, (_, i) => 51 - i),
        [], [], [], [],
      ],
      found: [
        [0, 1],     // Spades A, 2
        [13, 14],   // Hearts A, 2
        [26, 27],   // Diamonds A, 2
        [39, 40],   // Clubs A, 2
      ],
    };

    expect(fcWon(s)).toBe(false);

    // Auto-move should cascade all 44 remaining cards to foundations
    let cur = s;
    let autoMovesCount = 0;
    while (!fcWon(cur)) {
      const m = autoMoveFc(cur);
      expect(m).not.toBeNull();
      cur = applyFc(cur, m!)!;
      autoMovesCount++;
    }

    expect(fcWon(cur)).toBe(true);
    expect(autoMovesCount).toBe(44);
    expect(cur.found.every((f) => f.length === 13)).toBe(true);
  });

  it("supports multi-step move and undo simulation", () => {
    const s0 = dealFreeCell(99);
    const history: FreeCellState[] = [s0];
    const moves: FcMove[] = [];

    // Make 3 valid moves
    const m1 = "t0>c0";
    const s1 = applyFc(history[history.length - 1], m1)!;
    expect(s1).not.toBeNull();
    history.push(s1);
    moves.push(m1);

    const m2 = "t1>c1";
    const s2 = applyFc(history[history.length - 1], m2)!;
    expect(s2).not.toBeNull();
    history.push(s2);
    moves.push(m2);

    const m3 = "c0>c2";
    const s3 = applyFc(history[history.length - 1], m3)!;
    expect(s3).not.toBeNull();
    history.push(s3);
    moves.push(m3);

    expect(history.length).toBe(4);

    // Undo m3
    history.pop();
    moves.pop();
    expect(history[history.length - 1]).toEqual(s2);

    // Undo m2
    history.pop();
    moves.pop();
    expect(history[history.length - 1]).toEqual(s1);

    // Undo m1
    history.pop();
    moves.pop();
    expect(history[history.length - 1]).toEqual(s0);
  });
});

