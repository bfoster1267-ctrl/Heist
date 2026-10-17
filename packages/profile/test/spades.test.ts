import { describe, expect, it } from "vitest";
import {
  advanceSpades, applySpades, dealSpades, replaySpades, spadesBidMove, spadesGain, spadesLegal, spadesPay, spadesPickBid,
  spadesPickCard, spadesTallyOf, tallySpades, tallySpadesXp, SPADES_FLOOR, SPADES_QUICK_TARGET, SPADES_TARGET, SPADES_XP,
  type SpadesState,
} from "../src/spades";
import { SPADES } from "../src/tricks";
import { cardSuit } from "../src/solitaire";

function playOut(seed: number, target = SPADES_TARGET, pick: (s: SpadesState) => unknown = (s) => (s.phase === "bid" ? spadesBidMove(spadesPickBid(s, 0)) : spadesPickCard(s))) {
  let s = advanceSpades(dealSpades(seed, target));
  const moves: unknown[] = [];
  while (s.phase !== "over") {
    const m = pick(s);
    const n = applySpades(s, m);
    if (!n) throw new Error(`illegal move ${JSON.stringify(m)}`);
    moves.push(m);
    s = advanceSpades(n);
  }
  return { s, moves };
}

describe("Spades", () => {
  it("bids go round from the dealer's left, then the first lead comes from there too", () => {
    const s = dealSpades(9);
    expect(s.phase).toBe("bid");
    expect(s.t.turn).toBe(0); // hand 0: the dealer is on your right
    const n = advanceSpades(applySpades(s, "b3")!);
    expect(n.bids[0]).toBe(3);
    expect(n.bids.every((b) => b !== null)).toBe(true);
    expect(n.phase).toBe("play");
  });

  it("only takes bids 0 (Nil) to 13", () => {
    const s = dealSpades(9);
    expect(applySpades(s, "b14")).toBeNull();
    expect(applySpades(s, "b-1")).toBeNull();
    expect(applySpades(s, 3)).toBeNull();
    expect(applySpades(s, "b0")!.bids[0]).toBe(0);
  });

  it("spades can't be led until broken, and you must follow suit", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = advanceSpades(dealSpades(seed));
      s = advanceSpades(applySpades(s, spadesBidMove(spadesPickBid(s, 0)))!);
      while (s.phase === "play" && s.hand === 0) {
        const hand = s.t.hands[s.t.turn];
        const legal = spadesLegal(s);
        if (s.t.trick.length === 0 && !s.broken && hand.some((c) => cardSuit(c) !== SPADES)) expect(legal.some((c) => cardSuit(c) === SPADES)).toBe(false);
        if (s.t.trick.length) {
          const led = cardSuit(s.t.trick[0].card);
          if (hand.some((c) => cardSuit(c) === led)) expect(legal.every((c) => cardSuit(c) === led)).toBe(true);
        }
        s = advanceSpades(applySpades(s, spadesPickCard(s))!);
      }
    }
  });

  it("scores bids, bags and Nil, and the bag penalty every 10", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { s } = playOut(seed * 13);
      let bags: [number, number] = [0, 0];
      let scores: [number, number] = [0, 0];
      for (const r of s.results) {
        expect(r.tricks.reduce((a, b) => a + b, 0)).toBe(13);
        for (const team of [0, 1] as const) {
          const seats = [team, team + 2];
          let d = 0;
          let nb = 0;
          let contract = 0;
          let got = 0;
          for (const k of seats) {
            if (r.bids[k] === 0) {
              d += r.tricks[k] === 0 ? 100 : -100;
              nb += r.tricks[k];
            } else {
              contract += r.bids[k];
              got += r.tricks[k];
            }
          }
          if (contract) {
            if (got >= contract) {
              d += 10 * contract;
              nb += got - contract;
            } else d -= 10 * contract;
          }
          d += nb;
          bags[team] += nb;
          while (bags[team] >= 10) {
            bags[team] -= 10;
            d -= 100;
          }
          expect(r.delta[team]).toBe(d);
          scores[team] += d;
        }
      }
      expect(s.scores).toEqual(scores);
      expect(s.bags).toEqual(bags);
      const top = Math.max(...s.scores);
      expect(top >= SPADES_TARGET || Math.min(...s.scores) <= SPADES_FLOOR).toBe(true);
      expect(s.scores[s.winner!]).toBe(top);
    }
  });

  it("a quick game plays to 250", () => {
    const { s } = playOut(5, SPADES_QUICK_TARGET);
    expect(s.target).toBe(SPADES_QUICK_TARGET);
    expect(Math.max(...s.scores) >= SPADES_QUICK_TARGET || Math.min(...s.scores) <= SPADES_FLOOR).toBe(true);
  });

  it("a partner covers your Nil: they overtake you when you're winning the trick", () => {
    const s = dealSpades(1);
    // you bid Nil and led the K♥, West ducked; partner (seat 2) holds the A♥
    const spot: SpadesState = {
      ...s, phase: "play", bids: [0, 3, 4, 3], broken: false,
      t: { ...s.t, hands: [[1], [2], [13, 16], [3]], trick: [{ seat: 0, card: 25 }, { seat: 1, card: 14 }], turn: 2, count: 12 },
    };
    expect(spadesPickCard(spot)).toBe(13); // A♥ over your K♥
  });

  it("bots bid every hand, mostly make their bids, and sometimes go Nil", () => {
    let hands = 0;
    let made = 0;
    let nils = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { s } = playOut(seed * 7);
      for (const r of s.results) {
        hands++;
        if (r.made[1]) made++;
        nils += [1, 3].filter((k) => r.bids[k] === 0).length;
        expect(r.bids.every((b) => b >= 0 && b <= 13)).toBe(true);
      }
    }
    expect(made / hands).toBeGreaterThan(0.75);
    expect(nils).toBeGreaterThan(0);
  });

  it("replays exactly from the seed, target and moves", () => {
    const { s, moves } = playOut(31337, SPADES_QUICK_TARGET);
    expect(spadesTallyOf(replaySpades(31337, moves, SPADES_QUICK_TARGET))).toEqual(spadesTallyOf(s));
    // the same moves against the full target don't finish the game
    expect(tallySpades(31337, moves, SPADES_TARGET).won).toBe(false);
  });

  it("stops replaying at the first move that doesn't fit", () => {
    const { moves } = playOut(8);
    const t = tallySpades(8, ["b99", ...moves]);
    expect(t.hands).toBe(0);
    expect(t.over).toBe(false);
  });

  it("random legal play always reaches the end", () => {
    let r = 3;
    const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let seed = 1; seed <= 15; seed++) {
      const { s } = playOut(seed, SPADES_QUICK_TARGET, (x) => {
        if (x.phase === "bid") return spadesBidMove(Math.floor(rand() * 6));
        const l = spadesLegal(x);
        return l[Math.floor(rand() * l.length)];
      });
      expect(s.phase).toBe("over");
    }
  });

  it("pays tricks, bids made, Nils and the win, once", () => {
    const t = { hands: 6, tricks: 20, contracts: 5, nils: 1, won: true, over: true };
    expect(tallySpadesXp(t)).toBe(20 * SPADES_XP.trick + 5 * SPADES_XP.contract + SPADES_XP.nil + SPADES_XP.win);
    const first = spadesPay(undefined, undefined, t, 0);
    expect(first.xp).toBe(tallySpadesXp(t));
    expect(spadesPay(first.paid, first.paidXp, t, 0).xp).toBe(0);
    expect(spadesGain(first.paid, t).any).toBe(false);
  });
});
