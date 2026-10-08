// How each kind of cosmetic looks in the shop, the season locker and pack reveals, plus the pieces that
// show season items elsewhere (a banner behind the profile header, a cigar by your seat).

import { cosmetic, type Cosmetic } from "@heist/profile";
import type { CSSProperties } from "react";
import { Avatar } from "./bits";

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

/** A cigar with its band, lit, with a curl of smoke. */
export function Cigar({ id, size = 34 }: { id: string | undefined; size?: number }) {
  const c = id ? cosmetic(id) : undefined;
  if (!c?.colors) return null;
  const [band, wrapper] = c.colors;
  return (
    <svg className="cigar" viewBox="0 0 60 24" width={size} height={size * 0.4} aria-label={c.name}>
      <path className="cigar-smoke" d="M56 9 C52 4, 60 2, 55 -4" fill="none" stroke="rgba(230,230,230,0.55)" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="2" y="10" width="50" height="9" rx="4.5" fill={wrapper} />
      <rect x="2" y="10" width="50" height="3" rx="1.5" fill="rgba(255,255,255,0.12)" />
      <rect x="14" y="9.5" width="7" height="10" rx="1" fill={band} />
      <rect x="49" y="10" width="5" height="9" rx="2" fill="#9a9a9a" />
      <circle cx="54" cy="14.5" r="2.4" fill="#ff7a2f" />
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
            Nice hit.
          </span>
        </div>
      );
    case "banner":
      return <div className="acct-prev acct-prev-banner" style={bannerStyle(c.id) ?? { background: "rgba(255,255,255,0.04)" }} />;
    case "cigar":
      return <div className="acct-prev acct-prev-title">{c.colors ? <Cigar id={c.id} size={70} /> : "—"}</div>;
    case "emote":
    case "drink":
      return <div className="acct-prev acct-prev-title acct-prev-emoji">{c.emoji}</div>;
    default:
      return <div className="acct-prev acct-prev-title">{c.text ? `“${c.text}”` : "—"}</div>;
  }
}
