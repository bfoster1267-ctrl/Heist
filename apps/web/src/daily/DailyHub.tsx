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

export const GAME_LABELS: Record<DailyGame, { title: string; icon: string }> = {
  solitaire: { title: "Klondike Solitaire", icon: "♠" },
  freecell: { title: "FreeCell", icon: "♦" },
  spider: { title: "Spider Solitaire", icon: "🕷️" },
  tripeaks: { title: "TriPeaks", icon: "⛰️" },
  pyramid: { title: "Pyramid", icon: "🔺" },
  yukon: { title: "Yukon", icon: "🐺" },
  ers: { title: "Egyptian Rat Screw", icon: "⚡" },
  scoundrel: { title: "Scoundrel", icon: "🗡️" },
  minesweeper: { title: "Minesweeper", icon: "💣" },
  sudoku: { title: "Sudoku", icon: "🔢" },
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
      alert((err as Error).message || "Could not buy streak freeze");
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
      alert((err as Error).message || "Could not claim vault");
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
    <div className="daily-hub-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Daily Challenges">
      <div className="daily-hub-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="daily-hub-header">
          <div className="daily-title-group">
            <span className="daily-super">
              <span>✦</span> Daily Challenge #{challengeNo}
            </span>
            <h2 className="daily-title">
              WORLDWIDE <span>DAILY DEALS</span>
            </h2>
          </div>
          <button className="daily-close-btn" onClick={onClose} aria-label="Close Daily Challenges">
            ✕
          </button>
        </div>

        {/* Streak & Timer Card */}
        <div className="daily-streak-card">
          <div className="daily-streak-left">
            <span className="daily-flame" aria-hidden="true">🔥</span>
            <div className="daily-streak-stats">
              <span className="daily-streak-count">{streak} DAY STREAK</span>
              <span className="daily-multiplier-pill">{multiplier}x BONUS MULTIPLIER</span>
            </div>
          </div>
          <div className="daily-countdown-wrap">
            <span className="daily-countdown-label">Resets In</span>
            <span className="daily-countdown-val">{formatCountdown(msLeft)}</span>
          </div>
        </div>

        {/* Streak Freeze Bar */}
        <div className="daily-freeze-bar">
          <div className="daily-freeze-info">
            <span style={{ fontSize: 22 }} aria-hidden="true">🧊</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#38bdf8", letterSpacing: "0.5px" }}>
                {freezes > 0 ? `${freezes} STREAK FREEZE EQUIPPED` : "NO STREAK FREEZE EQUIPPED"}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {freezes > 0 ? "Protected! Streak won't break if you miss 1 day." : "Miss a day and streak resets. Equip protection!"}
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
              {buyingFreeze ? "Equipping..." : "+ Equip (200 🪙)"}
            </button>
          )}
        </div>

        {/* Daily Quests Trio */}
        {questsSummary && (
          <div className="daily-quests-box">
            <div className="daily-quests-header">
              <span style={{ fontWeight: 800, letterSpacing: "1px" }}>🎯 TODAY'S DAILY QUESTS</span>
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>
                {questsSummary.quests.filter((q) => q.done).length}/3 Done
              </span>
            </div>
            <div className="daily-quests-list">
              {questsSummary.quests.map((q) => (
                <div key={q.id} className="daily-quest-item">
                  <span style={{ fontSize: 22 }}>{q.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                      <span>{q.title}</span>
                      <span style={{ color: q.done ? "#22c55e" : "#94a3b8" }}>
                        {q.done ? "COMPLETED ✓" : `${q.current}/${q.target}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{q.desc}</div>
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
                <span>🏆</span> CRACK DAILY VAULT (+100 🪙 &amp; +250 XP)
              </button>
            )}
            {questsSummary.vaultClaimed && (
              <div className="daily-vault-done">
                <span>✓</span> Daily Loot Vault Claimed Today!
              </div>
            )}
          </div>
        )}

        {/* Milestone Progress Bar */}
        {nextMilestoneBonus && (
          <div className="daily-milestone-wrap">
            <div className="daily-milestone-head">
              <span>Next Milestone: {nextMilestoneDays}-Day Streak</span>
              <span className="daily-milestone-reward">+{nextMilestoneBonus.xp} XP & +{nextMilestoneBonus.coins} Coins</span>
            </div>
            <div className="daily-progress-track">
              <div className="daily-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        {/* Featured Challenge Card */}
        <div className="daily-featured-card">
          <span className="daily-featured-badge">⭐ TODAY'S FEATURED CHALLENGE</span>
          <div className="daily-featured-body">
            <div className="daily-featured-info">
              <h3 className="daily-featured-name">{GAME_LABELS[featuredGame].title}</h3>
              <p className="daily-featured-desc">{featuredChallenge.description}</p>
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
              aria-label={featuredCompleted ? "Completed" : `Play ${GAME_LABELS[featuredGame].title} Daily Challenge`}
            >
              {featuredCompleted ? "COMPLETED ✅" : "PLAY DEAL"}
            </button>
          </div>
        </div>

        {/* Today's Speed Benchmarks & Top Solvers */}
        <div className="daily-leaderboard-card">
          <div className="daily-leaderboard-header">
            <div className="daily-leaderboard-title">
              <span>⚡</span> TODAY'S PAR TIMES ({GAME_LABELS[featuredGame].title})
            </div>
            <div className="daily-speed-badge">Speed XP Active</div>
          </div>

          <div className="daily-leaderboard-list">
            {leaderboard.entries.map((entry) => (
              <div
                key={entry.name}
                className={`daily-leaderboard-row ${entry.isUser ? "user-row" : ""}`}
              >
                <div className="daily-solver-left">
                  <span className="daily-solver-rank">{entry.medal}</span>
                  <span className="daily-solver-name">{entry.isUser ? "Your best" : entry.name}</span>
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
                  <span>💡</span> Beat <strong>{pars[0]?.time ?? "1:30"}</strong> for Gold par and the most speed bonus XP!
                </div>
              );
            return (
              <div className={`daily-leaderboard-hint ${beaten ? "podium-win" : ""}`}>
                <span>{beaten ? beaten.medal : "👤"}</span>{" "}
                {beaten === pars[0]
                  ? "You beat Gold par today!"
                  : beaten
                    ? `You beat ${beaten.name}. Beat ${pars[0]?.time} for Gold!`
                    : `Your best is ${mine.time}. Beat ${pars[2]?.time} for Bronze par!`}
              </div>
            );
          })()}
        </div>



        {/* 8-Game Grid */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 className="daily-grid-title">All 8 Daily Challenges ({completedCount}/8 Done)</h4>
          <span style={{ fontSize: 11, color: "var(--gold)", fontFamily: "var(--cond)" }}>
            +50 XP · +15 Coins each
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
                      {isDone ? "Completed Today ✅" : `Deal #${ch.seed % 1000}`}
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
                  aria-label={`${isDone ? "Replay" : "Play"} ${info.title} challenge`}
                >
                  {isDone ? "REPLAY" : "PLAY"}
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
            aria-label="Share Daily Challenge Scorecard"
          >
            {copiedShare ? "Result Copied to Clipboard! 📋" : "Share Daily Challenge Result 📲"}
          </button>
          <div style={{ fontSize: 12, color: "#8a909b", textAlign: "center", fontStyle: "italic" }}>
            Share your daily streak with friends on iMessage, WhatsApp, or Twitter.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
