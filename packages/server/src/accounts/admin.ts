// The owner's admin panel: its own sign-in (ADMIN_USER / ADMIN_PASSWORD, separate from any player
// account) and read-only views of every account, the activity log, live tables and any game move by move.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HeistGame, type Answer } from "@heist/engine";
import { createSoloGame, levelInfo, upgrade, SOLO_SEAT } from "@heist/profile";
import type { RoomInfo } from "../protocol";
import { sanitizeAnswer } from "../sanitize";
import type { GameRecord } from "../store";
import type { ActivityEvent, ActivityLog } from "./activity";
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

  private row(a: Account): AccountRow {
    const p = upgrade(a.progress);
    return {
      id: a.id, name: a.name, email: a.email ?? null, guest: a.guest, providers: a.logins.map((l) => l.provider), createdAt: a.createdAt,
      lastSeen: this.log.lastSeen(a.id) ?? null, level: levelInfo(p.xp).level, prestige: p.prestige, chips: p.chips, coins: p.coins,
      games: p.stats.games, wins: p.stats.wins, winnings: p.stats.winnings, rating: Math.round(p.rating),
    };
  }

  async overview() {
    const now = this.now;
    const all = (await this.accounts.store.all()).filter((a) => a.name !== "Deleted player" || a.logins.length);
    const registered = all.filter((a) => !a.guest);
    const days = Array.from({ length: 30 }, (_, i) => dayKey(now - (29 - i) * DAY));
    const perDay = () => Object.fromEntries(days.map((d) => [d, 0])) as Record<string, number>;
    const signups = perDay();
    const guests = perDay();
    for (const a of all) {
      const d = dayKey(a.createdAt);
      if (d in signups) (a.guest ? guests : signups)[d]++;
    }
    const games = perDay();
    const active = new Map<string, Set<string>>(days.map((d) => [d, new Set()]));
    const kinds = new Map<string, number>();
    for (const e of this.log.window()) {
      if (e.at < now - 30 * DAY) continue;
      const d = dayKey(e.at);
      if (e.kind === "game.solo" || e.kind === "game.online") games[d] = (games[d] ?? 0) + 1;
      if (e.userId) active.get(d)?.add(e.userId);
      if (e.at >= now - DAY) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    }
    let a1 = 0, a7 = 0, a30 = 0;
    for (const t of this.log.seen().values()) {
      if (t >= now - DAY) a1++;
      if (t >= now - 7 * DAY) a7++;
      if (t >= now - 30 * DAY) a30++;
    }
    const sum = (f: (a: Account) => number) => registered.reduce((s, a) => s + f(a), 0);
    return {
      at: now,
      accounts: { total: all.length, registered: registered.length, guests: all.length - registered.length },
      active: { day: a1, week: a7, month: a30 },
      economy: {
        chips: sum((a) => a.progress.chips), coins: sum((a) => a.progress.coins), packsBought: sum((a) => a.progress.packsBought ?? 0),
        gamesPlayed: sum((a) => a.progress.stats.games), drinksSent: sum((a) => a.progress.drinksSent ?? 0),
      },
      daily: days.map((d) => ({ day: d, signups: signups[d], guests: guests[d], games: games[d], active: active.get(d)!.size })),
      today: [...kinds].sort((x, y) => y[1] - x[1]).map(([kind, count]) => ({ kind, count })),
      newest: [...registered].sort((x, y) => y.createdAt - x.createdAt).slice(0, 8).map((a) => this.row(a)),
      live: this.o.live?.() ?? null,
    };
  }

  async list(q: URLSearchParams) {
    const text = (q.get("q") ?? "").trim().toLowerCase();
    const show = q.get("show");
    const sort = q.get("sort") ?? "seen";
    let rows = (await this.accounts.store.all()).map((a) => this.row(a));
    if (show === "registered") rows = rows.filter((r) => !r.guest);
    if (show === "guests") rows = rows.filter((r) => r.guest);
    if (text) rows = rows.filter((r) => r.name.toLowerCase().includes(text) || (r.email ?? "").includes(text) || r.id.toLowerCase() === text);
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
    return { row: this.row(a), account: { ...rest, hasPassword: !!password, progress: upgrade(a.progress) }, counts };
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
