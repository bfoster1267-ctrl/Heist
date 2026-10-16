// The campaign ladder: twelve fixed tables against bots, played in order. Cleared stages can be
// replayed; the next one is highlighted; later ones stay locked.

import { STAGES } from "@heist/profile";
import { motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { list, t } from "./i18n";
import { cosName, stageBlurb, stageName, stageTwist } from "./i18n/data";

const ACTS = [
  { key: "camp.act1", from: 1 },
  { key: "camp.act2", from: 5 },
  { key: "camp.act3", from: 9 },
] as const;

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
        aria-label={t("camp.title")}
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rules-head">
          <span className="rules-title">{t("camp.title")}</span>
          <button className="btn small rules-close" onClick={onClose} autoFocus>
            {t("camp.close")}
          </button>
        </div>
        <div className="camp-sub">
          {cleared >= STAGES.length ? t("camp.allDone") : t("camp.progress", { n: cleared, total: STAGES.length })}
        </div>
        <div className="rules-body camp-list">
          {ACTS.map((act, ai) => (
            <section key={act.key}>
              <h3>{t(act.key)}</h3>
              {STAGES.slice(act.from - 1, ACTS[ai + 1] ? ACTS[ai + 1].from - 1 : undefined).map((s) => {
                const done = s.n <= cleared;
                const locked = s.n > next;
                const items = (s.items ?? []).map((id) => cosName(id)).filter(Boolean);
                return (
                  <div key={s.n} className={"camp-stage" + (done ? " done" : "") + (s.n === next && !done ? " next" : "") + (locked ? " locked" : "")}>
                    <div className="camp-n">{done ? "✓" : locked ? "🔒" : s.n}</div>
                    <div className="camp-info">
                      <div className="camp-name">
                        {stageName(s.n)} <span className="camp-meta">{t("camp.players", { n: s.players })} · {stageTwist(s.n)}</span>
                      </div>
                      <div className="camp-blurb">{stageBlurb(s.n)}</div>
                      <div className="camp-prize">
                        {done ? t("camp.cleared") : t("camp.firstClear", { coins: s.coins, xp: s.xp })}
                        {items.length > 0 && <span className="camp-item"> + {list(items)}</span>}
                      </div>
                    </div>
                    <button className={"btn small " + (done ? "ghost" : "primary")} disabled={locked} onClick={() => onPlay(s.n)}>
                      {done ? t("camp.replay") : t("camp.play")}

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
