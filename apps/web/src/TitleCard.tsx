import type { Card } from "@heist/engine";
import { motion } from "motion/react";
import { useEffect } from "react";
import { CardFace } from "./table/pieces";
import { Keyhole } from "./table/icons";
import { t } from "./i18n";
import { click } from "./sound";
import { buzz } from "./haptics";

// the hand fanned under the headline: real Job cards, same faces as at the table
const FAN: Card[] = [
  { id: 1, kind: "S", score: 12, cash: 4, color: 0 },
  { id: 2, kind: "X", score: 0, cash: 2, color: 4 },
  { id: 3, kind: "S", score: 20, cash: 5, color: 3 },
  { id: 4, kind: "F", score: 0, cash: 3, color: 1 },
];
const TILT = [-15, -5, 5, 15];

/** A first visit's one-tap front door: who we are, a hook and one Play button, then the coached first hand. */
export function TitleCard({ onPlay }: { onPlay: () => void }) {
  // the cookie banner waits: the line under the button says the same thing
  useEffect(() => {
    document.body.classList.add("title-card-open");
    return () => document.body.classList.remove("title-card-open");
  }, []);
  const play = () => {
    click();
    buzz("tap");
    try {
      localStorage.setItem("heist.cookieConsent", "1");
    } catch {
      /* fine without */
    }
    window.dispatchEvent(new Event("heist:consent"));
    onPlay();
  };
  return (
    <div className="title-card">
      <motion.div className="tc-brand" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <span className="tc-key">
          <Keyhole size={92} />
        </span>
        <h1 className="tc-logo">HEIST</h1>
      </motion.div>
      <motion.h2 className="tc-head" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.4 }}>
        {t("title.head1", "Trust no one.")}
        <br />
        {t("title.head2", "Take the score.")}
      </motion.h2>
      <p className="tc-tag">{t("title.tag", "A card game of crews, jobs and betrayal. Learn it in one hand.")}</p>
      <div className="tc-fan" aria-hidden>
        {FAN.map((c, i) => (
          <motion.span
            key={c.id}
            className="tc-fan-card"
            initial={{ opacity: 0, y: 40, rotate: 0, x: "-50%" }}
            animate={{ opacity: 1, y: Math.abs(TILT[i]) * 0.8, rotate: TILT[i], x: `${-50 + (i - 1.5) * 40}%` }}
            transition={{ delay: 0.25 + i * 0.07, type: "spring", stiffness: 160, damping: 18 }}
          >
            <span className="tc-fan-inner">
              <CardFace card={c} size="lg" />
            </span>
          </motion.span>
        ))}
      </div>
      <div className="tc-cta">
        <button type="button" className="tc-play" onClick={play} autoFocus>
          {t("title.play", "Play free")}
        </button>
        <p className="tc-small">{t("title.small", "3-minute hand · No download · No sign-up")}</p>
      </div>
      <p className="tc-cookie">
        {t("title.cookie", "Cookies keep your progress. Playing means you're OK with our")}{" "}
        <a href="./terms.html" target="_blank" rel="noreferrer">
          {t("title.terms", "Terms")}
        </a>{" "}
        &amp;{" "}
        <a href="./privacy.html" target="_blank" rel="noreferrer">
          {t("title.privacy", "Privacy")}
        </a>
        .
      </p>
    </div>
  );
}
