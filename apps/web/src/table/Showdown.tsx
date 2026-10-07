// The showdown reveal, played big and slow in the middle of the table: both cards come up face down,
// flip one after the other, totals count up, then the winner's side lights up and the loser's dims.
import type { GameEvent, GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { CardBack, CardFace, CountUp } from "./pieces";

export function Showdown({ s, ev, k }: { s: GameState; ev: GameEvent | null; k: number }) {
  const j = s.job;
  const on = !!j && !!ev && (ev.t === "reveal" || ev.t === "result" || ev.t === "hacked" || ev.t === "forged" || ev.t === "fixerFixer") && !!j.bossCard && !!j.markCard && j.revealed;
  const bust = j?.kind === "bust";
  const winner = j?.result === "B" || j?.result === "M" ? j.result : null;
  return (
    <AnimatePresence>
      {on && j && (
        <motion.div key={`sd-${s.turn}-${j.boss}-${j.mark}-${j.hideout}`} className="showdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} aria-hidden>
          {(["B", "M"] as const).map((side, i) => {
            const card = side === "B" ? j.bossCard! : j.markCard!;
            const who = side === "B" ? j.boss : j.mark;
            const total = side === "B" ? j.bTotal : j.mTotal;
            const state = winner ? (winner === side ? " win" : " lose") : "";
            return (
              <motion.div
                key={side}
                className={"sd-side sd-" + side + state}
                initial={{ x: side === "B" ? -120 : 120, opacity: 0, scale: 0.7 }}
                animate={{ x: 0, opacity: 1, scale: winner === side ? 1.08 : 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 18, delay: i * 0.08 }}
              >
                <div className="sd-who">
                  {bust ? "" : side === "B" ? "BOSS · " : "MARK · "}
                  {s.players[who].name}
                </div>
                <div className="sd-flip">
                  <motion.div
                    className="sd-inner"
                    initial={ev?.t === "reveal" ? { rotateY: 0 } : false}
                    animate={{ rotateY: 180 }}
                    transition={{ duration: 0.75, delay: 0.35 + i * 0.55, ease: [0.5, 0, 0.2, 1] }}
                  >
                    <div className="sd-face sd-back">
                      <CardBack size="lg" />
                    </div>
                    <div className="sd-face sd-front">
                      <CardFace card={card} size="lg" />
                    </div>
                  </motion.div>
                </div>
                <motion.div className="sd-total" initial={ev?.t === "reveal" ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 + i * 0.25 }}>
                  <CountUp value={total} />
                </motion.div>
              </motion.div>
            );
          })}
          <div className="sd-vs">VS</div>
          <AnimatePresence>
            {winner && (
              <motion.div
                key={`stamp-${k}`}
                className={"sd-stamp r-" + winner}
                initial={{ scale: 3, opacity: 0, rotate: -18 }}
                animate={{ scale: 1, opacity: 1, rotate: -8 }}
                transition={{ type: "spring", stiffness: 300, damping: 14 }}
              >
                {winner === "B" ? (bust ? "CLEARED OUT" : "BOSS WINS") : bust ? "HELD ON" : "MARK HOLDS"}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
