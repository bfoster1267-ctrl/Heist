// Accounts: signing in, profiles, and every change to a player's progression. All the rules about XP,
// coins, prestige and cosmetics live in @heist/profile; this applies them to stored accounts, one change
// at a time per account so a game ending and a shop purchase can't overwrite each other.

import { randomBytes, randomInt } from "node:crypto";
import {
  badgeOf, buy, buyIn, daily, equip, failed, levelInfo, newProgress, openPack, payForDrink, payout, prestige, publicProfile, refill,
  replaySolo, tallySol, solPay, settleSolitaire, tallyFreeCell, fcPay, settleFreeCell, tallyTriPeaks, tpPay, settleTriPeaks, tallyErs, ersPay, settleErs, tallySpider, spiderPay, settleSpider, tallyPyramid, pyramidPay, settlePyramid, tallyYukon, yukonPay, settleYukon, tallyScoundrel, scoundrelPay, settleScoundrel, replayCheckers, checkersTallyOf, checkersPay, settleCheckers, isCheckersLevel, replayHearts, heartsTallyOf, heartsPay, settleHearts, isHeartsLevel, replaySpades, spadesTallyOf, spadesPay, settleSpades, isSpadesLevel, tallyMines, minesPay, settleMinesweeper, isMinesLevel, MINES_DAILY_LEVEL, tallySudoku, sudokuPay, settleSudoku, isSudokuLevel, SUDOKU_DAILY_LEVEL, easySeed, lessonFor, FIRST_HAND, settle, settleCoached, addMistakes, addCounts, MISTAKES, MISTAKE_IDS, type MistakeCounts, summarize, upgrade, BOT_RATING, botLevelFor, botLevelsFor, soloRivals, soloMates, stage, drink as drinkInfo, level, places, rankedPublic, RANKED_LEVEL, RANKED_START_MMR, buyStreakFreeze, claimDailyVault, claimWelcomeGift, getDailySeed, todayUtc, recordQuestActivity, type Badge, type Fail, type Progress, type PublicProfile, type Reward,
} from "@heist/profile";
import type { BotLevel, GameEvent } from "@heist/engine";
import { cleanName, type Identity, type IdentityProvider } from "../identity";
import { sanitizeAnswer } from "../sanitize";
import { OAuth, OAuthError, type OAuthConfig } from "./oauth";
import { MemoryActivityLog, type ActivityEvent, type ActivityLog } from "./activity";
import { MemoryAccountStore, type Account, type Crm, type Feedback, FEEDBACK_REASONS, type AccountStore, type Login, type Provider } from "./store";
import { Tokens, checkPassword, hashPassword } from "./tokens";
import { STOCK_NAME, cringeName } from "./names";
import { parseSub, type PushSub } from "../push";

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
  /** they've had the "What lost you?" question (answered or closed), so it never shows again */
  asked: boolean;
  /** their player number (#1001 up), shown with their name when they say hi in the Lounge */
  num?: number;
}

export interface OnlineResult {
  gameId?: string;
  roomId?: string;
  stakes: number;
  players: number;
  seats: { seat: number; userId: string | null; bot: boolean; name?: string }[];
  /** who takes the pot (never a player who abandoned the game) */
  winners: number[];
  /** players who weren't at the table at the end: they lose the buy-in and it counts as abandoned */
  abandoned?: number[];
  events: GameEvent[];
  /** the table's bot level, for rating the bot seats */
  botLevel?: BotLevel;
  /** a ranked table: rank points by finishing place, from `scores` (higher is better per seat) */
  ranked?: boolean;
  scores?: number[];
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
  /** where everything players do is recorded (for the admin panel) */
  activity?: ActivityLog;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const SOLO_PLAYERS = [3, 4, 5, 6];
const MAX_STAKES = 1_000_000;
/** Coached play is always a 3-player table: the fewest rivals, so a learner who follows the coach usually wins */
const COACH_PLAYERS = 3;
/** turn alerts go to at most this many of a player's phones and browsers */
const MAX_PUSH_DEVICES = 5;
/** guests who never played are removed after this many days away */
export const GUEST_KEEP_DAYS = 30;

export class AccountService {
  readonly store: AccountStore;
  readonly oauth: OAuth;
  readonly devLogins: boolean;
  readonly activity: ActivityLog;
  private tokens: Tokens;
  private now: () => number;
  private locks = new Map<string, Promise<unknown>>();
  private badges = new Map<string, Badge>();
  private board: { at: number; by: string; rows: LeaderRow[] } | null = null;
  private numbering: Promise<void> | null = null;
  /** the highest player number handed out */
  private lastNum = 1000;
  /** every name in use, lower case, so a made-up name is never someone else's */
  private taken = new Set<string>();

  constructor(o: AccountOptions = {}) {
    this.store = o.store ?? new MemoryAccountStore();
    this.tokens = new Tokens(o.secret);
    this.oauth = o.verifier ?? new OAuth(o.oauth ?? {});
    this.devLogins = o.devLogins === true;
    this.now = o.now ?? Date.now;
    this.activity = o.activity ?? new MemoryActivityLog();
  }

  /** Record something a player did. */
  track(e: Omit<ActivityEvent, "at"> & { at?: number }) {
    this.activity.add({ at: this.now(), ...e });
  }

  // ------------------------------------------------------------------ helpers

  /** Change one account, in order with every other change to it (friends and requests touch two accounts). */
  edit<T>(id: string, fn: (a: Account) => Promise<T> | T): Promise<T> {
    return this.update(id, fn);
  }

  /** Run changes to one account in order. */
  private async update<T>(id: string, fn: (a: Account) => Promise<T> | T): Promise<T> {
    return this.queued(id, async () => {
      const a = await this.store.get(id);
      if (!a) throw new ApiError(404, "No such account");
      a.progress = upgrade(a.progress);
      const out = await fn(a);
      await this.store.put(a);
      this.badges.set(a.id, badgeOf(a.progress));
      return out;
    });
  }

  /** Run fn after everything already queued for this account. */
  private async queued<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  /**
   * A guest who never sat down to a game: the admin stats leave them out, and pruneGuests() removes them
   * once they've been away 30 days. Signed-up accounts, and anyone the owner wrote notes on, never count.
   */
  untouched(a: Account): boolean {
    const p = a.progress;
    const arcadeWins = (p.solitaire?.won ?? 0) + (p.freecell?.won ?? 0) + (p.tripeaks?.won ?? 0) + (p.ers?.won ?? 0)
      + (p.spider?.won ?? 0) + (p.pyramid?.won ?? 0) + (p.yukon?.won ?? 0) + (p.scoundrel?.won ?? 0) + (p.checkers?.won ?? 0)
      + (p.minesweeper?.won ?? 0) + (p.sudoku?.won ?? 0);
    const hasArcadeGame = Boolean(a.solitaire || a.freecell || a.tripeaks || a.spider || a.pyramid || a.ers || a.yukon || a.scoundrel || a.checkers || a.minesweeper || a.sudoku);
    return a.guest && !a.played && !a.solo && !hasArcadeGame && !a.crm && !a.feedback && p.stats.games === 0 && (p.coachGames ?? 0) === 0 && (p.campaign ?? 0) === 0
      && !p.ranked && arcadeWins === 0 && !this.activity.played().has(a.id);
  }

  /** Remove guests who never played a game and haven't been seen for `days` days (any visit restarts the clock). */
  async pruneGuests(days = GUEST_KEEP_DAYS): Promise<number> {
    const cutoff = this.now() - days * 24 * 60 * 60_000;
    const stale = (a: Account) => this.untouched(a) && Math.max(a.createdAt, this.activity.lastSeen(a.id) ?? 0) < cutoff;
    let removed = 0;
    for (const a of await this.store.all()) {
      if (!stale(a)) continue;
      // in the account's queue, so nothing it was doing a moment ago can write it back
      const gone = await this.queued(a.id, async () => {
        const x = await this.store.get(a.id);
        if (!x || !stale(x)) return false;
        await this.store.delete(x.id);
        this.badges.delete(x.id);
        return true;
      }).catch(() => false);
      if (gone) removed++;
    }
    if (removed) this.track({ kind: "system.pruneGuests", data: { removed, days } });
    return removed;
  }

  /**
   * Once per start: every account gets a player number (oldest first), and guests still on a stock name
   * ("Player", "Guest 4f2a", "Ace") get a cringe one, so each person is easy to follow in the admin panel.
   */
  numbered(): Promise<void> {
    return (this.numbering ??= this.numberAll());
  }

  private async numberAll() {
    const all = (await this.store.all()).sort((x, y) => x.createdAt - y.createdAt);
    for (const a of all) {
      this.taken.add(a.name.toLowerCase());
      if (a.num) this.lastNum = Math.max(this.lastNum, a.num);
    }
    for (const a of all) {
      const rename = a.guest && STOCK_NAME.test(a.name);
      if (a.num && !rename) continue;
      const num = a.num ?? ++this.lastNum;
      const name = rename ? this.freshName() : null;
      await this.update(a.id, (x) => {
        x.num ??= num;
        if (name && STOCK_NAME.test(x.name)) (x.name = name), (x.autoName = true);
      }).catch(() => {}); // removed meanwhile
    }
  }

  private freshName() {
    const n = cringeName(this.taken);
    this.taken.add(n.toLowerCase());
    return n;
  }

  private async create(name: string, guest: boolean, logins: Login[] = [], extra: Partial<Account> = {}): Promise<Account> {
    await this.numbered().catch(() => {});
    const chosen = cleanName(name, "");
    const auto = STOCK_NAME.test(chosen);
    const a: Account = {
      id: `u_${randomBytes(9).toString("base64url")}`, name: auto ? this.freshName() : chosen, num: ++this.lastNum, ...(auto ? { autoName: true } : {}),
      createdAt: this.now(), guest, logins, progress: newProgress(), solo: null, sessions: 0, ...extra,
    };
    this.taken.add(a.name.toLowerCase());
    await this.store.put(a);
    this.badges.set(a.id, badgeOf(a.progress));
    return a;
  }

  me(a: Account): Me {
    const progress = upgrade(a.progress);
    return {
      id: a.id, name: a.name, guest: a.guest, email: a.email ?? null, logins: a.logins.map((l) => l.provider), progress,
      profile: publicProfile(a.id, a.name, a.createdAt, progress), asked: !!a.feedback, ...(a.num ? { num: a.num } : {}),
    };
  }

  /**
   * Activates VIP Founder Pass on the server account.
   * Verifies the Stripe checkout session token format and optionally confirms payment with Stripe REST API if STRIPE_SECRET_KEY is configured.
   */
  async claimVip(a: Account, sessionId?: string): Promise<Me> {
    this.checkBan(a);
    if (sessionId) {
      if (!/^cs_(live|test)_[a-zA-Z0-9_]{16,}$/.test(sessionId)) {
        throw new ApiError(400, "Invalid Stripe checkout session token");
      }
      const secret = process.env.STRIPE_SECRET_KEY;
      if (secret) {
        try {
          const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
            headers: { Authorization: `Bearer ${secret}` },
          });
          if (!res.ok) throw new Error("Stripe verification failed");
          const session = (await res.json()) as { payment_status?: string };
          if (session.payment_status !== "paid") {
            throw new ApiError(400, "Stripe session payment not completed");
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new ApiError(400, "Unable to verify Stripe checkout session with Stripe API");
        }
      }
    }
    a.progress = upgrade(a.progress);
    a.progress.vip = true;
    await this.store.put(a);
    return this.me(a);
  }

  /** The account's suspension, if one is in force. */
  banOf(a: Account) {
    const b = a.crm?.ban;
    return b && (b.until === null || b.until > this.now()) ? b : null;
  }

  /** Stop a suspended account at the door, with a reason it can show. */
  private checkBan(a: Account) {
    const b = this.banOf(a);
    if (!b) return;
    const until = b.until === null ? "" : ` until ${new Date(b.until).toUTCString().slice(5, 22)} UTC`;
    throw new ApiError(403, `This account is suspended${until}.${b.reason ? ` Reason: ${b.reason}` : ""}`);
  }

  private session(a: Account) {
    this.checkBan(a);
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
    this.checkBan(a);
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
        this.checkBan(a);
        this.badges.set(a.id, badgeOf(upgrade(a.progress)));
        return { userId: a.id, name: a.name, token: this.tokens.issue(a.id, a.sessions, this.now()) };
      },
    };
  }

  async guest(token: unknown, name: unknown, source?: unknown) {
    const a = (await this.fromToken(token)) ?? (await this.create(typeof name === "string" ? name : "", true, [], source === "cg" ? { source: "cg" } : {}));
    return this.session(a);
  }

  /**
   * Playing on CrazyGames while signed in to their site: their user token picks the Heist account. The
   * first time, the account already playing on this device takes the CrazyGames login (keeping its
   * progress), or a new guest is made for it. A guest stays a guest: no Heist sign-in is ever asked for
   * there, and the same CrazyGames user lands on the same account on any device.
   */
  async crazyGames(credential: unknown, current?: unknown) {
    let v;
    try {
      v = await this.oauth.verifyCrazyGames(credential);
    } catch (e) {
      if (e instanceof OAuthError) throw new ApiError(401, e.message);
      throw e;
    }
    const login: Login = { provider: "crazygames", subject: v.subject };
    const existing = await this.store.byLogin(login);
    if (existing) return this.session(existing);
    const cur = await this.fromToken(current);
    // the account already playing on this device takes the login (a Heist sign-in made on CrazyGames
    // stays signed in); one tied to another CrazyGames user is someone else's (a shared computer)
    if (cur && !cur.logins.some((l) => l.provider === "crazygames")) {
      const a = await this.update(cur.id, (a) => {
        a.logins.push(login);
        if (!a.source) a.source = "cg";
        if (v.name && (a.autoName || STOCK_NAME.test(a.name))) (a.name = cleanName(v.name, a.name)), (a.autoName = false);
        return a;
      });
      return this.session(a);
    }
    return this.session(await this.create(v.name ?? "", true, [login], { source: "cg" }));
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
        if (extra.marketingConsent !== undefined) a.marketingConsent = extra.marketingConsent;
        if (extra.marketingConsentAt) a.marketingConsentAt = extra.marketingConsentAt;
        if (extra.name && (a.autoName || STOCK_NAME.test(a.name))) (a.name = cleanName(extra.name, a.name)), (a.autoName = false);
        return a;
      });
      return this.session(a);
    }
    const { name, ...extra } = make();
    return this.session(await this.create(name, false, [login], extra));
  }

  async register(email: unknown, password: unknown, name: unknown, current?: unknown, consent?: unknown) {
    if (typeof email !== "string" || !EMAIL.test(email.trim())) throw new ApiError(400, "That email doesn't look right");
    const addr = email.trim().toLowerCase();
    const login: Login = { provider: "email", subject: addr };
    if (await this.store.byLogin(login)) throw new ApiError(409, "There's already an account with that email. Sign in instead.");
    let hash: string | undefined = undefined;
    if (typeof password === "string" && password.trim().length > 0) {
      if (password.length < 8 || password.length > 200) throw new ApiError(400, "Use a password of at least 8 characters");
      hash = await hashPassword(password);
    }
    return this.signIn(login, current, () => ({
      name: typeof name === "string" && name.trim() ? name : addr.split("@")[0],
      email: addr,
      password: hash,
      marketingConsent: Boolean(consent),
      marketingConsentAt: consent ? Date.now() : undefined,
    }));
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
      x.push = undefined;
      x.friends = undefined;
      return x;
    });
    this.badges.delete(a.id);
    this.board = null;
  }

  // ------------------------------------------------------------------ turn alerts (web push)

  /** Save this browser's push subscription (one per endpoint; the oldest go past a handful of devices). */
  async pushSubscribe(a: Account, raw: unknown) {
    const sub = parseSub(raw, this.now());
    if (!sub) throw new ApiError(400, "That isn't a push subscription this server can use");
    await this.update(a.id, (x) => {
      x.push = [...(x.push ?? []).filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_PUSH_DEVICES);
    });
    return { ok: true };
  }

  async pushUnsubscribe(a: Account, endpoint: unknown) {
    if (typeof endpoint !== "string") throw new ApiError(400, "Which subscription?");
    await this.update(a.id, (x) => {
      x.push = (x.push ?? []).filter((s) => s.endpoint !== endpoint);
    });
    return { ok: true };
  }

  async pushSubs(userId: string): Promise<PushSub[]> {
    return (await this.store.get(userId))?.push ?? [];
  }

  /** The push service says this subscription is gone (app deleted, alerts turned off). */
  async pushGone(userId: string, endpoint: string) {
    await this.update(userId, (x) => {
      x.push = (x.push ?? []).filter((s) => s.endpoint !== endpoint);
    }).catch(() => {});
  }

  // ------------------------------------------------------------------ profile and shop

  private apply(a: Account, r: Progress | Fail) {
    if (failed(r)) throw new ApiError(400, r.error);
    a.progress = r;
  }

  /** Email accounts: set or change the password (needs the current one if already set). Other devices stay signed in. */
  async changePassword(a: Account, current: unknown, next: unknown) {
    if (a.password) {
      if (typeof current !== "string" || !(await checkPassword(current, a.password))) throw new ApiError(401, "That's not your current password");
    }
    if (typeof next !== "string" || next.length < 8 || next.length > 200) throw new ApiError(400, "Use a password of at least 8 characters");
    const hash = await hashPassword(next);
    return this.update(a.id, (x) => ((x.password = hash), this.me(x)));
  }

  rename(a: Account, name: unknown) {
    const n = cleanName(name, "");
    if (!n) throw new ApiError(400, "Pick a name");
    this.taken.add(n.toLowerCase());
    return this.update(a.id, (x) => ((x.name = n), (x.autoName = false), this.me(x)));
  }

  /** A rename from the game socket, which knows the player by id rather than by session. */
  renameId(id: string, name: string) {
    this.taken.add(name.toLowerCase());
    return this.update(id, (x) => ((x.name = name), (x.autoName = false), x.name));
  }

  buy(a: Account, id: unknown) {
    return this.update(a.id, (x) => (this.apply(x, buy(x.progress, String(id))), this.me(x)));
  }

  buyStreakFreeze(a: Account) {
    return this.update(a.id, (x) => {
      const res = buyStreakFreeze(x.progress);
      if (!res.success) throw new ApiError(400, res.error || "Cannot buy freeze");
      x.progress = res.progress;
      return this.me(x);
    });
  }

  claimDailyVault(a: Account) {
    return this.update(a.id, (x) => {
      const res = claimDailyVault(x.progress);
      if (!res.success) throw new ApiError(400, "Daily vault not ready or already claimed");
      x.progress = res.progress;
      return { me: this.me(x), coins: res.coins, xp: res.xp };
    });
  }

  claimWelcomeGift(a: Account) {
    return this.update(a.id, (x) => {
      const res = claimWelcomeGift(x.progress);
      x.progress = res.progress;
      return { me: this.me(x), claimed: res.claimed, coins: res.coins, freezes: res.freezes };
    });
  }

  equip(a: Account, id: unknown) {
    return this.update(a.id, (x) => (this.apply(x, equip(x.progress, String(id))), this.me(x)));
  }

  refill(a: Account) {
    return this.update(a.id, (x) => {
      const before = x.progress.chips;
      this.apply(x, refill(x.progress));
      // how many chips the refill created, for the admin panel's economy view (extra field; the app ignores it)
      return { ...this.me(x), refilled: x.progress.chips - before };
    });
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

  /** Open a season pack: a free one from the pass, or one bought with chips. The server rolls the items. */
  openPack(a: Account, paid: unknown) {
    return this.update(a.id, (x) => {
      const r = openPack(x.progress, this.now(), (n) => randomInt(n), paid === true);
      if (failed(r)) throw new ApiError(400, r.error);
      x.progress = r.progress;
      return { me: this.me(x), items: r.items, dupeXp: r.dupeXp };
    });
  }

  /** Pay for a drink. `count` is how many people it goes to. */
  payForDrink(userId: string, id: unknown, count: number) {
    return this.update(userId, (x) => (this.apply(x, payForDrink(x.progress, String(id), count)), this.me(x)));
  }

  /** Coins from the house: the feedback board's thanks when a player's bug is confirmed or idea ships. */
  giveCoins(userId: string, coins: number, why: string) {
    return this.update(userId, (x) => {
      x.progress.coins += coins;
      this.track({ kind: "coins.gift", userId, name: x.name, data: { coins, why } });
      return x.progress.coins;
    });
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

  /** A player's hidden skill rating (for matchmaking). */
  async rating(userId: string): Promise<number> {
    const a = await this.store.get(userId);
    return a ? upgrade(a.progress).rating : 1000;
  }

  /** Why this player can't queue for Ranked yet (null: they can). */
  async rankedLocked(userId: string): Promise<string | null> {
    const a = await this.store.get(userId);
    // a CrazyGames login counts as signed in (their players never see Heist's own sign-in)
    if (!a || (a.guest && !a.logins.some((l) => l.provider === "crazygames"))) return "Sign in to play Ranked";
    const lv = level(upgrade(a.progress));
    return lv >= RANKED_LEVEL ? null : `Ranked unlocks at level ${RANKED_LEVEL} (you're level ${lv})`;
  }

  /** Ranked MMR, for matching ranked tables. */
  async rankedMmr(userId: string): Promise<number> {
    const a = await this.store.get(userId);
    return upgrade(a?.progress ?? {}).ranked?.mmr ?? RANKED_START_MMR;
  }

  /** Bot level for a table this player hosts, from their hidden rating. */
  async botLevel(userId: string): Promise<BotLevel> {
    return botLevelFor(await this.rating(userId));
  }

  async chips(userId: string): Promise<number> {
    return (await this.store.get(userId))?.progress.chips ?? 0;
  }

  async publicProfile(id: string): Promise<PublicProfile> {
    const a = await this.store.get(id);
    if (!a) throw new ApiError(404, "No such player");
    const p = publicProfile(a.id, a.name, a.createdAt, upgrade(a.progress));
    // who you played with is yours alone: other players see your games, not the names at your tables
    return { ...p, stats: { ...p.stats, recent: p.stats.recent.map(({ with: _, ...g }) => g) } };
  }

  // ------------------------------------------------------------------ games

  /**
   * Start a vs-bots game: pay the buy-in and get a seed from the server.
   * `scaled`: the client builds bots at the levels in the ticket (older cached clients don't, so they get
   * normal bots). `campaign`: play that stage instead (it sets the table, and has no buy-in). `coached`: Coached play
   * (always 3 players, gentle bots for clients that ask, no buy-in, small XP, kept out of the career and the rating).
   * `lessons`: the client can teach Coached play's lessons, so a player's first coached games are one (lessons.ts).
   * `true` is an older client that knows lessons 1-4 only; 2 also knows the one-hand first lesson.
   */
  async soloStart(a: Account, players: unknown, stakes: unknown, scaled?: unknown, campaign?: unknown, coached?: unknown, gentle?: unknown, lessons?: unknown) {
    const st = campaign === undefined || campaign === null ? undefined : typeof campaign === "number" ? stage(campaign) : undefined;
    if (campaign !== undefined && campaign !== null && !st) throw new ApiError(400, "No such stage");
    if (st) [players, stakes] = [st.players, 0];
    if (typeof players !== "number" || !SOLO_PLAYERS.includes(players)) throw new ApiError(400, "Tables are for 3 to 6 players");
    if (typeof stakes !== "number" || !Number.isInteger(stakes) || stakes < 0 || stakes > MAX_STAKES) throw new ApiError(400, "Bad stakes");
    const coach = !st && coached === true;
    const n = coach ? COACH_PLAYERS : players;
    const buy = coach ? 0 : stakes;
    // Coached play deals a friendly game: the seed where following the coach wins fastest (it replays as usual)
    const les = coach && gentle === true && (lessons === true || lessons === 2) ? lessonFor(a.progress.coachGames, lessons === 2) : undefined;
    const seed = coach && gentle === true ? easySeed(() => randomInt(2 ** 31), n, 16, 250, undefined, les) : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      if (st && st.n > x.progress.campaign + 1) throw new ApiError(403, "Clear the stage before that one first");
      let quit: Reward | null = null;
      if (x.solo) quit = this.settleQuit(x);
      this.apply(x, buyIn(x.progress, buy));
      const levels = !st && !coach && scaled === true ? botLevelsFor(x.progress.rating, n - 1) : undefined;
      const solo = { gameId: `s_${randomBytes(6).toString("base64url")}`, seed, players: n, stakes: buy, startedAt: this.now(), levels, stage: st?.n, ...(coach ? { coached: true } : {}), ...(coach && gentle === true ? { gentle: true } : {}), ...(les ? { lesson: les } : {}) };
      x.solo = solo;
      x.played ??= this.now();
      return { me: this.me(x), gameId: solo.gameId, seed: solo.seed, players: n, levels, stage: st?.n, gentle: solo.gentle, lesson: les, quit };
    });
  }

  /** A solo game left unfinished counts as a loss (so quitting can't protect a win rate). Coached games
   * aren't in the career, so leaving one costs nothing. */
  private settleQuit(x: Account): Reward | null {
    const g = x.solo!;
    x.solo = null;
    this.activity.saveSolo({ gameId: g.gameId, userId: x.id, name: x.name, seed: g.seed, players: g.players, stakes: g.stakes, setup: { levels: g.levels, stage: g.stage, gentle: g.gentle, lesson: g.lesson },
      answers: [], startedAt: g.startedAt, endedAt: this.now(), quit: true, winners: [] });
    if (g.coached) return null;
    const r = settle(x.progress, {
      mode: "bots", players: g.players, stakes: g.stakes, won: false, payout: 0, quit: true, at: this.now(), rivals: soloRivals(g.players, g), with: soloMates(g.seed, g.players, g), campaign: g.stage,
      summary: { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 },
    });
    x.progress = r.progress;
    this.track({ kind: "game.solo", userId: x.id, name: x.name, data: { gameId: g.gameId, players: g.players, stakes: g.stakes, stage: g.stage, won: false, quit: true, payout: 0, xp: r.reward.xp, coins: r.reward.coins, minutes: Math.round((this.now() - g.startedAt) / 6000) / 10 } });
    return r.reward;
  }

  soloQuit(a: Account) {
    return this.update(a.id, (x) => {
      if (!x.solo) throw new ApiError(400, "No game in progress");
      const reward = this.settleQuit(x);
      return { me: this.me(x), reward };
    });
  }

  /** Count play toward today's three daily quests (the Loot Safe opens when all three are done). */
  private quest(x: Account, moves: number, reward?: Reward | null) {
    const xp = Math.max(0, reward?.xp ?? 0);
    const challengeDone = !!reward?.daily;
    if (!moves && !xp && !challengeDone) return;
    x.progress = recordQuestActivity(x.progress, { moves, xp, challengeDone }, todayUtc(this.now()));
  }

  /** Only today's own daily deal counts as the daily: the client can't mark any seed it likes. */
  private isDailyDeal(game: string, seed: number, asked: unknown): boolean {
    return asked === true && seed === getDailySeed(game, todayUtc(this.now()));
  }

  /** Deal a Solitaire game. Starting another one just replaces it (nothing is at stake). */
  solitaireStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.solitaire = { gameId: `k_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("solitaire", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.solitaire.gameId, seed: x.solitaire.seed };
    });
  }

  /**
   * Pay for a Solitaire deal so far: the server replays the moves from the seed and pays only what
   * they earned beyond what this deal was already paid (new positions, aces, finished suits, the
   * win). Banked as the player goes, and when they leave (the online table can be dealt mid-game);
   * `finish` is the win, which closes the deal.
   */
  solitaireBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.solitaire;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallySol(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      // the drain only ever lowers the pay, and never shrinks once reported
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = solPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.solitaire = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleSolitaire(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a FreeCell game. */
  freecellStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.freecell = { gameId: `fc_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("freecell", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.freecell.gameId, seed: x.freecell.seed };
    });
  }

  /** Pay for FreeCell deal so far: server replays moves from seed. */
  freecellBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.freecell;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyFreeCell(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = fcPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.freecell = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleFreeCell(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a TriPeaks game. */
  tripeaksStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.tripeaks = { gameId: `tp_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("tripeaks", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.tripeaks.gameId, seed: x.tripeaks.seed };
    });
  }

  /** Pay for TriPeaks deal so far: server replays moves from seed. */
  tripeaksBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.tripeaks;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyTriPeaks(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = tpPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.tripeaks = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleTriPeaks(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal an Egyptian Rat Screw game. */
  ersStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.ers = { gameId: `ers_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("ers", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.ers.gameId, seed: x.ers.seed };
    });
  }

  /** Pay for ERS game so far: server replays moves from seed. */
  ersBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.ers;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyErs(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = ersPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.ers = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleErs(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a Spider Solitaire game. */
  spiderStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.spider = { gameId: `sp_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("spider", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.spider.gameId, seed: x.spider.seed };
    });
  }

  /** Pay for Spider deal so far: server replays moves from seed. */
  spiderBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.spider;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallySpider(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = spiderPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.spider = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleSpider(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a Pyramid Solitaire game. */
  pyramidStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.pyramid = { gameId: `pyr_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("pyramid", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.pyramid.gameId, seed: x.pyramid.seed };
    });
  }

  /** Pay for Pyramid deal so far: server replays moves from seed. */
  pyramidBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.pyramid;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyPyramid(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = pyramidPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.pyramid = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settlePyramid(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a Yukon Solitaire game. */
  yukonStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.yukon = { gameId: `yk_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("yukon", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.yukon.gameId, seed: x.yukon.seed };
    });
  }

  /** Pay for Yukon deal so far: server replays moves from seed. */
  yukonBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.yukon;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyYukon(g.seed, moves as string[]);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = yukonPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.yukon = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleYukon(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a Scoundrel game. */
  scoundrelStart(a: Account, seed?: unknown, isDaily?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      x.scoundrel = { gameId: `sc_${randomBytes(6).toString("base64url")}`, seed: s, isDaily: this.isDailyDeal("scoundrel", s, isDaily), startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.scoundrel.gameId, seed: x.scoundrel.seed };
    });
  }

  /** Pay for Scoundrel deal so far: server replays moves from seed. */
  scoundrelBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.scoundrel;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyScoundrel(g.seed, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = scoundrelPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.scoundrel = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleScoundrel(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a Minesweeper board. The daily deal is always played on the daily board size. */
  minesweeperStart(a: Account, seed?: unknown, isDaily?: unknown, level?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      const daily = this.isDailyDeal("minesweeper", s, isDaily);
      const lv = daily ? MINES_DAILY_LEVEL : isMinesLevel(level) ? level : "beginner";
      x.minesweeper = { gameId: `ms_${randomBytes(6).toString("base64url")}`, seed: s, level: lv, isDaily: daily, startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.minesweeper.gameId, seed: x.minesweeper.seed, level: lv };
    });
  }

  /** Pay for the Minesweeper board so far: the server lays the field from the seed and replays the clicks. */
  minesweeperBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.minesweeper;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallyMines(g.seed, g.level, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = minesPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.minesweeper = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleMinesweeper(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Deal a Sudoku puzzle. The daily deal is always the daily level. */
  sudokuStart(a: Account, seed?: unknown, isDaily?: unknown, level?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      const daily = this.isDailyDeal("sudoku", s, isDaily);
      const lv = daily ? SUDOKU_DAILY_LEVEL : isSudokuLevel(level) ? level : "easy";
      x.sudoku = { gameId: `su_${randomBytes(6).toString("base64url")}`, seed: s, level: lv, isDaily: daily, startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.sudoku.gameId, seed: x.sudoku.seed, level: lv };
    });
  }

  /** Pay for the Sudoku so far: the server rebuilds the puzzle from the seed and replays the entries against its solution. */
  sudokuBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.sudoku;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 5000) throw new ApiError(400, "Bad moves");
      let t;
      try {
        t = tallySudoku(g.seed, g.level, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      if (finish && !t.won) throw new ApiError(400, "That game isn't won yet");
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = sudokuPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const secondsTaken = g.startedAt ? Math.max(1, Math.round((this.now() - g.startedAt) / 1000)) : undefined;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (t.won) x.sudoku = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleSudoku(x.progress, this.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Start a Checkers game against the bot. The daily is always against the Pro bot. */
  checkersStart(a: Account, seed?: unknown, isDaily?: unknown, level?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      const daily = this.isDailyDeal("checkers", s, isDaily);
      const lv = daily ? "pro" : isCheckersLevel(level) ? level : "rookie";
      x.checkers = { gameId: `ck_${randomBytes(6).toString("base64url")}`, seed: s, level: lv, isDaily: daily, startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.checkers.gameId, seed: x.checkers.seed, level: lv };
    });
  }

  /**
   * Pay for a Checkers game so far: the server replays your moves against the same bot (it plays the same
   * replies from the same seed), checks every move is legal and works out the result itself.
   * Finishing needs the game to be over (won, lost or drawn).
   */
  checkersBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.checkers;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 1000) throw new ApiError(400, "Bad moves");
      let rep;
      try {
        rep = replayCheckers(g.seed, g.level, moves, g.plies);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      const over = rep.state.winner !== null;
      if (finish && !over) throw new ApiError(400, "That game isn't over yet");
      const t = checkersTallyOf(rep.state, g.level);
      g.plies = rep.plies;
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = checkersPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (over) x.checkers = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleCheckers(x.progress, this.now(), pay.gained, pay.xp, g.isDaily);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Start a Hearts hand against the bots. The daily is always against the Pro bots. */
  heartsStart(a: Account, seed?: unknown, isDaily?: unknown, level?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      const daily = this.isDailyDeal("hearts", s, isDaily);
      const lv = daily ? "pro" : isHeartsLevel(level) ? level : "rookie";
      x.hearts = { gameId: `ht_${randomBytes(6).toString("base64url")}`, seed: s, level: lv, isDaily: daily, startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.hearts.gameId, seed: x.hearts.seed, level: lv };
    });
  }

  /** Pay for a Hearts hand so far: the server replays your pass and card plays against the seeded bots. */
  heartsBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.hearts;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 100) throw new ApiError(400, "Bad moves");
      let rep;
      try {
        rep = replayHearts(g.seed, g.level, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      const over = rep.state.phase === "done";
      if (finish && !over) throw new ApiError(400, "That game isn't over yet");
      const t = heartsTallyOf(rep.state, g.level);
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = heartsPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (over) x.hearts = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleHearts(x.progress, this.now(), pay.gained, pay.xp, g.isDaily);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
    });
  }

  /** Start a Spades hand against the bots. The daily is always against the Pro bots. */
  spadesStart(a: Account, seed?: unknown, isDaily?: unknown, level?: unknown) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : randomInt(2 ** 31);
    return this.update(a.id, (x) => {
      const daily = this.isDailyDeal("spades", s, isDaily);
      const lv = daily ? "pro" : isSpadesLevel(level) ? level : "rookie";
      x.spades = { gameId: `spd_${randomBytes(6).toString("base64url")}`, seed: s, level: lv, isDaily: daily, startedAt: this.now() };
      x.played ??= this.now();
      return { gameId: x.spades.gameId, seed: x.spades.seed, level: lv };
    });
  }

  /** Pay for a Spades hand so far: the server replays your bid and card plays against the seeded bots. */
  spadesBank(a: Account, gameId: unknown, moves: unknown, finish = false, drain: unknown = 0) {
    return this.update(a.id, (x) => {
      const g = x.spades;
      if (!g || g.gameId !== gameId) throw new ApiError(409, "That game isn't running any more");
      if (!Array.isArray(moves) || moves.length > 100) throw new ApiError(400, "Bad moves");
      let rep;
      try {
        rep = replaySpades(g.seed, g.level, moves);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      const over = rep.state.phase === "done";
      if (finish && !over) throw new ApiError(400, "That game isn't over yet");
      const t = spadesTallyOf(rep.state, g.level);
      g.drain = Math.max(g.drain ?? 0, typeof drain === "number" && Number.isFinite(drain) ? Math.min(1e6, Math.floor(drain)) : 0);
      const pay = spadesPay(g.paid, g.paidXp, t, g.drain);
      g.paid = pay.paid;
      g.paidXp = pay.paidXp;
      const fresh = Math.max(0, moves.length - (g.counted ?? 0));
      g.counted = Math.max(g.counted ?? 0, moves.length);
      if (over) x.spades = null;
      if (!pay.xp && !pay.gained.won) {
        this.quest(x, fresh);
        return { me: this.me(x), reward: null };
      }
      const r = settleSpades(x.progress, this.now(), pay.gained, pay.xp, g.isDaily);
      x.progress = r.progress;
      this.quest(x, fresh, r.reward);
      return { me: this.me(x), reward: r.reward };
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
        rep = replaySolo(g.seed, g.players, answers, sanitizeAnswer, g);
      } catch {
        throw new ApiError(400, "That game doesn't check out");
      }
      x.solo = null;
      const won = rep.winners.includes(0);
      // every vs-bots game feeds the rookie-mistake tally the coach leans on
      x.progress = addMistakes(x.progress, rep.mistakes);
      if (g.coached) {
        const c = settleCoached(x.progress, won, g.lesson === FIRST_HAND ? { at: this.now() } : undefined);
        x.progress = c.progress;
        this.activity.saveSolo({ gameId: g.gameId, userId: x.id, name: x.name, seed: g.seed, players: g.players, stakes: g.stakes, setup: { levels: g.levels, stage: g.stage, gentle: g.gentle, lesson: g.lesson },
          answers: answers as never, startedAt: g.startedAt, endedAt: this.now(), quit: false, winners: rep.winners });
        this.track({ kind: "game.solo", userId: x.id, name: x.name, data: { gameId: g.gameId, players: g.players, coached: true, lesson: g.lesson, won, quit: false, moves: answers.length } });
        return { me: this.me(x), reward: c.reward, winners: rep.winners };
      }
      const pay = payout(g.stakes, g.players, rep.winners, 0);
      const r = settle(x.progress, { mode: "bots", players: g.players, stakes: g.stakes, won, payout: pay, summary: summarize(rep.events, 0), at: this.now(),
        rivals: soloRivals(g.players, g, rep.winners), with: soloMates(g.seed, g.players, g, rep.winners), campaign: g.stage,
      });
      x.progress = r.progress;
      this.quest(x, 0, r.reward);
      this.board = null;
      this.activity.saveSolo({ gameId: g.gameId, userId: x.id, name: x.name, seed: g.seed, players: g.players, stakes: g.stakes, setup: { levels: g.levels, stage: g.stage, gentle: g.gentle, lesson: g.lesson },
        answers: answers as never, startedAt: g.startedAt, endedAt: this.now(), quit: false, winners: rep.winners });
      this.track({ kind: "game.solo", userId: x.id, name: x.name, data: { gameId: g.gameId, players: g.players, stakes: g.stakes, stage: g.stage, won, quit: false, payout: pay, xp: r.reward.xp, coins: r.reward.coins, moves: answers.length, minutes: Math.round((this.now() - g.startedAt) / 6000) / 10 } });
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
    // everyone's rating before this game, so the order players are settled in doesn't matter
    const ratings = new Map<number, number>();
    const mmrs = new Map<number, number>();
    for (const s of r.seats) {
      const acct = !s.bot && s.userId ? await this.store.get(s.userId) : null;
      ratings.set(s.seat, acct ? upgrade(acct.progress).rating : BOT_RATING[s.bot ? (r.botLevel ?? "normal") : "normal"]);
      mmrs.set(s.seat, (acct && upgrade(acct.progress).ranked?.mmr) || RANKED_START_MMR);
    }
    // ranked: everyone's finishing place, walk-outs last
    const spans = r.ranked && r.scores ? places(r.scores, r.abandoned) : null;
    for (const s of r.seats) {
      if (s.bot || !s.userId || !(await this.store.get(s.userId))) continue;
      const res = await this.update(s.userId, (x) => {
        const quit = !!r.abandoned?.includes(s.seat);
        const won = !quit && r.winners.includes(s.seat);
        const pay = won ? payout(r.stakes, r.players, r.winners, s.seat) : 0;
        // online buy-ins are taken when the game settles; chips never go below zero
        x.progress = { ...x.progress, chips: Math.max(0, x.progress.chips - r.stakes) };
        const st = settle(x.progress, { mode: "online", players: r.players, stakes: r.stakes, won, payout: pay, summary: summarize(r.events, s.seat), quit, at: this.now(),
          rivals: r.seats.filter((o) => o.seat !== s.seat).map((o) => ({ rating: ratings.get(o.seat)!, won: r.winners.includes(o.seat) && !r.abandoned?.includes(o.seat) })),
          with: r.seats.filter((o) => o.seat !== s.seat && o.name).map((o) => ({
            name: o.name!,
            ...(o.bot ? { bot: true as const } : o.userId ? { id: o.userId } : {}),
            ...(r.winners.includes(o.seat) ? { won: true as const } : {}),
          })),
          ...(spans
            ? {
                ranked: {
                  span: spans[s.seat], players: r.players, quit, won, at: this.now(),
                  rivals: r.seats.filter((o) => o.seat !== s.seat).map((o) => ({ mmr: mmrs.get(o.seat)!, place: spans[o.seat][0] })),
                },
              }
            : {}),
        });
        x.progress = st.progress;
        this.quest(x, 0, st.reward);
        this.track({ kind: "game.online", userId: x.id, name: x.name, data: { gameId: r.gameId, roomId: r.roomId, seat: s.seat, players: r.players, stakes: r.stakes, won, abandoned: quit, payout: pay, xp: st.reward.xp, coins: st.reward.coins, ...(st.reward.ranked ? { ranked: true, place: st.reward.ranked.place, rp: st.reward.ranked.rpAfter, rpDelta: st.reward.ranked.rpAfter - st.reward.ranked.rpBefore, mmr: st.reward.ranked.mmrAfter } : {}) } });
        return { reward: st.reward, me: this.me(x) };
      });
      out.set(s.userId, res);
    }
    this.board = null;
    return out;
  }

  // ------------------------------------------------------------------ rookie mistakes

  /** How often players make each rookie mistake, across every account (no names): which warnings matter. */
  async mistakes(): Promise<{ players: number; coachGames: number; counts: { id: string; title: string; count: number; players: number }[] }> {
    const all = (await this.store.all()).map((a) => upgrade(a.progress));
    let total: MistakeCounts = {};
    for (const p of all) total = addCounts(total, p.mistakes);
    const counts = MISTAKE_IDS.map((id) => ({ id, title: MISTAKES[id].title, count: total[id] ?? 0, players: all.filter((p) => (p.mistakes[id] ?? 0) > 0).length })).sort(
      (a, b) => b.count - a.count,
    );
    return { players: all.length, coachGames: all.reduce((t, p) => t + p.coachGames, 0), counts };
  }

  // ------------------------------------------------------------------ "What lost you?" after the first game

  /**
   * Keep a player's answer. It's asked once: a second answer is ignored, except that the comment box can
   * fill in a comment shortly after the tap.
   */
  feedback(a: Account, b: Record<string, unknown>, claude = false) {
    return this.update(a.id, (x) => {
      const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 1000) || null : null;
      const f = x.feedback;
      if (f) {
        if (comment && !f.comment && f.reason !== "skip" && this.now() - f.at < 30 * 60_000) f.comment = comment;
        return { me: this.me(x) };
      }
      const reason = FEEDBACK_REASONS.find((r) => r === b.reason);
      if (!reason) throw new ApiError(400, "Pick an answer");
      const round = typeof b.round === "number" && Number.isInteger(b.round) && b.round >= 0 && b.round < 100 ? b.round : null;
      const fb: Feedback = { at: this.now(), reason, comment: reason === "skip" ? null : comment, when: b.when === "finished" ? "finished" : "left", round, coached: b.coached === true };
      if (claude) fb.claude = true;
      x.feedback = fb;
      return { me: this.me(x) };
    });
  }

  // ------------------------------------------------------------------ the owner's notes on a player (admin panel)

  /** called when an account is suspended, so the game server can drop its sockets */
  onBan?: (userId: string) => void;

  private crm(id: string, fn: (c: Crm, a: Account) => void) {
    return this.update(id, (a) => {
      a.crm ??= { notes: [], tags: [], flag: null, ban: null };
      fn(a.crm, a);
      return a.crm;
    });
  }

  addNote(id: string, text: unknown) {
    const t = typeof text === "string" ? text.trim().slice(0, 2000) : "";
    if (!t) throw new ApiError(400, "Write something first");
    return this.crm(id, (c) => {
      c.notes.unshift({ id: randomBytes(6).toString("base64url"), at: this.now(), text: t });
      c.notes.splice(500);
    });
  }

  deleteNote(id: string, noteId: unknown) {
    return this.crm(id, (c) => void (c.notes = c.notes.filter((n) => n.id !== noteId)));
  }

  setTags(id: string, tags: unknown) {
    if (!Array.isArray(tags)) throw new ApiError(400, "Tags must be a list");
    const clean = [...new Set(tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 24)).filter(Boolean))].slice(0, 20);
    return this.crm(id, (c) => void (c.tags = clean));
  }

  setFlag(id: string, reason: unknown) {
    return this.crm(id, (c) => {
      c.flag = reason === null || reason === false ? null : { reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "", at: this.now() };
    });
  }

  /** Suspend for `days` (null: for good), or lift it with `days` = 0. */
  async ban(id: string, reason: unknown, days: unknown) {
    if (days !== null && (typeof days !== "number" || !(days >= 0) || days > 3650)) throw new ApiError(400, "Pick how long");
    const out = await this.crm(id, (c, a) => {
      if (days === 0) c.ban = null;
      else {
        c.ban = { reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "", at: this.now(), until: days === null ? null : this.now() + days * 86_400_000 };
        a.solo = null;
      }
    });
    if (days !== 0) {
      this.board = null;
      this.onBan?.(id);
    }
    return out;
  }

  // ------------------------------------------------------------------ leaderboards

  async leaderboard(by: unknown): Promise<LeaderRow[]> {
    const key = by === "level" || by === "wins" || by === "ranked" ? by : "winnings";
    if (this.board && this.board.by === key && this.now() - this.board.at < 30_000) return this.board.rows;
    const rows = (await this.store.all())
      .filter((a) => a.progress.stats.games > 0 && a.logins.length > 0 && !this.banOf(a))
      .map((a): LeaderRow => {
        const p = upgrade(a.progress);
        const r = rankedPublic(p.ranked, this.now());
        return {
          id: a.id, name: a.name, level: levelInfo(p.xp).level, prestige: p.prestige, xp: p.xp, wins: p.stats.wins, games: p.stats.games, winnings: p.stats.winnings, frame: p.equipped.frame, vip: Boolean(p.vip),
          ...(r && r.games ? { rank: r.label, rp: r.rp, mmr: r.mmr } : {}),
        };
      })
      // the ranked board lists only players with a ranked game this season
      .filter((r) => key !== "ranked" || r.rp !== undefined)
      .sort((a, b) =>
        key === "level" ? b.prestige - a.prestige || b.xp - a.xp : key === "wins" ? b.wins - a.wins : key === "ranked" ? b.rp! - a.rp! || b.mmr! - a.mmr! : b.winnings - a.winnings,
      )
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
  vip?: boolean;
  /** this season's rank, points and Ranked MMR (only after a ranked game this season) */
  rank?: string;
  rp?: number;
  mmr?: number;
}
