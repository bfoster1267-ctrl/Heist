// The table on a phone held upright: no felt, one column about the width of the phone. This turn's
// Boss is a big card on top with the job under it, every other player is one row (tap it to open
// their hideouts), and you sit at the bottom under your hand. When you pick the Mark or join a
// fight, the players you're choosing between open up into cards side by side.
// Flights, drinks and bubbles find everyone by the same data-anchors the poker table uses.
import { jobBases, roleName, type GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { CountUp, Crew, CrewBadge } from "./pieces";
import { footholdsOf, Hideout, pressable, useLongPress } from "./Seat";

const cashOf = (s: GameState, p: number) => s.players[p].bank.reduce((a, c) => a + c.cash, 0);
const homeOf = (s: GameState, p: number) => s.players[p].hideouts.reduce((a, h) => a + h[p], 0);

/** What every player view needs. */
interface Who {
  s: GameState;
  seat: number;
  /** online: their ranked rank */
  tag?: string;
  /** online: dropped, or a bot is playing for them */
  away?: "away" | "bot";
  /** press and hold: who's sitting there (SeatPeek) */
  onPeek?: () => void;
}

function Pips({ s, seat, anchor }: { s: GameState; seat: number; anchor?: string }) {
  const fh = footholdsOf(s, seat);
  return (
    <span className="l-pips" data-anchor={anchor} data-tip={`Footholds: ${fh} of ${s.target}\nCrew living in rival hideouts. ${s.target} wins.`} aria-label={`${fh} of ${s.target} Footholds`}>
      {Array.from({ length: s.target }, (_, i) => (
        <motion.span key={i + (i < fh ? "on" : "")} className={"pip" + (i < fh ? " on" : "")} initial={i < fh ? { scale: 2.4 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 12 }} />
      ))}
    </span>
  );
}

/** Boss and Mark tags, rank and away, after a name. */
function Tags({ s, seat, tag, away, me }: { s: GameState; seat: number; tag?: string; away?: "away" | "bot"; me?: boolean }) {
  const j = s.job;
  const boss = s.boss === seat && s.phase !== "setup";
  const mark = !!j && j.kind === "hit" && j.mark === seat;
  return (
    <>
      {me && <span className="you-tag">YOU</span>}
      {boss && <span className="l-tag boss">BOSS</span>}
      {mark && <span className="l-tag mark">MARK</span>}
      {tag && <span className="rank-tag">{tag}</span>}
      {away && (
        <span className="away-tag" data-tip={away === "bot" ? "A bot is playing this seat until they're back" : "Lost connection. Their seat is held."}>
          {away === "bot" ? "AUTO" : "AWAY"}
        </span>
      )}
    </>
  );
}

function Avatar({ s, seat, size, hold, acting }: { s: GameState; seat: number; size: number; hold: ReturnType<typeof useLongPress>; acting?: boolean }) {
  return (
    <span className="l-avatar" data-anchor={`seat-${seat}`} {...hold.props}>
      <CrewBadge color={s.players[seat].color} size={size} />
      {acting && (
        <span className="thinking" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      )}
    </span>
  );
}

function Hideouts({ s, seat, glow, onHideout }: { s: GameState; seat: number; glow?: boolean; onHideout?: (h: number) => void }) {
  return (
    <div className="l-hideouts">
      {s.players[seat].hideouts.map((_, h) => (
        <Hideout key={h} s={s} owner={seat} h={h} counts glow={glow} onClick={onHideout ? () => onHideout(h) : undefined} />
      ))}
    </div>
  );
}

function Stat({ k, children, cls, anchor, tip }: { k: string; children: ReactNode; cls?: string; anchor?: string; tip: string }) {
  return (
    <span className={"l-stat" + (cls ? " " + cls : "")} data-anchor={anchor} data-tip={tip}>
      <span className="l-stat-v">{children}</span>
      <span className="l-stat-k">{k}</span>
    </span>
  );
}

const TIPS = {
  cash: "Banked cash\nSpent on crew and bets. Thieves take loot from it.",
  home: "Crew at home\nIn their own hideouts, ready to send.",
  cards: "Cards in hand",
  pen: "Crew in the Pen\nCaught crew. One leaves the Pen each turn.",
  spare: "Crew in reserve\nNot on the table yet. Hired with cash.",
};

/** This turn's Boss, everything showing. */
export function BossCard({ s, seat, tag, away, onPeek, acting }: Who & { acting?: boolean }) {
  const P = s.players[seat];
  const hold = useLongPress(onPeek);
  return (
    <motion.div key={seat} className={"l-boss" + (s.winners?.includes(seat) ? " winner" : "")} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="l-head">
        <Avatar s={s} seat={seat} size={46} hold={hold} acting={acting} />
        <div className="l-id">
          <div className="l-name" {...hold.props}>
            <span className="l-name-text">{P.name}</span>
            <Tags s={s} seat={seat} tag={tag} away={away} />
          </div>
          <div className="l-role" data-tip-role={P.role ?? undefined} tabIndex={P.role ? 0 : undefined}>
            {roleName(P.role).replace(/^The /, "")}
          </div>
        </div>
        <Pips s={s} seat={seat} />
      </div>
      <div className="l-stats five">
        <Stat k="Cash" cls="cash" anchor={`bank-${seat}`} tip={TIPS.cash}>
          <CountUp value={cashOf(s, seat)} prefix="$" />
        </Stat>
        <Stat k="Home" anchor={`home-${seat}`} tip={TIPS.home}>
          {homeOf(s, seat)}
        </Stat>
        <Stat k="Cards" tip={TIPS.cards}>
          {P.hand.length}
        </Stat>
        <Stat k="Pen" cls="dim" tip={TIPS.pen}>
          {P.pen}
        </Stat>
        <Stat k="Spare" cls="dim" tip={TIPS.spare}>
          {P.reserve}
        </Stat>
      </div>
      <Hideouts s={s} seat={seat} />
    </motion.div>
  );
}

/** A player in one line: name, Footholds, cash and crew at home. Tapping it opens their hideouts. */
export function PlayerRow({ s, seat, tag, away, onPeek, acting, onOpen }: Who & { acting?: boolean; onOpen: () => void }) {
  const hold = useLongPress(onPeek);
  const j = s.job;
  const tap = () => {
    // letting go of a hold mustn't also open the row
    if (hold.held.current) {
      hold.held.current = false;
      return;
    }
    onOpen();
  };
  return (
    <div
      className={"l-row" + (acting ? " acting" : "") + (j?.kind === "hit" && j.mark === seat ? " mark" : "") + (s.boss === seat && s.phase !== "setup" ? " boss" : "") + (s.winners?.includes(seat) ? " winner" : "")}
      {...pressable(tap, `${s.players[seat].name}: show hideouts`)}
    >
      <Avatar s={s} seat={seat} size={32} hold={hold} />
      <span className="l-name" {...hold.props}>
        <span className="l-name-text">{s.players[seat].name}</span>
        <Tags s={s} seat={seat} tag={tag} away={away} />
        {acting && <span className="l-acting">…</span>}
      </span>
      <Pips s={s} seat={seat} />
      <span className="l-cash" data-anchor={`bank-${seat}`} data-tip={TIPS.cash}>
        <CountUp value={cashOf(s, seat)} prefix="$" />
      </span>
      <span className="l-home" data-anchor={`home-${seat}`} data-tip={TIPS.home}>
        <Crew color={s.players[seat].color} size={14} />
        {homeOf(s, seat)}
      </span>
    </div>
  );
}

/** A player as a card: name, Footholds, cash and home, and their three hideouts. For picking the Mark,
 *  picking a hideout, joining a fight, or a row tapped open. */
export function PlayerCard({ s, seat, tag, away, onPeek, onClick, glow, hideoutGlow, onHideout, acting, onClose }: Who & {
  onClick?: () => void;
  glow?: boolean;
  hideoutGlow?: boolean;
  onHideout?: (h: number) => void;
  acting?: boolean;
  /** a row tapped open: tap again to fold it back */
  onClose?: () => void;
}) {
  const hold = useLongPress(onPeek);
  const tapAt = onClick ?? onClose;
  const tap = tapAt
    ? () => {
        if (hold.held.current) {
          hold.held.current = false;
          return;
        }
        tapAt();
      }
    : undefined;
  const j = s.job;
  return (
    <motion.div
      className={"l-card" + (glow ? " glow" : "") + (onClick ? " clickable" : "") + (j?.kind === "hit" && j.mark === seat ? " mark" : "") + (s.boss === seat && s.phase !== "setup" ? " boss" : "") + (acting ? " acting" : "") + (s.winners?.includes(seat) ? " winner" : "")}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      {...pressable(tap, onClick ? `Pick ${s.players[seat].name} as the Mark` : `${s.players[seat].name}: fold away`)}
    >
      <div className="l-head">
        <Avatar s={s} seat={seat} size={34} hold={hold} acting={acting} />
        <span className="l-name" {...hold.props}>
          <span className="l-name-text">{s.players[seat].name}</span>
          <Tags s={s} seat={seat} tag={tag} away={away} />
        </span>
      </div>
      <div className="l-card-mid">
        <Pips s={s} seat={seat} />
        <span className="l-card-cash">
          <span className="l-cash" data-anchor={`bank-${seat}`} data-tip={TIPS.cash}>
            <CountUp value={cashOf(s, seat)} prefix="$" />
          </span>
          {" · "}
          <span data-anchor={`home-${seat}`} data-tip={TIPS.home}>
            {homeOf(s, seat)} home
          </span>
        </span>
      </div>
      <Hideouts s={s} seat={seat} glow={hideoutGlow} onHideout={onHideout} />
    </motion.div>
  );
}

/** Your own seat under your hand: name and Footholds, cash, home, pen and spare, your hideouts. */
export function MySeat({ s, seat, onPeek, me, acting }: Who & { me: boolean; acting?: boolean }) {
  const P = s.players[seat];
  const hold = useLongPress(onPeek);
  return (
    <div className={"l-me" + (s.boss === seat && s.phase !== "setup" ? " boss" : "") + (s.job?.kind === "hit" && s.job.mark === seat ? " mark" : "") + (acting ? " acting" : "") + (s.winners?.includes(seat) ? " winner" : "")} data-anchor={me ? "my-seat" : undefined}>
      <div className="l-me-top">
        <Avatar s={s} seat={seat} size={38} hold={hold} />
        <div className="l-id">
          <div className="l-name" {...hold.props}>
            <span className="l-name-text">{P.name}</span>
            <Tags s={s} seat={seat} me={me} />
          </div>
          <Pips s={s} seat={seat} anchor={me ? "my-fh" : undefined} />
        </div>
        <div className="l-stats four">
          <Stat k="Cash" cls="cash" anchor={`bank-${seat}`} tip={TIPS.cash}>
            <CountUp value={cashOf(s, seat)} prefix="$" />
          </Stat>
          <Stat k="Home" anchor={`home-${seat}`} tip={TIPS.home}>
            {homeOf(s, seat)}
          </Stat>
          <Stat k="Pen" cls="dim" tip={TIPS.pen}>
            {P.pen}
          </Stat>
          <Stat k="Spare" cls="dim" tip={TIPS.spare}>
            {P.reserve}
          </Stat>
        </div>
      </div>
      <Hideouts s={s} seat={seat} />
    </div>
  );
}

/** The job in one line: whose hideout, and the two sides' totals (crew so far, cards once they flip). */
export function JobLine({ s }: { s: GameState }) {
  const j = s.job;
  if (!j) return null;
  const P = s.players;
  const bust = j.kind === "bust";
  const H = bust ? P[j.boss].hideouts[j.hideout] : P[j.mark].hideouts[j.hideout];
  const base = bust ? { b: H[j.boss], m: H[j.mark] } : jobBases(s, j);
  const done = j.result === "B" || j.result === "M";
  const short = (p: number) => P[p].name;
  const title = bust ? `BUST · ${short(j.boss)}'s hideout ${j.hideout + 1}` : `${j.wanted ? "WANTED · " : ""}HIT · ${short(j.mark)}'s hideout ${j.hideout + 1}`;
  const result = j.result === "B" ? (bust ? "CLEARED OUT" : "BOSS WINS") : j.result === "M" ? (bust ? "HELD ON" : "MARK HOLDS") : j.result === "deal" ? "DEAL" : j.result ? "NO DEAL" : null;
  return (
    <motion.div key={`${j.kind}-${j.boss}-${j.mark}-${j.hideout}-${s.turn}`} className={"l-job" + (j.revealed ? " revealed" : "")} role="region" aria-label="Current job" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="l-job-main">
        <span className="l-job-title">{title}</span>
        <span className="l-job-score" data-tip={"Boss side vs Mark side\nCrew and bonuses, plus the cards once they flip. Ties go to the Mark."}>
          <span className={"l-job-b" + (done ? (j.result === "B" ? " won" : " lost") : "")} data-anchor="job-B">
            {j.revealed ? <CountUp value={j.bTotal} /> : base.b}
            {!j.revealed && <span className="q">+?</span>}
          </span>
          <span className="l-job-vs">vs</span>
          <span className={"l-job-m" + (done ? (j.result === "M" ? " won" : " lost") : "")} data-anchor="job-M">
            {j.revealed ? <CountUp value={j.mTotal} /> : base.m}
            {!j.revealed && <span className="q">+?</span>}
          </span>
        </span>
      </div>
      {(j.bets.length > 0 || j.hackerCall || result) && (
        <div className="l-job-sub">
          {result && <span className={"l-job-result r-" + j.result}>{result}</span>}
          {j.hackerCall && (
            <span>
              {P[j.hackerCall.seat].name}'s Hacker called <b>{j.hackerCall.n}</b>
            </span>
          )}
          {j.bets.map((b, i) => (
            <span key={i} className={"l-bet " + b.side}>
              {P[b.seat].name} ${b.card.cash} on {b.side === "B" ? "Boss" : "Mark"}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/** The top bar: Lobby, whose turn and which step, Skip, Chat and a menu for the rest. */
export function ListTop({
  who,
  step,
  onExit,
  onSkip,
  chat,
  menu,
  lastCall,
}: {
  who: string | null;
  step: string | null;
  onExit: () => void;
  onSkip: () => void;
  /** left out while watching */
  chat?: { on: boolean; toggle: () => void };
  menu: { label: string; key: string; on?: boolean; act: () => void }[];
  lastCall: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="l-top">
      <button className="icon-btn labeled" onClick={onExit} aria-label="Leave table">
        ←<span className="ib-k">Lobby</span>
      </button>
      <div className="l-turn" data-tip={"The Boss's turn, in order\nRegroup: draw, bank, hire. Hit: pick the Mark. Crew up: everyone picks a side. Showdown: cards flip. Payoff: winners and losers settle."}>
        {who && <span className="l-turn-who">{who}</span>}
        {step && <span className="l-turn-step">{step}</span>}
        {lastCall && <span className="l-turn-last">LAST CALL</span>}
      </div>
      <button className="icon-btn labeled" onClick={onSkip} aria-label="Skip to my next decision">
        ⏭<span className="ib-k">Skip</span>
      </button>
      {chat && (
        <button className={"icon-btn labeled" + (chat.on ? " on" : "")} aria-pressed={chat.on} onClick={chat.toggle} aria-label="Emotes, chat and drinks">
          💬<span className="ib-k">Chat</span>
        </button>
      )}
      <button className={"icon-btn labeled" + (open ? " on" : "")} aria-expanded={open} onClick={() => setOpen(!open)} aria-label="Menu">
        ⚙<span className="ib-k">Menu</span>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="l-menu-back" onClick={() => setOpen(false)} />
            <motion.div className="l-menu" role="menu" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
              {menu.map((m) => (
                <button
                  key={m.key}
                  role="menuitem"
                  className={"l-menu-item" + (m.on ? " on" : "")}
                  onClick={() => {
                    m.act();
                    // the speed changes in place; everything else opens something, so the menu gets out of the way
                    if (m.key !== "speed") setOpen(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
