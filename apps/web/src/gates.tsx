// Two screens that stand in front of the game on phones: turn the phone sideways, and open Heist in a
// real browser when it was opened inside Reddit, Instagram, Facebook or TikTok (their built-in browsers
// lose the account, can't install the app, and cramp the table).
import { useEffect, useState } from "react";
import { isIOS } from "./appShell";

/** The in-app browser Heist was opened in, or null for a real browser. */
export function inAppBrowser(ua = navigator.userAgent): string | null {
  if (/reddit/i.test(ua)) return "Reddit";
  if (/Instagram/.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/.test(ua)) return "Facebook";
  if (/TikTok|musical_ly|Bytedance|BytedanceWebview|trill_/i.test(ua)) return "TikTok";
  return null;
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
    <div className="inapp" role="dialog" aria-label="Open Heist in your browser">
      <div className="logo">HEIST</div>
      <div className="gate-title">Open in your browser</div>
      <div className="gate-text">{app}'s built-in browser can't run Heist properly. It takes two taps to fix:</div>
      {android ? (
        <a className="btn primary" href={intent}>
          Open in Chrome
        </a>
      ) : (
        <ol className="inapp-steps">
          <li>
            Tap <b>•••</b> {isIOS() ? "or the Share button " : ""}in the {app} corner.
          </li>
          <li>
            Pick <b>{isIOS() ? "Open in Safari" : "Open in browser"}</b>.
          </li>
        </ol>
      )}
      <button className="btn" onClick={copy}>
        {copied ? "Link copied. Paste it in your browser" : "Copy the link"}
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
        Already in your browser? Continue
      </button>
    </div>
  );
}

const PORTRAIT_PHONE = "(orientation: portrait) and (max-width: 760px) and (pointer: coarse)";

/** A phone held upright: menus work like that, but a table needs it on its side. */
export function portraitPhone() {
  try {
    return matchMedia(PORTRAIT_PHONE).matches;
  } catch {
    return false;
  }
}

/**
 * At a table on a phone turned upright: a "turn it back" screen over the table. CSS decides when it shows
 * (only while a table is open). The game carries on underneath, so turning the phone never leaves it.
 */
export function RotateGate() {
  return <Sideways text="The table needs the phone on its side. You're still in the game." />;
}

/** Asked before a game starts on an upright phone: the game opens once the phone is turned. */
export function TurnToPlay({ onReady, onCancel }: { onReady: () => void; onCancel: () => void }) {
  useEffect(() => {
    const m = matchMedia(PORTRAIT_PHONE);
    if (!m.matches) return onReady();
    const f = () => !m.matches && onReady();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [onReady]);
  return <Sideways asking text="Heist is played with the phone on its side, so the whole table fits. Your game starts when you turn it." onCancel={onCancel} />;
}

function Sideways({ text, asking, onCancel }: { text: string; asking?: boolean; onCancel?: () => void }) {
  const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  // Android can go full screen and lock sideways; iPhones can't, so they just turn the phone
  const canLock = !isIOS() && !!el.requestFullscreen && !!orient?.lock;
  return (
    <div className={"rotate-gate" + (asking ? " asking" : "")} role={asking ? "dialog" : undefined} aria-live="polite">
      <div className="rotate-phone" aria-hidden />
      <div className="gate-title">Turn your phone sideways</div>
      <div className="gate-text">{text}</div>
      {canLock && (
        <button
          className="btn primary big"
          onClick={() => {
            el.requestFullscreen!()
              .then(() => orient.lock!("landscape"))
              .catch(() => {
                /* not allowed here: turning the phone still works */
              });
          }}
        >
          Go full screen
        </button>
      )}
      {onCancel && (
        <button className="btn" onClick={onCancel}>
          Back to the menu
        </button>
      )}
    </div>
  );
}
