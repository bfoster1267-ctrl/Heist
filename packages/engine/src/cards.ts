import type { Card, RoleId } from "./types";

/** Six crews, each with a color and a shape (for color-blind players). Matches the printed cards. */
export const CREWS = [
  { id: "red", name: "Embers", hex: "#d6452b", shape: "circle" },
  { id: "blue", name: "Tidewater", hex: "#2f78c4", shape: "square" },
  { id: "green", name: "Verdant", hex: "#3a9a4a", shape: "triangle" },
  { id: "yellow", name: "Gilded", hex: "#e2b928", shape: "diamond" },
  { id: "purple", name: "Velvet", hex: "#8a4fbf", shape: "star" },
  { id: "orange", name: "Rust", hex: "#ee8a2a", shape: "hexagon" },
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
  { id: "muscle", name: "The Muscle", text: "As Boss or Mark: +1." },
  { id: "getaway", name: "The Getaway Driver", text: "Take 2 crew out of the Pen each turn, not 1." },
  { id: "safecracker", name: "The Safecracker", text: "Win as Boss: loot is $6, and the Mark sends 2 crew from another hideout to the Pen." },
  { id: "mastermind", name: "The Mastermind", text: "As Boss, skip the flip and pick the Mark. Their home turf is only +2." },
  { id: "forger", name: "The Forger", text: "Once per game, after the reveal: change your Score card to any number in the discard pile." },
  { id: "pickpocket", name: "The Pickpocket", text: "Whenever loot is paid, bank the top Job card." },
  { id: "inside_man", name: "The Inside Man", text: "Join both sides. Split your crew. Collect from the side that wins." },
  { id: "bookie", name: "The Bookie", text: "Lost bets go to you. When a job you're not in ends, bank the top Job card." },
  { id: "hacker", name: "The Hacker", text: "Boss or Mark only: before cards are picked, call a number. If your opponent's card shows it, you win outright." },
  { id: "lookout", name: "The Lookout", text: "As Mark: +4." },
  { id: "fence", name: "The Fence", text: "Once per turn: pay $2, take any card from the discard pile." },
  { id: "double_agent", name: "The Double Agent", text: "Ally on the losing side? Switch at the reveal: your crew go home." },
  { id: "wildcard", name: "The Wildcard", text: "Once per game, swap your Role with another player's." },
];

export const roleName = (r: RoleId | null) => (r ? ROLES.find((x) => x.id === r)!.name : "No role");

export function cardLabel(c: Card): string {
  switch (c.kind) {
    case "S":
      return `Score ${c.score}`;
    case "F":
      return "Fixer";
    case "B":
      return "Backup";
    case "X":
      return "Double-Cross";
  }
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
