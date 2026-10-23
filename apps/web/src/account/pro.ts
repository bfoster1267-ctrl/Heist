/**
 * Heist VIP Founder Pass state, storage, and checkout integration.
 */

import { purchase, purchaseRef } from "@heist/profile";
import { useSyncExternalStore } from "react";

export const HEIST_PRO_STRIPE_URL = "https://buy.stripe.com/cNicN42WW2Ta16V1fDf3a00";

export interface CoinBundle {
  id: string;
  /** the purchase in @heist/profile's PURCHASES this bundle sells */
  purchase: string;
  name: string;
  coins: number;
  chips: number;
  price: string;
  image: string;
  badge?: string;
  stripeUrl: string;
}

export const COIN_BUNDLES: CoinBundle[] = [
  {
    id: "bundle_starter",
    purchase: "starter",
    name: "Starter Stash",
    coins: purchase("starter")!.coins!,
    chips: purchase("starter")!.chips!,
    price: "$1.99",
    image: "/bundles/bundle_1.jpg",
    badge: "Popular",
    stripeUrl: "https://buy.stripe.com/6oUdR8btsfFWbLz0bzf3a07",
  },
  {
    id: "bundle_high_roller",
    purchase: "highroller",
    name: "High Roller Sack",
    coins: purchase("highroller")!.coins!,
    chips: purchase("highroller")!.chips!,
    price: "$4.99",
    image: "/bundles/bundle_2.jpg",
    badge: "Best Value",
    stripeUrl: "https://buy.stripe.com/eVqaEW2WW0L28zne2pf3a06",
  },
  {
    id: "bundle_vault",
    purchase: "vault",
    name: "Vault Master",
    coins: purchase("vault")!.coins!,
    chips: purchase("vault")!.chips!,
    price: "$9.99",
    image: "/bundles/bundle_3.jpg",
    badge: "Maximum",
    stripeUrl: "https://buy.stripe.com/9B6dR8bts65m8zn4rPf3a05",
  },
  {
    id: "bundle_kingpin",
    purchase: "kingpin",
    name: "Kingpin Safe",
    coins: purchase("kingpin")!.coins!,
    chips: purchase("kingpin")!.chips!,
    price: "$19.99",
    image: "/bundles/bundle_4.jpg",
    badge: "High Roller",
    stripeUrl: "https://buy.stripe.com/8x228qapo3Xe7vjaQdf3a03",
  },
  {
    id: "bundle_syndicate",
    purchase: "syndicate",
    name: "Syndicate Treasury",
    coins: purchase("syndicate")!.coins!,
    chips: purchase("syndicate")!.chips!,
    price: "$49.99",
    image: "/bundles/bundle_5.jpg",
    badge: "Whale Pack",
    stripeUrl: "https://buy.stripe.com/00wcN49lk65m02R8I5f3a02",
  },
  {
    id: "bundle_godfather",
    purchase: "godfather",
    name: "Godfather's Reserve",
    coins: purchase("godfather")!.coins!,
    chips: purchase("godfather")!.chips!,
    price: "$99.99",
    image: "/bundles/bundle_6.jpg",
    badge: "Ultimate",
    stripeUrl: "https://buy.stripe.com/dRmdR80OOeBS3f3cYlf3a08",
  },
];

/**
 * A Stripe Payment Link that tells Stripe which purchase and which account it's for, so the server's webhook
 * can credit the right player. Null while the server can't take payments yet (no Stripe keys) or offline.
 */
export function buyUrl(link: string, purchaseId: string, accountId: string | undefined, payments: boolean | undefined): string | null {
  if (!payments || !accountId) return null;
  return `${link}?client_reference_id=${encodeURIComponent(purchaseRef(purchaseId, accountId))}`;
}

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

export function getHeistProSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
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

// Cross-tab synchronization: notify listeners when another tab modifies pro status
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === SESSION_STORAGE_KEY) {
      LISTENERS.forEach((fn) => fn());
    }
  });
}

/**
 * Check URL parameters for successful Stripe return.
 * Strictly requires a Stripe Checkout session ID (cs_live_... / cs_test_...) provided by Stripe Payment Link redirect.
 * Only clears URL query parameters if the entitlement was successfully persisted to local storage.
 */
export function checkStripeProReturn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");

    const validSession = sessionId && /^cs_(live|test)_[a-zA-Z0-9_]{16,}$/.test(sessionId);

    if (validSession) {
      const persisted = setHeistPro(true, sessionId);
      if (persisted) {
        url.searchParams.delete("session_id");
        url.searchParams.delete("pro");
        url.searchParams.delete("vip");
        const cleanSearch = url.searchParams.toString();
        const cleanUrl = url.pathname + (cleanSearch ? `?${cleanSearch}` : "") + url.hash;
        window.history.replaceState({}, "", cleanUrl);
        return true;
      }
    }
  } catch {
    /* ignore URL parsing errors */
  }
  return false;
}
