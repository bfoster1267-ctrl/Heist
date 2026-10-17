import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LostReason } from "./backend";
import { useAccount } from "./useAccount";
import { t } from "../i18n";

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

  const options: { id: LostReason; labelKey: string }[] =
    ask.when === "finished"
      ? [
          { id: "liked" as const, labelKey: "feedback.opt_liked" },
          { id: "lost", labelKey: "feedback.opt_lost" },
          { id: "roles", labelKey: "feedback.opt_roles" },
          { id: "buttons", labelKey: "feedback.opt_buttons" },
          { id: "notForMe", labelKey: "feedback.opt_notForMe" },
        ]
      : [
          { id: "lost", labelKey: "feedback.opt_lost" },
          { id: "roles", labelKey: "feedback.opt_roles" },
          { id: "buttons", labelKey: "feedback.opt_buttons" },
          { id: "notForMe", labelKey: "feedback.opt_notForMe" },
        ];

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
      <motion.div className="lost-card" role="dialog" aria-label={ask.when === "finished" ? t("feedback.title_finished") : t("feedback.title_left")} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}>
        <button className="lost-x" onClick={picked ? onDone : skip} aria-label={t("profile.close")} data-track="What lost you: close">
          ✕
        </button>
        {!picked ? (
          <>
            <h2>{ask.when === "finished" ? t("feedback.title_finished") : t("feedback.title_left")}</h2>
            <p className="lost-sub">{t("feedback.sub")}</p>
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
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
            <button className="lost-skip" onClick={skip} data-track="What lost you: skip">
              {t("feedback.skip")}
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
            <h2>{t("feedback.thanks")}</h2>
            <p className="lost-sub">{t("feedback.comment_sub")}</p>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} placeholder={t("feedback.placeholder")} />
            <div className="lost-row">
              <button type="button" className="btn ghost" onClick={onDone}>
                {t("feedback.done")}
              </button>
              <button className="btn primary" disabled={busy || !comment.trim()} data-track="What lost you: send comment">
                {busy ? t("feedback.sending") : t("feedback.send")}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}
