// Season 1, "Opening Night": 78 items, made as color and pattern variants of a few base designs (felt,
// card back, frame, title, chat bubble, banner, emote, drink, cigar). About half sit on the season pass;
// the rest only come out of chip packs. Season items can only be earned while their season runs, and
// players keep them for good.

import type { Cosmetic, EquipSlot, Slot } from "./cosmetics";

export const SEASON_1 = 1;

/** [key, name, main, dark, light] */
const PALETTE: [string, string, string, string, string][] = [
  ["crimson", "Crimson", "#9b1c2c", "#3a0710", "#ff8a96"],
  ["teal", "Teal", "#127a78", "#052c2b", "#7fe3dc"],
  ["amber", "Amber", "#b8761a", "#3d2504", "#ffd27a"],
  ["plum", "Plum", "#6b2a6e", "#240b26", "#e2a1e6"],
  ["cobalt", "Cobalt", "#1f4fa8", "#0a1a3d", "#9cc0ff"],
  ["jade", "Jade", "#2e8b57", "#0c2e1c", "#9ff0c0"],
  ["rose", "Rose Gold", "#b76e79", "#3e1f24", "#ffd0d6"],
  ["ash", "Ash", "#5b5f66", "#1a1c20", "#d6dae0"],
  ["copper", "Copper", "#a5532a", "#36180a", "#f6b48b"],
  ["ice", "Ice", "#4f8fa8", "#12303b", "#dff6ff"],
];
const color = (key: string) => PALETTE.find((p) => p[0] === key)!;

const item = (slot: Slot, key: string, name: string, extra: Partial<Cosmetic>): Cosmetic => ({
  id: `s1.${slot}.${key}`, slot, name, price: 0, season: SEASON_1, rarity: "common", ...extra,
});

const felts = ["crimson", "teal", "amber", "plum", "cobalt", "jade", "ash", "copper"].map((k) => {
  const [, n, main, dark] = color(k);
  return item("felt", k, `${n} Felt`, { colors: [main, dark] });
});

const BACK_PATTERNS = ["stripes", "diamonds", "noir"];
const backs = ["crimson", "teal", "amber", "plum", "cobalt", "jade", "rose", "ice"].map((k, i) => {
  const [, n, main, , light] = color(k);
  const pattern = BACK_PATTERNS[i % BACK_PATTERNS.length];
  const style = pattern === "stripes" ? "Stripes" : pattern === "diamonds" ? "Diamonds" : "Noir";
  return item("cardBack", k, `${n} ${style}`, { colors: [main, light], pattern });
});

const frames = ["crimson", "teal", "amber", "plum", "cobalt", "rose"].map((k) => {
  const [, n, main, , light] = color(k);
  return item("frame", k, n, { colors: [main, light] });
});

const titles = ["Opening Night", "Night Owl", "Getaway Artist", "Silver Tongue", "Card Sharp", "Heat Seeker", "Clean Hands", "Wise Guy"].map((t) =>
  item("title", t.toLowerCase().replace(/\s+/g, "-"), t, { text: t }),
);

const chats = PALETTE.map(([k, n, main, dark, light]) => item("chat", k, `${n} Bubble`, { chat: [main, k === "ice" || k === "amber" ? dark : "#ffffff", light] }));

const BANNER_PATTERNS: [string, string][] = [
  ["stripes", "Stripes"],
  ["pinstripe", "Pinstripe"],
  ["diamonds", "Argyle"],
  ["deco", "Deco"],
  ["chevron", "Chevron"],
];
const banners = ["crimson", "teal", "amber", "plum", "cobalt", "jade", "rose", "ash", "copper", "ice"].map((k, i) => {
  const [, n, main, dark] = color(k);
  const [pattern, style] = BANNER_PATTERNS[i % BANNER_PATTERNS.length];
  return item("banner", k, `${n} ${style}`, { colors: [main, dark], pattern });
});

const emotes = (
  [
    ["joker", "Joker", "🃏"], ["dice", "Dice", "🎲"], ["diamond", "Diamond", "💎"], ["shades", "Shades", "🕶️"],
    ["siren", "Siren", "🚨"], ["key", "Key", "🗝️"], ["briefcase", "Briefcase", "💼"], ["tophat", "Top Hat", "🎩"],
    ["clover", "Lucky Clover", "🍀"], ["fire", "On Fire", "🔥"], ["hush", "Hush", "🤫"], ["rat", "Rat", "🐀"],
  ] as const
).map(([k, n, e]) => item("emote", k, n, { emoji: e }));

const drinks = (
  [
    ["wine", "Red Wine", "🍷"], ["maitai", "Mai Tai", "🍹"], ["toast", "Toast", "🥂"], ["sake", "Sake", "🍶"],
    ["tea", "Green Tea", "🍵"], ["boba", "Bubble Tea", "🧋"], ["milk", "Glass of Milk", "🥛"], ["juice", "Juice Box", "🧃"],
  ] as const
).map(([k, n, e]) => item("drink", k, n, { emoji: e }));

// cigars: [band, wrapper]
const cigars = (
  [
    ["corona", "Corona", "crimson", "#7a4a26"], ["robusto", "Robusto", "amber", "#5e3a1e"], ["churchill", "Churchill", "cobalt", "#6b4426"],
    ["torpedo", "Torpedo", "jade", "#4a2d17"], ["panatela", "Panatela", "rose", "#8a5a33"], ["maduro", "Maduro", "plum", "#3b2414"],
    ["lancero", "Lancero", "teal", "#7d5230"], ["perfecto", "Perfecto", "copper", "#5a3720"],
  ] as const
).map(([k, n, band, wrapper]) => item("cigar", k, n, { colors: [color(band)[2], wrapper] }));

const bySlot: Cosmetic[][] = [felts, backs, frames, titles, chats, banners, emotes, drinks, cigars];

// Each slot's first half goes on the pass, the rest into packs. The pass deals them out a slot at a time
// so neighboring tiers give different kinds of things.
const passHalf = bySlot.map((list) => list.slice(0, Math.ceil(list.length / 2)));
const packHalf = bySlot.map((list) => list.slice(Math.ceil(list.length / 2)));

const roundRobin = (lists: Cosmetic[][]) => {
  const out: Cosmetic[] = [];
  for (let i = 0; out.length < lists.reduce((t, l) => t + l.length, 0); i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
};

/** In pass order, tier by tier. */
export const SEASON_1_PASS_ITEMS = roundRobin(passHalf).map((c) => ({ ...c, source: "pass" as const }));
export const SEASON_1_PACK_ITEMS = packHalf.flat().map((c) => ({ ...c, source: "pack" as const }));

export const SEASON_ITEMS: Cosmetic[] = [...SEASON_1_PASS_ITEMS, ...SEASON_1_PACK_ITEMS];

export type { EquipSlot };
