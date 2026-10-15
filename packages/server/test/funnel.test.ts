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
