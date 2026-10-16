// Klondike solitaire (draw one). Tap a card to send it where it fits, or drag it. Undo, a hint, and the
// game finishes itself once every card is face up. Every new move, ace and finished suit pays a little XP
// and season XP (floating up from the card as it's earned); solving it pays nothing extra. It's paid when the
// player leaves, deals again or wins; the server replays the moves first, so nothing is paid twice.

import {
  applySol, autoMove, cardRank, cardRed, cardSuit, dealKlondike, fitsColumn, fitsFoundation, solGain, SOL_IDLE_S, solitaireRoom, solSolved, SOLITAIRE_DAY_XP, solWon, tallySol, tallyXp, tapMove,
  type Klondike, type PlayingCard, type SolMove, type SolTally,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { shareDailyResult } from "../daily/shareHelpers";
import { getDailyStreak, getStreakMultiplier } from "@heist/profile";
import { VictoryModal } from "../arcade/VictoryModal";
import "./solitaire.css";

const SUITS = ["♠", "♥", "♦", "♣"];
interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: SolTally = { moves: 0, aces: 0, stacks: 0, won: false };

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

/** Nothing left but flipping through the deck: no useful move on the table, and no deck card fits anywhere. */
function stuck(k: Klondike) {
  if (solWon(k)) return false;
  const h = findHint(k);
  if (h && h.pile !== "s") return false;
  return ![...k.stock, ...k.waste].some((c) => fitsFoundation(k, c) || k.cols.some((col) => fitsColumn(col, c)));
}

/** The deal: the cards gather on the deck, then fly out row by row, the top ones turning over as they land. */
const DEAL = { gather: 320, step: 45, flip: 140 };
const DEAL_MS = DEAL.gather + 28 * DEAL.step + 600;
/** When the card at row `j` of column `i` lands, dealt the classic way: across the columns, row by row. */
const landsAt = (i: number, j: number) => DEAL.gather + (7 * j - (j * (j - 1)) / 2 + i - j) * DEAL.step;

export function Solitaire({
  onExit,
  onHeist,
  banner,
  initialSeed,
  isDaily = false,
  challengerTime,
  challengerMoves,
  challengerScore,
}: {
  onExit: () => void;
  /** the win card's "Heist" button (left out while waiting in the online queue) */
  onHeist?: () => void;
  /** a strip under the top bar (the online queue and its timer) */
  banner?: ReactNode;
  initialSeed?: number;
  isDaily?: boolean;
  challengerTime?: string | null;
  challengerMoves?: number | null;
  challengerScore?: number | null;
}) {
  const { backend, act, showReward, me } = useAccount();
  const initialDeal = useRef(true);
  const [challengeOpen, setChallengeOpen] = useState(false);
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
  const [dealAt, setDealAt] = useState(0);
  const [dealT, setDealT] = useState(0);
  useEffect(() => {
    if (!dealAt) return;
    const t = window.setInterval(() => {
      const e = Date.now() - dealAt;
      setDealT(e);
      if (e > DEAL_MS) setDealAt(0);
    }, 30);
    return () => clearInterval(t);
  }, [dealAt]);
  const [stuckSeen, setStuckSeen] = useState(-1);

  // what this deal has earned so far (the most it has ever reached: undoing doesn't take XP back, and
  // redoing doesn't pay twice), and what the server has paid for
  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallySol(game.seed, moves);
    } catch {
      return null;
    }
  }, [game, moves]);
  const best = useRef(NOTHING);
  // stalling (no move for a few seconds) and hints drain the deal's XP, never below zero
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const pot = (t: SolTally) => Math.max(0, tallyXp(t) - drainRef.current);
  const banked = useRef(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  // Solitaire XP left today when the deal started (a little a day: Heist is the game to grind)
  const meNow = useRef(me);
  meNow.current = me;
  const dayLeft = useRef(0);
  const maxedShown = useRef(false);
  const live = useRef({ game, moves });
  live.current = { game, moves };
  /** Pay what the deal earned since it was last paid; leaving shows what it came to. */
  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    const xp = Math.max(0, tallyXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    // a win pays through the win itself
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.solitaireBank(g.gameId!, ms, drainRef.current));
    if (r?.reward && (show || r.reward.levelAfter > r.reward.levelBefore)) showReward(r.reward);
  }, [act, showReward]);
  // leaving (the lobby, or the online table being dealt) pays and shows it; so does putting the phone away
  useEffect(() => () => void bank(true), [bank]);
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") void bank(false);
      // the phone away isn't stalling
      else lastAct.current = Date.now();
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [bank]);

  const deal = useCallback(async () => {
    await bank(true);
    best.current = NOTHING;
    banked.current = 0;
    drainRef.current = 0;
    setDrain(0);
    setFloats([]);
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    const g = backend ? await backend.solitaireStart(firstSeed, dailyFlag).catch(() => null) : null;
    dayLeft.current = meNow.current ? solitaireRoom(meNow.current.progress, Date.now()) : SOLITAIRE_DAY_XP;
    maxedShown.current = false;
    // offline (or no server): still playable, it just can't pay XP
    const next = g ?? { gameId: null, seed: firstSeed ?? Math.floor(Math.random() * 2 ** 31) };
    setGame(next);
    setHist([dealKlondike(next.seed)]);
    setMoves([]);
    setDone(false);
    setHint(null);
    setArmed(false);
    setStarted(Date.now());
    lastAct.current = Date.now() + (reduce ? 0 : DEAL_MS);
    setDealT(0);
    setDealAt(reduce ? 0 : Date.now());
    cardSound(4);
  }, [backend, bank, reduce, initialSeed, isDaily]);
  useEffect(() => {
    void deal();
  }, [deal]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // stalling: a few seconds without a move, while there's a move to make and the game is on screen
  const stalled = (at: number) =>
    !!game?.gameId && !!k && !done && !dealAt && !solWon(k) && document.visibilityState === "visible" && at - lastAct.current >= SOL_IDLE_S * 1000 && !stuck(k);
  useEffect(() => {
    if (stalled(now)) setDrain((d) => Math.min(d + 1, tallyXp(best.current)));
    // once a second, on the clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const play = useCallback(
    (m: SolMove) => {
      const n = k && applySol(k, m);
      if (!n) return false;
      setHist((h) => [...h, n]);
      setMoves((ms) => [...ms, m]);
      setHint(null);
      lastAct.current = Date.now();
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

  const autoComplete = useCallback(() => {
    if (!k || done || solWon(k)) return;
    click();
    buzz("tap");
    let curr = k;
    const newMoves: string[] = [];
    const newHist = [...hist];
    while (!solWon(curr)) {
      const m = autoMove(curr);
      if (!m) break;
      const next = applySol(curr, m);
      if (!next) break;
      curr = next;
      newMoves.push(m);
      newHist.push(curr);
    }
    setMoves((prev) => [...prev, ...newMoves]);
    setHist(newHist);
  }, [k, done, hist]);

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
    if (id) void act((x) => x.solitaireFinish(id, moves, drainRef.current)).then((r) => r && showReward(r.reward));
  }, [k, done, game, moves, tally, act, showReward]);

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
    lastAct.current = Date.now();
    click();
    buzz("tap");
  };
  const showHint = () => {
    if (!k || done) return;
    const h = findHint(k);
    if (!h) return nope("s");
    setHint(h);
    // a hint costs the deal 1 XP
    setDrain((d) => Math.min(d + 1, tallyXp(best.current)));
    click();
    buzz("tap");
    window.setTimeout(() => setHint((x) => (x === h ? null : x)), 1800);
  };
  const newDeal = () => {
    // mid-game, the first tap asks to be sure
    if (moves.length && !done && !armed) {
      setArmed(true);
      click();
      buzz("tap");
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

  // XP floats up from the card that earned it: +1 for a new move, bigger for an ace, a suit, the win
  useEffect(() => {
    if (!tally || !k) return;
    const { gained, paid, any } = solGain(best.current, tally);
    const before = Math.min(pot(best.current), dayLeft.current);
    best.current = paid;
    const xp = Math.min(pot(paid), dayLeft.current) - before;
    // the day's Solitaire XP runs out: say so once, and point at Heist
    const maxed = any && xp < tallyXp(gained) && !maxedShown.current;
    if (maxed) maxedShown.current = true;
    if ((!xp && !maxed) || !game?.gameId) return;
    // where: the pile the last move landed on
    const last = hist[hist.length - 2];
    let x = colX(1);
    let y = rowY;
    const s = last ? k.found.findIndex((f, i) => f.length > last.found[i].length) : -1;
    const to = /t(\d)$|t(\d):/.exec(moves[moves.length - 1] ?? "");
    if (s >= 0) x = colX(3 + s);
    else if (to) {
      const i = Number(to[1] ?? to[2]);
      const col = k.cols[i];
      x = colX(i);
      y = tabY + col.down.length * offsets[i].down + Math.max(0, col.up.length - 1) * offsets[i].up;
    } else if (!k.waste.length) x = colX(0);
    const tag = maxed ? "MAXED TODAY · HEIST PAYS MORE" : gained.stacks ? "SUIT DONE" : gained.aces ? "ACE" : null;
    const id = ++floatId.current;
    setFloats((f) => [...f.slice(-5), { id, x: x + b.cw / 2, y, xp, tag }]);
    // not cleared by the next move: fast play still lets each one finish and go
    window.setTimeout(() => setFloats((f) => f.filter((q) => q.id !== id)), tag ? 1400 : 900);
    // only a new tally makes a float
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tally]);

  if (!k) return <div className="sol" />;

  type Placed = { c: PlayingCard; x: number; y: number; z: number; up: boolean; pile: Pile | "s"; depth: number; land?: number };
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
  // dealing: a card waits on the deck until its turn, and lands face down before the top ones turn over
  if (dealAt) {
    for (const p of placed) {
      if (p.pile[0] !== "t") continue;
      const at = landsAt(Number(p.pile[1]), p.z);
      p.land = at;
      if (dealT < at) Object.assign(p, { x: colX(0), y: rowY, z: 60 - at / DEAL.step });
      if (dealT < at + DEAL.flip) p.up = false;
    }
  }

  const dragging = (p: Placed) => !!drag && drag.moved && p.pile === drag.from && p.depth <= drag.depth && p.depth > 0;
  const hinted = (p: Placed) => !!hint && (hint.pile === "s" ? p.pile === "s" && p.depth === 1 : p.pile === hint.pile && p.depth > 0 && p.depth <= hint.depth);

  const down = (p: Placed, e: React.PointerEvent) => {
    if (dealAt || done || p.pile === "s" || !p.up || p.depth < 1) return;
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
    if (dealAt || done) return;
    if (!play("d")) nope("s");
  };

  const secs = Math.floor((now - started) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const won = solWon(k);
  const isStuck = !done && !dealAt && stuckSeen !== hist.length && stuck(k);
  const shownXp = Math.min(pot(best.current), dayLeft.current);
  const draining = stalled(now) && shownXp > 0;
  const small = b.cw < 64;
  return (
    <div className={"sol" + (small ? " sol-small" : "")} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <div className="sol-felt-rim" />
      <div className="sol-board" ref={board}>
      {banner && <div className="sol-banner">{banner}</div>}
      <div className="sol-bar" style={{ height: 52 }}>
        <button className="sol-icon-btn" onClick={() => { click(); buzz("tap"); onExit(); }} aria-label="Back to the lobby">
          <Icon d="M15 5 8 12l7 7" />
        </button>
        <div className="sol-hud">
          <span className="sol-hud-name">
            SOLITAIRE
            <span className="arcade-trust-pill">✓ Free · No Ads</span>
          </span>
          <span className="sol-hud-stats">
            <b>{moves.length}</b> moves <span className="sol-dot">·</span> <b>{clock}</b>
            {game?.gameId && (shownXp > 0 || drain > 0) && (
              <>
                {" "}<span className="sol-dot">·</span>{" "}
                <motion.b key={shownXp} className={"sol-xp" + (draining ? " drain" : "")} initial={reduce ? false : { scale: draining ? 0.8 : 1.35 }} animate={{ scale: 1 }}>
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

      {k && !done && !solWon(k) && solSolved(k) && (
        <button className="sol-autocomplete-btn" onClick={autoComplete}>
          ⚡ Auto Complete
        </button>
      )}

      {/* empty spots */}
      <button
        className={"sol-slot sol-stock" + (hint?.pile === "s" && !k.stock.length ? " hinted" : "")}
        style={{ left: colX(0), top: rowY, width: b.cw, height: b.ch }}
        onClick={draw}
        disabled={dealAt !== 0 || done || (!k.stock.length && !k.waste.length)}
        aria-label={k.stock.length ? "Draw a card" : k.waste.length ? "Turn the waste over" : "Stock and waste are empty"}
      >
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
        const flipping = !reduce && (dealAt ? p.up && p.land !== undefined && dealT < p.land + DEAL.flip + 320 : fresh.flipped.has(p.c));
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

      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className={"sol-float" + (f.tag ? " big" : "") + (f.xp ? "" : " note")}
            style={{ left: f.x, top: f.y }}
            initial={{ opacity: 0, y: 0, scale: f.tag ? 0.6 : 0.8 }}
            animate={{ opacity: [0, 1, 1, 0], y: reduce ? 0 : f.tag ? -70 : -44, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: f.tag ? 1.3 : 0.85, ease: "easeOut", opacity: { times: [0, 0.15, 0.7, 1], duration: f.tag ? 1.3 : 0.85 } }}
          >
            {f.xp > 0 && `+${f.xp}`}
            {f.tag && <small>{f.tag}</small>}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* the classic win: the cards leap off the foundations and bounce away, leaving trails */}
      {won && !reduce && <WinCascade from={(s) => ({ x: colX(3 + s), y: rowY })} cw={b.cw} ch={b.ch} />}

      <AnimatePresence>
        {isStuck && (
          <motion.div key="stuck" className="sol-stuck" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
            <span className="sol-stuck-title">No moves left</span>
            <button className="btn" onClick={undo}>
              Undo
            </button>
            <button className="btn primary" onClick={() => void deal()}>
              New deal
            </button>
            <button className="sol-stuck-x" onClick={() => { click(); buzz("tap"); setStuckSeen(hist.length); }} aria-label="Keep playing">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {won && (
        <VictoryModal
          game="solitaire"
          gameTitle="Klondike Solitaire"
          moves={moves.length}
          time={clock}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => void deal()}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="solitaire"
            gameTitle="Klondike Solitaire"
            seed={game.seed}
            time={clock}
            moves={moves.length}
            challengerTime={challengerTime}
            challengerMoves={challengerMoves}
            challengerScore={challengerScore}
            onClose={() => setChallengeOpen(false)}
          />
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

/**
 * The classic Solitaire win: one card at a time leaps off the foundations (kings first), falls, bounces
 * along the bottom and runs off the side, drawn without clearing so each leaves a trail of copies.
 */
function WinCascade({ from, cw, ch }: { from: (suit: number) => { x: number; y: number }; cw: number; ch: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const start = useRef(from);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    g.scale(dpr, dpr);
    const queue: PlayingCard[] = [];
    for (let r = 12; r >= 0; r--) for (let s = 0; s < 4; s++) queue.push(s * 13 + r);
    const live: { img: HTMLCanvasElement; x: number; y: number; vx: number; vy: number }[] = [];
    let last = 0;
    let raf = 0;
    const step = (t: number) => {
      if (queue.length && t - last > 220) {
        last = t;
        const c = queue.shift()!;
        const o = start.current(cardSuit(c));
        live.push({ img: cardSprite(c, cw, ch, dpr), x: o.x, y: o.y, vx: (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 4.5), vy: -2 - Math.random() * 5 });
      }
      for (const p of live) {
        p.vy += 0.5;
        p.x += p.vx;
        p.y += p.vy;
        if (p.y + ch > H) {
          p.y = H - ch;
          p.vy = -p.vy * 0.74;
        }
        g.drawImage(p.img, p.x, p.y, cw, ch);
      }
      for (let i = live.length - 1; i >= 0; i--) if (live[i].x < -cw || live[i].x > W) live.splice(i, 1);
      if (queue.length || live.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cw, ch]);
  return <canvas ref={ref} className="sol-cascade" />;
}

/** A card face drawn once into a small canvas, for the win cascade to stamp. */
function cardSprite(c: PlayingCard, cw: number, ch: number, dpr: number) {
  const cv = document.createElement("canvas");
  cv.width = cw * dpr;
  cv.height = ch * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  const r = Math.max(4, cw * 0.08);
  g.beginPath();
  g.roundRect(0.5, 0.5, cw - 1, ch - 1, r);
  const bg = g.createLinearGradient(0, 0, cw * 0.4, ch);
  bg.addColorStop(0, "#fffdf6");
  bg.addColorStop(0.55, "#f6eedb");
  bg.addColorStop(1, "#eadfc4");
  g.fillStyle = bg;
  g.fill();
  g.strokeStyle = "rgba(0, 0, 0, 0.35)";
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = cardRed(c) ? "#c0301b" : "#17191d";
  g.textBaseline = "top";
  const fs = Math.round(cw * 0.3);
  g.font = `${fs}px "Bebas Neue", Impact, sans-serif`;
  g.fillText(RANKS[cardRank(c)], cw * 0.08, ch * 0.05);
  g.font = `${Math.round(fs * 0.8)}px sans-serif`;
  g.textAlign = "right";
  g.fillText(SUITS[cardSuit(c)], cw * 0.92, ch * 0.06);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `${Math.round(cw * 0.5)}px sans-serif`;
  g.fillText(SUITS[cardSuit(c)], cw / 2, ch * 0.6);
  return cv;
}
