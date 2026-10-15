// The solo campaign: twelve fixed tables against bots, from a corner store to the vault. Each one is a
// set seat count, bot lineup and rule set, so everyone climbs the same ladder. Win a stage to unlock the
// next; the first clear pays coins and XP, and stages 4, 8 and 12 give items you can't get anywhere else.
// Campaign tables have no buy-in. They count toward career stats and the skill rating like any vs-bots game.

import type { BotOptions, RuleOptions } from "@heist/engine";

export interface Stage {
  /** 1-based */
  n: number;
  name: string;
  /** one line for the stage card */
  blurb: string;
  /** what the bots do differently, in a few words */
  twist: string;
  players: number;
  /** one per bot seat (seat 1 up) */
  bots: BotOptions[];
  rules?: Partial<RuleOptions>;
  /** first clear only */
  coins: number;
  xp: number;
  /** cosmetic ids given on the first clear */
  items?: string[];
}

const easy: BotOptions = { level: "easy" };
const normal: BotOptions = { level: "normal" };
const hard: BotOptions = { level: "hard" };

export const STAGES: Stage[] = [
  // Act 1: small time
  { n: 1, name: "Corner Store", blurb: "Two amateurs and a cash drawer. Learn the ropes.", twist: "Easy bots", players: 3, bots: [easy, easy], coins: 40, xp: 50 },
  { n: 2, name: "Pawn Shop", blurb: "The owner's nephew has done this before.", twist: "One bot knows the game", players: 3, bots: [easy, normal], coins: 50, xp: 60 },
  { n: 3, name: "Jewelry Counter", blurb: "A bigger crew means more hands in the till.", twist: "Four at the table", players: 4, bots: [easy, normal, normal], coins: 60, xp: 70 },
  { n: 4, name: "Armored Van", blurb: "Professionals only. They won't make it easy.", twist: "Full-strength bots", players: 4, bots: [normal, normal, normal], coins: 80, xp: 80, items: ["title.wheelman"] },
  // Act 2: moving up
  { n: 5, name: "Casino Cage", blurb: "Someone at this table has done hard time.", twist: "One hard bot", players: 4, bots: [normal, normal, hard], coins: 100, xp: 90 },
  { n: 6, name: "Bad Blood", blurb: "Beat them once and they'll come for you all night.", twist: "Bots hold grudges", players: 4, bots: [{ level: "normal", vendetta: true }, { level: "normal", vendetta: true }, { level: "hard" }], coins: 120, xp: 100 },
  { n: 7, name: "Partners in Crime", blurb: "Two of them came in together. Watch who backs who.", twist: "Two bots are secret partners", players: 5, bots: [{ level: "normal", partner: 2 }, { level: "normal", partner: 1 }, normal, normal], coins: 140, xp: 110 },
  { n: 8, name: "The Long Con", blurb: "They'll wait all night for the right card.", twist: "Patient hard bots", players: 5, bots: [{ level: "hard", patient: true }, { level: "hard", patient: true }, normal, normal], coins: 160, xp: 120, items: ["back.blueprint"] },
  // Act 3: the big score
  { n: 9, name: "Greased Palms", blurb: "Everyone here has a price. Bribes are on.", twist: "Bribes rule", players: 5, bots: [hard, normal, hard, normal], rules: { bribes: true }, coins: 180, xp: 130 },
  { n: 10, name: "Full House", blurb: "Six seats, five sharks.", twist: "Six-player table", players: 6, bots: [hard, hard, normal, hard, normal], coins: 200, xp: 140 },
  { n: 11, name: "The Syndicate", blurb: "A partnered pair and a grudge, at one table.", twist: "Partners and grudges", players: 6, bots: [{ level: "hard", partner: 2 }, { level: "hard", partner: 1 }, { level: "hard", vendetta: true }, hard, normal], rules: { openDeals: true }, coins: 250, xp: 160 },
  { n: 12, name: "The Vault", blurb: "The best in the business. Every rule on.", twist: "All hard bots, every rule", players: 6, bots: [hard, hard, hard, hard, hard], rules: { bribes: true, placeCrew: true, openDeals: true }, coins: 400, xp: 250, items: ["title.mastermind", "felt.vaultfloor"] },
];

export const stage = (n: number): Stage | undefined => STAGES[n - 1];

/** Stages cleared so far (the next one to play is cleared + 1). */
export const campaignNext = (cleared: number) => Math.min(cleared + 1, STAGES.length);
