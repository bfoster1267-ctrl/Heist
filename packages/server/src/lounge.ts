// The Lounge: one chat room for everyone in the app, read and written over the accounts API
// (GET /api/lounge, POST /api/lounge/say, POST /api/lounge/report). Messages live in memory only: the
// last 100 are kept, and a restart starts the room empty. Each message carries the sender's badge, so
// every reader sees it in the chat bubble the sender wears.
//
// Moderation: swear words are starred out, slurs and links are refused, each player gets a slow
// trickle of lines, and three reports from different players take a message down. A suspended
// account's messages are removed at once.

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

export class LoungeError extends Error {}

export class Lounge {
  private msgs: LoungeMsg[] = [];
  private gone: number[] = [];
  private next = 1;
  private said = new Map<string, number[]>();
  private reports = new Map<number, Set<string>>();
  private seen = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

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
    const text = cleanLine(raw);
    const mine = this.msgs.filter((m) => m.userId === user.id).at(-1);
    if (mine && !mine.drink && mine.text === text && this.now() - mine.at < 60_000) throw new LoungeError("You just said that");
    this.pace(user.id);
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
    return m;
  }

  /** A player flags a message. Returns the message reported (null: no such message, or their own). */
  report(reporter: string, id: unknown): { msg: LoungeMsg; hidden: boolean } | null {
    const m = typeof id === "number" ? this.msgs.find((x) => x.id === id) : undefined;
    if (!m || m.userId === reporter) return null;
    const by = this.reports.get(m.id) ?? new Set<string>();
    by.add(reporter);
    this.reports.set(m.id, by);
    const hidden = by.size >= REPORTS_TO_HIDE;
    if (hidden) this.take((x) => x.id === m.id);
    return { msg: m, hidden };
  }

  /** Take down everything one player said (they were suspended). */
  removeUser(userId: string) {
    this.take((m) => m.userId === userId);
  }

  private take(f: (m: LoungeMsg) => boolean) {
    for (const m of this.msgs) if (f(m)) this.gone.push(m.id);
    this.msgs = this.msgs.filter((m) => !f(m));
    if (this.gone.length > KEEP * 2) this.gone = this.gone.slice(-KEEP);
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
