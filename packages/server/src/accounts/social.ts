// Friends: requests, the friends list, inviting a friend to your table, and direct messages between friends.
// Friend links live on each account (both sides, changed in each account's own queue). Messages live in
// their own file (dms.json), one conversation per pair of friends, the newest few hundred kept. Messages go
// through the Lounge's filter (lounge.ts).
//
// An invite or a message reaches a friend two ways: their phone gets a notification (web push, for players
// who turned alerts on; tapping it opens the Home Screen app, full screen, straight into the table or the
// chat), and the app shows it the next time it checks in (it asks every few seconds while it's open).

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { levelInfo } from "@heist/profile";
import { LoungeError, cleanLine } from "../lounge";
import type { PushMessage } from "../push";
import { ApiError, type AccountService } from "./service";
import type { Account, FriendLinks } from "./store";

export const MAX_FRIENDS = 200;
/** unanswered requests a player can have going out (and coming in) at once */
const MAX_PENDING = 50;
/** messages kept per conversation */
const KEEP_MESSAGES = 300;
/** an invite shows in the app for this long */
const INVITE_MS = 15 * 60_000;
/** a player counts as online while their app checked in within this long */
const ONLINE_MS = 75_000;
/** someone looking at a chat doesn't get a phone buzz for it */
const VIEWING_MS = 12_000;
/** at most one message notification per conversation this often */
const DM_PUSH_GAP_MS = 60_000;

export interface FriendRow {
  id: string;
  name: string;
  level: number;
  prestige: number;
  frame: string;
  online: boolean;
  /** when the app last checked in (ms), null if not since the server started */
  seen: number | null;
  /** they get invites as notifications on a phone or browser */
  alerts: boolean;
  /** messages from them you haven't read */
  unread: number;
  /** the last message either way, for the list */
  last: { text: string; at: number; mine: boolean } | null;
}

export interface Person {
  id: string;
  name: string;
  level: number;
  prestige: number;
  frame: string;
  /** the chat bubble they wear (messages show in it) */
  chat: string;
}

export interface Invite {
  from: string;
  name: string;
  code: string;
  at: number;
}

export interface FriendsView {
  friends: FriendRow[];
  groups: GroupRow[];
  incoming: (Person & { at: number })[];
  outgoing: (Person & { at: number })[];
  invites: Invite[];
}

export interface Dm {
  from: string;
  text: string;
  at: number;
}

export interface Convo {
  messages: Dm[];
  /** each member's read mark (the `at` of the newest message they've seen) */
  read: Record<string, number>;
  /** a group chat (key "g_..."): its name and who's in it now (a chat between two friends has none) */
  group?: { name: string; members: string[]; by: string; at: number; /** everyone who was ever in it (the owner's view) */ ever?: string[] };
}

/** who wrote a line like "Ann added Bo" in a group chat */
export const SYSTEM = "system";
/** the most people in one group chat */
export const MAX_GROUP = 20;

export interface GroupRow {
  id: string;
  name: string;
  members: Person[];
  unread: number;
  last: { text: string; at: number; who: string } | null;
}

export interface DmStore {
  get(key: string): Convo | undefined;
  put(key: string, c: Convo): void;
  /** every conversation (group lists and the admin panel look through them) */
  entries(): Iterable<[string, Convo]>;
  flush(): Promise<void>;
}

export class MemoryDmStore implements DmStore {
  protected convos = new Map<string, Convo>();
  get(key: string) {
    return this.convos.get(key);
  }
  entries() {
    return this.convos.entries();
  }
  put(key: string, c: Convo) {
    this.convos.set(key, c);
  }
  async flush() {}
}

export class FileDmStore extends MemoryDmStore {
  private file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(dataDir: string, private delayMs = 500) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "dms.json");
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, Convo>;
      for (const [k, v] of Object.entries(raw)) this.convos.set(k, v);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  put(key: string, c: Convo) {
    super.put(key, c);
    if (!this.timer) this.timer = setTimeout(() => this.write(), this.delayMs);
  }
  private write() {
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.convos)));
    renameSync(tmp, this.file);
  }
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.write();
    }
  }
}

export interface SocialOptions {
  dms?: DmStore;
  now?: () => number;
  /** send a phone notification; resolves to how many devices it went to */
  notify?: (userId: string, m: PushMessage) => Promise<number>;
  /** whether this player has the game open on a socket right now */
  connected?: (userId: string) => boolean;
  /** whether a table with this code is open to join */
  tableOpen?: (code: string) => boolean;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const links = (a: Account): FriendLinks => (a.friends ??= { ids: [], incoming: [], outgoing: [] });
/** The Lounge's filter: swears starred out, slurs and links refused (a link from a "friend" is the usual scam). */
function cleanText(raw: unknown): string {
  try {
    return cleanLine(raw);
  } catch (e) {
    if (e instanceof LoungeError) throw new ApiError(400, e.message.replace(/ in the Lounge/, " in messages"));
    throw e;
  }
}

export class Social {
  readonly dms: DmStore;
  private now: () => number;
  /** when each player's app last checked in */
  private seen = new Map<string, number>();
  /** who is looking at which chat, and since when */
  /** which chat each player is looking at (a friend's id, or a group's), and since when */
  private viewing = new Map<string, { with: string; at: number }>();
  private invites = new Map<string, Invite[]>();
  private dmPushed = new Map<string, number>();
  private sent = new Map<string, number[]>();

  constructor(private svc: AccountService, private o: SocialOptions = {}) {
    this.dms = o.dms ?? new MemoryDmStore();
    this.now = o.now ?? Date.now;
  }

  /** The app checked in (any friends call does this). */
  touch(userId: string) {
    this.seen.set(userId, this.now());
    if (this.seen.size > 50_000) this.seen.clear();
  }

  online(userId: string) {
    return !!this.o.connected?.(userId) || this.now() - (this.seen.get(userId) ?? -Infinity) < ONLINE_MS;
  }

  /** at most `max` of this kind of thing per player per minute */
  private limit(userId: string, kind: string, max: number) {
    const key = `${kind}:${userId}`;
    const t = this.now();
    const recent = (this.sent.get(key) ?? []).filter((x) => t - x < 60_000);
    recent.push(t);
    this.sent.set(key, recent);
    if (this.sent.size > 20_000) this.sent.clear();
    if (recent.length > max) throw new ApiError(429, "Slow down a little");
  }

  private person(a: Account): Person {
    const p = a.progress;
    return { id: a.id, name: a.name, level: levelInfo(p.xp).level, prestige: p.prestige, frame: p.equipped.frame, chat: p.equipped.chat };
  }

  private async other(id: unknown): Promise<Account> {
    const a = typeof id === "string" && /^[\w-]{1,60}$/.test(id) ? await this.svc.store.get(id) : undefined;
    if (!a || this.svc.banOf(a)) throw new ApiError(404, "No such player");
    return a;
  }

  private notify(userId: string, m: PushMessage) {
    return this.o.notify ? this.o.notify(userId, m).catch(() => 0) : Promise.resolve(0);
  }

  // ------------------------------------------------------------------ the list

  async view(me: Account): Promise<FriendsView> {
    this.touch(me.id);
    const l = me.friends ?? { ids: [], incoming: [], outgoing: [] };
    const friends: FriendRow[] = [];
    for (const id of l.ids) {
      const a = await this.svc.store.get(id);
      if (!a || this.svc.banOf(a)) continue;
      const c = this.dms.get(pairKey(me.id, id));
      const mark = c?.read[me.id] ?? 0;
      const last = c?.messages.at(-1);
      friends.push({
        ...this.person(a),
        online: this.online(id),
        seen: this.seen.get(id) ?? null,
        alerts: (a.push?.length ?? 0) > 0,
        unread: c ? c.messages.filter((m) => m.from === id && m.at > mark).length : 0,
        last: last ? { text: last.text, at: last.at, mine: last.from === me.id } : null,
      });
    }
    // online first, then whoever you talked to last, then by name
    friends.sort((a, b) => +b.online - +a.online || (b.last?.at ?? 0) - (a.last?.at ?? 0) || a.name.localeCompare(b.name));
    const people = async (list: { id: string; at: number }[]) => {
      const out: (Person & { at: number })[] = [];
      for (const r of list) {
        const a = await this.svc.store.get(r.id);
        if (a && !this.svc.banOf(a)) out.push({ ...this.person(a), at: r.at });
      }
      return out;
    };
    const t = this.now();
    const invites = (this.invites.get(me.id) ?? []).filter((i) => t - i.at < INVITE_MS && l.ids.includes(i.from) && (this.o.tableOpen?.(i.code) ?? true));
    return { friends, groups: await this.groups(me.id), incoming: await people(l.incoming), outgoing: await people(l.outgoing), invites };
  }

  /** Find players to add by name (signed-up players and anyone who has played). */
  async search(me: Account, q: unknown): Promise<Person[]> {
    this.touch(me.id);
    const needle = typeof q === "string" ? q.trim().toLowerCase() : "";
    if (needle.length < 2) return [];
    const hits: { a: Account; score: number }[] = [];
    for (const a of await this.svc.store.all()) {
      if (a.id === me.id || this.svc.banOf(a) || (a.guest && this.svc.untouched(a))) continue;
      const n = a.name.toLowerCase();
      const at = n.indexOf(needle);
      if (at < 0) continue;
      hits.push({ a, score: (n === needle ? 0 : at === 0 ? 1 : 2) * 1e6 - levelInfo(a.progress.xp).level });
    }
    return hits.sort((x, y) => x.score - y.score).slice(0, 12).map((h) => this.person(h.a));
  }

  // ------------------------------------------------------------------ requests

  /** Ask to be friends (or say yes, if they already asked you). */
  async request(me: Account, id: unknown): Promise<{ status: "sent" | "friends" }> {
    const them = await this.other(id);
    if (them.id === me.id) throw new ApiError(400, "That's you");
    this.limit(me.id, "request", 20);
    const mine = me.friends;
    if (mine?.ids.includes(them.id)) return { status: "friends" };
    if (mine?.incoming.some((r) => r.id === them.id)) {
      await this.accept(me, them.id);
      return { status: "friends" };
    }
    if ((mine?.outgoing.length ?? 0) >= MAX_PENDING) throw new ApiError(400, "You have a lot of requests waiting. Give them a moment.");
    if ((mine?.ids.length ?? 0) >= MAX_FRIENDS) throw new ApiError(400, `You can have up to ${MAX_FRIENDS} friends`);
    const t = this.now();
    let fresh = false;
    await this.svc.edit(them.id, (x) => {
      const l = links(x);
      if (l.ids.includes(me.id) || l.incoming.some((r) => r.id === me.id)) return;
      if (l.incoming.length >= MAX_PENDING) l.incoming.shift();
      l.incoming.push({ id: me.id, at: t });
      fresh = true;
    });
    await this.svc.edit(me.id, (x) => {
      const l = links(x);
      if (!l.outgoing.some((r) => r.id === them.id)) l.outgoing.push({ id: them.id, at: t });
    });
    if (fresh) void this.notify(them.id, { title: "Friend request", body: `${me.name} wants to be friends on Heist.`, tag: `friend-${me.id}`, url: "./?friends=1" });
    return { status: "sent" };
  }

  async accept(me: Account, id: unknown) {
    const them = await this.other(id);
    let asked = false;
    await this.svc.edit(me.id, (x) => {
      const l = links(x);
      asked = l.incoming.some((r) => r.id === them.id);
      if (!asked && !l.ids.includes(them.id)) return;
      l.incoming = l.incoming.filter((r) => r.id !== them.id);
      l.outgoing = l.outgoing.filter((r) => r.id !== them.id);
      if (!l.ids.includes(them.id)) l.ids.push(them.id);
    });
    if (!asked) return { ok: true };
    await this.svc.edit(them.id, (x) => {
      const l = links(x);
      l.outgoing = l.outgoing.filter((r) => r.id !== me.id);
      l.incoming = l.incoming.filter((r) => r.id !== me.id);
      if (!l.ids.includes(me.id)) l.ids.push(me.id);
    });
    void this.notify(them.id, { title: "New friend", body: `${me.name} said yes. Invite them to a table!`, tag: `friend-${me.id}`, url: "./?friends=1" });
    return { ok: true };
  }

  /** Say no to a request, take back one you sent, or unfriend: whatever there is between the two of you goes. */
  async remove(me: Account, id: unknown) {
    if (typeof id !== "string") throw new ApiError(400, "Who?");
    const drop = (x: Account, other: string) => {
      const l = x.friends;
      if (!l) return;
      l.ids = l.ids.filter((i) => i !== other);
      l.incoming = l.incoming.filter((r) => r.id !== other);
      l.outgoing = l.outgoing.filter((r) => r.id !== other);
    };
    await this.svc.edit(me.id, (x) => drop(x, id));
    if (await this.svc.store.get(id)) await this.svc.edit(id, (x) => drop(x, me.id));
    return { ok: true };
  }

  // ------------------------------------------------------------------ invites

  /** Invite a friend to the table you're at: a notification on their phone, and a note in their app. */
  async invite(me: Account, id: unknown, code: unknown) {
    const them = await this.other(id);
    if (!me.friends?.ids.includes(them.id)) throw new ApiError(403, "You can only invite friends");
    const c = typeof code === "string" ? code.toUpperCase() : "";
    if (!/^[A-Z2-9]{5}$/.test(c) || !(this.o.tableOpen?.(c) ?? true)) throw new ApiError(404, "That table isn't open any more");
    this.limit(me.id, "invite", 30);
    const t = this.now();
    const list = (this.invites.get(them.id) ?? []).filter((i) => t - i.at < INVITE_MS && !(i.from === me.id && i.code === c));
    list.push({ from: me.id, name: me.name, code: c, at: t });
    this.invites.set(them.id, list.slice(-5));
    if (this.invites.size > 20_000) this.invites.clear();
    const devices = await this.notify(them.id, { title: `${me.name} invited you to play`, body: `Table ${c} is waiting. Tap to sit down.`, tag: `invite-${c}`, url: `./?table=${c}` });
    return { devices, online: this.online(them.id) };
  }

  /** Close an invite you've seen (joined or turned down). */
  dismiss(me: Account, code: unknown) {
    const list = this.invites.get(me.id);
    if (list) this.invites.set(me.id, list.filter((i) => i.code !== code));
    return { ok: true };
  }

  // ------------------------------------------------------------------ messages

  /** A chat (a friend's id, or a group's "g_..." id); reading it marks it read. */
  async thread(me: Account, id: unknown, before?: unknown) {
    if (isGroup(id)) return this.groupThread(me, id, before);
    const them = await this.other(id);
    this.touch(me.id);
    this.viewing.set(me.id, { with: them.id, at: this.now() });
    const key = pairKey(me.id, them.id);
    const c = this.dms.get(key);
    const all = c?.messages ?? [];
    const upTo = typeof before === "number" ? all.findIndex((m) => m.at >= before) : -1;
    const messages = (upTo >= 0 ? all.slice(0, upTo) : all).slice(-60);
    const newest = all.at(-1)?.at ?? 0;
    if (c && (c.read[me.id] ?? 0) < newest) this.dms.put(key, { ...c, read: { ...c.read, [me.id]: newest } });
    return {
      friend: { ...this.person(them), online: this.online(them.id) },
      /** the bubble your own messages show in */
      chat: me.progress.equipped.chat,
      friends: !!me.friends?.ids.includes(them.id),
      messages,
      /** when they last read what you sent */
      theirRead: c?.read[them.id] ?? 0,
    };
  }

  async send(me: Account, id: unknown, text: unknown) {
    if (isGroup(id)) return this.groupSend(me, id, text);
    const them = await this.other(id);
    if (!me.friends?.ids.includes(them.id) || !them.friends?.ids.includes(me.id)) throw new ApiError(403, "You can only message friends");
    const clean = cleanText(text);
    this.limit(me.id, "dm", 30);
    const key = pairKey(me.id, them.id);
    const c = this.dms.get(key) ?? { messages: [], read: {} };
    const at = Math.max(this.now(), (c.messages.at(-1)?.at ?? 0) + 1);
    const m: Dm = { from: me.id, text: clean, at };
    this.dms.put(key, { messages: [...c.messages, m].slice(-KEEP_MESSAGES), read: { ...c.read, [me.id]: at } });
    this.touch(me.id);
    // a buzz on their phone, unless they're reading this chat right now or just got one for it
    const v = this.viewing.get(them.id);
    const looking = v?.with === me.id && this.now() - v.at < VIEWING_MS;
    const pk = `${me.id}>${them.id}`;
    if (!looking && this.now() - (this.dmPushed.get(pk) ?? -Infinity) >= DM_PUSH_GAP_MS) {
      this.dmPushed.set(pk, this.now());
      if (this.dmPushed.size > 20_000) this.dmPushed.clear();
      void this.notify(them.id, { title: me.name, body: clean.length > 120 ? clean.slice(0, 119) + "…" : clean, tag: `dm-${me.id}`, url: `./?chat=${me.id}` });
    }
    return { message: m };
  }

  // ------------------------------------------------------------------ group chats

  private async people(ids: string[]): Promise<Person[]> {
    const out: Person[] = [];
    for (const id of ids) {
      const a = await this.svc.store.get(id);
      if (a) out.push(this.person(a));
    }
    return out;
  }

  /** The group chats this player is in, newest message first. */
  async groups(userId: string): Promise<GroupRow[]> {
    const rows: GroupRow[] = [];
    for (const [id, c] of this.dms.entries()) {
      if (!c.group?.members.includes(userId)) continue;
      const mark = c.read[userId] ?? 0;
      const last = c.messages.at(-1);
      const who = last && last.from !== SYSTEM ? (last.from === userId ? "You" : (await this.svc.store.get(last.from))?.name ?? "") : "";
      rows.push({
        id, name: c.group.name, members: await this.people(c.group.members.slice(0, 6)),
        unread: c.messages.filter((m) => m.from !== userId && m.from !== SYSTEM && m.at > mark).length,
        last: last ? { text: last.text, at: last.at, who } : null,
      });
    }
    return rows.sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  }

  private group(me: Account, id: string): Convo & { group: NonNullable<Convo["group"]> } {
    const c = this.dms.get(id);
    if (!c?.group || !c.group.members.includes(me.id)) throw new ApiError(404, "You're not in that group chat");
    return c as Convo & { group: NonNullable<Convo["group"]> };
  }

  /** Friends to add to a group: real ids of your friends, not already in it. */
  private async pick(me: Account, raw: unknown, already: string[] = []): Promise<Account[]> {
    const ids = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string"))] : [];
    const out: Account[] = [];
    for (const id of ids) {
      if (already.includes(id) || id === me.id) continue;
      if (!me.friends?.ids.includes(id)) throw new ApiError(403, "You can only add your friends");
      out.push(await this.other(id));
    }
    return out;
  }

  private line(id: string, c: Convo, text: string, from = SYSTEM): Dm {
    const at = Math.max(this.now(), (c.messages.at(-1)?.at ?? 0) + 1);
    const m: Dm = { from, text, at };
    const read = from === SYSTEM ? c.read : { ...c.read, [from]: at };
    this.dms.put(id, { ...c, messages: [...c.messages, m].slice(-KEEP_MESSAGES), read });
    return m;
  }

  /** Start a group chat with some of your friends. */
  async createGroup(me: Account, name: unknown, members: unknown) {
    this.limit(me.id, "group", 10);
    const add = await this.pick(me, members);
    if (!add.length) throw new ApiError(400, "Pick at least one friend");
    if (add.length + 1 > MAX_GROUP) throw new ApiError(400, `A group chat holds up to ${MAX_GROUP} people`);
    const id = `g_${randomBytes(9).toString("base64url")}`;
    const t = this.now();
    const c: Convo = { messages: [], read: {}, group: { name: groupName(name), members: [me.id, ...add.map((a) => a.id)], ever: [me.id, ...add.map((a) => a.id)], by: me.id, at: t } };
    this.dms.put(id, c);
    this.line(id, c, `${me.name} started the chat with ${add.map((a) => a.name).join(", ")}`);
    return { id };
  }

  /** Any member can bring in their own friends. */
  async addToGroup(me: Account, id: unknown, members: unknown) {
    const gid = String(id);
    const c = this.group(me, gid);
    const add = await this.pick(me, members, c.group.members);
    if (!add.length) return { ok: true };
    if (c.group.members.length + add.length > MAX_GROUP) throw new ApiError(400, `A group chat holds up to ${MAX_GROUP} people`);
    const ids = add.map((a) => a.id);
    const next = { ...c, group: { ...c.group, members: [...c.group.members, ...ids], ever: [...new Set([...(c.group.ever ?? c.group.members), ...ids])] } };
    this.line(gid, next, `${me.name} added ${add.map((a) => a.name).join(", ")}`);
    return { ok: true };
  }

  async renameGroup(me: Account, id: unknown, name: unknown) {
    const gid = String(id);
    const c = this.group(me, gid);
    const n = groupName(name);
    this.line(gid, { ...c, group: { ...c.group, name: n } }, n ? `${me.name} named the chat "${n}"` : `${me.name} removed the chat's name`);
    return { ok: true };
  }

  /** Leave a group chat (it stays for everyone else, and on the record). */
  async leaveGroup(me: Account, id: unknown) {
    const gid = String(id);
    const c = this.group(me, gid);
    this.line(gid, { ...c, group: { ...c.group, members: c.group.members.filter((m) => m !== me.id) } }, `${me.name} left`);
    return { ok: true };
  }

  private async groupThread(me: Account, id: string, before?: unknown) {
    const c = this.group(me, id);
    this.touch(me.id);
    this.viewing.set(me.id, { with: id, at: this.now() });
    const all = c.messages;
    const upTo = typeof before === "number" ? all.findIndex((m) => m.at >= before) : -1;
    const messages = (upTo >= 0 ? all.slice(0, upTo) : all).slice(-60);
    const newest = all.at(-1)?.at ?? 0;
    if ((c.read[me.id] ?? 0) < newest) this.dms.put(id, { ...c, read: { ...c.read, [me.id]: newest } });
    // senders who have since left still need a name and bubble on their old lines
    const ids = [...new Set([...c.group.members, ...messages.map((m) => m.from).filter((f) => f !== SYSTEM)])];
    const people = await this.people(ids);
    return {
      group: { id, name: c.group.name, members: c.group.members },
      people: people.map((p) => ({ ...p, online: this.online(p.id) })),
      chat: me.progress.equipped.chat,
      friends: true,
      messages,
      theirRead: 0,
    };
  }

  private async groupSend(me: Account, id: string, text: unknown) {
    const c = this.group(me, id);
    const clean = cleanText(text);
    this.limit(me.id, "dm", 30);
    const m = this.line(id, c, clean, me.id);
    this.touch(me.id);
    const t = this.now();
    for (const uid of c.group.members) {
      if (uid === me.id) continue;
      const v = this.viewing.get(uid);
      if (v?.with === id && t - v.at < VIEWING_MS) continue;
      const pk = `${id}>${uid}`;
      if (t - (this.dmPushed.get(pk) ?? -Infinity) < DM_PUSH_GAP_MS) continue;
      this.dmPushed.set(pk, t);
      const body = `${me.name}: ${clean}`;
      void this.notify(uid, { title: c.group.name || "Group chat", body: body.length > 120 ? body.slice(0, 119) + "…" : body, tag: `chat-${id}`, url: `./?chat=${id}` });
    }
    return { message: m };
  }

  // ------------------------------------------------------------------ the owner's view

  /** Every chat a player is or was in, with the messages (the admin panel's player file). */
  async chatsOf(userId: string) {
    const out: { id: string; kind: "dm" | "group"; name: string; members: { id: string; name: string }[]; messages: (Dm & { name: string })[] }[] = [];
    const names = new Map<string, string>();
    const nameOf = async (id: string) => {
      if (id === SYSTEM) return "";
      if (!names.has(id)) names.set(id, (await this.svc.store.get(id))?.name ?? "(gone)");
      return names.get(id)!;
    };
    for (const [id, c] of this.dms.entries()) {
      const isDm = !c.group && id.split("|").includes(userId);
      const inGroup = !!c.group && (c.group.ever ?? c.group.members).includes(userId);
      if (!isDm && !inGroup) continue;
      const memberIds = c.group ? c.group.members : id.split("|");
      const members = await Promise.all(memberIds.map(async (m) => ({ id: m, name: await nameOf(m) })));
      const messages = await Promise.all(c.messages.slice(-200).map(async (m) => ({ ...m, name: await nameOf(m.from) })));
      out.push({ id, kind: c.group ? "group" : "dm", name: c.group?.name || members.filter((m) => m.id !== userId).map((m) => m.name).join(", "), members, messages });
    }
    return out.sort((a, b) => (b.messages.at(-1)?.at ?? 0) - (a.messages.at(-1)?.at ?? 0));
  }
}

const isGroup = (id: unknown): id is string => typeof id === "string" && /^g_[\w-]{6,30}$/.test(id);
/** A group chat's name: optional, short, and through the same filter as messages. */
const groupName = (raw: unknown) => {
  const s = typeof raw === "string" ? raw.replace(/[<>]/g, "").trim() : "";
  return s ? cleanText(s).slice(0, 30) : "";
};
