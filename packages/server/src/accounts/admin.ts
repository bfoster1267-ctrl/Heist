// The owner's admin panel: its own sign-in (ADMIN_USER / ADMIN_PASSWORD, separate from any player
// account) and read-only views of every account, the activity log, live tables and any game move by move.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HeistGame, type Answer } from "@heist/engine";
import { createSoloGame, levelInfo, upgrade, SOLO_SEAT } from "@heist/profile";
import type { RoomInfo } from "../protocol";
import { sanitizeAnswer } from "../sanitize";
import type { GameRecord } from "../store";
import { byOwner, type ActivityEvent, type ActivityLog } from "./activity";
import type { AccountService } from "./service";
import type { Account } from "./store";

const SESSION_MS = 8 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

export class AdminAuth {
  private key: Buffer;

  constructor(
    private user: string,
    private password: string,
    secret: string | undefined,
    private now: () => number = Date.now,
  ) {
    // changing the admin password signs every admin session out
    this.key = createHmac("sha256", secret ?? randomBytes(32).toString("hex")).update(`admin:${user}:${password}`).digest();
  }

  /** A session token for the right username and password, else null. */
  login(user: unknown, password: unknown): { token: string; expires: number } | null {
    if (typeof user !== "string" || typeof password !== "string") return null;
    const okUser = timingSafeEqual(digest(user.trim().toLowerCase()), digest(this.user.toLowerCase()));
    const okPass = timingSafeEqual(digest(password), digest(this.password));
    if (!okUser || !okPass) return null;
    const expires = this.now() + SESSION_MS;
    return { token: `${expires}.${this.sign(expires)}`, expires };
  }

  check(token: unknown): boolean {
    if (typeof token !== "string") return false;
    const [exp, sig] = token.split(".");
    const expires = Number(exp);
    if (!sig || !Number.isFinite(expires) || expires < this.now()) return false;
    const want = Buffer.from(this.sign(expires));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private sign(expires: number) {
    return createHmac("sha256", this.key).update(String(expires)).digest("base64url");
  }
}

export interface LiveInfo {
  sockets: number;
  queued: number;
  rssMb: number;
  uptimeS: number;
  rooms: RoomInfo[];
}

export interface AccountRow {
  id: string;
  name: string;
  email: string | null;
  guest: boolean;
  providers: string[];
  createdAt: number;
  lastSeen: number | null;
  level: number;
  prestige: number;
  chips: number;
  coins: number;
  games: number;
  wins: number;
  winnings: number;
  rating: number;
  tags: string[];
  flagged: boolean;
  banned: boolean;
  notes: number;
  /** which person this account belongs to (accounts on the same device, or a guest on the same address) */
  person: string;
  /** how many accounts that person has */
  personAccounts: number;
  /** the owner's own accounts (seen on the device or address the admin panel signs in from) */
  you: boolean;
}

/** Accounts grouped into people. */
export interface People {
  /** account id -> person id */
  of: Map<string, string>;
  /** person id -> account ids */
  members: Map<string, string[]>;
  /** people who are the owner */
  owner: Set<string>;
  /** accounts with no device or address on record (made before the activity log, or never did anything) */
  untracked: Set<string>;
}

export type Moment =
  | { t: "say"; msg: string }
  | { t: "move"; n: number; seat: number; name: string; by: "player" | "bot" | "autopilot"; ask: string; answer: Answer };

export interface GameView {
  gameId: string;
  mode: "online" | "solo";
  seats: { name: string; bot: boolean; userId: string | null }[];
  stakes: number;
  startedAt: number;
  endedAt: number | null;
  winners: number[];
  code?: string;
  quit?: boolean;
  moments: Moment[];
  /** the replay stopped early (a log written by an older build) */
  broken?: string;
}

const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

export class AdminService {
  constructor(
    private accounts: AccountService,
    private log: ActivityLog,
    private o: { now?: () => number; live?: () => LiveInfo; game?: (id: string) => GameRecord | undefined } = {},
  ) {}

  private get now() {
    return (this.o.now ?? Date.now)();
  }

  private cache: { at: number; people: People } | null = null;

  /**
   * Group accounts into people. Two accounts are one person when the same app install used both, or when a
   * guest shares an address with another account (guests pile up when someone plays in a new browser or
   * clears it). Two signed-up accounts on one address stay two people: a household or a phone carrier can
   * share an address. Accounts seen where the admin panel signs in are the owner's.
   */
  people(all: Account[]): People {
    if (this.cache && this.now - this.cache.at < 30_000 && this.cache.people.of.size === all.length) return this.cache.people;
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r) ?? (parent.set(r, r), r);
      parent.set(x, r);
      return r;
    };
    const join = (a: string, b: string) => {
      const [x, y] = [find(a), find(b)];
      if (x !== y) parent.set(y, x);
    };
    const guest = new Map(all.map((a) => [a.id, a.guest]));
    for (const a of all) parent.set(a.id, a.id);
    const ipUsers = new Map<string, Set<string>>();
    const tracked = new Set<string>();
    const ownerIps = new Set<string>();
    const ownerDevices = new Set<string>();
    for (const e of this.log.window()) {
      if (e.kind === "admin.login" && e.ok) {
        if (e.ip) ownerIps.add(e.ip);
        if (e.device) ownerDevices.add(e.device);
        continue;
      }
      if (byOwner(e) || !e.userId || !guest.has(e.userId)) continue;
      tracked.add(e.userId);
      if (e.device) {
        if (!parent.has(`d:${e.device}`)) parent.set(`d:${e.device}`, `d:${e.device}`);
        join(`d:${e.device}`, e.userId);
      }
      if (e.ip) {
        let s = ipUsers.get(e.ip);
        if (!s) ipUsers.set(e.ip, (s = new Set()));
        s.add(e.userId);
      }
    }
    for (const users of ipUsers.values()) {
      const ids = [...users];
      const anchor = ids.find((id) => !guest.get(id)) ?? ids[0];
      for (const id of ids) if (guest.get(id)) join(anchor, id);
    }
    const of = new Map<string, string>();
    const members = new Map<string, string[]>();
    for (const a of all) {
      const p = find(a.id);
      of.set(a.id, p);
      members.set(p, [...(members.get(p) ?? []), a.id]);
    }
    const owner = new Set<string>();
    for (const d of ownerDevices) if (parent.has(`d:${d}`)) owner.add(find(`d:${d}`));
    for (const ip of ownerIps) for (const id of ipUsers.get(ip) ?? []) owner.add(find(id));
    const untracked = new Set(all.filter((a) => !tracked.has(a.id)).map((a) => a.id));
    const people = { of, members, owner, untracked };
    this.cache = { at: this.now, people };
    return people;
  }

  private row(a: Account, ppl?: People): AccountRow {
    const p = upgrade(a.progress);
    const person = ppl?.of.get(a.id) ?? a.id;
    return {
      id: a.id, name: a.name, email: a.email ?? null, guest: a.guest, providers: a.logins.map((l) => l.provider), createdAt: a.createdAt,
      lastSeen: this.log.lastSeen(a.id) ?? null, level: levelInfo(p.xp).level, prestige: p.prestige, chips: p.chips, coins: p.coins,
      games: p.stats.games, wins: p.stats.wins, winnings: p.stats.winnings, rating: Math.round(p.rating),
      tags: a.crm?.tags ?? [], flagged: !!a.crm?.flag, banned: !!this.accounts.banOf(a), notes: a.crm?.notes.length ?? 0,
      person, personAccounts: ppl?.members.get(person)?.length ?? 1, you: !!ppl?.owner.has(person),
    };
  }

  async overview() {
    const now = this.now;
    const all = (await this.accounts.store.all()).filter((a) => a.name !== "Deleted player" || a.logins.length);
    const ppl = this.people(all);
    const mine = (id: string) => ppl.owner.has(ppl.of.get(id) ?? id);
    const registered = all.filter((a) => !a.guest);
    const days = Array.from({ length: 30 }, (_, i) => dayKey(now - (29 - i) * DAY));
    const perDay = () => Object.fromEntries(days.map((d) => [d, 0])) as Record<string, number>;
    const signups = perDay();
    const newPeople = perDay();
    for (const a of registered) {
      const d = dayKey(a.createdAt);
      if (d in signups && !mine(a.id)) signups[d]++;
    }
    // a person counts from their first account; people we can't tell apart (no record) and you are left out
    let people = 0;
    for (const [p, ids] of ppl.members) {
      if (ppl.owner.has(p) || ids.every((id) => ppl.untracked.has(id))) continue;
      people++;
      const first = Math.min(...ids.map((id) => all.find((a) => a.id === id)?.createdAt ?? now));
      if (dayKey(first) in newPeople) newPeople[dayKey(first)]++;
    }
    const games = perDay();
    const active = new Map<string, Set<string>>(days.map((d) => [d, new Set()]));
    const kinds = new Map<string, number>();
    for (const e of this.log.window()) {
      if (e.at < now - 30 * DAY) continue;
      const d = dayKey(e.at);
      const you = !!e.userId && mine(e.userId);
      if ((e.kind === "game.solo" || e.kind === "game.online") && !you) games[d] = (games[d] ?? 0) + 1;
      if (e.userId && !byOwner(e) && !you) active.get(d)?.add(ppl.of.get(e.userId) ?? e.userId);
      if (e.at >= now - DAY) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    }
    const seenBy = (since: number) => {
      const s = new Set<string>();
      for (const [id, t] of this.log.seen()) if (t >= since && !mine(id)) s.add(ppl.of.get(id) ?? id);
      return s.size;
    };
    const others = registered.filter((a) => !mine(a.id));
    const sum = (f: (a: Account) => number) => others.reduce((s, a) => s + f(a), 0);
    const guests = all.filter((a) => a.guest);
    return {
      at: now,
      accounts: {
        total: all.length, registered: registered.length, guests: guests.length,
        people, signedUp: others.length,
        untrackedGuests: guests.filter((a) => ppl.untracked.has(a.id)).length,
        emptyGuests: guests.filter((a) => a.progress.stats.games === 0).length,
        yours: all.filter((a) => mine(a.id)).length,
      },
      active: { day: seenBy(now - DAY), week: seenBy(now - 7 * DAY), month: seenBy(now - 30 * DAY) },
      economy: {
        chips: sum((a) => a.progress.chips), coins: sum((a) => a.progress.coins), packsBought: sum((a) => a.progress.packsBought ?? 0),
        gamesPlayed: sum((a) => a.progress.stats.games), drinksSent: sum((a) => a.progress.drinksSent ?? 0),
      },
      daily: days.map((d) => ({ day: d, signups: signups[d], people: newPeople[d], games: games[d], active: active.get(d)!.size })),
      today: [...kinds].sort((x, y) => y[1] - x[1]).map(([kind, count]) => ({ kind, count })),
      newest: [...others].sort((x, y) => y.createdAt - x.createdAt).slice(0, 8).map((a) => this.row(a, ppl)),
      live: this.o.live?.() ?? null,
    };
  }

  async list(q: URLSearchParams) {
    const text = (q.get("q") ?? "").trim().toLowerCase();
    const show = q.get("show");
    const sort = q.get("sort") ?? "seen";
    const all = await this.accounts.store.all();
    const ppl = this.people(all);
    let rows = all.map((a) => this.row(a, ppl));
    if (q.get("mine") !== "1") rows = rows.filter((r) => !r.you);
    if (show === "people") {
      // one row per person: their signed-up account with the most games, else their newest
      const best = new Map<string, AccountRow>();
      const rank = (r: AccountRow) => (r.guest ? 0 : 1e12) + r.games * 1e6 + r.createdAt / 1e7;
      for (const r of rows) if (!best.has(r.person) || rank(r) > rank(best.get(r.person)!)) best.set(r.person, r);
      rows = [...best.values()].filter((r) => !(r.guest && r.games === 0 && r.personAccounts === 1 && ppl.untracked.has(r.id)));
    }
    if (show === "registered") rows = rows.filter((r) => !r.guest);
    if (show === "guests") rows = rows.filter((r) => r.guest);
    if (show === "flagged") rows = rows.filter((r) => r.flagged);
    if (show === "banned") rows = rows.filter((r) => r.banned);
    const tag = (q.get("tag") ?? "").trim().toLowerCase();
    if (tag) rows = rows.filter((r) => r.tags.some((t) => t.toLowerCase() === tag));
    if (text) rows = rows.filter((r) => r.name.toLowerCase().includes(text) || (r.email ?? "").includes(text) || r.id.toLowerCase() === text || r.tags.some((t) => t.toLowerCase() === text));
    const by: Record<string, (r: AccountRow) => number> = {
      seen: (r) => r.lastSeen ?? r.createdAt, new: (r) => r.createdAt, games: (r) => r.games, chips: (r) => r.chips, level: (r) => r.prestige * 1e6 + r.level,
      winnings: (r) => r.winnings, rating: (r) => r.rating,
    };
    const key = by[sort] ?? by.seen;
    rows.sort((a, b) => key(b) - key(a));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    return { total: rows.length, rows: rows.slice(offset, offset + 100) };
  }

  async account(id: string) {
    const a = await this.accounts.store.get(id);
    if (!a) return null;
    const counts: Record<string, number> = {};
    for (const e of this.log.window()) if (e.userId === id) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    const { password, ...rest } = a;
    // the addresses they've played from, newest first (for spotting second accounts)
    const ips = new Map<string, number>();
    for (const e of this.log.window()) if (e.userId === id && e.ip && !byOwner(e)) ips.set(e.ip, e.at);
    const crm = a.crm ?? { notes: [], tags: [], flag: null, ban: null };
    const all = await this.accounts.store.all();
    const ppl = this.people(all);
    const person = ppl.of.get(id) ?? id;
    const samePerson = (ppl.members.get(person) ?? [])
      .filter((x) => x !== id)
      .map((x) => all.find((b) => b.id === x)!)
      .filter(Boolean)
      .sort((x, y) => y.createdAt - x.createdAt)
      .slice(0, 50)
      .map((b) => ({ id: b.id, name: b.name, guest: b.guest, games: b.progress.stats.games, createdAt: b.createdAt }));
    const sameIp = new Map<string, { id: string; name: string }>();
    for (const e of this.log.window()) if (e.ip && e.userId && e.userId !== id && !byOwner(e) && ips.has(e.ip)) sameIp.set(e.userId, { id: e.userId, name: e.name ?? e.userId });
    return {
      row: this.row(a, ppl), samePerson, account: { ...rest, crm, hasPassword: !!password, progress: upgrade(a.progress) }, counts,
      ips: [...ips].sort((x, y) => y[1] - x[1]).map(([ip, at]) => ({ ip, at })), sameIp: [...sameIp.values()].slice(0, 20),
      tagsInUse: await this.tags(),
    };
  }

  /** Every tag on any account, most used first. */
  async tags() {
    const n = new Map<string, number>();
    for (const a of await this.accounts.store.all()) for (const t of a.crm?.tags ?? []) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n].sort((x, y) => y[1] - x[1]).map(([tag, count]) => ({ tag, count }));
  }

  activity(q: URLSearchParams): { events: ActivityEvent[] } {
    const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
    const kinds = (q.get("kinds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return {
      events: this.log.query({
        userId: q.get("user") || undefined, kinds, text: q.get("text") ?? undefined, from: num("from"), to: num("to"), before: num("before"), limit: num("limit") ?? 150,
      }),
    };
  }

  game(id: string): GameView | null {
    const rec = this.o.game?.(id);
    if (rec) return replayOnline(rec);
    const solo = this.log.solo(id);
    return solo ? replaySoloGame(solo) : null;
  }
}

function replayOnline(rec: GameRecord): GameView {
  const s = rec.start;
  const g = new HeistGame({ seed: s.seed, rules: s.rules, snapshots: false, seats: s.seats.map((x) => ({ name: x.name, bot: x.bot })) });
  const moments: Moment[] = [];
  const say = () => moments.push(...g.drainFrames().map((f): Moment => ({ t: "say", msg: f.msg })));
  say();
  let broken: string | undefined;
  rec.answers.forEach((r, n) => {
    if (broken) return;
    const ask = g.pending;
    moments.push({ t: "move", n: n + 1, seat: r.seat, name: s.seats[r.seat]?.name ?? `Seat ${r.seat + 1}`, by: r.by, ask: ask?.kind ?? "?", answer: r.a });
    try {
      g.answer(r.seat, r.a);
    } catch (e) {
      broken = String(e);
    }
    say();
  });
  return {
    gameId: s.gameId, mode: "online", code: s.code, seats: s.seats, stakes: s.stakes, startedAt: s.at, endedAt: rec.end?.at ?? null, winners: rec.end?.winners ?? [], moments, broken,
  };
}

function replaySoloGame(r: import("./activity").SoloRecord): GameView {
  const { game, bots } = createSoloGame(r.seed, r.players, r.name, false, r.setup);
  const names = game.s.players.map((p) => p.name);
  const moments: Moment[] = [];
  const say = () => moments.push(...game.drainFrames().map((f): Moment => ({ t: "say", msg: f.msg })));
  say();
  let i = 0;
  let n = 0;
  let broken: string | undefined;
  for (let guard = 0; guard < 100_000; guard++) {
    const p = game.pending;
    if (!p) break;
    let a: Answer | null;
    if (p.seat === SOLO_SEAT) {
      if (i >= r.answers.length) break; // quit here
      a = sanitizeAnswer(p, r.answers[i++]);
      if (!a) {
        broken = "bad answer";
        break;
      }
    } else a = bots.get(p.seat)!.answer(game, p);
    moments.push({ t: "move", n: ++n, seat: p.seat, name: names[p.seat], by: p.seat === SOLO_SEAT ? "player" : "bot", ask: p.kind, answer: a });
    game.answer(p.seat, a);
    say();
  }
  return {
    gameId: r.gameId, mode: "solo", stakes: r.stakes, startedAt: r.startedAt, endedAt: r.endedAt, winners: r.winners, quit: r.quit, moments, broken,
    seats: names.map((name, s) => ({ name, bot: s !== SOLO_SEAT, userId: s === SOLO_SEAT ? r.userId : null })),
  };
}
