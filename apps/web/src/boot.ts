// Tells the game server how far a NEW visitor's page got while starting up: the code ran, the page was
// actually on screen, the server answered, the guest account was made, or what broke. Ad clicks from the
// Facebook app run the code but never make a guest, and this says where they stop. Visitors who already
// have an account send nothing (the activity log has them). A handful of small calls per visit at most.

import { deviceId } from "./device";

const set = import.meta.env.VITE_SERVER_URL as string | undefined;
const base = set === "same-origin" ? "" : set?.replace(/\/$/, "");
const TOKEN_KEY = "heist.session";
const MAX = 10;

type Step = "js" | "shown" | "server" | "guest" | "error" | "leave";

function hasAccount() {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

// decided once, when the page starts: a guest made later in this visit keeps reporting until it leaves
const fresh = !hasAccount();
let sent = 0;
let guestDone = false;

const vis = () => (typeof document === "undefined" ? "" : document.visibilityState);
const prerendering = () => (typeof document !== "undefined" && "prerendering" in document ? !!(document as { prerendering?: boolean }).prerendering : false);

export function bootStep(step: Step, extra: { ok?: boolean; err?: string } = {}) {
  if (base === undefined || !fresh || sent >= MAX) return;
  if (step === "guest") guestDone = true;
  sent++;
  void fetch(`${base}/api/boot`, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json", "x-heist-device": deviceId() },
    body: JSON.stringify({ step, ms: Math.round(performance.now()), vis: vis(), pre: prerendering(), ...extra }),
  }).catch(() => {});
}

/** Start reporting (main.tsx, first thing): the code ran; then on screen, crashes, and leaving before a guest. */
export function installBoot() {
  if (base === undefined || !fresh) return;
  bootStep("js");
  let shown = vis() === "visible" && !prerendering();
  if (!shown) {
    const check = () => {
      if (shown || vis() !== "visible" || prerendering()) return;
      shown = true;
      bootStep("shown");
    };
    document.addEventListener("visibilitychange", check);
    document.addEventListener("prerenderingchange", check);
  }
  let errors = 0;
  const report = (err: string) => errors++ < 3 && bootStep("error", { err });
  window.addEventListener("error", (e) => report(`${e.message || "error"} @${(e.filename || "").split("/").pop()}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => report(`rejected: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
  window.addEventListener("pagehide", () => !guestDone && bootStep("leave"));
}
