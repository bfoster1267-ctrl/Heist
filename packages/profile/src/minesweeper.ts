// Minesweeper: the classic Windows grid, dealt from a seed. The mines are laid only after the first
// reveal, from the seed and that first cell, so the first click is always safe (it always opens an area)
// and the server can lay the exact same field when it replays the moves.

export type MinesLevel = "beginner" | "intermediate" | "expert";

export const MINES_LEVELS: Record<MinesLevel, { label: string; rows: number; cols: number; mines: number }> = {
  beginner: { label: "Beginner", rows: 9, cols: 9, mines: 10 },
  intermediate: { label: "Intermediate", rows: 16, cols: 16, mines: 40 },
  expert: { label: "Expert", rows: 16, cols: 30, mines: 99 },
};

export const MINES_LEVEL_IDS = ["beginner", "intermediate", "expert"] as const;

export function isMinesLevel(x: unknown): x is MinesLevel {
  return typeof x === "string" && (MINES_LEVEL_IDS as readonly string[]).includes(x);
}

/** The daily deal is always played on this board, so everyone races the same field. */
export const MINES_DAILY_LEVEL: MinesLevel = "intermediate";

/** r = reveal a cell, f = flag / unflag a cell, c = chord (open around a number whose flags are all placed) */
export type MinesMove = { k: "r"; i: number } | { k: "f"; i: number } | { k: "c"; i: number };

export interface MinesState {
  level: MinesLevel;
  rows: number;
  cols: number;
  mineCount: number;
  seed: number;
  /** null until the first reveal lays the field */
  mines: boolean[] | null;
  /** mines around each cell (all zero until the field is laid) */
  adj: number[];
  revealed: boolean[];
  flagged: boolean[];
  /** the first revealed cell (its opening pays no XP: it's free) */
  first: number | null;
  /** safe cells open, and how many of those the first click opened */
  open: number;
  opening: number;
  /** the mine that went off */
  exploded: number | null;
  lost: boolean;
  won: boolean;
}

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

/** The (up to 8) cells touching cell i. */
export function minesNeighbors(i: number, rows: number, cols: number): number[] {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
    }
  }
  return out;
}

/**
 * Lay the field for a seed once the first reveal is at `safe`: that cell and its neighbours never hold a mine,
 * so the first click always opens an area. Same seed, level and first cell: same field, on any machine.
 */
export function layMines(seed: number, level: MinesLevel, safe: number): boolean[] {
  const { rows, cols, mines } = MINES_LEVELS[level];
  const n = rows * cols;
  const keepOut = new Set([safe, ...minesNeighbors(safe, rows, cols)]);
  const spots: number[] = [];
  for (let i = 0; i < n; i++) if (!keepOut.has(i)) spots.push(i);
  const r = rng((seed ^ Math.imul(safe + 1, 0x9e3779b1)) >>> 0);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const field = new Array<boolean>(n).fill(false);
  for (let k = 0; k < mines && k < spots.length; k++) field[spots[k]] = true;
  return field;
}

/** A fresh, unopened board. */
export function dealMines(seed: number, level: MinesLevel = "beginner"): MinesState {
  const lv = isMinesLevel(level) ? level : "beginner";
  const { rows, cols, mines } = MINES_LEVELS[lv];
  const n = rows * cols;
  return {
    level: lv,
    rows,
    cols,
    mineCount: mines,
    seed,
    mines: null,
    adj: new Array<number>(n).fill(0),
    revealed: new Array<boolean>(n).fill(false),
    flagged: new Array<boolean>(n).fill(false),
    first: null,
    open: 0,
    opening: 0,
    exploded: null,
    lost: false,
    won: false,
  };
}

/** Safe cells on the board (what has to be opened to win). */
export const minesSafeCells = (s: MinesState) => s.rows * s.cols - s.mineCount;

/** Open cells from `starts`, flooding through zeros; flagged cells stay shut. Returns the cells opened, in order. */
function flood(s: MinesState, revealed: boolean[], starts: number[]): number[] {
  const opened: number[] = [];
  const queue = [...starts];
  while (queue.length) {
    const i = queue.shift()!;
    if (revealed[i] || s.flagged[i]) continue;
    revealed[i] = true;
    opened.push(i);
    if (s.mines![i]) continue;
    if (s.adj[i] === 0) {
      for (const nb of minesNeighbors(i, s.rows, s.cols)) if (!revealed[nb] && !s.flagged[nb]) queue.push(nb);
    }
  }
  return opened;
}

const validCell = (s: MinesState, i: unknown): i is number =>
  typeof i === "number" && Number.isInteger(i) && i >= 0 && i < s.rows * s.cols;

/** Apply one move. A move that does nothing hands back the same state. */
export function applyMines(s: MinesState, m: MinesMove): MinesState {
  if (s.won || s.lost || !m || typeof m !== "object" || !validCell(s, m.i)) return s;
  const i = m.i;

  if (m.k === "f") {
    if (s.revealed[i]) return s;
    const flagged = [...s.flagged];
    flagged[i] = !flagged[i];
    return { ...s, flagged };
  }

  let base = s;
  let targets: number[];
  if (m.k === "r") {
    if (s.revealed[i] || s.flagged[i]) return s;
    if (!s.mines) {
      // the first reveal lays the field around it
      const mines = layMines(s.seed, s.level, i);
      const adj = mines.map((_, c) => minesNeighbors(c, s.rows, s.cols).reduce((t, nb) => t + (mines[nb] ? 1 : 0), 0));
      base = { ...s, mines, adj, first: i };
    }
    targets = [i];
  } else if (m.k === "c") {
    if (!s.mines || !s.revealed[i] || s.adj[i] === 0) return s;
    const around = minesNeighbors(i, s.rows, s.cols);
    const flags = around.filter((nb) => s.flagged[nb]).length;
    if (flags !== s.adj[i]) return s;
    targets = around.filter((nb) => !s.revealed[nb] && !s.flagged[nb]);
    if (!targets.length) return s;
  } else {
    return s;
  }

  const revealed = [...base.revealed];
  const opened = flood(base, revealed, targets);
  if (!opened.length) return s;
  const boom = opened.find((c) => base.mines![c]);
  const safeOpened = opened.filter((c) => !base.mines![c]).length;
  const open = base.open + safeOpened;
  const firstMove = base.first === i && s.mines === null;
  const next: MinesState = {
    ...base,
    revealed,
    open,
    opening: firstMove ? safeOpened : base.opening,
  };
  if (boom !== undefined) {
    next.lost = true;
    next.exploded = boom;
    return next;
  }
  if (open >= minesSafeCells(base)) {
    next.won = true;
    // every mine left is flagged for the player, the way the classic game ends
    next.flagged = base.mines!.map((mine, c) => mine || (base.flagged[c] && !revealed[c]));
  }
  return next;
}

/** Mines left to find, by the flags placed (can go negative with too many flags, like the original). */
export const minesLeft = (s: MinesState) => s.mineCount - s.flagged.reduce((t, f, i) => t + (f && !s.revealed[i] ? 1 : 0), 0);

export interface MinesTally {
  /** safe cells opened by the player's own reveals (the free first opening doesn't count) */
  cells: number;
  won: boolean;
  level: MinesLevel;
}

/** Replay the moves from the seed: what the board earned. */
export function tallyMines(seed: number, level: MinesLevel, moves: readonly unknown[]): MinesTally {
  let s = dealMines(seed, level);
  for (const m of moves) {
    if (!m || typeof m !== "object") continue;
    s = applyMines(s, m as MinesMove);
    if (s.won || s.lost) break;
  }
  return { cells: Math.max(0, s.open - s.opening), won: s.won, level: s.level };
}

export const MINES_XP = {
  cell: 1,
  win: { beginner: 10, intermediate: 30, expert: 75 } as Record<MinesLevel, number>,
};
export const MINES_DAY_XP = 500;
export const MINES_IDLE_S = 30;

export function tallyMinesXp(t: MinesTally): number {
  return t.cells * MINES_XP.cell + (t.won ? MINES_XP.win[t.level] ?? 0 : 0);
}

export function minesGain(paid: MinesTally | undefined, t: MinesTally) {
  const p = paid ?? { cells: 0, won: false, level: t.level };
  const gained: MinesTally = {
    cells: Math.max(0, t.cells - p.cells),
    won: t.won && !p.won,
    level: t.level,
  };
  return {
    gained,
    paid: { cells: Math.max(t.cells, p.cells), won: t.won || p.won, level: t.level } as MinesTally,
    any: tallyMinesXp(gained) > 0,
  };
}

export function minesPay(paid: MinesTally | undefined, paidXp: number | undefined, t: MinesTally, drain: number) {
  const g = minesGain(paid, t);
  const before = paidXp ?? tallyMinesXp(paid ?? { cells: 0, won: false, level: t.level });
  const pot = Math.max(0, tallyMinesXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
