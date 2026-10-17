// Sudoku: a 9x9 puzzle generated from a seed, always with exactly one solution. The difficulty is set by
// how many clues are left and by which solving techniques it takes (graded by a human-style solver), so a
// Hard puzzle really needs more than singles. The server rebuilds the same puzzle from the seed and replays
// the player's entries against its solution: no result is ever taken from the client.

export type SudokuLevel = "easy" | "medium" | "hard" | "expert";

export const SUDOKU_LEVEL_IDS = ["easy", "medium", "hard", "expert"] as const;

/**
 * clues: dig down to this many givens. grade: the technique tier it must need
 * (1 = singles only, 2 = locked candidates and pairs/triples, 3 = beyond those).
 */
export const SUDOKU_LEVELS: Record<SudokuLevel, { label: string; clues: number; grade: number }> = {
  easy: { label: "Easy", clues: 40, grade: 1 },
  medium: { label: "Medium", clues: 32, grade: 1 },
  hard: { label: "Hard", clues: 27, grade: 2 },
  expert: { label: "Expert", clues: 17, grade: 3 },
};

export function isSudokuLevel(x: unknown): x is SudokuLevel {
  return typeof x === "string" && (SUDOKU_LEVEL_IDS as readonly string[]).includes(x);
}

/** The daily deal is always this level, so everyone solves the same grid. */
export const SUDOKU_DAILY_LEVEL: SudokuLevel = "medium";
/** three wrong digits and the puzzle is lost */
export const SUDOKU_MAX_MISTAKES = 3;
export const SUDOKU_MAX_HINTS = 3;

/** PRNG (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the grid's geometry ------------------------------------------------------------------------

export const sudokuRow = (i: number) => Math.floor(i / 9);
export const sudokuCol = (i: number) => i % 9;
export const sudokuBox = (i: number) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3);

/** the 27 units: 9 rows, 9 columns, 9 boxes */
const UNITS: number[][] = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = Math.floor(b / 3) * 3;
  const c0 = (b % 3) * 3;
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)));
}
/** the 20 cells sharing a row, column or box with each cell */
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set<number>();
  for (const u of UNITS) if (u.includes(i)) for (const j of u) if (j !== i) s.add(j);
  return [...s];
});

export const sudokuPeers = (i: number) => PEERS[i];

const ALL = 0x1ff;
const bit = (d: number) => 1 << (d - 1);
function pop(m: number) {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}
const lowDigit = (m: number) => 31 - Math.clz32(m & -m) + 1;

// ---- exact solver: counts solutions (stops at `limit`) ------------------------------------------

function countSolutions(grid: readonly number[], limit = 2, out?: number[]): number {
  const g = [...grid];
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const b = bit(d);
    const r = sudokuRow(i), c = sudokuCol(i), x = sudokuBox(i);
    if (rows[r] & b || cols[c] & b || boxes[x] & b) return 0;
    rows[r] |= b;
    cols[c] |= b;
    boxes[x] |= b;
  }
  let found = 0;
  const go = (): boolean => {
    // most constrained empty cell first
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[sudokuRow(i)] | cols[sudokuCol(i)] | boxes[sudokuBox(i)]);
      const n = pop(m);
      if (n < bestCount) {
        best = i;
        bestMask = m;
        bestCount = n;
        if (n <= 1) break;
      }
    }
    if (best < 0) {
      found++;
      if (out && found === 1) for (let i = 0; i < 81; i++) out[i] = g[i];
      return found >= limit;
    }
    if (!bestMask) return false;
    const r = sudokuRow(best), c = sudokuCol(best), x = sudokuBox(best);
    let m = bestMask;
    while (m) {
      const b = m & -m;
      m &= m - 1;
      g[best] = lowDigit(b);
      rows[r] |= b;
      cols[c] |= b;
      boxes[x] |= b;
      if (go()) return true;
      rows[r] &= ~b;
      cols[c] &= ~b;
      boxes[x] &= ~b;
    }
    g[best] = 0;
    return false;
  };
  go();
  return found;
}

/** Solve a grid (0 = empty). Null when it has no solution. */
export function solveSudoku(grid: readonly number[]): number[] | null {
  const out = new Array<number>(81).fill(0);
  return countSolutions(grid, 1, out) ? out : null;
}

/** True when the grid has exactly one solution. */
export const sudokuUnique = (grid: readonly number[]) => countSolutions(grid, 2) === 1;

/** A random full, valid grid. */
function fullGrid(r: () => number): number[] {
  const g = new Array<number>(81).fill(0);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const ro = sudokuRow(i), c = sudokuCol(i), x = sudokuBox(i);
    const free = ALL & ~(rows[ro] | cols[c] | boxes[x]);
    const ds: number[] = [];
    for (let d = 1; d <= 9; d++) if (free & bit(d)) ds.push(d);
    for (let k = ds.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [ds[k], ds[j]] = [ds[j], ds[k]];
    }
    for (const d of ds) {
      const b = bit(d);
      g[i] = d;
      rows[ro] |= b;
      cols[c] |= b;
      boxes[x] |= b;
      if (fill(i + 1)) return true;
      rows[ro] &= ~b;
      cols[c] &= ~b;
      boxes[x] &= ~b;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

// ---- human-style grader -------------------------------------------------------------------------

/**
 * Solve the way a person would and report the hardest tier it took: 1 = naked and hidden singles,
 * 2 = also locked candidates (pointing / claiming), naked pairs and triples, hidden pairs,
 * 3 = stuck with all of those (it needs X-wings, chains or guessing).
 */
export function gradeSudoku(puzzle: readonly number[]): number {
  const g = [...puzzle];
  const cand = new Array<number>(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    let m = ALL;
    for (const p of PEERS[i]) if (g[p]) m &= ~bit(g[p]);
    cand[i] = m;
  }
  const place = (i: number, d: number) => {
    g[i] = d;
    cand[i] = 0;
    for (const p of PEERS[i]) cand[p] &= ~bit(d);
  };
  const singles = (): boolean => {
    for (let i = 0; i < 81; i++) {
      if (!g[i] && pop(cand[i]) === 1) {
        place(i, lowDigit(cand[i]));
        return true;
      }
    }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let at = -1;
        let n = 0;
        for (const i of u) {
          if (g[i] === d) {
            n = -1;
            break;
          }
          if (!g[i] && cand[i] & b) {
            at = i;
            n++;
          }
        }
        if (n === 1) {
          place(at, d);
          return true;
        }
      }
    }
    return false;
  };
  const strip = (cells: number[], mask: number): boolean => {
    let changed = false;
    for (const i of cells) {
      if (!g[i] && cand[i] & mask) {
        cand[i] &= ~mask;
        changed = true;
      }
    }
    return changed;
  };
  const tier2 = (): boolean => {
    // locked candidates: a digit confined to one line inside a box (or one box inside a line)
    for (let a = 0; a < 27; a++) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        const where = UNITS[a].filter((i) => !g[i] && cand[i] & b);
        if (where.length < 2) continue;
        for (let o = 0; o < 27; o++) {
          if (o === a) continue;
          if (where.every((i) => UNITS[o].includes(i))) {
            if (strip(UNITS[o].filter((i) => !where.includes(i)), b)) return true;
          }
        }
      }
    }
    for (const u of UNITS) {
      const open = u.filter((i) => !g[i]);
      // naked pairs and triples
      for (let x = 0; x < open.length; x++) {
        for (let y = x + 1; y < open.length; y++) {
          const m2 = cand[open[x]] | cand[open[y]];
          if (pop(m2) === 2 && strip(open.filter((i) => i !== open[x] && i !== open[y]), m2)) return true;
          for (let z = y + 1; z < open.length; z++) {
            const m3 = m2 | cand[open[z]];
            if (pop(m3) === 3 && strip(open.filter((i) => i !== open[x] && i !== open[y] && i !== open[z]), m3)) return true;
          }
        }
      }
      // hidden pairs
      for (let d1 = 1; d1 <= 9; d1++) {
        const c1 = open.filter((i) => cand[i] & bit(d1));
        if (c1.length !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const c2 = open.filter((i) => cand[i] & bit(d2));
          if (c2.length !== 2 || c2[0] !== c1[0] || c2[1] !== c1[1]) continue;
          const keep = bit(d1) | bit(d2);
          let changed = false;
          for (const i of c1) {
            if (cand[i] & ~keep) {
              cand[i] &= keep;
              changed = true;
            }
          }
          if (changed) return true;
        }
      }
    }
    return false;
  };
  let tier = 1;
  for (;;) {
    if (g.every((v) => v)) return tier;
    if (singles()) continue;
    if (tier2()) {
      tier = 2;
      continue;
    }
    return 3;
  }
}

// ---- the generator ------------------------------------------------------------------------------

export interface SudokuPuzzle {
  level: SudokuLevel;
  /** the givens (0 = empty) */
  puzzle: number[];
  solution: number[];
  clues: number;
  grade: number;
}

/** Remove clues (in mirrored pairs where it can) while the answer stays unique, down to `target`. */
function dig(full: number[], r: () => number, target: number): number[] {
  const g = [...full];
  const order = Array.from({ length: 41 }, (_, i) => i);
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  let clues = 81;
  for (const i of order) {
    if (clues <= target) break;
    const j = 80 - i;
    const pair = i === j ? [i] : [i, j];
    if (clues - pair.length < target) continue;
    const keep = pair.map((c) => g[c]);
    for (const c of pair) g[c] = 0;
    if (sudokuUnique(g)) clues -= pair.length;
    else pair.forEach((c, k) => (g[c] = keep[k]));
  }
  // single cells, to get past what the mirrored pairs could reach
  if (clues > target) {
    const singles = Array.from({ length: 81 }, (_, i) => i).filter((i) => g[i]);
    for (let k = singles.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [singles[k], singles[j]] = [singles[j], singles[k]];
    }
    for (const i of singles) {
      if (clues <= target) break;
      const keep = g[i];
      g[i] = 0;
      if (sudokuUnique(g)) clues--;
      else g[i] = keep;
    }
  }
  return g;
}

const ATTEMPTS = 24;
const cache = new Map<string, SudokuPuzzle>();

/**
 * The puzzle for a seed and level. Always unique; tries a run of seeded candidates until one needs exactly
 * the level's techniques (Expert: at least tier 3 if one turns up, else the hardest found), so the same
 * seed and level always give the same puzzle on the server and in the browser.
 */
export function generateSudoku(seed: number, level: SudokuLevel = "easy"): SudokuPuzzle {
  const lv = isSudokuLevel(level) ? level : "easy";
  const key = `${seed >>> 0}:${lv}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const want = SUDOKU_LEVELS[lv];
  let best: SudokuPuzzle | null = null;
  for (let a = 0; a < ATTEMPTS; a++) {
    const r = rng((seed ^ Math.imul(a + 1, 0x85ebca6b) ^ Math.imul(SUDOKU_LEVEL_IDS.indexOf(lv) + 1, 0xc2b2ae35)) >>> 0);
    const solution = fullGrid(r);
    const puzzle = dig(solution, r, want.clues);
    const grade = gradeSudoku(puzzle);
    const clues = puzzle.filter((v) => v).length;
    const cand: SudokuPuzzle = { level: lv, puzzle, solution, clues, grade };
    const score = (p: SudokuPuzzle) => (p.grade === want.grade ? 100 : lv === "expert" ? p.grade * 10 : -Math.abs(p.grade - want.grade) * 10) - Math.abs(p.clues - want.clues);
    if (!best || score(cand) > score(best)) best = cand;
    if (grade === want.grade && (lv === "expert" || clues <= want.clues + 2)) break;
  }
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  cache.set(key, best!);
  return best!;
}

// ---- play ---------------------------------------------------------------------------------------

/** p = place digit d in cell i, e = erase cell i, h = hint (fill cell i, or the first open cell), u = undo the last entry */
export type SudokuMove =
  | { k: "p"; i: number; d: number }
  | { k: "e"; i: number }
  | { k: "h"; i?: number }
  | { k: "u" };

export interface SudokuState {
  level: SudokuLevel;
  givens: number[];
  solution: number[];
  /** what's on the board (givens included); wrong digits stay until erased */
  cells: number[];
  /** cells a hint filled */
  hinted: boolean[];
  mistakes: number;
  hints: number;
  /** what each entry replaced, for undo */
  past: { i: number; was: number }[];
  won: boolean;
  lost: boolean;
}

export function dealSudoku(seed: number, level: SudokuLevel = "easy"): SudokuState {
  const p = generateSudoku(seed, level);
  return {
    level: p.level,
    givens: p.puzzle,
    solution: p.solution,
    cells: [...p.puzzle],
    hinted: new Array<boolean>(81).fill(false),
    mistakes: 0,
    hints: 0,
    past: [],
    won: false,
    lost: false,
  };
}

const okCell = (i: unknown): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < 81;

/** A correct digit in place is locked: only empty or wrong cells take entries. */
export const sudokuOpen = (s: SudokuState, i: number) => !s.givens[i] && s.cells[i] !== s.solution[i];

const solved = (s: SudokuState, cells: number[]) => cells.every((v, i) => v === s.solution[i]);

/** Apply one move. A move that does nothing hands back the same state. */
export function applySudoku(s: SudokuState, m: SudokuMove): SudokuState {
  if (s.won || s.lost || !m || typeof m !== "object") return s;
  if (m.k === "p") {
    if (!okCell(m.i) || !sudokuOpen(s, m.i)) return s;
    const d = m.d;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 9 || s.cells[m.i] === d) return s;
    const cells = [...s.cells];
    cells[m.i] = d;
    const wrong = d !== s.solution[m.i];
    const mistakes = s.mistakes + (wrong ? 1 : 0);
    return {
      ...s,
      cells,
      mistakes,
      past: [...s.past, { i: m.i, was: s.cells[m.i] }],
      won: !wrong && solved(s, cells),
      lost: mistakes >= SUDOKU_MAX_MISTAKES,
    };
  }
  if (m.k === "e") {
    if (!okCell(m.i) || !sudokuOpen(s, m.i) || !s.cells[m.i]) return s;
    const cells = [...s.cells];
    cells[m.i] = 0;
    return { ...s, cells, past: [...s.past, { i: m.i, was: s.cells[m.i] }] };
  }
  if (m.k === "h") {
    if (s.hints >= SUDOKU_MAX_HINTS) return s;
    const i = okCell(m.i) && sudokuOpen(s, m.i) ? m.i : s.cells.findIndex((_, c) => sudokuOpen(s, c));
    if (i < 0) return s;
    const cells = [...s.cells];
    cells[i] = s.solution[i];
    const hinted = [...s.hinted];
    hinted[i] = true;
    return {
      ...s,
      cells,
      hinted,
      hints: s.hints + 1,
      past: [...s.past, { i, was: s.cells[i] }],
      won: solved(s, cells),
    };
  }
  if (m.k === "u") {
    const last = s.past[s.past.length - 1];
    if (!last) return s;
    const cells = [...s.cells];
    cells[last.i] = last.was;
    // mistakes and hints already spent stay spent, and a cell a hint filled never pays (even put back by hand)
    return { ...s, cells, past: s.past.slice(0, -1) };
  }
  return s;
}

/** Digits the player placed correctly themselves (not givens, not hints). */
export const sudokuPlaced = (s: SudokuState) =>
  s.cells.reduce((t, v, i) => t + (!s.givens[i] && !s.hinted[i] && v === s.solution[i] ? 1 : 0), 0);

export interface SudokuTally {
  /** correct digits on the board that the player placed (not givens, not hints) */
  placed: number;
  mistakes: number;
  won: boolean;
  level: SudokuLevel;
}

/** Replay the entries against the seed's solution: what the puzzle earned. */
export function tallySudoku(seed: number, level: SudokuLevel, moves: readonly unknown[]): SudokuTally {
  let s = dealSudoku(seed, level);
  for (const m of moves) {
    if (!m || typeof m !== "object") continue;
    s = applySudoku(s, m as SudokuMove);
    if (s.won || s.lost) break;
  }
  return { placed: sudokuPlaced(s), mistakes: s.mistakes, won: s.won, level: s.level };
}

export const SUDOKU_XP = {
  digit: 2,
  win: { easy: 20, medium: 40, hard: 60, expert: 90 } as Record<SudokuLevel, number>,
};
export const SUDOKU_DAY_XP = 500;
export const SUDOKU_IDLE_S = 45;

export function tallySudokuXp(t: SudokuTally): number {
  return t.placed * SUDOKU_XP.digit + (t.won ? SUDOKU_XP.win[t.level] ?? 0 : 0);
}

export function sudokuGain(paid: SudokuTally | undefined, t: SudokuTally) {
  const p = paid ?? { placed: 0, mistakes: 0, won: false, level: t.level };
  const gained: SudokuTally = {
    placed: Math.max(0, t.placed - p.placed),
    mistakes: t.mistakes,
    won: t.won && !p.won,
    level: t.level,
  };
  return {
    gained,
    paid: { placed: Math.max(t.placed, p.placed), mistakes: Math.max(t.mistakes, p.mistakes), won: t.won || p.won, level: t.level } as SudokuTally,
    any: tallySudokuXp(gained) > 0,
  };
}

export function sudokuPay(paid: SudokuTally | undefined, paidXp: number | undefined, t: SudokuTally, drain: number) {
  const g = sudokuGain(paid, t);
  const before = paidXp ?? tallySudokuXp(paid ?? { placed: 0, mistakes: 0, won: false, level: t.level });
  const pot = Math.max(0, tallySudokuXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
