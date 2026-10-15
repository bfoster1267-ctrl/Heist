import { describe, expect, it } from "vitest";
import {
  applySpider, canDealSpider, canMoveSpider, clearCompleteRuns, dealSpider,
  findCompleteRun, isValidSpiderSequence, tallySpider, tallySpiderXp,
  type SpiderCard, type SpiderState,
} from "../src/spider";

describe("Spider Solitaire", () => {
  it("deals 104 cards properly across 10 tableau cascades and stock", () => {
    const s = dealSpider(12345, 1);
    expect(s.tableau.length).toBe(10);
    expect(s.tableau[0].length).toBe(6);
    expect(s.tableau[1].length).toBe(6);
    expect(s.tableau[2].length).toBe(6);
    expect(s.tableau[3].length).toBe(6);
    expect(s.tableau[4].length).toBe(5);
    expect(s.tableau[9].length).toBe(5);

    // 4 * 6 + 6 * 5 = 54 cards on tableau
    const totalTableau = s.tableau.reduce((acc, col) => acc + col.length, 0);
    expect(totalTableau).toBe(54);

    // Remaining stock: 50 cards
    expect(s.stock.length).toBe(50);
    expect(s.completed).toBe(0);
    expect(s.won).toBe(false);
  });

  it("identifies valid same-suit descending sequences and rejects mixed suits or breaks", () => {
    // Suit 0 (Spades): card 7 = 8, card 6 = 7, card 5 = 6
    // Suit 1 (Hearts): card 18 = 6 (13 + 5 = 18)
    const validCol: SpiderCard[] = [
      { card: 10, up: false },
      { card: 7, up: true }, // 8♠
      { card: 6, up: true }, // 7♠
      { card: 5, up: true }, // 6♠
    ];

    expect(isValidSpiderSequence(validCol, 1)).toBe(true);
    expect(isValidSpiderSequence(validCol, 2)).toBe(true);
    expect(isValidSpiderSequence(validCol, 3)).toBe(true);
    expect(isValidSpiderSequence(validCol, 0)).toBe(false); // face down

    // Mixed suits: 8♠ (7) followed by 7♥ (19 = 13 + 6)
    const mixedSuitCol: SpiderCard[] = [
      { card: 7, up: true },  // 8♠
      { card: 19, up: true }, // 7♥
    ];
    expect(isValidSpiderSequence(mixedSuitCol, 0)).toBe(false); // Cannot move multi-suit together
    expect(isValidSpiderSequence(mixedSuitCol, 1)).toBe(true);  // Single card can move

    // Broken rank: 8♠ (7) followed by 5♠ (4)
    const brokenRankCol: SpiderCard[] = [
      { card: 7, up: true }, // 8♠
      { card: 4, up: true }, // 5♠
    ];
    expect(isValidSpiderSequence(brokenRankCol, 0)).toBe(false);
  });

  it("strictly enforces sequence movement in canMoveSpider", () => {
    const s = dealSpider(1, 2);
    // Col 0: 8♠ (card 7), 7♠ (card 6)
    s.tableau[0] = [
      { card: 7, up: true },
      { card: 6, up: true },
    ];
    // Col 1: 9♠ (card 8)
    s.tableau[1] = [
      { card: 8, up: true },
    ];
    // Col 2: 9♥ (card 21 = 13 + 8)
    s.tableau[2] = [
      { card: 21, up: true },
    ];
    // Col 3: empty
    s.tableau[3] = [];

    // Moving 8♠-7♠ sequence onto 9♠ (same suit) is legal
    expect(canMoveSpider(s, 0, 0, 1)).toBe(true);
    // Moving 8♠-7♠ sequence onto 9♥ (different suit) is legal in Spider (any suit destination)
    expect(canMoveSpider(s, 0, 0, 2)).toBe(true);
    // Moving to empty column accepts sequence
    expect(canMoveSpider(s, 0, 0, 3)).toBe(true);

    // Col 4: Mixed suit sequence 8♠ (7) and 7♥ (19)
    s.tableau[4] = [
      { card: 7, up: true },
      { card: 19, up: true },
    ];
    // Attempting to move the mixed sequence from index 0 is strictly illegal!
    expect(canMoveSpider(s, 4, 0, 1)).toBe(false);
    // Col 5: 8♠ (card 7). Moving single card 7♥ at index 1 onto 8♠ is legal
    s.tableau[5] = [{ card: 7, up: true }];
    expect(canMoveSpider(s, 4, 1, 5)).toBe(true);

    // Destination card cannot be face-down
    s.tableau[6] = [{ card: 7, up: false }];
    expect(canMoveSpider(s, 4, 1, 6)).toBe(false);
  });

  it("deals 10 cards from stock to all cascades and checks canDealSpider", () => {
    let s = dealSpider(42, 1);
    expect(s.stock.length).toBe(50);
    expect(canDealSpider(s)).toBe(true);

    s = applySpider(s, { kind: "deal" });
    expect(s.stock.length).toBe(40);
    expect(s.tableau[0].length).toBe(7);
    expect(s.tableau[4].length).toBe(6);

    // Check traditional empty column deal check
    s.tableau[9] = [];
    expect(canDealSpider(s, true)).toBe(false); // requireNoEmpty fails
    expect(canDealSpider(s, false)).toBe(true); // relaxed allows
  });

  it("detects and clears a complete K->A run, auto-flipping exposed face-down card", () => {
    // Build a run K -> A in Spades (cards 12 down to 0)
    const run: SpiderCard[] = [];
    for (let rank = 12; rank >= 0; rank--) {
      run.push({ card: rank, up: true });
    }

    expect(findCompleteRun(run)).toBe(0);

    const s = dealSpider(99, 1);
    // Col 0 has 1 face-down card, then K down to 2 (12 cards)
    const almostRun: SpiderCard[] = [
      { card: 25, up: false }, // face-down hidden card underneath
    ];
    for (let rank = 12; rank >= 1; rank--) {
      almostRun.push({ card: rank, up: true });
    }
    s.tableau[0] = almostRun;
    // Col 1 has Ace of Spades (card 0)
    s.tableau[1] = [{ card: 0, up: true }];

    expect(s.completed).toBe(0);

    // Move Ace from col 1 onto col 0 (onto the 2)
    const after = applySpider(s, { kind: "move", fromCol: 1, cardIndex: 0, toCol: 0 });

    // The complete K->A run should be cleared!
    expect(after.completed).toBe(1);
    // Col 0 should now only have 1 card left: the previously face-down card, now auto-flipped!
    expect(after.tableau[0].length).toBe(1);
    expect(after.tableau[0][0].up).toBe(true);
    expect(after.tableau[0][0].card).toBe(25);
    // Col 1 is now empty
    expect(after.tableau[1].length).toBe(0);
  });

  it("clears a complete K->A run exposed on fromCol when covering cards are moved away", () => {
    const s = dealSpider(99, 1);
    // Col 0 has a complete K->A run, but covered by a 5 of Spades (card 4)
    const runCovered: SpiderCard[] = [
      { card: 50, up: false }, // hidden card under the King
    ];
    for (let rank = 12; rank >= 0; rank--) {
      runCovered.push({ card: rank, up: true }); // K through A
    }
    runCovered.push({ card: 4, up: true }); // 5 of Spades covering Ace

    s.tableau[0] = runCovered;
    // Col 1 has 6 of Spades (card 5)
    s.tableau[1] = [{ card: 5, up: true }];

    // Move the covering 5 from Col 0 (index 14) to Col 1
    const after = applySpider(s, { kind: "move", fromCol: 0, cardIndex: 14, toCol: 1 });

    // The exposed K->A run on Col 0 should now be cleared!
    expect(after.completed).toBe(1);
    // Hidden card 50 should be auto-flipped to face-up!
    expect(after.tableau[0].length).toBe(1);
    expect(after.tableau[0][0].card).toBe(50);
    expect(after.tableau[0][0].up).toBe(true);
  });

  it("simulates moving cards, dealing stock, clearing a suit, and winning", () => {
    // Construct a game near victory (completed = 7 runs)
    const s = dealSpider(100, 1);
    s.completed = 7;

    // Col 0 has K through 2 (12 cards)
    const kDownTo2: SpiderCard[] = [];
    for (let rank = 12; rank >= 1; rank--) {
      kDownTo2.push({ card: rank, up: true });
    }
    s.tableau[0] = kDownTo2;

    // Col 1 has 2 face-down cards, then Ace of Spades (card 0)
    s.tableau[1] = [
      { card: 9, up: false },
      { card: 0, up: true },
    ];

    // Col 2 has an extra card so we can test a preliminary move
    s.tableau[2] = [
      { card: 6, up: true }, // 7♠
    ];
    s.tableau[3] = [
      { card: 5, up: true }, // 6♠
    ];

    // Step 1: Move 6♠ onto 7♠
    expect(canMoveSpider(s, 3, 0, 2)).toBe(true);
    let cur = applySpider(s, { kind: "move", fromCol: 3, cardIndex: 0, toCol: 2 });
    expect(cur.tableau[2].length).toBe(2);
    expect(cur.completed).toBe(7);
    expect(cur.won).toBe(false);

    // Step 2: Deal stock
    const stockBefore = cur.stock.length;
    cur = applySpider(cur, { kind: "deal" });
    expect(cur.stock.length).toBe(stockBefore - 10);

    // Step 3: Complete the 8th run by moving Ace onto 2
    // Let's ensure Col 0 ends with 2♠ and Col 1 ends with Ace♠
    cur.tableau[0] = [...kDownTo2];
    cur.tableau[1] = [{ card: 9, up: false }, { card: 0, up: true }];

    const winState = applySpider(cur, { kind: "move", fromCol: 1, cardIndex: 1, toCol: 0 });

    // Completed suits increments to 8
    expect(winState.completed).toBe(8);
    // Game is won!
    expect(winState.won).toBe(true);
    // Face-down card on Col 1 was auto-flipped
    expect(winState.tableau[1][0].up).toBe(true);

    // Further moves are blocked when won
    const afterWin = applySpider(winState, { kind: "deal" });
    expect(afterWin).toBe(winState);
  });

  it("tallies moves and calculates XP properly", () => {
    const moves = [{ kind: "deal" as const }];
    const t = tallySpider(777, moves, 1);
    expect(t.moves).toBe(1);
    expect(t.completedRuns).toBe(0);
    expect(tallySpiderXp(t)).toBe(0);
  });
});
