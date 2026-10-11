// First-game help: a three-step walkthrough of the table, then one coach tip the first time each kind of
// decision comes up. Both remember what you've seen; the settings menu can replay or turn them off.
import type { Answer, Ask, GameState } from "@heist/engine";
import { MISTAKES, coachTip, describePick, type Idea, type MistakeId } from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useState } from "react";
import { markSeen, setPrefs, usePrefs } from "../prefs";
import { boxIn } from "../turn";

interface Step {
  anchor?: string;
  title: string;
  text: string;
}

const steps = (s: GameState, lessonOn: boolean): Step[] => [
  {
    title: "Welcome to the table",
    text: `Heist is a game of crews, jobs and betrayal. Plant ${s.target} Footholds in rival hideouts and the pot is yours.`,
  },
  {
    anchor: "my-fh",
    title: "Footholds win the game",
    text: `A Foothold is one of your crew living in a rival's hideout. Fill these ${s.target} diamonds first and you win.`,
  },
  {
    anchor: "my-hand",
    title: "Your turn, in short",
    text: lessonOn
      ? "Hit rivals with your crew and a card from this hand. This first game, the coach plays most of your turn; each hand you take over one more move. Long-press anything to see what it is."
      : "Bank cards for cash, hire crew, then hit a rival with your crew and a card from this hand. Long-press anything on the table to see what it is.",
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
    <div className="walk" role="dialog" aria-modal="true" aria-label="How the table works">
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
            Skip tour
          </button>
          <span style={{ flex: 1 }} />
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn primary" autoFocus onClick={() => (last ? done() : setI(i + 1))}>
            {last ? "Let's go" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

const COACH: Partial<Record<Ask["kind"], { title: string; text: string }>> = {
  keepRole: { title: "Roles", text: "Each Role breaks one rule in your favor. Everyone can see everyone's Role, so pick one that fits how you want to play." },
  bank: { title: "Banking", text: "Banked cards are your cash. You spend it to hire crew and bet. Keep at least one Score or Fixer in hand to fight with." },
  hire: { title: "Hiring", text: "New crew come out of your reserve into a home hideout. More crew at home means stronger defense and bigger hits." },
  action: { title: "Hit, bust or lay low", text: "A Hit flips the top Job card: its color picks the Mark. You attack one of their hideouts. Bust clears a rival's Foothold out of your own hideout." },
  pickHideout: { title: "Pick the target", text: "Fewer guards is an easier fight. Their crew at home get a home-turf bonus." },
  send: { title: "Send your crew", text: "Each crew is +1 to your side. Win and they each try to leave 1 behind as a Foothold. Lose and they all go to the Pen." },
  join: { title: "Pick a side", text: "Other players can join. Back the Boss to grab a Foothold, or defend the Mark to bank a Cut. Or stay out of it." },
  bet: { title: "Side bets", text: "Put a banked card on the side you think wins. Right: it comes back plus the top Job card. Wrong: it's gone." },
  showdown: { title: "The showdown", text: "Boss and Mark each lay a card face down, then flip. Card plus crew. Higher wins, ties go to the Mark." },
  doubleCross: { title: "Double-Cross", text: "Flip one ally to the other side right before the showdown. Brutal, and anyone can play it." },
  backup: { title: "Backup", text: "Cards are face up now. +3 to either side can turn the fight." },
  dealOffer: { title: "Fixer vs Fixer", text: "Both laid Fixers, so it's a negotiation. If the Mark says no, both of you lose 2 crew to the Pen." },
  dealAccept: { title: "A deal on the table", text: "Accept and it's done. Refuse and both of you send 2 crew to the Pen." },
  again: { title: "On a roll", text: "You won, so you can hit again this turn. Each hit risks more crew." },
  discard: { title: "Hand limit", text: "You can hold 7 cards at the end of your turn. Pick the extras to throw away." },
};

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
  const tip = ask && !blocked && prefs.tips && !prefs.seen.includes(ask.kind) ? COACH[ask.kind] : undefined;
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
                No more tips
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" autoFocus onClick={() => markSeen(ask.kind)}>
                Next
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
          tag="New"
          title={idea.title}
          label={`New idea: ${idea.title}`}
          delay={0.35}
          actions={
            <>
              <button className="btn ghost" onClick={onOff}>
                Skip coaching
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" autoFocus onClick={onNext}>
                Next
              </button>
            </>
          }
        >
          {idea.text}
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
  const tip = coachTip(s, ask);
  const said = pick ? describePick(s, ask, pick) : "";
  const [hint, setHint] = useState(false);
  if (!tip && !cheer && !idea) return null;
  return (
    <div className="coach-line" role="note" aria-label="Coach">
      {cheer && <div className="coach-cheer">{cheer}</div>}
      {tip && (
        <div className="coach-line-text">
          <b>Coach:</b> {tip}
        </div>
      )}
      {hint && said ? (
        <div className="coach-pick">
          <b>Hint:</b> {said}
        </div>
      ) : null}
      {(idea || (said && !hint)) && (
        <div className="coach-line-btns">
          {idea && (
            <button className="coach-hint" onClick={onIdea}>
              <span className="coach-new-tag">New</span>
              {idea.title}
            </button>
          )}
          {said && !hint && (
            <button className="coach-hint" onClick={() => setHint(true)}>
              Stuck? Get a hint
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Coached play: a rookie mistake is caught before it's played. You can still play it. */
export function MistakeCheck({ id, before, onAnyway, onChange }: { id: MistakeId; before: number; onAnyway: () => void; onChange: () => void }) {
  const m = MISTAKES[id];
  return (
    <CoachCard
      tone="mistake"
      title={`Hold on: ${m.title.toLowerCase()}`}
      label={m.title}
      actions={
        <>
          <button className="btn ghost" onClick={onAnyway}>
            Do it anyway
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" autoFocus onClick={onChange}>
            Change my move
          </button>
        </>
      }
    >
      {m.why}
      {before > 0 && <> You've made this one {before} time{before === 1 ? "" : "s"} before.</>}
    </CoachCard>
  );
}
