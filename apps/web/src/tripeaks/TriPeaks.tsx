// TriPeaks Solitaire (3 peaks, 28-card tableau, stock and waste).
// Tap any uncovered card adjacent in rank (+/-1 with King <-> Ace wrap) to build combos.
// Full feature parity: streaks, audio pitch climb, hints, undo, floating XP, queue banner, and win cascade.

import {
  applyTp, cardRank, cardRed, cardSuit, dealTriPeaks, findTpHint, fitsTp, isTpUncovered,
  tallyTriPeaks, tallyTpXp, TP_IDLE_S, tpGain, tpHasMoves, tpPay, tpWon, TRIPEAKS_DAY_XP, tripeaksRoom,
  type PlayingCard, type TpMove, type TpTally, type TriPeaksState,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import "./tripeaks.css";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: TpTally = { cleared: 0, maxStreak: 0, peaks: 0, won: false };

/** Horizontal column fractions for the 28 tableau cards */
const TP_COLS: Record<number, number> = {
  // Row 0 (3 peaks)
  0: 1.5, 1: 4.5, 2: 7.5,
  // Row 1 (6 cards)
  3: 1.0, 4: 2.0, 5: 4.0, 6: 5.0, 7: 7.0, 8: 8.0,
  // Row 2 (9 cards)
  9: 0.5, 10: 1.5, 11: 2.5, 12: 3.5, 13: 4.5, 14: 5.5, 15: 6.5, 16: 7.5, 17: 8.5,
  // Row 3 (10 cards)
  18: 0, 19: 1, 20: 2, 21: 3, 22: 4, 23: 5, 24: 6, 25: 7, 26: 8, 27: 9,
};

const rowOf = (i: number) => (i < 3 ? 0 : i < 9 ? 1 : i < 18 ? 2 : 3);

function useBoard() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const width = Math.min(size.w, 756);
  const gap = Math.max(3, Math.round(width * 0.01));
  const cw = Math.floor((width - gap * 11) / 10);
  const ch = Math.round(cw * 1.42);
  const rowH = Math.round(ch * 0.44);
  return { width, height: size.h, gap, cw, ch, rowH, left: Math.round((size.w - width) / 2) + gap };
}

export function TriPeaks({ onExit, onHeist, banner }: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
}) {
  const { backend, act, showReward, me } = useAccount();
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [hist, setHist] = useState<TriPeaksState[]>([]);
  const [moves, setMoves] = useState<TpMove[]>([]);
  const [shake, setShake] = useState<string | null>(null);
  const [hint, setHint] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const b = useBoard();
  const board = useRef<HTMLDivElement>(null);
  const k = hist[hist.length - 1];
  const reduce = reducedMotion();
  const [stuckSeen, setStuckSeen] = useState(-1);

  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallyTriPeaks(game.seed, moves);
    } catch {
      return null;
    }
  }, [game, moves]);

  const best = useRef(NOTHING);
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const pot = (t: TpTally) => Math.max(0, tallyTpXp(t) - drainRef.current);
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
    const xp = Math.max(0, tallyTpXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.tripeaksBank(g.gameId!, ms, drainRef.current));
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

  const deal = useCallback(async () => {
    await bank(true);
    best.current = NOTHING;
    banked.current = 0;
    drainRef.current = 0;
    setDrain(0);
    setFloats([]);
    const g = backend ? await backend.tripeaksStart().catch(() => null) : null;
    dayLeft.current = meNow.current ? tripeaksRoom(meNow.current.progress, Date.now()) : TRIPEAKS_DAY_XP;
    maxedShown.current = false;
    const next = g ?? { gameId: null, seed: Math.floor(Math.random() * 2 ** 31) };
    setGame(next);
    setHist([dealTriPeaks(next.seed)]);
    setMoves([]);
    setDone(false);
    setHint(null);
    setArmed(false);
    setStarted(Date.now());
    lastAct.current = Date.now();
    cardSound(3);
  }, [backend, bank]);

  useEffect(() => {
    void deal();
  }, [deal]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stalled = (at: number) =>
    !!game?.gameId && !!k && !done && !tpWon(k) && document.visibilityState === "visible" && at - lastAct.current >= TP_IDLE_S * 1000 && tpHasMoves(k);

  useEffect(() => {
    if (stalled(now)) setDrain((d) => Math.min(d + 1, tallyTpXp(best.current)));
  }, [now]);

  const play = useCallback(
    (m: TpMove) => {
      const n = k && applyTp(k, m);
      if (!n) return false;
      setHist((h) => [...h, n]);
      setMoves((ms) => [...ms, m]);
      setHint(null);
      lastAct.current = Date.now();
      if (m.startsWith("t")) {
        click();
        buzz(n.streak >= 5 ? "bump" : "tap");
      } else {
        cardSound(1);
        buzz("tap");
      }
      return true;
    },
    [k],
  );

  useEffect(() => {
    if (!k || done || !tpWon(k)) return;
    setDone(true);
    winSound();
    buzz("win");
    const id = game?.gameId;
    if (id) void act((x) => x.tripeaksFinish(id, moves, drainRef.current)).then((r) => r && showReward(r.reward));
  }, [k, done, game, moves, act, showReward]);

  const undo = () => {
    if (hist.length < 2 || done) return;
    setHist((h) => h.slice(0, -1));
    setMoves((ms) => ms.slice(0, -1));
    setHint(null);
    lastAct.current = Date.now();
    click();
  };

  const showHint = () => {
    if (!k || done) return;
    const h = findTpHint(k);
    if (h === null) {
      if (k.stock.length > 0) {
        setShake("stock");
        buzz("tap");
        window.setTimeout(() => setShake(null), 320);
      }
      return;
    }
    setHint(h);
    setDrain((d) => Math.min(d + 1, tallyTpXp(best.current)));
    click();
    window.setTimeout(() => setHint(null), 1800);
  };

  const newDeal = () => {
    if (moves.length && !done && !armed) {
      setArmed(true);
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

  // Layout calculations
  const stripH = banner ? 36 : 0;
  const barH = 52 + stripH;
  const tabY = b.gap * 2 + barH + 10;
  const bottomY = tabY + 4 * b.rowH + b.ch * 0.6;
  const colX = (c: number) => b.left + c * (b.cw + b.gap);

  // Floating XP
  useEffect(() => {
    if (!tally || !k) return;
    const prevBest = best.current;
    const { gained, paid, any } = tpGain(prevBest, tally);
    const before = Math.min(pot(prevBest), dayLeft.current);
    best.current = paid;
    const xp = Math.min(pot(paid), dayLeft.current) - before;
    const xpEarned = tallyTpXp(paid) - tallyTpXp(prevBest);
    const maxed = any && xp < xpEarned && !maxedShown.current;
    if (maxed) maxedShown.current = true;
    if ((!xp && !maxed) || !game?.gameId) return;

    const x = colX(5.5) + b.cw / 2;
    const y = bottomY;
    const tag = maxed
      ? "MAXED TODAY · HEIST PAYS MORE"
      : gained.peaks
        ? "PEAK CLEARED"
        : (gained.streak10 || gained.maxStreak >= 10)
          ? "10x STREAK"
          : (gained.streak5 || gained.maxStreak >= 5)
            ? "5x STREAK"
            : null;
    const id = ++floatId.current;
    setFloats((f) => [...f.slice(-5), { id, x, y, xp, tag }]);
    window.setTimeout(() => setFloats((f) => f.filter((q) => q.id !== id)), tag ? 1400 : 900);
  }, [tally]);

  if (!k) return <div className="tp" />;

  const tapTableau = (i: number) => {
    if (done) return;
    const c = k.tableau[i];
    if (c === null || !k.up[i]) return;
    const topW = k.waste[k.waste.length - 1];
    if (topW === undefined || !fitsTp(c, topW)) {
      nope(`t${i}`);
      return;
    }
    play(`t${i}`);
  };

  const drawStock = () => {
    if (done || k.stock.length === 0) return;
    play("d");
  };

  const secs = Math.floor((now - started) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const won = tpWon(k);
  const isStuck = !done && stuckSeen !== hist.length && !tpHasMoves(k);
  const shownXp = Math.min(pot(best.current), dayLeft.current);
  const draining = stalled(now) && shownXp > 0;
  const topWaste = k.waste[k.waste.length - 1];

  return (
    <div className="tp">
      <div className="tp-felt-rim" />
      <div className="tp-board" ref={board}>
        {banner && <div className="tp-banner">{banner}</div>}
        <div className="tp-bar" style={{ height: 52 }}>
          <button className="tp-icon-btn" onClick={onExit} aria-label="Back to the lobby">
            <Icon d="M15 5 8 12l7 7" />
          </button>
          <div className="tp-hud">
            <span className="tp-hud-name">TRIPEAKS</span>
            <span className="tp-hud-stats">
              <b>{moves.length}</b> moves <span className="tp-dot">·</span> <b>{clock}</b>
              {game?.gameId && (shownXp > 0 || drain > 0) && (
                <>
                  {" "}<span className="tp-dot">·</span>{" "}
                  <motion.b key={shownXp} className={"tp-xp" + (draining ? " drain" : "")} initial={reduce ? false : { scale: draining ? 0.8 : 1.35 }} animate={{ scale: 1 }}>
                    +{shownXp} XP
                  </motion.b>
                </>
              )}
            </span>
          </div>
          <button className="tp-icon-btn" onClick={showHint} disabled={done} aria-label="Hint">
            <Icon d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
          </button>
          <button className="tp-icon-btn" onClick={undo} disabled={hist.length < 2 || done} aria-label="Undo">
            <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
          </button>
          <button className={"tp-icon-btn" + (armed ? " armed" : "")} onClick={newDeal} aria-label="New deal">
            {armed ? <span className="tp-sure">New?</span> : <Icon d="M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0 0 12.4 2M18.5 9A7 7 0 0 0 6.1 7" />}
          </button>
        </div>

        {/* Tableau Cards (28 spots in 3 peaks) */}
        {k.tableau.map((c, i) => {
          if (c === null) return null;
          const r = rowOf(i);
          const x = colX(TP_COLS[i]);
          const y = tabY + r * b.rowH;
          const isUp = k.up[i];
          const isHinted = hint === i;
          const key = `t${i}`;
          return (
            <motion.div
              key={`tp-${i}-${c}`}
              className={
                "tp-card" +
                (isUp ? (cardRed(c) ? " red" : "") : " back") +
                (isHinted ? " hinted" : "")
              }
              style={{
                left: x,
                top: y,
                width: b.cw,
                height: b.ch,
                zIndex: 10 + r * 5,
                fontSize: Math.round(b.cw * 0.3),
              }}
              animate={{
                rotate: shake === key ? [0, -6, 6, -4, 0] : 0,
                rotateY: isUp ? 0 : 180,
              }}
              transition={{ duration: 0.25 }}
              onClick={() => tapTableau(i)}
            >
              {isUp ? <Face c={c} /> : <Back />}
            </motion.div>
          );
        })}

        {/* Stock slot and draw pile */}
        <div
          className={"tp-slot stock" + (shake === "stock" ? " hinted" : "")}
          style={{ left: colX(3), top: bottomY, width: b.cw, height: b.ch }}
          onClick={drawStock}
        >
          {k.stock.length > 0 ? (
            <div className="tp-card back" style={{ width: b.cw, height: b.ch }}>
              <Back />
            </div>
          ) : (
            <Icon d="M4 4v6h6M5.5 15a7 7 0 1 0 1-8L4 10" />
          )}
          <span className="tp-stock-count">{k.stock.length}</span>
        </div>

        {/* Waste slot and current waste card */}
        <div className="tp-slot waste" style={{ left: colX(5), top: bottomY, width: b.cw, height: b.ch }}>
          {topWaste !== undefined && (
            <motion.div
              key={`waste-${topWaste}`}
              className={"tp-card" + (cardRed(topWaste) ? " red" : "")}
              style={{ width: b.cw, height: b.ch, fontSize: Math.round(b.cw * 0.3) }}
              initial={{ scale: 1.15 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.15 }}
            >
              <Face c={topWaste} />
            </motion.div>
          )}
        </div>

        {/* Combo streak badge */}
        {k.streak >= 2 && (
          <motion.div
            key={k.streak}
            className="tp-streak-badge"
            style={{ left: colX(4.5) + b.cw / 2, top: bottomY + b.ch / 2 }}
            initial={{ scale: 0.6, y: -10 }}
            animate={{ scale: 1, y: 0 }}
          >
            🔥 {k.streak}x STREAK
          </motion.div>
        )}

        {/* Floating XP numbers */}
        <AnimatePresence>
          {floats.map((f) => (
            <motion.div
              key={f.id}
              className={"tp-float" + (f.tag ? " big" : "")}
              style={{ left: f.x, top: f.y }}
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: reduce ? 0 : -45, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            >
              {f.xp > 0 && `+${f.xp}`}
              {f.tag && <small>{f.tag}</small>}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Win cascade */}
        {won && !reduce && <WinCascade from={() => ({ x: colX(5), y: bottomY })} cw={b.cw} ch={b.ch} />}

        {/* Stuck dialog */}
        <AnimatePresence>
          {isStuck && (
            <motion.div key="stuck" className="tp-stuck" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
              <span className="tp-stuck-title">No moves left</span>
              <button className="btn" onClick={undo}>
                Undo
              </button>
              <button className="btn primary" onClick={() => void deal()}>
                New deal
              </button>
              <button className="tp-stuck-x" onClick={() => setStuckSeen(hist.length)} aria-label="Keep playing">
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Win celebration dialog */}
      <AnimatePresence>
        {won && (
          <motion.div className="tp-win" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: reduce ? 0.4 : 1.8 }}>
            <motion.div className="tp-win-card" initial={{ scale: 0.7, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 18, delay: reduce ? 0.6 : 2.0 }}>
              <div className="tp-win-kicker">CLEAN JOB</div>
              <div className="tp-win-title">PEAKS CLEARED</div>
              <div className="tp-win-stats">
                <span>
                  <b>{moves.length}</b>moves
                </span>
                <span>
                  <b>{clock}</b>time
                </span>
              </div>
              <button className="btn primary big" onClick={() => void deal()} autoFocus>
                Deal again
              </button>
              {onHeist && (
                <button className="btn big tp-heist" onClick={onHeist}>
                  Heist
                </button>
              )}
              <button className="btn ghost" onClick={onExit}>
                Lobby
              </button>
            </motion.div>
          </motion.div>
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
      <span className="tp-corner">
        <span className="tp-rank">{RANKS[r]}</span>
        <span className="tp-suit">{s}</span>
      </span>
      {r > 10 ? (
        <span className="tp-court">
          <b>{RANKS[r]}</b>
          <i>{s}</i>
        </span>
      ) : (
        <span className={"tp-center" + (r === 1 ? " ace" : "")}>{s}</span>
      )}
    </>
  );
}

function Back() {
  return (
    <span className="tp-back-frame">
      <span className="tp-back-mark">H</span>
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

function WinCascade({ from, cw, ch }: { from: () => { x: number; y: number }; cw: number; ch: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
      if (queue.length && t - last > 180) {
        last = t;
        const c = queue.shift()!;
        const o = from();
        live.push({ img: cardSprite(c, cw, ch, dpr), x: o.x, y: o.y, vx: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5), vy: -3 - Math.random() * 6 });
      }
      for (const p of live) {
        p.vy += 0.55;
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
  }, [cw, ch, from]);
  return <canvas ref={ref} className="tp-cascade" />;
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
