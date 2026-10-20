import { describe, expect, it } from "vitest";
import { MemoryActivityLog } from "../src/accounts/activity";
import { AdminService } from "../src/accounts/admin";
import { cringeName, cringeNameCount } from "../src/accounts/names";
import { AccountService } from "../src/accounts/service";
import { MemoryAccountStore, type Account } from "../src/accounts/store";
import { cringeBotNames, newProgress, soloBotNames } from "@heist/profile";

describe("cringe names", () => {
  it("come in thousands, fit a seat plate and never repeat a taken one", () => {
    expect(cringeNameCount()).toBeGreaterThan(5000);
    const taken = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const n = cringeName(taken);
      expect(n.length).toBeLessThanOrEqual(20);
      expect(taken.has(n.toLowerCase())).toBe(false);
      taken.add(n.toLowerCase());
    }
  });
});

describe("player numbers", () => {
  it("every new player gets a made-up name and the next number; a chosen name is kept", async () => {
    const activity = new MemoryActivityLog();
    const svc = new AccountService({ secret: "s", activity });
    const a = await svc.guest(undefined, "");
    const b = await svc.guest(undefined, "Ace");
    const c = await svc.guest(undefined, "Rosa");
    expect(a.me.name).not.toMatch(/^(Player|Ace|Guest)/);
    expect(b.me.name).not.toBe(a.me.name);
    expect(c.me.name).toBe("Rosa");
    const nums = await Promise.all([a, b, c].map(async (x) => (await svc.store.get(x.me.id))!.num));
    expect(nums).toEqual([1001, 1002, 1003]);
    const admin = new AdminService(svc, activity);
    expect((await admin.nums()).nums[c.me.id]).toBe(1003);
    // "#1003" in the activity search is that player
    svc.track({ kind: "app.open", userId: a.me.id });
    svc.track({ kind: "app.open", userId: c.me.id });
    const ev = (await admin.activity(new URLSearchParams({ text: "#1003" }))).events;
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.userId === c.me.id)).toBe(true);
  });

  it("older accounts are numbered oldest first, and guests still on a stock name get a made-up one", async () => {
    const store = new MemoryAccountStore();
    const old = (id: string, name: string, createdAt: number, guest = true): Account => ({ id, name, createdAt, guest, logins: [], progress: newProgress(), solo: null, sessions: 0 });
    await store.put(old("u_b", "Player", 2));
    await store.put(old("u_a", "Guest 4f2a", 1));
    await store.put(old("u_c", "Brock", 3, false));
    const svc = new AccountService({ secret: "s", store });
    await svc.numbered();
    const [a, b, c] = await Promise.all(["u_a", "u_b", "u_c"].map((id) => store.get(id)));
    expect([a!.num, b!.num, c!.num]).toEqual([1001, 1002, 1003]);
    expect(a!.name).not.toMatch(/^Guest/);
    expect(b!.name).not.toBe("Player");
    expect(c!.name).toBe("Brock");
    // the next new player carries on from there
    const d = await svc.guest(undefined, "");
    expect((await store.get(d.me.id))!.num).toBe(1004);
  });
});

describe("bot names", () => {
  it("solo bots get cringe names, the same ones for the same seed, all different", () => {
    const a = soloBotNames(1234, 6);
    expect(a).toHaveLength(5);
    expect(new Set(a).size).toBe(5);
    expect(soloBotNames(1234, 6)).toEqual(a);
    expect(soloBotNames(99, 6)).not.toEqual(a);
    expect(cringeBotNames(3, undefined, new Set(a.map((n) => n.toLowerCase()))).some((n) => a.includes(n))).toBe(false);
  });
});
