// The campaign ladder: twelve fixed tables against bots, played in order. Cleared stages can be
// replayed; the next one is highlighted; later ones stay locked.

import { STAGES, cosmetic } from "@heist/profile";
import { motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

const ACTS = [
  { name: "Act 1: Small Time", from: 1 },
  { name: "Act 2: Moving Up", from: 5 },
  { name: "Act 3: The Big Score", from: 9 },
];

export function Campaign({ cleared, onPlay, onClose }: { cleared: number; onPlay: (stage: number) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const next = cleared + 1;
  return createPortal(
    <motion.div className="modal-back rules-back fixed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="rules camp"
        role="dialog"
        aria-label="Campaign"
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rules-head">
          <span className="rules-title">Campaign</span>
          <button className="btn small rules-close" onClick={onClose} autoFocus>
            ✕ Close
          </button>
        </div>
        <div className="camp-sub">
          {cleared >= STAGES.length ? "Every job pulled. You're The Mastermind." : `${cleared} of ${STAGES.length} jobs pulled. No buy-in: win to unlock the next table.`}
        </div>
        <div className="rules-body camp-list">
          {ACTS.map((act, ai) => (
            <section key={act.name}>
              <h3>{act.name}</h3>
              {STAGES.slice(act.from - 1, ACTS[ai + 1] ? ACTS[ai + 1].from - 1 : undefined).map((s) => {
                const done = s.n <= cleared;
                const locked = s.n > next;
                const items = (s.items ?? []).map((id) => cosmetic(id)?.name).filter(Boolean);
                return (
                  <div key={s.n} className={"camp-stage" + (done ? " done" : "") + (s.n === next && !done ? " next" : "") + (locked ? " locked" : "")}>
                    <div className="camp-n">{done ? "✓" : locked ? "🔒" : s.n}</div>
                    <div className="camp-info">
                      <div className="camp-name">
                        {s.name} <span className="camp-meta">{s.players} players · {s.twist}</span>
                      </div>
                      <div className="camp-blurb">{s.blurb}</div>
                      <div className="camp-prize">
                        {done ? "Cleared" : `First clear: ${s.coins} coins, ${s.xp} XP`}
                        {items.length > 0 && <span className="camp-item"> + {items.join(" and ")}</span>}
                      </div>
                    </div>
                    <button className={"btn small " + (done ? "ghost" : "primary")} disabled={locked} onClick={() => onPlay(s.n)}>
                      {done ? "Replay" : "Play"}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
