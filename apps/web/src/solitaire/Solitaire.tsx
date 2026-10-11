// Klondike solitaire (draw one). Tap a card to send it where it fits, or drag it. Undo, a hint, and the
// game finishes itself once every card is face up. Every card sent to a foundation pays a little XP and
// season XP (banked every few cards, and when the player leaves), and a win pays a bonus; the server
// replays the moves before paying, so Solitaire players are already moving up the Heist season pass.

import {
  applySol, autoMove, cardRank, cardRed, cardSuit, dealKlondike, solFound, solSolved, solWon, tapMove, SOLITAIRE_CARD,
  type Klondike, type PlayingCard, type SolMove,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import { Confetti } from "../table/Table";
import "./solitaire.css";

const SUITS = ["♠", "♥", "♦", "♣"];
/** Bank the foundation cards with the server every this many new ones (and on leaving or a new deal). */
const BANK_EVERY = 3;

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
/** what a hint points at: a card (its pile and depth) or the stock */
type Hint = { pile: Pile | "s"; depth: number } | null;

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
  const ch = Math.round(cw * 1.42);
  return { width, height: size.h, gap, cw, ch, left: Math.round((size.w - width) / 2) + gap };
}

/** A useful move to suggest: to a foundation, one that turns a card over, the waste card, else draw. */
function findHint(k: Klondike): Hint {
  const auto = autoMove(k);
  if (auto) return auto.startsWith("w") ? { pile: "w", depth: 1 } : { pile: auto.slice(0, 2) as Pile, depth: 1 };
  for (let i = 0; i < 7; i++) {
    const col = k.cols[i];
    if (col.down.length && col.up.length && tapMove(k, `t${i}`, col.up.length)) return { pile: `t${i}`, depth: col.up.length };
  }
  if (tapMove(k, "w")) return { pile: "w", depth: 1 };
  return k.stock.length || k.waste.length ? { pile: "s", depth: 0 } : null;
}

export function Solitaire({ onExit, onHeist, banner }: {
  onExit: () => void;
  /** the win card's "Try a hand of Heist" (left out while waiting in the online queue) */
  onHeist?: () => void;
  /** a strip under the top bar (the online queue and its timer) */
  banner?: ReactNode;
}) {
  const { backend, act, showReward } = useAccount();
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [hist, setHist] = useState<Klondike[]>([]);
  const [moves, setMoves] = useState<SolMove[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const [hint, setHint] = useState<Hint>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const b = useBoard();
  // the board sits below the iPhone's notch area; drops are measured from its top
  const board = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const ready = hist.length > 0;
  useEffect(() => setTop(board.current?.getBoundingClientRect().top ?? 0), [b.height, b.width, ready]);
  const k = hist[hist.length - 1];
  const reduce = reducedMotion();

  // XP for cards on the foundations, banked a few at a time; a game cut short (the online table was
  // dealt, or the player left) still pays for what got up there
  const banked = useRef(0);
  const [earned, setEarned] = useState(0);
  const [capped, setCapped] = useState(false);
  const live = useRef({ game, moves, k, done });
  live.current = { game, moves, k, done };
  const bank = useCallback(async (leaving = false) => {
    const { game: g, moves: ms, k: now, done: over } = live.current;
    // once it plays itself out, the win pays the rest (unless the player leaves first)
    if (!g?.gameId || !now || over || solWon(now) || (solSolved(now) && !leaving)) return;
    const up = solFound(now);
    if (up <= banked.current) return;
    const sent = up - banked.current;
    banked.current = up;
    const r = await act((x) => x.solitaireCards(g.gameId!, ms));
    if (!r) return;
    const xp = r.reward?.xp ?? 0;
    if (live.current.game === g) setEarned((e) => e + xp);
    if (xp < sent * SOLITAIRE_CARD.xp) setCapped(true);
    // a level reached on the way up gets the full reward card
    if (r.reward && r.reward.levelAfter > r.reward.levelBefore) showReward(r.reward);
  }, [act, showReward]);
  const found = k ? solFound(k) : 0;
  useEffect(() => {
    if (found - banked.current >= BANK_EVERY) void bank();
  }, [found, bank]);
  // leaving (the lobby, or the online table taking over) banks what's left
  useEffect(() => () => void bank(true), [bank]);

  const deal = useCallback(async () => {
    await bank(true);
    banked.current = 0;
    setEarned(0);
    const g = backend ? await backend.solitaireStart().catch(() => null) : null;
    // offline (or no server): still playable, it just can't pay XP
    const next = g ?? { gameId: null, seed: Math.floor(Math.random() * 2 ** 31) };
    setGame(next);
    setHist([dealKlondike(next.seed)]);
    setMoves([]);
    setDone(false);
    setHint(null);
    setArmed(false);
    setStarted(Date.now());
    cardSound(4);
  }, [backend, bank]);
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
      setHint(null);
      if (m.endsWith(">f")) {
        click();
        buzz("bump");
      } else {
        cardSound(1);
        buzz("tap");
      }
      return true;
    },
    [k],
  );

  // every card face up and the stock gone: play the rest to the foundations
  useEffect(() => {
    if (!k || done || solWon(k) || !solSolved(k)) return;
    const m = autoMove(k);
    if (!m) return;
    const t = window.setTimeout(() => play(m), reduce ? 20 : 110);
    return () => clearTimeout(t);
  }, [k, done, play, reduce]);

  // a win: the server replays it and pays
  useEffect(() => {
    if (!k || done || !solWon(k)) return;
    setDone(true);
    winSound();
    buzz("win");
    const id = game?.gameId;
    if (id) void act((x) => x.solitaireFinish(id, moves)).then((r) => r && showReward(r.reward));
  }, [k, done, game, moves, act, showReward]);

  // cards that just turned face up flip over; cards that just reached a foundation flash gold
  const prev = useRef<{ up: Set<number>; found: Set<number> }>({ up: new Set(), found: new Set() });
  const upNow = useMemo(() => new Set(k ? [...k.waste, ...k.found.flat(), ...k.cols.flatMap((c) => c.up)] : []), [k]);
  const foundNow = useMemo(() => new Set(k ? k.found.flat() : []), [k]);
  const [fresh, setFresh] = useState<{ flipped: Set<number>; landed: Set<number> }>({ flipped: new Set(), landed: new Set() });
  useEffect(() => {
    const p = prev.current;
    prev.current = { up: upNow, found: foundNow };
    if (!p.up.size) return;
    setFresh({ flipped: new Set([...upNow].filter((c) => !p.up.has(c))), landed: new Set([...foundNow].filter((c) => !p.found.has(c))) });
    const t = window.setTimeout(() => setFresh({ flipped: new Set(), landed: new Set() }), 450);
    return () => clearTimeout(t);
  }, [upNow, foundNow]);

  const undo = () => {
    if (hist.length < 2 || done) return;
    setHist((h) => h.slice(0, -1));
    setMoves((ms) => ms.slice(0, -1));
    setHint(null);
    click();
  };
  const showHint = () => {
    if (!k || done) return;
    const h = findHint(k);
    if (!h) return nope("s");
    setHint(h);
    click();
    window.setTimeout(() => setHint((x) => (x === h ? null : x)), 1800);
  };
  const newDeal = () => {
    // mid-game, the first tap asks to be sure
    if (moves.length && !done && !armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 2500);
      return;
    }
    void deal();
  };

  const nope = (key: string) => {
    setShake(key);
    buzz("tap");
    window.setTimeout(() => setShake(null), 320);
  };

  // where everything sits
  const stripH = banner ? 36 : 0;
  const barH = 52 + stripH;
  const rowY = b.gap * 2 + barH;
  const colX = (i: number) => b.left + i * (b.cw + b.gap);
  const tabY = rowY + b.ch + b.gap * 3;
  const room = b.height - top - tabY - b.gap * 2;
  const offsets = useMemo(() => {
    if (!k) return [];
    return k.cols.map((c) => {
      const down = Math.round(b.ch * 0.11);
      let up = Math.round(b.ch * 0.27);
      const need = c.down.length * down + Math.max(0, c.up.length - 1) * up + b.ch;
      if (need > room && c.up.length > 1) up = Math.max(Math.round(b.ch * 0.16), Math.floor((room - b.ch - c.down.length * down) / (c.up.length - 1)));
      return { down, up };
    });
  }, [k, b.ch, room]);

  if (!k) return <div className="sol" />;

  type Placed = { c: PlayingCard; x: number; y: number; z: number; up: boolean; pile: Pile | "s"; depth: number };
  const placed: Placed[] = [];
  k.stock.forEach((c, i) => placed.push({ c, x: colX(0) - Math.min(i, 4) * 0.6, y: rowY - Math.min(i, 4) * 0.6, z: i, up: false, pile: "s", depth: k.stock.length - i }));
  k.waste.forEach((c, i) => {
    const fan = Math.max(0, i - (k.waste.length - 3));
    placed.push({ c, x: colX(1) + fan * Math.round(b.cw * 0.2), y: rowY, z: i, up: true, pile: "w", depth: k.waste.length - i });
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
  const hinted = (p: Placed) => !!hint && (hint.pile === "s" ? p.pile === "s" && p.depth === 1 : p.pile === hint.pile && p.depth > 0 && p.depth <= hint.depth);

  const down = (p: Placed, e: React.PointerEvent) => {
    if (done || p.pile === "s" || !p.up || p.depth < 1) return;
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
    const y = e.clientY - top;
    const to = y < rowY + b.ch + b.gap && i >= 3 ? "f" : y >= rowY + b.ch ? `t${i}` : null;
    if (!to || `${d.from}` === to || (to === "f" && many)) return;
    if (!play(`${d.from}>${to}${to === "f" ? "" : many}`)) buzz("tap");
  };
  const draw = () => {
    if (done) return;
    if (!play("d")) nope("s");
  };

  const secs = Math.floor((now - started) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const won = solWon(k);
  // banked XP plus the cards not banked yet (until the day's card XP runs out)
  const shownXp = earned + (capped || done ? 0 : Math.max(0, found - banked.current) * SOLITAIRE_CARD.xp);
  const small = b.cw < 64;
  return (
    <div className={"sol" + (small ? " sol-small" : "")} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <div className="sol-felt-rim" />
      <div className="sol-board" ref={board}>
      {banner && <div className="sol-banner">{banner}</div>}
      <div className="sol-bar" style={{ height: 52 }}>
        <button className="sol-icon-btn" onClick={onExit} aria-label="Back to the lobby">
          <Icon d="M15 5 8 12l7 7" />
        </button>
        <div className="sol-hud">
          <span className="sol-hud-name">SOLITAIRE</span>
          <span className="sol-hud-stats">
            <b>{moves.length}</b> moves <span className="sol-dot">·</span> <b>{clock}</b>
            {game?.gameId && shownXp > 0 && (
              <>
                {" "}<span className="sol-dot">·</span>{" "}
                <motion.b key={shownXp} className="sol-xp" initial={reduce ? false : { scale: 1.35 }} animate={{ scale: 1 }}>
                  +{shownXp} XP
                </motion.b>
              </>
            )}
          </span>
        </div>
        <button className="sol-icon-btn" onClick={showHint} disabled={done} aria-label="Hint">
          <Icon d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
        </button>
        <button className="sol-icon-btn" onClick={undo} disabled={hist.length < 2 || done} aria-label="Undo">
          <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
        </button>
        <button className={"sol-icon-btn" + (armed ? " armed" : "")} onClick={newDeal} aria-label="New deal">
          {armed ? <span className="sol-sure">New?</span> : <Icon d="M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0 0 12.4 2M18.5 9A7 7 0 0 0 6.1 7" />}
        </button>
      </div>

      {/* empty spots */}
      <button className={"sol-slot sol-stock" + (hint?.pile === "s" && !k.stock.length ? " hinted" : "")} style={{ left: colX(0), top: rowY, width: b.cw, height: b.ch }} onClick={draw} aria-label={k.stock.length ? "Draw a card" : "Turn the waste over"}>
        {!k.stock.length && <Icon d="M4 4v6h6M5.5 15a7 7 0 1 0 1-8L4 10" />}
      </button>
      {[0, 1, 2, 3].map((s) => (
        <div key={s} className="sol-slot sol-found" style={{ left: colX(3 + s), top: rowY, width: b.cw, height: b.ch }}>
          <span className={"sol-slot-suit" + (s === 1 || s === 2 ? " red" : "")}>{SUITS[s]}</span>
        </div>
      ))}
      {k.cols.map((_, i) => (
        <div key={i} className="sol-slot sol-col" style={{ left: colX(i), top: tabY, width: b.cw, height: b.ch }}>
          <span className="sol-slot-k">K</span>
        </div>
      ))}

      {placed.map((p) => {
        const lift = dragging(p);
        const key = `${p.pile}:${p.depth}`;
        const flipping = !reduce && fresh.flipped.has(p.c);
        return (
          <motion.div
            key={p.c}
            className={
              "sol-card" +
              (p.up ? (cardRed(p.c) ? " red" : "") : " back") +
              (lift ? " lifted" : "") +
              (hinted(p) ? " hinted" : "") +
              (fresh.landed.has(p.c) ? " landed" : "")
            }
            style={{ width: b.cw, height: b.ch, zIndex: lift ? 500 + p.z : p.pile[0] === "t" ? 10 + p.z : 5 + p.z, fontSize: Math.round(b.cw * 0.3) }}
            initial={false}
            animate={{
              x: p.x + (lift ? drag!.dx : 0),
              y: p.y + (lift ? drag!.dy : 0),
              scale: lift ? 1.05 : 1,
              rotateY: flipping ? [90, 0] : 0,
              rotate: shake && key === shake ? [0, -5, 5, -3, 0] : won && p.pile[0] === "f" && !reduce ? [0, -6, 6, 0] : 0,
            }}
            transition={
              lift
                ? { duration: 0, scale: { duration: 0.12 } }
                : { type: "spring", stiffness: 520, damping: 38, rotateY: { duration: 0.28, ease: "easeOut" }, rotate: won ? { duration: 0.6, delay: (p.c % 13) * 0.04 } : { duration: 0.3 } }
            }
            onPointerDown={(e) => (p.pile === "s" ? draw() : down(p, e))}
          >
            {p.up ? <Face c={p.c} /> : <Back />}
          </motion.div>
        );
      })}

      </div>

      <AnimatePresence>
        {won && (
          <motion.div className="sol-win" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.6 }}>
            {!reduce && <Confetti />}
            <motion.div className="sol-win-card" initial={{ scale: 0.7, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.8 }}>
              <div className="sol-win-kicker">CLEAN JOB</div>
              <div className="sol-win-title">SOLVED</div>
              <div className="sol-win-stats">
                <span>
                  <b>{moves.length}</b>moves
                </span>
                <span>
                  <b>{clock}</b>time
                </span>
              </div>
              <button className="btn primary big" onClick={() => void deal()} autoFocus>
                Deal again
              </button>
              {onHeist && (
                <button className="btn big sol-heist" onClick={onHeist}>
                  Try a hand of Heist
                  <span className="lobby-sub">The betrayal card game this site is built around</span>
                </button>
              )}
              <button className="btn ghost" onClick={onExit}>
                Lobby
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A card face: rank and suit in the corner (all that shows when stacked), a big suit or a court letter below. */
function Face({ c }: { c: PlayingCard }) {
  const r = cardRank(c);
  const s = SUITS[cardSuit(c)];
  return (
    <>
      <span className="sol-corner">
        <span className="sol-rank">{RANKS[r]}</span>
        <span className="sol-suit">{s}</span>
      </span>
      {r > 10 ? (
        <span className="sol-court">
          <b>{RANKS[r]}</b>
          <i>{s}</i>
        </span>
      ) : (
        <span className={"sol-center" + (r === 1 ? " ace" : "")}>{s}</span>
      )}
    </>
  );
}

/** The house card back: oxblood, gold frame, the Heist mark. */
function Back() {
  return (
    <span className="sol-back-frame">
      <span className="sol-back-mark">H</span>
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
