import type { Card, RoleId } from "./types";
import { ENGINE_TEXT as T, type Say } from "./text";

/** Six crews, each with a color and a shape (for color-blind players). Matches the printed cards. */
export const CREWS = [
  { id: "red", name: T["crew.red"], hex: "#d6452b", shape: "circle" },
  { id: "blue", name: T["crew.blue"], hex: "#2f78c4", shape: "square" },
  { id: "green", name: T["crew.green"], hex: "#3a9a4a", shape: "triangle" },
  { id: "yellow", name: T["crew.yellow"], hex: "#e2b928", shape: "diamond" },
  { id: "purple", name: T["crew.purple"], hex: "#8a4fbf", shape: "star" },
  { id: "orange", name: T["crew.orange"], hex: "#ee8a2a", shape: "hexagon" },
] as const;

/** Score values in the 64-card v3 Job deck (44 Score cards). */
export const SCORE_MIX: [number, number][] = [
  [0, 2], [1, 4], [4, 6], [6, 7], [8, 7], [10, 6], [12, 4], [15, 4], [20, 3], [30, 1],
];
export const N_FIXER = 12;
export const N_BACKUP = 5;
export const N_DOUBLE = 3;

export const CASH_OF_SCORE: Record<number, number> = {
  0: 1, 1: 1, 4: 2, 6: 2, 8: 3, 10: 3, 12: 4, 15: 4, 20: 5, 30: 0,
};
export const CASH_OF_KIND = { F: 2, B: 1, X: 2 } as const;

/** The 64 Job cards, colors round-robin exactly as build_v3.py prints them. */
export function makeJobDeck(): Card[] {
  const specs: [Card["kind"], number][] = [];
  for (const [v, k] of SCORE_MIX) for (let i = 0; i < k; i++) specs.push(["S", v]);
  for (let i = 0; i < N_FIXER; i++) specs.push(["F", 0]);
  for (let i = 0; i < N_BACKUP; i++) specs.push(["B", 0]);
  for (let i = 0; i < N_DOUBLE; i++) specs.push(["X", 0]);
  return specs.map(([kind, score], i) => ({
    id: i,
    kind,
    score,
    cash: kind === "S" ? CASH_OF_SCORE[score] : CASH_OF_KIND[kind],
    color: i % CREWS.length,
  }));
}

export const ROLES: { id: RoleId; name: string; text: string }[] = [
  { id: "muscle", name: T["role.muscle.name"], text: T["role.muscle.text"] },
  { id: "getaway", name: T["role.getaway.name"], text: T["role.getaway.text"] },
  { id: "safecracker", name: T["role.safecracker.name"], text: T["role.safecracker.text"] },
  { id: "mastermind", name: T["role.mastermind.name"], text: T["role.mastermind.text"] },
  { id: "forger", name: T["role.forger.name"], text: T["role.forger.text"] },
  { id: "pickpocket", name: T["role.pickpocket.name"], text: T["role.pickpocket.text"] },
  { id: "inside_man", name: T["role.inside_man.name"], text: T["role.inside_man.text"] },
  { id: "bookie", name: T["role.bookie.name"], text: T["role.bookie.text"] },
  { id: "hacker", name: T["role.hacker.name"], text: T["role.hacker.text"] },
  { id: "lookout", name: T["role.lookout.name"], text: T["role.lookout.text"] },
  { id: "fence", name: T["role.fence.name"], text: T["role.fence.text"] },
  { id: "double_agent", name: T["role.double_agent.name"], text: T["role.double_agent.text"] },
  { id: "wildcard", name: T["role.wildcard.name"], text: T["role.wildcard.text"] },
];

export const roleName = (r: RoleId | null) => (r ? ROLES.find((x) => x.id === r)!.name : T["role.none"]);
/** A Role's name as a Say, for text that gets translated. */
export const roleSay = (r: RoleId | null): Say => ({ k: r ? `role.${r}.name` : "role.none" });

/** A card's name as a Say ("Score 12", "Fixer"), for text that gets translated. */
export const cardSay = (c: Card): Say => (c.kind === "S" ? { k: "card.S", v: { n: c.score } } : { k: `card.${c.kind}` });

export function cardLabel(c: Card): string {
  return c.kind === "S" ? T["card.S"].replace("{n}", String(c.score)) : T[`card.${c.kind}`];
}

export const isFighter = (c: Card) => c.kind === "S" || c.kind === "F";
export const fightValue = (c: Card | null) => (c && c.kind === "S" ? c.score : 0);
export const cashOf = (cards: Card[]) => cards.reduce((a, c) => a + c.cash, 0);

export const HIRE_COST = 3;
export const LOOT = 3;
export const HOME_TURF = 5;
export const HAND_LIMIT = 7;
export const BANK_PER_TURN = 2;
export const LAST_CALL_RUNOUTS = 3;
export const BACKUP_BONUS = 3;
