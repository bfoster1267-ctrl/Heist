// The activity log: one line for everything a player does (signing in, buying, opening packs, every table
// they sit at, every chat line, every screen and button in the app) and every finished game. The admin
// panel reads it. Passwords never reach it: request bodies are stripped of secret fields before logging.
//
// FileActivityLog appends JSON lines to DATA_DIR/activity/YYYY-MM.jsonl and keeps the newest events in
// memory for fast filtering; older history is read back from the files when a query reaches past that.
// Each player's move list lives with the game itself (games/done/ for online games, games/solo/ for
// games against bots), so the log stays small.

import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Answer } from "@heist/engine";
import type { SoloSetup } from "@heist/profile";

export interface ActivityEvent {
  at: number;
  /** what happened, e.g. "auth.login", "shop.buy", "table.chat", "game.online", "ui.tap" */
  kind: string;
  userId?: string;
  /** the player's name at the time */
  name?: string;
  ip?: string;
  /** the app install it came from (a random id the app keeps), when it sent one */
  device?: string;
  /** "app" for things the app reports about itself (screens, taps); everything else comes from the server */
  source?: "app";
  ok?: boolean;
  /** the error shown, when the action failed */
  error?: string;
  data?: Record<string, unknown>;
}

export interface ActivityQuery {
  userId?: string;
  /** kinds or kind prefixes ("shop." matches every shop event) */
  kinds?: string[];
  /** text anywhere in the event */
  text?: string;
  from?: number;
  to?: number;
  /** only events strictly older than this (paging) */
  before?: number;
  limit?: number;
}

/** A finished game against bots: enough to replay it move by move. */
export interface SoloRecord {
  gameId: string;
  userId: string;
  name: string;
  seed: number;
  players: number;
  stakes: number;
  setup: SoloSetup;
  answers: Answer[];
  startedAt: number;
  endedAt: number;
  /** quit before the end */
  quit: boolean;
  winners: number[];
}

export interface ActivityLog {
  add(e: ActivityEvent): void;
  query(q: ActivityQuery): ActivityEvent[];
  /** when this player last did anything (since the log began) */
  lastSeen(userId: string): number | undefined;
  /** every player's last-seen time */
  seen(): ReadonlyMap<string, number>;
  /** the newest events still in memory, oldest first (for dashboards) */
  window(): readonly ActivityEvent[];
  saveSolo(r: SoloRecord): void;
  solo(gameId: string): SoloRecord | undefined;
  flush(): Promise<void>;
}

/** something the owner did to a player's account (it names the player but isn't the player being active) */
export const byOwner = (e: ActivityEvent) => e.kind.startsWith("admin.");

const matches = (e: ActivityEvent, q: ActivityQuery, text: string | null) => {
  if (q.userId && e.userId !== q.userId) return false;
  if (q.before !== undefined && e.at >= q.before) return false;
  if (q.from !== undefined && e.at < q.from) return false;
  if (q.to !== undefined && e.at > q.to) return false;
  if (q.kinds?.length && !q.kinds.some((k) => (k.endsWith(".") ? e.kind.startsWith(k) : e.kind === k))) return false;
  if (text && !JSON.stringify(e).toLowerCase().includes(text)) return false;
  return true;
};

export class MemoryActivityLog implements ActivityLog {
  protected events: ActivityEvent[] = [];
  protected last = new Map<string, number>();
  protected solos = new Map<string, SoloRecord>();

  constructor(protected keep = 50_000) {}

  add(e: ActivityEvent) {
    this.remember(e);
  }

  protected remember(e: ActivityEvent) {
    this.events.push(e);
    if (this.events.length > this.keep * 1.1) this.events.splice(0, this.events.length - this.keep);
    if (e.userId && !byOwner(e)) this.last.set(e.userId, Math.max(this.last.get(e.userId) ?? 0, e.at));
  }

  query(q: ActivityQuery): ActivityEvent[] {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
    const text = q.text?.trim().toLowerCase() || null;
    const out: ActivityEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) if (matches(this.events[i], q, text)) out.push(this.events[i]);
    if (out.length < limit && this.events.length) {
      // past what's in memory: everything older than the oldest event held
      const oldest = this.events[0].at;
      if (q.from === undefined || q.from < oldest) out.push(...this.older({ ...q, before: Math.min(q.before ?? Infinity, oldest) }, limit - out.length, text));
    }
    return out;
  }

  /** events that have left memory (the file log reads them back) */
  protected older(_q: ActivityQuery, _limit: number, _text: string | null): ActivityEvent[] {
    return [];
  }

  lastSeen(userId: string) {
    return this.last.get(userId);
  }

  seen() {
    return this.last;
  }

  window() {
    return this.events;
  }

  saveSolo(r: SoloRecord) {
    this.solos.set(r.gameId, r);
  }

  solo(gameId: string) {
    return this.solos.get(gameId);
  }

  async flush() {}
}

const month = (at: number) => new Date(at).toISOString().slice(0, 7);
const SAFE_ID = /^[\w-]{1,40}$/;

export class FileActivityLog extends MemoryActivityLog {
  private dir: string;
  private soloDir: string;
  private pending = 0;
  private idle: (() => void)[] = [];
  /** lines waiting to be appended; written in batches, one after another, so they stay in order */
  private buffer: { file: string; line: string }[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string, keep?: number) {
    super(keep);
    this.dir = join(dataDir, "activity");
    this.soloDir = join(dataDir, "games", "solo");
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.soloDir, { recursive: true });
    // newest months first, until memory is full
    const files = this.files();
    const loaded: ActivityEvent[][] = [];
    let n = 0;
    let i = files.length - 1;
    for (; i >= 0 && n < this.keep; i--) {
      const evs = this.read(files[i]);
      loaded.unshift(evs);
      n += evs.length;
    }
    // last-seen times for players who only show up in older months
    for (let j = 0; j <= i; j++) for (const e of this.read(files[j])) if (e.userId && !byOwner(e)) this.last.set(e.userId, Math.max(this.last.get(e.userId) ?? 0, e.at));
    for (const evs of loaded) for (const e of evs) this.remember(e);
  }

  private files() {
    return readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort();
  }

  private read(file: string): ActivityEvent[] {
    let raw = "";
    try {
      raw = readFileSync(join(this.dir, file), "utf8");
    } catch {
      return [];
    }
    const out: ActivityEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // a line cut short by a crash
      }
    }
    return out;
  }

  private done() {
    if (--this.pending === 0) for (const f of this.idle.splice(0)) f();
  }

  add(e: ActivityEvent) {
    this.remember(e);
    this.buffer.push({ file: join(this.dir, `${month(e.at)}.jsonl`), line: JSON.stringify(e) + "\n" });
    if (this.buffer.length > 1) return; // a write is already queued and will take this line too
    this.pending++;
    this.writing = this.writing.then(async () => {
      await new Promise((r) => setImmediate(r));
      const batch = this.buffer.splice(0);
      const byFile = new Map<string, string>();
      for (const b of batch) byFile.set(b.file, (byFile.get(b.file) ?? "") + b.line);
      for (const [f, text] of byFile) await appendFile(f, text).catch((x) => console.error("activity log write failed", x));
      this.done();
    });
  }

  protected older(q: ActivityQuery, limit: number, text: string | null): ActivityEvent[] {
    const out: ActivityEvent[] = [];
    for (const f of this.files().reverse()) {
      if (q.from !== undefined && f.slice(0, 7) < month(q.from)) break;
      const evs = this.read(f);
      for (let i = evs.length - 1; i >= 0 && out.length < limit; i--) if (matches(evs[i], q, text)) out.push(evs[i]);
      if (out.length >= limit) break;
    }
    return out;
  }

  saveSolo(r: SoloRecord) {
    if (!SAFE_ID.test(r.gameId)) return;
    this.pending++;
    writeFile(join(this.soloDir, `${r.gameId}.json`), JSON.stringify(r))
      .catch((x) => console.error("solo record write failed", x))
      .finally(() => this.done());
  }

  solo(gameId: string): SoloRecord | undefined {
    if (!SAFE_ID.test(gameId)) return undefined;
    try {
      return JSON.parse(readFileSync(join(this.soloDir, `${gameId}.json`), "utf8"));
    } catch {
      return undefined;
    }
  }

  flush() {
    return this.pending ? new Promise<void>((r) => this.idle.push(r)) : Promise.resolve();
  }
}

/** Fields that never go in the log, at any depth. */
const SECRET = /pass|token|credential|secret/i;

/** A copy of a request body that is safe to log: no secrets, strings and arrays kept short. */
export function scrub(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + "…" : v;
  if (typeof v !== "object" || v === null) return v;
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.length > 20 ? `[${v.length} items]` : v.map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? "(hidden)" : scrub(x, depth + 1);
  return out;
}
