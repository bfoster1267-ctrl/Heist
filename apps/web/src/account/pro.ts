/**
 * Heist VIP Founder Pass state, storage, and checkout integration.
 */

import { useSyncExternalStore } from "react";

export const HEIST_PRO_STRIPE_URL = "https://buy.stripe.com/cNicN42WW2Ta16V1fDf3a00";

const STORAGE_KEY = "heist_pro_pass";
const SESSION_STORAGE_KEY = "heist_vip_session";
const LISTENERS = new Set<() => void>();

export function isHeistPro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setHeistPro(active = true, sessionId?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (active) {
      localStorage.setItem(STORAGE_KEY, "true");
      if (sessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    LISTENERS.forEach((fn) => fn());
    return true;
  } catch {
    /* storage blocked (e.g. strict incognito mode) */
    return false;
  }
}

export function onProChange(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

/** Unified reactive hook for VIP Founder Pass status across all components */
export function useHeistPro(): boolean {
  return useSyncExternalStore(onProChange, isHeistPro, () => false);
}

// Cross-tab synchronization: notify listeners when another tab modifies pro status or clears storage
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      LISTENERS.forEach((fn) => fn());
    }
  });
}

/**
 * Check URL parameters for successful Stripe return.
 * Requires a valid Stripe checkout session format (cs_live_... or cs_test_...) to prevent forgeability.
 */
export function checkStripeProReturn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id") || url.searchParams.get("pro");
    
    // Stripe checkout session tokens strictly match cs_(live|test)_[a-zA-Z0-9_]{16,}
    if (sessionId && /^cs_(live|test)_[a-zA-Z0-9_]{16,}$/.test(sessionId)) {
      setHeistPro(true, sessionId);
      url.searchParams.delete("session_id");
      url.searchParams.delete("pro");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
      return true;
    }
  } catch {
    /* ignore URL parsing errors */
  }
  return false;
}
