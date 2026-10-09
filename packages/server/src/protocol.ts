// Wire protocol between the Heist game server and a table client. JSON over one WebSocket.
// No Node imports here: the web app and the iPhone app import these types too.
//
// The server is authoritative. A client never runs the engine for an online table: it sends answers
// and plays back the Frames it is sent. Every Frame's state has already been passed through viewFor
// for the seat that receives it, so other hands, face-down showdown cards and the deck are never sent.

import type { Answer, Ask, BotLevel, Frame, GameState, RuleOptions } from "@heist/engine";
import type { Badge, Progress, Reward } from "@heist/profile";

export const PROTOCOL_VERSION = 1;

// ------------------------------------------------------------------ rooms

export type RoomStatus = "lobby" | "playing" | "over";

export interface SeatInfo {
  seat: number;
  kind: "open" | "human" | "bot";
  name: string;
  userId: string | null;
  connected: boolean;
  /** a bot is playing this human's seat (they timed out twice, left, or asked for it) */
  autopilot: boolean;
  /** level, prestige, frame and title of a signed-in player */
  badge?: Badge | null;
}

export interface RoomInfo {
  id: string;
  /** short code friends type or share in an invite link */
  code: string;
  status: RoomStatus;
  players: number;
  /** play-money chips per player for this table (no real money; see docs/PLAN.md) */
  stakes: number;
  isPrivate: boolean;
  hostId: string | null;
  seats: SeatInfo[];
  spectators: number;
  turnSeconds: number;
  /** optional rules this table plays with (see docs/ENGINE.md); a client must handle their Asks */
  rules: RuleOptions;
  /** how the bots that fill empty chairs play */
  botLevel: BotLevel;
  /** how many games this room has played (a rematch starts the next one) */
  games: number;
}

export interface RoomSummary {
  code: string;
  players: number;
  stakes: number;
  open: number;
  status: RoomStatus;
}

export interface CreateRoomOptions {
  players: number;
  stakes?: number;
  isPrivate?: boolean;
  /** seconds a human has for each decision before a bot answers for them */
  turnSeconds?: number;
  /** optional rules (default all off) */
  rules?: Partial<RuleOptions>;
  /** bots for empty chairs: "easy" | "normal" (default) | "hard" */
  botLevel?: BotLevel;
}

/** A Frame numbered within the current game, with state already filtered for the receiver. */
export interface SeenFrame extends Frame {
  i: number;
}

// ------------------------------------------------------------------ client -> server

export type ClientMsg =
  | { t: "hello"; v: number; token?: string; name?: string }
  | { t: "create"; options: CreateRoomOptions }
  | { t: "join"; code: string; spectate?: boolean; /** last frame index this client has, to resume without a full sync */ since?: number }
  | { t: "leave" }
  | { t: "list" }
  /** quick queue: get dealt into the next table of this size and stakes (bots fill seats after a wait) */
  | { t: "queue"; players: number; stakes: number }
  | { t: "unqueue" }
  | { t: "start" }
  /** a spectator takes a free seat (or a bot's chair) before the next game */
  | { t: "sit" }
  | { t: "answer"; askId: number; answer: Answer }
  | { t: "autopilot"; on: boolean }
  | { t: "chat"; text: string }
  /** buy a drink (coins) for one seat, or for everyone with a round (`to: null`) */
  | { t: "drink"; id: string; to: number | null }
  | { t: "ping"; n?: number };

// ------------------------------------------------------------------ server -> client

export type ErrorCode =
  | "bad_message"
  | "rate_limited"
  | "not_authenticated"
  | "no_room"
  | "room_full"
  | "not_host"
  | "not_your_turn"
  | "stale_ask"
  | "illegal"
  | "bad_state"
  | "no_chips"
  | "no_coins"
  | "suspended"
  | "version";

export type ServerMsg =
  | { t: "welcome"; v: number; userId: string; name: string; token: string }
  | { t: "rooms"; rooms: RoomSummary[] }
  | { t: "room"; room: RoomInfo; you: { seat: number | null } }
  /** full catch-up: the table as it is now (sent on join, reconnect, or a resume too old to replay) */
  | { t: "sync"; game: number; state: GameState; frame: number; log: string[] }
  /** new frames, in order; play them back with the table's pacing */
  | { t: "frames"; game: number; frames: SeenFrame[] }
  /** it's your decision; answer with the same askId before the deadline (epoch ms) */
  | { t: "ask"; askId: number; ask: Ask; deadline: number }
  /** who everyone is waiting on (sent to all, without the private details of the Ask) */
  | { t: "waiting"; seat: number; kind: Ask["kind"]; deadline: number }
  | { t: "timeout"; seat: number; autopilot: boolean }
  /** winners: who won on the table; paid: who takes the pot (winners still at the table, or the next best);
   * abandoned: players who weren't there at the end, who lose their buy-in */
  | { t: "gameOver"; game: number; winners: number[]; paid: number[]; abandoned: number[]; reason: "footholds" | "last_call"; stakes: number }
  | { t: "chat"; seat: number | null; name: string; text: string; at: number }
  /** someone bought a drink: `to` lists every seat it goes to */
  | { t: "drink"; from: number; to: number[]; id: string; name: string; at: number }
  /** your XP, coins and level after a game (signed-in players only), and your updated progress */
  | { t: "reward"; game: number; reward: Reward; progress: Progress }
  | { t: "left" }
  /** you're in the quick queue: how many are waiting, and when the table starts regardless (epoch ms) */
  | { t: "queue"; players: number; stakes: number; waiting: number; startsAt: number }
  | { t: "unqueued" }
  | { t: "error"; code: ErrorCode; msg: string }
  | { t: "pong"; n?: number; at: number };
