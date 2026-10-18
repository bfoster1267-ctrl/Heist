// Spider Solitaire (10 cascades, 104 cards, stock deals, 8 completed K->A runs to win).
// Full feature parity: auto-moves, sequence selection, hints, unlimited undo,
// custom ivory card faces, oxblood backs, floating XP, queue timer banner, and win cascade.

import {
  applySpider, canDealSpider, canMoveSpider, cardRank, cardRed, cardSuit, dealSpider,
  isValidSpiderSequence, SPIDER_DAY_XP, spiderPay, spiderRoom,
  tallySpider, tallySpiderXp, type PlayingCard, type SpiderMove,
  type SpiderState, type SpiderSuitMode, type SpiderTally,
} from "@heist/profile";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { card as cardSound, click, isHostMuted, isPlayerMuted, onSoundChange, setMuted, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { shareDailyResult } from "../daily/shareHelpers";
import { getDailyStreak, getStreakMultiplier } from "@heist/profile";
import { VictoryModal } from "../arcade/VictoryModal";
import "./spider.css";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: SpiderTally = { completedRuns: 0, moves: 0, won: false };

function useSpiderBoard() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const width = Math.min(size.w, 756);
  const gap = Math.max(3, Math.round(width * 0.008));
  const cw = Math.floor((width - gap * 11) / 10);
  const ch = Math.round(cw * 1.42);
  return { width, height: size.h, gap, cw, ch, left: Math.round((size.w - width) / 2) + gap };
}

export function Spider({
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
  const [hist, setHist] = useState<SpiderState[]>([]);
  const [moves, setMoves] = useState<SpiderMove[]>([]);
  const [mode, setMode] = useState<SpiderSuitMode>(1);
  const [selected, setSelected] = useState<{ col: number; cardIndex: number } | null>(null);
  const [hint, setHint] = useState<{ fromCol: number; cardIndex: number; toCol: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [playerMuted, setPlayerMuted] = useState(isPlayerMuted);
  const [hostMuted, setHostMuted] = useState(isHostMuted);
  useEffect(() => onSoundChange(() => {
    setPlayerMuted(isPlayerMuted());
    setHostMuted(isHostMuted());
  }), []);
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  const b = useSpiderBoard();

  const k = hist[hist.length - 1];
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  const best = useRef(NOTHING);
  const banked = useRef(0);
  const meNow = useRef(me);
  meNow.current = me;

  // Load new deal
  const deal = useCallback(async (suitMode = mode) => {
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    try {
      const g = backend ? await backend.spiderStart(firstSeed, dailyFlag).catch(() => null) : null;
      if (g) {
        setGame(g);
        setHist([dealSpider(g.seed, suitMode)]);
      } else {
        const seed = firstSeed ?? Math.floor(Math.random() * 2 ** 31);
        setGame({ gameId: null, seed });
        setHist([dealSpider(seed, suitMode)]);
      }
      setMoves([]);
      setSelected(null);
      setHint(null);
      setDone(false);
      best.current = NOTHING;
      banked.current = 0;
    } catch {
      const seed = firstSeed ?? Math.floor(Math.random() * 2 ** 31);
      setGame({ gameId: null, seed });
      setHist([dealSpider(seed, suitMode)]);
      setMoves([]);
      setSelected(null);
      setHint(null);
      setDone(false);
      best.current = NOTHING;
      banked.current = 0;
    }
  }, [backend, mode, initialSeed, isDaily]);

  useEffect(() => {
    void deal();
  }, [deal]);

  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallySpider(game.seed, moves, mode);
    } catch {
      return null;
    }
  }, [game, moves, mode]);

  // Bank progress on run completion
  useEffect(() => {
    if (!game || !tally) return;
    const cur = tally;
    const prev = best.current;
    if (cur.completedRuns > prev.completedRuns) {
      best.current = cur;
      const gainedXp = tallySpiderXp(cur) - banked.current;
      if (gainedXp > 0) {
        banked.current = tallySpiderXp(cur);
        const id = ++floatId.current;
        setFloats((f) => [...f, { id, x: window.innerWidth / 2, y: window.innerHeight / 2, xp: gainedXp, tag: "RUN CLEARED!" }]);
        setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1200);
      }
      if (game.gameId) {
        void act((x) => x.spiderBank(game.gameId!, moves, 0));
      }
    }
  }, [game, tally, moves, act]);

  // Check victory
  useEffect(() => {
    if (!k || done) return;
    if (k.won) {
      setDone(true);
      winSound();
      buzz("win");
      if (game?.gameId) {
        void act((x) => x.spiderFinish(game.gameId!, moves, 0))
          .then((r) => {
            if (r?.reward) showReward(r.reward);
          })
          .catch(() => {});
      }
    }
  }, [k, done, game, moves, act, showReward]);

  // Stock deal
  const handleDealStock = useCallback(() => {
    if (!k || k.won) return;
    if (k.stock.length === 0) {
      buzz("tap");
      return;
    }
    if (!canDealSpider(k)) {
      buzz("bump");
      const id = ++floatId.current;
      setFloats((f) => [...f, { id, x: window.innerWidth / 2, y: window.innerHeight / 2, xp: 0, tag: "NO EMPTY COLUMNS TO DEAL!" }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1200);
      return;
    }
    cardSound();
    buzz("tap");
    const next = applySpider(k, { kind: "deal" });
    setHist((h) => [...h, next]);
    setMoves((m) => [...m, { kind: "deal" }]);
    setSelected(null);
    setHint(null);
  }, [k]);

  // Find legal hint
  const handleHint = useCallback(() => {
    if (!k || k.won) return;
    click();
    // Scan all columns
    for (let from = 0; from < 10; from++) {
      const sourceCol = k.tableau[from];
      for (let idx = 0; idx < sourceCol.length; idx++) {
        if (!sourceCol[idx].up) continue;
        if (!isValidSpiderSequence(sourceCol, idx)) continue;

        // Try to find a target column
        for (let to = 0; to < 10; to++) {
          if (from === to) continue;
          if (canMoveSpider(k, from, idx, to)) {
            // Prioritize moves that expose a hidden card or match suit
            setHint({ fromCol: from, cardIndex: idx, toCol: to });
            buzz("tap");
            setTimeout(() => setHint(null), 2500);
            return;
          }
        }
      }
    }
    buzz("tap");
  }, [k]);

  // Undo move
  const handleUndo = useCallback(() => {
    if (hist.length <= 1 || done) return;
    click();
    buzz("tap");
    setHist((h) => h.slice(0, -1));
    setMoves((m) => m.slice(0, -1));
    setSelected(null);
    setHint(null);
  }, [hist, done]);

  // Column or Card click
  const handleCardClick = useCallback((colIdx: number, cardIdx: number) => {
    if (!k || k.won) return;
    const col = k.tableau[colIdx];
    const item = col[cardIdx];

    // If no card is currently selected
    if (!selected) {
      if (!item.up) return;
      if (!isValidSpiderSequence(col, cardIdx)) return;

      // Smart move check: Can it move to a matching suit destination right away?
      let targetCol: number | null = null;
      for (let to = 0; to < 10; to++) {
        if (to === colIdx) continue;
        if (canMoveSpider(k, colIdx, cardIdx, to)) {
          const dest = k.tableau[to];
          // Only auto-move if there is a same suit target
          if (dest.length > 0 && cardSuit(dest[dest.length - 1].card) === cardSuit(item.card)) {
            targetCol = to;
            break;
          }
        }
      }

      // If same-suit move found, perform move immediately!
      if (targetCol !== null) {
        cardSound();
        buzz("tap");
        const move: SpiderMove = { kind: "move", fromCol: colIdx, cardIndex: cardIdx, toCol: targetCol };
        const next = applySpider(k, move);
        setHist((h) => [...h, next]);
        setMoves((m) => [...m, move]);
        if (next.completed > k.completed) buzz("win");
        setHint(null);
        return;
      }

      // Otherwise select sequence so user can explicitly choose destination
      buzz("tap");
      setSelected({ col: colIdx, cardIndex: cardIdx });
      setHint(null);
      return;
    }

    // A sequence is already selected
    if (selected.col === colIdx) {
      // Tapping same column: change sub-sequence or deselect
      if (selected.cardIndex === cardIdx) {
        setSelected(null);
      } else if (item.up && isValidSpiderSequence(col, cardIdx)) {
        buzz("tap");
        setSelected({ col: colIdx, cardIndex: cardIdx });
      }
      return;
    }

    // Tapping a different column: attempt to move to it
    if (canMoveSpider(k, selected.col, selected.cardIndex, colIdx)) {
      cardSound();
      buzz("tap");
      const move: SpiderMove = { kind: "move", fromCol: selected.col, cardIndex: selected.cardIndex, toCol: colIdx };
      const next = applySpider(k, move);
      setHist((h) => [...h, next]);
      setMoves((m) => [...m, move]);
      if (next.completed > k.completed) buzz("win");
      setSelected(null);
      setHint(null);
    } else {
      // If illegal destination, but clicked card is itself a valid sequence start, select it instead
      if (item.up && isValidSpiderSequence(col, cardIdx)) {
        buzz("tap");
        setSelected({ col: colIdx, cardIndex: cardIdx });
      } else {
        setSelected(null);
      }
    }
  }, [k, selected]);

  // Click on empty column base
  const handleEmptyColClick = useCallback((colIdx: number) => {
    if (!k || k.won || !selected) return;
    if (canMoveSpider(k, selected.col, selected.cardIndex, colIdx)) {
      cardSound();
      buzz("tap");
      const move: SpiderMove = { kind: "move", fromCol: selected.col, cardIndex: selected.cardIndex, toCol: colIdx };
      const next = applySpider(k, move);
      setHist((h) => [...h, next]);
      setMoves((m) => [...m, move]);
      if (next.completed > k.completed) buzz("win");
      setSelected(null);
      setHint(null);
    }
  }, [k, selected]);

  const stockCount = k?.stock.length ?? 50;
  const dealsLeft = Math.floor(stockCount / 10);
  const completed = k?.completed ?? 0;
  const room = me ? spiderRoom(me.progress, Date.now()) : SPIDER_DAY_XP;

  return (
    <div className="spider">
      <div className="spider-felt-rim" />

      <div className="spider-board">
        {/* Top Header Bar */}
        <header className="spider-bar">
          <button
            type="button"
            className="spider-icon-btn"
            onClick={() => { click(); buzz("tap"); onExit(); }}
            title="Back to the lobby"
            aria-label="Back to the lobby"
          >
            <Icon d="M15 19l-7-7 7-7" />
          </button>

          <div className="spider-hud">
            <span className="spider-hud-name">
              SPIDER SOLITAIRE
              <span className="arcade-trust-pill">✓ Free · No Ads</span>
            </span>
            <span className="spider-hud-stats">
              {mode} SUIT • RUNS: <span className="spider-hud-val">{completed}/8</span> • <span className="spider-hud-val">{room} XP ROOM</span> • <span className="arcade-streak-pill">{streak > 0 ? `🔥 ${streak}d` : `🔥 Day 1`}</span>
            </span>
          </div>

          <button
            type="button"
            className={`spider-icon-btn ${hostMuted ? "disabled" : playerMuted ? "muted" : ""}`}
            onClick={() => {
              if (hostMuted) return;
              buzz("tap");
              setMuted(!playerMuted);
            }}
            disabled={hostMuted}
            aria-label={hostMuted ? "Sound muted by platform" : playerMuted ? "Unmute sound" : "Mute sound"}
            title={hostMuted ? "Sound muted by platform" : playerMuted ? "Unmute sound" : "Mute sound"}
          >
            {hostMuted || playerMuted ? (
              <Icon d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6" />
            ) : (
              <Icon d="M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
            )}
          </button>

          <button
            type="button"
            className="spider-icon-btn"
            onClick={handleHint}
            disabled={done}
            title="Show hint"
            aria-label="Hint"
          >
            <Icon d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 001 1h6a1 1 0 001-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 00-7-7zm-2 18a1 1 0 001 1h2a1 1 0 001-1v-1h-4v1z" />
          </button>

          <button
            type="button"
            className="spider-icon-btn"
            onClick={handleUndo}
            disabled={hist.length <= 1 || done}
            title="Undo last move"
            aria-label="Undo"
          >
            <Icon d="M3 10h10a5 5 0 015 5v2m-15-7l4-4m-4 4l4 4" />
          </button>

          <button
            type="button"
            className={`spider-icon-btn ${armed ? "armed" : ""}`}
            onClick={() => {
              click();
              buzz("tap");
              if (armed) {
                setArmed(false);
                void deal(mode);
              } else {
                setArmed(true);
                setTimeout(() => setArmed(false), 2600);
              }
            }}
            title={armed ? "Confirm new deal" : "New deal"}
            aria-label="New deal"
          >
            {armed ? <span className="spider-sure">NEW?</span> : <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
          </button>
        </header>

        {/* Foundation slots & Stock pile */}
        <div className="spider-top-row">
          {/* 8 Completed Foundation runs */}
          <div className="spider-foundations">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={`spider-foundation-slot ${i < completed ? "filled" : ""}`}
                style={{ width: b.cw * 0.75, height: b.ch * 0.75 }}
              >
                {i < completed ? (
                  <span style={{ fontSize: 13, color: "var(--gold)", fontWeight: 800 }}>K♠</span>
                ) : (
                  <span style={{ fontSize: 10, color: "rgba(231, 181, 60, 0.25)" }}>♠</span>
                )}
              </div>
            ))}
          </div>

          {/* Stock pile */}
          <div
            className="spider-stock-zone"
            onClick={handleDealStock}
            role="button"
            tabIndex={dealsLeft > 0 ? 0 : -1}
            aria-label={dealsLeft > 0 ? `Deal cards (${dealsLeft} deals remaining)` : "No deals remaining"}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleDealStock();
              }
            }}
          >
            <span className="spider-stock-count">{dealsLeft} DEALS</span>
            <div
              style={{
                position: "relative",
                width: b.cw,
                height: b.ch,
                cursor: dealsLeft > 0 ? "pointer" : "default",
              }}
            >
              {dealsLeft > 0 ? (
                <div className="spider-card face-down" style={{ width: b.cw, height: b.ch }}>
                  <span className="spider-back-frame">
                    <span className="spider-back-mark">H</span>
                  </span>
                </div>
              ) : (
                <div
                  className="spider-foundation-slot"
                  style={{ width: b.cw, height: b.ch }}
                >
                  <span style={{ fontSize: 12, color: "rgba(231, 181, 60, 0.3)" }}>✓</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 10 Tableau Cascades */}
        <div className="spider-tableau">
          {k?.tableau.map((col, colIdx) => {
            // Dynamic card step compression if column has many cards
            const totalCards = col.length;
            const availableHeight = b.height - 130;
            const downStep = Math.max(6, Math.min(14, Math.floor(availableHeight / (totalCards + 3))));
            const upStep = Math.max(10, Math.min(24, Math.floor(availableHeight / (totalCards + 2))));

            let currentTop = 0;

            return (
              <div
                key={colIdx}
                className="spider-col"
                style={{ width: b.cw }}
                onClick={() => col.length === 0 && handleEmptyColClick(colIdx)}
              >
                {/* Empty column base outline */}
                <div
                  className="spider-col-base"
                  style={{ width: b.cw, height: b.ch }}
                />

                {col.map((item, cardIdx) => {
                  const isSel = selected?.col === colIdx && cardIdx >= selected.cardIndex;
                  const isHinted = hint?.fromCol === colIdx && cardIdx >= hint.cardIndex;
                  const top = currentTop;
                  currentTop += item.up ? upStep : downStep;

                  return (
                    <div
                      key={cardIdx}
                      className={`spider-card ${item.up ? "face-up" : "face-down"} ${isSel ? "selected" : ""} ${isHinted ? "hinted" : ""}`}
                      style={{
                        width: b.cw,
                        height: b.ch,
                        top,
                        zIndex: cardIdx + 1,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCardClick(colIdx, cardIdx);
                      }}
                    >
                      {item.up ? (
                        <SpiderCardFace card={item.card} />
                      ) : (
                        <span className="spider-back-frame">
                          <span className="spider-back-mark">H</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating XP */}
      {floats.map((f) => (
        <div key={f.id} className="spider-float" style={{ left: f.x, top: f.y }}>
          +{f.xp} XP {f.tag}
        </div>
      ))}

      {/* Win Cascade & Dialog */}
      {k?.won && (
        <>
          <WinCascade from={() => ({ x: window.innerWidth / 2 - b.cw / 2, y: 120 })} cw={b.cw} ch={b.ch} />
          <VictoryModal
            game="spider"
            gameTitle="Spider Solitaire"
            moves={moves.length}
            isDaily={isDaily}
            progress={me?.progress}
            onDealAgain={() => { cardSound(4); buzz("tap"); void deal(mode); }}
            onChallengeFriend={() => setChallengeOpen(true)}
            onExit={() => onExit()}
            onHeist={onHeist ? () => onHeist() : undefined}
          />
        </>
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="spider"
            gameTitle="Spider Solitaire"
            seed={game.seed}
            moves={moves.length}
            challengerTime={challengerTime}
            challengerMoves={challengerMoves}
            challengerScore={challengerScore}
            onClose={() => setChallengeOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Online queue timer banner */}
      {banner}
    </div>
  );
}

function SpiderCardFace({ card }: { card: PlayingCard }) {
  const r = cardRank(card);
  const s = cardSuit(card);
  const red = cardRed(card);
  return (
    <>
      <div className={`spider-corner ${red ? "spider-red" : "spider-black"}`}>
        <span className="spider-corner-rank">{RANKS[r]}</span>
        <span className="spider-corner-suit">{SUITS[s]}</span>
      </div>
      {r >= 11 && r <= 13 ? (
        <div className={`spider-court ${red ? "spider-red" : "spider-black"}`}>
          <b>{RANKS[r]}</b>
          <i>{SUITS[s]}</i>
        </div>
      ) : (
        <div className={`spider-center-suit ${red ? "spider-red" : "spider-black"}`}>
          {SUITS[s]}
        </div>
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
      if (queue.length && t - last > 160) {
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
  return <canvas ref={ref} className="spider-cascade" />;
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
