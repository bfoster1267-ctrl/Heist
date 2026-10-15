import { START_CHIPS } from "@heist/profile";
import { describe, expect, it } from "vitest";
import { MemoryActivityLog } from "../src/accounts/activity";
import { AdminService } from "../src/accounts/admin";
import { AccountService } from "../src/accounts/service";

const DAY = 24 * 60 * 60_000;

function setup() {
  let t = Date.UTC(2026, 9, 1);
  const activity = new MemoryActivityLog();
  const svc = new AccountService({ secret: "s", now: () => t, activity });
  const admin = new AdminService(svc, activity, { now: () => t });
  return { svc, admin, activity, at: () => t, wait: (days: number) => (t += days * DAY) };
}

describe("guests who never played", () => {
  it("are left out of the admin stats but still listed", async () => {
    const { svc, admin } = setup();
    const idle = await svc.guest(undefined, "Lurker");
    svc.track({ kind: "app.open", userId: idle.me.id });
    const player = await svc.guest(undefined, "Player");
    await svc.soloStart(await svc.require(player.token), 3, 100);
    svc.track({ kind: "app.open", userId: player.me.id });
    const ov = await admin.overview();
    expect(ov.accounts.guests).toBe(2);
    expect(ov.accounts.untouched).toBe(1);
    expect(ov.active.day).toBe(1);
    const eco = await admin.economy();
    expect(eco.circulation.accounts).toBe(1);
    expect(eco.circulation.guests).toBe(START_CHIPS - 100);
    expect(eco.circulation.untouched).toEqual({ accounts: 1, chips: START_CHIPS });
    expect(eco.flows.start.all).toBe(START_CHIPS);
  });

  it("are removed after 30 days away; a visit, a game or signing up keeps them", async () => {
    const { svc, activity, wait } = setup();
    const gone = await svc.guest(undefined, "Gone");
    const back = await svc.guest(undefined, "Back");
    const played = await svc.guest(undefined, "Played");
    await svc.soloStart(await svc.require(played.token), 3, 100);
    await svc.soloQuit(await svc.require(played.token));
    const online = await svc.guest(undefined, "Online");
    svc.track({ kind: "table.queue", userId: online.me.id });
    const signed = await svc.register("keep@example.com", "password1", "Keep");

    wait(20);
    expect(await svc.pruneGuests()).toBe(0);
    svc.track({ kind: "app.open", userId: back.me.id }); // came back on day 20
    wait(11);
    expect(await svc.pruneGuests()).toBe(1);
    expect(await svc.store.get(gone.me.id)).toBeUndefined();
    for (const k of [back, played, online, signed]) expect(await svc.store.get(k.me.id)).toBeDefined();
    expect(activity.window().some((e) => e.kind === "system.pruneGuests")).toBe(true);

    // a removed guest's old token just gets a fresh guest
    const again = await svc.guest(gone.token, "Gone");
    expect(again.me.id).not.toBe(gone.me.id);

    wait(20);
    expect(await svc.pruneGuests()).toBe(1); // "Back" has now been away 31 days
    expect(await svc.store.get(back.me.id)).toBeUndefined();
  });
});
