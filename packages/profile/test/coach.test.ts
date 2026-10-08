import { HeistGame, Rng, randomAnswer, runBots, type Answer, type Ask, type Card, type GameState } from "@heist/engine";
import { describe, expect, it } from "vitest";
import { addMistakes, checkMove, coachTip, createSoloGame, newProgress, replaySolo, settleCoached, type MistakeId } from "../src";

const fresh = (): GameState => structuredClone(new HeistGame({ seed: 7, seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, bot: i > 0 })) }).s);
const score = (id: number, n: number): Card => ({ id, kind: "S", score: n, cash: 2, color: 0 });
const fixer = (id: number): Card => ({ id, kind: "F", score: 0, cash: 2, color: 0 });

describe("the coach", () => {
  it("catches each rookie mistake, and lets the good move through", () => {
    const s = fresh();
    // already in: a Foothold in P1's hideout 0, nothing in hideout 1
    s.players[1].hideouts[0][0] = 1;
    const pick: Ask = { kind: "pickHideout", seat: 0, mark: 1 };
    expect(checkMove(s, pick, { kind: "pickHideout", hideout: 0 })).toBe<MistakeId>("alreadyIn");
    expect(checkMove(s, pick, { kind: "pickHideout", hideout: 1 })).toBeNull();

    // all crew out: 9 at home
    expect(checkMove(s, { kind: "send", seat: 0, max: 4 }, { kind: "send", count: 4 })).toBeNull();
    s.players[0].hideouts.forEach((h, i) => (h[0] = i === 0 ? 3 : 0));
    expect(checkMove(s, { kind: "send", seat: 0, max: 3 }, { kind: "send", count: 3 })).toBe("allCrewOut");
    expect(checkMove(s, { kind: "send", seat: 0, max: 3 }, { kind: "send", count: 2 })).toBeNull();

    // laying low with a 20
    s.players[0].hand = [score(1, 20), fixer(2)];
    const act: Ask = { kind: "action", seat: 0, canHit: true, busts: [], wanted: [] };
    expect(checkMove(s, act, { kind: "action", choice: "pass" })).toBe("layLowStrong");
    expect(checkMove(s, act, { kind: "action", choice: "hit" })).toBeNull();

    // a Fixer while holding a Score
    expect(checkMove(s, { kind: "showdown", seat: 0, as: "boss" }, { kind: "showdown", cardId: 2 })).toBe("fixerWithScore");
    expect(checkMove(s, { kind: "showdown", seat: 0, as: "boss" }, { kind: "showdown", cardId: 1 })).toBeNull();

    // banking every fighter
    expect(checkMove(s, { kind: "bank", seat: 0, max: 2 }, { kind: "bank", cardIds: [1, 2] })).toBe("bankLastFighter");
    expect(checkMove(s, { kind: "bank", seat: 0, max: 2 }, { kind: "bank", cardIds: [2] })).toBeNull();
  });

  it("knows when a Backup would have won the fight", () => {
    const s = fresh();
    s.job = {
      kind: "hit", boss: 0, mark: 1, hideout: 0, wanted: false, side: { B: [2, 0, 0, 0], M: [0, 0, 0, 0] }, bets: [], bossCard: null, markCard: null,
      revealed: true, forged: { B: null, M: null }, backups: { B: 0, M: 0 }, hackerCall: null, bribes: [], bTotal: 20, mTotal: 22, result: null, note: "",
    };
    const ask: Ask = { kind: "backup", seat: 0 };
    expect(checkMove(s, ask, { kind: "backup", side: null })).toBe("skippedBackup"); // 20+3 beats 22
    expect(checkMove(s, ask, { kind: "backup", side: "B" })).toBeNull();
    s.job.mTotal = 23; // 20+3 only ties, and ties go to the Mark
    expect(checkMove(s, ask, { kind: "backup", side: null })).toBeNull();
    expect(coachTip(s, ask)).toMatch(/too far behind/);
  });

  it("has something to say at every decision, and never trips over random play", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = new HeistGame({ seed, snapshots: false, seats: [0, 1, 2, 3, 4].map((i) => ({ name: `P${i}`, bot: false })) });
      const r = new Rng(seed);
      const said = new Set<string>();
      for (let i = 0; i < 20000 && g.pending; i++) {
        const ask = g.pending;
        const a = randomAnswer(g, ask, r);
        checkMove(g.s, ask, a);
        if (coachTip(g.s, ask)) said.add(ask.kind);
        g.answer(ask.seat, a);
      }
      for (const k of ["action", "send", "showdown", "bank"]) expect(said).toContain(k);
    }
  });

  it("counts mistakes from a replayed game, and Coached play pays only a little XP", () => {
    const seed = 2;
    const { game, bots } = createSoloGame(seed, 4, "Tester");
    const r = new Rng(5);
    const answers: Answer[] = [];
    let live = 0;
    for (let i = 0; i < 100_000; i++) {
      runBots(game, bots);
      const p = game.pending;
      if (!p) break;
      const a = randomAnswer(game, p, r);
      if (checkMove(game.s, p, a)) live++;
      game.answer(0, a);
      answers.push(a);
    }
    const rep = replaySolo(seed, 4, answers);
    expect(Object.values(rep.mistakes).reduce((t, k) => t + (k ?? 0), 0)).toBe(live);
    expect(live).toBeGreaterThan(0);

    const p = addMistakes(newProgress(), { alreadyIn: 2 });
    expect(addMistakes(p, { alreadyIn: 1, allCrewOut: 1 }).mistakes).toEqual({ alreadyIn: 3, allCrewOut: 1 });
    const c = settleCoached(p, true);
    expect(c.reward.xp).toBe(50);
    expect(c.reward.payout).toBe(0);
    expect(c.progress.chips).toBe(p.chips);
    expect(c.progress.stats).toEqual(p.stats);
    expect(c.progress.coachGames).toBe(1);
  });
});
