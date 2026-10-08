// Line icons matching the printed cards (game/v3/build_v3.py): one per Role, plus the Job card marks.
// Drawn on a 100x100 grid, stroke in currentColor so they take the card's accent.
import type { RoleId } from "@heist/engine";
import type { ReactNode } from "react";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const F = { fill: "currentColor" };

const ROLE_ICONS: Record<RoleId, ReactNode> = {
  muscle: (
    <>
      <rect x="10" y="34" width="12" height="32" rx="3" {...F} />
      <rect x="22" y="40" width="9" height="20" rx="2" {...F} />
      <rect x="78" y="34" width="12" height="32" rx="3" {...F} />
      <rect x="69" y="40" width="9" height="20" rx="2" {...F} />
      <rect x="31" y="46" width="38" height="8" {...F} />
    </>
  ),
  getaway: (
    <>
      <path d="M12 62 V50 L24 46 L34 32 H64 L76 46 L88 50 V62 Z" {...F} />
      <circle cx="30" cy="64" r="9" fill="#13233a" stroke="currentColor" strokeWidth="5" />
      <circle cx="70" cy="64" r="9" fill="#13233a" stroke="currentColor" strokeWidth="5" />
      <path d="M38 36 H50 V46 H31 Z M54 36 H62 L70 46 H54 Z" fill="#13233a" />
    </>
  ),
  safecracker: (
    <>
      <rect x="16" y="16" width="68" height="64" rx="6" {...S} />
      <circle cx="50" cy="48" r="17" {...S} />
      <circle cx="50" cy="48" r="5" {...F} />
      <path d="M24 80 V88 M76 80 V88" {...S} />
    </>
  ),
  mastermind: (
    <>
      <path d="M50 14 a24 24 0 0 1 14 43 V66 H36 V57 A24 24 0 0 1 50 14 Z" {...S} />
      <path d="M40 76 H60 M43 86 H57" {...S} />
      <path d="M52 26 L42 44 H54 L46 58" {...S} strokeWidth={5} />
    </>
  ),
  forger: (
    <>
      <path d="M78 12 C46 20 30 46 26 78 C48 66 70 46 78 12 Z" {...F} />
      <path d="M22 88 L46 54" {...S} stroke="#13233a" strokeWidth={4} />
      <path d="M18 92 L30 74" {...S} />
    </>
  ),
  pickpocket: (
    <>
      <rect x="14" y="34" width="72" height="46" rx="7" {...F} />
      <rect x="60" y="48" width="26" height="18" rx="4" fill="#13233a" />
      <circle cx="70" cy="57" r="4" {...F} />
      <rect x="26" y="18" width="40" height="18" rx="3" fill="#e7b53c" />
    </>
  ),
  inside_man: (
    <>
      <rect x="22" y="14" width="56" height="74" rx="7" {...S} />
      <path d="M40 14 V24 H60 V14" {...S} />
      <circle cx="50" cy="44" r="9" {...F} />
      <path d="M34 72 C36 58 64 58 66 72 Z" {...F} />
    </>
  ),
  bookie: (
    <>
      <rect x="20" y="16" width="60" height="72" rx="6" {...S} />
      <path d="M38 12 H62 V22 H38 Z" {...F} />
      <text x="50" y="56" textAnchor="middle" fontFamily="Bebas Neue, Impact, sans-serif" fontSize="26" fill="currentColor">
        2:1
      </text>
      <path d="M32 70 H68 M32 79 H58" {...S} strokeWidth={4} />
    </>
  ),
  hacker: (
    <>
      <rect x="18" y="20" width="64" height="44" rx="5" {...S} />
      <path d="M8 76 H92 L84 84 H16 Z" {...F} />
      <text x="50" y="49" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="800" fontSize="16" fill="currentColor">
        01#
      </text>
    </>
  ),
  lookout: (
    <>
      <circle cx="30" cy="60" r="18" {...S} />
      <circle cx="70" cy="60" r="18" {...S} />
      <path d="M22 44 L32 22 H44 L48 46 M78 44 L68 22 H56 L52 46" {...S} />
    </>
  ),
  fence: (
    <>
      <path d="M48 12 H84 V48 L48 86 L12 50 Z" {...F} />
      <circle cx="70" cy="28" r="6" fill="#13233a" />
      <text x="47" y="62" textAnchor="middle" fontFamily="Bebas Neue, Impact, sans-serif" fontSize="34" fill="#13233a" transform="rotate(-45 47 52)">
        $
      </text>
    </>
  ),
  double_agent: (
    <>
      <path d="M8 40 C22 30 38 32 50 40 C62 32 78 30 92 40 C90 58 76 66 62 60 C56 57 54 52 50 52 C46 52 44 57 38 60 C24 66 10 58 8 40 Z" {...F} />
      <ellipse cx="30" cy="46" rx="8" ry="5" fill="#13233a" />
      <ellipse cx="70" cy="46" rx="8" ry="5" fill="#13233a" />
    </>
  ),
  wildcard: (
    <>
      <rect x="22" y="12" width="56" height="76" rx="6" {...S} />
      <polygon points="50,28 56,44 73,44 59,54 64,71 50,61 36,71 41,54 27,44 44,44" fill="#d6452b" />
    </>
  ),
};

export function RoleIcon({ role, size = 40 }: { role: RoleId; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {ROLE_ICONS[role]}
    </svg>
  );
}

export function FixerIcon({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <path d="M14 36 H74 M60 22 L76 36 L60 50" {...S} strokeWidth={10} />
      <path d="M86 66 H26 M40 52 L24 66 L40 80" {...S} strokeWidth={10} />
    </svg>
  );
}

export function SwitchIcon({ size = 40 }: { size?: number }) {
  const person = (x: number, fill: string) => (
    <g fill={fill}>
      <circle cx={x} cy="34" r="11" />
      <path d={`M${x - 19} 76 C${x - 18} 52 ${x + 18} 52 ${x + 19} 76 Z`} />
    </g>
  );
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {person(24, "#f2e8d3")}
      {person(76, "#d6452b")}
      <path d="M42 46 H58 M53 40 L59 46 L53 52 M58 60 H42 M47 54 L41 60 L47 66" {...S} stroke="#e7b53c" strokeWidth={4} />
    </svg>
  );
}

export function Keyhole({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle cx="50" cy="42" r="12" fill="currentColor" />
      <path d="M44 48 H56 L60 72 H40 Z" fill="currentColor" />
    </svg>
  );
}

export function Trophy({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <path d="M28 12 H72 V40 A22 22 0 0 1 28 40 Z" fill="currentColor" />
      <path d="M28 20 H14 C14 40 22 46 30 46 M72 20 H86 C86 40 78 46 70 46" fill="none" stroke="currentColor" strokeWidth="7" />
      <path d="M44 62 H56 V76 H66 V88 H34 V76 H44 Z" fill="currentColor" />
    </svg>
  );
}

export function People({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden fill="currentColor">
      <circle cx="28" cy="34" r="11" />
      <circle cx="72" cy="34" r="11" />
      <circle cx="50" cy="42" r="14" />
      <path d="M8 76 C8 56 44 54 46 70 Z M92 76 C92 56 56 54 54 70 Z M24 88 C24 58 76 58 76 88 Z" />
    </svg>
  );
}
