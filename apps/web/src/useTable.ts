// Runs a solo table in the browser: the engine, bot fillers, and a frame queue the table plays back
// with pacing so every move can be seen. Online play will swap the engine for a server connection
// that sends the same Frames.
import { Bot, HeistGame, runBots, viewFor, type Answer, type Ask, type Frame, type GameEvent, type GameState } from "@heist/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { sfx, yourTurn } from "./sound";

export const HUMAN = 0;

const BOT_NAMES = ["Vinnie", "Rosa", "Dutch", "Lola", "Sal", "Margo", "Frankie", "Ivy", "Nico", "Bea"];

/** How long each event holds the table, in ms at 1x speed. */
const HOLD: Record<GameEvent["t"], number> = {
  setup: 700, role: 250, wildcard: 1300, turn: 900, draw: 450, reshuffle: 1000, lastCall: 1800, penReturn: 550,
  fence: 800, bank: 650, hire: 650, stuck: 1300, flip: 1300, mark: 1100, target: 900, send: 600, pass: 350,
  doubleCross: 1600, bet: 700, hackerCall: 1100, facedown: 550, reveal: 1700, hacked: 1600, forged: 1300,
  backup: 1100, result: 1800, fixerFixer: 1400, deal: 1300, toPen: 650, foothold: 1000, loot: 900, cut: 550,
  betPaid: 600, bust: 1100, bustResult: 1400, again: 800, discard: 450, gameOver: 600,
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
}

export interface Shown {
  state: GameState;
  msg: string;
  ev: GameEvent | null;
  key: number;
}

export type FlightHook = (ev: GameEvent, before: GameState, after: GameState) => number;

export function useTable(settings: TableSettings) {
  const ref = useRef<{ game: HeistGame; bots: Map<number, Bot>; queue: Frame[]; timer: number | null } | null>(null);
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
    if (flightMs > 0) window.setTimeout(apply, flightMs / sp);
    else apply();
    r.timer = window.setTimeout(() => {
      r.timer = null;
      pump();
    }, (Math.max(HOLD[f.ev.t], flightMs + 150)) / sp);
  }, []);

  const start = useCallback(() => {
    const seed = settings.seed ?? Math.floor(Math.random() * 2 ** 31);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const seats = Array.from({ length: settings.players }, (_, i) => (i === HUMAN ? { name: settings.name || "Ace", bot: false } : { name: names[i], bot: true }));
    const game = new HeistGame({ seed, seats });
    const bots = new Map(game.s.players.filter((p) => p.bot).map((p) => [p.seat, new Bot(seed + p.seat * 31)]));
    if (ref.current?.timer) clearTimeout(ref.current.timer);
    ref.current = { game, bots, queue: game.drainFrames(), timer: null };
    shownRef.current = null;
    setShown(null);
    setAsk(null);
    setLog([]);
    pump();
  }, [settings, pump]);

  useEffect(() => {
    start();
    return () => {
      if (ref.current?.timer) clearTimeout(ref.current.timer);
      ref.current = null;
    };
  }, [start]);

  const answer = useCallback(
    (a: Answer) => {
      const r = ref.current;
      if (!r || !r.game.pending) return;
      try {
        r.game.answer(HUMAN, a);
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
    const last = r.queue[r.queue.length - 1];
    r.queue = [];
    if (last) {
      const s: Shown = { state: viewFor(last.state, HUMAN), msg: last.msg, ev: last.ev, key: ++counter.current };
      shownRef.current = s;
      setShown(s);
    }
    pump();
  }, [pump]);

  return { shown, ask: shown && !ref.current?.queue.length ? ask : null, answer, log, speed, setSpeed, restart: start, skip, flightHook, game: ref.current?.game ?? null };
}
