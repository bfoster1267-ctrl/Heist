// Klondike solitaire (draw one). Tap a card to send it where it fits, or drag it. Undo, and the game
// finishes itself once every card is face up. A win is replayed on the server and pays XP and
// season XP, so Solitaire players are already moving up the Heist season pass.

import {
  applySol, autoMove, cardRank, cardRed, cardSuit, dealKlondike, solSolved, solWon, tapMove,
  type Klondike, type PlayingCard, type SolMove,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import "./solitaire.css";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

type Pile = "w" | `f${number}` | `t${number}`;
interface Drag {
  from: Pile;
  depth: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  moved: boolean;
}

/** Card size and the gaps, from the space the board has. */
function useBoard() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const width = Math.min(size.w, 760);
  const gap = Math.max(4, Math.round(width * 0.012));
  const cw = Math.floor((width - gap * 8) / 7);
  const ch = Math.round(cw * 1.4);
  return { width, height: size.h, gap, cw, ch, left: Math.round((size.w - width) / 2) + gap };
}

export function Solitaire({ onExit, onHeist }: { onExit: () => void; onHeist: () => void }) {
  const { backend, act, showReward } = useAccount();
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [hist, setHist] = useState<Klondike[]>([]);
  const [moves, setMoves] = useState<SolMove[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const b = useBoard();
  const k = hist[hist.length - 1];

  const deal = useCallback(async () => {
    const g = backend ? await backend.solitaireStart().catch(() => null) : null;
    // offline (or no server): still playable, it just can't pay XP
    const next = g ?? { gameId: null, seed: Math.floor(Math.random() * 2 ** 31) };
    setGame(next);
    setHist([dealKlondike(next.seed)]);
    setMoves([]);
    setDone(false);
    setStarted(Date.now());
    cardSound(3);
  }, [backend]);
  useEffect(() => {
    void deal();
  }, [deal]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const play = useCallback(
    (m: SolMove) => {
      const n = k && applySol(k, m);
      if (!n) return false;
      setHist((h) => [...h, n]);
      setMoves((ms) => [...ms, m]);
      if (m === "d") cardSound(1);
      else if (m.endsWith(">f")) click();
      else cardSound(1);
      return true;
    },
    [k],
  );

  // every card face up and the stock gone: play the rest to the foundations
  useEffect(() => {
    if (!k || done || solWon(k) || !solSolved(k)) return;
    const m = autoMove(k);
    if (!m) return;
    const t = window.setTimeout(() => play(m), reducedMotion() ? 20 : 90);
    return () => clearTimeout(t);
  }, [k, done, play]);

  // a win: the server replays it and pays
  useEffect(() => {
    if (!k || done || !solWon(k)) return;
    setDone(true);
    winSound();
    buzz("win");
    const id = game?.gameId;
    if (id) void act((x) => x.solitaireFinish(id, moves)).then((r) => r && showReward(r.reward));
  }, [k, done, game, moves, act, showReward]);

  const undo = () => {
    if (hist.length < 2 || done) return;
    setHist((h) => h.slice(0, -1));
    setMoves((ms) => ms.slice(0, -1));
    click();
  };

  const nope = (key: string) => {
    setShake(key);
    buzz("tap");
    window.setTimeout(() => setShake(null), 300);
  };

  // where everything sits
  const rowY = b.gap * 2 + 44;
  const colX = (i: number) => b.left + i * (b.cw + b.gap);
  const tabY = rowY + b.ch + b.gap * 3;
  const room = b.height - tabY - b.gap * 2;
  const offsets = useMemo(() => {
    if (!k) return [];
    return k.cols.map((c) => {
      const down = Math.round(b.ch * 0.12);
      let up = Math.round(b.ch * 0.26);
      const need = c.down.length * down + Math.max(0, c.up.length - 1) * up + b.ch;
      if (need > room && c.up.length > 1) up = Math.max(Math.round(b.ch * 0.14), Math.floor((room - b.ch - c.down.length * down) / (c.up.length - 1)));
      return { down, up };
    });
  }, [k, b.ch, room]);

  if (!k) return <div className="sol" />;

  type Placed = { c: PlayingCard; x: number; y: number; z: number; up: boolean; pile: Pile | "s"; depth: number };
  const placed: Placed[] = [];
  k.stock.forEach((c, i) => placed.push({ c, x: colX(0), y: rowY, z: i, up: false, pile: "s", depth: 0 }));
  k.waste.forEach((c, i) => {
    const fan = Math.max(0, i - (k.waste.length - 3));
    placed.push({ c, x: colX(1) + fan * Math.round(b.cw * 0.18), y: rowY, z: i, up: true, pile: "w", depth: k.waste.length - i });
  });
  k.found.forEach((f, s) => f.forEach((c, i) => placed.push({ c, x: colX(3 + s), y: rowY, z: i, up: true, pile: `f${s}`, depth: f.length - i })));
  k.cols.forEach((col, i) => {
    let y = tabY;
    col.down.forEach((c, j) => {
      placed.push({ c, x: colX(i), y, z: j, up: false, pile: `t${i}`, depth: 0 });
      y += offsets[i].down;
    });
    col.up.forEach((c, j) => {
      placed.push({ c, x: colX(i), y, z: col.down.length + j, up: true, pile: `t${i}`, depth: col.up.length - j });
      y += offsets[i].up;
    });
  });

  const dragging = (p: Placed) => !!drag && drag.moved && p.pile === drag.from && p.depth <= drag.depth && p.depth > 0;

  const down = (p: Placed, e: React.PointerEvent) => {
    if (done) return;
    if (p.pile === "s") return;
    if (!p.up || p.depth < 1) return;
    // only the top card of the waste and the foundations moves
    if ((p.pile === "w" || p.pile[0] === "f") && p.depth !== 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ from: p.pile as Pile, depth: p.depth, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 6 });
  };
  const up = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    const many = d.depth > 1 ? `:${d.depth}` : "";
    if (!d.moved) {
      const m = tapMove(k, d.from, d.depth);
      if (!m || !play(m)) nope(`${d.from}:${d.depth}`);
      return;
    }
    // dropped: the pile under the finger
    const i = Math.max(0, Math.min(6, Math.floor((e.clientX - b.left + b.gap / 2) / (b.cw + b.gap))));
    const to = e.clientY < rowY + b.ch + b.gap && i >= 3 ? "f" : e.clientY >= rowY + b.ch ? `t${i}` : null;
    if (!to || `${d.from}` === to || (to === "f" && many)) return;
    if (!play(`${d.from}>${to}${to === "f" ? "" : many}`)) buzz("tap");
  };

  const secs = Math.floor((now - started) / 1000);
  const won = solWon(k);
  return (
    <div className="sol" onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <div className="sol-bar">
        <button className="btn ghost sol-btn" onClick={onExit}>
          ← Lobby
        </button>
        <span className="sol-stat">
          {moves.length} moves · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
        <button className="btn ghost sol-btn" onClick={undo} disabled={hist.length < 2 || done}>
          Undo
        </button>
        <button className="btn ghost sol-btn" onClick={() => void deal()}>
          New deal
        </button>
      </div>

      {/* empty spots */}
      <button className="sol-slot sol-stock" style={{ left: colX(0), top: rowY, width: b.cw, height: b.ch }} onClick={() => !done && (play("d") || nope("s"))} aria-label={k.stock.length ? "Draw a card" : "Turn the waste over"}>
        {!k.stock.length && "↻"}
      </button>
      {[0, 1, 2, 3].map((s) => (
        <div key={s} className="sol-slot" style={{ left: colX(3 + s), top: rowY, width: b.cw, height: b.ch }}>
          <span className={"sol-slot-suit" + (s === 1 || s === 2 ? " red" : "")}>{SUITS[s]}</span>
        </div>
      ))}
      {k.cols.map((_, i) => (
        <div key={i} className="sol-slot" style={{ left: colX(i), top: tabY, width: b.cw, height: b.ch }} />
      ))}

      {placed.map((p) => {
        const lift = dragging(p);
        const key = `${p.pile}:${p.depth}`;
        return (
          <motion.div
            key={p.c}
            className={"sol-card" + (p.up ? (cardRed(p.c) ? " red" : "") : " back") + (lift ? " lifted" : "")}
            style={{ width: b.cw, height: b.ch, zIndex: lift ? 500 + p.z : p.pile[0] === "t" ? 10 + p.z : 5 + p.z, fontSize: Math.round(b.cw * 0.3) }}
            initial={false}
            animate={{ x: p.x + (lift ? drag!.dx : 0), y: p.y + (lift ? drag!.dy : 0), rotate: shake && key === shake ? [0, -4, 4, 0] : 0 }}
            transition={lift ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
            onPointerDown={(e) => (p.pile === "s" ? !done && (play("d") || nope("s")) : down(p, e))}
          >
            {p.up && (
              <>
                <span className="sol-corner">
                  {RANKS[cardRank(p.c)]}
                  <span>{SUITS[cardSuit(p.c)]}</span>
                </span>
                <span className="sol-pip">{SUITS[cardSuit(p.c)]}</span>
              </>
            )}
          </motion.div>
        );
      })}

      <AnimatePresence>
        {won && (
          <motion.div className="sol-win" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="sol-win-card" initial={{ scale: 0.7, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.4 }}>
              <div className="sol-win-title">SOLVED</div>
              <div className="dim">
                {moves.length} moves in {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
              </div>
              <button className="btn primary big" onClick={() => void deal()} autoFocus>
                Deal again
              </button>
              <button className="btn big sol-heist" onClick={onHeist}>
                Try a hand of Heist
                <span className="lobby-sub">The betrayal card game this site is built around</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
