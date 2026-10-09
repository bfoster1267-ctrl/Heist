import { Bot, runBots, type Answer, type GameState } from "@heist/engine";
import { createSoloGame } from "@heist/profile";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileActivityLog } from "../src/accounts/activity";
import { AdminAuth, AdminTeam } from "../src/accounts/admin";
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
  it("takes only the right username and password, and its sessions expire", async () => {
    let t = 1_000;
    const auth = new AdminAuth("boss", "a-long-admin-password", "secret", () => t);
    expect(await auth.login("boss", "wrong")).toBeNull();
    expect(await auth.login("someone", "a-long-admin-password")).toBeNull();
    const s = (await auth.login("Boss ", "a-long-admin-password"))!;
    expect(auth.check(s.token)).toEqual({ user: "boss", role: "owner" });
    expect(auth.check(s.token.replace(/.$/, "x"))).toBeNull();
    expect(new AdminAuth("boss", "another-password-entirely", "secret", () => t).check(s.token)).toBeNull(); // a new password signs everyone out
    t += 9 * 60 * 60_000;
    expect(auth.check(s.token)).toBeNull();
  });

  it("lets the owner add admins with their own passwords, and remove them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-team-"));
    dirs.push(dir);
    const auth = new AdminAuth("boss", "a-long-admin-password", "secret", Date.now, AdminTeam.inDir(dir));
    const owner = { user: "boss", role: "owner" as const };
    await expect(auth.addMember(owner, "Sam", "short")).rejects.toThrow(/12 characters/);
    await expect(auth.addMember(owner, "boss", "a-good-long-password")).rejects.toThrow(/owner/);
    expect((await auth.addMember(owner, "Sam", "sams-long-password")).map((m) => m.user)).toEqual(["sam"]);
    const s = (await auth.login("sam", "sams-long-password"))!;
    expect(s.role).toBe("admin");
    expect(auth.check(s.token)).toEqual({ user: "sam", role: "admin" });
    await expect(auth.addMember({ user: "sam", role: "admin" }, "eve", "eves-long-password")).rejects.toThrow(/Only the owner/);
    // kept on disk, password hashed
    const again = new AdminAuth("boss", "a-long-admin-password", "secret", Date.now, AdminTeam.inDir(dir));
    expect(again.check(s.token)).toEqual({ user: "sam", role: "admin" });
    expect(readFileSync(join(dir, "admins.json"), "utf8")).not.toContain("sams-long-password");
    // a new password, or removal, signs them out
    await auth.addMember(owner, "sam", "a-new-long-password");
    expect(auth.check(s.token)).toBeNull();
    const s2 = (await auth.login("sam", "a-new-long-password"))!;
    auth.team.setLayout("sam", ["people", "chips"]);
    expect(auth.team.layout("sam")).toEqual(["people", "chips"]);
    auth.removeMember(owner, "sam");
    expect(auth.check(s2.token)).toBeNull();
    expect(await auth.login("sam", "a-new-long-password")).toBeNull();
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
        method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(path === "/api/admin/login" ? { "x-forwarded-for": "10.9.9.9" } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };

    // a player signs up, shops, uses the app and plays
    const ann = (await call("POST", "/api/auth/register", { email: "ann@x.com", password: "anns-password", name: "Ann" })).body;
    await call("POST", "/api/shop/buy", { id: "title.smooth" }, ann.token);
    await call("POST", "/api/shop/buy", { id: "no.such.thing" }, ann.token);
    await call("POST", "/api/chips/daily", {}, ann.token);
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
    const me = (await call("GET", "/api/me", undefined, ann.token)).body;
    const eco = await get("/api/admin/economy");
    expect(eco.circulation.chips).toBe(me.progress.chips);
    expect(eco.flows.start.all).toBe(10_000);
    expect(eco.flows.daily.all).toBe(500);
    expect(eco.circulation.untracked).toBe(0); // every chip accounted for
    expect(eco.players.played).toBe(1);
    expect(eco.daily.at(-1).added).toBeGreaterThanOrEqual(10_500);
    expect((await get("/api/admin/me"))).toMatchObject({ user: "admin", role: "owner", layout: null });
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

    const logins = (await get(`/api/admin/activity?kinds=admin.login&mine=1`)).events;
    expect(logins.map((e: { ok: boolean }) => e.ok)).toEqual([true, false]);
  }, 30_000);

  it("keeps notes, tags and flags on a player, and a suspension locks them out until it's lifted", async () => {
    const accounts = new AccountService({ secret: "s" });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, admin: { user: "admin", password: "a-long-admin-password" } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const call = async (method: string, path: string, body?: object, token?: string) => {
      const r = await fetch(base + path, {
        method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(path === "/api/admin/login" ? { "x-forwarded-for": "10.9.9.9" } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    const sam = (await call("POST", "/api/auth/register", { email: "sam@x.com", password: "sams-password", name: "Sam" })).body;
    const { token } = (await call("POST", "/api/admin/login", { user: "admin", password: "a-long-admin-password" })).body;
    const admin = (path: string, body: object) => call("POST", `/api/admin/accounts/${sam.me.id}/${path}`, body, token);
    const seenBefore = (await call("GET", `/api/admin/accounts/${sam.me.id}`, undefined, token)).body.row.lastSeen;

    expect((await call("POST", `/api/admin/accounts/${sam.me.id}/note`, { text: "hi" }, sam.token)).status).toBe(401); // players can't
    await admin("note", { text: "Asked about refunds in chat" });
    const n = (await admin("note", { text: "Second note" })).body.crm.notes;
    expect(n.map((x: { text: string }) => x.text)).toEqual(["Second note", "Asked about refunds in chat"]);
    await admin("unnote", { id: n[0].id });
    await admin("tags", { tags: ["VIP", "tester", "VIP", "", 5] });
    await admin("flag", { reason: "Wins too often" });

    let one = (await call("GET", `/api/admin/accounts/${sam.me.id}`, undefined, token)).body;
    expect(one.account.crm).toMatchObject({ tags: ["VIP", "tester"], flag: { reason: "Wins too often" }, notes: [{ text: "Asked about refunds in chat" }] });
    expect(one.row).toMatchObject({ flagged: true, banned: false, notes: 1, lastSeen: seenBefore }); // the owner's edits aren't the player being active
    expect((await call("GET", `/api/me`, undefined, sam.token)).body).not.toHaveProperty("crm");
    expect((await call("GET", `/api/admin/accounts?tag=vip`, undefined, token)).body.rows).toHaveLength(1);
    expect((await call("GET", `/api/admin/accounts?show=flagged`, undefined, token)).body.rows).toHaveLength(1);

    // suspended: dropped from the table socket, locked out of the API and sign-in, off the leaderboard
    const c = new HeistClient(`ws://127.0.0.1:${srv.port()}/ws`, { token: sam.token });
    const seen: ServerMsg[] = [];
    c.onAny((m) => seen.push(m));
    await c.connect();
    await admin("ban", { reason: "Chip farming", days: 7 });
    await until(() => seen.some((m) => m.t === "error" && m.code === "suspended"));
    const me = await call("GET", "/api/me", undefined, sam.token);
    expect(me.status).toBe(403);
    expect(me.body.error).toMatch(/suspended until .*Chip farming/);
    expect((await call("POST", "/api/auth/login", { email: "sam@x.com", password: "sams-password" })).status).toBe(403);
    expect((await call("GET", `/api/admin/accounts?show=banned`, undefined, token)).body.rows).toHaveLength(1);
    const again = new HeistClient(`ws://127.0.0.1:${srv.port()}/ws`, { token: sam.token });
    const seen2: ServerMsg[] = [];
    again.onAny((m) => seen2.push(m));
    void again.connect().catch(() => {});
    await until(() => seen2.some((m) => m.t === "error" && m.code === "suspended"));
    again.close();
    c.close();

    await admin("ban", { days: 0 });
    expect((await call("GET", "/api/me", undefined, sam.token)).status).toBe(200);
    one = (await call("GET", `/api/admin/accounts/${sam.me.id}`, undefined, token)).body;
    expect(one.account.crm.ban).toBeNull();
    const log = (await call("GET", `/api/admin/activity?user=${sam.me.id}&kinds=admin.`, undefined, token)).body.events.map((e: { kind: string }) => e.kind);
    expect(log).toEqual(["admin.ban", "admin.ban", "admin.flag", "admin.tags", "admin.unnote", "admin.note", "admin.note"]);
  }, 20_000);

  it("counts people, not accounts: one device or one address of guests is one person, and the owner is left out", async () => {
    const accounts = new AccountService({ secret: "s" });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, admin: { user: "admin", password: "a-long-admin-password" }, rate: { burst: 1000, perSec: 1000 } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const call = async (path: string, body: object, where: { ip: string; device?: string }, token?: string) => {
      const r = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", "x-forwarded-for": where.ip, ...(where.device ? { "x-heist-device": where.device } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      return r.json();
    };
    const get = async (path: string, token: string) => (await fetch(base + path, { headers: { authorization: `Bearer ${token}` } })).json();

    // the owner, on their own wifi and phone, opens a pile of guests
    const home = { ip: "10.0.0.1", device: "owner-phone-1" };
    for (let i = 0; i < 4; i++) await call("/api/auth/guest", {}, home);
    await call("/api/auth/guest", {}, { ip: "10.0.0.1" });
    // a stranger opens three guests in one browser (no device id yet) from one address
    for (let i = 0; i < 3; i++) await call("/api/auth/guest", {}, { ip: "2.2.2.2" });
    // another plays as a guest, then signs up on the same install from a new address
    await call("/api/auth/guest", {}, { ip: "3.3.3.3", device: "bob-laptop-1" });
    await call("/api/auth/register", { email: "bob@x.com", password: "bobs-password", name: "Bob" }, { ip: "4.4.4.4", device: "bob-laptop-1" });
    // two housemates sign up on one address: still two people
    await call("/api/auth/register", { email: "cat@x.com", password: "cats-password", name: "Cat" }, { ip: "5.5.5.5", device: "cat-phone-01" });
    await call("/api/auth/register", { email: "dan@x.com", password: "dans-password", name: "Dan" }, { ip: "5.5.5.5", device: "dan-phone-01" });

    const { token } = await call("/api/admin/login", { user: "admin", password: "a-long-admin-password" }, home);
    const ov = await get("/api/admin/overview", token);
    expect(ov.accounts).toMatchObject({ total: 12, guests: 9, registered: 3, people: 4, yours: 5, signedUp: 3 });
    expect(ov.active.day).toBe(4);
    expect(ov.daily.at(-1)).toMatchObject({ people: 4, active: 4 });

    const people = (await get("/api/admin/accounts?show=people", token)).rows;
    expect(people.map((r: { name: string }) => r.name).sort()).toContain("Bob");
    expect(people.length).toBe(4);
    const bob = people.find((r: { name: string }) => r.name === "Bob");
    expect(bob.personAccounts).toBe(2);
    expect((await get("/api/admin/accounts?show=all", token)).rows.length).toBe(7);
    expect((await get("/api/admin/accounts?show=all&mine=1", token)).rows.length).toBe(12);
    const detail = await get(`/api/admin/accounts/${bob.id}`, token);
    expect(detail.samePerson.length).toBe(1);
  });

  it("labels Claude's own test visits and leaves them out of the player counts", async () => {
    const accounts = new AccountService({ secret: "s" });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, admin: { user: "admin", password: "a-long-admin-password" }, rate: { burst: 1000, perSec: 1000 } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const call = async (path: string, body: object, headers: Record<string, string>, token?: string) =>
      (await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
    const get = async (path: string, token: string) => (await fetch(base + path, { headers: { authorization: `Bearer ${token}` } })).json();

    // a real player, Claude's browser (marked install id), and a Claude script (marked user agent)
    await call("/api/auth/guest", {}, { "x-forwarded-for": "7.7.7.7", "x-heist-device": "real-phone-01" });
    const browser = await call("/api/auth/guest", {}, { "x-forwarded-for": "8.8.8.8", "x-heist-device": "claude-abc12345" });
    await call("/api/track", { events: [{ kind: "tap", name: "Quick Play" }] }, { "x-forwarded-for": "8.8.8.8" }, browser.token);
    await call("/api/auth/guest", {}, { "x-forwarded-for": "9.9.9.9", "user-agent": "Mozilla/5.0 HeistClaudeTest" });

    const { token } = await call("/api/admin/login", { user: "admin", password: "a-long-admin-password" }, { "x-forwarded-for": "1.1.1.1" });
    const ov = await get("/api/admin/overview", token);
    expect(ov.accounts).toMatchObject({ total: 3, people: 1, yours: 0, claude: 2 });
    expect(ov.active.day).toBe(1);
    expect((await get("/api/admin/accounts?show=all", token)).rows.length).toBe(1);
    const all = (await get("/api/admin/accounts?show=all&mine=1", token)).rows;
    expect(all.filter((r: { claude: boolean }) => r.claude).length).toBe(2);
    // the feed shows players only; ?mine=1 brings back yours and Claude's, labeled
    const players = (await get("/api/admin/activity?limit=50", token)).events as { kind: string; ip?: string }[];
    expect(players.map((e) => e.kind).sort()).toEqual(["auth.guest"]);
    expect(players[0].ip).toBe("7.7.7.7");
    const events = (await get("/api/admin/activity?limit=50&mine=1", token)).events as { kind: string; claude?: boolean; you?: boolean; ip?: string }[];
    expect(events.find((e) => e.kind === "admin.login")?.you).toBe(true);
    // the tap carries no marker of its own, but it came from Claude's account
    expect(events.find((e) => e.kind === "ui.tap")?.claude).toBe(true);
    expect(events.filter((e) => e.kind === "auth.guest" && e.claude).length).toBe(2);
    expect(events.find((e) => e.kind === "auth.guest" && e.ip === "7.7.7.7")?.claude).toBeUndefined();
  });

  it("is off without an admin password", async () => {
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts: new AccountService({ secret: "s" }) });
    servers.push(srv);
    const r = await fetch(`http://127.0.0.1:${srv.port()}/api/admin/login`, { method: "POST", body: JSON.stringify({ user: "admin", password: "" }) });
    expect(r.status).toBe(404);
  });
});
