import { describe, expect, it } from "vitest";
import {
  applyHeartsCard,
  applyHeartsPass,
  heartsBotCard,
  heartsBotPass,
  heartsLegalPlays,
  newHearts,
  replayHearts,
  tallyHearts,
  TWO_OF_CLUBS,
} from "../src/hearts";
import {
  applySpadesBid,
  applySpadesCard,
  newSpades,
  replaySpades,
  spadesBotBid,
  spadesBotCard,
  spadesLegalPlays,
  tallySpades,
} from "../src/spades";
import { newProgress, settleHearts, settleSpades } from "../src/progress";

describe("Hearts rules and replay", () => {
  it("deals 13 distinct cards to each of the 4 seats", () => {
    const s = newHearts(42, "pro");
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    const all = new Set(s.hands.flat());
    expect(all.size).toBe(52);
  });

  it("exchanges 3 passed cards and starts with the holder of 2♣", () => {
    const s = newHearts(101, "pro");
    const pass = heartsBotPass(s.hands[0], "pro", 101, 0);
    const next = applyHeartsPass(s, pass);
    expect(next.phase).toBe("play");
    expect(next.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(next.hands[next.turn]).toContain(TWO_OF_CLUBS);
    expect(heartsLegalPlays(next, next.turn)).toEqual([TWO_OF_CLUBS]);
  });

  it("plays a full 13-trick hand and replays identically from seat 0 moves", () => {
    let s = newHearts(777, "pro");
    const moves: number[][] = [];
    const pass = heartsBotPass(s.hands[0], "pro", 777, 0);
    moves.push(pass);
    s = applyHeartsPass(s, pass);

    while (s.phase === "play") {
      if (s.turn === 0) {
        const legal = heartsLegalPlays(s, 0);
        expect(legal.length).toBeGreaterThan(0);
        const card = heartsBotCard(s, "pro", 777);
        moves.push([card]);
        s = applyHeartsCard(s, card);
      } else {
        const card = heartsBotCard(s, s.level, s.seed);
        s = applyHeartsCard(s, card);
      }
    }

    expect(s.phase).toBe("done");
    expect(s.trickNo).toBe(13);
    expect(s.tricksWon.reduce((a, b) => a + b, 0)).toBe(13);
    expect(s.rawPoints.reduce((a, b) => a + b, 0)).toBe(26);
    expect(moves.length).toBe(14); // 1 pass + 13 trick plays

    const replayed = replayHearts(777, "pro", moves);
    expect(replayed.state.points).toEqual(s.points);
    expect(replayed.state.winner).toBe(s.winner);

    const t = tallyHearts(777, "pro", moves);
    expect(t.over).toBe(true);
    const settled = settleHearts(newProgress(), Date.now(), t, undefined, true);
    expect(settled.progress.hearts).toBeDefined();
  });
});

describe("Spades rules and replay", () => {
  it("deals 13 distinct cards to each seat and starts in bid phase", () => {
    const s = newSpades(99, "pro");
    expect(s.phase).toBe("bid");
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(s.bids[0]).toBeNull();
    expect(s.bids[1]).toBeGreaterThanOrEqual(0);
  });

  it("plays a full 13-trick Spades hand and replays identically from seat 0 moves", () => {
    let s = newSpades(888, "boss");
    const moves: number[][] = [];
    const bid = spadesBotBid(s.hands[0], "boss", 888, 0);
    moves.push([bid]);
    s = applySpadesBid(s, bid);

    while (s.phase === "play") {
      if (s.turn === 0) {
        const legal = spadesLegalPlays(s, 0);
        expect(legal.length).toBeGreaterThan(0);
        const card = spadesBotCard(s, "boss", 888);
        moves.push([card]);
        s = applySpadesCard(s, card);
      } else {
        const card = spadesBotCard(s, s.level, s.seed);
        s = applySpadesCard(s, card);
      }
    }

    expect(s.phase).toBe("done");
    expect(s.trickNo).toBe(13);
    expect(s.tricksWon.reduce((a, b) => a + b, 0)).toBe(13);
    expect(moves.length).toBe(14); // 1 bid + 13 trick plays

    const replayed = replaySpades(888, "boss", moves);
    expect(replayed.state.scores).toEqual(s.scores);
    expect(replayed.state.winner).toBe(s.winner);

    const t = tallySpades(888, "boss", moves);
    expect(t.over).toBe(true);
    const settled = settleSpades(newProgress(), Date.now(), t, undefined, true);
    expect(settled.progress.spades).toBeDefined();
  });
});
