import { runBots } from "@heist/engine";
import { describe, expect, it } from "vitest";
import { coachRun, easySeed } from "../src/easy";
import { autoPick, ideaFor, lessonFor, lessonOpen, LESSONS } from "../src/lessons";
import { createSoloGame, replaySolo, SOLO_SEAT } from "../src/solo";

/** Play a lesson out with the learner following the coach; returns the answers and every ask they saw. */
function play(seed: number, lesson: number) {
  const { game, bots } = createSoloGame(seed, 3, "You", false, { gentle: true, lesson });
  const answers = [];
  const kinds = new Set<string>();
  for (let guard = 0; guard < 5000; guard++) {
    runBots(game, bots);
    const ask = game.pending;
    if (!ask) break;
    kinds.add(ask.kind);
    const a = autoPick(game, ask);
    answers.push(a);
    game.answer(SOLO_SEAT, a);
  }
  return { game, answers, kinds };
}

describe("Coached play lessons", () => {
  it("goes lesson 1, 2, 3, 4, then the full game", () => {
    expect([0, 1, 2, 3, 4, 9].map(lessonFor)).toEqual([1, 2, 3, 4, undefined, undefined]);
  });

  it("lesson 1 has no Roles, no bets and only Score cards", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { game, kinds } = play(seed, 1);
      expect(game.over).toBe(true);
      expect(game.s.players.every((p) => p.role === null)).toBe(true);
      expect(kinds.has("keepRole") || kinds.has("bet") || kinds.has("backup") || kinds.has("doubleCross")).toBe(false);
      const all = [...game.s.deck, ...game.s.discard, ...game.s.players.flatMap((p) => [...p.hand, ...p.bank])];
      expect(all.every((c) => c.kind === "S")).toBe(true);
    }
  });

  it("lesson 4 deals Roles from the simple list", () => {
    const simple = LESSONS[3].rules.rolePool!;
    for (let seed = 1; seed <= 10; seed++) expect(play(seed, 4).game.s.players.every((p) => simple.includes(p.role!))).toBe(true);
  });

  it("hands over one more kind of decision each hand, and explains each once", () => {
    const { game } = createSoloGame(5, 3, "You", false, { gentle: true, lesson: 1 });
    const s = { ...game.s, phase: "bank", firstBoss: 0, turn: 0, boss: 0 };
    const at = (kind: string, turn: number) => lessonOpen(1, { ...s, turn }, { kind, seat: 0 } as never);
    expect(at("showdown", 0)).toBe(true);
    expect(at("send", 0)).toBe(true); // hand 1
    expect(at("pickHideout", 0)).toBe(false);
    expect(at("pickHideout", 3)).toBe(true); // hand 2
    expect(at("bank", 3)).toBe(false);
    expect(at("discard", 30)).toBe(false); // the coach always does this one in lesson 1
    expect(ideaFor(1, s, { kind: "send", seat: 0, max: 3 }, [])?.title).toBe("Send your crew");
    expect(ideaFor(1, s, { kind: "send", seat: 0, max: 3 }, ["Send your crew"])).toBeUndefined();
    expect(lessonOpen(undefined, s, { kind: "bank", seat: 0, max: 2 })).toBe(true);
  });

  it("a lesson replays on the server like any game", () => {
    for (const lesson of [1, 2, 3, 4]) {
      const { game, answers } = play(40 + lesson, lesson);
      const rep = replaySolo(40 + lesson, 3, answers, undefined, { gentle: true, lesson });
      expect(rep.winners).toEqual(game.s.winners);
    }
  });

  it("the friendly deal still wins for a learner who follows the coach", () => {
    let x = 3;
    const next = () => (x = (x * 1103515245 + 12345) >>> 0) % 2 ** 31;
    for (const lesson of [1, 2, 3, 4]) {
      const r = coachRun(easySeed(next, 3, 16, 10_000, undefined, lesson), 3, lesson);
      expect(r.won).toBe(true);
    }
  });
});
