// Quick queue: press Play now, wait for others who want the same table size and stakes, and get dealt in.
// A table starts as soon as it's full. While people wait, bots trickle into the empty seats one at a
// time, spread evenly over QUEUE_WAIT_MS from the first person in line, so the count keeps moving (1/6,
// 2/6...) and every real player who joins makes the table deal sooner. Bots stay labeled as bots. Matched players land in an unlisted room like any other, so reconnecting, leaving
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

export const QUEUE_WAIT_MS = 60_000;
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
  /** Bot seats taken in a casual line whose first person has waited this long: one more every waitMs/(players-1). */
  private botsAt(players: number, waited: number) {
    return Math.min(players - 1, Math.floor((Math.max(0, waited) * (players - 1)) / this.waitMs));
  }

  /** When the next bot sits down (epoch ms), for a line whose first person joined at `since`. */
  private nextBotAt(players: number, since: number, bots: number) {
    return since + Math.ceil(((bots + 1) * this.waitMs) / (players - 1));
  }

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
      // casual tables deal once real players and the bots that have trickled in fill it; ranked never uses bots
      const bots = line.ranked ? 0 : this.botsAt(line.players, waited);
      if (near.length + bots < line.players) break;
      this.deal(line, near.slice(0, line.players));
    }
    if (!line.waiters.length) return this.drop(key, line);
    const first = line.waiters[0];
    line.startsAt = first.since + this.waitMs;
    this.tell(line, now);
    // ranked never runs out of wait, so it just looks again every tick as the band widens;
    // casual also looks again the moment the next bot sits down
    const next = line.ranked ? now + TICK_MS : Math.min(now + TICK_MS, this.nextBotAt(line.players, first.since, this.botsAt(line.players, now - first.since)));
    line.timer = this.clock.set(() => this.match(key, line), Math.max(0, next - now));
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

  /** Everyone in this line hears how many are waiting, how many bots have sat down, and when the table starts regardless. */
  private tell(line: Line, now: number) {
    const people = Math.min(line.waiters.length, line.players);
    const bots = line.ranked ? 0 : Math.min(this.botsAt(line.players, now - line.waiters[0].since), line.players - people);
    const msg: ServerMsg = {
      t: "queue", players: line.players, stakes: line.stakes, waiting: line.waiters.length, bots, startsAt: line.ranked ? 0 : line.startsAt, ...(line.ranked ? { ranked: true } : {}),
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
      for (const w of group) {
        w.conn.send({ t: "unqueued" });
        w.conn.send({ t: "error", code: "bad_state", msg: "The server is full right now. Try again in a minute." });
      }
      return;
    }
    const seated = group.filter((w) => {
      if (this.seat(w.conn, room) === null) return true;
      // couldn't sit them (socket gone mid-deal, say): say so, or their screen waits on a table that never comes
      w.conn.send({ t: "unqueued" });
      return false;
    });
    if (seated.length) {
      room.start(null);
      this.log?.(line.ranked ? "ranked table" : "quick table", { room: room.code, people: seated.length, players: line.players });
    }
  }
}
