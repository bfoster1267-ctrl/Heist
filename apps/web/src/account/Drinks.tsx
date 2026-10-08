// Send a drink across the table. The drink flies from your seat to theirs and they raise a glass; a
// round of champagne goes to everyone. Paid in coins (coffee is free). Bots sometimes send one back.

import { DRINKS, drink, type Drink } from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "./useAccount";

interface Flight {
  key: number;
  emoji: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface Bubble {
  key: number;
  text: string;
  at: { x: number; y: number };
}

const THANKS = ["Cheers!", "Salud!", "Much obliged.", "Don't mind if I do.", "To the job!", "You're all right."];
const BOT_GIFTS = ["coffee", "beer", "whiskey"];

function seatPoint(seat: number): { x: number; y: number } | null {
  const el = document.querySelector(`[data-anchor="seat-${seat}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

let nextKey = 1;

/** `names[0]` is you; the rest are the other seats in order. */
export function Drinks({ names, mySeat = 0 }: { names: string[]; mySeat?: number }) {
  const { me, act } = useAccount();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Drink | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const fly = useCallback((emoji: string, from: number, to: number, thanks: string | null) => {
    const a = seatPoint(from);
    const b = seatPoint(to);
    if (!a || !b) return;
    const f: Flight = { key: nextKey++, emoji, from: a, to: b };
    setFlights((x) => [...x, f]);
    later(() => {
      setFlights((x) => x.filter((y) => y !== f));
      if (thanks) {
        const bub: Bubble = { key: nextKey++, text: `${emoji} ${thanks}`, at: b };
        setBubbles((x) => [...x, bub]);
        later(() => setBubbles((x) => x.filter((y) => y !== bub)), 2600);
      }
    }, 950);
  }, []);

  const send = async (d: Drink, to: number | null) => {
    setOpen(false);
    setPick(null);
    const targets = to === null ? names.map((_, i) => i).filter((i) => i !== mySeat) : [to];
    const ok = await act((b) => b.drink(d.id, targets.length));
    if (!ok) return;
    targets.forEach((t, k) => later(() => fly(d.emoji, mySeat, t, THANKS[(t + k + d.price) % THANKS.length]), k * 140));
    // now and then a bot returns the favour
    const back = targets[Math.floor(Math.random() * targets.length)];
    if (Math.random() < 0.35) {
      const g = drink(BOT_GIFTS[Math.floor(Math.random() * BOT_GIFTS.length)])!;
      later(() => fly(g.emoji, back, mySeat, `from ${names[back]}`), 2600);
    }
  };

  const coins = me?.progress.coins ?? 0;
  return (
    <>
      <div className="acct-drinks">
        <button className="btn acct-drinks-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Send a drink">
          🍸 Drinks
        </button>
        <AnimatePresence>
          {open && (
            <motion.div className="acct-drinks-menu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              {!pick ? (
                <>
                  <div className="acct-drinks-head">Buy a drink</div>
                  {DRINKS.map((d) => (
                    <button key={d.id} className="acct-drink" disabled={coins < d.price} onClick={() => (d.round ? send(d, null) : setPick(d))}>
                      <span className="acct-drink-emoji">{d.emoji}</span>
                      <span>{d.name}</span>
                      <span className="acct-drink-price">{d.price ? <><span className="acct-coin" />{d.price}</> : "Free"}</span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <div className="acct-drinks-head">
                    {pick.emoji} {pick.name} for…
                  </div>
                  {names.map((n, i) =>
                    i === mySeat ? null : (
                      <button key={i} className="acct-drink" onClick={() => send(pick, i)}>
                        {n}
                      </button>
                    ),
                  )}
                  <button className="acct-drink dim" onClick={() => setPick(null)}>
                    Back
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="acct-drink-layer" aria-hidden>
        {flights.map((f) => (
          <motion.span
            key={f.key}
            className="acct-drink-fly"
            initial={{ x: f.from.x, y: f.from.y, scale: 0.6, rotate: -20 }}
            animate={{ x: [f.from.x, (f.from.x + f.to.x) / 2, f.to.x], y: [f.from.y, Math.min(f.from.y, f.to.y) - 120, f.to.y], scale: [0.6, 1.5, 1], rotate: [-20, 10, 0] }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
          >
            {f.emoji}
          </motion.span>
        ))}
        <AnimatePresence>
          {bubbles.map((b) => (
            <motion.span key={b.key} className="acct-drink-bubble" style={{ left: b.at.x, top: b.at.y - 46 }} initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }}>
              {b.text}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
