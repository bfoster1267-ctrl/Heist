// The action log. A Heist game is fully determined by its seed, its seats and the list of answers, so
// that is all we store: one start record, one line per answer, one end record. It is enough to rebuild
// every table after a server restart (see restore in rooms.ts), to replay a finished game, and later to
// settle chips (workstream 5) and investigate disputes.
//
// FileStore writes one JSON-lines file per game, and moves it to games/done/ when the game ends, so a
// restart only reads the games that were still running. PgGameStore (db/stores.ts) keeps the same records in
// Postgres when DATABASE_URL is set.

import { createWriteStream, mkdirSync, readFileSync, readdirSync, rename, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { Answer, BotLevel, RuleOptions } from "@heist/engine";

export interface StoredSeat {
  name: string;
  bot: boolean;
  userId: string | null;
}

export interface GameStart {
  gameId: string;
  roomId: string;
  code: string;
  /** which game of this room (1 = first, 2 = first rematch...) */
  game: number;
  seed: number;
  seats: StoredSeat[];
  stakes: number;
  isPrivate: boolean;
  hostId: string | null;
  turnSeconds: number;
  /** missing in logs written before optional rules existed: all off */
  rules?: RuleOptions;
  botLevel?: BotLevel;
  /** a ranked table (missing: casual) */
  ranked?: boolean;
  at: number;
}

export interface StoredAnswer {
  seat: number;
  a: Answer;
  /** who answered: the player, a bot seat, or a bot standing in for a player who ran out of time / is on autopilot */
  by: "player" | "bot" | "autopilot";
}

export interface GameEnd {
  winners: number[];
  /** aborted: the table stopped on an error and the game can't go on */
  reason: "footholds" | "last_call" | "aborted";
  at: number;
}

export interface GameRecord {
  start: GameStart;
  answers: StoredAnswer[];
  end: GameEnd | null;
}

export interface GameStore {
  started(g: GameStart): void;
  answered(gameId: string, a: StoredAnswer): void;
  ended(gameId: string, e: GameEnd): void;
  /** games that started but never ended (the server stopped mid-game) */
  unfinished(): Promise<GameRecord[]>;
  /** one game's record, running or finished (the admin panel's move list) */
  game?(gameId: string): Promise<GameRecord | undefined>;
  /** wait for pending writes (shutdown) */
  flush(): Promise<void>;
}

export class MemoryStore implements GameStore {
  games = new Map<string, GameRecord>();
  started(g: GameStart) {
    this.games.set(g.gameId, { start: g, answers: [], end: null });
  }
  answered(id: string, a: StoredAnswer) {
    this.games.get(id)?.answers.push(a);
  }
  ended(id: string, e: GameEnd) {
    const g = this.games.get(id);
    if (g) g.end = e;
  }
  async unfinished() {
    return [...this.games.values()].filter((g) => !g.end);
  }
  async game(id: string) {
    return this.games.get(id);
  }
  async flush() {}
}

export class FileStore implements GameStore {
  private dir: string;
  private open = new Map<string, WriteStream>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "games");
    mkdirSync(join(this.dir, "done"), { recursive: true });
  }

  private write(id: string, rec: object, close = false) {
    let w = this.open.get(id);
    if (!w) {
      w = createWriteStream(join(this.dir, `${id}.jsonl`), { flags: "a" });
      this.open.set(id, w);
    }
    w.write(JSON.stringify(rec) + "\n");
    if (close) {
      const file = `${id}.jsonl`;
      w.end(() => rename(join(this.dir, file), join(this.dir, "done", file), () => {}));
      this.open.delete(id);
    }
  }

  started(g: GameStart) {
    this.write(g.gameId, { t: "start", ...g });
  }
  answered(id: string, a: StoredAnswer) {
    this.write(id, { t: "a", ...a });
  }
  ended(id: string, e: GameEnd) {
    this.write(id, { t: "end", ...e }, true);
  }

  async unfinished(): Promise<GameRecord[]> {
    const out: GameRecord[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const rec = FileStore.parse(readFileSync(join(this.dir, f), "utf8"));
      if (rec && !rec.end) out.push(rec);
    }
    return out;
  }

  async game(id: string): Promise<GameRecord | undefined> {
    if (!/^[\w-]{1,40}$/.test(id)) return undefined;
    for (const f of [join(this.dir, "done", `${id}.jsonl`), join(this.dir, `${id}.jsonl`)]) {
      try {
        return FileStore.parse(readFileSync(f, "utf8")) ?? undefined;
      } catch {
        // not in this folder
      }
    }
    return undefined;
  }

  static parse(text: string): GameRecord | null {
    let rec: GameRecord | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let x: { t: string } & Record<string, unknown>;
      try {
        x = JSON.parse(line);
      } catch {
        break; // a torn last line from a crash: keep what came before it
      }
      const { t, ...body } = x;
      if (t === "start") rec = { start: body as unknown as GameStart, answers: [], end: null };
      else if (t === "a" && rec) rec.answers.push(body as unknown as StoredAnswer);
      else if (t === "end" && rec) rec.end = body as unknown as GameEnd;
    }
    return rec;
  }

  async flush() {
    await Promise.all([...this.open.values()].map((w) => new Promise<void>((r) => w.end(r))));
    this.open.clear();
  }
}
