// Entry point: `npm run dev -w packages/server` locally, `node dist/main.js` in the container.
//   PORT            port to listen on (default 8787)
//   DATA_DIR        where game logs go (default ./data); unfinished games are rebuilt from here on start
//   TOKEN_SECRET    signs guest tokens; set it in production so players keep their seats across restarts
//   ALLOWED_ORIGINS comma-separated browser origins allowed to connect (default: any)
//   TURN_GRACE_MS   how long a dropped player's decision waits before a bot answers (default 20000)
//   GOOGLE_CLIENT_IDS    Google OAuth client id(s), comma-separated: turns on Sign in with Google
//   APPLE_CLIENT_IDS     Apple Services ID (web) and app bundle id, comma-separated: turns on Sign in with Apple
//   FACEBOOK_APP_ID, FACEBOOK_APP_SECRET   turn on Continue with Facebook
//   DEV_LOGINS=1    sign in by name with no password (local testing only)

import { AccountService } from "./accounts/service";
import { FileAccountStore } from "./accounts/store";
import { startServer } from "./server";
import { FileStore } from "./store";

const env = process.env;
const log = (msg: string, extra?: object) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
if (!env.TOKEN_SECRET) log("TOKEN_SECRET not set: sign-ins won't survive a restart");
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const dataDir = env.DATA_DIR ?? "./data";

const accounts = new AccountService({
  store: new FileAccountStore(dataDir),
  secret: env.TOKEN_SECRET,
  devLogins: env.DEV_LOGINS === "1",
  oauth: {
    google: { clientIds: list(env.GOOGLE_CLIENT_IDS) },
    apple: { clientIds: list(env.APPLE_CLIENT_IDS) },
    facebook: env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET ? { appId: env.FACEBOOK_APP_ID, appSecret: env.FACEBOOK_APP_SECRET } : undefined,
  },
});
log("sign-in providers", { providers: [...accounts.oauth.providers(), "email", ...(accounts.devLogins ? ["dev"] : [])] });

const server = await startServer({
  port: Number(env.PORT ?? 8787),
  store: new FileStore(dataDir),
  accounts,
  allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : [],
  graceMs: env.TURN_GRACE_MS ? Number(env.TURN_GRACE_MS) : undefined,
  log,
  onGameOver: (r) => log("game over", { game: r.gameId, winners: r.winners, reason: r.reason }),
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log("shutting down");
    await server.close();
    process.exit(0);
  });
}
