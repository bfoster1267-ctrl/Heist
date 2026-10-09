import { Bot, runBots, type Answer, type GameState } from "@heist/engine";
import { STAGES, botLevelsFor, createSoloGame, type SoloSetup } from "@heist/profile";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OAuth } from "../src/accounts/oauth";
import { AccountService } from "../src/accounts/service";
import { FileAccountStore } from "../src/accounts/store";
import { HeistClient } from "../src/client";
import type { ServerMsg } from "../src/protocol";
import { startServer, type HeistServer } from "../src/server";
import { simpleAnswer } from "./helpers";

const servers: HeistServer[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ------------------------------------------------------------------ a fake Google, for real signature checks

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims: Record<string, unknown>, key = privateKey) {
  const head = b64({ alg: "RS256", kid: "k1" });
  const body = b64({ iss: "https://accounts.google.com", aud: "web-client", exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}
const fakeFetch = async (url: string) => ({
  ok: true,
  json: async () => (url.includes("googleapis") ? { keys: [jwk] } : {}),
});
const verifier = () => new OAuth({ google: { clientIds: ["web-client"] } }, fakeFetch);

/** Play a solo game from the server's seed with a bot in the player's chair, recording answers. */
function playSolo(seed: number, players: number, setup?: SoloSetup) {
  const { game, bots } = createSoloGame(seed, players, "Me", true, setup);
  const me = new Bot(seed + 99);
  const answers: Answer[] = [];
  for (;;) {
    runBots(game, bots);
    const p = game.pending;
    if (!p) break;
    const a = me.answer(game, p);
    game.answer(p.seat, a);
    answers.push(a);
  }
  return { answers, won: game.s.winners!.includes(0) };
}

describe("accounts", () => {
  it("creates email accounts, checks passwords, and turns a guest into an account keeping progress", async () => {
    const svc = new AccountService({ secret: "s" });
    const g = await svc.guest(undefined, "Ace");
    expect(g.me.guest).toBe(true);
    await svc.buy(await svc.require(g.token), "title.smooth"); // spend some starting coins as a guest
    const r = await svc.register("Ace@Example.com", "hunter22hunter", "Ace", g.token);
    expect(r.me.id).toBe(g.me.id);
    expect(r.me.guest).toBe(false);
    expect(r.me.progress.owned).toContain("title.smooth");
    await expect(svc.register("ace@example.com", "anotherpass", "X")).rejects.toThrow(/already/);
    await expect(svc.login("ace@example.com", "wrongpass")).rejects.toThrow(/Wrong/);
    expect((await svc.login(" ACE@example.com", "hunter22hunter")).me.id).toBe(g.me.id);
    await expect(svc.register("nope", "hunter22hunter", "X")).rejects.toThrow();
    await expect(svc.register("a@b.co", "short", "X")).rejects.toThrow();
  });

  it("verifies Google ID tokens and rejects forged, expired or foreign ones", async () => {
    const svc = new AccountService({ secret: "s", verifier: verifier() });
    const a = await svc.oauthSignIn("google", idToken({ sub: "g-123", name: "Gina", email: "gina@x.com" }), undefined);
    expect(a.me.name).toBe("Gina");
    expect(a.me.logins).toEqual(["google"]);
    const again = await svc.oauthSignIn("google", idToken({ sub: "g-123" }), undefined);
    expect(again.me.id).toBe(a.me.id);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await expect(svc.oauthSignIn("google", idToken({ sub: "g-1" }, other), undefined)).rejects.toThrow(/signature/);
    await expect(svc.oauthSignIn("google", idToken({ sub: "g-1", exp: 1000 }), undefined)).rejects.toThrow(/expired/);
    await expect(svc.oauthSignIn("google", idToken({ sub: "g-1", aud: "someone-else" }), undefined)).rejects.toThrow(/different app/);
    await expect(svc.oauthSignIn("apple", idToken({ sub: "g-1" }), undefined)).rejects.toThrow(/set up/);
  });

  it("changes an email account's password only with the current one", async () => {
    const svc = new AccountService({ secret: "s" });
    const r = await svc.register("pw@example.com", "firstpass1", "Pat");
    await expect(svc.changePassword(await svc.require(r.token), "wrongpass", "secondpass2")).rejects.toThrow(/current password/);
    await expect(svc.changePassword(await svc.require(r.token), "firstpass1", "short")).rejects.toThrow(/8 characters/);
    await svc.changePassword(await svc.require(r.token), "firstpass1", "secondpass2");
    await expect(svc.login("pw@example.com", "firstpass1")).rejects.toThrow(/Wrong/);
    expect((await svc.login("pw@example.com", "secondpass2")).me.id).toBe(r.me.id);
  });

  it("counts an abandoned online game as a quit: buy-in lost, no pot, no win", async () => {
    const svc = new AccountService({ secret: "s" });
    const a = await svc.register("stay@example.com", "password1", "Stay");
    const b = await svc.register("walk@example.com", "password1", "Walk");
    const chips = a.me.progress.chips;
    const out = await svc.recordOnline({
      stakes: 250,
      players: 3,
      seats: [{ seat: 0, userId: a.me.id, bot: false }, { seat: 1, userId: b.me.id, bot: false }, { seat: 2, userId: null, bot: true }],
      // seat 1 won on the table but had left, so the pot went to seat 0
      winners: [0],
      abandoned: [1],
      events: [],
    });
    const stay = out.get(a.me.id)!.me.progress;
    const walk = out.get(b.me.id)!.me.progress;
    expect(stay.chips).toBe(chips - 250 + 750);
    expect(stay.stats.wins).toBe(1);
    expect(walk.chips).toBe(chips - 250);
    expect(walk.stats).toMatchObject({ games: 1, wins: 0, losses: 1, quits: 1 });
    expect(walk.stats.recent[0]).toMatchObject({ won: false, quit: true, net: -250 });
  });

  it("signs out everywhere and deletes accounts", async () => {
    const svc = new AccountService({ secret: "s", devLogins: true });
    const a = await svc.dev("Dana");
    const b = await svc.signOutEverywhere(await svc.require(a.token));
    expect(await svc.fromToken(a.token)).toBeNull();
    expect(await svc.fromToken(b.token)).not.toBeNull();
    await svc.remove(await svc.require(b.token));
    expect(await svc.fromToken(b.token)).toBeNull();
    // the name is free to sign up with again, as a fresh account
    expect((await svc.dev("Dana")).me.id).not.toBe(a.me.id);
  });

  it("pays out vs-bots games only after replaying them, and counts quits as losses", async () => {
    const svc = new AccountService({ secret: "s" });
    const { token } = await svc.guest(undefined, "Solo");
    const acct = () => svc.require(token);
    const s = await svc.soloStart(await acct(), 4, 250);
    expect(s.me.progress.chips).toBe(10_000 - 250);
    const game = playSolo(s.seed, 4);
    await expect(svc.soloFinish(await acct(), s.gameId, game.answers.slice(0, -1))).rejects.toThrow(/check out/); // one answer short: never a finished game
    const done = await svc.soloFinish(await acct(), s.gameId, game.answers);
    expect(done.me.progress.stats.games).toBe(1);
    expect(done.me.progress.chips).toBe(10_000 - 250 + (game.won ? done.reward.payout : 0));
    expect(done.reward.xp).toBeGreaterThanOrEqual(50);
    await expect(svc.soloFinish(await acct(), s.gameId, game.answers)).rejects.toThrow(/isn't running/);

    const s2 = await svc.soloStart(await acct(), 3, 100);
    const s3 = await svc.soloStart(await acct(), 3, 100); // walked away from s2
    expect(s3.quit?.xp).toBe(0);
    expect(s3.me.progress.stats.quits).toBe(1);
    expect(s3.me.progress.stats.games).toBe(2);
    expect(s2.gameId).not.toBe(s3.gameId);
    await expect(svc.soloStart(await acct(), 3, 1_000_000)).rejects.toThrow(/chips/);
  });

  it("runs Coached play free, for a little XP, out of the career, and tallies rookie mistakes", async () => {
    const svc = new AccountService({ secret: "s" });
    const { token } = await svc.guest(undefined, "Learner");
    const acct = () => svc.require(token);
    const s = await svc.soloStart(await acct(), 4, 5000, undefined, undefined, true);
    expect(s.me.progress.chips).toBe(10_000); // no buy-in, whatever stakes were sent
    const game = playSolo(s.seed, 4);
    const done = await svc.soloFinish(await acct(), s.gameId, game.answers);
    expect(done.me.progress.stats.games).toBe(0);
    expect(done.me.progress.chips).toBe(10_000);
    expect(done.me.progress.coachGames).toBe(1);
    expect(done.reward.xp).toBeLessThanOrEqual(50);
    const report = await svc.mistakes();
    expect(report.coachGames).toBe(1);
    expect(report.counts.map((c) => c.id)).toContain("alreadyIn");

    // newer clients ask for the gentle bots, and the server replays with them
    const soft = await svc.soloStart(await acct(), 4, 0, true, undefined, true, true);
    expect(soft.gentle).toBe(true);
    expect(soft.levels).toBeUndefined();
    const g2 = playSolo(soft.seed, 4, { gentle: true });
    expect((await svc.soloFinish(await acct(), soft.gameId, g2.answers)).me.progress.coachGames).toBe(2);

    // walking out of a coached game costs nothing and isn't a quit
    await svc.soloStart(await acct(), 3, 0, undefined, undefined, true);
    const next = await svc.soloStart(await acct(), 3, 100);
    expect(next.quit).toBeNull();
    expect(next.me.progress.stats.quits).toBe(0);
  });

  it("scales vs-bots tables to a hidden skill rating, replaying them with the same bots", async () => {
    const svc = new AccountService({ secret: "s" });
    const { token } = await svc.guest(undefined, "Solo");
    const acct = () => svc.require(token);
    // an older client (no `scaled`) gets the normal bots it knows how to build
    expect((await svc.soloStart(await acct(), 4, 0)).levels).toBeUndefined();
    const s = await svc.soloStart(await acct(), 4, 0, true);
    // walking out of the first game cost some rating, so the bots ease off a little
    expect(s.me.progress.rating).toBeLessThan(1000);
    expect(s.levels).toEqual(botLevelsFor(s.me.progress.rating, 3));
    expect(s.levels).toContain("easy");
    const game = playSolo(s.seed, 4, { levels: s.levels });
    const done = await svc.soloFinish(await acct(), s.gameId, game.answers);
    const p = done.me.progress;
    expect(p.ratedGames).toBe(2);
    if (game.won) expect(p.rating).toBeGreaterThan(s.me.progress.rating);
    else expect(p.rating).toBeLessThanOrEqual(s.me.progress.rating);

    // a strong player gets hard bots, a weak one easy bots
    const x = await acct();
    x.progress.rating = 1200;
    await svc.store.put(x);
    expect((await svc.soloStart(await acct(), 5, 0, true)).levels).toEqual(["hard", "hard", "hard", "hard"]);
    expect(await svc.botLevel(x.id)).toBe("hard");
    const y = await acct();
    y.progress.rating = 900;
    await svc.store.put(y);
    expect((await svc.soloStart(await acct(), 3, 0, true)).levels).toEqual(["easy", "easy"]);
  });

  it("plays the campaign in order, paying and giving items on the first clear only", async () => {
    const svc = new AccountService({ secret: "s" });
    const { token } = await svc.guest(undefined, "Climber");
    const acct = () => svc.require(token);
    await expect(svc.soloStart(await acct(), 3, 0, true, 2)).rejects.toThrow(/before that one/);
    await expect(svc.soloStart(await acct(), 3, 0, true, 99)).rejects.toThrow(/No such stage/);
    // stage 4 gives a title; pretend stages 1-3 are cleared and win stage 4 (keep trying seeds until the stand-in wins)
    const x = await acct();
    x.progress.campaign = 3;
    await svc.store.put(x);
    let done;
    for (let i = 0; i < 40 && !done?.reward.lines.some((l) => l.label.startsWith("Cleared")); i++) {
      const s = await svc.soloStart(await acct(), 6, 5000, true, 4);
      expect(s).toMatchObject({ players: 4, stage: 4, levels: undefined });
      expect(s.me.progress.chips).toBe(10_000); // no buy-in
      const game = playSolo(s.seed, s.players, { stage: 4 });
      done = await svc.soloFinish(await acct(), s.gameId, game.answers);
      expect(done.me.progress.campaign).toBe(game.won ? 4 : 3);
    }
    const p = done!.me.progress;
    expect(p.campaign).toBe(4);
    expect(p.owned).toContain("title.wheelman");
    expect(done!.reward.unlocked).toContain("title.wheelman");
    expect(done!.reward.lines).toContainEqual({ label: "Cleared Armored Van", xp: STAGES[3].xp, coins: STAGES[3].coins });
    // replaying a cleared stage pays like a normal game
    const again = await svc.soloStart(await acct(), 3, 0, true, 4);
    const game = playSolo(again.seed, again.players, { stage: 4 });
    const r = await svc.soloFinish(await acct(), again.gameId, game.answers);
    expect(r.reward.lines.some((l) => l.label.startsWith("Cleared"))).toBe(false);
    await expect(svc.buy(await acct(), "title.mastermind")).rejects.toThrow(/campaign stage 12/);
  });

  it("moves online ratings by who beat whom", async () => {
    const svc = new AccountService({ secret: "s" });
    const a = await svc.register("win@example.com", "password1", "Win");
    const b = await svc.register("lose@example.com", "password1", "Lose");
    const out = await svc.recordOnline({
      stakes: 0,
      players: 3,
      seats: [{ seat: 0, userId: a.me.id, bot: false }, { seat: 1, userId: b.me.id, bot: false }, { seat: 2, userId: null, bot: true }],
      winners: [0],
      events: [],
      botLevel: "hard",
    });
    const win = out.get(a.me.id)!.me.progress;
    const lose = out.get(b.me.id)!.me.progress;
    expect(win.rating).toBeGreaterThan(1000);
    expect(lose.rating).toBeLessThan(1000);
    // the winner also beat the (hard) bot; the loser only lost to the winner
    expect(win.rating - 1000).toBeGreaterThan(1000 - lose.rating);
  });

  it("keeps accounts in a file across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-acct-"));
    dirs.push(dir);
    const one = new AccountService({ secret: "s", store: new FileAccountStore(dir) });
    const r = await one.register("keep@x.com", "longenough", "Keeper");
    await one.store.flush();
    const two = new AccountService({ secret: "s", store: new FileAccountStore(dir) });
    expect((await two.require(r.token)).name).toBe("Keeper");
    expect((await two.login("keep@x.com", "longenough")).me.id).toBe(r.me.id);
  });
});

describe("season packs", () => {
  it("sells a pack for chips, keeps a top-up's worth back, and opens free packs", async () => {
    const svc = new AccountService({ secret: "s", now: () => Date.UTC(2026, 10, 1) });
    const { me } = await svc.register("packs@x.com", "longenough", "Packer");
    const a = await svc.require((await svc.login("packs@x.com", "longenough")).token);
    // a new player has 10,000 chips: two packs, then not a third
    const r1 = await svc.openPack(a, true);
    expect(r1.items.length).toBe(3);
    expect(r1.me.progress.chips).toBe(me.progress.chips - 3000);
    await svc.openPack(a, true);
    await expect(svc.openPack(a, true)).rejects.toThrow(/2,500 left/);
    await expect(svc.openPack(a, false)).rejects.toThrow(/free pack/);
    const owned = (await svc.store.get(a.id))!.progress.owned;
    expect(new Set(owned).size).toBe(6);
  });
});

describe("accounts over HTTP and the game socket", () => {
  it("serves the API, settles an online game with XP and stats, and sells drinks for coins", async () => {
    const accounts = new AccountService({ secret: "s", devLogins: true });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, rate: { burst: 1000, perSec: 1000 } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const post = async (path: string, body: object, token?: string) => {
      const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };

    const cfg = await (await fetch(`${base}/api/config`)).json();
    expect(cfg.providers).toEqual(["email", "dev"]);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);

    const ann = (await post("/api/auth/dev", { name: "Ann" })).body;
    const ben = (await post("/api/auth/register", { email: "ben@x.com", password: "bens-password", name: "Ben" })).body;
    expect(ann.me.name).toBe("Ann");
    expect((await post("/api/shop/buy", { id: "felt.vault" }, ann.token)).status).toBe(400); // prestige-only

    // two signed-in players and two bots play online
    const play = (token: string) => {
      const c = new HeistClient(`ws://127.0.0.1:${srv.port()}/ws`, { token });
      let view: GameState | null = null;
      const seen: ServerMsg[] = [];
      c.onAny((m) => {
        seen.push(m);
        if (m.t === "sync") view = m.state;
        if (m.t === "frames" && m.frames.length) view = m.frames[m.frames.length - 1].state;
        if (m.t === "ask" && view) c.answer(simpleAnswer(m.ask, view));
      });
      return { c, seen };
    };
    const a = play(ann.token);
    const b = play(ben.token);
    await Promise.all([a.c.connect(), b.c.connect()]);
    expect(a.c.userId).toBe(ann.me.id);
    a.c.create({ players: 4, stakes: 500 });
    await until(() => !!a.c.room);
    b.c.join(a.c.room!.code);
    await until(() => a.c.room?.seats.filter((s) => s.kind === "human").length === 2);
    expect(a.c.room!.seats[0].badge?.level).toBe(1);
    a.c.start();

    // Ann buys Ben a whiskey and the table a round
    await until(() => a.seen.some((m) => m.t === "frames"));
    a.c.drink("whiskey", 1);
    await until(() => b.seen.some((m) => m.t === "drink"));
    const d = b.seen.find((m) => m.t === "drink") as Extract<ServerMsg, { t: "drink" }>;
    expect(d).toMatchObject({ from: 0, to: [1], id: "whiskey", name: "Ann" });
    a.c.drink("whiskey", 1); // too soon after the last one
    await until(() => a.seen.some((m) => m.t === "error" && m.code === "rate_limited"));

    await until(() => a.seen.some((m) => m.t === "reward") && b.seen.some((m) => m.t === "reward"), 20_000);
    const over = a.seen.find((m) => m.t === "gameOver") as Extract<ServerMsg, { t: "gameOver" }>;
    const ra = a.seen.find((m) => m.t === "reward") as Extract<ServerMsg, { t: "reward" }>;
    const annWon = over.winners.includes(0);
    expect(ra.progress.stats.games).toBe(1);
    expect(ra.progress.stats.byMode.online.g).toBe(1);
    expect(ra.progress.coins).toBe(300 - 15 + ra.reward.coins);
    expect(ra.progress.chips).toBe(10_000 - 500 + (annWon ? Math.floor(2000 / over.winners.length) : 0));
    expect(ra.reward.lines.some((l) => l.label === "Online table")).toBe(true);

    const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${ben.token}` } })).json();
    expect(me.progress.drinksReceived).toBe(1);
    const board = await (await fetch(`${base}/api/leaderboard?by=wins`)).json();
    expect(board.rows.map((r: { id: string }) => r.id).sort()).toEqual([ann.me.id, ben.me.id].sort());
    const pub = await (await fetch(`${base}/api/players/${ben.me.id}`)).json();
    expect(pub.stats.games).toBe(1);
    expect(pub).not.toHaveProperty("email");

    // can't sit at a table you can't afford
    a.c.create({ players: 3, stakes: 1_000_000 });
    await until(() => a.seen.some((m) => m.t === "error" && m.code === "no_chips"));
    a.c.close();
    b.c.close();
  }, 30_000);
});

const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};
