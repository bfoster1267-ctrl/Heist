import { cosmetic, rarityOf, type Cosmetic, type Rarity } from "@heist/profile";
import { useId, type CSSProperties } from "react";
import { Avatar } from "./bits";
import { VaultGlass, isVault } from "../vault";
import { Emoji } from "../emoji";
import { t } from "../i18n";

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const icon = rarity === "legendary" ? "✦" : rarity === "epic" ? "★" : rarity === "rare" ? "◆" : "•";
  return (
    <span className={`rarity-pill ${rarity}`}>
      {icon} {t(`rarity.${rarity}` as any) || rarity}
    </span>
  );
}

/** A banner's background: its pattern over a two-color gradient. */
export function bannerStyle(id: string | undefined): CSSProperties | undefined {
  const c = id ? cosmetic(id) : undefined;
  if (!c?.colors) return undefined;
  const [a, b] = c.colors;
  const line = "rgba(255, 255, 255, 0.10)";
  const overlay: Record<string, string> = {
    stripes: `repeating-linear-gradient(135deg, ${line} 0 10px, transparent 10px 26px)`,
    pinstripe: `repeating-linear-gradient(90deg, ${line} 0 1px, transparent 1px 14px)`,
    diamonds: `repeating-linear-gradient(45deg, ${line} 0 1px, transparent 1px 16px), repeating-linear-gradient(-45deg, ${line} 0 1px, transparent 1px 16px)`,
    deco: `repeating-radial-gradient(circle at 50% 120%, ${line} 0 2px, transparent 2px 18px)`,
    chevron: `linear-gradient(135deg, ${line} 25%, transparent 25%) -12px 0 / 24px 24px, linear-gradient(225deg, ${line} 25%, transparent 25%) -12px 0 / 24px 24px`,
  };
  return { background: `${overlay[c.pattern ?? ""] ?? ""}${overlay[c.pattern ?? ""] ? ", " : ""}linear-gradient(110deg, ${a}, ${b})` };
}

export const chatStyle = (c: Cosmetic | undefined): CSSProperties =>
  c?.chat ? { ["--chat-bg" as string]: c.chat[0], ["--chat-ink" as string]: c.chat[1], ["--chat-edge" as string]: c.chat[2] } : {};

/** Mix two #rrggbb colors; p is the share of the first. */
const mix = (a: string, b: string, p: number) => {
  const ch = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return "#" + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
};

/** A lit cigar: round-shaded wrapper with leaf seams, a gold band with its color and an H crest, ash, a glowing ember, drifting smoke. */
export function Cigar({ id, size = 34 }: { id: string | undefined; size?: number }) {
  const u = useId().replace(/:/g, "");
  const c = id ? cosmetic(id) : undefined;
  if (!c?.colors) return null;
  const [band, wrapper] = c.colors;
  return (
    <svg className="cigar" viewBox="0 0 120 44" width={size} height={(size * 44) / 120} overflow="visible" aria-label={c.name}>
      <defs>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(wrapper, "#000000", 0.55)} />
          <stop offset=".28" stopColor={mix(wrapper, "#ffd9a8", 0.7)} />
          <stop offset=".5" stopColor={wrapper} />
          <stop offset=".85" stopColor={mix(wrapper, "#000000", 0.5)} />
          <stop offset="1" stopColor={mix(wrapper, "#000000", 0.3)} />
        </linearGradient>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b4508" />
          <stop offset=".25" stopColor="#fff0b8" />
          <stop offset=".45" stopColor="#e2ad3c" />
          <stop offset=".8" stopColor="#7a4f0a" />
          <stop offset="1" stopColor="#3b2503" />
        </linearGradient>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(band, "#000000", 0.4)} />
          <stop offset=".3" stopColor={mix(band, "#ffffff", 0.8)} />
          <stop offset=".55" stopColor={band} />
          <stop offset="1" stopColor={mix(band, "#000000", 0.35)} />
        </linearGradient>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4a4a" />
          <stop offset=".3" stopColor="#d9d6d0" />
          <stop offset=".6" stopColor="#9c9893" />
          <stop offset="1" stopColor="#3a3836" />
        </linearGradient>
        <radialGradient id={`${u}e`}>
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset=".35" stopColor="#ffb12e" />
          <stop offset=".7" stopColor="#ff4a12" />
          <stop offset="1" stopColor="#7a1200" stopOpacity="0" />
        </radialGradient>
        <filter id={`${u}g`} x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id={`${u}s`} x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <clipPath id={`${u}k`}>
          <rect x="4" y="18" width="98" height="16" rx="8" />
        </clipPath>
      </defs>
      <ellipse cx="56" cy="38.5" rx="52" ry="3" fill="rgba(0,0,0,.45)" filter={`url(#${u}s)`} />
      <g className="cigar-smoke" filter={`url(#${u}s)`} fill="none" strokeLinecap="round">
        <path d="M111 21 C104 12, 118 8, 110 -1 S112 -12, 106 -18" stroke="rgba(235,235,240,.35)" strokeWidth="2.4" />
        <path d="M112 20 C118 13, 106 6, 114 -3" stroke="rgba(235,235,240,.22)" strokeWidth="1.6" />
      </g>
      <rect x="4" y="18" width="98" height="16" rx="8" fill={`url(#${u}w)`} />
      <g clipPath={`url(#${u}k)`} fill="none" strokeWidth=".7">
        <path d="M14 18 L22 34 M34 18 L42 34 M58 18 L66 34 M80 18 L88 34" stroke="rgba(0,0,0,.28)" />
        <path d="M10 26 Q30 24 50 27 T96 25" stroke="rgba(255,220,180,.10)" />
      </g>
      <rect x="24" y="17" width="16" height="18" rx="1.6" fill={`url(#${u}b)`} />
      <rect x="26.5" y="17" width="11" height="18" fill={`url(#${u}c)`} />
      <circle cx="32" cy="26" r="4.3" fill={`url(#${u}b)`} stroke="rgba(40,25,0,.6)" strokeWidth=".5" />
      <text x="32" y="28.2" fontFamily="Bebas Neue, Impact, sans-serif" fontSize="6.2" textAnchor="middle" fill="#4a3005">
        H
      </text>
      <rect x="98" y="18" width="9" height="16" rx="3" fill={`url(#${u}a)`} />
      <circle className="cigar-ember" cx="108" cy="26" r="6.5" fill={`url(#${u}e)`} filter={`url(#${u}g)`} />
      <ellipse cx="107.4" cy="26" rx="1.8" ry="7" fill="#ff6a1f" />
      <ellipse cx="107.6" cy="25" rx=".9" ry="4" fill="#ffd36b" />
    </svg>
  );
}

export function Preview({ c, name }: { c: Cosmetic; name: string }) {
  const [a, b] = c.colors ?? ["#333", "#111"];
  switch (c.slot) {
    case "felt":
      return <div className="acct-prev acct-prev-felt" style={{ background: `radial-gradient(ellipse at 50% 40%, ${a}, ${b})` }} />;
    case "cardBack":
      return (
        <div className="acct-prev acct-prev-backwrap">
          <div className="acct-prev-back" data-pattern={c.pattern} style={{ ["--back" as string]: a, ["--back2" as string]: b }}>
            <span>H</span>
          </div>
        </div>
      );
    case "frame":
      return (
        <div className="acct-prev acct-prev-frame">
          <Avatar name={name} frame={c.id} size={50} />
        </div>
      );
    case "chat":
      return (
        <div className="acct-prev acct-prev-title">
          <span className="acct-prev-chat" style={chatStyle(c)}>
            {t("wardrobe.preview_chat")}
          </span>
        </div>
      );
    case "banner": {
      const worn = bannerStyle(c.id);
      return <div className={"acct-prev acct-prev-banner" + (worn ? " worn" : "")} style={worn ?? { background: "rgba(255,255,255,0.04)" }} />;
    }
    case "cigar":
      return <div className="acct-prev acct-prev-title">{c.colors ? <Cigar id={c.id} size={70} /> : "—"}</div>;
    case "drink":
      if (c.emoji && isVault(c.emoji))
        return (
          <div className="acct-prev acct-prev-title acct-prev-legendary">
            <VaultGlass size={44} />
          </div>
        );
      return <div className="acct-prev acct-prev-title acct-prev-emoji">{c.emoji && <Emoji e={c.emoji} />}</div>;
    case "emote":
      return <div className="acct-prev acct-prev-title acct-prev-emoji">{c.emoji && <Emoji e={c.emoji} />}</div>;
    default:
      return <div className="acct-prev acct-prev-title">{c.text ? `“${c.text}”` : "—"}</div>;
  }
}
