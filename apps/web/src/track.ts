// Tells the game server which screens the player opens and which buttons they tap, for the owner's
// activity log (see the privacy page). Only with a game server and a signed-in session; never what's
// typed into a field. Sent in small batches.

import { deviceId } from "./device";

const set = import.meta.env.VITE_SERVER_URL as string | undefined;
const base = set === "same-origin" ? "" : set?.replace(/\/$/, "");
const TOKEN_KEY = "heist.session";

interface Ev {
  kind: "screen" | "tap" | "turn";
  name: string;
  at: number;
  data?: Record<string, unknown>;
}

let queue: Ev[] = [];
let lastScreen = "";

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function flush(leaving = false) {
  if (base === undefined || !queue.length) return;
  const t = token();
  if (!t) {
    queue = [];
    return;
  }
  const events = queue.splice(0, 50);
  void fetch(`${base}/api/track`, {
    method: "POST",
    keepalive: leaving,
    headers: { "content-type": "application/json", authorization: `Bearer ${t}`, "x-heist-device": deviceId() },
    body: JSON.stringify({ events }),
  }).catch(() => {});
}

function add(e: Ev) {
  if (base === undefined) return;
  queue.push(e);
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  if (queue.length >= 40) flush();
}

/** The player is now looking at this screen. */
export function trackScreen(name: string) {
  if (name === lastScreen) return;
  lastScreen = name;
  add({ kind: "screen", name, at: Date.now() });
}

/** A new turn began in a game vs bots (the admin panel's drop-off funnel counts how far people get). */
export function trackTurn(turn: number, coached: boolean) {
  add({ kind: "turn", name: `Turn ${turn}`, at: Date.now(), data: { turn, coached } });
}

/** What a tapped control is called: its data-track, label or text. */
function nameOf(el: Element): string {
  const named = el.getAttribute("data-track") || el.getAttribute("aria-label") || el.getAttribute("title");
  const text = named || (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.slice(0, 60) || el.tagName.toLowerCase();
}

export function installTracking() {
  if (base === undefined) return;
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as Element | null)?.closest?.("button, a, [role=button], [data-track], select, input[type=checkbox], input[type=radio]");
      if (!el || el.closest("[data-no-track]")) return;
      add({ kind: "tap", name: nameOf(el), at: Date.now() });
    },
    { capture: true, passive: true },
  );
  window.setInterval(() => flush(), 10_000);
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush(true));
}
