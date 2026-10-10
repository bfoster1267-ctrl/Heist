// Hosted-database mode against a real Postgres. Runs when TEST_DATABASE_URL points at an empty scratch
// database (CI starts one); skipped otherwise. Each test starts from empty tables.
import { newProgress } from "@heist/profile";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileActivityLog, type ActivityEvent, type SoloRecord } from "../src/accounts/activity";
import { AdminTeam } from "../src/accounts/admins";
import { FileAccountStore, type Account } from "../src/accounts/store";
import { openDatabase, type Database } from "../src/db/index";
import { PgPool, parseUrl } from "../src/db/pg";
import type { HeistServer } from "../src/server";
import { FileStore, type GameStart } from "../src/store";

const url = process.env.TEST_DATABASE_URL;
const dirs: string[] = [];
const open: Database[] = [];
const servers: HeistServer[] = [];
// each test's instances let go of the data before the next test starts
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {});
  for (const d of open.splice(0)) await d.close().catch(() => {});
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const account = (id: string, name: string, chips: number): Account => ({
  id,
  name,
  createdAt: 1,
  guest: false,
  logins: [{ provider: "email", subject: `${name.toLowerCase()}@example.com` }],
  email: `${name.toLowerCase()}@example.com`,
  progress: { ...newProgress(), chips },
  solo: null,
  sessions: 0,
});
const start = (gameId: string, at: number): GameStart => ({ gameId, roomId: "r_" + gameId, code: gameId.toUpperCase().slice(0, 5), game: 1, seed: 7, seats: [{ name: "Ann", bot: false, userId: "u_a" }, { name: "Bot", bot: true, userId: null }], stakes: 0, isPrivate: false, hostId: null, turnSeconds: 30, at });
const solo = (gameId: string): SoloRecord => ({ gameId, userId: "u_a", name: "Ann", seed: 3, players: 3, stakes: 10, setup: {} as SoloRecord["setup"], answers: [], startedAt: 5, endedAt: 9, quit: false, winners: [0] });

async function fresh(o: { dataDir?: string } = {}) {
  const db = await openDatabase(url!, { ...o, log: process.env.DBLOG ? (m, x) => console.log("  [db]", m, JSON.stringify(x ?? {})) : undefined });
  open.push(db);
  return db;
}

describe.skipIf(!url)("hosted database", () => {
  beforeEach(async () => {
    const pool = new PgPool(parseUrl(url!), 1);
    await pool.query("DROP TABLE IF EXISTS kv, accounts, activity, games, game_moves, solo_games");
    await pool.close();
  });

  it("copies the disk's files in once, and reads back exactly what the files held", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-import-"));
    dirs.push(dir);
    // a disk as the file stores leave it
    const files = new FileAccountStore(dir, 0);
    await files.put(account("u_a", "Ann", 500));
    await files.put(account("u_b", "Ben", 20));
    await files.flush();
    const log = new FileActivityLog(dir);
    const at = Date.UTC(2026, 8, 30);
    for (let i = 0; i < 5; i++) log.add({ at: at + i * 86_400_000, kind: i % 2 ? "shop.buy" : "auth.login", userId: i < 3 ? "u_a" : "u_b", name: "x", data: { i, text: "héllo 'quotes' \"too\"" } });
    log.saveSolo(solo("s1"));
    await log.flush();
    const games = new FileStore(dir);
    games.started(start("g_done", 10));
    games.answered("g_done", { seat: 0, a: { kind: "hire", count: 1 }, by: "player" });
    games.ended("g_done", { winners: [0], reason: "footholds", at: 20 });
    games.started(start("g_open", 30));
    games.answered("g_open", { seat: 0, a: { kind: "hire", count: 2 }, by: "player" });
    games.answered("g_open", { seat: 1, a: { kind: "hire", count: 0 }, by: "bot" });
    await games.flush();
    await new Promise((r) => setTimeout(r, 50)); // the finished game moves to games/done/
    const team = AdminTeam.inDir(dir);
    await team.set("helper", "a-long-password-1", "admin", 7);
    team.setLayout("helper", ["live", "bill"]);

    const db = await fresh({ dataDir: dir });
    await db.takeOver();
    expect(await db.accounts.all()).toEqual(await files.all());
    expect((await db.accounts.byLogin({ provider: "email", subject: "ben@example.com" }))?.id).toBe("u_b");
    const want = await new FileActivityLog(dir).query({ limit: 100 });
    expect(await db.activity.query({ limit: 100 })).toEqual(want);
    expect(db.activity.lastSeen("u_b")).toBe(new FileActivityLog(dir).lastSeen("u_b"));
    expect(await db.activity.solo("s1")).toEqual(solo("s1"));
    expect(await db.games.unfinished()).toEqual(await new FileStore(dir).unfinished());
    expect(await db.games.game("g_done")).toEqual(await new FileStore(dir).game("g_done"));
    expect(db.team.get("helper")).toEqual(team.get("helper"));
    expect(db.team.layout("helper")).toEqual(["live", "bill"]);
    await db.close();

    // a second start (and a later deploy) doesn't import again
    const again = await fresh({ dataDir: dir });
    await again.takeOver();
    const n = await again.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM activity");
    expect(n.rows[0].n).toBe(5);
    await again.close();
  });

  it("hands the data over from the old instance to the new one with nothing lost", async () => {
    const old = await fresh();
    await old.takeOver();
    await old.accounts.put(account("u_a", "Ann", 100));
    old.games.started(start("g1", 1));
    old.games.answered("g1", { seat: 0, a: { kind: "hire", count: 1 }, by: "player" });

    // the new instance starts while the old one is still serving: it waits
    const next = await fresh();
    let took = false;
    const taking = next.takeOver().then(() => (took = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(took).toBe(false);

    // the old one keeps playing until it's told to stop, then writes the rest and lets go
    await old.accounts.put(account("u_a", "Ann", 250));
    old.games.answered("g1", { seat: 1, a: { kind: "hire", count: 0 }, by: "bot" });
    old.activity.add({ at: 99, kind: "auth.login", userId: "u_a" });
    await old.close();
    await taking;

    expect((await next.accounts.get("u_a"))?.progress.chips).toBe(250);
    const [g] = await next.games.unfinished();
    expect(g.start.gameId).toBe("g1");
    expect(g.answers.map((a) => a.by)).toEqual(["player", "bot"]);
    expect((await next.activity.query({})).map((e) => e.at)).toEqual([99]);
    // and carries on numbering the moves where the old one stopped
    next.games.answered("g1", { seat: 0, a: { kind: "hire", count: 3 }, by: "player" });
    next.games.ended("g1", { winners: [1], reason: "last_call", at: 5 });
    const rec = await next.games.game("g1");
    expect(rec?.answers).toHaveLength(3);
    expect(rec?.end?.reason).toBe("last_call");
    expect(await next.games.unfinished()).toEqual([]);
  });

  it("reads the activity log back past what's kept in memory, with filters", async () => {
    const db = await fresh();
    await db.takeOver();
    const at = 1_000;
    for (let i = 0; i < 7; i++) db.activity.add({ at: at + i, kind: i % 2 ? "shop.buy" : "auth.login", userId: i < 3 ? "u_a" : "u_b", data: { i } });
    await db.close();
    const again = await openDatabase(url!);
    open.push(again);
    // only 3 events kept in memory
    (again.activity as unknown as { keep: number }).keep = 3;
    await again.takeOver();
    expect(again.activity.window()).toHaveLength(3);
    const i = (evs: ActivityEvent[]) => evs.map((e) => e.data!.i);
    expect(i(await again.activity.query({ limit: 100 }))).toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(i(await again.activity.query({ userId: "u_a", kinds: ["shop."] }))).toEqual([1]);
    expect(i(await again.activity.query({ kinds: ["auth.login"], before: at + 4 }))).toEqual([2, 0]);
    expect(i(await again.activity.query({ before: at + 4, limit: 2 }))).toEqual([3, 2]);
    expect(i(await again.activity.query({ from: at + 1, to: at + 2 }))).toEqual([2, 1]);
    expect(i(await again.activity.query({ skip: (e) => e.userId === "u_b" }))).toEqual([2, 1, 0]);
  });

  it("a deploy: the new server answers its health check at once, waits for the old one, then picks the table up mid-game", async () => {
    // loaded here so the store tests above run anywhere
    const { startServer } = await import("../src/server");
    const { HeistClient } = await import("../src/client");
    const { GuestIdentity } = await import("../src/identity");
    const { simpleAnswer } = await import("./helpers");
    const FAST = { burst: 1000, perSec: 1000 };
    const secret = "test-secret";
    const until = async (f: () => boolean, ms = 5000) => {
      const end = Date.now() + ms;
      while (!f()) {
        if (Date.now() > end) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    const db1 = await fresh();
    const srv1 = await startServer({ port: 0, host: "127.0.0.1", store: db1.games, identity: new GuestIdentity(secret), rate: FAST, ready: db1.takeOver() });
    await srv1.ready;
    const ann = new HeistClient(`ws://127.0.0.1:${srv1.port()}/ws`, { name: "Ann", reconnect: false });
    await ann.connect();
    ann.create({ players: 3 });
    await until(() => !!ann.room);
    const code = ann.room!.code;
    ann.start();
    await until(() => !!ann.ask);

    // the new version starts next to the old one
    const db2 = await fresh();
    const srv2 = await startServer({ port: 0, host: "127.0.0.1", store: db2.games, identity: new GuestIdentity(secret), rate: FAST, ready: db2.takeOver() });
    servers.push(srv2);
    const health = await (await fetch(`http://127.0.0.1:${srv2.port()}/healthz`)).json();
    expect(health.ok).toBe(true);
    expect(health.ready).toBe(false);
    // someone reaching the new server early just waits for their welcome
    const early = new HeistClient(`ws://127.0.0.1:${srv2.port()}/ws`, { name: "Ben", reconnect: false });
    let welcomed = false;
    const earlyIn = early.connect().then(() => (welcomed = true));
    await new Promise((r) => setTimeout(r, 200));
    expect(welcomed).toBe(false);
    expect(srv2.rooms.get(code)).toBeUndefined();

    // Render stops the old one: it writes the rest and lets go
    await srv1.close();
    await db1.close();
    await srv2.ready;
    await earlyIn;
    expect(srv2.rooms.get(code)?.status).toBe("playing");

    // Ann's app reconnects (to the new server) and plays on to the end
    const back = new HeistClient(`ws://127.0.0.1:${srv2.port()}/ws`, { name: "Ann", token: (ann as unknown as { token: string }).token });
    let view: import("@heist/engine").GameState | null = null;
    const over = new Promise((resolve) => back.on("gameOver", resolve));
    back.onAny((m) => {
      if (m.t === "sync") view = m.state;
      if (m.t === "frames" && m.frames.length) view = m.frames[m.frames.length - 1].state;
      if (m.t === "ask" && view) {
        const a = simpleAnswer(m.ask, view);
        setTimeout(() => back.ask?.askId === m.askId && back.answer(a), 1);
      }
    });
    await back.connect();
    expect(back.userId).toBe(ann.userId);
    back.join(code);
    await until(() => back.seat === 0);
    await over;
    early.close();
    back.close();
  }, 30_000);

  it("refuses to import over a database that already has accounts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-import-"));
    dirs.push(dir);
    const files = new FileAccountStore(dir, 0);
    await files.put(account("u_disk", "Disk", 1));
    await files.flush();
    const db = await fresh();
    await db.takeOver();
    await db.accounts.put(account("u_db", "Db", 2));
    await db.close();
    const next = await fresh({ dataDir: dir });
    await next.takeOver();
    expect((await next.accounts.all()).map((a) => a.id)).toEqual(["u_db"]);
  });
});
