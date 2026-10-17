// Compact banner component displayed in the Lobby and Arcade Hub
// Shows active streak, today's featured challenge, countdown timer, and 1-tap open.

import {
  formatCountdown,
  formatDailyChallengeNumber,
  getDailyStreak,
  getFeaturedDailyGame,
  getRemainingMsUntilNextUtcDay,
  todayUtc,
  type Progress,
} from "@heist/profile";
import { useEffect, useState } from "react";
import { buzz } from "../haptics";
import { click } from "../sound";
import "./daily.css";
import { GAME_LABELS } from "./DailyHub";
import { t } from "../i18n";

export function ChallengeBanner({
  progress,
  onOpenDaily,
}: {
  progress?: Progress;
  onOpenDaily: () => void;
}) {
  const [msLeft, setMsLeft] = useState(() => getRemainingMsUntilNextUtcDay());

  useEffect(() => {
    const timer = setInterval(() => {
      setMsLeft(getRemainingMsUntilNextUtcDay());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const today = todayUtc();
  const streak = progress ? getDailyStreak(progress, Date.now()) : 0;
  const challengeNo = formatDailyChallengeNumber(today);
  const featured = getFeaturedDailyGame();
  const info = GAME_LABELS[featured];
  const isDone = Boolean(progress?.daily?.completed?.[`${today}:${featured}`]);

  return (
    <div
      className="daily-banner-pill"
      onClick={() => {
        click();
        buzz("tap");
        onOpenDaily();
      }}
      role="button"
      tabIndex={0}
      aria-label={t("dly.bannerAria", { no: String(challengeNo), game: info.title, streak, time: formatCountdown(msLeft) })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDaily();
        }
      }}
    >
      <div className="daily-banner-left">
        <span className="daily-banner-flame" aria-hidden="true">🔥</span>
        <div className="daily-banner-text">
          <span className="daily-banner-headline">
            {streak > 0 ? t("dly.bannerStreak", { count: streak }) : t("dly.bannerNo", { no: String(challengeNo) })} · {info.title}
          </span>
          <span className="daily-banner-sub">
            {isDone ? t("dly.doneToday") : t("dly.bannerSub", { time: formatCountdown(msLeft) })}
          </span>
        </div>
      </div>

      <button type="button" className="daily-banner-btn" aria-hidden="true" tabIndex={-1}>
        {isDone ? t("dly.view") : t("dly.play")}

      </button>
    </div>
  );
}
