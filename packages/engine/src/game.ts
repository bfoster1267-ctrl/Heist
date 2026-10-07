// Heist v3 rules engine.
//
// The game runs as a generator: rules code reads top to bottom like the Boss and Mark cards, and every
// time a player has to choose something the generator yields an Ask. The host (browser for solo play,
// server for online play) answers it with answer(seat, Answer). Every state change is recorded as a
// Frame (event + snapshot) that the table animates. A game is fully reproducible from its seed and the
// list of answers, which is how a server can rebuild a table after a restart.

import {
  BACKUP_BONUS,
  BANK_PER_TURN,
  HAND_LIMIT,
  HIRE_COST,
  HOME_TURF,
  LAST_CALL_RUNOUTS,
  LOOT,
  ROLES,
  SCORE_MIX,
  cardLabel,
  cashOf,
  fightValue,
  isFighter,
  makeJobDeck,
  roleName,
} from "./cards";
import { Rng } from "./rng";
import type {
  Answer,
  Ask,
  BustOption,
  Card,
  Frame,
  GameConfig,
  GameEvent,
  GameState,
  JobState,
  PlayerState,
  RoleId,
  Side,
  WantedOption,
} from "./types";

type Flow<T = void> = Generator<Ask, T, Answer>;
type AnswerOf<K extends Answer["kind"]> = Extract<Answer, { kind: K }>;

export const HIDEOUTS = 3;
export const PER_HIDEOUT = 3;
export const CREW_PER_PLAYER = 12;

/** Pick cards that cover `amt` with the least overpay (no change is given). */
export function choosePayment(cards: Card[], amt: number): Card[] {
  const b = [...cards].sort((x, y) => x.cash - y.cash);
  if (!b.length || amt <= 0) return [];
  if (cashOf(b) <= amt) return b;
  const singles = b.filter((c) => c.cash >= amt);
  const best = singles.length ? singles.reduce((m, c) => (c.cash < m.cash ? c : m)) : null;
  const acc: Card[] = [];
  let tot = 0;
  for (const c of b) {
    if (tot >= amt) break;
    acc.push(c);
    tot += c.cash;
  }
  for (const c of [...acc].sort((x, y) => x.cash - y.cash)) {
    if (tot - c.cash >= amt) {
      acc.splice(acc.indexOf(c), 1);
      tot -= c.cash;
    }
  }
  return best && best.cash <= tot ? [best] : acc;
}

export function snapshot(s: GameState): GameState {
  return structuredClone(s);
}

export class HeistGame {
  s: GameState;
  rng: Rng;
  seed: number;
  frames: Frame[] = [];
  answers: { seat: number; a: Answer }[] = [];
  pending: Ask | null = null;
  private gen: Flow;
  private roleOffers: RoleId[][] = [];

  constructor(cfg: GameConfig) {
    const n = cfg.seats.length;
    if (n < 3 || n > 6) throw new Error("Heist is for 3 to 6 players");
    this.seed = cfg.seed;
    this.rng = new Rng(cfg.seed);
    const free = this.rng.shuffle([0, 1, 2, 3, 4, 5].filter((c) => !cfg.seats.some((s) => s.color === c)));
    const players: PlayerState[] = cfg.seats.map((sc, seat) => ({
      seat,
      name: sc.name,
      color: sc.color ?? free.pop()!,
      bot: sc.bot,
      role: null,
      hand: [],
      bank: [],
      reserve: CREW_PER_PLAYER - HIDEOUTS * PER_HIDEOUT,
      pen: 0,
      hideouts: Array.from({ length: HIDEOUTS }, () => {
        const h = new Array(n).fill(0);
        h[seat] = PER_HIDEOUT;
        return h;
      }),
      forgeUsed: false,
      wildUsed: false,
    }));
    this.s = {
      n,
      players,
      deck: this.rng.shuffle(makeJobDeck()),
      deckCount: 64,
      discard: [],
      boss: 0,
      firstBoss: 0,
      turn: 0,
      reshuffles: 0,
      lastCall: false,
      target: n === 3 ? 3 : 4,
      againAllowed: n > 3,
      job: null,
      flip: null,
      phase: "setup",
      winners: null,
      endReason: null,
    };
    this.s.boss = this.s.firstBoss = this.rng.int(n);
    const pool = this.rng.shuffle(ROLES.map((r) => r.id));
    this.roleOffers = players.map((_, i) => [pool[2 * i], pool[2 * i + 1]]);
    for (const p of players) for (let i = 0; i < 5; i++) p.hand.push(this.draw()!);
    this.gen = this.main();
    this.step(undefined as unknown as Answer);
  }

  // ------------------------------------------------------------------ host API
  answer(seat: number, a: Answer): void {
    const p = this.pending;
    if (!p) throw new Error("The game is over");
    if (p.seat !== seat) throw new Error(`Waiting on seat ${p.seat}, not ${seat}`);
    if (p.kind !== a.kind) throw new Error(`Expected a ${p.kind} answer`);
    const err = this.validate(p, a);
    if (err) throw new Error(err);
    this.answers.push({ seat, a });
    this.step(a);
  }

  get over(): boolean {
    return this.s.winners !== null;
  }

  /** Take frames recorded since the last call (the table animates these). */
  drainFrames(): Frame[] {
    const f = this.frames;
    this.frames = [];
    return f;
  }

  private step(a: Answer) {
    const r = this.gen.next(a);
    this.pending = r.done ? null : r.value;
    this.s.deckCount = this.s.deck.length;
  }

  private emit(ev: GameEvent, msg: string) {
    this.s.deckCount = this.s.deck.length;
    this.frames.push({ ev, msg, state: snapshot(this.s) });
  }

  private *ask<K extends Ask["kind"]>(a: Extract<Ask, { kind: K }>): Flow<AnswerOf<K>> {
    this.s.phase = a.kind;
    return (yield a) as AnswerOf<K>;
  }

  // ------------------------------------------------------------------ helpers
  name(p: number) {
    return this.s.players[p].name;
  }
  role(p: number) {
    return this.s.players[p].role;
  }
  homeCrew(p: number) {
    return this.s.players[p].hideouts.reduce((a, h) => a + h[p], 0);
  }
  footholds(p: number) {
    let k = 0;
    for (const q of this.s.players) if (q.seat !== p) for (const h of q.hideouts) if (h[p] > 0) k++;
    return k;
  }
  cash(p: number) {
    return cashOf(this.s.players[p].bank);
  }
  seatOfColor(color: number): number | null {
    const p = this.s.players.find((x) => x.color === color);
    return p ? p.seat : null;
  }
  hasFighter(p: number) {
    return this.s.players[p].hand.some(isFighter);
  }

  draw(): Card | null {
    const s = this.s;
    if (!s.deck.length) {
      if (!s.discard.length) return null;
      s.deck = this.rng.shuffle(s.discard);
      s.discard = [];
      s.reshuffles++;
      if (this.frames) this.emit({ t: "reshuffle", count: s.reshuffles }, `The Job deck ran out (${s.reshuffles} of ${LAST_CALL_RUNOUTS}). Shuffled the discard pile.`);
      if (s.reshuffles >= LAST_CALL_RUNOUTS && !s.lastCall) {
        s.lastCall = true;
        this.emit({ t: "lastCall" }, "Last Call! The game ends after this turn.");
      }
    }
    return s.deck.pop() ?? null;
  }

  private drawTo(p: number, k: number) {
    let got = 0;
    for (let i = 0; i < k; i++) {
      const c = this.draw();
      if (!c) break;
      this.s.players[p].hand.push(c);
      got++;
    }
    return got;
  }

  private bankTop(p: number, why: string) {
    const c = this.draw();
    if (!c) return;
    this.s.players[p].bank.push(c);
    this.emit({ t: "cut", seat: p }, `${this.name(p)} banks the top Job card ($${c.cash}): ${why}.`);
  }

  /** Pay `amt` from p's bank (no change). Returns the cash actually paid. */
  private pay(p: number, amt: number, to: number | null): number {
    const P = this.s.players[p];
    const paid = choosePayment(P.bank, amt);
    for (const c of paid) {
      P.bank.splice(P.bank.indexOf(c), 1);
      if (to === null) this.s.discard.push(c);
      else this.s.players[to].bank.push(c);
    }
    return cashOf(paid);
  }

  affordableHires(p: number, upTo: number): number {
    let bank = [...this.s.players[p].bank];
    let k = 0;
    while (k < upTo && cashOf(bank) >= HIRE_COST) {
      const paid = choosePayment(bank, HIRE_COST);
      bank = bank.filter((c) => !paid.includes(c));
      k++;
    }
    return k;
  }

  private takeHome(p: number, k: number): number {
    const hs = this.s.players[p].hideouts;
    let got = 0;
    for (let i = 0; i < k; i++) {
      const h = hs.reduce((m, x) => (x[p] > m[p] ? x : m));
      if (h[p] <= 0) break;
      h[p]--;
      got++;
    }
    return got;
  }

  private putHome(p: number, k: number) {
    const hs = this.s.players[p].hideouts;
    for (let i = 0; i < k; i++) hs.reduce((m, x) => (x[p] < m[p] ? x : m))[p]++;
  }

  private toPen(p: number, k: number) {
    if (k <= 0) return;
    this.s.players[p].pen += k;
    this.emit({ t: "toPen", seat: p, count: k }, `${k} of ${this.name(p)}'s crew go to the Pen.`);
  }

  bustOptions(b: number): BustOption[] {
    const out: BustOption[] = [];
    this.s.players[b].hideouts.forEach((h, i) => {
      h.forEach((k, q) => {
        if (q !== b && k > 0) out.push({ hideout: i, rival: q });
      });
    });
    return out;
  }

  /** Wanted: one player alone has the most Footholds (2+). Hit any hideout holding their crew. */
  wantedOptions(b: number): WantedOption[] {
    const n = this.s.n;
    const fh = Array.from({ length: n }, (_, p) => this.footholds(p));
    const top = Math.max(...fh);
    if (top < 2 || fh.filter((x) => x === top).length !== 1) return [];
    const leader = fh.indexOf(top);
    if (leader === b) return [];
    const out: WantedOption[] = [];
    for (const m of this.s.players) {
      if (m.seat === b || m.seat === leader) continue;
      m.hideouts.forEach((h, i) => {
        if (h[leader] > 0) out.push({ mark: m.seat, hideout: i, leader });
      });
    }
    return out;
  }

  rivals(b: number) {
    return this.s.players.map((p) => p.seat).filter((q) => q !== b);
  }

  // ------------------------------------------------------------------ the game
  private *main(): Flow {
    const s = this.s;
    this.emit({ t: "setup" }, `${s.n} players. First to ${s.target} Footholds wins.`);
    for (const p of s.players) {
      const a = yield* this.ask({ kind: "keepRole", seat: p.seat, options: this.roleOffers[p.seat] });
      p.role = a.role;
      this.emit({ t: "role", seat: p.seat, role: a.role }, `${p.name} is ${roleName(a.role)}.`);
    }
    while (!s.winners) {
      yield* this.turn(s.boss);
      if (s.winners) break;
      if (s.lastCall) {
        this.endLastCall();
        break;
      }
      s.boss = (s.boss + 1) % s.n;
      s.turn++;
    }
    s.phase = "over";
  }

  private endLastCall() {
    const s = this.s;
    const key = s.players.map((p) => this.footholds(p.seat) * 1000 + this.cash(p.seat));
    const best = Math.max(...key);
    s.winners = s.players.filter((p) => key[p.seat] === best).map((p) => p.seat);
    s.endReason = "last_call";
    this.emit({ t: "gameOver", winners: s.winners, reason: "last_call" }, `Last Call. ${s.winners.map((w) => this.name(w)).join(" and ")} win${s.winners.length > 1 ? "" : "s"} on Footholds.`);
  }

  private checkWin(): boolean {
    const s = this.s;
    const w = s.players.filter((p) => this.footholds(p.seat) >= s.target).map((p) => p.seat);
    if (!w.length) return false;
    s.winners = w;
    s.endReason = "footholds";
    s.job = null;
    this.emit({ t: "gameOver", winners: w, reason: "footholds" }, `${w.map((x) => this.name(x)).join(" and ")} reach${w.length > 1 ? "" : "es"} ${s.target} Footholds and win${w.length > 1 ? "" : "s"}!`);
    return true;
  }

  private *turn(b: number): Flow {
    const s = this.s;
    const P = s.players[b];
    s.job = null;
    s.flip = null;
    this.emit({ t: "turn", seat: b }, `${P.name} is the Boss.`);

    // Wildcard: swap Roles once per game (offered at the start of your turn).
    if (P.role === "wildcard" && !P.wildUsed) {
      const targets = this.rivals(b).filter((q) => s.players[q].role);
      const a = yield* this.ask({ kind: "wildcard", seat: b, targets });
      if (a.target !== null) {
        const Q = s.players[a.target];
        [P.role, Q.role] = [Q.role, P.role];
        P.wildUsed = true;
        Q.wildUsed = true; // the Wildcard ability left with the card; it's spent either way
        this.emit({ t: "wildcard", seat: b, target: a.target }, `${P.name} swaps Roles with ${Q.name} and becomes ${roleName(P.role)}.`);
      }
    }

    // 1. REGROUP
    const got = this.drawTo(b, P.hand.length ? 2 : 5);
    this.emit({ t: "draw", seat: b, count: got }, `${P.name} draws ${got}.`);
    const back = Math.min(P.role === "getaway" ? 2 : 1, P.pen);
    if (back) {
      P.pen -= back;
      this.putHome(b, back);
      this.emit({ t: "penReturn", seat: b, count: back }, `${P.name} takes ${back} crew out of the Pen.`);
    }
    if (P.role === "fence" && s.discard.length && this.cash(b) >= 2) {
      const a = yield* this.ask({ kind: "fence", seat: b, cost: 2 });
      if (a.cardId !== null) {
        this.pay(b, 2, null);
        const i = s.discard.findIndex((c) => c.id === a.cardId);
        const [c] = s.discard.splice(i, 1);
        P.hand.push(c);
        this.emit({ t: "fence", seat: b, cardId: c.id }, `${P.name} pays $2 and takes ${cardLabel(c)} from the discard pile.`);
      }
    }
    if (P.hand.length) {
      const a = yield* this.ask({ kind: "bank", seat: b, max: Math.min(BANK_PER_TURN, P.hand.length) });
      if (a.cardIds.length) {
        for (const id of a.cardIds) {
          const i = P.hand.findIndex((c) => c.id === id);
          P.bank.push(P.hand.splice(i, 1)[0]);
        }
        this.emit({ t: "bank", seat: b, cardIds: a.cardIds }, `${P.name} banks ${a.cardIds.length} card${a.cardIds.length > 1 ? "s" : ""}.`);
      }
    }
    const canHire = this.affordableHires(b, Math.min(2, P.reserve + P.pen));
    if (canHire) {
      const a = yield* this.ask({ kind: "hire", seat: b, max: canHire, cost: HIRE_COST });
      for (let i = 0; i < a.count; i++) {
        this.pay(b, HIRE_COST, null);
        if (P.reserve) P.reserve--;
        else P.pen--;
        this.putHome(b, 1);
      }
      if (a.count) this.emit({ t: "hire", seat: b, count: a.count }, `${P.name} hires ${a.count} crew for $${HIRE_COST * a.count}.`);
    }
    if (!this.hasFighter(b)) {
      s.discard.push(...P.hand);
      P.hand = [];
      this.drawTo(b, 5);
      this.emit({ t: "stuck", seat: b }, `${P.name} has no Score or Fixer: new hand of 5, and the turn passes.`);
      return;
    }

    // 2-6. HIT or BUST
    const busts = this.bustOptions(b);
    const a = yield* this.ask({ kind: "action", seat: b, canHit: this.homeCrew(b) > 0, busts, wanted: this.homeCrew(b) > 0 ? this.wantedOptions(b) : [] });
    if (a.choice === "pass") {
      this.emit({ t: "pass", seat: b }, `${P.name} lays low this turn.`);
    } else if (a.choice === "bust") {
      yield* this.bust(b, a.hideout, a.rival);
      if (this.checkWin()) return;
    } else {
      const won = yield* this.hit(b, a.choice === "wanted" ? { mark: a.mark, hideout: a.hideout } : null);
      if (s.winners) return;
      // 7. AGAIN?
      if (won && s.againAllowed && this.homeCrew(b) > 0 && this.hasFighter(b)) {
        const g = yield* this.ask({ kind: "again", seat: b });
        if (g.again) {
          this.emit({ t: "again", seat: b }, `${P.name} goes again.`);
          yield* this.hit(b, null);
          if (s.winners) return;
        }
      }
    }
    s.job = null;
    s.flip = null;
    const over = P.hand.length - HAND_LIMIT;
    if (over > 0) {
      const d = yield* this.ask({ kind: "discard", seat: b, count: over });
      for (const id of d.cardIds) s.discard.push(P.hand.splice(P.hand.findIndex((c) => c.id === id), 1)[0]);
      this.emit({ t: "discard", seat: b, count: over }, `${P.name} discards down to ${HAND_LIMIT}.`);
    }
  }

  private newJob(kind: "hit" | "bust", boss: number, mark: number, hideout: number, wanted: boolean): JobState {
    const n = this.s.n;
    return {
      kind, boss, mark, hideout, wanted,
      side: { B: new Array(n).fill(0), M: new Array(n).fill(0) },
      bets: [],
      bossCard: null,
      markCard: null,
      revealed: false,
      forged: { B: null, M: null },
      backups: { B: 0, M: 0 },
      hackerCall: null,
      bTotal: 0,
      mTotal: 0,
      result: null,
      note: "",
    };
  }

  /** Totals without the showdown cards. */
  bases(j: JobState): { b: number; m: number } {
    return jobBases(this.s, j);
  }

  private cardValue(j: JobState, side: Side) {
    const c = side === "B" ? j.bossCard : j.markCard;
    const f = j.forged[side];
    return f !== null ? f : fightValue(c);
  }

  private totals(j: JobState) {
    const { b, m } = this.bases(j);
    j.bTotal = b + this.cardValue(j, "B");
    j.mTotal = m + this.cardValue(j, "M");
  }

  private *showdownCard(p: number, as: "boss" | "mark" | "bust" | "rival"): Flow<Card | null> {
    const P = this.s.players[p];
    if (!this.hasFighter(p)) {
      this.s.discard.push(...P.hand);
      P.hand = [];
      this.drawTo(p, 5);
      this.emit({ t: "stuck", seat: p }, `${P.name} has no Score or Fixer: discards and draws 5.`);
      if (!this.hasFighter(p)) return null;
    }
    const a = yield* this.ask({ kind: "showdown", seat: p, as });
    const i = P.hand.findIndex((c) => c.id === a.cardId);
    const c = P.hand.splice(i, 1)[0];
    const j = this.s.job!;
    if (as === "boss" || as === "bust") j.bossCard = c;
    else j.markCard = c;
    this.emit({ t: "facedown", seat: p }, `${P.name} lays a card face down.`);
    return c;
  }

  private *hit(b: number, wanted: { mark: number; hideout: number } | null): Flow<boolean> {
    const s = this.s;
    let mark: number;
    let hideout: number;
    s.flip = null;
    if (wanted) {
      ({ mark, hideout } = wanted);
      this.emit({ t: "mark", boss: b, mark, how: "wanted" }, `Wanted! ${this.name(b)} hits ${this.name(mark)}'s hideout to get at the leader.`);
    } else {
      if (this.role(b) === "mastermind") {
        const a = yield* this.ask({ kind: "pickMark", seat: b, rivals: this.rivals(b), why: "mastermind" });
        mark = a.mark;
        this.emit({ t: "mark", boss: b, mark, how: "mastermind" }, `The Mastermind picks ${this.name(mark)} as the Mark.`);
      } else {
        const c = this.draw();
        let owner = c ? this.seatOfColor(c.color) : null;
        if (c) {
          s.deck.unshift(c); // the flipped card goes to the bottom
          s.flip = c;
        }
        if (owner === null || owner === b) {
          this.emit({ t: "flip", seat: b, card: c!, mark: null }, `The flip shows ${owner === b ? "the Boss's own" : "nobody's"} color. ${this.name(b)} picks the Mark.`);
          const a = yield* this.ask({ kind: "pickMark", seat: b, rivals: this.rivals(b), why: "free" });
          owner = a.mark;
          this.emit({ t: "mark", boss: b, mark: owner, how: "pick" }, `${this.name(b)} picks ${this.name(owner)} as the Mark.`);
        } else {
          this.emit({ t: "flip", seat: b, card: c!, mark: owner }, `The flip shows ${this.name(owner)}'s color.`);
          this.emit({ t: "mark", boss: b, mark: owner, how: "flip" }, `${this.name(owner)} is the Mark.`);
        }
        mark = owner;
      }
      const h = yield* this.ask({ kind: "pickHideout", seat: b, mark });
      hideout = h.hideout;
    }
    const j = (s.job = this.newJob("hit", b, mark, hideout, !!wanted));
    this.emit({ t: "target", mark, hideout }, `${this.name(b)} hits ${this.name(mark)}'s hideout ${hideout + 1}.`);

    // 3. CREW UP
    const send = yield* this.ask({ kind: "send", seat: b, max: Math.min(4, this.homeCrew(b)) });
    j.side.B[b] = this.takeHome(b, send.count);
    this.emit({ t: "send", seat: b, side: "B", count: j.side.B[b] }, `${this.name(b)} sends ${j.side.B[b]} crew.`);
    for (let i = 1; i < s.n; i++) {
      const p = (b + i) % s.n;
      if (p === mark) continue;
      const avail = this.homeCrew(p);
      if (!avail) continue;
      const a = yield* this.ask({ kind: "join", seat: p, max: Math.min(4, avail), split: this.role(p) === "inside_man" });
      if (a.B + a.M === 0) {
        this.emit({ t: "pass", seat: p }, `${this.name(p)} stays out.`);
        continue;
      }
      for (const side of ["B", "M"] as Side[]) {
        if (!a[side]) continue;
        j.side[side][p] += this.takeHome(p, a[side]);
        this.emit({ t: "send", seat: p, side, count: a[side] }, `${this.name(p)} joins the ${side === "B" ? "Boss" : "Mark"} with ${a[side]} crew.`);
      }
    }

    // 4. SIDE BETS: Double-Cross, then bets
    for (let i = 0; i < s.n; i++) {
      const p = (b + i) % s.n;
      const X = s.players[p].hand.find((c) => c.kind === "X");
      if (!X) continue;
      const targets = s.players.map((q) => q.seat).filter((q) => q !== b && q !== mark && j.side.B[q] + j.side.M[q] > 0);
      if (!targets.length) break;
      const a = yield* this.ask({ kind: "doubleCross", seat: p, targets });
      if (a.target === null) continue;
      const t = a.target;
      s.players[p].hand.splice(s.players[p].hand.indexOf(X), 1);
      s.discard.push(X);
      [j.side.B[t], j.side.M[t]] = [j.side.M[t], j.side.B[t]];
      const to: Side = j.side.B[t] > 0 ? "B" : "M";
      this.emit({ t: "doubleCross", seat: p, target: t, to }, `Double-Cross! ${this.name(p)} flips ${this.name(t)} to the ${to === "B" ? "Boss" : "Mark"}'s side.`);
    }
    const inJob = (q: number) => q === b || q === mark || j.side.B[q] + j.side.M[q] > 0;
    for (let i = 1; i < s.n; i++) {
      const p = (b + i) % s.n;
      if (inJob(p) || !s.players[p].bank.length) continue;
      const a = yield* this.ask({ kind: "bet", seat: p });
      if (!a.side) continue;
      const P = s.players[p];
      const card = P.bank.splice(P.bank.findIndex((c) => c.id === a.cardId), 1)[0];
      j.bets.push({ seat: p, card, side: a.side });
      this.emit({ t: "bet", seat: p, side: a.side }, `${P.name} bets $${card.cash} on the ${a.side === "B" ? "Boss" : "Mark"}.`);
    }

    // 5. SHOWDOWN
    const numbers = SCORE_MIX.map(([v]) => v);
    for (const p of [b, mark]) {
      if (this.role(p) === "hacker") {
        const a = yield* this.ask({ kind: "hackerCall", seat: p, numbers });
        j.hackerCall = { seat: p, n: a.n };
        this.emit({ t: "hackerCall", seat: p, n: a.n }, `The Hacker calls ${a.n}.`);
      }
    }
    j.bossCard = yield* this.showdownCard(b, "boss");
    j.markCard = yield* this.showdownCard(mark, "mark");
    j.revealed = true;
    this.totals(j);
    this.emit({ t: "reveal", bTotal: j.bTotal, mTotal: j.mTotal }, `Reveal: ${j.bossCard ? cardLabel(j.bossCard) : "nothing"} vs ${j.markCard ? cardLabel(j.markCard) : "nothing"}.`);

    let winner: Side | null = null;
    const bc = j.bossCard, mc = j.markCard;
    if (!bc) winner = "M";
    else if (!mc) winner = "B";
    if (!winner && j.hackerCall) {
      const h = j.hackerCall;
      const opp = h.seat === b ? mc : bc;
      if (opp && opp.kind === "S" && opp.score === h.n) {
        winner = h.seat === b ? "B" : "M";
        j.note = "Hacked";
        this.emit({ t: "hacked", seat: h.seat }, `Hacked! The card shows ${h.n}. ${this.name(h.seat)} wins outright.`);
      }
    }
    if (!winner && bc!.kind === "F" && mc!.kind === "F") {
      yield* this.fixerDeal(j);
      return false;
    }
    if (!winner) {
      if (bc!.kind === "F") winner = "M";
      else if (mc!.kind === "F") winner = "B";
    }
    if (!winner) {
      // 6. PAYOFF: Forger, then Backups, then compare (tie goes to the Mark)
      const discNums = () => [...new Set(s.discard.filter((c) => c.kind === "S").map((c) => c.score))].sort((x, y) => x - y);
      for (const [p, side] of [[b, "B"], [mark, "M"]] as [number, Side][]) {
        const P = s.players[p];
        if (P.role === "forger" && !P.forgeUsed && discNums().length) {
          const a = yield* this.ask({ kind: "forger", seat: p, numbers: discNums() });
          if (a.n !== null) {
            P.forgeUsed = true;
            j.forged[side] = a.n;
            this.totals(j);
            this.emit({ t: "forged", seat: p, n: a.n }, `The Forger changes their card to ${a.n}.`);
          }
        }
      }
      let played = true;
      while (played) {
        played = false;
        for (let i = 0; i < s.n; i++) {
          const p = (b + i) % s.n;
          const P = s.players[p];
          const bk = P.hand.find((c) => c.kind === "B");
          if (!bk) continue;
          const a = yield* this.ask({ kind: "backup", seat: p });
          if (!a.side) continue;
          P.hand.splice(P.hand.indexOf(bk), 1);
          s.discard.push(bk);
          j.backups[a.side] += BACKUP_BONUS;
          this.totals(j);
          this.emit({ t: "backup", seat: p, side: a.side }, `${P.name} plays Backup: +${BACKUP_BONUS} to the ${a.side === "B" ? "Boss" : "Mark"}.`);
          played = true;
        }
      }
      winner = j.bTotal > j.mTotal ? "B" : "M";
    }
    j.result = winner;
    this.emit({ t: "result", winner, bTotal: j.bTotal, mTotal: j.mTotal }, `${winner === "B" ? `The Boss wins, ${j.bTotal} to ${j.mTotal}` : `The Mark holds, ${j.mTotal} to ${j.bTotal}`}.`);
    this.settle(j, winner);
    if (this.checkWin()) return winner === "B";
    s.job = null;
    return winner === "B";
  }

  private discardShowdown(j: JobState) {
    for (const c of [j.bossCard, j.markCard]) if (c) this.s.discard.push(c);
  }

  private settle(j: JobState, win: Side) {
    const s = this.s;
    const { boss, mark } = j;
    const H = s.players[mark].hideouts[j.hideout];
    const lose: Side = win === "B" ? "M" : "B";
    const wasIn = (q: number) => q === boss || q === mark || j.side.B[q] + j.side.M[q] > 0;
    const inJob = s.players.map((p) => wasIn(p.seat));
    const bossSide = [...j.side.B];
    // Double Agent ally on the losing side switches at the reveal: their crew go home.
    for (const p of s.players) {
      if (p.role === "double_agent" && p.seat !== boss && p.seat !== mark && j.side[lose][p.seat] > 0) {
        this.putHome(p.seat, j.side[lose][p.seat]);
        j.side[lose][p.seat] = 0;
      }
    }
    if (win === "B") {
      for (const p of s.players) {
        const k = j.side.B[p.seat];
        if (!k) continue;
        j.side.B[p.seat] = 0;
        if (H[p.seat] === 0) {
          H[p.seat] = 1;
          this.putHome(p.seat, k - 1);
          this.emit({ t: "foothold", seat: p.seat, owner: mark, hideout: j.hideout }, `${p.name} leaves 1 crew behind: a Foothold.`);
        } else this.putHome(p.seat, k);
      }
      const markThere = H[mark];
      H[mark] = 0;
      this.toPen(mark, markThere);
      for (const p of s.players) {
        const k = j.side.M[p.seat];
        j.side.M[p.seat] = 0;
        this.toPen(p.seat, k);
      }
      for (const p of s.players) {
        if (p.seat !== mark && !bossSide[p.seat] && H[p.seat] > 0) {
          const k = H[p.seat];
          H[p.seat] = 0;
          this.toPen(p.seat, k);
        }
      }
      const safe = this.role(boss) === "safecracker";
      const paid = this.pay(mark, safe ? 2 * LOOT : LOOT, boss);
      this.emit({ t: "loot", from: mark, to: boss, amount: paid }, paid ? `${this.name(mark)} pays $${paid} loot.` : `${this.name(mark)} has no cash to pay loot.`);
      if (paid) for (const p of s.players) if (p.role === "pickpocket") this.bankTop(p.seat, "the Pickpocket skims the loot");
      if (safe) {
        const others = s.players[mark].hideouts.filter((h, i) => i !== j.hideout && h[mark] > 0);
        if (others.length) {
          const h = others.reduce((m, x) => (x[mark] > m[mark] ? x : m));
          const k = Math.min(2, h[mark]);
          h[mark] -= k;
          this.toPen(mark, k);
        }
      }
    } else {
      for (const p of s.players) {
        const k = j.side.B[p.seat];
        j.side.B[p.seat] = 0;
        this.toPen(p.seat, k);
      }
      for (const p of s.players) {
        const k = j.side.M[p.seat];
        if (!k) continue;
        j.side.M[p.seat] = 0;
        this.putHome(p.seat, k);
        if (p.seat !== mark) this.bankTop(p.seat, "their Cut for defending");
      }
    }
    const bookie = s.players.find((p) => p.role === "bookie");
    for (const bet of j.bets) {
      const P = s.players[bet.seat];
      if (bet.side === win) {
        P.bank.push(bet.card);
        this.emit({ t: "betPaid", seat: bet.seat, won: true }, `${P.name} wins the bet.`);
        this.bankTop(bet.seat, "a winning bet");
      } else {
        if (bookie && bookie.seat !== bet.seat) bookie.bank.push(bet.card);
        else s.discard.push(bet.card);
        this.emit({ t: "betPaid", seat: bet.seat, won: false }, `${P.name} loses the bet${bookie && bookie.seat !== bet.seat ? ` to the Bookie` : ""}.`);
      }
    }
    if (bookie && !inJob[bookie.seat]) this.bankTop(bookie.seat, "the house always gets paid");
    this.discardShowdown(j);
  }

  private *fixerDeal(j: JobState): Flow {
    const s = this.s;
    const { boss, mark } = j;
    const H = s.players[mark].hideouts[j.hideout];
    const inJob = s.players.map((p) => p.seat === boss || p.seat === mark || j.side.B[p.seat] + j.side.M[p.seat] > 0);
    this.emit({ t: "fixerFixer" }, "Fixer vs. Fixer: time to make a deal.");
    const o = yield* this.ask({ kind: "dealOffer", seat: boss });
    let accepted = false;
    if (o.offer) {
      const a = yield* this.ask({ kind: "dealAccept", seat: mark, offer: o.offer });
      accepted = a.accept;
      this.emit({ t: "deal", offer: o.offer, accepted }, accepted ? `${this.name(mark)} takes the deal.` : `${this.name(mark)} turns the deal down.`);
    }
    j.result = accepted ? "deal" : "nodeal";
    // allies go home and bets come back either way
    for (const p of s.players) {
      if (p.seat === boss) continue;
      const k = j.side.B[p.seat] + j.side.M[p.seat];
      j.side.B[p.seat] = j.side.M[p.seat] = 0;
      if (k) this.putHome(p.seat, k);
    }
    for (const bet of j.bets) s.players[bet.seat].bank.push(bet.card);
    const sent = j.side.B[boss];
    j.side.B[boss] = 0;
    if (accepted && o.offer === "foothold") {
      const stay = H[boss] === 0 ? 1 : 0;
      H[boss] += stay;
      this.putHome(boss, sent - stay);
      const paid = this.pay(boss, LOOT, mark);
      if (stay) this.emit({ t: "foothold", seat: boss, owner: mark, hideout: j.hideout }, `${this.name(boss)} pays $${paid} to leave 1 crew behind.`);
    } else if (accepted) {
      this.putHome(boss, sent);
    } else {
      const lb = Math.min(2, sent);
      this.putHome(boss, sent - lb);
      this.toPen(boss, lb);
      const lm = Math.min(2, H[mark]);
      H[mark] -= lm;
      this.toPen(mark, lm);
    }
    const bookie = s.players.find((p) => p.role === "bookie");
    if (bookie && !inJob[bookie.seat]) this.bankTop(bookie.seat, "the house always gets paid");
    this.discardShowdown(j);
    this.checkWin();
  }

  private *bust(b: number, hideout: number, rival: number): Flow {
    const s = this.s;
    const H = s.players[b].hideouts[hideout];
    const j = (s.job = this.newJob("bust", b, rival, hideout, false));
    this.emit({ t: "bust", seat: b, rival, hideout }, `${this.name(b)} busts ${this.name(rival)}'s crew out of hideout ${hideout + 1}.`);
    j.bossCard = yield* this.showdownCard(b, "bust");
    j.markCard = yield* this.showdownCard(rival, "rival");
    j.revealed = true;
    j.bTotal = H[b] + fightValue(j.bossCard);
    j.mTotal = H[rival] + fightValue(j.markCard);
    this.emit({ t: "reveal", bTotal: j.bTotal, mTotal: j.mTotal }, `Bust: ${j.bTotal} vs ${j.mTotal} (a Fixer counts as 0, tie goes to ${this.name(b)}).`);
    const win = j.bTotal >= j.mTotal;
    j.result = win ? "B" : "M";
    if (win) {
      const k = H[rival];
      H[rival] = 0;
      this.toPen(rival, k);
    } else {
      const k = H[b];
      H[b] = 0;
      this.toPen(b, k);
    }
    this.emit({ t: "bustResult", winner: win ? b : rival, loser: win ? rival : b }, win ? `${this.name(b)} clears them out.` : `${this.name(rival)} holds on.`);
    this.discardShowdown(j);
  }

  // ------------------------------------------------------------------ validation
  validate(p: Ask, a: Answer): string | null {
    const s = this.s;
    const P = s.players[p.seat];
    const inHand = (id: number) => P.hand.some((c) => c.id === id);
    const distinct = (ids: number[]) => new Set(ids).size === ids.length;
    switch (p.kind) {
      case "keepRole":
        return p.options.includes((a as AnswerOf<"keepRole">).role) ? null : "Pick one of your two Roles";
      case "wildcard": {
        const t = (a as AnswerOf<"wildcard">).target;
        return t === null || p.targets.includes(t) ? null : "Not a valid player";
      }
      case "fence": {
        const id = (a as AnswerOf<"fence">).cardId;
        return id === null || s.discard.some((c) => c.id === id) ? null : "That card isn't in the discard pile";
      }
      case "bank": {
        const ids = (a as AnswerOf<"bank">).cardIds;
        return ids.length <= p.max && distinct(ids) && ids.every(inHand) ? null : `Bank up to ${p.max} cards from your hand`;
      }
      case "hire": {
        const k = (a as AnswerOf<"hire">).count;
        return Number.isInteger(k) && k >= 0 && k <= p.max ? null : `Hire 0 to ${p.max}`;
      }
      case "action": {
        const x = a as AnswerOf<"action">;
        if (x.choice === "pass") return null;
        if (x.choice === "hit") return p.canHit ? null : "You have no crew at home";
        if (x.choice === "bust") return p.busts.some((o) => o.hideout === x.hideout && o.rival === x.rival) ? null : "No rival crew there";
        return p.wanted.some((o) => o.mark === x.mark && o.hideout === x.hideout) ? null : "Not a Wanted target";
      }
      case "pickMark":
        return p.rivals.includes((a as AnswerOf<"pickMark">).mark) ? null : "Pick a rival";
      case "pickHideout": {
        const h = (a as AnswerOf<"pickHideout">).hideout;
        return Number.isInteger(h) && h >= 0 && h < HIDEOUTS ? null : "Pick a hideout";
      }
      case "send": {
        const k = (a as AnswerOf<"send">).count;
        return Number.isInteger(k) && k >= 1 && k <= p.max ? null : `Send 1 to ${p.max}`;
      }
      case "join": {
        const x = a as AnswerOf<"join">;
        if (!(Number.isInteger(x.B) && Number.isInteger(x.M) && x.B >= 0 && x.M >= 0)) return "Bad crew count";
        if (x.B + x.M > p.max) return `Send at most ${p.max}`;
        if (!p.split && x.B && x.M) return "Only the Inside Man joins both sides";
        return null;
      }
      case "doubleCross": {
        const t = (a as AnswerOf<"doubleCross">).target;
        return t === null || p.targets.includes(t) ? null : "Not an ally in this job";
      }
      case "bet": {
        const x = a as AnswerOf<"bet">;
        if (!x.side) return null;
        return P.bank.some((c) => c.id === x.cardId) ? null : "Bet one of your banked cards";
      }
      case "hackerCall":
        return p.numbers.includes((a as AnswerOf<"hackerCall">).n) ? null : "Call a Score number";
      case "showdown": {
        const id = (a as AnswerOf<"showdown">).cardId;
        return P.hand.some((c) => c.id === id && isFighter(c)) ? null : "Play a Score or Fixer";
      }
      case "forger": {
        const k = (a as AnswerOf<"forger">).n;
        return k === null || p.numbers.includes(k) ? null : "Pick a number from the discard pile";
      }
      case "backup":
        return null;
      case "dealOffer":
      case "dealAccept":
      case "again":
        return null;
      case "discard": {
        const ids = (a as AnswerOf<"discard">).cardIds;
        return ids.length === p.count && distinct(ids) && ids.every(inHand) ? null : `Discard exactly ${p.count}`;
      }
    }
  }

  // ------------------------------------------------------------------ views
  /** What one seat may see right now (see viewFor). */
  viewFor(seat: number): GameState {
    return viewFor(this.s, seat);
  }
}

/** Boss and Mark totals for a job before the showdown cards (crew, home turf, Role bonuses, Backups). */
export function jobBases(s: GameState, j: JobState): { b: number; m: number } {
  const role = (p: number) => s.players[p].role;
  const H = s.players[j.mark].hideouts[j.hideout];
  let b = j.side.B.reduce((x, y) => x + y, 0) + j.backups.B;
  let m = H[j.mark] + j.side.M.reduce((x, y) => x + y, 0) + j.backups.M;
  m += role(j.boss) === "mastermind" ? 2 : HOME_TURF;
  if (role(j.boss) === "muscle") b += 1;
  if (role(j.mark) === "muscle") m += 1;
  if (role(j.mark) === "lookout") m += 4;
  return { b, m };
}

const HIDDEN: Omit<Card, "id"> = { kind: "S", score: 0, cash: 0, color: -1 };

/** What one seat may see: other hands, unrevealed showdown cards and the deck order are hidden.
 * Hidden cards get ids that say nothing about which card they are. Pass seat = -1 for a spectator. */
export function viewFor(st: GameState, seat: number): GameState {
  const v = snapshot(st);
  v.deck = [];
  for (const p of v.players) {
    if (p.seat !== seat) p.hand = p.hand.map((_, i) => ({ ...HIDDEN, id: -1000 - p.seat * 100 - i }));
  }
  const j = v.job;
  if (j && !j.revealed) {
    if (j.boss !== seat && j.bossCard) j.bossCard = { ...HIDDEN, id: -1 };
    if (j.mark !== seat && j.markCard) j.markCard = { ...HIDDEN, id: -2 };
  }
  return v;
}
