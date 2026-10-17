// Heist on CrazyGames (crazygames.com), through their HTML5 SDK v3. See docs/CRAZYGAMES.md.
//
// The SDK only loads when Heist runs on CrazyGames: the dedicated build (`vite build --mode crazygames`),
// a page served from a crazygames.com host, or a frame inside one (their portal, or ?cg=1 for testing in
// their preview tool or on localhost). Visiting playheist.net never loads it. Off CrazyGames every export
// here does nothing, so callers don't check.
//
// What it does there: loading and gameplay events around real play (tables and solo games), happytime on
// a win, their mute and chat settings, the CrazyGames account (linked to a Heist guest account on the
// server, see backend.ts), invite links through their portal, and a midgame ad between games only when
// VITE_CG_MIDGAME_ADS=1 (Heist sells nothing; ads are off unless the owner turns them on).
import { useEffect, useSyncExternalStore } from "react";
import { onWin, setHostMuted } from "./sound";

type CgEnv = "local" | "crazygames" | "disabled";
export interface CgUser {
  username: string;
  profilePictureUrl?: string;
}
interface CgSettings {
  muteAudio?: boolean;
  disableChat?: boolean;
}
interface CgSdk {
  init(): Promise<void>;
  environment: CgEnv;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: CgSettings;
    addSettingsChangeListener?(f: (s: CgSettings) => void): void;
    inviteLink?(params: Record<string, string>): string;
    getInviteParam?(name: string): string | null;
  };
  user?: {
    isUserAccountAvailable?: boolean;
    getUser(): Promise<CgUser | null>;
    getUserToken(): Promise<string>;
    showAuthPrompt(): Promise<CgUser | null>;
    addAuthListener?(f: (u: CgUser | null) => void): void;
  };
  ad?: {
    requestAd(type: "midgame" | "rewarded", cb: { adStarted?(): void; adFinished?(): void; adError?(e: unknown): void }): void;
  };
}
declare global {
  interface Window {
    CrazyGames?: { SDK: CgSdk };
  }
}

const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const MIDGAME_ADS = import.meta.env.VITE_CG_MIDGAME_ADS === "1";
/** the shortest gap between two midgame ads */
const AD_GAP_MS = 3 * 60_000;

const cgHost = (h: string) => h === "crazygames.com" || h.endsWith(".crazygames.com");
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

function detect(): boolean {
  if (import.meta.env.MODE === "crazygames") return true;
  if (typeof window === "undefined") return false;
  try {
    if (cgHost(location.hostname)) return true;
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      /* a cross-origin parent: framed */
    }
    const param = new URLSearchParams(location.search).get("cg") === "1";
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (param && local) return true;
    if (!framed) return false;
    const ancestors = Array.from(location.ancestorOrigins ?? []);
    return param || ancestors.some((o) => cgHost(hostOf(o))) || cgHost(hostOf(document.referrer));
  } catch {
    return false;
  }
}

/** Running on CrazyGames (decided once, at start-up). */
export const onCrazyGames = detect();

let sdk: CgSdk | null = null;
/** the SDK is up and talking to the portal (or its local test mode) */
const live = () => !!sdk && sdk.environment !== "disabled";
const safe = (f: () => void) => {
  try {
    if (live()) f();
  } catch {
    /* the portal said no; the game plays on */
  }
};

let chatOff = false;
const chatSubs = new Set<() => void>();
/** CrazyGames asked for chat to be off (their per-player setting): the Lounge and table chat hide. */
export const crazyGamesChatOff = () => chatOff;
function onCrazyGamesChat(f: () => void) {
  chatSubs.add(f);
  return () => void chatSubs.delete(f);
}
/** crazyGamesChatOff, kept current */
export const useCrazyGamesChatOff = () => useSyncExternalStore(onCrazyGamesChat, crazyGamesChatOff, () => false);

function applySettings(s: CgSettings | undefined) {
  if (!s) return;
  setHostMuted(!!s.muteAudio || adPlaying);
  if (!!s.disableChat !== chatOff) {
    chatOff = !!s.disableChat;
    chatSubs.forEach((f) => f());
  }
}

function loadScript(): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => fail(new Error("CrazyGames SDK didn't load"));
    document.head.appendChild(s);
  });
}

// the query parameters Heist reads at start-up (an invite through the portal brings them as invite params)
const LINK_PARAMS = ["game", "table", "join", "joinErs", "pvp", "daily", "dailyGame", "seed", "challenge", "ctime", "cmoves", "cscore", "level", "arcade", "friends", "chat"];

/** The address the game was opened at: on CrazyGames the app never moves off it (see pinPath). */
const entry = typeof location === "undefined" ? "/" : location.pathname;

/** history.replaceState as the browser has it, before pinPath */
const rawReplace = typeof history === "undefined" ? () => {} : history.replaceState.bind(history);

/**
 * Heist names its screens in the address (/solitaire, /card-games). On CrazyGames the game is a file in
 * their storage, so the address must stay on that file: anything after a reload or a relative link
 * (the table music) would miss. The screen goes in ?game= instead (see startPath).
 */
function pinPath() {
  for (const k of ["replaceState", "pushState"] as const) {
    const orig = history[k].bind(history);
    history[k] = (data: unknown, unused: string, url?: string | URL | null) => {
      if (url == null) return orig(data, unused, url);
      const u = new URL(String(url), location.href);
      // "/" is always the lobby (also when the game file sits at the root)
      if (u.origin === location.origin && (u.pathname !== entry || u.pathname === "/")) {
        const game = u.pathname.replace(/^\/+|\/+$/g, "");
        u.pathname = entry;
        if (game) u.searchParams.set("game", game);
        else u.searchParams.delete("game");
      }
      return orig(data, unused, u.href);
    };
  }
}

/** Load and start the SDK (on CrazyGames only). The app waits for this before it draws, at most a few seconds. */
export async function startCrazyGames(): Promise<void> {
  if (!onCrazyGames) return;
  pinPath();
  try {
    await Promise.race([
      (async () => {
        if (!window.CrazyGames) await loadScript();
        const s = window.CrazyGames?.SDK;
        if (!s) return;
        await s.init();
        sdk = s;
      })(),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
  } catch {
    sdk = null;
  }
  if (!live()) return;
  safe(() => sdk!.game.loadingStart());
  // an invite through the portal: its params join the address, where the app reads them
  safe(() => {
    const q = new URLSearchParams(location.search);
    let added = false;
    for (const k of LINK_PARAMS) {
      const v = sdk!.game.getInviteParam?.(k);
      if (v != null && !q.has(k)) {
        q.set(k, v);
        added = true;
      }
    }
    if (added) rawReplace(null, "", `${entry}?${q}`);
  });
  safe(() => applySettings(sdk!.game.settings));
  safe(() => sdk!.game.addSettingsChangeListener?.((s) => applySettings(s)));
  onWin(happytime);
}

/** The screen the address names: /solitaire on playheist.net, ?game=solitaire on CrazyGames. */
export function startPath(): string {
  if (!onCrazyGames) return location.pathname;
  const g = new URLSearchParams(location.search).get("game");
  return g && /^[\w/-]{1,40}$/.test(g) ? `/${g}` : "/";
}

/**
 * Where to go for a path of the app ("/solitaire?seed=1"), in this tab. On CrazyGames it stays on the
 * game's file with the screen in ?game=.
 */
export function appUrl(path: string): string {
  if (!onCrazyGames) return path;
  const u = new URL(path, location.origin);
  const game = u.pathname.replace(/^\/+|\/+$/g, "");
  const q = new URLSearchParams(u.search);
  if (game) q.set("game", game);
  const s = q.toString();
  return `${entry}${s ? `?${s}` : ""}`;
}

/**
 * A link to share for a path of the app ("/solitaire?challenge=5"). On CrazyGames: their invite link to
 * the game on their portal, carrying the same parameters; elsewhere this site's own address.
 */
export function shareUrl(path: string): string {
  const u = new URL(path, location.origin);
  if (onCrazyGames && live() && sdk!.game.inviteLink) {
    try {
      const params: Record<string, string> = {};
      const game = u.pathname.replace(/^\/+|\/+$/g, "");
      if (game) params.game = game;
      u.searchParams.forEach((v, k) => (params[k] = v));
      return sdk!.game.inviteLink(params);
    } catch {
      /* fall through to this site's address */
    }
  }
  return onCrazyGames ? new URL(appUrl(path), location.origin).href : u.href;
}

let loaded = false;
/** The game is ready to play (the account has loaded): ends the portal's loading state, once. */
export function crazyGamesLoaded() {
  if (loaded) return;
  loaded = true;
  safe(() => sdk!.game.loadingStop());
}

// Gameplay: on while any table or solo game is up (several screens can say so at once)
const playing = new Set<symbol>();
let lastAd = Date.now();
let adPlaying = false;

function setPlaying(key: symbol, on: boolean) {
  const was = playing.size > 0;
  if (on) playing.add(key);
  else playing.delete(key);
  const now = playing.size > 0;
  if (now === was) return;
  if (now) safe(() => sdk!.game.gameplayStart());
  else {
    safe(() => sdk!.game.gameplayStop());
    midgameAd();
  }
}

/** Tell CrazyGames when real play is on screen: a table or a solo game (not the lobby or menus). */
export function useCrazyGamesPlay(on: boolean) {
  useEffect(() => {
    if (!onCrazyGames || !on) return;
    const key = Symbol("play");
    setPlaying(key, true);
    return () => setPlaying(key, false);
  }, [on]);
}

let lastHappy = 0;
/** A win: the portal's celebration (at most every few seconds; a win plays its sound more than once). */
export function happytime() {
  const now = Date.now();
  if (now - lastHappy < 5000) return;
  lastHappy = now;
  safe(() => sdk!.game.happytime());
}

/** Between games, when the owner turned midgame ads on: one ad, muted while it plays. */
function midgameAd() {
  if (!MIDGAME_ADS || !live() || !sdk!.ad || Date.now() - lastAd < AD_GAP_MS) return;
  lastAd = Date.now();
  const done = () => {
    adPlaying = false;
    applySettings(sdk!.game.settings ?? {});
  };
  safe(() =>
    sdk!.ad!.requestAd("midgame", {
      adStarted: () => {
        adPlaying = true;
        setHostMuted(true);
      },
      adFinished: done,
      adError: done,
    }),
  );
}

// ---- the CrazyGames account

/** Their sign-in exists here (it doesn't in every country or embed). */
export const crazyGamesAccounts = () => live() && !!sdk!.user?.isUserAccountAvailable;

/** the account still has to be matched to the CrazyGames player (once a visit, and again after a sign-in there) */
let needLink = true;
/** The server matched the account to the CrazyGames player: no need to ask again on every account refresh. */
export function crazyGamesLinked() {
  needLink = false;
}

/** The signed-in CrazyGames player's token for the server, or null (not on CrazyGames, or not signed in there). */
export async function crazyGamesToken(): Promise<string | null> {
  if (!crazyGamesAccounts() || !needLink) return null;
  try {
    const u = await sdk!.user!.getUser();
    return u ? await sdk!.user!.getUserToken() : null;
  } catch {
    return null;
  }
}

/** Their sign-in prompt (from Heist's account screen on CrazyGames). True if they signed in. */
export async function crazyGamesSignIn(): Promise<boolean> {
  if (!crazyGamesAccounts()) return false;
  try {
    const ok = !!(await sdk!.user!.showAuthPrompt());
    if (ok) needLink = true;
    return ok;
  } catch {
    return false;
  }
}

/** Calls f when the player signs in to CrazyGames while playing (signing out there reloads the page). */
export function onCrazyGamesSignIn(f: () => void) {
  if (!crazyGamesAccounts() || !sdk!.user!.addAuthListener) return () => {};
  let on = true;
  safe(() =>
    sdk!.user!.addAuthListener!((u) => {
      if (!on || !u) return;
      needLink = true;
      f();
    }),
  );
  return () => void (on = false);
}

/** Where a new guest came from, for the owner's admin panel: "cg" on CrazyGames. */
export const crazyGamesSource = () => (onCrazyGames ? "cg" : undefined);
