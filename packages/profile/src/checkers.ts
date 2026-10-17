// Checkers vs bot (American checkers / English draughts, 8x8).
// Forced captures, multi-jumps (a man that's crowned mid-jump stops there), kings move and jump both ways.
// A draw comes after 40 moves each (80 turns) with no capture, or when the same position comes up three times.
// The bot is a plain alpha-beta search with iterative deepening, cut off by a node budget (never the clock),
// so the same seed, level and player moves always give the same bot replies: the server replays whole games.

/** Squares 0-31 are the dark squares, row by row from the bot's back row (row 0) down to yours (row 7). */
export type CheckersSq = number;

/** + is you (red, moves up the board, moves first), - is the bot (black). 1 = man, 2 = king. */
export type CheckersPiece = -2 | -1 | 0 | 1 | 2;

export type CheckersLevel = "rookie" | "pro" | "boss";
export const CHECKERS_LEVELS: readonly CheckersLevel[] = ["rookie", "pro", "boss"];
export const isCheckersLevel = (x: unknown): x is CheckersLevel => x === "rookie" || x === "pro" || x === "boss";

export interface CheckersMove {
  /** the squares the piece stands on, start to finish (a multi-jump lists every landing) */
  path: CheckersSq[];
  /** squares of the pieces jumped, in order */
  captured: CheckersSq[];
  /** a man reached the far row with this move */
  crowned: boolean;
}

export interface CheckersState {
  board: CheckersPiece[];
  /** whose turn: 1 you, -1 the bot */
  turn: 1 | -1;
  /** turns played */
  ply: number;
  /** turns since the last capture (80 = 40 moves each is a draw) */
  quiet: number;
  /** how often each position came up since the last capture or man move */
  seen: Record<string, number>;
  /** pieces each side has taken */
  taken: { red: number; black: number };
  /** kings each side has crowned */
  crowned: { red: number; black: number };
  last: CheckersMove | null;
  /** null while playing, 1 you won, -1 the bot won, 0 draw */
  winner: 1 | -1 | 0 | null;
  drawReason?: "forty" | "repetition";
}

export const CHECKERS_QUIET_LIMIT = 80;

// ---- board geometry -----------------------------------------------------------------------------

export const ckRow = (sq: CheckersSq) => sq >> 2;
export const ckCol = (sq: CheckersSq) => 2 * (sq & 3) + ((sq >> 2) % 2 === 0 ? 1 : 0);
export function ckSquare(row: number, col: number): CheckersSq {
  if (row < 0 || row > 7 || col < 0 || col > 7 || (row + col) % 2 !== 1) return -1;
  return row * 4 + (col >> 1);
}

// directions 0 NW, 1 NE (up the board, your men), 2 SW, 3 SE (down the board, the bot's men)
const DR = [-1, -1, 1, 1];
const DC = [-1, 1, -1, 1];
const STEP = new Int8Array(128);
const JUMP = new Int8Array(128);
for (let sq = 0; sq < 32; sq++) {
  for (let d = 0; d < 4; d++) {
    STEP[sq * 4 + d] = ckSquare(ckRow(sq) + DR[d], ckCol(sq) + DC[d]);
    JUMP[sq * 4 + d] = ckSquare(ckRow(sq) + 2 * DR[d], ckCol(sq) + 2 * DC[d]);
  }
}
const DIRS_KING = [0, 1, 2, 3];
const DIRS_RED = [0, 1];
const DIRS_BLACK = [2, 3];
const dirsFor = (p: number) => (p === 2 || p === -2 ? DIRS_KING : p > 0 ? DIRS_RED : DIRS_BLACK);
const crownRow = (side: number) => (side > 0 ? 0 : 7);

type Board = Int8Array | CheckersPiece[];

// ---- moves --------------------------------------------------------------------------------------

function jumps(b: Board, side: number, from: number, sq: number, piece: number, path: number[], caps: number[], out: CheckersMove[]): boolean {
  let any = false;
  for (const d of dirsFor(piece)) {
    const to = JUMP[sq * 4 + d];
    if (to < 0) continue;
    const mid = STEP[sq * 4 + d];
    if (b[mid] * side >= 0 || caps.includes(mid)) continue;
    if (b[to] !== 0 && to !== from) continue;
    any = true;
    path.push(to);
    caps.push(mid);
    const crowns = (piece === 1 || piece === -1) && ckRow(to) === crownRow(side);
    if (crowns || !jumps(b, side, from, to, piece, path, caps, out)) out.push({ path: [...path], captured: [...caps], crowned: crowns });
    path.pop();
    caps.pop();
  }
  return any;
}

function genMoves(b: Board, side: number): CheckersMove[] {
  const out: CheckersMove[] = [];
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (p * side <= 0) continue;
    jumps(b, side, sq, sq, p, [sq], [], out);
  }
  if (out.length) return out;
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (p * side <= 0) continue;
    for (const d of dirsFor(p)) {
      const to = STEP[sq * 4 + d];
      if (to < 0 || b[to] !== 0) continue;
      out.push({ path: [sq, to], captured: [], crowned: (p === 1 || p === -1) && ckRow(to) === crownRow(side) });
    }
  }
  return out;
}

/** Every legal move for the side to play (captures only, when there's one to make). */
export function checkersMoves(s: CheckersState): CheckersMove[] {
  if (s.winner !== null) return [];
  return genMoves(s.board, s.turn);
}

const keyOf = (b: Board, turn: number) => {
  let k = turn > 0 ? "r" : "b";
  for (let i = 0; i < 32; i++) k += "abcde"[b[i] + 2];
  return k;
};

export function newCheckers(): CheckersState {
  const board: CheckersPiece[] = [];
  for (let sq = 0; sq < 32; sq++) board.push(sq < 12 ? -1 : sq >= 20 ? 1 : 0);
  return {
    board, turn: 1, ply: 0, quiet: 0, seen: { [keyOf(board, 1)]: 1 },
    taken: { red: 0, black: 0 }, crowned: { red: 0, black: 0 }, last: null, winner: null,
  };
}

const samePath = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The legal move with this path, or null. */
export function findCheckersMove(s: CheckersState, path: unknown): CheckersMove | null {
  if (!Array.isArray(path) || path.length < 2 || path.length > 16) return null;
  if (!path.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 32)) return null;
  return checkersMoves(s).find((m) => samePath(m.path, path as number[])) ?? null;
}

/** Play a legal move (from checkersMoves). Returns the same state for anything else. */
export function applyCheckers(s: CheckersState, path: readonly number[]): CheckersState {
  const m = findCheckersMove(s, path);
  if (!m) return s;
  const board = [...s.board];
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  const piece = board[from];
  board[from] = 0;
  for (const c of m.captured) board[c] = 0;
  board[to] = (m.crowned ? 2 * s.turn : piece) as CheckersPiece;
  const turn = (s.turn > 0 ? -1 : 1) as 1 | -1;
  const red = s.turn > 0;
  const capture = m.captured.length > 0;
  const manMove = piece === 1 || piece === -1;
  const key = keyOf(board, turn);
  const seen = capture || manMove ? {} : { ...s.seen };
  seen[key] = (seen[key] ?? 0) + 1;
  const next: CheckersState = {
    board, turn, ply: s.ply + 1, quiet: capture ? 0 : s.quiet + 1, seen,
    taken: { red: s.taken.red + (red ? m.captured.length : 0), black: s.taken.black + (red ? 0 : m.captured.length) },
    crowned: { red: s.crowned.red + (red && m.crowned ? 1 : 0), black: s.crowned.black + (!red && m.crowned ? 1 : 0) },
    last: m, winner: null,
  };
  if (genMoves(board, turn).length === 0) next.winner = s.turn;
  else if (seen[key] >= 3) Object.assign(next, { winner: 0, drawReason: "repetition" });
  else if (next.quiet >= CHECKERS_QUIET_LIMIT) Object.assign(next, { winner: 0, drawReason: "forty" });
  return next;
}

// ---- the bot ------------------------------------------------------------------------------------

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

interface BotSpec {
  /** deepest iteration */
  depth: number;
  /** positions searched per move, at most: the search stops here rather than on the clock, so replays match */
  budget: number;
  /** random +/- points added to each candidate's score (on the bot's first moves only for the Boss) */
  noise: number;
  /** chance of just playing any legal move */
  blunder: number;
}

export const CHECKERS_BOTS: Record<CheckersLevel, BotSpec> = {
  rookie: { depth: 2, budget: 1500, noise: 70, blunder: 0.22 },
  pro: { depth: 6, budget: 12_000, noise: 14, blunder: 0 },
  boss: { depth: 30, budget: 45_000, noise: 0, blunder: 0 },
};
const HINT: BotSpec = { depth: 8, budget: 15_000, noise: 0, blunder: 0 };
const BOSS_OPENING_PLIES = 6;
const BOSS_OPENING_NOISE = 5;

const WIN = 100_000;
const MAN = 100;
const KING = 165;
// a little for holding the middle of the board
const CENTRE = new Int8Array(32);
for (let sq = 0; sq < 32; sq++) {
  const r = ckRow(sq);
  const c = ckCol(sq);
  CENTRE[sq] = (r >= 2 && r <= 5 ? 3 : 0) + (c >= 2 && c <= 5 ? 3 : 0) + (r >= 3 && r <= 4 && c >= 2 && c <= 5 ? 2 : 0);
}

/** Score for red (you); positive is good for red. Whole numbers only, so every machine agrees. */
function evaluate(b: Int8Array): number {
  let v = 0;
  let nR = 0;
  let nB = 0;
  let matR = 0;
  let matB = 0;
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (p === 0) continue;
    const r = sq >> 2;
    if (p === 1) {
      nR++;
      matR += MAN;
      v += (7 - r) * 3 + CENTRE[sq] + (r === 7 ? 6 : 0);
    } else if (p === -1) {
      nB++;
      matB += MAN;
      v -= r * 3 + CENTRE[sq] + (r === 0 ? 6 : 0);
    } else if (p === 2) {
      nR++;
      matR += KING;
      v += CENTRE[sq] * 2;
    } else {
      nB++;
      matB += KING;
      v -= CENTRE[sq] * 2;
    }
  }
  v += matR - matB;
  // ahead on material: trade down (the same lead is worth more with fewer pieces left)
  if (matR !== matB) v += Math.trunc(((matR - matB) * 6) / (nR + nB));
  // late on and ahead: send the kings after what's left instead of shuffling into a 40-move draw
  if (nR + nB <= 8 && matR !== matB) {
    const hunter = matR > matB ? 2 : -2;
    let dist = 0;
    for (let a = 0; a < 32; a++) {
      if (b[a] !== hunter) continue;
      let near = 8;
      for (let t = 0; t < 32; t++) {
        if (b[t] * hunter >= 0) continue;
        const d = Math.max(Math.abs(ckRow(a) - ckRow(t)), Math.abs(ckCol(a) - ckCol(t)));
        if (d < near) near = d;
      }
      dist += near;
    }
    v -= Math.sign(hunter) * dist * 2;
  }
  return v;
}

interface Ctx {
  nodes: number;
  budget: number;
  abort: boolean;
}

function make(b: Int8Array, m: CheckersMove, side: number): number[] {
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  const undo = [b[from]];
  for (const c of m.captured) {
    undo.push(b[c]);
    b[c] = 0;
  }
  b[from] = 0;
  b[to] = m.crowned ? 2 * side : undo[0];
  return undo;
}

function unmake(b: Int8Array, m: CheckersMove, undo: number[]) {
  const from = m.path[0];
  b[m.path[m.path.length - 1]] = 0;
  b[from] = undo[0];
  for (let i = 0; i < m.captured.length; i++) b[m.captured[i]] = undo[i + 1];
}

// longer jumps and crownings first: they're usually best, so the cuts come sooner
const order = (ms: CheckersMove[]) => (ms.length > 1 ? ms.sort((a, b) => b.captured.length - a.captured.length || +b.crowned - +a.crowned) : ms);

function negamax(c: Ctx, b: Int8Array, side: number, depth: number, alpha: number, beta: number, ply: number): number {
  if (++c.nodes > c.budget) {
    c.abort = true;
    return 0;
  }
  const moves = genMoves(b, side);
  if (!moves.length) return -WIN + ply;
  // captures are forced, so a line keeps going past the depth until it goes quiet (the budget still caps it)
  if (depth <= 0 && !moves[0].captured.length) return side * evaluate(b);
  if (ply > 60) return side * evaluate(b);
  let best = -WIN * 2;
  for (const m of order(moves)) {
    const u = make(b, m, side);
    const v = -negamax(c, b, -side, depth - 1, -beta, -alpha, ply + 1);
    unmake(b, m, u);
    if (c.abort) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function search(s: CheckersState, spec: BotSpec, r: () => number, noise: number): CheckersMove | null {
  const moves = order(genMoves(s.board, s.turn));
  if (moves.length <= 1) return moves[0] ?? null;
  if (spec.blunder > 0 && r() < spec.blunder) return moves[Math.floor(r() * moves.length)];
  const jitter = moves.map(() => (noise > 0 ? Math.floor(r() * (2 * noise + 1)) - noise : 0));
  const b = Int8Array.from(s.board);
  const side = s.turn;
  // a move that would make the same position a third time is a draw: worth 0 to either side
  const repeats = moves.map((m) => {
    if (m.captured.length) return false;
    const u = make(b, m, side);
    const k = keyOf(b, -side);
    unmake(b, m, u);
    return (s.seen[k] ?? 0) >= 2;
  });
  const c: Ctx = { nodes: 0, budget: spec.budget, abort: false };
  let rank = moves.map((_, i) => i);
  let chosen = 0;
  for (let depth = 1; depth <= spec.depth; depth++) {
    const scores = new Array<number>(moves.length).fill(-WIN * 2);
    let top = -WIN * 2;
    for (const i of rank) {
      // moves more than twice the noise behind can't win, so they only need a bound
      const alpha = top - 2 * noise - 1;
      let v: number;
      if (repeats[i]) v = 0;
      else {
        const u = make(b, moves[i], side);
        v = -negamax(c, b, -side, depth - 1, -WIN * 2, -alpha, 1);
        unmake(b, moves[i], u);
      }
      if (c.abort) break;
      scores[i] = v;
      if (v > top) top = v;
    }
    if (c.abort) break;
    let pick = rank[0];
    for (const i of rank) if (scores[i] + jitter[i] > scores[pick] + jitter[pick]) pick = i;
    chosen = pick;
    // best first next time round; the rest keep their order (stable sort) so ties go the same way every time
    rank = [...rank].sort((x, y) => scores[y] - scores[x]);
    if (top >= WIN - 200 || top <= -WIN + 200) break;
  }
  return moves[chosen];
}

/** The bot's move in this position (the same every time for the same seed). */
export function checkersBotMove(s: CheckersState, level: CheckersLevel, seed: number): CheckersMove | null {
  if (s.winner !== null) return null;
  const spec = CHECKERS_BOTS[level] ?? CHECKERS_BOTS.pro;
  const r = rng((seed ^ Math.imul(s.ply + 1, 0x9e3779b1)) >>> 0);
  const noise = level === "boss" ? (s.ply < BOSS_OPENING_PLIES ? BOSS_OPENING_NOISE : 0) : spec.noise;
  return search(s, spec, r, noise);
}

/** A good move for whoever's turn it is (the hint button). */
export function checkersHint(s: CheckersState): CheckersMove | null {
  if (s.winner !== null) return null;
  return search(s, HINT, rng(s.ply + 1), 0);
}

// ---- replay, tally and XP -----------------------------------------------------------------------

export interface CheckersReplay {
  state: CheckersState;
  /** every move played, yours and the bot's, as paths */
  plies: number[][];
}

/**
 * Replay a game from your moves: each of yours must be legal, and the bot answers each one exactly as it
 * did in play. `known` is an earlier replay of this game: while the moves match it, its bot replies are
 * reused instead of searched again (they'd come out the same anyway). Throws on an illegal move.
 */
export function replayCheckers(seed: number, level: CheckersLevel, moves: readonly unknown[], known?: readonly (readonly number[])[]): CheckersReplay {
  let s = newCheckers();
  const plies: number[][] = [];
  let onKnown = Array.isArray(known);
  const same = (path: readonly number[]) => {
    if (onKnown && !(known![plies.length] && samePath(known![plies.length], path))) onKnown = false;
  };
  for (const raw of moves) {
    if (s.winner !== null) break;
    const m = findCheckersMove(s, raw);
    if (!m) throw new Error("Illegal checkers move");
    same(m.path);
    s = applyCheckers(s, m.path);
    plies.push(m.path);
    if (s.winner !== null) break;
    const hint = onKnown ? known![plies.length] : undefined;
    const reply = hint && findCheckersMove(s, hint) ? findCheckersMove(s, hint) : checkersBotMove(s, level, seed);
    if (!reply) break;
    same(reply.path);
    s = applyCheckers(s, reply.path);
    plies.push(reply.path);
  }
  return { state: s, plies };
}

export interface CheckersTally {
  /** bot pieces you jumped */
  captures: number;
  won: boolean;
  drawn: boolean;
  level: CheckersLevel;
}

export const checkersTallyOf = (s: CheckersState, level: CheckersLevel): CheckersTally => ({
  captures: s.taken.red,
  won: s.winner === 1,
  drawn: s.winner === 0,
  level,
});

export function tallyCheckers(seed: number, level: CheckersLevel, moves: readonly unknown[]): CheckersTally & { over: boolean } {
  const { state } = replayCheckers(seed, level, moves);
  return { ...checkersTallyOf(state, level), over: state.winner !== null };
}

export const CHECKERS_XP = {
  capture: 3,
  win: { rookie: 15, pro: 60, boss: 120 } as Record<CheckersLevel, number>,
  draw: { rookie: 0, pro: 10, boss: 35 } as Record<CheckersLevel, number>,
};
export const CHECKERS_DAY_XP = 500;
export const CHECKERS_IDLE_S = 30;

const levelOf = (t: { level?: unknown }): CheckersLevel => (isCheckersLevel(t.level) ? t.level : "rookie");

export function tallyCheckersXp(t: CheckersTally): number {
  const lv = levelOf(t);
  return t.captures * CHECKERS_XP.capture + (t.won ? CHECKERS_XP.win[lv] : 0) + (t.drawn ? CHECKERS_XP.draw[lv] : 0);
}

const NONE = (level: CheckersLevel): CheckersTally => ({ captures: 0, won: false, drawn: false, level });

export function checkersGain(paid: CheckersTally | undefined, t: CheckersTally) {
  const p = paid ?? NONE(t.level);
  const gained: CheckersTally = {
    captures: Math.max(0, t.captures - p.captures),
    won: t.won && !p.won,
    // a game ends once: a draw pays only if nothing ended it before
    drawn: t.drawn && !p.drawn && !p.won,
    level: t.level,
  };
  return {
    gained,
    paid: { captures: Math.max(t.captures, p.captures), won: t.won || p.won, drawn: t.drawn || p.drawn, level: t.level },
    any: tallyCheckersXp(gained) > 0,
  };
}

export function checkersPay(paid: CheckersTally | undefined, paidXp: number | undefined, t: CheckersTally, drain: number) {
  const g = checkersGain(paid, t);
  const before = paidXp ?? tallyCheckersXp(paid ?? NONE(t.level));
  const pot = Math.max(0, tallyCheckersXp(g.paid) - Math.max(0, Number.isFinite(drain) ? drain : 0));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
