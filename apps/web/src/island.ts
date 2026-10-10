// Quiet table music, and what the phone shows for it. On iPhone anything playing audio sits in the Dynamic
// Island (and on the lock screen) while you're in another app, the way a music app does: so with the music
// on, Heist stays up there with its icon and a line like "Your turn · Table K7QX". Android shows the same
// in its media notification. Off in Settings (or with Sound off), nothing plays and nothing shows.
import { useEffect, useRef } from "react";
import { getPrefs, usePrefs } from "./prefs";
import { getVolume, isMuted, onDuck, onSoundChange } from "./sound";

/** the music sits under the table sounds (the file itself is mixed quiet, as iPhones ignore volume here) */
const LEVEL = 0.6;

const TAP = ["touchend", "click", "keydown"] as const;

let el: HTMLAudioElement | null = null;
let loading: Promise<void> | null = null;
function audio() {
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.setAttribute("playsinline", "");
    // played from memory: iPhones won't play audio from a server (or the offline cache) that can't send byte
    // ranges, and a blob needs neither
    const a = el;
    loading = fetch("./table-music.m4a")
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => void (a.src = URL.createObjectURL(b)))
      .catch(() => {
        loading = null;
        el = null;
      });
  }
  return el;
}

const media = () => (typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null);

/**
 * While a table is open: play the music and keep the "now playing" line current.
 * `title` is the big line ("Your turn"), `place` the small one ("Table K7QX").
 */
export function useIsland(title: string, place: string) {
  const prefs = usePrefs();
  // the player paused it from the Dynamic Island or lock screen: leave it paused for this table
  const paused = useRef(false);
  const resync = useRef<() => void>(() => {});

  useEffect(() => {
    if (import.meta.env.MODE === "single") return;
    const a = audio();
    let live = true;
    let waitTap: (() => void) | null = null;
    const unwait = () => {
      if (waitTap) for (const e of TAP) window.removeEventListener(e, waitTap, true);
      waitTap = null;
    };
    const want = () => getPrefs().tableMusic && !isMuted() && !paused.current;
    // under a big sting the music dips, then eases back (computers and Android; iPhones ignore volume here)
    let ducked = 1;
    let easing = 0;
    const level = () => (a.volume = Math.min(1, getVolume() * LEVEL * ducked));
    const offDuck = onDuck((ms) => {
      ducked = 0.35;
      level();
      window.clearInterval(easing);
      const t0 = performance.now() + ms;
      easing = window.setInterval(() => {
        const k = (performance.now() - t0) / 600;
        if (k < 0) return;
        ducked = Math.min(1, 0.35 + 0.65 * k);
        level();
        if (ducked >= 1) window.clearInterval(easing);
      }, 50);
    });
    const sync = () => {
      level();
      if (!want()) return a.pause();
      if (!a.paused) return;
      if (!a.src) {
        // still loading: start when it's in
        void loading?.then(() => live && a.src && sync());
        return;
      }
      a.play().catch(() => {
        // phones only start audio from a tap: try again on the next one
        if (waitTap) return;
        waitTap = () => {
          unwait();
          if (want()) void a.play().catch(() => {});
        };
        // iPhones count a finished tap (not a touch going down) as permission to play
        for (const e of TAP) window.addEventListener(e, waitTap, true);
      });
    };
    resync.current = sync;
    sync();
    const off = onSoundChange(sync);
    const m = media();
    m?.setActionHandler("play", () => {
      paused.current = false;
      sync();
    });
    m?.setActionHandler("pause", () => {
      paused.current = true;
      a.pause();
    });
    for (const x of ["seekbackward", "seekforward", "previoustrack", "nexttrack"] as MediaSessionAction[]) {
      try {
        m?.setActionHandler(x, null);
      } catch {
        /* not supported here */
      }
    }
    return () => {
      live = false;
      off();
      offDuck();
      window.clearInterval(easing);
      unwait();
      a.pause();
      if (m) {
        m.metadata = null;
        m.setActionHandler("play", null);
        m.setActionHandler("pause", null);
      }
    };
  }, []);

  // the music setting itself
  useEffect(() => resync.current(), [prefs.tableMusic]);

  useEffect(() => {
    const m = media();
    if (!m || typeof MediaMetadata === "undefined") return;
    const icon = (s: number) => ({ src: new URL(`./icons/icon-${s}.png`, location.href).href, sizes: `${s}x${s}`, type: "image/png" });
    m.metadata = new MediaMetadata({ title, artist: place, album: "Heist", artwork: [icon(192), icon(512)] });
  }, [title, place]);
}
