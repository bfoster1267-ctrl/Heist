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
- **Action log.** Each game is stored as seed + seats + every answer (and who gave it: player, bot, or
  autopilot). That rebuilds any game exactly. When the server restarts, unfinished tables are rebuilt
  from the log and players reclaim their seats by reconnecting.
- **Limits.** 16 KB per message, a per-socket rate limit, 5 chat lines per 10 s, and every answer is
  reshaped and type-checked before it reaches the engine. Idle rooms close after 10 minutes.

The wire protocol is in `src/protocol.ts` and a ready-made client (auto-reconnect, resume) in
`src/client.ts`; both are browser-safe and exported as `@heist/server/protocol` and `@heist/server/client`.
Frames arrive in the same shape the solo table already plays back (`ev`, `msg`, `state`), plus an index `i`.

## Where later work plugs in

| Later work | Plug-in point |
|---|---|
| Accounts (Supabase) | Implement `IdentityProvider` (verify the Supabase session token, return the account id and name) and pass it to `startServer`. Guests keep working through `GuestIdentity`. |
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

One server process holds all its tables in memory. Running more than one machine later needs rooms
pinned to a machine by code.

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

Real players take seconds per decision, so one CPU keeps up with well over a thousand tables; memory is
the limit, roughly 140 busy 6-player tables per GB. `fly.toml` asks for 1 GB.
