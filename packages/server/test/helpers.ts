import { isFighter, type Answer, type Ask, type GameState } from "@heist/engine";
import type { Clock, Conn } from "../src/room";
import type { ServerMsg } from "../src/protocol";

/** A legal, dumb answer to any Ask, using only what the player can see. */
export function simpleAnswer(ask: Ask, view: GameState): Answer {
  const me = view.players[ask.seat];
  switch (ask.kind) {
    case "keepRole": return { kind: "keepRole", role: ask.options[0] };
    case "wildcard": return { kind: "wildcard", target: null };
    case "fence": return { kind: "fence", cardId: null };
    case "bank": return { kind: "bank", cardIds: me.hand.slice(0, Math.min(1, ask.max)).map((c) => c.id) };
    case "hire": return { kind: "hire", count: ask.max };
    case "action": return ask.canHit ? { kind: "action", choice: "hit" } : { kind: "action", choice: "pass" };
    case "pickMark": return { kind: "pickMark", mark: ask.rivals[0] };
    case "pickHideout": return { kind: "pickHideout", hideout: 0 };
    case "send": return { kind: "send", count: ask.max };
    case "join": return { kind: "join", B: 0, M: 0 };
    case "bribe": return { kind: "bribe", offers: [] };
    case "placeCrew": return { kind: "placeCrew", to: [ask.count, 0, 0] };
    case "giveCards": return { kind: "giveCards", cardIds: me.hand.slice(0, ask.count).map((c) => c.id) };
    case "deal": return ask.offer ? { kind: "deal", action: "accept" } : { kind: "deal", action: "reject" };
    case "doubleCross": return { kind: "doubleCross", target: null };
    case "bet": return { kind: "bet", side: null };
    case "hackerCall": return { kind: "hackerCall", n: ask.numbers[0] };
    case "showdown": return { kind: "showdown", cardId: me.hand.find(isFighter)!.id };
    case "forger": return { kind: "forger", n: null };
    case "backup": return { kind: "backup", side: null };
    case "dealOffer": return { kind: "dealOffer", offer: null };
    case "dealAccept": return { kind: "dealAccept", accept: false };
    case "again": return { kind: "again", again: false };
    case "discard": return { kind: "discard", cardIds: me.hand.slice(0, ask.count).map((c) => c.id) };
  }
}

export class FakeClock implements Clock {
  t = 1_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now() { return this.t; }
  set(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clear(h: unknown) { this.timers = this.timers.filter((x) => x.id !== h); }
  get pending() { return this.timers.length; }
  /** Move time forward, firing due timers in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

export class TestConn implements Conn {
  inbox: ServerMsg[] = [];
  constructor(public id: string, public userId: string, public name: string) {}
  send(m: ServerMsg) { this.inbox.push(structuredClone(m)); }
  of<T extends ServerMsg["t"]>(t: T) { return this.inbox.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
  last<T extends ServerMsg["t"]>(t: T) { const a = this.of(t); return a[a.length - 1]; }
  /** latest table state this connection has been shown */
  view(): GameState | null {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i];
      if (m.t === "frames" && m.frames.length) return m.frames[m.frames.length - 1].state;
      if (m.t === "sync") return m.state;
    }
    return null;
  }
}
