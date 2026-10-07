// Player preferences kept in this browser: motion, tips, walkthrough progress.
// Sound settings live in sound.ts. Every read and write tolerates blocked storage.
import { useSyncExternalStore } from "react";

export type MotionPref = "system" | "reduce" | "full";
export type Theme = "classic" | "vault" | "neon";

export const THEMES: { id: Theme; name: string; felt: string; rail: string }[] = [
  { id: "classic", name: "Classic", felt: "#0f5a3c", rail: "#5b3a1e" },
  { id: "vault", name: "Vault", felt: "#263040", rail: "#8d939c" },
  { id: "neon", name: "Neon Vegas", felt: "#22104a", rail: "#ff3fb4" },
];

export interface Prefs {
  motion: MotionPref;
  theme: Theme;
  tips: boolean;
  /** The first-game walkthrough has been shown. */
  walked: boolean;
  /** Coach tips already shown, by key. */
  seen: string[];
}

const KEY = "heist.prefs";
const DEFAULTS: Prefs = { motion: "system", theme: "classic", tips: true, walked: false, seen: [] };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();
const subs = new Set<() => void>();

export function getPrefs() {
  return prefs;
}

export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked: lasts for this visit */
  }
  subs.forEach((f) => f());
}

export function markSeen(k: string) {
  if (!prefs.seen.includes(k)) setPrefs({ seen: [...prefs.seen, k] });
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function usePrefs() {
  return useSyncExternalStore(subscribe, getPrefs);
}

const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/** True when animations should be cut down (player setting, or the system setting when left on "system"). */
export function reducedMotion(p: Prefs = prefs) {
  return p.motion === "reduce" || (p.motion === "system" && !!mq?.matches);
}

export function useReducedMotion() {
  const p = usePrefs();
  return reducedMotion(p);
}
