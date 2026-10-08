// Things that fly across the table: crew to a job, crew to the Pen, loot, Cuts, cards being dealt.
// Positions come from data-anchor elements, so the animation follows whatever the layout is.
import type { GameEvent, GameState } from "@heist/engine";
import { motion } from "motion/react";
import { useCallback, useState } from "react";
import { reducedMotion } from "../prefs";
import { CardBack, Crew } from "./pieces";

export type Token = { kind: "crew"; color: number } | { kind: "coin" } | { kind: "card" } | { kind: "chip"; color: string };
interface Flight {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  token: Token;
  delay: number;
}

const DUR = 520;
let nextId = 1;

export function useFlights(canvas: React.RefObject<HTMLDivElement | null>, scale: number) {
  const [flights, setFlights] = useState<Flight[]>([]);

  const at = useCallback(
    (anchor: string) => {
      const root = canvas.current;
      const el = root?.querySelector(`[data-anchor="${anchor}"]`);
      if (!root || !el) return null;
      const r = el.getBoundingClientRect();
      const c = root.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - c.left) / scale, y: (r.top + r.height / 2 - c.top) / scale };
    },
    [canvas, scale],
  );

  /** Launch the flights for one event. Returns how long they take (ms at 1x). */
  const launch = useCallback(
    (ev: GameEvent, before: GameState, after: GameState): number => {
      if (reducedMotion()) return 0;
      const out: Flight[] = [];
      const color = (p: number) => after.players[p].color;
      const add = (from: string, to: string, token: Token, count = 1) => {
        const a = at(from), b = at(to);
        if (!a || !b) return;
        for (let i = 0; i < Math.min(count, 6); i++) out.push({ id: nextId++, from: a, to: b, token, delay: i * 70 });
      };
      const jobFrom = (p: number) => (before.job ? (before.job.side.M[p] > 0 && before.job.side.B[p] === 0 && before.job.mark !== p ? "job-M" : before.job.mark === p && before.job.kind === "hit" ? "job-M" : "job-B") : `seat-${p}`);
      switch (ev.t) {
        case "send":
          add(`home-${ev.seat}`, `job-${ev.side}`, { kind: "crew", color: color(ev.seat) }, ev.count);
          break;
        case "toPen":
          add(before.job ? jobFrom(ev.seat) : `seat-${ev.seat}`, "pen", { kind: "crew", color: color(ev.seat) }, ev.count);
          break;
        case "penReturn":
          add("pen", `home-${ev.seat}`, { kind: "crew", color: color(ev.seat) }, ev.count);
          break;
        case "foothold":
          add("job-B", `hideout-${ev.owner}-${ev.hideout}`, { kind: "crew", color: color(ev.seat) });
          break;
        case "loot":
          if (ev.amount) add(`bank-${ev.from}`, `bank-${ev.to}`, { kind: "coin" }, Math.min(ev.amount, 6));
          break;
        case "hire":
          add(`bank-${ev.seat}`, "discard", { kind: "coin" }, ev.count * 2);
          break;
        case "cut":
          add("deck", `bank-${ev.seat}`, { kind: "card" });
          break;
        case "draw":
          add("deck", `seat-${ev.seat}`, { kind: "card" }, ev.count);
          break;
        case "bet":
          add(`bank-${ev.seat}`, `job-${ev.side}`, { kind: "coin" });
          break;
      }
      if (!out.length) return 0;
      setFlights((f) => [...f, ...out]);
      const total = DUR + Math.max(...out.map((f) => f.delay));
      window.setTimeout(() => setFlights((f) => f.filter((x) => !out.includes(x))), total + 50);
      return total;
    },
    [at],
  );

  /** Fly tokens between two anchors outside of a game event (buy-ins, the payout). */
  const fly = useCallback(
    (from: string, to: string, token: Token, count: number, gap = 70) => {
      if (reducedMotion()) return 0;
      const a = at(from), b = at(to);
      if (!a || !b) return 0;
      const out: Flight[] = Array.from({ length: count }, (_, i) => ({ id: nextId++, from: a, to: b, token, delay: i * gap }));
      setFlights((f) => [...f, ...out]);
      const total = DUR + (count - 1) * gap;
      window.setTimeout(() => setFlights((f) => f.filter((x) => !out.includes(x))), total + 50);
      return total;
    },
    [at],
  );

  return { flights, launch, fly };
}

export function FlightLayer({ flights, speed }: { flights: Flight[]; speed: number }) {
  return (
    <div className="flight-layer">
      {flights.map((f) => {
        // Arc over the table instead of sliding in a straight line, like a toss.
        const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y;
        const lift = Math.min(90, Math.hypot(dx, dy) * 0.22);
        const mid = { x: f.from.x + dx / 2, y: f.from.y + dy / 2 - lift };
        const spin = f.token.kind === "card" ? (dx > 0 ? 200 : -200) : 0;
        return (
          <motion.div
            key={f.id}
            className="flight"
            initial={{ x: f.from.x, y: f.from.y, scale: 0.6, opacity: 0, rotate: 0 }}
            animate={{ x: [f.from.x, mid.x, f.to.x], y: [f.from.y, mid.y, f.to.y], scale: [0.6, 1.3, 1], opacity: [0, 1, 0.95], rotate: [0, spin / 2, spin] }}
            transition={{ duration: DUR / 1000 / speed, delay: f.delay / 1000 / speed, ease: [0.3, 0.1, 0.2, 1], times: [0, 0.45, 1] }}
          >
            {f.token.kind === "crew" && <Crew color={f.token.color} size={20} glow />}
            {f.token.kind === "coin" && <span className="coin">$</span>}
            {f.token.kind === "chip" && <span className="fly-chip" style={{ background: f.token.color }} />}
            {f.token.kind === "card" && <CardBack size="xs" />}
          </motion.div>
        );
      })}
    </div>
  );
}
