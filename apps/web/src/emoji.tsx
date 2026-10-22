// Drinks and emotes drawn as Microsoft's Fluent 3D emoji (MIT license, see /emoji/LICENSE-fluentui-emoji.txt)
// instead of the phone's own emoji font, so they look the same glossy way on every device. Anything without
// a picture falls back to the plain emoji.

const FILES: Record<string, string> = {
  "🃏": "joker",
  "🎲": "dice",
  "💎": "gem",
  "🕶️": "shades",
  "🚨": "siren",
  "🗝️": "key",
  "💼": "briefcase",
  "🎩": "tophat",
  "🍀": "clover",
  "🔥": "fire",
  "🤫": "hush",
  "🐀": "rat",
  "😎": "cool",
  "😂": "lol",
  "😡": "mad",
  "🤝": "deal",
  "👀": "eyes",
  "💰": "money",
  "😱": "scream",
  "🫡": "salute",
  "🍷": "wine",
  "🍹": "maitai",
  "🥂": "toast",
  "🍶": "sake",
  "🍵": "tea",
  "🧋": "boba",
  "🥛": "milk",
  "🧃": "juice",
  "☕": "coffee",
  "🍺": "beer",
  "🥃": "whiskey",
  "🍸": "martini",
  "🍾": "champagne",
};

const strip = (e: string) => e.replace(/️/g, "");
const BY_GLYPH = new Map(Object.entries(FILES).map(([e, f]) => [strip(e), f]));

export const emojiSrc = (e: string) => {
  const f = BY_GLYPH.get(strip(e));
  return f ? `/emoji/${f}.webp` : undefined;
};

/** An emoji as its 3D picture, sized like text at `size` px. */
export function Emoji({ e, size, className = "" }: { e: string; size?: number; className?: string }) {
  const src = emojiSrc(e);
  if (!src) return <>{e}</>;
  return (
    <img
      className={"emoji3d " + className}
      src={src}
      alt={e}
      draggable={false}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}
