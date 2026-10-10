// The Wardrobe: everything the player owns, by kind, ready to wear. One place for the table's look, card
// backs, frames, titles and the season's items; the Shop and the Season pass are where new things come from.

import { ALL_COSMETICS, DEFAULT_EQUIPPED, owns, type Cosmetic, type EquipSlot } from "@heist/profile";
import { useState } from "react";
import { THEMES, setPrefs, usePrefs } from "../prefs";
import type { Me } from "./backend";
import { Preview } from "./items";
import { useAccount } from "./useAccount";

/** each kind of thing you can wear, and where more of it comes from */
const SLOTS: [EquipSlot, string, "shop" | "season"][] = [
  ["felt", "Table felt", "shop"],
  ["cardBack", "Card backs", "shop"],
  ["frame", "Avatar frames", "shop"],
  ["title", "Titles", "shop"],
  ["banner", "Banners", "season"],
  ["chat", "Chat bubbles", "season"],
  ["cigar", "Cigars", "season"],
];

export function Wardrobe({ me, onGo }: { me: Me; onGo: (tab: "shop" | "season") => void }) {
  const { act } = useAccount();
  const prefs = usePrefs();
  const p = me.progress;
  const [busy, setBusy] = useState<string | null>(null);
  const wear = async (id: string) => {
    setBusy(id);
    await act((b) => b.equip(id));
    setBusy(null);
  };
  const collected = (slot: "emote" | "drink") => ALL_COSMETICS.filter((c) => c.slot === slot && c.season && p.owned.includes(c.id));
  const emotes = collected("emote");
  const drinks = collected("drink");
  return (
    <div className="acct-shop wardrobe">
      <p className="dim wardrobe-intro">Everything you own, ready to wear. New looks come from the Shop and the Season pass.</p>

      <section>
        <h3>Table style</h3>
        <div className="acct-items">
          {THEMES.map((t) => {
            const on = prefs.theme === t.id;
            return (
              <div key={t.id} className={"acct-item" + (on ? " on" : "")}>
                <div className="acct-prev acct-prev-felt" style={{ background: t.felt, borderColor: t.rail }} />
                <div className="acct-item-name">{t.name}</div>
                {on ? (
                  <div className="acct-item-tag">Wearing</div>
                ) : (
                  <button className="btn small gold" onClick={() => setPrefs({ theme: t.id })}>
                    Wear
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {SLOTS.map(([slot, label, from]) => {
        const house = DEFAULT_EQUIPPED[slot];
        const mine = ALL_COSMETICS.filter((c) => c.slot === slot && c.id !== house && owns(p, c.id));
        const list: Cosmetic[] = [...ALL_COSMETICS.filter((c) => c.id === house), ...mine];
        return (
          <section key={slot}>
            <h3>{label}</h3>
            <div className="acct-items">
              {list.map((c) => {
                const on = p.equipped[slot] === c.id;
                return (
                  <div key={c.id} className={"acct-item" + (on ? " on" : "")}>
                    <Preview c={c} name={me.name} />
                    <div className="acct-item-name">{c.name}</div>
                    {on ? (
                      <div className="acct-item-tag">Wearing</div>
                    ) : (
                      <button className="btn small gold" disabled={busy === c.id} onClick={() => wear(c.id)}>
                        Wear
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
                  <span className="acct-item-name">{from === "shop" ? "Find more in the Shop" : "Earn more in the Season pass"}</span>
                </button>
              )}
            </div>
          </section>
        );
      })}

      {(emotes.length > 0 || drinks.length > 0) && (
        <section>
          <h3>Collected</h3>
          {emotes.length > 0 && (
            <div className="wardrobe-collected">
              <span className="dim">In your chat tray</span>
              {emotes.map((c) => (
                <span key={c.id} title={c.name}>
                  {c.emoji}
                </span>
              ))}
            </div>
          )}
          {drinks.length > 0 && (
            <div className="wardrobe-collected">
              <span className="dim">On your drink menu</span>
              {drinks.map((c) => (
                <span key={c.id} title={c.name}>
                  {c.emoji}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
