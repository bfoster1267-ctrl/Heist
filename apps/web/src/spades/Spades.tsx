// Spades vs Bots (4-player trick-taking card game with bidding and Spade trumps)
// Casino-noir table, card stock with gilded court frames, Nil/contract bidding dial,
// step-by-step trick animations, bag tracking, and VictoryModal integration.

import {
  applySpadesBid, applySpadesCard, isSpadesLevel, newSpades,
  spadesBotCard, spadesLegalPlays, spadesRank, spadesSuit, type SpadesLevel,
  type SpadesSeat, type SpadesState,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { VictoryModal } from "../arcade/VictoryModal";
import { buzz } from "../haptics";
import { t } from "../i18n";
import { card as cardSound, chip, click, foundationChime, lose as loseSound, win as winSound } from "../sound";
import "./spades.css";

const SUIT_CHARS = ["♣", "♦", "♠", "♥"] as const;
const RANK_CHARS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

const BOT_NAMES: Record<SpadesLevel, [string, string, string]> = {
  rookie: ["Barnaby", "Penny", "Giles"],
  pro: ["Jasper", "Vesper", "Silas"],
  boss: ["The Baron", "Madame Rouge", "The Don"],
};

const LEVEL_STORAGE_KEY = "heist.spades.level";

function savedLevel(): SpadesLevel {
  try {
    const s = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (isSpadesLevel(s)) return s;
  } catch {
    /* fine */
  }
  return "pro";
}

interface FloatPill {
  id: number;
  text: string;
}

export interface SpadesProps {
  initialSeed?: number;
  isDaily?: boolean;
  onExit: () => void;
  banner?: ReactNode;
  onHeist?: () => void;
}

export function Spades({ initialSeed, isDaily = false, onExit, banner, onHeist }: SpadesProps) {
  const { me, backend, act } = useAccount();

  const [level, setLevel] = useState<SpadesLevel>(() => (isDaily ? "pro" : savedLevel()));
  const [picker, setPicker] = useState(false);
  const [trickBanner, setTrickBanner] = useState<string | null>(null);
  const [floats, setFloats] = useState<FloatPill[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [moves, setMoves] = useState<number[][]>([]);

  // Local game state
  const [state, setState] = useState<SpadesState>(() => {
    const seed = initialSeed ?? Math.floor(Math.random() * 2 ** 31);
    return newSpades(seed, isDaily ? "pro" : level);
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const isPendingBot = useRef(false);

  // Initialize or deal hand
  const deal = useCallback(
    async (targetLevel: SpadesLevel, targetSeed?: number) => {
      setTrickBanner(null);
      setMoves([]);
      const s = targetSeed ?? Math.floor(Math.random() * 2 ** 31);
      const lv = isDaily ? "pro" : targetLevel;
      const initial = newSpades(s, lv);
      setState(initial);

      if (backend) {
        try {
          const res = await backend.spadesStart(s, isDaily, lv);
          if (res) setGameId(res.gameId);
        } catch {
          /* offline or local fallback */
        }
      }
    },
    [backend, isDaily],
  );

  useEffect(() => {
    void deal(level, initialSeed);
  }, [deal, level, initialSeed]);

  // Show floating XP notification
  const addFloat = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setFloats((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setFloats((prev) => prev.filter((f) => f.id !== id));
    }, 1500);
  }, []);

  // Bot play automated runner with natural pacing for trick plays
  useEffect(() => {
    const s = state;
    if (s.phase !== "play") return;
    if (s.turn === 0) return; // Your turn
    if (isPendingBot.current) return;

    isPendingBot.current = true;
    const timer = setTimeout(() => {
      isPendingBot.current = false;
      const current = stateRef.current;
      if (current.phase !== "play" || current.turn === 0) return;

      const botCard = spadesBotCard(current, current.level, current.seed);
      if (botCard < 0) return;

      cardSound();
      buzz("tap");
      const next = applySpadesCard(current, botCard);
      setState(next);

      // Check if trick just completed
      if (next.lastTrick && next.trick.length === 0) {
        handleTrickCompleted(next);
      }
    }, 380);

    return () => {
      clearTimeout(timer);
      isPendingBot.current = false;
    };
  }, [state]);

  // Handle a trick completion announcement & scoring
  const handleTrickCompleted = (nextState: SpadesState) => {
    const last = nextState.lastTrick;
    if (!last) return;

    const winnerSeat = last.winner;
    const botNames = BOT_NAMES[nextState.level];
    const winnerName = winnerSeat === 0 ? "You" : botNames[winnerSeat - 1];

    if (winnerSeat === 0) {
      foundationChime((nextState.trickNo % 10) + 1);
      addFloat("+3 XP Book");
    } else {
      chip();
    }

    setTrickBanner(`${winnerName} won trick ${nextState.trickNo}`);

    setTimeout(() => {
      setTrickBanner(null);
    }, 1200);

    if (nextState.phase === "done") {
      handleGameOver(nextState);
    }
  };

  // Game over settlement
  const handleGameOver = async (finalState: SpadesState) => {
    const won = finalState.winner === 0;
    const currentMoves = movesRef.current;

    if (finalState.madeContract) {
      foundationChime(12);
      addFloat("CONTRACT MET! +20 XP");
    }

    if (won) {
      winSound();
      addFloat("+100 XP Victory");
    } else {
      loseSound();
    }

    if (gameId) {
      try {
        await act((b) => b.spadesFinish(gameId, currentMoves, 0));
      } catch {
        /* fine */
      }
    }
  };

  // South selects a bid
  const handleChooseBid = (bid: number) => {
    if (state.phase !== "bid" || state.bids[0] !== null) return;
    chip();
    buzz("bump");

    const newMoves = [...movesRef.current, [bid]];
    setMoves(newMoves);

    const next = applySpadesBid(state, bid);
    setState(next);
  };

  // South plays a card
  const handlePlayCard = (cardId: number) => {
    if (state.phase !== "play" || state.turn !== 0) return;
    const legal = spadesLegalPlays(state, 0);
    if (!legal.includes(cardId)) return;

    cardSound();
    buzz("tap");

    const newMoves = [...movesRef.current, [cardId]];
    setMoves(newMoves);

    const next = applySpadesCard(state, cardId);
    setState(next);

    if (next.lastTrick && next.trick.length === 0) {
      handleTrickCompleted(next);
    }
  };

  const legalCards = useMemo(() => {
    if (state.phase !== "play" || state.turn !== 0) return [];
    return spadesLegalPlays(state, 0);
  }, [state]);

  const botNames = BOT_NAMES[state.level];
  const southHand = state.hands[0];
  const isDone = state.phase === "done";
  const won = isDone && state.winner === 0;

  return (
    <div className="spd-root">
      <div className="spd-rim" />

      {/* Floating XP Pills */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="spd-float"
            initial={{ opacity: 0, y: 30, scale: 0.8 }}
            animate={{ opacity: 1, y: -20, scale: 1.1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            style={{ left: "calc(50% - 80px)", bottom: "26%" }}
          >
            {f.text}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Header Bar */}
      <div className="spd-bar">
        <div className="spd-bar-left">
          <button
            type="button"
            className="spd-btn-icon"
            onClick={() => {
              click();
              onExit();
            }}
            title={t("common.back_to_lobby", "Back to Lobby")}
          >
            ←
          </button>
          <div className="spd-title-pill">
            <span className="spd-title-text">{t("game.spades", "SPADES")}</span>
            {isDaily ? (
              <span className="spd-badge daily">Daily Deal</span>
            ) : (
              <button
                type="button"
                className="spd-badge"
                style={{ cursor: "pointer", background: "none", border: "none", color: "inherit", padding: 0 }}
                onClick={() => {
                  click();
                  setPicker(true);
                }}
              >
                {state.level.toUpperCase()} ▾
              </button>
            )}
            {state.spadesBroken && <span className="spd-badge trump">♠ Broken</span>}
          </div>
        </div>

        <div className="spd-bar-right">
          <span className="spd-badge">
            Trick {Math.min(13, state.trickNo + 1)} / 13
          </span>
        </div>
      </div>

      {banner}

      {/* Table Felt */}
      <div className="spd-table">
        {/* North (Seat 2) */}
        <div className="spd-north">
          <div className={`spd-seat-card ${state.turn === 2 && !isDone && state.phase === "play" ? "active-turn" : ""}`}>
            <span className="spd-seat-name">{botNames[1]} (N)</span>
            <span className={`spd-seat-contract ${state.bids[2] !== null && state.tricksWon[2] >= state.bids[2] ? "made" : ""}`}>
              {state.bids[2] === null ? "Bidding..." : `${state.tricksWon[2]} / ${state.bids[2]} books`}
            </span>
            <span className="spd-seat-score">{state.scores[2]} pts</span>
          </div>
          <div className="spd-opp-fan">
            {state.hands[2].map((_, i) => (
              <div key={i} className="spd-opp-card-back" />
            ))}
          </div>
        </div>

        {/* Middle Row (West, Trick Center, East) */}
        <div className="spd-middle-row">
          {/* West (Seat 1) */}
          <div className="spd-west">
            <div className={`spd-seat-card ${state.turn === 1 && !isDone && state.phase === "play" ? "active-turn" : ""}`}>
              <span className="spd-seat-name">{botNames[0]} (W)</span>
              <span className={`spd-seat-contract ${state.bids[1] !== null && state.tricksWon[1] >= state.bids[1] ? "made" : ""}`}>
                {state.bids[1] === null ? "Bidding..." : `${state.tricksWon[1]} / ${state.bids[1]} books`}
              </span>
              <span className="spd-seat-score">{state.scores[1]} pts</span>
            </div>
            <div className="spd-opp-fan vertical">
              {state.hands[1].map((_, i) => (
                <div key={i} className="spd-opp-card-back" />
              ))}
            </div>
          </div>

          {/* Trick Felt Center */}
          <div className="spd-trick-ring">
            {/* Trick Cards on Felt */}
            {state.trick.map((t) => (
              <div key={t.card} className={`spd-trick-card-slot seat-${t.seat}`}>
                <SpadesCardView card={t.card} />
              </div>
            ))}

            {/* Trick Winner Announcement Banner */}
            <AnimatePresence>
              {trickBanner && (
                <motion.div
                  className="spd-trick-banner"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  {trickBanner}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* East (Seat 3) */}
          <div className="spd-east">
            <div className={`spd-seat-card ${state.turn === 3 && !isDone && state.phase === "play" ? "active-turn" : ""}`}>
              <span className="spd-seat-name">{botNames[2]} (E)</span>
              <span className={`spd-seat-contract ${state.bids[3] !== null && state.tricksWon[3] >= state.bids[3] ? "made" : ""}`}>
                {state.bids[3] === null ? "Bidding..." : `${state.tricksWon[3]} / ${state.bids[3]} books`}
              </span>
              <span className="spd-seat-score">{state.scores[3]} pts</span>
            </div>
            <div className="spd-opp-fan vertical">
              {state.hands[3].map((_, i) => (
                <div key={i} className="spd-opp-card-back" />
              ))}
            </div>
          </div>
        </div>

        {/* South (Seat 0 / You) */}
        <div className="spd-south">
          {/* Bid Selector when phase === "bid" and you haven't bid yet */}
          {state.phase === "bid" && state.bids[0] === null && (
            <div className="spd-bid-box">
              <span className="spd-bid-title">Bid Your Contract (How many books will you win?)</span>
              <div className="spd-bid-grid">
                <button
                  type="button"
                  className="spd-bid-btn nil"
                  onClick={() => handleChooseBid(0)}
                  title="Nil: win 0 tricks (+50 pts bonus, -50 if broken)"
                >
                  Nil (0)
                </button>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="spd-bid-btn"
                    onClick={() => handleChooseBid(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* South Seat Info Badge */}
          <div className={`spd-seat-card ${state.turn === 0 && !isDone && state.phase === "play" ? "active-turn" : ""}`}>
            <span className="spd-seat-name">{me?.name || "You"} (South)</span>
            <span className={`spd-seat-contract ${state.bids[0] !== null && state.tricksWon[0] >= state.bids[0] ? "made" : ""}`}>
              {state.bids[0] === null ? "Your Bid" : `${state.tricksWon[0]} / ${state.bids[0]} books`}
            </span>
            <span className="spd-seat-score">{state.scores[0]} pts</span>
          </div>

          {/* Hand Cards */}
          <div className="spd-hand">
            {southHand.map((c) => {
              const isLegal = state.phase === "play" && state.turn === 0 && legalCards.includes(c);
              const isIllegal = state.phase === "play" && state.turn === 0 && !legalCards.includes(c);

              return (
                <SpadesCardView
                  key={c}
                  card={c}
                  legal={isLegal}
                  illegal={isIllegal}
                  onClick={() => {
                    if (state.phase === "play") {
                      handlePlayCard(c);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Difficulty Picker Modal */}
      <AnimatePresence>
        {picker && (
          <div className="spd-picker-overlay" onClick={() => setPicker(false)}>
            <motion.div
              className="spd-picker-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="spd-picker-title">Select Bot Strength</h2>
              <p className="spd-picker-desc">Choose your 3 opponents for Spades.</p>

              <div className="spd-bot-list">
                {(["rookie", "pro", "boss"] as const).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className={`spd-bot-btn ${level === lv ? "selected" : ""}`}
                    onClick={() => {
                      click();
                      setLevel(lv);
                      try {
                        localStorage.setItem(LEVEL_STORAGE_KEY, lv);
                      } catch {
                        /* fine */
                      }
                      setPicker(false);
                      void deal(lv);
                    }}
                  >
                    <div className="spd-bot-btn-left">
                      <span className="spd-bot-name">
                        {lv === "rookie" ? "Rookie Bots" : lv === "pro" ? "Pro Bots" : "Boss Bots"}
                      </span>
                      <span className="spd-bot-blurb">
                        {lv === "rookie"
                          ? "Barnaby, Penny, Giles. Casual bidding."
                          : lv === "pro"
                          ? "Jasper, Vesper, Silas. Accurate book calls and cuts."
                          : "The Baron, Madame Rouge, The Don. Relentless bag management."}
                      </span>
                    </div>
                    <span className="spd-bot-btn-icon">{lv === "rookie" ? "♟" : lv === "pro" ? "♞" : "♛"}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Victory / Defeat Modal */}
      {isDone && (
        <VictoryModal
          game="spades"
          gameTitle={`Spades vs ${level.charAt(0).toUpperCase() + level.slice(1)} Bots`}
          moves={state.tricksWon[0]}
          score={state.scores[0]}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => {
            click();
            void deal(level);
          }}
          onExit={onExit}
          onHeist={onHeist}
        />
      )}
    </div>
  );
}

// Individual card component with gilded court framing
function SpadesCardView({
  card,
  legal = false,
  illegal = false,
  onClick,
}: {
  card: number;
  legal?: boolean;
  illegal?: boolean;
  onClick?: () => void;
}) {
  const suit = spadesSuit(card);
  const rank = spadesRank(card);
  const isRed = suit === 1 || suit === 3;
  const isSpade = suit === 2;

  const rankStr = RANK_CHARS[rank];
  const suitStr = SUIT_CHARS[suit];

  const classNames = [
    "spd-card",
    isRed ? "red" : "",
    legal ? "legal" : "",
    illegal ? "illegal" : "",
    isSpade ? "spade-trump" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} onClick={onClick}>
      <span className="spd-corner">
        <span className="spd-rank">{rankStr}</span>
        <span className="spd-suit">{suitStr}</span>
      </span>

      {rank >= 9 ? (
        <span className="spd-court">
          <b>{rankStr}</b>
          <i>{suitStr}</i>
        </span>
      ) : (
        <span className="spd-center">{suitStr}</span>
      )}
    </div>
  );
}
