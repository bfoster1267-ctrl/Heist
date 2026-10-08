// The rules on one sheet, open any time from the top bar. Short, in play order, with the words the
// table uses (Boss, Mark, Foothold, Pen) so a new player can match what they read to what they see.
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const TABS = [
  {
    id: "goal",
    label: "Goal",
    body: (target: number) => (
      <>
        <p>
          <b>Win with {target} Footholds.</b> A Foothold is one of your crew living in a rival's hideout. The diamonds on each seat count them.
        </p>
        <p>Everyone starts with 3 hideouts of 3 crew at home, plus 3 spare crew.</p>
        <p>
          <b>Last Call:</b> the third time the Job deck runs out, the game ends. Most Footholds wins; a tie goes to the most cash.
        </p>
      </>
    ),
  },
  {
    id: "turn",
    label: "Your turn",
    body: () => (
      <>
        <p>When you hold the Boss badge, it's your turn:</p>
        <ol>
          <li>
            <b>Regroup.</b> Draw 2. One crew leaves the Pen. Bank up to 2 cards as cash. Hire up to 2 crew for $3 each.
          </li>
          <li>
            <b>Hit.</b> Flip a Job card: its color is the <b>Mark</b> you rob. Pick one of their hideouts.
          </li>
          <li>
            <b>Crew up.</b> Send 1 to 4 crew. Everyone else may join either side.
          </li>
          <li>
            <b>Showdown.</b> Boss and Mark each lay a card face down, then flip.
          </li>
          <li>
            Won? You may hit once more. Then the Boss badge passes left.
          </li>
        </ol>
        <p>
          <b>Bust</b> instead of a hit: fight a rival's crew sitting in one of your own hideouts.
        </p>
      </>
    ),
  },
  {
    id: "fight",
    label: "The fight",
    body: () => (
      <>
        <p>
          <b>Total = card + crew on your side.</b> The Mark gets +5 for home turf, and ties go to the Mark.
        </p>
        <p>
          <b>Boss wins:</b> each Boss-side player leaves 1 crew there as a Foothold. The Mark's side goes to the Pen, and the Mark pays $3 loot.
        </p>
        <p>
          <b>Mark wins:</b> the Boss side goes to the Pen. Each Mark ally banks a card (their Cut).
        </p>
        <p>
          <b>Score beats Fixer.</b> Fixer vs Fixer: make a deal, or both send 2 crew to the Pen.
        </p>
      </>
    ),
  },
  {
    id: "cards",
    label: "Cards",
    body: () => (
      <>
        <p>Every card is a fighter or money. The green coin in its corner is its cash value when banked.</p>
        <ul>
          <li>
            <b>Score</b> (big number): fight with it.
          </li>
          <li>
            <b>Fixer</b>: loses to any Score; two Fixers make a deal.
          </li>
          <li>
            <b>Backup</b>: +3 to either side after the flip.
          </li>
          <li>
            <b>Double-Cross</b>: make one ally switch sides.
          </li>
          <li>
            <b>Role</b>: your one rule-breaking power. Long-press a role name to read it.
          </li>
        </ul>
        <p>You pay with banked cards and get no change.</p>
      </>
    ),
  },
  {
    id: "table",
    label: "Reading the table",
    body: (target: number) => (
      <>
        <ul>
          <li>
            <b>Cards</b>: cards in hand. <b>Cash</b>: banked money.
          </li>
          <li>
            <b>Home</b>: your crew in your own hideouts. <b>Pen</b>: caught crew. <b>Spare</b>: crew you can hire.
          </li>
          <li>
            <b>Footholds 0/{target}</b>: progress to the win.
          </li>
          <li>
            <b>Hideouts 1 to 3</b>: whose crew are inside. A gold ring marks a rival's Foothold.
          </li>
          <li>
            <b>BOSS</b> and <b>MARK</b> badges show who is fighting. The glowing seat is the one acting.
          </li>
        </ul>
        <p>Long-press (or hover) anything on the table to see what it is.</p>
      </>
    ),
  },
];

export function Rules({ target, onClose, fixed }: { target: number; onClose: () => void; fixed?: boolean }) {
  const [tab, setTab] = useState(TABS[0].id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const t = TABS.find((x) => x.id === tab)!;
  const sheet = (
    <motion.div className={"modal-back rules-back" + (fixed ? " fixed" : "")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="rules"
        role="dialog"
        aria-label="How to play"
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rules-head">
          <span className="rules-title">How to play</span>
          <button className="btn small rules-close" onClick={onClose} autoFocus>
            ✕ Close
          </button>
        </div>
        <div className="rules-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="rules-body" role="tabpanel">
          {t.body(target)}
        </div>
      </motion.div>
    </motion.div>
  );
  // Outside the table (the lobby), cover the whole window rather than a transformed parent.
  return fixed ? createPortal(sheet, document.body) : sheet;
}
