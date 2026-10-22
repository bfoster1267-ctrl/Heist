// Egyptian Rat Screw (ERS) Real-Time 2-Player Multiplayer Room Handler
// Pure authoritative server state for 2-player head-to-head card flipping,
// face-card challenges, millisecond-adjudicated slaps, and win/loss resolution.

import { cardRank, checkSlap, dealErs, faceChances, type PlayingCard, type SlapReason } from "@heist/profile";
import type { ErsMoveLog, ErsRoomSummary, ErsRoomView, ErsStats, ServerMsg } from "./protocol";
import type { Clock, Conn } from "./room";
import { realClock } from "./room";

const ERS_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateErsCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += ERS_CODE_CHARS[Math.floor(Math.random() * ERS_CODE_CHARS.length)];
  }
  return code;
}

export interface ErsSeatState {
  seat: 0 | 1;
  userId: string | null;
  name: string;
  conn: Conn | null;
  connected: boolean;
  rematch: boolean;
}

export interface ErsRoomDeps {
  clock?: Clock;
  seed?: number;
  onGameOver?: (report: { roomId: string; code: string; winner: 0 | 1; stats: ErsStats }) => void;
  onChange?: (room: ErsRoom) => void;
  log?: (msg: string, extra?: object) => void;
}

export class ErsRoom {
  readonly id: string;
  readonly code: string;
  readonly clock: Clock;
  readonly isPrivate: boolean;

  status: "waiting" | "playing" | "over" = "waiting";
  seats: [ErsSeatState | null, ErsSeatState | null] = [null, null];

  /** Player 0 draw pile (face-down, top card is last element) */
  p0: PlayingCard[] = [];
  /** Player 1 draw pile (face-down, top card is last element) */
  p1: PlayingCard[] = [];
  /** Center pot pile (top card is last element, bottom card is index 0) */
  pot: PlayingCard[] = [];

  turn: 0 | 1 = 0;
  challenge: { by: 0 | 1; chances: number } | null = null;
  winner: 0 | 1 | null = null;
  winReason?: string;
  lastEvent?: string;

  stats: ErsStats = {
    cardsWon: [0, 0],
    slaps: [0, 0],
    falseSlaps: [0, 0],
    faceChallengesWon: [0, 0],
  };

  moveLogs: ErsMoveLog[] = [];
  private nextLogId = 1;
  private seed: number;
  private lastSlapResolved: { time: number; winner: 0 | 1; reason: SlapReason } | null = null;
  idleSince: number;

  constructor(
    options: { id?: string; code?: string; isPrivate?: boolean; seed?: number } = {},
    private deps: ErsRoomDeps = {}
  ) {
    this.clock = deps.clock ?? realClock;
    this.id = options.id ?? `ers_${Math.random().toString(36).slice(2, 9)}`;
    this.code = options.code ?? generateErsCode();
    this.isPrivate = options.isPrivate ?? false;
    this.seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.idleSince = this.clock.now();
  }

  /** Number of active human connections seated */
  get connections(): number {
    return this.seats.filter((s) => s && s.connected).length;
  }

  /** Check if a seat is open */
  openSeats(): number {
    let count = 0;
    if (!this.seats[0]) count++;
    if (!this.seats[1]) count++;
    return count;
  }

  summary(): ErsRoomSummary {
    const players = (this.seats[0] ? 1 : 0) + (this.seats[1] ? 1 : 0);
    return { code: this.code, players, status: this.status };
  }

  /** Get player view of the room */
  viewFor(seat: 0 | 1 | null): ErsRoomView {
    const youSeat = seat !== null ? this.seats[seat] : null;
    const oppIndex: 0 | 1 | null = seat !== null ? ((seat === 0 ? 1 : 0) as 0 | 1) : null;
    const oppSeat = oppIndex !== null ? this.seats[oppIndex] : null;

    const myPile = seat === 0 ? this.p0 : seat === 1 ? this.p1 : [];
    const oppPile = oppIndex === 0 ? this.p0 : oppIndex === 1 ? this.p1 : [];

    const topCards = this.pot.slice(-5); // last 5 cards for visual stacking
    const validSlapReason = checkSlap(this.pot);

    return {
      id: this.id,
      code: this.code,
      status: this.status,
      you: {
        seat,
        cardCount: myPile.length,
        cards: seat !== null ? [...myPile] : undefined,
      },
      opponent: oppSeat
        ? {
            seat: oppSeat.seat,
            name: oppSeat.name,
            connected: oppSeat.connected,
            cardCount: oppPile.length,
          }
        : null,
      turn: this.turn,
      challenge: this.challenge,
      potCount: this.pot.length,
      topCards,
      slapWindow: validSlapReason !== null,
      validSlapReason,
      winner: this.winner,
      winReason: this.winReason,
      stats: structuredClone(this.stats),
      lastEvent: this.lastEvent,
      moveLogs: this.moveLogs.slice(-25),
    };
  }

  /** Player joins the room */
  join(conn: Conn): { ok: boolean; seat?: 0 | 1; error?: string } {
    this.idleSince = this.clock.now();

    // Check if user is reconnecting
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (s && s.userId === conn.userId) {
        s.conn = conn;
        s.connected = true;
        s.name = conn.name;
        this.broadcastSync();
        conn.send({ t: "ers_welcome", seat: s.seat, code: this.code });
        return { ok: true, seat: s.seat };
      }
    }

    // Assign seat 0 or seat 1
    let seatIndex: 0 | 1;
    if (!this.seats[0]) seatIndex = 0;
    else if (!this.seats[1]) seatIndex = 1;
    else return { ok: false, error: "room_full" };

    const seatState: ErsSeatState = {
      seat: seatIndex,
      userId: conn.userId,
      name: conn.name || `Player ${seatIndex + 1}`,
      conn,
      connected: true,
      rematch: false,
    };
    this.seats[seatIndex] = seatState;

    conn.send({ t: "ers_welcome", seat: seatIndex, code: this.code });

    // If both seats are now taken, start the game!
    if (this.seats[0] && this.seats[1] && this.status === "waiting") {
      this.startGame();
    } else {
      this.broadcastSync();
    }

    this.deps.onChange?.(this);
    return { ok: true, seat: seatIndex };
  }

  /** Start a fresh game */
  startGame(seed?: number) {
    if (seed !== undefined) this.seed = seed;
    const dealt = dealErs(this.seed);
    this.p0 = dealt.p0;
    this.p1 = dealt.p1;
    this.pot = [];
    this.turn = 0;
    this.challenge = null;
    this.winner = null;
    this.winReason = undefined;
    this.status = "playing";
    this.lastSlapResolved = null;
    if (this.seats[0]) this.seats[0].rematch = false;
    if (this.seats[1]) this.seats[1].rematch = false;

    this.lastEvent = "Game started! 26 cards dealt each.";
    this.logAction(0, "play", undefined, "Game started. Player 1 flips first.");
    this.broadcastSync();
    this.deps.onChange?.(this);
  }

  /** Find the seat index for a connection id */
  seatOf(connId: string): 0 | 1 | null {
    if (this.seats[0]?.conn?.id === connId) return 0;
    if (this.seats[1]?.conn?.id === connId) return 1;
    return null;
  }

  /** Handle card play (flip) action */
  play(connId: string): { ok: boolean; error?: string } {
    const seat = this.seatOf(connId);
    if (seat === null) return { ok: false, error: "not_seated" };
    if (this.status !== "playing" || this.winner !== null) return { ok: false, error: "not_playing" };
    if (this.turn !== seat) return { ok: false, error: "not_your_turn" };

    const pile = seat === 0 ? this.p0 : this.p1;
    const opponentSeat: 0 | 1 = seat === 0 ? 1 : 0;
    const oppPile = opponentSeat === 0 ? this.p0 : this.p1;

    // Check if player has cards
    if (pile.length === 0) {
      if (this.challenge !== null) {
        // Failed challenge immediately
        this.awardPotTo(this.challenge.by, "Opponent ran out of cards during challenge!");
      } else {
        this.endGame(opponentSeat, "Opponent has no cards left to play!");
      }
      return { ok: false, error: "no_cards" };
    }

    // Pop the top card and place onto pot
    const card = pile.pop()!;
    this.pot.push(card);
    const chances = faceChances(card);
    const seatName = this.seats[seat]?.name ?? `Player ${seat + 1}`;

    this.logAction(seat, "play", card, `${seatName} played card ${card}`);

    // Broadcast flip event
    this.broadcast({
      t: "ers_flip",
      seat,
      card,
      potCount: this.pot.length,
      topCards: this.pot.slice(-5),
      turn: this.turn,
      challenge: this.challenge,
    });

    // 1. Face card played: starts or counters challenge!
    if (chances > 0) {
      if (oppPile.length === 0) {
        // Opponent has 0 cards, cannot answer face card challenge! Challenger takes pot
        this.awardPotTo(seat, `${seatName} played a face card and opponent had no cards!`);
        this.checkWinCondition();
      } else {
        this.challenge = { by: seat, chances };
        this.turn = opponentSeat;
        this.lastEvent = `${seatName} played a face card! (${chances} chances)`;
        this.broadcast({
          t: "ers_challenge",
          by: seat,
          chances,
          status: "started",
        });
      }
      this.broadcastSync();
      return { ok: true };
    }

    // 2. Number card played during an active challenge
    if (this.challenge !== null) {
      const left = this.challenge.chances - 1;
      if (left > 0 && pile.length > 0) {
        // Same player continues challenge attempts
        this.challenge.chances = left;
        this.turn = seat;
        this.lastEvent = `${left} ${left === 1 ? "chance" : "chances"} left`;
        this.broadcast({
          t: "ers_challenge",
          by: this.challenge.by,
          chances: left,
          status: "step",
        });
      } else {
        // Challenge failed! Challenger claims the pot
        const challenger = this.challenge.by;
        const challengerName = this.seats[challenger]?.name ?? `Player ${challenger + 1}`;
        this.stats.faceChallengesWon[challenger]++;
        this.awardPotTo(challenger, `${challengerName} won the face-card challenge!`);
        this.checkWinCondition();
      }
      this.broadcastSync();
      return { ok: true };
    }

    // 3. Normal turn alternation
    this.turn = opponentSeat;
    this.lastEvent = `${seatName} flipped a card.`;
    this.broadcastSync();
    return { ok: true };
  }

  /**
   * Handle slap action
   * Millisecond-adjudicated:
   * - Valid slap condition: first slap scoops the pot into their hand.
   * - Recent slap grace: if opponent slapped validly within 500ms, second slap is considered slower (no penalty).
   * - False slap: burn 1 card to the bottom of the pot.
   */
  slap(connId: string, clientTime?: number): { ok: boolean; valid: boolean; reason: SlapReason; error?: string } {
    const seat = this.seatOf(connId);
    if (seat === null) return { ok: false, valid: false, reason: null, error: "not_seated" };
    if (this.status !== "playing" || this.winner !== null) return { ok: false, valid: false, reason: null, error: "not_playing" };

    const reason = checkSlap(this.pot);
    const seatName = this.seats[seat]?.name ?? `Player ${seat + 1}`;
    const now = this.clock.now();

    if (reason !== null) {
      // Valid Slap!
      const winnerPile = seat === 0 ? this.p0 : this.p1;
      const count = this.pot.length;
      winnerPile.unshift(...this.pot);
      this.pot = [];
      this.turn = seat;
      this.challenge = null;
      this.stats.slaps[seat]++;
      this.stats.cardsWon[seat] += count;
      this.lastSlapResolved = { time: now, winner: seat, reason };

      const slapName =
        reason === "double" ? "DOUBLE" :
        reason === "sandwich" ? "SANDWICH" :
        reason === "marriage" ? "MARRIAGE" :
        reason === "tens" ? "SUM TO 10" : "TOP-BOTTOM";

      this.lastEvent = `${seatName} slapped ${slapName}! (+${count} cards)`;
      this.logAction(seat, "slap_win", undefined, `${seatName} slapped ${slapName} and won ${count} cards`);

      this.broadcast({
        t: "ers_slap",
        seat,
        valid: true,
        reason,
        winnerSeat: seat,
        cardsWon: count,
        potCount: 0,
        p0Count: this.p0.length,
        p1Count: this.p1.length,
      });

      this.checkWinCondition();
      this.broadcastSync();
      return { ok: true, valid: true, reason };
    }

    // No valid condition on the current pot:
    // Check if the other player just claimed a valid slap within 500ms (grace for slower slapper)
    if (this.lastSlapResolved && (now - this.lastSlapResolved.time <= 500)) {
      this.broadcast({
        t: "ers_slap",
        seat,
        valid: true,
        reason: this.lastSlapResolved.reason,
        winnerSeat: this.lastSlapResolved.winner,
        cardsWon: 0,
        potCount: this.pot.length,
        p0Count: this.p0.length,
        p1Count: this.p1.length,
        slower: true,
      });
      return { ok: true, valid: true, reason: this.lastSlapResolved.reason };
    }

    // Genuine False Slap! Burn 1 card from hand to bottom of the pot
    const slapperPile = seat === 0 ? this.p0 : this.p1;
    let burned: PlayingCard | undefined;
    if (slapperPile.length > 0) {
      burned = slapperPile.pop()!;
      this.pot.unshift(burned);
    }
    this.stats.falseSlaps[seat]++;
    this.lastEvent = `${seatName} false slapped! Burned 1 card to pot.`;
    this.logAction(seat, "burn", burned, `${seatName} false slapped and burned a card.`);

    this.broadcast({
      t: "ers_slap",
      seat,
      valid: false,
      reason: null,
      winnerSeat: null,
      cardsWon: 0,
      burnedCard: burned,
      potCount: this.pot.length,
      p0Count: this.p0.length,
      p1Count: this.p1.length,
    });

    this.checkWinCondition();
    this.broadcastSync();
    return { ok: true, valid: false, reason: null };
  }

  /** Award pot to player and reset active challenge */
  private awardPotTo(winner: 0 | 1, reasonMsg: string) {
    const pile = winner === 0 ? this.p0 : this.p1;
    const count = this.pot.length;
    pile.unshift(...this.pot);
    this.pot = [];
    this.turn = winner;
    this.challenge = null;
    this.stats.cardsWon[winner] += count;
    this.lastEvent = reasonMsg;

    this.broadcast({
      t: "ers_challenge",
      by: winner,
      chances: 0,
      status: "won",
      cardsAwarded: count,
    });

    this.logAction(winner, "challenge_win", undefined, reasonMsg);
  }

  /** Check if a player has achieved victory */
  checkWinCondition(): boolean {
    if (this.winner !== null) return true;

    // Player wins if opponent has 0 cards and the pot is empty
    if (this.p0.length === 52 || (this.p1.length === 0 && this.pot.length === 0)) {
      this.endGame(0, `${this.seats[0]?.name ?? "Player 1"} collected all 52 cards!`);
      return true;
    }
    if (this.p1.length === 52 || (this.p0.length === 0 && this.pot.length === 0)) {
      this.endGame(1, `${this.seats[1]?.name ?? "Player 2"} collected all 52 cards!`);
      return true;
    }
    return false;
  }

  /** End the game with a winner */
  private endGame(winner: 0 | 1, reason: string) {
    this.winner = winner;
    this.winReason = reason;
    this.status = "over";
    this.lastEvent = reason;
    this.logAction(winner, "game_over", undefined, reason);

    this.broadcast({
      t: "ers_over",
      winner,
      reason,
      stats: structuredClone(this.stats),
    });

    this.deps.onGameOver?.({
      roomId: this.id,
      code: this.code,
      winner,
      stats: structuredClone(this.stats),
    });
    this.deps.onChange?.(this);
  }

  /** Rematch request */
  rematch(connId: string): boolean {
    const seat = this.seatOf(connId);
    if (seat === null || this.status !== "over") return false;

    this.seats[seat]!.rematch = true;
    this.lastEvent = `${this.seats[seat]!.name} wants a rematch!`;

    if (this.seats[0]?.rematch && this.seats[1]?.rematch) {
      // Both want rematch, restart game with fresh seed!
      this.startGame(Math.floor(Math.random() * 2 ** 31));
      return true;
    }

    this.broadcastSync();
    return true;
  }

  /** Disconnect connection */
  disconnect(connId: string) {
    const seat = this.seatOf(connId);
    if (seat !== null && this.seats[seat]) {
      this.seats[seat]!.connected = false;
      this.idleSince = this.clock.now();
      this.broadcastSync();
    }
    this.deps.onChange?.(this);
  }

  /** Leave room */
  leave(connId: string) {
    const seat = this.seatOf(connId);
    if (seat !== null) {
      const remaining: 0 | 1 = seat === 0 ? 1 : 0;
      if (this.status === "playing" && this.winner === null) {
        this.endGame(remaining, `${this.seats[seat]?.name ?? "Opponent"} conceded.`);
      }
      this.seats[seat] = null;
      this.broadcast({ t: "ers_left", seat });
      this.broadcastSync();
    }
    this.deps.onChange?.(this);
  }

  private logAction(seat: 0 | 1, action: ErsMoveLog["action"], card?: PlayingCard, detail = "") {
    this.moveLogs.push({
      id: this.nextLogId++,
      time: this.clock.now(),
      seat,
      action,
      card,
      detail,
    });
  }

  /** Broadcast to both seats with customized views */
  broadcastSync() {
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (s?.conn && s.connected) {
        s.conn.send({
          t: "ers_sync",
          room: this.viewFor(i as 0 | 1),
        });
      }
    }
  }

  /** Broadcast raw message to all connected players */
  broadcast(msg: ServerMsg) {
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (s?.conn && s.connected) {
        s.conn.send(msg);
      }
    }
  }
}

export interface ErsAdminRoom {
  code: string;
  status: "waiting" | "playing" | "over";
  isPrivate: boolean;
  seats: { name: string; userId: string | null; connected: boolean }[];
}

/** In-memory manager for active ERS multiplayer rooms */
export class ErsRooms {
  private byCode = new Map<string, ErsRoom>();

  constructor(
    private deps: ErsRoomDeps = {},
    private limits: { maxRooms?: number; idleMs?: number } = {}
  ) {}

  get size(): number {
    return this.byCode.size;
  }

  /** A new room, or null when the server already holds its limit of ERS rooms. */
  create(opts: { isPrivate?: boolean; seed?: number } = {}): ErsRoom | null {
    if (this.byCode.size >= (this.limits.maxRooms ?? 1000)) return null;
    let code = "";
    do {
      code = generateErsCode();
    } while (this.byCode.has(code));

    const room = new ErsRoom(
      { code, ...opts },
      {
        ...this.deps,
        onChange: (r) => {
          this.deps.onChange?.(r);
        },
      }
    );
    this.byCode.set(code, room);
    return room;
  }

  get(code: string): ErsRoom | undefined {
    return this.byCode.get(code.trim().toUpperCase());
  }

  list(): ErsRoomSummary[] {
    return [...this.byCode.values()]
      .filter((r) => !r.isPrivate)
      .map((r) => r.summary());
  }

  /** every room, private ones too, with who's seated: for the admin panel's Live tables */
  admin(): ErsAdminRoom[] {
    return [...this.byCode.values()].map((r) => ({
      code: r.code, status: r.status, isPrivate: r.isPrivate,
      seats: r.seats.filter((x): x is ErsSeatState => !!x).map((x) => ({ name: x.name, userId: x.userId ?? null, connected: x.connected })),
    }));
  }

  /** rooms with a match under way, so a deploy can wait for them like it waits for Heist tables */
  get playing(): number {
    let n = 0;
    for (const r of this.byCode.values()) if (r.status === "playing") n++;
    return n;
  }

  sweep(now: number, maxIdleMs = 15 * 60_000) {
    for (const [code, room] of this.byCode) {
      if (room.connections > 0) continue;
      if (now - room.idleSince >= maxIdleMs) {
        this.byCode.delete(code);
      }
    }
  }

  closeAll() {
    this.byCode.clear();
  }
}
