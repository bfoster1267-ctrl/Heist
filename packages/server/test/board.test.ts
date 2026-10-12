import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AccountService } from "../src/accounts/service";
import { Board } from "../src/board";
import { startServer, type HeistServer } from "../src/server";

const servers: HeistServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
});

describe("the feedback board", () => {
  it("posts, votes, comments, sorts, merges, pays once and keeps it all on disk", async () => {
    let now = 1_000;
    const dir = mkdtempSync(join(tmpdir(), "board-"));
    const b = new Board({ dataDir: dir, now: () => now, delayMs: 1 });
    const ann = { id: "ann", name: "Ann" };
    const bo = { id: "bo", name: "Bo" };
    expect(() => b.add(ann, { kind: "rant", title: "hello there" })).toThrow(/kind/);
    expect(() => b.add(ann, { kind: "idea", title: "no" })).toThrow(/title/);
    expect(() => b.add(ann, { kind: "idea", title: "see spam.com" })).toThrow(/Links/);
    const bug = b.add(ann, { kind: "bug", title: "Cards overlap on iPhone", body: "line one\n\n\n\nline two shit", device: "iPhone 15" });
    expect(bug.votes).toBe(1);
    expect(b.post(bug.id)!.body).toBe("line one\n\nline two s***");
    now += 1;
    const idea = b.add(bo, { kind: "idea", title: "Dark mode table" });
    expect(() => b.add(bo, { kind: "idea", title: "dark mode table" })).toThrow(/already/);
    now += 1;
    b.add(bo, { kind: "other", title: "Love it" });
    now += 1;
    b.add(bo, { kind: "other", title: "Third today" });
    expect(() => b.add(bo, { kind: "other", title: "Fourth today" })).toThrow(/3 posts today/);

    expect(b.vote("bo", bug.id, true)).toEqual({ votes: 2, voted: true });
    expect(b.vote("bo", bug.id, true).votes).toBe(2); // once each
    expect(b.list("bo")[0]).toMatchObject({ id: bug.id, votes: 2, voted: true });
    expect(b.list(undefined, "new")[0].title).toBe("Third today");

    b.comment(bo, idea.id, "yes please");
    expect(() => b.comment(bo, idea.id, "again")).toThrow(/Slow down/);
    expect(b.post(idea.id, "bo")!.thread.map((c) => c.text)).toEqual(["yes please"]);

    // the owner: a duplicate folded in, a bug confirmed (paid once), a team reply
    const dupe = b.add(ann, { kind: "idea", title: "Night theme please" });
    b.vote("cy", dupe.id, true);
    b.manage(dupe.id, { mergeInto: idea.id });
    expect(b.list().some((p) => p.id === dupe.id)).toBe(false);
    expect(b.post(dupe.id)!.id).toBe(idea.id);
    expect(b.post(idea.id)!.votes).toBe(3);
    expect(b.manage(bug.id, { status: "planned" }).pay).toBe(true);
    expect(b.manage(bug.id, { status: "shipped" }).pay).toBe(false);
    expect(b.manage(idea.id, { status: "planned" }).pay).toBe(false); // ideas pay when they ship
    expect(b.manage(idea.id, { status: "shipped" }).pay).toBe(true);
    b.comment({ id: "heist-team", name: "Heist team" }, bug.id, "Fixed, thanks!", true);
    expect(b.list().find((p) => p.id === bug.id)!.answered).toBe(true);
    // shipped posts sink below open ones on Top
    expect(b.list().at(-1)!.status).toBe("shipped");

    // three reports hide a post
    const rude = b.add({ id: "zed", name: "Zed" }, { kind: "other", title: "This game is bad" });
    for (const r of ["ann", "bo", "cy"]) b.report(r, rude.id);
    expect(b.post(rude.id)).toBeNull();
    expect(b.report("bo", idea.id)).toBeNull(); // not your own

    await b.flush();
    const again = new Board({ dataDir: dir });
    expect(again.list().map((p) => p.title)).toEqual(b.list().map((p) => p.title));
    const next = again.add({ id: "new", name: "New" }, { kind: "idea", title: "Fresh one" });
    expect(next.id).toBeGreaterThan(rude.id);
  });

  it("serves the board over the API and pays the author from the admin panel", async () => {
    const accounts = new AccountService({ secret: "s", devLogins: true });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, admin: { user: "admin", password: "a-long-admin-password" }, rate: { burst: 1000, perSec: 1000 } });
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
    expect((await call("/api/board", fresh.token)).body.canPost).toBe(false);
    expect((await call("/api/board/new", fresh.token, { kind: "idea", title: "Hello there" })).status).toBe(403);

    const vet = (await call("/api/auth/dev", undefined, { name: "Vet" })).body as { token: string; me: { id: string } };
    const a = (await accounts.store.get(vet.me.id))!;
    await accounts.store.put({ ...a, progress: { ...a.progress, xp: 500 } });
    const posted = await call("/api/board/new", vet.token, { kind: "bug", title: "Chips vanish", device: "test" });
    expect(posted.status).toBe(200);
    const id = posted.body.post.id;
    expect((await call("/api/board/vote", vet.token, { id, on: false })).body).toEqual({ votes: 0, voted: false });
    expect((await call(`/api/board/post?id=${id}`)).body.post.title).toBe("Chips vanish");

    const admin = (await call("/api/admin/login", undefined, { user: "admin", password: "a-long-admin-password" })).body as { token: string };
    const coins = (await accounts.store.get(vet.me.id))!.progress.coins;
    const set = await call(`/api/admin/board/${id}`, admin.token, { status: "planned" });
    expect(set.body.paid).toBe(100);
    expect((await accounts.store.get(vet.me.id))!.progress.coins).toBe(coins + 100);
    await call(`/api/admin/board/${id}`, admin.token, { reply: "On it" });
    const seen = (await call(`/api/board/post?id=${id}`)).body.post;
    expect(seen.thread[0]).toMatchObject({ name: "Heist team", team: true, text: "On it" });
    expect((await call("/api/admin/board", admin.token)).body.posts[0].device).toBe("test");
  });
});
