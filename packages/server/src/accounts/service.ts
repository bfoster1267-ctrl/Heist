// Accounts: signing in, profiles, and every change to a player's progression. All the rules about XP,
// coins, prestige and cosmetics live in @heist/profile; this applies them to stored accounts, one change
// at a time per account so a game ending and a shop purchase can't overwrite each other.

import { randomBytes, randomInt } from "node:crypto";
import {
  badgeOf, buy, buyIn, daily, equip, failed, levelInfo, newProgress, payForDrink, payout, prestige, publicProfile, refill,
  replaySolo, settle, summarize, upgrade, drink as drinkInfo, type Badge, type Fail, type Progress, type PublicProfile, type Reward,
} from "@heist/profile";
import type { GameEvent } from "@heist/engine";
import { cleanName, type Identity, type IdentityProvider } from "../identity";
import { sanitizeAnswer } from "../sanitize";
import { OAuth, OAuthError, type OAuthConfig } from "./oauth";
import { MemoryAccountStore, type Account, type AccountStore, type Login, type Provider } from "./store";
import { Tokens, checkPassword, hashPassword } from "./tokens";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** What the signed-in player sees about themselves. */
export interface Me {
  id: string;
  name: string;
  guest: boolean;
  email: string | null;
  logins: Provider[];
  progress: Progress;
  profile: PublicProfile;
}

export interface OnlineResult {
  stakes: number;
  players: number;
  seats: { seat: number; userId: string | null; bot: boolean }[];
  winners: number[];
  events: GameEvent[];
}

export interface AccountOptions {
  store?: AccountStore;
  /** signs session tokens; set TOKEN_SECRET in production so sessions survive restarts */
  secret?: string;
  oauth?: OAuthConfig;
  /** test sign-in by name only, no password; never turn on in production */
  devLogins?: boolean;
  now?: () => number;
  /** swap for tests (real provider checks need the network) */
  verifier?: OAuth;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const SOLO_PLAYERS = [3, 4, 5, 6];
const MAX_STAKES = 1_000_000;

export class AccountService {
  readonly store: AccountStore;
  readonly oauth: OAuth;
  readonly devLogins: boolean;
  private tokens: Tokens;
  private now: () => number;
  private locks = new Map<string, Promise<unknown>>();
  private badges = new Map<string, Badge>();
  private board: { at: number; by: string; rows: LeaderRow[] } | null = null;

  constructor(o: AccountOptions = {}) {
    this.store = o.store ?? new MemoryAccountStore();
    this.tokens = new Tokens(o.secret);
    this.oauth = o.verifier ?? new OAuth(o.oauth ?? {});
    this.devLogins = o.devLogins === true;
    this.now = o.now ?? Date.now;
  }

  // ------------------------------------------------------------------ helpers

  /** Run changes to one account in order. */
  private async update<T>(id: string, fn: (a: Account) => Promise<T> | T): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const a = await this.store.get(id);
      if (!a) throw new ApiError(404, "No such account");
      a.progress = upgrade(a.progress);
      const out = await fn(a);
      await this.store.put(a);
      this.badges.set(a.id, badgeOf(a.progress));
      return out;
    });
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  private async create(name: string, guest: boolean, logins: Login[] = [], extra: Partial<Account> = {}): Promise<Account> {
    const a: Account = {
      id: `u_${randomBytes(9).toString("base64url")}`, name: cleanName(name, "Player"), createdAt: this.now(), guest, logins,
      progress: newProgress(), solo: null, sessions: 0, ...extra,
    };
    await this.store.put(a);
    this.badges.set(a.id, badgeOf(a.progress));
    return a;
  }

  me(a: Account): Me {
    const progress = upgrade(a.progress);
    return {
      id: a.id, name: a.name, guest: a.guest, email: a.email ?? null, logins: a.logins.map((l) => l.provider), progress,
      profile: publicProfile(a.id, a.name, a.createdAt, progress),
    };
  }

  private session(a: Account) {
    return { token: this.tokens.issue(a.id, a.sessions, this.now()), me: this.me(a) };
  }

  /** The account behind a session token, or null. */
  async fromToken(token: unknown): Promise<Account | null> {
    const t = this.tokens.read(token, this.now());
    if (!t) return null;
    const a = await this.store.get(t.accountId);
    return a && a.sessions === t.sessions ? a : null;
  }

  async require(token: unknown): Promise<Account> {
    const a = await this.fromToken(token);
    if (!a) throw new ApiError(401, "Please sign in again");
    return a;
  }

  /** Level, prestige and look for a seat at the table (from memory; no database call). */
  badge(userId: string): Badge | undefined {
    return this.badges.get(userId);
  }

  // ------------------------------------------------------------------ signing in

  /** For the game server's sockets: the account behind the token, or a new guest. */
  identity(): IdentityProvider {
    return {
      authenticate: async (token, name): Promise<Identity> => {
        const a = (await this.fromToken(token)) ?? (await this.create(name ?? "", true));
        this.badges.set(a.id, badgeOf(upgrade(a.progress)));
        return { userId: a.id, name: a.name, token: this.tokens.issue(a.id, a.sessions, this.now()) };
      },
    };
  }

  async guest(token: unknown, name: unknown) {
    const a = (await this.fromToken(token)) ?? (await this.create(typeof name === "string" ? name : "", true));
    return this.session(a);
  }

  /**
   * Sign in with a login (provider + user id). If nobody has it yet: a guest signing in keeps their
   * progress and becomes a real account; otherwise a new account is made.
   */
  private async signIn(login: Login, current: unknown, make: () => Partial<Account> & { name: string }) {
    const existing = await this.store.byLogin(login);
    if (existing) return this.session(existing);
    const cur = await this.fromToken(current);
    if (cur && cur.guest) {
      const extra = make();
      const a = await this.update(cur.id, (a) => {
        a.guest = false;
        a.logins.push(login);
        if (extra.email) a.email = extra.email;
        if (extra.password) a.password = extra.password;
        if (extra.name && (a.name.startsWith("Guest") || a.name === "Player")) a.name = cleanName(extra.name, a.name);
        return a;
      });
      return this.session(a);
    }
    const { name, ...extra } = make();
    return this.session(await this.create(name, false, [login], extra));
  }

  async register(email: unknown, password: unknown, name: unknown, current?: unknown) {
    if (typeof email !== "string" || !EMAIL.test(email.trim())) throw new ApiError(400, "That email doesn't look right");
    if (typeof password !== "string" || password.length < 8 || password.length > 200) throw new ApiError(400, "Use a password of at least 8 characters");
    const addr = email.trim().toLowerCase();
    const login: Login = { provider: "email", subject: addr };
    if (await this.store.byLogin(login)) throw new ApiError(409, "There's already an account with that email. Sign in instead.");
    const hash = await hashPassword(password);
    return this.signIn(login, current, () => ({ name: typeof name === "string" && name.trim() ? name : addr.split("@")[0], email: addr, password: hash }));
  }

  async login(email: unknown, password: unknown) {
    if (typeof email !== "string" || typeof password !== "string") throw new ApiError(400, "Enter your email and password");
    const a = await this.store.byLogin({ provider: "email", subject: email.trim().toLowerCase() });
    if (!a || !(await checkPassword(password, a.password))) throw new ApiError(401, "Wrong email or password");
    return this.session(a);
  }

  async oauthSignIn(provider: unknown, credential: unknown, name: unknown, current?: unknown) {
    let v;
    try {
      v = await this.oauth.verify(String(provider), credential);
    } catch (e) {
      if (e instanceof OAuthError) throw new ApiError(401, e.message);
      throw e;
    }
    const login: Login = { provider: provider as Provider, subject: v.subject };
    const given = typeof name === "string" && name.trim() ? name : v.name;
    return this.signIn(login, current, () => ({ name: given ?? v.email?.split("@")[0] ?? "Player", ...(v.email ? { email: v.email.toLowerCase() } : {}) }));
  }

  async dev(name: unknown, current?: unknown) {
    if (!this.devLogins) throw new ApiError(404, "Not found");
    const n = cleanName(name, "");
    if (!n) throw new ApiError(400, "Pick a name");
    return this.signIn({ provider: "dev", subject: n.toLowerCase() }, current, () => ({ name: n }));
  }

  async signOutEverywhere(a: Account) {
    return this.session(await this.update(a.id, (x) => (x.sessions++, x)));
  }

  /** Delete an account for good (required by the App Store for apps with sign-up). */
  async remove(a: Account) {
    await this.update(a.id, (x) => {
      x.logins = [];
      x.email = undefined;
      x.password = undefined;
      x.name = "Deleted player";
      x.guest = true;
      x.sessions++;
      x.progress = newProgress();
      x.solo = null;
      return x;
    });
    this.badges.delete(a.id);
    this.board = null;
  }

  // ------------------------------------------------------------------ profile and shop

  private apply(a: Account, r: Progress | Fail) {
    if (failed(r)) throw new ApiError(400, r.error);
    a.progress = r;
  }

  /** Email accounts: change the password (needs the current one). Other devices stay signed in. */
  async changePassword(a: Account, current: unknown, next: unknown) {
    if (!a.password) throw new ApiError(400, "This account doesn't sign in with a password");
    if (typeof current !== "string" || !(await checkPassword(current, a.password))) throw new ApiError(401, "That's not your current password");
    if (typeof next !== "string" || next.length < 8 || next.length > 200) throw new ApiError(400, "Use a password of at least 8 characters");
    const hash = await hashPassword(next);
    return this.update(a.id, (x) => ((x.password = hash), this.me(x)));
  }

  rename(a: Account, name: unknown) {
    const n = cleanName(name, "");
    if (!n) throw new ApiError(400, "Pick a name");
    return this.update(a.id, (x) => ((x.name = n), this.me(x)));
  }

  buy(a: Account, id: unknown) {
    return this.update(a.id, (x) => (this.apply(x, buy(x.progress, String(id))), this.me(x)));
  }

  equip(a: Account, id: unknown) {
    return this.update(a.id, (x) => (this.apply(x, equip(x.progress, String(id))), this.me(x)));
  }

  refill(a: Account) {
    return this.update(a.id, (x) => (this.apply(x, refill(x.progress)), this.me(x)));
  }

  daily(a: Account) {
    return this.update(a.id, (x) => {
      const r = daily(x.progress, this.now());
      if (failed(r)) throw new ApiError(400, r.error);
      x.progress = r.progress;
      return { me: this.me(x), chips: r.chips };
    });
  }

  prestige(a: Account) {
    return this.update(a.id, (x) => {
      const r = prestige(x.progress);
      if (failed(r)) throw new ApiError(400, r.error);
      x.progress = r.progress;
      this.board = null;
      return { me: this.me(x), coins: r.coins, unlocked: r.unlocked };
    });
  }

  /** Pay for a drink. `count` is how many people it goes to. */
  payForDrink(userId: string, id: unknown, count: number) {
    return this.update(userId, (x) => (this.apply(x, payForDrink(x.progress, String(id), count)), this.me(x)));
  }

  async drinkReceived(userId: string) {
    if (await this.store.get(userId)) await this.update(userId, (x) => void x.progress.drinksReceived++);
  }

  drinkPrice(id: unknown, count: number): number | null {
    const d = drinkInfo(String(id));
    return d ? d.price * (d.round ? 1 : count) : null;
  }

  async coins(userId: string): Promise<number> {
    return (await this.store.get(userId))?.progress.coins ?? 0;
  }

  async chips(userId: string): Promise<number> {
    return (await this.store.get(userId))?.progress.chips ?? 0;
  }

  async publicProfile(id: string): Promise<PublicProfile> {
    const a = await this.store.get(id);
    if (!a) throw new ApiError(404, "No such player");
    return publicProfile(a.id, a.name, a.createdAt, upgrade(a.progress));
  }

  // ------------------------------------------------------------------ games

  /** Start a vs-bots game: pay the buy-in and get a seed from the server. */
  soloStart(a: Account, players: unknown, stakes: unknown) {
    if (typeof players !== "number" || !SOLO_PLAYERS.includes(players)) throw new ApiError(400, "Tables are for 3 to 6 players");
    if (typeof stakes !== "number" || !Number.isInteger(stakes) || stakes < 0 || stakes > MAX_STAKES) throw new ApiError(400, "Bad stakes");
    return this.update(a.id, (x) => {
      let quit: Reward | null = null;
      if (x.solo) quit = this.settleQuit(x);
      this.apply(x, buyIn(x.progress, stakes));
      x.solo = { gameId: `s_${randomBytes(6).toString("base64url")}`, seed: randomInt(2 ** 31), players, stakes, startedAt: this.now() };
      return { me: this.me(x), gameId: x.solo.gameId, seed: x.solo.seed, quit };
    });
  }

  /** A solo game left unfinished counts as a loss (so quitting can't protect a win rate). */
  private settleQuit(x: Account): Reward {
    const g = x.solo!;
    x.solo = null;
    const r = settle(x.progress, {
      mode: "bots", players: g.players, stakes: g.stakes, won: false, payout: 0, quit: true, at: this.now(),
      summary: { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 },
    });
    x.progress = r.progress;
    return r.reward;
  }

  soloQuit(a: Account) {
    return this.update(a.id, (x) => {
      if (!x.solo) throw new ApiError(400, "No game in progress");
      const reward = this.settleQuit(x);
      return { me: this.me(x), reward };
    });
  }

  /** Finish a vs-bots game: the server replays it from the seed and the player's answers, then pays out. */
  soloFinish(a: Account, gameId: unknown, answers: unknown) {
    return this.update(a.id, (x) => {
      const g = x.solo;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(answers) || answers.length > 5000) throw new ApiError(400, "Bad answers");
      let rep;
      try {
        rep = replaySolo(g.seed, g.players, answers, sanitizeAnswer);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      x.solo = null;
      const won = rep.winners.includes(0);
      const pay = payout(g.stakes, g.players, rep.winners, 0);
      const r = settle(x.progress, { mode: "bots", players: g.players, stakes: g.stakes, won, payout: pay, summary: summarize(rep.events, 0), at: this.now() });
      x.progress = r.progress;
      this.board = null;
      return { me: this.me(x), reward: r.reward, winners: rep.winners };
    });
  }

  /** Can this player sit at a table with these stakes? */
  async canAfford(userId: string, stakes: number): Promise<boolean> {
    return (await this.chips(userId)) >= stakes;
  }

  /** Settle an online game for every signed-in player at the table. */
  async recordOnline(r: OnlineResult): Promise<Map<string, { reward: Reward; me: Me }>> {
    const out = new Map<string, { reward: Reward; me: Me }>();
    for (const s of r.seats) {
      if (s.bot || !s.userId || !(await this.store.get(s.userId))) continue;
      const res = await this.update(s.userId, (x) => {
        const won = r.winners.includes(s.seat);
        const pay = payout(r.stakes, r.players, r.winners, s.seat);
        // online buy-ins are taken when the game settles; chips never go below zero
        x.progress = { ...x.progress, chips: Math.max(0, x.progress.chips - r.stakes) };
        const st = settle(x.progress, { mode: "online", players: r.players, stakes: r.stakes, won, payout: pay, summary: summarize(r.events, s.seat), at: this.now() });
        x.progress = st.progress;
        return { reward: st.reward, me: this.me(x) };
      });
      out.set(s.userId, res);
    }
    this.board = null;
    return out;
  }

  // ------------------------------------------------------------------ leaderboards

  async leaderboard(by: unknown): Promise<LeaderRow[]> {
    const key = by === "level" || by === "wins" ? by : "winnings";
    if (this.board && this.board.by === key && this.now() - this.board.at < 30_000) return this.board.rows;
    const rows = (await this.store.all())
      .filter((a) => a.progress.stats.games > 0 && a.logins.length > 0)
      .map((a): LeaderRow => {
        const p = upgrade(a.progress);
        return { id: a.id, name: a.name, level: levelInfo(p.xp).level, prestige: p.prestige, xp: p.xp, wins: p.stats.wins, games: p.stats.games, winnings: p.stats.winnings, frame: p.equipped.frame };
      })
      .sort((a, b) => (key === "level" ? b.prestige - a.prestige || b.xp - a.xp : key === "wins" ? b.wins - a.wins : b.winnings - a.winnings))
      .slice(0, 100);
    this.board = { at: this.now(), by: key, rows };
    return rows;
  }
}

export interface LeaderRow {
  id: string;
  name: string;
  level: number;
  prestige: number;
  xp: number;
  wins: number;
  games: number;
  winnings: number;
  frame: string;
}
