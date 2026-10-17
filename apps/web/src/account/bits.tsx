// Small pieces of the player's identity: avatar with frame and level, prestige stars, XP bar, coins.

import { MAX_PRESTIGE, cosmetic, levelInfo, prestigeName } from "@heist/profile";
import { motion } from "motion/react";
import type { Me } from "./backend";
import { Chips } from "../table/pieces";
import { t } from "../i18n";
import { prestigeLabel, rankLabel } from "./Profile";

export function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? "?") + (w[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ name, frame, level, size = 56 }: { name: string; frame: string; level?: number; size?: number }) {
  const c = cosmetic(frame)?.colors;
  const isVaultCrown = frame === "frame.vault_crown";
  const isCyberNeon = frame === "frame.cyber_neon";
  const isInferno = frame === "frame.inferno";
  const frameClass = isVaultCrown
    ? " framed framed-vault_crown"
    : isCyberNeon
    ? " framed framed-cyber_neon"
    : isInferno
    ? " framed framed-inferno"
    : c
    ? " framed"
    : "";
  return (
    <span className={"acct-avatar" + frameClass} style={{ width: size, height: size, fontSize: size * 0.38, ...(c ? { ["--ring" as string]: c[0], ["--ring2" as string]: c[1] } : {}) }}>
      {isVaultCrown && <span className="avatar-crown-overlay" aria-hidden="true">👑</span>}
      <span className="acct-avatar-face">{initials(name)}</span>
      {level !== undefined && <span className="acct-avatar-level">{level}</span>}
    </span>
  );
}

export function Stars({ prestige, size = 14 }: { prestige: number; size?: number }) {
  if (!prestige) return null;
  return (
    <span className="acct-stars" title={prestigeLabel(prestige)} style={{ fontSize: size }}>
      {prestige >= MAX_PRESTIGE ? t("rank.legend_badge") : "★".repeat(prestige)}
    </span>
  );
}

export function XpBar({ xp, from }: { xp: number; from?: number }) {
  const li = levelInfo(xp);
  return (
    <div className="acct-xp" title={li.maxed ? t("account.xp_max") : `${li.into.toLocaleString()} / ${li.need.toLocaleString()} XP`}>
      <motion.div className="acct-xp-fill" initial={{ width: `${(from ?? li.pct) * 100}%` }} animate={{ width: `${li.pct * 100}%` }} transition={{ duration: 1.1, ease: "easeOut" }} />
      <span className="acct-xp-text">{li.maxed ? "MAX" : `${li.into.toLocaleString()} / ${li.need.toLocaleString()} XP`}</span>
    </div>
  );
}

export function Coins({ amount, big }: { amount: number; big?: boolean }) {
  return (
    <span className={"acct-coins" + (big ? " big" : "")} title={t("account.coins_tooltip")}>
      <span className="acct-coin" />
      {amount.toLocaleString()}
    </span>
  );
}

/** The player's corner of the lobby: avatar, name, rank, XP, chips and coins. Click for the full profile. */
export function ProfileChip({ me, packs = 0, onOpen }: { me: Me; packs?: number; onOpen: () => void }) {
  const p = me.progress;
  const li = levelInfo(p.xp);
  return (
    <button className="acct-chip" onClick={onOpen} aria-label={packs ? t("account.chip_pack_waiting") : t("account.chip_open")}>
      <Avatar name={me.name} frame={p.equipped.frame} level={li.level} size={46} />
      <span className="acct-chip-body">
        <span className="acct-chip-name">
          {me.name} <Stars prestige={p.prestige} size={11} />
        </span>
        <span className="acct-chip-rank">
          {rankLabel(li.level)}
          {me.guest ? ` · ${t("account.guest")}` : ""}
        </span>
        <XpBar xp={p.xp} />
      </span>
      <span className="acct-chip-money">
        <Chips amount={p.chips} small />
        <Coins amount={p.coins} />
      </span>
      {packs > 0 && <span className="acct-chip-dot" title={packs === 1 ? t("account.pack_waiting_one") : t("account.pack_waiting_many", { count: packs })} />}
    </button>
  );
}
