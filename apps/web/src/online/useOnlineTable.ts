// The online table source: the same shape as the solo useTable, but the game comes from the server.
// Frames arrive already filtered for this seat; this hook paces them with the same timings as the solo
// table, and offers the server's ask once the table has caught up.
import type { Answer, Ask, Frame } from "@heist/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { sfx, yourTurn } from "../sound";
import { HOLD, footholds, type FlightHook, type HistoryEntry, type Shown, type TableSettings, type TableSource } from "../useTable";
import type { OnlineSession } from "./session";

/** Frames waiting when the table opens beyond this many are fast-forwarded (joining a game in progress). */
const CATCH_UP = 12;

/** Make a table source bound to one online session. Create it once per table. */
export function onlineSource(sess: OnlineSession) {
  return function useOnlineTable(_settings: TableSettings): TableSource {
    const seat = sess.seat ?? -1;
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
    const queue = useRef<Frame[]>([]);
    const timer = useRef<number | null>(null);
    const game = useRef(0);
    const late = useRef(new Map<number, () => void>());
    /** Cancel frames still waiting on a card flight; returns the newest one. */
    const dropLate = () => {
      let newest: (() => void) | undefined;
      late.current.forEach((apply, id) => {
        clearTimeout(id);
        newest = apply;
      });
      late.current.clear();
      return newest;
    };

    const record = (f: Frame) =>
      history.current.push({ turn: f.state.turn, ev: f.ev, msg: f.msg, fh: footholds(f.state), boss: f.state.job?.boss ?? f.state.boss, mark: f.state.job?.mark ?? null });

    const show = useCallback((f: Frame) => {
      const s: Shown = { state: f.state, msg: f.msg, ev: f.ev, key: ++counter.current };
      shownRef.current = s;
      setShown(s);
      setLog((l) => [...l.slice(-80), { msg: f.msg, key: s.key }]);
    }, []);

    const pump = useCallback(() => {
      if (timer.current !== null) return;
      if (!queue.current.length) {
        const p = sess.ask;
        if (!p) return setAsk(null);
        if (performance.now() - lastAsk.current > 2500) yourTurn();
        lastAsk.current = performance.now();
        setAsk(p.ask);
        return;
      }
      const f = queue.current.shift()!;
      record(f);
      const sp = speedRef.current;
      const before = shownRef.current?.state ?? f.state;
      const flightMs = flightHook.current ? flightHook.current(f.ev, before, f.state) : 0;
      sfx(f.ev, seat);
      if (flightMs > 0) {
        // remembered so Skip can drop it: a late show would put an older frame back over the skipped-to one
        const id = window.setTimeout(() => {
          late.current.delete(id);
          show(f);
        }, flightMs / sp);
        late.current.set(id, () => show(f));
      } else show(f);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        pump();
      }, Math.max(HOLD[f.ev.t] ?? 700, flightMs + 150) / sp);
    }, [seat, show]);

    /** Start from whatever the session has: a synced table, then frames. Far behind: jump ahead. */
    const load = useCallback(() => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      dropLate();
      const feed = sess.feed;
      game.current = feed.game;
      history.current = [];
      queue.current = [];
      setAsk(null);
      if (feed.base) {
        const s: Shown = { state: feed.base.state, msg: feed.base.log.at(-1) ?? "", ev: null, key: ++counter.current };
        shownRef.current = s;
        setShown(s);
        setLog(feed.base.log.map((msg) => ({ msg, key: ++counter.current })));
      } else {
        shownRef.current = null;
        setShown(null);
        setLog([]);
      }
      let frames = [...feed.frames];
      if (frames.length > CATCH_UP) {
        const skipped = frames.slice(0, frames.length - 3);
        skipped.forEach(record);
        setLog(skipped.slice(-60).map((f) => ({ msg: f.msg, key: ++counter.current })));
        const last = skipped[skipped.length - 1];
        const s: Shown = { state: last.state, msg: last.msg, ev: last.ev, key: ++counter.current };
        shownRef.current = s;
        setShown(s);
        frames = frames.slice(-3);
      }
      queue.current = frames;
      pump();
    }, [pump]);

    useEffect(() => {
      load();
      const off = sess.onMessage((m) => {
        if (m.t === "sync") load();
        else if (m.t === "frames") {
          if (m.game !== game.current) return load();
          queue.current.push(...m.frames);
          setAsk(null);
          pump();
        } else if (m.t === "ask") pump();
        else if (m.t === "timeout" && m.seat === seat) setAsk(null);
        else if (m.t === "error") pump(); // a rejected answer: offer the same decision again
      });
      return () => {
        off();
        dropLate();
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
      };
    }, [load, pump, seat]);

    const answer = useCallback((a: Answer) => {
      if (!sess.ask) return;
      sess.client.answer(a);
      lastAsk.current = performance.now();
      setAsk(null);
    }, []);

    const skip = useCallback(() => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      const pending = dropLate();
      const rest = queue.current;
      queue.current = [];
      rest.forEach(record);
      const last = rest[rest.length - 1];
      if (last) {
        const s: Shown = { state: last.state, msg: last.msg, ev: last.ev, key: ++counter.current };
        shownRef.current = s;
        setShown(s);
      } else pending?.();
      pump();
    }, [pump]);

    const restart = useCallback(() => {}, []);

    return { shown, ask: shown && !queue.current.length ? ask : null, answer, log, speed, setSpeed, restart, skip, flightHook, history, game: null };
  };
}
