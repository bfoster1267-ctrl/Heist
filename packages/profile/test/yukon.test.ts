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

  it("moves multi-card stacks regardless of internal card order", () => {
    let s = dealYukon(200);
    // 9 of Spades is card 8 (suit 0, rank 9, black)
    // 8 of Hearts is card 20 (suit 1, rank 8, red)
    // 3 of Spades is card 2 (suit 0, rank 3, black)
    // 10 of Diamonds is card 35 (suit 2, rank 10, red)
    const nineOfSpades = 8;
    const eightOfHearts = 20;
    const threeOfSpades = 2;
    const tenOfDiamonds = 35;

    s.cols[0].down = [];
    s.cols[0].up = [nineOfSpades];

    // Col 1 has a stack starting with 8 of Hearts, followed by cards out of order!
    s.cols[1].down = [0]; // 1 down card
    s.cols[1].up = [eightOfHearts, threeOfSpades, tenOfDiamonds];

    // Moving all 3 cards from col 1 onto col 0:
    // Root is 8 of Hearts, destination top is 9 of Spades (opposite color, rank 8 on rank 9).
    // The internal order [3 of Spades, 10 of Diamonds] does NOT fit descending alternating,
    // but Yukon allows ANY face-up stack to move if its root fits!
    const next = applyYukon(s, "t1>t0:3");
    expect(next).not.toBe(s);
    expect(next.cols[0].up).toEqual([nineOfSpades, eightOfHearts, threeOfSpades, tenOfDiamonds]);
    // Since col 1's up cards were all moved, its down card [0] is automatically turned face-up!
    expect(next.cols[1].down.length).toBe(0);
    expect(next.cols[1].up).toEqual([0]);
  });

  it("supports move syntax with or without :count suffix", () => {
    let s = dealYukon(300);
    const kingOfHearts = 25; // rank 13
    s.cols[0].down = [];
    s.cols[0].up = [];
    s.cols[1].down = [];
    s.cols[1].up = [kingOfHearts];

    // Moving single card without :count suffix defaults to 1
    const next = applyYukon(s, "t1>t0");
    expect(next.cols[0].up).toEqual([kingOfHearts]);
    expect(next.cols[1].up.length).toBe(0);
  });

  it("plays through full game simulations, verifying multi-card stacks, Kings, foundations, and win", () => {
    // DFS solver for testing complete game play-throughs
    function solveYukon(seed: number, maxSteps = 8000): { won: boolean; moves: string[] } {
      let s = dealYukon(seed);
      const queue: { state: typeof s; moves: string[] }[] = [{ state: s, moves: [] }];
      const seen = new Set<string>();
      const key = (st: typeof s) =>
        st.cols.map((c) => c.down.length + ":" + c.up.join(",")).join("|") +
        "#" +
        st.found.map((f) => f.length).join(",");

      let steps = 0;
      while (queue.length > 0 && steps++ < maxSteps) {
        const cur = queue.pop()!;
        if (yukonWon(cur.state)) {
          return { won: true, moves: cur.moves };
        }
        const k = key(cur.state);
        if (seen.has(k)) continue;
        seen.add(k);

        // 1. Prioritize foundation moves
        let foundMove = false;
        for (let c = 0; c < 7; c++) {
          const col = cur.state.cols[c];
          if (col.up.length > 0) {
            const topCard = col.up[col.up.length - 1];
            if (fitsYukonFoundation(topCard, cur.state.found[cardSuit(topCard)])) {
              const m = `t${c}>f`;
              const next = applyYukon(cur.state, m);
              if (next !== cur.state) {
                queue.push({ state: next, moves: [...cur.moves, m] });
                foundMove = true;
              }
            }
          }
        }
        if (foundMove) continue;

        // 2. Tableau moves (single cards and multi-card stacks)
        for (let from = 0; from < 7; from++) {
          const colFrom = cur.state.cols[from];
          for (let i = 0; i < colFrom.up.length; i++) {
            const count = colFrom.up.length - i;
            const root = colFrom.up[i];
            for (let to = 0; to < 7; to++) {
              if (from === to) continue;
              const colTo = cur.state.cols[to];
              if (colTo.up.length === 0) {
                if (cardRank(root) === 13 && (i > 0 || colFrom.down.length > 0)) {
                  const m = `t${from}>t${to}:${count}`;
                  const next = applyYukon(cur.state, m);
                  if (next !== cur.state && !seen.has(key(next))) {
                    queue.push({ state: next, moves: [...cur.moves, m] });
                  }
                }
              } else {
                const destTop = colTo.up[colTo.up.length - 1];
                if (fitsYukon(root, destTop)) {
                  const m = `t${from}>t${to}:${count}`;
                  const next = applyYukon(cur.state, m);
                  if (next !== cur.state && !seen.has(key(next))) {
                    queue.push({ state: next, moves: [...cur.moves, m] });
                  }
                }
              }
            }
          }
        }
      }
      return { won: false, moves: [] };
    }

    // Run simulation on Seed 1
    const { won, moves } = solveYukon(1);
    expect(won).toBe(true);
    expect(moves.length).toBeGreaterThan(50);

    // Verify multi-card stack moves occurred in simulation
    const multiCardMoves = moves.filter((m) => {
      const match = /:(\d+)$/.exec(m);
      return match && Number(match[1]) > 1;
    });
    expect(multiCardMoves.length).toBeGreaterThan(20);

    // Step-by-step replay to verify moves, King placement, and auto-turning
    let state = dealYukon(1);
    let kingMovesCount = 0;
    let stackMovesCount = 0;

    for (const m of moves) {
      const tabMatch = /^t(\d)>t(\d)(?::(\d+))?$/.exec(m);
      if (tabMatch) {
        const from = Number(tabMatch[1]);
        const to = Number(tabMatch[2]);
        const count = tabMatch[3] ? Number(tabMatch[3]) : 1;
        if (count > 1) stackMovesCount++;
        if (state.cols[to].up.length === 0 && state.cols[to].down.length === 0) {
          kingMovesCount++;
          const root = state.cols[from].up[state.cols[from].up.length - count];
          expect(cardRank(root)).toBe(13); // must be King
        }
      }

      const next = applyYukon(state, m);
      expect(next).not.toBe(state);
      state = next;
    }

    expect(kingMovesCount).toBeGreaterThan(0);
    expect(stackMovesCount).toBeGreaterThan(0);
    expect(yukonWon(state)).toBe(true);
    expect(state.found.every((f) => f.length === 13)).toBe(true);

    // Tally verification
    const tally = tallyYukon(1, moves);
    expect(tally.won).toBe(true);
    expect(tally.foundations).toBe(52);
    expect(tally.unturned).toBe(21);
    expect(tally.moves).toBe(moves.length);
    expect(tallyYukonXp(tally)).toBe(
      21 * YUKON_XP.turn + 52 * YUKON_XP.foundation + YUKON_XP.win
    );
  });
});
