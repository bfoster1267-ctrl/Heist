# Engine API (`@heist/engine`)

What the table (`apps/web`) and the game server use. Everything is plain JSON so a server can send it as is.

## Running a game

```ts
import { HeistGame, Bot, runBots, viewFor } from "@heist/engine";

const g = new HeistGame({
  seed: 1234,
  seats: [{ name: "Brock", bot: false }, { name: "Rosa", bot: true }, { name: "Dutch", bot: true }],
  rules: { bribes: true },   // optional rules, see below; anything left out is off
  snapshots: true,           // default; false = frames carry the live state (fast, for sims and replays)
});
const bots = new Map([[1, new Bot(1, { level: "hard" })], [2, new Bot(2)]]);

runBots(g, bots);            // bots answer until a human must act or the game ends
g.pending;                   // the Ask waiting on a player, or null when the game is over
g.answer(0, { kind: "bank", cardIds: [] });  // throws on an illegal answer, with a message for the player
g.drainFrames();             // frames since the last call: { ev, msg, state } for the table to animate
viewFor(g.s, 0);             // what seat 0 may see (hands, face-down cards and the deck hidden); -1 = spectator
```

A game is fully reproducible from `seed`, `seats`, `rules` and the answer log (`g.answers`), so a server can store
only those and rebuild a table after a restart.

## Optional rules (`GameConfig.rules`)

All three default to **off**, so a host that doesn't handle their Asks yet keeps working. Turn one on only once
the table can answer its Ask for a human seat. Bots answer all of them.

| Rule | What it adds | New Asks | New events |
|---|---|---|---|
| `bribes` | After the Boss sends crew and before allies join, the Boss and then the Mark may pay banked cards to other players. Not binding: the money moves now, the player still joins whichever side they like. Every bribe is public in `job.bribes`. | `bribe` | `bribe` |
| `placeCrew` | Players choose where their crew go. Crew coming home (from a job, the Pen, or a hire) wait in `player.returning` until their owner places them: after Regroup, after each job, and after a bust. `send`/`join` answers may say which hideouts crew leave from (`from`). Off: crew leave the fullest hideout and return to the emptiest, as before. | `placeCrew` | `placeCrew` |
| `openDeals` | Fixer vs. Fixer becomes a negotiation. The Boss opens; each side then accepts, walks away, or counters, up to 4 offers in all (`DEAL_OFFERS`). A deal can move cash (paid from the bank, no change), hand cards (the giver picks which) and let the Boss leave 1 crew behind. A deal must be kept; no deal = 2 crew each to the Pen, as before. Off: the two set offers ("walk" or "pay $3 and leave 1 crew") stay. | `deal`, `giveCards` | `dealOffer`, `giveCards` (and the existing `deal`) |

`send` and `join` accept `from` with every rule set; it's just checked against your hideouts.

### The new Asks and Answers

```ts
// bribes
{ kind: "bribe"; seat; side: "B" | "M"; targets: number[] }
  -> { kind: "bribe"; offers: { to: number; cardIds: number[] }[] }   // [] = no bribe; one offer per player

// placeCrew
{ kind: "placeCrew"; seat; count }
  -> { kind: "placeCrew"; to: [h0, h1, h2] }                          // sums to count
{ kind: "send", count, from?: [h0, h1, h2] }                          // from sums to count
{ kind: "join", B, M, from?: [h0, h1, h2] }                           // from sums to B + M

// openDeals
{ kind: "deal"; seat; as: "boss" | "mark"; offer: Deal | null; offersLeft: number }
  -> { kind: "deal"; action: "accept" | "reject" | "propose"; deal?: Deal }
     // accept needs an offer on the table; propose needs offersLeft > 0
{ kind: "giveCards"; seat; to; count } -> { kind: "giveCards"; cardIds: number[] }

interface Deal { bossPays: number; markPays: number; bossCards: number; markCards: number; foothold: boolean }
```

`describeDeal(deal, bossName, markName)` gives a plain sentence for an offer ("Rosa pays $3, Rosa leaves 1 crew behind").

## Other changes in this version

- **Second hit can be Wanted.** The `again` Ask now carries `wanted: WantedOption[]`; the answer may add
  `wanted: { mark, hideout }`. Leaving it out is a normal flip, as before.
- **Job history.** `state.history` lists every finished job (Boss, Mark, kind, result, both cards, allies on each
  side). It's public, so a table can show "last jobs" and bots use it for grudges and spotting partners.
- **`player.returning`** is always 0 unless `placeCrew` is on.
- **`snapshots: false`** in the config for sims and server replays (about 10x faster).
- **`randomAnswer(game, ask, rng)`** picks a random legal answer to any Ask. The fuzz tests use it; it's also a
  ready-made load-test client.

Hosts that list every event type (like the table's `HOLD` timings) need entries for `bribe`, `dealOffer`,
`giveCards` and `placeCrew`.

## Bots

```ts
new Bot(seed, { level: "easy" | "normal" | "hard", patient?, vendetta?, partner? })
```

| Level | How it plays | One bot of this level among normal bots wins (fair share in brackets) |
|---|---|---|
| `easy` | Looser card choice, no bribes, Wanted only to stop a winner, random bets, fewer Double-Crosses. | 30 / 25 / 19 / 15% at 3/4/5/6 players (33/25/20/17) |
| `normal` | The Python balance-sim bot. Default. | fair |
| `hard` | The tricks that won in the strategy sims: sits out round 1 in about 3 games of 5, joins every fight, piles on anyone 1 Foothold from winning (picks them, joins against them, Double-Crosses their allies), holds grudges, spots players who keep backing each other, sharper card choice, dodges a Hacker's call. | 34 / 27 / 22 / 21% |

Traits on top of any level:

- `patient`: only hits with a 12+ card, 6+ cards in hand, a rival about to win, or after waiting 2 turns.
- `vendetta` (on for hard): a bad beat gives a grudge against the winner.
- `partner: seat`: a secret pair. Set it on both bots. They back each other until one is 1 Foothold from winning,
  then turn on them. In the sim a pair wins 46 / 34 / 26 / 20% per player at 3/4/5/6 (the Python strategy sim
  found 47 / 35 / 26 / 19%), so keep it for a "rigged table" mode, not for normal fills.

A table of all-hard bots has a smaller seat-order gap than all-normal (4 players: first seat 22% vs last 27%).

## Sim

```bash
npm run sim -- 2000                                  # 2000 games per player count, normal bots, base rules
npm run sim -- 2000 --rules bribes,placeCrew,openDeals
npm run sim -- 2000 --level hard                     # every bot hard
npm run sim -- 2000 --one hard                       # one hard bot, rotating seats, among normal bots
npm run sim -- 2000 --pairs                          # one secret pair per table
npm run sim -- 2000 --patient                        # every bot patient
```

Each line prints how games ended, rounds, seat win rates and per-game counts (hits, Wanted hits, busts, bets,
bribes, deals and so on) named like the Python sim's stats.

## Match with the Python balance sim

Share of games that end at the Foothold target (rest end at Last Call), current v3 rules, 4,000 games per count:

| | 3p | 4p | 5p | 6p |
|---|---|---|---|---|
| Python sim (`game/v3/sim/smart/v3smart_base.py`, current rules) | 67% | 61% | 66% | 71% |
| Engine before | 62% | 69% | 76% | 84% |
| Engine now (bribes on) | 65% | 63% | 69% | 75% |

What closed it: bots now take a Wanted hit whenever one is open, as the sim's bots do (Wanted hits per 4-player
game went from 0.9 to 4.6, the sim has 4.6), and the second hit after a win can be Wanted too. Smaller fixes:
bribes, the sim's Fixer deal habit (always ask for the Foothold), and bots no longer play a card the Hacker called.

What's left, and why:

- The sim's Mastermind still flips for the Mark and the Mark keeps +3, and its Safecracker loot is $3. The engine
  follows the printed cards (Mastermind picks the Mark, Mark only +2; Safecracker loot $6). Switching the engine
  to the sim's version moves 4-6 players to within 1 to 2 points of the sim.
- 3 players stays about 3 to 4 points under the sim with every difference above removed; no single cause found
  (hits, busts, Boss win rate, stuck hands, Fixer deals and Wanted hits all match per turn).
