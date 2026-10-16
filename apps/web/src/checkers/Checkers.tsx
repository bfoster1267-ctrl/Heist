// Checkers vs bot: American checkers on a casino-noir board (felt squares, walnut and brass rail),
// poker-chip pieces, sliding moves and arcing jumps, captured chips stacked at the side, a crowning
// moment for kings, legal-move and last-move highlights, a limited undo and a hint.
// You only ever send your own moves: the server replays them against the same seeded bot to check them.

import {
  applyCheckers, checkersBotMove, checkersGain, checkersHint, checkersMoves, checkersRoom, checkersTallyOf,
  ckCol, ckRow, tallyCheckersXp, CHECKERS_DAY_XP, CHECKERS_IDLE_S, CHECKERS_XP,
  getDailyStreak, newCheckers, type CheckersLevel, type CheckersMove, type CheckersState, type CheckersTally,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { markSeen, useReducedMotion, usePrefs } from "../prefs";
import { chip as chipSound, chipRun, click, foundationChime, lose as loseSound, win as winSound } from "../sound";
import { VictoryModal } from "../arcade/VictoryModal";
import "./checkers.css";

/** One position in the game, with a stable id per chip so each chip can slide from square to square. */
interface Frame {
  s: CheckersState;
  /** chip id on each square (0 = empty) */
  ids: number[];
  /** who made the move that led here: 1 you, -1 the bot, 0 the start */
  by: 0 | 1 | -1;
  /** order of play: only the newest move animates (stepping back with undo doesn't replay one) */
  seq: number;
}

interface Float {
  id: number;
  x: number;
  y: number;
  text: string;
}

const LEVELS: { id: CheckersLevel; name: string; blurb: string; icon: string }[] = [
  { id: "rookie", name: "Rookie", blurb: "Learning the ropes. Leaves pieces hanging.", icon: "♟" },
  { id: "pro", name: "Pro", blurb: "Sees a few moves ahead and punishes blunders.", icon: "♞" },
  { id: "boss", name: "Boss", blurb: "The house. Reads deep and never gives a chip away.", icon: "♛" },
];
const LEVEL_NAME: Record<CheckersLevel, string> = { rookie: "Rookie", pro: "Pro", boss: "Boss" };
/** undos per game: the stronger the bot, the fewer take-backs */
const UNDOS: Record<CheckersLevel, number> = { rookie: 5, pro: 3, boss: 1 };
const LEVEL_KEY = "heist.checkers.level";
const HOWTO_SEEN = "checkers.howto";

const SLIDE_S = 0.26;
const HOP_S = 0.3;

let SEQ = 0;

function firstFrame(): Frame {
  const s = newCheckers();
  return { s, ids: s.board.map((p, i) => (p ? i + 1 : 0)), by: 0, seq: ++SEQ };
}

function step(f: Frame, path: readonly number[]): Frame | null {
  const s = applyCheckers(f.s, path);
  if (s === f.s || !s.last) return null;
  const m = s.last;
  const ids = [...f.ids];
  const id = ids[m.path[0]];
  ids[m.path[0]] = 0;
  for (const c of m.captured) ids[c] = 0;
  ids[m.path[m.path.length - 1]] = id;
  return { s, ids, by: f.s.turn, seq: ++SEQ };
}

const isJump = (a: number, b: number) => Math.abs(ckRow(a) - ckRow(b)) === 2;
/** how long a move's animation runs, in seconds */
const moveTime = (m: CheckersMove | null) => (m ? (m.captured.length ? m.captured.length * HOP_S : SLIDE_S) : 0);

function savedLevel(): CheckersLevel | null {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    return v === "rookie" || v === "pro" || v === "boss" ? v : null;
  } catch {
    return null;
  }
}

/** The stage's size, so the board can be as big as the screen allows, upright or sideways. */
function useSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, [ref]);
  return size;
}

export function Checkers({
  onExit,
  onHeist,
  banner,
  initialSeed,
  isDaily = false,
}: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
  initialSeed?: number;
  isDaily?: boolean;
}) {
  const { backend, act, showReward, me } = useAccount();
  const reduce = useReducedMotion();
  const prefs = usePrefs();
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  const [game, setGame] = useState<{ gameId: string | null; seed: number; level: CheckersLevel; daily: boolean } | null>(null);
  const [frames, setFrames] = useState<Frame[]>(() => [firstFrame()]);
  const [moves, setMoves] = useState<number[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<CheckersMove | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [undosUsed, setUndosUsed] = useState(0);
  const [picker, setPicker] = useState(!isDaily);
  const [howto, setHowto] = useState(() => !prefs.seen.includes(HOWTO_SEEN));
  const [armed, setArmed] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const [drain, setDrain] = useState(0);
  const [dealNo, setDealNo] = useState(0);
  const [animSeq, setAnimSeq] = useState(0);
  const floatId = useRef(0);
  const epoch = useRef(0);
  const initialDeal = useRef(true);

  const top = frames[frames.length - 1];
  const s = top.s;
  const over = s.winner !== null;
  const myTurn = s.turn === 1 && !over && !!game && !picker;
  const thinking = s.turn === -1 && !over && !!game;

  // ---- money: bank captures as they come, settle the result at the end -----------------------------
  const best = useRef<CheckersTally>({ captures: 0, won: false, drawn: false, level: "rookie" });
  const banked = useRef(0);
  const finished = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const live = useRef({ game, moves, over });
  live.current = { game, moves, over };

  const send = useCallback((f: () => Promise<unknown>) => {
    queue.current = queue.current.then(f).catch(() => {});
  }, []);

  const bank = useCallback((show: boolean) => {
    const { game: g, moves: ms, over: done } = live.current;
    if (!g?.gameId || done || finished.current) return;
    const xp = Math.max(0, tallyCheckersXp(best.current) - drainRef.current);
    if (xp <= banked.current) return;
    banked.current = xp;
    const id = g.gameId;
    send(async () => {
      const r = await act((x) => x.checkersBank(id, ms, drainRef.current));
      if (r?.reward && (show || r.reward.levelAfter > r.reward.levelBefore)) showReward(r.reward);
    });
  }, [act, showReward, send]);

  const finish = useCallback((ms: number[][]) => {
    const g = live.current.game;
    if (!g?.gameId || finished.current) return;
    finished.current = true;
    const id = g.gameId;
    send(async () => {
      const r = await act((x) => x.checkersFinish(id, ms, drainRef.current));
      if (r?.reward) showReward(r.reward);
    });
  }, [act, showReward, send]);

  useEffect(() => () => bank(true), [bank]);
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") bank(false);
      else lastAct.current = Date.now();
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [bank]);

  // idle on your own turn slowly drains what the game can still pay (like every solo game)
  useEffect(() => {
    if (!myTurn) return;
    lastAct.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - lastAct.current > CHECKERS_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [myTurn]);

  // ---- dealing ------------------------------------------------------------------------------------
  const deal = useCallback(async (level: CheckersLevel) => {
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    bank(false);
    epoch.current++;
    const ep = epoch.current;
    const g = backend ? await backend.checkersStart(firstSeed, dailyFlag, level).catch(() => null) : null;
    if (ep !== epoch.current) return;
    const seed = g ? g.seed : firstSeed ?? Math.floor(Math.random() * 2 ** 31);
    const lv = g ? g.level : dailyFlag ? "pro" : level;
    setGame({ gameId: g?.gameId ?? null, seed, level: lv, daily: dailyFlag });
    setFrames([firstFrame()]);
    setDealNo((n) => n + 1);
    setMoves([]);
    setSelected(null);
    setHint(null);
    setUndosUsed(0);
    setDrain(0);
    setArmed(false);
    best.current = { captures: 0, won: false, drawn: false, level: lv };
    banked.current = 0;
    finished.current = false;
    lastAct.current = Date.now();
    chipRun(8);
    buzz("tap");
  }, [backend, initialSeed, isDaily, bank]);

  useEffect(() => {
    if (isDaily) void deal("pro");
    // the opponent picker opens first otherwise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (lv: CheckersLevel) => {
    click();
    buzz("tap");
    try {
      localStorage.setItem(LEVEL_KEY, lv);
    } catch {
      /* fine without */
    }
    setPicker(false);
    void deal(lv);
  };

  // ---- playing --------------------------------------------------------------------------------------
  const spawnFloat = (sq: number, text: string, delay = 0) => {
    const id = ++floatId.current;
    window.setTimeout(() => {
      setFloats((fs) => [...fs, { id, x: ckCol(sq), y: ckRow(sq), text }]);
      window.setTimeout(() => setFloats((fs) => fs.filter((f) => f.id !== id)), 1300);
    }, delay);
  };

  const moveSounds = (m: CheckersMove, mine: boolean) => {
    const t = moveTime(m) * 1000;
    if (m.captured.length) {
      m.captured.forEach((_, i) => window.setTimeout(() => chipSound(), (i + 0.5) * HOP_S * 1000));
      window.setTimeout(() => chipRun(Math.min(8, 2 + m.captured.length * 2)), t);
      buzz(mine ? "bump" : "tap");
    } else window.setTimeout(() => chipSound(), t * 0.8);
    if (m.crowned) window.setTimeout(() => foundationChime(13), t);
  };

  const ended = (f: Frame, ms: number[][]) => {
    const delay = moveTime(f.s.last) * 1000 + 250;
    window.setTimeout(() => {
      if (f.s.winner === 1) {
        winSound();
        buzz("win");
      } else {
        loseSound();
        buzz("alert");
      }
    }, delay);
    finish(ms);
  };

  const play = (m: CheckersMove) => {
    if (!myTurn || !game) return;
    const f = step(top, m.path);
    if (!f) return;
    lastAct.current = Date.now();
    const ms = [...moves, m.path];
    setFrames((fs) => [...fs, f]);
    setAnimSeq(f.seq);
    setMoves(ms);
    setSelected(null);
    setHint(null);
    setNudge(null);
    moveSounds(m, true);

    const g = checkersGain(best.current, checkersTallyOf(f.s, game.level));
    best.current = g.paid;
    const xp = g.gained.captures * CHECKERS_XP.capture;
    if (xp > 0) m.captured.forEach((c, i) => spawnFloat(c, `+${CHECKERS_XP.capture} XP`, (i + 0.5) * HOP_S * 1000));
    if (m.crowned) spawnFloat(m.path[m.path.length - 1], "KING!", moveTime(m) * 1000);
    live.current = { game, moves: ms, over: f.s.winner !== null };
    if (f.s.winner !== null) ended(f, ms);
    else if (g.any) bank(false);
  };

  // the bot answers once your chip has landed (the search is quick, and the same every time for this seed)
  useEffect(() => {
    if (!thinking || !game) return;
    const ep = epoch.current;
    const from = top;
    const t = window.setTimeout(() => {
      if (ep !== epoch.current) return;
      const m = checkersBotMove(from.s, game.level, game.seed);
      if (!m) return;
      const f = step(from, m.path);
      if (!f || ep !== epoch.current) return;
      setFrames((fs) => (fs[fs.length - 1] === from ? [...fs, f] : fs));
      setAnimSeq(f.seq);
      moveSounds(m, false);
      if (f.s.winner !== null) {
        const g = checkersGain(best.current, checkersTallyOf(f.s, game.level));
        best.current = g.paid;
        live.current = { ...live.current, over: true };
        ended(f, live.current.moves);
      }
    }, moveTime(from.s.last) * 1000 + (reduce ? 120 : 380));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, thinking, game]);

  const legal = useMemo(() => (myTurn ? checkersMoves(s) : []), [s, myTurn]);
  const movable = useMemo(() => new Set(legal.map((m) => m.path[0])), [legal]);
  const forced = legal.length > 0 && legal[0].captured.length > 0;
  // one piece with a jump to make: pick it up for you
  const chosen = selected ?? (forced && movable.size === 1 ? legal[0].path[0] : null);
  const targets = useMemo(() => {
    const out = new Map<number, CheckersMove>();
    if (chosen === null) return out;
    for (const m of legal) {
      if (m.path[0] !== chosen) continue;
      const to = m.path[m.path.length - 1];
      const had = out.get(to);
      if (!had || m.captured.length > had.captured.length) out.set(to, m);
    }
    return out;
  }, [legal, chosen]);
  const via = useMemo(() => {
    const v = new Set<number>();
    for (const m of targets.values()) m.path.slice(1, -1).forEach((q) => v.add(q));
    return v;
  }, [targets]);

  const onSquare = (sq: number) => {
    if (!myTurn) return;
    lastAct.current = Date.now();
    const m = targets.get(sq);
    if (m) {
      play(m);
      return;
    }
    if (movable.has(sq)) {
      click();
      buzz("tap");
      setSelected(sq === selected ? null : sq);
      setNudge(null);
      return;
    }
    if (s.board[sq] > 0) {
      buzz("bump");
      setNudge(forced ? "A jump is on the board: you have to take it." : "That chip is boxed in.");
      window.setTimeout(() => setNudge(null), 2200);
    }
    setSelected(null);
  };

  const undosLeft = game ? Math.max(0, UNDOS[game.level] - undosUsed) : 0;
  const canUndo = !!game && myTurn && moves.length > 0 && undosLeft > 0;
  const onUndo = () => {
    if (!canUndo) return;
    click();
    buzz("tap");
    epoch.current++;
    let i = frames.length - 1;
    while (i > 0 && frames[i].by === -1) i--;
    if (i > 0) i--;
    setFrames(frames.slice(0, i + 1));
    setMoves((ms) => ms.slice(0, -1));
    setUndosUsed((u) => u + 1);
    setSelected(null);
    setHint(null);
  };

  const onHint = () => {
    if (!myTurn) return;
    click();
    buzz("tap");
    const h = checkersHint(s);
    setHint(h);
    setSelected(h ? h.path[0] : null);
    window.setTimeout(() => setHint((x) => (x === h ? null : x)), 2600);
  };

  // ---- layout -----------------------------------------------------------------------------------------
  const stage = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(stage);
  const wide = w > h * 1.12;
  const trayW = wide ? Math.round(Math.min(130, Math.max(74, w * 0.14))) : 0;
  const trayH = wide ? 0 : Math.round(Math.min(78, Math.max(56, h * 0.09)));
  const outer = Math.max(220, Math.floor(wide ? Math.min(h - 8, w - 2 * trayW - 24) : Math.min(w - 8, h - 2 * trayH - 20)));
  const rail = Math.max(8, Math.round(outer * 0.035));
  const cell = Math.floor((outer - 2 * rail) / 8);
  const boardPx = cell * 8;
  const chipPx = Math.round(cell * 0.82);
  const at = (sq: number) => ({ x: ckCol(sq) * cell + (cell - chipPx) / 2, y: ckRow(sq) * cell + (cell - chipPx) / 2 });

  // the move that led here, as keyframes: a slide, or a hop (up and over) per jump
  const fresh = top.seq === animSeq;
  const moving = useMemo(() => {
    const m = s.last;
    if (!m || reduce || !fresh) return null;
    const pts = m.path.map(at);
    const xs = [pts[0].x];
    const ys = [pts[0].y];
    const sc = [1];
    const lift = cell * 0.45;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (isJump(m.path[i - 1], m.path[i])) {
        xs.push((a.x + b.x) / 2);
        ys.push((a.y + b.y) / 2 - lift);
        sc.push(1.22);
      } else {
        xs.push((a.x + b.x) / 2);
        ys.push((a.y + b.y) / 2);
        sc.push(1.06);
      }
      xs.push(b.x);
      ys.push(b.y);
      sc.push(1);
    }
    return { id: top.ids[m.path[m.path.length - 1]], x: xs, y: ys, scale: sc, duration: moveTime(m), crowned: m.crowned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, cell, chipPx, reduce, fresh]);

  // chips jumped by the last move: they burst off the board as the jumper passes
  const prev = frames.length > 1 ? frames[frames.length - 2] : null;
  const ghosts = s.last && prev && fresh ? s.last.captured.map((sq, i) => ({ sq, id: prev.ids[sq], color: prev.s.board[sq], i })) : [];

  const redTaken = s.taken.red; // black chips you took
  const blackTaken = s.taken.black; // your red chips the bot took
  const tally = game ? checkersTallyOf(s, game.level) : null;
  const xpNow = tally ? Math.max(0, tallyCheckersXp(best.current) - drain) : 0;
  const room = me ? checkersRoom(me.progress, Date.now()) : CHECKERS_DAY_XP;
  const level = game?.level ?? savedLevel() ?? "rookie";

  const status = over
    ? s.winner === 1 ? "You win!" : s.winner === -1 ? "The house wins" : "Draw"
    : !game ? "Pick your opponent"
    : thinking ? `${LEVEL_NAME[level]} bot is thinking`
    : forced ? "Jump is forced" : "Your move";

  const kingFx = s.last?.crowned && !reduce && fresh ? { sq: s.last.path[s.last.path.length - 1], delay: moveTime(s.last), key: frames.length } : null;

  return (
    <div className={`ck ${wide ? "wide" : "tall"}`}>
      <div className="ck-felt felt-inner" />
      <div className="ck-vignette" />

      <header className="ck-bar">
        <button className="ck-icon-btn" onClick={() => { click(); buzz("tap"); onExit(); }} title="Leave Checkers" aria-label="Back to the lobby">
          <Icon d="M15 19l-7-7 7-7" />
        </button>
        <div className="ck-hud">
          <div className="ck-hud-name">
            CHECKERS
            <button type="button" className={`ck-level-chip lv-${level}`} disabled={!!game?.daily} onClick={() => { click(); setPicker(true); }} aria-label="Change opponent">
              {game?.daily ? "DAILY · PRO" : `VS ${LEVEL_NAME[level].toUpperCase()}`}
            </button>
          </div>
          <div className="ck-hud-stats">
            <span className={`ck-status ${thinking ? "busy" : ""} ${forced && myTurn ? "forced" : ""}`}>{status}{thinking && <Dots />}</span>
            <span className="ck-dot">•</span>
            <b className="ck-xp">+{xpNow} XP</b>
            <span className="ck-dot hide-narrow">•</span>
            <span className="hide-narrow">{room} XP left today</span>
            <span className="ck-dot">•</span>
            <span className="arcade-streak-pill">{streak > 0 ? `🔥 ${streak}d` : "🔥 Day 1"}</span>
          </div>
        </div>
        <button className="ck-icon-btn" onClick={onHint} disabled={!myTurn} title="Hint" aria-label="Hint">
          <Icon d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 001 1h6a1 1 0 001-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 00-7-7zm-2 18a1 1 0 001 1h2a1 1 0 001-1v-1h-4v1z" />
        </button>
        <button className="ck-icon-btn ck-undo" onClick={onUndo} disabled={!canUndo} title={`Undo (${undosLeft} left)`} aria-label={`Undo, ${undosLeft} left`}>
          <Icon d="M3 10h10a5 5 0 015 5v2m-15-7l4-4m-4 4l4 4" />
          {game && <span className="ck-badge">{undosLeft}</span>}
        </button>
        <button
          className={`ck-icon-btn ${armed ? "armed" : ""}`}
          onClick={() => {
            click();
            buzz("tap");
            if (!game || over || moves.length === 0 || armed) {
              setArmed(false);
              if (game?.daily && !over) void deal("pro");
              else setPicker(true);
            } else {
              setArmed(true);
              window.setTimeout(() => setArmed(false), 2600);
            }
          }}
          title={armed ? "Resign and start again?" : "New game"}
          aria-label={armed ? "Confirm new game" : "New game"}
        >
          {armed ? <span className="ck-sure">NEW?</span> : <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
        </button>
      </header>

      {banner && <div className="ck-banner">{banner}</div>}

      <div className="ck-stage" ref={stage} style={banner ? { top: "calc(env(safe-area-inset-top) + 100px)" } : undefined}>
        <Tray side="bot" taken={blackTaken} label={`${LEVEL_NAME[level]} bot`} thinking={thinking} wide={wide} size={wide ? trayW : trayH} span={outer} />

        <div className="ck-table" style={{ width: outer, height: outer }}>
          <div className="ck-rail" style={{ padding: rail, borderRadius: Math.round(rail * 1.4) }}>
            <div className="ck-board" style={{ width: boardPx, height: boardPx }}>
              {Array.from({ length: 64 }, (_, i) => {
                const r = i >> 3;
                const c = i & 7;
                const dark = (r + c) % 2 === 1;
                if (!dark) return <div key={i} className="ck-sq light" style={{ left: c * cell, top: r * cell, width: cell, height: cell }} />;
                const sq = r * 4 + (c >> 1);
                const last = s.last && (s.last.path[0] === sq || s.last.path[s.last.path.length - 1] === sq);
                const target = targets.has(sq);
                const hinted = hint && (hint.path[0] === sq || hint.path[hint.path.length - 1] === sq);
                const can = myTurn && movable.has(sq) && chosen === null;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`ck-sq dark ${last ? "last" : ""} ${chosen === sq ? "sel" : ""} ${can ? "can" : ""} ${hinted ? "hinted" : ""}`}
                    style={{ left: c * cell, top: r * cell, width: cell, height: cell }}
                    onClick={() => onSquare(sq)}
                    aria-label={`Square ${sq + 1}${s.board[sq] ? (s.board[sq] > 0 ? ", your chip" : ", bot chip") : ""}${target ? ", move here" : ""}`}
                  >
                    {target && <span className={`ck-target ${targets.get(sq)!.captured.length ? "jump" : ""}`} />}
                    {via.has(sq) && <span className="ck-via" />}
                  </button>
                );
              })}

              {s.board.map((p, sq) => {
                if (!p) return null;
                const id = top.ids[sq];
                const pos = at(sq);
                const mv = moving && moving.id === id ? moving : null;
                return (
                  <motion.div
                    key={`${dealNo}-${id}`}
                    className={`ck-piece ${chosen === sq ? "lifted" : ""} ${myTurn && movable.has(sq) && chosen === null ? "can" : ""}`}
                    style={{ width: chipPx, height: chipPx, fontSize: Math.round(chipPx * 0.32), zIndex: mv ? 30 : chosen === sq ? 20 : 10 }}
                    initial={frames.length === 1 && !reduce ? { x: pos.x, y: pos.y - cell * 1.6, opacity: 0, scale: 1.25 } : false}
                    animate={mv ? { x: mv.x, y: mv.y, scale: mv.scale, opacity: 1 } : { x: pos.x, y: pos.y, scale: 1, opacity: 1 }}
                    transition={
                      mv
                        ? { duration: mv.duration, ease: "easeInOut" }
                        : frames.length === 1
                        ? { type: "spring", stiffness: 380, damping: 26, delay: (sq % 12) * 0.03 + (p < 0 ? 0 : 0.18) }
                        : { type: "spring", stiffness: 420, damping: 32 }
                    }
                    onClick={() => onSquare(sq)}
                  >
                    <Chip color={p > 0 ? "red" : "black"} king={p === 2 || p === -2} flip={!!(mv && mv.crowned)} flipDelay={mv ? mv.duration : 0} />
                  </motion.div>
                );
              })}

              <AnimatePresence>
                {ghosts.map((g) => {
                  const pos = at(g.sq);
                  return (
                    <motion.div
                      key={`ghost-${frames.length}-${g.id}`}
                      className="ck-piece ghost"
                      style={{ width: chipPx, height: chipPx, fontSize: Math.round(chipPx * 0.32), zIndex: 25 }}
                      initial={{ x: pos.x, y: pos.y, opacity: 1, scale: 1, rotate: 0 }}
                      animate={reduce ? { x: pos.x, y: pos.y, opacity: 0 } : { x: pos.x, y: pos.y - cell * 0.5, opacity: 0, scale: 0.35, rotate: g.color > 0 ? -160 : 160 }}
                      transition={{ duration: 0.38, delay: reduce ? 0 : (g.i + 0.55) * HOP_S, ease: "easeIn" }}
                    >
                      <Chip color={g.color > 0 ? "red" : "black"} king={g.color === 2 || g.color === -2} />
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {kingFx && (
                <motion.div
                  key={`crown-${kingFx.key}`}
                  className="ck-crown-fx"
                  style={{ left: ckCol(kingFx.sq) * cell, top: ckRow(kingFx.sq) * cell, width: cell, height: cell }}
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: [0, 1, 0], scale: [0.4, 1.9, 2.4] }}
                  transition={{ duration: 0.9, delay: kingFx.delay, times: [0, 0.35, 1] }}
                />
              )}

              <AnimatePresence>
                {floats.map((f) => (
                  <motion.div
                    key={f.id}
                    className={`ck-float ${f.text === "KING!" ? "king" : ""}`}
                    style={{ left: f.x * cell + cell / 2, top: f.y * cell }}
                    initial={{ opacity: 0, y: 6, scale: 0.8 }}
                    animate={{ opacity: 1, y: -cell * 0.6, scale: 1.1 }}
                    exit={{ opacity: 0, y: -cell, scale: 0.9 }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                  >
                    {f.text}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
          <AnimatePresence>
            {nudge && (
              <motion.div className="ck-nudge" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {nudge}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Tray side="you" taken={redTaken} label="You" thinking={false} wide={wide} size={wide ? trayW : trayH} span={outer} />
      </div>

      {/* opponent picker */}
      <AnimatePresence>
        {picker && !howto && (
          <motion.div className="ck-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="ck-panel" initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
              <div className="ck-panel-kicker">HIGH-STAKES CHECKERS</div>
              <h2 className="ck-panel-title">Choose your opponent</h2>
              <div className="ck-levels">
                {LEVELS.map((l) => (
                  <button key={l.id} type="button" className={`ck-level lv-${l.id} ${(game?.level ?? savedLevel()) === l.id ? "on" : ""}`} onClick={() => pick(l.id)}>
                    <span className="ck-level-icon">{l.icon}</span>
                    <span className="ck-level-text">
                      <span className="ck-level-name">{l.name}</span>
                      <span className="ck-level-blurb">{l.blurb}</span>
                    </span>
                    <span className="ck-level-xp">
                      <b>+{CHECKERS_XP.win[l.id]}</b>
                      <small>win XP</small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="ck-panel-foot">+{CHECKERS_XP.capture} XP for every chip you jump · {UNDOS.rookie}/{UNDOS.pro}/{UNDOS.boss} undos</div>
              <div className="ck-panel-row">
                {game && !over ? (
                  <button type="button" className="ck-btn ghost" onClick={() => { click(); setPicker(false); }}>Back to the game</button>
                ) : (
                  <button type="button" className="ck-btn ghost" onClick={() => { click(); onExit(); }}>Lobby</button>
                )}
                <button type="button" className="ck-btn ghost" onClick={() => { click(); setHowto(true); }}>How to play</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* how to play, the first time */}
      <AnimatePresence>
        {howto && (
          <motion.div className="ck-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="ck-panel" initial={{ y: 24 }} animate={{ y: 0 }}>
              <div className="ck-panel-kicker">HOW TO PLAY</div>
              <h2 className="ck-panel-title">Checkers in 30 seconds</h2>
              <ul className="ck-rules">
                <li><Chip color="red" /> <span>You're <b>red</b> and move first. Chips move one square diagonally forward.</span></li>
                <li><span className="ck-rule-icon">⤴</span> <span><b>Jumps are forced.</b> Hop over a bot chip to take it, and keep hopping while you can.</span></li>
                <li><Chip color="red" king /> <span>Reach the far row to be <b>crowned</b>: kings move and jump both ways.</span></li>
                <li><span className="ck-rule-icon">=</span> <span>40 moves each with no capture, or the same position three times, is a <b>draw</b>.</span></li>
              </ul>
              <div className="ck-panel-foot">Tap a glowing chip, then a gold dot. Hint shows a strong move; undo is limited.</div>
              <div className="ck-panel-row">
                <button type="button" className="ck-btn" onClick={() => { click(); markSeen(HOWTO_SEEN); setHowto(false); }}>Got it</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* lost or drawn */}
      <AnimatePresence>
        {over && s.winner !== 1 && !picker && (
          <motion.div className="ck-overlay soft" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: moveTime(s.last) + 0.5 }}>
            <motion.div className="ck-panel" initial={{ y: 30, scale: 0.94 }} animate={{ y: 0, scale: 1 }} transition={{ delay: moveTime(s.last) + 0.5, type: "spring", stiffness: 300, damping: 24 }}>
              <div className="ck-panel-kicker">{s.winner === 0 ? (s.drawReason === "repetition" ? "SAME POSITION THREE TIMES" : "40 MOVES WITHOUT A CAPTURE") : `${LEVEL_NAME[level].toUpperCase()} BOT WINS`}</div>
              <h2 className={`ck-panel-title ${s.winner === 0 ? "" : "lost"}`}>{s.winner === 0 ? "It's a draw" : "The house wins"}</h2>
              <p className="ck-result-sub">
                You jumped <b>{redTaken}</b> {redTaken === 1 ? "chip" : "chips"} and lost <b>{blackTaken}</b>.
                {s.winner === 0 && CHECKERS_XP.draw[level] > 0 ? ` A draw against the ${LEVEL_NAME[level]} bot still pays +${CHECKERS_XP.draw[level]} XP.` : ""}
              </p>
              <div className="ck-panel-row">
                <button type="button" className="ck-btn" onClick={() => { click(); void deal(level); }}>Rematch</button>
                <button type="button" className="ck-btn ghost" onClick={() => { click(); setPicker(true); }}>Change bot</button>
                <button type="button" className="ck-btn ghost" onClick={() => { click(); onExit(); }}>Lobby</button>
              </div>
              {onHeist && (
                <button type="button" className="ck-heist" onClick={() => { click(); onHeist(); }}>
                  Try <b>Heist</b>: the multiplayer card game this table belongs to →
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {over && s.winner === 1 && !picker && (
        <VictoryModal
          game="checkers"
          gameTitle={`Checkers vs ${LEVEL_NAME[level]}`}
          moves={moves.length}
          score={redTaken}
          isDaily={!!game?.daily}
          progress={me?.progress}
          onDealAgain={() => { click(); setPicker(true); }}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}
    </div>
  );
}

/** A poker chip seen from above: striped edge, dashed inlay ring, and a crown once it's a king (two chips high). */
function Chip({ color, king = false, flip = false, flipDelay = 0 }: { color: "red" | "black"; king?: boolean; flip?: boolean; flipDelay?: number }) {
  return (
    <motion.div
      className={`ck-chip ${color} ${king ? "king" : ""}`}
      initial={flip ? { rotateY: 0 } : false}
      animate={flip ? { rotateY: 360 } : undefined}
      transition={flip ? { duration: 0.6, delay: flipDelay, ease: "easeOut" } : undefined}
    >
      <span className="ck-chip-edge" />
      <span className="ck-chip-inlay">
        {king ? (
          <motion.span className="ck-crown" initial={flip ? { opacity: 0, scale: 2.2 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ delay: flipDelay + 0.3, type: "spring", stiffness: 420, damping: 18 }}>
            ♛
          </motion.span>
        ) : (
          <span className="ck-mark">H</span>
        )}
      </span>
      <span className="ck-chip-gloss" />
    </motion.div>
  );
}

/** A player's side: name, and the chips they've taken stacked up like winnings. */
function Tray({ side, taken, label, thinking, wide, size, span }: { side: "bot" | "you"; taken: number; label: string; thinking: boolean; wide: boolean; size: number; span: number }) {
  // the bot's tray holds your red chips; yours holds the black ones you took
  const color = side === "bot" ? "red" : "black";
  const per = 6;
  const stacks = Array.from({ length: Math.ceil(taken / per) }, (_, i) => Math.min(per, taken - i * per));
  return (
    <div className={`ck-tray ${side} ${wide ? "col" : "row"}`} style={wide ? { width: size, maxHeight: span } : { height: size, width: span }}>
      <div className="ck-tray-head">
        <span className={`ck-tray-name ${thinking ? "busy" : ""}`}>{label}{thinking && <Dots />}</span>
        <span className="ck-tray-count">{taken}</span>
      </div>
      <div className="ck-stacks">
        {stacks.map((n, si) => (
          <div key={si} className="ck-stack">
            <AnimatePresence initial={false}>
              {Array.from({ length: n }, (_, i) => (
                <motion.span
                  key={i}
                  className={`ck-stack-chip ${color}`}
                  style={{ bottom: i * 6 }}
                  initial={{ y: -40, opacity: 0, rotate: -8 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 520, damping: 22, delay: 0.25 }}
                />
              ))}
            </AnimatePresence>
          </div>
        ))}
        {taken === 0 && <span className="ck-tray-empty">no chips yet</span>}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="ck-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
