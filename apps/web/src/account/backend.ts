// Where the player's account lives. With a game server configured (VITE_SERVER_URL) it's the server:
// sign-in, career and coins follow the player to any device. Without one (or while it can't be reached)
// it's this browser, running the same @heist/profile rules, so XP, levels, the shop and career stats
// all work in the offline build too.

import type {
  Badge, CheckersLevel, HeartsLevel, MinesLevel, Progress, PublicProfile, Reward, SpadesLevel, SudokuLevel,
} from "@heist/profile";
import type { BotLevel } from "@heist/engine";
import { crazyGamesLinked, crazyGamesSource, crazyGamesToken } from "../crazygames";
import { deviceId } from "../device";

export interface Me {
  id: string;
  name: string;
  guest: boolean;
  email: string | null;
  logins: string[];
  progress: Progress;
  profile: PublicProfile;
  /** they've had the "What lost you?" question (server only; missing from older servers) */
  asked?: boolean;
}

/** An answer to "What lost you?" ("skip": closed without answering) */
export type LostReason = "roles" | "buttons" | "lost" | "notForMe" | "liked" | "skip";
export interface LostAnswer {
  reason?: LostReason;
  comment?: string;
  when?: "left" | "finished";
  round?: number | null;
  coached?: boolean;
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
  /** Coached play lesson (a player's first coached games teach the game a piece at a time) */
  lesson?: number;
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
  vip?: boolean;
  /** this season's rank, points and Ranked MMR (only after a ranked game this season) */
  rank?: string;
  rp?: number;
  mmr?: number;
}

export type BoardKind = "bug" | "idea" | "balance" | "other";
export type BoardVote = 1 | -1 | 0;
export type BoardStatus = "new" | "review" | "planned" | "doing" | "shipped" | "wont";
/** A post on the feedback board (the Lounge's Feedback tab) */
export interface BoardRow {
  id: number;
  at: number;
  kind: BoardKind;
  title: string;
  body: string;
  userId: string;
  name: string;
  badge?: Badge;
  /** upvotes minus downvotes */
  score: number;
  ups: number;
  downs: number;
  /** your vote: 1 up, -1 down, 0 none */
  mine: BoardVote;
  comments: number;
  status: BoardStatus;
  statusAt?: number;
  /** the Heist team has answered */
  answered: boolean;
}
export type BoardVoted = Pick<BoardRow, "score" | "ups" | "downs" | "mine">;
export interface BoardComment {
  id: number;
  at: number;
  userId: string;
  name: string;
  text: string;
  badge?: Badge;
  /** from the Heist team */
  team?: boolean;
}
export interface BoardView {
  posts: BoardRow[];
  canPost: boolean;
  why?: string;
  /** coins for a confirmed bug or a shipped post, and for each player who upvoted it */
  reward: number;
  voterReward: number;
}

/** A line in the Lounge, the app-wide chat (server only) */
export interface LoungeMsg {
  id: number;
  at: number;
  userId: string;
  name: string;
  text: string;
  /** level, frame, title and the chat bubble the sender wears */
  badge?: Badge;
  /** a drink sent from the Lounge ("<name> sent <to> a <text>") */
  drink?: { id: string; emoji: string; to: string; toId: string };
}
export interface LoungeFeed {
  msgs: LoungeMsg[];
  /** lines taken down since (reported, or the sender was suspended) */
  gone: number[];
  last: number;
  /** players looking at the Lounge in the last minute */
  here: number;
  canPost: boolean;
  /** why this player can't talk yet */
  why?: string;
}

export interface Backend {
  readonly kind: "server" | "browser";
  readonly config: Config;
  me(): Promise<Me>;
  /** campaign: play that stage; coached: Coached play (free, small XP, kept out of the career) */
  soloStart(players: number, stakes: number, name: string, campaign?: number, coached?: boolean): Promise<SoloTicket>;
  soloFinish(gameId: string, answers: unknown[]): Promise<{ me: Me; reward: Reward }>;
  /** deal a Solitaire game; a win is paid after the moves replay from the seed */
  solitaireStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  solitaireFinish(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a deal's moves so far (each part paid once), less what stalling and hints drained; null when nothing new */
  solitaireBank(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a FreeCell game; a win is paid after the moves replay from the seed */
  freecellStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  freecellFinish(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a deal's moves so far (each part paid once), less what stalling and hints drained; null when nothing new */
  freecellBank(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a TriPeaks game; a win is paid after the moves replay from the seed */
  tripeaksStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  tripeaksFinish(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a deal's moves so far (each part paid once), less what stalling and hints drained; null when nothing new */
  tripeaksBank(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal an Egyptian Rat Screw game; a win is paid after the moves replay from the seed */
  ersStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  ersFinish(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay an ERS game's moves so far; null when nothing new */
  ersBank(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a Spider Solitaire game; a win is paid after the moves replay from the seed */
  spiderStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  spiderFinish(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a Spider game's moves so far */
  spiderBank(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a Pyramid Solitaire game; a win is paid after the moves replay from the seed */
  pyramidStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  pyramidFinish(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a Pyramid game's moves so far */
  pyramidBank(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a Yukon Solitaire game; a win is paid after the moves replay from the seed */
  yukonStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  yukonFinish(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a Yukon game's moves so far */
  yukonBank(gameId: string, moves: string[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a Scoundrel game; a win is paid after the moves replay from the seed */
  scoundrelStart(seed?: number, isDaily?: boolean): Promise<{ gameId: string; seed: number }>;
  scoundrelFinish(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a Scoundrel game's moves so far */
  scoundrelBank(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a Minesweeper board (the daily deal is always the daily board); paid from the clicks replayed from the seed */
  minesweeperStart(seed?: number, isDaily?: boolean, level?: MinesLevel): Promise<{ gameId: string; seed: number; level: MinesLevel }>;
  minesweeperFinish(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a Minesweeper board's clicks so far */
  minesweeperBank(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** deal a Sudoku (the daily deal is always the daily level); paid from the entries replayed against the seed's solution */
  sudokuStart(seed?: number, isDaily?: boolean, level?: SudokuLevel): Promise<{ gameId: string; seed: number; level: SudokuLevel }>;
  sudokuFinish(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward }>;
  /** pay a Sudoku's entries so far */
  sudokuBank(gameId: string, moves: unknown[], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** start a Checkers game against the bot (the daily is always the Pro bot); the result is worked out by replaying your moves */
  checkersStart(seed?: number, isDaily?: boolean, level?: CheckersLevel): Promise<{ gameId: string; seed: number; level: CheckersLevel }>;
  /** settle a finished Checkers game (won, lost or drawn) */
  checkersFinish(gameId: string, moves: number[][], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** pay a Checkers game's captures so far */
  checkersBank(gameId: string, moves: number[][], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** start a Hearts hand against bots (the daily is always the Pro table) */
  heartsStart(seed?: number, isDaily?: boolean, level?: HeartsLevel): Promise<{ gameId: string; seed: number; level: HeartsLevel }>;
  /** settle a finished Hearts hand */
  heartsFinish(gameId: string, moves: number[][], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** pay a Hearts hand's points/tricks so far */
  heartsBank(gameId: string, moves: number[][], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** start a Spades hand against bots (the daily is always the Pro table) */
  spadesStart(seed?: number, isDaily?: boolean, level?: SpadesLevel): Promise<{ gameId: string; seed: number; level: SpadesLevel }>;
  /** settle a finished Spades hand */
  spadesFinish(gameId: string, moves: number[][], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  /** pay a Spades hand's books so far */
  spadesBank(gameId: string, moves: number[][], drain: number): Promise<{ me: Me; reward: Reward | null }>;
  soloQuit(): Promise<Me>;
  buy(id: string): Promise<Me>;
  equip(id: string): Promise<Me>;
  /** open a season pack: a free one from the pass, or one bought with chips */
  openPack(paid: boolean): Promise<PackOpened>;
  prestige(): Promise<{ me: Me; coins: number; unlocked: string[] }>;
  refill(): Promise<Me>;
  daily(): Promise<{ me: Me; chips: number }>;
  buyStreakFreeze(): Promise<Me>;
  claimDailyVault(): Promise<{ me: Me; coins: number; xp: number }>;
  claimWelcomeGift(): Promise<{ me: Me; claimed: boolean; coins: number; freezes: number }>;
  /** Activate VIP Founder Pass on account (syncing local entitlement and optional Stripe checkout session) */
  claimVip(sessionId?: string): Promise<Me>;
  drink(id: string, count: number): Promise<Me>;
  rename(name: string): Promise<Me>;
  /** email accounts on the server only */
  changePassword(current: string, next: string): Promise<Me>;
  leaderboard(by: "winnings" | "level" | "wins" | "ranked"): Promise<LeaderRow[]>;
  /** another player's public card */
  player(id: string): Promise<PublicProfile>;
  // signing in (server only)
  register(email: string, password?: string, name?: string, consent?: boolean): Promise<Me>;
  setPassword?(password: string): Promise<Me>;
  login(email: string, password: string): Promise<Me>;
  oauth(provider: string, credential: string, name?: string): Promise<Me>;
  dev(name: string): Promise<Me>;
  signOut(): Promise<Me>;
  deleteAccount(): Promise<Me>;
  /** "What lost you?" after the first game (server only) */
  feedback(a: LostAnswer): Promise<{ me: Me }>;
  /** the session token, for the game server socket */
  token(): string | null;
  /** Clean up any subscriptions or background tasks */
  dispose?(): void;
  /** the Lounge (server only): what's new after a line id, say something, flag a line */
  lounge?(after: number): Promise<LoungeFeed>;
  loungeSay?(text: string): Promise<{ msg: LoungeMsg }>;
  loungeReport?(id: number): Promise<{ ok: boolean; hidden?: boolean }>;
  /** tell the server a player was muted or unmuted (it only counts mutes, for the owner) */
  loungeMute?(userId: string, on: boolean): Promise<{ ok: boolean }>;
  /** send a drink (coins) to whoever said line `to` */
  loungeDrink?(to: number, id: string): Promise<{ msg: LoungeMsg; me: Me }>;
  /** the feedback board (server only) */
  board?(sort: "top" | "new"): Promise<BoardView>;
  boardPost?(id: number): Promise<{ post: BoardRow & { thread: BoardComment[] } }>;
  boardNew?(p: { kind: BoardKind; title: string; body: string; device?: string }): Promise<{ post: BoardRow }>;
  boardVote?(id: number, dir: BoardVote): Promise<BoardVoted>;
  boardComment?(id: number, text: string): Promise<{ comment: BoardComment }>;
  boardReport?(id: number, comment?: number): Promise<{ ok: boolean; hidden?: boolean }>;
}

export const store = {
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

// ------------------------------------------------------------------ the game server

const TOKEN_KEY = "heist.session";

/** the ad tags on the link this page was opened by, read once at load (the app tidies the address bar later) */
const LAND_KEYS = ["gclid", "gbraid", "wbraid", "play", "utm_source", "utm_medium", "utm_campaign", "utm_term"];
const LANDED: Record<string, string> | undefined = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const out: Record<string, string> = {};
    for (const k of LAND_KEYS) if (q.has(k)) out[k] = (q.get(k) ?? "").slice(0, 120);
    if (!Object.keys(out).length) return undefined;
    out.path = location.pathname.slice(0, 60);
    return out;
  } catch {
    return undefined;
  }
})();

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

  /** Any API route (friends and messages use this; they only exist on the server). */
  request<T>(path: string, body?: object): Promise<T> {
    return this.call<T>(path, body);
  }

  lounge(after: number) {
    return this.call<LoungeFeed>(`/api/lounge${after ? `?after=${after}` : ""}`);
  }
  loungeSay(text: string) {
    return this.call<{ msg: LoungeMsg }>("/api/lounge/say", { text });
  }
  loungeDrink(to: number, id: string) {
    return this.call<{ msg: LoungeMsg; me: Me }>("/api/lounge/drink", { to, id });
  }
  board(sort: "top" | "new") {
    return this.call<BoardView>(`/api/board?sort=${sort}`);
  }
  boardPost(id: number) {
    return this.call<{ post: BoardRow & { thread: BoardComment[] } }>(`/api/board/post?id=${id}`);
  }
  boardNew(p: { kind: BoardKind; title: string; body: string; device?: string }) {
    return this.call<{ post: BoardRow }>("/api/board/new", p);
  }
  boardVote(id: number, dir: BoardVote) {
    return this.call<BoardVoted>("/api/board/vote", { id, dir });
  }
  boardComment(id: number, text: string) {
    return this.call<{ comment: BoardComment }>("/api/board/comment", { id, text });
  }
  boardReport(id: number, comment?: number) {
    return this.call<{ ok: boolean; hidden?: boolean }>("/api/board/report", comment === undefined ? { id } : { id, comment });
  }
  loungeReport(id: number) {
    return this.call<{ ok: boolean; hidden?: boolean }>("/api/lounge/report", { id });
  }
  loungeMute(userId: string, on: boolean) {
    return this.call<{ ok: boolean }>("/api/lounge/mute", { userId, on });
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
    const me = await this.sessionMe();
    // On CrazyGames, signed in there: their account picks the Heist account (linking this one the first
    // time), so the player never meets Heist's own sign-in and keeps their progress on any device
    const cg = await crazyGamesToken();
    if (!cg) return me;
    try {
      const r = this.signedIn(await this.call("/api/auth/crazygames", { credential: cg }));
      crazyGamesLinked();
      return r;
    } catch {
      return me;
    }
  }

  private async sessionMe(): Promise<Me> {
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
    // the page that linked here (a Reddit post, a search) tells the owner where new players come from
    const ref = typeof document === "undefined" ? "" : document.referrer.slice(0, 300);
    // src: "cg" for a player who came through CrazyGames (the admin panel counts them)
    // land: the ad tags on the link they arrived by (Google's click id, ?play=1, utm_*), so the admin panel can tell ad visitors apart
    return this.signedIn(await this.call("/api/auth/guest", { name: store.get("heist.name") ?? "", ref, src: crazyGamesSource(), land: LANDED }));
  }

  soloStart(players: number, stakes: number, _name: string, campaign?: number, coached = false) {
    return this.call<SoloTicket>("/api/solo/start", { players, stakes, scaled: true, campaign, coached, gentle: coached, lessons: coached ? 2 : false });
  }
  soloFinish(gameId: string, answers: unknown[]) {
    return this.call<{ me: Me; reward: Reward }>("/api/solo/finish", { gameId, answers });
  }
  solitaireStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/solitaire/start", { seed, isDaily });
  }
  solitaireFinish(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/solitaire/finish", { gameId, moves, drain });
  }
  solitaireBank(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/solitaire/bank", { gameId, moves, drain });
  }
  freecellStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/freecell/start", { seed, isDaily });
  }
  freecellFinish(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/freecell/finish", { gameId, moves, drain });
  }
  freecellBank(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/freecell/bank", { gameId, moves, drain });
  }
  tripeaksStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/tripeaks/start", { seed, isDaily });
  }
  tripeaksFinish(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/tripeaks/finish", { gameId, moves, drain });
  }
  tripeaksBank(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/tripeaks/bank", { gameId, moves, drain });
  }
  ersStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/ers/start", { seed, isDaily });
  }
  ersFinish(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/ers/finish", { gameId, moves, drain });
  }
  ersBank(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/ers/bank", { gameId, moves, drain });
  }
  spiderStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/spider/start", { seed, isDaily });
  }
  spiderFinish(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/spider/finish", { gameId, moves, drain });
  }
  spiderBank(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/spider/bank", { gameId, moves, drain });
  }
  pyramidStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/pyramid/start", { seed, isDaily });
  }
  pyramidFinish(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/pyramid/finish", { gameId, moves, drain });
  }
  pyramidBank(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/pyramid/bank", { gameId, moves, drain });
  }
  yukonStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/yukon/start", { seed, isDaily });
  }
  yukonFinish(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/yukon/finish", { gameId, moves, drain });
  }
  yukonBank(gameId: string, moves: string[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/yukon/bank", { gameId, moves, drain });
  }
  scoundrelStart(seed?: number, isDaily?: boolean) {
    return this.call<{ gameId: string; seed: number }>("/api/scoundrel/start", { seed, isDaily });
  }
  scoundrelFinish(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/scoundrel/finish", { gameId, moves, drain });
  }
  scoundrelBank(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/scoundrel/bank", { gameId, moves, drain });
  }
  minesweeperStart(seed?: number, isDaily?: boolean, level?: MinesLevel) {
    return this.call<{ gameId: string; seed: number; level: MinesLevel }>("/api/minesweeper/start", { seed, isDaily, level });
  }
  minesweeperFinish(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/minesweeper/finish", { gameId, moves, drain });
  }
  minesweeperBank(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/minesweeper/bank", { gameId, moves, drain });
  }
  sudokuStart(seed?: number, isDaily?: boolean, level?: SudokuLevel) {
    return this.call<{ gameId: string; seed: number; level: SudokuLevel }>("/api/sudoku/start", { seed, isDaily, level });
  }
  sudokuFinish(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward }>("/api/sudoku/finish", { gameId, moves, drain });
  }
  sudokuBank(gameId: string, moves: unknown[], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/sudoku/bank", { gameId, moves, drain });
  }
  checkersStart(seed?: number, isDaily?: boolean, level?: CheckersLevel) {
    return this.call<{ gameId: string; seed: number; level: CheckersLevel }>("/api/checkers/start", { seed, isDaily, level });
  }
  checkersFinish(gameId: string, moves: number[][], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/checkers/finish", { gameId, moves, drain });
  }
  checkersBank(gameId: string, moves: number[][], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/checkers/bank", { gameId, moves, drain });
  }
  heartsStart(seed?: number, isDaily?: boolean, level?: HeartsLevel) {
    return this.call<{ gameId: string; seed: number; level: HeartsLevel }>("/api/hearts/start", { seed, isDaily, level });
  }
  heartsFinish(gameId: string, moves: number[][], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/hearts/finish", { gameId, moves, drain });
  }
  heartsBank(gameId: string, moves: number[][], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/hearts/bank", { gameId, moves, drain });
  }
  spadesStart(seed?: number, isDaily?: boolean, level?: SpadesLevel) {
    return this.call<{ gameId: string; seed: number; level: SpadesLevel }>("/api/spades/start", { seed, isDaily, level });
  }
  spadesFinish(gameId: string, moves: number[][], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/spades/finish", { gameId, moves, drain });
  }
  spadesBank(gameId: string, moves: number[][], drain: number) {
    return this.call<{ me: Me; reward: Reward | null }>("/api/spades/bank", { gameId, moves, drain });
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
  buyStreakFreeze() {
    return this.call<Me>("/api/daily/freeze", {});
  }
  claimDailyVault() {
    return this.call<{ me: Me; coins: number; xp: number }>("/api/daily/vault", {});
  }
  claimWelcomeGift() {
    return this.call<{ me: Me; claimed: boolean; coins: number; freezes: number }>("/api/daily/welcome", {});
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
  setPassword(password: string) {
    return this.call<Me>("/api/me/password", { password });
  }
  async leaderboard(by: string) {
    return (await this.call<{ rows: LeaderRow[] }>(`/api/leaderboard?by=${by}`)).rows;
  }
  player(id: string) {
    return this.call<PublicProfile>(`/api/players/${encodeURIComponent(id)}`);
  }
  async register(email: string, password?: string, name?: string, consent = false) {
    return this.signedIn(await this.call("/api/auth/register", { email, password, name, consent }));
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
  async claimVip(sessionId?: string) {
    const r = await this.call<{ me: Me }>("/api/me/vip", { sessionId });
    return r.me;
  }
  feedback(a: LostAnswer) {
    return this.call<{ me: Me }>("/api/feedback", a);
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
  if (set !== "same-origin") {
    const srv = url && (await ServerBackend.connect(url));
    if (srv) return srv;
    const { BrowserBackend } = await import("./browserBackend");
    return new BrowserBackend();
  }
  // The game server sent this page, so it is the player's home: never drop to browser-only play (games
  // would save to this phone instead of the account). Ride out a restart, e.g. during a deploy.
  for (let attempt = 0; ; attempt++) {
    const b = await ServerBackend.connect(url!);
    if (b) return b;
    if (attempt >= 3) throw new BackendError("Can't reach the game server");
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
