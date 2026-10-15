import { describe, expect, it } from "vitest";
import {
  DAILY_GAMES,
  DAILY_BASE_BONUS_XP,
  DAILY_BASE_BONUS_COINS,
  STREAK_MILESTONES,
  daysBetween,
  getDailyChallenge,
  getDailySeed,
  getMilestoneBonus,
  getStreakMultiplier,
  isChallengeCompleted,
  isDailyGame,
  newDailyProgress,
  newProgress,
  recordDailyCompletion,
  settleDailyChallenge,
  settleSolitaire,
  settleFreeCell,
  settleScoundrel,
  settleTriPeaks,
  todayUtc,
  upgrade,
  failed,
  levelInfo,
  buyStreakFreeze,
  getDailyQuests,
  recordQuestActivity,
  claimDailyVault,
  type DailyGame,
} from "../src";

describe("Daily Seed Generator", () => {
  it("generates deterministic seeds for the same game and date", () => {
    const seed1 = getDailySeed("solitaire", "2026-10-15");
    const seed2 = getDailySeed("solitaire", "2026-10-15");
    const seed3 = getDailySeed("solitaire", "2026-10-15");
    expect(seed1).toBe(seed2);
    expect(seed2).toBe(seed3);
    expect(typeof seed1).toBe("number");
    expect(seed1).toBeGreaterThan(0);
  });

  it("defaults to today's UTC date when dateStr is omitted", () => {
    const today = todayUtc();
    const implicit = getDailySeed("solitaire");
    const explicit = getDailySeed("solitaire", today);
    expect(implicit).toBe(explicit);
  });

  it("generates distinct seeds for all 8 games on the same date", () => {
    const testDate = "2026-10-15";
    const seeds = DAILY_GAMES.map((game) => getDailySeed(game, testDate));
    const uniqueSeeds = new Set(seeds);
    expect(uniqueSeeds.size).toBe(DAILY_GAMES.length);
  });

  it("generates distinct seeds across consecutive dates for the same game", () => {
    const seeds = new Set<number>();
    for (let day = 1; day <= 30; day++) {
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      const dateStr = `2026-11-${dayStr}`;
      const seed = getDailySeed("scoundrel", dateStr);
      expect(seeds.has(seed)).toBe(false);
      seeds.add(seed);
    }
    expect(seeds.size).toBe(30);
  });

  it("simulates 365 days across all 8 games with high seed entropy and 0 collisions", () => {
    const allSeeds = new Set<number>();
    const startDate = new Date(Date.UTC(2026, 0, 1));

    for (let i = 0; i < 365; i++) {
      const d = new Date(startDate.getTime() + i * 86_400_000);
      const dateStr = d.toISOString().slice(0, 10);
      for (const game of DAILY_GAMES) {
        const seed = getDailySeed(game, dateStr);
        expect(seed).toBeGreaterThan(0);
        expect(seed).toBeLessThanOrEqual(0xffffffff);
        allSeeds.add(seed);
      }
    }

    // 365 * 8 = 2920 unique deals
    expect(allSeeds.size).toBe(365 * 8);
  });

  it("is case-insensitive for game names", () => {
    expect(getDailySeed("SOLITAIRE", "2026-10-15")).toBe(getDailySeed("solitaire", "2026-10-15"));
    expect(getDailySeed("FreeCell", "2026-10-15")).toBe(getDailySeed("freecell", "2026-10-15"));
  });
});

describe("Date Utilities & Calendar Math", () => {
  it("computes exact day differences across regular days, months, leap years", () => {
    expect(daysBetween("2026-10-15", "2026-10-15")).toBe(0);
    expect(daysBetween("2026-10-15", "2026-10-16")).toBe(1);
    expect(daysBetween("2026-10-15", "2026-10-17")).toBe(2);
    expect(daysBetween("2026-10-17", "2026-10-15")).toBe(-2);

    // Month boundary
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    // Year boundary
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    // Leap year February
    expect(daysBetween("2024-02-28", "2024-02-29")).toBe(1);
    expect(daysBetween("2024-02-29", "2024-03-01")).toBe(1);
  });
});

describe("Daily Challenge Definitions", () => {
  it("provides definitions with valid goals and rewards for all 8 games", () => {
    for (const game of DAILY_GAMES) {
      expect(isDailyGame(game)).toBe(true);
      const challenge = getDailyChallenge(game, "2026-10-15");
      expect(challenge.game).toBe(game);
      expect(challenge.date).toBe("2026-10-15");
      expect(challenge.seed).toBeGreaterThan(0);
      expect(challenge.title.length).toBeGreaterThan(0);
      expect(challenge.description.length).toBeGreaterThan(0);
      expect(challenge.bonusXp).toBe(DAILY_BASE_BONUS_XP);
      expect(challenge.bonusCoins).toBe(DAILY_BASE_BONUS_COINS);
      expect(["win", "score", "rooms", "peaks", "suits"]).toContain(challenge.goal.type);
      expect(challenge.goal.target).toBeGreaterThan(0);
    }
  });

  it("checks completion for various goal types", () => {
    const winChallenge = getDailyChallenge("solitaire", "2026-10-15");
    expect(isChallengeCompleted(winChallenge, { won: true })).toBe(true);
    expect(isChallengeCompleted(winChallenge, { won: false })).toBe(false);

    const roomChallenge = {
      ...winChallenge,
      goal: { type: "rooms" as const, target: 10, description: "Clear 10 rooms" },
    };
    expect(isChallengeCompleted(roomChallenge, { roomsCleared: 9 })).toBe(false);
    expect(isChallengeCompleted(roomChallenge, { roomsCleared: 10 })).toBe(true);
    expect(isChallengeCompleted(roomChallenge, { roomsCleared: 12 })).toBe(true);
    expect(isChallengeCompleted(roomChallenge, { won: true })).toBe(true);

    const peakChallenge = {
      ...winChallenge,
      goal: { type: "peaks" as const, target: 3, description: "Clear 3 peaks" },
    };
    expect(isChallengeCompleted(peakChallenge, { peaks: 2 })).toBe(false);
    expect(isChallengeCompleted(peakChallenge, { peaks: 3 })).toBe(true);
  });
});

describe("Streak Progression & Multipliers", () => {
  it("computes monotonic streak multipliers up to 30 days", () => {
    expect(getStreakMultiplier(0)).toBe(1.0);
    expect(getStreakMultiplier(1)).toBe(1.0);
    expect(getStreakMultiplier(2)).toBe(1.1);
    expect(getStreakMultiplier(3)).toBe(1.25);
    expect(getStreakMultiplier(6)).toBe(1.25);
    expect(getStreakMultiplier(7)).toBe(1.5);
    expect(getStreakMultiplier(13)).toBe(1.5);
    expect(getStreakMultiplier(14)).toBe(1.75);
    expect(getStreakMultiplier(29)).toBe(1.75);
    expect(getStreakMultiplier(30)).toBe(2.0);
    expect(getStreakMultiplier(100)).toBe(2.0);
  });

  it("provides milestone bonuses for 3-day, 7-day, 14-day, 30-day", () => {
    expect(getMilestoneBonus(1)).toBeNull();
    expect(getMilestoneBonus(2)).toBeNull();

    const m3 = getMilestoneBonus(3);
    expect(m3).toEqual(STREAK_MILESTONES[3]);
    expect(m3?.xp).toBe(100);
    expect(m3?.coins).toBe(25);

    const m7 = getMilestoneBonus(7);
    expect(m7).toEqual(STREAK_MILESTONES[7]);
    expect(m7?.xp).toBe(250);
    expect(m7?.coins).toBe(75);

    const m14 = getMilestoneBonus(14);
    expect(m14?.xp).toBe(500);

    const m30 = getMilestoneBonus(30);
    expect(m30).toEqual(STREAK_MILESTONES[30]);
    expect(m30?.xp).toBe(1000);
    expect(m30?.coins).toBe(300);
  });
});

describe("recordDailyCompletion Streak Tracking", () => {
  it("starts at streak 1 on first ever completion", () => {
    const p = newProgress();
    const res = recordDailyCompletion(p, "solitaire", "2026-10-01");
    expect(res.streak).toBe(1);
    expect(res.longestStreak).toBe(1);
    expect(res.multiplier).toBe(1.0);
    expect(res.baseBonusXp).toBe(50);
    expect(res.bonusXp).toBe(50);
    expect(res.bonusCoins).toBe(15);
    expect(res.milestoneBonus).toBeNull();
    expect(res.progress.daily?.current).toBe(1);
    expect(res.progress.daily?.longest).toBe(1);
    expect(res.progress.daily?.lastDate).toBe("2026-10-01");
  });

  it("maintains continuity on consecutive days and awards milestone bonuses", () => {
    let p = newProgress();

    // Day 1
    p = recordDailyCompletion(p, "solitaire", "2026-10-01").progress;
    expect(p.daily?.current).toBe(1);
    expect(p.daily?.longest).toBe(1);

    // Day 2
    const d2 = recordDailyCompletion(p, "solitaire", "2026-10-02");
    p = d2.progress;
    expect(d2.streak).toBe(2);
    expect(d2.longestStreak).toBe(2);
    expect(d2.multiplier).toBe(1.1);
    expect(d2.bonusXp).toBe(Math.round(50 * 1.1)); // 55
    expect(d2.milestoneBonus).toBeNull();

    // Day 3 (Milestone 3!)
    const d3 = recordDailyCompletion(p, "solitaire", "2026-10-03");
    p = d3.progress;
    expect(d3.streak).toBe(3);
    expect(d3.longestStreak).toBe(3);
    expect(d3.multiplier).toBe(1.25);
    expect(d3.milestoneBonus).not.toBeNull();
    expect(d3.milestoneBonus?.streak).toBe(3);
    // 50 * 1.25 = 63, plus 100 milestone XP = 163
    expect(d3.bonusXp).toBe(63 + 100);
    expect(d3.bonusCoins).toBe(15 + 25);

    // Advance to Day 7 (Milestone 7!)
    p = recordDailyCompletion(p, "freecell", "2026-10-04").progress;
    p = recordDailyCompletion(p, "spider", "2026-10-05").progress;
    p = recordDailyCompletion(p, "tripeaks", "2026-10-06").progress;
    const d7 = recordDailyCompletion(p, "scoundrel", "2026-10-07");
    p = d7.progress;
    expect(d7.streak).toBe(7);
    expect(d7.longestStreak).toBe(7);
    expect(d7.multiplier).toBe(1.5);
    expect(d7.milestoneBonus?.streak).toBe(7);
    expect(d7.milestoneBonus?.xp).toBe(250);
    // 50 * 1.5 = 75, plus 250 milestone XP = 325
    expect(d7.bonusXp).toBe(75 + 250);
  });

  it("resets broken streak after missing a day while preserving longest streak", () => {
    let p = newProgress();

    // Build 5-day streak: Oct 1 through Oct 5
    for (let day = 1; day <= 5; day++) {
      const dateStr = `2026-10-0${day}`;
      p = recordDailyCompletion(p, "solitaire", dateStr).progress;
    }
    expect(p.daily?.current).toBe(5);
    expect(p.daily?.longest).toBe(5);

    // Miss Oct 6! Play on Oct 7 (gap of 2 days)
    const broken = recordDailyCompletion(p, "solitaire", "2026-10-07");
    p = broken.progress;

    expect(broken.streak).toBe(1); // Reset to 1
    expect(broken.longestStreak).toBe(5); // Preserved!
    expect(p.daily?.current).toBe(1);
    expect(p.daily?.longest).toBe(5);
    expect(broken.multiplier).toBe(1.0);

    // Play on Oct 8 (consecutive to Oct 7)
    const nextDay = recordDailyCompletion(p, "solitaire", "2026-10-08");
    p = nextDay.progress;
    expect(nextDay.streak).toBe(2);
    expect(nextDay.longestStreak).toBe(5);
  });

  it("handles multiple game completions on the same day", () => {
    let p = newProgress();

    // Complete Solitaire on Oct 10
    const sol = recordDailyCompletion(p, "solitaire", "2026-10-10");
    p = sol.progress;
    expect(sol.streak).toBe(1);
    expect(sol.gameAlreadyCompleted).toBe(false);
    expect(sol.alreadyCompletedToday).toBe(false);
    expect(sol.bonusXp).toBe(50);

    // Complete FreeCell on same day Oct 10
    const fc = recordDailyCompletion(p, "freecell", "2026-10-10");
    p = fc.progress;
    expect(fc.streak).toBe(1); // Streak does NOT advance twice on same calendar day
    expect(fc.alreadyCompletedToday).toBe(true);
    expect(fc.gameAlreadyCompleted).toBe(false);
    expect(fc.bonusXp).toBe(50); // Still gets daily clear bonus for FreeCell!

    // Repeat Solitaire on Oct 10 (already completed today)
    const solRepeat = recordDailyCompletion(p, "solitaire", "2026-10-10");
    expect(solRepeat.streak).toBe(1);
    expect(solRepeat.gameAlreadyCompleted).toBe(true);
    expect(solRepeat.bonusXp).toBe(0); // No double dipping
  });

  it("tracks 30-day streak milestone through simulation", () => {
    let p = newProgress();
    const startDate = new Date(Date.UTC(2026, 4, 1)); // May 1, 2026

    for (let day = 0; day < 30; day++) {
      const d = new Date(startDate.getTime() + day * 86_400_000);
      const dateStr = d.toISOString().slice(0, 10);
      const game = DAILY_GAMES[day % DAILY_GAMES.length];
      const res = recordDailyCompletion(p, game, dateStr);
      p = res.progress;

      expect(res.streak).toBe(day + 1);
      expect(res.longestStreak).toBe(day + 1);

      if (day + 1 === 3) {
        expect(res.milestoneBonus?.streak).toBe(3);
      } else if (day + 1 === 7) {
        expect(res.milestoneBonus?.streak).toBe(7);
      } else if (day + 1 === 14) {
        expect(res.milestoneBonus?.streak).toBe(14);
      } else if (day + 1 === 30) {
        expect(res.milestoneBonus?.streak).toBe(30);
        expect(res.multiplier).toBe(2.0);
        expect(res.milestoneBonus?.xp).toBe(1000);
        expect(res.milestoneBonus?.coins).toBe(300);
        // 50 * 2.0 = 100, plus 1000 = 1100
        expect(res.bonusXp).toBe(1100);
      }
    }

    expect(p.daily?.current).toBe(30);
    expect(p.daily?.longest).toBe(30);
  });
});

describe("settleDailyChallenge Integration in progress.ts", () => {
  it("settles daily challenge and grants bonus XP, coins, and updates streak", () => {
    const p = newProgress();
    const at = Date.UTC(2026, 9, 15, 12, 0, 0);
    const res = settleDailyChallenge(p, "solitaire", at, { won: true });

    expect(failed(res)).toBe(false);
    if (!failed(res)) {
      expect(res.reward.xp).toBe(50);
      expect(res.reward.coins).toBe(15);
      expect(res.reward.lines[0].label).toContain("Daily Challenge");
      expect(res.progress.xp).toBe(50);
      expect(res.progress.coins).toBe(p.coins + 15);
      expect(res.progress.daily?.current).toBe(1);
      expect(res.progress.daily?.longest).toBe(1);
      expect(res.daily.streak).toBe(1);
    }
  });

  it("fails when daily challenge goal is not met", () => {
    const p = newProgress();
    const at = Date.UTC(2026, 9, 15, 12, 0, 0);
    const res = settleDailyChallenge(p, "solitaire", at, { won: false });
    expect(failed(res)).toBe(true);
    if (failed(res)) {
      expect(res.error).toContain("Challenge goal not met");
    }
  });

  it("awards 0 bonus if same daily challenge settled twice on same day", () => {
    const p = newProgress();
    const at = Date.UTC(2026, 9, 15, 12, 0, 0);
    const first = settleDailyChallenge(p, "solitaire", at, { won: true });
    expect(failed(first)).toBe(false);

    if (!failed(first)) {
      const second = settleDailyChallenge(first.progress, "solitaire", at, { won: true });
      expect(failed(second)).toBe(false);
      if (!failed(second)) {
        expect(second.reward.xp).toBe(0);
        expect(second.reward.lines[0].label).toContain("already cleared today");
      }
    }
  });
});

describe("settle<Game> isDaily integration", () => {
  it("settleSolitaire with isDaily = true awards daily bonus and updates streak", () => {
    const p = newProgress();
    const at = Date.UTC(2026, 9, 15, 10, 0, 0);
    const tally = { moves: 60, aces: 4, stacks: 4, won: true };

    const res = settleSolitaire(p, at, tally, undefined, true);
    expect(res.reward.daily).toBeDefined();
    expect(res.reward.daily?.streak).toBe(1);
    expect(res.progress.daily?.current).toBe(1);

    const dailyLine = res.reward.lines.find((l) => l.label.includes("Daily Challenge"));
    expect(dailyLine).toBeDefined();
    expect(dailyLine?.xp).toBe(50);
  });

  it("settleFreeCell with isDaily = true advances consecutive streak on next day", () => {
    const p = newProgress();
    const day1 = Date.UTC(2026, 9, 15, 10, 0, 0);
    const day2 = Date.UTC(2026, 9, 16, 10, 0, 0);

    const res1 = settleSolitaire(p, day1, { moves: 50, aces: 4, stacks: 4, won: true }, undefined, true);
    expect(res1.progress.daily?.current).toBe(1);

    const res2 = settleFreeCell(res1.progress, day2, { moves: 50, aces: 4, stacks: 4, won: true }, undefined, true);
    expect(res2.progress.daily?.current).toBe(2);
    expect(res2.reward.daily?.streak).toBe(2);
    expect(res2.reward.daily?.multiplier).toBe(1.1);
  });

  it("settleScoundrel with isDaily = true satisfies room goal even when not escaping", () => {
    const p = newProgress();
    const at = Date.UTC(2026, 9, 15, 10, 0, 0);
    const tally = { monstersSlayed: 15, roomsCleared: 12, hpLeft: 0, won: false };

    const res = settleScoundrel(p, at, tally, undefined, true);
    expect(res.reward.daily).toBeDefined();
    expect(res.reward.daily?.streak).toBe(1);
  });

  it("settleTriPeaks with isDaily = true awards daily bonus when peaks cleared", () => {
    const p = newProgress();
    const at = Date.UTC(2026, 9, 15, 10, 0, 0);
    const tally = { cleared: 28, peaks: 3, maxStreak: 8, won: true };

    const res = settleTriPeaks(p, at, tally, undefined, true);
    expect(res.reward.daily).toBeDefined();
    expect(res.reward.daily?.streak).toBe(1);
  });
});

describe("upgrade function preserves daily state", () => {
  it("initializes daily state on fresh partial upgrade", () => {
    const up = upgrade({ chips: 5000 });
    expect(up.daily).toBeDefined();
    expect(up.daily?.current).toBe(0);
    expect(up.daily?.longest).toBe(0);
  });

  it("merges existing daily progress cleanly", () => {
    const base = newDailyProgress();
    base.current = 5;
    base.longest = 10;
    base.lastDate = "2026-10-15";
    base.streak = { current: 5, longest: 10, lastDate: "2026-10-15" };

    const up = upgrade({ chips: 5000, daily: base });
    expect(up.daily?.current).toBe(5);
    expect(up.daily?.longest).toBe(10);
    expect(up.daily?.lastDate).toBe("2026-10-15");
  });
});

describe("Streak Freeze System (Duolingo Retention Model)", () => {
  it("allows purchasing a streak freeze with 200 coins up to max 2", () => {
    let p = newProgress();
    p.coins = 500;
    expect(p.daily?.freezes ?? 0).toBe(0);

    const b1 = buyStreakFreeze(p);
    expect(b1.success).toBe(true);
    expect(b1.progress.coins).toBe(300);
    expect(b1.progress.daily?.freezes).toBe(1);

    const b2 = buyStreakFreeze(b1.progress);
    expect(b2.success).toBe(true);
    expect(b2.progress.coins).toBe(100);
    expect(b2.progress.daily?.freezes).toBe(2);

    // Cannot exceed max 2 freezes
    const b3 = buyStreakFreeze(b2.progress);
    expect(b3.success).toBe(false);
    expect(b3.error).toContain("Maximum 2");
  });

  it("consumes an equipped freeze on 1 missed day to keep streak intact", () => {
    let p = newProgress();
    // Play on day 1
    p = recordDailyCompletion(p, "solitaire", "2026-10-10").progress;
    expect(p.daily?.current).toBe(1);

    // Equip 1 freeze
    p.daily!.freezes = 1;

    // Skip day 2 (2026-10-11) and play on day 3 (2026-10-12)
    const res = recordDailyCompletion(p, "solitaire", "2026-10-12");
    expect(res.usedFreeze).toBe(true);
    expect(res.streak).toBe(2); // Streak continues!
    expect(res.progress.daily?.freezes).toBe(0); // Freeze consumed!
    expect(res.progress.daily?.usedFreezeDates).toContain("2026-10-12");
  });
});

describe("Daily Quest Trio & Loot Vault", () => {
  it("tracks moves and xp towards daily quests and cracks the vault", () => {
    let p = newProgress();
    const today = todayUtc();

    let q = getDailyQuests(p, today);
    expect(q.allCompleted).toBe(false);
    expect(q.quests[0].done).toBe(false);

    // Record activity: 30 moves, 200 xp
    p = recordQuestActivity(p, { moves: 35, xp: 250 }, today);
    q = getDailyQuests(p, today);
    expect(q.quests[0].done).toBe(true); // 30+ moves
    expect(q.quests[1].done).toBe(true); // 200+ xp
    expect(q.quests[2].done).toBe(false); // Daily challenge not done yet

    // Complete daily challenge
    p = recordDailyCompletion(p, "solitaire", today).progress;
    q = getDailyQuests(p, today);
    expect(q.allCompleted).toBe(true);
    expect(q.vaultClaimed).toBe(false);

    // Claim loot vault
    const claim = claimDailyVault(p, today);
    expect(claim.success).toBe(true);
    expect(claim.coins).toBe(100);
    expect(claim.xp).toBe(250);
    expect(claim.progress.coins).toBe(p.coins + 100);
  });
});
