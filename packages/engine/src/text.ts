// Player-facing text the engine makes: the game log, card and Role names. The English lives here (it's what
// the server logs and what older clients show); every log frame also carries the same line as a `Say` (a key
// plus its values), so a client can show it in the player's language. The web app's i18n catalogs translate
// these keys (see apps/web/src/i18n/README.md).
//
// Templates use {name} for a value. A key with `_one` / `_other` variants picks by the `count` value.
// Values that are themselves a Say (a card's name, a Role) are translated too; an array becomes a list
// ("Ann and Bob").

/** A line of player-facing text as a key and its values, so each client can say it in its own language. */
export interface Say {
  k: string;
  v?: Record<string, SayVar>;
}
export type SayVar = string | number | Say | SayVar[];

export type PluralRule = (n: number) => string;
const enPlural: PluralRule = (n) => (n === 1 ? "one" : "other");

/** Fill `{name}` slots in a template. Missing values are left as they are. */
export function fill(tpl: string, vars?: Record<string, string | number>): string {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** The template for `key` in `cat`, picking the plural form by `count` when the key has one. */
export function pick(cat: Record<string, string>, key: string, count: unknown, rule: PluralRule = enPlural): string | undefined {
  if (typeof count === "number") {
    const p = cat[`${key}_${rule(count)}`] ?? cat[`${key}_other`];
    if (p !== undefined) return p;
  }
  return cat[key];
}

/**
 * Say a `Say` with a catalog. Values that are Says are said first; arrays are joined with `list`
 * (default: English "a, b and c").
 */
export function sayWith(
  cat: Record<string, string>,
  s: Say,
  opts: { plural?: PluralRule; list?: (items: string[]) => string; fallback?: Record<string, string> } = {},
): string {
  const vars: Record<string, string | number> = {};
  const one = (x: SayVar): string | number =>
    Array.isArray(x) ? (opts.list ?? enList)(x.map((y) => String(one(y)))) : typeof x === "object" ? sayWith(cat, x, opts) : x;
  for (const [k, x] of Object.entries(s.v ?? {})) vars[k] = one(x);
  const tpl = pick(cat, s.k, vars.count, opts.plural) ?? (opts.fallback ? pick(opts.fallback, s.k, vars.count) : undefined) ?? s.k;
  return fill(tpl, vars);
}

const enList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The engine's English text. Keys are stable; change the English freely. */
export const ENGINE_TEXT = {
  // the six crews (color names on the cards)
  "crew.red": "Embers",
  "crew.blue": "Tidewater",
  "crew.green": "Verdant",
  "crew.yellow": "Gilded",
  "crew.purple": "Velvet",
  "crew.orange": "Rust",

  // cards
  "card.S": "Score {n}",
  "card.F": "Fixer",
  "card.B": "Backup",
  "card.X": "Double-Cross",
  "card.nothing": "nothing",

  // Roles
  "role.none": "No role",
  "role.muscle.name": "The Muscle",
  "role.muscle.text": "As Boss or Mark: +1.",
  "role.getaway.name": "The Getaway Driver",
  "role.getaway.text": "Take 2 crew out of the Pen each turn, not 1.",
  "role.safecracker.name": "The Safecracker",
  "role.safecracker.text": "Win as Boss: loot is $6, and the Mark sends 2 crew from another hideout to the Pen.",
  "role.mastermind.name": "The Mastermind",
  "role.mastermind.text": "As Boss, skip the flip and pick the Mark. Their home turf is only +2.",
  "role.forger.name": "The Forger",
  "role.forger.text": "Once per game, after the reveal: change your Score card to any number in the discard pile.",
  "role.pickpocket.name": "The Pickpocket",
  "role.pickpocket.text": "Whenever loot is paid, bank the top Job card.",
  "role.inside_man.name": "The Inside Man",
  "role.inside_man.text": "Join both sides. Split your crew. Collect from the side that wins.",
  "role.bookie.name": "The Bookie",
  "role.bookie.text": "Lost bets go to you. When a job you're not in ends, bank the top Job card.",
  "role.hacker.name": "The Hacker",
  "role.hacker.text": "Boss or Mark only: before cards are picked, call a number. If your opponent's card shows it, you win outright.",
  "role.lookout.name": "The Lookout",
  "role.lookout.text": "As Mark: +4.",
  "role.fence.name": "The Fence",
  "role.fence.text": "Once per turn: pay $2, take any card from the discard pile.",
  "role.double_agent.name": "The Double Agent",
  "role.double_agent.text": "Ally on the losing side? Switch at the reveal: your crew go home.",
  "role.wildcard.name": "The Wildcard",
  "role.wildcard.text": "Once per game, swap your Role with another player's.",

  // the game log
  "log.reshuffle": "The Job deck ran out ({n} of {max}). Shuffled the discard pile.",
  "log.lastCall": "Last Call! The game ends after this turn.",
  "log.cut": "{name} banks the top Job card (${cash}): {why}.",
  "log.why.pickpocket": "the Pickpocket skims the loot",
  "log.why.cut": "their Cut for defending",
  "log.why.bet": "a winning bet",
  "log.why.bookie": "the house always gets paid",
  "log.placeCrew": "{name} moves crew into their hideouts.",
  "log.toPen": "{count} of {name}'s crew go to the Pen.",
  "log.setup": "{n} players. First to {target} Footholds wins.",
  "log.role": "{name} is {role}.",
  "log.endLastHand_one": "That's the last hand. {winners} wins on Footholds.",
  "log.endLastHand_other": "That's the last hand. {winners} win on Footholds.",
  "log.endLastCall_one": "Last Call. {winners} wins on Footholds.",
  "log.endLastCall_other": "Last Call. {winners} win on Footholds.",
  "log.endFootholds_one": "{winners} reaches {target} Footholds and wins!",
  "log.endFootholds_other": "{winners} reach {target} Footholds and win!",
  "log.turn": "{name} is the Boss.",
  "log.wildcard": "{name} swaps Roles with {other} and becomes {role}.",
  "log.draw": "{name} draws {count}.",
  "log.penReturn": "{name} takes {count} crew out of the Pen.",
  "log.fence": "{name} pays $2 and takes {card} from the discard pile.",
  "log.bank_one": "{name} banks {count} card.",
  "log.bank_other": "{name} banks {count} cards.",
  "log.hire": "{name} hires {count} crew for ${cost}.",
  "log.stuckBoss": "{name} has no Score or Fixer: new hand of 5, and the turn passes.",
  "log.pass": "{name} lays low this turn.",
  "log.again": "{name} goes again.",
  "log.discardDown": "{name} discards down to {n}.",
  "log.stuck": "{name} has no Score or Fixer: discards and draws 5.",
  "log.facedown": "{name} lays a card face down.",
  "log.wanted": "Wanted! {boss} hits {mark}'s hideout to get at the leader.",
  "log.mastermind": "The Mastermind picks {mark} as the Mark.",
  "log.flipOwn": "The flip shows the Boss's own color. {boss} picks the Mark.",
  "log.flipNobody": "The flip shows nobody's color. {boss} picks the Mark.",
  "log.picks": "{boss} picks {mark} as the Mark.",
  "log.flipShows": "The flip shows {mark}'s color.",
  "log.isMark": "{mark} is the Mark.",
  "log.target": "{boss} hits {mark}'s hideout {h}.",
  "log.send": "{name} sends {count} crew.",
  "log.bribeB": "{name} slips {to} ${amount} to join the Boss.",
  "log.bribeM": "{name} slips {to} ${amount} to join the Mark.",
  "log.staysOut": "{name} stays out.",
  "log.joinB": "{name} joins the Boss with {count} crew.",
  "log.joinM": "{name} joins the Mark with {count} crew.",
  "log.doubleCrossB": "Double-Cross! {name} flips {target} to the Boss's side.",
  "log.doubleCrossM": "Double-Cross! {name} flips {target} to the Mark's side.",
  "log.betB": "{name} bets ${amount} on the Boss.",
  "log.betM": "{name} bets ${amount} on the Mark.",
  "log.hackerCall": "The Hacker calls {n}.",
  "log.reveal": "Reveal: {boss} vs {mark}.",
  "log.hacked": "Hacked! The card shows {n}. {name} wins outright.",
  "log.forged": "The Forger changes their card to {n}.",
  "log.backupB": "{name} plays Backup: +{n} to the Boss.",
  "log.backupM": "{name} plays Backup: +{n} to the Mark.",
  "log.bossWins": "The Boss wins, {a} to {b}.",
  "log.markHolds": "The Mark holds, {a} to {b}.",
  "log.foothold": "{name} leaves 1 crew behind: a Foothold.",
  "log.loot": "{name} pays ${amount} loot.",
  "log.noLoot": "{name} has no cash to pay loot.",
  "log.lootAlready": "{msg} {names} already had a Foothold there, so no new one: their crew all went home.",
  "log.betWon": "{name} wins the bet.",
  "log.betLost": "{name} loses the bet.",
  "log.betLostBookie": "{name} loses the bet to the Bookie.",
  "log.fixerFixer": "Fixer vs. Fixer: time to make a deal.",
  "log.dealLeave": "{name} leaves 1 crew behind.",
  "log.dealPayLeave": "{name} pays ${amount} to leave 1 crew behind.",
  "log.pays": "{name} pays ${amount}.",
  "log.dealTaken": "{name} takes the deal.",
  "log.dealRefused": "{name} turns the deal down.",
  "log.dealWalk": "{name} walks away from the table. No deal.",
  "log.dealOffer": "{name} offers: {deal}.",
  "log.giveCards_one": "{name} hands {to} {count} card.",
  "log.giveCards_other": "{name} hands {to} {count} cards.",
  "log.bust": "{name} busts {rival}'s crew out of hideout {h}.",
  "log.bustReveal": "Bust: {a} vs {b} (a Fixer counts as 0, tie goes to {name}).",
  "log.bustWon": "{name} clears them out.",
  "log.bustHeld": "{name} holds on.",

  // deals, as offered ("Ann leaves 1 crew behind, Bob pays $2")
  "deal.foothold": "{name} leaves 1 crew behind",
  "deal.pays": "{name} pays ${amount}",
  "deal.gives_one": "{name} gives {count} card",
  "deal.gives_other": "{name} gives {count} cards",
  "deal.walk": "both walk away",
} as const;

export type EngineTextKey = keyof typeof ENGINE_TEXT;

/** A Say in the engine's English. */
export const sayEn = (s: Say): string => sayWith(ENGINE_TEXT, s);
