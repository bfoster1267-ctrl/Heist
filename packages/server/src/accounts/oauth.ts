// Sign in with Apple, Google and Facebook. The browser does the provider's sign-in and hands us what it
// got back (Apple and Google: a signed ID token; Facebook: an access token); we check it with the
// provider and take their stable user id. Each provider is switched on by its settings (see main.ts) and
// stays hidden in the web app until then.

import { createPublicKey, verify } from "node:crypto";

export interface OAuthConfig {
  /** OAuth client ids from Google Cloud (web, and iOS later) */
  google?: { clientIds: string[] };
  /** Apple Services ID (web) and bundle id (iOS app) */
  apple?: { clientIds: string[] };
  facebook?: { appId: string; appSecret: string };
}

export interface Verified {
  subject: string;
  email?: string;
  name?: string;
}

export type OAuthProvider = "google" | "apple" | "facebook";

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const JWKS: Record<"google" | "apple", { url: string; issuers: string[] }> = {
  google: { url: "https://www.googleapis.com/oauth2/v3/certs", issuers: ["accounts.google.com", "https://accounts.google.com"] },
  apple: { url: "https://appleid.apple.com/auth/keys", issuers: ["https://appleid.apple.com"] },
};
const KEY_CACHE_MS = 60 * 60_000;

export class OAuthError extends Error {}

export class OAuth {
  private keys = new Map<string, { at: number; keys: (JsonWebKey & { kid?: string })[] }>();

  constructor(
    private cfg: OAuthConfig,
    private fetchFn: Fetch = (u) => fetch(u),
    private now: () => number = Date.now,
  ) {}

  /** Providers with settings, in the order the sign-in screen shows them. */
  providers(): OAuthProvider[] {
    const out: OAuthProvider[] = [];
    if (this.cfg.apple?.clientIds.length) out.push("apple");
    if (this.cfg.google?.clientIds.length) out.push("google");
    if (this.cfg.facebook?.appId) out.push("facebook");
    return out;
  }

  /** Public settings the web app needs to show each provider's button. */
  publicConfig() {
    return {
      apple: this.cfg.apple?.clientIds[0] ?? null,
      google: this.cfg.google?.clientIds[0] ?? null,
      facebook: this.cfg.facebook?.appId ?? null,
    };
  }

  async verify(provider: string, credential: unknown): Promise<Verified> {
    if (typeof credential !== "string" || credential.length > 8192) throw new OAuthError("Missing sign-in token");
    if (provider === "google" || provider === "apple") {
      const ids = this.cfg[provider]?.clientIds;
      if (!ids?.length) throw new OAuthError(`${provider} sign-in isn't set up`);
      const c = await this.verifyJwt(provider, credential, ids);
      if (provider === "google" && c.email_verified === false) throw new OAuthError("Google says that email isn't verified");
      return { subject: String(c.sub), email: typeof c.email === "string" ? c.email : undefined, name: typeof c.name === "string" ? c.name : undefined };
    }
    if (provider === "facebook") return this.verifyFacebook(credential);
    throw new OAuthError("Unknown sign-in provider");
  }

  private async jwks(provider: "google" | "apple", refresh = false) {
    const hit = this.keys.get(provider);
    if (hit && !refresh && this.now() - hit.at < KEY_CACHE_MS) return hit.keys;
    const r = await this.fetchFn(JWKS[provider].url);
    if (!r.ok) throw new OAuthError(`Couldn't reach ${provider} to check the sign-in`);
    const body = (await r.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = body.keys ?? [];
    this.keys.set(provider, { at: this.now(), keys });
    return keys;
  }

  private async verifyJwt(provider: "google" | "apple", token: string, audiences: string[]): Promise<Record<string, unknown>> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new OAuthError("Malformed sign-in token");
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch {
      throw new OAuthError("Malformed sign-in token");
    }
    if (header.alg !== "RS256") throw new OAuthError("Unexpected token signature");
    let jwk = (await this.jwks(provider)).find((k) => k.kid === header.kid);
    // providers rotate keys: one refetch when the key id is new to us
    if (!jwk) jwk = (await this.jwks(provider, true)).find((k) => k.kid === header.kid);
    if (!jwk) throw new OAuthError("Unknown signing key");
    const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    if (!ok) throw new OAuthError("Sign-in token signature is wrong");
    if (!JWKS[provider].issuers.includes(String(claims.iss))) throw new OAuthError("Sign-in token came from the wrong issuer");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => audiences.includes(String(a)))) throw new OAuthError("Sign-in token is for a different app");
    const now = this.now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new OAuthError("Sign-in token expired");
    if (typeof claims.sub !== "string" || !claims.sub) throw new OAuthError("Sign-in token has no user");
    return claims;
  }

  private async verifyFacebook(accessToken: string): Promise<Verified> {
    const fb = this.cfg.facebook;
    if (!fb?.appId) throw new OAuthError("facebook sign-in isn't set up");
    const appToken = `${fb.appId}|${fb.appSecret}`;
    const dbg = await this.fetchFn(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`);
    const d = ((await dbg.json()) as { data?: { is_valid?: boolean; app_id?: string; user_id?: string } }).data;
    if (!dbg.ok || !d?.is_valid || d.app_id !== fb.appId || !d.user_id) throw new OAuthError("Facebook didn't accept that sign-in");
    const me = await this.fetchFn(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
    const m = (await me.json()) as { id?: string; name?: string; email?: string };
    if (!me.ok || m.id !== d.user_id) throw new OAuthError("Facebook didn't accept that sign-in");
    return { subject: d.user_id, name: m.name, email: m.email };
  }
}
