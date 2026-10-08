import { roleName, ROLES, type GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { Cigar } from "../account/items";
import { CardBack, CountUp, Crew, CrewBadge } from "./pieces";

/** Click-or-keyboard props for a table element that acts like a button. */
export function pressable(onClick?: () => void, label?: string) {
  if (!onClick) return {};
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }
    },
  };
}

export function footholdsOf(s: GameState, p: number) {
  let k = 0;
  for (const q of s.players) if (q.seat !== p) for (const h of q.hideouts) if (h[p] > 0) k++;
  return k;
}

export function Hideout({
  s,
  owner,
  h,
  glow,
  onClick,
  big,
}: {
  s: GameState;
  owner: number;
  h: number;
  glow?: boolean;
  onClick?: () => void;
  big?: boolean;
}) {
  const H = s.players[owner].hideouts[h];
  const j = s.job;
  const targeted = j && j.kind === "hit" && j.mark === owner && j.hideout === h;
  const busted = j && j.kind === "bust" && j.boss === owner && j.hideout === h;
  const entries = H.map((k, seat) => ({ k, seat })).filter((e) => e.k > 0).sort((a, b) => (a.seat === owner ? -1 : b.seat === owner ? 1 : 0));
  return (
    <div
      data-anchor={`hideout-${owner}-${h}`}
      className={"hideout" + (glow ? " glow" : "") + (targeted || busted ? " targeted" : "") + (onClick ? " clickable" : "") + (big ? " big" : "")}
      data-tip={`${s.players[owner].name}'s hideout ${h + 1}\n${entries.map(({ k, seat }) => `${k} ${s.players[seat].name}${seat === owner ? " (home)" : " (Foothold)"}`).join(", ") || "Empty"}`}
      {...pressable(onClick, `Hideout ${h + 1}`)}
    >
      <span className="hideout-num">{h + 1}</span>
      {entries.length === 0 && <span className="hideout-empty">empty</span>}
      {entries.map(({ k, seat }) => (
        <span key={seat} className={"hideout-entry" + (seat !== owner ? " foothold" : "")}>
          <Crew color={s.players[seat].color} size={big ? 18 : 14} />
          {k > 1 && <span className="hideout-k">{k}</span>}
        </span>
      ))}
    </div>
  );
}

export function Seat({
  s,
  seat,
  pos,
  grow,
  me,
  glow,
  onClick,
  hideoutGlow,
  onHideout,
  acting,
  showBank,
  away,
  cigar,
}: {
  s: GameState;
  seat: number;
  pos: [number, number];
  grow?: React.CSSProperties;
  me: boolean;
  glow?: boolean;
  onClick?: () => void;
  hideoutGlow?: boolean;
  onHideout?: (h: number) => void;
  acting?: boolean;
  showBank?: boolean;
  /** online: the player has dropped ("away") or a bot is playing for them ("bot") */
  away?: "away" | "bot";
  /** your equipped cigar, resting by your avatar */
  cigar?: string;
}) {
  const P = s.players[seat];
  const j = s.job;
  const isBoss = s.boss === seat && s.phase !== "setup";
  const isMark = !!j && j.mark === seat && j.kind === "hit";
  const fh = footholdsOf(s, seat);
  const cash = P.bank.reduce((a, c) => a + c.cash, 0);
  const home = P.hideouts.reduce((a, h) => a + h[seat], 0);
  const role = ROLES.find((r) => r.id === P.role);
  const winner = s.winners?.includes(seat);
  return (
    <motion.div
      className={"seat" + (me ? " me" : "") + (glow ? " glow" : "") + (onClick ? " clickable" : "") + (isBoss ? " boss" : "") + (isMark ? " mark" : "") + (winner ? " winner" : "") + (acting ? " acting" : "")}
      style={{ left: pos[0], top: pos[1], ...grow }}
      layout={false}
      data-anchor={me ? "my-seat" : undefined}
      {...pressable(onClick, `Pick ${P.name} as the Mark`)}
    >
      <div className="seat-top">
        <div className="seat-avatar" data-anchor={`seat-${seat}`}>
          <CrewBadge color={P.color} size={42} />
          {cigar && <span className="seat-cigar"><Cigar id={cigar} size={30} /></span>}
          {acting && !me && (
            <span className="thinking" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          )}
          <AnimatePresence>
            {isBoss && (
              <motion.span key="boss" className="tag tag-boss" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                BOSS
              </motion.span>
            )}
            {isMark && (
              <motion.span key="mark" className="tag tag-mark" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                MARK
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="seat-id">
          <div className="seat-name">
            {P.name}
            {me && <span className="you-tag">YOU</span>}
            {away && (
              <span className="away-tag" data-tip={away === "bot" ? "A bot is playing this seat until they're back" : "Lost connection. Their seat is held."}>
                {away === "bot" ? "AUTO" : "AWAY"}
              </span>
            )}
          </div>
          <div className="seat-role" data-tip-role={role?.id} tabIndex={role ? 0 : undefined}>
            {/* "The Getaway Driver" doesn't fit next to the Footholds; the seat shows "Getaway Driver" */}
            {roleName(P.role).replace(/^The /, "")}
          </div>
        </div>
        <div className="seat-fh" data-anchor={me ? "my-fh" : undefined} data-tip={`Footholds: ${fh} of ${s.target}\nCrew living in rival hideouts. ${s.target} wins.`} aria-label={`${fh} of ${s.target} Footholds`}>
          <span className="fh-k">
            Footholds {fh}/{s.target}
          </span>
          <span className="fh-pips">
          {Array.from({ length: s.target }, (_, i) => (
            <motion.span key={i + (i < fh ? "on" : "")} className={"pip" + (i < fh ? " on" : "")} initial={i < fh ? { scale: 2.4 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 12 }} />
          ))}
          </span>
        </div>
      </div>
      <div className="seat-stats">
        <span className="stat" data-tip="Cards in hand">
          <span className="stat-v">
            <span className="mini-back" />
            {P.hand.length}
          </span>
          <span className="stat-k">Cards</span>
        </span>
        <span className="stat cash" data-tip="Banked cash\nSpent on crew and bets. Thieves take loot from it." data-anchor={`bank-${seat}`}>
          <span className="stat-v">
            <CountUp value={cash} prefix="$" />
          </span>
          <span className="stat-k">Cash</span>
        </span>
        <span className="stat" data-tip="Crew at home\nIn your own hideouts, ready to send." data-anchor={`home-${seat}`}>
          <span className="stat-v">
            <Crew color={P.color} size={13} />
            {home}
          </span>
          <span className="stat-k">Home</span>
        </span>
        <span className="stat dim" data-tip="Crew in the Pen\nCaught crew. One leaves the Pen each turn.">
          <span className="stat-v">{P.pen}</span>
          <span className="stat-k">Pen</span>
        </span>
        <span className="stat dim" data-tip="Crew in reserve\nNot on the table yet. Hire them with cash.">
          <span className="stat-v">{P.reserve}</span>
          <span className="stat-k">Spare</span>
        </span>
      </div>
      <div className="seat-sub">Hideouts</div>
      <div className="seat-hideouts">
        {P.hideouts.map((_, h) => (
          <Hideout key={h} s={s} owner={seat} h={h} glow={hideoutGlow} onClick={onHideout ? () => onHideout(h) : undefined} />
        ))}
      </div>
      {!me && (
        <div className="seat-hand">
          {P.hand.slice(0, 7).map((_, i) => (
            <span key={i} className="seat-hand-card" style={{ transform: `rotate(${(i - (Math.min(P.hand.length, 7) - 1) / 2) * 7}deg)` }}>
              <CardBack size="xs" />
            </span>
          ))}
        </div>
      )}
      {(!me || showBank) && P.bank.length > 0 && (
        <div className="seat-bank">
          {P.bank.map((c) => (
            <motion.span key={c.id} className="bank-coin" initial={{ scale: 0 }} animate={{ scale: 1 }}>
              ${c.cash}
            </motion.span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
