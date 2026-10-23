import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../src/accounts/activity";
import { buildFunnel } from "../src/accounts/funnel";

const H = 60 * 60_000;
const t0 = 1_000_000_000_000;

describe("drop-off funnel", () => {
  const events: ActivityEvent[] = [
    // a: taps I'm new, starts the coached game, leaves on turn 3
    { at: t0, kind: "auth.guest", userId: "a", name: "Ann" },
    { at: t0 + 1000, kind: "ui.tap", userId: "a", data: { name: "welcome-new" } },
    { at: t0 + 2000, kind: "solo.start", userId: "a", ok: true, data: { coached: true, gameId: "g1" } },
    { at: t0 + 3000, kind: "ui.turn", userId: "a", data: { turn: 1, coached: true } },
    { at: t0 + 4000, kind: "ui.turn", userId: "a", data: { turn: 3, coached: true } },
    // b (and d, the same person on another account): looks around and leaves
    { at: t0 + 10, kind: "auth.guest", userId: "b" },
    { at: t0 + 20, kind: "ui.tap", userId: "b", data: { name: "Quick Match" } },
    { at: t0 + 30, kind: "app.open", userId: "d" },
    // c: the lesson (older app: the tap carries the button's text), another game, back the next day, signs up
    { at: t0, kind: "auth.guest", userId: "c" },
    { at: t0 + 1, kind: "ui.tap", userId: "c", data: { name: "I'm new A short game with a coach. Free." } },
    { at: t0 + 2, kind: "solo.start", userId: "c", ok: true, data: { coached: true, gameId: "g2" } },
    { at: t0 + 3, kind: "ui.turn", userId: "c", data: { turn: 9, coached: true } },
    { at: t0 + 4, kind: "game.solo", userId: "c", data: { coached: true, quit: false } },
    { at: t0 + 5, kind: "solo.start", userId: "c", ok: true, data: {} },
    { at: t0 + 13 * H, kind: "auth.register", userId: "c", ok: true },
    // e: first seen long before the range
    { at: t0 - 100 * H, kind: "auth.guest", userId: "e" },
    { at: t0 + 50, kind: "ui.tap", userId: "e", data: { name: "Quick Match" } },
  ];
  const f = buildFunnel(events, (id) => (id === "d" ? "b" : id), t0 - H, t0 + 100 * H);
  const step = (k: string) => f.steps.find((s) => s.key === k)!;

  it("counts each new person once, at every step up to their furthest", () => {
    expect(f.people).toBe(3);
    expect(f.steps.map((s) => s.reached)).toEqual(f.steps.map((s) => s.reached).sort((x, y) => y - x));
    expect(step("visit").reached).toBe(3);
    expect(step("new").reached).toBe(2);
    expect(step("lesson").reached).toBe(2);
    expect(step("turn3").reached).toBe(2);
    expect(step("turn4").reached).toBe(1);
    expect(step("finish").reached).toBe(1);
    expect(step("again").reached).toBe(1);
    expect(step("back").reached).toBe(1);
    expect(step("signup").reached).toBe(1);
    // turn steps stop at the furthest anyone got
    expect(f.steps.some((s) => s.key === "turn10")).toBe(false);
  });

  it("says where people stopped and what they did last", () => {
    expect(step("visit").stopped).toBe(1);
    expect(step("visit").last).toEqual([{ what: 'Tapped "Quick Match"', count: 1 }]);
    expect(step("turn3").stopped).toBe(1);
    expect(step("visit").people?.length).toBe(1);
    expect(step("visit").people?.[0].person).toBe("b");
    expect(step("visit").people?.[0].userId).toBe("b");
    expect(step("visit").people?.[0].lastWhat).toBe('Tapped "Quick Match"');
    expect(step("turn3").people?.length).toBe(1);
    expect(step("turn3").people?.[0].name).toBe("Ann");
    expect(step("turn3").people?.[0].turn).toBe(3);
    expect(step("turn3").people?.[0].recent).toBeDefined();
    expect(f.worst?.of).toBe(3);
    expect(f.worst?.stopped).toBe(1);
    expect(f.turnsSince).toBe(t0 + 3);
    expect(f.newest.map((p) => [p.person, p.step])).toEqual([
      ["b", "Opened the site"],
      ["a", "Reached turn 3"],
      ["c", "Signed up"],
    ]);
  });

  it("leaves out people first seen outside the range", () => {
    expect(buildFunnel(events, (id) => id, t0 + 2 * H, t0 + 100 * H).people).toBe(0);
  });
});

describe("drop-off funnel: where people came from", () => {
  const ev: ActivityEvent[] = [
    // an ad click: Google's referrer, but the link carries the click id
    { at: t0, kind: "auth.guest", userId: "ad", ref: "https://www.google.com/", data: { land: { gclid: "x1", play: "1", path: "/" } } },
    { at: t0 + 1, kind: "solo.start", userId: "ad", ok: true, data: { coached: true, gameId: "g9" } },
    { at: t0 + 2, kind: "game.solo", userId: "ad", data: { coached: true, quit: false } },
    { at: t0 + 3, kind: "ui.tap", userId: "ad", data: { name: "tour-profile" } },
    // an ad click with only ?play=1 (auto-tagging off)
    { at: t0, kind: "auth.guest", userId: "ad2", data: { land: { play: "1" } } },
    // Meta ad clicks: Meta's click id, or ?play=1 arriving from Instagram
    { at: t0, kind: "auth.guest", userId: "fb", ref: "https://m.facebook.com/", data: { land: { fbclid: "f1", play: "1", utm_campaign: "cartoon16" } } },
    { at: t0, kind: "auth.guest", userId: "ig", ref: "https://l.instagram.com/", data: { land: { play: "1" } } },
    { at: t0, kind: "auth.guest", userId: "se", ref: "https://www.google.com/" },
    { at: t0, kind: "auth.guest", userId: "rd", ref: "https://old.reddit.com/r/WebGames/" },
    { at: t0, kind: "auth.guest", userId: "cg", data: { src: "cg" } },
    { at: t0, kind: "auth.guest", userId: "dir" },
    { at: t0, kind: "auth.guest", userId: "oth", ref: "https://itch.io/games" },
    // no guest event in the log: unknown
    { at: t0, kind: "app.open", userId: "nope" },
  ];
  const all = buildFunnel(ev, (id) => id, t0 - H, t0 + H);
  const ads = buildFunnel(ev, (id) => id, t0 - H, t0 + H, undefined, "ads");

  it("sorts each new person into one source", () => {
    const by = Object.fromEntries((all.sources ?? []).map((s) => [s.key, s.people]));
    expect(by).toEqual({ ads: 2, meta: 2, search: 1, social: 1, crazygames: 1, direct: 1, other: 1, unknown: 1 });
    expect(all.newest.find((p) => p.userId === "ad")?.source).toBe("Google & other ads");
    expect(all.newest.find((p) => p.userId === "ig")?.source).toBe("Meta ads");
  });

  it("filters the steps to one source, keeping every source's count", () => {
    expect(ads.people).toBe(2);
    expect(ads.sources).toEqual(all.sources);
    expect(ads.steps.find((s) => s.key === "tourcard")?.reached).toBe(1);
    expect(ads.steps.find((s) => s.key === "tour")?.reached).toBe(0);
  });

  it("gives headline rates on each person's own record, judging coming back only once a day has passed", () => {
    const ev: ActivityEvent[] = [
      // p: quits Heist on turn 1, never back
      { at: t0, kind: "auth.guest", userId: "p" },
      { at: t0 + 1, kind: "solo.start", userId: "p", ok: true, data: { coached: true, gameId: "p1" } },
      { at: t0 + 2, kind: "ui.turn", userId: "p", data: { turn: 1, coached: true } },
      // q: finishes, plays again, back 13 h later
      { at: t0, kind: "auth.guest", userId: "q" },
      { at: t0 + 1, kind: "solo.start", userId: "q", ok: true, data: { coached: true, gameId: "q1" } },
      { at: t0 + 2, kind: "ui.turn", userId: "q", data: { turn: 4, coached: true } },
      { at: t0 + 3, kind: "game.solo", userId: "q", data: { coached: true, quit: false } },
      { at: t0 + 4, kind: "solo.start", userId: "q", ok: true, data: {} },
      { at: t0 + 13 * H, kind: "app.open", userId: "q" },
      // r: signs up straight away but never comes back
      { at: t0, kind: "auth.guest", userId: "r" },
      { at: t0 + 5, kind: "auth.register", userId: "r", ok: true },
      // s: arrives an hour before the log ends, so too soon to say whether they come back
      { at: t0 + 29 * H, kind: "auth.guest", userId: "s" },
      { at: t0 + 30 * H, kind: "ui.tap", userId: "s", data: { name: "Quick Match" } },
    ];
    const g = buildFunnel(ev, (id) => id, t0 - H, t0 + 100 * H);
    const rate = (k: string) => g.rates.find((x) => x.key === k);
    expect(rate("started")).toMatchObject({ n: 2, of: 4 });
    expect(rate("turn1quit")).toMatchObject({ n: 1, of: 2 });
    expect(rate("finished")).toMatchObject({ n: 1, of: 4 });
    expect(rate("again")).toMatchObject({ n: 1, of: 4 });
    // the furthest-step funnel counts r as "back"; the rate doesn't, and leaves s out of the base
    expect(rate("back")).toMatchObject({ n: 1, of: 3 });
    expect(rate("signup")).toMatchObject({ n: 1, of: 4 });
  });
});
