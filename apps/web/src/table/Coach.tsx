// First-game help: a three-step walkthrough of the table, then one coach tip the first time each kind of
// decision comes up. Both remember what you've seen; the settings menu can replay or turn them off.
import type { Answer, Ask, GameState } from "@heist/engine";
import { coachTip, describePick, type Idea, type MistakeId } from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useState } from "react";
import { markSeen, setPrefs, usePrefs } from "../prefs";
import { boxIn } from "../turn";
import { Crew } from "./pieces";
import { t, tEn, type TKey } from "../i18n";
import { ideaText, ideaTitle, mistakeTitle, mistakeWhy } from "../i18n/data";

interface Step {
  anchor?: string;
  title: string;
  text: string;
}

const steps = (s: GameState, lessonOn: boolean): Step[] => [
  {
    title: t("walk.1.title"),
    text: t("walk.1.text", { n: s.target }),
  },
  {
    anchor: "my-fh",
    title: t("walk.2.title"),
    text: t("walk.2.text", { n: s.target }),
  },
  {
    anchor: "my-hand",
    title: t("walk.3.title"),
    text: lessonOn ? t("walk.3.lesson") : t("walk.3.text"),
  },
];

/** The walkthrough. Shows on the first game, or when replayed from settings. */
export function Walkthrough({ s, lessonOn = false, canvas, scale, open, onClose }: { s: GameState; lessonOn?: boolean; canvas: React.RefObject<HTMLDivElement | null>; scale: number; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const list = steps(s, lessonOn);
  const st = list[i];

  useLayoutEffect(() => {
    if (!open) return;
    const root = canvas.current;
    const el = st.anchor ? root?.querySelector(`[data-anchor="${st.anchor}"]`) : null;
    if (!root || !el) return setBox(null);
    const r = boxIn(el, root);
    setBox({ x: r.left / scale - 8, y: r.top / scale - 8, w: r.width / scale + 16, h: r.height / scale + 16 });
  }, [open, i, st.anchor, canvas, scale]);

  if (!open) return null;
  const done = () => {
    setPrefs({ walked: true });
    setI(0);
    onClose();
  };
  const last = i === list.length - 1;
  // Put the card on whichever side of the spotlight has room.
  const cardStyle: React.CSSProperties = box
    ? box.y > 320
      ? { left: Math.min(Math.max(box.x + box.w / 2, 230), 1050), top: box.y - 14, transform: "translate(-50%, -100%)" }
      : { left: Math.min(Math.max(box.x + box.w / 2, 230), 1050), top: box.y + box.h + 14, transform: "translateX(-50%)" }
    : { left: "50%", top: "42%", transform: "translate(-50%, -50%)" };
  return (
    <div className="walk" role="dialog" aria-modal="true" aria-label={t("walk.aria")}>
      <motion.div
        className="walk-hole"
        initial={false}
        animate={box ? { left: box.x, top: box.y, width: box.w, height: box.h, opacity: 1 } : { left: 640, top: 300, width: 0, height: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
      />
      <div className="walk-card" style={cardStyle}>
        <div className="walk-count">
          {i + 1} / {list.length}
        </div>
        <div className="walk-title">{st.title}</div>
        <div className="walk-text">{st.text}</div>
        <div className="btns">
          <button className="btn ghost small" onClick={done}>
            {t("walk.skip")}
          </button>
          <span style={{ flex: 1 }} />
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              {t("walk.back")}
            </button>
          )}
          <button className="btn primary" autoFocus onClick={() => (last ? done() : setI(i + 1))}>
            {last ? t("walk.go") : t("walk.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

const COACH_KINDS = new Set<Ask["kind"]>(["keepRole", "bank", "hire", "action", "pickHideout", "send", "join", "bet", "showdown", "doubleCross", "backup", "dealOffer", "dealAccept", "again", "discard"]);
const coachCard = (kind: Ask["kind"]) =>
  COACH_KINDS.has(kind) ? { title: t(`tipcard.${kind}.title` as TKey), text: t(`tipcard.${kind}.text` as TKey) } : undefined;

/**
 * A coach card that covers the whole table on purpose: it can't get cut off or sit on a button, and Next
 * puts it away so the decision is yours. It lives inside the table canvas, so it turns and scales with it
 * (phone upright, on its side, notch and all).
 */
function CoachCard({ tone, title, tag, label, children, actions, delay = 0 }: { tone: string; title: string; tag?: string; label: string; children: React.ReactNode; actions: React.ReactNode; delay?: number }) {
  return (
    <motion.div className={"coach-sheet " + tone} role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay }}>
      <motion.div className="coach-card" initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} transition={{ delay, type: "spring", stiffness: 260, damping: 24 }}>
        <div className="coach-card-title">
          {tag && <span className="coach-new-tag">{tag}</span>}
          {title}
        </div>
        <div className="coach-card-text">{children}</div>
        <div className="coach-card-btns">{actions}</div>
      </motion.div>
    </motion.div>
  );
}

/** One coach tip, the first time each kind of decision comes up. */
export function Coach({ ask, blocked }: { ask: Ask | null; blocked: boolean }) {
  const prefs = usePrefs();
  const tip = ask && !blocked && prefs.tips && !prefs.seen.includes(ask.kind) ? coachCard(ask.kind) : undefined;
  return (
    <AnimatePresence>
      {tip && ask && (
        <CoachCard
          key={ask.kind}
          tone="tip"
          title={tip.title}
          label={tip.title}
          delay={0.25}
          actions={
            <>
              <button className="btn ghost" onClick={() => setPrefs({ tips: false })}>
                {t("coach.noTips")}
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" autoFocus onClick={() => markSeen(ask.kind)}>
                {t("coach.next")}
              </button>
            </>
          }
        >
          {tip.text}
        </CoachCard>
      )}
    </AnimatePresence>
  );
}

/** Coached play: a new idea gets the whole screen once. Next hands the decision back to you. */
export function CoachIdea({ idea, onNext, onOff }: { idea: Idea | undefined; onNext: () => void; onOff: () => void }) {
  return (
    <AnimatePresence>
      {idea && (
        <CoachCard
          key={idea.title}
          tone="live"
          tag={t("coach.new")}
          title={ideaTitle(idea)}
          label={t("coach.newIdea", { title: ideaTitle(idea) })}
          delay={0.35}
          actions={
            <>
              <button className="btn ghost" onClick={onOff}>
                {t("coach.skip")}
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" autoFocus onClick={onNext}>
                {t("coach.next")}
              </button>
            </>
          }
        >
          {ideaText(idea)}
        </CoachCard>
      )}
    </AnimatePresence>
  );
}

/**
 * Coached play: the coach's short read of the decision, sitting just above your decision buttons as part
 * of the panel, so it moves with it and never covers a choice. The coach's own pick stays hidden until you
 * ask for a hint, and a good move gets a cheer.
 */
export function CoachLine({ s, ask, idea, pick, cheer, onIdea }: { s: GameState; ask: Ask; idea?: Idea; pick: Answer | null; cheer: string | null; onIdea: () => void }) {
  const tip = tEn(coachTip(s, ask));
  const said = pick ? tEn(describePick(s, ask, pick)) : "";
  const [hint, setHint] = useState(false);
  if (!tip && !cheer && !idea) return null;
  return (
    <div className="coach-line" role="note" aria-label={t("coach.aria")}>
      {cheer && <div className="coach-cheer">{cheer}</div>}
      {tip && (
        <div className="coach-line-text">
          <b>{t("coach.coach")}</b> {tip}
        </div>
      )}
      {hint && said ? (
        <div className="coach-pick">
          <b>{t("coach.hint")}</b> {said}
          {pick?.kind === "action" && (pick.choice === "bust" || pick.choice === "wanted") && (
            // the same shape and number the button shows, so the pick is easy to find
            <span className="move-target" aria-hidden>
              <Crew color={s.players[pick.choice === "bust" ? pick.rival : pick.mark].color} size={18} />
              <span className="ho-num">{pick.hideout + 1}</span>
            </span>
          )}
        </div>
      ) : null}
      {(idea || (said && !hint)) && (
        <div className="coach-line-btns">
          {idea && (
            <button className="coach-hint" onClick={onIdea}>
              <span className="coach-new-tag">{t("coach.new")}</span>
              {ideaTitle(idea)}
            </button>
          )}
          {said && !hint && (
            <button className="coach-hint" onClick={() => setHint(true)}>
              {t("coach.getHint")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Coached play: a rookie mistake is caught before it's played. You can still play it. */
export function MistakeCheck({ id, before, onAnyway, onChange }: { id: MistakeId; before: number; onAnyway: () => void; onChange: () => void }) {
  const title = mistakeTitle(id);
  return (
    <CoachCard
      tone="mistake"
      title={t("coach.holdOn", { what: title.charAt(0).toLowerCase() + title.slice(1) })}
      label={title}
      actions={
        <>
          <button className="btn ghost" onClick={onAnyway}>
            {t("coach.anyway")}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" autoFocus onClick={onChange}>
            {t("coach.change")}
          </button>
        </>
      }
    >
      {mistakeWhy(id)}
      {before > 0 && t("coach.before", { count: before })}

    </CoachCard>
  );
}
