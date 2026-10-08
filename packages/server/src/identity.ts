// Who is on the other end of a socket. Today everyone is a guest: the server hands out a signed token on
// first contact and the client keeps it (localStorage) so a refresh or a dropped connection gets the same
// seat back. Accounts (workstream 4) replace GuestIdentity with a provider that verifies a Supabase
// session token and returns the account's id and display name; nothing else in the server changes.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface Identity {
  userId: string;
  name: string;
  /** what the client should send back on reconnect */
  token: string;
}

export interface IdentityProvider {
  authenticate(token: string | undefined, name: string | undefined): Promise<Identity>;
}

export function cleanName(raw: unknown, fallback = "Guest"): string {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, 20);
}

export class GuestIdentity implements IdentityProvider {
  private secret: Buffer;

  constructor(secret?: string) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  private sign(userId: string) {
    return createHmac("sha256", this.secret).update(userId).digest("base64url");
  }

  async authenticate(token: string | undefined, name: string | undefined): Promise<Identity> {
    const userId = this.verify(token) ?? `g_${randomBytes(9).toString("base64url")}`;
    const n = cleanName(name, `Guest ${userId.slice(2, 6)}`);
    return { userId, name: n, token: `${userId}.${this.sign(userId)}` };
  }

  private verify(token: string | undefined): string | null {
    if (typeof token !== "string" || token.length > 200) return null;
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const userId = token.slice(0, dot);
    const want = Buffer.from(this.sign(userId));
    const got = Buffer.from(token.slice(dot + 1));
    return want.length === got.length && timingSafeEqual(want, got) ? userId : null;
  }
}
