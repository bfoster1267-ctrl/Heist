// The accounts HTTP API, served next to the game socket. JSON in and out; the session token goes in an
// `Authorization: Bearer` header. Every route is listed in packages/server/README.md.

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, type AccountService } from "./service";

const BODY_LIMIT = 16 * 1024;
/** a finished solo game posts every answer the player gave */
const SOLO_BODY_LIMIT = 512 * 1024;
/** sign-in attempts per address per window */
const AUTH_TRIES = 20;
const AUTH_WINDOW_MS = 10 * 60_000;

export interface ApiOptions {
  /** browser origins allowed to call the API (empty = any) */
  allowedOrigins?: string[];
  now?: () => number;
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
    "POST /api/solo/start": async (b, t) => svc.soloStart(await me(t), b.players, b.stakes, b.scaled),
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
    let key = `${req.method} ${url.pathname}`;
    let param = "";
    const player = url.pathname.match(/^\/api\/players\/([\w-]{1,40})$/);
    if (player && req.method === "GET") {
      key = "GET /api/players/:id";
      param = player[1];
    }
    const route = routes[key];
    if (!route) {
      send(res, 404, { error: "Not found" });
      return true;
    }
    try {
      if (key.startsWith("POST /api/auth/") || key === "POST /api/me/password") {
        const who = String(req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
        if (limited(who)) throw new ApiError(429, "Too many tries. Wait a few minutes and try again.");
      }
      const body = req.method === "POST" ? await readBody(req, key === "POST /api/solo/finish" ? SOLO_BODY_LIMIT : BODY_LIMIT) : {};
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
      send(res, 200, await route(body, token, url.searchParams, param));
    } catch (e) {
      if (e instanceof ApiError) send(res, e.status, { error: e.message });
      else {
        console.error(e);
        send(res, 500, { error: "Something went wrong" });
      }
    }
    return true;
  };
}
