// Who can open the admin panel. The owner signs in with ADMIN_USER / ADMIN_PASSWORD (always works, so the
// owner can't be locked out); the owner can add more admins, each with their own scrypt-hashed password.
// Each admin also keeps their own Overview layout here.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkPassword, hashPassword } from "./tokens";
import { ApiError } from "./service";

const SESSION_MS = 8 * 3_600_000;
const NAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export type Role = "owner" | "admin";
export interface AdminWho {
  user: string;
  role: Role;
}

export interface TeamMember {
  user: string;
  hash: string;
  /** changes with the password, signing old sessions out */
  stamp: string;
  createdAt: number;
  createdBy: string;
  lastLogin?: number;
}

interface TeamFile {
  members: TeamMember[];
  layouts: Record<string, string[]>;
}

/** The team list, in memory (tests) or in DATA_DIR/admins.json. */
export class AdminTeam {
  protected data: TeamFile = { members: [], layouts: {} };
  constructor(private file?: string) {
    if (!file) return;
    mkdirSync(join(file, ".."), { recursive: true });
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<TeamFile>;
      this.data = { members: raw.members ?? [], layouts: raw.layouts ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  static inDir(dataDir: string) {
    return new AdminTeam(join(dataDir, "admins.json"));
  }

  get(user: string) {
    return this.data.members.find((m) => m.user === user);
  }

  list() {
    return this.data.members.map(({ hash, ...m }) => m);
  }

  async set(user: string, password: string, by: string, now: number) {
    const m = this.get(user);
    const hash = await hashPassword(password);
    const stamp = randomBytes(6).toString("base64url");
    if (m) Object.assign(m, { hash, stamp });
    else this.data.members.push({ user, hash, stamp, createdAt: now, createdBy: by });
    this.save();
  }

  remove(user: string) {
    const n = this.data.members.length;
    this.data.members = this.data.members.filter((m) => m.user !== user);
    delete this.data.layouts[user];
    this.save();
    return this.data.members.length < n;
  }

  seen(user: string, at: number) {
    const m = this.get(user);
    if (m) {
      m.lastLogin = at;
      this.save();
    }
  }

  layout(user: string): string[] | null {
    return this.data.layouts[user] ?? null;
  }

  setLayout(user: string, layout: string[] | null) {
    if (layout) this.data.layouts[user] = layout;
    else delete this.data.layouts[user];
    this.save();
  }

  protected save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}

export class AdminAuth {
  private key: Buffer;
  private owner: string;

  constructor(
    user: string,
    private password: string,
    secret: string | undefined,
    private now: () => number = Date.now,
    readonly team = new AdminTeam(),
  ) {
    this.owner = user.trim().toLowerCase();
    // changing the owner password signs every admin session out
    this.key = createHmac("sha256", secret ?? randomBytes(32).toString("hex")).update(`admin:${this.owner}:${password}`).digest();
  }

  /** A session for the right username and password, else null. */
  async login(user: unknown, password: unknown): Promise<{ token: string; expires: number; user: string; role: Role } | null> {
    if (typeof user !== "string" || typeof password !== "string" || password.length > 200) return null;
    const name = user.trim().toLowerCase();
    let who: AdminWho | null = null;
    if (timingSafeEqual(digest(name), digest(this.owner)) && timingSafeEqual(digest(password), digest(this.password))) who = { user: this.owner, role: "owner" };
    else {
      const m = this.team.get(name);
      if (m && (await checkPassword(password, m.hash))) {
        who = { user: m.user, role: "admin" };
        this.team.seen(m.user, this.now());
      }
    }
    if (!who) return null;
    const expires = this.now() + SESSION_MS;
    const u = Buffer.from(who.user).toString("base64url");
    return { token: `${expires}.${u}.${this.sign(expires, who.user)}`, expires, ...who };
  }

  /** Who a token belongs to, or null if it's forged, expired, or that admin was removed. */
  check(token: unknown): AdminWho | null {
    if (typeof token !== "string" || token.length > 300) return null;
    const [exp, u, sig] = token.split(".");
    const expires = Number(exp);
    if (!sig || !u || !Number.isFinite(expires) || expires < this.now()) return null;
    const user = Buffer.from(u, "base64url").toString();
    const want = this.sign(expires, user);
    if (!want) return null;
    const a = Buffer.from(want);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { user, role: user === this.owner ? "owner" : "admin" };
  }

  private sign(expires: number, user: string): string | null {
    const stamp = user === this.owner ? "owner" : this.team.get(user)?.stamp;
    if (!stamp) return null;
    return createHmac("sha256", this.key).update(`${expires}.${user}.${stamp}`).digest("base64url");
  }

  /** Owner only: add an admin or give one a new password. */
  async addMember(by: AdminWho, user: unknown, password: unknown) {
    if (by.role !== "owner") throw new ApiError(403, "Only the owner can manage admins");
    const name = typeof user === "string" ? user.trim().toLowerCase() : "";
    if (!NAME.test(name)) throw new ApiError(400, "Usernames are 2 to 32 letters, numbers, dots, dashes or underscores");
    if (name === this.owner) throw new ApiError(400, "That's the owner's username");
    if (typeof password !== "string" || password.length < 12 || password.length > 200) throw new ApiError(400, "Use a password of at least 12 characters");
    await this.team.set(name, password, by.user, this.now());
    return this.team.list();
  }

  removeMember(by: AdminWho, user: unknown) {
    if (by.role !== "owner") throw new ApiError(403, "Only the owner can manage admins");
    if (typeof user !== "string" || !this.team.remove(user)) throw new ApiError(404, "No such admin");
    return this.team.list();
  }
}

const digest = (s: string) => createHmac("sha256", "cmp").update(s).digest();
