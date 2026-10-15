import { describe, expect, it } from "vitest";
import {
  applyScoundrel, dealScoundrel, isScoundrelCard, scoundrelCardKind,
  scoundrelCardValue, tallyScoundrel, tallyScoundrelXp,
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

    // Verify all cards are legitimate Scoundrel cards
    for (const c of [...s.room, ...s.dungeon]) {
      if (c !== null) {
        expect(isScoundrelCard(c)).toBe(true);
      }
    }
  });

  it("handles potions (healing up to 20 hp, max 1 potion used per room)", () => {
    let s = dealScoundrel(10);
    s.hp = 12;
    // Set room[0] to a potion (Heart 5)
    // Suit 1 (Hearts), rank 5 (c = 1*13 + 4 = 17)
    s.room[0] = 17;
    expect(scoundrelCardKind(17)).toBe("potion");
    expect(scoundrelCardValue(17)).toBe(5);

    const next = applyScoundrel(s, { kind: "pick", roomIndex: 0 });
    expect(next.hp).toBe(17);
    expect(next.potionUsedThisRoom).toBe(true);

    // Second potion in the same room should be discarded without healing
    next.room[1] = 17;
    const next2 = applyScoundrel(next, { kind: "pick", roomIndex: 1 });
    expect(next2.hp).toBe(17); // Did not heal again
  });

  it("handles weapons and monster combat with weapon durability", () => {
    let s = dealScoundrel(20);
    s.hp = 20;

    // Equip a weapon (Diamond 8: suit 2, rank 8 -> 2*13 + 7 = 33)
    s.room[0] = 33;
    const s1 = applyScoundrel(s, { kind: "pick", roomIndex: 0 });
    expect(s1.weapon).not.toBeNull();
    expect(s1.weapon?.power).toBe(8);

    // Fight a monster (Spade 6: suit 0, rank 6 -> 5)
    // Monster power 6 <= weapon power 8 -> 0 damage taken!
    s1.room[1] = 5;
    const s2 = applyScoundrel(s1, { kind: "pick", roomIndex: 1, useWeapon: true });
    expect(s2.hp).toBe(20);
    expect(s2.weapon?.lastDefeated).toBe(6);

    // Fight a monster with value 10 (Spade 10 -> 9)
    // Value 10 > lastDefeated 6 -> weapon CANNOT be used!
    s2.room[2] = 9;
    const s3 = applyScoundrel(s2, { kind: "pick", roomIndex: 2, useWeapon: true });
    expect(s3).toBe(s2); // Move rejected because monster is stronger than last defeated with that weapon
  });

  it("tracks rooms cleared and deals fresh cards every 3 resolved cards", () => {
    let s = dealScoundrel(30);
    // Resolve 3 cards in room
    const s1 = applyScoundrel(s, { kind: "pick", roomIndex: 0 });
    const s2 = applyScoundrel(s1, { kind: "pick", roomIndex: 1 });
    const s3 = applyScoundrel(s2, { kind: "pick", roomIndex: 2 });

    expect(s3.roomsCleared).toBe(1);
    expect(s3.cardsResolvedInRoom).toBe(0);
    expect(s3.dungeon.length).toBe(37); // 40 - 3 drawn = 37
  });

  it("tallies monsters slayed, rooms cleared, and calculates XP", () => {
    const t = tallyScoundrel(100, []);
    expect(t.monstersSlayed).toBe(0);
    expect(t.roomsCleared).toBe(0);
    expect(t.hpLeft).toBe(20);
    expect(t.won).toBe(false);
    expect(tallyScoundrelXp(t)).toBe(0);
  });
});
