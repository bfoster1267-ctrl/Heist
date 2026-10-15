// Helpers for generating Wordle-style share cards and asymmetric friend challenge links

import {
  formatDailyChallengeNumber,
  getDailyStreak,
  getStreakMultiplier,
  todayUtc,
  type DailyGame,
  type Progress,
} from "@heist/profile";

export interface DailySharePayload {
  game: DailyGame;
  gameTitle: string;
  won: boolean;
  time?: string;
  moves?: number;
  score?: number;
  streak?: number;
  multiplier?: number;
  challengeNumber?: number;
}

export function createDailyShareText({
  gameTitle,
  won,
  time,
  moves,
  score,
  streak = 1,
  multiplier = 1.0,
  challengeNumber = formatDailyChallengeNumber(),
}: DailySharePayload): string {
  const resultIcon = won ? "🏆 WON" : "⚔️ PLAYED";
  const metrics = [
    time ? `⏱️ ${time}` : null,
    moves !== undefined ? `🎯 ${moves} moves` : null,
    score !== undefined ? `⭐ ${score} pts` : null,
  ].filter(Boolean).join(" · ");

  const streakLine = `🔥 ${streak}-Day Streak (${multiplier}x Multiplier)`;
  const url = `${typeof window !== "undefined" ? window.location.origin : "https://playheist.net"}/?daily=1`;

  return [
    `🃏 HEIST DAILY CHALLENGE #${challengeNumber}`,
    `${resultIcon}: ${gameTitle}`,
    metrics,
    streakLine,
    `Can you beat my record? 👉 ${url}`,
  ].filter(Boolean).join("\n");
}

export async function shareDailyResult(payload: DailySharePayload): Promise<boolean> {
  const text = createDailyShareText(payload);
  const url = `${typeof window !== "undefined" ? window.location.origin : "https://playheist.net"}/?daily=1`;

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: `Heist Daily Challenge #${payload.challengeNumber ?? formatDailyChallengeNumber()}`,
        text,
        url,
      });
      return true;
    } catch {
      /* user dismissed native share dialog */
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* clipboard write denied */
    }
  }

  return false;
}

export interface FriendChallengePayload {
  game: string;
  gameTitle: string;
  seed: number;
  time?: string;
  moves?: number;
  score?: number;
}

export function createFriendChallengeUrl({
  game,
  seed,
  time,
  moves,
  score,
}: FriendChallengePayload): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://playheist.net";
  const u = new URL(`${origin}/${game}`);
  u.searchParams.set("challenge", String(seed));
  if (time) u.searchParams.set("ctime", time);
  if (moves !== undefined) u.searchParams.set("cmoves", String(moves));
  if (score !== undefined) u.searchParams.set("cscore", String(score));
  return u.toString();
}

export function createFriendChallengeText(payload: FriendChallengePayload): string {
  const url = createFriendChallengeUrl(payload);
  const metrics = [
    payload.time ? `⏱️ Time: ${payload.time}` : null,
    payload.moves !== undefined ? `🎯 Moves: ${payload.moves}` : null,
    payload.score !== undefined ? `⭐ Score: ${payload.score}` : null,
  ].filter(Boolean).join(" | ");

  return [
    `🃏 Can you beat my deal on Heist?`,
    `🎮 ${payload.gameTitle} · Deal #${payload.seed}`,
    metrics,
    `Play the exact same cards: 👉 ${url}`,
  ].filter(Boolean).join("\n");
}

export async function shareFriendChallenge(payload: FriendChallengePayload): Promise<boolean> {
  const text = createFriendChallengeText(payload);
  const url = createFriendChallengeUrl(payload);

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: `Challenge: Beat my score in ${payload.gameTitle}!`,
        text,
        url,
      });
      return true;
    } catch {
      /* user dismissed native share */
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* clipboard error */
    }
  }

  return false;
}
