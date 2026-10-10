# @heist/server

The online game server. It runs the shared engine for every table, so the server decides everything:
clients send answers and play back what they're sent, and each player only ever receives their own
view of the table (`viewFor`), never other hands, face-down showdown cards or the deck.

```bash
npm run server          # from the repo root: ws://localhost:8787/ws, health check at /healthz
npm run test:server     # room tests (fake clock) and real-socket games
npm run build -w packages/server   # one bundled file: packages/server/dist/main.js
```

## How a table works

- **Rooms** have a 5-letter code (no 0/O/1/I/L) to share with friends, 3 to 6 seats, play-money stakes and a
  turn clock (10 to 120 s, default 30). Public rooms with a free seat show up in `list`; private ones are
  join-by-code only.
- **Seats.** The first player in is the host. People join open seats in the lobby; anyone else (or anyone who
  asks) spectates and sees only public information. When the host starts, empty seats get bots.
- **Turns.** The engine runs until a person has to decide. That player gets an `ask` with an id and a
  deadline; everyone else gets `waiting`. The clock starts after the table has had time to animate the
  plays that came before it. Bots answer instantly; clients pace the playback.
- **Timeouts.** If the clock runs out a bot answers that one decision. Two in a row and a bot plays the
  seat (autopilot) until the player comes back or switches it off. A player can also hand their seat to
  a bot on purpose (`autopilot`).
- **Dropped connections.** The seat is held. Mid-game, a disconnected player's decisions wait only 20 s
  before a bot answers. The client reconnects with its token and sends the last frame it played, so it
  resumes without a gap; if that's too far back it gets a full `sync` instead. Leaving on purpose
  mid-game hands the seat to a bot; leaving in the lobby frees the seat.
- **Rematch.** After a game the host can start again with the same table; players who left are replaced by bots.
- **Table talk.** `chat` lines and `drink`s (one of five drinks, from a seated player to another seat) go to
  everyone at the table. They share one limit per player.
- **Action log.** Each game is stored as seed + seats + every answer (and who gave it: player, bot, or
  autopilot). That rebuilds any game exactly. When the server restarts, unfinished tables are rebuilt
  from the log and players reclaim their seats by reconnecting.
- **Limits.** 16 KB per message, a per-socket rate limit, 5 chat lines or drinks per 10 s, and every answer is
  reshaped and type-checked before it reaches the engine. Idle rooms close after 10 minutes.

The wire protocol is in `src/protocol.ts` and a ready-made client (auto-reconnect, resume, `onConnection` to show when it's reconnecting) in
`src/client.ts`; both are browser-safe and exported as `@heist/server/protocol` and `@heist/server/client`.
Frames arrive in the same shape the solo table already plays back (`ev`, `msg`, `state`), plus an index `i`.

## Where later work plugs in

| Later work | Plug-in point |
|---|---|
| Accounts | Done: pass an `AccountService` as `accounts` to `startServer` (main.ts does). See docs/ACCOUNTS.md for the API, sign-in setup and progression. |
| Quick queue, party queue, invites | `Rooms.create()`, then `room.join(conn)` for each matched player and `room.start(null)` to start without a host. Invite links carry the room code. |
| Chips economy | `onGameOver` gets the stakes, every seat's user id and the winners; settle buy-ins and payouts there. |
| Database | Implement `GameStore` (started, answered, ended, plus `unfinished` for restarts). |

## Deploying

The `Dockerfile` builds a small image (`docker build -f packages/server/Dockerfile .` from the repo root).
It runs on any host that runs a container with WebSockets. Ready-made configs at the repo root:

- **Fly.io**: `fly.toml` (steps in its header: launch, create a 1 GB volume, set `TOKEN_SECRET`, deploy).
- **Render**: `render.yaml` (New > Blueprint; it generates `TOKEN_SECRET` and adds a 1 GB disk).

Settings:

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on (8080 in the image). |
| `DATA_DIR` | Where game logs go (`/data` in the image: mount a volume there). |
| `TOKEN_SECRET` | Signs guest tokens. Set a long random value so players keep their seats across restarts. |
| `ALLOWED_ORIGINS` | Comma-separated web origins allowed to connect, e.g. `https://heist.example.com`. |
| `TURN_GRACE_MS` | How long a dropped player's decision waits before a bot answers (default 20000). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Turn on phone turn alerts (web push). Make a pair with `npm run vapid -w packages/server` and keep them only in the host's settings. Changing them later turns alerts off on every phone until the player opens Heist again. |

## Turn alerts

With VAPID keys set, a player can turn on alerts (the app offers once while they wait for a table, and in
Settings). The browser's subscription goes to `POST /api/push/subscribe {sub}` (`/api/push/unsubscribe
{endpoint}` undoes it; `GET /api/push/key` gives the public key). The app tells the socket when it goes to
the background (`{t: "away", on}`); then, a few seconds after their decision comes up (or someone sits at
their table), if they still aren't looking at that table, the server pushes "Your turn" to their phones, at
most once every 45 seconds. Only the big push services (Google, Apple, Mozilla, Microsoft) are accepted as
endpoints. On iPhone this needs Heist added to the Home Screen (iOS 16.4+). `src/push.ts` speaks the push
protocol itself with `node:crypto`; its tests check it against RFC 8291's worked example.

One server process holds all its tables in memory. Running more than one machine later needs rooms
pinned to a machine by code.

## Admin panel

The owner's back office lives at `/admin` on the same server. It is off until `ADMIN_PASSWORD` is set (12
characters or more); sign in with `ADMIN_USER` (default `admin`) and that password. Admin sessions last
8 hours, are separate from every player account, and changing the password signs them all out. Ten wrong
tries from one address lock it for 15 minutes, and every attempt is in the activity log.

It shows every account (search, sort, full record minus the password hash), the activity log, live tables,
and any game replayed move by move. It is read-only.

The activity log (`src/accounts/activity.ts`) records every API call and table message a player makes
(request bodies with password, token and credential fields removed), every finished game, chat lines, and
the screens and taps the web app reports to `POST /api/track`. It is written to
`DATA_DIR/activity/YYYY-MM.jsonl`; games against bots are saved to `DATA_DIR/games/solo/` so they can be
replayed like online games. The app links its privacy policy (`apps/web/public/privacy.html`) from sign-up.

Admin routes (all `GET` with `Authorization: Bearer <admin token>` except login):
`POST /api/admin/login {user, password}`, `/api/admin/overview`, `/api/admin/accounts?q=&sort=&show=&offset=`,
`/api/admin/accounts/:id`, `/api/admin/activity?user=&kinds=&text=&from=&to=&before=&limit=`,
`/api/admin/games/:id`, `/api/admin/live`, `/api/admin/feedback` (answers to "What lost you?").

Players answer "What lost you?" once, after their first game, with `POST /api/feedback {reason, comment?, when, round?, coached?}`
(reason: `roles`, `buttons`, `lost`, `notForMe`, `liked` or `skip`). A later call with only `comment` adds a comment to that
answer for 30 minutes; `GET /api/me` says `asked: true` from then on.

## Load test

`npm run build -w packages/server && npm run load -w packages/server -- --tables 100 --players 6 --think 300`
starts the bundled server in its own process and plays that many tables at once over real sockets, every
seat a client that answers after about `think` ms. Results on the dev container (one process, 600 sockets,
all six seats people, so every decision goes over the network):

| | |
|---|---|
| Errors | 0 |
| Server reply to an answer | median 8 ms, 95th percentile under 0.8 s at peak load |
| Server CPU per 6-player game | about 1.3 CPU-seconds (~550 decisions) |
| Memory | about 6.5 MB per busy 6-player table (sockets included): ~650 MB at 100 tables |

That run plays at bot speed, which is far busier than people.

### Capacity: how many people one server holds

`npm run load -w packages/server -- --tables 500 --players 6 --think 4000 --seconds 30 --core 0` deals every
table, then measures 30 s of play at people speed (about 4 s per decision), with the server pinned to one CPU
core. Heist is turn-based, so a table has one decision in flight at a time. Results on the dev container,
all six seats people:

| Players at once | Reply p50 / p99 | Server CPU (one core) | Server memory |
|---|---|---|---|
| 1,200 | 2 / 19 ms | 8% | 255 MB |
| 3,000 | 2 / 70 ms | 22% | 511 MB |
| 6,000 | 2.5 / 112 ms | 40% | 985 MB |
| 3,000, compression off (`COMPRESSION=0`) | 0.6 / 8 ms | 8% | 184 MB |

Memory is the limit: about 0.16 MB per connected player with compression on, most of it each socket's
compressor. A 512 MB instance (Render Starter) holds roughly 2,500 players at once. Compression off
triples that and cuts CPU by more than half, but each player then downloads about 5 MB per game instead
of a fraction of that, which matters on phone data.
