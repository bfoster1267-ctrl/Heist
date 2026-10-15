// Cosmetics bought with coins (earned by playing, never with real money in this version), unlocked by
// level and prestige, or earned in a season (the season pass and chip packs, see season.ts). Purely
// visual: nothing here changes the game.

import { SEASON_ITEMS } from "./season1";

/** Slots a player equips one item in. */
export type EquipSlot = "felt" | "cardBack" | "frame" | "title" | "chat" | "banner" | "cigar";
/** Emotes and drinks are collected, not equipped: owning one adds it to the chat tray or drink menu. */
export type Slot = EquipSlot | "emote" | "drink";

/**
 * How rare an item is. Season 1's only legendary is The Vault, the drink for finishing the pass; shiny
 * items and legendary drops slot in here later (plus the pack odds in season.ts).
 */
export type Rarity = "common" | "rare" | "epic" | "legendary";

export function rarityOf(c: Cosmetic): Rarity {
  if (c.rarity) return c.rarity;
  if (c.unlock?.prestige && c.unlock.prestige >= 5) return "legendary";
  if (c.unlock?.prestige && c.unlock.prestige >= 1) return "epic";
  if (c.unlock?.level && c.unlock.level >= 20) return "epic";
  if (c.unlock?.level && c.unlock.level >= 10) return "rare";
  if (c.campaign && c.campaign >= 12) return "legendary";
  if (c.campaign && c.campaign >= 8) return "epic";
  if (c.price >= 1200) return "legendary";
  if (c.price >= 600) return "epic";
  if (c.price >= 250) return "rare";
  return "common";
}

export interface Cosmetic {
  id: string;
  slot: Slot;
  name: string;
  /** coins to buy; 0 = free with the unlock (or owned from the start when there is no unlock) */
  price: number;
  unlock?: { level?: number; prestige?: number };
  /** felt: [center, edge]; cardBack: [main, accent]; frame: [ring, glow] */
  colors?: [string, string];
  /** title text shown under the name at the table */
  text?: string;
  /** card back or banner pattern */
  pattern?: string;
  /** emote and drink items: the emoji; cigars: the smoke tint */
  emoji?: string;
  /** chat bubbles: [bubble, text, edge] */
  chat?: [string, string, string];
  /** season items: which season, how it's earned, and its rarity */
  season?: number;
  source?: "pass" | "pack";
  rarity?: Rarity;
  /** campaign items: the stage whose first clear gives it (not for sale) */
  campaign?: number;
}

export const COSMETICS: Cosmetic[] = [
  // table felt
  { id: "felt.classic", slot: "felt", name: "Casino Green", price: 0, colors: ["#1f6b45", "#0b3322"], rarity: "common" },
  { id: "felt.midnight", slot: "felt", name: "Midnight Blue", price: 400, colors: ["#1d3f73", "#0a1630"], rarity: "rare" },
  { id: "felt.burgundy", slot: "felt", name: "Burgundy", price: 400, colors: ["#6f1d2c", "#2e0910"], rarity: "rare" },
  { id: "felt.slate", slot: "felt", name: "Slate", price: 600, colors: ["#3d4650", "#15191e"], rarity: "rare" },
  { id: "felt.violet", slot: "felt", name: "Velvet Violet", price: 900, unlock: { level: 15 }, colors: ["#4b2a72", "#1b0d2e"], rarity: "epic" },
  { id: "felt.cyber_grid", slot: "felt", name: "Neon Matrix", price: 1500, colors: ["#0a0f1d", "#00f0ff"], rarity: "epic" },
  { id: "felt.vault", slot: "felt", name: "Vault Gold", price: 0, unlock: { prestige: 1 }, colors: ["#6b5521", "#2a1f08"], rarity: "epic" },
  { id: "felt.vaultfloor", slot: "felt", name: "Vault Floor", price: 0, campaign: 12, colors: ["#4a4f57", "#1a1d22"], rarity: "legendary" },
  { id: "felt.obsidian", slot: "felt", name: "Obsidian", price: 0, unlock: { prestige: 5 }, colors: ["#262626", "#050505"], rarity: "legendary" },
  { id: "felt.obsidian_gold", slot: "felt", name: "High Roller Syndicate", price: 2400, colors: ["#141416", "#ffd700"], rarity: "legendary" },

  // card backs
  { id: "back.classic", slot: "cardBack", name: "House", price: 0, colors: ["#232832", "#e7b53c"], pattern: "classic", rarity: "common" },
  { id: "back.red", slot: "cardBack", name: "Casino Red", price: 250, colors: ["#8e1b25", "#f3e3c3"], pattern: "red", rarity: "rare" },
  { id: "back.navy", slot: "cardBack", name: "Navy Stripes", price: 300, colors: ["#1b3a6b", "#d9e2f0"], pattern: "stripes", rarity: "rare" },
  { id: "back.emerald", slot: "cardBack", name: "Emerald Diamonds", price: 500, colors: ["#16613f", "#e7d9a8"], pattern: "diamonds", rarity: "rare" },
  { id: "back.noir", slot: "cardBack", name: "Noir", price: 800, unlock: { level: 10 }, colors: ["#141414", "#c9a54b"], pattern: "noir", rarity: "epic" },
  { id: "back.blueprint", slot: "cardBack", name: "Blueprint", price: 0, campaign: 8, colors: ["#163a6b", "#9cc8ff"], pattern: "stripes", rarity: "epic" },
  { id: "back.gold", slot: "cardBack", name: "Gold Leaf", price: 0, unlock: { prestige: 2 }, colors: ["#7a5a14", "#ffe08a"], pattern: "gold", rarity: "epic" },
  { id: "back.cyber_holo", slot: "cardBack", name: "Cyber Hologram", price: 2500, colors: ["#00f0ff", "#ff0077"], pattern: "holo", rarity: "legendary" },
  { id: "back.dragon_gold", slot: "cardBack", name: "24K Golden Dragon", price: 3000, colors: ["#d4af37", "#fff1a8"], pattern: "dragon", rarity: "legendary" },

  // avatar frames
  { id: "frame.none", slot: "frame", name: "No Frame", price: 0, rarity: "common" },
  { id: "frame.bronze", slot: "frame", name: "Bronze", price: 0, unlock: { level: 5 }, colors: ["#b07a43", "#e3b07a"], rarity: "rare" },
  { id: "frame.silver", slot: "frame", name: "Silver", price: 0, unlock: { level: 20 }, colors: ["#aeb6bf", "#eef2f6"], rarity: "rare" },
  { id: "frame.gold", slot: "frame", name: "Gold", price: 0, unlock: { level: 35 }, colors: ["#d4a531", "#ffe08a"], rarity: "epic" },
  { id: "frame.ruby", slot: "frame", name: "Ruby", price: 1200, colors: ["#b3122e", "#ff6b81"], rarity: "epic" },
  { id: "frame.diamond", slot: "frame", name: "Diamond", price: 0, unlock: { prestige: 3 }, colors: ["#7fd3ff", "#ffffff"], rarity: "epic" },
  { id: "frame.cyber_neon", slot: "frame", name: "Cyber Syndicate", price: 1800, colors: ["#00e5ff", "#e000ff"], rarity: "epic" },
  { id: "frame.vault_crown", slot: "frame", name: "Vault Crown", price: 3500, colors: ["#ffd700", "#ffaa00"], rarity: "legendary" },
  { id: "frame.inferno", slot: "frame", name: "Inferno Embers", price: 2800, colors: ["#ff4500", "#ff8c00"], rarity: "legendary" },

  // titles
  { id: "title.none", slot: "title", name: "No Title", price: 0, rarity: "common" },
  { id: "title.smooth", slot: "title", name: "Smooth Operator", price: 250, text: "Smooth Operator", rarity: "rare" },
  { id: "title.highroller", slot: "title", name: "High Roller", price: 750, text: "High Roller", rarity: "epic" },
  { id: "title.ghost", slot: "title", name: "The Ghost", price: 0, unlock: { level: 25 }, text: "The Ghost", rarity: "epic" },
  { id: "title.untouchable", slot: "title", name: "Untouchable", price: 0, unlock: { prestige: 1 }, text: "Untouchable", rarity: "epic" },
  { id: "title.wheelman", slot: "title", name: "Wheelman", price: 0, campaign: 4, text: "Wheelman", rarity: "rare" },
  { id: "title.mastermind", slot: "title", name: "The Mastermind", price: 0, campaign: 12, text: "The Mastermind", rarity: "legendary" },
  { id: "title.legend", slot: "title", name: "Living Legend", price: 0, unlock: { prestige: 10 }, text: "Living Legend", rarity: "legendary" },
  { id: "title.apex", slot: "title", name: "Apex Predator", price: 2500, text: "Apex Predator", rarity: "legendary" },

  // cigars
  { id: "cigar.none", slot: "cigar", name: "No Cigar", price: 0, rarity: "common" },
  { id: "cigar.phantom", slot: "cigar", name: "Phantom Dragon", price: 2000, colors: ["#9900ff", "#2b0054"], rarity: "legendary" },

  // everyone starts with these; seasons add more
  { id: "chat.house", slot: "chat", name: "House Bubble", price: 0, chat: ["#f3ead6", "#1b1b1b", "#c9b98f"], rarity: "common" },
  { id: "banner.none", slot: "banner", name: "No Banner", price: 0, rarity: "common" },
];

export const DEFAULT_EQUIPPED: Record<EquipSlot, string> = {
  felt: "felt.classic",
  cardBack: "back.classic",
  frame: "frame.none",
  title: "title.none",
  chat: "chat.house",
  banner: "banner.none",
  cigar: "cigar.none",
};

/** Every item: the shop's plus every season's. */
export const ALL_COSMETICS: Cosmetic[] = [...COSMETICS, ...SEASON_ITEMS];
const byId = new Map(ALL_COSMETICS.map((c) => [c.id, c]));
export const cosmetic = (id: string) => byId.get(id);
export const equippable = (c: Cosmetic): c is Cosmetic & { slot: EquipSlot } => c.slot !== "emote" && c.slot !== "drink";

/** Unlock met? (level within the current prestige, or any prestige at or above the requirement) */
export function unlocked(c: Cosmetic, level: number, prestige: number): boolean {
  if (!c.unlock) return true;
  if (c.unlock.prestige !== undefined && prestige < c.unlock.prestige) return false;
  if (c.unlock.level !== undefined && level < c.unlock.level && prestige === 0) return false;
  return true;
}

/** Owned without buying: free items whose unlock is met (season and campaign items have to be earned). */
export const freeWith = (c: Cosmetic, level: number, prestige: number) => !c.season && !c.campaign && c.price === 0 && unlocked(c, level, prestige);

// ------------------------------------------------------------------ drinks

export interface Drink {
  id: string;
  name: string;
  emoji: string;
  price: number;
  /** sends one to everyone at the table */
  round?: boolean;
}

export const DRINKS: Drink[] = [
  { id: "coffee", name: "Coffee", emoji: "☕", price: 0 },
  { id: "beer", name: "Beer", emoji: "🍺", price: 5 },
  { id: "whiskey", name: "Whiskey", emoji: "🥃", price: 15 },
  { id: "martini", name: "Martini", emoji: "🍸", price: 25 },
  { id: "champagne", name: "Round of Champagne", emoji: "🍾", price: 60, round: true },
];

/** Season drinks cost a few coins to send, like the shop's, but only their owners can order them. Legendary ones are free. */
export const SEASON_DRINK_PRICE = 10;
const SEASON_DRINKS: Drink[] = SEASON_ITEMS.filter((c) => c.slot === "drink").map((c) => ({
  id: c.id, name: c.name, emoji: c.emoji!, price: c.rarity === "legendary" ? 0 : SEASON_DRINK_PRICE,
}));

/** The shop's drinks and every season's. */
export const ALL_DRINKS: Drink[] = [...DRINKS, ...SEASON_DRINKS];

export const drink = (id: string) => DRINKS.find((d) => d.id === id) ?? SEASON_DRINKS.find((d) => d.id === id);
