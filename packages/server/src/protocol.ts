// Wire protocol between the Heist game server and a table client. JSON over one WebSocket.
// No Node imports here: the web app and the iPhone app import these types too.
//
// The server is authoritative. A client never runs the engine for an online table: it sends answers
// and plays back the Frames it is sent. Every Frame's state has already been passed through viewFor
// for the seat that receives it, so other hands, face-down showdown cards and the deck are never sent.

import type { Answer, Ask, BotLevel, Frame, GameState, RuleOptions } from "@heist/engine";

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
  | { t: "start" }
  | { t: "answer"; askId: number; answer: Answer }
  | { t: "autopilot"; on: boolean }
  | { t: "chat"; text: string }
  /** buy a drink for another seat at the table (play-money cosmetic; seated players only) */
  | { t: "drink"; to: number; drink: DrinkId }
  | { t: "ping"; n?: number };

/** The drinks a player can send across the table. */
export const DRINK_IDS = ["martini", "whiskey", "champagne", "beer", "coffee"] as const;
export type DrinkId = (typeof DRINK_IDS)[number];

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
  | { t: "gameOver"; game: number; winners: number[]; reason: "footholds" | "last_call"; stakes: number }
  | { t: "chat"; seat: number | null; name: string; text: string; at: number }
  | { t: "drink"; from: number; to: number; drink: DrinkId }
  | { t: "left" }
  | { t: "error"; code: ErrorCode; msg: string }
  | { t: "pong"; n?: number; at: number };
