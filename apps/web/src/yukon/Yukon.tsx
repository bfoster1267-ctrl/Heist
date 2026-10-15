// Yukon Solitaire (7 cascades, 4 foundations, any face-up stack moves if root fits).
// Full feature parity: hint, undo, queue banner, floating XP, haptics, sounds, win celebration.

import {
  applyYukon, cardRank, cardRed, cardSuit, dealYukon, findYukonHint, fitsYukon,
  fitsYukonFoundation, tallyYukon, tallyYukonXp, yukonGain, yukonPay, yukonWon,
  YUKON_DAY_XP, YUKON_IDLE_S, yukonRoom, YUKON_XP, type PlayingCard,
  type YukonHint, type YukonState, type YukonTally,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import "./yukon.css";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: YukonTally = { foundations: 0, unturned: 0, moves: 0, won: false };

function useBoard() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const width = Math.min(size.w, 760);
  const gap = Math.max(3, Math.round(width * 0.012));
  const cw = Math.floor((width - gap * 8) / 7);
  const ch = Math.round(cw * 1.4);
  const downH = Math.max(10, Math.round(ch * 0.16));
  const upH = Math.max(18, Math.round(ch * 0.28));
  const boardLeft = Math.round((size.w - width) / 2) + gap;
  return { width, height: size.h, gap, cw, ch, downH, upH, left: boardLeft };
}

interface SelectedStack {
  fromCol: number;
  indexInUp: number;
  count: number;
  rootCard: PlayingCard;
}

export function Yukon({ onExit, onHeist, banner }: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
}) {
  const { backend, act, showReward, me } = useAccount();
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [hist, setHist] = useState<YukonState[]>([]);
  const [moves, setMoves] = useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedStack | null>(null);
  const [hint, setHint] = useState<YukonHint | null>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const b = useBoard();
  const board = useRef<HTMLDivElement>(null);
  const k = hist[hist.length - 1];
  const reduce = reducedMotion();

  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallyYukon(game.seed, moves);
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
  const live = useRef({ game, moves });
  live.current = { game, moves };

  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    const xp = Math.max(0, tallyYukonXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.yukonBank(g.gameId!, ms, drainRef.current));
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
    dayLeft.current = me ? yukonRoom(me.progress, Date.now()) : YUKON_DAY_XP;
  }, [me]);

  const deal = useCallback(async () => {
    const g = backend ? await backend.yukonStart().catch(() => null) : null;
    const seed = g ? g.seed : Math.floor(Math.random() * 2 ** 31);
    const initial = dealYukon(seed);
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
    cardSound();
    buzz("tap");
  }, [backend]);

  useEffect(() => {
    void deal();
  }, [deal]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastAct.current > YUKON_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [done]);

  const spawnFloat = (x: number, y: number, xp: number, tag: string | null) => {
    if (xp <= 0) return;
    const fid = ++floatId.current;
    setFloats((fs) => [...fs, { id: fid, x, y, xp, tag }]);
    setTimeout(() => {
      setFloats((fs) => fs.filter((f) => f.id !== fid));
    }, 1400);
  };

  const applyMoveStr = useCallback((m: string, floatPos?: { x: number; y: number }, tag?: string) => {
    if (!k || yukonWon(k)) return;
    lastAct.current = Date.now();
    const next = applyYukon(k, m);
    if (next === k) return;

    const nextMoves = [...moves, m];
    setHist((h) => [...h, next]);
    setMoves(nextMoves);
    setSelected(null);
    setHint(null);

    const prevTally = tally ?? NOTHING;
    const nextTally = tallyYukon(game?.seed ?? 0, nextMoves);
    const g = yukonGain(best.current, nextTally);
    best.current = g.paid;

    if (floatPos) {
      const xpGained = tallyYukonXp(g.gained);
      if (xpGained > 0) {
        spawnFloat(floatPos.x, floatPos.y, xpGained, tag ?? null);
      }
    }

    if (yukonWon(next) && !done) {
      setDone(true);
      winSound();
      buzz("win");
      if (game?.gameId) {
        void act((x) => x.yukonFinish(game.gameId!, nextMoves, drainRef.current)).then((r) => {
          if (r?.reward) showReward(r.reward);
        });
      }
    }
  }, [k, moves, tally, game, done, act, showReward]);

  // Handle click on a face-up card in column `colIdx` at position `idx` in `up`
  const onCardClick = (colIdx: number, idx: number, card: PlayingCard, e: React.MouseEvent) => {
    if (!k || yukonWon(k)) return;
    const col = k.cols[colIdx];
    const isTopCard = idx === col.up.length - 1;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = { x: rect.left + rect.width / 2, y: rect.top };

    // 1. If top card of column and no card is selected, check if it can go to foundation
    if (!selected && isTopCard) {
      const suit = cardSuit(card);
      if (fitsYukonFoundation(card, k.found[suit])) {
        cardSound();
        buzz("bump");
        applyMoveStr(`t${colIdx}>f`, pos, "Foundation");
        return;
      }
    }

    // 2. If no card selected, select this stack
    if (!selected) {
      click();
      buzz("tap");
      const count = col.up.length - idx;
      setSelected({ fromCol: colIdx, indexInUp: idx, count, rootCard: card });
      return;
    }

    // 3. If clicking the exact same card in the selected stack, deselect
    if (selected.fromCol === colIdx && selected.indexInUp === idx) {
      click();
      buzz("tap");
      setSelected(null);
      return;
    }

    // 4. Try placing selected stack onto this card (if it's the top card of another column)
    if (selected.fromCol !== colIdx && isTopCard) {
      if (fitsYukon(selected.rootCard, card)) {
        cardSound();
        buzz("bump");
        applyMoveStr(`t${selected.fromCol}>t${colIdx}:${selected.count}`, pos, "Placed");
        return;
      }
    }

    // 5. Otherwise switch selection to this card/stack
    click();
    buzz("tap");
    const count = col.up.length - idx;
    setSelected({ fromCol: colIdx, indexInUp: idx, count, rootCard: card });
  };

  // Handle click on an empty column slot
  const onEmptyColClick = (colIdx: number, e: React.MouseEvent) => {
    if (!k || yukonWon(k) || !selected) return;
    if (cardRank(selected.rootCard) === 13) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos = { x: rect.left + rect.width / 2, y: rect.top };
      cardSound();
      buzz("bump");
      applyMoveStr(`t${selected.fromCol}>t${colIdx}:${selected.count}`, pos, "King");
    }
  };

  // Handle click on a foundation pile
  const onFoundationClick = (suitIdx: number, e: React.MouseEvent) => {
    if (!k || yukonWon(k) || !selected) return;
    // Foundation only accepts a single card
    if (selected.count === 1) {
      if (fitsYukonFoundation(selected.rootCard, k.found[suitIdx])) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = { x: rect.left + rect.width / 2, y: rect.top };
        cardSound();
        buzz("bump");
        applyMoveStr(`t${selected.fromCol}>f`, pos, "Foundation");
      }
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
    if (!k || yukonWon(k)) return;
    click();
    buzz("tap");
    setDrain((d) => d + 2);
    const found = findYukonHint(k);
    if (found) {
      setHint(found);
      setTimeout(() => setHint(null), 2500);
    }
  };

  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs < 10 ? "0" : ""}${secs}`;

  const currentXp = Math.max(0, tallyYukonXp(tally ?? NOTHING) - drain);
  const foundationTotal = k ? k.found.reduce((sum, f) => sum + f.length, 0) : 0;

  return (
    <div className="yk" ref={board}>
      <div className="yk-felt-rim" />

      {/* Top action bar */}
      <div className="yk-bar">
        <button
          className="yk-icon-btn"
          onClick={onExit}
          title="Exit"
          aria-label="Exit"
        >
          ✕
        </button>

        <div className="yk-hud">
          <div className="yk-hud-name">YUKON</div>
          <div className="yk-hud-stats">
            <span>{timeStr}</span>
            <span className="yk-dot">•</span>
            <span>Foundations: <b>{foundationTotal}/52</b></span>
            <span className="yk-dot">•</span>
            <span>Moves: <b>{moves.length}</b></span>
            <span className="yk-dot">•</span>
            <b className="yk-xp">+{currentXp} XP</b>
          </div>
        </div>

        <button
          className="yk-icon-btn"
          onClick={onHint}
          disabled={done}
          title="Hint (-2 XP)"
          aria-label="Hint"
        >
          💡
        </button>

        <button
          className="yk-icon-btn"
          onClick={onUndo}
          disabled={hist.length <= 1 || done}
          title="Undo"
          aria-label="Undo"
        >
          ↶
        </button>

        <button
          className={`yk-icon-btn ${armed ? "armed" : ""}`}
          onClick={() => {
            if (armed) void deal();
            else {
              setArmed(true);
              setTimeout(() => setArmed(false), 3000);
            }
          }}
          title={armed ? "Deal new game?" : "New Game"}
          aria-label="New Game"
        >
          {armed ? <span className="yk-sure">NEW?</span> : "↻"}
        </button>
      </div>

      {banner && (
        <div style={{ position: "absolute", top: 52, left: 0, right: 0, zIndex: 590, display: "flex", justifyContent: "center" }}>
          {banner}
        </div>
      )}

      {/* Main Board */}
      <div className="yk-board" style={{ top: banner ? 96 : 56 }}>
        {k && (
          <>
            {/* Top row: 4 Foundations at columns 3, 4, 5, 6 */}
            {[0, 1, 2, 3].map((suit) => {
              const colSlot = 3 + suit;
              const left = b.left + colSlot * (b.cw + b.gap);
              const pile = k.found[suit];
              const topCard = pile.length > 0 ? pile[pile.length - 1] : null;

              return (
                <div
                  key={`found-${suit}`}
                  className="yk-slot foundation"
                  style={{
                    left,
                    top: 10,
                    width: b.cw,
                    height: b.ch,
                  }}
                  onClick={(e) => onFoundationClick(suit, e)}
                >
                  {topCard !== null ? (
                    (() => {
                      const rank = cardRank(topCard);
                      const s = cardSuit(topCard);
                      const red = cardRed(topCard);
                      return (
                        <div
                          className={`yk-card ${red ? "red" : ""}`}
                          style={{ width: b.cw, height: b.ch }}
                        >
                          <div className="yk-corner">
                            <span className="yk-rank">{RANKS[rank]}</span>
                            <span className="yk-suit">{SUITS[s]}</span>
                          </div>
                          {rank >= 11 && rank <= 13 ? (
                            <div className="yk-court">
                              <b>{RANKS[rank]}</b>
                              <i>{SUITS[s]}</i>
                            </div>
                          ) : (
                            <div className={`yk-center ${rank === 1 ? "ace" : ""}`}>
                              {SUITS[s]}
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <span>{SUITS[suit]}</span>
                  )}
                </div>
              );
            })}

            {/* 7 Tableau Columns */}
            {k.cols.map((col, colIdx) => {
              const colLeft = b.left + colIdx * (b.cw + b.gap);
              const colTop = 10 + b.ch + 16;

              return (
                <div key={`col-${colIdx}`}>
                  {/* Empty column slot */}
                  {col.down.length === 0 && col.up.length === 0 && (
                    <div
                      className="yk-slot column"
                      style={{
                        left: colLeft,
                        top: colTop,
                        width: b.cw,
                        height: b.ch,
                      }}
                      onClick={(e) => onEmptyColClick(colIdx, e)}
                    >
                      K
                    </div>
                  )}

                  {/* Face-down cards */}
                  {col.down.map((_, downIdx) => (
                    <div
                      key={`down-${colIdx}-${downIdx}`}
                      className="yk-card back"
                      style={{
                        left: colLeft,
                        top: colTop + downIdx * b.downH,
                        width: b.cw,
                        height: b.ch,
                        zIndex: downIdx + 1,
                      }}
                    >
                      <div className="yk-back-frame">
                        <div className="yk-back-mark">H</div>
                      </div>
                    </div>
                  ))}

                  {/* Face-up cards */}
                  {col.up.map((card, upIdx) => {
                    const rank = cardRank(card);
                    const suit = cardSuit(card);
                    const red = cardRed(card);
                    const cardTop = colTop + col.down.length * b.downH + upIdx * b.upH;

                    const isSelected =
                      selected?.fromCol === colIdx && upIdx >= selected.indexInUp;

                    let isHinted = false;
                    if (hint) {
                      if (hint.sourceCol === colIdx) {
                        const hintStart = col.up.length - hint.count;
                        if (upIdx >= hintStart) isHinted = true;
                      }
                      if (hint.targetCol === colIdx && upIdx === col.up.length - 1) {
                        isHinted = true;
                      }
                    }

                    return (
                      <div
                        key={`up-${colIdx}-${upIdx}`}
                        className={`yk-card ${red ? "red" : ""} ${isSelected ? "selected" : ""} ${isHinted ? "hinted" : ""}`}
                        style={{
                          left: colLeft,
                          top: cardTop,
                          width: b.cw,
                          height: b.ch,
                          zIndex: col.down.length + upIdx + (isSelected ? 300 : 10),
                        }}
                        onClick={(e) => onCardClick(colIdx, upIdx, card, e)}
                      >
                        <div className="yk-corner">
                          <span className="yk-rank">{RANKS[rank]}</span>
                          <span className="yk-suit">{SUITS[suit]}</span>
                        </div>
                        {rank >= 11 && rank <= 13 ? (
                          <div className="yk-court">
                            <b>{RANKS[rank]}</b>
                            <i>{SUITS[suit]}</i>
                          </div>
                        ) : (
                          <div className={`yk-center ${rank === 1 ? "ace" : ""}`}>
                            {SUITS[suit]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Floating XP numbers */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="yk-float"
            initial={{ opacity: 0, y: f.y + 10, x: f.x, scale: 0.8 }}
            animate={{ opacity: 1, y: f.y - 30, x: f.x, scale: 1.15 }}
            exit={{ opacity: 0, y: f.y - 60, scale: 0.9 }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          >
            <span>+{f.xp} XP</span>
            {f.tag && <span className="yk-float-tag">{f.tag}</span>}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Win Celebration */}
      {done && (
        <motion.div
          className="yk-win"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="yk-win-card">
            <div className="yk-win-title">SOLVED!</div>
            <div className="yk-win-sub">
              You cleared all 4 foundations in <b>{moves.length} moves</b> and <b>{timeStr}</b>.
            </div>
            <button className="yk-win-btn" onClick={() => void deal()}>
              PLAY AGAIN
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
