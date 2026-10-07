// Small visual building blocks: crew shapes, crew tokens, cards and chips. Colors and shapes match
// the printed cards (game/v3/build_cards.py).
import { CREWS, type Card } from "@heist/engine";
import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

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

export function CardFace({ card, size = "md" }: { card: Card; size?: CardSize }) {
  const k = KIND_STYLE[card.kind];
  return (
    <div className={`card card-${size} card-face kind-${card.kind}`} style={{ ["--accent" as string]: k.accent }}>
      <span className="card-cash">${card.cash}</span>
      <span className="card-crew" style={{ background: crewHex(card.color) }}>
        <Shape color={card.color} size={size === "xs" ? 7 : size === "sm" ? 9 : 13} />
      </span>
      <div className="card-main">
        {card.kind === "S" && <span className="card-num">{card.score}</span>}
        {card.kind === "F" && <span className="card-icon">⚖</span>}
        {card.kind === "B" && <span className="card-num small">+3</span>}
        {card.kind === "X" && <span className="card-icon">⇄</span>}
      </div>
      <span className="card-label">{k.label}</span>
    </div>
  );
}

export function CardBack({ size = "md" }: { size?: CardSize }) {
  return (
    <div className={`card card-${size} card-back`}>
      <span className="back-mark">H</span>
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
}: {
  card: Card;
  size?: CardSize;
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
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={"table-card" + (selected ? " selected" : "") + (dim ? " dim" : "") + (onClick ? " clickable" : "")}
      onClick={onClick}
      style={style}
      whileHover={onClick ? { y: -10 } : undefined}
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

export function Chips({ amount, small }: { amount: number; small?: boolean }) {
  const stacks = Math.min(5, Math.max(1, Math.ceil(Math.log10(Math.max(amount, 1)))));
  const colors = ["#c8372d", "#2f78c4", "#1d1f24", "#3a9a4a", "#8a4fbf"];
  return (
    <span className={"chips" + (small ? " small" : "")}>
      <span className="chip-stack">
        {Array.from({ length: stacks }, (_, i) => (
          <span key={i} className="chip" style={{ background: colors[i % colors.length], bottom: i * 3 }} />
        ))}
      </span>
      <span className="chip-amt">{amount.toLocaleString()}</span>
    </span>
  );
}
