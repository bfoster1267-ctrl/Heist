import { Bot, runBots, type Answer, type GameState } from "@heist/engine";
import { createSoloGame } from "@heist/profile";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileActivityLog } from "../src/accounts/activity";
import { AdminAuth } from "../src/accounts/admin";
import { AccountService } from "../src/accounts/service";
import { HeistClient } from "../src/client";
import type { ServerMsg } from "../src/protocol";
import { startServer, type HeistServer } from "../src/server";
import { MemoryStore } from "../src/store";
import { simpleAnswer } from "./helpers";

const servers: HeistServer[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

function playSolo(seed: number, players: number) {
  const { game, bots } = createSoloGame(seed, players, "Me", true);
  const me = new Bot(seed + 99);
  const answers: Answer[] = [];
  for (;;) {
    runBots(game, bots);
    const p = game.pending;
    if (!p) break;
    const a = me.answer(game, p);
    game.answer(p.seat, a);
    answers.push(a);
  }
  return answers;
}

describe("admin sign-in", () => {
  it("takes only the right username and password, and its sessions expire", () => {
    let t = 1_000;
    const auth = new AdminAuth("boss", "a-long-admin-password", "secret", () => t);
    expect(auth.login("boss", "wrong")).toBeNull();
    expect(auth.login("someone", "a-long-admin-password")).toBeNull();
    const s = auth.login("Boss ", "a-long-admin-password")!;
    expect(auth.check(s.token)).toBe(true);
    expect(auth.check(s.token.replace(/.$/, "x"))).toBe(false);
    expect(new AdminAuth("boss", "another-password-entirely", "secret", () => t).check(s.token)).toBe(false); // a new password signs everyone out
    t += 9 * 60 * 60_000;
    expect(auth.check(s.token)).toBe(false);
  });
});

describe("activity log", () => {
  it("keeps events in monthly files and reads them back, newest first, with filters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-activity-"));
    dirs.push(dir);
    const log = new FileActivityLog(dir, 3);
    const at = Date.UTC(2026, 9, 8);
    for (let i = 0; i < 6; i++) log.add({ at: at + i, kind: i % 2 ? "shop.buy" : "auth.login", userId: i < 3 ? "u_a" : "u_b", data: { i } });
    log.add({ at: Date.UTC(2026, 10, 1), kind: "shop.buy", userId: "u_a", data: { i: 6 } });
    await log.flush();
    const again = new FileActivityLog(dir, 3);
    expect(again.query({ limit: 100 }).map((e) => e.data!.i)).toEqual([6, 5, 4, 3, 2, 1, 0]); // past memory, from the files
    expect(again.query({ userId: "u_a", kinds: ["shop."] }).map((e) => e.data!.i)).toEqual([6, 1]);
    expect(again.query({ before: at + 4, limit: 2 }).map((e) => e.data!.i)).toEqual([3, 2]);
    expect(again.lastSeen("u_b")).toBe(at + 5);
  });
});

describe("admin panel API", () => {
  it("records what players do, without passwords, and shows the owner everything", async () => {
    const accounts = new AccountService({ secret: "s" });
    const store = new MemoryStore();
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, store, admin: { user: "admin", password: "a-long-admin-password" }, rate: { burst: 1000, perSec: 1000 } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const call = async (method: string, path: string, body?: object, token?: string) => {
      const r = await fetch(base + path, {
        method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };

    // a player signs up, shops, uses the app and plays
    const ann = (await call("POST", "/api/auth/register", { email: "ann@x.com", password: "anns-password", name: "Ann" })).body;
    await call("POST", "/api/shop/buy", { id: "title.smooth" }, ann.token);
    await call("POST", "/api/shop/buy", { id: "no.such.thing" }, ann.token);
    await call("POST", "/api/track", { events: [{ kind: "screen", name: "Lobby" }, { kind: "tap", name: "Play now" }, { kind: "BAD kind", name: "x" }] }, ann.token);
    expect((await call("POST", "/api/track", { events: [] })).status).toBe(401);

    const start = (await call("POST", "/api/solo/start", { players: 3, stakes: 100 }, ann.token)).body;
    const answers = playSolo(start.seed, 3);
    expect((await call("POST", "/api/solo/finish", { gameId: start.gameId, answers }, ann.token)).status).toBe(200);

    const c = new HeistClient(`ws://127.0.0.1:${srv.port()}/ws`, { token: ann.token });
    let view: GameState | null = null;
    const seen: ServerMsg[] = [];
    c.onAny((m) => {
      seen.push(m);
      if (m.t === "sync") view = m.state;
      if (m.t === "frames" && m.frames.length) view = m.frames[m.frames.length - 1].state;
      if (m.t === "ask" && view) c.answer(simpleAnswer(m.ask, view));
    });
    await c.connect();
    c.create({ players: 3, stakes: 0 });
    await until(() => !!c.room);
    c.chat("gl all");
    c.start();
    await until(() => seen.some((m) => m.t === "reward"), 20_000);
    c.close();

    // the admin panel
    expect((await call("GET", "/api/admin/overview")).status).toBe(401);
    expect((await call("GET", "/api/admin/overview", undefined, ann.token)).status).toBe(401); // a player's token is no good here
    expect((await call("POST", "/api/admin/login", { user: "admin", password: "nope" })).status).toBe(401);
    const { token } = (await call("POST", "/api/admin/login", { user: "admin", password: "a-long-admin-password" })).body;
    const get = async (path: string) => (await call("GET", path, undefined, token)).body;

    const ov = await get("/api/admin/overview");
    expect(ov.accounts).toMatchObject({ registered: 1 });
    expect(ov.active.day).toBe(1);
    expect(ov.daily.at(-1)).toMatchObject({ signups: 1, games: 2, active: 1 });
    expect(ov.live.rooms.length).toBe(1);

    const list = await get("/api/admin/accounts?q=ann");
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ name: "Ann", email: "ann@x.com", games: 2 });
    const one = await get(`/api/admin/accounts/${ann.me.id}`);
    expect(one.account.hasPassword).toBe(true);
    expect(JSON.stringify(one)).not.toContain("scrypt");
    expect(one.account).not.toHaveProperty("password");

    const all = (await get(`/api/admin/activity?user=${ann.me.id}&limit=500`)).events as { kind: string; ok?: boolean; error?: string; data?: any }[];
    const kinds = all.map((e) => e.kind);
    for (const k of ["auth.register", "shop.buy", "ui.screen", "ui.tap", "solo.start", "solo.finish", "game.solo", "online.connect", "table.create", "table.chat", "table.start", "game.online"])
      expect(kinds).toContain(k);
    expect(kinds).not.toContain("ui.BAD kind");
    expect(JSON.stringify(all)).not.toContain("anns-password");
    expect(all.find((e) => e.kind === "auth.register")!.data.password).toBe("(hidden)");
    expect(all.find((e) => e.kind === "table.chat")!.data).toMatchObject({ text: "gl all" });
    expect(all.find((e) => e.kind === "shop.buy" && e.ok === false)!.error).toBeTruthy();
    const fin = all.find((e) => e.kind === "solo.finish")!.data;
    expect(fin.moves).toBe(answers.length);
    expect(fin.answers).toBeUndefined(); // the moves stay in the game record

    const shop = (await get(`/api/admin/activity?kinds=shop.,ui.tap`)).events;
    expect(new Set(shop.map((e: { kind: string }) => e.kind))).toEqual(new Set(["shop.buy", "ui.tap"]));
    expect((await get(`/api/admin/activity?text=gl%20all`)).events).toHaveLength(1);

    // every game, move by move
    const solo = await get(`/api/admin/games/${start.gameId}`);
    expect(solo.mode).toBe("solo");
    expect(solo.broken).toBeUndefined();
    expect(solo.moments.filter((m: { t: string; by?: string }) => m.t === "move" && m.by === "player")).toHaveLength(answers.length);
    const onlineId = all.find((e) => e.kind === "game.online")!.data.gameId;
    const online = await get(`/api/admin/games/${onlineId}`);
    expect(online.mode).toBe("online");
    expect(online.broken).toBeUndefined();
    expect(online.moments.some((m: { t: string }) => m.t === "say")).toBe(true);
    expect(online.moments.filter((m: { t: string }) => m.t === "move").length).toBe(store.game(onlineId)!.answers.length);
    expect((await call("GET", "/api/admin/games/nope", undefined, token)).status).toBe(404);

    const logins = (await get(`/api/admin/activity?kinds=admin.login`)).events;
    expect(logins.map((e: { ok: boolean }) => e.ok)).toEqual([true, false]);
  }, 30_000);

  it("is off without an admin password", async () => {
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts: new AccountService({ secret: "s" }) });
    servers.push(srv);
    const r = await fetch(`http://127.0.0.1:${srv.port()}/api/admin/login`, { method: "POST", body: JSON.stringify({ user: "admin", password: "" }) });
    expect(r.status).toBe(404);
  });
});
