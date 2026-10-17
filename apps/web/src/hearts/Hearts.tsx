// Hearts vs Bots (4-player trick-taking card game)
// Casino-noir table, card stock with golden court frames, pass-3-cards exchange,
// step-by-step trick animations, Shoot the Moon celebration, and VictoryModal integration.

import {
  applyHeartsCard, applyHeartsPass, heartsBotCard, heartsLegalPlays, heartsPenalty,
  heartsRank, heartsSuit, heartsTallyOf, isHeartsLevel, isValidHeartsPass, newHearts,
  QUEEN_OF_SPADES, TWO_OF_CLUBS, type HeartsLevel, type HeartsSeat, type HeartsState,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { VictoryModal } from "../arcade/VictoryModal";
import { buzz } from "../haptics";
import { t } from "../i18n";
import { card as cardSound, chip, click, foundationChime, lose as loseSound, win as winSound } from "../sound";
import "./hearts.css";

const SUIT_CHARS = ["♣", "♦", "♠", "♥"] as const;
const RANK_CHARS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

const BOT_NAMES: Record<HeartsLevel, [string, string, string]> = {
  rookie: ["Barnaby", "Penny", "Giles"],
  pro: ["Jasper", "Vesper", "Silas"],
  boss: ["The Baron", "Madame Rouge", "The Don"],
};

const LEVEL_STORAGE_KEY = "heist.hearts.level";

function savedLevel(): HeartsLevel {
  try {
    const s = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (isHeartsLevel(s)) return s;
  } catch {
    /* fine */
  }
  return "pro";
}

interface FloatPill {
  id: number;
  text: string;
}

export interface HeartsProps {
  initialSeed?: number;
  isDaily?: boolean;
  onExit: () => void;
  banner?: ReactNode;
  onHeist?: () => void;
}

export function Hearts({ initialSeed, isDaily = false, onExit, banner, onHeist }: HeartsProps) {
  const { me, backend, act } = useAccount();

  const [level, setLevel] = useState<HeartsLevel>(() => (isDaily ? "pro" : savedLevel()));
  const [picker, setPicker] = useState(false);
  const [selectedPass, setSelectedPass] = useState<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [trickBanner, setTrickBanner] = useState<string | null>(null);
  const [floats, setFloats] = useState<FloatPill[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [moves, setMoves] = useState<number[][]>([]);

  // Local game state
  const [state, setState] = useState<HeartsState>(() => {
    const seed = initialSeed ?? Math.floor(Math.random() * 2 ** 31);
    return newHearts(seed, isDaily ? "pro" : level);
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const isPendingBot = useRef(false);

  // Initialize or deal hand
  const deal = useCallback(
    async (targetLevel: HeartsLevel, targetSeed?: number) => {
      setSelectedPass([]);
      setTrickBanner(null);
      setToast(null);
      setMoves([]);
      const s = targetSeed ?? Math.floor(Math.random() * 2 ** 31);
      const lv = isDaily ? "pro" : targetLevel;
      const initial = newHearts(s, lv);
      setState(initial);

      if (backend) {
        try {
          const res = await backend.heartsStart(s, isDaily, lv);
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

  // Bot play automated runner with natural pacing
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

      const botCard = heartsBotCard(current, current.level, current.seed);
      if (botCard < 0) return;

      cardSound();
      buzz("tap");
      const next = applyHeartsCard(current, botCard);
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
  const handleTrickCompleted = (nextState: HeartsState) => {
    const last = nextState.lastTrick;
    if (!last) return;

    const winnerSeat = last.winner;
    const botNames = BOT_NAMES[nextState.level];
    const winnerName = winnerSeat === 0 ? "You" : botNames[winnerSeat - 1];
    const pts = last.points;

    if (pts > 0) {
      chip();
      setTrickBanner(`${winnerName} took ${pts} penalty pts!`);
    } else {
      if (winnerSeat === 0) {
        foundationChime(3);
        addFloat("+50 XP Clean Trick");
      }
      setTrickBanner(`${winnerName} won the trick (0 pts)`);
    }

    setTimeout(() => {
      setTrickBanner(null);
    }, 1200);

    // If game ended, bank & celebrate
    if (nextState.phase === "done") {
      handleGameOver(nextState);
    }
  };

  // Game over settlement
  const handleGameOver = async (finalState: HeartsState) => {
    const won = finalState.winner === 0;
    const currentMoves = movesRef.current;

    if (finalState.shotMoon === 0) {
      foundationChime(13);
      winSound();
      addFloat("🌕 SHOT THE MOON! +500 XP");
    } else if (won) {
      winSound();
      addFloat("+100 XP Victory");
    } else {
      loseSound();
    }

    if (gameId) {
      try {
        await act((b) => b.heartsFinish(gameId, currentMoves, 0));
      } catch {
        /* fine */
      }
    }
  };

  // South selects/deselects a card during the pass phase
  const togglePassCard = (cardId: number) => {
    if (state.phase !== "pass") return;
    click();
    buzz("tap");
    setSelectedPass((prev) => {
      if (prev.includes(cardId)) return prev.filter((c) => c !== cardId);
      if (prev.length >= 3) return [...prev.slice(1), cardId];
      return [...prev, cardId];
    });
  };

  // Confirm pass 3 cards
  const handleConfirmPass = () => {
    if (state.phase !== "pass" || selectedPass.length !== 3) return;
    if (!isValidHeartsPass(state, selectedPass)) return;

    cardSound();
    buzz("bump");

    const newMoves = [...movesRef.current, selectedPass];
    setMoves(newMoves);

    // Apply pass
    let s = applyHeartsPass(state, selectedPass);
    setSelectedPass([]);

    // Inform player what they received
    const rec = s.receivedPass;
    const recFormatted = rec.map((c) => `${RANK_CHARS[heartsRank(c)]}${SUIT_CHARS[heartsSuit(c)]}`).join(" ");
    setToast(`Passed 3 cards. Received: ${recFormatted}`);
    setTimeout(() => setToast(null), 3000);

    // If bots go first (e.g. Someone else holds the 2 of clubs), advance will be triggered by useEffect
    setState(s);
  };

  // South plays a card
  const handlePlayCard = (cardId: number) => {
    if (state.phase !== "play" || state.turn !== 0) return;
    const legal = heartsLegalPlays(state, 0);
    if (!legal.includes(cardId)) return;

    cardSound();
    buzz("tap");

    const newMoves = [...movesRef.current, [cardId]];
    setMoves(newMoves);

    const next = applyHeartsCard(state, cardId);
    setState(next);

    if (next.lastTrick && next.trick.length === 0) {
      handleTrickCompleted(next);
    }
  };

  const legalCards = useMemo(() => {
    if (state.phase !== "play" || state.turn !== 0) return [];
    return heartsLegalPlays(state, 0);
  }, [state]);

  const botNames = BOT_NAMES[state.level];
  const southHand = state.hands[0];
  const isDone = state.phase === "done";
  const won = isDone && state.winner === 0;

  const passDirectionLabel =
    state.passDir === "left" ? "Left ←" : state.passDir === "right" ? "Right →" : "Across ↑";

  return (
    <div className="ht-root">
      <div className="ht-rim" />

      {/* Floating XP Pills */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="ht-float"
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
      <div className="ht-bar">
        <div className="ht-bar-left">
          <button
            type="button"
            className="ht-btn-icon"
            onClick={() => {
              click();
              onExit();
            }}
            title={t("common.back_to_lobby", "Back to Lobby")}
          >
            ←
          </button>
          <div className="ht-title-pill">
            <span className="ht-title-text">{t("game.hearts", "HEARTS")}</span>
            {isDaily ? (
              <span className="ht-badge daily">Daily Deal</span>
            ) : (
              <button
                type="button"
                className="ht-badge"
                style={{ cursor: "pointer", background: "none", border: "none", color: "inherit", padding: 0 }}
                onClick={() => {
                  click();
                  setPicker(true);
                }}
              >
                {state.level.toUpperCase()} ▾
              </button>
            )}
            {state.heartsBroken && <span className="ht-badge broken">♥ Broken</span>}
          </div>
        </div>

        <div className="ht-bar-right">
          <span className="ht-badge">
            Trick {Math.min(13, state.trickNo + 1)} / 13
          </span>
        </div>
      </div>

      {banner}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="ht-toast"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table Felt */}
      <div className="ht-table">
        {/* North (Seat 2) */}
        <div className="ht-north">
          <div className={`ht-seat-card ${state.turn === 2 && !isDone ? "active-turn" : ""}`}>
            <span className="ht-seat-name">{botNames[1]} (N)</span>
            <span className="ht-seat-pts">{state.points[2]} pts</span>
            <span className="ht-seat-tricks">{state.tricksWon[2]} tricks</span>
          </div>
          <div className="ht-opp-fan">
            {state.hands[2].map((_, i) => (
              <div key={i} className="ht-opp-card-back" />
            ))}
          </div>
        </div>

        {/* Middle Row (West, Trick Center, East) */}
        <div className="ht-middle-row">
          {/* West (Seat 1) */}
          <div className="ht-west">
            <div className={`ht-seat-card ${state.turn === 1 && !isDone ? "active-turn" : ""}`}>
              <span className="ht-seat-name">{botNames[0]} (W)</span>
              <span className="ht-seat-pts">{state.points[1]} pts</span>
              <span className="ht-seat-tricks">{state.tricksWon[1]} tricks</span>
            </div>
            <div className="ht-opp-fan vertical">
              {state.hands[1].map((_, i) => (
                <div key={i} className="ht-opp-card-back" />
              ))}
            </div>
          </div>

          {/* Trick Felt Center */}
          <div className="ht-trick-ring">
            {/* Trick Cards on Felt */}
            {state.trick.map((t) => (
              <div key={t.card} className={`ht-trick-card-slot seat-${t.seat}`}>
                <HeartsCardView card={t.card} />
              </div>
            ))}

            {/* Trick Winner Announcement Banner */}
            <AnimatePresence>
              {trickBanner && (
                <motion.div
                  className="ht-trick-banner"
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
          <div className="ht-east">
            <div className={`ht-seat-card ${state.turn === 3 && !isDone ? "active-turn" : ""}`}>
              <span className="ht-seat-name">{botNames[2]} (E)</span>
              <span className="ht-seat-pts">{state.points[3]} pts</span>
              <span className="ht-seat-tricks">{state.tricksWon[3]} tricks</span>
            </div>
            <div className="ht-opp-fan vertical">
              {state.hands[3].map((_, i) => (
                <div key={i} className="ht-opp-card-back" />
              ))}
            </div>
          </div>
        </div>

        {/* South (Seat 0 / You) */}
        <div className="ht-south">
          {state.phase === "pass" && (
            <div className="ht-pass-bar">
              <span className="ht-pass-prompt">
                Select 3 cards to pass {passDirectionLabel} ({selectedPass.length}/3)
              </span>
              <button
                type="button"
                className="ht-pass-btn"
                disabled={selectedPass.length !== 3}
                onClick={handleConfirmPass}
              >
                Pass Cards ➔
              </button>
            </div>
          )}

          {/* South Seat Info Badge */}
          <div className={`ht-seat-card ${state.turn === 0 && !isDone && state.phase === "play" ? "active-turn" : ""}`}>
            <span className="ht-seat-name">{me?.name || "You"} (South)</span>
            <span className="ht-seat-pts">{state.points[0]} penalty pts</span>
            <span className="ht-seat-tricks">{state.tricksWon[0]} tricks won</span>
          </div>

          {/* Hand Cards */}
          <div className="ht-hand">
            {southHand.map((c) => {
              const isSelected = selectedPass.includes(c);
              const isLegal = state.phase === "play" && state.turn === 0 && legalCards.includes(c);
              const isIllegal = state.phase === "play" && state.turn === 0 && !legalCards.includes(c);

              return (
                <HeartsCardView
                  key={c}
                  card={c}
                  selected={isSelected}
                  legal={isLegal}
                  illegal={isIllegal}
                  onClick={() => {
                    if (state.phase === "pass") {
                      togglePassCard(c);
                    } else if (state.phase === "play") {
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
          <div className="ht-picker-overlay" onClick={() => setPicker(false)}>
            <motion.div
              className="ht-picker-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="ht-picker-title">Select Bot Strength</h2>
              <p className="ht-picker-desc">Choose your 3 opponents for Hearts.</p>

              <div className="ht-bot-list">
                {(["rookie", "pro", "boss"] as const).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className={`ht-bot-btn ${level === lv ? "selected" : ""}`}
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
                    <div className="ht-bot-btn-left">
                      <span className="ht-bot-name">
                        {lv === "rookie" ? "Rookie Bots" : lv === "pro" ? "Pro Bots" : "Boss Bots"}
                      </span>
                      <span className="ht-bot-blurb">
                        {lv === "rookie"
                          ? "Barnaby, Penny, Giles. Casual play."
                          : lv === "pro"
                          ? "Jasper, Vesper, Silas. Sharp suit counting."
                          : "The Baron, Madame Rouge, The Don. Master strategists."}
                      </span>
                    </div>
                    <span className="ht-bot-btn-icon">{lv === "rookie" ? "♟" : lv === "pro" ? "♞" : "♛"}</span>
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
          game="hearts"
          gameTitle={`Hearts vs ${level.charAt(0).toUpperCase() + level.slice(1)} Bots`}
          moves={state.cleanTricks}
          score={state.points[0]}
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
function HeartsCardView({
  card,
  selected = false,
  legal = false,
  illegal = false,
  onClick,
}: {
  card: number;
  selected?: boolean;
  legal?: boolean;
  illegal?: boolean;
  onClick?: () => void;
}) {
  const suit = heartsSuit(card);
  const rank = heartsRank(card);
  const isRed = suit === 1 || suit === 3;
  const isQueenOfSpades = card === QUEEN_OF_SPADES;
  const isHeart = suit === 3;

  const rankStr = RANK_CHARS[rank];
  const suitStr = SUIT_CHARS[suit];

  const classNames = [
    "ht-card",
    isRed ? "red" : "",
    selected ? "selected" : "",
    legal ? "legal" : "",
    illegal ? "illegal" : "",
    isQueenOfSpades ? "queen-spades" : "",
    isHeart ? "penalty-heart" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} onClick={onClick}>
      <span className="ht-corner">
        <span className="ht-rank">{rankStr}</span>
        <span className="ht-suit">{suitStr}</span>
      </span>

      {rank >= 9 ? (
        <span className="ht-court">
          <b>{rankStr}</b>
          <i>{suitStr}</i>
        </span>
      ) : (
        <span className="ht-center">{suitStr}</span>
      )}
    </div>
  );
}
