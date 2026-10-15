// Scoundrel (Zach Gage & Kurt Bieg 2011 card dungeon crawler roguelike).
// 44-card deck: Spades/Clubs=Monsters (2-14), Diamonds=Weapons (2-10), Hearts=Potions (2-10).
// 4-card rooms, resolve 3 cards to advance, weapons degrade, max 20 HP, flee once in a row.

import { cardRank, cardSuit, type PlayingCard } from "./solitaire";

export type { PlayingCard };

export type CardKind = "monster" | "weapon" | "potion";

export function scoundrelCardKind(c: PlayingCard): CardKind {
  const s = cardSuit(c);
  if (s === 0 || s === 3) return "monster";
  if (s === 2) return "weapon";
  return "potion";
}

/** Monster value: 2-10, J=11, Q=12, K=13, A=14. Weapon/Potion: rank 2-10. */
export function scoundrelCardValue(c: PlayingCard): number {
  const r = cardRank(c);
  const s = cardSuit(c);
  if ((s === 0 || s === 3) && r === 1) return 14; // Ace is 14 for monsters
  return r;
}

export interface WeaponState {
  card: PlayingCard;
  power: number;
  lastDefeated?: number;
}

export interface ScoundrelState {
  dungeon: PlayingCard[];
  room: (PlayingCard | null)[];
  hp: number;
  maxHp: number;
  weapon: WeaponState | null;
  potionUsedThisRoom: boolean;
  canFlee: boolean;
  cardsResolvedInRoom: number;
  monstersSlayed: number;
  roomsCleared: number;
  escaped: boolean;
  dead: boolean;
}

export type ScoundrelMove =
  | { kind: "pick"; roomIndex: number; useWeapon?: boolean }
  | { kind: "flee" };

/** PRNG (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Check if card is part of the 44-card Scoundrel deck */
export function isScoundrelCard(c: PlayingCard): boolean {
  const s = cardSuit(c);
  const r = cardRank(c);
  // Red face cards and red aces removed
  if (s === 1 || s === 2) {
    if (r === 1 || r >= 11) return false;
  }
  return true;
}

/** Deal 44-card Scoundrel dungeon */
export function dealScoundrel(seed: number): ScoundrelState {
  const r = rng(seed);
  const deck: PlayingCard[] = [];
  for (let i = 0; i < 52; i++) {
    if (isScoundrelCard(i)) deck.push(i);
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // Draw initial 4 cards for the room
  const room = deck.splice(0, 4) as (PlayingCard | null)[];

  return {
    dungeon: deck,
    room,
    hp: 20,
    maxHp: 20,
    weapon: null,
    potionUsedThisRoom: false,
    canFlee: true,
    cardsResolvedInRoom: 0,
    monstersSlayed: 0,
    roomsCleared: 0,
    escaped: false,
    dead: false,
  };
}

/** Apply a move to Scoundrel state */
export function applyScoundrel(state: ScoundrelState, move: ScoundrelMove): ScoundrelState {
  if (state.dead || state.escaped) return state;

  // Flee the room
  if (move.kind === "flee") {
    if (!state.canFlee || state.cardsResolvedInRoom > 0) return state;
    const currentCards = state.room.filter((c): c is PlayingCard => c !== null);
    if (currentCards.length < 4 || state.dungeon.length === 0) return state;

    // Put current 4 cards to bottom of dungeon
    const nextDungeon = [...state.dungeon, ...currentCards];
    // Draw 4 fresh cards
    const nextRoom = nextDungeon.splice(0, 4) as (PlayingCard | null)[];

    return {
      ...state,
      dungeon: nextDungeon,
      room: nextRoom,
      canFlee: false, // Cannot flee twice in a row
      cardsResolvedInRoom: 0,
      potionUsedThisRoom: false,
    };
  }

  // Pick a card from the room
  if (move.kind === "pick") {
    const { roomIndex, useWeapon } = move;
    if (roomIndex < 0 || roomIndex >= 4) return state;
    const card = state.room[roomIndex];
    if (card === null) return state;

    const kind = scoundrelCardKind(card);
    const val = scoundrelCardValue(card);

    let nextHp = state.hp;
    let nextWeapon = state.weapon ? { ...state.weapon } : null;
    let nextPotionUsed = state.potionUsedThisRoom;
    let nextMonsters = state.monstersSlayed;

    if (kind === "potion") {
      if (!state.potionUsedThisRoom) {
        nextHp = Math.min(state.maxHp, nextHp + val);
        nextPotionUsed = true;
      }
    } else if (kind === "weapon") {
      nextWeapon = { card, power: val };
    } else if (kind === "monster") {
      if (useWeapon) {
        if (!nextWeapon) return state;
        // Weapon durability check: can only attack monster if value <= lastDefeated (if any)
        if (nextWeapon.lastDefeated !== undefined && val > nextWeapon.lastDefeated) {
          // Cannot use weapon against a stronger monster than the last one defeated with this weapon
          return state;
        }
        const damage = Math.max(0, val - nextWeapon.power);
        nextHp -= damage;
        nextWeapon.lastDefeated = val;
      } else {
        // Barehanded fight: take full damage
        nextHp -= val;
      }
      nextMonsters++;
    }

    if (nextHp <= 0) {
      const nextRoom = [...state.room];
      nextRoom[roomIndex] = null;
      return {
        ...state,
        hp: 0,
        room: nextRoom,
        weapon: nextWeapon,
        potionUsedThisRoom: nextPotionUsed,
        monstersSlayed: nextMonsters,
        dead: true,
      };
    }

    const nextRoom = [...state.room];
    nextRoom[roomIndex] = null;
    const resolved = state.cardsResolvedInRoom + 1;

    // Check if 3 cards have been resolved in this room
    if (resolved === 3) {
      // Advance to next room
      const nextDungeon = [...state.dungeon];
      const remainingCard = nextRoom.find((c) => c !== null) ?? null;
      const newCards = nextDungeon.splice(0, 3);
      const newRoom: (PlayingCard | null)[] = [remainingCard, ...newCards];
      while (newRoom.length < 4) newRoom.push(null);

      // Check win condition: room has no cards left and dungeon is empty
      const escaped = newRoom.every((c) => c === null);

      return {
        ...state,
        dungeon: nextDungeon,
        room: newRoom,
        hp: nextHp,
        weapon: nextWeapon,
        potionUsedThisRoom: false,
        canFlee: true,
        cardsResolvedInRoom: 0,
        monstersSlayed: nextMonsters,
        roomsCleared: state.roomsCleared + 1,
        escaped,
        dead: false,
      };
    }

    // In the last room when dungeon is empty, player can resolve all remaining cards to win
    const remainingCardsCount = nextRoom.filter((c) => c !== null).length;
    if (state.dungeon.length === 0 && remainingCardsCount === 0) {
      return {
        ...state,
        room: nextRoom,
        hp: nextHp,
        weapon: nextWeapon,
        potionUsedThisRoom: nextPotionUsed,
        cardsResolvedInRoom: resolved,
        monstersSlayed: nextMonsters,
        roomsCleared: state.roomsCleared + 1,
        escaped: true,
        dead: false,
      };
    }

    return {
      ...state,
      room: nextRoom,
      hp: nextHp,
      weapon: nextWeapon,
      potionUsedThisRoom: nextPotionUsed,
      cardsResolvedInRoom: resolved,
      monstersSlayed: nextMonsters,
      dead: false,
    };
  }

  return state;
}

export interface ScoundrelTally {
  monstersSlayed: number;
  roomsCleared: number;
  hpLeft: number;
  won: boolean;
}

export function tallyScoundrel(seed: number, moves: readonly unknown[]): ScoundrelTally {
  let s = dealScoundrel(seed);
  for (const m of moves) {
    if (!m || typeof m !== "object") continue;
    s = applyScoundrel(s, m as ScoundrelMove);
    if (s.dead || s.escaped) break;
  }

  return {
    monstersSlayed: s.monstersSlayed,
    roomsCleared: s.roomsCleared,
    hpLeft: s.hp,
    won: s.escaped && !s.dead,
  };
}

export const SCOUNDREL_XP = { monster: 2, room: 5, win: 50 };
export const SCOUNDREL_DAY_XP = 500;
export const SCOUNDREL_IDLE_S = 30;

export function tallyScoundrelXp(t: ScoundrelTally): number {
  return (
    t.monstersSlayed * SCOUNDREL_XP.monster +
    t.roomsCleared * SCOUNDREL_XP.room +
    (t.won ? SCOUNDREL_XP.win : 0)
  );
}

export function scoundrelGain(paid: ScoundrelTally | undefined, t: ScoundrelTally) {
  const p = paid ?? { monstersSlayed: 0, roomsCleared: 0, hpLeft: 0, won: false };
  const gained = {
    monstersSlayed: Math.max(0, t.monstersSlayed - p.monstersSlayed),
    roomsCleared: Math.max(0, t.roomsCleared - p.roomsCleared),
    hpLeft: t.hpLeft,
    won: t.won && !p.won,
  };
  return {
    gained,
    paid: {
      monstersSlayed: Math.max(t.monstersSlayed, p.monstersSlayed),
      roomsCleared: Math.max(t.roomsCleared, p.roomsCleared),
      hpLeft: t.hpLeft,
      won: t.won || p.won,
    },
    any: tallyScoundrelXp(gained) > 0,
  };
}

export function scoundrelPay(
  paid: ScoundrelTally | undefined,
  paidXp: number | undefined,
  t: ScoundrelTally,
  drain: number
) {
  const g = scoundrelGain(paid, t);
  const before = paidXp ?? tallyScoundrelXp(paid ?? { monstersSlayed: 0, roomsCleared: 0, hpLeft: 0, won: false });
  const pot = Math.max(0, tallyScoundrelXp(g.paid) - Math.max(0, drain));
  return {
    gained: g.gained,
    paid: g.paid,
    paidXp: Math.max(before, pot),
    xp: Math.max(0, pot - before),
  };
}
