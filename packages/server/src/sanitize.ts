// Answers arrive from the network as untrusted JSON. The engine's validate() checks game legality but
// trusts the shape (it was written for the browser, where answers come from our own buttons). This
// rebuilds a clean Answer with only the fields that kind uses, of the right types, so a malformed
// message is rejected here instead of reaching the rules generator.

import type { Answer, Ask, RoleId } from "@heist/engine";

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const intOrNull = (x: unknown): x is number | null => x === null || isInt(x);
const ids = (x: unknown): number[] | null => (Array.isArray(x) && x.length <= 20 && x.every(isInt) ? [...x] : null);
const side = (x: unknown): "B" | "M" | null | undefined => (x === "B" || x === "M" ? x : x === null ? null : undefined);

/** Returns a clean Answer for this Ask, or null if the message isn't shaped like one. */
export function sanitizeAnswer(ask: Ask, raw: unknown): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== ask.kind) return null;
  switch (ask.kind) {
    case "keepRole":
      return typeof r.role === "string" ? { kind: "keepRole", role: r.role as RoleId } : null;
    case "wildcard":
      return intOrNull(r.target) ? { kind: "wildcard", target: r.target } : null;
    case "fence":
      return intOrNull(r.cardId) ? { kind: "fence", cardId: r.cardId } : null;
    case "bank": {
      const c = ids(r.cardIds);
      return c ? { kind: "bank", cardIds: c } : null;
    }
    case "discard": {
      const c = ids(r.cardIds);
      return c ? { kind: "discard", cardIds: c } : null;
    }
    case "hire":
      return isInt(r.count) ? { kind: "hire", count: r.count } : null;
    case "send":
      return isInt(r.count) ? { kind: "send", count: r.count } : null;
    case "action":
      if (r.choice === "hit" || r.choice === "pass") return { kind: "action", choice: r.choice };
      if (r.choice === "bust" && isInt(r.hideout) && isInt(r.rival)) return { kind: "action", choice: "bust", hideout: r.hideout, rival: r.rival };
      if (r.choice === "wanted" && isInt(r.mark) && isInt(r.hideout)) return { kind: "action", choice: "wanted", mark: r.mark, hideout: r.hideout };
      return null;
    case "pickMark":
      return isInt(r.mark) ? { kind: "pickMark", mark: r.mark } : null;
    case "pickHideout":
      return isInt(r.hideout) ? { kind: "pickHideout", hideout: r.hideout } : null;
    case "join":
      return isInt(r.B) && isInt(r.M) ? { kind: "join", B: r.B, M: r.M } : null;
    case "doubleCross":
      return intOrNull(r.target) ? { kind: "doubleCross", target: r.target } : null;
    case "bet": {
      const s = side(r.side);
      if (s === undefined) return null;
      if (s === null) return { kind: "bet", side: null };
      return isInt(r.cardId) ? { kind: "bet", side: s, cardId: r.cardId } : null;
    }
    case "hackerCall":
      return isInt(r.n) ? { kind: "hackerCall", n: r.n } : null;
    case "showdown":
      return isInt(r.cardId) ? { kind: "showdown", cardId: r.cardId } : null;
    case "forger":
      return intOrNull(r.n) ? { kind: "forger", n: r.n } : null;
    case "backup": {
      const s = side(r.side);
      return s === undefined ? null : { kind: "backup", side: s };
    }
    case "dealOffer":
      return r.offer === "walk" || r.offer === "foothold" || r.offer === null ? { kind: "dealOffer", offer: r.offer } : null;
    case "dealAccept":
      return typeof r.accept === "boolean" ? { kind: "dealAccept", accept: r.accept } : null;
    case "again":
      return typeof r.again === "boolean" ? { kind: "again", again: r.again } : null;
  }
}
