// Quick queue: press Play now, wait for others who want the same table size and stakes, and get dealt in.
// A table starts as soon as it's full, or once the first person in line has waited QUEUE_WAIT_MS; then bots
// take the empty seats. Matched players land in an unlisted room like any other, so reconnecting, leaving
// and rematches work the same as at a friends' table.
//
// Lines are matched by hidden skill rating: a table only deals right away for players within a rating
// band of whoever has waited longest, and the band widens the longer they wait, so a busy queue groups
// players of similar skill and a quiet one still deals. When the longest wait runs out, that player and
// the closest-rated others in line sit down and bots (at the group's level) fill the rest.
//
// Ranked has its own lines, matched on Ranked MMR: always 6 people, and never bots. A ranked table only
// deals once six are in line; the rating band still widens with the wait so a quiet queue still deals.

import { RANKED_PLAYERS, botLevelFor } from "@heist/profile";
import type { ErrorCode, ServerMsg } from "./protocol";
import type { Clock, Conn, Room } from "./room";
import type { Rooms } from "./rooms";

export const QUEUE_WAIT_MS = 120_000;
/** how far apart in rating a table can be for someone who just joined, and how fast that widens */
const BAND = 100;
const BAND_PER_10S = 50;
/** look again this often while people wait (the band widens between looks) */
const TICK_MS = 5_000;

interface Waiter {
  conn: Conn;
  since: number;
  rating: number;
}

interface Line {
  ranked: boolean;
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

  /** `rating`: the player's hidden skill rating, or their Ranked MMR for a ranked line (1000 for anyone without one). */
  join(conn: Conn, players: unknown, stakes: unknown, rating = 1000, ranked = false): ErrorCode | null {
    if (ranked) players = RANKED_PLAYERS;
    if (typeof players !== "number" || !Number.isInteger(players) || players < 3 || players > 6) return "bad_message";
    if (typeof stakes !== "number" || !Number.isInteger(stakes) || stakes < 0 || stakes > 1_000_000) return "bad_message";
    this.leave(conn.id, false);
    // one place in line per person, whichever device they queued from last
    for (const [id, key] of this.where) {
      const line = this.lines.get(key);
      const w = line?.waiters.find((x) => x.conn.id === id);
      if (w && w.conn.userId === conn.userId) this.leave(id);
    }
    const key = `${ranked ? "r" : "c"}:${players}:${stakes}`;
    let line = this.lines.get(key);
    const now = this.clock.now();
    if (!line) {
      line = { ranked, players, stakes, waiters: [], timer: null, startsAt: now + this.waitMs };
      this.lines.set(key, line);
    }
    line.waiters.push({ conn, since: now, rating });
    this.where.set(conn.id, key);
    this.match(key, line);
    return null;
  }

  /** Deal every table this line can make now, then tell whoever is still waiting and look again later. */
  private match(key: string, line: Line) {
    if (line.timer !== null) this.clock.clear(line.timer);
    line.timer = null;
    const now = this.clock.now();
    for (;;) {
      const first = line.waiters[0];
      if (!first) break;
      const waited = now - first.since;
      const band = waited >= this.waitMs ? Infinity : BAND + BAND_PER_10S * Math.floor(waited / 10_000);
      const near = line.waiters
        .filter((w) => Math.abs(w.rating - first.rating) <= band)
        .sort((a, b) => (a === first ? -1 : b === first ? 1 : Math.abs(a.rating - first.rating) - Math.abs(b.rating - first.rating)));
      // casual tables deal short-handed once the wait is up (bots fill in); ranked ones never do
      if (near.length < line.players && (line.ranked || waited < this.waitMs)) break;
      this.deal(line, near.slice(0, line.players));
    }
    if (!line.waiters.length) return this.drop(key, line);
    line.startsAt = line.waiters[0].since + this.waitMs;
    this.tell(line);
    // ranked never runs out of wait, so it just looks again every tick as the band widens
    line.timer = this.clock.set(() => this.match(key, line), line.ranked ? TICK_MS : Math.max(0, Math.min(TICK_MS, line.startsAt - now)));
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
    else this.match(key, line);
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
    const msg: ServerMsg = {
      t: "queue", players: line.players, stakes: line.stakes, waiting: line.waiters.length, startsAt: line.ranked ? 0 : line.startsAt, ...(line.ranked ? { ranked: true } : {}),
    };
    for (const w of line.waiters) w.conn.send(msg);
  }

  /** Start a table for this group; bots fill whatever seats are left. */
  private deal(line: Line, group: Waiter[]) {
    line.waiters = line.waiters.filter((w) => !group.includes(w));
    for (const w of group) this.where.delete(w.conn.id);
    const avg = group.reduce((t, w) => t + w.rating, 0) / group.length;
    const room = this.rooms.create({
      players: line.players, stakes: line.stakes, isPrivate: true, turnSeconds: 30,
      rules: { bribes: false, placeCrew: false, openDeals: false }, botLevel: botLevelFor(avg), ranked: line.ranked,
    });
    if (!room) {
      for (const w of group) w.conn.send({ t: "error", code: "bad_state", msg: "The server is full right now. Try again in a minute." });
      return;
    }
    const seated = group.filter((w) => this.seat(w.conn, room) === null);
    if (seated.length) {
      room.start(null);
      this.log?.(line.ranked ? "ranked table" : "quick table", { room: room.code, people: seated.length, players: line.players });
    }
  }
}
