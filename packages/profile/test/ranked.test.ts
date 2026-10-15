import { describe, expect, it } from "vitest";
import {
  CHAMPION_RP, PROTECTED_GAMES, newProgress, newRanked, placePoints, places, playRanked, rankDelta, rankOf, rankedMmr, settle, tierStart,
  type RankedGame, type RankedState,
} from "../src";

const AT = Date.UTC(2026, 9, 10);
const summary = { footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0, role: null };
const even = (place: number): RankedGame => ({
  span: [place, place], players: 6, won: place === 0, at: AT,
  rivals: [0, 1, 2, 3, 4, 5].filter((p) => p !== place).map((p) => ({ mmr: 1000, place: p })),
});

describe("ranks", () => {
  it("names tiers and divisions", () => {
    expect(rankOf(0).label).toBe("Copper III");
    expect(rankOf(250).label).toBe("Copper I");
    expect(rankOf(300).label).toBe("Bronze III");
    expect(rankOf(1799).label).toBe("Diamond I");
    expect(rankOf(CHAMPION_RP).label).toBe("Champion");
  });

  it("orders places with abandoners last and ties shared", () => {
    expect(places([5, 9, 7], [1])).toEqual([[1, 1], [2, 2], [0, 0]]);
    expect(places([3, 3, 1])).toEqual([[0, 1], [0, 1], [2, 2]]);
    expect(placePoints(6, [0, 1])).toBe(30);
  });

  it("pays a top-half finish and charges a bottom-half one", () => {
    const at = (place: number) => rankDelta({ base: placePoints(6, [place, place]), mmr: 1000, rivalsMmr: [1000], rp: 900 });
    expect(at(0)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(0);
    expect(at(2)).toBeGreaterThan(0);
    expect(at(3)).toBeLessThan(0);
    expect(at(5)).toBeLessThan(at(4));
  });

  it("costs more to lose to weaker players and pays more to beat stronger ones", () => {
    const lose = (rivals: number) => rankDelta({ base: -35, mmr: 1200, rivalsMmr: [rivals], rp: 1500 });
    expect(lose(900)).toBeLessThan(lose(1200));
    const win = (rivals: number) => rankDelta({ base: 40, mmr: 1000, rivalsMmr: [rivals], rp: 900 });
    expect(win(1200)).toBeGreaterThan(win(1000));
  });

  it("climbs faster when the MMR is above the rank", () => {
    expect(rankDelta({ base: 40, mmr: 1200, rivalsMmr: [1200], rp: 0 })).toBeGreaterThan(rankDelta({ base: 40, mmr: 1200, rivalsMmr: [1200], rp: 1500 }));
  });

  it("moves Ranked MMR by finishing place", () => {
    expect(rankedMmr(1000, 20, 0, [{ mmr: 1000, place: 1 }, { mmr: 1000, place: 2 }])).toBeGreaterThan(1000);
    expect(rankedMmr(1000, 20, 2, [{ mmr: 1000, place: 0 }, { mmr: 1000, place: 1 }])).toBeLessThan(1000);
  });
});

describe("rank protection", () => {
  it("holds your tier in the first 10 games of a season", () => {
    const r: RankedState = { ...newRanked(1), rp: 610, peak: 610, games: 3 };
    const { state, result } = playRanked(r, even(5));
    expect(state.rp).toBe(tierStart(2));
    expect(result.held).toBe("tier");
  });

  it("never drops below Bronze once reached", () => {
    const r: RankedState = { ...newRanked(1), rp: 310, peak: 900, games: PROTECTED_GAMES + 5 };
    const { state, result } = playRanked(r, even(5));
    expect(state.rp).toBe(tierStart(1));
    expect(result.held).toBe("floor");
  });

  it("lets a high rank fall all the way to Bronze", () => {
    let r: RankedState = { ...newRanked(1), rp: 1700, peak: 1700, games: PROTECTED_GAMES, mmr: 1000 };
    // losing to a table of equals every game
    for (let i = 0; i < 40; i++) r = playRanked(r, { ...even(5), rivals: even(5).rivals.map((x) => ({ ...x, mmr: r.mmr })) }).state;
    expect(r.rp).toBe(tierStart(1));
  });
});

describe("settling a ranked game", () => {
  it("pays more than Casual and moves rank points, not the Casual rating", () => {
    const p = newProgress();
    const casual = settle(p, { mode: "online", players: 6, stakes: 100, won: false, payout: 0, summary, at: AT, rivals: [{ rating: 1000, won: true }] });
    const ranked = settle(p, { mode: "online", players: 6, stakes: 100, won: false, payout: 0, summary, at: AT, rivals: [{ rating: 1000, won: true }], ranked: even(1) });
    expect(ranked.reward.xp).toBeGreaterThan(casual.reward.xp);
    expect(ranked.reward.coins).toBeGreaterThan(casual.reward.coins);
    expect(ranked.progress.rating).toBe(p.rating);
    expect(ranked.progress.ranked!.rp).toBeGreaterThan(0);
    expect(ranked.reward.ranked!.place).toBe(2);
  });

  it("pays last season's rank and starts the new season from zero", () => {
    const p = { ...newProgress(), ranked: { ...newRanked(0), rp: 950, peak: 950, games: 12, total: 12, mmr: 1200 } };
    const r = settle(p, { mode: "online", players: 6, stakes: 100, won: true, payout: 600, summary, at: AT, ranked: even(0) });
    expect(r.reward.ranked!.seasonReward?.coins).toBe(400);
    expect(r.progress.ranked!.games).toBe(1);
    expect(r.progress.ranked!.last).toEqual({ season: 0, peak: 950 });
  });
});
