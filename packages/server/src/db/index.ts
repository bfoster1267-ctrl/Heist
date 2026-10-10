// Hosted-database mode (DATABASE_URL set): accounts, the activity log, game logs and the admin team live in
// Postgres instead of files on a disk. With no disk attached, Render can run the new version next to the
// old one and switch traffic over without a gap (a zero-downtime deploy). Two instances must never write at
// once, so the data has one owner at a time, held as a Postgres advisory lock on its own connection:
//
//   1. The new instance starts, answers /healthz, and waits for the lock (requests and socket messages wait).
//   2. Render sees it healthy, sends traffic to it, and SIGTERMs the old instance.
//   3. The old instance closes its sockets (players' apps reconnect, to the new instance), writes what's
//      left, and lets go of the lock.
//   4. The new instance takes the lock, loads everything, rebuilds the tables mid-game, and gets going.
//
// The first start in this mode also copies the disk's files in, once (importFiles).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "../accounts/store";
import type { ActivityEvent, SoloRecord } from "../accounts/activity";
import { FileStore } from "../store";
import { PgPool, parseUrl, type PgConnection } from "./pg";
import { PgAccountStore, PgActivityLog, PgAdminTeam, PgGameStore, Writer } from "./stores";

/** the advisory lock key the owning instance holds ("HEIST" in ASCII) */
const OWNER_LOCK = 0x4845495354;
/** taken for a moment while creating tables, so two instances don't race on it */
const SCHEMA_LOCK = 0x4845495355;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS activity (seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, at bigint NOT NULL, user_id text, kind text NOT NULL, ev jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS activity_at ON activity (at, seq);
CREATE INDEX IF NOT EXISTS activity_user ON activity (user_id, at);
CREATE TABLE IF NOT EXISTS games (id text PRIMARY KEY, start jsonb NOT NULL, started_at bigint NOT NULL, ended jsonb, ended_at bigint);
CREATE INDEX IF NOT EXISTS games_running ON games (started_at) WHERE ended IS NULL;
CREATE TABLE IF NOT EXISTS game_moves (game_id text NOT NULL, n int NOT NULL, move jsonb NOT NULL, PRIMARY KEY (game_id, n));
CREATE TABLE IF NOT EXISTS solo_games (id text PRIMARY KEY, user_id text, ended_at bigint, data jsonb NOT NULL);
`;

type Log = (msg: string, extra?: object) => void;

export interface Database {
  pool: PgPool;
  writer: Writer;
  accounts: PgAccountStore;
  activity: PgActivityLog;
  games: PgGameStore;
  team: PgAdminTeam;
  /** Wait for the data to be ours (the old instance hands over), copy the disk in once, load. */
  takeOver(): Promise<void>;
  /** sizes for the admin panel's Server page */
  sizes(): Promise<{ totalMb: number; parts: { name: string; mb: number; files: number }[] }>;
  /** Write everything left, then let go of the data (the next instance takes over). */
  close(): Promise<void>;
}

export async function openDatabase(url: string, o: { log?: Log; dataDir?: string; onLost?: () => void } = {}): Promise<Database> {
  const log = o.log ?? (() => {});
  const cfg = parseUrl(url);
  const pool = new PgPool(cfg, 4);
  const first = await pool.connect();
  try {
    await first.script(`BEGIN; SELECT pg_advisory_xact_lock(${SCHEMA_LOCK}); ${SCHEMA} COMMIT;`);
  } finally {
    await first.close();
  }
  const writer = new Writer(pool, log);
  const accounts = new PgAccountStore(pool, writer);
  const activity = new PgActivityLog(pool, writer);
  const games = new PgGameStore(pool, writer);
  const team = new PgAdminTeam(pool, writer);

  let lock: PgConnection | null = null;
  let closing = false;

  async function holdLock(wait: boolean): Promise<boolean> {
    const c = await pool.connect();
    lock = c; // so close() can end a wait that is still going
    const sql = wait ? `SELECT pg_advisory_lock(${OWNER_LOCK}) AS ok` : `SELECT pg_try_advisory_lock(${OWNER_LOCK}) AS ok`;
    let ok = false;
    try {
      const { rows } = await c.query<{ ok: boolean | string }>(sql);
      ok = wait || rows[0]?.ok === true;
    } finally {
      if (!ok) {
        lock = null;
        await c.close();
      }
    }
    if (ok) c.onClose = (e) => void lost(e);
    return ok;
  }

  /** The lock's connection dropped (the database restarted?): take it back, or stop if someone else has it. */
  async function lost(e: Error) {
    lock = null;
    if (closing) return;
    log("database lock connection lost", { err: String(e) });
    for (let i = 0; i < 15 && !closing; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        if (await holdLock(false)) return log("database lock taken back");
        break; // another instance owns the data now: this one must stop
      } catch {
        // database still away: try again
      }
    }
    if (closing) return;
    log("lost ownership of the data: stopping");
    o.onLost?.();
  }

  return {
    pool,
    writer,
    accounts,
    activity,
    games,
    team,
    async takeOver() {
      const t0 = Date.now();
      if (!(await holdLock(false))) {
        log("waiting for the running instance to hand over the database");
        await holdLock(true);
      }
      if (o.dataDir) await importFiles(pool, o.dataDir, log);
      const n = await accounts.load();
      const ev = await activity.load();
      await team.load();
      log("database ready", { accounts: n, events: ev, waitedMs: Date.now() - t0 });
    },
    async sizes() {
      const { rows } = await pool.query<{ name: string; bytes: number; n: number }>(
        `SELECT name, pg_total_relation_size(name::regclass) AS bytes, (SELECT reltuples FROM pg_class WHERE oid = name::regclass) AS n
         FROM unnest(ARRAY['accounts','activity','games','game_moves','solo_games','kv']) AS name`,
      );
      const total = await pool.query<{ bytes: number }>("SELECT pg_database_size(current_database()) AS bytes");
      const mb = (b: number) => Math.round((b / 2 ** 20) * 100) / 100;
      const label: Record<string, string> = { accounts: "Accounts", activity: "Activity log", games: "Online games", game_moves: "Online game moves", solo_games: "Games vs bots", kv: "Settings" };
      return { totalMb: mb(total.rows[0].bytes), parts: rows.map((r) => ({ name: label[r.name] ?? r.name, mb: mb(r.bytes), files: Math.max(0, Math.round(r.n)) })) };
    },
    async close() {
      writer.stopping = true;
      await writer.flush();
      closing = true;
      const l = lock as PgConnection | null;
      lock = null;
      await l?.close(); // ends the session, which releases the lock
      await pool.close();
    },
  };
}

/** a batch INSERT on one connection (used by the one-time import) */
async function insertRows(c: PgConnection, table: string, cols: string[], conflict: string, rows: unknown[][]) {
  const per = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const params: unknown[] = [];
    const tuples = rows.slice(i, i + per).map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(",")})`);
    await c.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")} ${conflict}`, params);
  }
}

const readJsonLines = (file: string): unknown[] => {
  const out: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a line cut short by a crash
    }
  }
  return out;
};
const list = (dir: string, re: RegExp) => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).sort() : []);

export interface ImportCounts {
  accounts: number;
  admins: number;
  events: number;
  games: number;
  moves: number;
  solo: number;
}

/**
 * Copy the disk's files (DATA_DIR: accounts.json, admins.json, activity/, games/) into the database, once.
 * All in one transaction, marked done in the same transaction, so a crash halfway leaves nothing behind
 * and the next start tries again. Skipped if it was done before, if there are no files, or if the
 * database already has accounts from somewhere else.
 */
export async function importFiles(pool: PgPool, dataDir: string, log: Log = () => {}): Promise<ImportCounts | null> {
  const done = await pool.query("SELECT value FROM kv WHERE key = 'imported_from_files'");
  if (done.rows.length) return null;
  const accountsFile = join(dataDir, "accounts.json");
  if (!existsSync(accountsFile)) return null;
  const already = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts");
  if (already.rows[0].n > 0) {
    log("not importing the disk: the database already has accounts", { accounts: already.rows[0].n });
    return null;
  }
  const t0 = Date.now();
  const counts: ImportCounts = { accounts: 0, admins: 0, events: 0, games: 0, moves: 0, solo: 0 };
  await pool.tx(async (c) => {
    const accounts = JSON.parse(readFileSync(accountsFile, "utf8")) as Account[];
    await insertRows(c, "accounts", ["id", "data"], "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", accounts.map((a) => [a.id, JSON.stringify(a)]));
    counts.accounts = accounts.length;

    const adminsFile = join(dataDir, "admins.json");
    if (existsSync(adminsFile)) {
      const team = JSON.parse(readFileSync(adminsFile, "utf8"));
      await c.query("INSERT INTO kv (key, value) VALUES ('admins', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(team)]);
      counts.admins = team.members?.length ?? 0;
    }

    const actDir = join(dataDir, "activity");
    for (const f of list(actDir, /^\d{4}-\d{2}\.jsonl$/)) {
      const evs = readJsonLines(join(actDir, f)) as ActivityEvent[];
      // the id is where the line was, so running this twice can't double an event
      await insertRows(c, "activity", ["id", "at", "user_id", "kind", "ev"], "ON CONFLICT (id) DO NOTHING", evs.map((e, i) => [`file:${f.slice(0, 7)}:${i}`, e.at, e.userId ?? null, e.kind, JSON.stringify(e)]));
      counts.events += evs.length;
    }

    const gameDirs = [join(dataDir, "games", "done"), join(dataDir, "games")];
    for (const dir of gameDirs) {
      for (const f of list(dir, /\.jsonl$/)) {
        const rec = FileStore.parse(readFileSync(join(dir, f), "utf8"));
        if (!rec?.start?.gameId) continue;
        const id = rec.start.gameId;
        await c.query("INSERT INTO games (id, start, started_at, ended, ended_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING", [
          id,
          JSON.stringify(rec.start),
          rec.start.at ?? 0,
          rec.end ? JSON.stringify(rec.end) : null,
          rec.end?.at ?? null,
        ]);
        await insertRows(c, "game_moves", ["game_id", "n", "move"], "ON CONFLICT (game_id, n) DO NOTHING", rec.answers.map((a, n) => [id, n, JSON.stringify(a)]));
        counts.games++;
        counts.moves += rec.answers.length;
      }
    }

    const soloDir = join(dataDir, "games", "solo");
    const solos: unknown[][] = [];
    for (const f of list(soloDir, /\.json$/)) {
      try {
        const r = JSON.parse(readFileSync(join(soloDir, f), "utf8")) as SoloRecord;
        solos.push([r.gameId, r.userId, r.endedAt, JSON.stringify(r)]);
      } catch {
        // a half-written file
      }
    }
    await insertRows(c, "solo_games", ["id", "user_id", "ended_at", "data"], "ON CONFLICT (id) DO NOTHING", solos);
    counts.solo = solos.length;

    await c.query("INSERT INTO kv (key, value) VALUES ('imported_from_files', $1)", [JSON.stringify({ at: Date.now(), dataDir, ...counts })]);
  });
  log("imported the disk into the database", { ...counts, ms: Date.now() - t0 });
  return counts;
}
