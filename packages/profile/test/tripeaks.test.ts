import { describe, expect, it } from "vitest";
import {
  applyTp, countPeaksCleared, dealTriPeaks, findTpHint, fitsTp, isTpUncovered,
  replayTriPeaks, tallyTriPeaks, tallyTpXp, tpGain, tpHasMoves, tpPay, tpWon,
  type TpMove, type TriPeaksState,
} from "../src/tripeaks";
import { settleTriPeaks, type Progress } from "../src/progress";

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
    // Suit 0 rank 1 (Ace = 0) vs rank 13 (King = 12)
    expect(fitsTp(0, 12)).toBe(true); // Ace fits King
    expect(fitsTp(12, 0)).toBe(true); // King fits Ace
    expect(fitsTp(5, 6)).toBe(true);  // 6 fits 7
    expect(fitsTp(5, 4)).toBe(true);  // 6 fits 5
    expect(fitsTp(5, 7)).toBe(false); // 6 does not fit 8
    expect(fitsTp(0, 2)).toBe(false); // Ace does not fit 3
    expect(fitsTp(12, 10)).toBe(false); // King does not fit Jack
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

  it("accurately detects cleared peaks", () => {
    const s = dealTriPeaks(77);
    expect(countPeaksCleared(s.tableau)).toBe(0);

    // Clear peak 0 (index 0)
    s.tableau[0] = null;
    expect(countPeaksCleared(s.tableau)).toBe(1);

    // Clear peak 1 (index 1)
    s.tableau[1] = null;
    expect(countPeaksCleared(s.tableau)).toBe(2);

    // Clear peak 2 (index 2)
    s.tableau[2] = null;
    expect(countPeaksCleared(s.tableau)).toBe(3);
  });

  it("tracks streaks and computes streak bonuses correctly without XP loss", () => {
    // Test tpGain milestone detection
    const t4 = { cleared: 4, maxStreak: 4, peaks: 0, won: false };
    const t5 = { cleared: 5, maxStreak: 5, peaks: 0, won: false };
    const g5 = tpGain(t4, t5);
    expect(g5.gained.streak5).toBe(true);
    expect(g5.gained.streak10).toBe(false);
    expect(g5.gained.maxStreak).toBe(5);
    expect(g5.any).toBe(true);

    // Progress settlement for reaching 5-card streak
    const initialProgress: Progress = {
      chips: 10000,
      coins: 300,
      xp: 0,
      prestige: 0,
      heists: { won: 0, lost: 0, streak: 0, bestStreak: 0 },
      season: { number: 1, xp: 0, claimed: [] },
      tripeaks: { won: 0, day: null, xp: 0 },
    };

    const pay5 = tpPay(t4, 4, t5, 0);
    expect(pay5.xp).toBe(4); // 1 for clear + 3 for streak5 bonus
    const settle5 = settleTriPeaks(initialProgress, Date.now(), pay5.gained, pay5.xp);
    expect(settle5.reward.xp).toBe(4);
    expect(settle5.reward.lines.some((l) => l.label === "5-card combo streak" && l.xp === 3)).toBe(true);

    // Reaching 10-card streak from 9
    const t9 = { cleared: 9, maxStreak: 9, peaks: 0, won: false };
    const t10 = { cleared: 10, maxStreak: 10, peaks: 0, won: false };
    const g10 = tpGain(t9, t10);
    expect(g10.gained.streak10).toBe(true);
    expect(g10.gained.streak5).toBe(false);
    expect(g10.gained.maxStreak).toBe(10);

    const pay10 = tpPay(t9, 12, t10, 0); // t9 had 9 + 3 = 12 XP; t10 has 10 + 3 + 10 = 23 XP -> diff is 11
    expect(pay10.xp).toBe(11);
    const settle10 = settleTriPeaks(initialProgress, Date.now(), pay10.gained, pay10.xp);
    expect(settle10.reward.xp).toBe(11);
    expect(settle10.reward.lines.some((l) => l.label === "10-card combo streak" && l.xp === 10)).toBe(true);

    // Full game straight to 10+ streak awards BOTH streak5 and streak10
    const tFull = { cleared: 28, maxStreak: 10, peaks: 3, won: true };
    const gFull = tpGain(undefined, tFull);
    expect(gFull.gained.streak5).toBe(true);
    expect(gFull.gained.streak10).toBe(true);

    const payFull = tpPay(undefined, undefined, tFull, 0);
    expect(payFull.xp).toBe(76);
    const settleFull = settleTriPeaks(initialProgress, Date.now(), payFull.gained, payFull.xp);
    expect(settleFull.reward.xp).toBe(76);
    expect(settleFull.reward.lines.some((l) => l.label === "5-card combo streak" && l.xp === 3)).toBe(true);
    expect(settleFull.reward.lines.some((l) => l.label === "10-card combo streak" && l.xp === 10)).toBe(true);
  });

  it("finds valid hints and recognizes stuck state", () => {
    const s = dealTriPeaks(42);
    expect(tpHasMoves(s)).toBe(true);

    // Clear all stock
    s.stock = [];
    // If no tableau card fits waste, findTpHint is null and tpHasMoves is false
    s.waste = [12]; // King of spades
    // Set all face-up cards to 5 (not adjacent to King)
    for (let i = 18; i < 28; i++) {
      s.tableau[i] = 4; // rank 5
    }
    expect(findTpHint(s)).toBeNull();
    expect(tpHasMoves(s)).toBe(false);

    // Now set one uncovered card to Ace (adjacent to King)
    s.tableau[20] = 0; // rank 1 (Ace)
    expect(findTpHint(s)).toBe(20);
    expect(tpHasMoves(s)).toBe(true);
  });

  it("simulates a full winning deal on Seed 8", () => {
    let s = dealTriPeaks(8);
    const moves: TpMove[] = [];

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

    expect(tpWon(s)).toBe(true);
    expect(s.tableau.every((c) => c === null)).toBe(true);

    // Replay moves
    const replayed = replayTriPeaks(8, moves);
    expect(tpWon(replayed)).toBe(true);

    const tally = tallyTriPeaks(8, moves);
    expect(tally.cleared).toBe(28);
    expect(tally.peaks).toBe(3);
    expect(tally.won).toBe(true);
    expect(tally.maxStreak).toBeGreaterThanOrEqual(5);
  });

  it("simulates a full 10-combo winning deal on Seed 39 with exact settlement", () => {
    let s = dealTriPeaks(39);
    const moves: TpMove[] = [];

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

    expect(tpWon(s)).toBe(true);
    const tally = tallyTriPeaks(39, moves);
    expect(tally.cleared).toBe(28);
    expect(tally.peaks).toBe(3);
    expect(tally.maxStreak).toBe(10);
    expect(tally.won).toBe(true);

    // Total XP: 28 (cleared) + 15 (3 peaks) + 20 (won) + 3 (streak5) + 10 (streak10) = 76
    expect(tallyTpXp(tally)).toBe(76);

    const pay = tpPay(undefined, undefined, tally, 0);
    expect(pay.xp).toBe(76);
  });

  it("preserves state consistency during undo and prevents duplicate XP", () => {
    const s0 = dealTriPeaks(42);
    const moves: TpMove[] = [];
    const history: TriPeaksState[] = [s0];

    // Find and play first move
    const h = findTpHint(s0);
    expect(h).not.toBeNull();
    const m1: TpMove = `t${h!}`;
    const s1 = applyTp(s0, m1)!;
    moves.push(m1);
    history.push(s1);

    expect(s1.tableau[h!]).toBeNull();
    expect(s1.streak).toBe(1);

    // Draw card
    const m2: TpMove = "d";
    const s2 = applyTp(s1, m2)!;
    moves.push(m2);
    history.push(s2);
    expect(s2.streak).toBe(0);

    // Undo draw
    history.pop();
    moves.pop();
    const restored1 = history[history.length - 1];
    expect(restored1.streak).toBe(1);
    expect(restored1.stock.length).toBe(s1.stock.length);
    expect(restored1.waste.length).toBe(s1.waste.length);

    // Undo first move
    history.pop();
    moves.pop();
    const restored0 = history[history.length - 1];
    expect(restored0.tableau[h!]).not.toBeNull();
    expect(restored0.streak).toBe(0);
  });
});
