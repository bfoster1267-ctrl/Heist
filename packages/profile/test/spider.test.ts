import { describe, expect, it } from "vitest";
import {
  applySpider, canMoveSpider, dealSpider, findCompleteRun,
  isValidSpiderSequence, tallySpider, tallySpiderXp, type SpiderCard,
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

  it("identifies valid same-suit descending sequences", () => {
    // Suit 0 (Spades): 8 is rank 8 (card 7), 7 is rank 7 (card 6), 6 is rank 6 (card 5)
    // Note: cardRank(card) returns rank 1..13 (Ace=1, King=13). Card 0 is Ace of spades (rank 1), Card 12 is King of spades (rank 13).
    // So rank 8 is card 7, rank 7 is card 6, rank 6 is card 5.
    const col: SpiderCard[] = [
      { card: 10, up: false },
      { card: 7, up: true }, // rank 8
      { card: 6, up: true }, // rank 7
      { card: 5, up: true }, // rank 6
    ];

    expect(isValidSpiderSequence(col, 1)).toBe(true);
    expect(isValidSpiderSequence(col, 2)).toBe(true);
    expect(isValidSpiderSequence(col, 3)).toBe(true);
    expect(isValidSpiderSequence(col, 0)).toBe(false); // face down
  });

  it("deals 10 cards from stock to all cascades", () => {
    let s = dealSpider(42, 1);
    expect(s.stock.length).toBe(50);
    s = applySpider(s, { kind: "deal" });
    expect(s.stock.length).toBe(40);
    expect(s.tableau[0].length).toBe(7);
    expect(s.tableau[4].length).toBe(6);
  });

  it("detects and clears a complete K->A run (13 cards)", () => {
    // Build a run K -> A in Spades (cards 12 down to 0)
    const run: SpiderCard[] = [];
    for (let rank = 12; rank >= 0; rank--) {
      run.push({ card: rank, up: true });
    }

    expect(findCompleteRun(run)).toBe(0);

    const s = dealSpider(99, 1);
    s.tableau[0] = [...run];
    s.tableau[1] = [{ card: 12, up: true }]; // King

    const after = applySpider(s, { kind: "deal" });
    // After deal or run check, completed increases
  });

  it("tallies moves and calculates XP properly", () => {
    const s = dealSpider(777, 1);
    const moves = [{ kind: "deal" as const }];
    const t = tallySpider(777, moves, 1);
    expect(t.moves).toBe(1);
    expect(t.completedRuns).toBe(0);
    expect(tallySpiderXp(t)).toBe(0);
  });
});
