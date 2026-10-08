// What a seat does when its player isn't there to play it (they dropped, left, or ran out the clock):
// nothing that helps them. It never starts or joins a hit, sends the fewest crew it can, plays its weakest
// card, and turns down every deal. Leaving a game can never be better than playing it.

import { fightValue, isFighter, type Answer, type Ask, type Card, type GameState } from "@heist/engine";

const byValue = (a: Card, b: Card) => a.cash - b.cash || fightValue(a) - fightValue(b);

export function deadWeight(ask: Ask, s: GameState): Answer {
  const hand = s.players[ask.seat].hand;
  const weakest = (n: number) => [...hand].sort(byValue).slice(0, n).map((c) => c.id);
  switch (ask.kind) {
    case "keepRole":
      return { kind: "keepRole", role: ask.options[0] };
    case "wildcard":
      return { kind: "wildcard", target: null };
    case "fence":
      return { kind: "fence", cardId: null };
    case "bank":
      return { kind: "bank", cardIds: [] };
    case "hire":
      return { kind: "hire", count: 0 };
    case "action":
      return { kind: "action", choice: "pass" };
    case "pickMark":
      return { kind: "pickMark", mark: ask.rivals[0] };
    case "pickHideout":
      return { kind: "pickHideout", hideout: 0 };
    case "send":
      return { kind: "send", count: 1 };
    case "join":
      return { kind: "join", B: 0, M: 0 };
    case "bribe":
      return { kind: "bribe", offers: [] };
    case "placeCrew":
      return { kind: "placeCrew", to: [ask.count, 0, 0] };
    case "giveCards":
      return { kind: "giveCards", cardIds: weakest(ask.count) };
    case "deal":
      return { kind: "deal", action: "reject" };
    case "doubleCross":
      return { kind: "doubleCross", target: null };
    case "bet":
      return { kind: "bet", side: null };
    case "hackerCall":
      return { kind: "hackerCall", n: ask.numbers[0] };
    case "showdown": {
      const fighters = hand.filter(isFighter).sort((a, b) => fightValue(a) - fightValue(b));
      return { kind: "showdown", cardId: fighters[0].id };
    }
    case "forger":
      return { kind: "forger", n: null };
    case "backup":
      return { kind: "backup", side: null };
    case "dealOffer":
      return { kind: "dealOffer", offer: null };
    case "dealAccept":
      return { kind: "dealAccept", accept: false };
    case "again":
      return { kind: "again", again: false };
    case "discard":
      // gives up its best cards: the hand left behind is the weakest it can be
      return { kind: "discard", cardIds: [...hand].sort(byValue).reverse().slice(0, ask.count).map((c) => c.id) };
  }
}
