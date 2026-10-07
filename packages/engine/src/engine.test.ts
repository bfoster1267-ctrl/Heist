import { describe, expect, it } from "vitest";
import { Bot, runBots } from "./bots";
import { CREW_PER_PLAYER, HeistGame } from "./game";
import type { GameState } from "./types";

function botGame(n: number, seed: number) {
  const g = new HeistGame({ seed, seats: Array.from({ length: n }, (_, k) => ({ name: `Bot ${k}`, bot: true })) });
  const bots = new Map(g.s.players.map((p) => [p.seat, new Bot(seed + p.seat)]));
  return { g, bots };
}

function cardsInPlay(s: GameState) {
  const ids: number[] = [...s.deck, ...s.discard].map((c) => c.id);
  for (const p of s.players) ids.push(...p.hand.map((c) => c.id), ...p.bank.map((c) => c.id));
  const placed = new Set(ids);
  expect(placed.size).toBe(ids.length); // no card in two places
  // cards on the table mid-job (showdown cards, bets) haven't gone anywhere yet
  if (s.job) for (const c of [s.job.bossCard, s.job.markCard, ...s.job.bets.map((b) => b.card)]) if (c) placed.add(c.id);
  return placed.size;
}

function crewOf(s: GameState, seat: number, inJob: boolean) {
  const P = s.players[seat];
  let k = P.reserve + P.pen;
  for (const q of s.players) for (const h of q.hideouts) k += h[seat];
  if (inJob && s.job) k += s.job.side.B[seat] + s.job.side.M[seat];
  return k;
}

describe("Heist engine", () => {
  it("finishes bot games at every player count", () => {
    for (const n of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { g, bots } = botGame(n, seed);
        runBots(g, bots);
        expect(g.over).toBe(true);
        expect(g.s.winners!.length).toBeGreaterThan(0);
      }
    }
  });

  it("never loses or invents a card or a crew member", () => {
    for (const n of [3, 4, 6]) {
      for (let seed = 1; seed <= 25; seed++) {
        const { g, bots } = botGame(n, 1000 + seed);
        runBots(g, bots);
        for (const f of g.frames) {
          const st = f.state;
          expect(cardsInPlay(st)).toBe(64);
          for (const p of st.players) expect(crewOf(st, p.seat, true)).toBe(CREW_PER_PLAYER);
        }
      }
    }
  });

  it("replays exactly from the seed and the answer log", () => {
    const { g, bots } = botGame(5, 77);
    runBots(g, bots);
    const r = new HeistGame({ seed: 77, seats: g.s.players.map((p) => ({ name: p.name, bot: true })) });
    for (const { seat, a } of g.answers) r.answer(seat, a);
    expect(r.s).toEqual(g.s);
  });

  it("rejects illegal answers", () => {
    const { g } = botGame(4, 5);
    const ask = g.pending!;
    expect(ask.kind).toBe("keepRole");
    expect(() => g.answer(ask.seat, { kind: "keepRole", role: "nonsense" as never })).toThrow();
    expect(() => g.answer((ask.seat + 1) % 4, { kind: "keepRole", role: "muscle" })).toThrow();
  });

  it("hides other hands in a player's view", () => {
    const { g } = botGame(4, 9);
    const v = g.viewFor(0);
    expect(v.deck.length).toBe(0);
    expect(v.players[1].hand.every((c) => c.color === -1)).toBe(true);
    expect(v.players[0].hand.every((c) => c.color >= 0)).toBe(true);
  });
});
