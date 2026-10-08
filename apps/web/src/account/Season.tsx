// The season: the pass track (season XP, tier by tier), packs to open or buy with chips, and the locker
// of season items to equip. All of it sits beside career XP and levels; nothing here changes the game.

import {
  ALL_COSMETICS, DEFAULT_EQUIPPED, PACK_KEEP, PACK_PRICE, PASS_TIERS, TIER_XP, cosmetic, currentPass, equippable, passTrack, seasonAt, seasonOwned,
  tierOf, type Cosmetic, type Slot, type TierReward,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Chips } from "../table/pieces";
import type { Me } from "./backend";
import { Coins } from "./bits";
import { Preview } from "./items";
import { useAccount } from "./useAccount";

const SLOT_NAMES: [Slot, string][] = [
  ["felt", "Table felt"],
  ["cardBack", "Card backs"],
  ["frame", "Avatar frames"],
  ["title", "Titles"],
  ["chat", "Chat bubbles"],
  ["banner", "Banners"],
  ["cigar", "Cigars"],
  ["emote", "Emotes"],
  ["drink", "Drinks"],
];
export const slotLabel = (s: Slot) => SLOT_NAMES.find(([k]) => k === s)?.[1] ?? s;

export function Season({ me }: { me: Me }) {
  const { act } = useAccount();
  const p = me.progress;
  const now = Date.now();
  const season = seasonAt(now);
  const [opened, setOpened] = useState<{ items: string[]; dupeXp: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!season)
    return (
      <div className="acct-empty">
        <div className="acct-empty-big">Between seasons</div>
        The next season starts soon. Everything you earned stays in your locker.
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
        <div>
          <div className="season-name">Season {season.id}: {season.name}</div>
          <div className="dim">
            {days} day{days === 1 ? "" : "s"} left · {owned.have} of {owned.of} items collected · Season items can only be earned this season
          </div>
        </div>
        <div className="season-tier">
          <span className="season-tier-n">{tier}</span>
          <span className="dim">of {PASS_TIERS}</span>
        </div>
      </div>
      <div className="acct-xp season-xp" title={`${into} / ${TIER_XP} season XP`}>
        <motion.div className="acct-xp-fill season-xp-fill" initial={{ width: 0 }} animate={{ width: `${(into / TIER_XP) * 100}%` }} transition={{ duration: 0.9 }} />
        <span className="acct-xp-text">{maxed ? "Pass complete" : `${into} / ${TIER_XP} season XP to tier ${tier + 1}`}</span>
      </div>
      <div className="dim season-how">Every game earns season XP: 150 for playing, +100 for a win, +50 online, +200 for your first win of the day.</div>

      <Track rewards={passTrack(season)} tier={tier} name={me.name} />

      <section className="season-packs">
        <h3>Packs</h3>
        <div className="season-pack-row">
          <div className="season-pack">
            <div className="season-pack-art" aria-hidden>
              <span>H</span>
            </div>
            <div>
              <b>Free packs: {pass.packs}</b>
              <div className="dim">Every 10 tiers of the pass gives one.</div>
            </div>
            <button className="btn gold" disabled={busy || pass.packs < 1} onClick={() => open(false)}>
              Open
            </button>
          </div>
          <div className="season-pack">
            <div className="season-pack-art buy" aria-hidden>
              <span>H</span>
            </div>
            <div>
              <b>Common pack</b>
              <div className="dim">
                3 items for <Chips amount={PACK_PRICE} />. You need {PACK_KEEP.toLocaleString()} chips left after buying.
              </div>
            </div>
            <button className="btn primary" disabled={busy || !canBuy} onClick={() => open(true)}>
              Buy & open
            </button>
          </div>
        </div>
        <div className="dim">Packs only hold items you don't have yet. Once you have them all, a pack pays out season XP instead.</div>
      </section>

      <Locker me={me} />

      <AnimatePresence>{opened && <PackReveal items={opened.items} dupeXp={opened.dupeXp} name={me.name} onClose={() => setOpened(null)} />}</AnimatePresence>
    </div>
  );
}

function rewardText(r: TierReward) {
  if (r.kind === "coins") return `${r.coins} coins`;
  if (r.kind === "packs") return r.packs > 1 ? `${r.packs} packs` : "Free pack";
  return cosmetic(r.id)?.name ?? r.id;
}

function Track({ rewards, tier, name }: { rewards: TierReward[]; tier: number; name: string }) {
  const row = useRef<HTMLDivElement>(null);
  // start scrolled to the next tier to earn
  useEffect(() => {
    const el = row.current?.children[Math.max(0, tier - 1)] as HTMLElement | undefined;
    if (el && row.current) row.current.scrollLeft = el.offsetLeft - 12;
  }, [tier]);
  return (
    <div className="season-track" ref={row}>
      {rewards.map((r, i) => {
        const t = i + 1;
        const c = r.kind === "item" ? cosmetic(r.id) : undefined;
        return (
          <div key={t} className={"season-tier-card" + (t <= tier ? " got" : "") + (t === tier + 1 ? " next" : "")}>
            <div className="season-tier-num">{t}</div>
            {c ? (
              <Preview c={c} name={name} />
            ) : (
              <div className="acct-prev acct-prev-title season-tier-bonus">{r.kind === "coins" ? <Coins amount={r.coins} /> : <span className="season-pack-mini">H</span>}</div>
            )}
            <div className="season-tier-what">{rewardText(r)}</div>
            {c && <div className="season-tier-slot">{slotLabel(c.slot)}</div>}
            {t <= tier && <div className="season-tier-check">✓</div>}
          </div>
        );
      })}
    </div>
  );
}

function PackReveal({ items, dupeXp, name, onClose }: { items: string[]; dupeXp: number; name: string; onClose: () => void }) {
  return (
    <motion.div className="acct-card-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="season-reveal" initial={{ scale: 0.9 }} animate={{ scale: 1 }} role="dialog" aria-label="Pack opened">
        <div className="season-reveal-title">Pack opened</div>
        <div className="season-reveal-items">
          {items.map((id, i) => {
            const c = cosmetic(id)!;
            return (
              <motion.div
                key={id}
                className="acct-item season-reveal-item"
                initial={{ rotateY: 180, opacity: 0, y: 20 }}
                animate={{ rotateY: 0, opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.35, duration: 0.5 }}
              >
                <Preview c={c} name={name} />
                <div className="acct-item-name">{c.name}</div>
                <div className="season-rarity">{c.rarity ?? "common"}</div>
                <div className="season-tier-slot">{slotLabel(c.slot)}</div>
              </motion.div>
            );
          })}
        </div>
        {dupeXp > 0 && <div className="dim">You already had everything else: +{dupeXp} season XP.</div>}
        <button className="btn gold" onClick={onClose}>
          Nice
        </button>
      </motion.div>
    </motion.div>
  );
}

/** Season items by kind: equip what you have; see where the rest come from. */
function Locker({ me }: { me: Me }) {
  const { act } = useAccount();
  const p = me.progress;
  const [busy, setBusy] = useState<string | null>(null);
  const season = seasonAt(Date.now());
  const track = season ? passTrack(season) : [];
  const tierFor = (id: string) => track.findIndex((r) => r.kind === "item" && r.id === id) + 1;
  const equip = async (id: string) => {
    setBusy(id);
    await act((b) => b.equip(id));
    setBusy(null);
  };
  return (
    <div className="acct-shop">
      <h3>Locker</h3>
      {SLOT_NAMES.map(([slot, label]) => {
        const items = ALL_COSMETICS.filter((c) => c.slot === slot && c.season);
        if (!items.length) return null;
        const house = (DEFAULT_EQUIPPED as Record<string, string>)[slot];
        const list: Cosmetic[] = house ? [cosmetic(house)!, ...items] : items;
        return (
          <section key={slot}>
            <h4 className="season-slot">{label}</h4>
            <div className="acct-items">
              {list.map((c) => {
                const have = !c.season || p.owned.includes(c.id);
                const on = equippable(c) && p.equipped[c.slot] === c.id;
                return (
                  <div key={c.id} className={"acct-item" + (on ? " on" : "") + (!have ? " locked" : "")}>
                    <Preview c={c} name={me.name} />
                    <div className="acct-item-name">{c.name}</div>
                    {on ? (
                      <div className="acct-item-tag">Equipped</div>
                    ) : !have ? (
                      <div className="acct-item-lock">{c.source === "pass" ? `Pass tier ${tierFor(c.id)}` : "In packs"}</div>
                    ) : equippable(c) ? (
                      <button className="btn small gold" disabled={busy === c.id} onClick={() => equip(c.id)}>
                        Equip
                      </button>
                    ) : (
                      <div className="acct-item-tag">{c.slot === "drink" ? "In your drink menu" : "In your chat tray"}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
