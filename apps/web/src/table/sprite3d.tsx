// Drinks and chips rendered in Blender (scripts/blender: anim.py renders the frames, sprites.py packs
// them). Each lives in /3d/ as a strip of frames side by side, played with CSS steps(), plus a still of
// its resting frame. A drink's strip is it rocking to a stop after it lands; a chip's is one full tumble.
import type { CSSProperties } from "react";
import { reducedMotion } from "../prefs";

interface Sheet {
  file: string;
  frames: number;
  /** one frame's size in the file, px */
  w: number;
  h: number;
}

const drink = (id: string, w: number): Sheet => ({ file: `drink-${id}`, frames: 18, w, h: 112 });
const DRINKS: Record<string, Sheet> = {
  "🏦": drink("vault", 106),
  "🥃": drink("whiskey", 106),
  "🍷": drink("wine", 67),
  "🍸": drink("martini", 87),
  "🍺": drink("beer", 84),
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
function Sprite({ s, height, mode, className }: { s: Sheet; height: number; mode: "still" | "once" | "loop"; className?: string }) {
  const w = (s.w * height) / s.h;
  if (mode === "still" || reducedMotion())
    return <img className={"sprite3d " + (className ?? "")} src={`/3d/${s.file}-still.webp`} width={w} height={height} alt="" draggable={false} />;
  const style = {
    width: w,
    height,
    backgroundImage: `url(/3d/${s.file}.webp)`,
    backgroundSize: `${w * s.frames}px ${height}px`,
    ["--sprite-end" as string]: mode === "once" ? `${-w * (s.frames - 1)}px` : `${-w * s.frames}px`,
    animation: mode === "once" ? `sprite3d ${s.frames * 45}ms steps(${s.frames - 1}) forwards` : `sprite3d ${s.frames * 40}ms steps(${s.frames}) infinite`,
  } as CSSProperties;
  return <span className={"sprite3d " + (className ?? "")} style={style} />;
}

/** A Blender drink: `settle` plays it rocking to a stop (when it lands), otherwise it stands still. */
export function Drink3D({ emoji, height, settle = false }: { emoji: string; height: number; settle?: boolean }) {
  const s = DRINKS[emoji];
  return s ? <Sprite s={s} height={height} mode={settle ? "once" : "still"} className="drink3d" /> : null;
}

/** A Blender chip tumbling through the air. */
export function Chip3D({ color, size }: { color: string; size: number }) {
  const s = CHIPS[color];
  return s ? <Sprite s={s} height={size} mode="loop" /> : null;
}
