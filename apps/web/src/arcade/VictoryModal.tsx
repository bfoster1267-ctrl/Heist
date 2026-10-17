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
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { click, chipRun, win } from "../sound";
import { saveDailyBest, shareDailyResult } from "../daily/shareHelpers";
import { isMobileDevice, MobileInstallModal } from "./MobileInstallModal";
import "./victory.css";
import { t, tk } from "../i18n";

const DAILY_LABELS: Record<string, string> = {
  solitaire: "Klondike Solitaire",
  freecell: "FreeCell",
  spider: "Spider Solitaire",
  tripeaks: "TriPeaks",
  pyramid: "Pyramid",
  yukon: "Yukon",
  ers: "Egyptian Rat Screw",
  scoundrel: "Scoundrel",
};
/** a daily game's name in the active language (the catalog's arcade title) */
const dailyLabel = (g: string) => (DAILY_LABELS[g] ? tk(`arc.${g}.title`, DAILY_LABELS[g]) : g.toUpperCase());

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
  const { act } = useAccount();
  const [copied, setCopied] = useState(false);
  const [welcomePackClaimed, setWelcomePackClaimed] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
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

  // Automatically award Day 1 Welcome Starter Pack if not yet claimed
  useEffect(() => {
    if (progress && !progress.daily?.welcomeClaimed && act) {
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

  // Record user's best time for today's daily challenge
  useEffect(() => {
    if (isDaily && time) {
      saveDailyBest(game, todayUtc(), { time, moves, score });
    }
  }, [isDaily, time, game, moves, score]);

  const handleSetReminder = async () => {
    click();
    buzz("tap");
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert(t("vic.noPush"));
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setReminderSet(true);
        buzz("win");
      } else {
        alert(t("vic.pushOff"));
      }
    } catch {
      /* ignore */
    }
  };

  // Calculate streak & multiplier
  const streak = progress ? Math.max(1, getDailyStreak(progress, Date.now())) : 1;
  const multiplier = getStreakMultiplier(streak);
  const freezes = progress?.daily?.freezes ?? 0;

  // Speed bonus: wins under 5 mins (300s) award +1 XP per second remaining
  let speedBonusXp = 0;
  if (time) {
    const parts = time.split(":").map((p) => parseInt(p, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const s = parts[0] * 60 + parts[1];
      if (s > 0 && s < 300) speedBonusXp = 300 - s;
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      const s = parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (s > 0 && s < 300) speedBonusXp = 300 - s;
    }
  }

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
    const tm = setTimeout(() => {
      chipRun(6);
    }, 450);
    return () => clearTimeout(tm);
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

  const showPwaPrompt = !isStandalone() && !pwaDismissed;

  const dismissPwa = () => {
    setPwaDismissed(true);
    try {
      localStorage.setItem("heist.pwaPrompt", "off");
    } catch {
      // storage blocked
    }
  };

  return createPortal(
    <div className="vic-overlay" role="dialog" aria-modal="true" aria-label={t("vic.aria")}>
      <div className="vic-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header Badge & Title */}
        <div className="vic-badge-row">
          <span className="vic-badge">
            <span>🏆</span> {isDaily ? t("vic.dailySolved") : t("vic.clean")}
          </span>
        </div>
        <h2 className="vic-title">{t("vic.title")}</h2>

        {/* Quick Stats Row */}
        <div className="vic-stats-row">
          {time && (
            <div className="vic-stat-pill">
              <span className="vic-stat-val">{time}</span>
              <span className="vic-stat-lbl">{t("vic.time")}</span>
            </div>
          )}
          {speedBonusXp > 0 && (
            <div className="vic-stat-pill" style={{ borderColor: "rgba(56, 189, 248, 0.4)", background: "rgba(56, 189, 248, 0.1)" }}>
              <span className="vic-stat-val" style={{ color: "#38bdf8" }}>+{speedBonusXp} XP</span>
              <span className="vic-stat-lbl" style={{ color: "#bae6fd" }}>{t("vic.speed")}</span>
            </div>
          )}
          {moves !== undefined && (
            <div className="vic-stat-pill">
              <span className="vic-stat-val">{moves}</span>
              <span className="vic-stat-lbl">{t("vic.moves")}</span>
            </div>
          )}
          {score !== undefined && (
            <div className="vic-stat-pill">
              <span className="vic-stat-val">{score}</span>
              <span className="vic-stat-lbl">{t("vic.score")}</span>
            </div>
          )}
        </div>

        {/* The Duolingo Flame Streak Card */}
        <div className="vic-streak-card">
          <span className="vic-flame-icon" aria-hidden="true">🔥</span>
          <div className="vic-streak-content">
            <div className="vic-streak-title">
              <span>{t("vic.streak", { count: streak })}</span>
              <span style={{ fontSize: "0.75rem", background: "rgba(0,0,0,0.4)", padding: "0.15rem 0.4rem", borderRadius: "4px" }}>
                {multiplier}x XP
              </span>
            </div>
            <div className="vic-streak-sub">
              {streak === 1 ? t("vic.first") : t("vic.active", { time: formatCountdown(msLeft) })}
            </div>
            {usedFreeze && (
              <div className="vic-freeze-tag">
                <span>🧊</span> {t("vic.freezeSaved")}
              </div>
            )}
            {freezes > 0 && !usedFreeze && (
              <div className="vic-freeze-tag">
                <span>🧊</span> {t("vic.freezes", { count: freezes })}
              </div>
            )}
          </div>
        </div>

        {/* Streak Reminder (Web Push) */}
        <div className="vic-reminder-row">
          {reminderSet ? (
            <div className="vic-reminder-confirmed">
              <span>✓</span> {t("vic.reminderOn")}
            </div>
          ) : (
            <button type="button" className="vic-reminder-btn" onClick={handleSetReminder}>
              <span>🔔</span> {t("vic.remind")}
            </button>
          )}
        </div>

        {/* Day 1 Welcome Starter Pack Notification */}
        {welcomePackClaimed && (
          <div className="vic-welcome-gift-card">
            <span style={{ fontSize: "1.8rem" }}>🎁</span>
            <div>
              <div className="vic-welcome-gift-title">{t("vic.packTitle")}</div>
              <div className="vic-welcome-gift-sub">{t("vic.packText")}</div>
            </div>
          </div>
        )}

        {/* Clinking Loot & XP Rewards */}
        <div className="vic-rewards-row">
          <div className="vic-reward-item">
            <span className="vic-reward-icon">🪙</span>
            <div>
              <div className="vic-reward-val">{t("vic.coins", { n: isDaily ? 50 : 25 })}</div>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>{t("vic.loot")}</div>
            </div>
          </div>
          <div className="vic-reward-item">
            <span className="vic-reward-icon">⭐</span>
            <div>
              <div className="vic-reward-val">+{Math.round((isDaily ? 100 : 50) * multiplier) + speedBonusXp} XP</div>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                {speedBonusXp > 0 ? t("vic.speedLevel", { n: speedBonusXp, lv: lvl.level }) : t("vic.levelPct", { lv: lvl.level, pct: levelPercent })}
              </div>
            </div>
          </div>
        </div>

        {/* Daily Quests Mini Progress */}
        {questsSummary && (
          <div className="vic-quests-card">
            <div className="vic-quests-head">
              <span>{t("vic.quests", { n: questsSummary.quests.filter((q) => q.done).length })}</span>
              <span style={{ color: "#fbbf24" }}>{t("vic.vault")}</span>
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
              <div className="vic-pwa-title">{t("vic.pwaTitle")}</div>
              <div className="vic-pwa-sub">{t("vic.pwaText")}</div>
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
              {t("vic.howInstall")} ➔
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
                window.location.href = `/${nextDailyGame}?dailyGame=1&seed=${getDailySeed(nextDailyGame)}`;
              }}
              autoFocus
            >
              {t("vic.nextDaily", { game: dailyLabel(nextDailyGame), n: dailyCompletedCount })} ➔
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
              {t("vic.allDone")} ↺
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
              {t("vic.nextDeal")} 🃏
            </button>
          )}

          <button
            type="button"
            className="vic-btn-share"
            onClick={handleShare}
          >
            <span>🔥</span> {copied ? t("vic.copied") : t("vic.share")}
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
                ↺ {t("vic.replay")}
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
                🏆 {t("vic.challenge")}
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
                {t("vic.heist")}
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
              {t("table.lobby")}
            </button>

          </div>
        </div>
      </div>
      {showInstallModal && (
        <MobileInstallModal isOpen={showInstallModal} onClose={() => setShowInstallModal(false)} />
      )}
    </div>,
    document.body
  );
}
