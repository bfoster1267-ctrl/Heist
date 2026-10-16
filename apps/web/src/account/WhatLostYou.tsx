// "What lost you?": asked once, when a new player walks out of their first game or comes back to the lobby
// after finishing it. One tap answers; a comment is optional. Closing it counts as asked, so it never
// comes back. Answers go to the owner's admin panel (Feedback).

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LostReason } from "./backend";
import { useAccount } from "./useAccount";
import { t, type TKey } from "../i18n";

const OPTIONS: { id: LostReason; label: TKey }[] = [
  { id: "lost", label: "lost.lost" },
  { id: "roles", label: "lost.roles" },
  { id: "buttons", label: "lost.buttons" },
  { id: "notForMe", label: "lost.notForMe" },
];

export interface LostAsk {
  when: "left" | "finished";
  round: number | null;
  coached: boolean;
}

export function WhatLostYou({ ask, onDone }: { ask: LostAsk; onDone: () => void }) {
  const { act } = useAccount();
  const [picked, setPicked] = useState<LostReason | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);
  const options: { id: LostReason; label: TKey }[] = ask.when === "finished" ? [{ id: "liked", label: "lost.liked" }, ...OPTIONS] : OPTIONS;

  const send = (reason: LostReason) => {
    if (sent.current) return;
    sent.current = true;
    void act((b) => b.feedback({ reason, ...ask }));
  };
  const skip = () => {
    send("skip");
    onDone();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (picked ? onDone() : skip());
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  return (
    <motion.div className="lost-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && (picked ? onDone() : skip())}>
      <motion.div className="lost-card" role="dialog" aria-label={t("lost.title")} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}>
        <button className="lost-x" onClick={picked ? onDone : skip} aria-label={t("common.close")} data-track="What lost you: close">
          ✕
        </button>
        {!picked ? (
          <>
            <h2>{ask.when === "finished" ? t("lost.titleDone") : t("lost.title")}</h2>
            <p className="lost-sub">{t("lost.sub")}</p>
            <div className="lost-options">
              {options.map((o) => (
                <button
                  key={o.id}
                  className="btn lost-option"
                  data-track={`What lost you: ${o.id}`}
                  onClick={() => {
                    send(o.id);
                    setPicked(o.id);
                  }}
                >
                  {t(o.label)}
                </button>
              ))}
            </div>
            <button className="lost-skip" onClick={skip} data-track="What lost you: skip">
              {t("lost.skip")}
            </button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!comment.trim()) return onDone();
              setBusy(true);
              await act((b) => b.feedback({ comment: comment.trim() }));
              onDone();
            }}
          >
            <h2>{t("lost.thanks")}</h2>
            <p className="lost-sub">{t("lost.more")}</p>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} placeholder={t("lost.placeholder")} />
            <div className="lost-row">
              <button type="button" className="btn ghost" onClick={onDone}>
                {t("common.done")}
              </button>
              <button className="btn primary" disabled={busy || !comment.trim()} data-track="What lost you: send comment">
                {busy ? t("common.sending") : t("common.send")}

              </button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}
