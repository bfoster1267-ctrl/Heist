// Bot players. Ported from the Python balance sim (game/v3/sim/v3sim.py) so the AI fillers play the
// way the 700,000+ simulated games did. Bots only read their own hand plus public information.

import { HIRE_COST, ROLES, cashOf, fightValue, isFighter, makeJobDeck } from "./cards";
import type { HeistGame } from "./game";
import { Rng } from "./rng";
import type { Answer, Ask, Card, RoleId, Side } from "./types";

const ROLE_TASTE: Record<RoleId, number> = {
  getaway: 9, lookout: 8, muscle: 7, mastermind: 7, inside_man: 6, hacker: 6, forger: 6,
  bookie: 6, pickpocket: 5, fence: 5, double_agent: 5, wildcard: 5, safecracker: 4,
};

const keepValue = (c: Card) => (c.kind === "S" ? c.score : { F: 7, B: 5, X: 6, S: 0 }[c.kind]);

export class Bot {
  rng: Rng;
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  answer(g: HeistGame, a: Ask): Answer {
    const s = g.s;
    const me = s.players[a.seat];
    const r = this.rng;
    switch (a.kind) {
      case "keepRole":
        return { kind: "keepRole", role: [...a.options].sort((x, y) => ROLE_TASTE[y] - ROLE_TASTE[x])[0] };

      case "wildcard": {
        const lead = a.targets.reduce((m, q) => (g.footholds(q) > g.footholds(m) ? q : m), a.targets[0]);
        return { kind: "wildcard", target: lead !== undefined && g.footholds(lead) >= s.target - 2 ? lead : null };
      }

      case "fence": {
        const big = s.discard.reduce<Card | null>((m, c) => (fightValue(c) > fightValue(m) ? c : m), null);
        return { kind: "fence", cardId: big && big.score >= 10 && g.cash(a.seat) >= 4 ? big.id : null };
      }

      case "bank": {
        const hand = [...me.hand];
        const ids: number[] = [];
        let cash = cashOf(me.bank);
        for (let i = 0; i < a.max; i++) {
          const want = me.reserve + me.pen > 0 ? 7 : 4;
          if (cash >= want || hand.length <= 3) break;
          const fighters = hand.filter(isFighter).length;
          const opts = hand.filter((c) => c.cash > 0 && (!isFighter(c) || fighters > 2));
          if (!opts.length) break;
          const c = opts.reduce((m, x) => (x.cash - 0.45 * keepValue(x) > m.cash - 0.45 * keepValue(m) ? x : m));
          if (c.cash - 0.45 * keepValue(c) < -3.5 && cash >= 3) break;
          hand.splice(hand.indexOf(c), 1);
          ids.push(c.id);
          cash += c.cash;
        }
        return { kind: "bank", cardIds: ids };
      }

      case "hire": {
        const home = g.homeCrew(a.seat);
        return { kind: "hire", count: home >= 10 ? 0 : Math.min(a.max, 10 - home) };
      }

      case "action": {
        // Bust if it's a good fight or someone is about to win off our hideout.
        let best: { score: number; hideout: number; rival: number } | null = null;
        const big = Math.max(0, ...me.hand.filter(isFighter).map((c) => c.score));
        for (const o of a.busts) {
          const H = me.hideouts[o.hideout];
          let score = H[a.seat] + big - (H[o.rival] + 9) + (g.footholds(o.rival) >= s.target - 1 ? 6 : 0);
          if (g.homeCrew(a.seat) === 0) score += 6;
          if (!best || score > best.score) best = { score, ...o };
        }
        if (best && best.score >= 0) return { kind: "action", choice: "bust", hideout: best.hideout, rival: best.rival };
        if (a.wanted.length) {
          const leader = a.wanted[0].leader;
          if (g.footholds(leader) >= s.target - 1) {
            const w = a.wanted.reduce((m, o) => {
              const def = (x: typeof o) => { const H = s.players[x.mark].hideouts[x.hideout]; return H[x.mark] + H.reduce((p, q) => p + q, 0) * 0.3; };
              return def(o) < def(m) ? o : m;
            });
            return { kind: "action", choice: "wanted", mark: w.mark, hideout: w.hideout };
          }
        }
        if (a.canHit) return { kind: "action", choice: "hit" };
        return { kind: "action", choice: "pass" };
      }

      case "pickMark": {
        // Go after the leader; among ties, the one with the weakest hideout.
        const fh = (q: number) => g.footholds(q);
        const top = Math.max(...a.rivals.map(fh));
        const lead = r.shuffle(a.rivals.filter((q) => fh(q) === top));
        const weakest = (q: number) => Math.min(...s.players[q].hideouts.map((h) => h[q]));
        return { kind: "pickMark", mark: lead.reduce((m, q) => (weakest(q) < weakest(m) ? q : m)) };
      }

      case "pickHideout": {
        const hs = s.players[a.mark].hideouts;
        const weak = (i: number) => {
          const h = hs[i];
          const others = h.reduce((x, k, q) => (q !== a.seat && q !== a.mark ? x + k : x), 0);
          return (h[a.seat] > 0 ? 100 : 0) + h[a.mark] + others * 0.5;
        };
        return { kind: "pickHideout", hideout: [0, 1, 2].reduce((m, i) => (weak(i) < weak(m) ? i : m)) };
      }

      case "send": {
        const home = g.homeCrew(a.seat);
        return { kind: "send", count: Math.max(1, Math.min(a.max, home <= 3 ? home : home - 1)) };
      }

      case "join": {
        const j = s.job!;
        const avail = g.homeCrew(a.seat);
        if (avail <= 1) return { kind: "join", B: 0, M: 0 };
        const H = s.players[j.mark].hideouts[j.hideout];
        const { b: bStr, m: mStr } = g.bases(j);
        let side: Side | null;
        if (H[a.seat] > 0) side = r.next() < 0.75 ? "M" : null;
        else if (g.footholds(j.boss) >= s.target - 1 && H[j.boss] === 0) side = "M";
        else if (g.footholds(j.mark) >= s.target - 1) side = "B";
        else {
          const lean = 1 / (1 + Math.exp(-(bStr - mStr) / 3));
          const x = r.next();
          const pB = 0.55 * (0.4 + 1.2 * lean);
          side = x < pB ? "B" : x < pB + 0.3 ? "M" : null;
        }
        if (!side) return { kind: "join", B: 0, M: 0 };
        const k = Math.min(a.max, avail - 1, r.pick([1, 2, 2, 3]));
        if (a.split && k >= 2) return { kind: "join", B: Math.floor(k / 2), M: k - Math.floor(k / 2) };
        return { kind: "join", B: side === "B" ? k : 0, M: side === "M" ? k : 0 };
      }

      case "doubleCross": {
        const j = s.job!;
        const mine: Side | null = a.seat === j.boss ? "B" : a.seat === j.mark ? "M" : j.side.B[a.seat] ? "B" : j.side.M[a.seat] ? "M" : null;
        if (!mine || r.next() > 0.7) return { kind: "doubleCross", target: null };
        const other: Side = mine === "B" ? "M" : "B";
        const enemies = a.targets.filter((q) => j.side[other][q] > 0 && q !== a.seat);
        if (!enemies.length) return { kind: "doubleCross", target: null };
        return { kind: "doubleCross", target: enemies.reduce((m, q) => (j.side[other][q] > j.side[other][m] ? q : m)) };
      }

      case "bet": {
        if (g.cash(a.seat) < 3 || r.next() < 0.5) return { kind: "bet", side: null };
        const j = s.job!;
        const { b, m } = g.bases(j);
        const side: Side = b + gauss(r) * 4 > m ? "B" : "M";
        const card = me.bank.reduce((x, c) => (c.cash < x.cash ? c : x));
        return { kind: "bet", side, cardId: card.id };
      }

      case "hackerCall": {
        const unseen = this.unseen(g, a.seat).filter((c) => c.kind === "S");
        const count = new Map<number, number>();
        for (const c of unseen) count.set(c.score, (count.get(c.score) ?? 0) + 1);
        let n = 6, best = -1;
        for (const [v, k] of count) if (k > best) [n, best] = [v, k];
        return { kind: "hackerCall", n: a.numbers.includes(n) ? n : a.numbers[0] };
      }

      case "showdown":
        return { kind: "showdown", cardId: this.pickCard(g, a.seat, a.as).id };

      case "forger": {
        const j = s.job!;
        const side: Side = a.seat === j.boss ? "B" : "M";
        const best = Math.max(...a.numbers);
        const { b, m } = g.bases(j);
        const mineNow = side === "B" ? j.bTotal : j.mTotal;
        const theirs = side === "B" ? j.mTotal : j.bTotal;
        const base = side === "B" ? b : m;
        const winning = side === "B" ? mineNow > theirs : mineNow >= theirs;
        const wouldWin = side === "B" ? base + best > theirs : base + best >= theirs;
        return { kind: "forger", n: !winning && wouldWin ? best : null };
      }

      case "backup": {
        const j = s.job!;
        const bWin = j.bTotal > j.mTotal;
        const losing: Side = bWin ? "M" : "B";
        const onSide = (sd: Side) => (sd === "B" ? a.seat === j.boss || j.side.B[a.seat] > 0 : a.seat === j.mark || j.side.M[a.seat] > 0);
        const gap = losing === "M" ? j.bTotal - j.mTotal : j.mTotal - j.bTotal + 1;
        return { kind: "backup", side: onSide(losing) && gap <= 3 ? losing : null };
      }

      case "dealOffer":
        return { kind: "dealOffer", offer: g.cash(a.seat) >= HIRE_COST ? "foothold" : "walk" };

      case "dealAccept":
        return { kind: "dealAccept", accept: a.offer === "walk" ? true : r.next() < 0.55 };

      case "again":
        return { kind: "again", again: g.homeCrew(a.seat) >= 2 };

      case "discard": {
        const ids = [...me.hand].sort((x, y) => keepValue(x) - keepValue(y)).slice(0, a.count).map((c) => c.id);
        return { kind: "discard", cardIds: ids };
      }
    }
  }

  private unseen(g: HeistGame, me: number): Card[] {
    const seen = new Set<number>();
    for (const c of g.s.discard) seen.add(c.id);
    for (const c of g.s.players[me].hand) seen.add(c.id);
    for (const p of g.s.players) for (const c of p.bank) seen.add(c.id);
    return ALL.filter((c) => !seen.has(c.id) && isFighter(c));
  }

  /** Monte Carlo guess at the opponent's card, then the card with the best win chance for its cost. */
  private pickCard(g: HeistGame, me: number, as: "boss" | "mark" | "bust" | "rival"): Card {
    const s = g.s;
    const j = s.job!;
    const r = this.rng;
    const opts = s.players[me].hand.filter(isFighter);
    const opp = as === "boss" ? j.mark : as === "mark" ? j.boss : as === "bust" ? j.mark : j.boss;
    let myTot: number, oppTot: number, defender: boolean;
    if (j.kind === "bust") {
      const H = s.players[j.boss].hideouts[j.hideout];
      myTot = as === "bust" ? H[j.boss] : H[j.mark];
      oppTot = as === "bust" ? H[j.mark] : H[j.boss];
      defender = as === "bust"; // the buster wins ties
    } else {
      const { b, m } = g.bases(j);
      myTot = as === "boss" ? b : m;
      oppTot = as === "boss" ? m : b;
      defender = as === "mark";
    }
    const pool = this.unseen(g, me);
    const src = pool.length ? pool : opts;
    const k = Math.max(1, Math.min(s.players[opp].hand.filter(isFighter).length || 1, src.length));
    const guesses: Card[] = [];
    for (let i = 0; i < 20; i++) {
      const hand = r.shuffle([...src]).slice(0, k);
      const sc = hand.filter((c) => c.kind === "S").sort((x, y) => x.score - y.score);
      guesses.push(sc.length && r.next() < 0.6 ? sc[sc.length - 1] : r.pick(hand));
    }
    const uniq = new Map<string, Card>();
    for (const c of opts) if (!uniq.has(c.kind + c.score)) uniq.set(c.kind + c.score, c);
    const utils: [number, Card][] = [];
    for (const c of uniq.values()) {
      let w = 0;
      for (const gs of guesses) {
        if (c.kind === "F" && gs.kind === "F") w += 0.5;
        else if (c.kind === "F") w += 0;
        else if (gs.kind === "F") w += 1;
        else {
          const x = c.score + myTot, y = gs.score + oppTot;
          w += x > y || (x === y && defender) ? 1 : 0;
        }
      }
      w /= guesses.length;
      utils.push([w - (c.kind === "S" ? (0.25 * c.score) / 30 : 0.05), c]);
    }
    const ws = utils.map(([u]) => Math.exp(u / 0.12));
    let x = r.next() * ws.reduce((p, q) => p + q, 0);
    for (let i = 0; i < utils.length; i++) {
      x -= ws[i];
      if (x <= 0) return utils[i][1];
    }
    return utils[utils.length - 1][1];
  }
}

const ALL = makeJobDeck();

function gauss(r: Rng) {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

/** Answer every pending ask that belongs to a bot. Returns when a human must act or the game ends. */
export function runBots(g: HeistGame, bots: Map<number, Bot>, maxSteps = 100000) {
  for (let i = 0; i < maxSteps && g.pending; i++) {
    const bot = bots.get(g.pending.seat);
    if (!bot) return;
    g.answer(g.pending.seat, bot.answer(g, g.pending));
  }
}

export const ROLE_IDS = ROLES.map((r) => r.id);
