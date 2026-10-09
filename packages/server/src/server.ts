// HTTP + WebSocket front door. One socket per client at /ws; GET /healthz for the host's health check.
// Each socket says hello (with its saved token), then creates, joins or lists rooms. A socket is in at
// most one room at a time.

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { DRINKS } from "@heist/profile";
import { scrub } from "./accounts/activity";
import { AdminAuth, AdminService } from "./accounts/admin";
import { accountsApi } from "./accounts/api";
import { serveStatic } from "./static";
import { ApiError, type AccountService } from "./accounts/service";
import { GuestIdentity, type Identity, type IdentityProvider } from "./identity";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "./protocol";
import { realClock, type Clock, type Conn, type GameOverReport, type Room } from "./room";
import { Rooms, roomOptions, type Limits } from "./rooms";
import { Matchmaker } from "./queue";
import { MemoryStore, type GameStore } from "./store";
import type { Hosting } from "./accounts/hosting";

export interface ServerOptions {
  port?: number;
  host?: string;
  identity?: IdentityProvider;
  store?: GameStore;
  clock?: Clock;
  limits?: Partial<Limits>;
  /** quick queue: how long the first person waits before bots fill the table (ms) */
  queueWaitMs?: number;
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
  /**
   * Accounts and progression. When set, sockets sign in with account session tokens (guests get a guest
   * account), the /api routes are served, online games settle chips, stats and XP, and drinks cost coins.
   */
  accounts?: AccountService;
  /** a built web app to serve at / (so the game and its server share one address) */
  webDir?: string;
  /** the owner's admin panel at /admin (needs accounts); off without a password */
  admin?: { user: string; password: string; secret?: string };
  /** server and Render stats for the admin panel */
  hosting?: Hosting;
}

export interface HeistServer {
  http: Server;
  rooms: Rooms;
  queue: Matchmaker;
  port(): number;
  close(): Promise<void>;
}

const MAX_MESSAGE_BYTES = 16 * 1024;
/** default token bucket per socket: a burst of 30 messages, refilling 10 per second */
const RATE = { burst: 30, perSec: 10 };
const HEARTBEAT_MS = 30_000;
const DRINK_IDS = new Set(DRINKS.map((d) => d.id));
/** messages that don't go in the activity log: moves are in the game's own record */
const QUIET = new Set(["ping", "hello", "answer", "list"]);

interface Client {
  conn: Conn | null;
  id: Identity | null;
  room: Room | null;
  tokens: number;
  last: number;
  alive: boolean;
  queue: Promise<void>;
  ip: string;
  /** the error this message got, if any (for the activity log) */
  failed?: string;
}

export async function startServer(o: ServerOptions = {}): Promise<HeistServer> {
  const clock = o.clock ?? realClock;
  const accounts = o.accounts;
  const identity = o.identity ?? accounts?.identity() ?? new GuestIdentity();
  const started = clock.now();
  const admin =
    accounts && o.admin?.password
      ? {
          auth: new AdminAuth(o.admin.user, o.admin.password, o.admin.secret, () => clock.now()),
          svc: new AdminService(accounts, accounts.activity, {
            now: () => clock.now(),
            game: (id) => store.game?.(id),
            live: () => ({
              sockets: wss.clients.size, queued: queue.size, rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), uptimeS: Math.round((clock.now() - started) / 1000),
              rooms: rooms.all().map((r) => r.info()),
            }),
          }),
          hosting: o.hosting,
        }
      : undefined;
  const api = accounts ? accountsApi(accounts, { allowedOrigins: o.allowedOrigins, now: () => clock.now(), admin }) : null;
  /** table activity, for the admin panel's log (moves themselves are in each game's record) */
  const track = (c: Client, kind: string, data?: Record<string, unknown>, error?: string) =>
    accounts && c.id && accounts.track({ kind, userId: c.id.userId, name: c.id.name, ip: c.ip, ok: !error, error, data: { ...data, ...(c.room ? { table: c.room.code } : {}) } });
  const store = o.store ?? new MemoryStore();
  const log = o.log ?? (() => {});
  const rate = o.rate ?? RATE;
  const onGameOver = (r: GameOverReport) => {
    o.onGameOver?.(r);
    if (accounts) void settleOnline(r);
  };
  const badge = accounts ? (userId: string) => accounts.badge(userId) : undefined;
  const rooms = new Rooms({ store, clock, log, onGameOver, badge, graceMs: o.graceMs, lobbyHoldMs: o.lobbyHoldMs }, o.limits);
  /** each signed-in connection's way into a room, for the matchmaker */
  const entrances = new Map<string, (room: Room) => ReturnType<Room["join"]>>();
  const queue = new Matchmaker(rooms, clock, (conn, room) => {
    const enter = entrances.get(conn.id);
    return enter ? enter(room) : "bad_state";
  }, o.queueWaitMs, log);

  /** Pay out an online game to every signed-in player and tell them what they earned. */
  async function settleOnline(r: GameOverReport) {
    try {
      const results = await accounts!.recordOnline(r);
      for (const ws of wss.clients) {
        const c = (ws as WebSocket & { heist?: Client }).heist;
        const res = c?.id ? results.get(c.id.userId) : undefined;
        if (res && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "reward", game: r.game, reward: res.reward, progress: res.me.progress } satisfies ServerMsg));
      }
      rooms.byId(r.roomId)?.touch();
    } catch (e) {
      log("settle failed", { game: r.gameId, err: String(e) });
    }
  }
  // a suspended player is dropped from every socket at once (their seat plays dead weight from then on)
  if (accounts)
    accounts.onBan = (userId) => {
      for (const ws of wss.clients) {
        const c = (ws as WebSocket & { heist?: Client }).heist;
        if (c?.id?.userId !== userId) continue;
        ws.send(JSON.stringify(errMsg("suspended", "This account has been suspended.")));
        ws.close();
      }
    };
  const restored = rooms.restore();
  if (restored) log("restored tables", { count: restored });

  const http = createServer(async (req, res) => {
    if (api && (await api(req, res))) return;
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      const cpu = process.cpuUsage();
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, sockets: wss.clients.size, queued: queue.size, rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));
      return;
    }
    if (o.webDir && (await serveStatic(o.webDir, req, res))) return;
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
  o.hosting?.start(() => wss.clients.size);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = String(req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
    const c: Client = { conn: null, id: null, room: null, tokens: rate.burst, last: clock.now(), alive: true, queue: Promise.resolve(), ip };
    const send = (m: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    const err = (code: Parameters<typeof errMsg>[0], msg?: string) => {
      c.failed = msg ?? code;
      send(errMsg(code, msg));
    };

    ws.on("pong", () => (c.alive = true));
    ws.on("close", () => {
      track(c, "online.disconnect");
      if (c.conn) {
        queue.leave(c.conn.id, false);
        entrances.delete(c.conn.id);
      }
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
      c.queue = c.queue.then(async () => {
        c.failed = undefined;
        await handle(m).catch((e) => {
          log("handler error", { t: m.t, err: String(e) });
          err("bad_state");
        });
        if (!QUIET.has(m.t)) {
          const { t, ...rest } = m as ClientMsg & Record<string, unknown>;
          track(c, `table.${t}`, scrub(rest) as Record<string, unknown>, c.failed);
        }
      });
    });

    async function handle(m: ClientMsg) {
      if (m.t === "ping") return send({ t: "pong", n: typeof m.n === "number" ? m.n : undefined, at: clock.now() });
      if (m.t === "hello") {
        if (m.v !== PROTOCOL_VERSION) return err("version", `This server speaks protocol ${PROTOCOL_VERSION}; refresh the page.`);
        if (c.id) return err("bad_state", "Already said hello");
        try {
          c.id = await identity.authenticate(m.token, m.name);
        } catch (x) {
          if (x instanceof ApiError && x.status === 403) {
            err("suspended", x.message);
            return ws.close();
          }
          throw x;
        }
        c.conn = { id: randomBytes(8).toString("base64url"), userId: c.id.userId, name: c.id.name, send };
        entrances.set(c.conn.id, (room) => enter(room, {}));
        track(c, "online.connect");
        return send({ t: "welcome", v: PROTOCOL_VERSION, userId: c.id.userId, name: c.id.name, token: c.id.token });
      }
      const conn = c.conn;
      if (!conn) return err("not_authenticated", "Say hello first");
      switch (m.t) {
        case "list":
          return send({ t: "rooms", rooms: rooms.list() });
        case "queue": {
          if (c.room?.status === "playing" && c.room.seatOf(conn.userId) !== null) return err("bad_state", "Finish or leave your game first");
          if (accounts && typeof m.stakes === "number" && !(await accounts.canAfford(conn.userId, m.stakes))) return err("no_chips", "Not enough chips for that table");
          const e = queue.join(conn, m.players, m.stakes, accounts ? await accounts.rating(conn.userId) : undefined);
          if (e) return err(e, "Pick 3 to 6 players and a buy-in");
          return;
        }
        case "unqueue":
          return queue.leave(conn.id);
        case "create": {
          queue.leave(conn.id);
          const opts = roomOptions(m.options);
          if (!opts) return err("bad_message", "Tables are for 3 to 6 players");
          // no level picked: the bots play to the host's skill
          if (accounts && !m.options?.botLevel) opts.botLevel = await accounts.botLevel(conn.userId);
          if (accounts && !(await accounts.canAfford(conn.userId, opts.stakes))) return err("no_chips", "Not enough chips for that table");
          const room = rooms.create(opts);
          if (!room) return err("bad_state", "The server is full right now");
          enter(room, {});
          return;
        }
        case "join": {
          queue.leave(conn.id);
          const room = rooms.get(m.code);
          if (!room) return err("no_room", "No table with that code");
          const takesSeat = m.spectate !== true && room.status === "lobby" && room.seatOf(conn.userId) === null;
          if (accounts && takesSeat && !(await accounts.canAfford(conn.userId, room.stakes))) return err("no_chips", "Not enough chips for that table");
          enter(room, { spectate: m.spectate === true, since: m.since });
          return;
        }
        case "leave":
          queue.leave(conn.id, false);
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
        case "drink": {
          if (typeof m.id !== "string") return err("bad_message");
          const d = room.drinkTargets(conn.id, m.to);
          if (typeof d === "string") return err(d);
          if (accounts) {
            if (accounts.drinkPrice(m.id, d.to.length) === null) return err("bad_message", "No such drink");
            try {
              await accounts.payForDrink(conn.userId, m.id, d.to.length);
            } catch (x) {
              return err(x instanceof ApiError ? "no_coins" : "bad_state", x instanceof ApiError ? x.message : undefined);
            }
            for (const seat of d.to) {
              const uid = room.userAt(seat);
              if (uid) void accounts.drinkReceived(uid).catch(() => {});
            }
          } else if (!DRINK_IDS.has(m.id)) return err("bad_message", "No such drink");
          room.sendDrink(conn.id, d.from, d.to, m.id);
          return;
        }
        default:
          return err("bad_message", "Unknown message");
      }
      if (e) err(e);
    }

    function enter(room: Room, opts: { spectate?: boolean; since?: number }): ReturnType<Room["join"]> {
      const conn = c.conn!;
      if (c.room && c.room !== room) c.room.leave(conn.id);
      else if (c.room === room) room.disconnect(conn.id);
      const e = room.join(conn, opts);
      if (e) {
        c.room = null;
        err(e);
        return e;
      }
      c.room = room;
      return null;
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
    queue,
    port: () => (http.address() as { port: number }).port,
    async close() {
      o.hosting?.stop();
      clearInterval(beat);
      queue.close();
      for (const ws of wss.clients) ws.terminate();
      rooms.closeAll();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      await store.flush();
      await accounts?.store.flush();
      await accounts?.activity.flush();
    },
  };
}

function errMsg(code: Extract<ServerMsg, { t: "error" }>["code"], msg?: string): ServerMsg {
  return { t: "error", code, msg: msg ?? code.replace(/_/g, " ") };
}
