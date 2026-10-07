import { Bot, runBots, type Answer } from "@heist/engine";
import { describe, expect, it } from "vitest";
import {
  MAX_LEVEL, buy, canPrestige, createSoloGame, equip, failed, level, levelInfo, newProgress, owns, payForDrink, payout,
  prestige, replaySolo, settle, summarize, xpForLevel, xpToNext, type GameResult, type GameSummary, type Progress,
} from "../src";

/** Play a solo game with a bot in the human seat, recording its answers like the table does. */
function playSolo(seed: number, players: number) {
  const { game, bots } = createSoloGame(seed, players, "Tester");
  const me = new Bot(seed ^ 0xabc);
  const answers: Answer[] = [];
  for (let i = 0; i < 100_000; i++) {
    runBots(game, bots);
    const p = game.pending;
    if (!p) break;
    const a = me.answer(game, p);
    game.answer(p.seat, a);
    answers.push(a);
  }
  return { answers, winners: game.s.winners! };
}

const noSummary: GameSummary = { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 };
const result = (o: Partial<GameResult> = {}): GameResult => ({ mode: "bots", players: 4, stakes: 250, won: true, payout: 1000, summary: noSummary, at: Date.UTC(2026, 9, 7), ...o });

describe("solo replay", () => {
  it("rebuilds the same result from seed and answers", () => {
    for (const [seed, n] of [[11, 3], [22, 4], [33, 5], [44, 6]]) {
      const g = playSolo(seed, n);
      const r = replaySolo(seed, n, g.answers);
      expect(r.winners).toEqual(g.winners);
      expect(r.events.at(-1)?.t).toBe("gameOver");
    }
  });

  it("rejects unfinished, padded or illegal answer lists", () => {
    const g = playSolo(5, 4);
    expect(() => replaySolo(5, 4, g.answers.slice(0, -1))).toThrow();
    expect(() => replaySolo(5, 4, [...g.answers, g.answers[0]])).toThrow();
    expect(() => replaySolo(6, 4, g.answers)).toThrow();
  });

  it("summarizes a seat's game", () => {
    const g = playSolo(77, 4);
    const r = replaySolo(77, 4, g.answers);
    const s = summarize(r.events, 0);
    expect(s.role).not.toBeNull();
    const totalFootholds = [0, 1, 2, 3].reduce((t, seat) => t + summarize(r.events, seat).footholds, 0);
    expect(totalFootholds).toBeGreaterThan(0);
  });

  it("splits the pot between winners", () => {
    expect(payout(250, 4, [0], 0)).toBe(1000);
    expect(payout(250, 4, [0, 2], 0)).toBe(500);
    expect(payout(250, 4, [1], 0)).toBe(0);
  });
});

describe("levels", () => {
  it("climbs a growing curve to the cap", () => {
    expect(xpToNext(1)).toBe(200);
    expect(levelInfo(0).level).toBe(1);
    expect(levelInfo(199).level).toBe(1);
    expect(levelInfo(200).level).toBe(2);
    expect(levelInfo(xpForLevel(MAX_LEVEL)).maxed).toBe(true);
    expect(levelInfo(xpForLevel(MAX_LEVEL) * 2).level).toBe(MAX_LEVEL);
  });
});

describe("settling a game", () => {
  it("pays chips, XP, coins and records stats", () => {
    const { progress: p, reward } = settle(newProgress(), result());
    expect(p.chips).toBe(10_000 + 1000);
    expect(reward.xp).toBe(50 + 100 + 15 + 100); // played, won, 4-player table, first win today
    expect(p.stats.wins).toBe(1);
    expect(p.stats.winnings).toBe(1000);
    expect(p.stats.streak).toBe(1);
    expect(reward.levelAfter).toBe(2);
    expect(reward.lines.some((l) => l.label === "Reached level 2")).toBe(true);
  });

  it("gives the first-win bonus once a day and tracks losing streaks", () => {
    let p = settle(newProgress(), result()).progress;
    const second = settle(p, result());
    expect(second.reward.lines.some((l) => l.label === "First win of the day")).toBe(false);
    p = settle(second.progress, result({ won: false, payout: 0 })).progress;
    p = settle(p, result({ won: false, payout: 0 })).progress;
    expect(p.stats.streak).toBe(-2);
    expect(p.stats.bestStreak).toBe(2);
    expect(p.stats.lost).toBe(500);
  });

  it("gives nothing for leaving early, and counts it as a loss", () => {
    const { progress: p, reward } = settle(newProgress(), result({ won: false, payout: 0, quit: true }));
    expect(reward.xp).toBe(0);
    expect(p.stats.losses).toBe(1);
    expect(p.stats.quits).toBe(1);
  });
});

describe("prestige and cosmetics", () => {
  const maxed = (): Progress => ({ ...newProgress(), xp: xpForLevel(MAX_LEVEL) });

  it("prestiges only at the max level, keeping stats", () => {
    expect(failed(prestige(newProgress()))).toBe(true);
    const r = prestige(maxed());
    if (failed(r)) throw new Error(r.error);
    expect(r.progress.prestige).toBe(1);
    expect(level(r.progress)).toBe(1);
    expect(r.coins).toBe(1000);
    expect(r.unlocked).toContain("felt.vault");
    expect(owns(r.progress, "felt.vault")).toBe(true);
    expect(canPrestige(r.progress)).toBe(false);
  });

  it("buys and equips with coins, respecting locks", () => {
    let p: Progress = { ...newProgress(), coins: 1000 };
    expect(failed(buy(p, "felt.violet"))).toBe(true); // level 15
    expect(failed(equip(p, "felt.midnight"))).toBe(true);
    const b = buy(p, "felt.midnight");
    if (failed(b)) throw new Error(b.error);
    expect(b.coins).toBe(600);
    const e = equip(b, "felt.midnight");
    if (failed(e)) throw new Error(e.error);
    expect(e.equipped.felt).toBe("felt.midnight");
    expect(failed(buy({ ...newProgress(), coins: 10 }, "felt.slate"))).toBe(true);
  });

  it("charges for drinks; a round costs the same however many are at the table", () => {
    const p = { ...newProgress(), coins: 100 };
    const w = payForDrink(p, "whiskey", 1);
    if (failed(w)) throw new Error(w.error);
    expect(w.coins).toBe(85);
    const r = payForDrink(p, "champagne", 5);
    if (failed(r)) throw new Error(r.error);
    expect(r.coins).toBe(40);
    expect(failed(payForDrink({ ...p, coins: 3 }, "beer", 1))).toBe(true);
  });
});
