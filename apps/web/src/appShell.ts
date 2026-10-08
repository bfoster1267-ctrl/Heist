// Home-screen app plumbing: offline service worker, no pinch zoom, safe areas, screen wake lock.
import { useEffect } from "react";

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Opened from the home screen rather than a browser tab. */
export const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;

export function installAppShell() {
  document.documentElement.classList.toggle("standalone", isStandalone());

  if (import.meta.env.PROD && import.meta.env.MODE !== "single" && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* offline play just won't be available */
      });
    });
  }

  // Safari ignores user-scalable=no; stop pinch zoom on the table directly.
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}

/** The notch and home-bar insets, in CSS px, read from env(safe-area-inset-*). */
export function safeInsets() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const v = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  probe.remove();
  return v;
}

/** Keep the phone from dimming and locking mid-game. */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!on || !wl) return;
    let lock: { release(): Promise<void> } | null = null;
    let live = true;
    const get = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((l) => {
          if (live) lock = l;
          else void l.release();
        })
        .catch(() => {
          /* not allowed right now (low power mode, no permission) */
        });
    };
    get();
    document.addEventListener("visibilitychange", get);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", get);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}
