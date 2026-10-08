// The connection to the game server, shared by the online lobby and the online table. One socket for
// the whole app. It keeps every frame of the current game, so a table that mounts late (or remounts
// for a rematch) can still play the game from the start or jump to where it is.
import type { Ask } from "@heist/engine";
import { HeistClient } from "@heist/server/client";
import type { RoomInfo, SeenFrame, ServerMsg } from "@heist/server/protocol";
import type { GameState } from "@heist/engine";

// the same session token the account uses, so online games count toward the player's career
const TOKEN_KEY = "heist.session";

/** Where the game server is: VITE_SERVER_URL, the dev server on localhost, or the page's own host. */
export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  // an http(s) address is the server itself (as the accounts code uses it); a ws(s) one is the socket
  if (env && env !== "same-origin") return /^http/.test(env) ? env.replace(/^http/, "ws").replace(/\/?$/, "/ws") : env;
  const { protocol, hostname, host } = location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return `ws://${hostname}:8787/ws`;
  // the GitHub Pages build talks to the hosted server; the server also serves the app at its own address
  if (hostname.endsWith("github.io")) return "wss://heist-server-xc2x.onrender.com/ws";
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
}

export interface GameFeed {
  game: number;
  /** a full table to start from (after a sync), or null when the frames start at the deal */
  base: { state: GameState; log: string[] } | null;
  frames: SeenFrame[];
}

type Listener = () => void;

export class OnlineSession {
  client: HeistClient;
  feed: GameFeed = { game: 0, base: null, frames: [] };
  ask: { askId: number; ask: Ask; deadline: number } | null = null;
  waiting: { seat: number; deadline: number } | null = null;
  rooms: { code: string; players: number; stakes: number; open: number }[] = [];
  error: string | null = null;
  status: "idle" | "connecting" | "online" | "offline" = "idle";
  gameOver: Extract<ServerMsg, { t: "gameOver" }> | null = null;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<(m: ServerMsg) => void>();

  constructor(name: string) {
    let token: string | undefined;
    try {
      token = localStorage.getItem(TOKEN_KEY) ?? undefined;
    } catch {
      /* private mode */
    }
    this.client = new HeistClient(serverUrl(), {
      name,
      token,
      onToken: (t) => {
        try {
          localStorage.setItem(TOKEN_KEY, t);
        } catch {
          /* ignore */
        }
      },
    });
    this.client.onAny((m) => this.receive(m));
  }

  get room(): RoomInfo | null {
    return this.client.room;
  }
  get seat(): number | null {
    return this.client.seat;
  }

  async connect() {
    if (this.status === "online" || this.status === "connecting") return;
    this.status = "connecting";
    this.emit();
    try {
      await this.client.connect();
      this.status = "online";
    } catch {
      this.status = "offline";
      this.error = "Couldn't reach the game server. Check your connection and try again.";
    }
    this.emit();
  }

  private receive(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        this.status = "online";
        break;
      case "rooms":
        this.rooms = m.rooms;
        break;
      case "sync":
        this.feed = { game: m.game, base: { state: m.state, log: m.log }, frames: [] };
        this.ask = null;
        break;
      case "frames":
        if (m.game !== this.feed.game) {
          this.feed = { game: m.game, base: null, frames: [] };
          this.gameOver = null;
        }
        this.feed.frames.push(...m.frames);
        this.ask = null;
        break;
      case "ask":
        this.ask = { askId: m.askId, ask: m.ask, deadline: m.deadline };
        break;
      case "waiting":
        this.waiting = { seat: m.seat, deadline: m.deadline };
        if (m.seat !== this.seat) this.ask = null;
        break;
      case "timeout":
        if (m.seat === this.seat) this.ask = null;
        break;
      case "gameOver":
        this.gameOver = m;
        this.waiting = null;
        break;
      case "left":
        this.feed = { game: 0, base: null, frames: [] };
        this.ask = null;
        this.waiting = null;
        this.gameOver = null;
        break;
      case "error":
        // a stale or late answer after a timeout isn't worth a message
        if (m.code !== "stale_ask" && m.code !== "not_your_turn") this.error = m.msg;
        break;
    }
    for (const f of this.frameListeners) f(m);
    this.emit();
  }

  /** Re-render on any change (lobby). */
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  /** Every message as it arrives (the table, which keeps its own playback queue). */
  onMessage(l: (m: ServerMsg) => void): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  clearError() {
    this.error = null;
    this.emit();
  }

  leave() {
    this.client.leave();
  }
  close() {
    this.client.close();
  }
}

let current: OnlineSession | null = null;

/** The app's one connection, opened on first use. */
export function session(name: string): OnlineSession {
  if (!current) current = new OnlineSession(name);
  void current.connect();
  return current;
}
