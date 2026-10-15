// The Lounge: one chat room for everyone in the app, read and written over the accounts API
// (GET /api/lounge, POST /api/lounge/say, POST /api/lounge/report). The last 100 messages are kept, in
// DATA_DIR/lounge.json when there is one, so a deploy doesn't empty the room. Each message carries the
// sender's badge, so every reader sees it in the chat bubble the sender wears.
//
// Moderation: swear words are starred out, slurs and links are refused, each player gets a slow
// trickle of lines, and three reports from different players take a message down. A suspended
// account's messages are removed at once.
//
// Conduct: each player's record (their recent lines, lines the filter refused or starred, reports
// against them, lines taken down, and how many players muted them) is kept with the room, for the
// owner's admin panel. A few hundred short lines per player: a few KB each.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Badge } from "@heist/profile";

export interface LoungeMsg {
  id: number;
  at: number;
  userId: string;
  name: string;
  text: string;
  badge?: Badge;
  /** a drink sent from the Lounge: the line reads "<name> sent <to> a <drink>" */
  drink?: { id: string; emoji: string; to: string; toId: string };
}

export interface LoungeFeed {
  msgs: LoungeMsg[];
  /** messages taken down (reported or suspended) that a reader may still be showing */
  gone: number[];
  /** the newest message id: pass it back as `after` to get only what's new */
  last: number;
  /** players who looked at the Lounge in the last minute */
  here: number;
}

const KEEP = 100;
/** a first look shows this many */
const FIRST = 50;
const MAX_CHARS = 200;
/** per player: a line at most every 2.5 s, and 6 a minute */
const GAP_MS = 2_500;
const PER_MIN = 6;
/** reports from this many different players take a message down */
const REPORTS_TO_HIDE = 3;
const HERE_MS = 60_000;

/** per player, the newest this many of each */
const KEEP_LINES = 200;
const KEEP_MARKS = 50;

/** A player's behaviour in the Lounge, for the admin panel. */
export interface Conduct {
  name: string;
  /** lines and drinks posted, all time */
  said: number;
  lines: { id: number; at: number; text: string; gone?: boolean }[];
  /** lines the filter refused (slurs, links) */
  refused: { at: number; text: string; why: string }[];
  /** lines sent with swears starred out */
  starred: number;
  /** one per player per line */
  reports: { at: number; by: string; msgId: number; text: string }[];
  /** lines taken down by reports */
  takenDown: number;
  /** players who muted them (and haven't unmuted) */
  mutedBy: string[];
}

/** One number to sort by: a refused slur or a line the room took down weighs most, a swear least. */
export const toxicity = (c: Conduct) => c.refused.length * 3 + c.takenDown * 5 + c.reports.length + c.mutedBy.length * 2 + c.starred;

interface Saved {
  next: number;
  msgs: LoungeMsg[];
  gone: number[];
  people: Record<string, Conduct>;
  reports?: [number, string[]][];
}

export class LoungeError extends Error {}

export class Lounge {
  private msgs: LoungeMsg[] = [];
  private gone: number[] = [];
  private next = 1;
  private said = new Map<string, number[]>();
  private reports = new Map<number, Set<string>>();
  private seen = new Map<string, number>();
  private people = new Map<string, Conduct>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private now: () => number;
  private o: { now?: () => number; dataDir?: string; delayMs?: number };

  constructor(o: (() => number) | { now?: () => number; dataDir?: string; delayMs?: number } = {}) {
    this.o = typeof o === "function" ? { now: o } : o;
    this.now = this.o.now ?? Date.now;
    if (!this.o.dataDir) return;
    mkdirSync(this.o.dataDir, { recursive: true });
    try {
      const raw = JSON.parse(readFileSync(this.file()!, "utf8")) as Saved;
      this.msgs = raw.msgs ?? [];
      this.gone = raw.gone ?? [];
      this.next = raw.next ?? this.msgs.reduce((n, m) => Math.max(n, m.id), 0) + 1;
      this.people = new Map(Object.entries(raw.people ?? {}));
      this.reports = new Map((raw.reports ?? []).map(([id, by]) => [id, new Set(by)]));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  private file() {
    return this.o.dataDir ? join(this.o.dataDir, "lounge.json") : null;
  }
  private changed() {
    if (!this.file() || this.timer) return;
    this.timer = setTimeout(() => this.write(), this.o.delayMs ?? 1_000);
  }
  private write() {
    this.timer = null;
    const f = this.file();
    if (!f) return;
    const saved: Saved = { next: this.next, msgs: this.msgs, gone: this.gone, people: Object.fromEntries(this.people), reports: [...this.reports].map(([id, by]) => [id, [...by]]) };
    writeFileSync(`${f}.tmp`, JSON.stringify(saved));
    renameSync(`${f}.tmp`, f);
  }
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.write();
    }
  }

  /** this player's record, made on first use (the name kept current) */
  private person(userId: string, name?: string): Conduct {
    let c = this.people.get(userId);
    if (!c) {
      c = { name: name ?? userId, said: 0, lines: [], refused: [], starred: 0, reports: [], takenDown: 0, mutedBy: [] };
      this.people.set(userId, c);
    } else if (name) c.name = name;
    return c;
  }
  private static push<T>(xs: T[], x: T, keep: number) {
    xs.push(x);
    if (xs.length > keep) xs.splice(0, xs.length - keep);
  }

  /** What's new since `after` (0: the latest few). `who` counts toward "here". */
  feed(after: number, who?: string): LoungeFeed {
    const t = this.now();
    if (who) {
      this.seen.set(who, t);
      if (this.seen.size > 5_000) for (const [k, v] of this.seen) if (t - v > HERE_MS) this.seen.delete(k);
    }
    let here = 0;
    for (const v of this.seen.values()) if (t - v <= HERE_MS) here++;
    const msgs = after > 0 ? this.msgs.filter((m) => m.id > after) : this.msgs.slice(-FIRST);
    return { msgs, gone: this.gone.slice(-KEEP), last: this.next - 1, here };
  }

  /** Post a line. Throws a LoungeError the player can read when it's refused. */
  say(user: { id: string; name: string; badge?: Badge }, raw: unknown): LoungeMsg {
    let text: string;
    try {
      text = cleanLine(raw);
    } catch (e) {
      // a refused slur or link goes on their record (an empty line doesn't)
      if (e instanceof LoungeError && typeof raw === "string" && raw.trim()) {
        Lounge.push(this.person(user.id, user.name).refused, { at: this.now(), text: raw.slice(0, MAX_CHARS), why: e.message }, KEEP_MARKS);
        this.changed();
      }
      throw e;
    }
    const mine = this.msgs.filter((m) => m.userId === user.id).at(-1);
    if (mine && !mine.drink && mine.text === text && this.now() - mine.at < 60_000) throw new LoungeError("You just said that");
    this.pace(user.id);
    if (text.includes("*") && text !== String(raw).replace(/\s+/g, " ").trim().slice(0, MAX_CHARS)) this.person(user.id, user.name).starred++;
    return this.post({ userId: user.id, name: user.name, text, ...(user.badge ? { badge: user.badge } : {}) });
  }

  /** The line a drink is about: who gets it (never yourself). Check `pace` and charge before `sendDrink`. */
  drinkFor(from: string, msgId: unknown): LoungeMsg {
    const m = typeof msgId === "number" ? this.msgs.find((x) => x.id === msgId) : undefined;
    if (!m) throw new LoungeError("That line is gone");
    if (m.userId === from) throw new LoungeError("Buying yourself a drink? Send it to someone else.");
    return m;
  }

  /** Post a drink line ("Ace sent Mia a Whiskey"). Drinks share the talking pace. */
  sendDrink(user: { id: string; name: string; badge?: Badge }, to: LoungeMsg, d: { id: string; name: string; emoji: string }): LoungeMsg {
    this.pace(user.id);
    return this.post({ userId: user.id, name: user.name, text: d.name, drink: { id: d.id, emoji: d.emoji, to: to.name, toId: to.userId }, ...(user.badge ? { badge: user.badge } : {}) });
  }

  /** Throws when this player is talking too fast; `check` only looks, without counting a line. */
  pace(userId: string, check = false) {
    const t = this.now();
    const recent = (this.said.get(userId) ?? []).filter((x) => t - x < 60_000);
    if (recent.length && t - recent[recent.length - 1] < GAP_MS) throw new LoungeError("Slow down a little");
    if (recent.length >= PER_MIN) throw new LoungeError("That's a lot of talking. Wait a minute.");
    if (check) return;
    recent.push(t);
    this.said.set(userId, recent);
    if (this.said.size > 5_000) this.said.clear();
  }

  private post(x: Omit<LoungeMsg, "id" | "at">): LoungeMsg {
    const m: LoungeMsg = { id: this.next++, at: this.now(), ...x };
    this.msgs.push(m);
    if (this.msgs.length > KEEP) {
      for (const old of this.msgs.splice(0, this.msgs.length - KEEP)) this.reports.delete(old.id);
    }
    const c = this.person(m.userId, m.name);
    c.said++;
    Lounge.push(c.lines, { id: m.id, at: m.at, text: m.drink ? `${m.drink.emoji} sent ${m.drink.to} a ${m.text}` : m.text }, KEEP_LINES);
    this.changed();
    return m;
  }

  /** A player flags a message. Returns the message reported (null: no such message, or their own). */
  report(reporter: string, id: unknown): { msg: LoungeMsg; hidden: boolean } | null {
    const m = typeof id === "number" ? this.msgs.find((x) => x.id === id) : undefined;
    if (!m || m.userId === reporter) return null;
    const by = this.reports.get(m.id) ?? new Set<string>();
    if (!by.has(reporter)) Lounge.push(this.person(m.userId, m.name).reports, { at: this.now(), by: reporter, msgId: m.id, text: m.text }, KEEP_MARKS);
    by.add(reporter);
    this.reports.set(m.id, by);
    const hidden = by.size >= REPORTS_TO_HIDE;
    if (hidden) {
      this.person(m.userId).takenDown++;
      this.take((x) => x.id === m.id);
    }
    this.changed();
    return { msg: m, hidden };
  }

  /** A player muted (or unmuted) someone. Muting only hides lines on their own screen; this just counts it. */
  mute(by: string, userId: unknown, on: boolean): boolean {
    if (typeof userId !== "string" || userId === by) return false;
    const c = this.people.get(userId);
    if (!c) return false;
    const has = c.mutedBy.includes(by);
    if (on && !has) c.mutedBy.push(by);
    else if (!on && has) c.mutedBy = c.mutedBy.filter((x) => x !== by);
    else return true;
    if (c.mutedBy.length > 1_000) c.mutedBy = c.mutedBy.slice(-1_000);
    this.changed();
    return true;
  }

  /** One player's Lounge record (null: they've never talked or been filtered). */
  conductOf(userId: string): (Conduct & { score: number }) | null {
    const c = this.people.get(userId);
    return c ? { ...c, score: toxicity(c) } : null;
  }

  /** Players with anything on their record, worst first, for the admin panel's watch list. */
  watchList(limit = 100) {
    return [...this.people]
      .map(([userId, c]) => ({ userId, name: c.name, said: c.said, refused: c.refused.length, starred: c.starred, reports: c.reports.length, takenDown: c.takenDown, muted: c.mutedBy.length, score: toxicity(c), last: c.lines.at(-1)?.at ?? c.refused.at(-1)?.at ?? 0 }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.last - a.last)
      .slice(0, limit);
  }

  /** Take down everything one player said (they were suspended). */
  removeUser(userId: string) {
    this.take((m) => m.userId === userId);
  }

  private take(f: (m: LoungeMsg) => boolean) {
    for (const m of this.msgs) {
      if (!f(m)) continue;
      this.gone.push(m.id);
      const line = this.people.get(m.userId)?.lines.find((l) => l.id === m.id);
      if (line) line.gone = true;
    }
    this.msgs = this.msgs.filter((m) => !f(m));
    if (this.gone.length > KEEP * 2) this.gone = this.gone.slice(-KEEP);
    this.changed();
  }
}

// ------------------------------------------------------------------ the filter

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t" };
/** lower case, look-alike digits and symbols as letters, everything else dropped ("ass!" stays "ass") */
const letters = (s: string) =>
  [...s.toLowerCase().replace(/^[^\p{L}\p{N}@$]+|[^\p{L}\p{N}]+$/gu, "")].map((ch) => LEET[ch] ?? ch).join("").normalize("NFKD").replace(/[^a-z]/g, "");
/** "fuuuck" -> "fuck" */
const squeeze = (s: string) => s.replace(/(.)\1+/g, "$1");

/** Slurs: refused anywhere in the line, even stretched out or with the spaces taken out (the double g
 *  keeps "Niger" and "mini game" safe). */
const SLURS_ANYWHERE = [/n+i+g{2,}(e+r+|a+|u+h+)/, /f+a+g{2,}o+t/, /k+i+l+y+o+u+r+s+e+l+f/];
/** Slurs refused as whole words (short ones would match innocent words if spaces were dropped). */
const SLUR_WORDS = new Set(["fag", "fags", "fagot", "retard", "retards", "retarded", "kike", "kikes", "spic", "spics", "chink", "chinks", "coon", "coons", "tranny", "trannies", "wetback", "gook", "gooks", "kys", "nazi"]);
/** Swears: starred out wherever they appear in a word. */
const SWEAR_PARTS = ["fuck", "fuk", "shit", "cunt", "bitch", "whore", "slut", "motherf"];
/** Swears starred out only as whole words ("cock" but not "cocktail", "ass" but not "pass"). */
const SWEAR_WORDS = new Set(["ass", "asses", "asshole", "assholes", "arse", "arsehole", "dick", "dicks", "dickhead", "cock", "cocks", "pussy", "pussies", "bastard", "bastards", "twat", "wank", "wanker", "prick", "pricks", "piss", "pissed", "bollocks", "dipshit", "jackass"]);

const LINK = /(https?:\/\/|www\.)|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(com|net|org|gg|io|ru|xyz|ly|me|co|tv|app|link|site|shop|club|live|info|biz)\b/i;

/** A line ready to post, or a LoungeError saying why not. */
export function cleanLine(raw: unknown): string {
  if (typeof raw !== "string") throw new LoungeError("Say something");
  const text = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!text) throw new LoungeError("Say something");
  if (LINK.test(text)) throw new LoungeError("Links aren't allowed in the Lounge");
  const all = letters(text);
  if (SLURS_ANYWHERE.some((r) => r.test(all))) throw new LoungeError("Keep it friendly: that word isn't allowed");
  const words = text.split(/(\s+)/);
  for (const w of words) {
    const l = letters(w);
    if (l && (SLUR_WORDS.has(l) || SLUR_WORDS.has(squeeze(l)))) throw new LoungeError("Keep it friendly: that word isn't allowed");
  }
  return words.map(star).join("");
}

/** "shit!" -> "s***!" when the word is a swear; anything else as it was. */
function star(w: string): string {
  const l = letters(w);
  if (!l) return w;
  const s = squeeze(l);
  const bad = SWEAR_WORDS.has(l) || SWEAR_WORDS.has(s) || SWEAR_PARTS.some((p) => l.includes(p) || s.includes(p));
  if (!bad) return w;
  let first = true;
  return w.replace(/[\p{L}\p{N}@$]/gu, (ch) => {
    if (first) {
      first = false;
      return ch;
    }
    return "*";
  });
}
