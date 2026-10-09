import { describe, expect, it } from "vitest";
import { coachRun, easySeed } from "../src/easy";

describe("Coached play's easy deal", () => {
  it("picks a seed where following the coach wins, first fight included", () => {
    let x = 11;
    const next = () => (x = (x * 1103515245 + 12345) >>> 0) % 2 ** 31;
    for (let i = 0; i < 5; i++) {
      const r = coachRun(easySeed(next, 3, 16, 10_000), 3);
      expect(r.won).toBe(true);
      expect(r.firstFight).toBe(true);
    }
  });
});
