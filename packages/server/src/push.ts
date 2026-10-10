// Web push: "your turn" and "someone sat down" alerts on a phone whose Heist app is closed or in the
// background. Speaks the standard protocol directly (VAPID sign-in, RFC 8291 aes128gcm encryption) with
// node:crypto, so there's no library to keep up to date. Keys come from VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
// (the usual web-push format: base64url of the 65-byte public point and the 32-byte private number).

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

export interface PushSub {
  endpoint: string;
  /** the browser's public key (base64url, 65 bytes) */
  p256dh: string;
  /** the browser's auth secret (base64url, 16 bytes) */
  auth: string;
  at: number;
}

export interface PushMessage {
  title: string;
  body: string;
  /** a later alert with the same tag replaces this one instead of stacking */
  tag: string;
  /** where tapping it opens */
  url?: string;
}

/** The push services browsers use. Only these get our requests, so a made-up endpoint can't aim the server elsewhere. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

/** Read a subscription the browser sent (PushSubscription.toJSON()); null if it isn't one. */
export function parseSub(raw: unknown, now: number): PushSub | null {
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!r || typeof r.endpoint !== "string" || r.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return null;
  const p256dh = r.keys?.p256dh, auth = r.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (unb64(p256dh).length !== 65 || unb64(auth).length !== 16) return null;
  return { endpoint: r.endpoint, p256dh, auth, at: now };
}

/** A fresh VAPID key pair, in the format VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY take. */
export function makeVapidKeys() {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return { publicKey: b64(e.getPublicKey()), privateKey: b64(e.getPrivateKey()) };
}

/**
 * Encrypt one message for one browser (RFC 8291, a single aes128gcm record). `salt` and `sender` are only
 * passed by tests, to check against the RFC's worked example.
 */
export function encrypt(payload: Buffer, sub: Pick<PushSub, "p256dh" | "auth">, salt = randomBytes(16), sender?: { priv: Buffer }) {
  const ua = unb64(sub.p256dh);
  const ecdh = createECDH("prime256v1");
  if (sender) ecdh.setPrivateKey(sender.priv);
  else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(ua);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPub]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, unb64(sub.auth), keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = asPub.length;
  return Buffer.concat([head, asPub, body]);
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>;

export class Pusher {
  readonly publicKey: string;
  private key: ReturnType<typeof createPrivateKey>;
  private jwts = new Map<string, { jwt: string; exp: number }>();

  constructor(
    keys: { publicKey: string; privateKey: string },
    private o: { subject?: string; now?: () => number; fetch?: Fetch; log?: (msg: string, extra?: object) => void } = {},
  ) {
    const pub = unb64(keys.publicKey);
    if (pub.length !== 65 || unb64(keys.privateKey).length !== 32) throw new Error("VAPID keys aren't in the expected format");
    this.publicKey = keys.publicKey;
    this.key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) }, format: "jwk" });
    // fail at start, not on the first alert, if the halves don't match
    const check = createECDH("prime256v1");
    check.setPrivateKey(unb64(keys.privateKey));
    if (!check.getPublicKey().equals(pub)) throw new Error("VAPID public and private keys don't match");
  }

  private now() {
    return (this.o.now ?? Date.now)();
  }

  /** The signed "this is Heist" token for one push service, reused until near its expiry. */
  private vapid(audience: string) {
    const t = Math.floor(this.now() / 1000);
    const hit = this.jwts.get(audience);
    if (hit && hit.exp - t > 3600) return hit.jwt;
    const exp = t + 12 * 3600;
    const part = (o: object) => b64(Buffer.from(JSON.stringify(o)));
    const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp, sub: this.o.subject ?? "mailto:support@playheist.net" })}`;
    const sig = sign("sha256", Buffer.from(unsigned), { key: this.key, dsaEncoding: "ieee-p1363" });
    const jwt = `${unsigned}.${b64(sig)}`;
    this.jwts.set(audience, { jwt, exp });
    return jwt;
  }

  /** Send one alert. Resolves to "gone" when the browser has dropped the subscription (forget it). */
  async send(sub: PushSub, m: PushMessage, ttlSeconds = 120): Promise<"ok" | "gone" | "failed"> {
    const url = new URL(sub.endpoint);
    const fetch = this.o.fetch ?? (globalThis.fetch as unknown as Fetch);
    try {
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          authorization: `vapid t=${this.vapid(url.origin)}, k=${this.publicKey}`,
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(ttlSeconds),
          urgency: "high",
          topic: m.tag.replace(/[^\w-]/g, "").slice(0, 32) || "heist",
        },
        body: encrypt(Buffer.from(JSON.stringify(m)), sub),
      });
      if (res.status === 404 || res.status === 410) return "gone";
      if (res.status >= 200 && res.status < 300) return "ok";
      this.o.log?.("push refused", { status: res.status, host: url.hostname });
      return "failed";
    } catch (e) {
      this.o.log?.("push failed", { host: url.hostname, err: String(e) });
      return "failed";
    }
  }
}
