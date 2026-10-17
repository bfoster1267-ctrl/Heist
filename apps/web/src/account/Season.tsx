// The season: the pass track (season XP, tier by tier) and packs to open or buy with chips. Season items
// are worn from the Wardrobe. All of it sits beside career XP and levels; nothing here changes the game.

import {
  PACK_KEEP, PACK_PRICE, PASS_TIERS, TIER_XP, cosmetic, currentPass, passTrack, rarityOf, seasonAt, seasonOwned,
  tierOf, type Slot, type TierReward,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reducedMotion } from "../prefs";
import { Chips } from "../table/pieces";
import type { Me } from "./backend";
import { Coins } from "./bits";
import { Preview, RarityBadge } from "./items";
import { useAccount } from "./useAccount";
import { t } from "../i18n";

const SLOT_NAMES: [Slot, string][] = [
  ["felt", "wardrobe.cat.felt"],
  ["cardBack", "wardrobe.cat.cardBack"],
  ["frame", "wardrobe.cat.frame"],
  ["title", "wardrobe.cat.title"],
  ["chat", "wardrobe.cat.finery"],
  ["banner", "wardrobe.cat.finery"],
  ["cigar", "shop.cigar"],
  ["emote", "wardrobe.cat.collected"],
  ["drink", "wardrobe.cat.collected"],
];
export const slotLabel = (s: Slot) => {
  const k = SLOT_NAMES.find(([slot]) => slot === s)?.[1];
  return k ? t(k) : s;
};

export function Season({ me, onWardrobe }: { me: Me; onWardrobe?: () => void }) {
  const { act } = useAccount();
  const p = me.progress;
  const now = Date.now();
  const season = seasonAt(now);
  const [opened, setOpened] = useState<{ items: string[]; dupeXp: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // decided once when the tab opens: the first time, the track sweeps to the prize
  const [sweep] = useState(() => !swept());
  if (!season)
    return (
      <div className="acct-empty">
        <div className="acct-empty-big">{t("season.between_seasons_title")}</div>
        {t("season.between_seasons_desc")}
      </div>
    );
  const pass = currentPass(p, now)!;
  const tier = tierOf(pass.xp);
  const maxed = tier >= PASS_TIERS;
  const into = maxed ? TIER_XP : pass.xp % TIER_XP;
  const days = Math.max(0, Math.ceil((season.end - now) / 86_400_000));
  const owned = seasonOwned(p, season);
  const canBuy = p.chips >= PACK_PRICE + PACK_KEEP;

  const open = async (paid: boolean) => {
    setBusy(true);
    const r = await act((b) => b.openPack(paid));
    setBusy(false);
    if (r) setOpened({ items: r.items, dupeXp: r.dupeXp });
  };

  return (
    <div className="season">
      <div className="season-top">
        <div className="season-top-copy">
          <div className="season-kicker">{t("season.vip_pass")}</div>
          <div className="season-name">{t("season.name", { id: season.id, name: season.name })}</div>
          <div className="dim">
            {t("season.days_left", {
              days,
              plural: days === 1 ? "" : "s",
              have: owned.have,
              total: owned.of,
            })}
          </div>
        </div>
        <div className="season-tier">
          <span className="season-tier-lbl">{t("season.tier")}</span>
          <span className="season-tier-n">{tier}</span>
          <span className="dim">{t("season.of_tiers", { total: PASS_TIERS })}</span>
        </div>
      </div>
      <div className="acct-xp season-xp" title={`${into} / ${TIER_XP} season XP`}>
        <motion.div className="acct-xp-fill season-xp-fill" initial={{ width: 0 }} animate={{ width: `${(into / TIER_XP) * 100}%` }} transition={{ duration: 0.9 }} />
        <span className="acct-xp-text">{maxed ? t("season.pass_complete") : t("season.xp_to_tier", { into, need: TIER_XP, next: tier + 1 })}</span>
      </div>
      <div className="dim season-how">{t("season.xp_rules")}</div>
      {season.prize && (
        <div className="season-prize-line">
          <span className="season-prize-tag">{t("season.grand_prize_tag", { tier: PASS_TIERS })}</span>
          <span><b>{cosmetic(season.prize)?.name}</b> {t("season.grand_prize_desc")}</span>
        </div>
      )}

      <Track rewards={passTrack(season)} tier={tier} name={me.name} sweep={sweep} />

      <section className="season-packs">
        <h3>{t("season.packs_title")}</h3>
        <div className="season-pack-row">
          <div className="season-pack">
            <div className="season-pack-art" aria-hidden>
              <span>H</span>
            </div>
            <div>
              <b>{t("season.free_packs_count", { count: pass.packs })}</b>
              <div className="dim">{t("season.free_packs_desc")}</div>
            </div>
            <button className="btn gold" disabled={busy || pass.packs < 1} onClick={() => open(false)}>
              {t("season.open_btn")}
            </button>
          </div>
          <div className="season-pack">
            <div className="season-pack-art buy" aria-hidden>
              <span>H</span>
            </div>
            <div>
              <b>{t("season.common_pack_title")}</b>
              <div className="dim">
                {t("season.common_pack_desc", { price: PACK_PRICE, keep: PACK_KEEP.toLocaleString() })}
              </div>
            </div>
            <button className="btn primary" disabled={busy || !canBuy} onClick={() => open(true)}>
              {t("season.buy_open_btn")}
            </button>
          </div>
        </div>
        <div className="dim">{t("season.packs_info")}</div>
      </section>

      {onWardrobe && (
        <button className="btn ghost season-wardrobe" onClick={onWardrobe}>
          {t("season.wear_in_wardrobe")}
        </button>
      )}

      <AnimatePresence>{opened && <PackReveal items={opened.items} dupeXp={opened.dupeXp} name={me.name} onClose={() => setOpened(null)} />}</AnimatePresence>
    </div>
  );
}

function rewardText(r: TierReward) {
  if (r.kind === "coins") return t("season.coins_reward", { coins: r.coins });
  if (r.kind === "packs") return r.packs > 1 ? t("season.free_packs_reward", { packs: r.packs }) : t("season.free_pack_reward");
  return cosmetic(r.id)?.name ?? r.id;
}

const SWEPT_KEY = "heist.passSwept";
/** whether the pass has already swept to its prize for this player (it does once, the first time it opens) */
function swept() {
  try {
    return !!localStorage.getItem(SWEPT_KEY);
  } catch {
    return true; // storage blocked: skip it rather than sweep on every visit
  }
}

/** Scroll `el` to `to` over `ms`, easing in and out. Resolves false if `stop()` turns true on the way. */
function glide(el: HTMLElement, to: number, ms: number, stop: () => boolean) {
  const from = el.scrollLeft;
  const start = performance.now();
  return new Promise<boolean>((done) => {
    const step = (now: number) => {
      if (stop()) return done(false);
      const k = Math.min(1, (now - start) / ms);
      el.scrollLeft = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
      if (k < 1) requestAnimationFrame(step);
      else done(true);
    };
    requestAnimationFrame(step);
  });
}

/**
 * The pass, tier by tier. `sweep`: the first time it opens, glide all the way to the prize at the top,
 * let it shine, then come back to the next tier to earn (a touch on the track stops it).
 */
export function Track({ rewards, tier, name, sweep = false }: { rewards: TierReward[]; tier: number; name: string; sweep?: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState(false);
  // start scrolled to the next tier to earn
  useEffect(() => {
    const el = row.current?.children[Math.max(0, tier - 1)] as HTMLElement | undefined;
    if (el && row.current) row.current.scrollLeft = el.offsetLeft - 12;
  }, [tier]);
  useEffect(() => {
    const el = row.current;
    if (!sweep || !el || reducedMotion()) return;
    try {
      localStorage.setItem(SWEPT_KEY, "1");
    } catch {
      // storage blocked: swept() already says skip it
    }
    let stopped = false;
    const stop = () => (stopped = true);
    el.addEventListener("pointerdown", stop);
    el.addEventListener("wheel", stop, { passive: true });
    const home = el.scrollLeft;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    el.style.scrollBehavior = "auto";
    void (async () => {
      await wait(600);
      if (stopped || !(await glide(el, el.scrollWidth - el.clientWidth, 2400, () => stopped))) return;
      setSpot(true);
      await wait(2300);
      setSpot(false);
      if (!stopped) await glide(el, home, 1000, () => stopped);
    })().finally(() => {
      el.style.scrollBehavior = "";
    });
    return () => {
      stopped = true;
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
    };
  }, [sweep]);
  return (
    <div className="season-track" ref={row}>
      {rewards.map((r, i) => {
        const t = i + 1;
        const c = r.kind === "item" ? cosmetic(r.id) : undefined;
        const rarity = c ? rarityOf(c) : "common";
        const legendary = rarity === "legendary";
        return (
          <div
            key={t}
            className={"season-tier-card" + (t <= tier ? " got" : "") + (t === tier + 1 ? " next" : "") + (legendary ? " legendary" : "") + (legendary && spot ? " spot" : "")}
            data-rarity={rarity}
          >
            <div className="season-tier-num">{t}</div>
            {c ? (
              <Preview c={c} name={name} />
            ) : (
              <div className="acct-prev acct-prev-title season-tier-bonus">{r.kind === "coins" ? <Coins amount={r.coins} /> : <span className="season-pack-mini">H</span>}</div>
            )}
            <div className="season-tier-what">{rewardText(r)}</div>
            {c && <div className="season-tier-slot">{slotLabel(c.slot)}</div>}
            {c && <RarityBadge rarity={rarity} />}
            {t <= tier && <div className="season-tier-check">✓</div>}
          </div>
        );
      })}
    </div>
  );
}

function PackReveal({ items, dupeXp, name, onClose }: { items: string[]; dupeXp: number; name: string; onClose: () => void }) {
  // Portaled to <body>: inside the profile screen it sat under the header on phones.
  return createPortal(
    <motion.div className="acct-card-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="season-reveal" initial={{ scale: 0.9 }} animate={{ scale: 1 }} role="dialog" aria-label={t("season.pack_opened")}>
        <div className="season-reveal-title">{t("season.pack_opened")}</div>
        <div className="season-reveal-items">
          {items.map((id, i) => {
            const c = cosmetic(id)!;
            const rarity = rarityOf(c);
            return (
              <motion.div
                key={id}
                className="acct-item season-reveal-item"
                data-rarity={rarity}
                initial={{ rotateY: 180, opacity: 0, y: 20 }}
                animate={{ rotateY: 0, opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.35, duration: 0.5 }}
              >
                <Preview c={c} name={name} />
                <div className="acct-item-name">{c.name}</div>
                <RarityBadge rarity={rarity} />
                <div className="season-tier-slot">{slotLabel(c.slot)}</div>
              </motion.div>
            );
          })}
        </div>
        {dupeXp > 0 && <div className="dim">{t("season.dupe_xp", { xp: dupeXp })}</div>}
        <button className="btn gold" onClick={onClose}>
          {t("season.nice_btn")}
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
