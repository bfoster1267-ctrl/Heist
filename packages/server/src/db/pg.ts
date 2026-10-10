// A small Postgres client: the wire protocol (v3) over node:net / node:tls, with password, MD5 and
// SCRAM-SHA-256 sign-in, one statement at a time per connection, text parameters and results, and a
// little pool. It covers what the server's stores need and nothing more, so the server keeps zero
// database dependencies (the container build stays `npm ci` on the same lockfile). Swapping in the
// `pg` package later only touches this file.

import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { connect as tcp, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** disable: plain TCP; prefer (default): TLS when the server offers it; require: TLS or fail; verify-full: TLS with a checked certificate */
  ssl: "disable" | "prefer" | "require" | "verify-full";
}

/** Read a postgres:// URL (the DATABASE_URL Render gives a service). */
export function parseUrl(url: string): PgConfig {
  const u = new URL(url);
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new Error("DATABASE_URL must start with postgres://");
  const mode = u.searchParams.get("sslmode") ?? "prefer";
  const ssl = mode === "disable" || mode === "require" || mode === "verify-full" ? mode : mode === "verify-ca" ? "verify-full" : "prefer";
  return {
    host: decodeURIComponent(u.hostname) || "localhost",
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || decodeURIComponent(u.username),
    ssl,
  };
}

export class PgError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface Result<R = Record<string, any>> {
  rows: R[];
  /** the command tag's row count (INSERT/UPDATE/DELETE/SELECT) */
  count: number;
}

// type OIDs whose text form we turn into JS values; everything else stays a string
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 1700]);
const JSONISH = new Set([114, 3802]);
const parseValue = (oid: number, s: string) => (oid === 16 ? s === "t" : NUMERIC.has(oid) ? Number(s) : JSONISH.has(oid) ? JSON.parse(s) : s);

const toText = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === "string" ? v : typeof v === "boolean" ? (v ? "t" : "f") : typeof v === "number" || typeof v === "bigint" ? String(v) : JSON.stringify(v);

/** One message out: a type byte (none for the startup packets), a length, the body. */
function frame(type: string | null, body: Buffer) {
  const head = Buffer.alloc(type ? 5 : 4);
  if (type) head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, type ? 1 : 0);
  return Buffer.concat([head, body]);
}
const cstr = (s: string) => Buffer.from(s + "\0", "utf8");
const i16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

interface Pending {
  fields: { name: string; oid: number }[];
  rows: Record<string, unknown>[];
  count: number;
  error: PgError | null;
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
}

/** One connection. Statements queue up and run one after another. */
export class PgConnection {
  private sock!: Socket | TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private waiting: Pending[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private onAuth: ((type: string, body: Buffer) => void) | null = null;
  dead: Error | null = null;
  /** called once if the connection drops after it was up */
  onClose: ((e: Error) => void) | null = null;

  static async open(cfg: PgConfig, timeoutMs = 10_000): Promise<PgConnection> {
    const c = new PgConnection();
    await c.start(cfg, timeoutMs);
    return c;
  }

  private async start(cfg: PgConfig, timeoutMs: number) {
    let sock: Socket | TLSSocket = await new Promise<Socket>((resolve, reject) => {
      const s = tcp({ host: cfg.host, port: cfg.port });
      s.setTimeout(timeoutMs, () => s.destroy(new Error(`Timed out reaching the database at ${cfg.host}:${cfg.port}`)));
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
    if (cfg.ssl !== "disable") {
      sock.write(frame(null, Buffer.concat([i32(80877103)])));
      const answer = await new Promise<string>((resolve, reject) => {
        sock.once("data", (d) => resolve(d.toString("latin1", 0, 1)));
        sock.once("error", reject);
      });
      if (answer === "S") {
        const plain = sock as Socket;
        sock = await new Promise<TLSSocket>((resolve, reject) => {
          const t = tlsConnect({ socket: plain, servername: /^[\d.]+$|:/.test(cfg.host) ? undefined : cfg.host, rejectUnauthorized: cfg.ssl === "verify-full" });
          t.once("secureConnect", () => resolve(t));
          t.once("error", reject);
        });
      } else if (cfg.ssl === "require" || cfg.ssl === "verify-full") {
        sock.destroy();
        throw new Error("The database doesn't offer TLS but the URL asks for sslmode=require");
      }
    }
    this.sock = sock;
    sock.setTimeout(0);
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 30_000);
    sock.on("data", (d) => this.receive(d));
    sock.on("error", (e) => this.fail(e));
    sock.on("close", () => this.fail(new Error("The database connection closed")));

    // startup, then sign in
    const params = Buffer.concat([i32(196608), cstr("user"), cstr(cfg.user), cstr("database"), cstr(cfg.database), cstr("application_name"), cstr("heist-server"), cstr("client_encoding"), cstr("UTF8"), Buffer.from([0])]);
    await new Promise<void>((resolve, reject) => {
      let scram: { nonce: string; bare: string; serverSig?: Buffer } | null = null;
      const done = (e?: Error) => {
        this.onAuth = null;
        if (e) {
          this.sock.destroy();
          reject(e);
        } else resolve();
      };
      this.waiting.push({ fields: [], rows: [], count: 0, error: null, resolve: () => done(), reject: (e) => done(e) });
      this.onAuth = (type, body) => {
        if (type !== "R") return;
        const code = body.readInt32BE(0);
        if (code === 0) return; // signed in; ReadyForQuery finishes the startup
        if (code === 3) return this.write("p", cstr(cfg.password));
        if (code === 5) {
          const md5 = (s: string | Buffer) => createHash("md5").update(s).digest("hex");
          return this.write("p", cstr("md5" + md5(Buffer.concat([Buffer.from(md5(cfg.password + cfg.user)), body.subarray(4, 8)]))));
        }
        if (code === 10) {
          const mechs = body.toString("utf8", 4).split("\0");
          if (!mechs.includes("SCRAM-SHA-256")) return done(new Error(`The database wants ${mechs.join(", ")} sign-in, which this client doesn't speak`));
          const nonce = randomBytes(18).toString("base64");
          const bare = `n=*,r=${nonce}`;
          scram = { nonce, bare };
          const first = Buffer.from(`n,,${bare}`);
          return this.write("p", Buffer.concat([cstr("SCRAM-SHA-256"), i32(first.length), first]));
        }
        if (code === 11 && scram) {
          const serverFirst = body.toString("utf8", 4);
          const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
          if (!attrs.r?.startsWith(scram.nonce) || !attrs.s || !attrs.i) return done(new Error("The database's SCRAM answer didn't check out"));
          const salted = pbkdf2Sync(cfg.password, Buffer.from(attrs.s, "base64"), Number(attrs.i), 32, "sha256");
          const hmac = (k: Buffer, s: string) => createHmac("sha256", k).update(s).digest();
          const clientKey = hmac(salted, "Client Key");
          const stored = createHash("sha256").update(clientKey).digest();
          const withoutProof = `c=biws,r=${attrs.r}`;
          const auth = `${scram.bare},${serverFirst},${withoutProof}`;
          const sig = hmac(stored, auth);
          const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
          scram.serverSig = hmac(hmac(salted, "Server Key"), auth);
          return this.write("p", Buffer.from(`${withoutProof},p=${proof.toString("base64")}`));
        }
        if (code === 12 && scram?.serverSig) {
          const v = Buffer.from(body.toString("utf8", 4).replace(/^v=/, "").split(",")[0], "base64");
          if (v.length !== scram.serverSig.length || !timingSafeEqual(v, scram.serverSig)) return done(new Error("The database's SCRAM signature didn't match"));
          return;
        }
        done(new Error(`Unsupported database sign-in method (${code})`));
      };
      this.sock.write(frame(null, params));
    });
  }

  private write(type: string, body: Buffer) {
    this.sock.write(frame(type, body));
  }

  private fail(e: Error) {
    if (this.dead) return;
    this.dead = e;
    for (const p of this.waiting.splice(0)) p.reject(e);
    this.onClose?.(e);
  }

  private receive(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.message(type, body);
    }
  }

  private message(type: string, body: Buffer) {
    const p = this.waiting[0];
    switch (type) {
      case "R":
        this.onAuth?.(type, body);
        return;
      case "E": {
        const fields: Record<string, string> = {};
        let at = 0;
        while (at < body.length && body[at] !== 0) {
          const end = body.indexOf(0, at + 1);
          fields[String.fromCharCode(body[at])] = body.toString("utf8", at + 1, end);
          at = end + 1;
        }
        const e = new PgError(fields.M ?? "Database error", fields.C);
        if (this.onAuth) {
          // a failed sign-in: the server hangs up without a ReadyForQuery
          this.onAuth = null;
          this.waiting.shift()?.reject(e);
          return;
        }
        if (p) p.error ??= e;
        return;
      }
      case "T": {
        if (!p) return;
        const n = body.readInt16BE(0);
        let at = 2;
        p.fields = [];
        for (let i = 0; i < n; i++) {
          const end = body.indexOf(0, at);
          const name = body.toString("utf8", at, end);
          const oid = body.readInt32BE(end + 7);
          p.fields.push({ name, oid });
          at = end + 19;
        }
        return;
      }
      case "D": {
        if (!p) return;
        const n = body.readInt16BE(0);
        let at = 2;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const len = body.readInt32BE(at);
          at += 4;
          const f = p.fields[i];
          if (len < 0) row[f.name] = null;
          else {
            row[f.name] = parseValue(f.oid, body.toString("utf8", at, at + len));
            at += len;
          }
        }
        p.rows.push(row);
        return;
      }
      case "C": {
        if (!p) return;
        const tag = body.toString("utf8", 0, body.length - 1);
        const m = /(\d+)$/.exec(tag);
        p.count += m ? Number(m[1]) : 0;
        return;
      }
      case "Z": {
        const done = this.waiting.shift();
        if (!done) return;
        if (done.error) done.reject(done.error);
        else done.resolve({ rows: done.rows, count: done.count });
        return;
      }
      default:
        // ParameterStatus, BackendKeyData, ParseComplete, BindComplete, NoData, notices...
        return;
    }
  }

  /** Run one statement with $1, $2... parameters. Objects go in as JSON. */
  query<R = Record<string, any>>(sql: string, params: unknown[] = []): Promise<Result<R>> {
    const run = () =>
      new Promise<Result>((resolve, reject) => {
        if (this.dead) return reject(this.dead);
        this.waiting.push({ fields: [], rows: [], count: 0, error: null, resolve, reject });
        const vals = params.map((v) => {
          const t = toText(v);
          return t === null ? i32(-1) : Buffer.concat([i32(Buffer.byteLength(t)), Buffer.from(t, "utf8")]);
        });
        this.sock.write(
          Buffer.concat([
            frame("P", Buffer.concat([cstr(""), cstr(sql), i16(0)])),
            frame("B", Buffer.concat([cstr(""), cstr(""), i16(0), i16(params.length), ...vals, i16(0)])),
            frame("D", Buffer.concat([Buffer.from("P"), cstr("")])),
            frame("E", Buffer.concat([cstr(""), i32(0)])),
            frame("S", Buffer.alloc(0)),
          ]),
        );
      });
    const r = this.chain.then(run, run);
    this.chain = r.catch(() => {});
    return r as Promise<Result<R>>;
  }

  /** Several statements in one go, no parameters (schema setup). */
  script(sql: string): Promise<void> {
    const run = () =>
      new Promise<void>((resolve, reject) => {
        if (this.dead) return reject(this.dead);
        this.waiting.push({ fields: [], rows: [], count: 0, error: null, resolve: () => resolve(), reject });
        this.write("Q", cstr(sql));
      });
    const r = this.chain.then(run, run);
    this.chain = r.catch(() => {});
    return r;
  }

  async close() {
    if (this.dead) return;
    this.onClose = null;
    try {
      this.write("X", Buffer.alloc(0));
    } catch {
      // already gone
    }
    this.sock.end();
    this.dead = new Error("closed");
  }
}

export interface Queryable {
  query<R = Record<string, any>>(sql: string, params?: unknown[]): Promise<Result<R>>;
}

/** A few connections shared by the stores. */
export class PgPool implements Queryable {
  private idle: PgConnection[] = [];
  private open = 0;
  private waiters: ((c: PgConnection) => void)[] = [];
  private closed = false;

  constructor(
    readonly cfg: PgConfig,
    private size = 4,
  ) {}

  /** a connection of its own, outside the pool (the deploy lock) */
  connect() {
    return PgConnection.open(this.cfg);
  }

  private async acquire(): Promise<PgConnection> {
    if (this.closed) throw new Error("The database pool is closed");
    while (this.idle.length) {
      const c = this.idle.pop()!;
      if (!c.dead) return c;
      this.open--;
    }
    if (this.open < this.size) {
      this.open++;
      try {
        return await PgConnection.open(this.cfg);
      } catch (e) {
        this.open--;
        throw e;
      }
    }
    return new Promise((r) => this.waiters.push(r));
  }

  private release(c: PgConnection) {
    if (c.dead) {
      this.open--;
      // someone waiting gets a fresh connection instead
      const w = this.waiters.shift();
      if (w) this.acquire().then(w, () => this.waiters.unshift(w));
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c);
    else this.idle.push(c);
  }

  async query<R = Record<string, any>>(sql: string, params: unknown[] = []): Promise<Result<R>> {
    const c = await this.acquire();
    try {
      return await c.query<R>(sql, params);
    } finally {
      this.release(c);
    }
  }

  /** Run `fn` inside BEGIN/COMMIT on one connection; any throw rolls back. */
  async tx<T>(fn: (c: PgConnection) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      await c.query("BEGIN");
      try {
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      }
    } finally {
      this.release(c);
    }
  }

  async close() {
    this.closed = true;
    await Promise.all(this.idle.splice(0).map((c) => c.close()));
  }
}
