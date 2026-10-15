// Session tokens and passwords. A session token is `a.<accountId>.<sessions>.<expires>.<signature>`,
// signed with the server secret; bumping the account's `sessions` counter invalidates every old token.

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SESSION_DAYS = 180;

export class Tokens {
  private secret: Buffer;
  constructor(secret?: string) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  private sig(body: string) {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }

  issue(accountId: string, sessions: number, now = Date.now()): string {
    const body = `a.${accountId}.${sessions}.${now + SESSION_DAYS * 86_400_000}`;
    return `${body}.${this.sig(body)}`;
  }

  /** The account id and session counter, or null if the token is forged, malformed or expired. */
  read(token: unknown, now = Date.now()): { accountId: string; sessions: number } | null {
    if (typeof token !== "string" || token.length > 300) return null;
    const parts = token.split(".");
    if (parts.length !== 5 || parts[0] !== "a") return null;
    const body = parts.slice(0, 4).join(".");
    const want = Buffer.from(this.sig(body));
    const got = Buffer.from(parts[4]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    if (Number(parts[3]) < now) return null;
    return { accountId: parts[1], sessions: Number(parts[2]) };
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(password.normalize("NFKC"), salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function checkPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [kind, salt, hash] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"));
  return want.length === got.length && timingSafeEqual(want, got);
}
