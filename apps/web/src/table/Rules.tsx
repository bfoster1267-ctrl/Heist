// The rules on one sheet, open any time from the top bar. Short, in play order, with the words the
// table uses (Boss, Mark, Foothold, Pen) so a new player can match what they read to what they see.
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t, tRich, type TKey } from "../i18n";

const P = ({ k, n }: { k: TKey; n?: number }) => <p>{tRich(k, { n })}</p>;
const Li = ({ k, n }: { k: TKey; n?: number }) => <li>{tRich(k, { n })}</li>;

const TABS = [
  {
    id: "goal",
    label: "rules.tab.goal",
    body: (target: number) => (
      <>
        <P k="rules.goal.1" n={target} />
        <P k="rules.goal.2" />
        <P k="rules.goal.3" />
      </>
    ),
  },
  {
    id: "turn",
    label: "rules.tab.turn",
    body: () => (
      <>
        <P k="rules.turn.0" />
        <ol>
          <Li k="rules.turn.1" />
          <Li k="rules.turn.2" />
          <Li k="rules.turn.3" />
          <Li k="rules.turn.4" />
          <Li k="rules.turn.5" />
        </ol>
        <P k="rules.turn.bust" />
      </>
    ),
  },
  {
    id: "fight",
    label: "rules.tab.fight",
    body: () => (
      <>
        <P k="rules.fight.1" />
        <P k="rules.fight.2" />
        <P k="rules.fight.3" />
        <P k="rules.fight.4" />
      </>
    ),
  },
  {
    id: "cards",
    label: "rules.tab.cards",
    body: () => (
      <>
        <P k="rules.cards.0" />
        <ul>
          <Li k="rules.cards.S" />
          <Li k="rules.cards.F" />
          <Li k="rules.cards.B" />
          <Li k="rules.cards.X" />
          <Li k="rules.cards.role" />
        </ul>
        <P k="rules.cards.pay" />
      </>
    ),
  },
  {
    id: "table",
    label: "rules.tab.table",
    body: (target: number) => (
      <>
        <ul>
          <Li k="rules.table.1" />
          <Li k="rules.table.2" />
          <Li k="rules.table.3" n={target} />
          <Li k="rules.table.4" />
          <Li k="rules.table.5" />
        </ul>
        <P k="rules.table.6" />
      </>
    ),
  },
] satisfies { id: string; label: TKey; body: (target: number) => React.ReactNode }[];

export function Rules({ target, onClose, fixed }: { target: number; onClose: () => void; fixed?: boolean }) {
  const [tab, setTab] = useState(TABS[0].id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const cur = TABS.find((x) => x.id === tab)!;
  const sheet = (
    <motion.div className={"modal-back rules-back" + (fixed ? " fixed" : "")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="rules"
        role="dialog"
        aria-label={t("rules.title")}
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rules-head">
          <span className="rules-title">{t("rules.title")}</span>
          <button className="btn small rules-close" onClick={onClose} autoFocus>
            ✕ {t("common.close")}
          </button>
        </div>
        <div className="rules-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
              {t(x.label)}
            </button>
          ))}
        </div>
        <div className="rules-body" role="tabpanel">
          {cur.body(target)}

        </div>
      </motion.div>
    </motion.div>
  );
  // Outside the table (the lobby), cover the whole window rather than a transformed parent.
  return fixed ? createPortal(sheet, document.body) : sheet;
}
