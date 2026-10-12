import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AccountService } from "../src/accounts/service";
import { FileDmStore, Social } from "../src/accounts/social";
import type { PushMessage } from "../src/push";
import { startServer, type HeistServer } from "../src/server";

const servers: HeistServer[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Accounts, a clock and a notification outbox, with three signed-up players. */
async function setup(o: { tableOpen?: (code: string) => boolean; dir?: string } = {}) {
  let t = 1_000_000;
  const svc = new AccountService({ secret: "s", devLogins: true, now: () => t });
  const pushed: { to: string; m: PushMessage }[] = [];
  const social = new Social(svc, {
    now: () => t,
    notify: async (to, m) => (pushed.push({ to, m }), to === "nobody" ? 0 : 1),
    tableOpen: o.tableOpen,
    dms: o.dir ? new FileDmStore(o.dir) : undefined,
  });
  const make = async (name: string) => (await svc.dev(name)).me.id;
  const ids = { ann: await make("Ann"), bo: await make("Bo"), cy: await make("Cy") };
  const acct = async (id: string) => (await svc.store.get(id))!;
  return { svc, social, pushed, ids, acct, tick: (ms: number) => (t += ms) };
}

describe("friends", () => {
  it("sends a request, accepts it on both sides, and unfriends on both sides", async () => {
    const { social, pushed, ids, acct } = await setup();
    expect(await social.request(await acct(ids.ann), ids.bo)).toEqual({ status: "sent" });
    expect(pushed.at(-1)).toMatchObject({ to: ids.bo, m: { title: "Friend request", url: "./?friends=1" } });
    // asking twice doesn't buzz them twice
    await social.request(await acct(ids.ann), ids.bo);
    expect(pushed.filter((p) => p.to === ids.bo)).toHaveLength(1);

    let bo = await social.view(await acct(ids.bo));
    expect(bo.incoming.map((p) => p.name)).toEqual(["Ann"]);
    expect((await social.view(await acct(ids.ann))).outgoing.map((p) => p.name)).toEqual(["Bo"]);

    await social.accept(await acct(ids.bo), ids.ann);
    bo = await social.view(await acct(ids.bo));
    const ann = await social.view(await acct(ids.ann));
    expect(bo.friends.map((f) => f.name)).toEqual(["Ann"]);
    expect(ann.friends.map((f) => f.name)).toEqual(["Bo"]);
    expect(bo.incoming).toEqual([]);
    expect(ann.outgoing).toEqual([]);
    expect(pushed.at(-1)).toMatchObject({ to: ids.ann, m: { title: "New friend" } });

    await social.remove(await acct(ids.ann), ids.bo);
    expect((await social.view(await acct(ids.bo))).friends).toEqual([]);
    expect((await social.view(await acct(ids.ann))).friends).toEqual([]);
  });

  it("makes two people friends when both ask, and refuses yourself and strangers' ids", async () => {
    const { social, ids, acct } = await setup();
    await social.request(await acct(ids.ann), ids.cy);
    expect(await social.request(await acct(ids.cy), ids.ann)).toEqual({ status: "friends" });
    expect((await social.view(await acct(ids.ann))).friends.map((f) => f.id)).toEqual([ids.cy]);
    await expect(social.request(await acct(ids.ann), ids.ann)).rejects.toThrow(/you/);
    await expect(social.request(await acct(ids.ann), "u_nope")).rejects.toThrow(/No such player/);
    // accepting a request that was never sent does nothing
    await social.accept(await acct(ids.bo), ids.ann);
    expect((await social.view(await acct(ids.bo))).friends).toEqual([]);
  });

  it("finds players by name, best match first, never yourself", async () => {
    const { social, ids, acct, svc } = await setup();
    await svc.dev("Annabel");
    const found = await social.search(await acct(ids.ann), "ann");
    expect(found.map((p) => p.name)).toEqual(["Annabel"]);
    expect(await social.search(await acct(ids.bo), "a")).toEqual([]);
    expect((await social.search(await acct(ids.bo), "ANN")).map((p) => p.name)).toEqual(["Ann", "Annabel"]);
  });
});

async function friends(s: Awaited<ReturnType<typeof setup>>, a: string, b: string) {
  await s.social.request(await s.acct(a), b);
  await s.social.accept(await s.acct(b), a);
}

describe("table invites", () => {
  it("buzzes a friend's phone with a link that opens the table, and shows it in their app", async () => {
    const s = await setup({ tableOpen: (c) => c === "ABCDE" });
    await friends(s, s.ids.ann, s.ids.bo);
    const r = await s.social.invite(await s.acct(s.ids.ann), s.ids.bo, "abcde");
    expect(r.devices).toBe(1);
    expect(s.pushed.at(-1)).toMatchObject({ to: s.ids.bo, m: { title: "Ann invited you to play", url: "./?table=ABCDE", tag: "invite-ABCDE" } });
    const v = await s.social.view(await s.acct(s.ids.bo));
    expect(v.invites).toMatchObject([{ from: s.ids.ann, name: "Ann", code: "ABCDE" }]);
    s.social.dismiss(await s.acct(s.ids.bo), "ABCDE");
    expect((await s.social.view(await s.acct(s.ids.bo))).invites).toEqual([]);
  });

  it("only invites friends, only to open tables, and invites fade", async () => {
    const s = await setup({ tableOpen: (c) => c === "ABCDE" });
    await expect(s.social.invite(await s.acct(s.ids.ann), s.ids.cy, "ABCDE")).rejects.toThrow(/friends/);
    await friends(s, s.ids.ann, s.ids.cy);
    await expect(s.social.invite(await s.acct(s.ids.ann), s.ids.cy, "ZZZZZ")).rejects.toThrow(/isn't open/);
    await s.social.invite(await s.acct(s.ids.ann), s.ids.cy, "ABCDE");
    s.tick(16 * 60_000);
    expect((await s.social.view(await s.acct(s.ids.cy))).invites).toEqual([]);
  });
});

describe("direct messages", () => {
  it("delivers messages between friends, counts unread, marks read, and buzzes once a minute at most", async () => {
    const s = await setup();
    await friends(s, s.ids.ann, s.ids.bo);
    const before = s.pushed.length;
    await s.social.send(await s.acct(s.ids.ann), s.ids.bo, "  deal me in  ");
    await s.social.send(await s.acct(s.ids.ann), s.ids.bo, "table ABCDE");
    const buzzes = s.pushed.slice(before);
    expect(buzzes).toHaveLength(1);
    expect(buzzes[0]).toMatchObject({ to: s.ids.bo, m: { title: "Ann", body: "deal me in", url: `./?chat=${s.ids.ann}` } });

    let row = (await s.social.view(await s.acct(s.ids.bo))).friends[0];
    expect(row.unread).toBe(2);
    expect(row.last).toMatchObject({ text: "table ABCDE", mine: false });

    const th = await s.social.thread(await s.acct(s.ids.bo), s.ids.ann);
    expect(th.messages.map((m) => m.text)).toEqual(["deal me in", "table ABCDE"]);
    row = (await s.social.view(await s.acct(s.ids.bo))).friends[0];
    expect(row.unread).toBe(0);
    // Ann sees Bo read it
    expect((await s.social.thread(await s.acct(s.ids.ann), s.ids.bo)).theirRead).toBe(th.messages[1].at);

    // Bo has the chat open: no buzz for Ann's next line, even after the gap
    s.tick(61_000);
    await s.social.thread(await s.acct(s.ids.bo), s.ids.ann);
    await s.social.send(await s.acct(s.ids.ann), s.ids.bo, "you there?");
    expect(s.pushed.length).toBe(before + 1);
  });

  it("refuses strangers, slurs and links, and stars out swears", async () => {
    const s = await setup();
    await expect(s.social.send(await s.acct(s.ids.ann), s.ids.cy, "hi")).rejects.toThrow(/only message friends/);
    await friends(s, s.ids.ann, s.ids.cy);
    await expect(s.social.send(await s.acct(s.ids.ann), s.ids.cy, "go to www.scam.com")).rejects.toThrow(/Links aren't allowed in messages/);
    await expect(s.social.send(await s.acct(s.ids.ann), s.ids.cy, "   ")).rejects.toThrow(/Say something/);
    const r = await s.social.send(await s.acct(s.ids.ann), s.ids.cy, "oh shit");
    expect(r.message.text).toBe("oh s***");
    // unfriending ends the conversation
    await s.social.remove(await s.acct(s.ids.cy), s.ids.ann);
    await expect(s.social.send(await s.acct(s.ids.ann), s.ids.cy, "hey")).rejects.toThrow(/only message friends/);
  });

  it("keeps messages across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-dms-"));
    dirs.push(dir);
    const s = await setup({ dir });
    await friends(s, s.ids.ann, s.ids.bo);
    await s.social.send(await s.acct(s.ids.ann), s.ids.bo, "see you at the table");
    await s.social.dms.flush();
    const again = new Social(s.svc, { dms: new FileDmStore(dir) });
    expect((await again.thread(await s.acct(s.ids.bo), s.ids.ann)).messages.map((m) => m.text)).toEqual(["see you at the table"]);
  });
});

describe("friends over HTTP", () => {
  it("serves the friends routes to signed-in players only", async () => {
    const svc = new AccountService({ secret: "s", devLogins: true });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts: svc });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const a = await svc.dev("Ann");
    const b = await svc.dev("Bo");
    const call = async (token: string, path: string, body?: object) => {
      const r = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json() };
    };
    expect((await call("nope", "/api/friends")).status).toBe(401);
    expect((await call(a.token, "/api/friends/request", { id: b.me.id })).json).toEqual({ status: "sent" });
    expect((await call(b.token, "/api/friends")).json.incoming[0].name).toBe("Ann");
    await call(b.token, "/api/friends/accept", { id: a.me.id });
    expect((await call(a.token, "/api/dm/send", { to: b.me.id, text: "hi Bo" })).status).toBe(200);
    const th = await call(b.token, `/api/dm?with=${a.me.id}`);
    expect(th.json.messages.map((m: { text: string }) => m.text)).toEqual(["hi Bo"]);
    // no such table on this server
    expect((await call(a.token, "/api/friends/invite", { id: b.me.id, code: "ABCDE" })).status).toBe(404);
    // a message's words stay out of the owner's activity log
    const logged = svc.activity.window().filter((e) => e.kind === "dm.send");
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0].data)).not.toContain("hi Bo");
  });
});
