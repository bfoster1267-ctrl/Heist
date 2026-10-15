import { describe, expect, it } from "vitest";
import { applySol, autoMove, dealKlondike, newProgress, replaySol, settleSolitaire, solitaireRoom, solGain, solPay, solSolved, solWon, tallySol, tallyXp, tapMove, upgrade, SOL_XP, SOLITAIRE_DAY_XP, SEASONS, type Klondike, type SolMove } from "../src";

/** A greedy player: foundations first, then any column move that turns a card over, else draw. */
function greedy(seed: number, limit = 3000): { k: Klondike; moves: SolMove[] } {
  let k = dealKlondike(seed);
  const moves: SolMove[] = [];
  let draws = 0;
  while (moves.length < limit && !solWon(k)) {
    let m: SolMove | null = autoMove(k);
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
      if (++draws > 60) break;
      m = "d";
    } else draws = 0;
    const n = applySol(k, m);
    if (!n) break;
    k = n;
    moves.push(m);
  }
  return { k, moves };
}

describe("solitaire", () => {
  it("deals 52 different cards: 28 in columns (one face up each), 24 in the stock", () => {
    const k = dealKlondike(42);
    const all = [...k.stock, ...k.cols.flatMap((c) => [...c.down, ...c.up])];
    expect(new Set(all).size).toBe(52);
    expect(k.stock.length).toBe(24);
    expect(k.cols.map((c) => c.up.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(k.cols.map((c) => c.down.length)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dealKlondike(42)).toEqual(k);
  });

  it("rejects illegal moves and keeps every card through a played game", () => {
    const k = dealKlondike(7);
    expect(applySol(k, "w>f")).toBeNull();
    expect(applySol(k, "t0>t0")).toBeNull();
    expect(applySol(k, "t3>t5:2")).toBeNull();
    expect(applySol(k, "nonsense")).toBeNull();
    const { k: end, moves } = greedy(7);
    const all = [...end.stock, ...end.waste, ...end.found.flat(), ...end.cols.flatMap((c) => [...c.down, ...c.up])];
    expect(new Set(all).size).toBe(52);
    expect(replaySol(7, moves)).toEqual(end);
    expect(() => replaySol(7, [...moves, "t0>t0"])).toThrow();
  });

  it("a simple greedy player wins some deals, and a solved game finishes itself", () => {
    let won = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { k } = greedy(seed);
      if (solWon(k)) won++;
      if (solSolved(k)) {
        let x = k;
        for (let m = autoMove(x); m; m = autoMove(x)) x = applySol(x, m)!;
        expect(solWon(x)).toBe(true);
      }
    }
    expect(won).toBeGreaterThan(0);
  });

  it("counts only positions never seen before, and each ace and suit once", () => {
    const seed = 7;
    expect(tallySol(seed, [])).toEqual({ moves: 0, aces: 0, stacks: 0, won: false });
    // flipping through the whole stock twice: the second pass is all positions already seen
    const pass = Array.from({ length: 25 }, () => "d");
    expect(tallySol(seed, pass).moves).toBe(24); // 24 draws, then back where it started
    expect(tallySol(seed, [...pass, ...pass]).moves).toBe(24);
    expect(() => tallySol(seed, ["t0>t0"])).toThrow();
    // undo and redo pays nothing twice
    const first = solGain(undefined, tallySol(seed, ["d", "d"]));
    expect(first.gained.moves).toBe(2);
    expect(solGain(first.paid, tallySol(seed, ["d"])).any).toBe(false);
    expect(solGain(first.paid, tallySol(seed, ["d", "d", "d"])).gained.moves).toBe(1);
  });

  it("stalling and hints drain a deal's XP, never below zero, and never take back what's paid", () => {
    const seed = 7;
    const five = tallySol(seed, ["d", "d", "d", "d", "d"]);
    const a = solPay(undefined, undefined, five, 2);
    expect([a.xp, a.paidXp]).toEqual([3, 3]);
    // more drain after paying: nothing new, nothing taken back
    expect(solPay(a.paid, a.paidXp, five, 5).xp).toBe(0);
    expect(solPay(undefined, undefined, five, 99).xp).toBe(0);
    // more moves earn again once they climb past what was paid
    const eight = tallySol(seed, ["d", "d", "d", "d", "d", "d", "d", "d"]);
    expect(solPay(a.paid, a.paidXp, eight, 2).xp).toBe(3);
    // the reward shows what the drain cost, and adds up
    const r = settleSolitaire(newProgress(), Date.now(), solGain(undefined, five).gained, 3).reward;
    expect(r.xp).toBe(3);
    expect(r.lines.map((l) => [l.label, l.xp])).toEqual([["5 new moves", 5], ["Slow play and hints", -2]]);
  });

  it("pays each part in XP and season XP alike, up to a small daily allowance", () => {
    const at = SEASONS[0].start + 1000;
    const p = newProgress();
    const t = { moves: 120, aces: 4, stacks: 4, won: true };
    const r = settleSolitaire(p, at, t);
    expect(r.reward.xp).toBe(120 + 4 * SOL_XP.ace + 4 * SOL_XP.stack + SOL_XP.win);
    expect(r.reward.xp).toBe(tallyXp(t));
    expect(r.reward.pass?.xp).toBe(r.reward.xp);
    expect(r.progress.solitaire.won).toBe(1);
    expect(r.reward.lines.map((l) => l.label).slice(0, 3)).toEqual(["120 new moves", "4 aces sent up", "4 suits finished"]);
    const near = { ...r.progress, solitaire: { ...r.progress.solitaire, xp: SOLITAIRE_DAY_XP - 10 } };
    const capped = settleSolitaire(near, at, { moves: 50, aces: 0, stacks: 0, won: false });
    expect(capped.reward.xp).toBe(10);
    expect(settleSolitaire(capped.progress, at, { moves: 5, aces: 0, stacks: 0, won: false }).reward.xp).toBe(0);
    expect(settleSolitaire(capped.progress, at + 86_400_000, { moves: 5, aces: 0, stacks: 0, won: false }).reward.xp).toBe(5);
    expect(solitaireRoom(capped.progress, at)).toBe(0);
    expect(solitaireRoom(capped.progress, at + 86_400_000)).toBe(SOLITAIRE_DAY_XP);
    expect(upgrade({ xp: 5 } as never).solitaire).toEqual({ won: 0, day: null, xp: 0 });
  });
});
