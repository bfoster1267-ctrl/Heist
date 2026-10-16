// The address a request came from. Fly's edge sets fly-client-ip, but any client can send that header
// itself, so it's trusted only when the server actually runs on Fly.
import type { IncomingMessage } from "node:http";

const ON_FLY = !!process.env.FLY_APP_NAME;

export function clientIp(req: IncomingMessage): string {
  const fly = ON_FLY ? req.headers["fly-client-ip"] : undefined;
  return String(fly ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
}
