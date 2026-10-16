// Create an account or sign in: Apple, Google, Facebook (each shown once the server has its settings),
// email and password, or a name-only test login on development servers. A guest who signs up keeps
// everything they've earned so far.

import { useState } from "react";
import { useAccount } from "./useAccount";
import { t, tEn, tNodes } from "../i18n";

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
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in didn't work";
      setNote(tEn(msg));
      // the email already has an account: flip to signing in, keeping what they typed
      if (/sign in instead/i.test(msg)) setMode("login");
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
      const token = await new Promise<string>((res, rej) => window.FB!.login((r) => (r.authResponse ? res(r.authResponse.accessToken) : rej(new Error(t("signin.fbCancelled")))), { scope: "public_profile,email" }));
      await act((b) => b.oauth("facebook", token));
    });

  if (backend?.kind !== "server")
    return (
      <div className="acct-signin">
        <h3>{t("signin.title")}</h3>
        <div className="dim">{t("signin.offline")}</div>
      </div>
    );

  return (
    <div className="acct-signin">
      <h3>{t("signin.title")}</h3>
      <div className="dim">{t("signin.sub")}</div>
      {(has("apple") || has("google") || has("facebook")) && (
        <div className="acct-provider-row">
          {has("apple") && (
            <button className="acct-provider apple" disabled={busy} onClick={apple}>
              {t("signin.apple")}
            </button>
          )}
          {has("google") && (
            <button className="acct-provider google" disabled={busy} onClick={google}>
              {t("signin.google")}
            </button>
          )}
          {has("facebook") && (
            <button className="acct-provider facebook" disabled={busy} onClick={facebook}>
              {t("signin.facebook")}
            </button>
          )}
        </div>
      )}
      <form
        className="acct-email"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => act((b) => (mode === "register" ? b.register(email, password, name) : b.login(email, password)), { inline: true }));
        }}
      >
        <div className="seg">
          <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>
            {t("signin.create")}
          </button>
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            {t("signin.haveOne")}
          </button>
        </div>
        <input type="email" name="email" autoComplete="username" placeholder={t("signin.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div className="acct-pw">
          <input type={show ? "text" : "password"} name="password" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? t("signin.pwNew") : t("signin.pw")} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : 1} />
          <button type="button" className="acct-pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? t("signin.hidePw") : t("signin.showPw")}>
            {show ? t("signin.hide") : t("signin.show")}
          </button>
        </div>
        {mode === "register" && <input placeholder={t("signin.displayName")} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />}
        <button className="btn primary big" disabled={busy}>
          {mode === "register" ? t("signin.create") : t("signin.signIn")}
        </button>
        {mode === "register" && (
          <div className="dim acct-privacy">
            {tNodes("signin.privacy", {
              link: (
                <a href="./privacy.html" target="_blank" rel="noreferrer">
                  {t("signin.privacyLink")}
                </a>
              ),
            })}
          </div>
        )}
        {mode === "login" && (
          <button type="button" className="acct-link" onClick={() => setForgot((v) => !v)}>
            {t("signin.forgot")}
          </button>
        )}
        {mode === "login" && forgot && (
          <div className="dim acct-forgot">
            {t("signin.forgotText")}
          </div>
        )}
      </form>
      {has("dev") && (
        <form
          className="acct-email"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => act((b) => b.dev(name), { inline: true }));
          }}
        >
          <div className="dim">{t("signin.dev")}</div>
          <input placeholder={t("signin.name")} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={busy || !name.trim()}>
            {t("signin.devBtn")}

          </button>
        </form>
      )}
      {note && <div className="acct-note">{note}</div>}
    </div>
  );
}
