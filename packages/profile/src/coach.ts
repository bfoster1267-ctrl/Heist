// Coached play: a real game against bots with a coach talking you through it. Two parts, both pure so
// the table, the browser account and the server agree:
//  - checkMove spots rookie mistakes in an answer before it's played (the table asks "are you sure?"),
//    and the server counts them from every solo game it replays, so we learn which ones new players make.
//  - coachTip is the coach's one-line read of the decision in front of you.
// Advice lives only here, in Coached play. Regular and online tables show facts, never advice.

import { PROFILE_TEXT as T, say } from "./text";
import { Bot, cardLabel, isFighter, jobBases, type Answer, type Ask, type GameState, type HeistGame } from "@heist/engine";

export type MistakeId = "alreadyIn" | "allCrewOut" | "layLowStrong" | "fixerWithScore" | "bankLastFighter" | "skippedBackup";

export const MISTAKES: Record<MistakeId, { title: string; why: string }> = {
  alreadyIn: { title: T["mistake.alreadyIn.title"], why: T["mistake.alreadyIn.why"] },
  allCrewOut: { title: T["mistake.allCrewOut.title"], why: T["mistake.allCrewOut.why"] },
  layLowStrong: { title: T["mistake.layLowStrong.title"], why: T["mistake.layLowStrong.why"] },
  fixerWithScore: { title: T["mistake.fixerWithScore.title"], why: T["mistake.fixerWithScore.why"] },
  bankLastFighter: { title: T["mistake.bankLastFighter.title"], why: T["mistake.bankLastFighter.why"] },
  skippedBackup: { title: T["mistake.skippedBackup.title"], why: T["mistake.skippedBackup.why"] },
};

export const MISTAKE_IDS = Object.keys(MISTAKES) as MistakeId[];

const homeOf = (s: GameState, p: number) => s.players[p].hideouts.reduce((a, h) => a + h[p], 0);
const bestScore = (s: GameState, p: number) => Math.max(-1, ...s.players[p].hand.filter((c) => c.kind === "S").map((c) => c.score));

/** Which side `p` is fighting for in the current job, if any. */
function sideOf(s: GameState, p: number): "B" | "M" | null {
  const j = s.job;
  if (!j) return null;
  if (j.boss === p || j.side.B[p] > 0) return "B";
  if (j.mark === p || j.side.M[p] > 0) return "M";
  return null;
}

/** The rookie mistake this answer makes, if any. Only reads what the answering player can see. */
export function checkMove(s: GameState, ask: Ask, a: Answer): MistakeId | null {
  const me = ask.seat;
  const P = s.players[me];
  switch (ask.kind) {
    case "pickHideout": {
      if (a.kind !== "pickHideout") return null;
      const hs = s.players[ask.mark].hideouts;
      return hs[a.hideout]?.[me] > 0 && hs.some((h) => h[me] === 0) ? "alreadyIn" : null;
    }
    case "action": {
      if (a.kind !== "action") return null;
      if (a.choice === "pass") return ask.canHit && bestScore(s, me) >= 15 ? "layLowStrong" : null;
      if (a.choice === "wanted") {
        const inThere = (m: number, h: number) => s.players[m].hideouts[h][me] > 0;
        return inThere(a.mark, a.hideout) && ask.wanted.some((w) => !inThere(w.mark, w.hideout)) ? "alreadyIn" : null;
      }
      return null;
    }
    case "send": {
      if (a.kind !== "send") return null;
      const home = homeOf(s, me);
      return home >= 3 && a.count >= home ? "allCrewOut" : null;
    }
    case "join": {
      if (a.kind !== "join") return null;
      const home = homeOf(s, me);
      return home >= 3 && a.B + a.M >= home ? "allCrewOut" : null;
    }
    case "showdown": {
      if (a.kind !== "showdown") return null;
      const c = P.hand.find((x) => x.id === a.cardId);
      return c?.kind === "F" && P.hand.some((x) => x.kind === "S") ? "fixerWithScore" : null;
    }
    case "bank": {
      if (a.kind !== "bank") return null;
      const left = P.hand.filter((c) => !a.cardIds.includes(c.id));
      return P.hand.some(isFighter) && !left.some(isFighter) ? "bankLastFighter" : null;
    }
    case "backup": {
      if (a.kind !== "backup" || a.side) return null;
      const j = s.job;
      const mine = sideOf(s, me);
      if (!j || !mine || !j.revealed) return null;
      // the Boss needs to be strictly ahead; the Mark wins ties
      const short = mine === "B" ? j.mTotal - j.bTotal : j.bTotal - j.mTotal - 1;
      return short >= 0 && short < 3 ? "skippedBackup" : null;
    }
  }
  return null;
}

/** The coach's read of the decision in front of you: one or two short sentences. */
export function coachTip(s: GameState, ask: Ask): string {
  const me = ask.seat;
  const name = (p: number) => s.players[p].name;
  const best = bestScore(s, me);
  const home = homeOf(s, me);
  const j = s.job;
  switch (ask.kind) {
    case "keepRole":
      return say("tip.keepRole");
    case "bank":
      return best >= 0
        ? say("tip.bank", { best })
        : say("tip.bankNoScore");
    case "hire":
      return say("tip.hire", { home });
    case "action": {
      if (ask.wanted.length) return say("tip.wanted", { name: name(ask.wanted[0].leader) });
      if (!ask.canHit) return ask.busts.length ? say("tip.noCrewBust") : say("tip.noCrew");
      if (best >= 15) return say("tip.strong", { best });
      if (best >= 8) return say("tip.medium", { best });
      return ask.busts.length ? say("tip.weakBust") : say("tip.weak");
    }
    case "pickMark":
      return say("tip.pickMark");
    case "pickHideout": {
      const hs = s.players[ask.mark].hideouts;
      const open = hs.map((h, i) => ({ i, g: h[ask.mark], in: h[me] > 0 })).filter((x) => !x.in);
      if (!open.length) return say("tip.allFootholds");
      const t = open.reduce((m, x) => (x.g < m.g ? x : m));
      return say("tip.pickHideout", { h: t.i + 1, g: t.g });
    }
    case "send": {
      if (!j) return "";
      // the Boss has to beat guards + home turf (allies aside) with crew + card; ties go to the Mark
      const { b, m } = jobBases(s, j);
      const need = Math.min(ask.max, Math.max(1, m + 1 - b - Math.max(best, 0)));
      return say("tip.send", { m, best: Math.max(best, 0), need });
    }
    case "join":
      return j ? say("tip.join", { boss: name(j.boss), mark: name(j.mark) }) : "";
    case "bet":
      return say("tip.bet");
    case "doubleCross":
      return say("tip.doubleCross");
    case "hackerCall":
      return say("tip.hackerCall");
    case "showdown": {
      if (ask.as === "bust" || ask.as === "rival") return say("tip.showdownBust", { best: Math.max(best, 0) });
      if (best >= 0 && !s.players[me].hand.some((c) => c.kind === "F")) return say("tip.showdownTotal", { best });
      return best >= 0 ? say("tip.showdownBeats", { best }) : say("tip.showdownNoScore");
    }
    case "forger":
      return say("tip.forger");
    case "backup": {
      const mine = sideOf(s, me);
      if (!j || !mine) return say("tip.backupOut");
      const short = mine === "B" ? j.mTotal - j.bTotal : j.bTotal - j.mTotal - 1;
      if (short < 0) return say("tip.backupWinning");
      return short < 3 ? say("tip.backupClose") : say("tip.backupFar");
    }
    case "again":
      return home >= 3 ? say("tip.again", { home }) : say("tip.stop");
    case "discard":
      return say("tip.discard");
    case "fence":
      return say("tip.fence");
    case "wildcard":
      return say("tip.wildcard");
    case "dealOffer":
    case "deal":
      return say("tip.deal");
    case "dealAccept":
      return say("tip.dealAccept");
    case "giveCards":
      return say("tip.giveCards");
    case "placeCrew":
      return say("tip.placeCrew");
    case "bribe":
      return say("tip.bribe");
  }
  return "";
}

/**
 * The coach's pick for the decision in front of you: what the strongest bot would play from your seat. It
 * sees only your hand and the table, like you. Never a move checkMove would flag.
 */
export function coachPick(g: HeistGame, ask: Ask): Answer | null {
  let a: Answer;
  try {
    a = new Bot(g.s.turn * 977 + ask.seat, { level: "hard" }).answer(g, ask);
  } catch {
    return null;
  }
  // the strong bot often sits out its first turn; with gentle bots a learner does better hitting, and it's
  // what the coach's tip says
  if (ask.kind === "action" && a.kind === "action" && a.choice === "pass" && ask.canHit) a = { kind: "action", choice: "hit" };
  if (!checkMove(g.s, ask, a)) return a;
  // the strong bot sometimes empties its hideouts or holds a Score back; the coach doesn't
  if (a.kind === "send" && a.count > 1) a = { ...a, count: a.count - 1, from: undefined };
  else if (a.kind === "join" && a.B + a.M > 1) a = { ...a, B: a.B > 0 ? a.B - 1 : 0, M: a.B > 0 ? a.M : a.M - 1, from: undefined };
  else if (a.kind === "showdown") {
    const top = g.s.players[ask.seat].hand.filter((c) => c.kind === "S").sort((x, y) => y.score - x.score)[0];
    if (top) a = { kind: "showdown", cardId: top.id };
  }
  return checkMove(g.s, ask, a) ? null : a;
}

/** The coach's pick in words, for the coach card ("" when there's nothing worth saying). */
export function describePick(s: GameState, ask: Ask, a: Answer): string {
  const me = s.players[ask.seat];
  const name = (p: number) => s.players[p].name;
  const card = (id: number) => {
    const c = me.hand.find((x) => x.id === id) ?? me.bank.find((x) => x.id === id);
    return c ? cardLabel(c) : say("pick.aCard");
  };
  const list = (ids: number[]) => ids.map(card).join(", ");
  switch (a.kind) {
    case "bank":
      return a.cardIds.length ? say("pick.bank", { cards: list(a.cardIds) }) : say("pick.bankNothing");
    case "hire":
      return a.count ? say("pick.hire", { count: a.count }) : say("pick.noHire");
    case "action":
      if (a.choice === "hit") return say("pick.hit");
      if (a.choice === "pass") return say("pick.layLow");
      if (a.choice === "bust") return say("pick.bust", { name: name(a.rival), h: a.hideout + 1 });
      return say("pick.wanted", { name: name(a.mark), h: a.hideout + 1 });
    case "again":
      return a.again ? say("pick.again") : say("pick.stop");
    case "pickMark":
      return say("pick.mark", { name: name(a.mark) });
    case "pickHideout":
      return say("pick.hideout", { h: a.hideout + 1 });
    case "send":
      return say("pick.send", { count: a.count });
    case "join":
      if (a.B && a.M) return say("pick.joinBoth", { b: a.B, m: a.M });
      if (a.B) return say("pick.backBoss", { count: a.B });
      if (a.M) return say("pick.defendMark", { count: a.M });
      return say("pick.stayOut");
    case "bet":
      return a.side ? say(a.side === "B" ? "pick.betBoss" : "pick.betMark") : say("pick.noBet");
    case "showdown":
      return say("pick.play", { card: card(a.cardId) });
    case "doubleCross":
      return a.target === null ? say("pick.keepDouble") : say("pick.double", { name: name(a.target) });
    case "backup":
      return a.side ? say(a.side === "B" ? "pick.backupBoss" : "pick.backupMark") : say("pick.keepBackup");
    case "discard":
      return say("pick.discard", { cards: list(a.cardIds) });
    case "fence":
      return a.cardId === null ? say("pick.noFence") : say("pick.fence");
    case "hackerCall":
      return say("pick.call", { n: a.n });
    case "dealAccept":
      return a.accept ? say("pick.takeDeal") : say("pick.refuse");
  }
  return "";
}

/** Count of each mistake, added up. */
export type MistakeCounts = Partial<Record<MistakeId, number>>;

export function addCounts(a: MistakeCounts, b: MistakeCounts): MistakeCounts {
  const out: MistakeCounts = { ...a };
  for (const k of MISTAKE_IDS) if (b[k]) out[k] = (out[k] ?? 0) + b[k]!;
  return out;
}
