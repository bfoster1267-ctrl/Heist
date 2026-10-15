import { describe, expect, it } from "vitest";
import {
  applyScoundrel, cardRank, cardSuit, dealScoundrel, isScoundrelCard,
  scoundrelCardKind, scoundrelCardValue, tallyScoundrel, tallyScoundrelXp,
  type PlayingCard, type ScoundrelMove, type ScoundrelState,
} from "../src/scoundrel";

describe("Scoundrel Card Dungeon", () => {
  it("creates a 44-card dungeon deck without red face cards or red aces", () => {
    const s = dealScoundrel(42);
    // 4 cards in room + 40 in dungeon = 44 total cards
    expect(s.room.length).toBe(4);
    expect(s.dungeon.length).toBe(40);
    expect(s.hp).toBe(20);
    expect(s.dead).toBe(false);
    expect(s.escaped).toBe(false);

    const allCards = [...s.room, ...s.dungeon].filter((c): c is PlayingCard => c !== null);
    expect(allCards.length).toBe(44);

    let monsterCount = 0;
    let weaponCount = 0;
    let potionCount = 0;

    for (const c of allCards) {
      expect(isScoundrelCard(c)).toBe(true);
      const kind = scoundrelCardKind(c);
      if (kind === "monster") monsterCount++;
      else if (kind === "weapon") weaponCount++;
      else if (kind === "potion") potionCount++;
    }

    expect(monsterCount).toBe(26); // 13 Spades + 13 Clubs
    expect(weaponCount).toBe(9);   // Diamonds 2-10
    expect(potionCount).toBe(9);   // Hearts 2-10
  });

  it("verifies monster Ace evaluates to 14, while other cards match their ranks", () => {
    // Spade Ace: suit 0, rank 1 -> c = 0
    expect(scoundrelCardKind(0)).toBe("monster");
    expect(scoundrelCardValue(0)).toBe(14);

    // Club Ace: suit 3, rank 1 -> c = 39
    expect(scoundrelCardKind(39)).toBe("monster");
    expect(scoundrelCardValue(39)).toBe(14);

    // Spade King: suit 0, rank 13 -> c = 12
    expect(scoundrelCardKind(12)).toBe("monster");
    expect(scoundrelCardValue(12)).toBe(13);

    // Diamond 10: suit 2, rank 10 -> c = 2*13 + 9 = 35
    expect(scoundrelCardKind(35)).toBe("weapon");
    expect(scoundrelCardValue(35)).toBe(10);

    // Heart 7: suit 1, rank 7 -> c = 1*13 + 6 = 19
    expect(scoundrelCardKind(19)).toBe("potion");
    expect(scoundrelCardValue(19)).toBe(7);
  });

  it("handles potions (healing up to 20 hp, max 1 potion used per room, carryover)", () => {
    let s = dealScoundrel(10);
    s.hp = 12;
    // Set room[0] to a potion (Heart 5)
    s.room[0] = 17; // Heart 5
    expect(scoundrelCardKind(17)).toBe("potion");
    expect(scoundrelCardValue(17)).toBe(5);

    const next = applyScoundrel(s, { kind: "pick", roomIndex: 0 });
    expect(next.hp).toBe(17);
    expect(next.potionUsedThisRoom).toBe(true);

    // Second potion in the same room should be discarded without healing
    next.room[1] = 17;
    const next2 = applyScoundrel(next, { kind: "pick", roomIndex: 1 });
    expect(next2.hp).toBe(17); // Did not heal again

    // When advancing to a new room, potion usage is reset
    next2.room[2] = 33; // Weapon (Diamond 8)
    const next3 = applyScoundrel(next2, { kind: "pick", roomIndex: 2 });
    expect(next3.roomsCleared).toBe(1);
    expect(next3.potionUsedThisRoom).toBe(false);

    // Healing in the new room is now permitted
    next3.hp = 10;
    next3.room[0] = 17; // Heart 5
    const next4 = applyScoundrel(next3, { kind: "pick", roomIndex: 0 });
    expect(next4.hp).toBe(15);
    expect(next4.potionUsedThisRoom).toBe(true);
  });

  it("caps HP at maxHp (20) and still consumes potion usage for that room", () => {
    let s = dealScoundrel(15);
    s.hp = 19;
    s.room[0] = 17; // Heart 5
    const s1 = applyScoundrel(s, { kind: "pick", roomIndex: 0 });
    expect(s1.hp).toBe(20);
    expect(s1.potionUsedThisRoom).toBe(true);

    // Take damage
    s1.room[1] = 5; // Spade 6 (monster)
    const s2 = applyScoundrel(s1, { kind: "pick", roomIndex: 1 });
    expect(s2.hp).toBe(14);

    // Another potion in same room cannot heal
    s2.room[2] = 17;
    const s3 = applyScoundrel(s2, { kind: "pick", roomIndex: 2 });
    expect(s3.hp).toBe(14);
  });

  it("handles weapons, replacement, durability degradation, and barehanded choice", () => {
    let s = dealScoundrel(20);
    s.hp = 20;

    // Equip a weapon (Diamond 8: suit 2, rank 8 -> 2*13 + 7 = 33)
    s.room[0] = 33;
    const s1 = applyScoundrel(s, { kind: "pick", roomIndex: 0 });
    expect(s1.weapon).not.toBeNull();
    expect(s1.weapon?.power).toBe(8);
    expect(s1.weapon?.lastDefeated).toBeUndefined();

    // Fight a monster with weapon (Spade 10 -> power 10)
    // Monster 10 - weapon 8 = 2 damage taken
    s1.room[1] = 9; // Spade 10
    const s2 = applyScoundrel(s1, { kind: "pick", roomIndex: 1, useWeapon: true });
    expect(s2.hp).toBe(18);
    expect(s2.weapon?.lastDefeated).toBe(10);

    // Next monster with value 6 (Spade 6 -> 5)
    // 6 <= lastDefeated 10 -> Weapon CAN attack it!
    // Monster 6 <= weapon 8 -> 0 damage taken!
    s2.room[2] = 5; // Spade 6
    const s3 = applyScoundrel(s2, { kind: "pick", roomIndex: 2, useWeapon: true });
    expect(s3.hp).toBe(18);
    expect(s3.weapon?.lastDefeated).toBe(6); // Durability degraded down to 6!

    // Advance to next room (need 1 more card)
    s3.room[0] = 17; // Heart 5
    const s4 = applyScoundrel(s3, { kind: "pick", roomIndex: 0 });
    expect(s4.roomsCleared).toBe(1);

    // Try to attack monster with value 7 (Spade 7 -> 6) with degraded weapon (lastDefeated 6)
    // 7 > 6 -> weapon CANNOT attack! Move must be rejected!
    s4.room[0] = 6; // Spade 7
    const s5 = applyScoundrel(s4, { kind: "pick", roomIndex: 0, useWeapon: true });
    expect(s5).toBe(s4); // Rejected!

    // Player can instead fight barehanded! Takes full 7 damage (20 - 7 = 13). Weapon is unchanged.
    const s6 = applyScoundrel(s4, { kind: "pick", roomIndex: 0, useWeapon: false });
    expect(s6.hp).toBe(13);
    expect(s6.weapon?.lastDefeated).toBe(6);

    // Equipping a new weapon replaces previous weapon and resets durability
    s6.room[1] = 30; // Diamond 5
    const s7 = applyScoundrel(s6, { kind: "pick", roomIndex: 1 });
    expect(s7.weapon?.power).toBe(5);
    expect(s7.weapon?.lastDefeated).toBeUndefined(); // Fresh weapon!
  });

  it("rejects useWeapon: true if no weapon is equipped", () => {
    let s = dealScoundrel(25);
    expect(s.weapon).toBeNull();
    s.room[0] = 5; // Spade 6 (monster)
    const next = applyScoundrel(s, { kind: "pick", roomIndex: 0, useWeapon: true });
    expect(next).toBe(s); // Rejected!
  });

  it("handles fleeing rules: cannot flee twice in a row, cannot flee after picking a card", () => {
    let s = dealScoundrel(50);
    expect(s.canFlee).toBe(true);
    const initialRoomCards = [...s.room];
    const initialDungeonCount = s.dungeon.length;

    // Flee room 1
    const f1 = applyScoundrel(s, { kind: "flee" });
    expect(f1.canFlee).toBe(false);
    expect(f1.cardsResolvedInRoom).toBe(0);
    expect(f1.dungeon.length).toBe(initialDungeonCount);
    // The 4 cards that were in room were placed at bottom of dungeon
    expect(f1.dungeon.slice(-4)).toEqual(initialRoomCards);

    // Cannot flee again immediately!
    const f2 = applyScoundrel(f1, { kind: "flee" });
    expect(f2).toBe(f1);

    // Set safe cards in room so player survives resolving 3 cards
    f1.room[0] = 17; // Heart 5 (potion)
    f1.room[1] = 33; // Diamond 8 (weapon)
    f1.room[2] = 18; // Heart 6 (potion)

    // Resolve 1 card in the new room
    const p1 = applyScoundrel(f1, { kind: "pick", roomIndex: 0 });
    expect(p1.cardsResolvedInRoom).toBe(1);

    // After picking a card, cannot flee even if canFlee is true
    const p1WithCanFlee = { ...p1, canFlee: true };
    const f3 = applyScoundrel(p1WithCanFlee, { kind: "flee" });
    expect(f3).toBe(p1WithCanFlee); // Rejected because cardsResolvedInRoom > 0

    // Resolve 2 more cards to finish the room
    const p2 = applyScoundrel(p1, { kind: "pick", roomIndex: 1 });
    const p3 = applyScoundrel(p2, { kind: "pick", roomIndex: 2 });
    expect(p3.roomsCleared).toBe(1);
    expect(p3.dead).toBe(false);
    // Now in the new room, fleeing is allowed again!
    expect(p3.canFlee).toBe(true);
    const f4 = applyScoundrel(p3, { kind: "flee" });
    expect(f4.canFlee).toBe(false);
  });

  it("ends game when HP drops to 0 or below (loss condition)", () => {
    let s = dealScoundrel(60);
    s.hp = 5;
    s.room[0] = 0; // Spade Ace (14 damage)
    const dead = applyScoundrel(s, { kind: "pick", roomIndex: 0, useWeapon: false });
    expect(dead.hp).toBe(0);
    expect(dead.dead).toBe(true);
    expect(dead.escaped).toBe(false);

    // Further moves must be rejected
    const dead2 = applyScoundrel(dead, { kind: "pick", roomIndex: 1 });
    expect(dead2).toBe(dead);
  });

  it("runs full simulation: player losses when playing recklessly", () => {
    // A reckless player that always picks monsters barehanded will die
    const s = dealScoundrel(101);
    let state = s;
    const moves: ScoundrelMove[] = [];

    while (!state.dead && !state.escaped) {
      // Pick first non-null card
      const idx = state.room.findIndex((c) => c !== null);
      if (idx === -1) break;
      const m: ScoundrelMove = { kind: "pick", roomIndex: idx, useWeapon: false };
      moves.push(m);
      state = applyScoundrel(state, m);
    }

    expect(state.dead).toBe(true);
    expect(state.hp).toBe(0);
    expect(state.escaped).toBe(false);

    const tally = tallyScoundrel(101, moves);
    expect(tally.won).toBe(false);
    expect(tally.hpLeft).toBe(0);
    expect(tally.monstersSlayed).toBeGreaterThan(0);
  });

  it("runs full simulation: plays through complete games with a search bot", () => {
    // Solves games using beam search across rooms
    function solveGame(seed: number): { won: boolean; moves: ScoundrelMove[]; endState: ScoundrelState } {
      interface BeamNode {
        state: ScoundrelState;
        moves: ScoundrelMove[];
      }

      let beam: BeamNode[] = [{ state: dealScoundrel(seed), moves: [] }];
      let bestTerminal: BeamNode | null = null;

      for (let round = 0; round < 35 && beam.length > 0; round++) {
        const nextBeam: BeamNode[] = [];

        for (const { state, moves } of beam) {
          if (state.escaped && !state.dead) {
            if (!bestTerminal || state.hp > bestTerminal.state.hp) {
              bestTerminal = { state, moves };
            }
            continue;
          }
          if (state.dead) {
            if (!bestTerminal) bestTerminal = { state, moves };
            continue;
          }

          const nonNull = state.room
            .map((c, i) => (c !== null ? i : -1))
            .filter((i) => i !== -1);

          // Final room: resolve remaining cards
          if (state.dungeon.length === 0) {
            const perms = nonNull.length === 1 ? [[nonNull[0]]] : [[nonNull[0], nonNull[1]], [nonNull[1], nonNull[0]]];
            for (const p of perms) {
              function recEnd(cur: ScoundrelState, step: number, curM: ScoundrelMove[]) {
                if (step === p.length || cur.dead) {
                  nextBeam.push({ state: cur, moves: curM });
                  return;
                }
                const idx = p[step];
                const card = cur.room[idx];
                if (card === null) return;
                const kind = scoundrelCardKind(card);
                const val = scoundrelCardValue(card);
                if (kind === "monster") {
                  const canW = cur.weapon && (cur.weapon.lastDefeated === undefined || val <= cur.weapon.lastDefeated);
                  if (canW) {
                    const n = applyScoundrel(cur, { kind: "pick", roomIndex: idx, useWeapon: true });
                    recEnd(n, step + 1, [...curM, { kind: "pick", roomIndex: idx, useWeapon: true }]);
                  }
                  const nBare = applyScoundrel(cur, { kind: "pick", roomIndex: idx, useWeapon: false });
                  recEnd(nBare, step + 1, [...curM, { kind: "pick", roomIndex: idx, useWeapon: false }]);
                } else {
                  const n = applyScoundrel(cur, { kind: "pick", roomIndex: idx });
                  recEnd(n, step + 1, [...curM, { kind: "pick", roomIndex: idx }]);
                }
              }
              recEnd(state, 0, moves);
            }
            continue;
          }

          // Flee option
          if (state.canFlee && state.cardsResolvedInRoom === 0 && state.dungeon.length > 0) {
            const fled = applyScoundrel(state, { kind: "flee" });
            if (!fled.dead) {
              nextBeam.push({ state: fled, moves: [...moves, { kind: "flee" }] });
            }
          }

          // 3-card pick permutations
          const perms3: number[][] = [];
          for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
              if (j === i) continue;
              for (let k = 0; k < 4; k++) {
                if (k === i || k === j) continue;
                perms3.push([i, j, k]);
              }
            }
          }

          for (const perm of perms3) {
            function rec(cur: ScoundrelState, step: number, curM: ScoundrelMove[]) {
              if (step === 3 || cur.dead) {
                nextBeam.push({ state: cur, moves: curM });
                return;
              }
              const idx = perm[step];
              const card = cur.room[idx];
              if (card === null) return;
              const kind = scoundrelCardKind(card);
              const val = scoundrelCardValue(card);
              if (kind === "monster") {
                const canW = cur.weapon && (cur.weapon.lastDefeated === undefined || val <= cur.weapon.lastDefeated);
                if (canW) {
                  const n = applyScoundrel(cur, { kind: "pick", roomIndex: idx, useWeapon: true });
                  rec(n, step + 1, [...curM, { kind: "pick", roomIndex: idx, useWeapon: true }]);
                }
                const nBare = applyScoundrel(cur, { kind: "pick", roomIndex: idx, useWeapon: false });
                rec(nBare, step + 1, [...curM, { kind: "pick", roomIndex: idx, useWeapon: false }]);
              } else {
                const n = applyScoundrel(cur, { kind: "pick", roomIndex: idx });
                rec(n, step + 1, [...curM, { kind: "pick", roomIndex: idx }]);
              }
            }
            rec(state, 0, moves);
          }
        }

        // Rank nextBeam and keep top candidates
        nextBeam.sort((a, b) => {
          if (a.state.escaped && !a.state.dead) return -1;
          if (b.state.escaped && !b.state.dead) return 1;
          if (a.state.dead && !b.state.dead) return 1;
          if (!a.state.dead && b.state.dead) return -1;
          const scoreA = a.state.hp * 100 + (a.state.weapon ? a.state.weapon.power * 25 : 0) + a.state.monstersSlayed * 5;
          const scoreB = b.state.hp * 100 + (b.state.weapon ? b.state.weapon.power * 25 : 0) + b.state.monstersSlayed * 5;
          return scoreB - scoreA;
        });

        // Deduplicate and keep top 25
        const seen = new Set<string>();
        beam = [];
        for (const item of nextBeam) {
          const key = `${item.state.hp}:${item.state.weapon?.power ?? 0}:${item.state.weapon?.lastDefeated ?? 0}:${item.state.dungeon.length}:${item.state.roomsCleared}`;
          if (!seen.has(key)) {
            seen.add(key);
            beam.push(item);
            if (beam.length >= 25) break;
          }
        }
      }

      const winningNode = beam.find((b) => b.state.escaped && !b.state.dead) ?? (bestTerminal?.state.escaped ? bestTerminal : null);
      if (winningNode) {
        return { won: true, moves: winningNode.moves, endState: winningNode.state };
      }
      const best = bestTerminal ?? beam[0];
      return { won: false, moves: best.moves, endState: best.state };
    }

    let wins = 0;
    let losses = 0;
    let fleeCount = 0;
    let totalMonsters = 0;

    // Simulate complete game runs with varying seeds
    for (let seed = 1; seed <= 30; seed++) {
      const res = solveGame(seed);
      const state = res.endState;
      const allMoves = res.moves;

      for (const m of allMoves) {
        if (m.kind === "flee") fleeCount++;
      }

      // Replay all moves through tallyScoundrel to verify exact tally parity
      const tally = tallyScoundrel(seed, allMoves);
      expect(tally.monstersSlayed).toBe(state.monstersSlayed);
      expect(tally.roomsCleared).toBe(state.roomsCleared);
      expect(tally.hpLeft).toBe(state.hp);
      expect(tally.won).toBe(state.escaped && !state.dead);

      totalMonsters += state.monstersSlayed;
      if (state.escaped && !state.dead) {
        wins++;
        expect(state.roomsCleared).toBe(15);
        expect(state.hp).toBeGreaterThan(0);
        expect(tally.won).toBe(true);
      } else {
        losses++;
        expect(state.dead).toBe(true);
        expect(tally.won).toBe(false);
      }
    }

    // Verify simulation results: both wins and losses observed, fleeing exercised
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
    expect(fleeCount).toBeGreaterThan(0);
    expect(totalMonsters).toBeGreaterThan(100);
  });
});
