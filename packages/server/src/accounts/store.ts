// Where accounts live. Every account is one record: who they are, how they sign in, and their whole
// progression (chips, coins, XP, prestige, stats, cosmetics). FileAccountStore keeps them all in memory
// and writes one JSON file (atomically, a moment after each change), which is plenty for one server at
// launch. A Postgres/Supabase store later only needs to implement AccountStore.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BotLevel } from "@heist/engine";
import type { Progress } from "@heist/profile";

export type Provider = "email" | "apple" | "google" | "facebook" | "dev";

export interface Login {
  provider: Provider;
  /** the provider's stable user id (for email: the lowercased address) */
  subject: string;
}

export interface SoloGame {
  gameId: string;
  seed: number;
  players: number;
  stakes: number;
  startedAt: number;
  /** each bot's level, picked from the player's rating at the start (missing on older games: all normal) */
  levels?: BotLevel[];
  /** a campaign stage */
  stage?: number;
}

export interface Account {
  id: string;
  name: string;
  createdAt: number;
  /** no sign-in method yet: progress lives on this device's token until they create an account */
  guest: boolean;
  logins: Login[];
  email?: string;
  /** scrypt hash, for email sign-in */
  password?: string;
  progress: Progress;
  /** the vs-bots game in progress (its buy-in is already paid) */
  solo: SoloGame | null;
  /** bumping this signs the account out everywhere */
  sessions: number;
}

export interface AccountStore {
  get(id: string): Promise<Account | undefined>;
  byLogin(l: Login): Promise<Account | undefined>;
  put(a: Account): Promise<void>;
  /** every account (leaderboards; a database store would query instead) */
  all(): Promise<Account[]>;
  flush(): Promise<void>;
}

const loginKey = (l: Login) => `${l.provider}:${l.subject}`;

export class MemoryAccountStore implements AccountStore {
  protected byId = new Map<string, Account>();
  protected logins = new Map<string, string>();

  protected index(a: Account) {
    for (const l of a.logins) this.logins.set(loginKey(l), a.id);
  }
  async get(id: string) {
    const a = this.byId.get(id);
    return a && structuredClone(a);
  }
  async byLogin(l: Login) {
    const id = this.logins.get(loginKey(l));
    return id ? this.get(id) : undefined;
  }
  async put(a: Account) {
    const old = this.byId.get(a.id);
    if (old) for (const l of old.logins) this.logins.delete(loginKey(l));
    this.byId.set(a.id, structuredClone(a));
    this.index(a);
  }
  async all() {
    return [...this.byId.values()].map((a) => structuredClone(a));
  }
  async flush() {}
}

export class FileAccountStore extends MemoryAccountStore {
  private file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string, private delayMs = 300) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "accounts.json");
    let raw: Account[] = [];
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    for (const a of raw) {
      this.byId.set(a.id, a);
      this.index(a);
    }
  }

  async put(a: Account) {
    await super.put(a);
    if (!this.timer) this.timer = setTimeout(() => this.write(), this.delayMs);
  }

  private write() {
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.byId.values()]));
    renameSync(tmp, this.file);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.write();
    }
  }
}
