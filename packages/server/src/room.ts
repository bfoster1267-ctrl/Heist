// One online table. Holds the seats, runs the engine, answers for bots, times human decisions, and sends
// every connection only what its seat may see. Transport-agnostic: a Conn is anything with send(), and the
// clock is injected, so the whole room runs in tests without sockets or real time.

import { Bot, HeistGame, viewFor, type Ask, type BotLevel, type RuleOptions, type Frame, type GameEvent, type GameState } from "@heist/engine";
import { randomInt } from "node:crypto";
import type { ErrorCode, RoomInfo, SeatInfo, SeenFrame, ServerMsg } from "./protocol";
import { sanitizeAnswer } from "./sanitize";
import type { GameRecord, GameStore, StoredAnswer } from "./store";

export interface Conn {
  id: string;
  userId: string;
  name: string;
  send(msg: ServerMsg): void;
}

export interface Clock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => {
    const h = setTimeout(fn, ms);
    h.unref?.();
    return h;
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface GameOverReport {
  roomId: string;
  gameId: string;
  stakes: number;
  seats: { seat: number; userId: string | null; bot: boolean }[];
  winners: number[];
  reason: "footholds" | "last_call";
}

export interface RoomDeps {
  store: GameStore;
  clock: Clock;
  /** hook for the chips economy (workstream 5): settle buy-ins and payouts here */
  onGameOver?: (r: GameOverReport) => void;
  /** called whenever the room's public summary changes (lobby lists, matchmaking) */
  onChange?: (room: Room) => void;
  log?: (msg: string, extra?: object) => void;
  /** a disconnected player's decisions wait this long before a bot answers (ms) */
  graceMs?: number;
  /** a disconnected player's lobby seat is held this long (ms) */
  lobbyHoldMs?: number;
}

export interface RoomConfig {
  id: string;
  code: string;
  players: number;
  stakes: number;
  isPrivate: boolean;
  turnSeconds: number;
  rules: RuleOptions;
  botLevel: BotLevel;
}

interface Seat {
  kind: "open" | "human" | "bot";
  userId: string | null;
  name: string;
  autopilot: boolean;
  timeouts: number;
  bot: Bot | null;
  holdTimer: unknown;
}

const BOT_NAMES = ["Vinnie", "Rosa", "Dutch", "Lola", "Sal", "Margo", "Frankie", "Ivy", "Nico", "Bea"];
/** Frames kept for clients that reconnect and resume (older ones get a full sync instead). */
const FRAME_BUFFER = 150;
/** Two missed decisions in a row and a bot keeps playing the seat until the player is back. */
const TIMEOUTS_TO_AUTOPILOT = 2;
/** Rough time the table spends animating a frame, so a player's clock starts after they've seen the play. */
const PLAYBACK_MS: Partial<Record<GameEvent["t"], number>> = {
  reveal: 1700, result: 1800, lastCall: 1800, doubleCross: 1600, hacked: 1600, bustResult: 1400, fixerFixer: 1400,
  stuck: 1300, flip: 1300, wildcard: 1300, forged: 1300, deal: 1300,
};
const PLAYBACK_DEFAULT_MS = 700;
const PLAYBACK_CAP_MS = 30_000;

export class Room {
  readonly id: string;
  readonly code: string;
  readonly players: number;
  readonly stakes: number;
  readonly isPrivate: boolean;
  readonly rules: RuleOptions;
  readonly botLevel: BotLevel;
  readonly turnMs: number;
  hostId: string | null = null;
  status: "lobby" | "playing" | "over" = "lobby";
  seats: Seat[];
  games = 0;
  /** last time anyone was connected (epoch ms); the manager closes rooms idle too long */
  idleSince: number;

  private deps: Required<Pick<RoomDeps, "graceMs" | "lobbyHoldMs">> & RoomDeps;
  private conns = new Map<string, { conn: Conn; spectator: boolean }>();
  private game: HeistGame | null = null;
  private gameId = "";
  private recent: Frame[] = [];
  private frameCount = 0;
  private log: string[] = [];
  private askId = 0;
  private deadline = 0;
  private timer: unknown = null;
  private playbackMs = 0;
  /** the current decision was given the short clock because its player wasn't connected */
  private askShort = false;
  private chatTimes = new Map<string, number[]>();

  constructor(cfg: RoomConfig, deps: RoomDeps) {
    this.id = cfg.id;
    this.code = cfg.code;
    this.players = cfg.players;
    this.stakes = cfg.stakes;
    this.isPrivate = cfg.isPrivate;
    this.rules = cfg.rules;
    this.botLevel = cfg.botLevel;
    this.turnMs = cfg.turnSeconds * 1000;
    this.deps = { ...deps, graceMs: deps.graceMs ?? 20_000, lobbyHoldMs: deps.lobbyHoldMs ?? 60_000 };
    this.seats = Array.from({ length: cfg.players }, () => blankSeat());
    this.idleSince = deps.clock.now();
  }

  // ------------------------------------------------------------------ public summary

  info(): RoomInfo {
    return {
      id: this.id,
      code: this.code,
      status: this.status,
      players: this.players,
      stakes: this.stakes,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      seats: this.seats.map((s, seat): SeatInfo => ({
        seat,
        kind: s.kind,
        name: s.name,
        userId: s.userId,
        connected: s.userId !== null && this.isConnected(s.userId),
        autopilot: s.autopilot,
      })),
      spectators: [...this.conns.values()].filter((c) => c.spectator).length,
      turnSeconds: this.turnMs / 1000,
      rules: this.rules,
      botLevel: this.botLevel,
      games: this.games,
    };
  }

  openSeats() {
    return this.status === "lobby" ? this.seats.filter((s) => s.kind === "open").length : 0;
  }

  get connections() {
    return this.conns.size;
  }

  seatOf(userId: string): number | null {
    const i = this.seats.findIndex((s) => s.kind === "human" && s.userId === userId);
    return i < 0 ? null : i;
  }

  private isConnected(userId: string) {
    for (const c of this.conns.values()) if (c.conn.userId === userId) return true;
    return false;
  }

  // ------------------------------------------------------------------ membership

  /** Add a connection. Seats the user if they had a seat, or takes an open one in the lobby; otherwise spectates. */
  join(conn: Conn, opts: { spectate?: boolean; since?: number } = {}): ErrorCode | null {
    let seat = this.seatOf(conn.userId);
    if (seat === null && !opts.spectate && this.status === "lobby") {
      seat = this.seats.findIndex((s) => s.kind === "open");
      if (seat < 0) return "room_full";
      Object.assign(this.seats[seat], { kind: "human", userId: conn.userId, name: conn.name, autopilot: false, timeouts: 0 });
    }
    if (seat !== null) {
      const s = this.seats[seat];
      if (s.holdTimer !== null) this.deps.clock.clear(s.holdTimer);
      s.holdTimer = null;
      // coming back takes the seat back from the bot
      s.autopilot = false;
      s.timeouts = 0;
      if (this.status === "lobby") s.name = conn.name;
    }
    if (!this.hostId && seat !== null) this.hostId = conn.userId;
    this.conns.set(conn.id, { conn, spectator: seat === null });
    this.changed();
    this.catchUp(conn, opts.since);
    if (seat !== null && this.askShort && this.game?.pending?.seat === seat && this.status === "playing") {
      // their decision was on the short clock for a dropped connection: back to a full one
      this.issueAsk();
    }
    return null;
  }

  /** The player chose to go: in the lobby the seat opens up; mid-game a bot plays it from here. */
  leave(connId: string) {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    const seat = this.seatOf(c.conn.userId);
    if (seat !== null && !this.isConnected(c.conn.userId)) {
      if (this.status === "playing") this.setAutopilot(seat, true);
      else this.freeSeat(seat);
    }
    this.afterDisconnect();
  }

  /** The socket dropped. The seat is held: in the lobby for a while, mid-game with a short clock. */
  disconnect(connId: string) {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    const seat = this.seatOf(c.conn.userId);
    if (seat !== null && !this.isConnected(c.conn.userId)) {
      if (this.status !== "playing") {
        const s = this.seats[seat];
        s.holdTimer = this.deps.clock.set(() => {
          s.holdTimer = null;
          if (s.userId && !this.isConnected(s.userId) && this.status !== "playing") {
            this.freeSeat(seat);
            this.changed();
          }
        }, this.deps.lobbyHoldMs);
      } else if (this.game?.pending?.seat === seat && this.deadline - this.deps.clock.now() > this.deps.graceMs) {
        this.issueAsk(); // shorten their clock to the reconnect grace
      }
    }
    this.afterDisconnect();
  }

  private afterDisconnect() {
    if (!this.conns.size) this.idleSince = this.deps.clock.now();
    this.changed();
  }

  private freeSeat(seat: number) {
    const s = this.seats[seat];
    const uid = s.userId;
    if (s.holdTimer !== null) this.deps.clock.clear(s.holdTimer);
    this.seats[seat] = blankSeat();
    if (uid && uid === this.hostId) {
      const next = this.seats.find((x) => x.kind === "human" && x.userId && this.isConnected(x.userId));
      this.hostId = next?.userId ?? null;
    }
  }

  // ------------------------------------------------------------------ game lifecycle

  /** Host starts the game (or a rematch). Empty seats get bots. */
  start(userId: string | null, seed = randomInt(2 ** 31)): ErrorCode | null {
    if (userId !== null && userId !== this.hostId) return "not_host";
    if (this.status === "playing") return "bad_state";
    const taken = new Set<string>();
    for (const s of this.seats) {
      if (s.kind === "human" && this.status === "over" && s.userId && !this.isConnected(s.userId)) {
        // left after the last game: a bot takes the chair for the rematch
        Object.assign(s, { kind: "open", userId: null });
      }
      if (s.kind !== "open") taken.add(s.name);
    }
    const names = BOT_NAMES.filter((n) => !taken.has(n));
    for (const s of this.seats) if (s.kind === "open") Object.assign(s, { kind: "bot", name: names.shift() ?? "Bot", autopilot: false });
    if (!this.seats.some((s) => s.kind === "human")) return "bad_state";
    this.games++;
    this.gameId = `${this.id}-${this.games}`;
    this.deps.store.started({
      gameId: this.gameId,
      roomId: this.id,
      code: this.code,
      game: this.games,
      seed,
      seats: this.seats.map((s) => ({ name: s.name, bot: s.kind === "bot", userId: s.userId })),
      stakes: this.stakes,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      turnSeconds: this.turnMs / 1000,
      rules: this.rules,
      botLevel: this.botLevel,
      at: this.deps.clock.now(),
    });
    this.begin(seed);
    this.deps.log?.("game started", { room: this.code, game: this.gameId });
    this.advance();
    return null;
  }

  private begin(seed: number, replay: StoredAnswer[] = []) {
    this.game = new HeistGame({ seed, rules: this.rules, seats: this.seats.map((s) => ({ name: s.name, bot: s.kind === "bot" })) });
    for (const [i, s] of this.seats.entries()) {
      // a bot standing in for a person plays at normal strength, whatever the table's fill level
      s.bot = new Bot(seed + 7919 * (i + 1), { level: s.kind === "bot" ? this.botLevel : "normal" });
      s.timeouts = 0;
    }
    for (const r of replay) this.game.answer(r.seat, r.a);
    this.recent = [];
    this.frameCount = 0;
    this.log = [];
    this.status = "playing";
    this.changed();
    this.record(this.game.drainFrames(), replay.length > 0);
  }

  /** Rebuild a table the server was running when it stopped. Players reconnect with their tokens. */
  static restore(rec: GameRecord, deps: RoomDeps): Room {
    const st = rec.start;
    const room = new Room({ id: st.roomId, code: st.code, players: st.seats.length, stakes: st.stakes, isPrivate: st.isPrivate, turnSeconds: st.turnSeconds, rules: st.rules ?? { bribes: false, placeCrew: false, openDeals: false }, botLevel: st.botLevel ?? "normal" }, deps);
    room.seats = st.seats.map((s) => ({ ...blankSeat(), kind: s.bot ? "bot" : "human", name: s.name, userId: s.userId }));
    room.hostId = st.hostId;
    room.games = st.game;
    room.gameId = st.gameId;
    room.begin(st.seed, rec.answers);
    room.advance();
    return room;
  }

  /** Keep frames for catch-up and send them to everyone (silent while rebuilding). */
  private record(frames: Frame[], silent = false) {
    if (!frames.length) return;
    const first = this.frameCount;
    this.frameCount += frames.length;
    this.recent.push(...frames);
    if (this.recent.length > FRAME_BUFFER) this.recent.splice(0, this.recent.length - FRAME_BUFFER);
    for (const f of frames) {
      this.log.push(f.msg);
      this.playbackMs += PLAYBACK_MS[f.ev.t] ?? PLAYBACK_DEFAULT_MS;
    }
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
    if (silent) return;
    const bySeat = new Map<number, ServerMsg>();
    for (const { conn, spectator } of this.conns.values()) {
      const seat = spectator ? -1 : (this.seatOf(conn.userId) ?? -1);
      let msg = bySeat.get(seat);
      if (!msg) {
        msg = { t: "frames", game: this.games, frames: frames.map((f, k) => seen(f, first + k, seat)) };
        bySeat.set(seat, msg);
      }
      conn.send(msg);
    }
  }

  /** Run the game forward: bots and autopilot seats answer at once; stop at a human decision or the end. */
  private advance() {
    const g = this.game;
    if (!g || this.status !== "playing") return;
    this.clearTimer();
    for (let steps = 0; steps < 100_000; steps++) {
      const p = g.pending;
      if (!p) return this.finish();
      const s = this.seats[p.seat];
      if (s.kind === "human" && !s.autopilot) return this.issueAsk();
      if (!this.botAnswers(p, s.kind === "bot" ? "bot" : "autopilot")) return;
    }
  }

  private botAnswers(p: Ask, by: StoredAnswer["by"]): boolean {
    const g = this.game!;
    const s = this.seats[p.seat];
    try {
      const a = s.bot!.answer(g, p);
      g.answer(p.seat, a);
      this.deps.store.answered(this.gameId, { seat: p.seat, a, by });
    } catch (e) {
      // an engine or bot bug: stop the table rather than send a broken game
      this.deps.log?.("bot failed", { room: this.code, ask: p, err: String(e) });
      this.clearTimer();
      this.status = "over";
      this.deps.store.ended(this.gameId, { winners: [], reason: "aborted", at: this.deps.clock.now() });
      this.broadcast({ t: "error", code: "bad_state", msg: "The table hit a problem and stopped. Sorry!" });
      this.changed();
      return false;
    }
    this.record(g.drainFrames());
    return true;
  }

  /** Ask the human whose decision it is, with a clock that starts after the table has animated. */
  private issueAsk() {
    const g = this.game;
    const p = g?.pending;
    if (!g || !p) return;
    this.clearTimer();
    const s = this.seats[p.seat];
    const now = this.deps.clock.now();
    const here = s.userId !== null && this.isConnected(s.userId);
    const think = here ? this.turnMs : Math.min(this.turnMs, this.deps.graceMs);
    this.askShort = !here;
    const wait = Math.min(this.playbackMs, PLAYBACK_CAP_MS) + think;
    this.playbackMs = 0;
    this.askId++;
    this.deadline = now + wait;
    const id = this.askId;
    this.timer = this.deps.clock.set(() => this.timedOut(id), wait);
    this.sendAsk(p);
  }

  private sendAsk(p: Ask) {
    const s = this.seats[p.seat];
    for (const { conn, spectator } of this.conns.values()) {
      if (!spectator && conn.userId === s.userId) conn.send({ t: "ask", askId: this.askId, ask: p, deadline: this.deadline });
      conn.send({ t: "waiting", seat: p.seat, kind: p.kind, deadline: this.deadline });
    }
  }

  private timedOut(id: number) {
    this.timer = null;
    const p = this.game?.pending;
    if (!p || id !== this.askId || this.status !== "playing") return;
    const s = this.seats[p.seat];
    s.timeouts++;
    if (s.timeouts >= TIMEOUTS_TO_AUTOPILOT) s.autopilot = true;
    this.broadcast({ t: "timeout", seat: p.seat, autopilot: s.autopilot });
    if (s.autopilot) this.changed();
    if (this.botAnswers(p, "autopilot")) this.advance();
  }

  private finish() {
    const g = this.game!;
    this.clearTimer();
    this.status = "over";
    const winners = g.s.winners ?? [];
    const reason = g.s.endReason ?? "last_call";
    this.deps.store.ended(this.gameId, { winners, reason, at: this.deps.clock.now() });
    this.broadcast({ t: "gameOver", game: this.games, winners, reason, stakes: this.stakes });
    this.deps.onGameOver?.({
      roomId: this.id,
      gameId: this.gameId,
      stakes: this.stakes,
      seats: this.seats.map((s, seat) => ({ seat, userId: s.userId, bot: s.kind === "bot" })),
      winners,
      reason,
    });
    for (const s of this.seats) s.autopilot = false;
    this.changed();
  }

  // ------------------------------------------------------------------ player input

  answer(connId: string, askId: unknown, raw: unknown): ErrorCode | null {
    const c = this.conns.get(connId);
    const g = this.game;
    if (!c || c.spectator || !g || this.status !== "playing") return "bad_state";
    const p = g.pending;
    const seat = this.seatOf(c.conn.userId);
    if (!p || seat === null || p.seat !== seat || this.seats[seat].autopilot) return "not_your_turn";
    if (askId !== this.askId) return "stale_ask";
    const a = sanitizeAnswer(p, raw);
    if (!a) return "bad_message";
    try {
      g.answer(seat, a);
    } catch {
      return "illegal";
    }
    this.deps.store.answered(this.gameId, { seat, a, by: "player" });
    this.seats[seat].timeouts = 0;
    this.record(g.drainFrames());
    this.advance();
    return null;
  }

  /** A player hands their seat to a bot (or takes it back). */
  autopilot(connId: string, on: boolean): ErrorCode | null {
    const c = this.conns.get(connId);
    const seat = c ? this.seatOf(c.conn.userId) : null;
    if (seat === null || this.status !== "playing") return "bad_state";
    this.setAutopilot(seat, on);
    return null;
  }

  private setAutopilot(seat: number, on: boolean) {
    const s = this.seats[seat];
    if (s.autopilot === on) return;
    s.autopilot = on;
    s.timeouts = 0;
    this.changed();
    if (this.game?.pending?.seat === seat) {
      if (on) this.advance();
      else this.issueAsk();
    }
  }

  chat(connId: string, text: unknown): ErrorCode | null {
    const c = this.conns.get(connId);
    if (!c || typeof text !== "string") return "bad_message";
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
    if (!clean) return null;
    const now = this.deps.clock.now();
    const recent = (this.chatTimes.get(c.conn.userId) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 5) return "rate_limited";
    recent.push(now);
    this.chatTimes.set(c.conn.userId, recent);
    const seat = c.spectator ? null : this.seatOf(c.conn.userId);
    this.broadcast({ t: "chat", seat, name: c.conn.name, text: clean, at: now });
    return null;
  }

  // ------------------------------------------------------------------ sending

  private catchUp(conn: Conn, since: number | undefined) {
    const c = this.conns.get(conn.id);
    conn.send({ t: "room", room: this.info(), you: { seat: c && !c.spectator ? this.seatOf(conn.userId) : null } });
    const g = this.game;
    if (!g || !c) return;
    const seat = c.spectator ? -1 : (this.seatOf(conn.userId) ?? -1);
    const oldest = this.frameCount - this.recent.length;
    if (typeof since === "number" && Number.isInteger(since) && since >= oldest && since <= this.frameCount) {
      const fs = this.recent.slice(since - oldest);
      if (fs.length) conn.send({ t: "frames", game: this.games, frames: fs.map((f, k) => seen(f, since + k, seat)) });
    } else {
      conn.send({ t: "sync", game: this.games, state: viewFor(g.s, seat), frame: this.frameCount, log: [...this.log] });
    }
    const p = g.pending;
    if (p && this.status === "playing" && this.timer !== null) {
      if (seat === p.seat && !this.seats[seat].autopilot) conn.send({ t: "ask", askId: this.askId, ask: p, deadline: this.deadline });
      conn.send({ t: "waiting", seat: p.seat, kind: p.kind, deadline: this.deadline });
    }
  }

  private broadcast(msg: ServerMsg) {
    for (const { conn } of this.conns.values()) conn.send(msg);
  }

  /** Seat changes: everyone gets the new room info (each with their own seat). */
  private changed() {
    const room = this.info();
    for (const { conn, spectator } of this.conns.values()) conn.send({ t: "room", room, you: { seat: spectator ? null : this.seatOf(conn.userId) } });
    this.deps.onChange?.(this);
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.clock.clear(this.timer);
    this.timer = null;
  }

  /** Stop timers (room closing or server shutting down). */
  close() {
    this.clearTimer();
    for (const s of this.seats) if (s.holdTimer !== null) this.deps.clock.clear(s.holdTimer);
    this.broadcast({ t: "left" });
    this.conns.clear();
  }
}

function blankSeat(): Seat {
  return { kind: "open", userId: null, name: "", autopilot: false, timeouts: 0, bot: null, holdTimer: null };
}

function seen(f: Frame, i: number, seat: number): SeenFrame {
  return { i, ev: f.ev, msg: f.msg, state: frameView(f.state, seat) };
}

const HIDDEN = { kind: "S", score: 0, cash: 0, color: -1 } as const;

/** The same view as the engine's viewFor, for a frame snapshot that is never changed again: it shares
 * everything public with the snapshot instead of deep-copying it, which was most of the server's CPU.
 * Only ever serialised, never mutated. Tested against viewFor on every frame of whole games. */
export function frameView(st: GameState, seat: number): GameState {
  const players = st.players.map((p) => (p.seat === seat ? p : { ...p, hand: p.hand.map((_, k) => ({ ...HIDDEN, id: -1000 - p.seat * 100 - k })) }));
  let job = st.job;
  if (job && !job.revealed) {
    const hideB = job.boss !== seat && job.bossCard;
    const hideM = job.mark !== seat && job.markCard;
    if (hideB || hideM) job = { ...job, bossCard: hideB ? { ...HIDDEN, id: -1 } : job.bossCard, markCard: hideM ? { ...HIDDEN, id: -2 } : job.markCard };
  }
  return { ...st, deck: [], players, job };
}
