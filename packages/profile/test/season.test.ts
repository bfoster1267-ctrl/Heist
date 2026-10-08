import { describe, expect, it } from "vitest";
import {
  ALL_COSMETICS, PACK_KEEP, PACK_PRICE, PACK_SIZE, PASS_TIERS, REFILL_TO, SEASONS, TIER_XP, buy, equip, failed, newProgress, openPack,
  passTrack, payForDrink, refill, seasonAt, settle, type GameResult, type GameSummary, type Progress,
} from "../src";

const S1 = SEASONS[0];
const IN_SEASON = Date.UTC(2026, 10, 1);
const noSummary: GameSummary = { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 };
const game = (o: Partial<GameResult> = {}): GameResult => ({ mode: "bots", players: 4, stakes: 250, won: false, payout: 0, summary: noSummary, at: IN_SEASON, ...o });
/** a seeded stand-in for crypto randomness */
const seeded = (seed: number) => (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
const rich = (): Progress => ({ ...newProgress(), chips: 1_000_000 });

describe("season 1 items", () => {
  const items = ALL_COSMETICS.filter((c) => c.season === 1);
  it("has 50 to 100 items with unique ids, split between pass and packs", () => {
    expect(items.length).toBeGreaterThanOrEqual(50);
    expect(items.length).toBeLessThanOrEqual(100);
    expect(new Set(ALL_COSMETICS.map((c) => c.id)).size).toBe(ALL_COSMETICS.length);
    expect(S1.passItems.length + S1.packItems.length).toBe(items.length);
    expect(new Set(items.map((c) => c.slot)).size).toBe(9);
    expect(items.every((c) => c.rarity === "common")).toBe(true);
  });
  it("can't be bought with coins, and nobody starts with them", () => {
    const p = { ...newProgress(), coins: 1e9 };
    for (const c of items) expect(failed(buy(p, c.id))).toBe(true);
    expect(failed(equip(p, S1.passItems[0].id))).toBe(true);
  });
  it("puts every pass item on the track once", () => {
    const t = passTrack(S1);
    expect(t.length).toBe(PASS_TIERS);
    const ids = t.flatMap((r) => (r.kind === "item" ? [r.id] : []));
    expect(new Set(ids)).toEqual(new Set(S1.passItems.map((c) => c.id)));
    expect(t[PASS_TIERS - 1]).toEqual({ kind: "packs", packs: 3 });
  });
});

describe("season pass", () => {
  it("earns season XP from games, apart from career XP", () => {
    const r = settle(newProgress(), game({ won: true, payout: 1000 }));
    expect(r.reward.pass?.xp).toBe(450); // played + won + first win of the day
    expect(r.progress.pass?.xp).toBe(450);
    expect(r.progress.xp).not.toBe(450);
  });
  it("hands out tier rewards as you climb", () => {
    let p = newProgress();
    for (let i = 0; i < 6; i++) p = settle(p, game({ at: IN_SEASON + i })).progress;
    // 6 x 150 = 900 XP: tier 1
    expect(p.pass!.xp).toBe(900);
    const first = passTrack(S1)[0];
    expect(first.kind === "item" && p.owned.includes(first.id)).toBe(true);
    const r = settle(p, game({ at: IN_SEASON + 10 }));
    expect(r.reward.pass!.tierBefore).toBe(1);
  });
  it("stops at the top tier and gives the final packs once", () => {
    let p = newProgress();
    for (let i = 0; i < PASS_TIERS * TIER_XP / 150 + 20; i++) p = settle(p, game({ at: IN_SEASON + i })).progress;
    expect(p.pass!.xp).toBe(PASS_TIERS * TIER_XP);
    expect(p.pass!.packs).toBe(4 + 3);
    for (const c of S1.passItems) expect(p.owned).toContain(c.id);
  });
  it("earns nothing for a quit or outside a season", () => {
    expect(settle(newProgress(), game({ quit: true })).reward.pass).toBeNull();
    expect(seasonAt(Date.UTC(2020, 0, 1))).toBeNull();
    expect(settle(newProgress(), game({ at: Date.UTC(2020, 0, 1) })).reward.pass).toBeNull();
  });
  it("starts fresh in a new season", () => {
    const p = { ...newProgress(), pass: { season: 0, xp: 9999, packs: 4 } };
    expect(settle(p, game()).progress.pass).toEqual({ season: 1, xp: 150, packs: 0 });
  });
});

describe("packs", () => {
  it("cost chips and give three items you don't have", () => {
    const r = openPack(rich(), IN_SEASON, seeded(1), true);
    if (failed(r)) throw new Error(r.error);
    expect(r.items.length).toBe(PACK_SIZE);
    expect(new Set(r.items).size).toBe(PACK_SIZE);
    expect(r.progress.chips).toBe(1_000_000 - PACK_PRICE);
    for (const id of r.items) expect(S1.packItems.some((c) => c.id === id)).toBe(true);
  });
  it("cost more than a top-up, and can't be farmed by going broke and refilling", () => {
    expect(PACK_KEEP).toBe(REFILL_TO);
    expect(PACK_PRICE).toBeGreaterThan(REFILL_TO);
    // a topped-up player can't afford one
    const broke = refill({ ...newProgress(), chips: 0 });
    if (failed(broke)) throw new Error(broke.error);
    expect(failed(openPack(broke, IN_SEASON, seeded(2), true))).toBe(true);
    // buying one always leaves you too rich to top up
    const p = { ...newProgress(), chips: PACK_PRICE + PACK_KEEP };
    const r = openPack(p, IN_SEASON, seeded(3), true);
    if (failed(r)) throw new Error(r.error);
    expect(failed(refill(r.progress))).toBe(true);
    expect(failed(openPack({ ...p, chips: PACK_PRICE + PACK_KEEP - 1 }, IN_SEASON, seeded(3), true))).toBe(true);
  });
  it("opens free packs from the pass without chips", () => {
    const p = { ...newProgress(), chips: 0, pass: { season: 1, xp: 0, packs: 1 } };
    const r = openPack(p, IN_SEASON, seeded(4), false);
    if (failed(r)) throw new Error(r.error);
    expect(r.progress.pass!.packs).toBe(0);
    expect(r.progress.chips).toBe(0);
    expect(failed(openPack(r.progress, IN_SEASON, seeded(4), false))).toBe(true);
  });
  it("turns repeats into season XP once the pool is complete", () => {
    let p = rich();
    for (let i = 0; i < Math.ceil(S1.packItems.length / PACK_SIZE); i++) {
      const r = openPack(p, IN_SEASON, seeded(i + 9), true);
      if (failed(r)) throw new Error(r.error);
      p = r.progress;
    }
    for (const c of S1.packItems) expect(p.owned).toContain(c.id);
    const r = openPack(p, IN_SEASON, seeded(99), true);
    if (failed(r)) throw new Error(r.error);
    expect(r.items).toEqual([]);
    expect(r.dupeXp).toBeGreaterThan(0);
    expect(r.progress.pass!.xp).toBe(p.pass!.xp + r.dupeXp);
  });
  it("can't be bought after the season", () => {
    expect(failed(openPack(rich(), Date.UTC(2027, 5, 1), seeded(1), true))).toBe(true);
  });
});

describe("using season items", () => {
  it("equips owned season items and orders owned season drinks", () => {
    const felt = S1.passItems.find((c) => c.slot === "felt")!;
    const wine = [...S1.passItems, ...S1.packItems].find((c) => c.slot === "drink")!;
    const emote = [...S1.passItems, ...S1.packItems].find((c) => c.slot === "emote")!;
    const p = { ...newProgress(), owned: [felt.id, wine.id, emote.id] };
    const e = equip(p, felt.id);
    if (failed(e)) throw new Error(e.error);
    expect(e.equipped.felt).toBe(felt.id);
    expect(failed(equip(p, emote.id))).toBe(true);
    expect(failed(payForDrink(p, wine.id, 1))).toBe(false);
    expect(failed(payForDrink(newProgress(), wine.id, 1))).toBe(true);
  });
});
