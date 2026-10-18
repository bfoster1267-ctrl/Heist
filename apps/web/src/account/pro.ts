/**
 * Heist Pro Pass state, storage, and checkout integration.
 */

export const HEIST_PRO_STRIPE_URL = "https://buy.stripe.com/cNicN42WW2Ta16V1fDf3a00";

const STORAGE_KEY = "heist_pro_pass";
const LISTENERS = new Set<(isPro: boolean) => void>();

export function isHeistPro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setHeistPro(active = true): void {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      localStorage.setItem(STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore storage errors */
  }
  LISTENERS.forEach((fn) => fn(active));
}

export function onProChange(listener: (isPro: boolean) => void): () => void {
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

/** Check URL parameters for successful Stripe return (?pro=success) */
export function checkStripeProReturn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("pro") === "success" || url.searchParams.get("pro") === "activated") {
      setHeistPro(true);
      // clean param from URL without page reload
      url.searchParams.delete("pro");
      window.history.replaceState({}, "", url.toString());
      return true;
    }
  } catch {
    /* ignore URL errors */
  }
  return false;
}
