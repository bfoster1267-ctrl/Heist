// The rules on one sheet, open any time from the top bar. Short, in play order, with the words the
// table uses (Boss, Mark, Foothold, Pen) so a new player can match what they read to what they see.
// Fully localized with pluggable i18n support.

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t, useLanguage } from "../i18n";

export function Rules({ target, onClose, fixed }: { target: number; onClose: () => void; fixed?: boolean }) {
  // Subscribe to language change so the sheet instantly updates if language changes
  useLanguage();

  const [tab, setTab] = useState("goal");

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const tabs = [
    {
      id: "goal",
      label: t("rules.tab.goal", "Goal"),
      body: (
        <>
          <p>
            <b>{t("rules.goal.win", { target })}</b>
          </p>
          <p>{t("rules.goal.start")}</p>
          <p>
            <b>{t("rules.goal.last_call")}</b>
          </p>
        </>
      ),
    },
    {
      id: "turn",
      label: t("rules.tab.turn", "Your turn"),
      body: (
        <>
          <p>{t("rules.turn.head")}</p>
          <ol>
            <li>{t("rules.turn.step1")}</li>
            <li>{t("rules.turn.step2")}</li>
            <li>{t("rules.turn.step3")}</li>
            <li>{t("rules.turn.step4")}</li>
            <li>{t("rules.turn.step5")}</li>
          </ol>
          <p>
            <b>{t("rules.turn.bust")}</b>
          </p>
        </>
      ),
    },
    {
      id: "fight",
      label: t("rules.tab.fight", "The fight"),
      body: (
        <>
          <p>
            <b>{t("rules.fight.total")}</b>
          </p>
          <p>
            <b>{t("rules.fight.boss_wins")}</b>
          </p>
          <p>
            <b>{t("rules.fight.mark_wins")}</b>
          </p>
          <p>
            <b>{t("rules.fight.fixer")}</b>
          </p>
        </>
      ),
    },
    {
      id: "cards",
      label: t("rules.tab.cards", "Cards"),
      body: (
        <>
          <p>{t("rules.cards.desc")}</p>
          <ul>
            <li>{t("rules.cards.score")}</li>
            <li>{t("rules.cards.fixer")}</li>
            <li>{t("rules.cards.backup")}</li>
            <li>{t("rules.cards.double_cross")}</li>
            <li>{t("rules.cards.role")}</li>
          </ul>
          <p>{t("rules.cards.pay")}</p>
        </>
      ),
    },
    {
      id: "table",
      label: t("rules.tab.table", "Reading the table"),
      body: (
        <>
          <ul>
            <li>{t("rules.table.cards_cash")}</li>
            <li>{t("rules.table.crew")}</li>
            <li>{t("rules.table.footholds", { target })}</li>
            <li>{t("rules.table.hideouts")}</li>
            <li>{t("rules.table.badges")}</li>
          </ul>
          <p>{t("rules.table.long_press")}</p>
        </>
      ),
    },
  ];

  const currentTab = tabs.find((x) => x.id === tab) ?? tabs[0];

  const sheet = (
    <motion.div
      className={"modal-back rules-back" + (fixed ? " fixed" : "")}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="rules"
        role="dialog"
        aria-label={t("rules.title", "How to play")}
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rules-head">
          <span className="rules-title">{t("rules.title", "How to play")}</span>
          <button className="btn small rules-close" onClick={onClose} autoFocus>
            ✕ {t("common.close", "Close")}
          </button>
        </div>
        <div className="rules-tabs" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={tab === x.id}
              className={tab === x.id ? "on" : ""}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="rules-body" role="tabpanel">
          {currentTab.body}
        </div>
      </motion.div>
    </motion.div>
  );

  // Outside the table (the lobby), cover the whole window rather than a transformed parent.
  return fixed ? createPortal(sheet, document.body) : sheet;
}
