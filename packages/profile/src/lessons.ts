// Coached play lessons: a new player's first five coached games teach the game a piece at a time.
//  - The first is a single hand: one round (everyone is the Boss once), then the game ends and the new
//    player is shown around the lobby. It teaches the fight and sending crew.
//  - The next two have no Roles, no bets and a deck of Score cards only. The coach plays every decision
//    you haven't been handed yet, and hands over one more kind each hand you play as the Boss.
//  - Then the trick cards (Fixer, Backup, Double-Cross), one per hand.
//  - The last adds Roles, from a short list of simple ones, and side bets.
// After that, Coached play is the full game. The lesson's rules go in the solo ticket, so the server
// replays it like any other game; the coach's moves are ordinary answers.
// A lesson's `n` is its id in solo tickets and saved games, so it never changes: the first hand came later
// and is n 5. Show players its place in the list (lessonNo), not n.

import { Bot, type Answer, type Ask, type GameState, type HeistGame, type RoleId, type RuleOptions } from "@heist/engine";
import { coachPick } from "./coach";
import { PROFILE_TEXT as T } from "./text";

type Kind = Ask["kind"];

export interface Idea {
  /** stable id for the idea's text (PROFILE_TEXT idea.<id>.title / .text); "" for known ideas */
  id: string;
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
  /** id kept in tickets and saved games (not the lesson's place in the list: see lessonNo) */
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

const FIGHT: Idea = { id: "fight", hand: 0, kinds: ["showdown"], title: T["idea.fight.title"], text: T["idea.fight.text"] };
const SEND: Idea = { id: "send", hand: 1, kinds: ["send"], title: T["idea.send.title"], text: T["idea.send.text"] };
const TARGET: Idea = { id: "target", hand: 2, kinds: ["pickHideout", "pickMark"], title: T["idea.target.title"], text: T["idea.target.text"] };
const JOIN: Idea = { id: "join", hand: 0, kinds: ["join"], title: T["idea.join.title"], text: T["idea.join.text"] };
const CASH: Idea = { id: "cash", hand: 1, kinds: ["bank", "hire"], at: ["bank"], title: T["idea.cash.title"], text: T["idea.cash.text"] };
const ACTION: Idea = { id: "action", hand: 2, kinds: ["action", "again"], at: ["action"], title: T["idea.action.title"], text: T["idea.action.text"] };
/** what an earlier lesson taught: yours from the start, not explained again */
const known = (...ideas: Idea[]): Idea => ({ id: "", hand: 0, kinds: ideas.flatMap((i) => i.kinds), title: "", text: "" });

/** the first hand: one round, then the new player is shown around the lobby (FIRST_HAND is its id) */
export const FIRST_HAND = 5;

// A coached game deals a friendly seed, so it's short: about 2 or 3 of your hands. Each lesson teaches about
// three ideas, one per hand, and any it doesn't reach move to the next lesson's start.
export const LESSONS: Lesson[] = [
  {
    n: FIRST_HAND,
    name: T["lesson.5.name"],
    blurb: T["lesson.5.blurb"],
    rules: { noRoles: true, scoresOnly: true, noBets: true, rounds: 1 },
    ideas: [FIGHT, SEND],
  },
  {
    n: 1,
    name: T["lesson.1.name"],
    blurb: T["lesson.1.blurb"],
    rules: { noRoles: true, scoresOnly: true, noBets: true },
    ideas: [known(FIGHT, SEND), { ...TARGET, hand: 1 }, { ...JOIN, hand: 2 }, { ...CASH, hand: 3 }, { ...ACTION, hand: 4 }],
  },
  {
    n: 2,
    name: T["lesson.2.name"],
    blurb: T["lesson.2.blurb"],
    rules: { noRoles: true, scoresOnly: true, noBets: true },
    ideas: [known(FIGHT, SEND, TARGET), JOIN, CASH, ACTION],
  },
  {
    n: 3,
    name: T["lesson.3.name"],
    blurb: T["lesson.3.blurb"],
    rules: { noRoles: true, noBets: true },
    ideas: [
      known(FIGHT, SEND, TARGET, JOIN, CASH, ACTION),
      { id: "fixers", hand: 0, kinds: ["dealOffer", "dealAccept", "deal", "discard"], at: ["showdown", "dealOffer", "dealAccept", "deal"], title: T["idea.fixers.title"], text: T["idea.fixers.text"] },
      { id: "backup", hand: 1, kinds: ["backup"], title: T["idea.backup.title"], text: T["idea.backup.text"] },
      { id: "doubleCross", hand: 2, kinds: ["doubleCross"], title: T["idea.doubleCross.title"], text: T["idea.doubleCross.text"] },
    ],
  },
  {
    n: 4,
    name: T["lesson.4.name"],
    blurb: T["lesson.4.blurb"],
    rules: { rolePool: SIMPLE_ROLES },
    rest: true,
    ideas: [
      { id: "roles", hand: 0, kinds: ["keepRole"], title: T["idea.roles.title"], text: T["idea.roles.text"] },
      { id: "bets", hand: 1, kinds: ["bet"], title: T["idea.bets.title"], text: T["idea.bets.text"] },
    ],
  },
];

export const lesson = (n: number | undefined): Lesson | undefined => (n ? LESSONS.find((l) => l.n === n) : undefined);

/**
 * The lesson a player's next coached game teaches (undefined: they've done them all; it's the full game).
 * `firstHand` false: for an older cached client that only knows lessons 1-4, which it plays in order.
 */
export const lessonFor = (coachGames: number, firstHand = true): number | undefined =>
  firstHand ? LESSONS[coachGames]?.n : coachGames < 4 ? coachGames + 1 : undefined;

/** A lesson's place in the list, counted from 1, as players see it ("Lesson 2 of 5"). */
export const lessonNo = (n: number | undefined): number | undefined => {
  const i = LESSONS.findIndex((l) => l.n === n);
  return i < 0 ? undefined : i + 1;
};

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
