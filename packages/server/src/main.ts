// Entry point: `npm run dev -w packages/server` locally, `node dist/main.js` in the container.
//   PORT            port to listen on (default 8787)
//   DATA_DIR        where game logs go (default ./data); unfinished games are rebuilt from here on start
//   TOKEN_SECRET    signs guest tokens; set it in production so players keep their seats across restarts
//   ALLOWED_ORIGINS comma-separated browser origins allowed to connect (default: any)
//   COMPRESSION     set to 0 to turn off WebSocket compression
//   TURN_GRACE_MS   how long a dropped player's decision waits before a bot answers (default 20000)

import { GuestIdentity } from "./identity";
import { startServer } from "./server";
import { FileStore } from "./store";

const env = process.env;
const log = (msg: string, extra?: object) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
if (!env.TOKEN_SECRET) log("TOKEN_SECRET not set: guest tokens won't survive a restart");

const server = await startServer({
  port: Number(env.PORT ?? 8787),
  store: new FileStore(env.DATA_DIR ?? "./data"),
  identity: new GuestIdentity(env.TOKEN_SECRET),
  allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : [],
  compression: env.COMPRESSION !== "0",
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
