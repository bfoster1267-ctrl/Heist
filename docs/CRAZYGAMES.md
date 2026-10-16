# Heist on CrazyGames

How to submit Heist to [CrazyGames](https://www.crazygames.com) as an HTML5 game, and what the code
does differently there. The integration lives in `apps/web/src/crazygames.ts`.

## What you do yourself

1. **Make a developer account** at the CrazyGames developer portal (developer.crazygames.com) and
   accept their developer terms.
2. **Let the CrazyGames build talk to the game server.** If `ALLOWED_ORIGINS` is set on the server
   (fly secret / Render env), add `https://*.crazygames.com` to it, e.g.
   `fly secrets set ALLOWED_ORIGINS=https://playheist.net,https://*.crazygames.com`. If it isn't set,
   every origin is already allowed and there's nothing to do. Deploy the server from this branch first:
   it has the CrazyGames sign-in route (`/api/auth/crazygames`) and the wildcard origins.
3. **Build the upload** (needs `npm install` first):
   ```sh
   npm run build:crazygames -w apps/web
   cd apps/web/dist-crazygames && zip -r ../heist-crazygames.zip .
   ```
   `apps/web/.env.crazygames` points the build at `https://playheist.net` for accounts, tables and chat.
   The zip is about 1 MB plus the JS bundle, far under their limits (50 MB initial download, 20 MB for
   the mobile homepage, 250 MB / 1,500 files total).
4. **Test it in their preview / QA tool** before submitting: upload the zip as a new game, open the
   preview, and check (with the browser console open) that you see the SDK's loading and gameplay
   events, a sitting-down-at-a-table → gameplayStart, back to the lobby → gameplayStop, a win →
   happytime, and that their mute button silences the game. The browser's network tab must show calls
   to `playheist.net` succeeding (if they fail with a CORS / 403 error, see step 2).
5. **Submit** in the developer portal: upload the zip (game type: HTML5, "upload files", not an
   external URL), fill in the details, add the assets below, and send it for review. Start with a
   **Basic Launch** (SDK optional, no revenue); Full Launch comes after they review the numbers.

Locally you can try the CrazyGames mode without their portal: run the dev server and open
`http://localhost:5173/?cg=1` (their SDK runs in its "local" test mode there and logs the events).

## Assets they ask for

| What | Size | Notes |
| --- | --- | --- |
| Landscape cover | 1920 × 1080 (16:9) | required |
| Portrait cover | 800 × 1200 (2:3) | required |
| Square cover | 800 × 800 (1:1) | required |
| Preview video(s) | 1080p, landscape (and portrait) | ~15–20 s of real play, no sound, no text overlays; check the portal for current limits |
| Description, controls, tags | text | "Tap / click" controls; tags like card game, multiplayer, solitaire |

Cover rules: the game's title is the only text allowed (no "New", "Play", "Free"), no borders, no
logos or other brands, nothing blurry or copyrighted. `apps/web/public/og-image.png` is 1200 × 630
with text on it, so it can't be reused: make fresh covers from table screenshots.

## What the CrazyGames build does

The SDK (`https://sdk.crazygames.com/crazygames-sdk-v3.js`) only loads in the CrazyGames build, on a
`crazygames.com` host, or in a frame on one (or `?cg=1` in a frame / on localhost). Visiting
playheist.net never loads it.

- **SDK events**: `SDK.init()` before the app draws; `game.loadingStart()` then `loadingStop()` once
  the account has loaded; `gameplayStart()` / `gameplayStop()` around real play only (a Heist table vs
  bots or online, every solo game, Solitaire while queued), not the lobby or menus; `happytime()` on a
  win (at most once every 5 seconds).
- **Mute**: their mute setting (`game.settings.muteAudio`, and changes to it) silences effects and the
  table music without touching the player's own sound setting. An ad playing mutes too.
- **Chat**: their `disableChat` setting hides the Lounge (the free-text chat). Table quick-chat is
  preset lines and emotes only, so it stays.
- **Accounts**: no Heist sign-in is ever required (players start as guests, as on playheist.net). A
  player signed in to CrazyGames gets their CrazyGames account linked to their Heist guest account on
  the server (token checked against CrazyGames' published key), so their career follows them across
  devices. Heist's own sign-in stays available in the account screen, with a "Sign in with CrazyGames"
  button first. The "save your progress" nudges after games are off there.
- **Ads**: none by default (Heist sells nothing). `VITE_CG_MIDGAME_ADS=1` in `.env.crazygames` turns on
  one midgame ad between games, at most every 3 minutes, muted while it plays.
- **Nothing that leaves the game**: no Google Ads tag, no SEO text or links to playheist.net / the
  blog, no home-screen app (no service worker, manifest or install prompts), no notification prompts,
  no "open in your browser" screen. Invite and challenge links use CrazyGames invite links
  (`game.inviteLink`), and an invite's parameters are read back on arrival (`game.getInviteParam`).
  The address never leaves the game's own file (screens go in `?game=` instead of `/solitaire`).
- **Tracking**: new players there are marked with source `cg`. The admin panel shows a "From
  CrazyGames" stat on the dashboard, a source filter on Players (`/players?source=cg`) and a
  CrazyGames badge on their rows; the Bots page lists their referrer as "CrazyGames".

## Things to double-check against their current docs

Their docs site couldn't be reached while this was written, so a few names come from the v3 SDK as
known before: `game.settings` / `addSettingsChangeListener`, `game.inviteLink` / `getInviteParam`, the
`user` module (`getUser`, `getUserToken`, `showAuthPrompt`, `addAuthListener`) and the token's
`userId` / `username` fields and key URL (`https://sdk.crazygames.com/publicKey.json`). Every call is
guarded, so a renamed method just does nothing; the preview tool's console will show which events
arrive.

Content: Heist's chips are play money with no way to buy them, which fits their rule against real-money
gambling. Mention that in the description if a reviewer asks.
