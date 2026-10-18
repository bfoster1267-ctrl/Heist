// FreeCell Solitaire (8 cascades, 4 free cells, 4 foundations).
// Tap a card to send it where it fits, or drag it. Unlimited undo, smart hints, and the
// game finishes itself once all cascades are sorted. Every new move, ace, and finished suit pays
// a little XP and season XP; the server replays the moves first so nothing is paid twice.

import {
  applyFc, autoMoveFc, cardRank, cardRed, cardSuit, dealFreeCell, FC_IDLE_S, fcGain, fcHasMoves, fcPay, fcSolved, fcWon, findFcHint, FREECELL_DAY_XP, freecellRoom, tallyFcXp, tallyFreeCell, tapMoveFc,
  type FcHint, type FcMove, type FcTally, type FreeCellState, type PlayingCard,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, cardSlam, click, foundationChime, isMuted, onSoundChange, setMuted, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { shareDailyResult } from "../daily/shareHelpers";
import { getDailyStreak, getStreakMultiplier } from "@heist/profile";
import { VictoryModal } from "../arcade/VictoryModal";
import "./freecell.css";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: FcTally = { moves: 0, aces: 0, stacks: 0, won: false };
const LAND_SCALE = [1.08, 1];
const SHAKE_ROT = [0, -5, 5, -3, 0];
const WIN_ROT = [0, -6, 6, 0];

type Pile = `c${number}` | `f${number}` | `t${number}`;
interface Drag {
  from: Pile;
  depth: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  moved: boolean;
}

/** Card size and spacing for 8-column FreeCell board */
function useBoard() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const width = Math.min(size.w, 756);
  const gap = Math.max(3, Math.round(width * 0.01));
  const cw = Math.floor((width - gap * 9) / 8);
  const ch = Math.round(cw * 1.42);
  return { width, height: size.h, gap, cw, ch, left: Math.round((size.w - width) / 2) + gap };
}

/** The deal: 52 cards fly out across the 8 columns */
const DEAL = { gather: 280, step: 30, flip: 100 };
const DEAL_MS = DEAL.gather + 52 * DEAL.step + 400;

export function FreeCell({
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
  const initialDeal = useRef(true);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [hist, setHist] = useState<FreeCellState[]>([]);
  const [moves, setMoves] = useState<FcMove[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const [hint, setHint] = useState<FcHint>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [finalTime, setFinalTime] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted);
  useEffect(() => onSoundChange(() => setMutedState(isMuted())), []);
  const b = useBoard();
  const board = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const ready = hist.length > 0;
  useEffect(() => setTop(board.current?.getBoundingClientRect().top ?? 0), [b.height, b.width, ready]);
  const k = hist[hist.length - 1];
  const reduce = reducedMotion();
  const [dealAt, setDealAt] = useState(0);
  const [dealT, setDealT] = useState(0);

  useEffect(() => {
    if (!dealAt) return;
    const t = window.setInterval(() => {
      const e = Date.now() - dealAt;
      setDealT(e);
      if (e > DEAL_MS) setDealAt(0);
    }, 30);
    return () => clearInterval(t);
  }, [dealAt]);

  const [stuckSeen, setStuckSeen] = useState(-1);
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallyFreeCell(game.seed, moves);
    } catch {
      return null;
    }
  }, [game, moves]);

  const best = useRef(NOTHING);
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const pot = (t: FcTally) => Math.max(0, tallyFcXp(t) - drainRef.current);
  const banked = useRef(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  const meNow = useRef(me);
  meNow.current = me;
  const dayLeft = useRef(0);
  const maxedShown = useRef(false);
  const live = useRef({ game, moves });
  live.current = { game, moves };

  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    const xp = Math.max(0, tallyFcXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.freecellBank(g.gameId!, ms, drainRef.current));
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

  const deal = useCallback(async (seedOverride?: number) => {
    await bank(true);
    best.current = NOTHING;
    banked.current = 0;
    drainRef.current = 0;
    setDrain(0);
    setFloats([]);
    const seedToUse = seedOverride ?? (initialDeal.current ? initialSeed : undefined);
    const dailyFlag = initialDeal.current ? isDaily : Boolean(seedOverride && isDaily);
    initialDeal.current = false;
    const g = backend ? await backend.freecellStart(seedToUse, dailyFlag).catch(() => null) : null;
    dayLeft.current = meNow.current ? freecellRoom(meNow.current.progress, Date.now()) : FREECELL_DAY_XP;
    maxedShown.current = false;
    const next = g ?? { gameId: null, seed: seedToUse ?? Math.floor(Math.random() * 2 ** 31) };
    setGame(next);
    setHist([dealFreeCell(next.seed)]);
    setMoves([]);
    setDone(false);
    setHint(null);
    setArmed(false);
    setFinalTime(null);
    setStarted(Date.now());
    lastAct.current = Date.now() + (reduce ? 0 : DEAL_MS);
    setDealT(0);
    setDealAt(reduce ? 0 : Date.now());
    cardSound(4);
  }, [backend, bank, reduce, initialSeed, isDaily]);

  useEffect(() => {
    void deal();
  }, [deal]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stalled = (at: number) =>
    !!game?.gameId && !!k && !done && !dealAt && !fcWon(k) && document.visibilityState === "visible" && at - lastAct.current >= FC_IDLE_S * 1000 && fcHasMoves(k);

  useEffect(() => {
    if (stalled(now)) setDrain((d) => Math.min(d + 1, tallyFcXp(best.current)));
  }, [now]);

  const won = Boolean(k && fcWon(k));
  const secs = started ? Math.floor((now - started) / 1000) : 0;
  const liveClock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const clock = finalTime ?? liveClock;

  useEffect(() => {
    if (won && !finalTime) {
      setFinalTime(liveClock);
    }
  }, [won, finalTime, liveClock]);

  const play = useCallback(
    (m: FcMove) => {
      const n = k && applyFc(k, m);
      if (!n) return false;
      setHist((h) => [...h, n]);
      setMoves((ms) => [...ms, m]);
      setHint(null);
      lastAct.current = Date.now();
      if (m.endsWith(">f")) {
        let rank = 1;
        for (let s = 0; s < 4; s++) {
          if (n.found[s].length > k.found[s].length) {
            const card = n.found[s][n.found[s].length - 1];
            rank = (card % 13) + 1;
            break;
          }
        }
        foundationChime(rank);
        buzz("bump");
      } else {
        cardSound(1);
        buzz("tap");
      }
      return true;
    },
    [k],
  );

  const autoComplete = useCallback(() => {
    if (!k || done || fcWon(k)) return;
    cardSlam();
    buzz("bump");
    let curr = k;
    const newMoves: string[] = [];
    const newHist = [...hist];
    while (!fcWon(curr)) {
      const m = autoMoveFc(curr);
      if (!m) break;
      const next = applyFc(curr, m);
      if (!next) break;
      curr = next;
      newMoves.push(m);
      newHist.push(curr);
    }
    setMoves((prev) => [...prev, ...newMoves]);
    setHist(newHist);
  }, [k, done, hist]);

  // Auto-solve when cascades are sorted or cards can be safely banked
  useEffect(() => {
    if (!k || done || fcWon(k)) return;
    const m = autoMoveFc(k);
    if (!m) return;
    const t = window.setTimeout(() => play(m), reduce ? 20 : 100);
    return () => clearTimeout(t);
  }, [k, done, play, reduce]);

  // A win: the server replays it and pays
  useEffect(() => {
    if (!k || done || !fcWon(k)) return;
    setDone(true);
    winSound();
    buzz("win");
    const id = game?.gameId;
    if (id) void act((x) => x.freecellFinish(id, moves, drainRef.current)).then((r) => r && showReward(r.reward));
  }, [k, done, game, moves, act, showReward]);

  // Cards reaching foundations flash gold
  const prevFound = useRef<Set<number>>(new Set());
  const foundNow = useMemo(() => new Set(k ? k.found.flat() : []), [k]);
  const [landed, setLanded] = useState<Set<number>>(new Set());
  useEffect(() => {
    const p = prevFound.current;
    prevFound.current = foundNow;
    if (!foundNow.size) return;
    setLanded(new Set([...foundNow].filter((c) => !p.has(c))));
    const t = window.setTimeout(() => setLanded(new Set()), 450);
    return () => clearTimeout(t);
  }, [foundNow]);

  const undo = () => {
    if (hist.length < 2 || done) return;
    setHist((h) => h.slice(0, -1));
    setMoves((ms) => ms.slice(0, -1));
    setHint(null);
    lastAct.current = Date.now();
    click();
    buzz("tap");
  };

  const showHint = () => {
    if (!k || done) return;
    const h = findFcHint(k);
    if (!h) return nope("h");
    setHint(h);
    setDrain((d) => Math.min(d + 1, tallyFcXp(best.current)));
    click();
    buzz("tap");
    window.setTimeout(() => setHint((x) => (x === h ? null : x)), 1800);
  };

  const newDeal = () => {
    if (moves.length && !done && !armed) {
      setArmed(true);
      click();
      buzz("tap");
      window.setTimeout(() => setArmed(false), 2500);
      return;
    }
    void deal();
  };

  const nope = (key: string) => {
    setShake(key);
    buzz("tap");
    window.setTimeout(() => setShake(null), 320);
  };

  // Coordinates and layout
  const stripH = banner ? 36 : 0;
  const barH = 52 + stripH;
  const rowY = b.gap * 2 + barH;
  const colX = (i: number) => b.left + i * (b.cw + b.gap);
  const tabY = rowY + b.ch + b.gap * 3;
  const room = b.height - top - tabY - b.gap * 2;

  const offsets = useMemo(() => {
    if (!k) return [];
    return k.cols.map((col) => {
      let up = Math.round(b.ch * 0.28);
      const need = Math.max(0, col.length - 1) * up + b.ch;
      if (need > room && col.length > 1) {
        up = Math.max(Math.round(b.ch * 0.14), Math.floor((room - b.ch) / (col.length - 1)));
      }
      return up;
    });
  }, [k, b.ch, room]);

  // Floating XP animations
  useEffect(() => {
    if (!tally || !k) return;
    const { gained, paid, any } = fcGain(best.current, tally);
    const before = Math.min(pot(best.current), dayLeft.current);
    best.current = paid;
    const xp = Math.min(pot(paid), dayLeft.current) - before;
    const maxed = any && xp < tallyFcXp(gained) && !maxedShown.current;
    if (maxed) maxedShown.current = true;
    if ((!xp && !maxed) || !game?.gameId) return;

    let x = colX(2);
    let y = rowY;
    const last = hist[hist.length - 2];
    const s = last ? k.found.findIndex((f, i) => f.length > last.found[i].length) : -1;
    const to = /t(\d)$|t(\d):/.exec(moves[moves.length - 1] ?? "");
    const toCell = /c(\d)$/.exec(moves[moves.length - 1] ?? "");
    if (s >= 0) {
      x = colX(4 + s);
    } else if (toCell) {
      x = colX(Number(toCell[1]));
    } else if (to) {
      const i = Number(to[1] ?? to[2]);
      const col = k.cols[i];
      x = colX(i);
      y = tabY + Math.max(0, col.length - 1) * offsets[i];
    }
    const tag = maxed ? "MAXED TODAY · HEIST PAYS MORE" : gained.stacks ? "SUIT DONE" : gained.aces ? "ACE" : null;
    const id = ++floatId.current;
    setFloats((f) => [...f.slice(-5), { id, x: x + b.cw / 2, y, xp, tag }]);
    window.setTimeout(() => setFloats((f) => f.filter((q) => q.id !== id)), tag ? 1400 : 900);
  }, [tally]);

  if (!k) return <div className="fc" />;

  type Placed = { c: PlayingCard; x: number; y: number; z: number; pile: Pile; depth: number; land?: number };
  const placed: Placed[] = [];

  // Free cells (indices 0..3 at cols 0..3)
  k.cells.forEach((c, i) => {
    if (c !== null) placed.push({ c, x: colX(i), y: rowY, z: 10, pile: `c${i}`, depth: 1 });
  });

  // Foundations (suits 0..3 at cols 4..7)
  k.found.forEach((f, s) => {
    f.forEach((c, i) => {
      placed.push({ c, x: colX(4 + s), y: rowY, z: i, pile: `f${s}`, depth: f.length - i });
    });
  });

  // Tableau columns (0..7)
  k.cols.forEach((col, i) => {
    let y = tabY;
    col.forEach((c, j) => {
      placed.push({ c, x: colX(i), y, z: j, pile: `t${i}`, depth: col.length - j });
      y += offsets[i];
    });
  });

  // Deal animation: cards fly in across columns
  if (dealAt) {
    for (const p of placed) {
      if (p.pile[0] !== "t") continue;
      const colIdx = Number(p.pile[1]);
      const cardIdx = p.z * 8 + colIdx;
      const at = DEAL.gather + cardIdx * DEAL.step;
      p.land = at;
      if (dealT < at) {
        Object.assign(p, { x: colX(3), y: -b.ch - 20, z: 60 - cardIdx });
      } else if (dealT < at + 260) {
        p.z = 200 + p.z;
      }
    }
  }
  placed.sort((a, b) => a.c - b.c);

  const dragging = (p: Placed) => !!drag && drag.moved && p.pile === drag.from && p.depth <= drag.depth && p.depth > 0;
  const hinted = (p: Placed) => !!hint && p.pile === hint.pile && p.depth > 0 && p.depth <= hint.depth;

  const down = (p: Placed, e: React.PointerEvent) => {
    if (dealAt || done || p.depth < 1) return;
    if (p.pile[0] === "f") return; // foundations don't drag
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ from: p.pile, depth: p.depth, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false });
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 6 });
  };

  const up = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      const m = tapMoveFc(k, d.from as `c${number}` | `t${number}`, d.depth);
      if (!m || !play(m)) nope(`${d.from}:${d.depth}`);
      return;
    }

    // Dropped target based on finger coordinates
    const i = Math.max(0, Math.min(7, Math.floor((e.clientX - b.left + b.gap / 2) / (b.cw + b.gap))));
    const y = e.clientY - top;

    // Top row: cells (0..3) or foundations (4..7)
    if (y < rowY + b.ch + b.gap * 2) {
      if (d.depth > 1) return nope(`${d.from}:${d.depth}`); // Only 1 card can go to top row
      if (i >= 4) {
        // Foundation
        if (!play(`${d.from}>f`)) buzz("tap");
      } else {
        // Cell
        if (!play(`${d.from}>c${i}`)) buzz("tap");
      }
      return;
    }

    // Tableau drop (t0..t7)
    const to = `t${i}`;
    if (d.from === to) return;
    const moveStr = `${d.from}>${to}${d.depth > 1 ? `:${d.depth}` : ""}`;
    if (!play(moveStr)) buzz("tap");
  };

  const isStuck = !done && !dealAt && stuckSeen !== hist.length && !fcHasMoves(k);
  const shownXp = Math.min(pot(best.current), dayLeft.current);
  const draining = stalled(now) && shownXp > 0;
  const small = b.cw < 60;

  return (
    <div className={"fc" + (small ? " fc-small" : "")} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <div className="fc-felt-rim" />
      <div className="fc-board" ref={board}>
        {banner && <div className="fc-banner">{banner}</div>}
        <div className="fc-bar" style={{ height: 52 }}>
          <button className="fc-icon-btn" onClick={() => { click(); buzz("tap"); onExit(); }} aria-label="Back to the lobby">
            <Icon d="M15 5 8 12l7 7" />
          </button>
          <div className="fc-hud">
            <span className="fc-hud-name">
              FREECELL
              <span className="arcade-trust-pill">✓ Free · No Ads</span>
            </span>
            <span className="fc-hud-stats">
              <b>{moves.length}</b> moves <span className="fc-dot">·</span> <b>{clock}</b>
              {game?.gameId && (shownXp > 0 || drain > 0) && (
                <>
                  {" "}<span className="fc-dot">·</span>{" "}
                  <motion.b key={shownXp} className={"fc-xp" + (draining ? " drain" : "")} initial={reduce ? false : { scale: draining ? 0.8 : 1.35 }} animate={{ scale: 1 }}>
                    +{shownXp} XP
                  </motion.b>
                </>
              )}
              {" "}<span className="fc-dot">·</span>{" "}
              <span className="arcade-streak-pill">{streak > 0 ? `🔥 ${streak}d` : `🔥 Day 1`}</span>
            </span>
          </div>
          <button
            className={"fc-icon-btn" + (muted ? " muted" : "")}
            onClick={() => { buzz("tap"); setMuted(!muted); }}
            aria-label={muted ? "Unmute sound" : "Mute sound"}
            title={muted ? "Unmute sound" : "Mute sound"}
          >
            {muted ? (
              <Icon d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6" />
            ) : (
              <Icon d="M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
            )}
          </button>
          <button className="fc-icon-btn" onClick={showHint} disabled={done} aria-label="Hint">
            <Icon d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
          </button>
          <button className="fc-icon-btn" onClick={undo} disabled={hist.length < 2 || done} aria-label="Undo">
            <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
          </button>
          <button className={"fc-icon-btn" + (armed ? " armed" : "")} onClick={newDeal} aria-label="New deal">
            {armed ? <span className="fc-sure">New?</span> : <Icon d="M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0 0 12.4 2M18.5 9A7 7 0 0 0 6.1 7" />}
          </button>
        </div>

        {k && !done && !fcWon(k) && fcSolved(k) && (
          <button className="fc-autocomplete-btn" onClick={autoComplete}>
            ⚡ Auto Complete
          </button>
        )}

        {/* 4 Free Cell slots (left cols 0..3) */}
        {[0, 1, 2, 3].map((i) => (
          <div key={`cell-${i}`} className="fc-slot fc-cell-slot" style={{ left: colX(i), top: rowY, width: b.cw, height: b.ch }}>
            <span className="fc-slot-cellmark">FREE</span>
          </div>
        ))}

        {/* 4 Foundation slots (right cols 4..7) */}
        {[0, 1, 2, 3].map((s) => (
          <div key={`found-${s}`} className="fc-slot fc-found" style={{ left: colX(4 + s), top: rowY, width: b.cw, height: b.ch }}>
            <span className={"fc-slot-suit" + (s === 1 || s === 2 ? " red" : "")}>{SUITS[s]}</span>
          </div>
        ))}

        {/* 8 Tableau column base slots */}
        {k.cols.map((_, i) => (
          <div key={`col-${i}`} className="fc-slot fc-col" style={{ left: colX(i), top: tabY, width: b.cw, height: b.ch }} />
        ))}

        {/* All placed cards */}
        {placed.map((p) => {
          const lift = dragging(p);
          const key = `${p.pile}:${p.depth}`;
          const isLanded = !reduce && landed.has(p.c);
          const zIndex = lift
            ? 500 + p.z
            : isLanded
              ? 400 + p.z
              : p.pile[0] === "t"
                ? 30 + p.z
                : 5 + p.z;
          return (
            <motion.div
              key={p.c}
              className={
                "fc-card" +
                (cardRed(p.c) ? " red" : "") +
                (lift ? " lifted" : "") +
                (hinted(p) ? " hinted" : "") +
                (isLanded ? " landed" : "")
              }
              style={{ width: b.cw, height: b.ch, zIndex, fontSize: Math.round(b.cw * 0.3) }}
              initial={false}
              animate={{
                x: p.x + (lift ? drag!.dx : 0),
                y: p.y + (lift ? drag!.dy : 0),
                scale: lift ? 1.05 : isLanded ? LAND_SCALE : 1,
                rotate: shake && key === shake ? SHAKE_ROT : won && p.pile[0] === "f" && !reduce ? WIN_ROT : 0,
              }}
              transition={
                lift
                  ? { duration: 0, scale: { duration: 0.12 } }
                  : {
                      type: "spring",
                      stiffness: 520,
                      damping: 38,
                      scale: isLanded ? { duration: 0.32, ease: "easeOut" } : { duration: 0.15 },
                      rotate: won ? { duration: 0.6, delay: (p.c % 13) * 0.04 } : { duration: 0.3 },
                    }
              }
              onPointerDown={(e) => down(p, e)}
            >
              <Face c={p.c} />
            </motion.div>
          );
        })}

        {/* Floating XP animations */}
        <AnimatePresence>
          {floats.map((f) => (
            <motion.div
              key={f.id}
              className={"fc-float" + (f.tag ? " big" : "") + (f.xp ? "" : " note")}
              style={{ left: f.x, top: f.y }}
              initial={{ opacity: 0, y: 0, scale: f.tag ? 0.6 : 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: reduce ? 0 : f.tag ? -70 : -44, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: f.tag ? 1.3 : 0.85, ease: "easeOut", opacity: { times: [0, 0.15, 0.7, 1], duration: f.tag ? 1.3 : 0.85 } }}
            >
              {f.xp > 0 && `+${f.xp}`}
              {f.tag && <small>{f.tag}</small>}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Win cascade */}
        {won && !reduce && <WinCascade from={(s) => ({ x: colX(4 + s), y: rowY })} cw={b.cw} ch={b.ch} />}

        {/* Stuck alert */}
        <AnimatePresence>
          {isStuck && (
            <motion.div key="stuck" className="fc-stuck" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
              <span className="fc-stuck-title">No moves left</span>
              <button className="btn" onClick={undo}>
                Undo
              </button>
              <button className="btn gold" onClick={() => void deal(game?.seed)}>
                ↺ Retry Deal
              </button>
              <button className="btn primary" onClick={() => void deal()}>
                New deal
              </button>
              <button className="fc-stuck-x" onClick={() => { click(); buzz("tap"); setStuckSeen(hist.length); }} aria-label="Keep playing">
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {won && (
        <VictoryModal
          game="freecell"
          gameTitle="FreeCell"
          moves={moves.length}
          time={clock}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => void deal()}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="freecell"
            gameTitle="FreeCell"
            seed={game.seed}
            time={clock}
            moves={moves.length}
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

function Face({ c }: { c: PlayingCard }) {
  const r = cardRank(c);
  const s = SUITS[cardSuit(c)];
  return (
    <>
      <span className="fc-corner">
        <span className="fc-rank">{RANKS[r]}</span>
        <span className="fc-suit">{s}</span>
      </span>
      {r > 10 ? (
        <span className="fc-court">
          <b>{RANKS[r]}</b>
          <i>{s}</i>
        </span>
      ) : (
        <span className={"fc-center" + (r === 1 ? " ace" : "")}>{s}</span>
      )}
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function WinCascade({ from, cw, ch }: { from: (suit: number) => { x: number; y: number }; cw: number; ch: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const start = useRef(from);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    g.scale(dpr, dpr);
    const queue: PlayingCard[] = [];
    for (let r = 12; r >= 0; r--) for (let s = 0; s < 4; s++) queue.push(s * 13 + r);
    const live: { img: HTMLCanvasElement; x: number; y: number; vx: number; vy: number }[] = [];
    let last = 0;
    let raf = 0;
    const step = (t: number) => {
      if (queue.length && t - last > 220) {
        last = t;
        const c = queue.shift()!;
        const o = start.current(cardSuit(c));
        live.push({ img: cardSprite(c, cw, ch, dpr), x: o.x, y: o.y, vx: (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 4.5), vy: -2 - Math.random() * 5 });
      }
      for (const p of live) {
        p.vy += 0.5;
        p.x += p.vx;
        p.y += p.vy;
        if (p.y + ch > H) {
          p.y = H - ch;
          p.vy = -p.vy * 0.74;
        }
        g.drawImage(p.img, p.x, p.y, cw, ch);
      }
      for (let i = live.length - 1; i >= 0; i--) if (live[i].x < -cw || live[i].x > W) live.splice(i, 1);
      if (queue.length || live.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cw, ch]);
  return <canvas ref={ref} className="fc-cascade" />;
}

function cardSprite(c: PlayingCard, cw: number, ch: number, dpr: number) {
  const cv = document.createElement("canvas");
  cv.width = cw * dpr;
  cv.height = ch * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  const r = Math.max(4, cw * 0.08);
  g.beginPath();
  g.roundRect(0.5, 0.5, cw - 1, ch - 1, r);
  const bg = g.createLinearGradient(0, 0, cw * 0.4, ch);
  bg.addColorStop(0, "#fffdf6");
  bg.addColorStop(0.55, "#f6eedb");
  bg.addColorStop(1, "#eadfc4");
  g.fillStyle = bg;
  g.fill();
  g.strokeStyle = "rgba(0, 0, 0, 0.35)";
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = cardRed(c) ? "#c0301b" : "#17191d";
  g.textBaseline = "top";
  const fs = Math.round(cw * 0.3);
  g.font = `${fs}px "Bebas Neue", Impact, sans-serif`;
  g.fillText(RANKS[cardRank(c)], cw * 0.08, ch * 0.05);
  g.font = `${Math.round(fs * 0.8)}px sans-serif`;
  g.textAlign = "right";
  g.fillText(SUITS[cardSuit(c)], cw * 0.92, ch * 0.06);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `${Math.round(cw * 0.5)}px sans-serif`;
  g.fillText(SUITS[cardSuit(c)], cw / 2, ch * 0.6);
  return cv;
}
