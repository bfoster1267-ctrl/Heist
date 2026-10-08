// HTTP + WebSocket front door. One socket per client at /ws; GET /healthz for the host's health check.
// Each socket says hello (with its saved token), then creates, joins or lists rooms. A socket is in at
// most one room at a time.

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { GuestIdentity, type Identity, type IdentityProvider } from "./identity";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "./protocol";
import { realClock, type Clock, type Conn, type GameOverReport, type Room } from "./room";
import { Rooms, roomOptions, type Limits } from "./rooms";
import { MemoryStore, type GameStore } from "./store";

export interface ServerOptions {
  port?: number;
  host?: string;
  identity?: IdentityProvider;
  store?: GameStore;
  clock?: Clock;
  limits?: Partial<Limits>;
  graceMs?: number;
  lobbyHoldMs?: number;
  /** browser origins allowed to connect (empty = any; set this in production) */
  allowedOrigins?: string[];
  /** compress messages (default true) */
  compression?: boolean;
  /** per-socket message rate: a burst, refilling this many per second */
  rate?: { burst: number; perSec: number };
  onGameOver?: (r: GameOverReport) => void;
  log?: (msg: string, extra?: object) => void;
}

export interface HeistServer {
  http: Server;
  rooms: Rooms;
  port(): number;
  close(): Promise<void>;
}

const MAX_MESSAGE_BYTES = 16 * 1024;
/** default token bucket per socket: a burst of 30 messages, refilling 10 per second */
const RATE = { burst: 30, perSec: 10 };
const HEARTBEAT_MS = 30_000;

interface Client {
  conn: Conn | null;
  id: Identity | null;
  room: Room | null;
  tokens: number;
  last: number;
  alive: boolean;
  queue: Promise<void>;
}

export async function startServer(o: ServerOptions = {}): Promise<HeistServer> {
  const clock = o.clock ?? realClock;
  const identity = o.identity ?? new GuestIdentity();
  const store = o.store ?? new MemoryStore();
  const log = o.log ?? (() => {});
  const rate = o.rate ?? RATE;
  const rooms = new Rooms({ store, clock, log, onGameOver: o.onGameOver, graceMs: o.graceMs, lobbyHoldMs: o.lobbyHoldMs }, o.limits);
  const restored = rooms.restore();
  if (restored) log("restored tables", { count: restored });

  const http = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      const cpu = process.cpuUsage();
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, sockets: wss.clients.size, rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    server: http,
    path: "/ws",
    maxPayload: MAX_MESSAGE_BYTES,
    // frames carry whole table snapshots that differ little from one to the next: compression cuts them
    // several-fold. Small zlib windows keep each socket's compressor to ~40 KB instead of ~300 KB.
    perMessageDeflate:
      o.compression === false
        ? false
        : { threshold: 1024, serverMaxWindowBits: 11, zlibDeflateOptions: { memLevel: 6, level: 6 }, concurrencyLimit: 4 },
    verifyClient: ({ origin }: { origin: string }) => !o.allowedOrigins?.length || o.allowedOrigins.includes(origin),
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const c: Client = { conn: null, id: null, room: null, tokens: rate.burst, last: clock.now(), alive: true, queue: Promise.resolve() };
    const send = (m: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    const err = (code: Parameters<typeof errMsg>[0], msg?: string) => send(errMsg(code, msg));

    ws.on("pong", () => (c.alive = true));
    ws.on("close", () => {
      if (c.room && c.conn) c.room.disconnect(c.conn.id);
      c.room = null;
    });
    ws.on("message", (data, isBinary) => {
      c.alive = true;
      const now = clock.now();
      c.tokens = Math.min(rate.burst, c.tokens + ((now - c.last) / 1000) * rate.perSec);
      c.last = now;
      if (c.tokens < 1) return err("rate_limited");
      c.tokens--;
      if (isBinary) return err("bad_message");
      let m: ClientMsg;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return err("bad_message");
      }
      if (!m || typeof m !== "object" || typeof m.t !== "string") return err("bad_message");
      // one message at a time per socket, in arrival order (hello is async)
      c.queue = c.queue.then(() =>
        handle(m).catch((e) => {
          log("handler error", { t: m.t, err: String(e) });
          err("bad_state");
        }),
      );
    });

    async function handle(m: ClientMsg) {
      if (m.t === "ping") return send({ t: "pong", n: typeof m.n === "number" ? m.n : undefined, at: clock.now() });
      if (m.t === "hello") {
        if (m.v !== PROTOCOL_VERSION) return err("version", `This server speaks protocol ${PROTOCOL_VERSION}; refresh the page.`);
        if (c.id) return err("bad_state", "Already said hello");
        c.id = await identity.authenticate(m.token, m.name);
        c.conn = { id: randomBytes(8).toString("base64url"), userId: c.id.userId, name: c.id.name, send };
        return send({ t: "welcome", v: PROTOCOL_VERSION, userId: c.id.userId, name: c.id.name, token: c.id.token });
      }
      const conn = c.conn;
      if (!conn) return err("not_authenticated", "Say hello first");
      switch (m.t) {
        case "list":
          return send({ t: "rooms", rooms: rooms.list() });
        case "create": {
          const opts = roomOptions(m.options);
          if (!opts) return err("bad_message", "Tables are for 3 to 6 players");
          const room = rooms.create(opts);
          if (!room) return err("bad_state", "The server is full right now");
          return enter(room, {});
        }
        case "join": {
          const room = rooms.get(m.code);
          if (!room) return err("no_room", "No table with that code");
          return enter(room, { spectate: m.spectate === true, since: m.since });
        }
        case "leave":
          if (c.room) c.room.leave(conn.id);
          c.room = null;
          return send({ t: "left" });
      }
      const room = c.room;
      if (!room) return err("no_room", "Join a table first");
      let e: ReturnType<Room["start"]> = null;
      switch (m.t) {
        case "start":
          e = room.start(conn.userId);
          break;
        case "answer":
          e = room.answer(conn.id, m.askId, m.answer);
          break;
        case "autopilot":
          e = room.autopilot(conn.id, m.on === true);
          break;
        case "sit":
          e = room.sit(conn.id);
          break;
        case "chat":
          e = room.chat(conn.id, m.text);
          break;
        case "drink":
          e = room.drink(conn.id, m.to, m.drink);
          break;
        default:
          return err("bad_message", "Unknown message");
      }
      if (e) err(e);
    }

    function enter(room: Room, opts: { spectate?: boolean; since?: number }) {
      const conn = c.conn!;
      if (c.room && c.room !== room) c.room.leave(conn.id);
      else if (c.room === room) room.disconnect(conn.id);
      const e = room.join(conn, opts);
      if (e) {
        c.room = null;
        return err(e);
      }
      c.room = room;
    }

    (ws as WebSocket & { heist?: Client }).heist = c;
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      const c = (ws as WebSocket & { heist?: Client }).heist;
      if (c && !c.alive) {
        ws.terminate();
        continue;
      }
      if (c) c.alive = false;
      ws.ping();
    }
    rooms.sweep(clock.now());
  }, HEARTBEAT_MS);
  beat.unref();

  await new Promise<void>((r) => http.listen(o.port ?? 8787, o.host ?? "0.0.0.0", r));
  log("listening", { port: (http.address() as { port: number }).port });

  return {
    http,
    rooms,
    port: () => (http.address() as { port: number }).port,
    async close() {
      clearInterval(beat);
      for (const ws of wss.clients) ws.terminate();
      rooms.closeAll();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      await store.flush();
    },
  };
}

function errMsg(code: Extract<ServerMsg, { t: "error" }>["code"], msg?: string): ServerMsg {
  return { t: "error", code, msg: msg ?? code.replace(/_/g, " ") };
}
