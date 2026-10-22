// The Wardrobe & Fitting Room: Luxury character showcase and equipment suite.
// Players preview their complete avatar, frame, cigar, title, and card deck on table felt in real time.

import {
  ALL_COSMETICS,
  DEFAULT_EQUIPPED,
  cosmetic,
  owns,
  rarityOf,
  type Cosmetic,
  type EquipSlot,
} from "@heist/profile";
import { useState } from "react";
import { THEMES, setPrefs, usePrefs, type Theme } from "../prefs";
import type { Me } from "./backend";
import { Avatar, Stars } from "./bits";
import { Cigar, Preview, RarityBadge } from "./items";
import { useAccount } from "./useAccount";
import { VaultGlass, isVault } from "../vault";
import { Emoji } from "../emoji";
import { buzz } from "../haptics";
import { card as cardSound, click, win as winSound } from "../sound";
import { t } from "../i18n";
import "./wardrobe.css";

const CATEGORIES = [
  { id: "all", labelKey: "wardrobe.cat.all" },
  { id: "felt", labelKey: "wardrobe.cat.felt" },
  { id: "cardBack", labelKey: "wardrobe.cat.cardBack" },
  { id: "frame", labelKey: "wardrobe.cat.frame" },
  { id: "title", labelKey: "wardrobe.cat.title" },
  { id: "finery", labelKey: "wardrobe.cat.finery" },
  { id: "collected", labelKey: "wardrobe.cat.collected" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const THEME_METAS: Record<Theme, { nameKey: string; name: string; main: string; edge: string; rail: string; rarity: "rare" | "epic" | "legendary" }> = {
  classic: {
    nameKey: "wardrobe.theme.classic",
    name: "Classic Casino Felt",
    main: "#187a50",
    edge: "#083822",
    rail: "#5b3a1e",
    rarity: "rare",
  },
  vault: {
    nameKey: "wardrobe.theme.vault",
    name: "The Vault Steel Felt",
    main: "#3a4656",
    edge: "#161c26",
    rail: "#8d939c",
    rarity: "epic",
  },
  neon: {
    nameKey: "wardrobe.theme.neon",
    name: "Neon Vegas Cyber Felt",
    main: "#3b1670",
    edge: "#10072a",
    rail: "#ff3fb4",
    rarity: "legendary",
  },
};

const SLOTS: [EquipSlot, string, "shop" | "season"][] = [
  ["felt", "wardrobe.cat.felt", "shop"],
  ["cardBack", "wardrobe.cat.cardBack", "shop"],
  ["frame", "wardrobe.cat.frame", "shop"],
  ["title", "wardrobe.cat.title", "shop"],
  ["banner", "wardrobe.cat.finery", "season"],
  ["cigar", "shop.cigar", "season"],
  ["chat", "wardrobe.cat.finery", "season"],
];

export function Wardrobe({ me, onGo }: { me: Me; onGo: (tab: "shop" | "season") => void }) {
  const { act } = useAccount();
  const prefs = usePrefs();
  const p = me.progress;
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<CategoryId>("all");

  // Temporary preview state for "The Fitting Room"
  const [previewLook, setPreviewLook] = useState<Record<EquipSlot, string>>(() => ({
    ...p.equipped,
  }));
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);

  const isHouseFeltPreviewed = previewLook.felt === "felt.classic";
  const activePreviewTheme: Theme | null = previewTheme ?? (isHouseFeltPreviewed ? prefs.theme : null);

  const isThemePreviewing = previewTheme !== null && (previewTheme !== prefs.theme || p.equipped.felt !== "felt.classic");
  const isCosmeticPreviewing = Object.entries(previewLook).some(
    ([slot, id]) => p.equipped[slot as EquipSlot] !== id,
  );
  const isPreviewing = isThemePreviewing || isCosmeticPreviewing;

  const wear = async (id: string, slot?: EquipSlot) => {
    click();
    buzz("win");
    winSound();
    setBusy(id);
    await act((b) => b.equip(id));
    if (slot) {
      setPreviewLook((prev) => ({ ...prev, [slot]: id }));
      if (slot === "felt") {
        setPreviewTheme(null);
      }
    }
    setBusy(null);
  };

  const previewClassicTheme = (themeId: Theme) => {
    cardSound();
    buzz("tap");
    setPreviewTheme(themeId);
    setPreviewLook((prev) => ({ ...prev, felt: "felt.classic" }));
  };

  const wearClassicTheme = async (themeId: Theme) => {
    click();
    buzz("win");
    winSound();
    setBusy(`theme-${themeId}`);
    setPrefs({ theme: themeId });
    await act((b) => b.equip("felt.classic"));
    setPreviewTheme(null);
    setPreviewLook((prev) => ({ ...prev, felt: "felt.classic" }));
    setBusy(null);
  };

  const previewItem = (c: Cosmetic) => {
    if (c.slot in DEFAULT_EQUIPPED) {
      cardSound();
      buzz("tap");
      if (c.slot === "felt") {
        setPreviewTheme(null);
      }
      setPreviewLook((prev) => ({ ...prev, [c.slot as EquipSlot]: c.id }));
    }
  };

  const resetLook = () => {
    click();
    buzz("tap");
    setPreviewLook({ ...p.equipped });
    setPreviewTheme(null);
  };

  const collected = (slot: "emote" | "drink") =>
    ALL_COSMETICS.filter((c) => c.slot === slot && c.season && p.owned.includes(c.id));
  const emotes = collected("emote");
  const drinks = collected("drink");

  // Active previewed cosmetic objects
  const previewedFelt = cosmetic(previewLook.felt);
  const previewedBack = cosmetic(previewLook.cardBack);
  const previewedFrame = cosmetic(previewLook.frame);
  const previewedTitle = cosmetic(previewLook.title);
  const previewedCigar = cosmetic(previewLook.cigar);

  // Felt details: either classic theme or custom cosmetic felt
  const currentThemeMeta = isHouseFeltPreviewed && activePreviewTheme ? THEME_METAS[activePreviewTheme] : null;

  const feltMain = currentThemeMeta ? currentThemeMeta.main : (previewedFelt?.colors?.[0] ?? "#1f6b45");
  const feltEdge = currentThemeMeta ? currentThemeMeta.edge : (previewedFelt?.colors?.[1] ?? "#0b3322");
  const feltRail = currentThemeMeta ? currentThemeMeta.rail : "rgba(255, 215, 0, 0.4)";
  const feltDisplayName = currentThemeMeta ? t(currentThemeMeta.nameKey) : (previewedFelt?.name ?? t("wardrobe.cat.felt"));
  const feltThemeClass = currentThemeMeta && activePreviewTheme ? ` theme-${activePreviewTheme}` : "";

  const [backMain, backAccent] = previewedBack?.colors ?? ["#232832", "#e7b53c"];

  return (
    <div className="acct-shop wardrobe">
      {/* -------------------------------------------------------------
          THE FITTING ROOM: Live Interactive Character Showcase
      ------------------------------------------------------------- */}
      <div className="fitting-room">
        <div className="fitting-room-ambient-glow" />
        <div className="fitting-room-top">
          <div className="fitting-room-title">
            <span>✨</span> {t("wardrobe.fitting_room")}
          </div>
          {isPreviewing ? (
            <div className="fitting-room-status previewing">
              <span>{t("wardrobe.previewing")}</span>
              <button
                type="button"
                className="btn small ghost"
                style={{ fontSize: 10, padding: "2px 8px", height: "auto" }}
                onClick={resetLook}
              >
                {t("wardrobe.reset")}
              </button>
            </div>
          ) : (
            <div className="fitting-room-status">{t("wardrobe.active_setup")}</div>
          )}
        </div>

        <div className="fitting-stage">
          {/* Left: Player Persona (Avatar, Crown, Lit Cigar, Title) */}
          <div className="fitting-player-pedestal">
            <div className="fitting-avatar-wrap">
              <Avatar
                name={me.name}
                frame={previewLook.frame}
                level={p.xp ? Math.floor(p.xp / 1000) + 1 : 1}
                size={74}
              />
            </div>
            <div className="fitting-player-details">
              <div className="fitting-player-name">
                {me.name} <Stars prestige={p.prestige} size={12} />
              </div>
              <div className="fitting-player-title">
                {previewedTitle?.text ? `“${previewedTitle.text}”` : t("wardrobe.contender")}
              </div>
              <div className="fitting-player-cigar">
                <Cigar id={previewLook.cigar} size={50} />
              </div>
            </div>
          </div>

          {/* Right: Table Felt & 3D Perspective Card Fan */}
          <div
            className={`fitting-table-pedestal${feltThemeClass}`}
            style={{
              background: `radial-gradient(ellipse at 50% 45%, ${feltMain}, ${feltEdge})`,
              borderColor: feltRail,
            }}
          >
            <div className="fitting-deck-fan">
              <div
                className="fitting-card-sample c-under"
                data-pattern={previewedBack?.pattern}
                style={{
                  background: backMain,
                  ["--back" as string]: backMain,
                  ["--back2" as string]: backAccent,
                }}
              >
                <span>H</span>
              </div>
              <div
                className="fitting-card-sample c-top"
                data-pattern={previewedBack?.pattern}
                style={{
                  background: backMain,
                  ["--back" as string]: backMain,
                  ["--back2" as string]: backAccent,
                }}
              >
                <span>H</span>
              </div>
            </div>
            <span className="fitting-felt-label">
              {feltDisplayName} · {previewedBack?.name ?? t("wardrobe.cat.cardBack")}
            </span>
          </div>
        </div>
      </div>

      {/* Category Pills Navigation */}
      <div className="wardrobe-nav-pills" role="tablist">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`wardrobe-nav-pill ${tab === cat.id ? "active" : ""}`}
            onClick={() => {
              click();
              buzz("tap");
              setTab(cat.id);
            }}
            role="tab"
            aria-selected={tab === cat.id}
          >
            {t(cat.labelKey)}
          </button>
        ))}
      </div>

      {/* -------------------------------------------------------------
          Theme Preset Felts
      ------------------------------------------------------------- */}
      {(tab === "all" || tab === "felt") && (
        <section>
          <h3>{t("wardrobe.casino_classic_felts")}</h3>
          <div className="acct-items">
            {THEMES.map((th) => {
              const meta = THEME_METAS[th.id];
              const on = p.equipped.felt === "felt.classic" && prefs.theme === th.id;
              const isPreview = activePreviewTheme === th.id && (previewTheme !== null || (isHouseFeltPreviewed && !on));

              return (
                <div
                  key={th.id}
                  className={"acct-item" + (on ? " on" : "") + (isPreview ? " previewing-card" : "")}
                  data-rarity={meta.rarity}
                  onClick={() => previewClassicTheme(th.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    className={`acct-prev acct-prev-felt theme-card-preview theme-card-${th.id}`}
                    style={{
                      background: `radial-gradient(ellipse at 50% 45%, ${meta.main} 0%, ${meta.edge} 100%)`,
                      borderColor: meta.rail,
                    }}
                  >
                    <span className="theme-card-watermark">HEIST</span>
                  </div>
                  <div className="acct-item-name">{t(meta.nameKey)}</div>
                  <RarityBadge rarity={meta.rarity} />
                  {on ? (
                    <div className="acct-item-tag">{t("wardrobe.equipped")}</div>
                  ) : (
                    <button
                      className="btn small gold"
                      disabled={busy === `theme-${th.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void wearClassicTheme(th.id);
                      }}
                    >
                      {t("wardrobe.wear")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* -------------------------------------------------------------
          Cosmetic Equipment Slots
      ------------------------------------------------------------- */}
      {SLOTS.filter(([slot]) => {
        if (tab === "all") return true;
        if (tab === "felt") return slot === "felt";
        if (tab === "cardBack") return slot === "cardBack";
        if (tab === "frame") return slot === "frame";
        if (tab === "title") return slot === "title";
        if (tab === "finery") return slot === "banner" || slot === "cigar" || slot === "chat";
        return false;
      }).map(([slot, labelKey, from]) => {
        const house = DEFAULT_EQUIPPED[slot];
        const mine = ALL_COSMETICS.filter((c) => c.slot === slot && c.id !== house && owns(p, c.id));
        const list: Cosmetic[] = slot === "felt" ? mine : [...ALL_COSMETICS.filter((c) => c.id === house), ...mine];
        const sectionTitle = slot === "felt" ? t("wardrobe.collector_felts") : t(labelKey);

        return (
          <section key={slot}>
            <h3>{sectionTitle}</h3>
            <div className="acct-items">
              {list.map((c) => {
                const on = p.equipped[slot] === c.id;
                const isPreview = previewLook[slot] === c.id;
                const rarity = rarityOf(c);

                return (
                  <div
                    key={c.id}
                    className={"acct-item" + (on ? " on" : "") + (isPreview && !on ? " previewing-card" : "")}
                    data-rarity={rarity}
                    onClick={() => previewItem(c)}
                    style={{ cursor: "pointer" }}
                  >
                    <Preview c={c} name={me.name} />
                    <div className="acct-item-name">{c.name}</div>
                    <RarityBadge rarity={rarity} />
                    {on ? (
                      <div className="acct-item-tag">{t("wardrobe.equipped")}</div>
                    ) : (
                      <button
                        className="btn small gold"
                        disabled={busy === c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void wear(c.id, slot);
                        }}
                      >
                        {t("wardrobe.wear")}
                      </button>
                    )}
                  </div>
                );
              })}
              {!mine.length && (
                <button className="acct-item wardrobe-more" onClick={() => onGo(from)}>
                  <span className="wardrobe-more-plus" aria-hidden>
                    +
                  </span>
                  <span className="acct-item-name">
                    {from === "shop" ? t("wardrobe.find_more_shop") : t("wardrobe.earn_more_season")}
                  </span>
                </button>
              )}
            </div>
          </section>
        );
      })}

      {/* -------------------------------------------------------------
          Collected Emotes & Drinks
      ------------------------------------------------------------- */}
      {(tab === "all" || tab === "collected") && (emotes.length > 0 || drinks.length > 0) && (
        <section>
          <h3>{t("wardrobe.collected_finery")}</h3>
          {emotes.length > 0 && (
            <div className="wardrobe-collected">
              <span className="dim">{t("wardrobe.in_chat")}</span>
              {emotes.map((c) => (
                <span key={c.id} title={c.name} className="acct-collected-emoji">
                  {c.emoji && <Emoji e={c.emoji} />}
                </span>
              ))}
            </div>
          )}
          {drinks.length > 0 && (
            <div className="wardrobe-collected">
              <span className="dim">{t("wardrobe.in_drinks")}</span>
              {drinks.map((c) => (
                <span key={c.id} title={c.name} className="acct-collected-emoji">
                  {c.emoji && isVault(c.emoji) ? <VaultGlass size={24} /> : c.emoji && <Emoji e={c.emoji} />}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
