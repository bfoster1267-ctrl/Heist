// The accounts HTTP API, served next to the game socket. JSON in and out; the session token goes in an
// `Authorization: Bearer` header. Every route is listed in packages/server/README.md.

import type { IncomingMessage, ServerResponse } from "node:http";
import { scrub } from "./activity";
import type { AdminAuth, AdminService } from "./admin";
import { ApiError, type AccountService } from "./service";

const BODY_LIMIT = 16 * 1024;
/** a finished solo game posts every answer the player gave */
const SOLO_BODY_LIMIT = 512 * 1024;
/** sign-in attempts per address per window */
const AUTH_TRIES = 20;
const AUTH_WINDOW_MS = 10 * 60_000;
/** admin sign-in attempts per address per window */
const ADMIN_TRIES = 10;
/** app activity reports per player per minute, and events per report */
const TRACK_PER_MIN = 60;
const TRACK_EVENTS = 50;
/** opening the app counts once per player per this long */
const OPEN_EVERY_MS = 10 * 60_000;

export interface ApiOptions {
  /** browser origins allowed to call the API (empty = any) */
  allowedOrigins?: string[];
  now?: () => number;
  /** the owner's admin panel (off when no admin password is set) */
  admin?: { auth: AdminAuth; svc: AdminService };
}

/** "POST /api/shop/buy" -> "shop.buy" */
const kindOf = (key: string) => {
  if (key === "GET /api/players/:id") return "view.player";
  if (key === "GET /api/leaderboard") return "view.leaderboard";
  return key.replace(/^\w+ \/api\//, "").replace(/\//g, ".");
};

/** What's worth keeping from a route's answer, beyond the request itself. */
function outcome(key: string, out: unknown): Record<string, unknown> {
  const o = (out ?? {}) as Record<string, any>;
  const x: Record<string, unknown> = {};
  const me = o.me ?? (o.progress ? o : undefined);
  if (me?.progress) x.balance = { chips: me.progress.chips, coins: me.progress.coins };
  if (key === "POST /api/season/pack") Object.assign(x, { items: o.items, dupeXp: o.dupeXp });
  if (key === "POST /api/chips/daily") x.chips = o.chips;
  if (key === "POST /api/prestige") Object.assign(x, { coins: o.coins, unlocked: o.unlocked });
  if (key === "POST /api/solo/start") Object.assign(x, { gameId: o.gameId, players: o.players, stage: o.stage });
  if (key === "POST /api/solo/finish" || key === "POST /api/solo/quit") x.reward = o.reward && { xp: o.reward.xp, coins: o.reward.coins, payout: o.reward.payout };
  return x;
}

type Handler = (body: Record<string, unknown>, token: string | undefined, query: URLSearchParams, param: string) => Promise<unknown>;

export function accountsApi(svc: AccountService, o: ApiOptions = {}) {
  const now = o.now ?? Date.now;
  const tries = new Map<string, number[]>();
  const limited = (key: string) => {
    const t = now();
    const recent = (tries.get(key) ?? []).filter((x) => t - x < AUTH_WINDOW_MS);
    recent.push(t);
    tries.set(key, recent);
    if (tries.size > 10_000) tries.clear();
    return recent.length > AUTH_TRIES;
  };

  const me = (token: string | undefined) => svc.require(token);
  const opened = new Map<string, number>();
  const reports = new Map<string, number[]>();
  const adminTries = new Map<string, number[]>();
  const ipOf = (req: IncomingMessage) => String(req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  const within = (m: Map<string, number[]>, key: string, windowMs: number, max: number) => {
    const t = now();
    const recent = (m.get(key) ?? []).filter((x) => t - x < windowMs);
    recent.push(t);
    m.set(key, recent);
    if (m.size > 10_000) m.clear();
    return recent.length <= max;
  };

  /** The app reports screens and taps; each becomes a "ui.*" activity event. */
  async function track(body: Record<string, unknown>, token: string | undefined, ip: string) {
    const a = await me(token);
    if (!within(reports, a.id, 60_000, TRACK_PER_MIN)) throw new ApiError(429, "Slow down");
    const list = Array.isArray(body.events) ? body.events.slice(0, TRACK_EVENTS) : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const kind = typeof e.kind === "string" && /^[a-z]{2,12}$/.test(e.kind) ? e.kind : null;
      if (!kind) continue;
      const name = typeof e.name === "string" ? e.name.slice(0, 80) : "";
      const data: Record<string, unknown> = { name };
      if (e.data && typeof e.data === "object") Object.assign(data, scrub(e.data) as object);
      if (typeof e.at === "number") data.clientAt = e.at;
      svc.track({ kind: `ui.${kind}`, userId: a.id, name: a.name, ip, source: "app", data });
    }
    return { ok: true };
  }

  /** Log one API call: who, what they sent (no secrets), and how it went. */
  async function record(key: string, body: Record<string, unknown>, token: string | undefined, ip: string, out: unknown, error?: string) {
    if (key === "GET /api/config" || key === "POST /api/track") return;
    const res = out as { me?: { id: string; name: string } } | undefined;
    let who = res?.me ? { id: res.me.id, name: res.me.name } : null;
    if (!who) {
      const a = await svc.fromToken(token).catch(() => null);
      if (a) who = { id: a.id, name: a.name };
    }
    if (key === "GET /api/me") {
      if (!who || now() - (opened.get(who.id) ?? 0) < OPEN_EVERY_MS) return;
      opened.set(who.id, now());
      if (opened.size > 50_000) opened.clear();
      svc.track({ kind: "app.open", userId: who.id, name: who.name, ip });
      return;
    }
    // a finished game's moves are kept with the game itself (the admin panel replays them)
    const sent = key === "POST /api/solo/finish" && Array.isArray(body.answers) ? { ...body, answers: undefined, moves: body.answers.length } : body;
    const data = { ...(scrub(sent) as object), ...(error ? {} : outcome(key, out)) };
    svc.track({ kind: kindOf(key), userId: who?.id, name: who?.name, ip, ok: !error, error, data: Object.keys(data).length ? data : undefined });
  }

  /** /api/admin/*: the owner's panel. Its own sign-in; never a player's token. */
  async function adminRoute(req: IncomingMessage, res: ServerResponse, url: URL, ip: string) {
    const admin = o.admin;
    if (!admin) return send(res, 404, { error: "Not found" });
    const path = url.pathname.slice("/api/admin".length);
    try {
      if (req.method === "POST" && path === "/login") {
        if (!within(adminTries, ip, 15 * 60_000, ADMIN_TRIES)) throw new ApiError(429, "Too many tries. Wait 15 minutes.");
        const b = await readBody(req, BODY_LIMIT);
        const s = admin.auth.login(b.user, b.password);
        svc.track({ kind: "admin.login", ip, ok: !!s, error: s ? undefined : "wrong username or password", data: { user: typeof b.user === "string" ? b.user.slice(0, 60) : null } });
        if (!s) throw new ApiError(401, "Wrong username or password");
        return send(res, 200, s);
      }
      const auth = req.headers.authorization;
      if (!admin.auth.check(auth?.startsWith("Bearer ") ? auth.slice(7) : undefined)) throw new ApiError(401, "Please sign in");
      if (req.method !== "GET") throw new ApiError(404, "Not found");
      const q = url.searchParams;
      const id = path.match(/^\/(accounts|games)\/([\w-]{1,60})$/);
      if (path === "/overview") return send(res, 200, await admin.svc.overview());
      if (path === "/accounts") return send(res, 200, await admin.svc.list(q));
      if (path === "/activity") return send(res, 200, admin.svc.activity(q));
      if (path === "/live") return send(res, 200, (await admin.svc.overview()).live);
      if (id?.[1] === "accounts") {
        const a = await admin.svc.account(id[2]);
        return a ? send(res, 200, a) : send(res, 404, { error: "No such account" });
      }
      if (id?.[1] === "games") {
        const g = admin.svc.game(id[2]);
        return g ? send(res, 200, g) : send(res, 404, { error: "That game's record isn't on this server" });
      }
      throw new ApiError(404, "Not found");
    } catch (e) {
      if (e instanceof ApiError) send(res, e.status, { error: e.message });
      else {
        console.error(e);
        send(res, 500, { error: "Something went wrong" });
      }
    }
  }

  const routes: Record<string, Handler> = {
    "GET /api/config": async () => ({
      providers: [...svc.oauth.providers(), "email", ...(svc.devLogins ? ["dev"] : [])],
      ...svc.oauth.publicConfig(),
    }),
    "POST /api/auth/guest": async (b) => svc.guest(b.token, b.name),
    "POST /api/auth/register": async (b, t) => svc.register(b.email, b.password, b.name, t),
    "POST /api/auth/login": async (b) => svc.login(b.email, b.password),
    "POST /api/auth/oauth": async (b, t) => svc.oauthSignIn(b.provider, b.credential, b.name, t),
    "POST /api/auth/dev": async (b, t) => svc.dev(b.name, t),
    "POST /api/auth/signout-everywhere": async (_, t) => svc.signOutEverywhere(await me(t)),
    "GET /api/me": async (_, t) => svc.me(await me(t)),
    "POST /api/me/name": async (b, t) => svc.rename(await me(t), b.name),
    "POST /api/me/password": async (b, t) => svc.changePassword(await me(t), b.current, b.password),
    "POST /api/me/delete": async (_, t) => (await svc.remove(await me(t)), { ok: true }),
    "POST /api/prestige": async (_, t) => svc.prestige(await me(t)),
    "POST /api/shop/buy": async (b, t) => svc.buy(await me(t), b.id),
    "POST /api/shop/equip": async (b, t) => svc.equip(await me(t), b.id),
    "POST /api/season/pack": async (b, t) => svc.openPack(await me(t), b.paid),
    "POST /api/chips/refill": async (_, t) => svc.refill(await me(t)),
    "POST /api/chips/daily": async (_, t) => svc.daily(await me(t)),
    "POST /api/solo/start": async (b, t) => svc.soloStart(await me(t), b.players, b.stakes, b.scaled, b.campaign),
    "POST /api/solo/finish": async (b, t) => svc.soloFinish(await me(t), b.gameId, b.answers),
    "POST /api/solo/quit": async (_, t) => svc.soloQuit(await me(t)),
    "POST /api/solo/drink": async (b, t) => {
      const count = typeof b.count === "number" && Number.isInteger(b.count) && b.count >= 1 && b.count <= 5 ? b.count : 1;
      return svc.payForDrink((await me(t)).id, b.id, count);
    },
    "GET /api/leaderboard": async (_, __, q) => ({ rows: await svc.leaderboard(q.get("by")) }),
    "GET /api/players/:id": async (_, __, ___, id) => svc.publicProfile(id),
  };

  function cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (origin) {
      if (o.allowedOrigins?.length && !o.allowedOrigins.includes(origin)) return false;
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader("access-control-max-age", "600");
    }
    return true;
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function readBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          reject(new ApiError(413, "Too big"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString());
          resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
        } catch {
          reject(new ApiError(400, "Bad JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  /** Handles /api/* requests; returns false for anything else. */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/")) return false;
    if (!cors(req, res)) {
      send(res, 403, { error: "Origin not allowed" });
      return true;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return true;
    }
    const ip = ipOf(req);
    if (url.pathname.startsWith("/api/admin/")) {
      await adminRoute(req, res, url, ip);
      return true;
    }
    let key = `${req.method} ${url.pathname}`;
    let param = "";
    const player = url.pathname.match(/^\/api\/players\/([\w-]{1,40})$/);
    if (player && req.method === "GET") {
      key = "GET /api/players/:id";
      param = player[1];
    }
    const route = key === "POST /api/track" ? (b: Record<string, unknown>, t: string | undefined) => track(b, t, ip) : routes[key];
    if (!route) {
      send(res, 404, { error: "Not found" });
      return true;
    }
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    let body: Record<string, unknown> = {};
    try {
      if (key.startsWith("POST /api/auth/") || key === "POST /api/me/password") {
        if (limited(ip)) throw new ApiError(429, "Too many tries. Wait a few minutes and try again.");
      }
      body = req.method === "POST" ? await readBody(req, key === "POST /api/solo/finish" ? SOLO_BODY_LIMIT : BODY_LIMIT) : {};
      if (param) body = { ...body, id: param };
      const out = await route(body, token, url.searchParams, param);
      send(res, 200, out);
      await record(key, body, token, ip, out).catch((e) => console.error("activity", e));
    } catch (e) {
      await record(key, body, token, ip, undefined, e instanceof ApiError ? e.message : "server error").catch(() => {});
      if (e instanceof ApiError) send(res, e.status, { error: e.message });
      else {
        console.error(e);
        send(res, 500, { error: "Something went wrong" });
      }
    }
    return true;
  };
}
