import { CREWS, type GameState } from "@heist/engine";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useAnimationControls } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWakeLock } from "../appShell";
import { buzz } from "../haptics";
import { getPrefs, reducedMotion, usePrefs } from "../prefs";
import { chipRun, shuffle as shuffleSound } from "../sound";
import { BANNER, HUMAN as LOCAL_SEAT, useTable, type HistoryEntry, type TableSettings, type TableSource } from "../useTable";
import { ActionPanel, handSelect } from "./ActionPanel";
import { Bubbles, ChatTray, useBubbles } from "./Chat";
import { botRound, DrinkLayer, DRINKS, useDrinks } from "./Drinks";
import { Coach, Walkthrough } from "./Coach";
import { FlightLayer, useFlights } from "./Flights";
import { JobZone } from "./JobZone";
import { seatGrow, seatPos, useLayout } from "./layout";
import { CardBack, CardFace, Chips, CountUp, Crew, TableCard } from "./pieces";
import { Recap } from "./Recap";
import { Seat, footholdsOf } from "./Seat";
import { Rules } from "./Rules";
import { Settings } from "./Settings";
import { Showdown } from "./Showdown";
import { TooltipLayer } from "./Tooltip";

const CHIP_COLORS = ["#c8372d", "#2f78c4", "#1d1f24", "#3a9a4a", "#8a4fbf"];

const STEPS = ["Regroup", "Hit", "Crew up", "Showdown", "Payoff"];
const STEP_OF: Partial<Record<string, number>> = {
  ...Object.fromEntries(["turn", "draw", "penReturn", "fence", "bank", "hire", "stuck"].map((k) => [k, 0])),
  ...Object.fromEntries(["flip", "mark", "target", "bust"].map((k) => [k, 1])),
  ...Object.fromEntries(["send", "bribe", "pass", "doubleCross", "bet"].map((k) => [k, 2])),
  ...Object.fromEntries(["hackerCall", "facedown", "reveal", "hacked", "forged", "backup"].map((k) => [k, 3])),
  ...Object.fromEntries(["result", "fixerFixer", "deal", "dealOffer", "giveCards", "toPen", "foothold", "loot", "cut", "betPaid", "bustResult", "placeCrew", "again"].map((k) => [k, 4])),
};

/** Where we are in the Boss's turn: whose turn, then the five steps with the current one lit. */
function TurnSteps({ who, step }: { who: string; step: number }) {
  return (
    <div className="turn-steps" data-tip={"The Boss's turn, in order\nRegroup: draw, bank, hire. Hit: pick the Mark. Crew up: everyone picks a side. Showdown: cards flip. Payoff: winners and losers settle."}>
      <span className="turn-who">{who}</span>
      {STEPS.map((x, i) => (
        <span key={x} className={"turn-step" + (i === step ? " on" : i < step ? " done" : "")}>
          {x}
        </span>
      ))}
    </div>
  );
}

/** Events that shake the table a little. */
const SHAKE = new Set(["doubleCross", "hacked", "bustResult"]);

export function Table({
  settings,
  onExit,
  onGameOver,
  onAgain,
  againLabel,
  forfeit,
  seat = LOCAL_SEAT,
  useSource = useTable,
  talk,
  watching = false,
  away,
  clock,
}: {
  settings: TableSettings;
  onExit: () => void;
  onGameOver: (won: number) => void;
  /** deal the next game; left out online when only the host can deal */
  onAgain?: () => void;
  /** the label on that button (default "Deal again") */
  againLabel?: string;
  /** online: you weren't at the table when the game ended, so it counts as abandoned */
  forfeit?: boolean;
  /** The seat this player sits in. */
  seat?: number;
  /** Where the game comes from: the local game vs bots by default, or an online table. Keep it fixed for the Table's lifetime. */
  useSource?: (settings: TableSettings) => TableSource;
  /** Table talk shared with other players (online): what you say goes out, and everyone's lines come back as bubbles. */
  /** Watching, not playing (online): the table is drawn from `seat`, but it isn't yours. */
  watching?: boolean;
  /** online: seats whose player has dropped or is on autopilot */
  away?: Record<number, "away" | "bot">;
  /** online: the turn clock, shown on your action panel */
  clock?: ReactNode;
  talk?: {
    send: (text: string) => void;
    listen: (heard: (seat: number, text: string) => void) => () => void;
    drink: (to: number, emoji: string) => void;
    listenDrinks: (got: (from: number, to: number, emoji: string) => void) => () => void;
  };
}) {
  const HUMAN = seat;
  const t = useSource(settings);
  const { L, scale, dx, dy } = useLayout();
  const prefs = usePrefs();
  const reduce = reducedMotion(prefs);
  const canvas = useRef<HTMLDivElement>(null);
  const { flights, launch, fly, at: anchorAt } = useFlights(canvas, scale);
  t.flightHook.current = launch;
  const [sel, setSel] = useState<number[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showRules, setShowRules] = useState(false);
  // Which part of the Boss's turn we're in, from the latest event (kept when an event doesn't say).
  const stepRef = useRef(0);
  const evNow = t.shown?.ev;
  if (evNow && STEP_OF[evNow.t] !== undefined) stepRef.current = STEP_OF[evNow.t]!;
  const chat = useBubbles(HUMAN);
  useEffect(() => talk?.listen((seat, text) => chat.say(seat, text)), [talk, chat.say]);
  const nRef = useRef(settings.players);
  // Drinks sit on the rail just above the player's avatar.
  const seatAt = (seat: number): [number, number] => {
    const a = anchorAt(`seat-${seat}`);
    // above the avatar, or beside it for a seat at the top edge, where above is off the table
    if (a) return a.y - 32 < 18 ? [a.x - 40, a.y] : [a.x - 8, a.y - 32];
    const p = seatPos(L, seat, nRef.current, HUMAN);
    return [p[0], p[1] - 70];
  };
  const drinks = useDrinks(seatAt, (d) => {
    const st = t.shown?.state;
    if (!st?.players[d.seat]?.bot) return;
    // A bot raises the glass, and sometimes sends one back to you (not online, where others wouldn't see it).
    window.setTimeout(() => chat.say(d.seat, Math.random() < 0.5 ? "Cheers! 🥂" : "🥂"), 300);
    if (!talk && d.from === HUMAN && Math.random() < 0.35) {
      const back = DRINKS[Math.floor(Math.random() * DRINKS.length)].emoji;
      window.setTimeout(() => drinks.send(d.seat, HUMAN, back), 2200);
    }
  });
  useEffect(() => talk?.listenDrinks((from, to, emoji) => drinks.send(from, to, emoji)), [talk, drinks.send]);
  // the tour pauses nothing, so it only runs at a local table where the game waits for you
  const [walk, setWalk] = useState(() => !getPrefs().walked && useSource === useTable);
  const [potShown, setPotShown] = useState(0);
  const [paidOut, setPaidOut] = useState(false);
  const paid = useRef(false);
  const shake = useAnimationControls();
  useWakeLock(!t.shown?.state.winners);

  const s = t.shown?.state;
  const pot = settings.stakes * settings.players;
  const ev = t.shown?.ev ?? null;
  const wide = L.name === "wide";

  // Buy-ins: everyone's chips slide into the pot as the cards come out.
  const boughtIn = useRef(false);
  const [dealing, setDealing] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setDealing(false), 2500);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!s || boughtIn.current) return;
    boughtIn.current = true;
    let ms = 0;
    for (let p = 0; p < s.n; p++) ms = Math.max(ms, fly(`seat-${p}`, "pot", { kind: "chip", color: CHIP_COLORS[p % CHIP_COLORS.length] }, 3, 60));
    chipRun(8);
    window.setTimeout(() => setPotShown(pot), ms);
    // Then the deal: five cards to each rival, a beat apart; your own hand fans in on its own.
    for (let p = 0; p < s.n; p++) if (p !== HUMAN) window.setTimeout(() => fly("deck", `seat-${p}`, { kind: "card" }, 5, 70), ms + p * 160);
    if (!reducedMotion()) window.setTimeout(shuffleSound, ms);
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

  // Buzz on the moments that matter to you (Android always; iPhone when it lands on a tap).
  useEffect(() => {
    if (!ev || !s) return;
    if (ev.t === "foothold" && (ev.seat === HUMAN || ev.owner === HUMAN)) buzz("bump");
    else if (ev.t === "doubleCross" && ev.target === HUMAN) buzz("alert");
    else if (ev.t === "mark" && ev.mark === HUMAN) buzz("bump");
    else if (ev.t === "gameOver" && ev.winners.includes(HUMAN)) buzz("win");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.shown?.key]);

  useEffect(() => {
    if (s) {
      nRef.current = s.n;
      chat.react(ev, s);
      const r = talk ? null : botRound(ev, s);
      if (r) {
        const d = DRINKS[Math.floor(Math.random() * DRINKS.length)].emoji;
        window.setTimeout(() => drinks.send(r[0], r[1], d), 1600);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.shown?.key]);

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
      <div
        className={`stage theme-${prefs.theme}` + (reduce ? " reduce-motion" : "") + (prefs.textSize > 1 ? " big-text" : "")}
        style={{ "--ts": prefs.textSize } as React.CSSProperties}
      >
        <motion.div className="shaker" animate={shake}>
        <div className={`canvas l-${L.name}`} ref={canvas} style={{ width: L.W, height: L.H, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})` }}>
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
              <button className="icon-btn labeled" onClick={onExit} aria-label="Leave table" data-tip="Leave table">
                ←<span className="ib-k">Lobby</span>
              </button>
              <div className="topbar-info">
                <span className="stakes">
                  Stakes {settings.stakes.toLocaleString()} · First to {s.target}
                </span>
                {s.phase !== "setup" && !s.winners && <TurnSteps who={s.boss === HUMAN ? "Your turn" : `${s.players[s.boss].name}'s turn`} step={stepRef.current} />}
              </div>
            </div>
            <div className="topbar right" role="toolbar" aria-label="Table controls">
              <button
                className="icon-btn labeled"
                aria-label={`Game speed ${t.speed}x. Tap to change.`}
                data-tip="Game speed (1, 2, 4)"
                onClick={() => t.setSpeed(t.speed === 1 ? 2 : t.speed === 2 ? 4 : 1)}
              >
                {t.speed}x<span className="ib-k">Speed</span>
              </button>
              <button className="icon-btn labeled" onClick={t.skip} aria-label="Skip to my next decision" data-tip="Skip to my next decision (S)">
                ⏭<span className="ib-k">Skip</span>
              </button>
              {!watching && (
                <button className={"icon-btn labeled" + (showChat ? " on" : "")} aria-pressed={showChat} onClick={() => setShowChat(!showChat)} aria-label="Emotes, chat and drinks" data-tip="Emotes, chat and drinks">
                  💬<span className="ib-k">Chat</span>
                </button>
              )}
              <button className={"icon-btn labeled" + (showLog ? " on" : "")} aria-pressed={showLog} onClick={() => setShowLog(!showLog)} aria-label="Game log" data-tip="Game log (L)">
                ☰<span className="ib-k">Log</span>
              </button>
              <button className={"icon-btn labeled" + (showRules ? " on" : "")} aria-pressed={showRules} onClick={() => setShowRules(!showRules)} aria-label="How to play" data-tip="How to play">
                ?<span className="ib-k">Rules</span>
              </button>
              <button className={"icon-btn labeled" + (showSettings ? " on" : "")} aria-pressed={showSettings} onClick={() => setShowSettings(!showSettings)} aria-label="Settings" data-tip="Sound, motion and tips">
                ⚙<span className="ib-k">Settings</span>
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
                  grow={seatGrow(L, pos)}
                  me={!watching && p.seat === HUMAN}
                  glow={pickMark || s.boss === p.seat}
                  onClick={pickMark ? () => t.answer({ kind: "pickMark", mark: p.seat }) : undefined}
                  hideoutGlow={pickHide}
                  onHideout={pickHide ? (h) => t.answer({ kind: "pickHideout", hideout: h }) : undefined}
                  acting={!s.winners && actor === p.seat}
                  showBank={wide}
                  away={away?.[p.seat]}
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
            <div className={"my-hand" + (watching ? " watching" : "")} data-anchor="my-hand" role="group" aria-label="Your hand" aria-hidden={watching || undefined}>
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
                    onClick={
                      can
                        ? () => {
                            buzz("tap");
                            toggle(c.id);
                          }
                        : undefined
                    }
                    style={{ rotate: `${off * 3}deg`, marginTop: Math.abs(off) * 4, zIndex: i }}
                    enter={dealing ? 0.5 + i * 0.12 : undefined}
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
                  clock={clock}
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

          <Showdown s={s} ev={ev} k={t.shown!.key} />
          <Bubbles bubbles={chat.bubbles} pos={(seat) => seatPos(L, seat, s.n, HUMAN)} />
          <DrinkLayer drinks={drinks.drinks} slides={drinks.slides} pos={seatAt} />
          <AnimatePresence>
            {showChat && !watching && (
              <ChatTray
                onSay={(text) => (talk ? talk.send(text) : chat.say(HUMAN, text))}
                rivals={s.players.filter((p) => p.seat !== HUMAN).map((p) => ({ seat: p.seat, name: p.name }))}
                onDrink={(to, emoji) => (talk ? talk.drink(to, emoji) : drinks.send(HUMAN, to, emoji))}
                onClose={() => setShowChat(false)}
              />
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
          <AnimatePresence>{showRules && <Rules target={s.target} onClose={() => setShowRules(false)} />}</AnimatePresence>
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

          <AnimatePresence>{s.winners && paidOut && <GameOver s={s} me={watching || forfeit ? -1 : HUMAN} forfeit={forfeit} pot={pot} history={t.history.current} onAgain={onAgain} againLabel={againLabel} onExit={onExit} />}</AnimatePresence>
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

function GameOver({
  s,
  me,
  pot,
  history,
  onAgain,
  againLabel = "Deal again",
  forfeit,
  onExit,
}: {
  s: GameState;
  me: number;
  pot: number;
  history: HistoryEntry[];
  onAgain?: () => void;
  againLabel?: string;
  forfeit?: boolean;
  onExit: () => void;
}) {
  const won = s.winners!.includes(me);
  const share = Math.floor(pot / s.winners!.length);
  const rows = [...s.players].sort((a, b) => footholdsOf(s, b.seat) - footholdsOf(s, a.seat));
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {won && !reducedMotion() && <Confetti />}
      <motion.div className="modal" role="dialog" aria-modal="true" aria-labelledby="go-title" initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
        {/* The result and the buttons come first, so nothing needs scrolling to leave or deal again. */}
        <div className="go-side">
          <div id="go-title" className={"modal-title" + (won ? " gold" : "")}>
            {won ? "YOU PULLED IT OFF" : forfeit ? "YOU WALKED OUT" : "THE JOB'S OVER"}
          </div>
          <div className="modal-sub">
            {s.winners!.map((w) => s.players[w].name).join(" & ")} win{s.winners!.length > 1 ? "" : "s"} {s.endReason === "last_call" ? "at Last Call" : `with ${s.target} Footholds`}
          </div>
          {forfeit && <div className="modal-sub">You weren't at the table when it ended, so this game counts as abandoned and your buy-in is lost.</div>}
          {won && (
            <div className="modal-pot">
              <Chips amount={share} counting /> <span>added to your chips</span>
            </div>
          )}
          <div className="btns center">
            {onAgain ? (
              <button className="btn primary big" onClick={onAgain} autoFocus>
                {againLabel}
              </button>
            ) : (
              <button className="btn big" disabled>
                Waiting for the host to deal
              </button>
            )}
            <button className="btn ghost" onClick={onExit}>
              Lobby
            </button>
          </div>
        </div>
        <Recap h={history} s={s} />
      </motion.div>
    </motion.div>
  );
}
