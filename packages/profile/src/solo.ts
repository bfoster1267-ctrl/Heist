// Solo tables (you against bots). The browser and the server build these the same way, so the server
// can replay a solo game from its seed and the player's answers and check the result before it counts
// toward a career: the bots' moves come from their own seeded randomness, never from the client.

import { Bot, HeistGame, runBots, type Answer, type Ask, type BotLevel, type GameEvent } from "@heist/engine";
import { BOT_RATING, type Rival } from "./rating";

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

/** `levels` gives each bot seat (seat 1 up) its level, picked from the player's rating; missing = normal. */
export function createSoloGame(seed: number, players: number, name: string, snapshots = true, levels: BotLevel[] = []) {
  const bots = soloBotNames(seed, players);
  const seats = Array.from({ length: players }, (_, i) => (i === SOLO_SEAT ? { name: name || "Ace", bot: false } : { name: bots[i - 1], bot: true }));
  const game = new HeistGame({ seed, seats, snapshots });
  const botMap = new Map(game.s.players.filter((p) => p.bot).map((p) => [p.seat, new Bot(seed + p.seat * 31, { level: levels[p.seat - 1] ?? "normal" })]));
  return { game, bots: botMap };
}

export interface SoloReplay {
  winners: number[];
  reason: "footholds" | "last_call";
  events: GameEvent[];
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
  levels: BotLevel[] = [],
): SoloReplay {
  const { game, bots } = createSoloGame(seed, players, "You", false, levels);
  const events: GameEvent[] = [];
  const take = () => events.push(...game.drainFrames().map((f) => f.ev));
  take();
  let i = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    runBots(game, bots);
    take();
    const p = game.pending;
    if (!p) break;
    if (p.seat !== SOLO_SEAT) throw new Error("bot stalled");
    if (i >= answers.length) throw new Error("game isn't finished");
    const a = clean(p, answers[i++]);
    if (!a) throw new Error("bad answer");
    game.answer(SOLO_SEAT, a);
    take();
  }
  if (i !== answers.length) throw new Error("extra answers");
  if (!game.s.winners) throw new Error("game isn't finished");
  return { winners: game.s.winners, reason: game.s.endReason ?? "last_call", events };
}

/** The pot is every seat's buy-in; winners split it (bots' buy-ins are house money). */
export function payout(stakes: number, players: number, winners: number[], seat: number): number {
  return winners.includes(seat) ? Math.floor((stakes * players) / winners.length) : 0;
}

/** The bots at a solo table, as rivals for the skill rating. */
export function soloRivals(players: number, levels: BotLevel[] = [], winners: number[] = []): Rival[] {
  return Array.from({ length: players - 1 }, (_, i) => ({ rating: BOT_RATING[levels[i] ?? "normal"], won: winners.includes(i + 1) }));
}
