// Coached play: a real game against bots with a coach talking you through it. Two parts, both pure so
// the table, the browser account and the server agree:
//  - checkMove spots rookie mistakes in an answer before it's played (the table asks "are you sure?"),
//    and the server counts them from every solo game it replays, so we learn which ones new players make.
//  - coachTip is the coach's one-line read of the decision in front of you.
// Advice lives only here, in Coached play. Regular and online tables show facts, never advice.

import { Bot, cardLabel, isFighter, jobBases, type Answer, type Ask, type GameState, type HeistGame } from "@heist/engine";

export type MistakeId = "alreadyIn" | "allCrewOut" | "layLowStrong" | "fixerWithScore" | "bankLastFighter" | "skippedBackup";

export const MISTAKES: Record<MistakeId, { title: string; why: string }> = {
  alreadyIn: {
    title: "You're already in that hideout",
    why: "You already have a Foothold there, so winning gets you nothing new. Hit a hideout you're not in yet.",
  },
  allCrewOut: {
    title: "That empties your hideouts",
    why: "Crew at home defend you. Send everyone and any rival can walk into your empty hideouts next turn. Keep 1 or 2 home.",
  },
  layLowStrong: {
    title: "You have a strong hand",
    why: "A big Score wins most fights. Laying low with one wastes your turn while rivals catch up.",
  },
  fixerWithScore: {
    title: "A Score beats a Fixer",
    why: "If the other side plays any Score, your Fixer loses outright. Play a Score unless you want a Fixer-vs-Fixer deal.",
  },
  bankLastFighter: {
    title: "That banks your last fighter",
    why: "With no Score or Fixer in hand you can't fight: your turn gets skipped and you redraw. Keep one in hand.",
  },
  skippedBackup: {
    title: "Backup wins this fight",
    why: "Your side is close enough that +3 turns it around. Play the Backup.",
  },
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
      return "Pick the Role whose rule you'll use most. Everyone can see it, so rivals will play around it.";
    case "bank":
      return best >= 0
        ? `Bank cheap cards you won't fight with. Keep your best Score (${best}) and at least one fighter in hand.`
        : "Bank cards you won't fight with. You'll want a Score or Fixer in hand to hit.";
    case "hire":
      return `You have ${home} crew at home. Hiring makes your hits bigger and your hideouts harder to crack. Hire when the cash is spare.`;
    case "action": {
      if (ask.wanted.length) return `${name(ask.wanted[0].leader)} is running away with it. Wanted lets you hit a hideout holding their crew and knock them back.`;
      if (!ask.canHit) return ask.busts.length ? "No crew at home to hit with. Bust a rival out of your hideout instead." : "No crew at home. Lay low this turn and rebuild.";
      if (best >= 15) return `You hold a ${best}. That wins most fights, so this is a good turn to hit.`;
      if (best >= 8) return `Your best Score is ${best}. A hit is fine if you can send 2 or more crew.`;
      return ask.busts.length ? "Your hand is weak. Busting a rival out of your own hideout is the safer play." : "Your hand is weak. Laying low is fine; draw into better cards.";
    }
    case "pickMark":
      return "Pick someone with weak hideouts, or the leader, to slow them down.";
    case "pickHideout": {
      const hs = s.players[ask.mark].hideouts;
      const open = hs.map((h, i) => ({ i, g: h[ask.mark], in: h[me] > 0 })).filter((x) => !x.in);
      if (!open.length) return "You already have a Foothold in every one of these, so this hit can't win you a new one.";
      const t = open.reduce((m, x) => (x.g < m.g ? x : m));
      return `Hideout ${t.i + 1} has the fewest guards (${t.g}) and none of your crew yet. That's your best target.`;
    }
    case "send": {
      if (!j) return "";
      // the Boss has to beat guards + home turf (allies aside) with crew + card; ties go to the Mark
      const { b, m } = jobBases(s, j);
      const need = Math.min(ask.max, Math.max(1, m + 1 - b - Math.max(best, 0)));
      return `The Mark starts at ${m} (guards plus home turf) before cards. With your ${Math.max(best, 0)}, about ${need} crew wins it. Keep 1 or 2 home to defend.`;
    }
    case "join":
      return j ? `Backing ${name(j.boss)} can win you a Foothold. Defending ${name(j.mark)} banks you a Cut if they hold. The Mark gets +5 home turf and wins ties.` : "";
    case "bet":
      return "Bet on the side you think wins. The Mark has +5 home turf and wins ties.";
    case "doubleCross":
      return "Flip an ally off the side you want to win. It works best right before the showdown, when they can't answer.";
    case "hackerCall":
      return "Call a number your opponent is likely to hold: the middle Scores (8, 10, 12) are the most common.";
    case "showdown": {
      if (ask.as === "bust" || ask.as === "rival") return `A Fixer counts as 0 here. Play a Score: your best is ${Math.max(best, 0)}.`;
      return best >= 0 ? `A Score beats any Fixer. Your best is ${best}.` : "No Scores in hand: your Fixer only wins if they play a Fixer too.";
    }
    case "forger":
      return "Change your card if a higher number from the discard pile wins the fight.";
    case "backup": {
      const mine = sideOf(s, me);
      if (!j || !mine) return "You're not in this fight. Backup can still swing it toward the side you bet on, or against the leader.";
      const short = mine === "B" ? j.mTotal - j.bTotal : j.bTotal - j.mTotal - 1;
      if (short < 0) return "Your side is already winning. Save the Backup.";
      return short < 3 ? "Your side is close: +3 wins it. Play the Backup." : "Your side is too far behind for +3 to help. Save it.";
    }
    case "again":
      return home >= 3 ? `You still have ${home} crew home. Go again if you hold a good Score.` : "Only a few crew left at home. Stopping keeps you safe from counter-hits.";
    case "discard":
      return "Throw away the lowest Scores first. Keep Backup and Double-Cross; they swing fights.";
    case "fence":
      return "Buy back a big Score or a Backup if one is in the discard pile.";
    case "wildcard":
      return "Swap for a Role that's beating you, or keep yours if it's working.";
    case "dealOffer":
    case "deal":
      return "No deal sends 2 of your crew and 2 of theirs to the Pen. A cheap deal is usually better than that.";
    case "dealAccept":
      return "Refusing costs both of you 2 crew. Take the deal unless it hands them the game.";
    case "giveCards":
      return "Give away your weakest cards.";
    case "placeCrew":
      return "Put crew where rivals have Footholds, so you can bust them out.";
    case "bribe":
      return "A bribe isn't binding. Pay players who need the cash, and don't count on them.";
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
    return c ? cardLabel(c) : "a card";
  };
  const list = (ids: number[]) => ids.map(card).join(", ");
  const crew = (n: number) => `${n} crew`;
  switch (a.kind) {
    case "bank":
      return a.cardIds.length ? `Bank ${list(a.cardIds)}.` : "Bank nothing this turn.";
    case "hire":
      return a.count ? `Hire ${crew(a.count)}.` : "Don't hire.";
    case "action":
      if (a.choice === "hit") return "Hit.";
      if (a.choice === "pass") return "Lay low.";
      if (a.choice === "bust") return `Bust ${name(a.rival)} out of your hideout ${a.hideout + 1}.`;
      return `Wanted: hit ${name(a.mark)}'s hideout ${a.hideout + 1}.`;
    case "again":
      return a.again ? "Hit again." : "Stop here.";
    case "pickMark":
      return `Hit ${name(a.mark)}.`;
    case "pickHideout":
      return `Hideout ${a.hideout + 1}.`;
    case "send":
      return `Send ${crew(a.count)}.`;
    case "join":
      if (a.B && a.M) return `Join both sides: ${a.B} with the Boss, ${a.M} with the Mark.`;
      if (a.B) return `Back the Boss with ${crew(a.B)}.`;
      if (a.M) return `Defend the Mark with ${crew(a.M)}.`;
      return "Stay out.";
    case "bet":
      return a.side ? `Bet on the ${a.side === "B" ? "Boss" : "Mark"}.` : "Don't bet.";
    case "showdown":
      return `Play your ${card(a.cardId)}.`;
    case "doubleCross":
      return a.target === null ? "Keep your Double-Cross." : `Double-Cross ${name(a.target)}.`;
    case "backup":
      return a.side ? `Play Backup for the ${a.side === "B" ? "Boss" : "Mark"}.` : "Keep your Backup.";
    case "discard":
      return `Throw away ${list(a.cardIds)}.`;
    case "fence":
      return a.cardId === null ? "Don't buy anything back." : "Buy it back.";
    case "hackerCall":
      return `Call ${a.n}.`;
    case "dealAccept":
      return a.accept ? "Take the deal." : "Refuse it.";
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
