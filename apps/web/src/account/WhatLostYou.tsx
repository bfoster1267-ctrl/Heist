// "What lost you?": asked once, when a new player walks out of their first game or comes back to the lobby
// after finishing it. One tap answers; a comment is optional. Closing it counts as asked, so it never
// comes back. Answers go to the owner's admin panel (Feedback).

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LostReason } from "./backend";
import { useAccount } from "./useAccount";

const OPTIONS: { id: LostReason; label: string }[] = [
  { id: "lost", label: "I didn't know what to do" },
  { id: "roles", label: "The roles" },
  { id: "buttons", label: "Too many buttons" },
  { id: "notForMe", label: "Just not my thing" },
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
  const options = ask.when === "finished" ? [{ id: "liked" as const, label: "Nothing, I liked it" }, ...OPTIONS] : OPTIONS;

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
      <motion.div className="lost-card" role="dialog" aria-label="What lost you?" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}>
        <button className="lost-x" onClick={picked ? onDone : skip} aria-label="Close" data-track="What lost you: close">
          ✕
        </button>
        {!picked ? (
          <>
            <h2>{ask.when === "finished" ? "Anything lose you?" : "What lost you?"}</h2>
            <p className="lost-sub">One tap helps make Heist easier to learn.</p>
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
                  {o.label}
                </button>
              ))}
            </div>
            <button className="lost-skip" onClick={skip} data-track="What lost you: skip">
              Skip
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
            <h2>Thanks!</h2>
            <p className="lost-sub">Anything else you'd tell us? (optional)</p>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} placeholder="What would have made it easier?" />
            <div className="lost-row">
              <button type="button" className="btn ghost" onClick={onDone}>
                Done
              </button>
              <button className="btn primary" disabled={busy || !comment.trim()} data-track="What lost you: send comment">
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}
