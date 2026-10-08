// What a game earned: XP lines counting in, the XP bar filling (and bursting on a level-up), coins, and
// anything newly unlocked. Slides in at the top so the table's own game-over buttons stay reachable.

import { cosmetic, rankName, xpToNext, type Reward } from "@heist/profile";
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
    const t = window.setTimeout(() => showReward(null), stay);
    return () => clearTimeout(t);
  }, [reward, showReward, stay]);

  return <AnimatePresence>{reward && <RewardCard key={JSON.stringify(reward.lines)} r={reward} onClose={() => showReward(null)} onSave={save} />}</AnimatePresence>;
}

function RewardCard({ r, onClose, onSave }: { r: Reward; onClose: () => void; onSave?: () => void }) {
  const leveled = r.levelAfter > r.levelBefore;
  // stage 0: fill the old level; stage 1: level-up burst and the new level's bar
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!leveled) return;
    const t = window.setTimeout(() => setStage(1), 1300);
    return () => clearTimeout(t);
  }, [leveled]);
  const lvl = stage === 1 ? r.levelAfter : r.levelBefore;
  const from = stage === 1 ? 0 : r.xpBefore / xpToNext(r.levelBefore);
  const to = leveled && stage === 0 ? 1 : r.xpAfter / xpToNext(r.levelAfter);
  return (
    <motion.div className="acct-reward" initial={{ y: -140, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -140, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} role="status">
      <button className="acct-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <div className="acct-reward-top">
        <motion.span className="acct-reward-xp" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
          +{r.xp} XP
        </motion.span>
        {r.coins > 0 && <Coins amount={r.coins} big />}
      </div>
      <div className="acct-reward-level">
        <span className="acct-reward-lv">Lv {lvl}</span>
        <div className="acct-xp">
          <motion.div key={stage} className="acct-xp-fill" initial={{ width: `${from * 100}%` }} animate={{ width: `${Math.min(1, to) * 100}%` }} transition={{ duration: 1.1, ease: "easeOut" }} />
        </div>
      </div>
      <AnimatePresence>
        {leveled && stage === 1 && (
          <motion.div className="acct-levelup" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: [0.4, 1.15, 1], opacity: 1 }} transition={{ duration: 0.6 }}>
            <span className="acct-levelup-burst" />
            LEVEL {r.levelAfter} · {rankName(r.levelAfter).toUpperCase()}
          </motion.div>
        )}
      </AnimatePresence>
      <ul className="acct-reward-lines">
        {r.lines.map((l, i) => (
          <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.12 }}>
            <span>{l.label}</span>
            <span className="acct-reward-amt">
              {l.xp ? `+${l.xp} XP` : ""} {l.coins ? `+${l.coins}c` : ""}
            </span>
          </motion.li>
        ))}
      </ul>
      {r.unlocked.length > 0 && (
        <div className="acct-reward-unlock">
          Unlocked: {r.unlocked.map((id) => cosmetic(id)?.name).filter(Boolean).join(", ")}. Equip in the Shop.
        </div>
      )}
      {r.canPrestige && <div className="acct-reward-unlock">Level 50! You can prestige from your profile.</div>}
      {onSave && (
        <button className="btn primary acct-reward-save" onClick={onSave}>
          Save my career: free account
        </button>
      )}
    </motion.div>
  );
}
