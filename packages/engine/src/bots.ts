// Bot players. The "normal" bot is ported from the Python balance sim (game/v3/sim/v3sim.py) so the AI
// fillers play the way the 700,000+ simulated games did. "hard" adds the tricks that beat the table in
// the strategy sims (game/v3/sim/smart/): sit out round 1, join every fight, pile on whoever is one
// Foothold from winning, hold grudges, and notice players who keep backing each other. "easy" plays
// looser. Bots only read their own hand plus public information (including the job history).

import { HIRE_COST, ROLES, cashOf, fightValue, isFighter, makeJobDeck } from "./cards";
import { choosePayment, type HeistGame } from "./game";
import { Rng } from "./rng";
import type { Answer, Ask, Card, Deal, JobState, RoleId, Side, WantedOption } from "./types";

const ROLE_TASTE: Record<RoleId, number> = {
  getaway: 9, lookout: 8, muscle: 7, mastermind: 7, inside_man: 6, hacker: 6, forger: 6,
  bookie: 6, pickpocket: 5, fence: 5, double_agent: 5, wildcard: 5, safecracker: 4,
};

const keepValue = (c: Card) => (c.kind === "S" ? c.score : { F: 7, B: 5, X: 6, S: 0 }[c.kind]);

export type BotLevel = "easy" | "normal" | "hard";

export interface BotOptions {
  /** default "normal" (plays like the balance sim) */
  level?: BotLevel;
  /** Only hits with a 12+ card, a hand of 6+, a rival about to win, or after waiting 2 turns. Off by default:
   * in the sims a whole table of patient players made games slow, and waiting only paid when others didn't. */
  patient?: boolean;
  /** A bad beat gives a grudge: pick that player as Mark, join against them, Double-Cross their allies.
   * On by default for hard bots. */
  vendetta?: boolean;
  /** Secret partner: back each other (join their side, never pick them) until they're 1 Foothold from
   * winning, then turn on them. Set it on both bots. Hard bots notice pairs after 3 assists. */
  partner?: number | null;
}

interface Tuning {
  temp: number; // card choice softmax temperature
  sitOutRound1: boolean;
  joinEveryFight: boolean;
  pileOn: boolean;
  wantedAlways: boolean;
  watchPairs: boolean;
  fenceMin: number;
  wildGap: number;
  dcRate: number;
  bribes: boolean;
  avoidHackerCall: boolean;
}

const TUNING: Record<BotLevel, Tuning> = {
  easy: { temp: 0.35, sitOutRound1: false, joinEveryFight: false, pileOn: false, wantedAlways: false, watchPairs: false, fenceMin: 12, wildGap: 1, dcRate: 0.4, bribes: false, avoidHackerCall: false },
  normal: { temp: 0.12, sitOutRound1: false, joinEveryFight: false, pileOn: false, wantedAlways: true, watchPairs: false, fenceMin: 10, wildGap: 2, dcRate: 0.7, bribes: true, avoidHackerCall: true },
  hard: { temp: 0.08, sitOutRound1: true, joinEveryFight: true, pileOn: true, wantedAlways: true, watchPairs: true, fenceMin: 8, wildGap: 3, dcRate: 0.7, bribes: true, avoidHackerCall: true },
};

export class Bot {
  rng: Rng;
  level: BotLevel;
  patient: boolean;
  vendetta: boolean;
  partner: number | null;
  private t: Tuning;
  private waited = 0;
  private grudge: number | null = null;
  private seenJobs = 0;
  /** assists[a][b]: times a joined b's side while b was Boss or Mark */
  private assists: number[][] = [];

  constructor(seed: number, opts: BotOptions = {}) {
    this.rng = new Rng(seed);
    this.level = opts.level ?? "normal";
    this.t = TUNING[this.level];
    this.patient = opts.patient ?? false;
    this.vendetta = opts.vendetta ?? this.level === "hard";
    this.partner = opts.partner ?? null;
  }

  answer(g: HeistGame, a: Ask): Answer {
    this.observe(g, a.seat);
    const s = g.s;
    const me = s.players[a.seat];
    const r = this.rng;
    const t = this.t;
    const threat = (q: number) => g.footholds(q) >= s.target - 1;
    switch (a.kind) {
      case "keepRole":
        return { kind: "keepRole", role: [...a.options].sort((x, y) => ROLE_TASTE[y] - ROLE_TASTE[x])[0] };

      case "wildcard": {
        const lead = a.targets.reduce((m, q) => (g.footholds(q) > g.footholds(m) ? q : m), a.targets[0]);
        return { kind: "wildcard", target: lead !== undefined && g.footholds(lead) >= s.target - t.wildGap ? lead : null };
      }

      case "fence": {
        const big = s.discard.reduce<Card | null>((m, c) => (fightValue(c) > fightValue(m) ? c : m), null);
        return { kind: "fence", cardId: big && big.score >= t.fenceMin && g.cash(a.seat) >= 4 ? big.id : null };
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
        const home = g.homeCrew(a.seat) + me.returning;
        return { kind: "hire", count: home >= 10 ? 0 : Math.min(a.max, 10 - home) };
      }

      case "action": {
        // Bust if it's a good fight or someone is about to win off our hideout.
        let best: { score: number; hideout: number; rival: number } | null = null;
        const big = Math.max(0, ...me.hand.filter(isFighter).map((c) => c.score));
        for (const o of a.busts) {
          const H = me.hideouts[o.hideout];
          let score = H[a.seat] + big - (H[o.rival] + 9) + (threat(o.rival) ? 6 : 0);
          if (g.homeCrew(a.seat) === 0) score += 6;
          if (this.level === "easy") score -= 3;
          if (!best || score > best.score) best = { score, ...o };
        }
        if (best && best.score >= 0) return { kind: "action", choice: "bust", hideout: best.hideout, rival: best.rival };
        if (!a.canHit) return { kind: "action", choice: "pass" };
        const rivalsThreat = this.rivals(g, a.seat).some(threat);
        if (t.sitOutRound1 && s.turn < s.n && !rivalsThreat) return { kind: "action", choice: "pass" };
        if (this.patient) {
          const top = Math.max(0, ...me.hand.filter((c) => c.kind === "S").map((c) => c.score));
          if (!(top >= 12 || me.hand.length >= 6 || this.waited >= 2 || rivalsThreat)) {
            this.waited++;
            return { kind: "action", choice: "pass" };
          }
        }
        this.waited = 0;
        const w = this.pickWanted(g, a.seat, a.wanted);
        if (w) return { kind: "action", choice: "wanted", mark: w.mark, hideout: w.hideout };
        return { kind: "action", choice: "hit" };
      }

      case "again": {
        if (g.homeCrew(a.seat) < 2) return { kind: "again", again: false };
        const w = this.pickWanted(g, a.seat, a.wanted);
        return w ? { kind: "again", again: true, wanted: { mark: w.mark, hideout: w.hideout } } : { kind: "again", again: true };
      }

      case "pickMark": {
        const fh = (q: number) => g.footholds(q);
        let cands = a.rivals.filter((q) => !this.loyalTo(g, a.seat, q));
        if (!cands.length) cands = a.rivals;
        if (t.pileOn) {
          const th = cands.filter(threat);
          if (th.length) return { kind: "pickMark", mark: th[0] };
        }
        if (this.vendetta && this.grudge !== null && cands.includes(this.grudge)) return { kind: "pickMark", mark: this.grudge };
        if (t.watchPairs && !rivalsAboutToWin(g, a.rivals)) {
          const teamed = cands.filter((q) => this.exposed(q, a.seat));
          if (teamed.length) return { kind: "pickMark", mark: teamed.reduce((m, q) => (fh(q) > fh(m) ? q : m)) };
        }
        // Go after the leader; among ties, the one with the weakest hideout.
        const top = Math.max(...cands.map(fh));
        const lead = r.shuffle(cands.filter((q) => fh(q) === top));
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
        const count = Math.max(1, Math.min(a.max, home <= 3 ? home : home - 1));
        return { kind: "send", count, from: this.from(g, a.seat, count) };
      }

      case "bribe": {
        if (!t.bribes || g.cash(a.seat) < 6) return { kind: "bribe", offers: [] };
        const j = s.job!;
        const taken = new Set(j.bribes.map((b) => b.to));
        const cands = a.targets.filter((q) => g.homeCrew(q) >= 2 && !taken.has(q));
        if (!cands.length) return { kind: "bribe", offers: [] };
        let to: number;
        if (this.level === "hard") {
          const { b, m } = g.bases(j);
          if (Math.abs(b - m) > 6) return { kind: "bribe", offers: [] };
          to = cands.reduce((x, q) => (g.homeCrew(q) > g.homeCrew(x) ? q : x));
        } else {
          if (r.next() >= 0.5) return { kind: "bribe", offers: [] };
          to = r.pick(cands);
        }
        return { kind: "bribe", offers: [{ to, cardIds: choosePayment(me.bank, 2).map((c) => c.id) }] };
      }

      case "join": {
        const j = s.job!;
        const avail = g.homeCrew(a.seat);
        if (avail <= 1) return { kind: "join", B: 0, M: 0 };
        const side = this.joinSide(g, a.seat, j);
        if (!side) return { kind: "join", B: 0, M: 0 };
        const k = Math.min(a.max, avail - 1, r.pick([1, 2, 2, 3]));
        const from = this.from(g, a.seat, k);
        if (a.split && k >= 2) return { kind: "join", B: Math.floor(k / 2), M: k - Math.floor(k / 2), from };
        return { kind: "join", B: side === "B" ? k : 0, M: side === "M" ? k : 0, from };
      }

      case "doubleCross": {
        const j = s.job!;
        const mine: Side | null = a.seat === j.boss ? "B" : a.seat === j.mark ? "M" : j.side.B[a.seat] ? "B" : j.side.M[a.seat] ? "M" : null;
        if (!mine) return { kind: "doubleCross", target: null };
        const other: Side = mine === "B" ? "M" : "B";
        const enemies = a.targets.filter((q) => j.side[other][q] > 0 && q !== a.seat && !this.loyalTo(g, a.seat, q));
        if (!enemies.length) return { kind: "doubleCross", target: null };
        if (t.pileOn || this.vendetta) {
          const hot = enemies.filter((q) => (t.pileOn && threat(q)) || (this.vendetta && q === this.grudge));
          if (hot.length) return { kind: "doubleCross", target: hot[0] };
        }
        if (r.next() > t.dcRate) return { kind: "doubleCross", target: null };
        return { kind: "doubleCross", target: enemies.reduce((m, q) => (j.side[other][q] > j.side[other][m] ? q : m)) };
      }

      case "bet": {
        if (g.cash(a.seat) < 3 || r.next() < 0.5) return { kind: "bet", side: null };
        const j = s.job!;
        const { b, m } = g.bases(j);
        const side: Side = this.level === "easy" ? (r.next() < 0.5 ? "B" : "M") : b + gauss(r) * 4 > m ? "B" : "M";
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

      case "deal":
        return this.deal(g, a);

      case "giveCards": {
        const ids = [...me.hand].sort((x, y) => keepValue(x) - keepValue(y)).slice(0, a.count).map((c) => c.id);
        return { kind: "giveCards", cardIds: ids };
      }

      case "placeCrew":
        return { kind: "placeCrew", to: this.place(g, a.seat, a.count) };

      case "discard": {
        const ids = [...me.hand].sort((x, y) => keepValue(x) - keepValue(y)).slice(0, a.count).map((c) => c.id);
        return { kind: "discard", cardIds: ids };
      }
    }
  }

  // ------------------------------------------------------------------ memory
  /** Read jobs finished since we last looked: grudges after bad beats, and who keeps backing whom. */
  private observe(g: HeistGame, me: number) {
    const h = g.s.history;
    const n = g.s.n;
    if (!this.assists.length) this.assists = Array.from({ length: n }, () => new Array(n).fill(0));
    for (; this.seenJobs < h.length; this.seenJobs++) {
      const j = h[this.seenJobs];
      if (j.kind !== "hit") continue;
      for (const q of j.allies.B) this.assists[q][j.boss]++;
      for (const q of j.allies.M) this.assists[q][j.mark]++;
      if ((j.result !== "B" && j.result !== "M") || !j.bossCard || !j.markCard) continue;
      const bwin = j.result === "B";
      const loser = bwin ? j.mark : j.boss;
      const winner = bwin ? j.boss : j.mark;
      const lc = bwin ? j.markCard : j.bossCard;
      const wc = bwin ? j.bossCard : j.markCard;
      const badBeat = lc.kind === "S" && (wc.kind !== "S" || lc.score >= wc.score || lc.score >= 12);
      if (badBeat && loser === me) this.grudge = winner;
    }
  }

  /** Still backing our secret partner? (Not once they're 1 Foothold from winning.) */
  private loyalTo(g: HeistGame, me: number, q: number) {
    return this.partner === q && g.footholds(q) < g.s.target - 1 && q !== me;
  }

  /** Two players who've backed each other 3+ times in plain sight look like a team. */
  private exposed(q: number, me: number) {
    if (!this.t.watchPairs || !this.assists.length) return false;
    return this.assists[q].some((k, x) => x !== me && x !== q && k + this.assists[x][q] >= 3 && k > 0 && this.assists[x][q] > 0);
  }

  private rivals(g: HeistGame, me: number) {
    return g.s.players.map((p) => p.seat).filter((q) => q !== me);
  }

  private pickWanted(g: HeistGame, me: number, opts: WantedOption[]): WantedOption | null {
    if (!opts.length) return null;
    const s = g.s;
    const leader = opts[0].leader;
    if (this.loyalTo(g, me, leader)) return null;
    if (!this.t.wantedAlways && g.footholds(leader) < s.target - 1) return null;
    const def = (x: WantedOption) => {
      const H = s.players[x.mark].hideouts[x.hideout];
      return H[x.mark] + H.reduce((p, q) => p + q, 0) * 0.3;
    };
    return opts.reduce((m, o) => (def(o) < def(m) ? o : m));
  }

  private joinSide(g: HeistGame, me: number, j: JobState): Side | null {
    const s = g.s;
    const r = this.rng;
    const t = this.t;
    const H = s.players[j.mark].hideouts[j.hideout];
    const T = s.target;
    const fh = (q: number) => g.footholds(q);
    const paid = j.bribes.filter((b) => b.to === me);
    const bribedSide = paid.length ? paid.reduce((x, b) => (b.amount >= x.amount ? b : x)).side : null;
    if (this.level !== "hard") {
      // the sim bot: a bribe wins (1 in 5 take the money and stay out), then defend our own crew
      if (bribedSide) return r.next() < 0.8 ? bribedSide : null;
      if (H[me] > 0) return r.next() < 0.75 ? "M" : null;
    } else {
      // our crew already sit in the target hideout: defend it. Then pile on anyone about to win.
      if (H[me] > 0) return "M";
      if (fh(j.boss) >= T - 1) return "M";
      if (fh(j.mark) >= T - 1) return "B";
    }
    if (this.partner !== null && this.loyalTo(g, me, this.partner)) {
      if (this.partner === j.boss) return "B";
      if (this.partner === j.mark) return "M";
    }
    if (this.vendetta && this.grudge !== null) {
      if (this.grudge === j.boss) return "M";
      if (this.grudge === j.mark) return "B";
    }
    if (t.watchPairs) {
      if (this.exposed(j.boss, me)) return "M";
      if (this.exposed(j.mark, me)) return "B";
    }
    if (bribedSide && r.next() < 0.8) return bribedSide;
    const { b: bStr, m: mStr } = g.bases(j);
    if (t.joinEveryFight) return bStr + 2 >= mStr ? "B" : "M";
    if (fh(j.boss) >= T - 1 && H[j.boss] === 0) return "M";
    if (fh(j.mark) >= T - 1) return "B";
    const lean = 1 / (1 + Math.exp(-(bStr - mStr) / 3));
    const x = r.next();
    const pB = 0.55 * (0.4 + 1.2 * lean);
    return x < pB ? "B" : x < pB + 0.3 ? "M" : null;
  }

  // ------------------------------------------------------------------ crew placement (rules.placeCrew)
  /** Which hideouts to take crew from: only chosen when players place their own crew. Hard bots keep crew
   * where rivals sit (to bust them later) and send from quiet hideouts. */
  private from(g: HeistGame, me: number, count: number): number[] | undefined {
    if (!g.s.rules.placeCrew) return undefined;
    const hs = g.s.players[me].hideouts.map((h) => [...h]);
    const rivalsIn = (h: number[]) => h.reduce((x, k, q) => (q !== me ? x + k : x), 0);
    const out = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const key = (h: number) => hs[h][me] - (this.level === "hard" && rivalsIn(hs[h]) > 0 ? 3 : 0);
      const h = [0, 1, 2].filter((x) => hs[x][me] > 0).reduce((m, x) => (key(x) > key(m) ? x : m));
      hs[h][me]--;
      out[h]++;
    }
    return out;
  }

  private place(g: HeistGame, me: number, count: number): number[] {
    const hs = g.s.players[me].hideouts.map((h) => [...h]);
    const rivalsIn = (h: number[]) => h.reduce((x, k, q) => (q !== me ? x + k : x), 0);
    const out = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const key = (h: number) => {
        const H = hs[h];
        // hard: stack up next to rival crew (bust them, and a Boss hitting there faces more of us)
        const bonus = this.level === "hard" && rivalsIn(H) > 0 && H[me] <= rivalsIn(H) + 2 ? 3 : 0;
        return H[me] - bonus;
      };
      const h = [0, 1, 2].reduce((m, x) => (key(x) < key(m) ? x : m));
      hs[h][me]++;
      out[h]++;
    }
    return out;
  }

  // ------------------------------------------------------------------ open Fixer deals (rules.openDeals)
  /** How much a deal is worth to `me` compared with no deal (both sides send 2 crew to the Pen). */
  private dealValue(g: HeistGame, me: number, d: Deal): number {
    const j = g.s.job!;
    const isBoss = me === j.boss;
    const cash = isBoss ? d.markPays - d.bossPays : d.bossPays - d.markPays;
    const cards = isBoss ? d.markCards - d.bossCards : d.bossCards - d.markCards;
    let fh = 0;
    if (d.foothold) {
      const near = g.footholds(j.boss) >= g.s.target - 1;
      fh = isBoss ? (near ? 100 : 4.5) : -(near ? 100 : 4.5);
    }
    // no deal costs us 2 crew (worth ~1.5 each) and costs them the same (worth ~0.75 to us)
    const noDealSaved = 2 * 1.5 - 2 * 0.75;
    return cash + 1.5 * cards + fh + noDealSaved;
  }

  private deal(g: HeistGame, a: Extract<Ask, { kind: "deal" }>): Answer {
    const s = g.s;
    const j = s.job!;
    const me = a.seat;
    const noise = this.level === "easy" ? 3 : this.level === "normal" ? 1.5 : 0.5;
    const canFoothold = s.players[j.mark].hideouts[j.hideout][j.boss] === 0;
    const walk: Deal = { bossPays: 0, markPays: 0, bossCards: 0, markCards: 0, foothold: false };
    if (a.offer) {
      const v = this.dealValue(g, me, a.offer) + gauss(this.rng) * noise;
      if (v >= 0) return { kind: "deal", action: "accept" };
      if (a.offersLeft <= 0) return { kind: "deal", action: "reject" };
      // counter: the Mark offers both walking away; the Boss offers to pay a little more
      if (me === j.mark) return { kind: "deal", action: "propose", deal: walk };
      const pay = Math.min(g.cash(me), a.offer.bossPays + 2);
      return { kind: "deal", action: "propose", deal: canFoothold ? { ...walk, foothold: true, bossPays: pay } : walk };
    }
    // opening offer (Boss)
    if (canFoothold && g.cash(me) >= HIRE_COST) return { kind: "deal", action: "propose", deal: { ...walk, foothold: true, bossPays: HIRE_COST } };
    return { kind: "deal", action: "propose", deal: walk };
  }

  // ------------------------------------------------------------------ showdown cards
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
    // the opponent's Hacker called a number before cards were picked: playing it loses outright
    const called = this.t.avoidHackerCall && j.hackerCall && j.hackerCall.seat === opp ? j.hackerCall.n : null;
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
      if (!(c.kind === "S" && c.score === called)) {
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
      }
      utils.push([w - (c.kind === "S" ? (0.25 * c.score) / 30 : 0.05), c]);
    }
    const ws = utils.map(([u]) => Math.exp(u / this.t.temp));
    let x = r.next() * ws.reduce((p, q) => p + q, 0);
    for (let i = 0; i < utils.length; i++) {
      x -= ws[i];
      if (x <= 0) return utils[i][1];
    }
    return utils[utils.length - 1][1];
  }
}

const ALL = makeJobDeck();

function rivalsAboutToWin(g: HeistGame, rivals: number[]) {
  return rivals.some((q) => g.footholds(q) >= g.s.target - 1);
}

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
