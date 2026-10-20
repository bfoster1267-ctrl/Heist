// Where new players drop off: each new person's furthest step, from the first visit through the coached
// lesson, a second game, coming back and signing up. Built from the activity log alone.
//
// A person counts at a step when they reached it or anything after it, so the counts only go down and the
// biggest fall between two steps is where most people leave.

import type { ActivityEvent } from "./activity";

const HOUR = 60 * 60_000;
/** "came back" means activity this long after the first visit */
export const RETURN_AFTER = 12 * HOUR;
/** the coached-game turns shown as their own steps (only up to the furthest anyone got) */
const TURNS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];

/** Where a new person came from, read off the guest account their first visit made. */
export type SourceKey = "ads" | "search" | "social" | "crazygames" | "direct" | "other" | "unknown";
export const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "ads", label: "Google Ads" },
  { key: "search", label: "Search" },
  { key: "social", label: "Social" },
  { key: "crazygames", label: "CrazyGames" },
  { key: "direct", label: "Direct" },
  { key: "other", label: "Other sites" },
  { key: "unknown", label: "Not recorded" },
];
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu)\./;
const SOCIAL = /(reddit|tiktok|facebook|instagram|youtube|discord|twitter|threads|linkedin|pinterest|snapchat)/;

/** a guest's sign-up event: the ad tags on their link first (an ad click's referrer is Google too), then the referring site */
export function sourceOf(e: ActivityEvent): SourceKey {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const land = (d.land ?? {}) as Record<string, unknown>;
  const medium = typeof land.utm_medium === "string" ? land.utm_medium.toLowerCase() : "";
  if (land.gclid || land.gbraid || land.wbraid || land.play !== undefined || /^(cpc|ppc|paid|paidsearch)$/.test(medium)) return "ads";
  if (d.src === "cg") return "crazygames";
  if (!e.ref) return "direct";
  let host = "";
  try {
    host = new URL(e.ref).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (host === "playheist.net" || host.endsWith(".playheist.net")) return "direct";
  if (SEARCH.test(host)) return "search";
  if (SOCIAL.test(host) || host === "t.co" || host === "x.com") return "social";
  if (host.includes("crazygames")) return "crazygames";
  return "other";
}

export interface FunnelPerson {
  person: string;
  /** the account to open in the player file */
  userId: string;
  name: string;
  first: number;
  last: number;
  step: string;
  stepKey?: string;
  turn: number | null;
  lastWhat?: string;
  recent?: string[];
  minutes?: number;
  /** where they came from (a SOURCES label) */
  source?: string;
}

export interface FunnelStep {
  key: string;
  label: string;
  /** what it means, in a few words */
  note: string;
  /** people who got at least this far */
  reached: number;
  /** people whose furthest step is this one */
  stopped: number;
  /** of those who stopped here: the middle time between their first and last event, in minutes */
  minutes: number | null;
  /** of those who stopped here: what they did last (a tap, a screen, or the kind of event) */
  last: { what: string; count: number }[];
  /** people whose furthest step is this one (newest first, up to 100) */
  people?: FunnelPerson[];
}

export interface Funnel {
  from: number;
  to: number;
  /** the oldest event the numbers can see (older history isn't read) */
  logStart: number | null;
  /** when turn-by-turn tracking began; before that, nobody shows a turn */
  turnsSince: number | null;
  people: number;
  steps: FunnelStep[];
  /** the step most people stop at (null when nobody stopped anywhere but the end) */
  worst: { step: string; label: string; stopped: number; of: number } | null;
  newest: FunnelPerson[];
  /** new people in range by where they came from (before the source filter), biggest first */
  sources: { key: SourceKey; label: string; people: number }[];
}

interface Trail {
  ids: Set<string>;
  userId: string;
  name: string;
  first: number;
  last: number;
  lastWhat: string;
  recent: string[];
  newTap: boolean;
  lesson: boolean;
  /** where they came from: set by the guest account their first visit made */
  source: SourceKey | null;
  /** tapped their player card when the lobby tour spotlit it (the tour's first stop) */
  tourCard: boolean;
  /** tapped through the lobby tour after the first hand (picked coaching or bots at the end) */
  toured: boolean;
  coachedGames: Set<string>;
  turn: number;
  finished: boolean;
  games: number;
  online: boolean;
  back: boolean;
  signedUp: boolean;
  arcadeStarted: boolean;
  arcadeWon: boolean;
  gameTypes: Set<string>;
}

const what = (e: ActivityEvent) => {
  const name = typeof e.data?.name === "string" ? e.data.name : "";
  if (e.kind === "ui.tap") return `Tapped "${name}"`;
  if (e.kind === "ui.screen") return `Looking at ${name}`;
  if (e.kind === "ui.turn") return `Turn ${e.data?.turn ?? "?"} of a game`;
  return e.kind;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * events: every player event the log holds (any order); the owner's and Claude's already left out.
 * personOf: which person an account belongs to (several accounts can be one person).
 * People count when their first event falls in [from, to).
 */
export function buildFunnel(events: readonly ActivityEvent[], personOf: (userId: string) => string, from: number, to: number, gameFilter?: string, sourceFilter?: string): Funnel {
  const sorted = [...events].filter((e) => e.userId).sort((a, b) => a.at - b.at);
  const trails = new Map<string, Trail>();
  let turnsSince: number | null = null;
  for (const e of sorted) {
    const p = personOf(e.userId!);
    let t = trails.get(p);
    if (!t) {
      t = {
        ids: new Set(), userId: e.userId!, name: e.name ?? "", first: e.at, last: e.at, lastWhat: what(e),
        recent: [],
        newTap: false, lesson: false, source: null, tourCard: false, toured: false, coachedGames: new Set(), turn: 0, finished: false,
        games: 0, online: false, back: false, signedUp: false, arcadeStarted: false, arcadeWon: false,
        gameTypes: new Set(),
      };
      trails.set(p, t);
    }
    t.ids.add(e.userId!);
    if (e.name) t.name = e.name;
    t.last = e.at;
    // the API's own calls (config, /me) say little; taps, screens and game steps say where they were
    if (e.kind !== "ui.ping" && (e.kind.startsWith("ui.") || e.kind.startsWith("solo.") || e.kind.startsWith("game.") || e.kind.startsWith("table.") || e.kind.startsWith("auth.") || e.kind.startsWith("solitaire.") || e.kind.startsWith("freecell.") || e.kind.startsWith("spider.") || e.kind.startsWith("tripeaks.") || e.kind.startsWith("pyramid.") || e.kind.startsWith("ers.") || e.kind.startsWith("yukon.") || e.kind.startsWith("scoundrel.") || e.kind.startsWith("checkers.") || e.kind.startsWith("hearts.") || e.kind.startsWith("spades.") || e.kind.startsWith("minesweeper.") || e.kind.startsWith("sudoku."))) {
      const act = what(e);
      t.lastWhat = act;
      if (t.recent[t.recent.length - 1] !== act) {
        t.recent.push(act);
        if (t.recent.length > 5) t.recent.shift();
      }
    }
    if (e.at - t.first >= RETURN_AFTER) t.back = true;
    const d = (e.data ?? {}) as Record<string, unknown>;
    const ok = e.ok !== false;
    switch (e.kind) {
      case "ui.tap":
        if (d.name === "welcome-new" || (typeof d.name === "string" && d.name.startsWith("I'm new"))) t.newTap = true;
        if (d.name === "tour-profile") t.tourCard = true;
        if (d.name === "tour-coach" || d.name === "tour-bots" || d.name === "tour-save" || d.name === "tour-lobby") t.toured = true;
        break;
      case "auth.guest":
        if (ok && !t.source) t.source = sourceOf(e);
        break;
      case "ui.turn":
        turnsSince ??= e.at;
        if (d.coached === true && typeof d.turn === "number") t.turn = Math.max(t.turn, d.turn);
        break;
      case "solo.start":
        if (!ok) break;
        t.games++;
        t.gameTypes.add("heist_solo");
        if (d.coached === true) {
          t.lesson = true;
          if (typeof d.gameId === "string") t.coachedGames.add(d.gameId);
        }
        break;
      case "game.solo":
        t.gameTypes.add("heist_solo");
        if (d.coached === true && d.quit === false) t.finished = true;
        break;
      case "game.online":
        t.online = true;
        t.gameTypes.add("heist_online");
        break;
      case "auth.register":
      case "auth.oauth":
        if (ok) t.signedUp = true;
        break;
      case "solitaire.start":
      case "freecell.start":
      case "spider.start":
      case "tripeaks.start":
      case "pyramid.start":
      case "ers.start":
      case "yukon.start":
      case "scoundrel.start":
      case "minesweeper.start":
      case "sudoku.start":
      case "checkers.start":
      case "hearts.start":
      case "spades.start":
        if (!ok) break;
        t.games++;
        t.arcadeStarted = true;
        t.gameTypes.add(e.kind.split(".")[0]);
        break;
      case "solitaire.finish":
      case "freecell.finish":
      case "spider.finish":
      case "tripeaks.finish":
      case "pyramid.finish":
      case "ers.finish":
      case "yukon.finish":
      case "scoundrel.finish":
      case "minesweeper.finish":
      case "sudoku.finish":
      case "checkers.finish":
      case "hearts.finish":
      case "spades.finish":
        t.arcadeWon = true;
        t.finished = true;
        t.gameTypes.add(e.kind.split(".")[0]);
        break;
      case "solitaire.bank":
      case "freecell.bank":
      case "spider.bank":
      case "tripeaks.bank":
      case "pyramid.bank":
      case "ers.bank":
      case "yukon.bank":
      case "scoundrel.bank":
      case "minesweeper.bank":
      case "sudoku.bank":
      case "checkers.bank":
      case "hearts.bank":
      case "spades.bank":
        t.arcadeStarted = true;
        t.gameTypes.add(e.kind.split(".")[0]);
        break;
    }
  }

  let fresh = [...trails.entries()].filter(([, t]) => t.first >= from && t.first < to);
  if (gameFilter) {
    if (gameFilter === "arcade") {
      fresh = fresh.filter(([, t]) => t.arcadeStarted);
    } else if (gameFilter === "heist") {
      fresh = fresh.filter(([, t]) => t.lesson || t.online || t.coachedGames.size > 0);
    } else if (gameFilter !== "all") {
      fresh = fresh.filter(([, t]) => t.gameTypes.has(gameFilter));
    }
  }

  const srcOf = (t: Trail): SourceKey => t.source ?? "unknown";
  const label = (k: SourceKey) => SOURCES.find((x) => x.key === k)!.label;
  const sources = SOURCES.map((x) => ({ ...x, people: fresh.filter(([, t]) => srcOf(t) === x.key).length }))
    .filter((x) => x.people > 0)
    .sort((a, b) => b.people - a.people);
  if (sourceFilter && sourceFilter !== "all") fresh = fresh.filter(([, t]) => srcOf(t) === sourceFilter);

  const maxTurn = Math.max(0, ...fresh.map(([, t]) => t.turn));
  const turns = TURNS.filter((n) => n <= maxTurn);
  const defs: { key: string; label: string; note: string; did: (t: Trail) => boolean }[] = [
    { key: "visit", label: "Opened the site", note: "any visit", did: () => true },
    // the welcome question went away 2026-10-11: new visitors now go straight into the first hand
    { key: "new", label: "Tapped I'm new", note: "first-visit welcome (now skipped: counts going straight in)", did: (t) => t.newTap || t.lesson || t.arcadeStarted },
    { key: "lesson", label: "Started a game", note: "Learn to play or card game deal", did: (t) => t.lesson || t.arcadeStarted },
    ...turns.map((n) => ({ key: `turn${n}`, label: `Reached turn ${n}`, note: "of the coached game", did: (t: Trail) => t.turn >= n })),
    { key: "finish", label: "Finished the game", note: "played it to the end", did: (t) => t.finished || t.arcadeWon },
    { key: "tourcard", label: "Opened their player card", note: "the lobby tour's first stop, which opens the Season pass", did: (t) => t.tourCard || t.toured },
    { key: "tour", label: "Picked what's next", note: "the tour's last card: more coaching, save progress, or the lobby", did: (t) => t.toured },
    { key: "again", label: "Played another game", note: "a second game of any kind", did: (t) => t.games >= 2 || t.online },
    { key: "back", label: "Came back later", note: "12+ hours after the first visit", did: (t) => t.back },
    { key: "signup", label: "Signed up", note: "made an account", did: (t) => t.signedUp },
  ];
  const furthest = (t: Trail) => {
    let k = 0;
    defs.forEach((s, i) => s.did(t) && (k = i));
    return k;
  };
  const at = fresh.map(([p, t]) => ({ p, t, k: furthest(t) }));
  const steps: FunnelStep[] = defs.map((s, i) => {
    const stop = at.filter((x) => x.k === i);
    const lasts = new Map<string, number>();
    for (const x of stop) lasts.set(x.t.lastWhat, (lasts.get(x.t.lastWhat) ?? 0) + 1);
    const mins = median(stop.map((x) => (x.t.last - x.t.first) / 60_000));
    return {
      key: s.key, label: s.label, note: s.note,
      reached: at.filter((x) => x.k >= i).length,
      stopped: stop.length,
      minutes: mins === null ? null : Math.round(mins * 10) / 10,
      last: [...lasts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, count]) => ({ what: w, count })),
      people: stop
        .sort((a, b) => b.t.last - a.t.last)
        .slice(0, 100)
        .map(({ p, t }) => ({
          person: p,
          userId: t.userId,
          name: t.name,
          first: t.first,
          last: t.last,
          step: s.label,
          stepKey: s.key,
          turn: t.turn || null,
          lastWhat: t.lastWhat,
          recent: t.recent.length ? t.recent : [t.lastWhat],
          minutes: Math.round(((t.last - t.first) / 60_000) * 10) / 10,
          source: label(srcOf(t)),
        })),
    };
  });
  // the last step is the finish line, not a drop
  let worst: Funnel["worst"] = null;
  for (const s of steps.slice(0, -1)) if (s.stopped > 0 && (!worst || s.stopped > worst.stopped)) worst = { step: s.key, label: s.label, stopped: s.stopped, of: at.length };
  return {
    from, to,
    logStart: sorted[0]?.at ?? null,
    turnsSince,
    people: at.length,
    steps,
    worst,
    newest: at
      .sort((a, b) => b.t.first - a.t.first)
      .slice(0, 100)
      .map(({ p, t, k }) => ({
        person: p,
        userId: t.userId,
        name: t.name,
        first: t.first,
        last: t.last,
        step: defs[k].label,
        stepKey: defs[k].key,
        turn: t.turn || null,
        lastWhat: t.lastWhat,
        recent: t.recent.length ? t.recent : [t.lastWhat],
        minutes: Math.round(((t.last - t.first) / 60_000) * 10) / 10,
        source: label(srcOf(t)),
      })),
    sources,
  };
}
