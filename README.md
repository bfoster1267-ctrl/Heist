# Heist

The online version of **Heist**, the double-cross card game: 3 to 6 players, poker-table seats, bots to fill empty chairs, play-money chips. Browser first, iPhone app after.

## What's here

| Path | What it is |
|---|---|
| `packages/engine` | The v3 rules as code: every Boss/Mark/Pen rule and all 13 Roles, bots ported from the balance sim, tests, and a bot-vs-bot sim. Runs in the browser and on a server. |
| `apps/web` | The table: lobby, seats around a felt table, the job zone, card and crew animations, sound, play-money chips. Solo vs bots today. |
| `docs/PLAN.md` | The roadmap and the workstreams (one branch each). |

## Run it

```bash
npm install
npm run dev          # the table at http://localhost:5173
npm test             # engine tests
npm run sim -- 500   # 500 bot games per player count
npm run build -w apps/web -- --mode single   # one self-contained index.html in apps/web/dist-single
```

## How the engine works

The rules run as a generator: the code reads top to bottom like the Boss card, and each time a player has to choose something the engine stops and asks (`game.pending`). The host answers with `game.answer(seat, answer)`. Every change is recorded as a frame (event, message, state snapshot) that the table animates. A game is fully reproducible from its seed plus the list of answers, so a server can rebuild a table after a restart, and `viewFor(state, seat)` strips what a seat may not see (other hands, face-down cards, the deck order).

Chips are play money only. They can't be bought or cashed out.
