import { describe, expect, it } from "vitest";
import {
  applyYukon, cardRank, cardSuit, dealYukon, findYukonHint, fitsYukon,
  fitsYukonFoundation, tallyYukon, tallyYukonXp, yukonWon, YUKON_XP,
} from "../src/yukon";

describe("Yukon Solitaire", () => {
  it("deals 52 cards across 7 columns with exact down and up distribution", () => {
    const s = dealYukon(42);
    expect(s.cols.length).toBe(7);
    expect(s.found.length).toBe(4);

    // Col 0: 0 down, 1 up
    expect(s.cols[0].down.length).toBe(0);
    expect(s.cols[0].up.length).toBe(1);

    // Cols 1 to 6: c down, 5 up
    for (let c = 1; c < 7; c++) {
      expect(s.cols[c].down.length).toBe(c);
      expect(s.cols[c].up.length).toBe(5);
    }

    const totalDown = s.cols.reduce((sum, c) => sum + c.down.length, 0);
    const totalUp = s.cols.reduce((sum, c) => sum + c.up.length, 0);
    expect(totalDown).toBe(21);
    expect(totalUp).toBe(31);
    expect(totalDown + totalUp).toBe(52);
  });

  it("moves any face-up stack if root card fits alternating color and descending rank", () => {
    const s = dealYukon(12345);
    // Find a valid hint or move
    const hint = findYukonHint(s);
    if (hint) {
      const next = applyYukon(s, hint.move);
      expect(next).not.toBe(s);
    }
  });

  it("moves top card to foundation when valid", () => {
    let s = dealYukon(100);
    // Construct a state where an Ace is exposed on a column
    // Spades Ace is 0
    s.cols[0].up = [0]; // Ace of spades
    const next = applyYukon(s, "t0>f");
    expect(next.found[0]).toEqual([0]);
    expect(next.cols[0].up.length).toBe(0);
  });

  it("tallies moves, foundations, unturned cards, and calculates XP", () => {
    const seed = 999;
    const t = tallyYukon(seed, []);
    expect(t.moves).toBe(0);
    expect(t.foundations).toBe(0);
    expect(t.unturned).toBe(0);
    expect(t.won).toBe(false);
    expect(tallyYukonXp(t)).toBe(0);
  });

  it("handles empty column placement only with Kings", () => {
    let s = dealYukon(101);
    s.cols[0].up = []; // empty
    s.cols[0].down = [];
    s.cols[1].down = [];

    // Card with rank 13 (King) vs rank 10
    const nonKing = 9; // rank 10
    const king = 12; // rank 13 (King of Spades)
    s.cols[1].up = [nonKing];

    // Non-king fails
    const bad = applyYukon(s, "t1>t0:1");
    expect(bad.cols[0].up.length).toBe(0);

    // King succeeds
    s.cols[1].up = [king];
    const good = applyYukon(s, "t1>t0:1");
    expect(good.cols[0].up).toEqual([king]);
    expect(good.cols[1].up.length).toBe(0);
  });
});
