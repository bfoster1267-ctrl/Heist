// What a game earned: XP lines counting in, the XP bar filling (and bursting on a level-up), coins, and
// anything newly unlocked. Slides in at the top so the table's own game-over buttons stay reachable.

import { rankOf, xpToNext, type RankedResult, type Reward } from "@heist/profile";
import { num, ordinal, t, tEn } from "../i18n";
import { cosName, rankLabel, rankTitle } from "../i18n/data";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { levelUp, lose as loseSound, win as winSound } from "../sound";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Coins } from "./bits";
import { useAccount } from "./useAccount";

export function Rewards({ onSave }: { onSave?: () => void }) {
  const { reward, showReward, me, backend } = useAccount();
  // guests on the live server get a nudge to keep what they just earned
  const save =
    onSave && me?.guest && backend?.kind === "server"
      ? () => {
          showReward(null);
          onSave();
        }
      : undefined;
  // guests get longer to tap the save button
  const stay = save ? 25_000 : 12_000;
  useEffect(() => {
    if (!reward) return;
    const tm = window.setTimeout(() => showReward(null), stay);
    return () => clearTimeout(tm);
  }, [reward, showReward, stay]);

  // a new rank (up or down) gets its own full-screen moment before the usual card
  const [moment, setMoment] = useState<RankedResult | null>(null);
  useEffect(() => {
    const r = reward?.ranked;
    if (r && rankOf(r.rpBefore).label !== rankOf(r.rpAfter).label) setMoment(r);
  }, [reward]);
  return (
    <>
      <AnimatePresence>{reward && <RewardCard key={JSON.stringify(reward.lines)} r={reward} onClose={() => showReward(null)} onSave={save} />}</AnimatePresence>
      <AnimatePresence>{moment && <RankMoment key="rank" r={moment} onClose={() => setMoment(null)} />}</AnimatePresence>
    </>
  );
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** Rank up or rank down: the badge, the new rank, and what moved it. Tap anywhere to close. */
function RankMoment({ r, onClose }: { r: RankedResult; onClose: () => void }) {
  const up = r.rpAfter > r.rpBefore;
  const from = rankOf(r.rpBefore);
  const to = rankOf(r.rpAfter);
  const reduce = reducedMotion();
  useEffect(() => {
    buzz(up ? "win" : "alert");
    if (up) winSound();
    else loseSound();
    const tm = window.setTimeout(onClose, 6000);
    return () => clearTimeout(tm);
  }, [up, onClose]);
  return (
    <motion.div className={"rank-moment " + (up ? "up" : "down")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-label={up ? t("rw.rankUpAria") : t("rw.rankDownAria")}>
      <motion.div className="rank-moment-kicker" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
        {up ? t("rw.rankUp") : t("rw.rankDown")}
      </motion.div>
      <div className="rank-moment-badges">
        <motion.div
          className={`rank-badge tier-${from.tier} old`}
          initial={{ scale: 1, opacity: 1 }}
          animate={reduce ? { opacity: 0.35 } : up ? { scale: [1, 1.1, 0.7], opacity: [1, 1, 0.35] } : { rotate: [0, -4, 4, -8, 0], scale: [1, 1, 0.7], opacity: [1, 1, 0.35] }}
          transition={{ duration: 0.9 }}
        >
          {rankLabel(from.label)}
        </motion.div>
        <motion.span className="rank-moment-arrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
          {up ? "▲" : "▼"}
        </motion.span>
        <motion.div
          className={`rank-badge tier-${to.tier} new`}
          initial={{ scale: reduce ? 1 : 0.2, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scale: [0.2, 1.25, 1], opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.7 }}
        >
          {up && !reduce && <span className="rank-burst" />}
          {rankLabel(to.label)}
        </motion.div>
      </div>
      <motion.div className="rank-moment-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
        {signed(r.rpAfter - r.rpBefore)} RP · MMR {num(r.mmrAfter)} ({signed(r.mmrAfter - r.mmrBefore)}) · {t("rw.finished", { place: ordinal(r.place), n: r.players })}
      </motion.div>
      <div className="rank-moment-tap">{t("rw.tap")}</div>
    </motion.div>
  );
}


/** Every ranked game: place, points and MMR on the reward card. */
function RankedStrip({ r }: { r: RankedResult }) {
  const moved = r.rpAfter - r.rpBefore;
  const to = rankOf(r.rpAfter);
  return (
    <div className={"acct-reward-ranked " + (moved > 0 ? "up" : moved < 0 ? "down" : "")}>
      <span>
        {t("rw.place", { place: ordinal(r.place), n: r.players })} · <b>{rankLabel(to.label)}</b>
      </span>
      <span>
        {signed(moved)} RP · MMR {num(r.mmrAfter)} ({signed(r.mmrAfter - r.mmrBefore)})
      </span>
      {r.held && <span className="dim">{r.held === "tier" ? t("rw.heldTier") : t("rw.heldFloor")}</span>}
    </div>
  );
}

function RewardCard({ r, onClose, onSave }: { r: Reward; onClose: () => void; onSave?: () => void }) {
  const leveled = r.levelAfter > r.levelBefore;
  // stage 0: fill the old level; stage 1: level-up burst and the new level's bar
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!leveled) return;
    const tm = window.setTimeout(() => {
      setStage(1);
      levelUp();
    }, 1300);
    return () => clearTimeout(tm);
  }, [leveled]);
  const lvl = stage === 1 ? r.levelAfter : r.levelBefore;
  const from = stage === 1 ? 0 : r.xpBefore / xpToNext(r.levelBefore);
  const to = leveled && stage === 0 ? 1 : r.xpAfter / xpToNext(r.levelAfter);
  return (
    <motion.div className="acct-reward" initial={{ y: -140, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -140, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} role="status">
      <button className="acct-close" onClick={onClose} aria-label={t("common.close")}>
        ✕
      </button>
      <div className="acct-reward-top">
        <motion.span className="acct-reward-xp" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
          +{r.xp} XP
        </motion.span>
        {r.coins > 0 && <Coins amount={r.coins} big />}
      </div>
      <div className="acct-reward-level">
        <span className="acct-reward-lv">{t("rw.lv", { n: lvl })}</span>
        <div className="acct-xp">
          <motion.div key={stage} className="acct-xp-fill" initial={{ width: `${from * 100}%` }} animate={{ width: `${Math.min(1, to) * 100}%` }} transition={{ duration: 1.1, ease: "easeOut" }} />
        </div>
      </div>
      <AnimatePresence>
        {leveled && stage === 1 && (
          <motion.div className="acct-levelup" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: [0.4, 1.15, 1], opacity: 1 }} transition={{ duration: 0.6 }}>
            <span className="acct-levelup-burst" />
            {t("rw.level", { n: r.levelAfter })} · {rankTitle(r.levelAfter).toUpperCase()}
          </motion.div>
        )}
      </AnimatePresence>
      {r.ranked && <RankedStrip r={r.ranked} />}
      <ul className="acct-reward-lines">
        {r.lines.map((l, i) => (
          <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.12 }}>
            <span>{tEn(l.label)}</span>
            <span className="acct-reward-amt">
              {l.xp ? `${l.xp > 0 ? "+" : ""}${l.xp} XP` : ""} {l.coins ? `+${l.coins}c` : ""}
            </span>
          </motion.li>
        ))}
      </ul>
      {r.unlocked.length > 0 && (
        <div className="acct-reward-unlock">
          {t("rw.unlocked", { items: r.unlocked.map((id) => cosName(id)).filter(Boolean).join(", ") })}
        </div>
      )}
      {r.pass && r.pass.xp > 0 && (
        <div className="acct-reward-season">
          <span>
            {t("rw.pass", { xp: r.pass.xp })}{` · ${t("rw.tier", { n: r.pass.tierAfter })}${r.pass.tierAfter > r.pass.tierBefore ? "!" : ""}`}
          </span>
          {r.pass.rewards.length > 0 && (
            <span className="acct-reward-season-got">
              {t("rw.got", {
                items: r.pass.rewards
                  .map((x) => (x.kind === "item" ? cosName(x.id) : x.kind === "coins" ? t("common.coins", { n: x.coins }) : t("rw.packs", { count: x.packs })))
                  .join(", "),
              })}
            </span>
          )}
        </div>
      )}
      {r.canPrestige && <div className="acct-reward-unlock">{t("rw.prestige")}</div>}
      {onSave && (
        <button className="btn primary acct-reward-save" onClick={onSave}>
          {t("rw.save")}

        </button>
      )}
    </motion.div>
  );
}
