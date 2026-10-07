// All tables on this server: create by options, find by code, list public lobbies, close idle rooms,
// and rebuild unfinished games after a restart. Matchmaking (quick queue, party queue; workstream 4)
// sits on top of this: it creates rooms with create(), seats players with room.join() and starts them
// with room.start(null).

import { randomBytes, randomInt } from "node:crypto";
import type { CreateRoomOptions, RoomSummary } from "./protocol";
import { Room, type RoomDeps } from "./room";

/** No 0/O, 1/I/L: codes are read aloud and typed on phones. */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 5;

export interface Limits {
  maxRooms: number;
  /** close a lobby or finished table with nobody connected after this long (ms) */
  idleMs: number;
  /** close a table mid-game with nobody connected after this long (ms) */
  idlePlayingMs: number;
}

export const DEFAULT_LIMITS: Limits = { maxRooms: 2000, idleMs: 10 * 60_000, idlePlayingMs: 30 * 60_000 };

export function roomOptions(o: Partial<CreateRoomOptions> | undefined): Required<CreateRoomOptions> | null {
  const players = o?.players;
  if (typeof players !== "number" || !Number.isInteger(players) || players < 3 || players > 6) return null;
  const stakes = typeof o?.stakes === "number" && Number.isInteger(o.stakes) && o.stakes >= 0 && o.stakes <= 1_000_000 ? o.stakes : 0;
  const t = o?.turnSeconds;
  const turnSeconds = typeof t === "number" && Number.isFinite(t) ? Math.round(Math.min(120, Math.max(10, t))) : 30;
  return { players, stakes, isPrivate: o?.isPrivate === true, turnSeconds };
}

export class Rooms {
  private byCode = new Map<string, Room>();
  readonly limits: Limits;

  constructor(
    private deps: RoomDeps,
    limits: Partial<Limits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  get size() {
    return this.byCode.size;
  }

  create(o: Required<CreateRoomOptions>): Room | null {
    if (this.byCode.size >= this.limits.maxRooms) return null;
    let code = "";
    do code = Array.from({ length: CODE_LEN }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
    while (this.byCode.has(code));
    const room = new Room({ id: `r_${randomBytes(6).toString("base64url")}`, code, ...o }, this.deps);
    this.byCode.set(code, room);
    return room;
  }

  get(code: unknown): Room | undefined {
    return typeof code === "string" ? this.byCode.get(code.trim().toUpperCase()) : undefined;
  }

  /** Public lobbies with a free seat, fullest first (so tables fill up instead of spreading out). */
  list(limit = 50): RoomSummary[] {
    return [...this.byCode.values()]
      .filter((r) => !r.isPrivate && r.openSeats() > 0)
      .sort((a, b) => a.openSeats() - b.openSeats())
      .slice(0, limit)
      .map((r) => ({ code: r.code, players: r.players, stakes: r.stakes, open: r.openSeats(), status: r.status }));
  }

  /** Close rooms nobody has been connected to for a while. */
  sweep(now: number) {
    for (const [code, r] of this.byCode) {
      if (r.connections) continue;
      const limit = r.status === "playing" ? this.limits.idlePlayingMs : this.limits.idleMs;
      if (now - r.idleSince >= limit) {
        r.close();
        this.byCode.delete(code);
      }
    }
  }

  /** Rebuild tables from games that were running when the server last stopped. */
  restore(): number {
    let n = 0;
    for (const rec of this.deps.store.unfinished()) {
      if (this.byCode.has(rec.start.code)) continue;
      try {
        this.byCode.set(rec.start.code, Room.restore(rec, this.deps));
        n++;
      } catch (e) {
        this.deps.log?.("restore failed", { game: rec.start.gameId, err: String(e) });
      }
    }
    return n;
  }

  closeAll() {
    for (const r of this.byCode.values()) r.close();
    this.byCode.clear();
  }
}
