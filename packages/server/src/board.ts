// The feedback board: the Lounge's Feedback tab. Players post a bug, an idea, a balance gripe or other
// feedback; everyone can upvote ("Me too" on a bug) and comment; the owner tags each post's status from the
// admin panel, answers as the Heist team, merges duplicates, and pays the author coins when a bug is
// confirmed or an idea ships. Unlike the Lounge, posts are kept: they live in DATA_DIR/board.json.
//
// Text goes through the Lounge's filter (swears starred, slurs and links refused).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Badge } from "@heist/profile";
import { LoungeError, cleanLine } from "./lounge";

export const BOARD_KINDS = ["bug", "idea", "balance", "other"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
export const BOARD_STATUSES = ["new", "review", "planned", "doing", "shipped", "wont"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export interface BoardComment {
  id: number;
  at: number;
  userId: string;
  name: string;
  text: string;
  badge?: Badge;
  /** written from the admin panel: shows the gold "Heist team" tag */
  team?: boolean;
  reports?: string[];
  hidden?: boolean;
}

export interface BoardPost {
  id: number;
  at: number;
  kind: BoardKind;
  title: string;
  body: string;
  userId: string;
  name: string;
  badge?: Badge;
  /** who upvoted (the author counts as the first vote) */
  votes: string[];
  comments: BoardComment[];
  status: BoardStatus;
  statusAt?: number;
  /** the phone and app it was sent from (bugs only; shown in the admin panel, never to players) */
  device?: string;
  /** a duplicate folded into another post: its votes went there */
  mergedInto?: number;
  reports?: string[];
  hidden?: boolean;
  /** the author was paid for it (once) */
  rewarded?: boolean;
}

/** What a player sees in the list: counts, not who voted. */
export interface BoardRow {
  id: number;
  at: number;
  kind: BoardKind;
  title: string;
  body: string;
  userId: string;
  name: string;
  badge?: Badge;
  votes: number;
  voted: boolean;
  comments: number;
  status: BoardStatus;
  statusAt?: number;
  /** the Heist team has answered */
  answered: boolean;
}

export class BoardError extends LoungeError {}

/** reports from this many players hide a post or comment until the owner looks */
const REPORTS_TO_HIDE = 3;
const POSTS_PER_DAY = 3;
const COMMENT_GAP_MS = 10_000;
const COMMENTS_PER_DAY = 30;
const DAY = 24 * 3_600_000;
const TITLE = { min: 4, max: 80 };
const BODY_MAX = 1_000;
const COMMENT_MAX = 500;

/** the coins a player gets when their bug is confirmed or their idea ships */
export const BOARD_REWARD = 100;

interface Saved {
  next: number;
  posts: BoardPost[];
}

export class Board {
  private posts: BoardPost[] = [];
  private next = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wrote = new Map<string, number[]>();
  private said = new Map<string, number[]>();

  constructor(private o: { dataDir?: string; now?: () => number; delayMs?: number } = {}) {
    if (!o.dataDir) return;
    mkdirSync(o.dataDir, { recursive: true });
    try {
      const raw = JSON.parse(readFileSync(this.file()!, "utf8")) as Saved;
      this.posts = raw.posts ?? [];
      this.next = raw.next ?? this.posts.reduce((n, p) => Math.max(n, p.id, ...p.comments.map((c) => c.id)), 0) + 1;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  private now() {
    return (this.o.now ?? Date.now)();
  }
  private file() {
    return this.o.dataDir ? join(this.o.dataDir, "board.json") : null;
  }
  private changed() {
    if (!this.file() || this.timer) return;
    this.timer = setTimeout(() => this.write(), this.o.delayMs ?? 500);
  }
  private write() {
    this.timer = null;
    const f = this.file();
    if (!f) return;
    writeFileSync(`${f}.tmp`, JSON.stringify({ next: this.next, posts: this.posts } satisfies Saved));
    renameSync(`${f}.tmp`, f);
  }
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.write();
    }
  }

  private row(p: BoardPost, me?: string): BoardRow {
    return {
      id: p.id,
      at: p.at,
      kind: p.kind,
      title: p.title,
      body: p.body,
      userId: p.userId,
      name: p.name,
      ...(p.badge ? { badge: p.badge } : {}),
      votes: p.votes.length,
      voted: !!me && p.votes.includes(me),
      comments: p.comments.filter((c) => !c.hidden).length,
      status: p.status,
      ...(p.statusAt ? { statusAt: p.statusAt } : {}),
      answered: p.comments.some((c) => c.team),
    };
  }

  /** The board as players see it: newest or most voted first, merged and taken-down posts left out. */
  list(me?: string, sort: unknown = "top"): BoardRow[] {
    const shown = this.posts.filter((p) => !p.hidden && !p.mergedInto);
    const done = (p: BoardPost) => p.status === "shipped" || p.status === "wont";
    shown.sort(sort === "new" ? (a, b) => b.at - a.at : (a, b) => Number(done(a)) - Number(done(b)) || b.votes.length - a.votes.length || b.at - a.at);
    return shown.slice(0, 200).map((p) => this.row(p, me));
  }

  /** One post with its comments. A merged post answers with the one it went into. */
  post(id: unknown, me?: string): (BoardRow & { thread: BoardComment[] }) | null {
    let p = this.find(id);
    if (p?.mergedInto) p = this.find(p.mergedInto);
    if (!p || p.hidden) return null;
    const thread = p.comments.filter((c) => !c.hidden).map(({ reports: _r, hidden: _h, ...c }) => c);
    return { ...this.row(p, me), thread };
  }

  private find(id: unknown) {
    return typeof id === "number" ? this.posts.find((p) => p.id === id) : undefined;
  }
  private must(id: unknown) {
    const p = this.find(id);
    if (!p || p.hidden || p.mergedInto) throw new BoardError("That post is gone");
    return p;
  }

  private recent(m: Map<string, number[]>, userId: string, window: number) {
    const t = this.now();
    const r = (m.get(userId) ?? []).filter((x) => t - x < window);
    m.set(userId, r);
    if (m.size > 5_000) for (const [k, v] of m) if (!v.some((x) => t - x < DAY)) m.delete(k);
    return r;
  }

  /** A new post. `device` is the browser's description, kept for bugs only. */
  add(user: { id: string; name: string; badge?: Badge }, b: { kind?: unknown; title?: unknown; body?: unknown; device?: unknown }): BoardRow {
    const kind = BOARD_KINDS.find((k) => k === b.kind);
    if (!kind) throw new BoardError("Pick what kind of post this is");
    const title = cleanLine(b.title).slice(0, TITLE.max);
    if (title.length < TITLE.min) throw new BoardError("Give it a short title");
    const body = typeof b.body === "string" && b.body.trim() ? cleanBody(b.body) : "";
    const mine = this.recent(this.wrote, user.id, DAY);
    if (mine.length >= POSTS_PER_DAY) throw new BoardError(`That's ${POSTS_PER_DAY} posts today. Vote or comment on others, and post again tomorrow.`);
    const t = this.now();
    if (this.posts.some((p) => p.userId === user.id && !p.mergedInto && p.title.toLowerCase() === title.toLowerCase())) throw new BoardError("You already posted that");
    mine.push(t);
    const p: BoardPost = {
      id: this.next++,
      at: t,
      kind,
      title,
      body,
      userId: user.id,
      name: user.name,
      ...(user.badge ? { badge: user.badge } : {}),
      votes: [user.id],
      comments: [],
      status: "new",
      ...(kind === "bug" && typeof b.device === "string" ? { device: b.device.slice(0, 300) } : {}),
    };
    this.posts.push(p);
    this.changed();
    return this.row(p, user.id);
  }

  /** Upvote (or take it back). Returns the new count. */
  vote(userId: string, id: unknown, on: unknown): { votes: number; voted: boolean } {
    const p = this.must(id);
    const has = p.votes.includes(userId);
    if (on !== false && !has) p.votes.push(userId);
    if (on === false && has) p.votes = p.votes.filter((v) => v !== userId);
    this.changed();
    return { votes: p.votes.length, voted: p.votes.includes(userId) };
  }

  comment(user: { id: string; name: string; badge?: Badge }, id: unknown, raw: unknown, team = false): BoardComment {
    const p = this.must(id);
    const text = cleanBody(raw, COMMENT_MAX);
    if (!team) {
      const r = this.recent(this.said, user.id, DAY);
      const t = this.now();
      if (r.length && t - r[r.length - 1] < COMMENT_GAP_MS) throw new BoardError("Slow down a little");
      if (r.length >= COMMENTS_PER_DAY) throw new BoardError("That's a lot of comments today. Back tomorrow.");
      r.push(t);
    }
    const c: BoardComment = { id: this.next++, at: this.now(), userId: user.id, name: user.name, text, ...(user.badge ? { badge: user.badge } : {}), ...(team ? { team: true } : {}) };
    p.comments.push(c);
    this.changed();
    return c;
  }

  /** A player flags a post or one of its comments. Null: nothing to report (gone, or their own). */
  report(reporter: string, id: unknown, commentId?: unknown): { hidden: boolean; post: BoardPost; comment?: BoardComment } | null {
    const p = this.find(id);
    if (!p || p.hidden) return null;
    const target = commentId === undefined ? p : p.comments.find((c) => c.id === commentId);
    if (!target || target.userId === reporter || ("team" in target && target.team)) return null;
    const by = new Set(target.reports ?? []);
    by.add(reporter);
    target.reports = [...by];
    if (by.size >= REPORTS_TO_HIDE) target.hidden = true;
    this.changed();
    return { hidden: !!target.hidden, post: p, ...(target !== p ? { comment: target as BoardComment } : {}) };
  }

  /** Everything one player wrote comes down (they were suspended). */
  removeUser(userId: string) {
    for (const p of this.posts) {
      if (p.userId === userId) p.hidden = true;
      for (const c of p.comments) if (c.userId === userId) c.hidden = true;
    }
    this.changed();
  }

  // ------------------------------------------------------------------ the owner's side

  /** Every post for the admin panel, most voted first, with the device and reports. */
  all(): (BoardPost & { voteCount: number })[] {
    return [...this.posts].sort((a, b) => b.votes.length - a.votes.length || b.at - a.at).map((p) => ({ ...p, voteCount: p.votes.length }));
  }

  /**
   * The owner's changes to one post. Returns the post, and whether its author is now owed the reward (a
   * bug marked planned, in progress or shipped, or an idea marked shipped, paid once) and who to tell.
   */
  manage(id: unknown, b: { status?: unknown; hide?: unknown; mergeInto?: unknown }): { post: BoardPost; pay: boolean; statusChanged: boolean } {
    const p = this.find(id);
    if (!p) throw new BoardError("No such post");
    let statusChanged = false;
    if (b.status !== undefined) {
      const s = BOARD_STATUSES.find((x) => x === b.status);
      if (!s) throw new BoardError("No such status");
      statusChanged = s !== p.status;
      p.status = s;
      p.statusAt = this.now();
    }
    if (typeof b.hide === "boolean") {
      p.hidden = b.hide;
      if (!b.hide) p.reports = [];
    }
    if (b.mergeInto !== undefined) {
      const into = this.find(b.mergeInto);
      if (!into || into.id === p.id || into.mergedInto) throw new BoardError("Merge it into a post that's still up");
      p.mergedInto = into.id;
      into.votes = [...new Set([...into.votes, ...p.votes])];
    }
    const confirmed = p.kind === "bug" ? ["planned", "doing", "shipped"].includes(p.status) : p.kind === "idea" && p.status === "shipped";
    const pay = statusChanged && confirmed && !p.rewarded && !p.mergedInto;
    if (pay) p.rewarded = true;
    this.changed();
    return { post: p, pay, statusChanged };
  }

  /** Bring a hidden comment back, or take one down. */
  manageComment(id: unknown, commentId: unknown, hide: boolean) {
    const c = this.find(id)?.comments.find((x) => x.id === commentId);
    if (!c) throw new BoardError("No such comment");
    c.hidden = hide;
    if (!hide) c.reports = [];
    this.changed();
    return c;
  }
}

/** Longer text (a post's details, a comment): the Lounge's filter line by line, blank lines squeezed. */
function cleanBody(raw: unknown, max = BODY_MAX): string {
  if (typeof raw !== "string") throw new BoardError("Write something");
  const lines = raw.slice(0, max * 2).split(/\r?\n/).map((l) => (l.trim() ? cleanLongLine(l) : ""));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  if (!text) throw new BoardError("Write something");
  return text;
}

/** cleanLine keeps 200 characters: run it over each piece of a long line, cut between words. */
function cleanLongLine(l: string): string {
  const pieces: string[] = [];
  let cur = "";
  for (const w of l.split(/\s+/)) {
    if (cur && cur.length + 1 + w.length > 200) {
      pieces.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) pieces.push(cur);
  return pieces.map((x) => cleanLine(x)).join(" ");
}
