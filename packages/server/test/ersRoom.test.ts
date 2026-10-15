import { describe, expect, it } from "vitest";
import { ErsRoom, generateErsCode } from "../src/ersRoom";
import { FakeClock, TestConn } from "./helpers";
import { startServer, type HeistServer } from "../src/server";

describe("ErsRoom unit tests", () => {
  function setupRoom(seed = 42) {
    const clock = new FakeClock();
    const overs: unknown[] = [];
    const room = new ErsRoom(
      { code: "TEST1", seed },
      { clock, onGameOver: (r) => overs.push(r) }
    );
    const p0 = new TestConn("c0", "u0", "Alice");
    const p1 = new TestConn("c1", "u1", "Bob");
    return { clock, room, p0, p1, overs };
  }

  it("handles 2 human players joining and deals 26 cards each", () => {
    const { room, p0, p1 } = setupRoom();

    expect(room.status).toBe("waiting");
    expect(room.openSeats()).toBe(2);

    const r0 = room.join(p0);
    expect(r0.ok).toBe(true);
    expect(r0.seat).toBe(0);
    expect(room.status).toBe("waiting");
    expect(room.openSeats()).toBe(1);

    const r1 = room.join(p1);
    expect(r1.ok).toBe(true);
    expect(r1.seat).toBe(1);

    // Both seated -> game starts
    expect(room.status).toBe("playing");
    expect(room.p0.length).toBe(26);
    expect(room.p1.length).toBe(26);
    expect(room.pot.length).toBe(0);
    expect(room.turn).toBe(0);

    // 3rd player is rejected
    const p2 = new TestConn("c2", "u2", "Charlie");
    const r2 = room.join(p2);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe("room_full");

    // Both players received sync messages
    const sync0 = p0.last("ers_sync");
    expect(sync0).toBeDefined();
    expect(sync0?.room.status).toBe("playing");
    expect(sync0?.room.you.cardCount).toBe(26);
    expect(sync0?.room.opponent?.cardCount).toBe(26);
  });

  it("validates turn alternation on non-face cards and rejects out-of-turn play", () => {
    const { room, p0, p1 } = setupRoom();
    room.join(p0);
    room.join(p1);

    // Setup specific hands: both have number cards (e.g. rank 2 and 3)
    // Card 1 = rank 2 (2 of spades), Card 2 = rank 3 (3 of spades)
    room.p0 = [1];
    room.p1 = [2];

    // Player 1 tries to play out of turn
    const outOfTurn = room.play("c1");
    expect(outOfTurn.ok).toBe(false);
    expect(outOfTurn.error).toBe("not_your_turn");

    // Player 0 plays validly
    const play0 = room.play("c0");
    expect(play0.ok).toBe(true);
    expect(room.pot.length).toBe(1);
    expect(room.p0.length).toBe(0);
    expect(room.turn).toBe(1);

    // Player 1 flips next
    const play1 = room.play("c1");
    expect(play1.ok).toBe(true);
    expect(room.pot.length).toBe(2);
    expect(room.p1.length).toBe(0);
  });

  it("handles face-card challenges (King = 3 chances, challenge failure gives pot to challenger)", () => {
    const { room, p0, p1 } = setupRoom();
    room.join(p0);
    room.join(p1);

    // King is rank 13 (card 12). Number cards: rank 4 (card 3), rank 5 (card 4), rank 6 (card 5)
    // Top of draw pile is popped from the end, so order: [5, 4, 3] pops 3, then 4, then 5.
    room.p0 = [12]; // King of Spades
    room.p1 = [5, 4, 3]; // 3 non-face cards

    // Player 0 plays King
    const playK = room.play("c0");
    expect(playK.ok).toBe(true);
    expect(room.challenge).toEqual({ by: 0, chances: 3 });
    expect(room.turn).toBe(1); // Turn moves to challenged player

    // Player 1 plays card 3 (chance 1 of 3)
    room.play("c1");
    expect(room.challenge?.chances).toBe(2);
    expect(room.turn).toBe(1); // Still Player 1's turn to answer challenge

    // Player 1 plays card 4 (chance 2 of 3)
    room.play("c1");
    expect(room.challenge?.chances).toBe(1);
    expect(room.turn).toBe(1);

    // Player 1 plays card 5 (chance 3 of 3)
    room.play("c1");
    // Challenge failed! Challenger (Player 0) scoops all 4 cards in the pot!
    expect(room.challenge).toBeNull();
    expect(room.pot.length).toBe(0);
    expect(room.p0.length).toBe(4);
    expect(room.stats.faceChallengesWon[0]).toBe(1);
    expect(room.turn).toBe(0); // Challenger leads next turn
  });

  it("handles counter-challenges when challenged player plays a face card", () => {
    const { room, p0, p1 } = setupRoom();
    room.join(p0);
    room.join(p1);

    // Player 0 has King (card 12, rank 13 = 3 chances), then two 2s (card 1)
    // Player 1 has Queen (card 11, rank 12 = 2 chances)
    room.p0 = [1, 1, 12];
    room.p1 = [11];

    // P0 plays King (3 chances)
    room.play("c0");
    expect(room.challenge).toEqual({ by: 0, chances: 3 });
    expect(room.turn).toBe(1);

    // P1 answers with Queen (counter-challenge!)
    room.play("c1");
    expect(room.challenge).toEqual({ by: 1, chances: 2 });
    expect(room.turn).toBe(0); // Turn switches back to P0 to answer Queen

    // P0 plays card 1 (chance 1 of 2)
    room.play("c0");
    expect(room.challenge?.chances).toBe(1);
    expect(room.turn).toBe(0);

    // P0 plays card 1 (chance 2 of 2)
    room.play("c0");
    // Challenge failed! P1 wins the pot
    expect(room.challenge).toBeNull();
    expect(room.pot.length).toBe(0);
    expect(room.p1.length).toBe(4); // King + Queen + two 2s
    expect(room.stats.faceChallengesWon[1]).toBe(1);
    expect(room.turn).toBe(1);
  });

  it("awards pot to first valid slap on doubles, sandwiches, marriages, tens, and top-bottom", () => {
    const { room, p0, p1 } = setupRoom();
    room.join(p0);
    room.join(p1);

    // 1. Double slap: Two 7s (card 6, card 19)
    room.pot = [6, 19];
    const slapDouble = room.slap("c0");
    expect(slapDouble.ok).toBe(true);
    expect(slapDouble.valid).toBe(true);
    expect(slapDouble.reason).toBe("double");
    expect(room.pot.length).toBe(0);
    expect(room.turn).toBe(0);
    expect(room.stats.slaps[0]).toBe(1);

    // 2. Sandwich slap: 9, 3, 9 (card 8, card 2, card 21)
    room.pot = [8, 2, 21];
    const slapSandwich = room.slap("c1");
    expect(slapSandwich.ok).toBe(true);
    expect(slapSandwich.valid).toBe(true);
    expect(slapSandwich.reason).toBe("sandwich");
    expect(room.pot.length).toBe(0);
    expect(room.stats.slaps[1]).toBe(1);

    // 3. Marriage slap: King and Queen (card 12, card 11)
    room.pot = [12, 11];
    const slapMarriage = room.slap("c0");
    expect(slapMarriage.valid).toBe(true);
    expect(slapMarriage.reason).toBe("marriage");
    expect(room.pot.length).toBe(0);

    // 4. Tens slap: 4 and 6 (card 3, card 5)
    room.pot = [3, 5];
    const slapTens = room.slap("c1");
    expect(slapTens.valid).toBe(true);
    expect(slapTens.reason).toBe("tens");
    expect(room.pot.length).toBe(0);

    // 5. Top-Bottom slap: First card 8, two middle cards, top card 8 (card 7, card 1, card 2, card 20)
    room.pot = [7, 1, 2, 20];
    const slapTopBottom = room.slap("c0");
    expect(slapTopBottom.valid).toBe(true);
    expect(slapTopBottom.reason).toBe("topbottom");
    expect(room.pot.length).toBe(0);
  });

  it("handles simultaneous slaps where first wins and second within grace window gets no penalty", () => {
    const { room, clock, p0, p1 } = setupRoom();
    room.join(p0);
    room.join(p1);

    // Pot has double (two Jacks: card 10, card 23)
    room.pot = [10, 23];
    const initialP0Count = room.p0.length;
    const initialP1Count = room.p1.length;

    // Player 0 slaps first at t = 1000ms
    const s0 = room.slap("c0");
    expect(s0.ok).toBe(true);
    expect(s0.valid).toBe(true);
    expect(s0.reason).toBe("double");
    expect(room.pot.length).toBe(0);
    expect(room.p0.length).toBe(initialP0Count + 2);

    // Player 1 slaps 40ms later at t = 1040ms (within 500ms grace)
    clock.advance(40);
    const s1 = room.slap("c1");
    expect(s1.ok).toBe(true);
    expect(s1.valid).toBe(true);
    // Player 1 did NOT suffer a false slap penalty!
    expect(room.stats.falseSlaps[1]).toBe(0);
    expect(room.p1.length).toBe(initialP1Count);
  });

  it("penalizes false slaps by burning 1 card to the bottom of the pot", () => {
    const { room, p0, p1 } = setupRoom();
    room.join(p0);
    room.join(p1);

    // Pot has card 3 (rank 4) and card 4 (rank 5) -> not double, not sandwich, not tens (4+5=9)
    room.pot = [3, 4];
    room.p0 = [10, 20, 30]; // Top card is 30

    const falseSlap = room.slap("c0");
    expect(falseSlap.ok).toBe(true);
    expect(falseSlap.valid).toBe(false);
    expect(falseSlap.reason).toBeNull();

    // Burned 1 card from p0 to the bottom of the pot (pot[0])
    expect(room.stats.falseSlaps[0]).toBe(1);
    expect(room.p0.length).toBe(2);
    expect(room.pot.length).toBe(3);
    expect(room.pot[0]).toBe(30); // Card 30 burned to the bottom of the pot
  });

  it("resolves game victory when one player sweeps all cards", () => {
    const { room, p0, p1, overs } = setupRoom();
    room.join(p0);
    room.join(p1);

    // Player 0 has 51 cards, Player 1 has 1 card (Jack: card 10). Pot has 0 cards.
    // Jack has 1 chance.
    room.p0 = Array.from({ length: 51 }, (_, i) => i);
    room.p1 = [10]; // Jack
    room.pot = [];
    room.turn = 1;

    // Player 1 plays Jack (card 10)
    room.play("c1");
    expect(room.p1.length).toBe(0);
    expect(room.challenge).toEqual({ by: 1, chances: 1 });
    expect(room.turn).toBe(0);

    // Player 0 plays a face card (e.g. Ace = card 0)
    // When Player 0 plays a face card, opponent (P1) has 0 cards and cannot answer!
    room.p0 = [0];
    room.play("c0");

    // Player 0 takes pot and wins the entire match!
    expect(room.winner).toBe(0);
    expect(room.status).toBe("over");
    expect(overs.length).toBe(1);
    expect(p0.last("ers_over")?.winner).toBe(0);
  });
});

describe("ErsRoom integration over HTTP and WebSockets", () => {
  let server: HeistServer;

  it("creates and inspects ERS rooms via HTTP API", async () => {
    server = await startServer({ port: 0 });
    const port = server.port();

    // 1. POST /api/ers/create
    const resCreate = await fetch(`http://127.0.0.1:${port}/api/ers/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: false }),
    });
    expect(resCreate.status).toBe(200);
    const dataCreate = await resCreate.json();
    expect(dataCreate.ok).toBe(true);
    expect(typeof dataCreate.code).toBe("string");
    expect(dataCreate.code.length).toBe(5);

    // 2. GET /api/ers/:code
    const resGet = await fetch(`http://127.0.0.1:${port}/api/ers/${dataCreate.code}`);
    expect(resGet.status).toBe(200);
    const dataGet = await resGet.json();
    expect(dataGet.ok).toBe(true);
    expect(dataGet.room.code).toBe(dataCreate.code);
    expect(dataGet.room.status).toBe("waiting");

    // 3. GET /api/ers list
    const resList = await fetch(`http://127.0.0.1:${port}/api/ers`);
    expect(resList.status).toBe(200);
    const dataList = await resList.json();
    expect(dataList.ok).toBe(true);
    expect(dataList.rooms.some((r: { code: string }) => r.code === dataCreate.code)).toBe(true);

    await server.close();
  });

  it("plays real-time ERS over WebSocket protocol", async () => {
    server = await startServer({ port: 0 });
    const port = server.port();
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    const ws0 = new WebSocket(wsUrl);
    const ws1 = new WebSocket(wsUrl);

    const msgs0: any[] = [];
    const msgs1: any[] = [];

    ws0.onmessage = (e) => msgs0.push(JSON.parse(String(e.data)));
    ws1.onmessage = (e) => msgs1.push(JSON.parse(String(e.data)));

    await Promise.all([
      new Promise<void>((r) => (ws0.onopen = () => r())),
      new Promise<void>((r) => (ws1.onopen = () => r())),
    ]);

    // Hello handshake
    ws0.send(JSON.stringify({ t: "hello", v: 1, name: "Alice" }));
    ws1.send(JSON.stringify({ t: "hello", v: 1, name: "Bob" }));

    // Wait for welcome
    await new Promise((r) => setTimeout(r, 60));
    expect(msgs0.some((m) => m.t === "welcome")).toBe(true);
    expect(msgs1.some((m) => m.t === "welcome")).toBe(true);

    // Player 0 creates ERS room
    ws0.send(JSON.stringify({ t: "ers_create" }));
    await new Promise((r) => setTimeout(r, 60));

    const welcome0 = msgs0.find((m) => m.t === "ers_welcome");
    expect(welcome0).toBeDefined();
    expect(welcome0.seat).toBe(0);
    const roomCode = welcome0.code;

    // Player 1 joins the ERS room
    ws1.send(JSON.stringify({ t: "ers_join", code: roomCode }));
    await new Promise((r) => setTimeout(r, 60));

    const welcome1 = msgs1.find((m) => m.t === "ers_welcome");
    expect(welcome1).toBeDefined();
    expect(welcome1.seat).toBe(1);

    // Both should receive playing sync
    const syncs0 = msgs0.filter((m) => m.t === "ers_sync");
    const lastSync0 = syncs0[syncs0.length - 1];
    expect(lastSync0.room.status).toBe("playing");
    expect(lastSync0.room.turn).toBe(0);

    // Player 0 flips top card
    ws0.send(JSON.stringify({ t: "ers_play" }));
    await new Promise((r) => setTimeout(r, 60));

    const flips1 = msgs1.filter((m) => m.t === "ers_flip");
    expect(flips1.length).toBeGreaterThan(0);
    expect(flips1[flips1.length - 1].seat).toBe(0);

    // Player 1 sends slap
    ws1.send(JSON.stringify({ t: "ers_slap", time: Date.now() }));
    await new Promise((r) => setTimeout(r, 60));

    const slaps0 = msgs0.filter((m) => m.t === "ers_slap");
    expect(slaps0.length).toBeGreaterThan(0);

    ws0.close();
    ws1.close();
    await server.close();
  });
});
