import { describe, expect, it } from "vitest";
import { applySol, autoMove, dealKlondike, newProgress, replaySol, settleSolitaire, solFound, solSolved, solWon, tapMove, upgrade, SOLITAIRE_CARD, SOLITAIRE_XP, SEASONS, type Klondike, type SolMove } from "../src";

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

  it("pays XP and season XP for the first wins of the day only", () => {
    const at = SEASONS[0].start + 1000;
    let p = newProgress();
    for (let i = 0; i < SOLITAIRE_XP.perDay; i++) {
      const r = settleSolitaire(p, at);
      expect(r.reward.xp).toBe(SOLITAIRE_XP.xp);
      expect(r.reward.pass?.xp).toBe(SOLITAIRE_XP.season);
      p = r.progress;
    }
    const over = settleSolitaire(p, at);
    expect(over.reward.xp).toBe(0);
    expect(over.reward.pass).toBeNull();
    expect(over.progress.solitaire.won).toBe(SOLITAIRE_XP.perDay + 1);
    expect(settleSolitaire(over.progress, at + 86_400_000).reward.xp).toBe(SOLITAIRE_XP.xp);
    expect(upgrade({ xp: 5 } as never).solitaire).toEqual({ won: 0, day: null, today: 0, cards: 0 });
  });

  it("pays for cards on the foundations up to a daily cap, and counts them on a win", () => {
    const at = SEASONS[0].start + 1000;
    let p = newProgress();
    const r = settleSolitaire(p, at, { won: false, cards: 5 });
    expect(r.reward.xp).toBe(5 * SOLITAIRE_CARD.xp);
    expect(r.reward.pass?.xp).toBe(5 * SOLITAIRE_CARD.season);
    expect(r.progress.solitaire.won).toBe(0);
    p = r.progress;
    const big = settleSolitaire(p, at, { won: false, cards: SOLITAIRE_CARD.perDay });
    expect(big.reward.xp).toBe((SOLITAIRE_CARD.perDay - 5) * SOLITAIRE_CARD.xp);
    p = big.progress;
    expect(settleSolitaire(p, at, { won: false, cards: 3 }).reward.xp).toBe(0);
    const win = settleSolitaire(p, at, { won: true, cards: 10 });
    expect(win.reward.xp).toBe(SOLITAIRE_XP.xp);
    expect(settleSolitaire(p, at + 86_400_000, { won: true, cards: 52 }).reward.xp).toBe(SOLITAIRE_XP.xp + 52 * SOLITAIRE_CARD.xp);
    expect(solFound(dealKlondike(1))).toBe(0);
  });
});
