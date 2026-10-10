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
}

export interface FunnelPerson {
  person: string;
  /** the account to open in the player file */
  userId: string;
  name: string;
  first: number;
  last: number;
  step: string;
  turn: number | null;
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
}

interface Trail {
  ids: Set<string>;
  userId: string;
  name: string;
  first: number;
  last: number;
  lastWhat: string;
  newTap: boolean;
  lesson: boolean;
  coachedGames: Set<string>;
  turn: number;
  finished: boolean;
  games: number;
  online: boolean;
  back: boolean;
  signedUp: boolean;
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
export function buildFunnel(events: readonly ActivityEvent[], personOf: (userId: string) => string, from: number, to: number): Funnel {
  const sorted = [...events].filter((e) => e.userId).sort((a, b) => a.at - b.at);
  const trails = new Map<string, Trail>();
  let turnsSince: number | null = null;
  for (const e of sorted) {
    const p = personOf(e.userId!);
    let t = trails.get(p);
    if (!t) {
      t = { ids: new Set(), userId: e.userId!, name: e.name ?? "", first: e.at, last: e.at, lastWhat: what(e), newTap: false, lesson: false, coachedGames: new Set(), turn: 0, finished: false, games: 0, online: false, back: false, signedUp: false };
      trails.set(p, t);
    }
    t.ids.add(e.userId!);
    if (e.name) t.name = e.name;
    t.last = e.at;
    // the API's own calls (config, /me) say little; taps, screens and game steps say where they were
    if (e.kind.startsWith("ui.") || e.kind.startsWith("solo.") || e.kind.startsWith("game.") || e.kind.startsWith("table.") || e.kind.startsWith("auth.")) t.lastWhat = what(e);
    if (e.at - t.first >= RETURN_AFTER) t.back = true;
    const d = (e.data ?? {}) as Record<string, unknown>;
    const ok = e.ok !== false;
    switch (e.kind) {
      case "ui.tap":
        if (d.name === "welcome-new" || (typeof d.name === "string" && d.name.startsWith("I'm new"))) t.newTap = true;
        break;
      case "ui.turn":
        turnsSince ??= e.at;
        if (d.coached === true && typeof d.turn === "number") t.turn = Math.max(t.turn, d.turn);
        break;
      case "solo.start":
        if (!ok) break;
        t.games++;
        if (d.coached === true) {
          t.lesson = true;
          if (typeof d.gameId === "string") t.coachedGames.add(d.gameId);
        }
        break;
      case "game.solo":
        if (d.coached === true && d.quit === false) t.finished = true;
        break;
      case "game.online":
        t.online = true;
        break;
      case "auth.register":
      case "auth.oauth":
        if (ok) t.signedUp = true;
        break;
    }
  }

  const fresh = [...trails.entries()].filter(([, t]) => t.first >= from && t.first < to);
  const maxTurn = Math.max(0, ...fresh.map(([, t]) => t.turn));
  const turns = TURNS.filter((n) => n <= maxTurn);
  const defs: { key: string; label: string; note: string; did: (t: Trail) => boolean }[] = [
    { key: "visit", label: "Opened the site", note: "any visit", did: () => true },
    { key: "new", label: "Tapped I'm new", note: "on the first-visit welcome", did: (t) => t.newTap },
    { key: "lesson", label: "Started the coached game", note: "Learn to play", did: (t) => t.lesson },
    ...turns.map((n) => ({ key: `turn${n}`, label: `Reached turn ${n}`, note: "of the coached game", did: (t: Trail) => t.turn >= n })),
    { key: "finish", label: "Finished the coached game", note: "played it to the end", did: (t) => t.finished },
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
      .map(({ p, t, k }) => ({ person: p, userId: t.userId, name: t.name, first: t.first, last: t.last, step: defs[k].label, turn: t.turn || null })),
  };
}
