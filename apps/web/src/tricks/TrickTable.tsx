// The card table Hearts and Spades share: four seats round the felt, a fanned hand at the bottom, cards that
// fly from a seat into the trick and get swept to whoever took it, a top bar, a score sheet and a first-time
// how-to card. Sized from the space it's given, so it fits an upright iPhone, a sideways one and a desktop.

import { cardRank, cardRed, cardSuit, type Play, type PlayingCard, type Seat } from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { buzz } from "../haptics";
import { click } from "../sound";
import { CREW_LOOK } from "./crew";
import "./tricks.css";

export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const cardName = (c: PlayingCard) => `${RANKS[cardRank(c)]}${SUITS[cardSuit(c)]}`;

export type SeatPos = "south" | "west" | "north" | "east";
export const SEAT_POS: SeatPos[] = ["south", "west", "north", "east"];

/** The stage's size, and the card size and anchor points that fit it. */
export interface Layout {
  w: number;
  h: number;
  cw: number;
  ch: number;
  landscape: boolean;
  /** the middle of the trick */
  cx: number;
  cy: number;
  /** top of the player's hand */
  handY: number;
  /** where each seat sits (centre of its plate) */
  seats: { x: number; y: number }[];
}

export function useLayout(ref: RefObject<HTMLDivElement | null>): Layout | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    f();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(f) : null;
    ro?.observe(el);
    window.addEventListener("resize", f);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", f);
    };
  }, [ref]);
  if (!size || size.w < 10 || size.h < 10) return null;
  const { w, h } = size;
  const landscape = w > h * 1.25;
  const cw = Math.round(Math.max(40, Math.min(88, w / (landscape ? 6.3 : 5.8), h / (landscape ? 5.6 : 7.4))));
  const ch = Math.round(cw * 1.4);
  const handY = h - ch - 6;
  // upright, you sit above your hand in the middle; sideways, off to the left so the trick has the height
  const southY = handY - (landscape ? 40 : 28);
  const northY = landscape ? 26 : 34;
  const cy = Math.round(landscape ? (northY + 30 + handY - 8) / 2 : (northY + 30 + southY - 24) / 2);
  const side = landscape ? Math.min(w * 0.2, 150) : Math.max(40, Math.min(w * 0.14, 70));
  return {
    w, h, cw, ch, landscape, handY,
    cx: Math.round(w / 2),
    cy,
    seats: [
      { x: landscape ? 92 : w / 2, y: southY },
      { x: side, y: cy },
      { x: w / 2, y: northY },
      { x: w - side, y: cy },
    ],
  };
}

/** An ivory card face, like the rest of the arcade's. */
export function CardFace({ card, cw, ch, className = "", style }: { card: PlayingCard; cw: number; ch: number; className?: string; style?: React.CSSProperties }) {
  const r = cardRank(card);
  const s = cardSuit(card);
  const court = r >= 11;
  return (
    <div className={`tt-card ${cardRed(card) ? "red" : ""} ${className}`} style={{ width: cw, height: ch, fontSize: Math.round(cw * 0.3), ...style }}>
      <div className="tt-corner">
        <span className="tt-rank">{RANKS[r]}</span>
        <span className="tt-suit">{SUITS[s]}</span>
      </div>
      {court ? (
        <div className="tt-court">
          <b>{RANKS[r]}</b>
          <i>{SUITS[s]}</i>
        </div>
      ) : (
        <div className={`tt-pip ${r === 1 ? "ace" : ""}`}>{SUITS[s]}</div>
      )}
    </div>
  );
}

export function CardBack({ cw, ch, style, className = "" }: { cw: number; ch: number; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={`tt-card tt-back card-back ${className}`} style={{ width: cw, height: ch, ...style }}>
      <div className="tt-back-frame">
        <span className="tt-back-mark">H</span>
      </div>
    </div>
  );
}

export interface SeatView {
  /** crew id, or null for you */
  crew: string | null;
  name: string;
  role: string;
  /** the big number on the plate (score) */
  score: ReactNode;
  /** a smaller line under it (points this hand, bid and tricks) */
  sub?: ReactNode;
  active: boolean;
  /** cards still in hand (drawn as a mini fan of backs for the crew) */
  cards: number;
  /** a teammate's plate is trimmed in gold */
  mate?: boolean;
  dealer?: boolean;
}

/** One seat: avatar, name, score, a mini fan of the cards it's holding, and a speech bubble. */
export function SeatPlate({ seat, view, layout, bubble }: { seat: Seat; view: SeatView; layout: Layout; bubble: string | null }) {
  const pos = SEAT_POS[seat];
  const p = layout.seats[seat];
  const look = view.crew ? CREW_LOOK[view.crew] : null;
  const mini = Math.max(14, Math.round(layout.cw * 0.34));
  const vertical = !layout.landscape && (pos === "west" || pos === "east");
  return (
    <div
      className={`tt-seat tt-${pos} ${vertical ? "vertical" : ""} ${view.active ? "active" : ""} ${view.mate ? "mate" : ""}`}
      style={{ left: p.x, top: p.y }}
      data-anchor={seat === 0 ? "seat-0" : undefined}
    >
      {seat !== 0 && view.cards > 0 && (
        <div className="tt-minifan" aria-hidden="true">
          {Array.from({ length: view.cards }).map((_, i) => (
            <CardBack
              key={i}
              cw={mini}
              ch={Math.round(mini * 1.4)}
              className="tt-mini"
              style={{ transform: `translateX(${(i - (view.cards - 1) / 2) * mini * 0.28}px) rotate(${(i - (view.cards - 1) / 2) * 4}deg)` }}
            />
          ))}
        </div>
      )}
      <div className="tt-plate">
        <div
          className="tt-avatar"
          style={look ? { background: `radial-gradient(circle at 35% 30%, ${look.color}, ${look.color2})` } : undefined}
        >
          {look ? look.mark : view.name.slice(0, 1).toUpperCase()}
          {view.dealer && <span className="tt-dealer" title="Dealer">D</span>}
        </div>
        <div className="tt-plate-text">
          <span className="tt-name">{view.name}</span>
          {!vertical && <span className="tt-role">{view.role}</span>}
        </div>
        <div className="tt-score">
          <b>{view.score}</b>
          {view.sub !== undefined && <small>{view.sub}</small>}
        </div>
      </div>
      <AnimatePresence>
        {bubble && (
          <motion.div
            key={bubble}
            className="tt-bubble"
            initial={{ opacity: 0, scale: 0.6, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
          >
            {bubble}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const OFFSET = [
  [0, 0.34],
  [-0.62, 0],
  [0, -0.34],
  [0.62, 0],
] as const;

/** The trick in the middle. While `sweep` names a winner, the cards slide over to that seat. */
export function TrickPile({ plays, layout, sweepTo, reduce }: { plays: readonly Play[]; layout: Layout; sweepTo: Seat | null; reduce: boolean }) {
  const { cw, ch, cx, cy } = layout;
  return (
    <div className="tt-trick" aria-live="polite">
      {plays.map((p, i) => {
        const [ox, oy] = OFFSET[p.seat];
        const x = cx - cw / 2 + ox * cw;
        const y = cy - ch / 2 + oy * ch;
        const from = layout.seats[p.seat];
        const fromX = p.seat === 0 ? x : from.x - cw / 2;
        const fromY = p.seat === 0 ? layout.handY : from.y - ch / 2;
        const rot = ((p.card % 7) - 3) * 2.2 + (p.seat === 1 ? -6 : p.seat === 3 ? 6 : 0);
        const to = sweepTo !== null ? layout.seats[sweepTo] : null;
        return (
          <motion.div
            key={`${p.seat}-${p.card}`}
            className="tt-trick-card"
            style={{ zIndex: 10 + i }}
            initial={reduce ? { x, y, rotate: rot, opacity: 0 } : { x: fromX, y: fromY, rotate: rot * 3, scale: p.seat === 0 ? 1.05 : 0.55, opacity: p.seat === 0 ? 1 : 0.3 }}
            animate={
              to
                ? { x: to.x - cw / 2, y: to.y - ch / 2, rotate: rot * 2, scale: 0.35, opacity: 0 }
                : { x, y, rotate: rot, scale: 1, opacity: 1 }
            }
            transition={
              to
                ? { duration: reduce ? 0.15 : 0.42, ease: [0.55, 0, 0.75, 0.2], delay: reduce ? 0 : i * 0.03 }
                : reduce
                ? { duration: 0.12 }
                : { type: "spring", stiffness: 340, damping: 27, mass: 0.8 }
            }
          >
            <CardFace card={p.card} cw={cw} ch={ch} className={sweepTo === null && i === plays.length - 1 ? "fresh" : ""} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** The player's fanned hand. Playable cards rise when it's your move; the rest dim. */
export function Hand({
  cards, layout, playable, selected, hinted, fresh, onTap, reduce,
}: {
  cards: readonly PlayingCard[];
  layout: Layout;
  /** null: not your move (nothing dims) */
  playable: readonly PlayingCard[] | null;
  selected?: readonly PlayingCard[];
  hinted?: readonly PlayingCard[];
  /** just passed to you */
  fresh?: readonly PlayingCard[];
  onTap: (c: PlayingCard) => void;
  reduce: boolean;
}) {
  const { w, cw, ch, handY } = layout;
  const n = cards.length;
  const room = Math.min(w, 820) - 20 - cw;
  const step = n > 1 ? Math.min(cw * 0.7, room / (n - 1)) : 0;
  const total = cw + step * Math.max(0, n - 1);
  const x0 = (w - total) / 2;
  const mid = (n - 1) / 2;
  const tilt = Math.min(3.2, 34 / Math.max(n, 1));
  return (
    <div className="tt-hand" role="group" aria-label="Your hand">
      <AnimatePresence initial={!reduce}>
        {cards.map((c, i) => {
          const d = i - mid;
          const up = playable ? playable.includes(c) : false;
          const sel = selected?.includes(c) ?? false;
          const lift = (sel ? 26 : 0) + (up && !sel ? 10 : 0);
          return (
            <motion.button
              type="button"
              key={c}
              className={`tt-hand-card ${playable && !up ? "dim" : ""} ${sel ? "selected" : ""} ${hinted?.includes(c) ? "hinted" : ""} ${fresh?.includes(c) ? "new" : ""}`}
              style={{ zIndex: i + 1, width: cw, height: ch }}
              initial={reduce ? false : { x: w / 2 - cw / 2, y: handY - layout.h * 0.4, rotate: 0, opacity: 0, scale: 0.6 }}
              animate={{ x: x0 + i * step, y: handY + Math.abs(d) * Math.abs(d) * 0.55 - lift, rotate: d * tilt, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.08 } }}
              transition={reduce ? { duration: 0.1 } : { type: "spring", stiffness: 420, damping: 32, delay: 0 }}
              onClick={() => onTap(c)}
              aria-label={`${cardName(c)}${up ? ", playable" : ""}${sel ? ", picked" : ""}`}
              aria-pressed={sel}
            >
              <CardFace card={c} cw={cw} ch={ch} />
              {fresh?.includes(c) && <span className="tt-new-tag">NEW</span>}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** The top bar: back, the game's name and running stats, then hint, score sheet and new game. */
export function TopBar({
  title, stats, onExit, onHint, onScores, onNew, hintDisabled,
}: {
  title: string;
  stats: ReactNode;
  onExit: () => void;
  onHint: () => void;
  onScores: () => void;
  onNew: () => void;
  hintDisabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2800);
    return () => clearTimeout(t);
  }, [armed]);
  const tap = (f: () => void) => () => {
    click();
    buzz("tap");
    f();
  };
  return (
    <header className="tt-bar">
      <button type="button" className="tt-icon-btn" onClick={tap(onExit)} title="Back to the lobby" aria-label="Back to the lobby">
        <Icon d="M15 19l-7-7 7-7" />
      </button>
      <div className="tt-hud">
        <span className="tt-hud-name">
          {title}
          <span className="arcade-trust-pill">✓ Free · No Ads</span>
        </span>
        <span className="tt-hud-stats">{stats}</span>
      </div>
      <button type="button" className="tt-icon-btn" onClick={tap(onHint)} disabled={hintDisabled} title="What would the crew do?" aria-label="Hint">
        <Icon d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0012 3z" />
      </button>
      <button type="button" className="tt-icon-btn" onClick={tap(onScores)} title="Score sheet" aria-label="Score sheet">
        <Icon d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3" />
      </button>
      <button
        type="button"
        className={`tt-icon-btn ${armed ? "armed" : ""}`}
        onClick={tap(() => {
          if (armed) {
            setArmed(false);
            onNew();
          } else setArmed(true);
        })}
        title={armed ? "Tap again for a new game" : "New game"}
        aria-label={armed ? "Confirm new game" : "New game"}
      >
        {armed ? <span className="tt-sure">NEW?</span> : <Icon d="M4 4v5h.6m15.3 2A8 8 0 004.6 9m0 0H9m11 11v-5h-.6m0 0a8 8 0 01-15.3-2m15.3 2H15" />}
      </button>
    </header>
  );
}

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** A centred card over the felt: the score sheet, the bidding box, results. */
export function Panel({ children, onClose, wide = false, label }: { children: ReactNode; onClose?: () => void; wide?: boolean; label: string }) {
  return (
    <motion.div className="tt-panel-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <motion.div
        className={`tt-panel ${wide ? "wide" : ""}`}
        initial={{ y: 30, scale: 0.94, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.96, opacity: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** First visit: a short how-to card, then never again on this device. */
export function useFirstTime(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(key);
    } catch {
      return false;
    }
  });
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* fine without */
    }
  };
  return [open, close];
}

export function HowTo({ title, rules, onClose }: { title: string; rules: ReactNode[]; onClose: () => void }) {
  return (
    <Panel onClose={onClose} label={`How to play ${title}`}>
      <div className="tt-panel-kicker">HOW TO PLAY</div>
      <div className="tt-panel-title">{title}</div>
      <ul className="tt-rules">
        {rules.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <button type="button" className="tt-btn primary" onClick={() => { click(); buzz("tap"); onClose(); }}>
        Deal me in
      </button>
    </Panel>
  );
}

export interface Float {
  id: number;
  x: number;
  y: number;
  text: string;
  tag?: string;
}

/** Floating +XP numbers. */
export function Floats({ floats }: { floats: Float[] }) {
  return (
    <AnimatePresence>
      {floats.map((f) => (
        <motion.div
          key={f.id}
          className="tt-float"
          style={{ left: f.x, top: f.y }}
          initial={{ opacity: 0, y: 10, scale: 0.8 }}
          animate={{ opacity: 1, y: -34, scale: 1.12 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        >
          <span>{f.text}</span>
          {f.tag && <small>{f.tag}</small>}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

export function useFloats() {
  const [floats, setFloats] = useState<Float[]>([]);
  const id = useRef(0);
  const add = (x: number, y: number, text: string, tag?: string) => {
    const fid = ++id.current;
    setFloats((fs) => [...fs, { id: fid, x, y, text, tag }]);
    setTimeout(() => setFloats((fs) => fs.filter((f) => f.id !== fid)), 1500);
  };
  return { floats, add };
}

/** Speech bubbles over the seats, one at a time per seat. */
export function useBubbles() {
  const [bubbles, setBubbles] = useState<(string | null)[]>([null, null, null, null]);
  const timers = useRef<number[]>([0, 0, 0, 0]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const say = (seat: number, text: string, ms = 2200) => {
    if (!text) return;
    clearTimeout(timers.current[seat]);
    setBubbles((b) => b.map((x, i) => (i === seat ? text : x)));
    timers.current[seat] = window.setTimeout(() => setBubbles((b) => b.map((x, i) => (i === seat ? null : x))), ms);
  };
  const hush = () => setBubbles([null, null, null, null]);
  return { bubbles, say, hush };
}
