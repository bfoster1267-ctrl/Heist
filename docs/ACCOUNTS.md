# Accounts and progression

Players can play straight away as a guest. Their level, coins, items and career stats build up from the
first game. Creating an account (email, Apple, Google or Facebook) keeps all of it and makes it follow
them to any device. Play money only: chips and coins can't be bought or cashed out.

## What a player gets

- **Career stats**: games, wins, losses, win and loss rate, winnings, buy-ins lost, net, biggest pot,
  current and best streak, results by table size, vs bots and online, results by Role, and the last 20
  games.
- **Trackers**: footholds taken, jobs run as Boss, jobs pulled off, jobs fought off, double-crosses, loot
  collected, busts won, bets won, drinks sent and received.
- **XP and levels**: 50 levels with a rank name every five levels (Rookie, Runner, Wheelman, Cracksman,
  Con Artist, Enforcer, Lieutenant, Underboss, Kingpin, Godfather, Legend). A game pays 50 XP, +100 for a
  win, more for bigger tables, footholds and jobs, +25 online, and +100 for the first win of the day.
  Leaving early pays nothing and counts as a loss.
- **Prestige**: at level 50, start again at level 1 with a star (up to 10), a coin payout and
  prestige-only cosmetics. Stats and items stay.
- **Coins**: from playing, winning and every level-up. They buy table felts, card backs, avatar frames
  and titles; some unlock only by level or prestige. Drinks at the table cost coins (coffee is free).
- **Daily chips** and a free top-up when a player runs low.

All of these rules live in `packages/profile` and are shared by the server and the web app.

## How it fits together

- **The server** (`packages/server/src/accounts`) stores accounts in `DATA_DIR/accounts.json`, serves the
  JSON API below, and signs game sockets in with the same session token. Online games settle chips, XP and
  stats when they end. Vs-bot games get their seed from the server and are replayed from the player's
  answers before they pay out, so a doctored result doesn't count.
- **The web app** uses the server when it's built with `VITE_SERVER_URL=https://your-server`. Without one
  (or if it can't be reached), progress is kept in that browser with the same rules, which is how the
  shared preview link works today.

## Going live (email sign-up)

The Docker image runs the game server and serves the web app from the same address, so one link does
everything: the game, email accounts, career stats and online tables.

1. Make an account at <https://render.com> and connect GitHub.
2. **New > Blueprint**, pick this repo. Render reads `render.yaml` (Starter plan with a 1 GB disk, so
   accounts survive restarts).
3. When it's live, open `https://<name>.onrender.com` on the phone and use Share > Add to Home Screen.

Players can then create an account with an email and password. There's no password-reset email yet.

## Turning on each sign-in method

Email sign-in works with no setup. Each of the others appears in the app as soon as its settings are on
the server. These are the accounts to create, and what to paste where.

### Google (free)

1. Go to <https://console.cloud.google.com>, create a project (e.g. "Heist").
2. **APIs & Services > OAuth consent screen**: choose External, fill in the app name, support email and
   logo, and publish it.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**, type **Web application**.
   Under *Authorized JavaScript origins* add the web app's address (e.g. `https://heist.example.com`).
4. Copy the **Client ID** and set `GOOGLE_CLIENT_IDS` on the server.

### Apple (needs the Apple Developer Program, $99/year, the same account the iPhone app needs)

1. At <https://developer.apple.com/account>, **Certificates, IDs & Profiles > Identifiers > +**, make an
   **App ID** (e.g. `com.yourname.heist`) with **Sign in with Apple** ticked.
2. Make a **Services ID** (e.g. `com.yourname.heist.web`), tick **Sign in with Apple**, click
   *Configure*, pick the App ID from step 1, add the web app's domain and the return URL
   `https://heist.example.com/`.
3. Set `APPLE_CLIENT_IDS` on the server to the Services ID and the App ID, comma-separated:
   `com.yourname.heist.web,com.yourname.heist`. No private key is needed: the server only checks the
   signed token Apple hands the app.

Apple requires Sign in with Apple in the iPhone app whenever Google or Facebook sign-in are offered, and
requires that players can delete their account from inside the app. Both are built in (Profile > Account
> Delete account).

### Facebook (free)

1. At <https://developers.facebook.com/apps>, **Create app**, use case *Authenticate and request data
   from users with Facebook Login*.
2. Add **Facebook Login** for the web and enter the web app's address.
3. **App settings > Basic**: add a privacy policy URL and a user data deletion URL (both required before
   the app can go Live), then copy the **App ID** and **App Secret**.
4. Set `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` on the server, and switch the app to **Live**.

The app only asks for the public profile and email, which don't need Facebook's app review.

### Server settings

| Variable | What it does |
|---|---|
| `TOKEN_SECRET` | Signs session tokens. Set a long random value or everyone is signed out on each restart. |
| `GOOGLE_CLIENT_IDS` | Turns on Sign in with Google. |
| `APPLE_CLIENT_IDS` | Turns on Sign in with Apple. |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Turn on Continue with Facebook. |
| `DEV_LOGINS=1` | Sign in with only a name, for testing. Never in production. |
| `ALLOWED_ORIGINS` | The web app's address; also limits which sites can call the API. |

## API

JSON over HTTPS on the game server. Send the session token as `Authorization: Bearer <token>`.

| Route | What it does |
|---|---|
| `GET /api/config` | Which sign-in methods are on, and the public client ids the app needs. |
| `POST /api/auth/guest` | `{token?, name?}`: the account behind a saved token, or a new guest. |
| `POST /api/auth/register` | `{email, password, name}`: create an account (a guest token keeps its progress). |
| `POST /api/auth/login` | `{email, password}` |
| `POST /api/auth/oauth` | `{provider: "apple" \| "google" \| "facebook", credential, name?}` |
| `POST /api/auth/dev` | `{name}` (test servers only) |
| `POST /api/auth/signout-everywhere` | Invalidate every session for the account. |
| `GET /api/me` | The player's account, progress and public profile. |
| `POST /api/me/name` | `{name}` |
| `POST /api/me/delete` | Delete the account for good. |
| `POST /api/prestige` | Prestige at level 50. |
| `POST /api/shop/buy`, `POST /api/shop/equip` | `{id}` of a cosmetic. |
| `POST /api/chips/refill`, `POST /api/chips/daily` | Top up when low; daily free chips. |
| `POST /api/solo/start` | `{players, stakes}`: pay the buy-in, get `{gameId, seed}`. |
| `POST /api/solo/finish` | `{gameId, answers}`: replayed and paid out; returns the reward. |
| `POST /api/solo/quit` | Leave a vs-bots game (counts as a loss). |
| `POST /api/solo/drink` | `{id, count}`: pay for a drink at a vs-bots table. |
| `GET /api/leaderboard?by=winnings\|level\|wins` | Top 100 signed-in players. |
| `GET /api/players/:id` | A player's public profile. |

On the game socket, `{t: "drink", id, to}` buys a drink for a seat (or a round with `to: null`) and
everyone receives `{t: "drink", from, to, id, name}`. After an online game each signed-in player gets
`{t: "reward", reward, progress}`, and seats carry a `badge` (level, prestige, frame, title).
