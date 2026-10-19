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
      // Google Ads Sign-up conversion event
      window.gtag("event", "conversion", {
        send_to: "AW-18515793903/5w9YCKje26EdEO-vgv1E",
        value: 1.0,
        currency: "USD",
      });
    }
  } catch {
    // blocked by privacy extensions or network errors
  }
}

export function trackGameComplete(game: string, result: "win" | "stuck" | "finish" = "win", duration?: number) {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "level_end", {
        level_name: game,
        success: result === "win",
        duration,
      });
      // Also emit custom micro-conversion event for Google Ads secondary goals
      window.gtag("event", "game_complete", {
        game,
        result,
      });
    }
  } catch {
    // ignore telemetry errors
  }
}

export function trackPwaInstall(platform: "ios" | "android" | "other" = "other") {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "pwa_install", {
        platform,
      });
    }
  } catch {
    // ignore telemetry errors
  }
}

