import { describe, expect, it } from "vitest";
import { Bot, type BotLevel, runBots } from "./bots";
import { randomAnswer } from "./fuzz";
import { CREW_PER_PLAYER, HeistGame } from "./game";
import { Rng } from "./rng";
import type { GameState, RuleOptions } from "./types";

const ALL_RULES: Partial<RuleOptions> = { bribes: true, placeCrew: true, openDeals: true };

function botGame(n: number, seed: number, opts: { rules?: Partial<RuleOptions>; level?: BotLevel; snapshots?: boolean } = {}) {
  const g = new HeistGame({ seed, rules: opts.rules, snapshots: opts.snapshots, seats: Array.from({ length: n }, (_, k) => ({ name: `Bot ${k}`, bot: true })) });
  const bots = new Map(g.s.players.map((p) => [p.seat, new Bot(seed + p.seat, { level: opts.level })]));
  return { g, bots };
}

/** Play a whole game with random legal answers, checking cards and crew after every answer. */
function fuzzGame(n: number, seed: number, rules: Partial<RuleOptions>) {
  const g = new HeistGame({ seed, rules, snapshots: false, seats: Array.from({ length: n }, (_, k) => ({ name: `P${k}`, bot: false })) });
  const r = new Rng(seed * 31 + 7);
  for (let i = 0; i < 20000 && g.pending; i++) {
    g.answer(g.pending.seat, randomAnswer(g, g.pending, r));
    expect(cardsInPlay(g.s)).toBe(64);
    for (const p of g.s.players) expect(crewOf(g.s, p.seat, true)).toBe(CREW_PER_PLAYER);
  }
  return g;
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
  let k = P.reserve + P.pen + P.returning;
  for (const q of s.players) for (const h of q.hideouts) k += h[seat];
  if (inJob && s.job) k += s.job.side.B[seat] + s.job.side.M[seat];
  return k;
}

describe("Heist engine", () => {
  it("finishes bot games at every player count", () => {
    for (const n of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { g, bots } = botGame(n, seed, { snapshots: false });
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

  it("finishes bot games with every optional rule on, at every level", () => {
    for (const level of ["easy", "normal", "hard"] as BotLevel[]) {
      for (const n of [3, 4, 5, 6]) {
        for (let seed = 1; seed <= 12; seed++) {
          const { g, bots } = botGame(n, 500 + seed, { rules: ALL_RULES, level, snapshots: false });
          runBots(g, bots);
          expect(g.over).toBe(true);
          for (const p of g.s.players) expect(crewOf(g.s, p.seat, true)).toBe(CREW_PER_PLAYER);
        }
      }
    }
  });

  it("keeps cards and crew whole with every optional rule on", () => {
    let bribes = 0, placed = 0, offers = 0;
    for (const n of [3, 5, 6]) {
      for (let seed = 1; seed <= 15; seed++) {
        const { g, bots } = botGame(n, 2000 + seed, { rules: ALL_RULES });
        runBots(g, bots);
        for (const f of g.frames) {
          expect(cardsInPlay(f.state)).toBe(64);
          for (const p of f.state.players) expect(crewOf(f.state, p.seat, true)).toBe(CREW_PER_PLAYER);
          bribes += +(f.ev.t === "bribe");
          placed += +(f.ev.t === "placeCrew");
          offers += +(f.ev.t === "dealOffer");
        }
      }
    }
    expect(bribes).toBeGreaterThan(0);
    expect(placed).toBeGreaterThan(0);
    expect(offers).toBeGreaterThan(0);
  });

  it("survives random legal play (fuzz), with and without the optional rules", () => {
    for (const rules of [{}, ALL_RULES]) {
      for (const n of [3, 4, 6]) {
        for (let seed = 1; seed <= 10; seed++) {
          const g = fuzzGame(n, seed, rules);
          expect(g.over).toBe(true);
        }
      }
    }
  });

  it("replays random play exactly from the seed and the answer log", () => {
    const g = fuzzGame(4, 99, ALL_RULES);
    const r = new HeistGame({ seed: 99, rules: ALL_RULES, seats: g.s.players.map((p) => ({ name: p.name, bot: false })) });
    for (const { seat, a } of g.answers) r.answer(seat, a);
    expect(r.s).toEqual(g.s);
  });

  it("keeps a public history of finished jobs", () => {
    const { g, bots } = botGame(4, 21, { snapshots: false });
    runBots(g, bots);
    const h = g.s.history;
    expect(h.length).toBeGreaterThan(5);
    for (const j of h) {
      expect(["B", "M", "deal", "nodeal"]).toContain(j.result);
      expect(j.allies.B).not.toContain(j.boss);
      expect(j.allies.M).not.toContain(j.mark);
    }
  });

  it("rejects illegal answers to the optional-rule asks", () => {
    const g = new HeistGame({ seed: 3, rules: ALL_RULES, seats: [0, 1, 2, 3].map((k) => ({ name: `P${k}`, bot: false })) });
    const r = new Rng(1);
    const checked = new Set<string>();
    for (let i = 0; i < 20000 && g.pending && checked.size < 4; i++) {
      const a = g.pending;
      if (a.kind === "send" && a.max >= 1) {
        expect(() => g.answer(a.seat, { kind: "send", count: 1, from: [5, 0, 0] })).toThrow();
        expect(() => g.answer(a.seat, { kind: "send", count: 1, from: [1, 1, 0] })).toThrow();
        checked.add("send");
      }
      if (a.kind === "placeCrew") {
        expect(() => g.answer(a.seat, { kind: "placeCrew", to: [a.count + 1, 0, 0] })).toThrow();
        expect(() => g.answer(a.seat, { kind: "placeCrew", to: [a.count, -1, 1] })).toThrow();
        checked.add("placeCrew");
      }
      if (a.kind === "bribe") {
        expect(() => g.answer(a.seat, { kind: "bribe", offers: [{ to: a.seat, cardIds: [g.s.players[a.seat].bank[0].id] }] })).toThrow();
        expect(() => g.answer(a.seat, { kind: "bribe", offers: [{ to: a.targets[0], cardIds: [9999] }] })).toThrow();
        checked.add("bribe");
      }
      if (a.kind === "deal") {
        const broke = { bossPays: 999, markPays: 0, bossCards: 0, markCards: 0, foothold: false };
        expect(() => g.answer(a.seat, { kind: "deal", action: "propose", deal: broke })).toThrow();
        if (!a.offer) expect(() => g.answer(a.seat, { kind: "deal", action: "accept" })).toThrow();
        checked.add("deal");
      }
      g.answer(a.seat, randomAnswer(g, a, r));
    }
    expect(checked.size).toBeGreaterThanOrEqual(3);
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

  it("gives a human Boss who wins a Foothold, just like a bot (or says why not)", () => {
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const n = 3 + (seed % 4);
      const g = new HeistGame({ seed, seats: Array.from({ length: n }, (_, k) => ({ name: `P${k}`, bot: k !== 0 })) });
      const bots = new Map(g.s.players.map((p) => [p.seat, new Bot(seed + p.seat)]));
      const r = new Rng(seed);
      let job: GameState["job"] = null;
      let before: number[] = [];
      for (let i = 0; i < 20000 && g.pending; i++) {
        const a = g.pending;
        g.answer(a.seat, a.seat === 0 ? randomAnswer(g, a, r) : bots.get(a.seat)!.answer(g, a));
        for (const f of g.drainFrames()) {
          if (f.ev.t === "result" && f.ev.winner === "B" && f.state.job?.kind === "hit") {
            job = f.state.job;
            before = f.state.players[job.mark].hideouts[job.hideout];
          }
          if (f.ev.t === "loot" && job) {
            const H = f.state.players[job.mark].hideouts[job.hideout];
            job.side.B.forEach((k, p) => {
              if (!k) return;
              if (p === 0) wins++;
              expect(H[p]).toBeGreaterThan(0);
              if (before[p] > 0) expect(f.msg).toContain(`P${p} `);
            });
            job = null;
          }
        }
      }
    }
    expect(wins).toBeGreaterThan(20);
  });
});
