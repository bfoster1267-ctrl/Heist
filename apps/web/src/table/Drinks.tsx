// Send a drink: pick one, pick a player, and it slides across the felt to their seat and stays by
// their name for a while. Bots raise a glass back, and now and then buy a round themselves.
// Drinks cost coins (coffee is free); the app charges before the drink is sent.
import type { GameEvent, GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { reducedMotion } from "../prefs";
import { clink } from "../sound";

// the menu, with prices in coins, is shared with the shop rules in @heist/profile
export { DRINKS } from "@heist/profile";

export interface Drink {
  seat: number;
  from: number;
  emoji: string;
  key: number;
}

interface Slide {
  key: number;
  from: [number, number];
  to: [number, number];
  emoji: string;
}

const STAY_MS = 25000;
const SLIDE_MS = 900;

export function useDrinks(pos: (seat: number) => [number, number], onLanded: (d: Drink) => void) {
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const n = useRef(0);
  const posRef = useRef(pos);
  posRef.current = pos;
  const landed = useRef(onLanded);
  landed.current = onLanded;

  const send = useCallback((from: number, to: number, emoji: string) => {
    const key = ++n.current;
    const d: Drink = { seat: to, from, emoji, key };
    const land = () => {
      setSlides((ss) => ss.filter((x) => x.key !== key));
      clink();
      // Keep the last three in front of each seat.
      setDrinks((ds) => [...ds.filter((x) => x.seat !== to), ...ds.filter((x) => x.seat === to).slice(-2), d]);
      window.setTimeout(() => setDrinks((ds) => ds.filter((x) => x.key !== key)), STAY_MS);
      landed.current(d);
    };
    if (reducedMotion()) return land();
    setSlides((ss) => [...ss, { key, from: posRef.current(from), to: posRef.current(to), emoji }]);
    window.setTimeout(land, SLIDE_MS);
  }, []);

  return { drinks, slides, send };
}

/** Bots sometimes buy a round after a fight. Returns [from, to] or null. */
export function botRound(ev: GameEvent | null, s: GameState): [number, number] | null {
  if (!ev || ev.t !== "result" || !s.job || Math.random() > 0.12) return null;
  const j = s.job;
  // The winner toasts the loser ("no hard feelings"), or an ally toasts the winner.
  const winner = ev.winner === "B" ? j.boss : j.mark;
  const loser = ev.winner === "B" ? j.mark : j.boss;
  const pair: [number, number] = Math.random() < 0.5 ? [winner, loser] : [loser, winner];
  return s.players[pair[0]]?.bot ? pair : null;
}

const at = (p: [number, number]): [number, number] => p;

export function DrinkLayer({ drinks, slides, pos }: { drinks: Drink[]; slides: Slide[]; pos: (seat: number) => [number, number] }) {
  return (
    <div className="drink-layer" aria-hidden>
      {slides.map((sl) => {
        const [fx, fy] = at(sl.from);
        const [tx, ty] = at(sl.to);
        return (
          <motion.span
            key={sl.key}
            className="drink sliding"
            initial={{ x: fx, y: fy, scale: 0.4, rotate: -20, opacity: 0 }}
            animate={{ x: [fx, (fx + tx) / 2, tx], y: [fy, (fy + ty) / 2 + 30, ty], scale: [0.4, 1.5, 1], rotate: [-20, 8, 0], opacity: 1 }}
            transition={{ duration: SLIDE_MS / 1000, ease: [0.2, 0.7, 0.3, 1], times: [0, 0.6, 1] }}
          >
            {sl.emoji}
          </motion.span>
        );
      })}
      <AnimatePresence>
        {drinks.map((d) => {
          const [x, y] = at(pos(d.seat));
          const i = drinks.filter((o) => o.seat === d.seat).indexOf(d);
          return (
            <motion.span
              key={d.key}
              className="drink"
              style={{ left: x + i * 24, top: y }}
              initial={{ scale: 1.6, y: -10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: "spring", stiffness: 400, damping: 14 }}
            >
              {d.emoji}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
