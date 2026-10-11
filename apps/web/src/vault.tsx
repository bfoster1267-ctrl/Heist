// The Vault: Season 1's legendary drink, the prize at the top of the season pass. It's drawn here
// instead of being an emoji: a gold cocktail with a little vault door on the glass. When it lands at
// someone's seat the door's wheel spins, the door swings open, gold coins splash out and the seat
// glows gold. Everything else about it is an ordinary drink, keyed on its emoji (🏦).
import { VAULT_DRINK } from "@heist/profile";
import { motion } from "motion/react";
import { useId } from "react";

export const VAULT_EMOJI = VAULT_DRINK.emoji!;
export const isVault = (emoji: string) => emoji === VAULT_EMOJI;

/** The glass. `open`: play the landing (wheel spins, door swings open on the coins inside). */
export function VaultGlass({ size = 40, open = false }: { size?: number; open?: boolean }) {
  const id = useId().replace(/:/g, "");
  const gold = `vg-gold-${id}`;
  const door = `vg-door-${id}`;
  return (
    <svg className="vault-glass" viewBox="0 0 64 72" width={size} height={(size * 72) / 64} aria-label={VAULT_DRINK.name} role="img">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9a3" />
          <stop offset="0.55" stopColor="#e7b53c" />
          <stop offset="1" stopColor="#9a6a12" />
        </linearGradient>
        <radialGradient id={door} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fff1c2" />
          <stop offset="0.5" stopColor="#d9a22e" />
          <stop offset="1" stopColor="#7a520c" />
        </radialGradient>
      </defs>
      {/* the drink */}
      <path d="M12.6 28 H51.4 L49.6 64 Q49.4 68 45.6 68 H18.4 Q14.6 68 14.4 64 Z" fill={`url(#${gold})`} />
      <ellipse cx="32" cy="28" rx="19.4" ry="2.6" fill="#fff3c4" opacity="0.8" />
      {/* the vault behind the door, full of coins */}
      <circle cx="32" cy="50" r="12.4" fill="#2b1c05" />
      <g fill="#ffd864" stroke="#8a5d0c" strokeWidth="0.8">
        <ellipse cx="29" cy="53" rx="5" ry="2" />
        <ellipse cx="34" cy="50.5" rx="5" ry="2" />
        <ellipse cx="31" cy="48" rx="5" ry="2" />
      </g>
      {/* the vault door: the wheel spins, then the door swings open on its hinge (left edge) */}
      <motion.g
        style={{ transformOrigin: "19px 50px", transformBox: "view-box" }}
        initial={false}
        animate={open ? { scaleX: [1, 1, 0.18], opacity: [1, 1, 0.9] } : { scaleX: 1 }}
        transition={open ? { duration: 1.3, times: [0, 0.55, 1], ease: "easeInOut", delay: 0.15 } : undefined}
      >
        <circle cx="32" cy="50" r="13" fill={`url(#${door})`} stroke="#5a3b06" strokeWidth="1.2" />
        <circle cx="32" cy="50" r="9.5" fill="none" stroke="#fff1c2" strokeOpacity="0.6" strokeWidth="0.9" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <circle key={a} cx={32 + 11.2 * Math.cos((a * Math.PI) / 180)} cy={50 + 11.2 * Math.sin((a * Math.PI) / 180)} r="0.9" fill="#5a3b06" />
        ))}
        <motion.g
          style={{ transformOrigin: "32px 50px", transformBox: "view-box" }}
          initial={false}
          animate={open ? { rotate: [0, 300] } : { rotate: 0 }}
          transition={open ? { duration: 0.75, ease: [0.3, 0, 0.2, 1], delay: 0.15 } : undefined}
          stroke="#4a3005"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M32 43.5 V56.5 M26.4 46.75 L37.6 53.25 M26.4 53.25 L37.6 46.75" />
          <circle cx="32" cy="50" r="2.4" fill="#ffe9a3" strokeWidth="1" />
        </motion.g>
      </motion.g>
      {/* the glass over it all */}
      <path d="M9.5 12 H54.5 L50.6 64.4 Q50.2 70 44.8 70 H19.2 Q13.8 70 13.4 64.4 Z" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.75)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M15 17 L17.6 62" stroke="rgba(255,255,255,0.45)" strokeWidth="2.2" strokeLinecap="round" />
      {/* a gold coin on the rim */}
      <circle cx="50" cy="11" r="6.5" fill={`url(#${gold})`} stroke="#7a520c" strokeWidth="1" />
      <text x="50" y="13.6" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#7a520c" fontFamily="Georgia, serif">
        H
      </text>
    </svg>
  );
}

// where each coin flies: [dx, dy] in px, a fan above the glass that falls back down
const COINS: [number, number][] = [
  [-46, -38], [-30, -58], [-12, -66], [8, -64], [26, -56], [44, -40], [-56, -12], [56, -14], [-22, -46], [20, -44],
];

/** The splash when the Vault lands: a gold glow at the seat and coins flying out of the glass. */
export function VaultBurst() {
  return (
    <span className="vault-burst" aria-hidden>
      <motion.span
        className="vault-ring"
        initial={{ scale: 0.3, opacity: 0.95 }}
        animate={{ scale: [0.3, 1.5, 1.25], opacity: [0.95, 0.8, 0] }}
        transition={{ duration: 2.6, times: [0, 0.35, 1], ease: "easeOut" }}
      />
      {COINS.map(([dx, dy], i) => (
        <motion.span
          key={i}
          className="vault-coin"
          initial={{ x: 0, y: 0, scale: 0.4, opacity: 0, rotateY: 0 }}
          animate={{ x: [0, dx * 0.7, dx], y: [0, dy, dy + 70], scale: [0.4, 1, 0.8], opacity: [0, 1, 0], rotateY: [0, 360, 720] }}
          transition={{ duration: 1.25, delay: 1 + i * 0.03, times: [0, 0.45, 1], ease: "easeOut" }}
        />
      ))}
    </span>
  );
}
