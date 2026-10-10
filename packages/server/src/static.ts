// Serves the built web app (apps/web/dist) so players open the game at the server's own address: one link,
// and the app's API calls and socket stay on the same origin.

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".m4a": "audio/mp4",
};

export async function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    return false;
  }
  if (path.startsWith("/api/") || path === "/ws") return false;
  const root = normalize(dir);
  let file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return false;
  const isFile = await stat(file).then((s) => s.isFile(), () => false);
  // unknown paths without an extension get the app (it has one page); /admin gets the owner's back office
  if (!isFile) {
    if (extname(path)) return false;
    file = join(root, path === "/admin" ? "admin.html" : "index.html");
  }
  const body = await readFile(file).catch(() => null);
  if (!body) return false;
  const name = file.slice(root.length);
  // hashed build files never change; the page, manifest and service worker must always be fresh
  const immutable = name.startsWith(sep + "assets" + sep);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}
