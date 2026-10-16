// The screen that stands in front of the game when it was opened inside Instagram, Facebook or TikTok:
// open Heist in a real browser (their built-in browsers lose the account, can't install the app, and cramp
// the table). Reddit players play in Reddit's browser: an upright phone gets the table drawn sideways
// (see turn.ts), since Reddit's browser never rotates.
import { useState } from "react";
import { isIOS } from "./appShell";
import { t } from "./i18n";

/** The in-app browser Heist was opened in, or null for a real browser. */
export function inAppBrowser(ua = navigator.userAgent): string | null {
  if (/reddit/i.test(ua)) return "Reddit";
  if (/Instagram/.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/.test(ua)) return "Facebook";
  if (/TikTok|musical_ly|Bytedance|BytedanceWebview|trill_/i.test(ua)) return "TikTok";
  return null;
}

/** In-app browsers that get the open-in-browser screen. Reddit's plays fine, so it isn't one. */
export function gatedInApp(ua = navigator.userAgent): string | null {
  const app = inAppBrowser(ua);
  return app === "Reddit" ? null : app;
}

const OK_KEY = "heist.inappOk";

/** Let the player through anyway (this tab only), in case the check is wrong about their browser. */
export function inAppWaved() {
  try {
    return sessionStorage.getItem(OK_KEY) === "1";
  } catch {
    return false;
  }
}

export function OpenInBrowser({ app, onAnyway }: { app: string; onAnyway: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = location.href;
  const android = /Android/i.test(navigator.userAgent);
  const copy = () => {
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
  };
  // Android: an intent link hands the page to Chrome (or the default browser) straight from the app
  const intent = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  return (
    <div className="inapp" role="dialog" aria-label={t("gate.aria")}>
      <div className="logo">HEIST</div>
      <div className="gate-title">{t("gate.title")}</div>
      <div className="gate-text">{t("gate.text", { app })}</div>
      {android ? (
        <a className="btn primary" href={intent}>
          {t("gate.chrome")}
        </a>
      ) : (
        <ol className="inapp-steps">
          <li>
            {t("gate.tap")} <b>•••</b> {isIOS() ? t("gate.cornerShare", { app }) : t("gate.corner", { app })}
          </li>
          <li>
            {t("gate.pick")} <b>{isIOS() ? t("gate.safari") : t("gate.browser")}</b>.
          </li>
        </ol>
      )}
      <button className="btn" onClick={copy}>
        {copied ? t("gate.copied") : t("gate.copy")}
      </button>
      <button
        className="inapp-anyway"
        onClick={() => {
          try {
            sessionStorage.setItem(OK_KEY, "1");
          } catch {
            /* ignore */
          }
          onAnyway();
        }}
      >
        {t("gate.anyway")}

      </button>
    </div>
  );
}
