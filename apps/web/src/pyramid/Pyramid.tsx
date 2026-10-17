// Pyramid Solitaire (28-card pyramid, 24-card stock, pairs summing to 13, Kings clear solo).
// Full feature parity: hint, undo, queue banner, floating XP, haptics, sounds, win canvas.

import {
  applyPyramid, cardRank, cardRed, cardSuit, dealPyramid, findPyramidHint, isPyramidUncovered,
  pyramidGain, pyramidPay, pyramidRow, pyramidValue, PYRAMID_DAY_XP, PYRAMID_IDLE_S,
  pyramidRoom, tallyPyramid, tallyPyramidXp, type PlayingCard, type PyramidHint,
  type PyramidMove, type PyramidState, type PyramidTally,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { shareDailyResult } from "../daily/shareHelpers";
import { getDailyStreak, getStreakMultiplier } from "@heist/profile";
import { VictoryModal } from "../arcade/VictoryModal";
import "./pyramid.css";
import { t, tNodes } from "../i18n";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: PyramidTally = { clearedCards: 0, moves: 0, won: false };

/** Row starts for the 7 rows of the pyramid */
const ROW_STARTS = [0, 1, 3, 6, 10, 15, 21];

function useBoard() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const width = Math.min(size.w, 756);
  const gap = Math.max(3, Math.round(width * 0.012));
  const cw = Math.floor((width - gap * 8) / 7.2);
  const ch = Math.round(cw * 1.4);
  const maxRowH = Math.max(16, Math.floor((size.h - 140 - 2 * ch) / 6));
  const rowH = Math.min(Math.round(ch * 0.44), maxRowH);
  const boardLeft = Math.round((size.w - width) / 2) + gap;
  return { width, height: size.h, gap, cw, ch, rowH, left: boardLeft };
}

type SelectedCard =
  | { source: "pyramid"; index: number; card: PlayingCard }
  | { source: "waste"; card: PlayingCard };

export function Pyramid({
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
  const [hist, setHist] = useState<PyramidState[]>([]);
  const [moves, setMoves] = useState<PyramidMove[]>([]);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [hint, setHint] = useState<PyramidHint | null>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const b = useBoard();
  const board = useRef<HTMLDivElement>(null);
  const k = hist[hist.length - 1];
  const reduce = reducedMotion();
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallyPyramid(game.seed, moves);
    } catch {
      return null;
    }
  }, [game, moves]);

  const best = useRef(NOTHING);
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
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
    const xp = Math.max(0, tallyPyramidXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.pyramidBank(g.gameId!, ms, drainRef.current));
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
    dayLeft.current = me ? pyramidRoom(me.progress, Date.now()) : PYRAMID_DAY_XP;
  }, [me]);

  const deal = useCallback(async () => {
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    const g = backend ? await backend.pyramidStart(firstSeed, dailyFlag).catch(() => null) : null;
    const seed = g ? g.seed : (firstSeed ?? Math.floor(Math.random() * 2 ** 31));
    const initial = dealPyramid(seed);
    setGame({ gameId: g?.gameId ?? null, seed });
    setHist([initial]);
    setMoves([]);
    setSelected(null);
    setHint(null);
    setArmed(false);
    setDone(false);
    setStarted(Date.now());
    setNow(Date.now());
    best.current = NOTHING;
    setDrain(0);
    banked.current = 0;
    maxedShown.current = false;
    cardSound();
    buzz("tap");
  }, [backend, initialSeed, isDaily]);

  useEffect(() => {
    void deal();
  }, [deal]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastAct.current > PYRAMID_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [done]);

  // Floating XP trigger
  const spawnFloat = (x: number, y: number, xp: number, tag: string | null) => {
    if (xp <= 0) return;
    const fid = ++floatId.current;
    setFloats((fs) => [...fs, { id: fid, x, y, xp, tag }]);
    setTimeout(() => {
      setFloats((fs) => fs.filter((f) => f.id !== fid));
    }, 1400);
  };

  const applyMove = useCallback((m: PyramidMove, floatPos?: { x: number; y: number }, tag?: string) => {
    if (!k || k.won) return;
    lastAct.current = Date.now();
    const next = applyPyramid(k, m);
    if (next === k) return;

    const nextMoves = [...moves, m];
    setHist((h) => [...h, next]);
    setMoves(nextMoves);
    setSelected(null);
    setHint(null);

    const prevTally = tally ?? NOTHING;
    const nextTally = tallyPyramid(game?.seed ?? 0, nextMoves);
    const g = pyramidGain(best.current, nextTally);
    best.current = g.paid;

    if (floatPos) {
      const xpGained = tallyPyramidXp(g.gained);
      if (xpGained > 0) {
        spawnFloat(floatPos.x, floatPos.y, xpGained, tag ?? null);
      }
    }

    if (next.won && !done) {
      setDone(true);
      winSound();
      buzz("win");
      if (game?.gameId) {
        void act((x) => x.pyramidFinish(game.gameId!, nextMoves, drainRef.current)).then((r) => {
          if (r?.reward) showReward(r.reward);
        });
      }
    }
  }, [k, moves, tally, game, done, act, showReward]);

  const onPyramidCardClick = (idx: number, e: React.MouseEvent) => {
    if (!k || k.won || k.pyramid[idx] === null) return;
    if (!isPyramidUncovered(k.pyramid, idx)) {
      buzz("alert");
      return;
    }

    const card = k.pyramid[idx]!;
    const val = pyramidValue(card);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = { x: rect.left + rect.width / 2, y: rect.top };

    // If card is a King, clear immediately
    if (val === 13) {
      cardSound();
      buzz("bump");
      applyMove({ kind: "king", pyramidIndex: idx }, pos, "King");
      return;
    }

    // If nothing selected, select this card
    if (!selected) {
      click();
      buzz("tap");
      setSelected({ source: "pyramid", index: idx, card });
      return;
    }

    // If this card is already selected, deselect
    if (selected.source === "pyramid" && selected.index === idx) {
      click();
      buzz("tap");
      setSelected(null);
      return;
    }

    // Pair check
    const otherVal = pyramidValue(selected.card);
    if (val + otherVal === 13) {
      cardSound();
      buzz("bump");
      if (selected.source === "pyramid") {
        applyMove({ kind: "pair_pyramid", idxA: selected.index, idxB: idx }, pos, "Pair");
      } else {
        applyMove({ kind: "pair_waste", pyramidIndex: idx }, pos, "Pair");
      }
    } else {
      // Select new card instead
      click();
      buzz("tap");
      setSelected({ source: "pyramid", index: idx, card });
    }
  };

  const onWasteClick = (e: React.MouseEvent) => {
    if (!k || k.won || k.waste.length === 0) return;
    const card = k.waste[k.waste.length - 1];
    const val = pyramidValue(card);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = { x: rect.left + rect.width / 2, y: rect.top };

    // If waste card is King, clear immediately
    if (val === 13) {
      cardSound();
      buzz("bump");
      applyMove({ kind: "waste_king" }, pos, "King");
      return;
    }

    // If nothing selected, select waste card
    if (!selected) {
      click();
      buzz("tap");
      setSelected({ source: "waste", card });
      return;
    }

    // If waste was already selected, deselect
    if (selected.source === "waste") {
      click();
      buzz("tap");
      setSelected(null);
      return;
    }

    // If a pyramid card was selected, check pair
    const otherVal = pyramidValue(selected.card);
    if (val + otherVal === 13) {
      cardSound();
      buzz("bump");
      applyMove({ kind: "pair_waste", pyramidIndex: selected.index }, pos, "Pair");
    } else {
      // Select waste card instead
      click();
      buzz("tap");
      setSelected({ source: "waste", card });
    }
  };

  const onStockClick = () => {
    if (!k || k.won) return;
    if (k.stock.length > 0) {
      cardSound();
      buzz("tap");
      applyMove({ kind: "draw" });
    } else if (k.waste.length > 0) {
      cardSound();
      buzz("bump");
      applyMove({ kind: "recycle" });
    } else {
      buzz("tap");
    }
  };

  const onUndo = () => {
    if (hist.length <= 1 || done) return;
    cardSound();
    buzz("tap");
    setHist((h) => h.slice(0, -1));
    setMoves((m) => m.slice(0, -1));
    setSelected(null);
    setHint(null);
  };

  const onHint = () => {
    if (!k || k.won) return;
    click();
    buzz("tap");
    setDrain((d) => d + 2);
    const found = findPyramidHint(k);
    if (found) {
      setHint(found);
      setTimeout(() => setHint(null), 2500);
    }
  };

  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs < 10 ? "0" : ""}${secs}`;

  const currentXp = Math.max(0, tallyPyramidXp(tally ?? NOTHING) - drain);
  const clearedCount = k?.pyramid.filter((c) => c === null).length ?? 0;

  return (
    <div className="pyr" ref={board}>
      <div className="pyr-felt-rim" />

      {/* Top action bar */}
      <div className="pyr-bar">
        <button
          className="pyr-icon-btn"
          onClick={() => { click(); buzz("tap"); onExit(); }}
          title={t("solo.exit")}
          aria-label={t("solo.exit")}
        >
          ✕
        </button>

        <div className="pyr-hud">
          <div className="pyr-hud-name">
            {t("arc.pyramid.title").toUpperCase()}
            <span className="arcade-trust-pill">{t("solo.free")}</span>
          </div>
          <div className="pyr-hud-stats">
            <span>{timeStr}</span>
            <span className="pyr-dot">•</span>
            <span>{tNodes("pyr.cleared", { b: <b>{clearedCount}/28</b> })}</span>
            <span className="pyr-dot">•</span>
            <span>{tNodes("solo.movesL", { b: <b>{moves.length}</b> })}</span>
            <span className="pyr-dot">•</span>
            <b className="pyr-xp">+{currentXp} XP</b>
            <span className="pyr-dot">•</span>
            <span className="arcade-streak-pill">{streak > 0 ? t("solo.streakD", { n: streak }) : t("solo.day1")}</span>
          </div>
        </div>

        <button
          className="pyr-icon-btn"
          onClick={onHint}
          disabled={done}
          title={t("solo.hintCost")}
          aria-label={t("solo.hint")}
        >
          💡
        </button>

        <button
          className="pyr-icon-btn"
          onClick={onUndo}
          disabled={hist.length <= 1 || done}
          title={t("solo.undo")}
          aria-label={t("solo.undo")}
        >
          ↶
        </button>

        <button
          className={`pyr-icon-btn ${armed ? "armed" : ""}`}
          onClick={() => {
            click();
            buzz("tap");
            if (armed) void deal();
            else {
              setArmed(true);
              setTimeout(() => setArmed(false), 3000);
            }
          }}
          title={armed ? t("solo.newGameQ") : t("solo.newGame")}
          aria-label={t("solo.newGame")}
        >
          {armed ? <span className="pyr-sure">{t("solo.NEWQ")}</span> : "↻"}
        </button>
      </div>

      {banner && (
        <div style={{ position: "absolute", top: 52, left: 0, right: 0, zIndex: 590, display: "flex", justifyContent: "center" }}>
          {banner}
        </div>
      )}

      {/* Main Board */}
      <div className="pyr-board" style={{ top: banner ? 96 : 56 }}>
        {k && (
          <>
            {/* Pyramid cards */}
            {k.pyramid.map((card, idx) => {
              if (card === null) return null;
              const r = pyramidRow(idx);
              const colInRow = idx - ROW_STARTS[r];
              // Horizontal position centering row r over 7 columns
              const colFrac = (6 - r) / 2 + colInRow;
              const left = b.left + colFrac * (b.cw + b.gap);
              const top = 10 + r * b.rowH;
              const uncovered = isPyramidUncovered(k.pyramid, idx);
              const isSelected = selected?.source === "pyramid" && selected.index === idx;

              let isHinted = false;
              if (hint) {
                if (hint.kind === "king" && hint.pyramidIndex === idx) isHinted = true;
                if (hint.kind === "pair_pyramid" && (hint.idxA === idx || hint.idxB === idx)) isHinted = true;
                if (hint.kind === "pair_waste" && hint.pyramidIndex === idx) isHinted = true;
              }

              const rank = cardRank(card);
              const suit = cardSuit(card);
              const red = cardRed(card);

              return (
                <div
                  key={idx}
                  className={`pyr-card ${uncovered ? "" : "covered"} ${red ? "red" : ""} ${isSelected ? "selected" : ""} ${isHinted ? "hinted" : ""}`}
                  style={{
                    left,
                    top,
                    width: b.cw,
                    height: b.ch,
                    zIndex: idx + 10,
                  }}
                  onClick={(e) => onPyramidCardClick(idx, e)}
                >
                  <div className="pyr-corner">
                    <span className="pyr-rank">{RANKS[rank]}</span>
                    <span className="pyr-suit">{SUITS[suit]}</span>
                  </div>
                  {rank >= 11 && rank <= 13 ? (
                    <div className="pyr-court">
                      <b>{RANKS[rank]}</b>
                      <i>{SUITS[suit]}</i>
                    </div>
                  ) : (
                    <div className={`pyr-center ${rank === 1 ? "ace" : ""}`}>
                      {SUITS[suit]}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Bottom Deck Zone: Stock & Waste */}
            {(() => {
              const stockTop = 10 + 6 * b.rowH + b.ch + 16;
              const stockLeft = b.left + 2 * (b.cw + b.gap);
              const wasteLeft = b.left + 3.5 * (b.cw + b.gap);

              const stockHinted = hint?.kind === "draw";
              const recycleHinted = hint?.kind === "recycle";
              const wasteHinted =
                hint?.kind === "waste_king" ||
                (hint?.kind === "pair_waste");

              return (
                <>
                  {/* Stock slot */}
                  <div
                    className="pyr-slot stock"
                    style={{
                      left: stockLeft,
                      top: stockTop,
                      width: b.cw,
                      height: b.ch,
                    }}
                    onClick={onStockClick}
                    role="button"
                    tabIndex={0}
                    aria-label={k.stock.length > 0 ? t("pyr.draw", { n: k.stock.length }) : k.waste.length > 0 ? t("pyr.recycleAria") : t("solo.stockEmpty")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onStockClick();
                      }
                    }}
                  >
                    {k.stock.length > 0 ? (
                      <div
                        className={`pyr-card back ${stockHinted ? "hinted" : ""}`}
                        style={{ width: b.cw, height: b.ch }}
                      >
                        <div className="pyr-back-frame">
                          <div className="pyr-back-mark">H</div>
                        </div>
                      </div>
                    ) : k.waste.length > 0 ? (
                      <div className={`pyr-recycle-btn ${recycleHinted ? "hinted" : ""}`}>
                        <span style={{ fontSize: "16px" }}>↻</span>
                        <span>{t("pyr.recycle")}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", opacity: 0.5 }}>{t("pyr.empty")}</span>
                    )}
                    <span className="pyr-stock-count">{t("solo.left", { n: k.stock.length })}</span>
                  </div>

                  {/* Waste slot */}
                  <div
                    className="pyr-slot waste"
                    style={{
                      left: wasteLeft,
                      top: stockTop,
                      width: b.cw,
                      height: b.ch,
                    }}
                  >
                    {k.waste.length > 0 ? (
                      (() => {
                        const topCard = k.waste[k.waste.length - 1];
                        const rank = cardRank(topCard);
                        const suit = cardSuit(topCard);
                        const red = cardRed(topCard);
                        const isSelected = selected?.source === "waste";

                        return (
                          <div
                            className={`pyr-card ${red ? "red" : ""} ${isSelected ? "selected" : ""} ${wasteHinted ? "hinted" : ""}`}
                            style={{
                              width: b.cw,
                              height: b.ch,
                              zIndex: 100,
                            }}
                            onClick={onWasteClick}
                          >
                            <div className="pyr-corner">
                              <span className="pyr-rank">{RANKS[rank]}</span>
                              <span className="pyr-suit">{SUITS[suit]}</span>
                            </div>
                            {rank >= 11 && rank <= 13 ? (
                              <div className="pyr-court">
                                <b>{RANKS[rank]}</b>
                                <i>{SUITS[suit]}</i>
                              </div>
                            ) : (
                              <div className={`pyr-center ${rank === 1 ? "ace" : ""}`}>
                                {SUITS[suit]}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <span style={{ fontSize: "12px", opacity: 0.4 }}>{t("pyr.waste")}</span>

                    )}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Floating XP numbers */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="pyr-float"
            initial={{ opacity: 0, y: f.y + 10, x: f.x, scale: 0.8 }}
            animate={{ opacity: 1, y: f.y - 30, x: f.x, scale: 1.15 }}
            exit={{ opacity: 0, y: f.y - 60, scale: 0.9 }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          >
            <span>+{f.xp} XP</span>
            {f.tag && <span className="pyr-float-tag">{f.tag}</span>}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Win Celebration */}
      {done && (
        <VictoryModal
          game="pyramid"
          gameTitle="Pyramid Solitaire"
          moves={moves.length}
          time={timeStr}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => { cardSound(); buzz("tap"); void deal(); }}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
        />
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="pyramid"
            gameTitle="Pyramid Solitaire"
            seed={game.seed}
            time={timeStr}
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
