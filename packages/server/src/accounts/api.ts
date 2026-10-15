// The accounts HTTP API, served next to the game socket. JSON in and out; the session token goes in an
// `Authorization: Bearer` header. Every route is listed in packages/server/README.md.

import type { IncomingMessage, ServerResponse } from "node:http";
import { badgeOf, drink as drinkInfo, upgrade, type Progress } from "@heist/profile";
import { LoungeError, type Lounge } from "../lounge";
import { BOARD_REWARD, BOARD_VOTER_REWARD, type Board, type BoardPost } from "../board";
import type { PushMessage } from "../push";
import { CLAUDE_UA, scrub } from "./activity";
import type { AdminAuth, AdminService } from "./admin";
import type { Hosting } from "./hosting";
import { ApiError, type AccountService } from "./service";
import type { Social } from "./social";

const BODY_LIMIT = 16 * 1024;
/** a finished solo game posts every answer the player gave */
const SOLO_BODY_LIMIT = 512 * 1024;
/** sign-in attempts per address per window */
const AUTH_TRIES = 20;
const AUTH_WINDOW_MS = 10 * 60_000;
/** admin sign-in attempts per address per window */
const ADMIN_TRIES = 10;
/** app activity reports per player per minute, and events per report */
const TRACK_PER_MIN = 60;
const TRACK_EVENTS = 50;
/** opening the app counts once per player per this long */
const OPEN_EVERY_MS = 10 * 60_000;

export interface ApiOptions {
  /** browser origins allowed to call the API (empty = any) */
  allowedOrigins?: string[];
  now?: () => number;
  /** the owner's admin panel (off when no admin password is set) */
  admin?: { auth: AdminAuth; svc: AdminService; hosting?: Hosting };
  /** the VAPID public key browsers subscribe to turn alerts with (alerts are off without one) */
  pushKey?: string;
  /** friends, table invites and direct messages */
  social?: Social;
  /** the Lounge, the app-wide chat room (off without one) */
  lounge?: Lounge;
  /** the feedback board, the Lounge's Feedback tab (off without one) */
  board?: Board;
  /** a phone alert to a player (the board tells authors and voters what became of a post) */
  notify?: (userId: string, m: PushMessage) => Promise<number>;
}

/** calls the app makes every few seconds while it's open: not worth a line each in the activity log */
const UNLOGGED = new Set(["GET /api/config", "POST /api/track", "GET /api/friends", "GET /api/dm", "GET /api/friends/search", "GET /api/lounge", "GET /api/board", "GET /api/board/post"]);

/** where a request came from: its address, the app install's id when it sent one, and whether Claude's testing sent it */
type Where = { ip: string; device?: string; tester?: "claude"; ua?: string };
const deviceOf = (req: IncomingMessage) => {
  const d = req.headers["x-heist-device"];
  return typeof d === "string" && /^[\w-]{8,40}$/.test(d) ? d : undefined;
};

/** "POST /api/shop/buy" -> "shop.buy" */
const kindOf = (key: string) => {
  if (key === "GET /api/players/:id") return "view.player";
  if (key === "GET /api/leaderboard") return "view.leaderboard";
  return key.replace(/^\w+ \/api\//, "").replace(/\//g, ".");
};

/** What's worth keeping from a route's answer, beyond the request itself. */
function outcome(key: string, out: unknown): Record<string, unknown> {
  const o = (out ?? {}) as Record<string, any>;
  const x: Record<string, unknown> = {};
  const me = o.me ?? (o.progress ? o : undefined);
  if (me?.progress) x.balance = { chips: me.progress.chips, coins: me.progress.coins };
  if (key === "POST /api/season/pack") Object.assign(x, { items: o.items, dupeXp: o.dupeXp });
  if (key === "POST /api/chips/daily") x.chips = o.chips;
  if (key === "POST /api/chips/refill") x.chips = o.refilled;
  if (key === "POST /api/prestige") Object.assign(x, { coins: o.coins, unlocked: o.unlocked });
  if (key === "POST /api/solo/start") Object.assign(x, { gameId: o.gameId, players: o.players, stage: o.stage });
  if (key === "POST /api/solitaire/finish" || key === "POST /api/solitaire/bank" || key === "POST /api/freecell/finish" || key === "POST /api/freecell/bank") x.reward = o.reward && { xp: o.reward.xp };
  if (key === "POST /api/board/new" && o.post) Object.assign(x, { post: o.post.id, kind: o.post.kind, title: o.post.title });
  if (key === "POST /api/lounge/report" && o.reported) Object.assign(x, { reported: o.reported, hidden: o.hidden });
  if (key === "POST /api/solo/finish" || key === "POST /api/solo/quit") x.reward = o.reward && { xp: o.reward.xp, coins: o.reward.coins, payout: o.reward.payout };
  return x;
}

type Handler = (body: Record<string, unknown>, token: string | undefined, query: URLSearchParams, param: string) => Promise<unknown>;

export function accountsApi(svc: AccountService, o: ApiOptions = {}) {
  const now = o.now ?? Date.now;
  const tries = new Map<string, number[]>();
  const limited = (key: string) => {
    const t = now();
    const recent = (tries.get(key) ?? []).filter((x) => t - x < AUTH_WINDOW_MS);
    recent.push(t);
    tries.set(key, recent);
    if (tries.size > 10_000) tries.clear();
    return recent.length > AUTH_TRIES;
  };

  const me = (token: string | undefined) => svc.require(token);
  const social = () => {
    if (!o.social) throw new ApiError(404, "Friends aren't set up on this server");
    return o.social;
  };
  const opened = new Map<string, number>();
  const reports = new Map<string, number[]>();
  const adminTries = new Map<string, number[]>();
  const ipOf = (req: IncomingMessage) => String(req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  const within = (m: Map<string, number[]>, key: string, windowMs: number, max: number) => {
    const t = now();
    const recent = (m.get(key) ?? []).filter((x) => t - x < windowMs);
    recent.push(t);
    m.set(key, recent);
    if (m.size > 10_000) m.clear();
    return recent.length <= max;
  };

  /** The app reports screens and taps; each becomes a "ui.*" activity event. */
  async function track(body: Record<string, unknown>, token: string | undefined, w: Where) {
    const a = await me(token);
    if (!within(reports, a.id, 60_000, TRACK_PER_MIN)) throw new ApiError(429, "Slow down");
    const list = Array.isArray(body.events) ? body.events.slice(0, TRACK_EVENTS) : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const kind = typeof e.kind === "string" && /^[a-z]{2,12}$/.test(e.kind) ? e.kind : null;
      if (!kind) continue;
      const name = typeof e.name === "string" ? e.name.slice(0, 80) : "";
      const data: Record<string, unknown> = { name };
      if (e.data && typeof e.data === "object") Object.assign(data, scrub(e.data) as object);
      if (typeof e.at === "number") data.clientAt = e.at;
      svc.track({ kind: `ui.${kind}`, userId: a.id, name: a.name, ...w, ua: undefined, source: "app", data });
    }
    return { ok: true };
  }

  /** Log one API call: who, what they sent (no secrets), and how it went. */
  async function record(key: string, body: Record<string, unknown>, token: string | undefined, w: Where, out: unknown, error?: string) {
    if (UNLOGGED.has(key)) return;
    const res = out as { me?: { id: string; name: string } } | undefined;
    let who = res?.me ? { id: res.me.id, name: res.me.name } : null;
    if (!who) {
      const a = await svc.fromToken(token).catch(() => null);
      if (a) who = { id: a.id, name: a.name };
    }
    if (key === "GET /api/me") {
      if (!who || now() - (opened.get(who.id) ?? 0) < OPEN_EVERY_MS) return;
      opened.set(who.id, now());
      if (opened.size > 50_000) opened.clear();
      svc.track({ kind: "app.open", userId: who.id, name: who.name, ...w });
      return;
    }
    // the user agent is kept where it tells a person from a bot: a new guest, and calls from no account
    const keepUa = key === "POST /api/auth/guest" || !who;
    // where a new guest came from (the app sends the page that linked to the site)
    const ref = key === "POST /api/auth/guest" && typeof body.ref === "string" && body.ref ? body.ref.slice(0, 300) : undefined;
    // a finished game's moves are kept with the game itself (the admin panel replays them)
    const sent =
      key === "POST /api/solo/finish" && Array.isArray(body.answers) ? { ...body, answers: undefined, moves: body.answers.length }
      : (key === "POST /api/solitaire/finish" || key === "POST /api/solitaire/bank" || key === "POST /api/freecell/finish" || key === "POST /api/freecell/bank") && Array.isArray(body.moves) ? { ...body, moves: body.moves.length }
      : key === "POST /api/auth/guest" ? { ...body, ref: undefined }
      : body;
    const data = { ...(scrub(sent) as object), ...(error ? {} : outcome(key, out)) };
    svc.track({ kind: kindOf(key), userId: who?.id, name: who?.name, ...w, ua: keepUa ? w.ua : undefined, ...(ref ? { ref } : {}), ok: !error, error, data: Object.keys(data).length ? data : undefined });
  }

  /** /api/admin/*: the owner's panel. Its own sign-in; never a player's token. */
  async function adminRoute(req: IncomingMessage, res: ServerResponse, url: URL, ip: string) {
    const admin = o.admin;
    if (!admin) return send(res, 404, { error: "Not found" });
    const path = url.pathname.slice("/api/admin".length);
    try {
      if (req.method === "POST" && path === "/login") {
        if (!within(adminTries, ip, 15 * 60_000, ADMIN_TRIES)) throw new ApiError(429, "Too many tries. Wait 15 minutes.");
        const b = await readBody(req, BODY_LIMIT);
        const s = await admin.auth.login(b.user, b.password);
        svc.track({ kind: "admin.login", ip, device: deviceOf(req), ok: !!s, error: s ? undefined : "wrong username or password", data: { user: typeof b.user === "string" ? b.user.slice(0, 60) : null, role: s?.role } });
        if (!s) throw new ApiError(401, "Wrong username or password");
        return send(res, 200, s);
      }
      const auth = req.headers.authorization;
      const who = admin.auth.check(auth?.startsWith("Bearer ") ? auth.slice(7) : undefined);
      if (!who) throw new ApiError(401, "Please sign in");
      const team = admin.auth.team;
      if (req.method === "POST" && (path === "/team" || path === "/team/remove" || path === "/layout")) {
        const b = await readBody(req, BODY_LIMIT);
        if (path === "/layout") {
          const layout = Array.isArray(b.layout) ? b.layout.filter((x): x is string => typeof x === "string" && /^[\w.-]{1,40}$/.test(x)).slice(0, 60) : null;
          team.setLayout(who.user, layout);
          return send(res, 200, { layout });
        }
        const members = path === "/team" ? await admin.auth.addMember(who, b.user, b.password) : admin.auth.removeMember(who, b.user);
        svc.track({ kind: path === "/team" ? "admin.team" : "admin.unteam", ip, data: { by: who.user, user: typeof b.user === "string" ? b.user.slice(0, 40) : null } });
        return send(res, 200, { members });
      }
      const act = path.match(/^\/accounts\/([\w-]{1,60})\/(note|unnote|tags|flag|ban)$/);
      if (req.method === "POST" && act) {
        const b = await readBody(req, BODY_LIMIT);
        const [, uid, what] = act;
        const target = await svc.store.get(uid);
        if (!target) throw new ApiError(404, "No such account");
        const crm =
          what === "note" ? await svc.addNote(uid, b.text)
          : what === "unnote" ? await svc.deleteNote(uid, b.id)
          : what === "tags" ? await svc.setTags(uid, b.tags)
          : what === "flag" ? await svc.setFlag(uid, b.reason)
          : await svc.ban(uid, b.reason, b.days === undefined ? null : b.days);
        svc.track({ kind: `admin.${what}`, userId: uid, name: target.name, ip, data: { ...(scrub(b) as Record<string, unknown>), by: who.user } });
        return send(res, 200, { crm });
      }
      const boardAct = path.match(/^\/board\/(\d{1,9})$/);
      if (req.method === "POST" && boardAct && o.board) {
        const b = await readBody(req, BODY_LIMIT);
        const out = await manageBoard(o.board, Number(boardAct[1]), b);
        svc.track({ kind: "admin.board", ip, data: { ...(scrub(b) as Record<string, unknown>), post: Number(boardAct[1]), by: who.user } });
        return send(res, 200, out);
      }
      if (req.method !== "GET") throw new ApiError(404, "Not found");
      const q = url.searchParams;
      const id = path.match(/^\/(accounts|games)\/([\w-]{1,60})$/);
      if (path === "/me") return send(res, 200, { ...who, layout: team.layout(who.user) });
      if (path === "/team") {
        if (who.role !== "owner") throw new ApiError(403, "Only the owner can manage admins");
        return send(res, 200, { members: team.list() });
      }
      if (path === "/feedback") return send(res, 200, await admin.svc.feedback());
      if (path === "/economy") return send(res, 200, await admin.svc.economy());
      if (path === "/overview") return send(res, 200, await admin.svc.overview());
      if (path === "/accounts") return send(res, 200, await admin.svc.list(q));
      if (path === "/activity") return send(res, 200, await admin.svc.activity(q));
      if (path === "/funnel") return send(res, 200, await admin.svc.funnel(q));
      if (path === "/bots") return send(res, 200, await admin.svc.bots(q));
      if (path === "/live") return send(res, 200, (await admin.svc.overview()).live);
      if (path === "/server") {
        if (!admin.hosting) throw new ApiError(404, "Not found");
        return send(res, 200, { ...(await admin.hosting.report()), live: (await admin.svc.overview()).live });
      }
      if (path === "/tags") return send(res, 200, { tags: await admin.svc.tags() });
      if (path === "/board") {
        if (!o.board) throw new ApiError(404, "Not found");
        return send(res, 200, { posts: o.board.all(), reward: BOARD_REWARD, voterReward: BOARD_VOTER_REWARD });
      }
      if (path === "/lounge") {
        if (!o.lounge) throw new ApiError(404, "Not found");
        return send(res, 200, { players: o.lounge.watchList() });
      }
      const conduct = path.match(/^\/accounts\/([\w-]{1,60})\/lounge$/);
      if (conduct) {
        if (!o.lounge) throw new ApiError(404, "Not found");
        return send(res, 200, { conduct: o.lounge.conductOf(conduct[1]) });
      }
      const chats = path.match(/^\/accounts\/([\w-]{1,60})\/chats$/);
      if (chats) {
        if (!o.social) throw new ApiError(404, "Not found");
        svc.track({ kind: "admin.chats", userId: chats[1], ip, data: { by: who.user } });
        return send(res, 200, { chats: await o.social.chatsOf(chats[1]) });
      }
      if (id?.[1] === "accounts") {
        const a = await admin.svc.account(id[2]);
        return a ? send(res, 200, a) : send(res, 404, { error: "No such account" });
      }
      if (id?.[1] === "games") {
        const g = admin.svc.game(id[2]);
        return g ? send(res, 200, g) : send(res, 404, { error: "That game's record isn't on this server" });
      }
      throw new ApiError(404, "Not found");
    } catch (e) {
      if (e instanceof ApiError) send(res, e.status, { error: e.message });
      else {
        console.error(e);
        send(res, 500, { error: "Something went wrong" });
      }
    }
  }

  const routes: Record<string, Handler> = {
    "GET /api/config": async () => ({
      providers: [...svc.oauth.providers(), "email", ...(svc.devLogins ? ["dev"] : [])],
      ...svc.oauth.publicConfig(),
    }),
    "POST /api/auth/guest": async (b) => svc.guest(b.token, b.name),
    "POST /api/auth/register": async (b, t) => svc.register(b.email, b.password, b.name, t),
    "POST /api/auth/login": async (b) => svc.login(b.email, b.password),
    "POST /api/auth/oauth": async (b, t) => svc.oauthSignIn(b.provider, b.credential, b.name, t),
    "POST /api/auth/dev": async (b, t) => svc.dev(b.name, t),
    "POST /api/auth/signout-everywhere": async (_, t) => svc.signOutEverywhere(await me(t)),
    "GET /api/me": async (_, t) => svc.me(await me(t)),
    "POST /api/me/name": async (b, t) => svc.rename(await me(t), b.name),
    "POST /api/me/password": async (b, t) => svc.changePassword(await me(t), b.current, b.password),
    "POST /api/me/delete": async (_, t) => (await svc.remove(await me(t)), { ok: true }),
    "POST /api/prestige": async (_, t) => svc.prestige(await me(t)),
    "POST /api/shop/buy": async (b, t) => svc.buy(await me(t), b.id),
    "POST /api/shop/equip": async (b, t) => svc.equip(await me(t), b.id),
    "POST /api/season/pack": async (b, t) => svc.openPack(await me(t), b.paid),
    "POST /api/chips/refill": async (_, t) => svc.refill(await me(t)),
    "POST /api/chips/daily": async (_, t) => svc.daily(await me(t)),
    "POST /api/solo/start": async (b, t) => svc.soloStart(await me(t), b.players, b.stakes, b.scaled, b.campaign, b.coached, b.gentle, b.lessons),
    "POST /api/solo/finish": async (b, t) => svc.soloFinish(await me(t), b.gameId, b.answers),
    "POST /api/solitaire/start": async (_b, t) => svc.solitaireStart(await me(t)),
    "POST /api/solitaire/finish": async (b, t) => svc.solitaireBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/solitaire/bank": async (b, t) => svc.solitaireBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/freecell/start": async (_b, t) => svc.freecellStart(await me(t)),
    "POST /api/freecell/finish": async (b, t) => svc.freecellBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/freecell/bank": async (b, t) => svc.freecellBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/tripeaks/start": async (_b, t) => svc.tripeaksStart(await me(t)),
    "POST /api/tripeaks/finish": async (b, t) => svc.tripeaksBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/tripeaks/bank": async (b, t) => svc.tripeaksBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/ers/start": async (_b, t) => svc.ersStart(await me(t)),
    "POST /api/ers/finish": async (b, t) => svc.ersBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/ers/bank": async (b, t) => svc.ersBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/spider/start": async (_b, t) => svc.spiderStart(await me(t)),
    "POST /api/spider/finish": async (b, t) => svc.spiderBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/spider/bank": async (b, t) => svc.spiderBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/pyramid/start": async (_b, t) => svc.pyramidStart(await me(t)),
    "POST /api/pyramid/finish": async (b, t) => svc.pyramidBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/pyramid/bank": async (b, t) => svc.pyramidBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/yukon/start": async (_b, t) => svc.yukonStart(await me(t)),
    "POST /api/yukon/finish": async (b, t) => svc.yukonBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/yukon/bank": async (b, t) => svc.yukonBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/scoundrel/start": async (_b, t) => svc.scoundrelStart(await me(t)),
    "POST /api/scoundrel/finish": async (b, t) => svc.scoundrelBank(await me(t), b.gameId, b.moves, true, b.drain),
    "POST /api/scoundrel/bank": async (b, t) => svc.scoundrelBank(await me(t), b.gameId, b.moves, false, b.drain),
    "POST /api/solo/quit": async (_, t) => svc.soloQuit(await me(t)),
    "POST /api/solo/drink": async (b, t) => {
      const count = typeof b.count === "number" && Number.isInteger(b.count) && b.count >= 1 && b.count <= 5 ? b.count : 1;
      return svc.payForDrink((await me(t)).id, b.id, count);
    },
    "GET /api/push/key": async () => ({ key: o.pushKey ?? null }),
    "POST /api/push/subscribe": async (b, t) => {
      if (!o.pushKey) throw new ApiError(404, "Turn alerts aren't set up on this server");
      return svc.pushSubscribe(await me(t), b.sub);
    },
    "POST /api/push/unsubscribe": async (b, t) => svc.pushUnsubscribe(await me(t), b.endpoint),
    "GET /api/friends": async (_, t) => social().view(await me(t)),
    "GET /api/friends/search": async (_, t, q) => ({ people: await social().search(await me(t), q.get("q")) }),
    "POST /api/friends/request": async (b, t) => social().request(await me(t), b.id),
    "POST /api/friends/accept": async (b, t) => social().accept(await me(t), b.id),
    "POST /api/friends/remove": async (b, t) => social().remove(await me(t), b.id),
    "POST /api/friends/invite": async (b, t) => social().invite(await me(t), b.id, b.code),
    "POST /api/friends/dismiss": async (b, t) => social().dismiss(await me(t), b.code),
    "GET /api/dm": async (_, t, q) => social().thread(await me(t), q.get("with"), q.has("before") ? Number(q.get("before")) : undefined),
    "POST /api/dm/send": async (b, t) => social().send(await me(t), b.to, b.text),
    "POST /api/chats/group": async (b, t) => social().createGroup(await me(t), b.name, b.members),
    "POST /api/chats/add": async (b, t) => social().addToGroup(await me(t), b.id, b.members),
    "POST /api/chats/rename": async (b, t) => social().renameGroup(await me(t), b.id, b.name),
    "POST /api/chats/leave": async (b, t) => social().leaveGroup(await me(t), b.id),
    "GET /api/coach/mistakes": async () => svc.mistakes(),
    "GET /api/leaderboard": async (_, __, q) => ({ rows: await svc.leaderboard(q.get("by")) }),
    "GET /api/players/:id": async (_, __, ___, id) => svc.publicProfile(id),
    ...(o.lounge ? loungeRoutes(o.lounge) : {}),
    ...(o.board ? boardRoutes(o.board) : {}),
  };

  /** The owner's changes to a board post: status, hide, merge, a comment as the Heist team, a comment taken down. */
  async function manageBoard(board: Board, id: number, b: Record<string, unknown>) {
    const refuse = <T,>(f: () => T): T => {
      try {
        return f();
      } catch (e) {
        if (e instanceof LoungeError) throw new ApiError(400, e.message.replace(/ in the Lounge/, ""));
        throw e;
      }
    };
    if (typeof b.commentId === "number") return { comment: refuse(() => board.manageComment(id, b.commentId, b.hideComment !== false)) };
    if (typeof b.reply === "string") return { comment: refuse(() => board.comment({ id: "heist-team", name: "Heist team" }, id, b.reply, true)), post: board.all().find((p) => p.id === id) };
    const { post, pay, statusChanged } = refuse(() => board.manage(id, b));
    // the author, then everyone who upvoted it (the author's own vote doesn't pay twice)
    let voters = 0;
    if (pay) {
      await svc.giveCoins(post.userId, BOARD_REWARD, `board #${post.id}`).catch(() => {});
      for (const v of post.votes) {
        if (v === post.userId) continue;
        if (await svc.giveCoins(v, BOARD_VOTER_REWARD, `board vote #${post.id}`).then(() => true, () => false)) voters++;
      }
    }
    if (statusChanged) void tellBoard(post, pay);
    return { post: { ...post, score: post.votes.length - (post.downs?.length ?? 0) }, paid: pay ? BOARD_REWARD : 0, voters };
  }

  /** A post's new status reaches its author (with the coins, when paid) and, when it ships, everyone who voted. */
  async function tellBoard(p: BoardPost, paid: boolean) {
    if (!o.notify) return;
    const word: Record<string, string> = { review: "is being looked at", planned: "is planned", doing: "is being worked on", shipped: "shipped", wont: "won't be done for now" };
    const what = word[p.status];
    if (!what) return;
    const title = p.title.length > 60 ? `${p.title.slice(0, 57)}...` : p.title;
    const tag = `board-${p.id}`;
    await o.notify(p.userId, { title: `Your post ${what}`, body: paid ? `"${title}". Thanks! +${BOARD_REWARD} coins.` : `"${title}"`, tag }).catch(() => 0);
    if (p.status !== "shipped" && !paid) return;
    const head = p.status === "shipped" ? "Something you voted for shipped" : "A bug you backed was confirmed";
    for (const v of p.votes) if (v !== p.userId) await o.notify(v, { title: head, body: paid ? `"${title}". +${BOARD_VOTER_REWARD} coins for backing it.` : `"${title}"`, tag }).catch(() => 0);
  }

  /** The feedback board: anyone reads it; players who've finished a game post, vote and comment. */
  function boardRoutes(board: Board): Record<string, Handler> {
    const why = (a: { progress: Progress } | null) => {
      if (!a) return "Open the app to join in";
      const p = a.progress;
      return p.xp || p.coachGames || p.prestige ? null : "Finish your first game to post and vote";
    };
    const refuse = <T,>(f: () => T): T => {
      try {
        return f();
      } catch (e) {
        if (e instanceof LoungeError) throw new ApiError(400, e.message.replace(/ in the Lounge/, ""));
        throw e;
      }
    };
    const player = async (t: string | undefined) => {
      const a = await me(t);
      const no = svc.banOf(a) ? "This account is suspended" : why(a);
      if (no) throw new ApiError(403, no);
      return a;
    };
    return {
      "GET /api/board": async (_, t, q) => {
        const a = await svc.fromToken(t).catch(() => null);
        const no = a && svc.banOf(a) ? "This account is suspended" : why(a);
        return { posts: board.list(a?.id, q.get("sort")), canPost: !no, reward: BOARD_REWARD, voterReward: BOARD_VOTER_REWARD, ...(no ? { why: no } : {}) };
      },
      "GET /api/board/post": async (_, t, q) => {
        const a = await svc.fromToken(t).catch(() => null);
        const p = board.post(Number(q.get("id")), a?.id);
        if (!p) throw new ApiError(404, "That post is gone");
        return { post: p };
      },
      "POST /api/board/new": async (b, t) => {
        const a = await player(t);
        return { post: refuse(() => board.add({ id: a.id, name: a.name, badge: badgeOf(upgrade(a.progress)) }, b)) };
      },
      "POST /api/board/vote": async (b, t) => {
        const a = await player(t);
        return refuse(() => board.vote(a.id, b.id, b.dir));
      },
      "POST /api/board/comment": async (b, t) => {
        const a = await player(t);
        return { comment: refuse(() => board.comment({ id: a.id, name: a.name, badge: badgeOf(upgrade(a.progress)) }, b.id, b.text)) };
      },
      "POST /api/board/report": async (b, t) => {
        const a = await me(t);
        const r = board.report(a.id, b.id, b.comment);
        return r ? { ok: true, hidden: r.hidden } : { ok: false };
      },
    };
  }

  /** The Lounge: anyone can read it; players who've finished a game (lesson, solo or online) can talk. */
  function loungeRoutes(lounge: Lounge): Record<string, Handler> {
    const why = (a: { progress: Progress } | null) => {
      if (!a) return "Open the app to join the Lounge";
      const p = a.progress;
      return p.xp || p.coachGames || p.prestige ? null : "Finish your first game to chat in the Lounge";
    };
    /** a refusal the player can read becomes a 400 */
    const refuse = <T,>(f: () => T): T => {
      try {
        return f();
      } catch (e) {
        if (e instanceof LoungeError) throw new ApiError(400, e.message);
        throw e;
      }
    };
    return {
      "GET /api/lounge": async (_, t, q) => {
        const a = await svc.fromToken(t).catch(() => null);
        const after = Number(q.get("after"));
        const no = a && svc.banOf(a) ? "This account is suspended" : why(a);
        return { ...lounge.feed(Number.isInteger(after) && after > 0 ? after : 0, a?.id), canPost: !no, ...(no ? { why: no } : {}) };
      },
      "POST /api/lounge/say": async (b, t) => {
        const a = await me(t);
        const no = why(a);
        if (no) throw new ApiError(403, no);
        return { msg: refuse(() => lounge.say({ id: a.id, name: a.name, badge: badgeOf(upgrade(a.progress)) }, b.text)) };
      },
      /** send a drink (coins) to whoever said a line: it shows in the Lounge for everyone */
      "POST /api/lounge/drink": async (b, t) => {
        const a = await me(t);
        const no = why(a);
        if (no) throw new ApiError(403, no);
        const d = drinkInfo(String(b.id));
        if (!d) throw new ApiError(400, "No such drink");
        if (d.round) throw new ApiError(400, "Rounds are for the table. Pick one drink.");
        const to = refuse(() => lounge.drinkFor(a.id, b.to));
        refuse(() => lounge.pace(a.id, true));
        const paid = await svc.payForDrink(a.id, d.id, 1);
        const msg = refuse(() => lounge.sendDrink({ id: a.id, name: a.name, badge: badgeOf(upgrade(a.progress)) }, to, d));
        await svc.drinkReceived(to.userId).catch(() => {});
        return { msg, me: paid };
      },
      /** muting hides a player on your own screen; the server only counts it, for the owner */
      "POST /api/lounge/mute": async (b, t) => {
        const a = await me(t);
        return { ok: lounge.mute(a.id, b.userId, b.on !== false) };
      },
      "POST /api/lounge/report": async (b, t) => {
        const a = await me(t);
        const r = lounge.report(a.id, b.id);
        return r ? { ok: true, hidden: r.hidden, reported: { userId: r.msg.userId, name: r.msg.name, text: r.msg.text } } : { ok: false };
      },
    };
  }

  function cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (origin) {
      if (o.allowedOrigins?.length && !o.allowedOrigins.includes(origin)) return false;
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type, x-heist-device");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader("access-control-max-age", "600");
    }
    return true;
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function readBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          reject(new ApiError(413, "Too big"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString());
          resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
        } catch {
          reject(new ApiError(400, "Bad JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  /** Handles /api/* requests; returns false for anything else. */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/")) return false;
    if (!cors(req, res)) {
      send(res, 403, { error: "Origin not allowed" });
      return true;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return true;
    }
    const ip = ipOf(req);
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 300);
    const w: Where = { ip, device: deviceOf(req), ua: ua || undefined };
    if (ua.includes(CLAUDE_UA)) w.tester = "claude";
    if (url.pathname.startsWith("/api/admin/")) {
      await adminRoute(req, res, url, ip);
      return true;
    }
    let key = `${req.method} ${url.pathname}`;
    let param = "";
    const player = url.pathname.match(/^\/api\/players\/([\w-]{1,40})$/);
    if (player && req.method === "GET") {
      key = "GET /api/players/:id";
      param = player[1];
    }
    const route =
      key === "POST /api/track" ? (b: Record<string, unknown>, t: string | undefined) => track(b, t, w)
      : key === "POST /api/feedback" ? async (b: Record<string, unknown>, t: string | undefined) => svc.feedback(await me(t), b, w.tester === "claude")
      : routes[key];
    if (!route) {
      send(res, 404, { error: "Not found" });
      return true;
    }
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    let body: Record<string, unknown> = {};
    try {
      if (key.startsWith("POST /api/auth/") || key === "POST /api/me/password") {
        if (limited(ip)) throw new ApiError(429, "Too many tries. Wait a few minutes and try again.");
      }
      body = req.method === "POST" ? await readBody(req, key === "POST /api/solo/finish" || key === "POST /api/solitaire/finish" || key === "POST /api/solitaire/bank" || key === "POST /api/freecell/finish" || key === "POST /api/freecell/bank" ? SOLO_BODY_LIMIT : BODY_LIMIT) : {};
      if (param) body = { ...body, id: param };
      const out = await route(body, token, url.searchParams, param);
      send(res, 200, out);
      await record(key, body, token, w, out).catch((e) => console.error("activity", e));
    } catch (e) {
      await record(key, body, token, w, undefined, e instanceof ApiError ? e.message : "server error").catch(() => {});
      if (e instanceof ApiError) send(res, e.status, { error: e.message });
      else {
        console.error(e);
        send(res, 500, { error: "Something went wrong" });
      }
    }
    return true;
  };
}
