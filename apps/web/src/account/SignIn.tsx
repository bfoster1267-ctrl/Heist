// Create an account or sign in: Apple, Google, Facebook (each shown once the server has its settings),
// email and password, or a name-only test login on development servers. A guest who signs up keeps
// everything they've earned so far.

import { useState } from "react";
import { useAccount } from "./useAccount";

declare global {
  interface Window {
    google?: { accounts: { id: { initialize(o: object): void; prompt(): void; renderButton(el: HTMLElement, o: object): void } } };
    AppleID?: { auth: { init(o: object): void; signIn(): Promise<{ authorization: { id_token: string }; user?: { name?: { firstName?: string; lastName?: string } } }> } };
    FB?: { init(o: object): void; login(cb: (r: { authResponse?: { accessToken: string } }) => void, o: object): void };
  }
}

const loaded = new Map<string, Promise<void>>();
function script(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error(`Couldn't load ${src}`));
      document.head.appendChild(s);
    });
    loaded.set(src, p);
  }
  return p;
}

export function SignIn() {
  const { backend, act } = useAccount();
  const cfg = backend?.config;
  const has = (p: string) => !!cfg?.providers.includes(p);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Sign-in didn't work");
    }
    setBusy(false);
  };

  const apple = () =>
    run(async () => {
      await script("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
      window.AppleID!.auth.init({ clientId: cfg!.apple, scope: "name email", redirectURI: location.origin, usePopup: true });
      const r = await window.AppleID!.auth.signIn();
      // Apple only sends the name the very first time someone signs in
      const n = [r.user?.name?.firstName, r.user?.name?.lastName].filter(Boolean).join(" ");
      await act((b) => b.oauth("apple", r.authorization.id_token, n || undefined));
    });

  const google = () =>
    run(async () => {
      await script("https://accounts.google.com/gsi/client");
      await new Promise<void>((res) => {
        window.google!.accounts.id.initialize({
          client_id: cfg!.google,
          callback: async (r: { credential: string }) => {
            await act((b) => b.oauth("google", r.credential));
            res();
          },
        });
        window.google!.accounts.id.prompt();
      });
    });

  const facebook = () =>
    run(async () => {
      await script("https://connect.facebook.net/en_US/sdk.js");
      window.FB!.init({ appId: cfg!.facebook, version: "v19.0", cookie: false, xfbml: false });
      const token = await new Promise<string>((res, rej) => window.FB!.login((r) => (r.authResponse ? res(r.authResponse.accessToken) : rej(new Error("Facebook sign-in was cancelled"))), { scope: "public_profile,email" }));
      await act((b) => b.oauth("facebook", token));
    });

  if (backend?.kind !== "server")
    return (
      <div className="acct-signin">
        <h3>Save your career to an account</h3>
        <div className="acct-provider-row">
          <button className="acct-provider apple" disabled>
            Sign in with Apple
          </button>
          <button className="acct-provider google" disabled>
            Sign in with Google
          </button>
          <button className="acct-provider facebook" disabled>
            Continue with Facebook
          </button>
        </div>
        <div className="dim">Accounts turn on when the game server is live. Until then your level, coins and stats are saved in this browser.</div>
      </div>
    );

  return (
    <div className="acct-signin">
      <h3>Save your career to an account</h3>
      <div className="dim">Keep your level, coins, items and stats on every device. Everything you've earned as a guest comes with you.</div>
      {(has("apple") || has("google") || has("facebook")) && (
        <div className="acct-provider-row">
          {has("apple") && (
            <button className="acct-provider apple" disabled={busy} onClick={apple}>
              Sign in with Apple
            </button>
          )}
          {has("google") && (
            <button className="acct-provider google" disabled={busy} onClick={google}>
              Sign in with Google
            </button>
          )}
          {has("facebook") && (
            <button className="acct-provider facebook" disabled={busy} onClick={facebook}>
              Continue with Facebook
            </button>
          )}
        </div>
      )}
      <form
        className="acct-email"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => act((b) => (mode === "register" ? b.register(email, password, name) : b.login(email, password))));
        }}
      >
        <div className="seg">
          <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>
            Create account
          </button>
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            I have one
          </button>
        </div>
        <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : 1} />
        {mode === "register" && <input placeholder="Display name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />}
        <button className="btn primary big" disabled={busy}>
          {mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
      {has("dev") && (
        <form
          className="acct-email"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => act((b) => b.dev(name)));
          }}
        >
          <div className="dim">Test server: sign in with just a name.</div>
          <input placeholder="Name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={busy || !name.trim()}>
            Test sign-in
          </button>
        </form>
      )}
      {note && <div className="acct-note">{note}</div>}
    </div>
  );
}
