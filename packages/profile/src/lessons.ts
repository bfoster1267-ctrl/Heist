// Coached play lessons: a new player's first four coached games teach the game a piece at a time.
//  - Lessons 1 and 2 have no Roles, no bets and a deck of Score cards only. The coach plays every decision
//    you haven't been handed yet, and hands over one more kind each hand you play as the Boss.
//  - Lesson 3 adds the trick cards (Fixer, Backup, Double-Cross), one per hand.
//  - Lesson 4 adds Roles, from a short list of simple ones, and side bets.
// After that, Coached play is the full game. The lesson's rules go in the solo ticket, so the server
// replays it like any other game; the coach's moves are ordinary answers.

import { Bot, type Answer, type Ask, type GameState, type HeistGame, type RoleId, type RuleOptions } from "@heist/engine";
import { coachPick } from "./coach";

type Kind = Ask["kind"];

export interface Idea {
  /** the hand (your turns as the Boss, counted from 1) this idea opens on; 0: from the start */
  hand: number;
  /** decisions that are yours from then on; until then the coach plays them for you */
  kinds: Kind[];
  /** decisions that bring up the explanation (default: kinds) */
  at?: Kind[];
  /** "" for ideas from an earlier lesson, which aren't explained again */
  title: string;
  text: string;
}

export interface Lesson {
  n: number;
  name: string;
  /** one line for the lobby and the table's top bar */
  blurb: string;
  rules: Partial<RuleOptions>;
  ideas: Idea[];
  /** decisions no idea lists are yours too (otherwise the coach plays them) */
  rest?: boolean;
}

const SIMPLE_ROLES: RoleId[] = ["muscle", "lookout", "getaway", "safecracker", "pickpocket", "mastermind"];

const FIGHT: Idea = { hand: 0, kinds: ["showdown"], title: "The fight", text: "When you're the Boss or the Mark, you lay a card face down, then both flip. Your card plus your crew: higher wins, and ties go to the Mark." };
const SEND: Idea = { hand: 1, kinds: ["send"], title: "Send your crew", text: "Each crew you send is +1 in the fight. Win and they leave a Foothold in that hideout. Lose and they go to the Pen for a while." };
const TARGET: Idea = { hand: 2, kinds: ["pickHideout", "pickMark"], title: "Pick the target", text: "Hit the hideout with the fewest guards that has none of your crew yet. A new hideout means a new Foothold." };
const JOIN: Idea = { hand: 0, kinds: ["join"], title: "Pick a side", text: "When two rivals fight, you can join. Back the Boss to grab a Foothold, or defend the Mark to bank a Cut. Staying out is fine too." };
const CASH: Idea = { hand: 1, kinds: ["bank", "hire"], at: ["bank"], title: "Cash and crew", text: "Cards you bank turn into cash. Spend $3 to hire another crew. Keep your best Score in hand to fight with." };
const ACTION: Idea = { hand: 2, kinds: ["action", "again"], at: ["action"], title: "Hit, bust or lay low", text: "Now you choose your move. Hit a rival, bust a rival's Foothold out of your own hideout, or lay low when your hand is weak." };
/** what an earlier lesson taught: yours from the start, not explained again */
const known = (...ideas: Idea[]): Idea => ({ hand: 0, kinds: ideas.flatMap((i) => i.kinds), title: "", text: "" });

// A coached game deals a friendly seed, so it's short: about 2 or 3 of your hands. Each lesson teaches about
// three ideas, one per hand, and any it doesn't reach move to the next lesson's start.
export const LESSONS: Lesson[] = [
  {
    n: 1,
    name: "The fight",
    blurb: "Lesson 1 of 4. The coach plays most of your turn and hands you one new move each hand.",
    rules: { noRoles: true, scoresOnly: true, noBets: true },
    ideas: [FIGHT, SEND, TARGET, { ...JOIN, hand: 3 }, { ...CASH, hand: 4 }, { ...ACTION, hand: 5 }],
  },
  {
    n: 2,
    name: "Your turn",
    blurb: "Lesson 2 of 4. You take over the rest of your turn: picking sides, cash and crew, and your move.",
    rules: { noRoles: true, scoresOnly: true, noBets: true },
    ideas: [known(FIGHT, SEND, TARGET), JOIN, CASH, ACTION],
  },
  {
    n: 3,
    name: "Dirty tricks",
    blurb: "Lesson 3 of 4. The trick cards join the deck, one new one each hand.",
    rules: { noRoles: true, noBets: true },
    ideas: [
      known(FIGHT, SEND, TARGET, JOIN, CASH, ACTION),
      { hand: 0, kinds: ["dealOffer", "dealAccept", "deal", "discard"], at: ["showdown", "dealOffer", "dealAccept", "deal"], title: "Fixers", text: "A Fixer is a bluff card. It loses to any Score, but if both sides play a Fixer it becomes a deal: say no and both lose 2 crew to the Pen." },
      { hand: 1, kinds: ["backup"], title: "Backup", text: "After the flip, anyone holding a Backup can add +3 to either side. Use it when your side is close." },
      { hand: 2, kinds: ["doubleCross"], title: "Double-Cross", text: "Right before the fight, flip one ally to the other side. Anyone can play it." },
    ],
  },
  {
    n: 4,
    name: "Roles and bets",
    blurb: "Lesson 4 of 4. Everything so far, plus a Role that bends one rule your way, and side bets.",
    rules: { rolePool: SIMPLE_ROLES },
    rest: true,
    ideas: [
      { hand: 0, kinds: ["keepRole"], title: "Roles", text: "Each Role breaks one rule in your favor, and everyone can see everyone's. These are the simple ones; the full game has 13." },
      { hand: 1, kinds: ["bet"], title: "Side bets", text: "Not in a fight? Bet a banked card on who wins. Right and you get it back plus the top Job card. Wrong and it's gone." },
    ],
  },
];

export const lesson = (n: number | undefined): Lesson | undefined => (n ? LESSONS.find((l) => l.n === n) : undefined);

/** The lesson a player's next coached game teaches (undefined: they've done them all; it's the full game). */
export const lessonFor = (coachGames: number): number | undefined => (coachGames < LESSONS.length ? coachGames + 1 : undefined);

/** How many hands `seat` has started as the Boss so far (0 before their first turn). */
export function handOf(s: GameState, seat: number): number {
  if (s.phase === "setup" || s.phase === "keepRole") return 0;
  let k = 0;
  for (let t = 0; t <= s.turn; t++) if ((s.firstBoss + t) % s.n === seat) k++;
  return k;
}

/** Is this decision the learner's to make yet? (No lesson: always.) */
export function lessonOpen(n: number | undefined, s: GameState, ask: Ask): boolean {
  const l = lesson(n);
  if (!l) return true;
  const hand = handOf(s, ask.seat);
  const ideas = l.ideas.filter((i) => i.kinds.includes(ask.kind));
  if (!ideas.length) return !!l.rest;
  return ideas.some((i) => i.hand <= hand);
}

/** The idea to explain at this decision: open, not explained yet, and about this decision. */
export function ideaFor(n: number | undefined, s: GameState, ask: Ask, taught: string[]): Idea | undefined {
  const l = lesson(n);
  if (!l) return undefined;
  const hand = handOf(s, ask.seat);
  return l.ideas.find((i) => i.title && i.hand <= hand && !taught.includes(i.title) && (i.at ?? i.kinds).includes(ask.kind));
}

/** The coach's move when it plays a decision for the learner: its pick, else a careful bot's. */
export function autoPick(g: HeistGame, ask: Ask): Answer {
  return coachPick(g, ask) ?? new Bot(g.s.turn * 977 + ask.seat, { level: "normal" }).answer(g, ask);
}
