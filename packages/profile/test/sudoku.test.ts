import { describe, expect, it } from "vitest";
import {
  applySudoku, dealSudoku, generateSudoku, gradeSudoku, solveSudoku, sudokuPay, sudokuUnique, tallySudoku, tallySudokuXp,
  SUDOKU_LEVEL_IDS, SUDOKU_LEVELS, SUDOKU_MAX_HINTS, SUDOKU_XP, type SudokuMove,
} from "../src/sudoku";

const valid = (g: number[]) => {
  for (let k = 0; k < 9; k++) {
    const row = new Set<number>(), col = new Set<number>(), box = new Set<number>();
    for (let j = 0; j < 9; j++) {
      row.add(g[k * 9 + j]);
      col.add(g[j * 9 + k]);
      box.add(g[(Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)]);
    }
    if (row.size !== 9 || col.size !== 9 || box.size !== 9 || row.has(0)) return false;
  }
  return true;
};

describe("Sudoku generator", () => {
  it("makes unique puzzles whose solution matches the givens, at every level", () => {
    for (const lv of SUDOKU_LEVEL_IDS) {
      for (let seed = 1; seed <= 6; seed++) {
        const p = generateSudoku(seed * 1013, lv);
        expect(valid(p.solution)).toBe(true);
        expect(sudokuUnique(p.puzzle)).toBe(true);
        expect(solveSudoku(p.puzzle)).toEqual(p.solution);
        p.puzzle.forEach((v, i) => v && expect(v).toBe(p.solution[i]));
        expect(p.clues).toBe(p.puzzle.filter((v) => v).length);
        expect(gradeSudoku(p.puzzle)).toBe(p.grade);
      }
    }
  });

  it("gets harder by level: fewer clues and harder techniques", () => {
    const avg = (lv: (typeof SUDOKU_LEVEL_IDS)[number], f: (p: ReturnType<typeof generateSudoku>) => number) =>
      [1, 2, 3, 4, 5, 6].reduce((t, s) => t + f(generateSudoku(s * 31, lv)), 0) / 6;
    expect(avg("easy", (p) => p.clues)).toBeGreaterThan(avg("medium", (p) => p.clues));
    expect(avg("medium", (p) => p.clues)).toBeGreaterThan(avg("hard", (p) => p.clues));
    expect(avg("hard", (p) => p.clues)).toBeGreaterThan(avg("expert", (p) => p.clues));
    expect(avg("easy", (p) => p.grade)).toBe(SUDOKU_LEVELS.easy.grade);
    expect(avg("hard", (p) => p.grade)).toBeGreaterThanOrEqual(1.5);
    expect(avg("expert", (p) => p.grade)).toBeGreaterThan(2);
  });

  it("is deterministic: the same seed and level always give the same puzzle", () => {
    const a = generateSudoku(777, "hard");
    const b = generateSudoku(777, "hard");
    expect(b.puzzle).toEqual(a.puzzle);
    expect(generateSudoku(778, "hard").puzzle).not.toEqual(a.puzzle);
  });
});

describe("Sudoku play", () => {
  const seed = 4242;

  it("wins by filling every cell right; the replay counts the digits and the mistake", () => {
    for (const lv of SUDOKU_LEVEL_IDS) {
      let s = dealSudoku(seed, lv);
      const open = s.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      const moves: SudokuMove[] = [{ k: "p", i: open[0], d: (s.solution[open[0]] % 9) + 1 }, { k: "u" }, { k: "h" }];
      for (const m of moves) s = applySudoku(s, m);
      expect(s.mistakes).toBe(1);
      expect(s.hints).toBe(1);
      for (const i of open) {
        if (s.cells[i] === s.solution[i]) continue;
        const m: SudokuMove = { k: "p", i, d: s.solution[i] };
        moves.push(m);
        s = applySudoku(s, m);
      }
      expect(s.won).toBe(true);
      const t = tallySudoku(seed, lv, moves);
      expect(t).toEqual({ placed: open.length - 1, mistakes: 1, won: true, level: lv });
      expect(tallySudokuXp(t)).toBe((open.length - 1) * SUDOKU_XP.digit + SUDOKU_XP.win[lv]);
    }
  });

  it("three mistakes lose, and nothing moves after", () => {
    let s = dealSudoku(seed, "easy");
    const open = s.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    for (let k = 0; k < 3; k++) s = applySudoku(s, { k: "p", i: open[k], d: (s.solution[open[k]] % 9) + 1 });
    expect(s.lost).toBe(true);
    expect(applySudoku(s, { k: "p", i: open[5], d: s.solution[open[5]] })).toBe(s);
  });

  it("locks givens and correct digits; erases only wrong ones", () => {
    let s = dealSudoku(seed, "easy");
    const given = s.givens.findIndex((v) => v);
    expect(applySudoku(s, { k: "p", i: given, d: (s.givens[given] % 9) + 1 })).toBe(s);
    const i = s.cells.indexOf(0);
    s = applySudoku(s, { k: "p", i, d: s.solution[i] });
    expect(applySudoku(s, { k: "e", i })).toBe(s);
    expect(applySudoku(s, { k: "p", i, d: (s.solution[i] % 9) + 1 })).toBe(s);
    const j = s.cells.indexOf(0);
    s = applySudoku(s, { k: "p", i: j, d: (s.solution[j] % 9) + 1 });
    s = applySudoku(s, { k: "e", i: j });
    expect(s.cells[j]).toBe(0);
  });

  it("hints are limited and never pay, even undone and re-entered by hand", () => {
    let s = dealSudoku(1, "easy");
    const i = s.cells.indexOf(0);
    const moves: SudokuMove[] = [{ k: "h", i }, { k: "u" }, { k: "p", i, d: s.solution[i] }];
    for (const m of moves) s = applySudoku(s, m);
    expect(tallySudoku(1, "easy", moves).placed).toBe(0);
    let h = dealSudoku(1, "easy");
    for (let k = 0; k < SUDOKU_MAX_HINTS + 2; k++) h = applySudoku(h, { k: "h" });
    expect(h.hints).toBe(SUDOKU_MAX_HINTS);
  });

  it("ignores junk moves from a tampered client", () => {
    const t = tallySudoku(9, "medium", [null, 3, { k: "p", i: 200, d: 1 }, { k: "p", i: 0, d: 12 }, { k: "zz" }, { k: "p", i: 1.5, d: 2 }]);
    expect(t.placed).toBe(0);
    expect(t.won).toBe(false);
  });

  it("never pays the same digits twice", () => {
    const t = { placed: 20, mistakes: 0, won: false, level: "easy" as const };
    const p1 = sudokuPay(undefined, undefined, t, 0);
    expect(p1.xp).toBe(40);
    expect(sudokuPay(p1.paid, p1.paidXp, t, 0).xp).toBe(0);
  });
});
