import { CREWS, type GameState } from "@heist/engine";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useAnimationControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getPrefs, reducedMotion, usePrefs } from "../prefs";
import { chipRun } from "../sound";
import { BANNER, HUMAN, useTable, type TableSettings } from "../useTable";
import { ActionPanel, handSelect } from "./ActionPanel";
import { Coach, Walkthrough } from "./Coach";
import { FlightLayer, useFlights } from "./Flights";
import { JobZone } from "./JobZone";
import { seatPos, useLayout } from "./layout";
import { CardBack, CardFace, Chips, CountUp, Crew, TableCard } from "./pieces";
import { Seat, footholdsOf } from "./Seat";
import { Settings } from "./Settings";
import { TooltipLayer } from "./Tooltip";

const CHIP_COLORS = ["#c8372d", "#2f78c4", "#1d1f24", "#3a9a4a", "#8a4fbf"];

/** Events that shake the table a little. */
const SHAKE = new Set(["doubleCross", "hacked", "bustResult"]);

export function Table({ settings, onExit, onGameOver, onAgain }: { settings: TableSettings; onExit: () => void; onGameOver: (won: number) => void; onAgain: () => void }) {
  const t = useTable(settings);
  const { L, scale } = useLayout();
  const prefs = usePrefs();
  const reduce = reducedMotion(prefs);
  const canvas = useRef<HTMLDivElement>(null);
  const { flights, launch, fly } = useFlights(canvas, scale);
  t.flightHook.current = launch;
  const [sel, setSel] = useState<number[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [walk, setWalk] = useState(() => !getPrefs().walked);
  const [potShown, setPotShown] = useState(0);
  const [paidOut, setPaidOut] = useState(false);
  const paid = useRef(false);
  const shake = useAnimationControls();

  const s = t.shown?.state;
  const pot = settings.stakes * settings.players;
  const ev = t.shown?.ev ?? null;
  const wide = L.name === "wide";

  // Buy-ins: everyone's chips slide into the pot as the cards come out.
  const boughtIn = useRef(false);
  useEffect(() => {
    if (!s || boughtIn.current) return;
    boughtIn.current = true;
    let ms = 0;
    for (let p = 0; p < s.n; p++) ms = Math.max(ms, fly(`seat-${p}`, "pot", { kind: "chip", color: CHIP_COLORS[p % CHIP_COLORS.length] }, 3, 60));
    chipRun(8);
    window.setTimeout(() => setPotShown(pot), ms);
  }, [s, pot, fly]);

  // The payout: the pot flies to the winners before the results card comes up.
  useEffect(() => {
    if (s?.winners && !paid.current) {
      paid.current = true;
      let ms = 0;
      for (const w of s.winners) ms = Math.max(ms, fly("pot", `seat-${w}`, { kind: "chip", color: "#e7b53c" }, 10, 45));
      window.setTimeout(() => setPotShown(0), ms * 0.6);
      window.setTimeout(() => setPaidOut(true), ms + 250);
      onGameOver(s.winners.includes(HUMAN) ? Math.floor(pot / s.winners.length) : 0);
    }
    if (!s?.winners) {
      paid.current = false;
      setPaidOut(false);
    }
  }, [s?.winners, pot, onGameOver, fly, s]);

  useEffect(() => {
    if (ev && SHAKE.has(ev.t) && !reduce) void shake.start({ x: [0, -7, 6, -4, 3, 0], transition: { duration: 0.4 } });
  }, [t.shown?.key, ev, reduce, shake]);

  // Keyboard: S skip, L log, M mute via settings, Esc closes panels.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        setShowLog(false);
        setShowSettings(false);
      } else if (e.key === "s" || e.key === "S") t.skip();
      else if (e.key === "l" || e.key === "L") setShowLog((v) => !v);
      else if (e.key === "1" || e.key === "2" || e.key === "4") {
        if (!e.altKey && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== "INPUT") t.setSpeed(Number(e.key));
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [t]);

  if (!s) return <div className="loading">Shuffling…</div>;
  const ask = walk ? null : t.ask;
  const me = s.players[HUMAN];
  const hs = handSelect(ask, s, HUMAN);
  const toggle = (id: number) => {
    if (!hs || !hs.allow(id)) return;
    if (sel.includes(id)) setSel(sel.filter((x) => x !== id));
    else if (hs.max === 1) setSel([id]);
    else if (sel.length < hs.max) setSel([...sel, id]);
  };
  const banner = ev && BANNER[ev.t] ? t.shown : null;
  const flipShow = ev && (ev.t === "flip" || ev.t === "mark") && s.flip ? s.flip : null;
  const penCrew = s.players.filter((p) => p.pen > 0);
  const discardTop = s.discard[s.discard.length - 1];
  const actor = t.ask ? HUMAN : ev && "seat" in ev && typeof ev.seat === "number" ? ev.seat : (s.job?.boss ?? s.boss);
  const showdown = !!s.job && (s.job.revealed || ev?.t === "facedown");

  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <div className={"stage" + (reduce ? " reduce-motion" : "")}>
        <motion.div className="shaker" animate={shake}>
        <div className={`canvas l-${L.name}`} ref={canvas} style={{ width: L.W, height: L.H, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <LayoutGroup>
            <div className="felt">
              <div className="felt-inner" />
              <div className="felt-logo">HEIST</div>
            </div>
            <div className={"spot" + (showdown ? " on" : "")} aria-hidden />

            <div className="ticker" aria-hidden>
              <AnimatePresence mode="popLayout">
                <motion.span key={t.shown!.key} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>
                  {t.shown!.msg}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="sr-only" aria-live="polite">
              {t.ask ? `Your move. ${t.shown!.msg}` : t.shown!.msg}
            </div>

            <div className="topbar left">
              <button className="icon-btn" onClick={onExit} aria-label="Leave table" data-tip="Leave table">
                ←
              </button>
              <span className="stakes">
                Stakes {settings.stakes.toLocaleString()} · First to {s.target}
              </span>
            </div>
            <div className="topbar right" role="toolbar" aria-label="Table controls">
              {[1, 2, 4].map((x) => (
                <button key={x} className={"icon-btn" + (t.speed === x ? " on" : "")} aria-pressed={t.speed === x} aria-label={`Speed ${x}x`} onClick={() => t.setSpeed(x)}>
                  {x}x
                </button>
              ))}
              <button className="icon-btn" onClick={t.skip} aria-label="Skip to my next decision" data-tip="Skip to my next decision (S)">
                ⏭
              </button>
              <button className={"icon-btn" + (showLog ? " on" : "")} aria-pressed={showLog} onClick={() => setShowLog(!showLog)} aria-label="Game log" data-tip="Game log (L)">
                ☰
              </button>
              <button className={"icon-btn" + (showSettings ? " on" : "")} aria-pressed={showSettings} onClick={() => setShowSettings(!showSettings)} aria-label="Settings" data-tip="Sound, motion and tips">
                ⚙
              </button>
            </div>

            {/* center: deck, discard, pen, pot */}
            <div className="deck" data-anchor="deck" data-tip={`Job deck · ${s.deckCount} cards\nRun-outs: ${s.reshuffles} of 3. The third one is Last Call.`}>
              <CardBack size="sm" />
              <span className="pile-label">JOBS {s.deckCount}</span>
              <span className="runouts">
                {Array.from({ length: 3 }, (_, i) => (
                  <span key={i} className={"runout" + (i < s.reshuffles ? " on" : "")} />
                ))}
              </span>
            </div>
            <div className="discard" data-anchor="discard" data-tip={`Discard pile · ${s.discard.length} cards\nShuffled back in when the Job deck runs out.`}>
              {discardTop ? <TableCard card={discardTop} size="sm" /> : <div className="card card-sm card-slot" />}
              <span className="pile-label">DISCARD {s.discard.length}</span>
            </div>
            <div className="pen" data-anchor="pen" data-tip="The Pen\nCrew who lost a fight. One comes home at the start of each of their owner's turns.">
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
            <div className="pot" data-anchor="pot" data-tip={`The pot · ${pot.toLocaleString()} play chips\nEveryone's buy-in. The winner takes it all.`}>
              <Chips amount={potShown} counting />
              <span className="pile-label">POT</span>
            </div>
            {s.lastCall && <div className="lastcall-badge">LAST CALL</div>}

            <JobZone s={s} />

            {/* seats */}
            {s.players.map((p) => {
              const pos = seatPos(L, p.seat, s.n, HUMAN);
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
                  acting={!s.winners && actor === p.seat}
                  showBank={wide}
                />
              );
            })}

            {/* your bank and hand */}
            {!wide && (
              <div className="my-bank" data-anchor={`bank-${HUMAN}`}>
                <div className="area-label">
                  BANK{" "}
                  <b>
                    <CountUp value={me.bank.reduce((a, c) => a + c.cash, 0)} prefix="$" />
                  </b>
                </div>
                <div className="my-bank-cards">
                  {me.bank.map((c) => (
                    <TableCard key={c.id} card={c} size="xs" />
                  ))}
                </div>
              </div>
            )}
            <div className="my-hand" data-anchor="my-hand" role="group" aria-label="Your hand">
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

            <AnimatePresence>
              {ask && (
                <ActionPanel
                  key={JSON.stringify(ask)}
                  ask={ask}
                  s={s}
                  seat={HUMAN}
                  sel={sel}
                  setSel={setSel}
                  answer={(a) => {
                    setSel([]);
                    t.answer(a);
                  }}
                />
              )}
            </AnimatePresence>
            <Coach ask={ask} blocked={walk || !!s.winners} />
            {!t.ask && !s.winners && (
              <div className="waiting">
                <span className="dots">
                  <span />
                  <span />
                  <span />
                </span>
                {s.players[actor].name}'s move
              </div>
            )}
          </LayoutGroup>

          <AnimatePresence>
            {flipShow && (
              <motion.div
                key={`flip-${flipShow.id}-${t.shown!.key}`}
                className="flip-show"
                initial={{ rotateY: 180, scale: 0.4, opacity: 0, y: 60 }}
                animate={{ rotateY: 0, scale: 1, opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 170, damping: 18 }}
              >
                <CardFace card={flipShow} size="lg" />
                <div className="flip-caption" style={{ color: CREWS[flipShow.color].hex }}>
                  {CREWS[flipShow.color].name}
                  <span className="dim">{s.players.some((p) => p.color === flipShow.color) ? "" : " · nobody here"}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {banner && (
              <motion.div key={banner.key} className={"banner b-" + ev!.t} initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.35 }}>
                <motion.span initial={{ letterSpacing: "14px", opacity: 0 }} animate={{ letterSpacing: "2px", opacity: 1 }} transition={{ delay: 0.12, duration: 0.45 }}>
                  {banner.msg}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>

          <FlightLayer flights={flights} speed={t.speed} />

          <AnimatePresence>
            {showLog && (
              <motion.div className="log" initial={{ x: 320 }} animate={{ x: 0 }} exit={{ x: 320 }} role="log" aria-label="Game log">
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
          <AnimatePresence>
            {showSettings && (
              <Settings
                onClose={() => setShowSettings(false)}
                onTour={() => {
                  setShowSettings(false);
                  setWalk(true);
                }}
              />
            )}
          </AnimatePresence>

          <Walkthrough s={s} canvas={canvas} scale={scale} open={walk && !s.winners} onClose={() => setWalk(false)} />
          <TooltipLayer canvas={canvas} scale={scale} H={L.H} />

          <AnimatePresence>{s.winners && paidOut && <GameOver s={s} pot={pot} onAgain={onAgain} onExit={onExit} />}</AnimatePresence>
        </div>
        </motion.div>
        <RotateHint />
      </div>
    </MotionConfig>
  );
}

function RotateHint() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="rotate-hint" role="dialog" aria-label="Turn your phone">
      <div className="rotate-phone" aria-hidden />
      <div className="rotate-title">Turn your phone sideways</div>
      <div className="dim">The table needs the room.</div>
      <button className="btn ghost small" onClick={() => setDismissed(true)}>
        Play upright anyway
      </button>
    </div>
  );
}

function Confetti() {
  const bits = Array.from({ length: 46 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden>
      {bits.map((i) => {
        const x = (i * 37) % 100;
        const color = i % 3 === 0 ? "#e7b53c" : CREWS[i % 6].hex;
        return (
          <motion.span
            key={i}
            className={i % 4 === 0 ? "conf-coin" : "conf-bit"}
            style={{ left: `${x}%`, background: color }}
            initial={{ y: -40, rotate: 0, opacity: 1 }}
            animate={{ y: 900, rotate: (i % 2 ? 1 : -1) * (360 + i * 20), opacity: [1, 1, 0] }}
            transition={{ duration: 2.4 + (i % 7) * 0.25, delay: (i % 10) * 0.08, ease: "easeIn" }}
          />
        );
      })}
    </div>
  );
}

function GameOver({ s, pot, onAgain, onExit }: { s: GameState; pot: number; onAgain: () => void; onExit: () => void }) {
  const won = s.winners!.includes(HUMAN);
  const share = Math.floor(pot / s.winners!.length);
  const rows = [...s.players].sort((a, b) => footholdsOf(s, b.seat) - footholdsOf(s, a.seat));
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {won && !reducedMotion() && <Confetti />}
      <motion.div className="modal" role="dialog" aria-modal="true" aria-labelledby="go-title" initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
        <div id="go-title" className={"modal-title" + (won ? " gold" : "")}>
          {won ? "YOU PULLED IT OFF" : "THE JOB'S OVER"}
        </div>
        <div className="modal-sub">
          {s.winners!.map((w) => s.players[w].name).join(" & ")} win{s.winners!.length > 1 ? "" : "s"} {s.endReason === "last_call" ? "at Last Call" : `with ${s.target} Footholds`}
        </div>
        {won && (
          <div className="modal-pot">
            <Chips amount={share} counting /> <span>added to your chips</span>
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
          <button className="btn primary big" onClick={onAgain} autoFocus>
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
