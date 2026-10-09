import { useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "./api";

export const num = (n: number | undefined | null) => (n ?? 0).toLocaleString("en-US");

export function ago(at: number | null | undefined, now = Date.now()): string {
  if (!at) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const when = (at: number) =>
  new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
export const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function go(path: string) {
  location.hash = path;
}

export function Link({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={`#${to}`} className={className}>
      {children}
    </a>
  );
}

/** A big number with its label. */
export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "gold" | "cash" | "red" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub !== undefined && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** One series of columns over days, with a hover tooltip. Single series, so no legend: the title names it. */
export function Columns({ title, rows, total }: { title: string; rows: { label: string; value: number }[]; total?: React.ReactNode }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 380;
  const H = 130;
  const pad = { l: 34, r: 6, t: 10, b: 22 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const band = (W - pad.l - pad.r) / rows.length;
  const bar = Math.max(2, Math.min(16, band - 2));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="card chart">
      <div className="chart-head">
        <h3>{title}</h3>
        <div className="chart-total">{h ? `${h.label}: ${num(h.value)}` : total}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="tick" textAnchor="end">
              {num(t)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = pad.l + i * band + (band - bar) / 2;
          const top = y(r.value);
          const base = y(0);
          const hgt = base - top;
          const rad = Math.min(4, hgt);
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={pad.l + i * band} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
              {r.value > 0 && (
                <path
                  className={`col ${hover === i ? "on" : ""}`}
                  d={`M${x},${base} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + bar - rad} Q${x + bar},${top} ${x + bar},${top + rad} V${base} Z`}
                />
              )}
              {(i === rows.length - 1 || (i % 7 === 0 && rows.length - 1 - i >= 4)) && (
                <text x={pad.l + i * band + band / 2} y={H - 6} className="tick" textAnchor="middle">
                  {r.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
  return Math.max(1, 10 * p);
}

/** Re-run `load` now and every `ms` while `on`. */
export function usePoll(load: () => void, ms: number, on = true) {
  const f = useRef(load);
  f.current = load;
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => f.current(), ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

// ------------------------------------------------------------------ activity in words

/** Families of activity, for filters and badge colors. Prefixes match the server's kinds. */
export const FAMILIES: { id: string; label: string; kinds: string[] }[] = [
  { id: "acct", label: "Sign-ins & account", kinds: ["auth.", "me.", "app.open"] },
  { id: "money", label: "Shop, packs & chips", kinds: ["shop.", "season.", "chips.", "prestige", "solo.drink"] },
  { id: "games", label: "Games", kinds: ["game.", "solo."] },
  { id: "tables", label: "Online tables & chat", kinds: ["table.", "online."] },
  { id: "app", label: "Screens & taps", kinds: ["ui."] },
  { id: "views", label: "Profiles & boards viewed", kinds: ["view."] },
  { id: "admin", label: "Admin sign-ins", kinds: ["admin."] },
];

export function familyOf(kind: string) {
  return FAMILIES.find((f) => f.kinds.some((k) => (k.endsWith(".") ? kind.startsWith(k) : kind === k)))?.id ?? "other";
}

const LABELS: Record<string, string> = {
  "auth.register": "Signed up (email)",
  "auth.login": "Signed in",
  "auth.guest": "Opened as guest",
  "auth.oauth": "Signed in with provider",
  "auth.dev": "Dev sign-in",
  "auth.signout-everywhere": "Signed out everywhere",
  "app.open": "Opened the app",
  "me.name": "Changed name",
  "me.password": "Changed password",
  "me.delete": "Deleted account",
  "shop.buy": "Bought",
  "shop.equip": "Equipped",
  "season.pack": "Opened a pack",
  "chips.refill": "Refilled chips",
  "chips.daily": "Daily chips",
  prestige: "Prestiged",
  "solo.start": "Sat down vs bots",
  "solo.finish": "Finished vs bots",
  "solo.quit": "Walked out vs bots",
  "solo.drink": "Bought a drink (vs bots)",
  "game.solo": "Game vs bots",
  "game.online": "Online game",
  "online.connect": "Connected to online play",
  "online.disconnect": "Disconnected",
  "table.create": "Opened a table",
  "table.join": "Joined a table",
  "table.leave": "Left the table",
  "table.start": "Started the game",
  "table.queue": "Joined the quick queue",
  "table.unqueue": "Left the quick queue",
  "table.sit": "Took a seat",
  "table.autopilot": "Autopilot",
  "table.chat": "Chat",
  "table.drink": "Sent a drink",
  "ui.screen": "Screen",
  "ui.tap": "Tapped",
  "view.player": "Viewed a profile",
  "view.leaderboard": "Viewed the leaderboard",
  "admin.login": "Admin sign-in",
};

export const labelOf = (kind: string) => LABELS[kind] ?? kind;

/** The interesting part of an event, in a few words. */
export function detailOf(e: ActivityEvent): string {
  const d = (e.data ?? {}) as Record<string, any>;
  const chips = (n: unknown) => `${num(Number(n))} chips`;
  switch (e.kind) {
    case "auth.register":
    case "auth.login":
      return d.email ?? "";
    case "shop.buy":
    case "shop.equip":
      return String(d.id ?? "");
    case "season.pack":
      return [d.paid ? "bought with chips" : "free", Array.isArray(d.items) ? d.items.join(", ") : ""].filter(Boolean).join(" · ");
    case "chips.daily":
      return d.chips ? `+${chips(d.chips)}` : "";
    case "solo.start":
      return d.campaign != null ? `campaign stage ${d.campaign}` : `${d.players} players · ${chips(d.stakes)}`;
    case "game.solo":
    case "game.online":
      return [
        d.abandoned ? "ABANDONED" : d.quit ? "quit" : d.won ? "WON" : "lost",
        `${d.players}p`,
        d.stakes ? `buy-in ${num(d.stakes)}` : "free",
        d.payout ? `paid ${num(d.payout)}` : "",
        d.xp ? `+${d.xp} XP` : "",
        d.minutes ? `${d.minutes} min` : "",
      ].filter(Boolean).join(" · ");
    case "solo.finish":
    case "solo.quit":
      return [d.moves ? `${d.moves} moves` : "", d.reward ? `+${d.reward.xp} XP` : "", d.reward?.payout ? `paid ${num(d.reward.payout)}` : ""].filter(Boolean).join(" · ");
    case "table.chat":
      return `“${d.text ?? ""}”`;
    case "table.create":
      return d.options ? `${d.options.players ?? "?"} players · ${chips(d.options.stakes ?? 0)}` : "";
    case "table.join":
      return String(d.code ?? "");
    case "table.queue":
      return `${d.players} players · ${chips(d.stakes)}`;
    case "table.drink":
      return String(d.id ?? "");
    case "table.autopilot":
      return d.on ? "on" : "off";
    case "ui.screen":
    case "ui.tap":
      return String(d.name ?? "");
    case "me.name":
      return String(d.name ?? "");
    case "admin.login":
      return String(d.user ?? "");
    default: {
      const rest = Object.entries(d).filter(([k]) => k !== "balance" && k !== "clientAt");
      return rest.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ").slice(0, 140);
    }
  }
}
