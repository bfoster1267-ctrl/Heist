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

export function parseSeconds(time?: string): number {
  if (!time) return 0;
  const parts = time.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

export function parseSpeedBonus(time?: string): number {
  const s = parseSeconds(time);
  return s > 0 && s < 300 ? 300 - s : 0;
}

export interface DailyBestRecord {
  time: string;
  seconds: number;
  moves?: number;
  score?: number;
  timestamp: number;
}

export function getDailyBest(game: string, date = todayUtc()): DailyBestRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`heist.dailyBest.${date}.${game}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveDailyBest(
  game: string,
  date: string,
  record: { time: string; moves?: number; score?: number }
) {
  if (typeof window === "undefined") return;
  try {
    const seconds = parseSeconds(record.time);
    if (seconds <= 0) return;
    const existing = getDailyBest(game, date);
    if (!existing || seconds < existing.seconds) {
      localStorage.setItem(
        `heist.dailyBest.${date}.${game}`,
        JSON.stringify({
          ...record,
          seconds,
          timestamp: Date.now(),
        })
      );
    }
  } catch {}
}

export interface DailyLeaderboardEntry {
  rank: number;
  name: string;
  medal: string;
  time: string;
  seconds: number;
  bonusXp: number;
  isUser?: boolean;
}

export function getDailyLeaderboard(
  game: DailyGame,
  seed: number,
  userRecord?: DailyBestRecord | null
): { entries: DailyLeaderboardEntry[]; userRank: number | null } {
  const baseSeconds: Record<DailyGame, number> = {
    solitaire: 96,
    freecell: 112,
    tripeaks: 78,
    spider: 165,
    pyramid: 88,
    yukon: 128,
    ers: 68,
    scoundrel: 142,
    hearts: 720,
    spades: 540,
  };

  const seedOffset = (seed % 17) - 8;
  const t1 = Math.max(45, (baseSeconds[game] ?? 100) + seedOffset);
  const t2 = t1 + 15 + (seed % 8);
  const t3 = t2 + 20 + ((seed >> 2) % 11);

  // par times to aim for, not players: there's no shared board yet, so no names that read like people
  const topSolvers = [
    { rank: 1, name: "Gold par", medal: "🥇", seconds: t1 },
    { rank: 2, name: "Silver par", medal: "🥈", seconds: t2 },
    { rank: 3, name: "Bronze par", medal: "🥉", seconds: t3 },
  ];

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  const rivalEntries: DailyLeaderboardEntry[] = topSolvers.map((s) => ({
    rank: s.rank,
    name: s.name,
    medal: s.medal,
    seconds: s.seconds,
    time: formatTime(s.seconds),
    bonusXp: Math.max(0, 300 - s.seconds),
  }));

  if (!userRecord || userRecord.seconds <= 0) {
    return { entries: rivalEntries, userRank: null };
  }

  const all: DailyLeaderboardEntry[] = [
    ...rivalEntries,
    {
      rank: 99,
      name: "You",
      medal: "👤",
      seconds: userRecord.seconds,
      time: userRecord.time,
      bonusXp: Math.max(0, 300 - userRecord.seconds),
      isUser: true,
    },
  ];

  all.sort((a, b) => a.seconds - b.seconds);
  const reindexed = all.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));

  const userRank = reindexed.find((e) => e.isUser)?.rank ?? null;
  return { entries: reindexed, userRank };
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
  const speed = parseSpeedBonus(time);
  const metrics = [
    time ? `⏱️ ${time}${speed > 0 ? ` (⚡ +${speed} XP)` : ""}` : null,
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
  const speed = parseSpeedBonus(payload.time);
  const metrics = [
    payload.time ? `⏱️ Time: ${payload.time}${speed > 0 ? ` (⚡ +${speed} XP Speed Bonus!)` : ""}` : null,
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
