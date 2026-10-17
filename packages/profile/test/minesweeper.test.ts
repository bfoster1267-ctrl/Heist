import { describe, expect, it } from "vitest";
import {
  applyMines, dealMines, layMines, minesLeft, minesNeighbors, minesPay, minesSafeCells, tallyMines, tallyMinesXp,
  MINES_LEVEL_IDS, MINES_LEVELS, MINES_XP, type MinesMove, type MinesState,
} from "../src/minesweeper";

/** Win a board by opening every safe cell (the test can see the mines). */
function clear(seed: number, level: (typeof MINES_LEVEL_IDS)[number], first: number) {
  let s = dealMines(seed, level);
  const moves: MinesMove[] = [{ k: "r", i: first }];
  s = applyMines(s, moves[0]);
  for (let i = 0; i < s.rows * s.cols && !s.won; i++) {
    if (!s.mines![i] && !s.revealed[i]) {
      const m: MinesMove = { k: "r", i };
      moves.push(m);
      s = applyMines(s, m);
    }
  }
  return { s, moves };
}

describe("Minesweeper", () => {
  it("deals the three classic boards", () => {
    expect(MINES_LEVELS.beginner).toMatchObject({ rows: 9, cols: 9, mines: 10 });
    expect(MINES_LEVELS.intermediate).toMatchObject({ rows: 16, cols: 16, mines: 40 });
    expect(MINES_LEVELS.expert).toMatchObject({ rows: 16, cols: 30, mines: 99 });
    const s = dealMines(1, "expert");
    expect(s.revealed.length).toBe(480);
    expect(s.mines).toBeNull();
  });

  it("never puts a mine under or around the first click, and always lays the right number", () => {
    for (const lv of MINES_LEVEL_IDS) {
      for (let seed = 1; seed <= 40; seed++) {
        const { rows, cols, mines } = MINES_LEVELS[lv];
        const first = (seed * 37) % (rows * cols);
        const field = layMines(seed, lv, first);
        expect(field.filter(Boolean).length).toBe(mines);
        expect(field[first]).toBe(false);
        for (const nb of minesNeighbors(first, rows, cols)) expect(field[nb]).toBe(false);
        const s = applyMines(dealMines(seed, lv), { k: "r", i: first });
        expect(s.lost).toBe(false);
        expect(s.adj[first]).toBe(0);
        expect(s.open).toBeGreaterThan(1);
      }
    }
  });

  it("lays the same field for the same seed and first click (so the server can replay it)", () => {
    expect(layMines(99, "expert", 40)).toEqual(layMines(99, "expert", 40));
    expect(layMines(99, "expert", 40)).not.toEqual(layMines(99, "expert", 41));
    expect(layMines(99, "expert", 40)).not.toEqual(layMines(100, "expert", 40));
  });

  it("wins when every safe cell is open, flags the mines, and the replay agrees", () => {
    for (const lv of MINES_LEVEL_IDS) {
      const { s, moves } = clear(7, lv, 0);
      expect(s.won).toBe(true);
      expect(minesLeft(s)).toBe(0);
      const t = tallyMines(7, lv, moves);
      expect(t.won).toBe(true);
      expect(t.cells).toBe(minesSafeCells(s) - s.opening);
      expect(tallyMinesXp(t)).toBe(t.cells * MINES_XP.cell + MINES_XP.win[lv]);
    }
  });

  it("the free first opening pays nothing", () => {
    const t = tallyMines(3, "beginner", [{ k: "r", i: 40 }]);
    expect(t.cells).toBe(0);
  });

  it("loses on a mine, and nothing moves after", () => {
    let s = applyMines(dealMines(5, "beginner"), { k: "r", i: 0 });
    const mine = s.mines!.indexOf(true);
    const flagged = applyMines(s, { k: "f", i: mine });
    expect(applyMines(flagged, { k: "r", i: mine })).toBe(flagged);
    s = applyMines(s, { k: "r", i: mine });
    expect(s.lost).toBe(true);
    expect(s.exploded).toBe(mine);
    expect(applyMines(s, { k: "r", i: 1 })).toBe(s);
  });

  it("chords around a number only once its flags are all placed", () => {
    let s: MinesState = applyMines(dealMines(77, "intermediate"), { k: "r", i: 0 });
    let tested = false;
    for (let i = 0; i < 256 && !tested; i++) {
      if (!s.revealed[i] || s.adj[i] === 0) continue;
      const around = minesNeighbors(i, s.rows, s.cols);
      const shut = around.filter((x) => !s.revealed[x] && !s.mines![x]);
      if (!shut.length) continue;
      expect(applyMines(s, { k: "c", i })).toBe(s);
      for (const x of around) if (s.mines![x]) s = applyMines(s, { k: "f", i: x });
      const c = applyMines(s, { k: "c", i });
      expect(c.lost).toBe(false);
      for (const x of shut) expect(c.revealed[x]).toBe(true);
      tested = true;
    }
    expect(tested).toBe(true);
  });

  it("ignores junk moves from a tampered client", () => {
    const t = tallyMines(1, "beginner", [null, 5, "x", { k: "r", i: -1 }, { k: "r", i: 1e9 }, { k: "z", i: 3 }, { k: "r", i: 2.5 }]);
    expect(t).toEqual({ cells: 0, won: false, level: "beginner" });
  });

  it("never pays the same cells twice", () => {
    const t = { cells: 50, won: false, level: "beginner" as const };
    const p1 = minesPay(undefined, undefined, t, 0);
    expect(p1.xp).toBe(50);
    expect(minesPay(p1.paid, p1.paidXp, t, 0).xp).toBe(0);
    const won = minesPay(p1.paid, p1.paidXp, { ...t, cells: 60, won: true }, 0);
    expect(won.xp).toBe(10 + MINES_XP.win.beginner);
  });
});
