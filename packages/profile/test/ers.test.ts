import { describe, expect, it } from "vitest";
import { applyErs, checkSlap, dealErs, faceChances } from "../src/ers";

describe("Egyptian Rat Screw engine", () => {
  it("deals 26 cards each and starts with empty pot", () => {
    const s = dealErs(42);
    expect(s.p0.length).toBe(26);
    expect(s.p1.length).toBe(26);
    expect(s.pot.length).toBe(0);
    expect(s.turn).toBe(0);
  });

  it("calculates face card chances correctly", () => {
    expect(faceChances(0)).toBe(4);   // Ace (rank 1) -> 4 chances
    expect(faceChances(12)).toBe(3);  // King (rank 13) -> 3 chances
    expect(faceChances(11)).toBe(2);  // Queen (rank 12) -> 2 chances
    expect(faceChances(10)).toBe(1);  // Jack (rank 11) -> 1 chance
    expect(faceChances(4)).toBe(0);   // 5 (rank 5) -> 0
  });

  it("detects slap conditions: doubles, sandwich, marriage, tens", () => {
    // Doubles (suit 0 rank 8, suit 1 rank 8)
    expect(checkSlap([7, 20])).toBe("double");

    // Sandwich (suit 0 rank 7, suit 2 rank 3, suit 1 rank 7)
    expect(checkSlap([6, 28, 19])).toBe("sandwich");

    // Marriage (suit 0 King=12, suit 1 Queen=24)
    expect(checkSlap([12, 24])).toBe("marriage");

    // Tens (suit 0 rank 4 = 3, suit 0 rank 6 = 5; 4 + 6 = 10)
    expect(checkSlap([3, 5])).toBe("tens");

    // Top-Bottom
    expect(checkSlap([4, 18, 20, 17])).toBe("topbottom");
  });

  it("valid slap scoops pot into winner's pile", () => {
    const s = dealErs(1);
    s.pot = [7, 20]; // Double 8s
    const s2 = applyErs(s, "slap:0");
    expect(s2.pot.length).toBe(0);
    expect(s2.p0.length).toBe(28); // 26 + 2
  });

  it("false slap burns 1 card to the pot", () => {
    const s = dealErs(1);
    s.pot = [2, 18]; // 3 and 6 (no double, sandwich, etc.)
    const s2 = applyErs(s, "slap:0");
    expect(s2.pot.length).toBe(3);
    expect(s2.p0.length).toBe(25); // burned 1 card
  });
});
