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

export function CoinIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`currency-icon coin-icon ${className}`}
      style={{ verticalAlign: "-0.16em", display: "inline-block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="heistCoinGlow" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff9db" />
          <stop offset="40%" stopColor="#f59e0b" />
          <stop offset="85%" stopColor="#b45309" />
          <stop offset="100%" stopColor="#78350f" />
        </radialGradient>
        <linearGradient id="heistCoinRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="url(#heistCoinGlow)" stroke="url(#heistCoinRim)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="#78350f" strokeWidth="0.8" strokeDasharray="1.5 1" opacity="0.65" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="#fef08a" strokeWidth="0.8" opacity="0.8" />
      <text x="12" y="15.2" textAnchor="middle" fill="#451a03" fontSize="9" fontWeight="900" fontFamily="system-ui, sans-serif">H</text>
    </svg>
  );
}

export function ChipIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`currency-icon chip-icon ${className}`}
      style={{ verticalAlign: "-0.16em", display: "inline-block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="heistChipBg" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f87171" />
          <stop offset="55%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#991b1b" />
        </radialGradient>
        <linearGradient id="heistChipRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="url(#heistChipBg)" stroke="url(#heistChipRim)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="8.7" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeDasharray="3 3.1" opacity="0.95" />
      <circle cx="12" cy="12" r="6" fill="#18181b" stroke="#ffffff" strokeWidth="0.8" />
      <circle cx="12" cy="12" r="4.6" fill="none" stroke="#fca5a5" strokeWidth="0.6" />
      <text x="12" y="15" textAnchor="middle" fill="#fef2f2" fontSize="8.5" fontWeight="900" fontFamily="system-ui, sans-serif">H</text>
    </svg>
  );
}

export function Coins({ amount, big }: { amount: number; big?: boolean }) {
  return (
    <span className={"acct-coins" + (big ? " big" : "")} title={t("account.coins_tooltip")}>
      <CoinIcon size={big ? 20 : 16} />
      {amount.toLocaleString()}
    </span>
  );
}

/** The player's corner of the lobby: avatar, name, rank, XP, chips and coins. Click for the full profile. */
export function ProfileChip({ me, packs = 0, onOpen, onOpenShop }: { me: Me; packs?: number; onOpen: () => void; onOpenShop?: () => void }) {
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
      <span
        className="acct-chip-money"
        onClick={(e) => {
          if (onOpenShop) {
            e.stopPropagation();
            onOpenShop();
          }
        }}
        title="Open Shop & Stashes"
      >
        <Chips amount={p.chips} small />
        <Coins amount={p.coins} />
      </span>
      {packs > 0 && <span className="acct-chip-dot" title={packs === 1 ? t("account.pack_waiting_one") : t("account.pack_waiting_many", { count: packs })} />}
    </button>
  );
}
