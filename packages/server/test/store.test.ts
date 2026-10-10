import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileStore } from "../src/store";

it("keeps a game log on disk, survives a torn last line, and files finished games away", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heist-store-"));
  try {
    const s = new FileStore(dir);
    const start = { gameId: "g1", roomId: "r", code: "ABCDE", game: 1, seed: 9, seats: [], stakes: 0, isPrivate: false, hostId: null, turnSeconds: 30, at: 1 };
    s.started(start);
    s.answered("g1", { seat: 0, a: { kind: "hire", count: 1 }, by: "player" });
    s.started({ ...start, gameId: "g2" });
    s.ended("g2", { winners: [0], reason: "footholds", at: 2 });
    await s.flush();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(dir, "games", "done", "g2.jsonl"))).toBe(true);
    const open = await new FileStore(dir).unfinished();
    expect(open.map((g) => g.start.gameId)).toEqual(["g1"]);
    expect(open[0].answers).toEqual([{ seat: 0, a: { kind: "hire", count: 1 }, by: "player" }]);
    const torn = FileStore.parse(`{"t":"start","gameId":"g3"}\n{"t":"a","seat":1,"a":{"kind":"hire","count":0},"by":"bot"}\n{"t":"a","se`);
    expect(torn?.answers.length).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
