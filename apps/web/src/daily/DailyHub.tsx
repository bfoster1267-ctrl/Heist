// Daily Challenge Hub Modal
// Displays today's worldwide daily challenges across all 8 solo games, active streak counter,
// streak multipliers, milestone progress, countdown timers, and Wordle-style sharing.

import {
  DAILY_BASE_BONUS_COINS,
  DAILY_BASE_BONUS_XP,
  DAILY_GAMES,
  formatCountdown,
  formatDailyChallengeNumber,
  getDailyChallenge,
  getDailyQuests,
  getDailyStreak,
  getFeaturedDailyGame,
  getMilestoneBonus,
  getRemainingMsUntilNextUtcDay,
  getStreakMultiplier,
  isChallengeCompleted,
  STREAK_MILESTONES,
  todayUtc,
  type DailyGame,
  type Progress,
} from "@heist/profile";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { card as cardSound, click } from "../sound";
import "./daily.css";
import { getDailyBest, getDailyLeaderboard, shareDailyResult } from "./shareHelpers";
import { num, t, tEn, tk, tNodes, type TKey } from "../i18n";
import { dailyText } from "../i18n/data";

/** a daily game's label; the title is read in the active language each time */
const label = (id: DailyGame, icon: string) => ({
  get title() {
    return t(`dly.game.${id}` as TKey);
  },
  icon,
});

export const GAME_LABELS: Record<DailyGame, { readonly title: string; icon: string }> = {
  solitaire: label("solitaire", "♠"),
  freecell: label("freecell", "♦"),
  spider: label("spider", "🕷️"),
  tripeaks: label("tripeaks", "⛰️"),
  pyramid: label("pyramid", "🔺"),
  yukon: label("yukon", "🐺"),
  ers: label("ers", "⚡"),
  scoundrel: label("scoundrel", "🗡️"),
};

export interface DailyHubProps {
  progress?: Progress;
  onClose: () => void;
  onPlayChallenge: (game: DailyGame, seed: number) => void;
}

export function DailyHub({ progress: propProgress, onClose, onPlayChallenge }: DailyHubProps) {
  const { me, act } = useAccount() ?? {};
  const progress = me?.progress ?? propProgress;
  const [msLeft, setMsLeft] = useState(() => getRemainingMsUntilNextUtcDay());
  const [copiedShare, setCopiedShare] = useState(false);
  const [buyingFreeze, setBuyingFreeze] = useState(false);
  const [claimingVault, setClaimingVault] = useState(false);

  // Countdown timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setMsLeft(getRemainingMsUntilNextUtcDay());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Escape key listener
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const today = todayUtc();
  const challengeNo = formatDailyChallengeNumber(today);
  const streak = progress ? getDailyStreak(progress, Date.now()) : 0;
  const multiplier = getStreakMultiplier(streak);
  const freezes = progress?.daily?.freezes ?? 0;
  const questsSummary = progress ? getDailyQuests(progress) : null;

  // Handle Buy Freeze
  const handleBuyFreeze = async () => {
    click();
    buzz("tap");
    if (!act) return;
    setBuyingFreeze(true);
    try {
      await act((b) => b.buyStreakFreeze());
      buzz("bump");
    } catch (err: unknown) {
      alert(tEn((err as Error).message || "") || t("dly.buyFail"));
    } finally {
      setBuyingFreeze(false);
    }
  };

  // Handle Claim Vault
  const handleClaimVault = async () => {
    click();
    buzz("tap");
    if (!act) return;
    setClaimingVault(true);
    try {
      await act((b) => b.claimDailyVault());
      buzz("win");
    } catch (err: unknown) {
      alert(tEn((err as Error).message || "") || t("dly.vaultFail"));
    } finally {
      setClaimingVault(false);
    }
  };

  // Featured rotating game for today
  const featuredGame = getFeaturedDailyGame();
  const featuredChallenge = getDailyChallenge(featuredGame, today);
  const featuredCompleted = Boolean(progress?.daily?.completed?.[`${today}:${featuredGame}`]);

  const userDailyBest = useMemo(() => getDailyBest(featuredGame, today), [featuredGame, today]);
  const leaderboard = useMemo(
    () => getDailyLeaderboard(featuredGame, featuredChallenge.seed, userDailyBest),
    [featuredGame, featuredChallenge.seed, userDailyBest]
  );

  // Next milestone calculation
  const nextMilestoneDays = [3, 7, 14, 30].find((m) => m > streak) ?? 30;
  const nextMilestoneBonus = STREAK_MILESTONES[nextMilestoneDays];
  const progressPercent = Math.min(100, Math.round((streak / nextMilestoneDays) * 100));

  // Count how many of today's 8 challenges are completed
  const completedCount = useMemo(() => {
    if (!progress?.daily?.completed) return 0;
    return DAILY_GAMES.filter((g) => Boolean(progress.daily?.completed?.[`${today}:${g}`])).length;
  }, [progress, today]);

  const handleShare = async () => {
    click();
    buzz("tap");
    const success = await shareDailyResult({
      game: featuredGame,
      gameTitle: GAME_LABELS[featuredGame].title,
      won: featuredCompleted,
      streak,
      multiplier,
      challengeNumber: challengeNo,
    });
    if (success) {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2400);
    }
  };

  return createPortal(
    <div className="daily-hub-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("dly.aria")}>
      <div className="daily-hub-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="daily-hub-header">
          <div className="daily-title-group">
            <span className="daily-super">
              <span>✦</span> {t("dly.no", { no: String(challengeNo) })}
            </span>
            <h2 className="daily-title">
              {t("dly.title1")} <span>{t("dly.title2")}</span>
            </h2>
          </div>
          <button className="daily-close-btn" onClick={onClose} aria-label={t("dly.close")}>
            ✕
          </button>
        </div>

        {/* Streak & Timer Card */}
        <div className="daily-streak-card">
          <div className="daily-streak-left">
            <span className="daily-flame" aria-hidden="true">🔥</span>
            <div className="daily-streak-stats">
              <span className="daily-streak-count">{t("dly.streak", { count: streak })}</span>
              <span className="daily-multiplier-pill">{t("dly.mult", { x: multiplier })}</span>
            </div>
          </div>
          <div className="daily-countdown-wrap">
            <span className="daily-countdown-label">{t("dly.resetsIn")}</span>
            <span className="daily-countdown-val">{formatCountdown(msLeft)}</span>
          </div>
        </div>

        {/* Streak Freeze Bar */}
        <div className="daily-freeze-bar">
          <div className="daily-freeze-info">
            <span style={{ fontSize: 22 }} aria-hidden="true">🧊</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#38bdf8", letterSpacing: "0.5px" }}>
                {freezes > 0 ? t("dly.freezeOn", { count: freezes }) : t("dly.freezeOff")}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {freezes > 0 ? t("dly.freezeOnText") : t("dly.freezeOffText")}
              </div>
            </div>
          </div>
          {freezes < 2 && (
            <button
              type="button"
              className="daily-freeze-btn"
              onClick={handleBuyFreeze}
              disabled={buyingFreeze || (progress?.coins ?? 0) < 200}
            >
              {buyingFreeze ? t("dly.equipping") : t("dly.equip")}
            </button>
          )}
        </div>

        {/* Daily Quests Trio */}
        {questsSummary && (
          <div className="daily-quests-box">
            <div className="daily-quests-header">
              <span style={{ fontWeight: 800, letterSpacing: "1px" }}>{t("dly.quests")}</span>
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>
                {t("dly.questsDone", { n: questsSummary.quests.filter((q) => q.done).length })}
              </span>
            </div>
            <div className="daily-quests-list">
              {questsSummary.quests.map((q) => (
                <div key={q.id} className="daily-quest-item">
                  <span style={{ fontSize: 22 }}>{q.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                      <span>{tk(`quest.${q.id}.title`, q.title)}</span>
                      <span style={{ color: q.done ? "#22c55e" : "#94a3b8" }}>
                        {q.done ? t("dly.questDone") : `${num(q.current)}/${num(q.target)}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{tk(`quest.${q.id}.desc`, q.desc)}</div>
                    <div className="daily-progress-track" style={{ height: 4 }}>
                      <div
                        className="daily-progress-fill"
                        style={{
                          width: `${Math.min(100, (q.current / q.target) * 100)}%`,
                          background: q.done ? "#22c55e" : "#3b82f6",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Daily Vault Loot Safe Claim */}
            {questsSummary.allCompleted && !questsSummary.vaultClaimed && (
              <button
                type="button"
                className="daily-vault-claim-btn"
                onClick={handleClaimVault}
                disabled={claimingVault}
              >
                <span>🏆</span> {t("dly.vault")}
              </button>
            )}
            {questsSummary.vaultClaimed && (
              <div className="daily-vault-done">
                <span>✓</span> {t("dly.vaultDone")}
              </div>
            )}
          </div>
        )}

        {/* Milestone Progress Bar */}
        {nextMilestoneBonus && (
          <div className="daily-milestone-wrap">
            <div className="daily-milestone-head">
              <span>{t("dly.milestone", { n: nextMilestoneDays })}</span>
              <span className="daily-milestone-reward">{t("dly.milestoneReward", { xp: nextMilestoneBonus.xp, coins: nextMilestoneBonus.coins })}</span>
            </div>
            <div className="daily-progress-track">
              <div className="daily-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        {/* Featured Challenge Card */}
        <div className="daily-featured-card">
          <span className="daily-featured-badge">{t("dly.featured")}</span>
          <div className="daily-featured-body">
            <div className="daily-featured-info">
              <h3 className="daily-featured-name">{GAME_LABELS[featuredGame].title}</h3>
              <p className="daily-featured-desc">{dailyText(featuredChallenge).description}</p>
            </div>
            <button
              type="button"
              className={`daily-play-btn ${featuredCompleted ? "completed" : ""}`}
              onClick={() => {
                if (featuredCompleted) return;
                cardSound();
                buzz("tap");
                onPlayChallenge(featuredGame, featuredChallenge.seed);
              }}
              aria-label={featuredCompleted ? t("dly.completed") : t("dly.playAria", { game: GAME_LABELS[featuredGame].title })}
            >
              {featuredCompleted ? t("dly.completedBtn") : t("dly.playDeal")}
            </button>
          </div>
        </div>

        {/* Today's Speed Benchmarks & Top Solvers */}
        <div className="daily-leaderboard-card">
          <div className="daily-leaderboard-header">
            <div className="daily-leaderboard-title">
              <span>⚡</span> {t("dly.parTimes", { game: GAME_LABELS[featuredGame].title })}
            </div>
            <div className="daily-speed-badge">{t("dly.speedXp")}</div>
          </div>

          <div className="daily-leaderboard-list">
            {leaderboard.entries.map((entry) => (
              <div
                key={entry.name}
                className={`daily-leaderboard-row ${entry.isUser ? "user-row" : ""}`}
              >
                <div className="daily-solver-left">
                  <span className="daily-solver-rank">{entry.medal}</span>
                  <span className="daily-solver-name">{entry.isUser ? t("dly.yourBest") : entry.name}</span>
                </div>
                <div className="daily-solver-right">
                  <span className="daily-solver-time">⏱️ {entry.time}</span>
                  <span className="daily-solver-xp">+{entry.bonusXp} XP</span>
                </div>
              </div>
            ))}
          </div>

          {(() => {
            const pars = leaderboard.entries.filter((e) => !e.isUser);
            const mine = leaderboard.entries.find((e) => e.isUser);
            const beaten = mine ? pars.find((e) => mine.seconds <= e.seconds) : undefined;
            if (!mine)
              return (
                <div className="daily-leaderboard-hint">
                  <span>💡</span> {tNodes("dly.hintBeat", { time: <strong>{pars[0]?.time ?? "1:30"}</strong> })}
                </div>
              );
            return (
              <div className={`daily-leaderboard-hint ${beaten ? "podium-win" : ""}`}>
                <span>{beaten ? beaten.medal : "👤"}</span>{" "}
                {beaten === pars[0]
                  ? t("dly.beatGold")
                  : beaten
                    ? t("dly.beatSome", { name: beaten.name.toLowerCase(), time: pars[0]?.time ?? "" })
                    : t("dly.yourTime", { time: mine.time, par: pars[2]?.time ?? "" })}
              </div>
            );
          })()}
        </div>



        {/* 8-Game Grid */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 className="daily-grid-title">{t("dly.all", { n: completedCount })}</h4>
          <span style={{ fontSize: 11, color: "var(--gold)", fontFamily: "var(--cond)" }}>
            {t("dly.each")}
          </span>
        </div>

        <div className="daily-games-grid">
          {DAILY_GAMES.map((gameId) => {
            const ch = getDailyChallenge(gameId, today);
            const isDone = Boolean(progress?.daily?.completed?.[`${today}:${gameId}`]);
            const info = GAME_LABELS[gameId];

            return (
              <div key={gameId} className="daily-game-row">
                <div className="daily-game-left">
                  <span className="daily-game-icon">{info.icon}</span>
                  <div>
                    <div className="daily-game-name">{info.title}</div>
                    <div className="daily-game-payout">
                      {isDone ? t("dly.doneToday") : t("dly.deal", { n: String(ch.seed % 1000) })}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className={`daily-mini-play-btn ${isDone ? "done" : ""}`}
                  onClick={() => {
                    cardSound();
                    buzz("tap");
                    onPlayChallenge(gameId, ch.seed);
                  }}
                  aria-label={t("dly.rowAria", { action: isDone ? t("dly.replayWord") : t("dly.playWord"), game: info.title })}
                >
                  {isDone ? t("dly.replay") : t("dly.play")}
                </button>
              </div>
            );
          })}
        </div>

        {/* Share Wordle-style Card Button */}
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            className="btn gold big"
            style={{ width: "100%", height: 48, fontSize: 16 }}
            onClick={handleShare}
            aria-label={t("dly.shareAria")}
          >
            {copiedShare ? t("dly.copied") : t("dly.share")}
          </button>
          <div style={{ fontSize: 12, color: "#8a909b", textAlign: "center", fontStyle: "italic" }}>
            {t("dly.shareHint")}

          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
