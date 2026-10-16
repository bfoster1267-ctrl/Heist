// The end of a new player's first hand: the win, the XP it earned, and season pass tier 1 opening up,
// with the next few tiers in view. Then on to the lobby tour.

import { passTrack, seasonById, xpToNext, type Reward } from "@heist/profile";
import { motion } from "motion/react";
import { Track } from "./Season";
import { t, tEn, tRich } from "../i18n";

/** How many pass tiers the card shows (four fit the table's modal without scrolling). */
const SHOWN = 4;

export function FirstWin({ r, won, name, onNext }: { r: Reward; won: boolean; name: string; onNext: () => void }) {
  const season = r.pass ? seasonById(r.pass.season) : null;
  const from = r.xpBefore / xpToNext(r.levelBefore);
  const to = r.levelAfter > r.levelBefore ? 1 : r.xpAfter / xpToNext(r.levelAfter);
  return (
    <>
      <div id="go-title" className="modal-title gold">
        {won ? t("fw.won") : t("fw.played")}
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
            {tRich("fw.tier", { n: r.pass.tierAfter })}
          </div>
          <Track rewards={passTrack(season).slice(0, SHOWN)} tier={r.pass.tierAfter} name={name} />
          <div className="dim">{t("fw.every", { season: tEn(season.name) })}</div>
        </motion.div>
      )}
      <div className="btns center">
        <button className="btn primary big" onClick={onNext} autoFocus>
          {t("fw.next")}

        </button>
      </div>
    </>
  );
}
