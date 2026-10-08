// Haptics. Android gets navigator.vibrate. iPhone Safari has no vibrate API, but since iOS 18 toggling
// a native switch control gives a light tap, so a hidden one is clicked for each buzz. iOS only does
// this inside a user gesture, so on iPhone the taps come with your own button presses.
import { getPrefs } from "./prefs";

let label: HTMLLabelElement | null = null;

function iosSwitch() {
  if (label) return label;
  label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

const PATTERNS = { tap: 8, bump: 18, win: [20, 60, 20, 60, 40], alert: [30, 40, 30] } as const;
export type Buzz = keyof typeof PATTERNS;

export function buzz(kind: Buzz = "tap") {
  if (!getPrefs().haptics) return;
  try {
    if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind] as number | number[]);
      return;
    }
    const l = iosSwitch();
    l.click();
    if (kind === "win" || kind === "alert") window.setTimeout(() => l.click(), 90);
  } catch {
    /* no haptics here */
  }
}
