import { roleName, ROLES, type GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { CardBack, Crew, CrewBadge } from "./pieces";

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
      onClick={onClick}
      title={`Hideout ${h + 1}`}
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
  me,
  glow,
  onClick,
  hideoutGlow,
  onHideout,
}: {
  s: GameState;
  seat: number;
  pos: [number, number];
  me: boolean;
  glow?: boolean;
  onClick?: () => void;
  hideoutGlow?: boolean;
  onHideout?: (h: number) => void;
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
      className={"seat" + (me ? " me" : "") + (glow ? " glow" : "") + (onClick ? " clickable" : "") + (isBoss ? " boss" : "") + (isMark ? " mark" : "") + (winner ? " winner" : "")}
      style={{ left: pos[0], top: pos[1] }}
      onClick={onClick}
      layout={false}
    >
      <div className="seat-top">
        <div className="seat-avatar" data-anchor={`seat-${seat}`}>
          <CrewBadge color={P.color} size={42} />
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
          </div>
          <div className="seat-role" title={role?.text}>
            {roleName(P.role)}
          </div>
        </div>
        <div className="seat-fh" title={`${fh} of ${s.target} Footholds`}>
          {Array.from({ length: s.target }, (_, i) => (
            <span key={i} className={"pip" + (i < fh ? " on" : "")} />
          ))}
        </div>
      </div>
      <div className="seat-stats">
        <span className="stat" title="Cards in hand">
          <span className="mini-back" />
          {P.hand.length}
        </span>
        <span className="stat cash" title="Banked cash" data-anchor={`bank-${seat}`}>
          ${cash}
        </span>
        <span className="stat" title="Crew at home" data-anchor={`home-${seat}`}>
          <Crew color={P.color} size={13} />
          {home}
        </span>
        <span className="stat dim" title="In the Pen / in reserve">
          Pen {P.pen} · Res {P.reserve}
        </span>
      </div>
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
      {!me && P.bank.length > 0 && (
        <div className="seat-bank" title="Banked cards (cash)">
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
