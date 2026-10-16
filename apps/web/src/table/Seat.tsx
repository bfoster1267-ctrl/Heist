import { ROLES, type GameState } from "@heist/engine";
import { t } from "../i18n";
import { roleShort } from "../i18n/data";
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
      data-tip={`${t("seat.hideoutTip", { name: s.players[owner].name, n: h + 1 })}\n${entries.map(({ k, seat }) => t(seat === owner ? "seat.home" : "seat.foothold", { k, name: s.players[seat].name })).join(", ") || t("seat.empty")}`}
      {...pressable(onClick, t("seat.hideout", { n: h + 1 }))}
    >
      <span className="hideout-num">{h + 1}</span>
      {entries.length === 0 && <span className="hideout-empty">{t("seat.emptyShort")}</span>}
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
  tag,
  onName,
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
  /** online: the player's ranked rank this season, shown by their name */
  tag?: string;
  /** online: tap the name for the player's profile */
  onName?: () => void;
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
  const atRight = String(grow?.transformOrigin ?? "").startsWith("right");
  return (
    <motion.div
      className={"seat" + (me ? " me" : "") + (glow ? " glow" : "") + (onClick ? " clickable" : "") + (isBoss ? " boss" : "") + (isMark ? " mark" : "") + (winner ? " winner" : "") + (acting ? " acting" : "") + (atRight ? " at-right" : "")}
      style={{ left: pos[0], top: pos[1], ...grow }}
      layout={false}
      data-anchor={me ? "my-seat" : undefined}
      {...pressable(onClick, t("seat.pickMark", { name: P.name }))}
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
                {t("seat.boss")}
              </motion.span>
            )}
            {isMark && (
              <motion.span key="mark" className="tag tag-mark" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                {t("seat.mark")}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="seat-id">
          <div className="seat-name">
            {onName ? (
              <button
                className="seat-name-btn"
                data-tip={t("seat.profile")}
                onClick={(e) => {
                  e.stopPropagation();
                  onName();
                }}
              >
                {P.name}
              </button>
            ) : (
              P.name
            )}
            {me && <span className="you-tag">{t("seat.you")}</span>}
            {away && (
              <span className="away-tag" data-tip={away === "bot" ? t("seat.botTip") : t("seat.awayTip")}>
                {away === "bot" ? t("seat.auto") : t("seat.away")}
              </span>
            )}
          </div>
          <div className="seat-role" data-tip-role={role?.id} tabIndex={role ? 0 : undefined}>
            {tag && <span className="rank-tag">{tag}</span>}
            {/* "The Getaway Driver" doesn't fit next to the Footholds; the seat shows "Getaway Driver" */}
            {roleShort(P.role)}
          </div>
        </div>
        <div className="seat-fh" data-anchor={me ? "my-fh" : undefined} data-tip={t("seat.fhTip", { fh, n: s.target })} aria-label={t("seat.fhAria", { fh, n: s.target })}>
          <span className="fh-k">
            {t("seat.fh", { fh, n: s.target })}
          </span>
          <span className="fh-pips">
          {Array.from({ length: s.target }, (_, i) => (
            <motion.span key={i + (i < fh ? "on" : "")} className={"pip" + (i < fh ? " on" : "")} initial={i < fh ? { scale: 2.4 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 12 }} />
          ))}
          </span>
        </div>
      </div>
      <div className="seat-stats">
        <span className="stat" data-tip={t("seat.cardsTip")}>
          <span className="stat-v">
            <span className="mini-back" />
            {P.hand.length}
          </span>
          <span className="stat-k">{t("seat.cards")}</span>
        </span>
        <span className="stat cash" data-tip={t("seat.cashTip")} data-anchor={`bank-${seat}`}>
          <span className="stat-v">
            <CountUp value={cash} prefix="$" />
          </span>
          <span className="stat-k">{t("seat.cash")}</span>
        </span>
        <span className="stat" data-tip={t("seat.homeTip")} data-anchor={`home-${seat}`}>
          <span className="stat-v">
            <Crew color={P.color} size={13} />
            {home}
          </span>
          <span className="stat-k">{t("seat.homeK")}</span>
        </span>
        <span className="stat dim" data-tip={t("seat.penTip")}>
          <span className="stat-v">{P.pen}</span>
          <span className="stat-k">{t("seat.pen")}</span>
        </span>
        <span className="stat dim" data-tip={t("seat.spareTip")}>
          <span className="stat-v">{P.reserve}</span>
          <span className="stat-k">{t("seat.spare")}</span>
        </span>
      </div>
      <div className="seat-sub">{t("seat.hideouts")}</div>

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
