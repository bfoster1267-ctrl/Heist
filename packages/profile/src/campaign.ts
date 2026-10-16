// The solo campaign: twelve fixed tables against bots, from a corner store to the vault. Each one is a
// set seat count, bot lineup and rule set, so everyone climbs the same ladder. Win a stage to unlock the
// next; the first clear pays coins and XP, and stages 4, 8 and 12 give items you can't get anywhere else.
// Campaign tables have no buy-in. They count toward career stats and the skill rating like any vs-bots game.

import type { BotOptions, RuleOptions } from "@heist/engine";
import { PROFILE_TEXT as T, say } from "./text";

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
  { n: 1, name: T["stage.1.name"], blurb: T["stage.1.blurb"], twist: T["stage.1.twist"], players: 3, bots: [easy, easy], coins: 40, xp: 50 },
  { n: 2, name: T["stage.2.name"], blurb: T["stage.2.blurb"], twist: T["stage.2.twist"], players: 3, bots: [easy, normal], coins: 50, xp: 60 },
  { n: 3, name: T["stage.3.name"], blurb: T["stage.3.blurb"], twist: T["stage.3.twist"], players: 4, bots: [easy, normal, normal], coins: 60, xp: 70 },
  { n: 4, name: T["stage.4.name"], blurb: T["stage.4.blurb"], twist: T["stage.4.twist"], players: 4, bots: [normal, normal, normal], coins: 80, xp: 80, items: ["title.wheelman"] },
  // Act 2: moving up
  { n: 5, name: T["stage.5.name"], blurb: T["stage.5.blurb"], twist: T["stage.5.twist"], players: 4, bots: [normal, normal, hard], coins: 100, xp: 90 },
  { n: 6, name: T["stage.6.name"], blurb: T["stage.6.blurb"], twist: T["stage.6.twist"], players: 4, bots: [{ level: "normal", vendetta: true }, { level: "normal", vendetta: true }, { level: "hard" }], coins: 120, xp: 100 },
  { n: 7, name: T["stage.7.name"], blurb: T["stage.7.blurb"], twist: T["stage.7.twist"], players: 5, bots: [{ level: "normal", partner: 2 }, { level: "normal", partner: 1 }, normal, normal], coins: 140, xp: 110 },
  { n: 8, name: T["stage.8.name"], blurb: T["stage.8.blurb"], twist: T["stage.8.twist"], players: 5, bots: [{ level: "hard", patient: true }, { level: "hard", patient: true }, normal, normal], coins: 160, xp: 120, items: ["back.blueprint"] },
  // Act 3: the big score
  { n: 9, name: T["stage.9.name"], blurb: T["stage.9.blurb"], twist: T["stage.9.twist"], players: 5, bots: [hard, normal, hard, normal], rules: { bribes: true }, coins: 180, xp: 130 },
  { n: 10, name: T["stage.10.name"], blurb: T["stage.10.blurb"], twist: T["stage.10.twist"], players: 6, bots: [hard, hard, normal, hard, normal], coins: 200, xp: 140 },
  { n: 11, name: T["stage.11.name"], blurb: T["stage.11.blurb"], twist: T["stage.11.twist"], players: 6, bots: [{ level: "hard", partner: 2 }, { level: "hard", partner: 1 }, { level: "hard", vendetta: true }, hard, normal], rules: { openDeals: true }, coins: 250, xp: 160 },
  { n: 12, name: T["stage.12.name"], blurb: T["stage.12.blurb"], twist: T["stage.12.twist"], players: 6, bots: [hard, hard, hard, hard, hard], rules: { bribes: true, placeCrew: true, openDeals: true }, coins: 400, xp: 250, items: ["title.mastermind", "felt.vaultfloor"] },
];

export const stage = (n: number): Stage | undefined => STAGES[n - 1];

/** Stages cleared so far (the next one to play is cleared + 1). */
export const campaignNext = (cleared: number) => Math.min(cleared + 1, STAGES.length);
