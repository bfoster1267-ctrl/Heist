import { describe, expect, it } from "vitest";
import {
  applyErs, checkSlap, dealErs, faceChances, tallyErs, tallyErsXp,
  type ErsMove, type ErsState,
} from "../src/ers";

describe("Egyptian Rat Screw engine", () => {
  it("deals 26 cards each and starts with empty pot", () => {
    const s = dealErs(42);
    expect(s.p0.length).toBe(26);
    expect(s.p1.length).toBe(26);
    expect(s.pot.length).toBe(0);
    expect(s.turn).toBe(0);
    expect(s.winner).toBe(null);
  });

  it("calculates face card chances correctly", () => {
    expect(faceChances(0)).toBe(4);   // Ace (rank 1) -> 4 chances
    expect(faceChances(12)).toBe(3);  // King (rank 13) -> 3 chances
    expect(faceChances(11)).toBe(2);  // Queen (rank 12) -> 2 chances
    expect(faceChances(10)).toBe(1);  // Jack (rank 11) -> 1 chance
    expect(faceChances(4)).toBe(0);   // 5 (rank 5) -> 0
    expect(faceChances(9)).toBe(0);   // 10 (rank 10) -> 0
  });

  describe("slap conditions", () => {
    it("detects doubles (identical rank in succession)", () => {
      // 8♠ (card 7) and 8♥ (card 20 = 13 + 7)
      expect(checkSlap([7, 20])).toBe("double");
      // 2♦ (card 27 = 26 + 1) and 2♣ (card 40 = 39 + 1)
      expect(checkSlap([15, 27, 40])).toBe("double");
    });

    it("detects sandwiches (same rank separated by 1 card)", () => {
      // 7♠ (card 6), 3♦ (card 28), 7♥ (card 19)
      expect(checkSlap([6, 28, 19])).toBe("sandwich");
      expect(checkSlap([10, 2, 45, 2])).toBe("sandwich");
    });

    it("detects marriages (King and Queen in either order)", () => {
      // King (rank 13) and Queen (rank 12)
      expect(checkSlap([12, 24])).toBe("marriage"); // K♠ (12) and Q♥ (24)
      expect(checkSlap([24, 12])).toBe("marriage"); // Q♥ (24) and K♠ (12)
      expect(checkSlap([5, 38, 24])).toBe("marriage"); // 6♠, K♦ (38), Q♥ (24 = 13+11)
    });

    it("detects tens (top two cards sum to 10)", () => {
      // A (rank 1) + 9 (rank 9): card 0 and card 8
      expect(checkSlap([0, 8])).toBe("tens");
      expect(checkSlap([8, 0])).toBe("tens");
      // 2 + 8: card 1 and card 7
      expect(checkSlap([1, 7])).toBe("tens");
      // 3 + 7: card 2 and card 6
      expect(checkSlap([2, 6])).toBe("tens");
      // 4 + 6: card 3 and card 5
      expect(checkSlap([3, 5])).toBe("tens");
      // 5 + 5: triggers double (which is also a slap)
      expect(checkSlap([4, 17])).toBe("double");
    });

    it("detects top-bottom (top card matches very first card in pot)", () => {
      // First card in pot is card 4 (rank 5). Top card is card 17 (rank 5)
      expect(checkSlap([4, 18, 20, 17])).toBe("topbottom");
      // Length < 3 does not trigger top-bottom
      expect(checkSlap([4, 18])).toBe(null);
    });
  });

  describe("slap resolution and penalties", () => {
    it("valid slap scoops pot into winner's pile", () => {
      const s = dealErs(1);
      s.pot = [7, 20]; // Double 8s
      const s2 = applyErs(s, "slap:0");
      expect(s2.pot.length).toBe(0);
      expect(s2.p0.length).toBe(28); // 26 + 2
      expect(s2.turn).toBe(0); // Winner of slap plays next
      expect(s2.challenge).toBe(null);
    });

    it("false slap burns 1 card to the bottom of the pot", () => {
      const s = dealErs(1);
      s.pot = [2, 18]; // 3 and 6 (no slap condition)
      const s2 = applyErs(s, "slap:0");
      expect(s2.pot.length).toBe(3);
      expect(s2.p0.length).toBe(25); // burned 1 card
      // Burned card is at the bottom of the pot (index 0)
      expect(s2.pot[0]).toBe(s.p0[s.p0.length - 1]);
    });
  });

  describe("face card challenges", () => {
    it("initiates challenge when face card is played", () => {
      const s = dealErs(1);
      s.p0 = [12]; // King of Spades (3 chances)
      s.turn = 0;

      const s2 = applyErs(s, "play:0");
      expect(s2.pot).toEqual([12]);
      expect(s2.challenge).toEqual({ by: 0, chances: 3 });
      expect(s2.turn).toBe(1); // Opponent must answer
    });

    it("challenger claims pot if opponent exhausts all chances with number cards", () => {
      const s = dealErs(1);
      s.p0 = [10]; // Jack (1 chance)
      s.p1 = [2, 5]; // number cards (3 and 6)
      s.turn = 0;

      // P0 plays Jack
      let cur = applyErs(s, "play:0");
      expect(cur.challenge).toEqual({ by: 0, chances: 1 });
      expect(cur.turn).toBe(1);

      // P1 plays number card (chance 1 exhausted!)
      cur = applyErs(cur, "play:1");
      expect(cur.challenge).toBe(null);
      expect(cur.pot.length).toBe(0); // P0 claimed the pot!
      expect(cur.turn).toBe(0); // Challenger starts next turn
      expect(cur.lastEvent).toContain("You won the challenge");
    });

    it("counter-challenge flips challenger when defender plays another face card", () => {
      const s = dealErs(1);
      s.p0 = [2, 3, 11]; // Queen (11) on top, with cards remaining underneath to answer
      s.p1 = [4, 0]; // Ace (0) is top card (last element), on top of 5 (4)
      s.turn = 0;

      // P0 plays Queen
      let cur = applyErs(s, "play:0");
      expect(cur.challenge).toEqual({ by: 0, chances: 2 });
      expect(cur.turn).toBe(1);

      // P1 plays Ace on their first chance
      cur = applyErs(cur, "play:1");
      expect(cur.challenge).toEqual({ by: 1, chances: 4 }); // Now P1 challenges P0 with 4 chances!
      expect(cur.turn).toBe(0);
    });

    it("resolves immediately if defender runs out of cards during a challenge without stuck state", () => {
      const s = dealErs(1);
      s.p0 = [12]; // King (3 chances)
      s.p1 = [3];  // Only 1 card left!
      s.turn = 0;

      // P0 plays King
      let cur = applyErs(s, "play:0");
      expect(cur.challenge).toEqual({ by: 0, chances: 3 });
      expect(cur.turn).toBe(1);

      // P1 plays their last card (1 chance used, 2 remaining, but 0 cards left)
      cur = applyErs(cur, "play:1");

      // Because P1 ran out of cards, challenge immediately resolves
      expect(cur.challenge).toBe(null);
      expect(cur.pot.length).toBe(0);
      expect(cur.p1.length).toBe(0);
      // P0 claims pot and wins the game!
      expect(cur.winner).toBe(0);
    });
  });

  describe("full simulation test vs bot", () => {
    it("simulates full matches of ERS without stuck states or infinite loops", () => {
      // Run multiple seeds
      const seeds = [101, 202, 303, 404, 505];

      for (const seed of seeds) {
        let state = dealErs(seed);
        const moves: ErsMove[] = [];
        let steps = 0;
        const maxSteps = 2500;

        while (state.winner === null && steps < maxSteps) {
          steps++;

          // 1. Check for slap condition
          const slap = checkSlap(state.pot);
          if (slap !== null) {
            // Either human or bot slaps (simulate alternating reaction)
            const whoSlaps = steps % 3 === 0 ? "slap:0" : "slap:1";
            const prev = state;
            state = applyErs(state, whoSlaps);
            moves.push(whoSlaps);
            expect(state).not.toBe(prev);
            continue;
          }

          // 2. Play card according to current turn
          const move: ErsMove = state.turn === 0 ? "play:0" : "play:1";
          const prev = state;
          state = applyErs(state, move);
          moves.push(move);

          // State must progress or declare a winner
          if (state.winner === null) {
            expect(state).not.toBe(prev);
          }
        }

        // Must complete within maxSteps with a decisive winner
        expect(state.winner).not.toBe(null);
        expect(steps).toBeLessThan(maxSteps);

        // Verify total cards on board equals 52
        const totalCards = state.p0.length + state.p1.length + state.pot.length;
        expect(totalCards).toBe(52);

        // Tally replay must match
        const tally = tallyErs(seed, moves);
        expect(tally.won).toBe(state.winner === 0);
        expect(tallyErsXp(tally)).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
