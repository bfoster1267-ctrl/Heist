import { passTrack, seasonById, xpToNext, type Reward } from "@heist/profile";
import { motion } from "motion/react";
import { Track } from "./Season";
import { t } from "../i18n";

/** How many pass tiers the card shows (four fit the table's modal without scrolling). */
const SHOWN = 4;

export function FirstWin({ r, won, name, onNext }: { r: Reward; won: boolean; name: string; onNext: () => void }) {
  const season = r.pass ? seasonById(r.pass.season) : null;
  const from = r.xpBefore / xpToNext(r.levelBefore);
  const to = r.levelAfter > r.levelBefore ? 1 : r.xpAfter / xpToNext(r.levelAfter);
  return (
    <>
      <div id="go-title" className="modal-title gold">
        {won ? t("rewards.you_pulled_it_off") : t("rewards.thats_a_hand")}
      </div>
      <div className="first-win-xp">
        <motion.span className="acct-reward-xp" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
          +{r.xp} XP
        </motion.span>
        <div className="acct-xp">
          <motion.div className="acct-xp-fill" initial={{ width: `${from * 100}%` }} animate={{ width: `${Math.min(1, to) * 100}%` }} transition={{ duration: 1.1, ease: "easeOut", delay: 0.3 }} />
        </div>
      </div>
      {season && r.pass && (
        <motion.div className="first-win-pass" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}>
          <div className="first-win-pass-head">
            {t("rewards.tier_unlocked", { tier: r.pass.tierAfter })}
          </div>
          <Track rewards={passTrack(season).slice(0, SHOWN)} tier={r.pass.tierAfter} name={name} />
          <div className="dim">{season.name} · 50 tiers</div>
        </motion.div>
      )}
      <div className="btns center">
        <button className="btn primary big" onClick={onNext} autoFocus>
          {t("rewards.show_around")}
        </button>
      </div>
    </>
  );
}
