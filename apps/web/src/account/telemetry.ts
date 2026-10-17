/**
 * Client-side conversion tracking for Google Ads and GA4.
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

export function trackSignUp(method: string, source = "web") {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "sign_up", {
        method,
        source,
      });
    }
  } catch {
    // blocked by privacy extensions or network errors
  }
}
