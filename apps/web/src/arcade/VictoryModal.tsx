// Duolingo-style Dopamine Victory Modal for All Solo Card Games
// Delivers a high-energy post-game celebration: animated streak flame, clinking coins,
// XP fill bar, daily quest progress, Wordle-style score sharing, and home screen retention hooks.

import {
  DAILY_GAMES,
  formatCountdown,
  formatDailyChallengeNumber,
  getDailyQuests,
  getDailySeed,
  getDailyStreak,
  getRemainingMsUntilNextUtcDay,
  getStreakMultiplier,
  levelInfo,
  todayUtc,
  type DailyGame,
  type Progress,
} from "@heist/profile";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "../account/useAccount";
import { MemberModal } from "../account/MemberModal";
import { buzz } from "../haptics";
import { click, chipRun, win } from "../sound";
import { parseSpeedBonus, saveDailyBest, shareDailyResult } from "../daily/shareHelpers";
import { isMobileDevice, MobileInstallModal } from "./MobileInstallModal";
import { appUrl, onCrazyGames } from "../crazygames";
import { t, useLanguage } from "../i18n";
import "./victory.css";

const DAILY_LABELS: Record<string, string> = {
  solitaire: "Klondike Solitaire",
  freecell: "FreeCell",
  spider: "Spider Solitaire",
  tripeaks: "TriPeaks",
  pyramid: "Pyramid",
  yukon: "Yukon",
  ers: "Egyptian Rat Screw",
  scoundrel: "Scoundrel",
  minesweeper: "Minesweeper",
  sudoku: "Sudoku",
  checkers: "Checkers",
  hearts: "Hearts",
  spades: "Spades",
};

export interface VictoryModalProps {
  game: DailyGame | string;
  gameTitle: string;
  moves?: number;
  time?: string;
  score?: number;
  isDaily?: boolean;
  progress?: Progress | null;
  usedFreeze?: boolean;
  onDealAgain: () => void;
  onChallengeFriend?: () => void;
  onExit: () => void;
  onHeist?: () => void;
}

export function VictoryModal({
  game,
  gameTitle,
  moves,
  time,
  score,
  isDaily,
  progress,
  usedFreeze,
  onDealAgain,
  onChallengeFriend,
  onExit,
  onHeist,
}: VictoryModalProps) {
  useLanguage();
  const { act, me } = useAccount();
  const [copied, setCopied] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [welcomePackClaimed, setWelcomePackClaimed] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderSet, setReminderSet] = useState(() => {
    try {
      return typeof Notification !== "undefined" && Notification.permission === "granted";
    } catch {
      return false;
    }
  });
  const [msLeft, setMsLeft] = useState(() => getRemainingMsUntilNextUtcDay());
  const [pwaDismissed, setPwaDismissed] = useState(() => {
    try {
      return localStorage.getItem("heist.pwaPrompt") === "off";
    } catch {
      return false;
    }
  });
  const giftClaimedRef = useRef(false);

  // Automatically award Day 1 Welcome Starter Pack if not yet claimed (once per mount)
  useEffect(() => {
    if (progress && !progress.daily?.welcomeClaimed && act && !giftClaimedRef.current) {
      giftClaimedRef.current = true;
      act((b) => b.claimWelcomeGift())
        .then((res) => {
          if (res && "claimed" in res && res.claimed) {
            setWelcomePackClaimed(true);
            buzz("win");
          }
        })
        .catch(() => {});
    }
  }, [progress, act]);

  // Auto-prompt member progress saving modal on victory for guests (once per session)
  useEffect(() => {
    if (!me?.guest || onCrazyGames) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const prompted = sessionStorage.getItem("heist.memberPrompted");
      if (!prompted) {
        timer = setTimeout(() => {
          try {
            sessionStorage.setItem("heist.memberPrompted", "1");
          } catch {}
          setShowMemberModal(true);
        }, 1200);
      }
    } catch {
      // ignore storage errors
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [me?.guest]);

  // Record user's best time for today's daily challenge
  useEffect(() => {
    if (isDaily && time) {
      saveDailyBest(game, todayUtc(), { time, moves, score });
    }
  }, [isDaily, time, game, moves, score]);

  const handleSetReminder = async () => {
    click();
    buzz("tap");
    setReminderError(null);
    if (typeof window === "undefined" || !("Notification" in window)) {
      setReminderError("Push notifications not supported on this browser.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setReminderSet(true);
        buzz("win");
      } else {
        setReminderError("Notifications blocked in browser settings.");
      }
    } catch {
      setReminderError("Could not enable notifications.");
    }
  };

  // Calculate streak & multiplier
  const streak = progress ? Math.max(1, getDailyStreak(progress, Date.now())) : 1;
  const multiplier = getStreakMultiplier(streak);
  const freezes = progress?.daily?.freezes ?? 0;

  // Turn-based board & trick-taking card games don't award a speed bonus on the server
  const noSpeedGames = new Set(["checkers", "hearts", "spades"]);
  const speedBonusXp = noSpeedGames.has(game) ? 0 : parseSpeedBonus(time);

  // Level info
  const lvl = progress ? levelInfo(progress.xp) : { level: 1, pct: 0, into: 0, need: 100, maxed: false };
  const levelPercent = Math.min(100, Math.round(lvl.pct * 100));

  // Today's Quests
  const questsSummary = progress ? getDailyQuests(progress) : null;

  // Next uncompleted daily challenge for immediate quick-queue
  const today = todayUtc();
  const nextDailyGame = useMemo(() => {
    if (!isDaily || !progress) return null;
    const completed = progress.daily?.completed ?? {};
    const currentIndex = DAILY_GAMES.indexOf(game as DailyGame);
    for (let i = 1; i <= DAILY_GAMES.length; i++) {
      const idx = (currentIndex + i) % DAILY_GAMES.length;
      const g = DAILY_GAMES[idx];
      if (!completed[`${today}:${g}`]) {
        return g;
      }
    }
    return null;
  }, [isDaily, progress, game, today]);

  const dailyCompletedCount = useMemo(() => {
    if (!progress?.daily?.completed) return 0;
    return DAILY_GAMES.filter((g) => Boolean(progress.daily?.completed?.[`${today}:${g}`])).length;
  }, [progress, today]);

  // Play fanfare and chip clinks on mount
  useEffect(() => {
    win();
    buzz("win");
    const t = setTimeout(() => {
      chipRun(6);
    }, 450);
    return () => clearTimeout(t);
  }, []);

  // Countdown timer for next challenge
  useEffect(() => {
    const timer = setInterval(() => {
      setMsLeft(getRemainingMsUntilNextUtcDay());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Handle Share Card
  const handleShare = async () => {
    click();
    buzz("tap");
    const success = await shareDailyResult({
      game: (game as DailyGame) || "solitaire",
      gameTitle,
      won: true,
      time,
      moves,
      score,
      streak,
      multiplier,
      challengeNumber: formatDailyChallengeNumber(),
    });
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    }
  };

  // Check standalone mode (PWA)
  const isStandalone = () => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator && Boolean((window.navigator as unknown as { standalone: boolean }).standalone))
    );
  };

  const showPwaPrompt = !isStandalone() && !pwaDismissed && !onCrazyGames;

  const dismissPwa = () => {
    setPwaDismissed(true);
    try {
      localStorage.setItem("heist.pwaPrompt", "off");
    } catch {
      // storage blocked
    }
  };

  return createPortal(
    <div className="vic-overlay" role="dialog" aria-modal="true" aria-label="Game Won Celebration">
      <div className="vic-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header Badge & Title */}
        <div className="vic-badge-row">
          <span className="vic-badge">
            <span>🏆</span> {isDaily ? "DAILY CHALLENGE SOLVED" : "CLEAN JOB"}
          </span>
        </div>
        <h2 className="vic-title">{t("victory.title", "VICTORY!")}</h2>

        {/* Quick Stats Row */}
        <div className="vic-stats-row">
          {time && (
            <div className="vic-stat-pill">
              <span className="vic-stat-val">{time}</span>
              <span className="vic-stat-lbl">{t("common.time", "Time")}</span>
            </div>
          )}
          {speedBonusXp > 0 && (
            <div className="vic-stat-pill" style={{ borderColor: "rgba(56, 189, 248, 0.4)", background: "rgba(56, 189, 248, 0.1)" }}>
              <span className="vic-stat-val" style={{ color: "#38bdf8" }}>+{speedBonusXp} XP</span>
              <span className="vic-stat-lbl" style={{ color: "#bae6fd" }}>Speed Bonus</span>
            </div>
          )}
          {moves !== undefined && (
            <div className="vic-stat-pill">
              <span className="vic-stat-val">{moves}</span>
              <span className="vic-stat-lbl">{t("common.moves", "Moves")}</span>
            </div>
          )}
          {score !== undefined && (
            <div className="vic-stat-pill">
              <span className="vic-stat-val">{score}</span>
              <span className="vic-stat-lbl">{t("common.score", "Score")}</span>
            </div>
          )}
        </div>

        {/* The Duolingo Flame Streak Card */}
        <div className="vic-streak-card">
          <span className="vic-flame-icon" aria-hidden="true">🔥</span>
          <div className="vic-streak-content">
            <div className="vic-streak-title">
              <span>{streak}-DAY STREAK!</span>
              <span style={{ fontSize: "0.75rem", background: "rgba(0,0,0,0.4)", padding: "0.15rem 0.4rem", borderRadius: "4px" }}>
                {multiplier}x XP
              </span>
            </div>
            <div className="vic-streak-sub">
              {streak === 1
                ? "First win locked in! Play tomorrow to reach Day 2."
                : `Streak active! Keep the fire burning in ${formatCountdown(msLeft)}.`}
            </div>
            {usedFreeze && (
              <div className="vic-freeze-tag">
                <span>🧊</span> Streak Freeze saved your streak!
              </div>
            )}
            {freezes > 0 && !usedFreeze && (
              <div className="vic-freeze-tag">
                <span>🧊</span> {freezes} Streak Freeze Protected
              </div>
            )}
          </div>
        </div>

        {/* Guest Member Onboarding Hook */}
        {me?.guest && !onCrazyGames && (
          <div
            className="vic-member-card"
            role="button"
            tabIndex={0}
            onClick={() => {
              click();
              setShowMemberModal(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                click();
                setShowMemberModal(true);
              }
            }}
          >
            <span className="vic-member-icon" aria-hidden="true">👑</span>
            <div className="vic-member-content">
              <div className="vic-member-title">
                SAVE YOUR XP &amp; {streak}-DAY STREAK
              </div>
              <div className="vic-member-sub">
                Lock in your Battle Pass &amp; skins before cache clears. Free.
              </div>
            </div>
            <button
              type="button"
              className="vic-member-btn"
              onClick={(e) => {
                e.stopPropagation();
                click();
                setShowMemberModal(true);
              }}
            >
              SAVE ➔
            </button>
          </div>
        )}

        {/* Streak Reminder (Web Push) */}
        <div className="vic-reminder-row">
          {reminderSet ? (
            <div className="vic-reminder-confirmed">
              <span>✓</span> Streak reminder active! We'll alert you before reset.
            </div>
          ) : (
            <button type="button" className="vic-reminder-btn" onClick={handleSetReminder}>
              <span>🔔</span> Remind Me Tomorrow
            </button>
          )}
          {reminderError && (
            <div style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 4 }}>{reminderError}</div>
          )}
        </div>

        {/* Day 1 Welcome Starter Pack Notification */}
        {welcomePackClaimed && (
          <div className="vic-welcome-gift-card">
            <span style={{ fontSize: "1.8rem" }}>🎁</span>
            <div>
              <div className="vic-welcome-gift-title">DAY 1 STARTER PACK UNLOCKED!</div>
              <div className="vic-welcome-gift-sub">
                +1 Streak Freeze 🧊 &amp; +250 Coins 🪙 added! Your streak is protected if you miss tomorrow.
              </div>
            </div>
          </div>
        )}

        {/* Clinking Loot & XP Rewards */}
        <div className="vic-rewards-row">
          <div className="vic-reward-item">
            <span className="vic-reward-icon">🪙</span>
            <div>
              <div className="vic-reward-val">+{isDaily ? 50 : 25} COINS</div>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Loot Earned</div>
            </div>
          </div>
          <div className="vic-reward-item">
            <span className="vic-reward-icon">⭐</span>
            <div>
              <div className="vic-reward-val">+{Math.round((isDaily ? 100 : 50) * multiplier) + speedBonusXp} XP</div>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                {speedBonusXp > 0 ? `+${speedBonusXp} Speed · Level ${lvl.level}` : `Level ${lvl.level} (${levelPercent}%)`}
              </div>
            </div>
          </div>
        </div>

        {/* Daily Quests Mini Progress */}
        {questsSummary && (
          <div className="vic-quests-card">
            <div className="vic-quests-head">
              <span>Daily Quests ({questsSummary.quests.filter((q) => q.done).length}/3)</span>
              <span style={{ color: "#fbbf24" }}>Vault: +100 🪙</span>
            </div>
            <div className="vic-quests-row">
              {questsSummary.quests.map((q) => (
                <div key={q.id} className="vic-quest-mini">
                  <div className="vic-quest-mini-top">
                    <span>{q.icon}</span>
                    <span style={{ fontWeight: 700, color: q.done ? "#22c55e" : "#94a3b8" }}>
                      {q.done ? "✓" : `${q.current}/${q.target}`}
                    </span>
                  </div>
                  <div className="vic-quest-bar">
                    <div
                      className={`vic-quest-fill ${q.done ? "done" : ""}`}
                      style={{ width: `${Math.min(100, (q.current / q.target) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mobile PWA / Full Screen Install Hook */}
        {showPwaPrompt && (
          <div className="vic-pwa-card">
            <span style={{ fontSize: "1.4rem" }}>📲</span>
            <div className="vic-pwa-content">
              <div className="vic-pwa-title">Play in Full Screen</div>
              <div className="vic-pwa-sub">Install to home screen for zero browser bars and offline play.</div>
            </div>
            <button
              type="button"
              className="vic-pwa-btn"
              onClick={() => {
                click();
                buzz("tap");
                setShowInstallModal(true);
              }}
            >
              How to Install ➔
            </button>
          </div>
        )}

        {/* Main Action Buttons */}
        <div className="vic-actions">
          {isDaily && nextDailyGame ? (
            <button
              type="button"
              className="vic-btn-deal vic-btn-next-daily"
              onClick={() => {
                click();
                buzz("tap");
                // dailyGame + seed opens today's own deal; ?daily alone opened the Daily Hub over a random deal
                window.location.href = appUrl(`/${nextDailyGame}?dailyGame=1&seed=${getDailySeed(nextDailyGame)}`);
              }}
              autoFocus
            >
              NEXT DAILY DEAL: {DAILY_LABELS[nextDailyGame] ?? nextDailyGame.toUpperCase()} ({dailyCompletedCount}/{DAILY_GAMES.length}) ➔
            </button>
          ) : isDaily && !nextDailyGame ? (
            <button
              type="button"
              className="vic-btn-deal"
              onClick={() => {
                click();
                buzz("tap");
                onDealAgain();
              }}
              autoFocus
            >
              ALL {DAILY_GAMES.length} DEALS CRACKED! REPLAY ↺
            </button>
          ) : (
            <button
              type="button"
              className="vic-btn-deal"
              onClick={() => {
                click();
                buzz("tap");
                onDealAgain();
              }}
              autoFocus
            >
              {t("victory.deal_again", "PLAY NEXT DEAL 🃏")}
            </button>
          )}

          <button
            type="button"
            className="vic-btn-share"
            onClick={handleShare}
          >
            <span>🔥</span> {copied ? t("victory.copied", "COPIED TO CLIPBOARD! ✓") : t("victory.share_result", "SHARE SCORE CARD")}
          </button>

          <div className="vic-sub-actions">
            {isDaily && (
              <button
                type="button"
                className="vic-btn-sub"
                onClick={() => {
                  click();
                  buzz("tap");
                  onDealAgain();
                }}
              >
                ↺ {t("victory.deal_again", "Replay Deal")}
              </button>
            )}
            {onChallengeFriend && (
              <button
                type="button"
                className="vic-btn-sub"
                onClick={() => {
                  click();
                  buzz("tap");
                  onChallengeFriend();
                }}
              >
                🏆 {t("victory.challenge_friend", "Challenge Friend")}
              </button>
            )}
            {onHeist && (
              <button
                type="button"
                className="vic-btn-sub"
                onClick={() => {
                  click();
                  buzz("tap");
                  onHeist();
                }}
              >
                Multiplayer Heist
              </button>
            )}
            <button
              type="button"
              className="vic-btn-sub"
              onClick={() => {
                click();
                buzz("tap");
                onExit();
              }}
            >
              Lobby
            </button>
          </div>
        </div>
      </div>
      {showInstallModal && (
        <MobileInstallModal isOpen={showInstallModal} onClose={() => setShowInstallModal(false)} />
      )}
      {showMemberModal && (
        <MemberModal
          isOpen={showMemberModal}
          onClose={() => setShowMemberModal(false)}
          streak={streak}
          xp={Math.round((isDaily ? 100 : 50) * multiplier) + speedBonusXp}
          multiplier={multiplier}
          source="victory_modal"
        />
      )}
    </div>,
    document.body
  );
}
