// The Postgres versions of the server's stores (DATABASE_URL set). They keep the same shape as the file
// stores: everything the game reads often stays in memory, and every change is written behind, in order,
// through one Writer. Reads that reach past memory (old activity, a finished game's moves, a solo game)
// go to the database.
//
// Only one server instance owns the data at a time (see db/index.ts: the deploy lock), so the in-memory
// copies never go stale.

import type { GameEnd, GameRecord, GameStart, GameStore, StoredAnswer } from "../store";
import { MemoryAccountStore, type Account } from "../accounts/store";
import { matches, MemoryActivityLog, type ActivityEvent, type ActivityQuery, type SoloRecord } from "../accounts/activity";
import { AdminTeam } from "../accounts/admins";
import type { PgPool } from "./pg";
import { randomBytes } from "node:crypto";

type Stmt = { sql: string; params: unknown[] };
/** a row for a multi-row INSERT; consecutive rows for the same table go in one statement */
type Row = { table: string; cols: string[]; conflict: string; values: unknown[] };
/** worked out when the batch is written, so repeated changes to one thing write once, with its latest state */
type Op = Stmt | Row | (() => Stmt | null);

const ROWS_PER_INSERT = 500;

/**
 * Writes queued changes in order, in batches, one transaction per batch. A failed batch is retried (the
 * database restarting, a network blip) with backoff; every write is safe to repeat.
 */
export class Writer {
  private ops: Op[] = [];
  private running: Promise<void> | null = null;
  private idle: (() => void)[] = [];
  private backoff = 250;
  /** set once the owner is shutting down: give up after a few failed tries instead of retrying forever */
  stopping = false;

  constructor(
    private db: PgPool,
    private log: (msg: string, extra?: object) => void = () => {},
  ) {}

  push(op: Op) {
    this.ops.push(op);
    this.running ??= this.drain();
  }

  get pending() {
    return this.ops.length;
  }

  private async drain() {
    let failures = 0;
    await new Promise((r) => setImmediate(r)); // let a burst of changes pile up into one batch
    while (this.ops.length) {
      const batch = this.ops.splice(0, 5000);
      try {
        await this.db.tx(async (c) => {
          for (const s of compile(batch)) await c.query(s.sql, s.params);
        });
        this.backoff = 250;
        failures = 0;
      } catch (e) {
        failures++;
        this.log("database write failed", { err: String(e), ops: batch.length, try: failures });
        if (this.stopping && failures >= 5) {
          this.log("database writes dropped", { ops: batch.length + this.ops.length });
          this.ops.length = 0;
          break;
        }
        this.ops.unshift(...batch);
        await new Promise((r) => setTimeout(r, this.backoff));
        this.backoff = Math.min(this.backoff * 2, 15_000);
      }
    }
    this.running = null;
    for (const f of this.idle.splice(0)) f();
  }

  /** Wait until every change queued so far is in the database. */
  flush(): Promise<void> {
    if (!this.running && !this.ops.length) return Promise.resolve();
    this.running ??= this.drain();
    return new Promise((r) => this.idle.push(r));
  }
}

function compile(batch: Op[]): Stmt[] {
  const out: Stmt[] = [];
  let group: Row[] = [];
  const close = () => {
    for (let i = 0; i < group.length; i += ROWS_PER_INSERT) {
      const part = group.slice(i, i + ROWS_PER_INSERT);
      const { table, cols, conflict } = part[0];
      const params: unknown[] = [];
      const tuples = part.map((r) => `(${r.values.map((v) => (params.push(v), `$${params.length}`)).join(",")})`);
      out.push({ sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")} ${conflict}`, params });
    }
    group = [];
  };
  for (const op of batch) {
    const s = typeof op === "function" ? op() : op;
    if (!s) continue;
    if ("table" in s) {
      const g = group[0];
      if (g && (g.table !== s.table || g.conflict !== s.conflict || g.cols.join() !== s.cols.join())) close();
      group.push(s);
    } else {
      close();
      out.push(s);
    }
  }
  close();
  return out;
}

const json = (v: unknown) => JSON.stringify(v);

/** Accounts: all in memory (as with the file store), each change upserted. */
export class PgAccountStore extends MemoryAccountStore {
  private dirty = new Set<string>();

  constructor(
    private db: PgPool,
    private writer: Writer,
  ) {
    super();
  }

  async load() {
    this.byId.clear();
    this.logins.clear();
    const { rows } = await this.db.query<{ data: Account }>("SELECT data FROM accounts");
    for (const { data } of rows) {
      this.byId.set(data.id, data);
      this.index(data);
    }
    return rows.length;
  }

  async put(a: Account) {
    await super.put(a);
    if (this.dirty.has(a.id)) return; // already queued: it writes the latest state
    this.dirty.add(a.id);
    this.writer.push(() => {
      this.dirty.delete(a.id);
      const now = this.byId.get(a.id);
      return now ? { sql: "INSERT INTO accounts (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()", params: [a.id, json(now)] } : null;
    });
  }

  flush() {
    return this.writer.flush();
  }
}

/** The activity log: the newest events in memory, every event in the table. */
export class PgActivityLog extends MemoryActivityLog {
  constructor(
    private db: PgPool,
    private writer: Writer,
    keep?: number,
  ) {
    super(keep);
  }

  async load() {
    this.events = [];
    this.last.clear();
    const seen = await this.db.query<{ user_id: string; at: number }>(
      "SELECT user_id, max(at) AS at FROM activity WHERE user_id IS NOT NULL AND kind NOT LIKE 'admin.%' GROUP BY user_id",
    );
    for (const r of seen.rows) this.last.set(r.user_id, r.at);
    const { rows } = await this.db.query<{ ev: ActivityEvent }>("SELECT ev FROM (SELECT ev, at, seq FROM activity ORDER BY at DESC, seq DESC LIMIT $1) t ORDER BY at, seq", [this.keep]);
    for (const r of rows) this.remember(r.ev);
    return rows.length;
  }

  add(e: ActivityEvent) {
    this.remember(e);
    this.writer.push({ table: "activity", cols: ["id", "at", "user_id", "kind", "ev"], conflict: "ON CONFLICT (id) DO NOTHING", values: [randomBytes(9).toString("base64url"), e.at, e.userId ?? null, e.kind, json(e)] });
  }

  /** Older than memory: page back through the table, filtering as the memory part does. */
  protected async older(q: ActivityQuery, limit: number, text: string | null): Promise<ActivityEvent[]> {
    await this.writer.flush();
    const out: ActivityEvent[] = [];
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    if (q.userId) where.push(`user_id = ${p(q.userId)}`);
    if (q.from !== undefined) where.push(`at >= ${p(q.from)}`);
    if (q.to !== undefined) where.push(`at <= ${p(q.to)}`);
    if (q.kinds?.length) {
      const exact = q.kinds.filter((k) => !k.endsWith("."));
      const prefixes = q.kinds.filter((k) => k.endsWith("."));
      const any = [...(exact.length ? [`kind IN (SELECT jsonb_array_elements_text(${p(json(exact))}::jsonb))`] : []), ...prefixes.map((k) => `starts_with(kind, ${p(k)})`)];
      where.push(`(${any.join(" OR ")})`);
    }
    let cursor: { at: number; seq: number } | null = null;
    const before = q.before ?? Infinity;
    for (let page = 0; page < 50 && out.length < limit; page++) {
      const w = [...where];
      const ps = [...params];
      const pp = (v: unknown) => (ps.push(v), `$${ps.length}`);
      if (cursor) w.push(`(at, seq) < (${pp(cursor.at)}, ${pp(cursor.seq)})`);
      else if (Number.isFinite(before)) w.push(`at < ${pp(before)}`);
      const { rows } = await this.db.query<{ ev: ActivityEvent; at: number; seq: number }>(
        `SELECT ev, at, seq FROM activity ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY at DESC, seq DESC LIMIT 1000`,
        ps,
      );
      for (const r of rows) if (out.length < limit && matches(r.ev, q, text)) out.push(r.ev);
      if (rows.length < 1000) break;
      const lastRow = rows[rows.length - 1];
      cursor = { at: lastRow.at, seq: lastRow.seq };
    }
    return out;
  }

  saveSolo(r: SoloRecord) {
    this.writer.push({ table: "solo_games", cols: ["id", "user_id", "ended_at", "data"], conflict: "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ended_at = EXCLUDED.ended_at", values: [r.gameId, r.userId, r.endedAt, json(r)] });
  }

  async solo(gameId: string): Promise<SoloRecord | undefined> {
    await this.writer.flush();
    const { rows } = await this.db.query<{ data: SoloRecord }>("SELECT data FROM solo_games WHERE id = $1", [gameId]);
    return rows[0]?.data;
  }

  flush() {
    return this.writer.flush();
  }
}

/** Online game logs: one row per game, one row per move. */
export class PgGameStore implements GameStore {
  /** moves written so far per running game (each move's number is its key, so a retried write can't double it) */
  private moves = new Map<string, number>();

  constructor(
    private db: PgPool,
    private writer: Writer,
  ) {}

  started(g: GameStart) {
    this.moves.set(g.gameId, 0);
    this.writer.push({ sql: "INSERT INTO games (id, start, started_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", params: [g.gameId, json(g), g.at] });
  }

  answered(gameId: string, a: StoredAnswer) {
    const n = this.moves.get(gameId) ?? 0;
    this.moves.set(gameId, n + 1);
    this.writer.push({ table: "game_moves", cols: ["game_id", "n", "move"], conflict: "ON CONFLICT (game_id, n) DO NOTHING", values: [gameId, n, json(a)] });
  }

  ended(gameId: string, e: GameEnd) {
    this.moves.delete(gameId);
    this.writer.push({ sql: "UPDATE games SET ended = $2, ended_at = $3 WHERE id = $1", params: [gameId, json(e), e.at] });
  }

  async unfinished(): Promise<GameRecord[]> {
    await this.writer.flush();
    const games = await this.db.query<{ id: string; start: GameStart }>("SELECT id, start FROM games WHERE ended IS NULL ORDER BY started_at");
    if (!games.rows.length) return [];
    const moves = await this.db.query<{ game_id: string; move: StoredAnswer }>("SELECT game_id, move FROM game_moves WHERE game_id IN (SELECT jsonb_array_elements_text($1::jsonb)) ORDER BY game_id, n", [json(games.rows.map((g) => g.id))]);
    const by = new Map<string, GameRecord>(games.rows.map((g) => [g.id, { start: g.start, answers: [], end: null }]));
    for (const m of moves.rows) by.get(m.game_id)?.answers.push(m.move);
    for (const [id, rec] of by) this.moves.set(id, rec.answers.length);
    return [...by.values()];
  }

  async game(gameId: string): Promise<GameRecord | undefined> {
    await this.writer.flush();
    const g = await this.db.query<{ start: GameStart; ended: GameEnd | null }>("SELECT start, ended FROM games WHERE id = $1", [gameId]);
    if (!g.rows[0]) return undefined;
    const m = await this.db.query<{ move: StoredAnswer }>("SELECT move FROM game_moves WHERE game_id = $1 ORDER BY n", [gameId]);
    return { start: g.rows[0].start, answers: m.rows.map((r) => r.move), end: g.rows[0].ended };
  }

  flush() {
    return this.writer.flush();
  }
}

/** The admin team, kept as one JSON value. */
export class PgAdminTeam extends AdminTeam {
  constructor(
    private db: PgPool,
    private writer: Writer,
  ) {
    super();
  }

  async load() {
    const { rows } = await this.db.query<{ value: { members?: []; layouts?: {} } }>("SELECT value FROM kv WHERE key = 'admins'");
    const v = rows[0]?.value;
    this.data = { members: v?.members ?? [], layouts: v?.layouts ?? {} };
  }

  protected save() {
    this.writer.push(() => ({ sql: "INSERT INTO kv (key, value) VALUES ('admins', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", params: [json(this.data)] }));
  }
}
