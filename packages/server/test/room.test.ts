import { Bot, HeistGame, runBots, viewFor, type GameState } from "@heist/engine";
import { describe, expect, it } from "vitest";
import { deadWeight } from "../src/deadweight";
import { Room, frameView, payees } from "../src/room";
import { sanitizeAnswer } from "../src/sanitize";
import { MemoryStore } from "../src/store";
import { FakeClock, TestConn, simpleAnswer } from "./helpers";

const NO_RULES = { bribes: false, placeCrew: false, openDeals: false };

function setup(players = 4, turnSeconds = 30, rules = NO_RULES) {
  const clock = new FakeClock();
  const store = new MemoryStore();
  const overs: unknown[] = [];
  const room = new Room({ id: "r_test", code: "ABCDE", players, stakes: 100, isPrivate: false, turnSeconds, rules, botLevel: "normal" }, { store, clock, onGameOver: (r) => overs.push(r) });
  return { clock, store, room, overs };
}

/** Answer every ask this connection gets until the game ends (or `stopAfter` answers). */
function playAll(room: Room, conns: TestConn[], stopAfter = Infinity) {
  let n = 0;
  for (let guard = 0; guard < 20000 && room.status === "playing" && n < stopAfter; guard++) {
    let moved = false;
    for (const c of conns) {
      const ask = c.last("ask");
      if (!ask || (c as TestConn & { done?: number }).done === ask.askId) continue;
      (c as TestConn & { done?: number }).done = ask.askId;
      if (room["game"]?.pending?.seat !== ask.ask.seat) continue;
      const err = room.answer(c.id, ask.askId, simpleAnswer(ask.ask, c.view()!));
      expect(err).toBeNull();
      moved = true;
      n++;
      break;
    }
    if (!moved) break;
  }
  return n;
}

/** Every card id this connection could see in other players' hands or face-down job cards. */
function leaks(st: GameState, seat: number) {
  const out: string[] = [];
  if (st.deck.length) out.push("deck");
  for (const p of st.players) if (p.seat !== seat && p.hand.some((c) => c.id >= 0 || c.color !== -1)) out.push(`hand of ${p.seat}`);
  const j = st.job;
  if (j && !j.revealed) {
    if (j.boss !== seat && j.bossCard && j.bossCard.id >= 0) out.push("boss card");
    if (j.mark !== seat && j.markCard && j.markCard.id >= 0) out.push("mark card");
  }
  return out;
}

describe("Room", () => {
  it("seats players in the lobby, makes the first one host, and rejects a full table", () => {
    const { room } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    expect(room.join(a)).toBeNull();
    expect(room.join(b)).toBeNull();
    expect(room.hostId).toBe("u1");
    expect(room.join(new TestConn("c3", "u3", "Cat"))).toBeNull();
    expect(room.join(new TestConn("c4", "u4", "Dee"))).toBe("room_full");
    expect(room.join(new TestConn("c5", "u5", "Eve"), { spectate: true })).toBeNull();
    expect(room.info().spectators).toBe(1);
    expect(room.start("u2")).toBe("not_host");
    room.leave("c1");
    expect(room.hostId).toBe("u2");
    expect(room.info().seats[0].kind).toBe("open");
  });

  it("plays a full game with humans and bots, sending each seat only what it may see", () => {
    const { room, store, overs } = setup(5);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    const spec = new TestConn("c3", "u3", "Spy");
    room.join(a);
    room.join(b);
    room.join(spec, { spectate: true });
    expect(room.start("u1", 4242)).toBeNull();
    expect(room.info().seats.filter((s) => s.kind === "bot").length).toBe(3);
    playAll(room, [a, b]);
    expect(room.status).toBe("over");
    expect(a.last("gameOver")).toBeTruthy();
    expect(overs.length).toBe(1);

    for (const [c, seat] of [[a, 0], [b, 1], [spec, -1]] as const) {
      const frames = c.of("frames").flatMap((m) => m.frames);
      expect(frames.map((f) => f.i)).toEqual(frames.map((_, k) => k)); // every frame, in order, once
      for (const f of frames) expect(leaks(f.state, seat)).toEqual([]);
      // asks only ever go to their own seat
      for (const m of c.of("ask")) expect(m.ask.seat).toBe(seat);
    }
    expect(spec.of("ask").length).toBe(0);

    // the stored log rebuilds the exact final table
    const rec = [...store.games.values()][0];
    expect(rec.end).toBeTruthy();
    const g = new HeistGame({ seed: rec.start.seed, seats: rec.start.seats });
    for (const x of rec.answers) g.answer(x.seat, x.a);
    expect(g.s).toEqual(room["game"]!.s);
    expect(rec.answers.some((x) => x.by === "player")).toBe(true);
    expect(rec.answers.some((x) => x.by === "bot")).toBe(true);
  });

  it("plays with every optional rule on: bribes, crew placement and open Fixer deals", () => {
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      const { room, store } = setup(4, 30, { bribes: true, placeCrew: true, openDeals: true });
      const a = new TestConn("c1", "u1", "Ann");
      const b = new TestConn("c2", "u2", "Ben");
      room.join(a);
      room.join(b);
      room.start("u1", seed);
      playAll(room, [a, b]);
      expect(room.status).toBe("over");
      for (const [c, seat] of [[a, 0], [b, 1]] as const) for (const f of c.of("frames").flatMap((m) => m.frames)) expect(leaks(f.state, seat)).toEqual([]);
      for (const c of [a, b]) for (const m of c.of("ask")) kinds.add(m.ask.kind);
      const rec = [...store.games.values()][0];
      const g = new HeistGame({ seed: rec.start.seed, seats: rec.start.seats, rules: rec.start.rules });
      for (const x of rec.answers) g.answer(x.seat, x.a);
      expect(g.s).toEqual(room["game"]!.s);
    }
    // people were asked the new questions, not just the bots
    expect(kinds.has("placeCrew") && kinds.has("bribe")).toBe(true);
  });

  it("rejects stale, out-of-turn and malformed answers", () => {
    const { room } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 7);
    const ask = a.last("ask");
    expect(ask.ask.kind).toBe("keepRole");
    expect(room.answer("c2", ask.askId, simpleAnswer(ask.ask, a.view()!))).toBe("not_your_turn");
    expect(room.answer("c1", ask.askId + 1, simpleAnswer(ask.ask, a.view()!))).toBe("stale_ask");
    expect(room.answer("c1", ask.askId, { kind: "keepRole", role: 5 })).toBe("bad_message");
    expect(room.answer("c1", ask.askId, { kind: "keepRole", role: "nonsense" })).toBe("illegal");
    expect(room.answer("c1", ask.askId, "hi")).toBe("bad_message");
    expect(room.answer("c1", ask.askId, simpleAnswer(ask.ask, a.view()!))).toBeNull();
    expect(room.answer("c1", ask.askId, simpleAnswer(ask.ask, a.view()!))).not.toBeNull();
  });

  it("lets a bot answer when the clock runs out, and hands the seat to a bot after two misses", () => {
    const { room, clock } = setup(3, 20);
    const a = new TestConn("c1", "u1", "Ann");
    room.join(a);
    room.start("u1", 99);
    const first = a.last("ask");
    clock.advance(first.deadline - clock.now() - 1);
    expect(a.of("timeout").length).toBe(0);
    clock.advance(1);
    expect(a.of("timeout")).toEqual([{ t: "timeout", seat: 0, autopilot: false }]);
    // miss the next one too: autopilot plays the rest of the game
    clock.advance(a.last("ask").deadline - clock.now());
    expect(a.last("timeout").autopilot).toBe(true);
    expect(room.status).toBe("over");
    // taking the seat back is allowed in the next game
    expect(room.start("u1", 100)).toBeNull();
    expect(room.info().seats[0].autopilot).toBe(false);
  });

  it("gives the clock time to animate before a decision starts counting", () => {
    const { room, clock } = setup(4, 30);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 5);
    const ask = a.last("ask");
    expect(ask.deadline - clock.now()).toBeGreaterThan(30_000);
    expect(ask.deadline - clock.now()).toBeLessThanOrEqual(60_000);
  });

  it("resumes a dropped player from the last frame they saw, and shortens their clock while they're gone", () => {
    const { room, clock } = setup(4, 30);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 31337);
    playAll(room, [a, b], 25);
    const seenA = a.of("frames").flatMap((m) => m.frames);
    const since = seenA[seenA.length - 1].i + 1;
    room.disconnect("c1");
    expect(room.info().seats[0].connected).toBe(false);
    // the game goes on without Ann; her decisions wait only the reconnect grace
    playAll(room, [b], 10);
    const pend = room["game"]!.pending!;
    if (pend.seat === 0) expect(room["deadline"] - clock.now()).toBeLessThanOrEqual(20_000 + 30_000);
    const a2 = new TestConn("c9", "u1", "Ann");
    expect(room.join(a2, { since })).toBeNull();
    expect(room.seatOf("u1")).toBe(0);
    expect(a2.of("sync").length).toBe(0);
    const resumed = a2.of("frames").flatMap((m) => m.frames);
    a2.inbox.unshift(...a.inbox); // the client still has the table it saw before the drop
    if (resumed.length) expect(resumed[0].i).toBe(since);
    // a resume point the server no longer has gets a full sync instead
    const a3 = new TestConn("c10", "u1", "Ann");
    room.join(a3, { since: -5 });
    expect(a3.of("sync").length).toBe(1);
    expect(leaks(a3.last("sync").state, 0)).toEqual([]);
    playAll(room, [a2, b]);
    expect(room.status).toBe("over");
  });

  it("a player who leaves on purpose is out for the rest of the game, and abandons it", () => {
    const { room, overs } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 12);
    room.leave("c2");
    expect(room.info().seats[1].autopilot).toBe(true);
    playAll(room, [a], 15);
    const b2 = new TestConn("c3", "u2", "Ben");
    room.join(b2);
    expect(b2.last("room").you.seat).toBeNull(); // back only as a spectator
    expect(room.info().seats[1].autopilot).toBe(true);
    playAll(room, [a]);
    expect(room.status).toBe("over");
    const over = overs[0] as { abandoned: number[]; winners: number[] };
    expect(over.abandoned).toEqual([1]);
    expect(over.winners).not.toContain(1);
    expect(b2.last("gameOver").abandoned).toEqual([1]);
    // the rematch deals a bot into that chair
    expect(room.start("u1", 13)).toBeNull();
    expect(room.info().seats[1].kind).toBe("bot");
  });

  it("a dropped player gets their seat back any time before the end; away at the end is abandoned", () => {
    const { room, clock, overs } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 12);
    room.disconnect("c2");
    // his turns run out on the short clock and the seat goes to dead weight
    for (let i = 0; i < 40 && !room.info().seats[1].autopilot; i++) {
      playAll(room, [a], 1);
      clock.advance(25_000);
    }
    expect(room.info().seats[1].autopilot).toBe(true);
    const b2 = new TestConn("c3", "u2", "Ben");
    room.join(b2, { since: 0 });
    expect(b2.last("room").you.seat).toBe(1);
    expect(room.info().seats[1].autopilot).toBe(false);
    // and drops again for good
    room.disconnect("c3");
    for (let i = 0; i < 500 && room.status === "playing"; i++) {
      playAll(room, [a]);
      clock.advance(25_000);
    }
    expect(room.status).toBe("over");
    expect((overs[0] as { abandoned: number[] }).abandoned).toEqual([1]);
    // coming back after the end shows the result, abandoned and all
    const b3 = new TestConn("c4", "u2", "Ben");
    room.join(b3);
    expect(b3.last("gameOver")).toMatchObject({ abandoned: [1] });
    expect(b3.last("gameOver").paid).not.toContain(1);
  });

  it("rebuilds a table from the stored log after a restart", async () => {
    const { room, store, clock } = setup(4);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 555);
    playAll(room, [a, b], 30);
    const before = structuredClone(room["game"]!.s);
    const rec = (await store.unfinished())[0];
    const back = Room.restore(rec, { store, clock });
    expect(back["game"]!.s).toEqual(before);
    expect(back.code).toBe("ABCDE");
    const a2 = new TestConn("c3", "u1", "Ann");
    const b2 = new TestConn("c4", "u2", "Ben");
    back.join(a2, { since: a.of("frames").flatMap((m) => m.frames).at(-1)!.i + 1 });
    back.join(b2);
    a2.inbox.unshift(...a.inbox);
    expect(back.seatOf("u1")).toBe(0);
    playAll(back, [a2, b2]);
    expect(back.status).toBe("over");
  });

  it("plays a rematch with the same table, and bots take the chairs of players who left", () => {
    const { room, clock } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    room.start("u1", 1);
    room.autopilot("c1", true);
    room.autopilot("c2", true);
    expect(room.status).toBe("over");
    room.leave("c2");
    expect(room.start("u1", 2)).toBeNull();
    expect(room.games).toBe(2);
    expect(room.info().seats[1].kind).toBe("bot");
    expect(a.last("frames").game).toBe(2);
    clock.advance(10 * 60_000);
    expect(room.status).toBe("over");
  });

  it("lets a spectator take a bot's chair between games, and plays them in the rematch", () => {
    const { room } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    room.join(a);
    room.start("u1", 1);
    const w = new TestConn("c2", "u2", "Wes");
    room.join(w);
    expect(w.last("room").you.seat).toBeNull();
    expect(room.sit("c2")).toBe("bad_state"); // not mid-game
    room.autopilot("c1", true);
    expect(room.status).toBe("over");
    expect(room.sit("c2")).toBeNull();
    const seat = w.last("room").you.seat;
    expect(seat).not.toBeNull();
    expect(room.info().seats[seat!]).toMatchObject({ kind: "human", name: "Wes", userId: "u2" });
    room.autopilot("c1", false);
    expect(room.start("u1", 2)).toBeNull();
    // Wes is dealt in: his own hand arrives face up, and the game waits on people, not bots
    const st = w.last("frames").frames.at(-1)!.state;
    expect(st.players[seat!].hand.every((c) => c.id >= 0)).toBe(true);
    expect(st.players[seat!].bot).toBe(false);
  });

  it("rate-limits and cleans chat", () => {
    const { room } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    room.join(a);
    expect(room.chat("c1", "  hi\nthere  ")).toBeNull();
    expect(a.last("chat")).toMatchObject({ seat: 0, name: "Ann", text: "hi there" });
    for (let i = 0; i < 4; i++) room.chat("c1", "x");
    expect(room.chat("c1", "x")).toBe("rate_limited");
  });

  it("relays drinks between seated players only", () => {
    const { room } = setup(3);
    const a = new TestConn("c1", "u1", "Ann");
    const b = new TestConn("c2", "u2", "Ben");
    room.join(a);
    room.join(b);
    const w = new TestConn("c3", "u3", "Wes");
    room.join(w, { spectate: true });
    expect(room.drinkTargets("c1", 1)).toBe("bad_state"); // not before the game
    room.start("u1", 5);
    expect(room.drinkTargets("c1", 1)).toEqual({ from: 0, to: [1] });
    room.sendDrink("c1", 0, [1], "whiskey");
    expect(b.last("drink")).toMatchObject({ t: "drink", from: 0, to: [1], id: "whiskey", name: "Ann" });
    expect(w.last("drink")).toMatchObject({ t: "drink", from: 0, to: [1], id: "whiskey" });
    expect(room.drinkTargets("c1", 1)).toBe("rate_limited"); // one every few seconds
    expect(room.drinkTargets("c2", 1)).toBe("bad_message"); // not to yourself
    expect(room.drinkTargets("c2", 3)).toBe("bad_message"); // no such seat
    expect(room.drinkTargets("c2", null)).toEqual({ from: 1, to: [0, 2] }); // a round for the table
    expect(room.drinkTargets("c3", 0)).toBe("bad_state"); // spectators can't buy
  });
});

describe("dead weight and payouts", () => {
  it("absent seats never hit, join, bank or deal, and play their weakest card", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new HeistGame({ seed, seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, bot: false })) });
      const bots = [1, 2, 3].map((i) => new Bot(seed * 10 + i));
      for (let guard = 0; guard < 5000 && g.pending; guard++) {
        const p = g.pending;
        if (p.seat === 0) {
          const a = deadWeight(p, g.s);
          if (p.kind === "action") expect(a).toEqual({ kind: "action", choice: "pass" });
          if (p.kind === "join") expect(a).toMatchObject({ B: 0, M: 0 });
          if (p.kind === "bank") expect(a).toMatchObject({ cardIds: [] });
          if (p.kind === "hire") expect(a).toMatchObject({ count: 0 });
          if (p.kind === "showdown") {
            const vals = g.s.players[0].hand.filter((c) => c.kind === "S" || c.kind === "F").map((c) => (c.kind === "S" ? c.score : 0));
            const played = g.s.players[0].hand.find((c) => c.id === (a as { cardId: number }).cardId)!;
            expect(played.kind === "S" ? played.score : 0).toBe(Math.min(...vals));
          }
          g.answer(0, a); // the engine accepts every one of them
        } else g.answer(p.seat, bots[p.seat - 1].answer(g, p));
      }
      expect(g.pending).toBeNull();
      expect(g.s.winners).not.toContain(0);
    }
  });

  it("pays the winners who stayed, or else the best-placed seat still at the table", () => {
    const g = new HeistGame({ seed: 3, seats: [0, 1, 2].map((i) => ({ name: `P${i}`, bot: true })) });
    runBots(g, new Map([0, 1, 2].map((i) => [i, new Bot(i)])));
    const w = g.s.winners!;
    expect(payees(g.s, w, [])).toEqual(w);
    const gone = w[0];
    const others = [0, 1, 2].filter((p) => p !== gone);
    const paid = payees(g.s, [gone], [gone]);
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((p) => others.includes(p))).toBe(true);
    expect(payees(g.s, [gone], [0, 1, 2])).toEqual([]);
  });
});

describe("frameView", () => {
  it("matches the engine's viewFor on every frame, for every seat and a spectator", () => {
    for (const n of [3, 6]) {
      for (let seed = 1; seed <= 6; seed++) {
        const g = new HeistGame({ seed, seats: Array.from({ length: n }, (_, k) => ({ name: `B${k}`, bot: true })) });
        runBots(g, new Map(g.s.players.map((p) => [p.seat, new Bot(seed + p.seat)])));
        for (const f of g.frames) for (let seat = -1; seat < n; seat++) expect(JSON.parse(JSON.stringify(frameView(f.state, seat)))).toEqual(viewFor(f.state, seat));
      }
    }
  });
});

describe("sanitizeAnswer", () => {
  it("keeps only the fields an answer uses and rejects wrong types", () => {
    const ask = { kind: "bet", seat: 0 } as const;
    expect(sanitizeAnswer(ask, { kind: "bet", side: "B", cardId: 3, extra: 1 })).toEqual({ kind: "bet", side: "B", cardId: 3 });
    expect(sanitizeAnswer(ask, { kind: "bet", side: "Z", cardId: 3 })).toBeNull();
    expect(sanitizeAnswer(ask, { kind: "bet", side: null })).toEqual({ kind: "bet", side: null });
    expect(sanitizeAnswer({ kind: "bank", seat: 0, max: 2 }, { kind: "bank", cardIds: ["1"] })).toBeNull();
    expect(sanitizeAnswer({ kind: "again", seat: 0, wanted: [] }, { kind: "again", again: "yes" })).toBeNull();
    expect(sanitizeAnswer({ kind: "hire", seat: 0, max: 2, cost: 3 }, { kind: "send", count: 1 })).toBeNull();
  });
});
