// Turn alerts: a phone notification when it's your turn at an online table (or someone sits down) while
// Heist is closed or in the background. Web push, so on iPhone it only works for Heist added to the Home
// Screen (iOS 16.4+); Android and desktop browsers work from a tab too. The player turns it on; we only ask
// at a moment it makes sense (waiting for a table), never on first load.
import { useEffect, useReducer } from "react";
import { isIOS, isStandalone } from "./appShell";
import { serverUrl } from "./online/session";

export type AlertState =
  /** this browser can't do push at all */
  | "unsupported"
  /** iPhone/iPad in a Safari tab: works once Heist is on the Home Screen */
  | "needs-install"
  | "off"
  | "on"
  /** the player said no to notifications: only the phone's settings can undo it */
  | "blocked";

const PREF = "heist.alerts";
const ASKED = "heist.alertsAsked";
const TOKEN_KEY = "heist.session";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked: lasts for this visit */
  }
};

const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

function canPush() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && import.meta.env.MODE !== "single";
}

export function alertState(): AlertState {
  if (!canPush()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && read(PREF) === "1" ? "on" : "off";
}

/** The alert state, kept current (also re-renders when the "asked already" mark changes). */
export function useAlertState() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    subs.add(bump);
    return () => void subs.delete(bump);
  }, []);
  return alertState();
}

/** The game server's address for API calls (the socket's address, over http). */
const apiBase = () => serverUrl().replace(/^ws/, "http").replace(/\/ws$/, "");

async function api(path: string, body: object) {
  const token = read(TOKEN_KEY);
  if (!token) throw new Error("Not signed in");
  const r = await fetch(apiBase() + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't save that");
}

async function serverKey(): Promise<string | null> {
  const r = await fetch(apiBase() + "/api/push/key").catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json()) as { key: string | null }).key;
}

const bytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Subscribe this browser and tell the server. Needs a tap (the permission prompt). */
export async function turnOnAlerts(): Promise<AlertState> {
  write(ASKED, "1");
  if (!canPush()) return alertState();
  const ok = await Notification.requestPermission();
  if (ok !== "granted") {
    changed();
    return alertState();
  }
  try {
    await subscribe();
    write(PREF, "1");
  } catch {
    write(PREF, "0");
  }
  changed();
  return alertState();
}

async function subscribe() {
  const key = await serverKey();
  if (!key) throw new Error("Turn alerts aren't set up on the server");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // a subscription made with another key (the server's keys changed) won't get our alerts
  const old = sub?.options.applicationServerKey;
  if (sub && old && new Uint8Array(old).join() !== bytes(key).join()) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) });
  await api("/api/push/subscribe", { sub: sub.toJSON() });
}

export async function turnOffAlerts() {
  write(PREF, "0");
  changed();
  if (!canPush()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await api("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* already gone */
  }
}

/** On start-up: alerts that were on get re-sent to the server (the subscription can change, or the account). */
export function syncAlerts() {
  if (alertState() !== "on") return;
  void subscribe().catch(() => {
    /* offline or signed out: next start tries again */
  });
}

/** Whether to show the "get a buzz on your turn?" card: alerts possible, off, and not asked before. */
export function shouldAskForAlerts() {
  return alertState() === "off" && read(ASKED) !== "1";
}

export function dismissAlertsAsk() {
  write(ASKED, "1");
  changed();
}
