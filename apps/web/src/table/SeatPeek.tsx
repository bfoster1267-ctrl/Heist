// Press and hold a seat: a small card with who's sitting there. A player shows their level, rank and
// record; a bot shows how hard it plays. It never covers your turn: the table closes it when you're up.
import { BOT_RATING, winRate, type PublicProfile } from "@heist/profile";
import type { BotLevel, BotOptions } from "@heist/engine";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useAccountMaybe } from "../account/useAccount";
import { CrewBadge } from "./pieces";

export type PeekWho =
  | { kind: "player"; name: string; color: number; userId: string | null; me: boolean }
  | { kind: "bot"; name: string; color: number; bot: BotOptions; level: BotLevel };

const LEVEL_NAME: Record<BotLevel, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const LEVEL_LINE: Record<BotLevel, string> = {
  easy: "Plays loose and makes mistakes. A good table to learn on.",
  normal: "Plays a solid, steady game.",
  hard: "Plays sharp, holds grudges and spots teams.",
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function SeatPeek({ who, onClose, onProfile }: { who: PeekWho; onClose: () => void; onProfile?: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <motion.div className="peek-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="peek" role="dialog" aria-label={`${who.name}'s stats`} initial={{ y: 14, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 14, opacity: 0 }}>
        <button className="peek-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="peek-head">
          <CrewBadge color={who.color} size={40} />
          <div className="peek-name">{who.name}</div>
        </div>
        {who.kind === "bot" ? <BotBody who={who} /> : <PlayerBody who={who} onProfile={onProfile} />}
      </motion.div>
    </motion.div>
  );
}

function BotBody({ who }: { who: Extract<PeekWho, { kind: "bot" }> }) {
  const b = who.bot;
  return (
    <>
      <div className="peek-tags">
        <span className="peek-tag bot">BOT</span>
      </div>
      <div className="peek-tiles">
        <Tile k="Difficulty" v={LEVEL_NAME[who.level]} tone={`lvl-${who.level}`} />
        <Tile k="Skill rating" v={String(BOT_RATING[who.level])} />
      </div>
      <div className="peek-line">{b.soft != null ? "Goes easy on new players." : LEVEL_LINE[who.level]}</div>
      {b.patient && <div className="peek-line dim">Patient: waits for a big hand before it hits.</div>}
      {b.vendetta && who.level !== "hard" && <div className="peek-line dim">Holds grudges against whoever beats it.</div>}
    </>
  );
}

function PlayerBody({ who, onProfile }: { who: Extract<PeekWho, { kind: "player" }>; onProfile?: () => void }) {
  const acct = useAccountMaybe();
  const mine = who.me && acct?.me ? acct.me.profile : null;
  const [p, setP] = useState<PublicProfile | null>(mine);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (mine || !who.userId || !acct?.backend) return;
    let live = true;
    acct.backend.player(who.userId).then(
      (x) => live && setP(x),
      () => live && setErr(true),
    );
    return () => {
      live = false;
    };
  }, [who.userId, acct?.backend, mine]);
  if (!p) return <div className="peek-line dim">{err || !who.userId || !acct?.backend ? "A guest. No stats yet." : "Loading…"}</div>;
  const s = p.stats;
  const ranked = p.ranked;
  return (
    <>
      <div className="peek-tags">
        <span className="peek-tag">Level {p.level}</span>
        {ranked && ranked.games > 0 && <span className={`peek-tag tier-${ranked.tier}`}>{ranked.label}</span>}
      </div>
      <div className="peek-tiles">
        <Tile k="Games" v={s.games.toLocaleString()} />
        <Tile k="Win rate" v={s.games ? pct(winRate(s)) : "–"} />
        <Tile k="Streak" v={s.streak > 0 ? `${s.streak}W` : s.streak < 0 ? `${-s.streak}L` : "–"} />
      </div>
      {onProfile && !who.me && (
        <button className="btn small peek-more" onClick={onProfile}>
          Full profile
        </button>
      )}
    </>
  );
}

function Tile({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className={"peek-tile" + (tone ? ` ${tone}` : "")}>
      <b>{v}</b>
      <span>{k}</span>
    </div>
  );
}
