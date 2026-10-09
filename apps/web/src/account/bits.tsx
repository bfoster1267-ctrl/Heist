// Small pieces of the player's identity: avatar with frame and level, prestige stars, XP bar, coins.

import { MAX_PRESTIGE, cosmetic, levelInfo, prestigeName, rankName } from "@heist/profile";
import { motion } from "motion/react";
import type { Me } from "./backend";
import { Chips } from "../table/pieces";

export function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? "?") + (w[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ name, frame, level, size = 56 }: { name: string; frame: string; level?: number; size?: number }) {
  const c = cosmetic(frame)?.colors;
  return (
    <span className={"acct-avatar" + (c ? " framed" : "")} style={{ width: size, height: size, fontSize: size * 0.38, ...(c ? { ["--ring" as string]: c[0], ["--ring2" as string]: c[1] } : {}) }}>
      <span className="acct-avatar-face">{initials(name)}</span>
      {level !== undefined && <span className="acct-avatar-level">{level}</span>}
    </span>
  );
}

export function Stars({ prestige, size = 14 }: { prestige: number; size?: number }) {
  if (!prestige) return null;
  return (
    <span className="acct-stars" title={prestigeName(prestige)} style={{ fontSize: size }}>
      {prestige >= MAX_PRESTIGE ? "★ LEGEND ★" : "★".repeat(prestige)}
    </span>
  );
}

export function XpBar({ xp, from }: { xp: number; from?: number }) {
  const li = levelInfo(xp);
  return (
    <div className="acct-xp" title={li.maxed ? "Max level: prestige to start again with a star" : `${li.into.toLocaleString()} / ${li.need.toLocaleString()} XP`}>
      <motion.div className="acct-xp-fill" initial={{ width: `${(from ?? li.pct) * 100}%` }} animate={{ width: `${li.pct * 100}%` }} transition={{ duration: 1.1, ease: "easeOut" }} />
      <span className="acct-xp-text">{li.maxed ? "MAX" : `${li.into.toLocaleString()} / ${li.need.toLocaleString()} XP`}</span>
    </div>
  );
}

export function Coins({ amount, big }: { amount: number; big?: boolean }) {
  return (
    <span className={"acct-coins" + (big ? " big" : "")} title="Coins: earned by playing, spent on cosmetics and drinks">
      <span className="acct-coin" />
      {amount.toLocaleString()}
    </span>
  );
}

/** The player's corner of the lobby: avatar, name, rank, XP, chips and coins. Click for the full profile. */
export function ProfileChip({ me, onOpen }: { me: Me; onOpen: () => void }) {
  const p = me.progress;
  const li = levelInfo(p.xp);
  return (
    <button className="acct-chip" onClick={onOpen} aria-label="Open your profile and career stats">
      <Avatar name={me.name} frame={p.equipped.frame} level={li.level} size={46} />
      <span className="acct-chip-body">
        <span className="acct-chip-name">
          {me.name} <Stars prestige={p.prestige} size={11} />
        </span>
        <span className="acct-chip-rank">
          {rankName(li.level)}
          {me.guest ? " · Guest" : ""}
        </span>
        <XpBar xp={p.xp} />
      </span>
      <span className="acct-chip-money">
        <Chips amount={p.chips} small />
        <Coins amount={p.coins} />
      </span>
    </button>
  );
}
