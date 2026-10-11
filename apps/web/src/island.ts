// Quiet table music, and what the phone shows for it. On iPhone anything playing audio sits in the Dynamic
// Island (and on the lock screen) while you're in another app, the way a music app does: so with the music
// on, Heist stays up there with its icon and a line like "Your turn · Table K7QX". Android shows the same
// in its media notification. Off in Settings (or with Sound off), nothing plays and nothing shows.
import { useEffect, useRef } from "react";
import { getPrefs, usePrefs } from "./prefs";
import { getMusicVolume, isMuted, onDuck, onSoundChange } from "./sound";

/**
 * Settings > Music at full plays the file this much louder than it's mixed. iPhones ignore an audio
 * element's volume, so the level is baked into the audio itself: the track is decoded once and replayed
 * from a copy scaled to the slider.
 */
const BOOST = 1.6;

const TAP = ["touchend", "click", "keydown"] as const;

let el: HTMLAudioElement | null = null;
let loading: Promise<void> | null = null;
/** the file as it came (used if this browser can't decode it for us) */
let raw = "";
let pcm: { data: Float32Array; rate: number } | null = null;
let baked = -1;
function audio() {
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.setAttribute("playsinline", "");
    // played from memory: iPhones won't play audio from a server (or the offline cache) that can't send byte
    // ranges, and a blob needs neither
    const a = el;
    loading = fetch("./table-music.m4a")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(async (buf) => {
        raw = URL.createObjectURL(new Blob([buf], { type: "audio/mp4" }));
        try {
          const d = await new OfflineAudioContext(1, 1, 32000).decodeAudioData(buf.slice(0));
          pcm = { data: d.getChannelData(0), rate: d.sampleRate };
        } catch {
          pcm = null;
        }
        bake(a);
      })
      .catch(() => {
        loading = null;
        el = null;
      });
  }
  return el;
}

/** the track as a 16-bit WAV at `gain` */
function wav(p: { data: Float32Array; rate: number }, gain: number) {
  const n = p.data.length;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, x: string) => [...x].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  b.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, p.rate, true);
  b.setUint32(28, p.rate * 2, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  str(36, "data");
  b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, p.data[i] * gain)) * 32767, true);
  return URL.createObjectURL(new Blob([b.buffer], { type: "audio/wav" }));
}

/** put the music at the Settings level, picking up where it was */
function bake(a: HTMLAudioElement) {
  if (!pcm) {
    if (!a.src && raw) a.src = raw;
    return;
  }
  const g = Math.round(getMusicVolume() * 20) / 20;
  if (g === baked || g === 0) return;
  baked = g;
  const t = a.currentTime;
  const playing = !a.paused;
  const old = a.src;
  a.src = wav(pcm, g * BOOST);
  if (old && old !== raw) URL.revokeObjectURL(old);
  if (t) a.addEventListener("loadedmetadata", () => (a.currentTime = t), { once: true });
  if (playing) void a.play().catch(() => {});
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
    const want = () => getPrefs().tableMusic && getMusicVolume() > 0 && !isMuted() && !paused.current;
    // under a big sting the music dips, then eases back (computers and Android; iPhones ignore volume here)
    let ducked = 1;
    let easing = 0;
    const level = () => (a.volume = ducked);
    // the Music slider: re-bake once it settles, not on every step of the drag
    let rebake = 0;
    const offLevel = onSoundChange(() => {
      window.clearTimeout(rebake);
      rebake = window.setTimeout(() => {
        bake(a);
        sync();
      }, 250);
    });
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
      offLevel();
      window.clearInterval(easing);
      window.clearTimeout(rebake);
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
