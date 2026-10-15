import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hosting, series } from "../src/accounts/hosting";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("server page", () => {
  it("measures itself and the data disk without a Render key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-hosting-"));
    dirs.push(dir);
    mkdirSync(join(dir, "activity"));
    writeFileSync(join(dir, "activity", "2026-10.jsonl"), "x".repeat(2 ** 20));
    writeFileSync(join(dir, "accounts.json"), "{}");
    const h = new Hosting({ dataDir: dir, plan: "starter", diskGb: 1, now: () => Date.UTC(2026, 9, 16) });
    h.sample(3);
    const r = await h.report();
    expect(r.render).toEqual({ connected: false, missing: "key" });
    expect(r.self.samples[0].sockets).toBe(3);
    expect(r.disk!.parts.find((p) => p.name === "Activity log")).toMatchObject({ mb: 1, files: 1 });
    expect(r.disk!.parts.find((p) => p.name === "Online games")).toMatchObject({ mb: 0, files: 0 });
    // Starter $7 + 1 GB disk $0.25, half way through October
    expect(r.cost).toMatchObject({ plan: "starter", monthly: 7.25 });
    expect(r.cost.soFar).toBeCloseTo(7.25 * (15 / 31), 2);
  });

  it("asks Render for the service, deploys and metrics, once a minute, and says when the key is wrong", async () => {
    let now = Date.UTC(2026, 9, 9, 12);
    const asked: string[] = [];
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const fake = (async (url: string, init: RequestInit) => {
      asked.push(url.replace("https://api.render.com/v1", "").split("?")[0]);
      if ((init.headers as Record<string, string>).authorization !== "Bearer good") return reply({ message: "unauthorized" }, 401);
      if (url.includes("/deploys")) return reply([{ deploy: { id: "dep-1", status: "live", commit: { id: "abcdef123", message: "Admin: people\n\nmore" }, createdAt: "2026-10-09T11:00:00Z", finishedAt: "2026-10-09T11:03:00Z" }, cursor: "x" }]);
      if (url.includes("/metrics/memory?")) return reply([{ labels: [{ field: "instance", value: "a" }], unit: "bytes", values: [{ timestamp: "2026-10-09T11:00:00Z", value: 100 }] }, { values: [{ timestamp: "2026-10-09T11:00:00Z", value: 50 }] }]);
      if (url.includes("/metrics/")) return reply([]);
      return reply({ id: "srv-1", name: "heist-server", suspended: "not_suspended", serviceDetails: { plan: "starter", region: "oregon", url: "https://x.onrender.com", disk: { sizeGB: 1 } } });
    }) as unknown as typeof fetch;
    const h = new Hosting({ renderKey: "good", serviceId: "srv-1", now: () => now, fetch: fake });
    const r = await h.report();
    expect(r.render.connected).toBe(true);
    if (!r.render.connected) return;
    expect(r.render.service).toMatchObject({ name: "heist-server", plan: "starter", region: "oregon" });
    expect(r.render.deploys[0]).toMatchObject({ status: "live", commit: "abcdef1", message: "Admin: people" });
    expect(r.render.metrics.memory).toEqual({ unit: "bytes", points: [{ at: Date.UTC(2026, 9, 9, 11), value: 150 }] });
    expect(r.cost.monthly).toBe(7.25);
    const n = asked.length;
    await h.report();
    expect(asked.length).toBe(n); // cached
    now += 61_000;
    await h.report();
    expect(asked.length).toBe(2 * n);

    const bad = await new Hosting({ renderKey: "nope", serviceId: "srv-1", fetch: fake }).report();
    expect(bad.render).toMatchObject({ connected: false, error: expect.stringContaining("API key") });
  });

  it("adds Render's series up per hour", () => {
    expect(series([{ values: [{ timestamp: "2026-10-09T02:00:00Z", value: 1 }, { timestamp: "2026-10-09T01:00:00Z", value: 2 }] }, { values: [{ timestamp: "2026-10-09T01:00:00Z", value: 3 }] }])).toEqual([
      { at: Date.UTC(2026, 9, 9, 1), value: 5 },
      { at: Date.UTC(2026, 9, 9, 2), value: 1 },
    ]);
    expect(series({ nope: 1 })).toEqual([]);
  });
});
