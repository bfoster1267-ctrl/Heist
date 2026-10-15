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

  const colTop = 10 + b.ch + 16;

  // Auto-adjust spacing per column if a column grows tall
  const colOffsets = useMemo(() => {
    if (!k) return [];
    const availableRoom = Math.max(220, b.height - (banner ? 96 : 56) - colTop - 40);
    return k.cols.map((col) => {
      let downH = Math.max(8, Math.round(b.ch * 0.16));
      let upH = Math.max(16, Math.round(b.ch * 0.28));
      const downCount = col.down.length;
      const upCount = col.up.length;
      const needed = downCount * downH + Math.max(0, upCount - 1) * upH + b.ch;
      if (needed > availableRoom && downCount + upCount > 1) {
        const minUpH = Math.max(14, Math.round(b.ch * 0.14));
        const minDownH = Math.max(6, Math.round(b.ch * 0.08));

        if (upCount > 1) {
          const targetUpH = Math.floor((availableRoom - b.ch - downCount * downH) / (upCount - 1));
          upH = Math.max(minUpH, Math.min(upH, targetUpH));
        }

        const stillNeeded = downCount * downH + Math.max(0, upCount - 1) * upH + b.ch;
        if (stillNeeded > availableRoom && downCount > 0) {
          const targetDownH = Math.floor((availableRoom - b.ch - Math.max(0, upCount - 1) * upH) / downCount);
          downH = Math.max(minDownH, Math.min(downH, targetDownH));
        }
      }
      return { downH, upH };
    });
  }, [k, b.height, b.ch, colTop, banner]);

  const maxColBottom = useMemo(() => {
    if (!k || !colOffsets.length) return colTop + b.ch + 40;
    return k.cols.reduce((max, col, idx) => {
      const off = colOffsets[idx] ?? { downH: b.downH, upH: b.upH };
      const bottom = colTop + col.down.length * off.downH + Math.max(0, col.up.length - 1) * off.upH + b.ch + 40;
      return Math.max(max, bottom);
    }, colTop + b.ch + 40);
  }, [k, colOffsets, colTop, b.ch, b.downH, b.upH]);

  const getValidTableauDestinations = useCallback(
    (s: YukonState, fromCol: number, rootCard: PlayingCard, isKingBase = false) => {
      const dests: number[] = [];
      for (let to = 0; to < 7; to++) {
        if (to === fromCol) continue;
        const colTo = s.cols[to];
        if (colTo.up.length === 0) {
          if (cardRank(rootCard) === 13 && !isKingBase) {
            dests.push(to);
          }
        } else {
          const topDest = colTo.up[colTo.up.length - 1];
          if (fitsYukon(rootCard, topDest)) {
            dests.push(to);
          }
        }
      }
      return dests;
    },
    []
  );

  // Handle click on a face-up card in column `colIdx` at position `idx` in `up`
  const onCardClick = (colIdx: number, idx: number, card: PlayingCard, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!k || yukonWon(k)) return;
    const col = k.cols[colIdx];
    const isTopCard = idx === col.up.length - 1;
    const count = col.up.length - idx;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = { x: rect.left + rect.width / 2, y: rect.top };

    // Case 1: No card is selected
    if (!selected) {
      // 1a. If exposed bottom card can move to foundation, auto-move!
      if (isTopCard) {
        const suit = cardSuit(card);
        if (fitsYukonFoundation(card, k.found[suit])) {
          cardSound();
          buzz("bump");
          applyMoveStr(`t${colIdx}>f`, pos, "Foundation");
          return;
        }
      }

      // 1b. Check if this stack can legally move to a single valid tableau column
      const isKingBase = idx === 0 && col.down.length === 0 && cardRank(card) === 13;
      const validDests = getValidTableauDestinations(k, colIdx, card, isKingBase);

      if (validDests.length === 1) {
        // Exactly one legal destination column -> auto-move!
        const toCol = validDests[0];
        cardSound();
        buzz("bump");
        const isKing = cardRank(card) === 13 && k.cols[toCol].up.length === 0;
        applyMoveStr(`t${colIdx}>t${toCol}:${count}`, pos, isKing ? "King" : "Placed");
        return;
      }

      // Multiple valid destinations or none: select this stack for tap-to-destination
      click();
      buzz("tap");
      setSelected({ fromCol: colIdx, indexInUp: idx, count, rootCard: card });
      return;
    }

    // Case 2: A stack is already selected
    // 2a. Clicking the exact same card in the selected stack -> deselect
    if (selected.fromCol === colIdx && selected.indexInUp === idx) {
      click();
      buzz("tap");
      setSelected(null);
      return;
    }

    // 2b. Clicking another card in the same column -> switch selection to that stack
    if (selected.fromCol === colIdx) {
      click();
      buzz("tap");
      setSelected({ fromCol: colIdx, indexInUp: idx, count, rootCard: card });
      return;
    }

    // 2c. Clicking in a different column -> try placing selected stack onto that column!
    if (col.up.length > 0) {
      const topDest = col.up[col.up.length - 1];
      if (fitsYukon(selected.rootCard, topDest)) {
        cardSound();
        buzz("bump");
        applyMoveStr(`t${selected.fromCol}>t${colIdx}:${selected.count}`, pos, "Placed");
        return;
      }
    } else {
      // Empty column takes King
      if (cardRank(selected.rootCard) === 13) {
        cardSound();
        buzz("bump");
        applyMoveStr(`t${selected.fromCol}>t${colIdx}:${selected.count}`, pos, "King");
        return;
      }
    }

    // 2d. Otherwise switch selection to the tapped card/stack
    click();
    buzz("tap");
    setSelected({ fromCol: colIdx, indexInUp: idx, count, rootCard: card });
  };

  // Handle click on an empty column slot
  const onEmptyColClick = (colIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
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
    e.stopPropagation();
    if (!k || yukonWon(k)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = { x: rect.left + rect.width / 2, y: rect.top };

    // If a single card is selected and fits this foundation:
    if (selected && selected.count === 1) {
      if (fitsYukonFoundation(selected.rootCard, k.found[suitIdx])) {
        cardSound();
        buzz("bump");
        applyMoveStr(`t${selected.fromCol}>f`, pos, "Foundation");
        return;
      }
    }

    // If no card is selected, check if any column's top card fits this foundation
    if (!selected) {
      for (let c = 0; c < 7; c++) {
        const col = k.cols[c];
        if (col.up.length > 0) {
          const topCard = col.up[col.up.length - 1];
          if (cardSuit(topCard) === suitIdx && fitsYukonFoundation(topCard, k.found[suitIdx])) {
            cardSound();
            buzz("bump");
            applyMoveStr(`t${c}>f`, pos, "Foundation");
            return;
          }
        }
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
          onClick={() => { click(); buzz("tap"); onExit(); }}
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
            click();
            buzz("tap");
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
      <div
        className="yk-board"
        style={{ top: banner ? 96 : 56 }}
        onClick={() => setSelected(null)}
      >
        {k && (
          <>
            {/* Top row: 4 Foundations at columns 3, 4, 5, 6 */}
            {[0, 1, 2, 3].map((suit) => {
              const colSlot = 3 + suit;
              const left = b.left + colSlot * (b.cw + b.gap);
              const pile = k.found[suit];
              const topCard = pile.length > 0 ? pile[pile.length - 1] : null;

              const isFoundationHinted = Boolean(
                hint?.isFoundation &&
                hint.sourceCol !== undefined &&
                k.cols[hint.sourceCol]?.up.length > 0 &&
                cardSuit(k.cols[hint.sourceCol].up[k.cols[hint.sourceCol].up.length - 1]) === suit
              );

              return (
                <div
                  key={`found-${suit}`}
                  className={`yk-slot foundation ${isFoundationHinted ? "hinted" : ""}`}
                  style={{
                    left,
                    top: 10,
                    width: b.cw,
                    height: b.ch,
                  }}
                  onClick={(e) => onFoundationClick(suit, e)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${SUITS[suit]} foundation pile (${pile.length} cards)`}
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
              const off = colOffsets[colIdx] ?? { downH: b.downH, upH: b.upH };

              return (
                <div key={`col-${colIdx}`}>
                  {/* Empty column slot */}
                  {col.down.length === 0 && col.up.length === 0 && (
                    <div
                      className={`yk-slot column ${hint?.targetCol === colIdx ? "hinted" : ""}`}
                      style={{
                        left: colLeft,
                        top: colTop,
                        width: b.cw,
                        height: b.ch,
                      }}
                      onClick={(e) => onEmptyColClick(colIdx, e)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Empty column ${colIdx + 1}, Kings can be placed here`}
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
                        top: colTop + downIdx * off.downH,
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
                    const cardTop = colTop + col.down.length * off.downH + upIdx * off.upH;

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

            {/* Scroll anchor spacer so tall columns can smoothly scroll without bottom clipping */}
            <div
              style={{
                position: "absolute",
                top: maxColBottom,
                left: 0,
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
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
            <button className="yk-win-btn" onClick={() => { cardSound(); buzz("tap"); void deal(); }}>
              PLAY AGAIN
            </button>
            <button className="yk-win-btn secondary" style={{ marginTop: 8 }} onClick={() => { click(); buzz("tap"); onExit(); }}>
              LOBBY
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
