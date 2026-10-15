import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AccountService } from "../src/accounts/service";
import { HeistClient } from "../src/client";
import { Pusher, encrypt, makeVapidKeys, parseSub, type Fetch } from "../src/push";
import { startServer, type HeistServer } from "../src/server";

const u = (s: string) => Buffer.from(s, "base64url");
const servers: HeistServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
});
const until = async (f: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** a browser's side of a subscription: its keys, and decrypting what the server sent */
function browser(endpoint = "https://fcm.googleapis.com/fcm/send/abc") {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = Buffer.alloc(16, 9);
  const sub = { endpoint, keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  const open = (b: Buffer) => {
    const salt = b.subarray(0, 16), asPub = b.subarray(21, 21 + b[20]), ct = b.subarray(21 + b[20]);
    const ikm = Buffer.from(hkdfSync("sha256", ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32));
    const key = (info: string, n: number) => Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(info), n));
    const d = createDecipheriv("aes-128-gcm", key("Content-Encoding: aes128gcm\0", 16), key("Content-Encoding: nonce\0", 12));
    d.setAuthTag(ct.subarray(-16));
    const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
    expect(plain[plain.length - 1]).toBe(2);
    return JSON.parse(plain.subarray(0, -1).toString());
  };
  return { sub, open };
}

describe("web push", () => {
  it("encrypts exactly as RFC 8291's worked example", () => {
    const body = encrypt(
      Buffer.from("When I grow up, I want to be a watermelon"),
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      u("DGv6ra1nlYgDCS1FRnbzlw"),
      { priv: u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") },
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("signs a VAPID token the push service can check, and sends a message the browser can read", async () => {
    const keys = makeVapidKeys();
    const b = browser("https://web.push.apple.com/QK7x");
    let seen: Parameters<Fetch>[1] | null = null;
    const p = new Pusher(keys, { fetch: async (_, init) => ((seen = init), { status: 201 }) });
    const sub = parseSub(b.sub, 1)!;
    expect(await p.send(sub, { title: "Your turn", body: "Table K7QX", tag: "turn-K7QX" })).toBe("ok");
    const [, jwt, k] = seen!.headers.authorization.match(/^vapid t=(.+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(u(c).toString()).aud).toBe("https://web.push.apple.com");
    const pub = u(k);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, u(sig))).toBe(true);
    expect(b.open(seen!.body)).toEqual({ title: "Your turn", body: "Table K7QX", tag: "turn-K7QX" });

    const gone = new Pusher(keys, { fetch: async () => ({ status: 410 }) });
    expect(await gone.send(sub, { title: "a", body: "b", tag: "c" })).toBe("gone");
    expect(() => new Pusher({ publicKey: makeVapidKeys().publicKey, privateKey: keys.privateKey })).toThrow();
  });

  it("only takes subscriptions on real push services", () => {
    const { sub } = browser();
    expect(parseSub(sub, 1)).not.toBeNull();
    expect(parseSub({ ...sub, endpoint: "https://evil.example/x" }, 1)).toBeNull();
    expect(parseSub({ ...sub, endpoint: "http://fcm.googleapis.com/x" }, 1)).toBeNull();
    expect(parseSub({ ...sub, endpoint: "https://fcm.googleapis.com.evil.example/x" }, 1)).toBeNull();
    expect(parseSub({ endpoint: sub.endpoint, keys: { p256dh: "short", auth: sub.keys.auth } }, 1)).toBeNull();
  });

  it("alerts a player whose app is in the background, and not one who's looking", async () => {
    const sent: { url: string; body: Buffer }[] = [];
    const push = new Pusher(makeVapidKeys(), { fetch: async (url, init) => (sent.push({ url, body: init.body }), { status: 201 }) });
    const accounts = new AccountService({ secret: "s", devLogins: true });
    const srv = await startServer({ port: 0, host: "127.0.0.1", accounts, push, rate: { burst: 1000, perSec: 1000 } });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port()}`;
    const post = async (path: string, body: object, token?: string) => {
      const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    expect((await (await fetch(`${base}/api/push/key`)).json()).key).toBe(push.publicKey);
    const [ann, ben, cal] = await Promise.all(["Ann", "Ben", "Cal"].map(async (n) => (await post("/api/auth/dev", { name: n })).body as { token: string }));
    const annPhone = browser("https://fcm.googleapis.com/fcm/send/ann");
    const benPhone = browser("https://fcm.googleapis.com/fcm/send/ben");
    expect((await post("/api/push/subscribe", { sub: annPhone.sub }, ann.token)).status).toBe(200);
    expect((await post("/api/push/subscribe", { sub: benPhone.sub }, ben.token)).status).toBe(200);
    expect((await post("/api/push/subscribe", { sub: { ...annPhone.sub, endpoint: "https://evil.example/x" } }, cal.token)).status).toBe(400);

    const sock = (token: string) => new HeistClient(`ws://127.0.0.1:${srv.port()}/ws`, { token });
    const a = sock(ann.token), b = sock(ben.token), c = sock(cal.token);
    await Promise.all([a.connect(), b.connect(), c.connect()]);
    a.create({ players: 4 });
    await until(() => !!a.room);
    a.setAway(true);
    await new Promise((r) => setTimeout(r, 100));
    b.join(a.room!.code);
    await until(() => sent.length > 0);
    expect(sent[0].url).toBe(annPhone.sub.endpoint);
    expect(annPhone.open(sent[0].body)).toMatchObject({ title: "Ben sat down", tag: `table-${a.room!.code}` });

    // Ben is looking at the table: Cal sitting down buzzes nobody (Ann had one moments ago)
    c.join(a.room!.code);
    await until(() => a.room!.seats.filter((s) => s.kind === "human").length === 3);
    await new Promise((r) => setTimeout(r, 5000));
    expect(sent.length).toBe(1);
    for (const x of [a, b, c]) x.close();
  }, 20_000);
});
