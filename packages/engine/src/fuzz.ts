// A player that picks a random legal answer to every Ask. Used by the fuzz tests to push the engine down
// paths bots never take; also handy for load-testing a server.
import { isFighter } from "./cards";
import type { HeistGame } from "./game";
import { HIDEOUTS } from "./game";
import type { Rng } from "./rng";
import type { Answer, Ask, Deal } from "./types";

export function randomAnswer(g: HeistGame, a: Ask, r: Rng): Answer {
  const s = g.s;
  const P = s.players[a.seat];
  const coin = (p = 0.5) => r.next() < p;
  const some = <T>(xs: T[], max: number) => r.shuffle([...xs]).slice(0, r.int(Math.min(max, xs.length) + 1));
  /** split `count` of p's home crew across hideouts at random (null: let the engine choose) */
  const from = (count: number): number[] | undefined => {
    if (coin()) return undefined;
    const left = P.hideouts.map((h) => h[a.seat]);
    const out = new Array(HIDEOUTS).fill(0);
    for (let i = 0; i < count; i++) {
      const hs = left.flatMap((k, h) => (k > out[h] ? [h] : []));
      out[r.pick(hs)]++;
    }
    return out;
  };
  switch (a.kind) {
    case "keepRole": return { kind: "keepRole", role: r.pick(a.options) };
    case "wildcard": return { kind: "wildcard", target: coin() ? null : r.pick(a.targets) };
    case "fence": return { kind: "fence", cardId: coin() || !s.discard.length ? null : r.pick(s.discard).id };
    case "bank": return { kind: "bank", cardIds: some(P.hand, a.max).map((c) => c.id) };
    case "hire": return { kind: "hire", count: r.int(a.max + 1) };
    case "action": {
      const opts: Answer[] = [{ kind: "action", choice: "pass" }];
      if (a.canHit) opts.push({ kind: "action", choice: "hit" }, { kind: "action", choice: "hit" });
      for (const b of a.busts) opts.push({ kind: "action", choice: "bust", ...b });
      for (const w of a.wanted) opts.push({ kind: "action", choice: "wanted", mark: w.mark, hideout: w.hideout });
      return r.pick(opts);
    }
    case "pickMark": return { kind: "pickMark", mark: r.pick(a.rivals) };
    case "pickHideout": return { kind: "pickHideout", hideout: r.int(HIDEOUTS) };
    case "send": {
      const count = 1 + r.int(a.max);
      return { kind: "send", count, from: from(count) };
    }
    case "bribe": {
      const bank = r.shuffle([...P.bank]);
      const offers = some(a.targets, 2).map((to) => ({ to, cardIds: bank.splice(0, 1 + r.int(2)).map((c) => c.id) }));
      return { kind: "bribe", offers: offers.filter((o) => o.cardIds.length) };
    }
    case "join": {
      const k = r.int(a.max + 1);
      if (a.split && coin()) {
        const b = r.int(k + 1);
        return { kind: "join", B: b, M: k - b, from: from(k) };
      }
      return coin() ? { kind: "join", B: k, M: 0, from: from(k) } : { kind: "join", B: 0, M: k, from: from(k) };
    }
    case "doubleCross": return { kind: "doubleCross", target: coin() ? null : r.pick(a.targets) };
    case "bet": return coin() || !P.bank.length ? { kind: "bet", side: null } : { kind: "bet", side: coin() ? "B" : "M", cardId: r.pick(P.bank).id };
    case "hackerCall": return { kind: "hackerCall", n: r.pick(a.numbers) };
    case "showdown": return { kind: "showdown", cardId: r.pick(P.hand.filter(isFighter)).id };
    case "forger": return { kind: "forger", n: coin() ? null : r.pick(a.numbers) };
    case "backup": return { kind: "backup", side: coin() ? null : coin() ? "B" : "M" };
    case "dealOffer": return { kind: "dealOffer", offer: coin(0.2) ? null : coin() ? "walk" : "foothold" };
    case "dealAccept": return { kind: "dealAccept", accept: coin() };
    case "deal": {
      if (a.offer && coin(0.4)) return { kind: "deal", action: "accept" };
      if (a.offersLeft <= 0 || coin(0.15)) return { kind: "deal", action: "reject" };
      const j = s.job!;
      const B = s.players[j.boss], M = s.players[j.mark];
      const cash = (p: typeof B) => p.bank.reduce((x, c) => x + c.cash, 0);
      const deal: Deal = {
        bossPays: r.int(Math.min(cash(B), 4) + 1),
        markPays: r.int(Math.min(cash(M), 4) + 1),
        bossCards: r.int(Math.min(B.hand.length, 2) + 1),
        markCards: r.int(Math.min(M.hand.length, 2) + 1),
        foothold: M.hideouts[j.hideout][j.boss] === 0 && coin(),
      };
      return { kind: "deal", action: "propose", deal };
    }
    case "giveCards": return { kind: "giveCards", cardIds: r.shuffle([...P.hand]).slice(0, a.count).map((c) => c.id) };
    case "placeCrew": {
      const to = new Array(HIDEOUTS).fill(0);
      for (let i = 0; i < a.count; i++) to[r.int(HIDEOUTS)]++;
      return { kind: "placeCrew", to };
    }
    case "again":
      if (coin(0.3)) return { kind: "again", again: false };
      return a.wanted.length && coin() ? { kind: "again", again: true, wanted: r.pick(a.wanted) } : { kind: "again", again: true };
    case "discard": return { kind: "discard", cardIds: r.shuffle([...P.hand]).slice(0, a.count).map((c) => c.id) };
  }
}
