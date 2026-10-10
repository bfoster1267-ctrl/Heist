// Runs a solo table in the browser: the engine, bot fillers, and a frame queue the table plays back
// with pacing so every move can be seen. Online play will swap the engine for a server connection
// that sends the same Frames.
import { Bot, HeistGame, runBots, viewFor, type Answer, type Ask, type BotLevel, type Frame, type GameEvent, type GameState } from "@heist/engine";
import { createSoloGame } from "@heist/profile";
import { useCallback, useEffect, useRef, useState } from "react";
import { sfx, yourTurn } from "./sound";
import { trackTurn } from "./track";

export const HUMAN = 0;


/** How long each event holds the table, in ms at 1x speed. */
export const HOLD: Record<GameEvent["t"], number> = {
  setup: 700, role: 250, wildcard: 1300, turn: 900, draw: 450, reshuffle: 1000, lastCall: 1800, penReturn: 550,
  fence: 800, bank: 650, hire: 650, stuck: 1300, flip: 1300, mark: 1100, target: 900, send: 600, pass: 350,
  doubleCross: 1600, bet: 700, hackerCall: 1100, facedown: 550, reveal: 2600, hacked: 1600, forged: 1300,
  backup: 1100, result: 2200, fixerFixer: 1400, deal: 1300, toPen: 650, foothold: 1000, loot: 900, cut: 550,
  betPaid: 600, bust: 1100, bustResult: 1400, again: 800, discard: 450, gameOver: 600,
  // optional rules (engine RuleOptions): not switched on at this table yet
  bribe: 900, dealOffer: 1100, giveCards: 700, placeCrew: 500,
};

/** Events worth a big banner in the middle of the table. */
export const BANNER: Partial<Record<GameEvent["t"], true>> = {
  lastCall: true, doubleCross: true, hacked: true, result: true, fixerFixer: true, bustResult: true, wildcard: true, stuck: true,
};

export interface TableSettings {
  players: number;
  name: string;
  stakes: number;
  seed?: number;
  /** Coached play: a coach talks you through the game (free table, small XP, not in the career) */
  coached?: boolean;
  /** Coached play bots that go easy on you */
  gentle?: boolean;
  /** Coached play lesson (see lessons.ts in the profile package) */
  lesson?: number;
  /** each bot's level, from the account's solo ticket */
  levels?: BotLevel[];
  /** a campaign stage (sets the bots and rules) */
  stage?: number;
}

export interface Shown {
  state: GameState;
  msg: string;
  ev: GameEvent | null;
  key: number;
}

/** One line of the hand history, kept for the recap after the game. */
export interface HistoryEntry {
  turn: number;
  ev: GameEvent;
  msg: string;
  /** Footholds per seat after this event. */
  fh: number[];
  boss: number;
  mark: number | null;
}

export function footholds(s: GameState) {
  return s.players.map((p) => {
    let k = 0;
    for (const q of s.players) if (q.seat !== p.seat) for (const h of q.hideouts) if (h[p.seat] > 0) k++;
    return k;
  });
}

export type FlightHook = (ev: GameEvent, before: GameState, after: GameState) => number;

export function useTable(settings: TableSettings) {
  const ref = useRef<{ game: HeistGame; bots: Map<number, Bot>; queue: Frame[]; timer: number | null; answers: Answer[] } | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [log, setLog] = useState<{ msg: string; key: number }[]>([]);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  speedRef.current = speed;
  const flightHook = useRef<FlightHook | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const counter = useRef(0);
  const lastAsk = useRef(-1e9);
  const history = useRef<HistoryEntry[]>([]);
  // frame updates waiting on a flight animation, oldest first
  const late = useRef(new Map<number, () => void>());
  /** Cancel them; returns the newest, so Skip can show it at once instead. */
  const dropLate = () => {
    let newest: (() => void) | undefined;
    late.current.forEach((apply, id) => {
      clearTimeout(id);
      newest = apply;
    });
    late.current.clear();
    return newest;
  };
  const coached = useRef(false);
  coached.current = !!settings.coached;
  const record = (f: Frame) => {
    if (f.ev.t === "turn") trackTurn(f.state.turn + 1, coached.current);
    history.current.push({ turn: f.state.turn, ev: f.ev, msg: f.msg, fh: footholds(f.state), boss: f.state.job?.boss ?? f.state.boss, mark: f.state.job?.mark ?? null });
  };

  const pump = useCallback(() => {
    const r = ref.current;
    if (!r || r.timer !== null) return;
    if (!r.queue.length) {
      const p = r.game.pending;
      if (!p) return;
      if (p.seat !== HUMAN) {
        runBots(r.game, r.bots);
        r.queue.push(...r.game.drainFrames());
        return pump();
      }
      // Chime when the table comes back to you, not on every follow-up choice in the same turn.
      if (performance.now() - lastAsk.current > 2500) yourTurn();
      lastAsk.current = performance.now();
      setAsk(p);
      return;
    }
    const f = r.queue.shift()!;
    record(f);
    const sp = speedRef.current;
    const after = viewFor(f.state, HUMAN);
    const before = shownRef.current?.state ?? after;
    const flightMs = flightHook.current ? flightHook.current(f.ev, before, after) : 0;
    sfx(f.ev, HUMAN);
    const apply = () => {
      const s: Shown = { state: after, msg: f.msg, ev: f.ev, key: ++counter.current };
      shownRef.current = s;
      setShown(s);
      setLog((l) => [...l.slice(-80), { msg: f.msg, key: s.key }]);
    };
    if (flightMs > 0) {
      // remembered so Skip can drop it: a late apply would put an older frame back over the skipped-to one
      const id = window.setTimeout(() => {
        late.current.delete(id);
        apply();
      }, flightMs / sp);
      late.current.set(id, apply);
    } else apply();
    r.timer = window.setTimeout(() => {
      r.timer = null;
      pump();
    }, (Math.max(HOLD[f.ev.t], flightMs + 150)) / sp);
  }, []);

  const start = useCallback(() => {
    const seed = settings.seed ?? Math.floor(Math.random() * 2 ** 31);
    // built the same way the server replays it, so a finished game can be checked before it counts
    const { game, bots } = createSoloGame(seed, settings.players, settings.name, true, { levels: settings.levels, stage: settings.stage, gentle: settings.gentle, lesson: settings.lesson });
    if (ref.current?.timer) clearTimeout(ref.current.timer);
    dropLate();
    ref.current = { game, bots, queue: game.drainFrames(), timer: null, answers: [] };
    shownRef.current = null;
    history.current = [];
    setShown(null);
    setAsk(null);
    setLog([]);
    pump();
  }, [settings, pump]);

  useEffect(() => {
    start();
    return () => {
      if (ref.current?.timer) clearTimeout(ref.current.timer);
      dropLate();
      ref.current = null;
    };
  }, [start]);

  const answer = useCallback(
    (a: Answer) => {
      const r = ref.current;
      if (!r || !r.game.pending) return;
      try {
        r.game.answer(HUMAN, a);
        r.answers.push(a);
      } catch (e) {
        console.warn(e);
        return;
      }
      setAsk(null);
      lastAsk.current = performance.now();
      r.queue.push(...r.game.drainFrames());
      pump();
    },
    [pump],
  );

  /** Skip the pacing and jump to the next decision (or the end). */
  const skip = useCallback(() => {
    const r = ref.current;
    if (!r) return;
    if (r.timer !== null) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    const pending = dropLate();
    const last = r.queue[r.queue.length - 1];
    r.queue.forEach(record);
    r.queue = [];
    if (last) {
      const s: Shown = { state: viewFor(last.state, HUMAN), msg: last.msg, ev: last.ev, key: ++counter.current };
      shownRef.current = s;
      setShown(s);
    } else pending?.();
    pump();
  }, [pump]);

  return { shown, ask: shown && !ref.current?.queue.length ? ask : null, answer, log, speed, setSpeed, restart: start, skip, flightHook, history, game: ref.current?.game ?? null, answers: () => ref.current?.answers ?? [] };
}

/** What the table renders from. The local game vs bots is one source; online play plugs in another. */
export type TableSource = ReturnType<typeof useTable>;
