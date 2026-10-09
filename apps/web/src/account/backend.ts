// Where the player's account lives. With a game server configured (VITE_SERVER_URL) it's the server:
// sign-in, career and coins follow the player to any device. Without one (or while it can't be reached)
// it's this browser, running the same @heist/profile rules, so XP, levels, the shop and career stats
// all work in the offline build too.

import {
  addMistakes, buy, buyIn, daily, settleCoached, equip, failed, newProgress, openPack, payForDrink, payout, prestige, publicProfile, refill, replaySolo, settle,
  botLevelsFor, soloRivals, stage, summarize, upgrade, type Fail, type Progress, type PublicProfile, type Reward,
} from "@heist/profile";
import type { BotLevel } from "@heist/engine";
import { deviceId } from "../device";

export interface Me {
  id: string;
  name: string;
  guest: boolean;
  email: string | null;
  logins: string[];
  progress: Progress;
  profile: PublicProfile;
}

export interface Config {
  /** sign-in methods the server has switched on: apple, google, facebook, email, dev */
  providers: string[];
  apple: string | null;
  google: string | null;
  facebook: string | null;
}

export interface SoloTicket {
  gameId: string;
  seed: number;
  /** each bot's level, picked from your skill rating (missing: all normal) */
  levels?: BotLevel[];
  /** a campaign stage, which sets the seat count (older servers don't send players) */
  stage?: number;
  players?: number;
  /** Coached play: the bots go easy on you */
  gentle?: boolean;
  me: Me;
  /** the reward for a game walked away from (it counts as a loss) */
  quit: Reward | null;
}

export interface PackOpened {
  me: Me;
  items: string[];
  dupeXp: number;
}

export interface LeaderRow {
  id: string;
  name: string;
  level: number;
  prestige: number;
  wins: number;
  games: number;
  winnings: number;
  frame: string;
  /** this season's rank, points and Ranked MMR (only after a ranked game this season) */
  rank?: string;
  rp?: number;
  mmr?: number;
}

export interface Backend {
  readonly kind: "server" | "browser";
  readonly config: Config;
  me(): Promise<Me>;
  /** campaign: play that stage; coached: Coached play (free, small XP, kept out of the career) */
  soloStart(players: number, stakes: number, name: string, campaign?: number, coached?: boolean): Promise<SoloTicket>;
  soloFinish(gameId: string, answers: unknown[]): Promise<{ me: Me; reward: Reward }>;
  soloQuit(): Promise<Me>;
  buy(id: string): Promise<Me>;
  equip(id: string): Promise<Me>;
  /** open a season pack: a free one from the pass, or one bought with chips */
  openPack(paid: boolean): Promise<PackOpened>;
  prestige(): Promise<{ me: Me; coins: number; unlocked: string[] }>;
  refill(): Promise<Me>;
  daily(): Promise<{ me: Me; chips: number }>;
  drink(id: string, count: number): Promise<Me>;
  rename(name: string): Promise<Me>;
  /** email accounts on the server only */
  changePassword(current: string, next: string): Promise<Me>;
  leaderboard(by: "winnings" | "level" | "wins" | "ranked"): Promise<LeaderRow[]>;
  /** another player's public card */
  player(id: string): Promise<PublicProfile>;
  // signing in (server only)
  register(email: string, password: string, name: string): Promise<Me>;
  login(email: string, password: string): Promise<Me>;
  oauth(provider: string, credential: string, name?: string): Promise<Me>;
  dev(name: string): Promise<Me>;
  signOut(): Promise<Me>;
  deleteAccount(): Promise<Me>;
  /** the session token, for the game server socket */
  token(): string | null;
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage blocked: lasts for this visit only */
    }
  },
};

export class BackendError extends Error {
  /** the HTTP status, when the server answered */
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

// ------------------------------------------------------------------ this browser

interface LocalSave {
  id: string;
  name: string;
  joined: number;
  progress: Progress;
  solo: { gameId: string; seed: number; players: number; stakes: number; levels?: BotLevel[]; stage?: number; coached?: boolean; gentle?: boolean } | null;
}

const LOCAL_KEY = "heist.profile";

export class BrowserBackend implements Backend {
  readonly kind = "browser" as const;
  readonly config: Config = { providers: [], apple: null, google: null, facebook: null };
  private save: LocalSave;

  constructor() {
    let s: LocalSave | null = null;
    try {
      s = JSON.parse(store.get(LOCAL_KEY) ?? "null");
    } catch {
      s = null;
    }
    if (!s) {
      const p = newProgress();
      // chips from before profiles existed carry over
      const old = Number(store.get("heist.chips"));
      if (Number.isFinite(old) && old > 0) p.chips = old;
      s = { id: "local", name: store.get("heist.name") || "Ace", joined: Date.now(), progress: p, solo: null };
    }
    s.progress = upgrade(s.progress);
    this.save = s;
    this.write();
  }

  private write() {
    store.set(LOCAL_KEY, JSON.stringify(this.save));
  }

  private view(): Me {
    const s = this.save;
    return { id: s.id, name: s.name, guest: true, email: null, logins: [], progress: s.progress, profile: publicProfile(s.id, s.name, s.joined, s.progress) };
  }

  private apply(r: Progress | Fail): Me {
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r;
    this.write();
    return this.view();
  }

  async me() {
    return this.view();
  }

  private quit(): Reward | null {
    const g = this.save.solo;
    if (!g) return null;
    this.save.solo = null;
    if (g.coached) return null;
    const r = settle(this.save.progress, {
      mode: "bots", players: g.players, stakes: g.stakes, won: false, payout: 0, quit: true, at: Date.now(), rivals: soloRivals(g.players, g), campaign: g.stage,
      summary: { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 },
    });
    this.save.progress = r.progress;
    return r.reward;
  }

  async soloStart(players: number, stakes: number, name: string, campaign?: number, coached = false): Promise<SoloTicket> {
    const st = campaign ? stage(campaign) : undefined;
    if (campaign && (!st || st.n > this.save.progress.campaign + 1)) throw new BackendError("Clear the stage before that one first");
    if (st) [players, stakes] = [st.players, 0];
    const quit = this.quit();
    if (coached) [players, stakes] = [3, 0];
    if (name) this.save.name = name;
    const p = buyIn(this.save.progress, stakes);
    if (failed(p)) throw new BackendError(p.error);
    this.save.progress = p;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const levels = st || coached ? undefined : botLevelsFor(this.save.progress.rating, players - 1);
    this.save.solo = { gameId: `l_${seed}`, seed, players, stakes, levels, stage: st?.n, ...(coached ? { coached: true, gentle: true } : {}) };
    this.write();
    return { gameId: this.save.solo.gameId, seed, levels, stage: st?.n, players, gentle: coached || undefined, me: this.view(), quit };
  }

  async soloFinish(gameId: string, answers: unknown[]) {
    const g = this.save.solo;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const rep = replaySolo(g.seed, g.players, answers, undefined, g);
    this.save.solo = null;
    const won = rep.winners.includes(0);
    this.save.progress = addMistakes(this.save.progress, rep.mistakes);
    if (g.coached) {
      const c = settleCoached(this.save.progress, won);
      this.save.progress = c.progress;
      this.write();
      return { me: this.view(), reward: c.reward };
    }
    const r = settle(this.save.progress, {
      mode: "bots", players: g.players, stakes: g.stakes, won, payout: payout(g.stakes, g.players, rep.winners, 0), summary: summarize(rep.events, 0), at: Date.now(),
      rivals: soloRivals(g.players, g, rep.winners), campaign: g.stage,
    });
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  async soloQuit() {
    this.quit();
    this.write();
    return this.view();
  }

  async buy(id: string) {
    return this.apply(buy(this.save.progress, id));
  }
  async equip(id: string) {
    return this.apply(equip(this.save.progress, id));
  }
  async openPack(paid: boolean): Promise<PackOpened> {
    const r = openPack(this.save.progress, Date.now(), (n) => Math.floor(Math.random() * n), paid);
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), items: r.items, dupeXp: r.dupeXp };
  }
  async prestige() {
    const r = prestige(this.save.progress);
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), coins: r.coins, unlocked: r.unlocked };
  }
  async refill() {
    return this.apply(refill(this.save.progress));
  }
  async daily() {
    const r = daily(this.save.progress, Date.now());
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), chips: r.chips };
  }
  async drink(id: string, count: number) {
    return this.apply(payForDrink(this.save.progress, id, count));
  }
  async rename(name: string) {
    const n = name.trim().slice(0, 20);
    if (!n) throw new BackendError("Pick a name");
    this.save.name = n;
    store.set("heist.name", n);
    this.write();
    return this.view();
  }
  async leaderboard(): Promise<LeaderRow[]> {
    return [];
  }
  async player(id: string): Promise<PublicProfile> {
    if (id !== this.save.id) throw new BackendError("Player cards need the game server");
    return this.view().profile;
  }
  async changePassword(): Promise<Me> {
    throw new BackendError("Passwords need the game server");
  }
  private offline(): never {
    throw new BackendError("Accounts turn on when the game server is live.");
  }
  async register() {
    return this.offline();
  }
  async login() {
    return this.offline();
  }
  async oauth() {
    return this.offline();
  }
  async dev() {
    return this.offline();
  }
  async signOut() {
    return this.view();
  }
  async deleteAccount() {
    store.set(LOCAL_KEY, null);
    this.save = new BrowserBackend().save;
    return this.view();
  }
  token() {
    return null;
  }
}

// ------------------------------------------------------------------ the game server

const TOKEN_KEY = "heist.session";

export class ServerBackend implements Backend {
  readonly kind = "server" as const;
  private constructor(
    private base: string,
    readonly config: Config,
    private session: string | null,
  ) {}

  /** Connect, or null if the server can't be reached (the app falls back to the browser). */
  static async connect(base: string): Promise<ServerBackend | null> {
    try {
      const r = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      return new ServerBackend(base, await r.json(), store.get(TOKEN_KEY));
    } catch {
      return null;
    }
  }

  token() {
    return this.session;
  }

  private async call<T>(path: string, body?: object): Promise<T> {
    const r = await fetch(this.base + path, {
      method: body ? "POST" : "GET",
      headers: { "x-heist-device": deviceId(), ...(body ? { "content-type": "application/json" } : {}), ...(this.session ? { authorization: `Bearer ${this.session}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await r.json().catch(() => ({ error: "The server sent something odd" }));
    if (!r.ok) throw new BackendError(out.error ?? "Something went wrong", r.status);
    return out as T;
  }

  private signedIn(r: { token: string; me: Me }): Me {
    this.session = r.token;
    store.set(TOKEN_KEY, r.token);
    return r.me;
  }

  async me(): Promise<Me> {
    if (this.session) {
      // Only a 401 (expired, or signed out everywhere) drops the session for a guest. A blip while the
      // server restarts after a deploy must not swap a signed-in player's token for a fresh guest.
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.call<Me>("/api/me");
        } catch (e) {
          if (e instanceof BackendError && e.status === 401) break;
          if (e instanceof BackendError && e.status === 403) throw e; // suspended: no point retrying
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    }
    return this.signedIn(await this.call("/api/auth/guest", { name: store.get("heist.name") ?? "" }));
  }

  soloStart(players: number, stakes: number, _name: string, campaign?: number, coached = false) {
    return this.call<SoloTicket>("/api/solo/start", { players, stakes, scaled: true, campaign, coached, gentle: coached });
  }
  soloFinish(gameId: string, answers: unknown[]) {
    return this.call<{ me: Me; reward: Reward }>("/api/solo/finish", { gameId, answers });
  }
  async soloQuit() {
    return (await this.call<{ me: Me }>("/api/solo/quit", {})).me;
  }
  buy(id: string) {
    return this.call<Me>("/api/shop/buy", { id });
  }
  equip(id: string) {
    return this.call<Me>("/api/shop/equip", { id });
  }
  openPack(paid: boolean) {
    return this.call<PackOpened>("/api/season/pack", { paid });
  }
  prestige() {
    return this.call<{ me: Me; coins: number; unlocked: string[] }>("/api/prestige", {});
  }
  refill() {
    return this.call<Me>("/api/chips/refill", {});
  }
  daily() {
    return this.call<{ me: Me; chips: number }>("/api/chips/daily", {});
  }
  drink(id: string, count: number) {
    return this.call<Me>("/api/solo/drink", { id, count });
  }
  rename(name: string) {
    return this.call<Me>("/api/me/name", { name });
  }
  changePassword(current: string, password: string) {
    return this.call<Me>("/api/me/password", { current, password });
  }
  async leaderboard(by: string) {
    return (await this.call<{ rows: LeaderRow[] }>(`/api/leaderboard?by=${by}`)).rows;
  }
  player(id: string) {
    return this.call<PublicProfile>(`/api/players/${encodeURIComponent(id)}`);
  }
  async register(email: string, password: string, name: string) {
    return this.signedIn(await this.call("/api/auth/register", { email, password, name }));
  }
  async login(email: string, password: string) {
    return this.signedIn(await this.call("/api/auth/login", { email, password }));
  }
  async oauth(provider: string, credential: string, name?: string) {
    return this.signedIn(await this.call("/api/auth/oauth", { provider, credential, name }));
  }
  async dev(name: string) {
    return this.signedIn(await this.call("/api/auth/dev", { name }));
  }
  async signOut() {
    this.session = null;
    store.set(TOKEN_KEY, null);
    return this.me();
  }
  async deleteAccount() {
    await this.call("/api/me/delete", {});
    return this.signOut();
  }
}

export async function openBackend(): Promise<Backend> {
  // "same-origin": the app is served by the game server itself (the Docker image builds it this way)
  const set = import.meta.env.VITE_SERVER_URL as string | undefined;
  const url = (set === "same-origin" ? location.origin : set)?.replace(/\/$/, "");
  if (set !== "same-origin") return (url && (await ServerBackend.connect(url))) || new BrowserBackend();
  // The game server sent this page, so it is the player's home: never drop to browser-only play (games
  // would save to this phone instead of the account). Ride out a restart, e.g. during a deploy.
  for (let attempt = 0; ; attempt++) {
    const b = await ServerBackend.connect(url!);
    if (b) return b;
    if (attempt >= 3) throw new BackendError("Can't reach the game server");
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
