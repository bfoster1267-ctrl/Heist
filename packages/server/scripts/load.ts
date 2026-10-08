// Load test: starts the bundled server in its own process, then plays many tables at once over real
// sockets, every seat a client that answers like a fast person. Reports how quickly the server answers,
// and its memory and CPU.
//
//   npm run build -w packages/server && npm run load -w packages/server -- --tables 100 --players 6 --think 150

import type { GameState } from "@heist/engine";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HeistClient } from "../src/client";
import { simpleAnswer as answerFor } from "../test/helpers";

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const TABLES = arg("tables", 50);
const PLAYERS = arg("players", 6);
const THINK = arg("think", 150); // ms a client waits before answering
const PORT = arg("port", 8790);


const here = dirname(fileURLToPath(import.meta.url));
const data = mkdtempSync(join(tmpdir(), "heist-load-"));
const server = spawn(process.execPath, [...(process.env.PROF ? ["--cpu-prof", `--cpu-prof-dir=${process.env.PROF}`] : []), join(here, "../dist/main.js")], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: data, TOKEN_SECRET: "load" },
  stdio: ["ignore", "ignore", "inherit"],
});
const url = `ws://127.0.0.1:${PORT}/ws`;
const health = async () => (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json() as Promise<{ rssMb: number; cpuMs: number; sockets: number }>;
for (let i = 0; ; i++) {
  try {
    await health();
    break;
  } catch {
    if (i > 50) throw new Error("server didn't start");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const lat: number[] = [];
let bytes = 0;
let rateLimited = 0;
let errors = 0;

async function table(): Promise<number> {
  const clients = Array.from({ length: PLAYERS }, (_, k) => new HeistClient(url, { name: `P${k}`, reconnect: false }));
  await Promise.all(clients.map((c) => c.connect()));
  const done = clients.map((c) => {
    let view: GameState | null = null;
    let sentAt = 0;
    c.onAny((m) => {
      bytes += JSON.stringify(m).length;
      if (sentAt && (m.t === "frames" || m.t === "error")) {
        lat.push(performance.now() - sentAt);
        sentAt = 0;
      }
      if (m.t === "error") m.code === "rate_limited" ? rateLimited++ : errors++;
      if (m.t === "sync") view = m.state;
      if (m.t === "frames" && m.frames.length) view = m.frames[m.frames.length - 1].state;
      if (m.t === "ask") {
        setTimeout(() => {
          if (c.ask?.askId !== m.askId || !view) return;
          sentAt = performance.now();
          c.answer(answerFor(m.ask, view));
        }, THINK * (0.5 + Math.random()));
      }
    });
    return new Promise<void>((r) => c.on("gameOver", () => r()));
  });
  clients[0].create({ players: PLAYERS, isPrivate: true });
  await new Promise<void>((r) => clients[0].on("room", () => r()));
  const code = clients[0].room!.code;
  for (const c of clients.slice(1)) c.join(code);
  while ((clients[0].room?.seats.filter((s) => s.kind === "human").length ?? 0) < PLAYERS) await new Promise((r) => setTimeout(r, 20));
  const t0 = performance.now();
  clients[0].start();
  await Promise.all(done);
  for (const c of clients) c.close();
  return performance.now() - t0;
}

const before = await health();
const t0 = performance.now();
let peak = 0;
const sampler = setInterval(async () => (peak = Math.max(peak, (await health()).rssMb)), 500);
const times = await Promise.all(Array.from({ length: TABLES }, () => table()));
clearInterval(sampler);
const wall = performance.now() - t0;
const after = await health();
server.kill("SIGINT");
await new Promise((r) => server.on("exit", r));
rmSync(data, { recursive: true, force: true });

lat.sort((a, b) => a - b);
const pct = (p: number) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] * 10) / 10;
console.log(
  JSON.stringify(
    {
      tables: TABLES,
      players: PLAYERS,
      sockets: TABLES * PLAYERS,
      thinkMs: THINK,
      answers: lat.length,
      answerToReplyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: pct(1) },
      gameSeconds: Math.round(times.reduce((a, b) => a + b, 0) / times.length / 100) / 10,
      serverCpuSecondsPerGame: Math.round((after.cpuMs - before.cpuMs) / TABLES) / 1000,
      serverCpuShare: Math.round(((after.cpuMs - before.cpuMs) / wall) * 100) + "%",
      serverPeakRssMb: Math.max(peak, after.rssMb),
      mbSentPerPlayerUncompressed: Math.round(bytes / (TABLES * PLAYERS) / 2 ** 20 * 100) / 100,
      rateLimited,
      errors,
    },
    null,
    2,
  ),
);
