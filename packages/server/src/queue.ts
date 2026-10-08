// Quick queue: press Play now, wait for others who want the same table size and stakes, and get dealt in.
// A table starts as soon as it's full, or once the first person in line has waited QUEUE_WAIT_MS; then bots
// take the empty seats. Matched players land in an unlisted room like any other, so reconnecting, leaving
// and rematches work the same as at a friends' table.

import type { ErrorCode, ServerMsg } from "./protocol";
import type { Clock, Conn, Room } from "./room";
import type { Rooms } from "./rooms";

export const QUEUE_WAIT_MS = 120_000;

interface Waiter {
  conn: Conn;
  since: number;
}

interface Line {
  players: number;
  stakes: number;
  waiters: Waiter[];
  timer: unknown;
  startsAt: number;
}

export class Matchmaker {
  private lines = new Map<string, Line>();
  /** which line each connection is in */
  private where = new Map<string, string>();

  constructor(
    private rooms: Rooms,
    private clock: Clock,
    /** seat this connection at the new table (the server moves its socket into the room) */
    private seat: (conn: Conn, room: Room) => ErrorCode | null,
    private waitMs = QUEUE_WAIT_MS,
    private log?: (msg: string, extra?: object) => void,
  ) {}

  /** People waiting right now, all lines together. */
  get size() {
    return this.where.size;
  }

  join(conn: Conn, players: unknown, stakes: unknown): ErrorCode | null {
    if (typeof players !== "number" || !Number.isInteger(players) || players < 3 || players > 6) return "bad_message";
    if (typeof stakes !== "number" || !Number.isInteger(stakes) || stakes < 0 || stakes > 1_000_000) return "bad_message";
    this.leave(conn.id, false);
    // one place in line per person, whichever device they queued from last
    for (const [id, key] of this.where) {
      const line = this.lines.get(key);
      const w = line?.waiters.find((x) => x.conn.id === id);
      if (w && w.conn.userId === conn.userId) this.leave(id);
    }
    const key = `${players}:${stakes}`;
    let line = this.lines.get(key);
    const now = this.clock.now();
    if (!line) {
      line = { players, stakes, waiters: [], timer: null, startsAt: now + this.waitMs };
      const l = line;
      line.timer = this.clock.set(() => this.deal(key, l), this.waitMs);
      this.lines.set(key, line);
    }
    line.waiters.push({ conn, since: now });
    this.where.set(conn.id, key);
    if (line.waiters.length >= players) this.deal(key, line);
    else this.tell(line);
    return null;
  }

  /** Out of line: they asked, joined a table some other way, or their socket closed. */
  leave(connId: string, notify = true) {
    const key = this.where.get(connId);
    if (!key) return;
    this.where.delete(connId);
    const line = this.lines.get(key);
    if (!line) return;
    const i = line.waiters.findIndex((w) => w.conn.id === connId);
    const [w] = i >= 0 ? line.waiters.splice(i, 1) : [];
    if (notify && w) w.conn.send({ t: "unqueued" });
    if (!line.waiters.length) this.drop(key, line);
    else this.tell(line);
  }

  close() {
    for (const [key, line] of this.lines) this.drop(key, line);
    this.where.clear();
  }

  private drop(key: string, line: Line) {
    if (line.timer !== null) this.clock.clear(line.timer);
    line.timer = null;
    if (this.lines.get(key) === line) this.lines.delete(key);
  }

  /** Everyone in this line hears how many are waiting and when the table starts regardless. */
  private tell(line: Line) {
    const msg: ServerMsg = { t: "queue", players: line.players, stakes: line.stakes, waiting: line.waiters.length, startsAt: line.startsAt };
    for (const w of line.waiters) w.conn.send(msg);
  }

  /** Start a table for the people at the front of the line; bots fill whatever seats are left. */
  private deal(key: string, line: Line) {
    this.drop(key, line);
    const group = line.waiters.splice(0, line.players);
    for (const w of group) this.where.delete(w.conn.id);
    // anyone left over (a line can't really overflow, but be safe) starts a fresh line
    const rest = line.waiters.splice(0);
    for (const w of rest) this.where.delete(w.conn.id);
    if (group.length) {
      const room = this.rooms.create({ players: line.players, stakes: line.stakes, isPrivate: true, turnSeconds: 30, rules: { bribes: false, placeCrew: false, openDeals: false }, botLevel: "normal" });
      if (!room) {
        for (const w of group) w.conn.send({ t: "error", code: "bad_state", msg: "The server is full right now. Try again in a minute." });
      } else {
        const seated = group.filter((w) => this.seat(w.conn, room) === null);
        if (seated.length) {
          room.start(null);
          this.log?.("quick table", { room: room.code, people: seated.length, players: line.players });
        }
      }
    }
    for (const w of rest) this.join(w.conn, line.players, line.stakes);
  }
}
