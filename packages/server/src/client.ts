// A small client for the game server, for the web table, the iPhone app and tests. Uses the standard
// WebSocket (browsers, and Node 22+). Keeps the guest token, the current room and the last frame seen,
// so after a dropped connection it reconnects on its own and resumes the table where it left off.

import type { Answer, Ask } from "@heist/engine";
import { PROTOCOL_VERSION, type ClientMsg, type CreateRoomOptions, type DrinkId, type RoomInfo, type ServerMsg } from "./protocol";

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
  private retry = 0;
  private spectating = false;

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
          this.retry = 0;
          resolve();
          for (const h of this.connHandlers) h(true);
          // back after a drop: rejoin the table and pick up after the last frame we played
          if (this.room) this.send({ t: "join", code: this.room.code, spectate: this.spectating, since: this.game ? this.nextFrame : undefined });
        }
        this.receive(m);
      };
      ws.onerror = () => {
        if (!welcomed) reject(new Error("Could not reach the game server"));
      };
      ws.onclose = () => {
        this.ws = null;
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
      case "room":
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
    this.spectating = false;
    this.send({ t: "create", options });
  }
  join(code: string, spectate = false) {
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
  autopilot(on: boolean) {
    this.send({ t: "autopilot", on });
  }
  chat(text: string) {
    this.send({ t: "chat", text });
  }
  drink(to: number, drink: DrinkId) {
    this.send({ t: "drink", to, drink });
  }
  leave() {
    this.send({ t: "leave" });
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
