import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AccountService } from "../src/accounts/service";
import { Lounge, cleanLine } from "../src/lounge";
import { startServer, type HeistServer } from "../src/server";

const servers: HeistServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
});

const refused = (s: string) => {
  try {
    cleanLine(s);
    return false;
  } catch {
    return true;
  }
};

describe("the Lounge filter", () => {
  it("stars out swears, keeps innocent words, refuses slurs and links", () => {
    expect(cleanLine("what the fuck")).toBe("what the f***");
    expect(cleanLine("FUUUCK this")).toBe("F***** this");
    expect(cleanLine("sh1t happens")).toBe("s*** happens");
    expect(cleanLine("you ass!")).toBe("you a**!");
    expect(cleanLine("pass the cocktail, classic assassin")).toBe("pass the cocktail, classic assassin");
    expect(cleanLine("Niger and Nigeria, a mini game")).toBe("Niger and Nigeria, a mini game");
    expect(cleanLine("  gg   wp  ")).toBe("gg wp");
    for (const s of ["n i g g e r", "kill yourself", "kys", "R3TARD", "visit spam.com", "www.example", "go to spam (dot) net", "", "   "]) expect(refused(s), s).toBe(true);
    expect(cleanLine("x".repeat(500)).length).toBe(200);
  });
});

describe("the Lounge", () => {
  it("paces each player, hides a message after three reports, and clears a suspended player's lines", () => {
    let now = 1_000;
    const l = new Lounge(() => now);
    const a = { id: "a", name: "A" };
    l.say(a, "hi");
    expect(() => l.say(a, "again")).toThrow(/Slow down/);
    now += 3_000;
    expect(() => l.say(a, "hi")).toThrow(/just said/);
    const m = l.say(a, "hello");
    expect(l.report("a", m.id)).toBeNull(); // not your own
    expect(l.report("b", m.id)!.hidden).toBe(false);
    expect(l.report("b", m.id)!.hidden).toBe(false); // the same person twice counts once
    expect(l.report("c", m.id)!.hidden).toBe(false);
    expect(l.report("d", m.id)!.hidden).toBe(true);
    const f = l.feed(0, "reader");
    expect(f.msgs.map((x) => x.text)).toEqual(["hi"]);
    expect(f.gone).toEqual([m.id]);
    expect(f.here).toBe(1);
    expect(l.feed(f.last).msgs).toEqual([]);
    l.removeUser("a");
    expect(l.feed(0).msgs).toEqual([]);
    for (let i = 0; i < 6; i++) {
      now += 3_000;
      l.say({ id: "z", name: "Z" }, `line ${i}`);
    }
    now += 3_000;
    expect(() => l.say({ id: "z", name: "Z" }, "one more")).toThrow(/minute/);
  });

  it("keeps the room and each player's record on disk: refused and starred lines, reports, take-downs, mutes", async () => {
    let now = 1_000;
    const dir = mkdtempSync(join(tmpdir(), "lounge-"));
    const l = new Lounge({ now: () => now, dataDir: dir, delayMs: 1 });
    const zed = { id: "zed", name: "Zed" };
    l.say(zed, "hello all");
    now += 5_000;
    expect(() => l.say(zed, "you retard")).toThrow(/friendly/);
    l.say(zed, "what the fuck");
    now += 5_000;
    const bad = l.say(zed, "you all suck");
    for (const r of ["a", "b", "c", "c"]) l.report(r, bad.id);
    expect(l.mute("a", "zed", true)).toBe(true);
    l.mute("a", "zed", true); // once each
    l.mute("b", "zed", true);
    l.mute("b", "zed", false);
    expect(l.mute("a", "nobody", true)).toBe(false);
    const c = l.conductOf("zed")!;
    expect(c).toMatchObject({ said: 3, starred: 1, takenDown: 1, mutedBy: ["a"] });
    expect(c.refused.map((x) => x.text)).toEqual(["you retard"]);
    expect(c.reports.length).toBe(3);
    expect(c.lines.at(-1)).toMatchObject({ text: "you all suck", gone: true });
    expect(c.score).toBe(3 + 5 + 3 + 2 + 1);
    expect(l.watchList()[0]).toMatchObject({ userId: "zed", score: 14 });
    expect(l.conductOf("a")).toBeNull();

    await l.flush();
    const again = new Lounge({ dataDir: dir, now: () => now });
    expect(again.feed(0).msgs.map((m) => m.text)).toEqual(["hello all", "what the f***"]);
    expect(again.conductOf("zed")!.score).toBe(14);
    expect(again.say({ id: "new", name: "New" }, "hi").id).toBe(bad.id + 1);
  });

  it("serves the Lounge over the API: anyone reads, players who've finished a game talk in their bubble", async () => {
    const accounts = new AccountService({ secret: "s", devLogins: true });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, rate: { burst: 1000, perSec: 1000 } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const call = async (path: string, token?: string, body?: object) => {
      const r = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: (await r.json()) as Record<string, any> };
    };
    const fresh = (await call("/api/auth/guest", undefined, { name: "New" })).body as { token: string };
    expect((await call("/api/lounge", fresh.token)).body.canPost).toBe(false);
    expect((await call("/api/lounge/say", fresh.token, { text: "hi" })).status).toBe(403);

    const vet = (await call("/api/auth/dev", undefined, { name: "Vet" })).body as { token: string; me: { id: string } };
    const a = (await accounts.store.get(vet.me.id))!;
    await accounts.store.put({ ...a, progress: { ...a.progress, xp: 500, owned: [...a.progress.owned, "s1.chat.crimson"], equipped: { ...a.progress.equipped, chat: "s1.chat.crimson" } } });
    expect((await call("/api/lounge", vet.token)).body.canPost).toBe(true);
    const said = await call("/api/lounge/say", vet.token, { text: "anyone up for a game? shit" });
    expect(said.status).toBe(200);
    expect(said.body.msg.text).toBe("anyone up for a game? s***");
    expect((await call("/api/lounge/say", vet.token, { text: "www.spam.com" })).status).toBe(400);

    const feed = (await call("/api/lounge")).body;
    expect(feed.canPost).toBe(false);
    expect(feed.msgs).toHaveLength(1);
    expect(feed.msgs[0].badge.chat).toBe("s1.chat.crimson");
    expect((await call(`/api/lounge?after=${feed.last}`)).body.msgs).toEqual([]);

    // a drink for whoever said a line: paid in coins, shown to everyone
    const pal = (await call("/api/auth/dev", undefined, { name: "Pal" })).body as { token: string; me: { id: string } };
    const p = (await accounts.store.get(pal.me.id))!;
    await accounts.store.put({ ...p, progress: { ...p.progress, xp: 500 } });
    const coins = p.progress.coins;
    expect((await call("/api/lounge/drink", vet.token, { to: feed.msgs[0].id, id: "beer" })).status).toBe(400); // not to yourself
    expect((await call("/api/lounge/drink", pal.token, { to: feed.msgs[0].id, id: "champagne" })).status).toBe(400); // rounds stay at tables
    const sent = await call("/api/lounge/drink", pal.token, { to: feed.msgs[0].id, id: "beer" });
    expect(sent.status).toBe(200);
    expect(sent.body.msg.drink).toMatchObject({ id: "beer", to: "Vet", toId: vet.me.id });
    expect(sent.body.me.progress.coins).toBe(coins - 5);
    expect((await accounts.store.get(vet.me.id))!.progress.drinksReceived).toBe(1);

    const rep = await call("/api/lounge/report", fresh.token, { id: feed.msgs[0].id });
    expect(rep.body).toMatchObject({ ok: true, hidden: false });
    await accounts.ban(vet.me.id, "spam", 1);
    expect((await call("/api/lounge")).body.msgs.map((m: { userId: string }) => m.userId)).toEqual([pal.me.id]);
  });
});
