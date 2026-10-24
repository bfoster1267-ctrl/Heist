// Wire protocol between the Heist game server and a table client. JSON over one WebSocket.
// No Node imports here: the web app and the iPhone app import these types too.
//
// The server is authoritative. A client never runs the engine for an online table: it sends answers
// and plays back the Frames it is sent. Every Frame's state has already been passed through viewFor
// for the seat that receives it, so other hands, face-down showdown cards and the deck are never sent.

import type { Answer, Ask, BotLevel, Frame, GameState, RuleOptions } from "@heist/engine";
import type { Badge, Progress, Reward, PlayingCard, SlapReason } from "@heist/profile";

export type { PlayingCard, SlapReason };

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
  /** a ranked table: one game, people only, no coaching on the table */
  ranked?: boolean;
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
  | { t: "queue"; players: number; stakes: number; ranked?: boolean }
  | { t: "unqueue" }
  | { t: "start" }
  /** a spectator takes a free seat (or a bot's chair) before the next game */
  | { t: "sit" }
  | { t: "answer"; askId: number; answer: Answer }
  | { t: "autopilot"; on: boolean }
  | { t: "chat"; text: string }
  /** change your name (saved to your account); your seat shows it at once while the table hasn't dealt */
  | { t: "rename"; name: string }
  /** buy a drink (coins) for one seat, or for everyone with a round (`to: null`) */
  | { t: "drink"; id: string; to: number | null }
  | { t: "ping"; n?: number }
  /** the app went to the background (or came back): while away, your turn sends a phone alert */
  | { t: "away"; on: boolean }
  // ERS Multiplayer messages
  | { t: "ers_create"; isPrivate?: boolean }
  | { t: "ers_join"; code: string }
  | { t: "ers_play" }
  | { t: "ers_slap"; time?: number }
  | { t: "ers_rematch" }
  | { t: "ers_leave" }
  | { t: "play" }
  | { t: "slap"; time?: number };

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
  | "ranked_locked"
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
  /** your new name, after a rename */
  | { t: "renamed"; name: string }
  /** you're in the quick queue: how many people are waiting, how many bots have sat down so far, and when the table starts regardless (epoch ms) */
  | { t: "queue"; players: number; stakes: number; waiting: number; bots: number; startsAt: number; ranked?: boolean }
  | { t: "unqueued" }
  | { t: "error"; code: ErrorCode; msg: string }
  | { t: "pong"; n?: number; at: number }
  // ERS Multiplayer broadcasts
  | { t: "ers_welcome"; seat: 0 | 1 | null; code: string }
  | { t: "ers_rooms"; rooms: ErsRoomSummary[] }
  | { t: "ers_sync"; room: ErsRoomView }
  | { t: "ers_flip"; seat: 0 | 1; card: PlayingCard; potCount: number; topCards: PlayingCard[]; turn: 0 | 1; challenge: { by: 0 | 1; chances: number } | null }
  | { t: "ers_slap"; seat: 0 | 1; valid: boolean; reason: SlapReason; winnerSeat: 0 | 1 | null; cardsWon: number; burnedCard?: PlayingCard; potCount: number; p0Count: number; p1Count: number; slower?: boolean }
  | { t: "ers_challenge"; by: 0 | 1; chances: number; status: "started" | "step" | "won"; cardsAwarded?: number }
  | { t: "ers_over"; winner: 0 | 1; reason: string; stats: ErsStats }
  | { t: "ers_error"; code: string; msg: string }
  | { t: "ers_left"; seat: 0 | 1 };

// ------------------------------------------------------------------ ERS types

export interface ErsRoomSummary {
  code: string;
  players: number;
  status: "waiting" | "playing" | "over";
}

export interface ErsMoveLog {
  id: number;
  time: number;
  seat: 0 | 1;
  action: "play" | "slap" | "burn" | "challenge_win" | "slap_win" | "game_over";
  card?: PlayingCard;
  reason?: string;
  detail: string;
}

export interface ErsStats {
  cardsWon: [number, number];
  slaps: [number, number];
  falseSlaps: [number, number];
  faceChallengesWon: [number, number];
}

export interface ErsRoomView {
  id: string;
  code: string;
  status: "waiting" | "playing" | "over";
  you: {
    seat: 0 | 1 | null;
    cardCount: number;
    cards?: PlayingCard[];
  };
  opponent: {
    seat: 0 | 1 | null;
    name: string;
    connected: boolean;
    cardCount: number;
  } | null;
  turn: 0 | 1;
  challenge: { by: 0 | 1; chances: number } | null;
  potCount: number;
  topCards: PlayingCard[];
  slapWindow: boolean;
  validSlapReason: SlapReason;
  winner: 0 | 1 | null;
  winReason?: string;
  stats: ErsStats;
  lastEvent?: string;
  moveLogs: ErsMoveLog[];
}

