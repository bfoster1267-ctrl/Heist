// A small client for the game server, for the web table, the iPhone app and tests. Uses the standard
// WebSocket (browsers, and Node 22+). Keeps the guest token, the current room and the last frame seen,
// so after a dropped connection it reconnects on its own and resumes the table where it left off.

import type { Answer, Ask } from "@heist/engine";
import { PROTOCOL_VERSION, type ClientMsg, type CreateRoomOptions, type RoomInfo, type ServerMsg } from "./protocol";

type Handler<T extends ServerMsg["t"]> = (m: Extract<ServerMsg, { t: T }>) => void;

export interface ClientOptions {
  name?: string;
  /** a token from an earlier welcome (keep it in localStorage) */
  token?: string;
  /** called when the server issues or refreshes the token */
  onToken?: (token: string) => void;
  /** reconnect after a drop (default true) */
  reconnect?: boolean;
  WebSocket?: typeof WebSocket;
}

export class HeistClient {
  userId: string | null = null;
  name: string | null = null;
  room: RoomInfo | null = null;
  seat: number | null = null;
  game = 0;
  /** index of the next frame expected (so a reconnect resumes from here) */
  nextFrame = 0;
  ask: { askId: number; ask: Ask; deadline: number } | null = null;

  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: ServerMsg) => void>>();
  private any = new Set<(m: ServerMsg) => void>();
  private token: string | undefined;
  private closed = false;
  /** the current socket has been welcomed (a drop now reconnects by itself) */
  private live = false;
  private retry = 0;
  private spectating = false;
  /** the app is in the background (told to the server again after a reconnect) */
  private away = false;
  /** the quick-queue line we're waiting in (sent again after a reconnect, since the server drops it with the socket) */
  queued: { players: number; stakes: number; ranked: boolean } | null = null;

  constructor(
    private url: string,
    private opts: ClientOptions = {},
  ) {
    this.token = opts.token;
  }

  on<T extends ServerMsg["t"]>(t: T, h: Handler<T>): () => void {
    const set = this.handlers.get(t) ?? new Set();
    set.add(h as (m: ServerMsg) => void);
    this.handlers.set(t, set);
    return () => set.delete(h as (m: ServerMsg) => void);
  }

  /** Told when the connection drops (false) and when the server welcomes us again (true). */
  onConnection(h: (up: boolean) => void): () => void {
    this.connHandlers.add(h);
    return () => this.connHandlers.delete(h);
  }
  private connHandlers = new Set<(up: boolean) => void>();

  /** Every message, after the client has updated its own fields. */
  onAny(h: (m: ServerMsg) => void): () => void {
    this.any.add(h);
    return () => this.any.delete(h);
  }

  /** Open the socket and say hello. Resolves once the server has welcomed us. */
  connect(): Promise<void> {
    this.closed = false;
    const WS = this.opts.WebSocket ?? WebSocket;
    return new Promise((resolve, reject) => {
      const ws = new WS(this.url);
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => this.send({ t: "hello", v: PROTOCOL_VERSION, token: this.token, name: this.opts.name });
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as ServerMsg;
        if (m.t === "welcome" && !welcomed) {
          welcomed = true;
          this.live = true;
          this.retry = 0;
          resolve();
          for (const h of this.connHandlers) h(true);
          // back after a drop: rejoin the table and pick up after the last frame we played
          if (this.room) this.send({ t: "join", code: this.room.code, spectate: this.spectating, since: this.game ? this.nextFrame : undefined });
          else if (this.queued) this.queue(this.queued.players, this.queued.stakes, this.queued.ranked);
          if (this.away) this.send({ t: "away", on: true });
        }
        // a suspended account is turned away for good: stop trying to reconnect
        if (m.t === "error" && m.code === "suspended") {
          this.closed = true;
          if (!welcomed) reject(new Error(m.msg));
        }
        this.receive(m);
      };
      ws.onerror = () => {
        if (!welcomed) reject(new Error("Could not reach the game server"));
      };
      ws.onclose = () => {
        this.ws = null;
        this.live = false;
        this.ask = null;
        if (welcomed && !this.closed) for (const h of this.connHandlers) h(false);
        if (!this.closed && welcomed && this.opts.reconnect !== false) this.reconnectLater();
      };
    });
  }

  private reconnectLater() {
    const ms = Math.min(10_000, 500 * 2 ** this.retry++);
    setTimeout(() => {
      if (!this.closed) this.connect().catch(() => this.reconnectLater());
    }, ms);
  }

  private receive(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        this.userId = m.userId;
        this.name = m.name;
        if (m.token !== this.token) {
          this.token = m.token;
          this.opts.onToken?.(m.token);
        }
        break;
      case "renamed":
        this.name = m.name;
        break;
      case "unqueued":
        this.queued = null;
        break;
      case "error":
        // the server turned the queue request down: we're not in line
        if (this.queued && (m.code === "no_chips" || m.code === "ranked_locked" || m.code === "bad_message" || m.code === "bad_state")) this.queued = null;
        break;
      case "room":
        this.queued = null;
        this.room = m.room;
        this.seat = m.you.seat;
        break;
      case "sync":
        this.game = m.game;
        this.nextFrame = m.frame;
        this.ask = null;
        break;
      case "frames":
        if (m.game !== this.game) {
          this.game = m.game;
          this.nextFrame = 0;
        }
        if (m.frames.length) this.nextFrame = m.frames[m.frames.length - 1].i + 1;
        this.ask = null; // the game moved on; a new ask follows if it's our decision again
        break;
      case "ask":
        this.ask = { askId: m.askId, ask: m.ask, deadline: m.deadline };
        break;
      case "waiting":
        if (this.ask && m.seat !== this.seat) this.ask = null;
        break;
      case "timeout":
        if (m.seat === this.seat) this.ask = null;
        break;
      case "left":
        this.room = null;
        this.seat = null;
        this.ask = null;
        break;
    }
    for (const h of this.handlers.get(m.t) ?? []) h(m);
    for (const h of this.any) h(m);
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  list() {
    this.send({ t: "list" });
  }
  create(options: CreateRoomOptions) {
    this.queued = null;
    this.spectating = false;
    this.send({ t: "create", options });
  }
  join(code: string, spectate = false) {
    this.queued = null;
    this.spectating = spectate;
    this.game = 0;
    this.nextFrame = 0;
    this.send({ t: "join", code, spectate });
  }
  start() {
    this.send({ t: "start" });
  }
  /** Answer the current decision. The ask stays until the game moves on, so a rejected answer can be retried. */
  answer(answer: Answer) {
    if (!this.ask) return;
    this.send({ t: "answer", askId: this.ask.askId, answer });
  }
  /** Quick queue: get dealt into the next table of this size and stakes. */
  queue(players: number, stakes: number, ranked = false) {
    this.queued = { players, stakes, ranked };
    this.send({ t: "queue", players, stakes, ...(ranked ? { ranked: true } : {}) });
  }
  unqueue() {
    this.queued = null;
    this.send({ t: "unqueue" });
  }
  sit() {
    this.send({ t: "sit" });
  }
  autopilot(on: boolean) {
    this.send({ t: "autopilot", on });
  }
  /** The app went to the background or came back: while away, the server alerts the phone on your turn. */
  setAway(on: boolean) {
    if (on === this.away) return;
    this.away = on;
    this.send({ t: "away", on });
  }
  chat(text: string) {
    this.send({ t: "chat", text });
  }
  /** change your name (saved to your account; your seat shows it while the table waits to deal) */
  rename(name: string) {
    this.send({ t: "rename", name });
  }
  /** buy a drink for one seat, or a round for the table (`to` null) */
  drink(id: string, to: number | null) {
    this.send({ t: "drink", id, to });
  }

  leave() {
    this.send({ t: "leave" });
  }
  /**
   * Play as another account (the player signed in or out in the app since this socket said hello).
   * Away from a table the socket reconnects at once as the new account; at a table (or before the
   * server has welcomed us) it switches on the next hello, so a game in progress isn't dropped.
   */
  setToken(token: string | undefined) {
    if (token === this.token) return;
    this.token = token;
    if (this.live && !this.room) this.drop();
  }
  close() {
    this.closed = true;
    this.ws?.close();
  }
  /** Drop the socket as if the network failed (tests). */
  drop() {
    this.ws?.close();
  }
}
