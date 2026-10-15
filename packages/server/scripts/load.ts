// Load test: starts the bundled server in its own process, then plays many tables at once over real
// sockets, every seat a client that answers like a fast person. Reports how quickly the server answers,
// and its memory and CPU.
//
//   npm run build -w packages/server && npm run load -w packages/server -- --tables 100 --players 6 --think 150
//
// Capacity (how many people one server holds): people-speed thinking, measured over a fixed window once
// every table is playing, with the server pinned to one CPU core (Linux, taskset):
//
//   npm run load -w packages/server -- --tables 400 --players 6 --think 4000 --seconds 60 --core 0

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
/** measure for this many seconds once every table is dealt, then stop (0: play every game to the end) */
const SECONDS = arg("seconds", 0);
/** pin the server to this CPU core (-1: no pinning) */
const CORE = arg("core", -1);


const here = dirname(fileURLToPath(import.meta.url));
const data = mkdtempSync(join(tmpdir(), "heist-load-"));
const nodeArgs = [...(process.env.PROF ? ["--cpu-prof", `--cpu-prof-dir=${process.env.PROF}`] : []), join(here, "../dist/main.js")];
const [cmd, cmdArgs] = CORE >= 0 ? ["taskset", ["-c", String(CORE), process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];
const server = spawn(cmd, cmdArgs, {
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
/** only answers inside the measuring window count, when there is one */
let measuring = SECONDS === 0;
let dealt = 0;
const allClients: HeistClient[] = [];

async function table(): Promise<number> {
  const clients = Array.from({ length: PLAYERS }, (_, k) => new HeistClient(url, { name: `P${k}`, reconnect: false }));
  allClients.push(...clients);
  await Promise.all(clients.map((c) => c.connect()));
  const done = clients.map((c) => {
    let view: GameState | null = null;
    let sentAt = 0;
    c.onAny((m) => {
      bytes += JSON.stringify(m).length;
      if (sentAt && (m.t === "frames" || m.t === "error")) {
        if (measuring) lat.push(performance.now() - sentAt);
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
  dealt++;
  if (SECONDS) return 0;
  await Promise.all(done);
  for (const c of clients) c.close();
  return performance.now() - t0;
}

let before = await health();
let t0 = performance.now();
let peak = 0;
const sampler = setInterval(async () => (peak = Math.max(peak, (await health()).rssMb)), 500);
let times: number[];
if (SECONDS) {
  // open tables in batches, like people arriving, then measure a steady window
  for (let i = 0; i < TABLES; i += 25) await Promise.all(Array.from({ length: Math.min(25, TABLES - i) }, () => table()));
  await new Promise((r) => setTimeout(r, 5000));
  before = await health();
  t0 = performance.now();
  measuring = true;
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  measuring = false;
  times = [];
} else times = await Promise.all(Array.from({ length: TABLES }, () => table()));
clearInterval(sampler);
const wall = performance.now() - t0;
const after = await health();
for (const c of allClients) c.close();
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
      ...(SECONDS
        ? { windowSeconds: SECONDS, tablesDealt: dealt, answersPerSecond: Math.round(lat.length / SECONDS) }
        : { gameSeconds: Math.round(times.reduce((a, b) => a + b, 0) / times.length / 100) / 10, serverCpuSecondsPerGame: Math.round((after.cpuMs - before.cpuMs) / TABLES) / 1000 }),
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
