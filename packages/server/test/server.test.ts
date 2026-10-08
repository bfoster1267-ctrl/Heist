import type { GameState } from "@heist/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HeistClient } from "../src/client";
import type { ServerMsg } from "../src/protocol";
import { startServer, type HeistServer } from "../src/server";
import { FileStore } from "../src/store";
import { simpleAnswer } from "./helpers";

// bots-speed test players answer far faster than people; real servers keep the default limit
const FAST = { burst: 1000, perSec: 1000 };
const servers: HeistServer[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A client that plays every decision it's given with simpleAnswer, from the table it has been shown. */
function player(url: string, name: string, token?: string) {
  const c = new HeistClient(url, { name, token });
  let view: GameState | null = null;
  const seen: ServerMsg[] = [];
  let answered = 0;
  const over = new Promise<Extract<ServerMsg, { t: "gameOver" }>>((resolve) => c.on("gameOver", resolve));
  c.onAny((m) => {
    seen.push(m);
    if (m.t === "sync") view = m.state;
    if (m.t === "frames" && m.frames.length) view = m.frames[m.frames.length - 1].state;
    if (m.t === "ask" && view) {
      const a = simpleAnswer(m.ask, view);
      // answer a little later, like a person would (and so drops can land mid-turn)
      setTimeout(() => {
        if (c.ask?.askId === m.askId) {
          c.answer(a);
          answered++;
        }
      }, 1);
    }
  });
  return { c, seen, over, answered: () => answered };
}

const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("game server over WebSockets", () => {
  it("runs a 5-seat table with three people and two bots, through a dropped connection, to the end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-"));
    dirs.push(dir);
    const srv = await startServer({ port: 0, host: "127.0.0.1", store: new FileStore(dir), rate: FAST });
    servers.push(srv);
    const url = `ws://127.0.0.1:${srv.port()}/ws`;

    const ann = player(url, "Ann");
    const ben = player(url, "Ben");
    const cat = player(url, "Cat");
    await Promise.all([ann.c.connect(), ben.c.connect(), cat.c.connect()]);
    expect(ann.c.userId).not.toBe(ben.c.userId);

    ann.c.create({ players: 5, stakes: 50, turnSeconds: 30 });
    await until(() => !!ann.c.room);
    const code = ann.c.room!.code;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);

    // the public lobby list shows the table
    const listed = new Promise<Extract<ServerMsg, { t: "rooms" }>>((r) => ben.c.on("rooms", r));
    ben.c.list();
    expect((await listed).rooms.some((r) => r.code === code && r.open === 4)).toBe(true);

    ben.c.join(code);
    cat.c.join(code.toLowerCase());
    await until(() => ann.c.room?.seats.filter((s) => s.kind === "human").length === 3);
    ben.c.start(); // not the host
    await until(() => ben.seen.some((m) => m.t === "error" && m.code === "not_host"));
    ann.c.start();

    // Ben's connection drops after a few decisions; his client reconnects with its token and resumes
    await until(() => ben.answered() >= 3, 10_000);
    const ups: boolean[] = [];
    ben.c.onConnection((up) => ups.push(up));
    ben.c.drop();
    await until(() => ben.seen.filter((m) => m.t === "welcome").length >= 2, 10_000);
    expect(ben.c.seat).toBe(1);
    expect(ups).toEqual([false, true]);

    const results = await Promise.all([ann.over, ben.over, cat.over]);
    expect(new Set(results.map((r) => JSON.stringify(r.winners))).size).toBe(1);

    // nobody was ever sent another player's hand or a face-down card
    for (const [p, seat] of [[ann, 0], [ben, 1], [cat, 2]] as const) {
      for (const m of p.seen) {
        const states = m.t === "frames" ? m.frames.map((f) => f.state) : m.t === "sync" ? [m.state] : [];
        for (const st of states) {
          expect(st.deck).toEqual([]);
          for (const q of st.players) if (q.seat !== seat) expect(q.hand.every((c) => c.id < 0)).toBe(true);
          if (st.job && !st.job.revealed) {
            if (st.job.boss !== seat) expect(st.job.bossCard?.id ?? -1).toBeLessThan(0);
            if (st.job.mark !== seat) expect(st.job.markCard?.id ?? -1).toBeLessThan(0);
          }
        }
        if (m.t === "ask") expect(m.ask.seat).toBe(seat);
      }
    }

    // Ben's frames, across the drop, are every frame exactly once and in order
    const frames = ben.seen.flatMap((m) => (m.t === "frames" ? m.frames.map((f) => f.i) : []));
    const syncs = ben.seen.filter((m) => m.t === "sync").length;
    if (!syncs) expect(frames).toEqual(frames.map((_, k) => k));

    for (const p of [ann, ben, cat]) p.c.close();
  }, 30_000);

  it("rejects junk, rate-limits floods, and keeps working", async () => {
    const srv = await startServer({ port: 0, host: "127.0.0.1" });
    servers.push(srv);
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port()}/ws`);
    const got: ServerMsg[] = [];
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
    await new Promise((r) => (ws.onopen = r));
    ws.send("not json");
    ws.send(JSON.stringify({ t: "join", code: "AAAAA" }));
    ws.send(JSON.stringify({ t: "hello", v: 999 }));
    await until(() => got.length >= 3);
    expect(got.map((m) => (m.t === "error" ? m.code : m.t))).toEqual(["bad_message", "not_authenticated", "version"]);
    for (let i = 0; i < 100; i++) ws.send(JSON.stringify({ t: "ping", n: i }));
    await until(() => got.some((m) => m.t === "error" && m.code === "rate_limited"));
    const res = await fetch(`http://127.0.0.1:${srv.port()}/healthz`);
    expect((await res.json()).ok).toBe(true);
    ws.close();
  });

  it("brings an unfinished table back after a restart, with the players' seats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-"));
    dirs.push(dir);
    const secret = "test-secret";
    const { GuestIdentity } = await import("../src/identity");
    const srv1 = await startServer({ port: 0, host: "127.0.0.1", store: new FileStore(dir), identity: new GuestIdentity(secret), rate: FAST });
    const url1 = `ws://127.0.0.1:${srv1.port()}/ws`;
    const ann = new HeistClient(url1, { name: "Ann", reconnect: false });
    await ann.connect();
    ann.create({ players: 3 });
    await until(() => !!ann.room);
    const code = ann.room!.code;
    ann.start();
    await until(() => !!ann.ask);
    await srv1.close(); // server goes down mid-game

    const srv2 = await startServer({ port: 0, host: "127.0.0.1", store: new FileStore(dir), identity: new GuestIdentity(secret), rate: FAST });
    servers.push(srv2);
    expect(srv2.rooms.get(code)?.status).toBe("playing");
    const back = player(`ws://127.0.0.1:${srv2.port()}/ws`, "Ann", (ann as unknown as { token: string }).token);
    await back.c.connect();
    expect(back.c.userId).toBe(ann.userId);
    back.c.join(code);
    await until(() => back.c.seat === 0);
    await back.over;
  }, 30_000);

  it("quick queue: two people wait, bots fill the table, and both play it to the end", async () => {
    const srv = await startServer({ port: 0, host: "127.0.0.1", rate: FAST, queueWaitMs: 300 });
    servers.push(srv);
    const url = `ws://127.0.0.1:${srv.port()}/ws`;
    const a = player(url, "Ann");
    const b = player(url, "Ben");
    await a.c.connect();
    await b.c.connect();
    a.c.queue(4, 250);
    b.c.queue(4, 250);
    await until(() => b.seen.some((m) => m.t === "queue" && m.waiting === 2));
    const [ra, rb] = await Promise.all([a.over, b.over]);
    expect(ra.winners).toEqual(rb.winners);
    expect(a.c.room?.code).toBe(b.c.room?.code);
    expect(a.c.room?.seats.filter((s) => s.kind === "bot").length).toBe(2);
    expect(srv.queue.size).toBe(0);
  }, 30_000);
});
