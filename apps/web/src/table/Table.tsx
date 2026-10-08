import { CREWS, type Answer, type GameState } from "@heist/engine";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isMuted, setMuted } from "../sound";
import { BANNER, HUMAN, useTable, type TableSettings } from "../useTable";
import { ActionPanel, handSelect } from "./ActionPanel";
import { FlightLayer, useFlights } from "./Flights";
import { JobZone } from "./JobZone";
import { H, seatPos, W } from "./layout";
import { CardBack, CardFace, Chips, Crew, TableCard } from "./pieces";
import { Seat, footholdsOf } from "./Seat";

function useScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const f = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return scale;
}

export function Table({ settings, onExit, onGameOver, onAgain }: { settings: TableSettings; onExit: () => void; onGameOver: (won: number, answers: Answer[]) => void; onAgain: () => void }) {
  const t = useTable(settings);
  const scale = useScale();
  const canvas = useRef<HTMLDivElement>(null);
  const { flights, launch } = useFlights(canvas, scale);
  t.flightHook.current = launch;
  const [sel, setSel] = useState<number[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [muted, setMute] = useState(isMuted());
  const paid = useRef(false);

  const s = t.shown?.state;
  const pot = settings.stakes * settings.players;

  useEffect(() => {
    if (s?.winners && !paid.current) {
      paid.current = true;
      onGameOver(s.winners.includes(HUMAN) ? Math.floor(pot / s.winners.length) : 0, t.answers());
    }
    if (!s?.winners) paid.current = false;
  }, [s?.winners, pot, onGameOver]);

  if (!s) return <div className="loading">Shuffling…</div>;
  const ask = t.ask;
  const me = s.players[HUMAN];
  const hs = handSelect(ask, s, HUMAN);
  const toggle = (id: number) => {
    if (!hs || !hs.allow(id)) return;
    if (sel.includes(id)) setSel(sel.filter((x) => x !== id));
    else if (hs.max === 1) setSel([id]);
    else if (sel.length < hs.max) setSel([...sel, id]);
  };
  const ev = t.shown!.ev;
  const banner = ev && BANNER[ev.t] ? t.shown : null;
  const flipShow = ev && (ev.t === "flip" || ev.t === "mark") && s.flip ? s.flip : null;
  const penCrew = s.players.filter((p) => p.pen > 0);
  const discardTop = s.discard[s.discard.length - 1];

  return (
    <div className="stage">
      <div className="canvas" ref={canvas} style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <LayoutGroup>
          <div className="felt">
            <div className="felt-inner" />
            <div className="felt-logo">HEIST</div>
          </div>

          <div className="ticker">
            <AnimatePresence mode="popLayout">
              <motion.span key={t.shown!.key} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>
                {t.shown!.msg}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="topbar left">
            <button className="icon-btn" onClick={onExit} title="Leave table">
              ←
            </button>
            <span className="stakes">
              Stakes {settings.stakes.toLocaleString()} · First to {s.target}
            </span>
          </div>
          <div className="topbar right">
            {[1, 2, 4].map((x) => (
              <button key={x} className={"icon-btn" + (t.speed === x ? " on" : "")} onClick={() => t.setSpeed(x)}>
                {x}x
              </button>
            ))}
            <button className="icon-btn" onClick={t.skip} title="Skip to my next decision">
              ⏭
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setMuted(!muted);
                setMute(!muted);
              }}
              title="Sound"
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button className={"icon-btn" + (showLog ? " on" : "")} onClick={() => setShowLog(!showLog)} title="Game log">
              ☰
            </button>
          </div>

          {/* center: deck, discard, pen, pot */}
          <div className="deck" data-anchor="deck" title={`${s.deckCount} cards in the Job deck`}>
            <CardBack size="sm" />
            <span className="pile-label">JOBS {s.deckCount}</span>
            <span className="runouts">
              {Array.from({ length: 3 }, (_, i) => (
                <span key={i} className={"runout" + (i < s.reshuffles ? " on" : "")} />
              ))}
            </span>
          </div>
          <div className="discard" data-anchor="discard">
            {discardTop ? <TableCard card={discardTop} size="sm" /> : <div className="card card-sm card-slot" />}
            <span className="pile-label">DISCARD {s.discard.length}</span>
          </div>
          <div className="pen" data-anchor="pen">
            <span className="pile-label">THE PEN</span>
            <div className="pen-crew">
              {penCrew.length === 0 && <span className="dim small">empty</span>}
              {penCrew.map((p) => (
                <span key={p.seat} className="pen-entry">
                  <Crew color={p.color} size={16} />
                  {p.pen}
                </span>
              ))}
            </div>
          </div>
          <div className="pot" data-anchor="pot">
            <Chips amount={pot} />
            <span className="pile-label">POT</span>
          </div>
          {s.lastCall && <div className="lastcall-badge">LAST CALL</div>}

          <JobZone s={s} />

          {/* seats */}
          {s.players.map((p) => {
            const pos = seatPos(p.seat, s.n, HUMAN);
            const pickMark = ask?.kind === "pickMark" && ask.rivals.includes(p.seat);
            const pickHide = ask?.kind === "pickHideout" && ask.mark === p.seat;
            return (
              <Seat
                key={p.seat}
                s={s}
                seat={p.seat}
                pos={pos}
                me={p.seat === HUMAN}
                glow={pickMark || s.boss === p.seat}
                onClick={pickMark ? () => t.answer({ kind: "pickMark", mark: p.seat }) : undefined}
                hideoutGlow={pickHide}
                onHideout={pickHide ? (h) => t.answer({ kind: "pickHideout", hideout: h }) : undefined}
              />
            );
          })}

          {/* your bank and hand */}
          <div className="my-bank" data-anchor={`bank-${HUMAN}`}>
            <div className="area-label">
              BANK <b>${me.bank.reduce((a, c) => a + c.cash, 0)}</b>
            </div>
            <div className="my-bank-cards">
              {me.bank.map((c) => (
                <TableCard key={c.id} card={c} size="xs" />
              ))}
            </div>
          </div>
          <div className="my-hand">
            {me.hand.map((c, i) => {
              const n = me.hand.length;
              const off = i - (n - 1) / 2;
              const can = !!hs && hs.allow(c.id);
              return (
                <TableCard
                  key={c.id}
                  card={c}
                  size="md"
                  selected={sel.includes(c.id)}
                  dim={!!hs && !can}
                  onClick={can ? () => toggle(c.id) : undefined}
                  style={{ rotate: `${off * 3}deg`, marginTop: Math.abs(off) * 4, zIndex: i }}
                />
              );
            })}
          </div>

          <AnimatePresence>{ask && <ActionPanel key={JSON.stringify(ask)} ask={ask} s={s} seat={HUMAN} sel={sel} setSel={setSel} answer={(a) => { setSel([]); t.answer(a); }} />}</AnimatePresence>
          {!ask && !s.winners && (
            <div className="waiting">
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
              {s.players[s.job?.boss ?? s.boss].name}'s move
            </div>
          )}
        </LayoutGroup>

        <AnimatePresence>
          {flipShow && (
            <motion.div key={`flip-${flipShow.id}-${t.shown!.key}`} className="flip-show" initial={{ rotateY: 90, scale: 0.6, opacity: 0 }} animate={{ rotateY: 0, scale: 1, opacity: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              <CardFace card={flipShow} size="lg" />
              <div className="flip-caption">{CREWS[flipShow.color].name} color{s.players.some((p) => p.color === flipShow.color) ? "" : " · nobody here"}</div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {banner && (
            <motion.div key={banner.key} className="banner" initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.35 }}>
              {banner.msg}
            </motion.div>
          )}
        </AnimatePresence>

        <FlightLayer flights={flights} speed={t.speed} />

        <AnimatePresence>
          {showLog && (
            <motion.div className="log" initial={{ x: 320 }} animate={{ x: 0 }} exit={{ x: 320 }}>
              <div className="log-title">Game log</div>
              <div className="log-body">
                {[...t.log].reverse().map((l) => (
                  <div key={l.key} className="log-line">
                    {l.msg}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>{s.winners && <GameOver s={s} pot={pot} onAgain={onAgain} onExit={onExit} />}</AnimatePresence>
      </div>
      <div className="rotate-hint">Turn your phone sideways for the full table</div>
    </div>
  );
}

function GameOver({ s, pot, onAgain, onExit }: { s: GameState; pot: number; onAgain: () => void; onExit: () => void }) {
  const won = s.winners!.includes(HUMAN);
  const share = Math.floor(pot / s.winners!.length);
  const rows = [...s.players].sort((a, b) => footholdsOf(s, b.seat) - footholdsOf(s, a.seat));
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
      <motion.div className="modal" initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} transition={{ delay: 0.6, type: "spring", stiffness: 200, damping: 18 }}>
        <div className={"modal-title" + (won ? " gold" : "")}>{won ? "YOU PULLED IT OFF" : "THE JOB'S OVER"}</div>
        <div className="modal-sub">
          {s.winners!.map((w) => s.players[w].name).join(" & ")} win{s.winners!.length > 1 ? "" : "s"} {s.endReason === "last_call" ? "at Last Call" : `with ${s.target} Footholds`}
        </div>
        {won && (
          <div className="modal-pot">
            <Chips amount={share} /> <span>added to your chips</span>
          </div>
        )}
        <table className="standings">
          <tbody>
            {rows.map((p) => (
              <tr key={p.seat} className={s.winners!.includes(p.seat) ? "win" : ""}>
                <td>
                  <Crew color={p.color} size={16} /> {p.name}
                </td>
                <td>{footholdsOf(s, p.seat)} Footholds</td>
                <td>${p.bank.reduce((a, c) => a + c.cash, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btns center">
          <button className="btn primary big" onClick={onAgain}>
            Deal again
          </button>
          <button className="btn ghost" onClick={onExit}>
            Lobby
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

