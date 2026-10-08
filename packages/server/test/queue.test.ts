import { describe, expect, it } from "vitest";
import { Matchmaker, QUEUE_WAIT_MS } from "../src/queue";
import { Rooms } from "../src/rooms";
import { MemoryStore } from "../src/store";
import { FakeClock, TestConn } from "./helpers";

function setup() {
  const clock = new FakeClock();
  const rooms = new Rooms({ store: new MemoryStore(), clock });
  const mm = new Matchmaker(rooms, clock, (conn, room) => room.join(conn));
  const conn = (n: number) => new TestConn(`c${n}`, `u${n}`, `P${n}`);
  return { clock, rooms, mm, conn };
}

describe("quick queue", () => {
  it("deals a table the moment it's full", () => {
    const { mm, conn, rooms } = setup();
    const cs = [1, 2, 3, 4].map(conn);
    for (const c of cs.slice(0, 3)) expect(mm.join(c, 4, 250)).toBeNull();
    expect(cs[0].last("queue")).toMatchObject({ players: 4, stakes: 250, waiting: 3 });
    expect(rooms.size).toBe(0);
    mm.join(cs[3], 4, 250);
    expect(rooms.size).toBe(1);
    expect(mm.size).toBe(0);
    const seats = cs.map((c) => c.last("room").you.seat);
    expect(new Set(seats)).toEqual(new Set([0, 1, 2, 3]));
    expect(cs[0].last("room").room).toMatchObject({ status: "playing", stakes: 250, isPrivate: true });
    expect(cs.every((c) => c.of("frames").length > 0)).toBe(true);
  });

  it("fills the empty seats with bots after the wait", () => {
    const { mm, conn, rooms, clock } = setup();
    const a = conn(1);
    const b = conn(2);
    mm.join(a, 5, 0);
    clock.advance(30_000);
    mm.join(b, 5, 0);
    expect(b.last("queue").startsAt).toBe(a.last("queue").startsAt); // the clock runs from the first in line
    clock.advance(QUEUE_WAIT_MS - 30_001);
    expect(rooms.size).toBe(0);
    clock.advance(1);
    expect(rooms.size).toBe(1);
    const room = a.last("room").room;
    expect(room.status).toBe("playing");
    expect(room.seats.filter((s) => s.kind === "human").length).toBe(2);
    expect(room.seats.filter((s) => s.kind === "bot").length).toBe(3);
  });

  it("groups players by skill, widening the gap the longer they wait", () => {
    const { mm, conn, rooms, clock } = setup();
    const [pro, pro2, rook, rook2, pro3] = [1, 2, 3, 4, 5].map(conn);
    mm.join(pro, 3, 0, 1400);
    mm.join(rook, 3, 0, 800);
    mm.join(pro2, 3, 0, 1380);
    mm.join(rook2, 3, 0, 820);
    expect(rooms.size).toBe(0); // four waiting, but no three within reach of each other
    mm.join(pro3, 3, 0, 1420);
    expect(rooms.size).toBe(1);
    const names = (c: TestConn) => c.last("room").room.seats.map((x: { name: string }) => x.name).sort();
    expect(names(pro)).toEqual(["P1", "P2", "P5"]);
    expect(mm.size).toBe(2);
    // the rookies still get a table when the wait runs out, with a bot, and easy bots for their level
    clock.advance(QUEUE_WAIT_MS);
    expect(rooms.size).toBe(2);
    expect(rook.last("room").room).toMatchObject({ botLevel: "easy" });
    expect(rook.last("room").room.seats.filter((x: { kind: string }) => x.kind === "bot").length).toBe(1);
    expect(pro.last("room").room.botLevel).toBe("hard");
  });

  it("keeps sizes and stakes apart, and lets people step out of line", () => {
    const { mm, conn, rooms, clock } = setup();
    const a = conn(1);
    const b = conn(2);
    const c = conn(3);
    mm.join(a, 3, 250);
    mm.join(b, 3, 1000);
    mm.join(c, 4, 250);
    expect(a.last("queue").waiting).toBe(1);
    expect(mm.size).toBe(3);
    mm.leave("c2");
    expect(b.last("unqueued")).toBeTruthy();
    expect(clock.pending).toBe(2); // b's line is gone, timer and all
    clock.advance(QUEUE_WAIT_MS);
    expect(rooms.size).toBe(2);
    expect(b.of("room")).toEqual([]);
  });

  it("holds one place per person, and rejects bad sizes", () => {
    const { mm, conn } = setup();
    const a = conn(1);
    const a2 = new TestConn("c9", "u1", "P1"); // the same person on another device
    mm.join(a, 4, 0);
    mm.join(a2, 4, 0);
    expect(mm.size).toBe(1);
    expect(a.last("unqueued")).toBeTruthy();
    expect(mm.join(a, 7, 0)).toBe("bad_message");
    expect(mm.join(a, 4, -5)).toBe("bad_message");
  });
});
