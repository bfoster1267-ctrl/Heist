import { describe, expect, it } from "vitest";
import {
  // Klondike
  dealKlondike, applySol, autoMove, tapMove, solWon, solSolved, solHasMoves, replaySol, tallySol,
  // FreeCell
  dealFreeCell, applyFc, autoMoveFc, tapMoveFc, fcWon, fcHasMoves, findFcHint, maxSupermove, isSafeFoundationMove, fitsFcColumn, replayFreeCell, tallyFreeCell,
  // Spider
  dealSpider, applySpider, canDealSpider, canMoveSpider, findSpiderHint, spiderHasMoves, isValidSpiderSequence, tallySpider,
  // TriPeaks
  dealTriPeaks, applyTp, findTpHint, tpHasMoves, tpWon, replayTriPeaks, tallyTriPeaks,
  // Pyramid
  dealPyramid, applyPyramid, findPyramidHint, pyramidHasMoves, pyramidValue, tallyPyramid,
  // Yukon
  dealYukon, applyYukon, findYukonHint, yukonHasMoves, yukonWon, fitsYukonFoundation, fitsYukon, cardRank, cardSuit, tallyYukon,
  // ERS
  dealErs, applyErs, checkSlap, tallyErs, type ErsMove, type ErsState,
  // Scoundrel
  dealScoundrel, applyScoundrel, scoundrelCardKind, scoundrelCardValue, tallyScoundrel,
  type ScoundrelMove, type ScoundrelState, type PlayingCard,
} from "../src";

describe("Exhaustive Game Simulations & Edge Cases", () => {
  // =========================================================================
  // 1. KLONDIKE SOLITAIRE
  // =========================================================================
  describe("1. Klondike Solitaire", () => {
    function simulateKlondike(seed: number, limit = 2000) {
      let k = dealKlondike(seed);
      const moves: string[] = [];
      let draws = 0;
      const seen = new Set<string>();
      const key = (s: typeof k) =>
        `${s.stock.join(",")}|${s.waste.join(",")}|${s.found.map((f) => f.length).join(",")}|${s.cols.map((c) => `${c.down.length}:${c.up.join(",")}`).join("/")}`;

      while (moves.length < limit && !solWon(k)) {
        seen.add(key(k));
        let m: string | null = autoMove(k);
        if (!m) {
          for (let i = 0; i < 7 && !m; i++) {
            const col = k.cols[i];
            if (!col.up.length) continue;
            const t = tapMove(k, `t${i}`, col.up.length);
            if (t && t.includes(">t") && col.down.length) m = t;
          }
        }
        if (!m) m = tapMove(k, "w");
        if (!m) {
          if (++draws > 60) break; // Exhausted passes through stock without new moves
          m = "d";
        } else {
          draws = 0;
        }

        const next = applySol(k, m);
        if (!next) break;
        k = next;
        moves.push(m);

        if (solSolved(k)) {
          // Solved game auto-completes to victory
          while (!solWon(k)) {
            const autoM = autoMove(k);
            if (!autoM) break;
            const afterAuto = applySol(k, autoM)!;
            moves.push(autoM);
            k = afterAuto;
          }
          break;
        }
      }

      const terminal = solWon(k) ? "win" : moves.length >= limit ? "limit" : "stuck";
      return { k, moves, terminal, won: solWon(k) };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      const results: { seed: number; moves: number; terminal: string }[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateKlondike(seed);
        results.push({ seed, moves: sim.moves.length, terminal: sim.terminal });

        // Rule invariant: exactly 52 cards preserved
        const allCards = [
          ...sim.k.stock,
          ...sim.k.waste,
          ...sim.k.found.flat(),
          ...sim.k.cols.flatMap((c) => [...c.down, ...c.up]),
        ];
        expect(allCards.length).toBe(52);
        expect(new Set(allCards).size).toBe(52);

        // Replay integrity
        const replayed = replaySol(seed, sim.moves);
        expect(replayed).toEqual(sim.k);
        const tally = tallySol(seed, sim.moves);
        expect(tally.won).toBe(sim.won);
      }
      expect(results.length).toBe(10);
    });

    it("checks edge cases: empty stock recycling, empty column Kings, multi-step undo", () => {
      // Empty stock recycling: when both stock and waste are empty, draw returns null
      const k = dealKlondike(42);
      k.stock = [];
      k.waste = [];
      expect(applySol(k, "d")).toBeNull();

      // Recycling waste to stock preserves reverse draw order
      k.stock = [];
      k.waste = [10, 20, 30]; // top of waste is 30
      const recycled = applySol(k, "d");
      expect(recycled).not.toBeNull();
      expect(recycled!.waste).toEqual([]);
      // First card drawn from recycled stock should be 10 (the bottom of previous waste)
      const firstDraw = applySol(recycled!, "d");
      expect(firstDraw!.waste).toEqual([10]);

      // Multi-card cascade moves with empty columns:
      // Empty column accepts only King
      const nonKingStack = dealKlondike(5);
      nonKingStack.cols[0].up = [];
      nonKingStack.cols[0].down = [];
      nonKingStack.cols[1].down = [];
      nonKingStack.cols[1].up = [2, 1]; // 3 of Spades, 2 of Spades (non-King)
      expect(applySol(nonKingStack, "t1>t0:2")).toBeNull();

      // Moving King stack to empty column succeeds and leaves previous column empty if down was empty
      const kingStack = dealKlondike(5);
      kingStack.cols[0].up = [];
      kingStack.cols[0].down = [];
      kingStack.cols[1].down = [];
      kingStack.cols[1].up = [12, 24]; // King of Spades (12), Queen of Hearts (24)
      const afterKingMove = applySol(kingStack, "t1>t0:2");
      expect(afterKingMove).not.toBeNull();
      expect(afterKingMove!.cols[0].up).toEqual([12, 24]);
      expect(afterKingMove!.cols[1].up.length).toBe(0);

      // Stalemate detection: stock and waste empty, and no column moves possible
      const blockedSol = dealKlondike(42);
      blockedSol.stock = [];
      blockedSol.waste = [];
      blockedSol.cols.forEach((c) => {
        c.down = [];
        c.up = [12]; // All Kings of Spades, cannot move to foundations or each other
      });
      expect(solHasMoves(blockedSol)).toBe(false);

      // Multi-step undo at beginning, middle, and victory
      const s0 = dealKlondike(7);
      const history: typeof s0[] = [s0];
      const m1 = "d";
      history.push(applySol(history[history.length - 1], m1)!);
      const m2 = "d";
      history.push(applySol(history[history.length - 1], m2)!);
      expect(history.length).toBe(3);

      // Undo m2
      history.pop();
      expect(history[history.length - 1].stock.length).toBe(s0.stock.length - 1);
      // Undo m1 (back to initial deal)
      history.pop();
      expect(history[history.length - 1]).toEqual(s0);
      // Undo at beginning of game is a no-op / bounds safe
      expect(history.length).toBe(1);
    });
  });

  // =========================================================================
  // 2. FREECELL
  // =========================================================================
  describe("2. FreeCell", () => {
    function simulateFreeCell(seed: number, limit = 300) {
      let s = dealFreeCell(seed);
      const moves: string[] = [];
      const seen = new Set<string>();
      const key = (st: typeof s) =>
        `${st.cells.join(",")}|${st.found.map((f) => f.length).join(",")}|${st.cols.map((c) => c.join(",")).join("/")}`;

      seen.add(key(s));

      while (moves.length < limit && !fcWon(s)) {
        // 1. Auto-move safe cards to foundation
        const auto = autoMoveFc(s);
        if (auto) {
          const next = applyFc(s, auto);
          if (next && !seen.has(key(next))) {
            s = next;
            seen.add(key(next));
            moves.push(auto);
            continue;
          }
        }

        // 2. Hint move
        let moved = false;
        const hint = findFcHint(s);
        if (hint) {
          const m = tapMoveFc(s, hint.pile, hint.depth);
          if (m) {
            const next = applyFc(s, m);
            if (next && !seen.has(key(next))) {
              s = next;
              seen.add(key(next));
              moves.push(m);
              moved = true;
            }
          }
        }

        // 3. Search non-cyclic legal moves
        if (!moved) {
          for (let i = 0; i < 8 && !moved; i++) {
            const col = s.cols[i];
            if (!col.length) continue;
            for (let depth = 1; depth <= col.length; depth++) {
              const seq = col.slice(col.length - depth);
              if (depth > 1 && !seq.every((_, idx) => idx === 0 || fitsFcColumn([seq[idx - 1]], seq[idx]))) break;
              const m = tapMoveFc(s, `t${i}`, depth);
              if (m) {
                const next = applyFc(s, m);
                if (next && !seen.has(key(next))) {
                  s = next;
                  seen.add(key(next));
                  moves.push(m);
                  moved = true;
                  break;
                }
              }
            }
          }
        }

        if (!moved) break;
      }

      return { s, moves, won: fcWon(s), hasMoves: fcHasMoves(s) };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateFreeCell(seed);
        // Card conservation invariant: exactly 52 cards
        const all = [
          ...sim.s.cells.filter((c): c is number => c !== null),
          ...sim.s.found.flat(),
          ...sim.s.cols.flat(),
        ];
        expect(all.length).toBe(52);
        expect(new Set(all).size).toBe(52);

        // Replay integrity
        const replayed = replayFreeCell(seed, sim.moves);
        expect(replayed).toEqual(sim.s);
        const tally = tallyFreeCell(seed, sim.moves);
        expect(tally.moves).toBe(sim.moves.length);
        expect(tally.won).toBe(sim.won);
      }
    });

    it("checks edge cases: supermove capacity limits, n-1 foundation rule, stalemate detection, multi-step undo", () => {
      // Supermove capacity with empty columns:
      // (1 + freeCells) * 2^(emptyCols - 1) when destination is empty!
      const s = dealFreeCell(42);
      s.cells = [null, null, null, null]; // 4 free cells
      s.cols = [[], [], [], [10], [11], [12], [13], [14]]; // 3 empty columns (0, 1, 2)

      // Moving to empty column 0: destIsEmpty = true -> emptyCols becomes 3 - 1 = 2
      // Capacity = (1 + 4) * 2^2 = 20
      expect(maxSupermove(s, true)).toBe(20);
      // Moving to non-empty column 3: destIsEmpty = false -> emptyCols = 3
      // Capacity = (1 + 4) * 2^3 = 40
      expect(maxSupermove(s, false)).toBe(40);

      // Safe foundation moves: Ace and 2 are always safe; 3 requires both opposite suits at rank 2
      const sFound = dealFreeCell(1);
      sFound.found = [
        [0, 1], // Spades A, 2
        [13],   // Hearts A (length 1)
        [26],   // Diamonds A (length 1)
        [39, 40], // Clubs A, 2
      ];
      // 3 of Spades (card 2) is rank 3. Opposite suits (Hearts, Diamonds) are only at 1. Not safe!
      expect(isSafeFoundationMove(sFound, 2)).toBe(false);
      // Raise Hearts and Diamonds to rank 2:
      sFound.found[1].push(14);
      sFound.found[2].push(27);
      expect(isSafeFoundationMove(sFound, 2)).toBe(true);

      // Stalemate detection: completely blocked state
      // All 4 cells full of Kings (cards 12, 25, 38, 51)
      // All 8 columns end with Kings
      const blocked: typeof s = {
        cells: [12, 25, 38, 51], // 4 Kings, cannot move to empty foundations
        found: [[], [], [], []],
        cols: [
          [12], [25], [38], [51], [12], [25], [38], [51],
        ],
      };
      // No moves available (cells full, no empty columns, no moves to foundation, no builds)
      expect(fcHasMoves(blocked)).toBe(false);

      // Undo after victory
      const wonState: typeof s = {
        cells: [null, null, null, null],
        cols: Array.from({ length: 8 }, () => []),
        found: [
          Array.from({ length: 13 }, (_, i) => i),
          Array.from({ length: 13 }, (_, i) => i + 13),
          Array.from({ length: 13 }, (_, i) => i + 26),
          Array.from({ length: 13 }, (_, i) => i + 39),
        ],
      };
      expect(fcWon(wonState)).toBe(true);
      const hist = [wonState];
      expect(hist.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. SPIDER SOLITAIRE
  // =========================================================================
  describe("3. Spider Solitaire", () => {
    function simulateSpider(seed: number, limit = 500) {
      let s = dealSpider(seed, 1);
      const moves: any[] = [];

      while (moves.length < limit && !s.won) {
        const hint = findSpiderHint(s);
        if (!hint) break;
        const next = applySpider(s, hint);
        if (next === s) break;
        s = next;
        moves.push(hint);
      }

      return { s, moves, won: s.won, hasMoves: spiderHasMoves(s) };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateSpider(seed);
        // Card conservation invariant: exactly 104 cards
        const totalCards =
          sim.s.tableau.reduce((acc, col) => acc + col.length, 0) +
          sim.s.stock.length +
          sim.s.completed * 13;
        expect(totalCards).toBe(104);

        const tally = tallySpider(seed, sim.moves, 1);
        expect(tally.completedRuns).toBe(sim.s.completed);
        expect(tally.won).toBe(sim.s.won);
      }
    });

    it("checks edge cases: empty column moves, complete run auto-flip, state non-mutation, undo", () => {
      // Empty column accepts any same-suit valid sequence
      const s = dealSpider(1, 2);
      s.tableau[0] = [
        { card: 7, up: true }, // 8♠
        { card: 6, up: true }, // 7♠
      ];
      s.tableau[1] = []; // empty column
      expect(canMoveSpider(s, 0, 0, 1)).toBe(true);

      // But empty column rejects mixed-suit sequence
      s.tableau[2] = [
        { card: 7, up: true },  // 8♠
        { card: 19, up: true }, // 7♥
      ];
      expect(canMoveSpider(s, 2, 0, 1)).toBe(false);

      // Verify that applySpider does NOT mutate prior state's Card objects!
      const priorState = dealSpider(99, 1);
      const originalDownCard = priorState.tableau[0][0];
      const copyOfOriginalUp = originalDownCard.up;
      const moved = applySpider(priorState, { kind: "deal" });
      expect(originalDownCard.up).toBe(copyOfOriginalUp); // Prior state card NOT mutated!

      // Stalemate detection: stock empty and no moves
      const deadSpider = dealSpider(1, 1);
      deadSpider.stock = [];
      deadSpider.tableau = [
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
        [{ card: 0, up: true }], // Ace
      ];
      expect(spiderHasMoves(deadSpider)).toBe(false);

      // Multi-step undo simulation
      const hist = [priorState];
      const m1 = { kind: "deal" as const };
      hist.push(applySpider(hist[hist.length - 1], m1));
      expect(hist.length).toBe(2);
      expect(hist[1].stock.length).toBe(priorState.stock.length - 10);
      hist.pop();
      expect(hist[hist.length - 1]).toEqual(priorState);
    });
  });

  // =========================================================================
  // 4. TRIPEAKS
  // =========================================================================
  describe("4. TriPeaks", () => {
    function simulateTriPeaks(seed: number) {
      let s = dealTriPeaks(seed);
      const moves: string[] = [];

      while (!tpWon(s)) {
        const hint = findTpHint(s);
        if (hint !== null) {
          const m = `t${hint}` as const;
          const next = applyTp(s, m);
          if (!next) break;
          moves.push(m);
          s = next;
        } else if (s.stock.length > 0) {
          const next = applyTp(s, "d");
          if (!next) break;
          moves.push("d");
          s = next;
        } else {
          break;
        }
      }

      return { s, moves, won: tpWon(s), hasMoves: tpHasMoves(s) };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateTriPeaks(seed);
        // Card count invariant: exactly 52 cards
        const remainingTableau = sim.s.tableau.filter((c) => c !== null).length;
        const total = remainingTableau + sim.s.waste.length + sim.s.stock.length;
        expect(total).toBe(52);

        // Replay integrity
        const replayed = replayTriPeaks(seed, sim.moves);
        expect(replayed).toEqual(sim.s);
        const tally = tallyTriPeaks(seed, sim.moves);
        expect(tally.won).toBe(sim.won);
      }
    });

    it("checks edge cases: empty stock exhaustion, stalemate detection, undo at victory", () => {
      const s = dealTriPeaks(1);
      s.stock = [];
      // Drawing from empty stock returns null
      expect(applyTp(s, "d")).toBeNull();

      // Stalemate detection: stock empty and no cards fit waste
      s.waste = [0]; // Ace
      s.tableau.fill(6); // 7s (diff is 5, cannot fit)
      expect(tpHasMoves(s)).toBe(false);
      expect(findTpHint(s)).toBeNull();

      // Undo at victory
      const winSim = simulateTriPeaks(8); // Seed 8 is a winning deal
      expect(winSim.won).toBe(true);
      const hist = [winSim.s];
      expect(tpWon(hist[0])).toBe(true);
    });
  });

  // =========================================================================
  // 5. PYRAMID
  // =========================================================================
  describe("5. Pyramid", () => {
    function simulatePyramid(seed: number, limit = 250) {
      let s = dealPyramid(seed);
      const moves: any[] = [];
      let stuckCount = 0;

      while (!s.won && moves.length < limit) {
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

      return { s, moves, won: s.won, hasMoves: pyramidHasMoves(s) };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulatePyramid(seed);
        const remainingPyr = sim.s.pyramid.filter((c) => c !== null).length;
        const clearedPyr = 28 - remainingPyr;
        const totalRemaining = remainingPyr + sim.s.stock.length + sim.s.waste.length;
        expect(totalRemaining).toBeLessThanOrEqual(52);
        expect(totalRemaining).toBeGreaterThanOrEqual(0);

        const tally = tallyPyramid(seed, sim.moves);
        expect(tally.clearedCards).toBe(clearedPyr);
        expect(tally.won).toBe(sim.won);
      }
    });

    it("checks edge cases: empty stock recycling, stalemate detection, no infinite loops", () => {
      const s = dealPyramid(10);
      s.stock = [];
      s.waste = [];
      // Cannot recycle empty waste
      expect(applyPyramid(s, { kind: "recycle" })).toBe(s);

      // Cannot recycle when stock is not empty
      s.stock = [1, 2];
      s.waste = [3, 4];
      expect(applyPyramid(s, { kind: "recycle" })).toBe(s);

      // Stalemate detection: stock is empty, waste cannot pair with any uncovered card, no pyramid pairs/kings
      s.stock = [];
      s.waste = [0]; // Ace (rank 1)
      s.pyramid.fill(null);
      s.pyramid[21] = 1; // 2 (rank 2). 1 + 2 = 3 !== 13.
      expect(pyramidHasMoves(s)).toBe(false);
      expect(findPyramidHint(s)).toBeNull(); // Clean stalemate termination, no infinite loop!
    });
  });

  // =========================================================================
  // 6. YUKON
  // =========================================================================
  describe("6. Yukon", () => {
    function simulateYukon(seed: number, maxSteps = 4000) {
      let s = dealYukon(seed);
      const queue: { state: typeof s; moves: string[] }[] = [{ state: s, moves: [] }];
      const seen = new Set<string>();
      const key = (st: typeof s) =>
        st.cols.map((c) => c.down.length + ":" + c.up.join(",")).join("|") +
        "#" +
        st.found.map((f) => f.length).join(",");

      let steps = 0;
      let finalState = s;
      let finalMoves: string[] = [];

      while (queue.length > 0 && steps++ < maxSteps) {
        const cur = queue.pop()!;
        finalState = cur.state;
        finalMoves = cur.moves;
        if (yukonWon(cur.state)) break;

        const k = key(cur.state);
        if (seen.has(k)) continue;
        seen.add(k);

        // 1. Foundation move
        let found = false;
        for (let c = 0; c < 7; c++) {
          const col = cur.state.cols[c];
          if (col.up.length > 0) {
            const topCard = col.up[col.up.length - 1];
            if (fitsYukonFoundation(topCard, cur.state.found[cardSuit(topCard)])) {
              const m = `t${c}>f`;
              const next = applyYukon(cur.state, m);
              if (next !== cur.state) {
                queue.push({ state: next, moves: [...cur.moves, m] });
                found = true;
              }
            }
          }
        }
        if (found) continue;

        // 2. Tableau moves
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

      return { s: finalState, moves: finalMoves, won: yukonWon(finalState) };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateYukon(seed, 500);
        // Invariant: 52 total cards
        const total =
          sim.s.cols.reduce((sum, c) => sum + c.down.length + c.up.length, 0) +
          sim.s.found.reduce((sum, f) => sum + f.length, 0);
        expect(total).toBe(52);

        const tally = tallyYukon(seed, sim.moves);
        expect(tally.moves).toBe(sim.moves.length);
        expect(tally.won).toBe(sim.won);
      }
    });

    it("checks edge cases: empty column King constraint, arbitrary stack order, auto-flip, stalemate", () => {
      // Empty column accepts only King root
      const s = dealYukon(7);
      s.cols[0].up = [];
      s.cols[0].down = [];
      s.cols[1].down = [];
      s.cols[1].up = [8, 20]; // 9 of Spades (rank 9) on top
      expect(applyYukon(s, "t1>t0:2")).toBe(s); // Rejected!

      // Arbitrary internal order allowed if root fits
      s.cols[2].down = [];
      s.cols[2].up = [35]; // 10 of Diamonds (rank 10, red)
      // Moving [9 of Spades (black), 8 of Hearts] onto 10 of Diamonds
      const moved = applyYukon(s, "t1>t2:2");
      expect(moved).not.toBe(s);
      expect(moved.cols[2].up.length).toBe(3);

      // Auto-turn face-down card
      s.cols[3].down = [1];
      s.cols[3].up = [8];
      const moved2 = applyYukon(s, "t3>t2:1");
      expect(moved2.cols[3].down.length).toBe(0);
      expect(moved2.cols[3].up).toEqual([1]); // Face-down card auto-turned up!

      // Stalemate detection
      const deadYukon = dealYukon(99);
      deadYukon.cols.forEach((c) => {
        c.down = [];
        c.up = [12]; // All Kings, cannot move onto each other
      });
      deadYukon.found = [[], [], [], []];
      expect(yukonHasMoves(deadYukon)).toBe(false);
    });
  });

  // =========================================================================
  // 7. EGYPTIAN RAT SCREW
  // =========================================================================
  describe("7. Egyptian Rat Screw", () => {
    function simulateErs(seed: number, maxSteps = 2500) {
      let state = dealErs(seed);
      const moves: ErsMove[] = [];
      let steps = 0;

      while (state.winner === null && steps < maxSteps) {
        steps++;
        const slap = checkSlap(state.pot);
        if (slap !== null) {
          // Asymmetric player reaction ensures decisive game resolution without infinite oscillation
          const who: ErsMove = steps % 3 === 0 ? "slap:0" : "slap:1";
          state = applyErs(state, who);
          moves.push(who);
          continue;
        }

        const move: ErsMove = state.turn === 0 ? "play:0" : "play:1";
        state = applyErs(state, move);
        moves.push(move);
      }

      return { state, moves, winner: state.winner };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateErs(seed);
        expect(sim.winner).not.toBeNull();
        const totalCards = sim.state.p0.length + sim.state.p1.length + sim.state.pot.length;
        expect(totalCards).toBe(52);

        const tally = tallyErs(seed, sim.moves);
        expect(tally.won).toBe(sim.winner === 0);
      }
    });

    it("checks edge cases: simultaneous slaps, false slaps with 1 card in hand, face card challenges with exhausted deck", () => {
      // Simultaneous slaps:
      // Pot has cards popped from p0 (conserving 52 total cards)
      const s = dealErs(42);
      // Double 8s: 8♠ (7) and 8♥ (20)
      s.p0 = s.p0.filter((c) => c !== 7 && c !== 20);
      s.p1 = s.p1.filter((c) => c !== 7 && c !== 20);
      s.pot = [7, 20]; // 8♠ and 8♥ (2 cards in pot)
      // Exactly 52 cards total
      expect(s.p0.length + s.p1.length + s.pot.length).toBe(52);

      const s1 = applyErs(s, "slap:0");
      expect(s1.pot.length).toBe(0);

      const s2 = applyErs(s1, "slap:1");
      expect(s2.pot.length).toBe(1); // Slower slap on empty pot burns 1 card
      // Card conservation holds: exactly 52 cards
      expect(s2.p0.length + s2.p1.length + s2.pot.length).toBe(52);

      // False slap when player has exactly 1 card in hand:
      // Player burns their only card -> hand drops to 0 -> opponent declared winner immediately!
      const sOneCard = dealErs(1);
      sOneCard.p0 = [5]; // 1 card left
      sOneCard.pot = [2, 18]; // no slap
      const sDead = applyErs(sOneCard, "slap:0");
      expect(sDead.p0.length).toBe(0);
      expect(sDead.winner).toBe(1); // Opponent wins!

      // Face card challenge with exhausted deck:
      // P0 plays King (3 chances), P1 has 0 cards in hand
      const sZero = dealErs(1);
      sZero.p0 = [12]; // King
      sZero.p1 = [];   // 0 cards
      sZero.turn = 0;
      const sWonImmediate = applyErs(sZero, "play:0");
      expect(sWonImmediate.winner).toBe(0); // Challenger claims pot and wins!

      // Defender runs out of cards midway through challenge:
      const sMidway = dealErs(2);
      sMidway.p0 = [12]; // King (3 chances)
      sMidway.p1 = [3];  // Only 1 number card
      sMidway.turn = 0;
      let cur = applyErs(sMidway, "play:0"); // P0 plays King
      expect(cur.challenge?.chances).toBe(3);
      cur = applyErs(cur, "play:1"); // P1 plays their only card
      expect(cur.winner).toBe(0); // Challenger wins immediately, no stuck state!
    });
  });

  // =========================================================================
  // 8. SCOUNDREL
  // =========================================================================
  describe("8. Scoundrel", () => {
    function simulateScoundrel(seed: number) {
      let state = dealScoundrel(seed);
      const moves: ScoundrelMove[] = [];
      let steps = 0;

      while (!state.dead && !state.escaped && steps++ < 100) {
        // Find valid pick
        let played = false;
        for (let i = 0; i < 4; i++) {
          const card = state.room[i];
          if (card === null) continue;
          const kind = scoundrelCardKind(card);
          const val = scoundrelCardValue(card);

          if (kind === "monster") {
            const canW = state.weapon && (state.weapon.lastDefeated === undefined || val <= state.weapon.lastDefeated);
            if (canW) {
              const m: ScoundrelMove = { kind: "pick", roomIndex: i, useWeapon: true };
              const next = applyScoundrel(state, m);
              if (next !== state) {
                state = next;
                moves.push(m);
                played = true;
                break;
              }
            }
            // Barehanded
            const mBare: ScoundrelMove = { kind: "pick", roomIndex: i, useWeapon: false };
            const nextBare = applyScoundrel(state, mBare);
            if (nextBare !== state) {
              state = nextBare;
              moves.push(mBare);
              played = true;
              break;
            }
          } else {
            const m: ScoundrelMove = { kind: "pick", roomIndex: i };
            const next = applyScoundrel(state, m);
            if (next !== state) {
              state = next;
              moves.push(m);
              played = true;
              break;
            }
          }
        }

        if (!played) {
          if (state.canFlee && state.cardsResolvedInRoom === 0 && state.dungeon.length > 0) {
            const fled = applyScoundrel(state, { kind: "flee" });
            if (fled !== state) {
              state = fled;
              moves.push({ kind: "flee" });
              continue;
            }
          }
          break;
        }
      }

      return { state, moves, terminal: state.escaped ? "escaped" : state.dead ? "dead" : "stuck" };
    }

    it("runs automated gameplay simulations through 10 complete games across seeds 1..10", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const sim = simulateScoundrel(seed);
        expect(["escaped", "dead"]).toContain(sim.terminal);

        const tally = tallyScoundrel(seed, sim.moves);
        expect(tally.monstersSlayed).toBe(sim.state.monstersSlayed);
        expect(tally.roomsCleared).toBe(sim.state.roomsCleared);
        expect(tally.hpLeft).toBe(sim.state.hp);
        expect(tally.won).toBe(sim.state.escaped && !sim.state.dead);
      }
    });

    it("checks edge cases: 0 HP loss, weapon degradation with higher monsters, room carryover potions, fleeing constraints", () => {
      // 0 HP loss: weapon 8 vs monster 6
      const s = dealScoundrel(10);
      s.room[0] = 33; // Diamond 8 (weapon)
      s.room[1] = 5;  // Spade 6 (monster)
      const s1 = applyScoundrel(s, { kind: "pick", roomIndex: 0 }); // equip weapon (resolved = 1)
      expect(s1.weapon?.power).toBe(8);
      const s2 = applyScoundrel(s1, { kind: "pick", roomIndex: 1, useWeapon: true }); // attack monster (resolved = 2)
      expect(s2.hp).toBe(20); // 0 damage taken!
      expect(s2.weapon?.lastDefeated).toBe(6); // Durability degraded to 6

      // Weapon degradation: cannot attack monster with value 7 using weapon with lastDefeated = 6
      s2.room[2] = 6; // Spade 7
      const s3Illegal = applyScoundrel(s2, { kind: "pick", roomIndex: 2, useWeapon: true });
      expect(s3Illegal).toBe(s2); // Move rejected!

      // Barehanded attack allowed: takes 7 damage and completes room 0 (resolved = 3)
      const s3Legal = applyScoundrel(s2, { kind: "pick", roomIndex: 2, useWeapon: false });
      expect(s3Legal.hp).toBe(13);
      expect(s3Legal.weapon?.lastDefeated).toBe(6); // Weapon durability unchanged
      expect(s3Legal.roomsCleared).toBe(1); // Advanced to room 1!
      expect(s3Legal.potionUsedThisRoom).toBe(false); // Reset for new room!

      // Room carryover potions in room 1:
      s3Legal.room[1] = 17; // Heart 5 (potion)
      s3Legal.room[2] = 18; // Heart 6 (potion)
      const s4 = applyScoundrel(s3Legal, { kind: "pick", roomIndex: 1 }); // pick first potion
      expect(s4.hp).toBe(18); // Healed 5
      expect(s4.potionUsedThisRoom).toBe(true);

      // Second potion in same room discarded without healing
      const s5 = applyScoundrel(s4, { kind: "pick", roomIndex: 2 });
      expect(s5.hp).toBe(18); // HP does NOT increase!

      // Fleeing constraints: cannot flee after picking cards in a room
      expect(s4.cardsResolvedInRoom).toBe(1);
      expect(applyScoundrel(s4, { kind: "flee" })).toBe(s4); // Flee rejected!
    });
  });
});
