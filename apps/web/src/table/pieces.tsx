// Small visual building blocks: crew shapes, crew tokens, cards and chips. Colors and shapes match
// the printed cards (game/v3/build_cards.py).
import { CREWS, ROLES, cardLabel, type Card, type RoleId } from "@heist/engine";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../prefs";
import type { CSSProperties, ReactNode } from "react";
import { FixerIcon, Keyhole, People, RoleIcon, SwitchIcon, Trophy } from "./icons";

export const crewHex = (c: number) => (c >= 0 ? CREWS[c].hex : "#555");

export function Shape({ color, size = 14, fill = "#f2e8d3", stroke = "#16181d" }: { color: number; size?: number; fill?: string; stroke?: string }) {
  const shape = color >= 0 ? CREWS[color].shape : "circle";
  const p = { fill, stroke, strokeWidth: 6, strokeLinejoin: "round" as const };
  let el: ReactNode;
  switch (shape) {
    case "circle":
      el = <circle cx="50" cy="50" r="34" {...p} />;
      break;
    case "square":
      el = <rect x="18" y="18" width="64" height="64" rx="6" {...p} />;
      break;
    case "triangle":
      el = <polygon points="50,12 88,82 12,82" {...p} />;
      break;
    case "diamond":
      el = <polygon points="50,8 90,50 50,92 10,50" {...p} />;
      break;
    case "star":
      el = <polygon points="50,6 61,38 95,38 67,58 78,92 50,71 22,92 33,58 5,38 39,38" {...p} />;
      break;
    default:
      el = <polygon points="50,8 87,29 87,71 50,92 13,71 13,29" {...p} />;
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {el}
    </svg>
  );
}

/** A crew member: a chip in the crew's color with its shape. */
export function Crew({ color, size = 18, glow, style }: { color: number; size?: number; glow?: boolean; style?: CSSProperties }) {
  return (
    <span
      className={"crew" + (glow ? " crew-glow" : "")}
      style={{ width: size, height: size, background: crewHex(color), ...style }}
      title={color >= 0 ? `${CREWS[color].name} crew` : undefined}
    >
      <Shape color={color} size={size * 0.62} />
    </span>
  );
}

export function CrewBadge({ color, size = 44 }: { color: number; size?: number }) {
  return (
    <span className="crew-badge" style={{ width: size, height: size, background: crewHex(color) }}>
      <Shape color={color} size={size * 0.6} />
    </span>
  );
}

const KIND_STYLE: Record<Card["kind"], { label: string; accent: string }> = {
  S: { label: "SCORE", accent: "#e7b53c" },
  F: { label: "FIXER", accent: "#1f9e8f" },
  B: { label: "BACKUP", accent: "#d6452b" },
  X: { label: "DOUBLE-CROSS", accent: "#d6452b" },
};

export type CardSize = "xs" | "sm" | "md" | "lg";

const ICON_PX: Record<CardSize, number> = { xs: 16, sm: 30, md: 44, lg: 70 };

/** A Job card face, laid out like the printed card: kind band, cash badge, crew tile, big mark, rule pill. */
export function CardFace({ card, size = "md" }: { card: Card; size?: CardSize }) {
  const k = KIND_STYLE[card.kind];
  const big = size === "md" || size === "lg";
  return (
    <div className={`card card-${size} card-face kind-${card.kind}`} style={{ ["--accent" as string]: k.accent }}>
      {size === "lg" && <span className="card-band">{k.label}</span>}
      <span className={"card-cash" + (card.cash === 0 ? " zero" : "")}>${card.cash}</span>
      <span className="card-crew" style={{ background: crewHex(card.color) }}>
        <Shape color={card.color} size={size === "xs" ? 7 : size === "sm" ? 9 : size === "md" ? 12 : 18} />
      </span>
      <div className="card-main">
        {card.kind === "S" && <span className="card-num">{card.score}</span>}
        {card.kind === "F" && <FixerIcon size={ICON_PX[size]} />}
        {card.kind === "B" && <span className="card-num">+3</span>}
        {card.kind === "X" && <SwitchIcon size={ICON_PX[size] * 1.1} />}
        {big && card.kind === "F" && <span className="card-sub">MAKE A DEAL</span>}
        {big && card.kind === "B" && <span className="card-sub">BOOST EITHER SIDE</span>}
        {big && card.kind === "X" && <span className="card-sub">1 ALLY SWITCHES</span>}
      </div>
      {size === "sm" && <span className="card-label">{k.label}</span>}
      {big && card.kind === "S" && (
        <span className="card-pill">
          {card.score} + <People size={size === "lg" ? 16 : 13} /> = <Trophy size={size === "lg" ? 14 : 11} />
        </span>
      )}
    </div>
  );
}

export function CardBack({ size = "md" }: { size?: CardSize }) {
  return (
    <div className={`card card-${size} card-back`}>
      <span className="back-key">
        <Keyhole size={size === "xs" ? 16 : size === "sm" ? 26 : size === "md" ? 40 : 64} />
      </span>
      {size !== "xs" && <span className="back-word">HEIST</span>}
    </div>
  );
}

/** A Role card, blueprint style like the print. */
export function RoleCard({ role, size = "md" }: { role: RoleId; size?: "sm" | "md" }) {
  const R = ROLES.find((r) => r.id === role)!;
  return (
    <div className={"role-face role-" + size}>
      <span className="role-kicker">CREW ROLE · BREAKS ONE RULE</span>
      <span className="role-disc">
        <RoleIcon role={role} size={size === "sm" ? 30 : 46} />
      </span>
      <span className="role-band">{R.name}</span>
      <span className="role-rule">{R.text}</span>
    </div>
  );
}

/** A card that flies between places on the table (shared layoutId) and can be face up or down. */
export function TableCard({
  card,
  size = "md",
  faceDown,
  selected,
  dim,
  onClick,
  style,
  enter,
}: {
  card: Card;
  size?: CardSize;
  /** Deal this card in from above after this many seconds. */
  enter?: number;
  faceDown?: boolean;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const hidden = faceDown || card.color < 0;
  return (
    <motion.div
      layoutId={`card-${card.id}`}
      layout
      className={"table-card" + (selected ? " selected" : "") + (dim ? " dim" : "") + (onClick ? " clickable" : "")}
      onClick={onClick}
      style={style}
      whileHover={onClick ? { y: -10 } : undefined}
      initial={enter !== undefined ? { y: -340, x: -120, opacity: 0, scale: 0.5, rotateZ: -40 } : false}
      animate={enter !== undefined ? { y: 0, x: 0, opacity: 1, scale: 1, rotateZ: 0 } : undefined}
      transition={enter !== undefined ? { delay: enter, type: "spring", stiffness: 220, damping: 22 } : { type: "spring", stiffness: 380, damping: 32 }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? !!selected : undefined}
      aria-label={hidden ? "Face-down card" : cardLabel(card) + (card.cash ? `, $${card.cash}` : "")}
      data-tip={hidden || onClick || size === "md" || size === "lg" ? undefined : tipFor(card)}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {hidden ? <CardBack size={size} /> : <CardFace card={card} size={size} />}
    </motion.div>
  );
}

/** Flip a card from back to face (the showdown reveal). */
export function FlipCard({ card, revealed, size = "md" }: { card: Card | null; revealed: boolean; size?: CardSize }) {
  if (!card) return <div className={`card card-${size} card-slot`} />;
  return (
    <div className={`flip card-${size}`}>
      <motion.div className="flip-inner" initial={false} animate={{ rotateY: revealed && card.color >= 0 ? 180 : 0 }} transition={{ duration: 0.6, ease: "easeInOut" }}>
        <div className="flip-side flip-back">
          <CardBack size={size} />
        </div>
        <div className="flip-side flip-front">{card.color >= 0 && <CardFace card={card} size={size} />}</div>
      </motion.div>
    </div>
  );
}

export function Chips({ amount, small, counting }: { amount: number; small?: boolean; counting?: boolean }) {
  const stacks = Math.min(5, Math.max(1, Math.ceil(Math.log10(Math.max(amount, 1)))));
  const colors = ["#c8372d", "#2f78c4", "#1d1f24", "#3a9a4a", "#8a4fbf"];
  return (
    <span className={"chips" + (small ? " small" : "")}>
      <span className="chip-stack">
        {Array.from({ length: stacks }, (_, i) => (
          <span key={i} className="chip" style={{ background: colors[i % colors.length], bottom: i * 3 }} />
        ))}
      </span>
      <span className="chip-amt">{counting ? <CountUp value={amount} /> : amount.toLocaleString()}</span>
    </span>
  );
}

const KIND_TIP: Record<Card["kind"], string> = {
  S: "Score: lay it face down at the showdown. Its number plus your side's crew is your total.",
  F: "Fixer: lay it at the showdown. Fixer vs Fixer makes a deal; a Score always beats a Fixer.",
  B: "Backup: play after the cards are revealed for +3 to either side.",
  X: "Double-Cross: anyone can play it after allies join. One ally switches sides.",
};

export function tipFor(card: Card) {
  return `${cardLabel(card)} · $${card.cash} cash · ${CREWS[card.color]?.name ?? ""} color\n${KIND_TIP[card.kind]}`;
}

/** A number that counts to its new value instead of jumping. */
export function CountUp({ value, prefix = "" }: { value: number; prefix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const a = from.current, t0 = performance.now(), dur = 450;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(a + (value - a) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return (
    <>
      {prefix}
      {shown.toLocaleString()}
    </>
  );
}
