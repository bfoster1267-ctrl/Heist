import { describe, expect, it } from "vitest";
import {
  applyCheckers, checkersBotMove, checkersGain, checkersHint, checkersMoves, checkersPay, ckSquare, newCheckers,
  replayCheckers, tallyCheckers, tallyCheckersXp, CHECKERS_QUIET_LIMIT, CHECKERS_XP,
  type CheckersLevel, type CheckersPiece, type CheckersState,
} from "../src/checkers";

/** A position with just these pieces on it, red (you) to move unless said otherwise. */
function position(pieces: [row: number, col: number, piece: CheckersPiece][], turn: 1 | -1 = 1): CheckersState {
  const board: CheckersPiece[] = new Array(32).fill(0);
  for (const [r, c, p] of pieces) board[ckSquare(r, c)] = p;
  return { ...newCheckers(), board, turn, seen: {} };
}

/** Bot against bot from the start; returns red's moves (what a player would send) and the final state. */
function botGame(red: CheckersLevel, black: CheckersLevel, seed: number) {
  let s = newCheckers();
  const mine: number[][] = [];
  while (s.winner === null && s.ply < 400) {
    const m = s.turn === 1 ? checkersBotMove(s, red, seed + 1) : checkersBotMove(s, black, seed);
    expect(m).not.toBeNull();
    if (s.turn === 1) mine.push(m!.path);
    s = applyCheckers(s, m!.path);
  }
  return { mine, state: s };
}

describe("Checkers rules", () => {
  it("sets up 12 chips a side with red to move and 7 opening moves", () => {
    const s = newCheckers();
    expect(s.board.filter((p) => p === 1).length).toBe(12);
    expect(s.board.filter((p) => p === -1).length).toBe(12);
    expect(s.turn).toBe(1);
    expect(checkersMoves(s).length).toBe(7);
    expect(checkersMoves(s).every((m) => m.captured.length === 0)).toBe(true);
  });

  it("forces a capture when one is on", () => {
    const s = position([[5, 2, 1], [4, 3, -1], [6, 5, 1], [0, 1, -1]]);
    const ms = checkersMoves(s);
    expect(ms.length).toBe(1);
    expect(ms[0].path).toEqual([ckSquare(5, 2), ckSquare(3, 4)]);
    expect(ms[0].captured).toEqual([ckSquare(4, 3)]);
    // a quiet move is refused while the jump is there
    const quiet = applyCheckers(s, [ckSquare(6, 5), ckSquare(5, 4)]);
    expect(quiet).toBe(s);
  });

  it("chains a multi-jump to the end and removes every jumped chip", () => {
    const s = position([[7, 0, 1], [6, 1, -1], [4, 3, -1], [0, 7, -1]]);
    const ms = checkersMoves(s);
    expect(ms.length).toBe(1);
    expect(ms[0].path).toEqual([ckSquare(7, 0), ckSquare(5, 2), ckSquare(3, 4)]);
    const n = applyCheckers(s, ms[0].path);
    expect(n.board[ckSquare(6, 1)]).toBe(0);
    expect(n.board[ckSquare(4, 3)]).toBe(0);
    expect(n.board[ckSquare(3, 4)]).toBe(1);
    expect(n.taken.red).toBe(2);
    expect(n.quiet).toBe(0);
  });

  it("crowns a man on the far row and ends the jump there", () => {
    // jumping into the king row stops the move even though a king could jump on
    const s = position([[2, 1, 1], [1, 2, -1], [1, 4, -1], [7, 6, -1]]);
    const ms = checkersMoves(s);
    expect(ms.length).toBe(1);
    expect(ms[0].path).toEqual([ckSquare(2, 1), ckSquare(0, 3)]);
    expect(ms[0].crowned).toBe(true);
    const n = applyCheckers(s, ms[0].path);
    expect(n.board[ckSquare(0, 3)]).toBe(2);
    expect(n.board[ckSquare(1, 4)]).toBe(-1);
    expect(n.crowned.red).toBe(1);
  });

  it("lets kings move backwards and men only forwards", () => {
    const k = position([[4, 3, 2], [0, 1, -1]]);
    expect(checkersMoves(k).length).toBe(4);
    const m = position([[4, 3, 1], [0, 1, -1]]);
    expect(checkersMoves(m).length).toBe(2);
    expect(checkersMoves(m).every((x) => x.path[1] < x.path[0])).toBe(true);
  });

  it("wins when the other side has no move left", () => {
    const s = position([[5, 2, 1], [4, 3, -1]]);
    const n = applyCheckers(s, checkersMoves(s)[0].path);
    expect(n.winner).toBe(1);
    expect(checkersMoves(n)).toEqual([]);
  });

  it("draws after 40 moves each without a capture", () => {
    const s = { ...position([[7, 0, 2], [0, 7, -2]]), quiet: CHECKERS_QUIET_LIMIT - 1 };
    const n = applyCheckers(s, checkersMoves(s)[0].path);
    expect(n.winner).toBe(0);
    expect(n.drawReason).toBe("forty");
  });

  it("draws when the same position comes up a third time", () => {
    let s = position([[7, 0, 2], [0, 7, -2]]);
    const cycle = [
      [ckSquare(7, 0), ckSquare(6, 1)],
      [ckSquare(0, 7), ckSquare(1, 6)],
      [ckSquare(6, 1), ckSquare(7, 0)],
      [ckSquare(1, 6), ckSquare(0, 7)],
    ];
    // twice round: every position so far has come up at most twice
    for (let i = 0; i < 8; i++) s = applyCheckers(s, cycle[i % 4]);
    expect(s.winner).toBeNull();
    // the first one again makes three
    s = applyCheckers(s, cycle[0]);
    expect(s.winner).toBe(0);
    expect(s.drawReason).toBe("repetition");
  });
});

describe("Checkers bot", () => {
  it("plays the same move for the same seed, every time", () => {
    for (const lv of ["rookie", "pro", "boss"] as CheckersLevel[]) {
      let s = newCheckers();
      s = applyCheckers(s, checkersMoves(s)[2].path);
      const a = checkersBotMove(s, lv, 777);
      const b = checkersBotMove(s, lv, 777);
      expect(a).not.toBeNull();
      expect(a!.path).toEqual(b!.path);
    }
  });

  it("takes a free piece and a hint never suggests an illegal move", () => {
    const s = position([[3, 2, -1], [4, 3, 1], [7, 0, 1], [0, 1, -1]], -1);
    const m = checkersBotMove(s, "boss", 1);
    expect(m!.captured).toEqual([ckSquare(4, 3)]);
    const h = checkersHint(newCheckers());
    expect(checkersMoves(newCheckers()).some((x) => x.path.join() === h!.path.join())).toBe(true);
  });

  it("replays a whole game to the same result from the player's moves alone", () => {
    for (const [red, black, seed] of [["pro", "rookie", 11], ["rookie", "pro", 23], ["pro", "boss", 5]] as [CheckersLevel, CheckersLevel, number][]) {
      const g = botGame(red, black, seed);
      expect(g.state.winner).not.toBeNull();
      const r = replayCheckers(seed, black, g.mine);
      expect(r.state.board).toEqual(g.state.board);
      expect(r.state.winner).toBe(g.state.winner);
      // with an earlier replay to lean on, it comes out the same
      const again = replayCheckers(seed, black, g.mine, r.plies);
      expect(again.plies).toEqual(r.plies);
      const t = tallyCheckers(seed, black, g.mine);
      expect(t.over).toBe(true);
      expect(t.captures).toBe(g.state.taken.red);
      expect(t.won).toBe(g.state.winner === 1);
    }
  });

  it("searches again when an earlier replay doesn't fit", () => {
    const g = botGame("pro", "rookie", 3);
    const honest = replayCheckers(3, "rookie", g.mine);
    const forged = honest.plies.map((p) => [...p]);
    forged[1] = [99, 98];
    const r = replayCheckers(3, "rookie", g.mine, forged);
    expect(r.plies).toEqual(honest.plies);
  });

  it("rejects an illegal player move", () => {
    expect(() => replayCheckers(1, "rookie", [[ckSquare(5, 0), ckSquare(3, 2)]])).toThrow();
    expect(() => replayCheckers(1, "rookie", ["nope"])).toThrow();
  });

  it("beats a weaker level more often than not", () => {
    let bossWins = 0;
    for (let seed = 1; seed <= 4; seed++) if (botGame("rookie", "boss", seed).state.winner === -1) bossWins++;
    expect(bossWins).toBeGreaterThanOrEqual(3);
  });
});

describe("Checkers XP", () => {
  it("pays captures plus a win bonus by level", () => {
    expect(tallyCheckersXp({ captures: 12, won: true, drawn: false, level: "boss" })).toBe(12 * CHECKERS_XP.capture + CHECKERS_XP.win.boss);
    expect(tallyCheckersXp({ captures: 3, won: false, drawn: false, level: "pro" })).toBe(9);
    expect(CHECKERS_XP.win.rookie).toBeLessThan(CHECKERS_XP.win.pro);
    expect(CHECKERS_XP.win.pro).toBeLessThan(CHECKERS_XP.win.boss);
  });

  it("only pays new captures and one result", () => {
    const first = checkersGain(undefined, { captures: 5, won: false, drawn: false, level: "pro" });
    expect(first.gained.captures).toBe(5);
    const again = checkersGain(first.paid, { captures: 5, won: false, drawn: false, level: "pro" });
    expect(again.any).toBe(false);
    const won = checkersPay(first.paid, undefined, { captures: 7, won: true, drawn: false, level: "pro" }, 0);
    expect(won.gained.captures).toBe(2);
    expect(won.gained.won).toBe(true);
    const twice = checkersPay(won.paid, won.paidXp, { captures: 7, won: true, drawn: false, level: "pro" }, 0);
    expect(twice.xp).toBe(0);
  });
});
