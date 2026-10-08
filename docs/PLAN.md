# Heist online: plan

Goal: a polished online multiplayer Heist in the browser (poker-table seats, full animations, play-money betting, quick queue, friend invites, queue with friends), then an iPhone app from the same code.

## Decisions so far

- **Play money only.** Chips can't be bought or cashed out. Real-money wagering would make Heist regulated gambling (state licences, app store gambling rules). Selling cosmetic items or chip top-ups later is a separate decision; chips still can't be cashed out.
- **Web first, one codebase.** TypeScript everywhere. The engine runs in the browser (solo) and on the server (online). The iPhone app wraps the web app (Capacitor) rather than being a second codebase.
- **Server decides everything online.** Clients send answers, the server runs the engine and sends each player only what they may see (`viewFor`). Nobody can cheat by reading the page.
- **Rules are v3** (`game/heist-draft-v3.md` in the project files). The engine follows them; where the rulebook left a gap, these calls were made and can be changed:
  - Roles are face up (everyone sees them).
  - Last Call ends the game at the end of the turn in which the Job deck runs out the third time.
  - A Boss may lay low (skip the hit).
  - Fixer vs Fixer deals are two set offers ("I pay $3 and leave 1 crew" or "we both walk"). Free-form trades come with chat.
  - Crew leave and return to the hideout with the most or fewest of your crew (no hideout choice yet).
  - Bribes aren't a button yet; they come with chat and "give a banked card".

## Done (branch `claude/engine-and-table`)

- Rules engine with all 13 Roles, replay from seed + answers, hidden-information views.
- Bots ported from the Python balance sim. 1,200 bot games through the engine with no errors; 62/69/76/84% of games end at the Foothold target at 3/4/5/6 players (Python sim: 62/62/66/72%).
- Tests: every bot game finishes, cards and crew are never lost or duplicated, exact replay, illegal answers rejected, hands hidden.
- Engine workstream, round 1 (see `docs/ENGINE.md`): bots use Wanted like the sim, so 65/63/69/75% now end at the target (Python 67/61/66/71%). Optional rules, off by default until the table handles them: bribes, players placing their own crew, open Fixer vs Fixer deals. Bot levels easy / normal / hard, plus patient, grudge and secret-partner traits. Public job history. Fuzz tests with random legal play, replay of fuzzed games.
- Table: lobby with stakes and play chips, felt table with seats, hideouts and Footholds, job zone with face-down cards that flip, flying crew/coins/cards, banners, game log, speed controls, sound, game-over payout.

## Done (table polish, workstream 2)

- Cards drawn like the printed icon cards (Score pill, Fixer arrows, Double-Cross figures, keyhole backs, blueprint Role cards with icons).
- Phone-sideways layout: a shorter canvas picked for wide screens so the table draws about a third bigger.
- First-game table tour and one coach tip per decision type; tooltips on everything (hover, focus, long press).
- Keyboard play, screen-reader announcements, reduced-motion mode, settings menu (sound, volume, motion, tips).
- Animation and sound pass: arced tosses, buy-ins into the pot, payout to the winner, confetti, showdown spotlight, table shake on Double-Cross, count-up totals, your-turn chime.

## Workstreams (one branch and thread each)

| # | Workstream | Branch | Depends on | What "done" looks like |
|---|---|---|---|---|
| 1 | Engine and bots | `engine/*` | none | ~~Hideout choice for crew, bribes, free-form Fixer deals; bot difficulty levels (grudges, secret pairs, patience); closer match to the Python sim at 5-6 players.~~ Done, see `docs/ENGINE.md`. Next: the table and server switch the optional rules on. |
| 2 | Table polish | `table/*` | none | Card art when it's locked, tutorial/first game walkthrough, better mobile landscape layout, hover tooltips, accessibility, reduced-motion mode, sound pass. |
| 3 | Game server | `server/*` | 1 | Authoritative WebSocket server running the engine; rooms, reconnect, turn timers (bot takes over on timeout), spectators, action log storage. Hosting on Fly.io or Render (Brock needs an account). |
| 4 | Accounts, friends, matchmaking | `social/*` | 3 | **Accounts done (PR #5, see docs/ACCOUNTS.md):** sign in with Apple, Google, Facebook or email, guests keep progress, career stats and trackers, XP, levels, prestige, coins, cosmetics shop, drinks. Accounts live on the game server (no Supabase needed). Still to do: friends list, invite links, party queue, quick queue, bot fill after a wait. |
| 5 | Chips economy | `chips/*` | 4 | **Mostly done in PR #5:** server-side chips, buy-ins and payouts for online and vs-bot games, daily bonus, top-ups, leaderboards. Play money only. |
| 6 | iPhone app | `ios/*` | 2, 4 | Capacitor wrap, portrait table layout, haptics, push notifications for invites and "your turn", TestFlight build. Needs an Apple Developer account ($99/year) and a cloud Mac build (Codemagic or similar). |

Workstreams 1 and 2 can start now in parallel. 3 starts now too and 4 follows it. 5 and 6 come after accounts exist.

## Things only Brock can do

- Hosting account for the game server (Fly.io or Render) when workstream 3 is ready to deploy.
- Developer accounts for sign-in: Google Cloud (free), Apple Developer ($99/year, also needed for the iPhone app), Facebook for Developers (free). Steps in docs/ACCOUNTS.md.
- Apple Developer account for the iPhone app.
- Pick the art direction; the table currently draws cards from the icon style.
