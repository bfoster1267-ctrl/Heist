import { describe, expect, it } from "vitest";
import { MemoryActivityLog } from "../src/accounts/activity";
import { AdminService } from "../src/accounts/admin";
import { CRAWLER_UA, SETTLE_MS, judge, sourceOf } from "../src/accounts/bots";
import { AccountService } from "../src/accounts/service";

const MIN = 60_000;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Reddit/Version 2025.40.0";

function setup(reverse?: (ip: string) => Promise<string[]>) {
  let t = Date.UTC(2026, 9, 12, 13);
  const activity = new MemoryActivityLog();
  const svc = new AccountService({ secret: "s", now: () => t, activity });
  const admin = new AdminService(svc, activity, { now: () => t, reverse });
  return { svc, admin, activity, wait: (ms: number) => (t += ms) };
}

/** a first visit as it reaches the server: the guest, then the lesson starting on its own */
async function visit(svc: AccountService, ip: string, ua: string, ref = "") {
  const g = await svc.guest(undefined, "");
  svc.track({ kind: "auth.guest", userId: g.me.id, ip, ua, ...(ref ? { ref } : {}) });
  svc.track({ kind: "solo.start", userId: g.me.id, ip, data: { coached: true } });
  svc.track({ kind: "ui.screen", userId: g.me.id, ip, source: "app", data: { name: "Table vs bots" } });
  svc.track({ kind: "ui.turn", userId: g.me.id, ip, source: "app", data: { name: "Turn 1", turn: 1 } });
  return g;
}

describe("bot visits", () => {
  it("knows robot browsers from people's browsers", () => {
    for (const ua of ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Mozilla/5.0 (compatible; redditbot/1.0)", "Mozilla/5.0 HeadlessChrome/120.0", "facebookexternalhit/1.1", "curl/8.4.0"])
      expect(CRAWLER_UA.test(ua)).toBe(true);
    for (const ua of [IPHONE, "Mozilla/5.0 (Linux; Android 13; CUBOT X30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"])
      expect(CRAWLER_UA.test(ua)).toBe(false);
  });

  it("says where a visitor came from", () => {
    expect(sourceOf("https://www.reddit.com/", undefined)).toBe("reddit.com");
    expect(sourceOf(undefined, IPHONE)).toBe("Reddit app");
    expect(sourceOf("https://playheist.net/", undefined)).toBeNull();
    expect(sourceOf("", undefined)).toBeNull();
    expect(sourceOf("https://www.crazygames.com/game/heist", undefined)).toBe("CrazyGames");
    expect(sourceOf("https://games.crazygames.com/en_US/heist/index.html", undefined)).toBe("CrazyGames");
  });

  it("never calls someone who tapped, or signed up, a bot", () => {
    const now = Date.UTC(2026, 9, 12);
    const seen = [{ at: now - 20 * MIN, kind: "auth.guest", userId: "u", ua: "redditbot/1.0" }];
    expect(judge(seen, false, now, () => undefined)?.kind).toBe("crawler");
    expect(judge([...seen, { at: now - 19 * MIN, kind: "ui.tap", userId: "u" }], false, now, () => undefined)).toBeNull();
    expect(judge(seen, true, now, () => undefined)).toBeNull();
    // a brand-new visit gets a few minutes for its taps to arrive
    const fresh = [{ at: now - 1000, kind: "auth.guest", userId: "u" }];
    expect(judge(fresh, false, now, () => undefined)).toBeNull();
    expect(judge(fresh, false, now + SETTLE_MS, () => undefined)?.kind).toBe("untouched");
  });

  it("leaves bots out of the stats and lists them with where they came from", async () => {
    const { svc, admin, wait } = setup(async (ip) => (ip === "207.46.13.154" ? ["msnbot-207-46-13-154.search.msn.com"] : []));
    // a person: the lesson starts, they tap through it
    const person = await visit(svc, "1.1.1.1", IPHONE, "https://www.reddit.com/");
    svc.track({ kind: "ui.tap", userId: person.me.id, ip: "1.1.1.1", source: "app", data: { name: "Next" } });
    // three robots: a preview fetcher, a search engine's address, and one that never touched anything
    await visit(svc, "2.2.2.2", "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)");
    await visit(svc, "207.46.13.154", "Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36");
    await visit(svc, "3.3.3.3", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36", "https://www.reddit.com/");
    // and a signed-up player who only looked
    const reg = await svc.register("real@example.com", "password1", "Real");
    svc.track({ kind: "app.open", userId: reg.me.id, ip: "4.4.4.4" });

    let bots = await admin.bots(new URLSearchParams());
    // before the dust settles only the robot browser is certain (the address is looked up in the background)
    expect(bots.rows.map((r) => r.kind).sort()).toEqual(["crawler", "crawler"]);
    wait(SETTLE_MS + MIN);
    bots = await admin.bots(new URLSearchParams());
    expect(bots.total).toBe(3);
    expect(bots.kinds).toEqual({ crawler: 2, untouched: 1 });
    const bing = bots.rows.find((r) => r.ips[0].ip === "207.46.13.154")!;
    expect(bing.reason).toMatch(/search\.msn\.com/);
    expect(bing.ips[0].host).toBe("msnbot-207-46-13-154.search.msn.com");
    const quiet = bots.rows.find((r) => r.kind === "untouched")!;
    expect(quiet.source).toBe("reddit.com");
    expect(quiet.last).toBe("ui.turn Turn 1");
    expect(bots.sources[0]).toEqual({ source: "Unknown (no referrer)", count: 2 });

    const ov = await admin.overview();
    expect(ov.accounts.bots).toBe(3);
    expect(ov.accounts.people).toBe(2);
    const funnel = await admin.funnel(new URLSearchParams({ from: "0" }));
    expect(funnel.people).toBe(2); // the person and the signed-up player
    const act = await admin.activity(new URLSearchParams());
    expect(act.events.every((e) => e.userId === person.me.id || e.userId === reg.me.id)).toBe(true);
    const list = await admin.list(new URLSearchParams({ show: "bots" }));
    expect(list.total).toBe(3);
    expect((await admin.list(new URLSearchParams())).rows.some((r) => r.bot)).toBe(false);
  });
});
