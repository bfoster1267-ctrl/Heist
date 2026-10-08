// Cosmetics bought with coins (earned by playing, never with real money in this version) or unlocked by
// level and prestige. Purely visual: nothing here changes the game.

export type Slot = "felt" | "cardBack" | "frame" | "title";

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
  /** card back pattern */
  pattern?: "classic" | "red" | "stripes" | "diamonds" | "noir" | "gold";
}

export const COSMETICS: Cosmetic[] = [
  // table felt
  { id: "felt.classic", slot: "felt", name: "Casino Green", price: 0, colors: ["#1f6b45", "#0b3322"] },
  { id: "felt.midnight", slot: "felt", name: "Midnight Blue", price: 400, colors: ["#1d3f73", "#0a1630"] },
  { id: "felt.burgundy", slot: "felt", name: "Burgundy", price: 400, colors: ["#6f1d2c", "#2e0910"] },
  { id: "felt.slate", slot: "felt", name: "Slate", price: 600, colors: ["#3d4650", "#15191e"] },
  { id: "felt.violet", slot: "felt", name: "Velvet Violet", price: 900, unlock: { level: 15 }, colors: ["#4b2a72", "#1b0d2e"] },
  { id: "felt.vault", slot: "felt", name: "Vault Gold", price: 0, unlock: { prestige: 1 }, colors: ["#6b5521", "#2a1f08"] },
  { id: "felt.obsidian", slot: "felt", name: "Obsidian", price: 0, unlock: { prestige: 5 }, colors: ["#262626", "#050505"] },

  // card backs
  { id: "back.classic", slot: "cardBack", name: "House", price: 0, colors: ["#232832", "#e7b53c"], pattern: "classic" },
  { id: "back.red", slot: "cardBack", name: "Casino Red", price: 250, colors: ["#8e1b25", "#f3e3c3"], pattern: "red" },
  { id: "back.navy", slot: "cardBack", name: "Navy Stripes", price: 300, colors: ["#1b3a6b", "#d9e2f0"], pattern: "stripes" },
  { id: "back.emerald", slot: "cardBack", name: "Emerald Diamonds", price: 500, colors: ["#16613f", "#e7d9a8"], pattern: "diamonds" },
  { id: "back.noir", slot: "cardBack", name: "Noir", price: 800, unlock: { level: 10 }, colors: ["#141414", "#c9a54b"], pattern: "noir" },
  { id: "back.gold", slot: "cardBack", name: "Gold Leaf", price: 0, unlock: { prestige: 2 }, colors: ["#7a5a14", "#ffe08a"], pattern: "gold" },

  // avatar frames
  { id: "frame.none", slot: "frame", name: "No Frame", price: 0 },
  { id: "frame.bronze", slot: "frame", name: "Bronze", price: 0, unlock: { level: 5 }, colors: ["#b07a43", "#e3b07a"] },
  { id: "frame.silver", slot: "frame", name: "Silver", price: 0, unlock: { level: 20 }, colors: ["#aeb6bf", "#eef2f6"] },
  { id: "frame.gold", slot: "frame", name: "Gold", price: 0, unlock: { level: 35 }, colors: ["#d4a531", "#ffe08a"] },
  { id: "frame.ruby", slot: "frame", name: "Ruby", price: 1200, colors: ["#b3122e", "#ff6b81"] },
  { id: "frame.diamond", slot: "frame", name: "Diamond", price: 0, unlock: { prestige: 3 }, colors: ["#7fd3ff", "#ffffff"] },

  // titles
  { id: "title.none", slot: "title", name: "No Title", price: 0 },
  { id: "title.smooth", slot: "title", name: "Smooth Operator", price: 250, text: "Smooth Operator" },
  { id: "title.highroller", slot: "title", name: "High Roller", price: 750, text: "High Roller" },
  { id: "title.ghost", slot: "title", name: "The Ghost", price: 0, unlock: { level: 25 }, text: "The Ghost" },
  { id: "title.untouchable", slot: "title", name: "Untouchable", price: 0, unlock: { prestige: 1 }, text: "Untouchable" },
  { id: "title.legend", slot: "title", name: "Living Legend", price: 0, unlock: { prestige: 10 }, text: "Living Legend" },
];

export const DEFAULT_EQUIPPED: Record<Slot, string> = {
  felt: "felt.classic",
  cardBack: "back.classic",
  frame: "frame.none",
  title: "title.none",
};

export const cosmetic = (id: string) => COSMETICS.find((c) => c.id === id);

/** Unlock met? (level within the current prestige, or any prestige at or above the requirement) */
export function unlocked(c: Cosmetic, level: number, prestige: number): boolean {
  if (!c.unlock) return true;
  if (c.unlock.prestige !== undefined && prestige < c.unlock.prestige) return false;
  if (c.unlock.level !== undefined && level < c.unlock.level && prestige === 0) return false;
  return true;
}

/** Owned without buying: free items whose unlock is met. */
export const freeWith = (c: Cosmetic, level: number, prestige: number) => c.price === 0 && unlocked(c, level, prestige);

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

export const drink = (id: string) => DRINKS.find((d) => d.id === id);
