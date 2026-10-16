// Spades: you and Ledger (across) against Lou and Duchess. Bid, play to your contract, mind your bags.
// A full game runs to 500; a quick one (and the daily deal) to 250. The rules and bots live in @heist/profile:
// only your own bids and plays go to the server, which replays everyone's from the seed.

import {
  CREW, SPADES, SPADES_CREW, SPADES_DAY_XP, SPADES_IDLE_S, SPADES_QUICK_TARGET, SPADES_TARGET, applySpades, cardSuit, dealSpades,
  getDailyStreak, replaySpades, spadesBidMove, spadesBotStep, spadesLegal, spadesPickBid, spadesPickCard, spadesRoom, spadesTallyOf,
  spadesTarget, tallySpadesXp, type Play, type PlayingCard, type Seat, type SpadesState,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { VictoryModal } from "../arcade/VictoryModal";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { buzz } from "../haptics";
import { useReducedMotion } from "../prefs";
import { card as cardSound, cardSlam, chip, chipRun, click, lose as loseSound, shuffle, win as winSound } from "../sound";
import { crewLine } from "../tricks/crew";
import {
  Floats, Hand, HowTo, Panel, SEAT_POS, SUITS, SeatPlate, TopBar, TrickPile, useBubbles, useFirstTime, useFloats, useLayout,
  type SeatView,
} from "../tricks/TrickTable";
import "./spades.css";

interface Sweep {
  plays: Play[];
  winner: Seat;
  go: boolean;
  handEnd: boolean;
}

const QUICK_KEY = "heist.spades.quick";
const savedQuick = () => {
  try {
    return localStorage.getItem(QUICK_KEY) === "1";
  } catch {
    return false;
  }
};

function whyNot(s: SpadesState, c: PlayingCard): string {
  const t = s.t;
  if (t.trick.length) {
    const led = cardSuit(t.trick[0].card);
    if (t.hands[0].some((x) => cardSuit(x) === led) && cardSuit(c) !== led) return `Follow suit: ${SUITS[led]}`;
  } else if (!s.broken && cardSuit(c) === SPADES) return "Spades aren't broken yet";
  return "You can't play that one";
}

const bidLabel = (b: number | null) => (b === null ? "…" : b === 0 ? "NIL" : String(b));

export function Spades({
  onExit,
  onHeist,
  banner,
  initialSeed,
  isDaily = false,
  challengerTime,
  challengerMoves,
  challengerScore,
}: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
  initialSeed?: number;
  isDaily?: boolean;
  challengerTime?: string | null;
  challengerMoves?: number | null;
  challengerScore?: number | null;
}) {
  const { backend, act, showReward, me } = useAccount();
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const L = useLayout(stage);
  const initialDeal = useRef(true);
  const [game, setGame] = useState<{ gameId: string | null; seed: number; target: number } | null>(null);
  const [s, setS] = useState<SpadesState | null>(null);
  const [moves, setMoves] = useState<unknown[]>([]);
  const [hint, setHint] = useState<PlayingCard[]>([]);
  const [bidPick, setBidPick] = useState<number | null>(null);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [sheet, setSheet] = useState<"hand" | "peek" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // picking full or quick: open at the start (never for the daily, which is always quick)
  const [choosing, setChoosing] = useState(!isDaily);
  const [quick, setQuick] = useState(savedQuick);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [howto, closeHowto] = useFirstTime("heist.spades.howto");
  const { floats, add } = useFloats();
  const { bubbles, say, hush } = useBubbles();
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const banked = useRef(0);
  const closed = useRef(false);
  const live = useRef({ game, moves });
  live.current = { game, moves };

  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    if (!g?.gameId || closed.current || !ms.length) return;
    // the same replay the server runs
    const t = spadesTallyOf(replaySpades(g.seed, ms, g.target));
    const xp = Math.max(0, tallySpadesXp(t) - drainRef.current);
    if (xp <= banked.current && !t.over) return;
    banked.current = xp;
    if (t.over) closed.current = true;
    const r = t.won
      ? await act((x) => x.spadesFinish(g.gameId!, ms, drainRef.current))
      : await act((x) => x.spadesBank(g.gameId!, ms, drainRef.current));
    if (r?.reward && (show || r.reward.levelAfter > r.reward.levelBefore)) showReward(r.reward);
  }, [act, showReward]);

  useEffect(() => () => void bank(true), [bank]);
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") void bank(false);
      else lastAct.current = Date.now();
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [bank]);

  const deal = useCallback(async (wantQuick: boolean) => {
    if (!initialDeal.current) await bank(false);
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    const g = backend ? await backend.spadesStart(firstSeed, dailyFlag, wantQuick).catch(() => null) : null;
    const seed = g ? g.seed : (firstSeed ?? Math.floor(Math.random() * 2 ** 31));
    const target = g ? g.target : spadesTarget(dailyFlag || wantQuick);
    setGame({ gameId: g?.gameId ?? null, seed, target });
    setS(dealSpades(seed, target));
    setMoves([]);
    setHint([]);
    setBidPick(null);
    setSweep(null);
    setSheet(null);
    hush();
    setDrain(0);
    banked.current = 0;
    closed.current = false;
    lastAct.current = Date.now();
    shuffle();
    buzz("tap");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, initialSeed, isDaily, bank]);

  // the daily deals straight away; otherwise the mode card deals
  useEffect(() => {
    if (isDaily) void deal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (q: boolean) => {
    click();
    buzz("tap");
    setQuick(q);
    try {
      localStorage.setItem(QUICK_KEY, q ? "1" : "0");
    } catch {
      /* fine without */
    }
    setChoosing(false);
    void deal(q);
  };

  const yourMove = !!s && !sweep && !sheet && !choosing && s.phase !== "over" && s.t.turn === 0;
  useEffect(() => {
    if (!yourMove) return;
    lastAct.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - lastAct.current > SPADES_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [yourMove]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const step = (prev: SpadesState, next: SpadesState) => {
    const n = next.hand * 52 + next.t.played.length + next.bids.filter((b) => b !== null).length;
    if (prev.phase === "bid") {
      const seat = prev.t.turn;
      const b = next.phase === "bid" || next.hand === prev.hand ? next.bids[seat] : null;
      chip();
      const crew = SPADES_CREW[seat];
      if (crew && b === 0) say(seat, crewLine(crew.id, "nil", n));
      setS(next);
      return;
    }
    const handEnd = next.hand !== prev.hand || (next.phase === "over" && prev.phase !== "over");
    const trickDone = handEnd || next.t.count > prev.t.count;
    const last = handEnd ? (next.phase === "over" ? next.t.last : next.results[next.results.length - 1]?.last ?? null) : next.t.last;
    const played = trickDone ? last?.plays[3]?.card : next.t.trick[next.t.trick.length - 1]?.card;
    const ledSuit = trickDone ? (last ? cardSuit(last.plays[0].card) : null) : next.t.trick.length ? cardSuit(next.t.trick[0].card) : null;
    // a spade on another suit is a trump: it lands hard
    if (played !== undefined && cardSuit(played) === SPADES && ledSuit !== SPADES) {
      cardSlam();
      buzz("bump");
    } else cardSound();
    if (!prev.broken && next.broken && !handEnd) setToast("Spades are broken");
    if (trickDone && last) {
      setSweep({ plays: last.plays, winner: last.winner, go: false, handEnd });
      if (handEnd) {
        const r = next.results[next.results.length - 1];
        if (r) {
          const mate = SPADES_CREW[2]!;
          if (r.made[0] === true) say(2, crewLine(mate.id, "good", n), 2600);
          else if (r.made[0] === false) say(2, crewLine(mate.id, "bad", n), 2600);
          const opp = SPADES_CREW[n % 2 ? 1 : 3]!;
          const oppSeat = n % 2 ? 1 : 3;
          if (r.made[1] === false) say(oppSeat, crewLine(opp.id, "bad", n + 1), 2600);
          else if (r.made[1] === true) say(oppSeat, crewLine(opp.id, "good", n + 1), 2600);
          if (r.bagPenalty[0]) setToast("10 bags: -100 for your team");
          else if (r.bagPenalty[1]) setToast("They bagged out: -100");
        }
        const gained = tallySpadesXp(spadesTallyOf(next)) - tallySpadesXp(spadesTallyOf(prev));
        if (gained > 0 && L) {
          const p = L.seats[0];
          add(p.x, p.y - 40, `+${gained} XP`, r?.made[0] ? "BID MADE" : r && r.bids[0] === 0 && r.tricks[0] === 0 ? "NIL MADE" : "TRICKS");
        }
      }
    }
    setS(next);
  };

  // the crew bid and play one at a time
  useEffect(() => {
    if (!s || sweep || sheet || howto || choosing || s.phase === "over" || s.t.turn === 0) return;
    const wait = reduce ? 260 : s.phase === "bid" ? 650 : s.t.trick.length === 0 ? 700 : 520;
    const id = setTimeout(() => step(s, spadesBotStep(s)), wait);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, sweep, sheet, howto, choosing, reduce]);

  useEffect(() => {
    if (!sweep) return;
    if (!sweep.go) {
      const id = setTimeout(() => {
        cardSound(2);
        if (sweep.winner === 0 || sweep.winner === 2) buzz("tap");
        setSweep((w) => (w ? { ...w, go: true } : w));
      }, reduce ? 300 : 820);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setSweep(null);
      if (sweep.handEnd) {
        setSheet("hand");
        chipRun(6);
        if (s?.phase === "over") {
          if (s.winner === 0) {
            winSound();
            buzz("win");
          } else {
            loseSound();
            buzz("alert");
          }
          void bank(true);
        } else void bank(false);
      }
    }, reduce ? 160 : 480);
    return () => clearTimeout(id);
  }, [sweep, reduce, s, bank]);

  const onTap = (c: PlayingCard) => {
    if (!s || sweep || sheet || s.phase !== "play" || s.t.turn !== 0) return;
    lastAct.current = Date.now();
    if (!spadesLegal(s).includes(c)) {
      buzz("bump");
      setToast(whyNot(s, c));
      return;
    }
    const next = applySpades(s, c);
    if (!next) return;
    buzz("tap");
    setMoves((m) => [...m, c]);
    setHint([]);
    step(s, next);
  };

  const onBid = (n: number) => {
    if (!s || s.phase !== "bid" || s.t.turn !== 0) return;
    const m = spadesBidMove(n);
    const next = applySpades(s, m);
    if (!next) return;
    lastAct.current = Date.now();
    chip();
    buzz("tap");
    setMoves((ms) => [...ms, m]);
    setBidPick(null);
    setS(next);
  };

  const suggested = s && s.phase === "bid" && s.t.turn === 0 ? spadesPickBid(s, 0, 0) : null;
  const onHint = () => {
    if (!s || !yourMove) return;
    if (s.phase === "bid") {
      setBidPick(suggested);
      return;
    }
    setHint([spadesPickCard(s)]);
    setTimeout(() => setHint([]), 2600);
  };

  const names = useMemo(() => [me?.name ?? "You", CREW.lou.name, CREW.ledger.name, CREW.duchess.name], [me?.name]);
  const room = me ? spadesRoom(me.progress, Date.now()) : SPADES_DAY_XP;
  const xpNow = s ? Math.max(0, tallySpadesXp(spadesTallyOf(s)) - drain) : 0;
  const over = !!s && s.phase === "over" && !sweep && sheet === null;

  const seatView = (i: number): SeatView => {
    const crew = SPADES_CREW[i];
    const b = s?.bids[i] ?? null;
    const showHand = !!s && !sweep?.handEnd;
    return {
      crew: crew?.id ?? null,
      name: names[i],
      role: i === 2 ? "Your partner" : crew?.role ?? (me?.guest ? "Guest" : "You"),
      score: showHand ? s!.t.tricks[i] : 0,
      sub: showHand ? (b === null ? "bid …" : b === 0 ? "NIL" : `bid ${b}`) : "",
      active: !!s && !sweep && !sheet && s.phase !== "over" && s.t.turn === i,
      cards: showHand ? s!.t.hands[i].length : 0,
      mate: i === 0 || i === 2,
      dealer: !!s && s.dealer === i,
    };
  };

  const target = game?.target ?? (quick ? SPADES_QUICK_TARGET : SPADES_TARGET);
  const yourLead = !!s && yourMove && s.phase === "play" && s.t.trick.length === 0;

  return (
    <div className="tt spades">
      <div className="tt-rim" />
      <TopBar
        title="SPADES"
        stats={
          s ? (
            <>
              Us <b>{s.scores[0]}</b> · Them <b>{s.scores[1]}</b>
              <span className="tt-dot">•</span>
              Bags <b>{s.bags[0]}</b>
              <span className="tt-dot">•</span>
              To <b>{target}</b>
              <span className="tt-dot">•</span>
              <b className="xp">+{xpNow} XP</b>
              <span className="tt-dot">•</span>
              <span>{room} left today</span>
              <span className="tt-dot">•</span>
              <span className="arcade-streak-pill">{streak > 0 ? `🔥 ${streak}d` : "🔥 Day 1"}</span>
            </>
          ) : (
            "Pick your game"
          )
        }
        onExit={onExit}
        onHint={onHint}
        hintDisabled={!yourMove}
        onScores={() => s && setSheet("peek")}
        onNew={() => setChoosing(true)}
      />
      {banner && <div className="tt-banner">{banner}</div>}

      <div className="tt-stage" ref={stage}>
        {L && s && (
          <>
            <div className="tt-oval" data-mark="SPADES" style={{ left: L.cx - L.cw * 1.9, top: L.cy - L.ch * 1.15, width: L.cw * 3.8, height: L.ch * 2.3 }} />
            {([1, 2, 3, 0] as Seat[]).map((i) => (
              <SeatPlate key={SEAT_POS[i]} seat={i} view={seatView(i)} layout={L} bubble={bubbles[i]} />
            ))}
            <TrickPile plays={sweep ? sweep.plays : s.t.trick} layout={L} sweepTo={sweep?.go ? sweep.winner : null} reduce={reduce} />
            <Hand
              cards={sweep?.handEnd ? [] : s.t.hands[0]}
              layout={L}
              playable={s.phase === "play" && s.t.turn === 0 && !sweep ? spadesLegal(s) : null}
              hinted={hint}
              onTap={onTap}
              reduce={reduce}
            />
            <AnimatePresence>
              {s.phase === "bid" && s.t.turn === 0 && !sheet && !choosing && !sweep && (
                <motion.div
                  className="tt-bidbox"
                  style={{ top: L.cy, left: L.cx }}
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                >
                  <div className="tt-bidbox-head">
                    <b>YOUR BID</b>
                    <span>
                      {names[2]}: <b>{bidLabel(s.bids[2])}</b> · Them: <b>{bidLabel(s.bids[1])}</b> + <b>{bidLabel(s.bids[3])}</b>
                    </span>
                  </div>
                  <div className="tt-bids">
                    {Array.from({ length: 14 }, (_, n) => (
                      <button
                        type="button"
                        key={n}
                        className={`tt-bid ${n === 0 ? "nil" : ""} ${n === suggested ? "suggest" : ""} ${n === bidPick ? "on" : ""}`}
                        onClick={() => {
                          click();
                          buzz("tap");
                          setBidPick(n);
                        }}
                        aria-label={n === 0 ? "Bid Nil" : `Bid ${n}`}
                      >
                        {n === 0 ? "NIL" : n}
                      </button>
                    ))}
                  </div>
                  <div className="tt-bidbox-foot">
                    <span>Ledger reads your hand as {suggested === 0 ? "a Nil" : suggested}</span>
                    <button type="button" className="tt-btn primary small" disabled={bidPick === null} onClick={() => bidPick !== null && onBid(bidPick)}>
                      {bidPick === null ? "Pick a bid" : bidPick === 0 ? "Go Nil" : `Bid ${bidPick}`}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {yourLead && !toast && (
              <div className="tt-toast" style={{ top: L.cy - 12 }}>
                Your lead
              </div>
            )}
            {toast && (
              <div className="tt-toast warn" style={{ top: L.cy - 12 }}>
                {toast}
              </div>
            )}
          </>
        )}
      </div>

      <Floats floats={floats} />

      <AnimatePresence>
        {choosing && !howto && (
          <Panel label="Choose a game" onClose={s ? () => setChoosing(false) : undefined}>
            <div className="tt-panel-kicker">YOU &amp; {CREW.ledger.name.toUpperCase()} VS {CREW.lou.name.toUpperCase()} &amp; {CREW.duchess.name.toUpperCase()}</div>
            <div className="tt-panel-title">SPADES</div>
            <div className="tt-modes">
              <button type="button" className={`tt-mode ${quick ? "on" : ""}`} onClick={() => start(true)}>
                <b>QUICK GAME · 250</b>
                <span>About 5 hands. A coffee-break heist.</span>
              </button>
              <button type="button" className={`tt-mode ${!quick ? "on" : ""}`} onClick={() => start(false)}>
                <b>FULL GAME · 500</b>
                <span>The classic race. Bags bite harder.</span>
              </button>
            </div>
            {s && s.phase !== "over" && <div className="tt-panel-sub">Starting over ends the game you're in.</div>}
          </Panel>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {howto && (
          <HowTo
            title="Spades"
            onClose={closeHowto}
            rules={[
              <>You and <b>{CREW.ledger.name}</b> (across) are a team against {CREW.lou.name} and {CREW.duchess.name}.</>,
              <>Everyone <b>bids</b> the tricks they'll take. <b>Nil</b> (0) is +100 if you take none, -100 if you take one.</>,
              <><b>Spades are trump</b> and can't be led until one's been played. Follow suit if you can.</>,
              <>Make your team's bid for <b>10 a trick</b>; extras are <b>bags</b> (+1 each). <b>10 bags cost 100</b>. Miss it and lose 10 a trick.</>,
              <>First team to <b>500</b> (or 250 in a quick game) wins. A team at -200 is out.</>,
              <>XP for your tricks, every bid your team makes, a Nil, and the win (up to {SPADES_DAY_XP} a day).</>,
            ]}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && s && (
          <SpadesSheet
            s={s}
            names={names}
            mode={sheet === "peek" ? "peek" : s.phase === "over" ? "final" : "hand"}
            onClose={() => {
              click();
              buzz("tap");
              const wasHand = sheet === "hand";
              setSheet(null);
              if (wasHand && s.phase !== "over") shuffle();
            }}
          />
        )}
      </AnimatePresence>

      {over && s.winner === 0 && !choosing && (
        <VictoryModal
          game="spades"
          gameTitle="Spades"
          moves={moves.length}
          score={s.scores[0]}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => setChoosing(true)}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}
      <AnimatePresence>
        {over && s.winner === 1 && !choosing && (
          <Panel label="Game over">
            <div className="tt-panel-kicker">GAME OVER</div>
            <div className="tt-panel-title lost">SET UP</div>
            <div className="tt-panel-sub">
              {CREW.lou.name} and {CREW.duchess.name} take it, <b>{s.scores[1]}</b> to <b>{s.scores[0]}</b>. {CREW.ledger.name} wants a rematch.
            </div>
            <div className="tt-panel-btns">
              <button type="button" className="tt-btn primary" onClick={() => { cardSound(3); buzz("tap"); setChoosing(true); }}>
                Rematch
              </button>
              <button type="button" className="tt-btn" onClick={() => { click(); onExit(); }}>
                Lobby
              </button>
            </div>
            {onHeist && (
              <button type="button" className="tt-btn small" onClick={() => { click(); onHeist(); }}>
                Try Heist, the bluffing game →
              </button>
            )}
          </Panel>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="spades"
            gameTitle="Spades"
            seed={game.seed}
            score={s?.scores[0]}
            challengerTime={challengerTime}
            challengerMoves={challengerMoves}
            challengerScore={challengerScore}
            onClose={() => setChallengeOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SpadesSheet({ s, names, mode, onClose }: { s: SpadesState; names: string[]; mode: "peek" | "hand" | "final"; onClose: () => void }) {
  const final = mode === "final";
  const team = (r: SpadesState["results"][number], k: 0 | 1) => {
    const a = r.bids[k];
    const b = r.bids[k + 2];
    return `${bidLabel(a)}+${bidLabel(b)} · ${r.tricks[k] + r.tricks[k + 2]}`;
  };
  return (
    <Panel onClose={onClose} wide label="Score sheet">
      <div className="tt-panel-kicker">{final ? "FINAL SCORES" : `AFTER HAND ${s.results.length} · PLAYING TO ${s.target}`}</div>
      <div className="tt-panel-title">SCORE SHEET</div>
      <div className="tt-sheet-wrap">
        <table className="tt-sheet">
          <thead>
            <tr>
              <th>#</th>
              <th>Bids · Won</th>
              <th>Us</th>
              <th>Bids · Won</th>
              <th>Them</th>
            </tr>
          </thead>
          <tbody>
            {s.results.map((r, i) => (
              <tr key={i} className={i === s.results.length - 1 ? "latest" : ""}>
                <td>{i + 1}</td>
                <td>{team(r, 0)}</td>
                <td className={r.delta[0] < 0 ? "bad" : r.made[0] ? "lead" : ""}>
                  {r.delta[0] > 0 ? "+" : ""}
                  {r.delta[0]}
                  {r.bagPenalty[0] ? " 🎒" : ""}
                </td>
                <td>{team(r, 1)}</td>
                <td className={r.delta[1] < 0 ? "bad" : r.made[1] ? "lead" : ""}>
                  {r.delta[1] > 0 ? "+" : ""}
                  {r.delta[1]}
                  {r.bagPenalty[1] ? " 🎒" : ""}
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>Σ</td>
              <td />
              <td className={s.scores[0] >= s.scores[1] ? "lead" : ""}>{s.scores[0]}</td>
              <td />
              <td className={s.scores[1] > s.scores[0] ? "lead" : ""}>{s.scores[1]}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tt-panel-sub">
        {names[0]} &amp; {names[2]}: <b>{s.bags[0]}</b> bags · {names[1]} &amp; {names[3]}: <b>{s.bags[1]}</b> bags (10 cost 100)
      </div>
      <button type="button" className="tt-btn primary" onClick={onClose}>
        {final ? "See result" : mode === "hand" ? "Next hand" : "Back to the table"}
      </button>
    </Panel>
  );
}
