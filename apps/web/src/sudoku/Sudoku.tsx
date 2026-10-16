// Sudoku: the combination lock. Ivory givens on a felt-and-gold grid, pencil marks, highlights for the
// same digit, row, column and box, a gold sweep for every row, column or box you complete, and the safe
// swinging open when the grid is done. Three wrong digits lock the safe. The server rebuilds the puzzle
// from the seed and replays every entry (and undo, and hint) against the solution before it pays.

import {
  applySudoku, dealSudoku, getDailyStreak, isSudokuLevel, sudokuBox, sudokuCol, sudokuGain, sudokuOpen, sudokuPeers,
  sudokuPlaced, sudokuRoom, sudokuRow, tallySudokuXp,
  SUDOKU_DAILY_LEVEL, SUDOKU_DAY_XP, SUDOKU_IDLE_S, SUDOKU_LEVELS, SUDOKU_LEVEL_IDS, SUDOKU_MAX_HINTS, SUDOKU_MAX_MISTAKES, SUDOKU_XP,
  type SudokuLevel, type SudokuMove, type SudokuState, type SudokuTally,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { useReducedMotion } from "../prefs";
import { card as cardSound, cardSlam, chip, click, foundationChime, lose as loseSound, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { VictoryModal } from "../arcade/VictoryModal";
import "./sudoku.css";

const LEVEL_KEY = "heist.sudoku.level";
const HOWTO_KEY = "heist.sudoku.howto";
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const bit = (d: number) => 1 << (d - 1);

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

/** One step the undo button can take back: an entry sent to the server (m), and the pencil marks before it. */
interface Step {
  m: boolean;
  notes: number[];
}

function savedLevel(): SudokuLevel {
  try {
    const q = new URLSearchParams(location.search).get("level");
    if (isSudokuLevel(q)) return q;
    const v = localStorage.getItem(LEVEL_KEY);
    return isSudokuLevel(v) ? v : "easy";
  } catch {
    return "easy";
  }
}

const tallyOf = (s: SudokuState): SudokuTally => ({ placed: sudokuPlaced(s), mistakes: s.mistakes, won: s.won, level: s.level });

/** the 27 units, to spot the ones a digit just completed */
const UNITS: number[][] = [];
for (let k = 0; k < 9; k++) {
  UNITS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
  UNITS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
  UNITS.push(Array.from({ length: 81 }, (_, i) => i).filter((i) => sudokuBox(i) === k));
}

/** The free area, measured, so the grid fits any phone, either way up, or a desktop. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    window.addEventListener("orientationchange", read);
    return () => {
      ro?.disconnect();
      window.removeEventListener("orientationchange", read);
    };
  }, []);
  return [ref, box] as const;
}

export function Sudoku({
  onExit,
  onHeist,
  banner,
  initialSeed,
  isDaily = false,
  challengerTime,
  challengerMoves,
  challengerScore,
}: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
  initialSeed?: number;
  isDaily?: boolean;
  challengerTime?: string | null;
  challengerMoves?: number | null;
  challengerScore?: number | null;
}) {
  const { backend, act, showReward, me } = useAccount();
  const reduce = useReducedMotion();
  const initialDeal = useRef(true);
  const [level, setLevel] = useState<SudokuLevel>(() => (isDaily ? SUDOKU_DAILY_LEVEL : savedLevel()));
  const [game, setGame] = useState<{ gameId: string | null; seed: number; level: SudokuLevel; daily: boolean } | null>(null);
  const [s, setS] = useState<SudokuState | null>(null);
  const [moves, setMoves] = useState<SudokuMove[]>([]);
  const [notes, setNotes] = useState<number[]>(() => new Array<number>(81).fill(0));
  const [steps, setSteps] = useState<Step[]>([]);
  const [pencil, setPencil] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [startAt, setStartAt] = useState(Date.now());
  const [endAt, setEndAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sweep, setSweep] = useState<{ id: number; delays: Map<number, number> }>({ id: 0, delays: new Map() });
  const [bad, setBad] = useState<{ i: number; id: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [armed, setArmed] = useState(false);
  const [cracking, setCracking] = useState(false);
  const [victory, setVictory] = useState(false);
  const [lostCard, setLostCard] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [howto, setHowto] = useState(() => {
    try {
      return !localStorage.getItem(HOWTO_KEY);
    } catch {
      return false;
    }
  });
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  const timers = useRef<number[]>([]);
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;
  const [wrapRef, box] = useBox<HTMLDivElement>();
  const cellEls = useRef<(HTMLDivElement | null)[]>([]);

  // ---- banking, as in every arcade game ----------------------------------------------------------------
  const best = useRef<SudokuTally>({ placed: 0, mistakes: 0, won: false, level });
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const banked = useRef(0);
  const live = useRef({ game, moves });
  live.current = { game, moves };
  const dayLeft = useRef(SUDOKU_DAY_XP);

  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    const xp = Math.max(0, tallySudokuXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.sudokuBank(g.gameId!, ms, drainRef.current));
    if (r?.reward && (show || r.reward.levelAfter > r.reward.levelBefore)) showReward(r.reward);
  }, [act, showReward]);

  useEffect(() => () => void bank(true), [bank]);
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") void bank(false);
      else lastAct.current = Date.now();
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [bank]);
  useEffect(() => {
    dayLeft.current = me ? sudokuRoom(me.progress, Date.now()) : SUDOKU_DAY_XP;
  }, [me]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const later = (f: () => void, ms: number) => {
    timers.current.push(window.setTimeout(f, ms));
  };

  const deal = useCallback(async (lv: SudokuLevel, seedAgain?: number) => {
    const firstSeed = initialDeal.current ? initialSeed : seedAgain;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    const g = backend ? await backend.sudokuStart(firstSeed, dailyFlag, lv).catch(() => null) : null;
    const seed = g ? g.seed : (firstSeed ?? Math.floor(Math.random() * 2 ** 31));
    const realLevel = g?.level ?? (dailyFlag ? SUDOKU_DAILY_LEVEL : lv);
    const fresh = dealSudoku(seed, realLevel);
    setLevel(realLevel);
    setGame({ gameId: g?.gameId ?? null, seed, level: realLevel, daily: dailyFlag });
    setS(fresh);
    setMoves([]);
    setNotes(new Array<number>(81).fill(0));
    setSteps([]);
    setPencil(false);
    setSel(fresh.cells.indexOf(0));
    setStartAt(Date.now());
    setEndAt(null);
    setNow(Date.now());
    setSweep({ id: 0, delays: new Map() });
    setBad(null);
    setArmed(false);
    setCracking(false);
    setVictory(false);
    setLostCard(false);
    best.current = { placed: 0, mistakes: 0, won: false, level: realLevel };
    setDrain(0);
    banked.current = 0;
    lastAct.current = Date.now();
    cardSound(3);
    buzz("tap");
  }, [backend, initialSeed, isDaily]);

  useEffect(() => {
    void deal(level);
    // first deal only: later deals come from the buttons
  }, []);

  /** Pay what this puzzle earned, then deal another (or the same seed again). */
  const newPuzzle = useCallback(async (lv: SudokuLevel, seedAgain?: number) => {
    try {
      localStorage.setItem(LEVEL_KEY, lv);
    } catch {
      /* fine without */
    }
    void bank(true);
    await deal(lv, seedAgain);
  }, [bank, deal]);

  const done = !!s && (s.won || s.lost);
  useEffect(() => {
    if (!s || done) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastAct.current > SUDOKU_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [s, done]);

  const spawnFloat = (i: number, xp: number, tag: string | null) => {
    if (xp <= 0 && !tag) return;
    const r = cellEls.current[i]?.getBoundingClientRect();
    if (!r) return;
    const fid = ++floatId.current;
    setFloats((fs) => [...fs, { id: fid, x: r.left + r.width / 2, y: r.top, xp, tag }]);
    later(() => setFloats((fs) => fs.filter((f) => f.id !== fid)), 1400);
  };

  /** Send one entry: applied here at once, replayed by the server when it banks. */
  const play = (m: SudokuMove, prevNotes: number[], nextNotes: number[] = prevNotes) => {
    if (!s || !game || s.won || s.lost) return null;
    lastAct.current = Date.now();
    const next = applySudoku(s, m);
    if (next === s) return null;
    const nextMoves = [...moves, m];
    setS(next);
    setMoves(nextMoves);
    setNotes(nextNotes);
    if (m.k !== "u") setSteps((st) => [...st, { m: true, notes: prevNotes }]);
    const g = sudokuGain(best.current, tallyOf(next));
    best.current = g.paid;
    const xp = Math.min(tallySudokuXp(g.gained) - (g.gained.won ? SUDOKU_XP.win[next.level] : 0), Math.max(0, dayLeft.current));

    if (next.won) {
      setEndAt(Date.now());
      const last = "i" in m && typeof m.i === "number" ? m.i : 40;
      const delays = new Map<number, number>();
      for (let c = 0; c < 81; c++) {
        const d = Math.abs(sudokuRow(c) - sudokuRow(last)) + Math.abs(sudokuCol(c) - sudokuCol(last));
        delays.set(c, reduce ? 0 : d * 45);
      }
      setSweep((sw) => ({ id: sw.id + 1, delays }));
      winSound();
      buzz("win");
      later(() => setCracking(true), reduce ? 100 : 700);
      later(() => {
        setCracking(false);
        setVictory(true);
      }, reduce ? 700 : 2600);
      if (game.gameId) {
        void act((x) => x.sudokuFinish(game.gameId!, nextMoves, drainRef.current)).then((r) => {
          if (r?.reward) showReward(r.reward);
        });
      }
    }
    return { next, xp };
  };

  const placeDigit = (i: number, d: number) => {
    if (!s) return;
    const prev = notes;
    // a right digit clears its own pencil marks and that digit's marks around it
    const right = s.solution[i] === d;
    let nextNotes = prev;
    if (right) {
      nextNotes = [...prev];
      nextNotes[i] = 0;
      for (const p of sudokuPeers(i)) nextNotes[p] &= ~bit(d);
    }
    const r = play({ k: "p", i, d }, prev, nextNotes);
    if (!r) return;
    const { next, xp } = r;
    if (!right) {
      setBad({ i, id: Date.now() });
      cardSlam();
      buzz("alert");
      if (next.lost) {
        setEndAt(Date.now());
        later(() => loseSound(), 250);
        later(() => setLostCard(true), reduce ? 200 : 900);
      }
      return;
    }
    // rows, columns and boxes this digit completed sweep gold
    const completed = UNITS.filter((u) => u.includes(i) && u.every((c) => next.cells[c] === next.solution[c]));
    if (completed.length && !next.won) {
      const delays = new Map<number, number>();
      for (const u of completed) {
        for (const c of u) {
          const dist = Math.abs(sudokuRow(c) - sudokuRow(i)) + Math.abs(sudokuCol(c) - sudokuCol(i));
          delays.set(c, Math.min(delays.get(c) ?? 999, reduce ? 0 : dist * 55));
        }
      }
      setSweep((sw) => ({ id: sw.id + 1, delays }));
      completed.forEach((_, k) => later(() => foundationChime(9 + k * 2), k * 140));
      buzz("bump");
    } else if (!next.won) {
      foundationChime(d);
      buzz("tap");
    }
    spawnFloat(i, xp, completed.length && !next.won ? (completed.length > 1 ? `${completed.length} lines!` : "Line!") : null);
  };

  const toggleNote = (i: number, d: number) => {
    if (!s || !sudokuOpen(s, i) || s.cells[i]) return;
    const prev = notes;
    const next = [...prev];
    next[i] ^= bit(d);
    setNotes(next);
    setSteps((st) => [...st, { m: false, notes: prev }]);
    lastAct.current = Date.now();
    click();
    buzz("tap");
  };

  const input = (d: number) => {
    if (!s || done || sel === null) return;
    if (!sudokuOpen(s, sel)) {
      buzz("tap");
      return;
    }
    if (pencil && !s.cells[sel]) toggleNote(sel, d);
    else placeDigit(sel, d);
  };

  const erase = () => {
    if (!s || done || sel === null || !sudokuOpen(s, sel)) return;
    if (s.cells[sel]) {
      if (play({ k: "e", i: sel }, notes)) {
        chip();
        buzz("tap");
      }
    } else if (notes[sel]) {
      const prev = notes;
      const next = [...prev];
      next[sel] = 0;
      setNotes(next);
      setSteps((st) => [...st, { m: false, notes: prev }]);
      chip();
      buzz("tap");
    }
  };

  const undo = () => {
    if (!s || done || !steps.length) return;
    const last = steps[steps.length - 1];
    setSteps((st) => st.slice(0, -1));
    if (last.m) {
      const next = applySudoku(s, { k: "u" });
      if (next !== s) {
        setS(next);
        setMoves((ms) => [...ms, { k: "u" }]);
      }
    }
    setNotes(last.notes);
    lastAct.current = Date.now();
    cardSound();
    buzz("tap");
  };

  /** A hint fills the open cell with the fewest candidates (or the one selected), and never pays. */
  const hint = () => {
    if (!s || done || s.hints >= SUDOKU_MAX_HINTS) return;
    let target = sel !== null && sudokuOpen(s, sel) ? sel : -1;
    if (target < 0) {
      let fewest = 10;
      for (let c = 0; c < 81; c++) {
        if (!sudokuOpen(s, c)) continue;
        let m = 0x1ff;
        for (const p of sudokuPeers(c)) if (s.cells[p] && s.cells[p] === s.solution[p]) m &= ~bit(s.cells[p]);
        let n = 0;
        for (let x = m; x; x &= x - 1) n++;
        if (n < fewest) {
          fewest = n;
          target = c;
        }
      }
    }
    if (target < 0) return;
    const d = s.solution[target];
    const nextNotes = [...notes];
    nextNotes[target] = 0;
    for (const p of sudokuPeers(target)) nextNotes[p] &= ~bit(d);
    const r = play({ k: "h", i: target }, notes, nextNotes);
    if (!r) return;
    setSel(target);
    foundationChime(13);
    buzz("bump");
    spawnFloat(target, 0, "Hint");
  };

  // keyboard: digits, arrows, erase, P pencil, U/Ctrl+Z undo, H hint
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || picker || howto) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) {
      input(Number(k));
      e.preventDefault();
    } else if (k === "Backspace" || k === "Delete" || k === "0") {
      erase();
      e.preventDefault();
    } else if (k === "p" || k === "P" || k === "n" || k === "N") {
      setPencil((x) => !x);
      click();
    } else if ((k === "z" && (e.ctrlKey || e.metaKey)) || k === "u" || k === "U") {
      undo();
      e.preventDefault();
    } else if (k === "h" || k === "H") {
      hint();
    } else if (k.startsWith("Arrow")) {
      e.preventDefault();
      const cur = sel ?? 40;
      let r = sudokuRow(cur);
      let c = sudokuCol(cur);
      if (k === "ArrowUp") r = (r + 8) % 9;
      if (k === "ArrowDown") r = (r + 1) % 9;
      if (k === "ArrowLeft") c = (c + 8) % 9;
      if (k === "ArrowRight") c = (c + 1) % 9;
      setSel(r * 9 + c);
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // ---- layout -------------------------------------------------------------------------------------------
  const side = Math.max(180, Math.floor(Math.min(box.w, box.h) - 8));
  const elapsed = Math.max(0, Math.floor(((endAt ?? now) - startAt) / 1000));
  const timeStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const currentXp = Math.max(0, tallySudokuXp(s ? tallyOf(s) : best.current) - drain);
  const selVal = s && sel !== null ? s.cells[sel] : 0;
  const counts = DIGITS.map((d) => (s ? s.cells.filter((v, i) => v === d && v === s.solution[i]).length : 0));
  const levelInfo = SUDOKU_LEVELS[level];
  const inProgress = !!s && !done && moves.length > 0;

  const closeHowto = () => {
    setHowto(false);
    click();
    try {
      localStorage.setItem(HOWTO_KEY, "1");
    } catch {
      /* fine without */
    }
  };

  const askNew = () => {
    click();
    buzz("tap");
    if (!inProgress || armed) void newPuzzle(level);
    else {
      setArmed(true);
      later(() => setArmed(false), 3000);
    }
  };

  const cells: ReactNode[] = [];
  if (s) {
    for (let i = 0; i < 81; i++) {
      const v = s.cells[i];
      const given = !!s.givens[i];
      const wrong = !!v && v !== s.solution[i];
      const isSel = sel === i;
      const zone = sel !== null && !isSel && (sudokuRow(i) === sudokuRow(sel) || sudokuCol(i) === sudokuCol(sel) || sudokuBox(i) === sudokuBox(sel));
      const same = !!selVal && v === selVal && !wrong;
      const sweepDelay = sweep.delays.get(i);
      let cls = "su-cell";
      if (given) cls += " given";
      else if (v) cls += wrong ? " wrong" : s.hinted[i] ? " hinted" : " mine";
      if (isSel) cls += " sel";
      else if (same) cls += " same";
      else if (zone) cls += " zone";
      if (sudokuCol(i) % 3 === 2 && sudokuCol(i) < 8) cls += " br";
      if (sudokuRow(i) % 3 === 2 && sudokuRow(i) < 8) cls += " bb";
      const n = notes[i];
      cells.push(
        <div
          key={i}
          ref={(el) => {
            cellEls.current[i] = el;
          }}
          className={cls}
          role="gridcell"
          aria-label={`Row ${sudokuRow(i) + 1} column ${sudokuCol(i) + 1}${v ? `, ${v}` : ", empty"}${wrong ? ", wrong" : ""}`}
          aria-selected={isSel}
          onPointerDown={() => {
            setSel(i);
            lastAct.current = Date.now();
            buzz("tap");
          }}
        >
          {sweepDelay !== undefined && <span key={`sw${sweep.id}`} className="su-sweep" style={{ animationDelay: `${sweepDelay}ms` }} />}
          {v ? (
            <span key={bad && bad.i === i ? `b${bad.id}` : `v${v}`} className={`su-val ${wrong && bad?.i === i ? "shake" : ""}`}>
              {v}
            </span>
          ) : n ? (
            <span className="su-notes">
              {DIGITS.map((d) => (
                <i key={d} className={selVal === d && n & bit(d) ? "hi" : undefined}>
                  {n & bit(d) ? d : ""}
                </i>
              ))}
            </span>
          ) : null}
        </div>,
      );
    }
  }

  return (
    <div className="su" data-level={level}>
      <div className="su-felt-rim" />

      <div className="su-bar">
        <button
          className="su-icon-btn"
          onClick={() => {
            click();
            buzz("tap");
            onExit();
          }}
          title="Exit"
          aria-label="Exit"
        >
          ✕
        </button>
        <div className="su-hud">
          <div className="su-hud-name">
            SUDOKU
            <span className="arcade-trust-pill">✓ Free · No Ads</span>
          </div>
          <div className="su-hud-stats">
            <span>{game?.daily ? "Daily · " : ""}{levelInfo.label}</span>
            <span className="su-dot">•</span>
            <span>{timeStr}</span>
            <span className="su-dot">•</span>
            <b className="su-xp">+{currentXp} XP</b>
            <span className="su-dot">•</span>
            <span className="arcade-streak-pill">{streak > 0 ? `🔥 ${streak}d` : `🔥 Day 1`}</span>
          </div>
        </div>
        <button
          className="su-icon-btn"
          onClick={() => {
            click();
            buzz("tap");
            setPicker(true);
          }}
          title="Difficulty"
          aria-label="Choose difficulty"
        >
          ▦
        </button>
        <button
          className={`su-icon-btn ${armed ? "armed" : ""}`}
          onClick={askNew}
          title={armed ? "Deal a new puzzle?" : "New puzzle"}
          aria-label={armed ? "Confirm new puzzle" : "New puzzle"}
        >
          {armed ? <span className="su-sure">NEW?</span> : "↻"}
        </button>
      </div>

      {banner && <div className="su-banner">{banner}</div>}

      <div className="su-status" style={{ marginTop: banner ? 46 : 0 }}>
        <div className="su-locks" aria-label={`${s?.mistakes ?? 0} of ${SUDOKU_MAX_MISTAKES} mistakes`}>
          <span className="su-status-label">MISTAKES</span>
          {Array.from({ length: SUDOKU_MAX_MISTAKES }, (_, k) => (
            <span key={k} className={`su-pip ${k < (s?.mistakes ?? 0) ? "hit" : ""}`} />
          ))}
        </div>
        <div className="su-status-time">{timeStr}</div>
      </div>

      <div className="su-wrap" ref={wrapRef}>
        {s && (
          <div
            key={`${game?.seed}-${game?.level}`}
            className={`su-grid ${s.won ? "is-won" : ""} ${s.lost ? "is-lost" : ""}`}
            role="grid"
            aria-label={`${levelInfo.label} Sudoku`}
            style={{ width: side, height: side, fontSize: Math.round(side / 9 * 0.56) } as CSSProperties}
          >
            {cells}
          </div>
        )}
      </div>

      <div className="su-pad">
        <div className="su-tools">
          <button className="su-tool" onClick={undo} disabled={!steps.length || done} aria-label="Undo">
            <span className="su-tool-ico">↶</span>
            <small>Undo</small>
          </button>
          <button className="su-tool" onClick={erase} disabled={done} aria-label="Erase">
            <span className="su-tool-ico">⌫</span>
            <small>Erase</small>
          </button>
          <button
            className={`su-tool ${pencil ? "on" : ""}`}
            onClick={() => {
              setPencil((p) => !p);
              click();
              buzz("tap");
            }}
            aria-pressed={pencil}
            aria-label="Pencil marks"
          >
            <span className="su-tool-ico">✎</span>
            <small>Notes {pencil ? "on" : "off"}</small>
          </button>
          <button className="su-tool" onClick={hint} disabled={done || (s?.hints ?? 0) >= SUDOKU_MAX_HINTS} aria-label="Hint">
            <span className="su-tool-ico">💡</span>
            <small>Hint</small>
            <b className="su-badge">{SUDOKU_MAX_HINTS - (s?.hints ?? 0)}</b>
          </button>
        </div>
        <div className={`su-digits ${pencil ? "pencil" : ""}`}>
          {DIGITS.map((d, k) => (
            <button
              key={d}
              className={`su-digit ${counts[k] >= 9 ? "full" : ""} ${selVal === d ? "match" : ""}`}
              onClick={() => input(d)}
              disabled={done || counts[k] >= 9}
              aria-label={`${pencil ? "Note" : "Place"} ${d}`}
            >
              {d}
              <small>{9 - counts[k]}</small>
            </button>
          ))}
        </div>
      </div>

      {/* Floating XP */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="su-float"
            initial={{ opacity: 0, y: f.y + 10, x: f.x, scale: 0.8 }}
            animate={{ opacity: 1, y: f.y - 34, x: f.x, scale: 1.12 }}
            exit={{ opacity: 0, y: f.y - 64, scale: 0.9 }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          >
            {f.xp > 0 && <span>+{f.xp} XP</span>}
            {f.tag && <span className="su-float-tag">{f.tag}</span>}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* The safe opens */}
      <AnimatePresence>
        {cracking && (
          <motion.div className="su-crack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="su-crack-dial"
              initial={{ rotate: 0, scale: 0.6 }}
              animate={{ rotate: reduce ? 0 : 540, scale: 1 }}
              transition={{ duration: 1.1, ease: [0.4, 0, 0.2, 1] }}
            >
              {DIGITS.map((d) => (
                <span key={d} style={{ transform: `rotate(${d * 40}deg) translateY(calc(min(54vw, 220px) * -0.4))` }}>
                  {d}
                </span>
              ))}
            </motion.div>
            <motion.div
              className="su-crack-title"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.8, duration: 0.4 }}
            >
              SAFE CRACKED
              <small>{levelInfo.label} · {timeStr} · {s?.mistakes ?? 0} mistakes · +{SUDOKU_XP.win[level]} XP solve bonus</small>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Three strikes */}
      <AnimatePresence>
        {lostCard && s?.lost && (
          <motion.div
            className="su-lost"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <div className="su-lost-title">SAFE LOCKED</div>
            <div className="su-lost-sub">
              Three wrong digits tripped the lock. You placed <b>{sudokuPlaced(s)}</b> digits in {timeStr}.
            </div>
            <div className="su-lost-btns">
              <button
                className="su-btn gold"
                onClick={() => {
                  cardSound();
                  buzz("tap");
                  if (game) void newPuzzle(game.level, game.seed);
                }}
              >
                RETRY PUZZLE
              </button>
              <button
                className="su-btn"
                onClick={() => {
                  cardSound();
                  buzz("tap");
                  void newPuzzle(level);
                }}
              >
                NEW PUZZLE
              </button>
              <button
                className="su-btn"
                onClick={() => {
                  click();
                  buzz("tap");
                  setPicker(true);
                }}
              >
                DIFFICULTY
              </button>
              <button
                className="su-btn"
                onClick={() => {
                  click();
                  buzz("tap");
                  onExit();
                }}
              >
                LOBBY
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Difficulty picker */}
      <AnimatePresence>
        {picker && (
          <motion.div className="su-sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPicker(false)}>
            <motion.div
              className="su-sheet"
              initial={{ y: 40, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 40, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Choose a difficulty"
            >
              <div className="su-sheet-title">CHOOSE YOUR LOCK</div>
              {SUDOKU_LEVEL_IDS.map((id, k) => {
                const L = SUDOKU_LEVELS[id];
                return (
                  <button
                    key={id}
                    className={`su-level ${id === level ? "on" : ""}`}
                    onClick={() => {
                      cardSound();
                      buzz("tap");
                      setPicker(false);
                      void newPuzzle(id);
                    }}
                  >
                    <span className="su-level-pips">
                      {SUDOKU_LEVEL_IDS.map((_, j) => (
                        <i key={j} className={j <= k ? "on" : undefined} />
                      ))}
                    </span>
                    <span className="su-level-text">
                      <b>{L.label}</b>
                      <small>
                        {id === "easy" ? "Singles · lots of clues" : id === "medium" ? "Hidden singles · fewer clues" : id === "hard" ? "Pairs & pointing" : "Advanced chains · minimal clues"} · +{SUDOKU_XP.win[id]} XP
                      </small>
                    </span>
                  </button>
                );
              })}
              <button className="su-btn" onClick={() => setPicker(false)}>
                CANCEL
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* How to play, for first-timers */}
      <AnimatePresence>
        {howto && (
          <motion.div className="su-sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeHowto}>
            <motion.div className="su-sheet" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How to play Sudoku">
              <div className="su-sheet-title">HOW TO CRACK IT</div>
              <ul className="su-howto">
                <li>Fill every row, column and 3×3 box with <b>1 to 9</b>, each digit once.</li>
                <li><b>Tap a cell</b>, then a number. Right digits lock in place and pay XP.</li>
                <li>A <b>wrong digit</b> is a mistake. Three mistakes lock the safe.</li>
                <li>Turn on <b>Notes</b> to pencil in candidates for free.</li>
                <li>Stuck? Use one of 3 <b>hints</b> (they don't pay XP), or undo.</li>
              </ul>
              <button className="su-btn gold" onClick={closeHowto}>
                LET'S GO
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {victory && s?.won && (
        <VictoryModal
          game="sudoku"
          gameTitle={`Sudoku ${levelInfo.label}`}
          moves={moves.length}
          time={timeStr}
          score={SUDOKU_MAX_MISTAKES - s.mistakes}
          isDaily={!!game?.daily}
          progress={me?.progress}
          onDealAgain={() => void newPuzzle(level)}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="sudoku"
            gameTitle={`Sudoku ${levelInfo.label}`}
            seed={game.seed}
            level={game.level}
            time={s?.won ? timeStr : undefined}
            moves={s?.won ? moves.length : undefined}
            challengerTime={challengerTime}
            challengerMoves={challengerMoves}
            challengerScore={challengerScore}
            onClose={() => setChallengeOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
