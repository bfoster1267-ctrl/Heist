// Drinks and chips rendered in Blender (scripts/blender: anim.py renders the frames, sprites.py packs
// them). Each lives in /3d/ as a strip of frames side by side, played with CSS steps(), plus a still of
// its resting frame. A drink has two strips: leaning as it brakes while it slides (-slide), then rocking to a
// stop after it lands; a chip's is one full tumble.
import type { CSSProperties } from "react";
import { reducedMotion } from "../prefs";

interface Sheet {
  file: string;
  frames: number;
  /** one frame's size in the file, px */
  w: number;
  h: number;
  /** shown this much of the asked height (short, wide pieces like a mug would look huge at full height) */
  scale?: number;
}

const drink = (id: string, w: number, scale = 1): Sheet => ({ file: `drink-${id}`, frames: 18, w, h: 112, scale });
const DRINKS: Record<string, Sheet> = {
  "🏦": drink("vault", 109),
  "🥃": drink("whiskey", 108),
  "🍷": drink("wine", 70),
  "🍸": drink("martini", 89),
  "🍺": drink("beer", 87),
  "☕": drink("coffee", 134, 0.75),
  "🍾": drink("champagne", 45),
  "🥂": drink("toast", 75),
  "🍹": drink("maitai", 65),
  "🍶": drink("sake", 92, 0.9),
  "🍵": drink("tea", 166, 0.6),
  "🧋": drink("boba", 61),
  "🥛": drink("milk", 76),
  "🧃": drink("juice", 62),
};

const chip = (id: string): Sheet => ({ file: `chip-${id}`, frames: 12, w: 65, h: 64 });
/** The table's chip colors (Table.tsx CHIP_COLORS) and the payout gold. */
const CHIPS: Record<string, Sheet> = {
  "#c8372d": chip("red"),
  "#2f78c4": chip("blue"),
  "#1d1f24": chip("black"),
  "#3a9a4a": chip("green"),
  "#8a4fbf": chip("purple"),
  "#e7b53c": chip("legendary"),
};

export const has3dDrink = (emoji: string) => emoji in DRINKS;
export const has3dChip = (color: string) => color in CHIPS;

/** One sheet at a given height: still, played once (ending on the last frame), or looping. */
function Sprite({ s, height, mode, className, ms, flip }: { s: Sheet; height: number; mode: "still" | "once" | "loop"; className?: string; ms?: number; flip?: boolean }) {
  height *= s.scale ?? 1;
  const w = (s.w * height) / s.h;
  if (mode === "still" || reducedMotion())
    return <img className={"sprite3d " + (className ?? "")} src={`/3d/${s.file}-still.webp`} width={w} height={height} alt="" draggable={false} />;
  const style = {
    width: w,
    height,
    backgroundImage: `url(/3d/${s.file}.webp)`,
    backgroundSize: `${w * s.frames}px ${height}px`,
    ["--sprite-end" as string]: mode === "once" ? `${-w * (s.frames - 1)}px` : `${-w * s.frames}px`,
    animation: mode === "once" ? `sprite3d ${ms ?? s.frames * 45}ms steps(${s.frames - 1}) forwards` : `sprite3d ${ms ?? s.frames * 40}ms steps(${s.frames}) infinite`,
    ...(flip ? { transform: "scaleX(-1)" } : {}),
  } as CSSProperties;
  return <span className={"sprite3d " + (className ?? "")} style={style} />;
}

/** The lean while sliding: 11 frames, rendered moving left to right (flip it for right to left). */
const SLIDE_FRAMES = 11;

/**
 * A Blender drink: `settle` plays it rocking to a stop (when it lands); `slide` plays it leaning as it
 * brakes over that many ms, mirrored when `flip`; otherwise it stands still.
 */
export function Drink3D({ emoji, height, settle = false, slide, flip }: { emoji: string; height: number; settle?: boolean; slide?: number; flip?: boolean }) {
  const s = DRINKS[emoji];
  if (!s) return null;
  if (slide && !reducedMotion()) return <Sprite s={{ ...s, file: `${s.file}-slide`, frames: SLIDE_FRAMES }} height={height} mode="once" ms={slide} flip={flip} className="drink3d" />;
  return <Sprite s={s} height={height} mode={settle ? "once" : "still"} className="drink3d" />;
}

/** A Blender chip tumbling through the air. */
export function Chip3D({ color, size }: { color: string; size: number }) {
  const s = CHIPS[color];
  return s ? <Sprite s={s} height={size} mode="loop" /> : null;
}
