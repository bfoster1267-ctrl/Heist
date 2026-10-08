// Solo tables (you against bots). The browser and the server build these the same way, so the server
// can replay a solo game from its seed and the player's answers and check the result before it counts
// toward a career: the bots' moves come from their own seeded randomness, never from the client.

import { Bot, HeistGame, runBots, type Answer, type Ask, type BotLevel, type BotOptions, type GameEvent, type RuleOptions } from "@heist/engine";
import { stage } from "./campaign";
import { checkMove, type MistakeCounts } from "./coach";
import { BOT_RATING, type Rival } from "./rating";

/** How a solo table's bots are set up: levels picked from the rating, or a campaign stage. Empty: all normal. */
export interface SoloSetup {
  levels?: BotLevel[];
  stage?: number;
}

/** The bots and rules a solo table is built with. */
export function soloTable(players: number, setup: SoloSetup = {}): { players: number; bots: BotOptions[]; rules?: Partial<RuleOptions> } {
  const st = setup.stage ? stage(setup.stage) : undefined;
  if (st) return { players: st.players, bots: st.bots, rules: st.rules };
  return { players, bots: Array.from({ length: players - 1 }, (_, i) => ({ level: setup.levels?.[i] ?? "normal" })) };
}

export const SOLO_SEAT = 0;
const BOT_NAMES = ["Vinnie", "Rosa", "Dutch", "Lola", "Sal", "Margo", "Frankie", "Ivy", "Nico", "Bea"];

export function soloBotNames(seed: number, players: number): string[] {
  const names = [...BOT_NAMES];
  // deterministic shuffle, so the server and the table agree on who's sitting where
  let x = seed >>> 0 || 1;
  for (let i = names.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) >>> 0;
    const j = x % (i + 1);
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names.slice(0, players - 1);
}

export function createSoloGame(seed: number, players: number, name: string, snapshots = true, setup: SoloSetup = {}) {
  const t = soloTable(players, setup);
  const bots = soloBotNames(seed, t.players);
  const seats = Array.from({ length: t.players }, (_, i) => (i === SOLO_SEAT ? { name: name || "Ace", bot: false } : { name: bots[i - 1], bot: true }));
  const game = new HeistGame({ seed, seats, snapshots, rules: t.rules });
  const botMap = new Map(game.s.players.filter((p) => p.bot).map((p) => [p.seat, new Bot(seed + p.seat * 31, t.bots[p.seat - 1])]));
  return { game, bots: botMap };
}

export interface SoloReplay {
  winners: number[];
  reason: "footholds" | "last_call";
  events: GameEvent[];
  /** rookie mistakes the player made (see coach.ts) */
  mistakes: MistakeCounts;
}

/**
 * Replay a finished solo game. Throws if the answers don't make a legal, finished game. Answers from the
 * network go through `clean` first (the server passes its answer sanitizer).
 */
export function replaySolo(
  seed: number,
  players: number,
  answers: unknown[],
  clean: (ask: Ask, raw: unknown) => Answer | null = (_, a) => a as Answer,
  setup: SoloSetup = {},
): SoloReplay {
  const { game, bots } = createSoloGame(seed, players, "You", false, setup);
  const events: GameEvent[] = [];
  const take = () => events.push(...game.drainFrames().map((f) => f.ev));
  take();
  let i = 0;
  const mistakes: MistakeCounts = {};
  for (let guard = 0; guard < 100_000; guard++) {
    runBots(game, bots);
    take();
    const p = game.pending;
    if (!p) break;
    if (p.seat !== SOLO_SEAT) throw new Error("bot stalled");
    if (i >= answers.length) throw new Error("game isn't finished");
    const a = clean(p, answers[i++]);
    if (!a) throw new Error("bad answer");
    const m = checkMove(game.s, p, a);
    if (m) mistakes[m] = (mistakes[m] ?? 0) + 1;
    game.answer(SOLO_SEAT, a);
    take();
  }
  if (i !== answers.length) throw new Error("extra answers");
  if (!game.s.winners) throw new Error("game isn't finished");
  return { winners: game.s.winners, reason: game.s.endReason ?? "last_call", events, mistakes };
}

/** The pot is every seat's buy-in; winners split it (bots' buy-ins are house money). */
export function payout(stakes: number, players: number, winners: number[], seat: number): number {
  return winners.includes(seat) ? Math.floor((stakes * players) / winners.length) : 0;
}

/** The bots at a solo table, as rivals for the skill rating. */
export function soloRivals(players: number, setup: SoloSetup = {}, winners: number[] = []): Rival[] {
  return soloTable(players, setup).bots.map((b, i) => ({ rating: BOT_RATING[b.level ?? "normal"], won: winners.includes(i + 1) }));
}
