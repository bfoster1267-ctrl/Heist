// Heist v3 rules engine types. Everything here is plain JSON so a server can send it to clients.

export type CardKind = "S" | "F" | "B" | "X"; // Score, Fixer, Backup, Double-Cross

export interface Card {
  id: number;
  kind: CardKind;
  score: number; // Score cards only; 0 otherwise
  cash: number; // printed cash value
  color: number; // crew color index 0..5 (see CREWS)
}

export type RoleId =
  | "muscle"
  | "getaway"
  | "safecracker"
  | "mastermind"
  | "forger"
  | "pickpocket"
  | "inside_man"
  | "bookie"
  | "hacker"
  | "lookout"
  | "fence"
  | "double_agent"
  | "wildcard";

export type Side = "B" | "M"; // Boss side, Mark side

export interface PlayerState {
  seat: number;
  name: string;
  color: number; // crew color index
  bot: boolean;
  role: RoleId | null;
  hand: Card[];
  bank: Card[];
  reserve: number;
  pen: number;
  /** hideouts[h][seat] = how many of that seat's crew sit in this player's hideout h */
  hideouts: number[][];
  forgeUsed: boolean;
  wildUsed: boolean;
}

export interface Bet {
  seat: number;
  card: Card;
  side: Side;
}

export interface JobState {
  kind: "hit" | "bust";
  boss: number;
  mark: number;
  hideout: number; // index into the Mark's hideouts (hit) or the Boss's (bust)
  wanted: boolean;
  /** crew each seat sent to each side */
  side: { B: number[]; M: number[] };
  bets: Bet[];
  bossCard: Card | null;
  markCard: Card | null;
  revealed: boolean;
  forged: { B: number | null; M: number | null };
  backups: { B: number; M: number };
  hackerCall: { seat: number; n: number } | null;
  bTotal: number;
  mTotal: number;
  result: Side | "deal" | "nodeal" | null;
  note: string;
}

export interface GameState {
  n: number;
  players: PlayerState[];
  deck: Card[];
  deckCount: number;
  discard: Card[];
  boss: number;
  firstBoss: number;
  turn: number;
  reshuffles: number;
  lastCall: boolean;
  target: number;
  againAllowed: boolean;
  job: JobState | null;
  flip: Card | null;
  phase: string;
  winners: number[] | null;
  endReason: "footholds" | "last_call" | null;
}

// ---------------------------------------------------------------- decisions

export type Ask =
  | { kind: "keepRole"; seat: number; options: RoleId[] }
  | { kind: "wildcard"; seat: number; targets: number[] }
  | { kind: "fence"; seat: number; cost: number }
  | { kind: "bank"; seat: number; max: number }
  | { kind: "hire"; seat: number; max: number; cost: number }
  | { kind: "action"; seat: number; canHit: boolean; busts: BustOption[]; wanted: WantedOption[] }
  | { kind: "pickMark"; seat: number; rivals: number[]; why: "free" | "mastermind" }
  | { kind: "pickHideout"; seat: number; mark: number }
  | { kind: "send"; seat: number; max: number }
  | { kind: "join"; seat: number; max: number; split: boolean }
  | { kind: "doubleCross"; seat: number; targets: number[] }
  | { kind: "bet"; seat: number }
  | { kind: "hackerCall"; seat: number; numbers: number[] }
  | { kind: "showdown"; seat: number; as: "boss" | "mark" | "bust" | "rival" }
  | { kind: "forger"; seat: number; numbers: number[] }
  | { kind: "backup"; seat: number }
  | { kind: "dealOffer"; seat: number }
  | { kind: "dealAccept"; seat: number; offer: DealOffer }
  | { kind: "again"; seat: number }
  | { kind: "discard"; seat: number; count: number };

export interface BustOption {
  hideout: number;
  rival: number;
}
export interface WantedOption {
  mark: number;
  hideout: number;
  leader: number;
}
export type DealOffer = "walk" | "foothold";

export type Answer =
  | { kind: "keepRole"; role: RoleId }
  | { kind: "wildcard"; target: number | null }
  | { kind: "fence"; cardId: number | null }
  | { kind: "bank"; cardIds: number[] }
  | { kind: "hire"; count: number }
  | { kind: "action"; choice: "hit" }
  | { kind: "action"; choice: "pass" }
  | { kind: "action"; choice: "bust"; hideout: number; rival: number }
  | { kind: "action"; choice: "wanted"; mark: number; hideout: number }
  | { kind: "pickMark"; mark: number }
  | { kind: "pickHideout"; hideout: number }
  | { kind: "send"; count: number }
  | { kind: "join"; B: number; M: number }
  | { kind: "doubleCross"; target: number | null }
  | { kind: "bet"; side: Side | null; cardId?: number }
  | { kind: "hackerCall"; n: number }
  | { kind: "showdown"; cardId: number }
  | { kind: "forger"; n: number | null }
  | { kind: "backup"; side: Side | null }
  | { kind: "dealOffer"; offer: DealOffer | null }
  | { kind: "dealAccept"; accept: boolean }
  | { kind: "again"; again: boolean }
  | { kind: "discard"; cardIds: number[] };

// ---------------------------------------------------------------- events (what the table animates)

export type GameEvent =
  | { t: "setup" }
  | { t: "role"; seat: number; role: RoleId }
  | { t: "wildcard"; seat: number; target: number }
  | { t: "turn"; seat: number }
  | { t: "draw"; seat: number; count: number }
  | { t: "reshuffle"; count: number }
  | { t: "lastCall" }
  | { t: "penReturn"; seat: number; count: number }
  | { t: "fence"; seat: number; cardId: number }
  | { t: "bank"; seat: number; cardIds: number[] }
  | { t: "hire"; seat: number; count: number }
  | { t: "stuck"; seat: number }
  | { t: "flip"; seat: number; card: Card; mark: number | null }
  | { t: "mark"; boss: number; mark: number; how: "flip" | "pick" | "wanted" | "mastermind" }
  | { t: "target"; mark: number; hideout: number }
  | { t: "send"; seat: number; side: Side; count: number }
  | { t: "pass"; seat: number }
  | { t: "doubleCross"; seat: number; target: number; to: Side }
  | { t: "bet"; seat: number; side: Side }
  | { t: "hackerCall"; seat: number; n: number }
  | { t: "facedown"; seat: number }
  | { t: "reveal"; bTotal: number; mTotal: number }
  | { t: "hacked"; seat: number }
  | { t: "forged"; seat: number; n: number }
  | { t: "backup"; seat: number; side: Side }
  | { t: "result"; winner: Side; bTotal: number; mTotal: number }
  | { t: "fixerFixer" }
  | { t: "deal"; offer: DealOffer; accepted: boolean }
  | { t: "toPen"; seat: number; count: number }
  | { t: "foothold"; seat: number; owner: number; hideout: number }
  | { t: "loot"; from: number; to: number; amount: number }
  | { t: "cut"; seat: number }
  | { t: "betPaid"; seat: number; won: boolean }
  | { t: "bust"; seat: number; rival: number; hideout: number }
  | { t: "bustResult"; winner: number; loser: number }
  | { t: "again"; seat: number }
  | { t: "discard"; seat: number; count: number }
  | { t: "gameOver"; winners: number[]; reason: "footholds" | "last_call" };

export interface Frame {
  ev: GameEvent;
  msg: string;
  state: GameState;
}

export interface SeatConfig {
  name: string;
  bot: boolean;
  color?: number;
}

export interface GameConfig {
  seats: SeatConfig[];
  seed: number;
}
