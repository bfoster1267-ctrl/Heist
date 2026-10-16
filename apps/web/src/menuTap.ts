// The menus' tap: every button in the lobby and the screens over it (profile, season, rewards, friends,
// the Lounge, settings, the Daily hub) gives a soft tap and a light buzz. One listener on the document
// while a menu is up, so new buttons get it without wiring each one. The game screens are left alone:
// their cards and chips make their own sounds. Mute and the effects volume apply (see sound.ts), and
// buttons that already play `click` sound once (the two share a debounce).
import { buzz } from "./haptics";
import { tap } from "./sound";

const TAPPABLE = 'button, a[href], summary, select, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"]';

function onTap(e: MouseEvent) {
  const el = e.target instanceof Element ? e.target.closest(TAPPABLE) : null;
  // data-silent: a button with a sound of its own that shouldn't get a tap under it
  if (!el || el.closest("[data-silent]")) return;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
  tap();
  buzz("tap");
}

/** Tap sounds on for the menus; returns the switch-off. */
export function menuTaps() {
  // capture: runs before React's handlers, so a button that also calls click() is the one debounced
  document.addEventListener("click", onTap, true);
  return () => document.removeEventListener("click", onTap, true);
}
