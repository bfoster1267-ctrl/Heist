import { type Reward } from "@heist/profile";
import { CREWS, type Answer, type GameState } from "@heist/engine";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useAnimationControls } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWakeLock } from "../appShell";
import { useIsland } from "../island";
import { buzz } from "../haptics";
import { getPrefs, reducedMotion, usePrefs } from "../prefs";
import { cardSlam, chipRun, shuffle as shuffleSound } from "../sound";
import { BANNER, HUMAN as LOCAL_SEAT, useTable, type HistoryEntry, type TableSettings, type TableSource } from "../useTable";
import { ActionPanel, handSelect } from "./ActionPanel";
import { useLook } from "../account/useAccount";
import { FirstWin } from "../account/FirstWin";
import { Bubbles, ChatTray, useBubbles } from "./Chat";
import { botRound, DrinkLayer, DRINKS, useDrinks } from "./Drinks";
import { isVault } from "../vault";
import { Coach, CoachIdea, CoachLine, MistakeCheck, Walkthrough } from "./Coach";
import { autoPick, checkMove, coachPick, FIRST_HAND, ideaFor, lesson, lessonNo, lessonOpen, type MistakeCounts, type MistakeId } from "@heist/profile";
import { FlightLayer, useFlights } from "./Flights";
import { JobZone } from "./JobZone";
import { clearSpot, seatGrow, seatPos, useLayout, type Spot } from "./layout";
import { CardBack, CardFace, Chips, CountUp, Crew, TableCard } from "./pieces";
import { Recap } from "./Recap";
import { Seat, footholdsOf } from "./Seat";
import { Rules } from "./Rules";
import { Settings } from "./Settings";
import { Showdown } from "./Showdown";
import { TooltipLayer } from "./Tooltip";
import { list, t as tr } from "../i18n";
import { crewName, lessonName, stageName } from "../i18n/data";

const CHIP_COLORS = ["#c8372d", "#2f78c4", "#1d1f24", "#3a9a4a", "#8a4fbf"];

const STEPS = ["step.0", "step.1", "step.2", "step.3", "step.4"] as const;
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
    <div className="turn-steps" data-tip={tr("table.stepsTip")}>
      <span className="turn-who">{who}</span>
      {STEPS.map((x, i) => (
        <span key={x} className={"turn-step" + (i === step ? " on" : i < step ? " done" : "")}>
          {tr(x)}
        </span>
      ))}
    </div>
  );
}

/** Events that shake the table a little. */
/** what the coach says after a move that isn't a mistake */
const CHEERS = ["table.cheer1", "table.cheer2", "table.cheer3", "table.cheer4", "table.cheer5"] as const;
/** what the waiting line says while the coach plays a decision the lesson hasn't handed you yet */
const COACH_DOES = new Set(["bank", "hire", "action", "pickMark", "pickHideout", "send", "join", "discard", "again", "bet", "doubleCross", "backup"]);
const coachDoes = (kind: string) => (COACH_DOES.has(kind) ? tr(`coachDoes.${kind}` as "coachDoes.bank") : tr("coachDoes.other"));
const SHAKE = new Set(["doubleCross", "hacked", "bustResult"]);

export function Table({
  settings,
  onExit,
  onGameOver,
  onAgain,
  buyDrink,
  againLabel,
  forfeit,
  seat = LOCAL_SEAT,
  useSource = useTable,
  talk,
  bubbleLooks,
  watching = false,
  away,
  clock,
  mistakes,
  clean = false,
  tags,
  onName,
  place,
  turnRef,
  firstReward,
}: {
  /** the new player's first hand: what it earned, shown on its game-over card */
  firstReward?: Reward | null;
  /** the small line under the title in the Dynamic Island / lock screen ("Table K7QX") */
  place?: string;
  /** kept up to date with the job the table is on (so a player walking out can say where) */
  turnRef?: { current: number };
  settings: TableSettings;
  /** Ranked: a clean HUD, no coach tips or explainer lines, just the table and your choices */
  clean?: boolean;
  /** online: a short tag by each seat's name (their ranked rank) */
  tags?: Record<number, string>;
  /** online: tap a player's name to see their profile */
  onName?: (seat: number) => void;
  /** Coached play: the rookie mistakes this player has made before */
  mistakes?: MistakeCounts;
  onExit: () => void;
  onGameOver: (won: number, answers: Answer[]) => void;
  /** deal the next game; left out online when only the host can deal */
  onAgain?: () => void;
  /** the label on that button (default "Deal again") */
  againLabel?: string;
  /** pay for a drink (coins) before it's sent; false = couldn't pay */
  buyDrink?: (emoji: string, count: number) => Promise<boolean>;
  /** online: you weren't at the table when the game ended, so it counts as abandoned */
  forfeit?: boolean;
  /** The seat this player sits in. */
  seat?: number;
  /** Where the game comes from: the local game vs bots by default, or an online table. Keep it fixed for the Table's lifetime. */
  useSource?: (settings: TableSettings) => TableSource;
  /** online: the chat bubble each seat wears (from its badge), so everyone's lines show in their own style */
  bubbleLooks?: Record<number, string | undefined>;
  /** Watching, not playing (online): the table is drawn from `seat`, but it isn't yours. */
  watching?: boolean;
  /** online: seats whose player has dropped or is on autopilot */
  away?: Record<number, "away" | "bot">;
  /** online: the turn clock, shown on your action panel */
  clock?: ReactNode;
  /** Table talk shared with other players (online): what you say goes out, and everyone's lines come back as bubbles. */
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
  // Coached play: an answer held back because the coach spotted a rookie mistake in it
  const [held, setHeld] = useState<{ a: Answer; id: MistakeId } | null>(null);
  // while a table is open, an upright phone draws the page sideways (see turn.ts)
  useEffect(() => {
    document.documentElement.classList.add("in-game");
    return () => document.documentElement.classList.remove("in-game");
  }, []);
  /** Coached play: a word of praise for the move just made, shown for a few seconds */
  const [cheer, setCheer] = useState<string | null>(null);
  useEffect(() => {
    if (!cheer) return;
    const id = setTimeout(() => setCheer(null), 6000);
    return () => clearTimeout(id);
  }, [cheer]);
  useEffect(() => setHeld(null), [t.ask]);
  // Coached play: the learner can wave the coach off and finish the game on their own
  const [coachOff, setCoachOff] = useState(false);
  // Which part of the Boss's turn we're in, from the latest event (kept when an event doesn't say).
  const stepRef = useRef(0);
  const evNow = t.shown?.ev;
  if (evNow && STEP_OF[evNow.t] !== undefined) stepRef.current = STEP_OF[evNow.t]!;
  const chat = useBubbles(HUMAN);
  const look = useLook();
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
    window.setTimeout(() => chat.say(d.seat, isVault(d.emoji) ? tr("table.vaultBot") : Math.random() < 0.5 ? tr("table.cheersBot") : "🥂"), isVault(d.emoji) ? 1800 : 300);
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
  useIsland(t.shown?.state.winners ? tr("island.over") : t.ask && !watching ? tr("island.yourTurn") : watching ? tr("island.watching") : "Heist", place ?? tr("island.atTable"));

  const s = t.shown?.state;
  if (turnRef && s) turnRef.current = s.turn;
  const pot = settings.stakes * settings.players;
  const ev = t.shown?.ev ?? null;
  const wide = L.name === "wide";

  // Coached play lessons: a decision the lesson hasn't handed you yet, the coach plays for you
  const lessonOn = !!settings.coached && !!settings.lesson && !watching && !coachOff;
  const autoAsk = lessonOn && s && t.ask && !walk && !s.winners && !lessonOpen(settings.lesson, s, t.ask) ? t.ask : null;
  useEffect(() => {
    if (!autoAsk) return;
    const id = window.setTimeout(() => {
      const g = t.game;
      if (g?.pending) t.answer(autoPick(g, g.pending));
    }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);
  // the lesson ideas already explained this game
  const [taught, setTaught] = useState<string[]>([]);
  // the new ideas whose full-screen card was put away with Next (the panel's New tag brings it back)
  const [read, setRead] = useState<string[]>([]);

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
      onGameOver(s.winners.includes(HUMAN) ? Math.floor(pot / s.winners.length) : 0, t.answers());
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
    if (ev && SHAKE.has(ev.t) && !reduce) {
      cardSlam();
      void shake.start({ x: [0, -7, 6, -4, 3, 0], transition: { duration: 0.4 } });
    }
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

  // The flipped Job card finds a spot on the felt that leaves every seat readable (you pick the Mark
  // off those seats). Measured again a moment later, once the decision panel has come in.
  const flipSpot = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = flipSpot.current, c = canvas.current;
      if (el && c && el.offsetWidth) setSpot(clearSpot(el, c, L));
    };
    place();
    const id = window.setTimeout(place, 450);
    return () => window.clearTimeout(id);
  }, [t.shown?.key, L, scale, prefs.textSize, s?.n]);

  if (!s) return <div className="loading">{tr("table.shuffling")}</div>;
  const ask = walk ? null : t.ask;
  const coached = !!settings.coached && !watching && !coachOff;
  const idea = coached && ask && !autoAsk ? ideaFor(settings.lesson, s, ask, taught) : undefined;
  /** Every answer from this seat goes through here, so Coached play can catch a mistake first. */
  const play = (a: Answer) => {
    if (idea) setTaught((x) => [...x, idea.title]); // titles are ids here (English), never shown
    if (coached && ask) {
      const id = checkMove(s, ask, a);
      if (id) return setHeld({ a, id });
      const best = t.game ? coachPick(t.game, ask) : null;
      setCheer(best && JSON.stringify(best) === JSON.stringify(a) ? tr("table.cheerBest") : tr(CHEERS[Math.floor(Math.random() * CHEERS.length)]));
    }
    setHeld(null);
    setSel([]);
    t.answer(a);
  };
  const me = s.players[HUMAN];
  const hs = handSelect(ask, s, HUMAN);
  const toggle = (id: number) => {
    if (!hs || !hs.allow(id)) return;
    if (sel.includes(id)) setSel(sel.filter((x) => x !== id));
    else if (hs.max === 1) setSel([id]);
    else if (sel.length < hs.max) setSel([...sel, id]);
  };
  const banner = ev && BANNER[ev.t] ? t.shown : null;
  // the flipped Job card steps aside while you pick a hideout, since that's all about the seats
  const flipShow = ev && (ev.t === "flip" || ev.t === "mark") && s.flip && t.ask?.kind !== "pickHideout" ? s.flip : null;
  const penCrew = s.players.filter((p) => p.pen > 0);
  const discardTop = s.discard[s.discard.length - 1];
  const actor = t.ask ? HUMAN : ev && "seat" in ev && typeof ev.seat === "number" ? ev.seat : (s.job?.boss ?? s.boss);
  const showdown = !!s.job && (s.job.revealed || ev?.t === "facedown");

  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <div
        className={`stage theme-${prefs.theme}` + (reduce ? " reduce-motion" : "") + (prefs.textSize > 1 ? " big-text" : "") + (clean ? " clean-hud" : "")}
        style={{ "--ts": prefs.textSize } as React.CSSProperties}
      >
        <motion.div className="shaker" animate={shake}>
        <div className={`canvas l-${L.name}${wide && settings.players >= 5 ? " crowd" : ""}`} ref={canvas} style={{ width: L.W, height: L.H, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})` }}>
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
              {t.ask ? tr("table.yourMove", { msg: t.shown!.msg }) : t.shown!.msg}
            </div>

            <div className="topbar left">
              <button className="icon-btn labeled" onClick={onExit} aria-label={tr("table.leave")} data-tip={tr("table.leave")}>
                ←<span className="ib-k">{tr("table.lobby")}</span>
              </button>
              <div className="topbar-info">
                <span className="stakes">
                  {settings.stage ? tr("table.stage", { n: settings.stage, name: stageName(settings.stage) }) : settings.coached ? (lesson(settings.lesson) ? tr("table.lesson", { n: lessonNo(settings.lesson), name: lessonName(settings.lesson) }) : tr("table.coachedPlay")) : tr("table.stakes", { n: settings.stakes })} · {s.rules.rounds === 1 ? tr("table.oneHand") : tr("table.firstTo", { n: s.target })}
                </span>
                {s.phase !== "setup" && !s.winners && <TurnSteps who={s.boss === HUMAN ? tr("table.yourTurn") : tr("table.theirTurn", { name: s.players[s.boss].name })} step={stepRef.current} />}
              </div>
            </div>
            <div className="topbar right" role="toolbar" aria-label={tr("table.controls")}>
              <button
                className="icon-btn labeled"
                aria-label={tr("table.speedAria", { n: t.speed })}
                data-tip={tr("table.speedTip")}
                onClick={() => t.setSpeed(t.speed === 1 ? 2 : t.speed === 2 ? 4 : 1)}
              >
                {t.speed}x<span className="ib-k">{tr("table.speed")}</span>
              </button>
              <button className="icon-btn labeled" onClick={t.skip} aria-label={tr("table.skipAria")} data-tip={tr("table.skipTip")}>
                ⏭<span className="ib-k">{tr("table.skip")}</span>
              </button>
              {!watching && (
                <button className={"icon-btn labeled" + (showChat ? " on" : "")} aria-pressed={showChat} onClick={() => setShowChat(!showChat)} aria-label={tr("table.chatAria")} data-tip={tr("table.chatAria")}>
                  💬<span className="ib-k">{tr("table.chat")}</span>
                </button>
              )}
              <button className={"icon-btn labeled" + (showLog ? " on" : "")} aria-pressed={showLog} onClick={() => setShowLog(!showLog)} aria-label={tr("table.logAria")} data-tip={tr("table.logTip")}>
                ☰<span className="ib-k">{tr("table.log")}</span>
              </button>
              <button className={"icon-btn labeled" + (showRules ? " on" : "")} aria-pressed={showRules} onClick={() => setShowRules(!showRules)} aria-label={tr("table.rulesAria")} data-tip={tr("table.rulesAria")}>
                ?<span className="ib-k">{tr("table.rules")}</span>
              </button>
              <button className={"icon-btn labeled" + (showSettings ? " on" : "")} aria-pressed={showSettings} onClick={() => setShowSettings(!showSettings)} aria-label={tr("table.settingsAria")} data-tip={tr("table.settingsTip")}>
                ⚙<span className="ib-k">{tr("table.settings")}</span>
              </button>
            </div>

            {/* center: deck, discard, pen, pot */}
            <div className="deck" data-anchor="deck" data-tip={tr("table.deckTip", { n: s.deckCount, r: s.reshuffles })}>
              <CardBack size="sm" />
              <span className="pile-label">{tr("table.jobs", { n: s.deckCount })}</span>
              <span className="runouts">
                {Array.from({ length: 3 }, (_, i) => (
                  <span key={i} className={"runout" + (i < s.reshuffles ? " on" : "")} />
                ))}
              </span>
            </div>
            <div className="discard" data-anchor="discard" data-tip={tr("table.discardTip", { n: s.discard.length })}>
              {discardTop ? <TableCard card={discardTop} size="sm" /> : <div className="card card-sm card-slot" />}
              <span className="pile-label">{tr("table.discard", { n: s.discard.length })}</span>
            </div>
            <div className="pen" data-anchor="pen" data-tip={tr("table.penTip")}>
              <span className="pile-label">{tr("table.pen")}</span>
              <div className="pen-crew">
                {penCrew.length === 0 && <span className="dim small">{tr("table.empty")}</span>}
                {penCrew.map((p) => (
                  <span key={p.seat} className="pen-entry">
                    <Crew color={p.color} size={16} />
                    {p.pen}
                  </span>
                ))}
              </div>
            </div>
            <div className="pot" data-anchor="pot" data-tip={tr("table.potTip", { n: pot })}>
              <Chips amount={potShown} counting />
              <span className="pile-label">{tr("table.pot")}</span>
            </div>
            {s.lastCall && <div className="lastcall-badge">{tr("table.lastCall")}</div>}

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
                  grow={seatGrow(L, pos, s.n)}
                  me={!watching && p.seat === HUMAN}
                  cigar={!watching && p.seat === HUMAN ? look.equipped?.cigar : undefined}
                  glow={pickMark || s.boss === p.seat}
                  onClick={pickMark ? () => play({ kind: "pickMark", mark: p.seat }) : undefined}
                  hideoutGlow={pickHide}
                  onHideout={pickHide ? (h) => play({ kind: "pickHideout", hideout: h }) : undefined}
                  acting={!s.winners && actor === p.seat}
                  showBank={wide}
                  away={away?.[p.seat]}
                  tag={tags?.[p.seat]}
                  onName={onName ? () => onName(p.seat) : undefined}
                />
              );
            })}

            {/* your bank and hand */}
            {!wide && (
              <div className="my-bank" data-anchor={`bank-${HUMAN}`}>
                <div className="area-label">
                  {tr("table.bank")}{" "}
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
            <div className={"my-hand" + (watching ? " watching" : "")} data-anchor="my-hand" role="group" aria-label={tr("table.yourHand")} aria-hidden={watching || undefined}>
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
              {ask && !autoAsk && (
                <ActionPanel
                  key={JSON.stringify(ask)}
                  ask={ask}
                  s={s}
                  seat={HUMAN}
                  clock={clock}
                  sel={sel}
                  setSel={setSel}
                  answer={play}
                  coach={
                    coached && !s.winners ? (
                      <CoachLine s={s} ask={ask} idea={idea} pick={t.game ? coachPick(t.game, ask) : null} cheer={cheer} onIdea={() => idea && setRead((x) => x.filter((r) => r !== idea.title))} />
                    ) : undefined
                  }
                />
              )}
            </AnimatePresence>
            {coached ? (
              held ? (
                <MistakeCheck id={held.id} before={mistakes?.[held.id] ?? 0} onChange={() => setHeld(null)} onAnyway={() => {
                  const a = held.a;
                  setHeld(null);
                  setSel([]);
                  t.answer(a);
                }} />
              ) : (
                <CoachIdea idea={!s.winners && !autoAsk && idea && !read.includes(idea.title) ? idea : undefined} onNext={() => idea && setRead((x) => [...x, idea.title])} onOff={() => setCoachOff(true)} />
              )
            ) : (
              !clean && !coachOff && <Coach ask={ask} blocked={walk || !!s.winners} />
            )}
            {(!t.ask || autoAsk) && !s.winners && (
              <div className={"waiting" + (autoAsk ? " coach-plays" : "")}>
                <span className="dots">
                  <span />
                  <span />
                  <span />
                </span>
                {autoAsk ? tr("table.coachSays", { what: coachDoes(autoAsk.kind) }) : tr("table.theirMove", { name: s.players[actor].name })}
              </div>
            )}
          </LayoutGroup>

          <div className="flip-spot" ref={flipSpot} style={spot ? { left: spot.left, top: spot.top, transform: `scale(${spot.scale})` } : { visibility: "hidden" }}>
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
                  {crewName(flipShow.color)}
                  <span className="dim">{s.players.some((p) => p.color === flipShow.color) ? "" : tr("table.nobodyHere")}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
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
          <Bubbles bubbles={chat.bubbles} pos={(seat) => seatPos(L, seat, s.n, HUMAN)} mine={watching ? undefined : HUMAN} looks={bubbleLooks} />
          <DrinkLayer drinks={drinks.drinks} slides={drinks.slides} pos={seatAt} />
          <AnimatePresence>
            {showChat && !watching && (
              <ChatTray
                onSay={(text) => (talk ? talk.send(text) : chat.say(HUMAN, text))}
                rivals={s.players.filter((p) => p.seat !== HUMAN).map((p) => ({ seat: p.seat, name: p.name }))}
                onDrink={async (to, emoji) => {
                  if (talk) talk.drink(to, emoji);
                  else if (!buyDrink || (await buyDrink(emoji, 1))) drinks.send(HUMAN, to, emoji);
                }}
                onClose={() => setShowChat(false)}
              />
            )}
          </AnimatePresence>
          <FlightLayer flights={flights} speed={t.speed} />

          <AnimatePresence>
            {showLog && (
              <motion.div className="log" initial={{ x: 320 }} animate={{ x: 0 }} exit={{ x: 320 }} role="log" aria-label={tr("table.logAria")}>
                <div className="log-title">{tr("table.logAria")}</div>
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

          <Walkthrough s={s} lessonOn={lessonOn} canvas={canvas} scale={scale} open={walk && !s.winners} onClose={() => setWalk(false)} />
          <TooltipLayer canvas={canvas} scale={scale} H={L.H} />

          <AnimatePresence>{s.winners && paidOut && <GameOver s={s} me={watching || forfeit ? -1 : HUMAN} forfeit={forfeit} pot={pot} history={t.history.current} onAgain={onAgain} againLabel={againLabel} oneGame={clean} firstHand={settings.coached && settings.lesson === FIRST_HAND && !forfeit} firstReward={firstReward} onExit={onExit} />}</AnimatePresence>
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
    <div className="rotate-hint" role="dialog" aria-label={tr("table.turnPhone")}>
      <div className="rotate-phone" aria-hidden />
      <div className="rotate-title">{tr("table.turnSideways")}</div>
      <div className="dim">{tr("table.needsRoom")}</div>
      <button className="btn ghost small" onClick={() => setDismissed(true)}>
        {tr("table.upright")}
      </button>
    </div>
  );
}

export function Confetti() {
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
  againLabel = tr("table.dealAgain"),
  forfeit,
  oneGame,
  firstHand,
  firstReward,
  onExit,
}: {
  firstReward?: Reward | null;
  s: GameState;
  me: number;
  pot: number;
  history: HistoryEntry[];
  onAgain?: () => void;
  againLabel?: string;
  forfeit?: boolean;
  /** a ranked table: no rematch, queue again from the lobby */
  oneGame?: boolean;
  /** a new player's one-hand first lesson: no rematch, it heads on to the lobby tour by itself */
  firstHand?: boolean;
  onExit: () => void;
}) {
  const won = s.winners!.includes(me);
  useEffect(() => {
    if (!firstHand) return;
    // long enough to watch the XP and the season pass land
    const t = window.setTimeout(onExit, firstReward ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [firstHand, firstReward, onExit]);
  if (firstHand)
    return (
      <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {won && !reducedMotion() && <Confetti />}
        <motion.div className="modal first-hand-done" role="dialog" aria-modal="true" aria-labelledby="go-title" initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
          {firstReward ? (
            <FirstWin r={firstReward} won={won} name={s.players[me]?.name ?? ""} onNext={onExit} />
          ) : (
            <>
              <div id="go-title" className="modal-title gold">
                {won ? tr("table.niceHand") : tr("table.thatsAHand")}
              </div>
              <div className="modal-sub">{tr("table.firstHandText")}</div>
              <div className="btns center">
                <button className="btn primary big" onClick={onExit} autoFocus>
                  {tr("table.showAround")}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    );
  const share = Math.floor(pot / s.winners!.length);
  const rows = [...s.players].sort((a, b) => footholdsOf(s, b.seat) - footholdsOf(s, a.seat));
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {won && !reducedMotion() && <Confetti />}
      <motion.div className="modal" role="dialog" aria-modal="true" aria-labelledby="go-title" initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
        {/* The result and the buttons come first, so nothing needs scrolling to leave or deal again. */}
        <div className="go-side">
          <div id="go-title" className={"modal-title" + (won ? " gold" : "")}>
            {won ? tr("table.won") : forfeit ? tr("table.walked") : tr("table.over")}
          </div>
          <div className="modal-sub">
            {s.endReason === "last_call"
              ? tr("table.winLastCall", { count: s.winners!.length, names: list(s.winners!.map((w) => s.players[w].name)) })
              : tr("table.winFootholds", { count: s.winners!.length, names: list(s.winners!.map((w) => s.players[w].name)), n: s.target })}
          </div>
          {forfeit && <div className="modal-sub">{tr("table.forfeit")}</div>}
          {won && (
            <div className="modal-pot">
              <Chips amount={share} counting /> <span>{tr("table.addedChips")}</span>
            </div>
          )}
          <div className="btns center">
            {onAgain ? (
              <button className="btn primary big" onClick={onAgain} autoFocus>
                {againLabel}
              </button>
            ) : oneGame ? null : (
              <button className="btn big" disabled>
                {tr("table.waitHost")}
              </button>
            )}
            <button className={oneGame ? "btn primary big" : "btn ghost"} onClick={onExit} autoFocus={oneGame}>
              {oneGame ? tr("table.backLobby") : tr("table.lobby")}

            </button>
          </div>
        </div>
        <Recap h={history} s={s} />
      </motion.div>
    </motion.div>
  );
}
