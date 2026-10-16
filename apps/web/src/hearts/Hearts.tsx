// Hearts vs three of the crew (Lou, Duchess, Nails). The rules and the bots live in @heist/profile; the
// table plays the bots one card at a time so you can watch each card land and each trick get swept away.
// Only your own passes and plays are sent to the server, which replays the whole game from the seed.

import {
  CREW, HEARTS, HEARTS_CREW, HEARTS_DAY_XP, HEARTS_IDLE_S, HEARTS_PASS_OFFSET, QUEEN_OF_SPADES, TWO_OF_CLUBS,
  applyHearts, cardSuit, dealHearts, getDailyStreak, heartsBotStep, heartsLegal, heartsPickCard, heartsPickPass, heartsPoints,
  heartsRoom, heartsTallyOf, replayHearts, tallyHeartsXp, type HeartsState, type Play, type PlayingCard, type Seat,
} from "@heist/profile";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { VictoryModal } from "../arcade/VictoryModal";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { buzz } from "../haptics";
import { useReducedMotion } from "../prefs";
import { card as cardSound, cardSlam, chip, click, lose as loseSound, shuffle, win as winSound } from "../sound";
import { crewLine } from "../tricks/crew";
import {
  Floats, Hand, HowTo, Panel, SEAT_POS, SUITS, SeatPlate, TopBar, TrickPile, cardName, useBubbles, useFirstTime, useFloats, useLayout,
  type SeatView,
} from "../tricks/TrickTable";
import "./hearts.css";

const PASS_LABEL = { left: "left", right: "right", across: "across", hold: "no pass" } as const;
const SEAT_SIDE = ["", "on your left", "across", "on your right"];

interface Sweep {
  plays: Play[];
  winner: Seat;
  go: boolean;
  handEnd: boolean;
}

/** Why a card can't be played, in words. */
function whyNot(s: HeartsState, c: PlayingCard): string {
  const t = s.t;
  const hand = t.hands[0];
  if (t.count === 0 && t.trick.length === 0 && hand.includes(TWO_OF_CLUBS)) return "The 2♣ leads the first trick";
  if (t.trick.length) {
    const led = cardSuit(t.trick[0].card);
    if (hand.some((x) => cardSuit(x) === led) && cardSuit(c) !== led) return `Follow suit: ${SUITS[led]}`;
    if (t.count === 0 && heartsPoints(c) > 0) return "No points on the first trick";
  } else if (!s.broken && cardSuit(c) === HEARTS) return "Hearts aren't broken yet";
  return "You can't play that one";
}

export function Hearts({
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
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [s, setS] = useState<HeartsState | null>(null);
  const [moves, setMoves] = useState<unknown[]>([]);
  const [picked, setPicked] = useState<PlayingCard[]>([]);
  const [hint, setHint] = useState<PlayingCard[]>([]);
  const [fresh, setFresh] = useState<PlayingCard[]>([]);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [sheet, setSheet] = useState<"hand" | "peek" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [howto, closeHowto] = useFirstTime("heist.hearts.howto");
  const { floats, add } = useFloats();
  const { bubbles, say, hush } = useBubbles();
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  // idle time on your move drains the game's XP, like the other arcade games
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
    const t = heartsTallyOf(replayHearts(g.seed, ms));
    const xp = Math.max(0, tallyHeartsXp(t) - drainRef.current);
    if (xp <= banked.current && !t.over) return;
    banked.current = xp;
    if (t.over) closed.current = true;
    const r = t.won
      ? await act((x) => x.heartsFinish(g.gameId!, ms, drainRef.current))
      : await act((x) => x.heartsBank(g.gameId!, ms, drainRef.current));
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

  const deal = useCallback(async () => {
    if (!initialDeal.current) await bank(false);
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    const g = backend ? await backend.heartsStart(firstSeed, dailyFlag).catch(() => null) : null;
    const seed = g ? g.seed : (firstSeed ?? Math.floor(Math.random() * 2 ** 31));
    setGame({ gameId: g?.gameId ?? null, seed });
    setS(dealHearts(seed));
    setMoves([]);
    setPicked([]);
    setHint([]);
    setFresh([]);
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

  useEffect(() => {
    void deal();
    // the first deal only; later ones come from the buttons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yourMove = !!s && !sweep && !sheet && (s.phase === "pass" || (s.phase === "play" && s.t.turn === 0));
  useEffect(() => {
    if (!yourMove) return;
    lastAct.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - lastAct.current > HEARTS_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [yourMove]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1700);
    return () => clearTimeout(t);
  }, [toast]);

  /** Move the table on to `next` (one card played, by anyone): sounds, quips, and the trick sweep. */
  const step = (prev: HeartsState, next: HeartsState) => {
    const handEnd = next.hand !== prev.hand || (next.phase === "over" && prev.phase !== "over");
    const trickDone = handEnd || next.t.count > prev.t.count;
    const last = handEnd ? (next.phase === "over" ? next.t.last : next.results[next.results.length - 1]?.last ?? null) : next.t.last;
    const played = trickDone ? last?.plays[3]?.card : next.t.trick[next.t.trick.length - 1]?.card;
    if (played === QUEEN_OF_SPADES) {
      cardSlam();
      buzz("bump");
    } else cardSound();
    if (!prev.broken && next.broken && !handEnd) setToast("Hearts are broken");
    const n = next.hand * 52 + next.t.played.length;
    if (trickDone && last) {
      setSweep({ plays: last.plays, winner: last.winner, go: false, handEnd });
      const q = last.plays.find((p) => p.card === QUEEN_OF_SPADES);
      if (q) {
        const taker = HEARTS_CREW[last.winner];
        if (taker) say(last.winner, crewLine(taker.id, "queen", n));
        const giver = HEARTS_CREW[q.seat];
        if (giver && q.seat !== last.winner) say(q.seat, crewLine(giver.id, "dump", n));
      }
      if (handEnd) {
        const r = next.results[next.results.length - 1];
        if (r?.moon !== null && r?.moon !== undefined) {
          const shooter = HEARTS_CREW[r.moon];
          if (shooter) say(r.moon, crewLine(shooter.id, "moon", n), 3200);
        }
        const gained = tallyHeartsXp(heartsTallyOf(next)) - tallyHeartsXp(heartsTallyOf(prev));
        if (gained > 0 && L) {
          const p = L.seats[0];
          add(p.x, p.y - 40, `+${gained} XP`, r?.moon === 0 ? "SHOT THE MOON!" : `Dodged ${26 - (r?.points[0] ?? 26)}`);
        }
      }
    }
    setS(next);
  };

  // the crew play their cards one at a time
  useEffect(() => {
    if (!s || sweep || sheet || howto || s.phase !== "play" || s.t.turn === 0) return;
    const id = setTimeout(() => step(s, heartsBotStep(s)), reduce ? 260 : s.t.trick.length === 0 ? 700 : 520);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, sweep, sheet, howto, reduce]);

  // a finished trick: a beat to see it, then it slides to whoever took it
  useEffect(() => {
    if (!sweep) return;
    if (!sweep.go) {
      const id = setTimeout(() => {
        const pts = sweep.plays.reduce((a, p) => a + heartsPoints(p.card), 0);
        if (pts > 0) chip();
        else cardSound(2);
        if (sweep.winner === 0 && pts > 0) buzz("bump");
        setSweep((w) => (w ? { ...w, go: true } : w));
      }, reduce ? 300 : 820);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setSweep(null);
      if (sweep.handEnd) {
        setSheet("hand");
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
    if (!s || sweep || sheet) return;
    lastAct.current = Date.now();
    if (s.phase === "pass") {
      click();
      buzz("tap");
      setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length >= 3 ? [...p.slice(1), c] : [...p, c]));
      return;
    }
    if (s.phase !== "play" || s.t.turn !== 0) return;
    if (!heartsLegal(s).includes(c)) {
      buzz("bump");
      setToast(whyNot(s, c));
      return;
    }
    const next = applyHearts(s, c);
    if (!next) return;
    buzz("tap");
    setMoves((m) => [...m, c]);
    setHint([]);
    setFresh([]);
    step(s, next);
  };

  const onPass = () => {
    if (!s || s.phase !== "pass" || picked.length !== 3) return;
    const next = applyHearts(s, picked);
    if (!next) return;
    lastAct.current = Date.now();
    cardSound(3);
    buzz("tap");
    setMoves((m) => [...m, [...picked]]);
    setPicked([]);
    setHint([]);
    setFresh(next.received);
    setS(next);
  };

  const onHint = () => {
    if (!s) return;
    if (s.phase === "pass") setHint(heartsPickPass(s.t.hands[0]));
    else if (s.phase === "play" && s.t.turn === 0 && !sweep) setHint([heartsPickCard(s)]);
    else return;
    setTimeout(() => setHint([]), 2600);
  };

  const names = useMemo(() => [me?.name ?? "You", CREW.lou.name, CREW.duchess.name, CREW.nails.name], [me?.name]);
  const room = me ? heartsRoom(me.progress, Date.now()) : HEARTS_DAY_XP;
  const xpNow = s ? Math.max(0, tallyHeartsXp(heartsTallyOf(s)) - drain) : 0;
  const over = !!s && s.phase === "over" && !sweep && sheet === null;
  const handPts = s ? s.t.taken.map((cs) => cs.reduce((a, c) => a + heartsPoints(c), 0)) : [0, 0, 0, 0];

  const seatView = (i: number): SeatView => {
    const crew = HEARTS_CREW[i];
    return {
      crew: crew?.id ?? null,
      name: names[i],
      role: crew?.role ?? (me?.guest ? "Guest" : "You"),
      score: s?.scores[i] ?? 0,
      sub: sweep?.handEnd ? "" : `♥ ${handPts[i]}`,
      active: !!s && !sweep && !sheet && ((s.phase === "play" && s.t.turn === i) || (s.phase === "pass" && i === 0)),
      cards: !s || sweep?.handEnd ? 0 : s.t.hands[i].length,
    };
  };

  const passTo = s ? ((HEARTS_PASS_OFFSET[s.pass] % 4) as Seat) : 0;
  const yourLead = !!s && yourMove && s.phase === "play" && s.t.trick.length === 0;

  return (
    <div className="tt hearts">
      <div className="tt-rim" />
      <TopBar
        title="HEARTS"
        stats={
          s ? (
            <>
              Hand <b>{s.hand + 1}</b>
              <span className="tt-dot">•</span>
              {s.phase === "over" ? "Final" : `Pass ${PASS_LABEL[s.pass]}`}
              <span className="tt-dot">•</span>
              <b className="xp">+{xpNow} XP</b>
              <span className="tt-dot">•</span>
              <span>{room} left today</span>
              <span className="tt-dot">•</span>
              <span className="arcade-streak-pill">{streak > 0 ? `🔥 ${streak}d` : "🔥 Day 1"}</span>
            </>
          ) : (
            "Shuffling…"
          )
        }
        onExit={onExit}
        onHint={onHint}
        hintDisabled={!yourMove}
        onScores={() => setSheet("peek")}
        onNew={() => void deal()}
      />
      {banner && <div className="tt-banner">{banner}</div>}

      <div className="tt-stage" ref={stage}>
        {L && s && (
          <>
            <div className="tt-oval" data-mark="HEARTS" style={{ left: L.cx - L.cw * 1.9, top: L.cy - L.ch * 1.15, width: L.cw * 3.8, height: L.ch * 2.3 }} />
            {([1, 2, 3, 0] as Seat[]).map((i) => (
              <SeatPlate key={SEAT_POS[i]} seat={i} view={seatView(i)} layout={L} bubble={bubbles[i]} />
            ))}
            <TrickPile plays={sweep ? sweep.plays : s.t.trick} layout={L} sweepTo={sweep?.go ? sweep.winner : null} reduce={reduce} />
            <Hand
              cards={sweep?.handEnd ? [] : s.t.hands[0]}
              layout={L}
              playable={s.phase === "play" && s.t.turn === 0 && !sweep ? heartsLegal(s) : null}
              selected={picked}
              hinted={hint}
              fresh={fresh}
              onTap={onTap}
              reduce={reduce}
            />
            {s.phase === "pass" && !sheet && (
              <div className="tt-prompt" style={{ top: L.cy - 20 }}>
                <span>
                  Pass 3 {PASS_LABEL[s.pass]} to <b>{names[passTo]}</b> ({picked.length}/3)
                </span>
                <button type="button" className="tt-btn primary small" disabled={picked.length !== 3} onClick={onPass}>
                  Pass {s.pass === "left" ? "←" : s.pass === "right" ? "→" : "↑"}
                </button>
              </div>
            )}
            {yourLead && !toast && (
              <div className="tt-toast" style={{ top: L.cy - 12 }}>
                {s.t.count === 0 ? "Lead the 2♣" : "Your lead"}
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
        {howto && (
          <HowTo
            title="Hearts"
            onClose={closeHowto}
            rules={[
              <>Avoid points: every <b>♥ is 1</b> and the <b>Q♠ is 13</b>. Lowest score when someone hits <b>100</b> wins.</>,
              <>Pass 3 cards each hand: left, right, across, then hold.</>,
              <>The <b>2♣</b> leads. Follow suit if you can; no points on the first trick.</>,
              <>Hearts can't be led until one's been played.</>,
              <>Take <b>all 26</b> points and you <b>shoot the moon</b>: everyone else gets 26.</>,
              <>XP for every point you dodge, a moon, and the win (up to {HEARTS_DAY_XP} a day).</>,
            ]}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && s && (
          <HeartsSheet
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

      {over && s.winner === 0 && (
        <VictoryModal
          game="hearts"
          gameTitle="Hearts"
          moves={moves.length}
          score={s.scores[0]}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => void deal()}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}
      <AnimatePresence>
        {over && s.winner !== 0 && s.winner !== null && (
          <Panel label="Game over">
            <div className="tt-panel-kicker">GAME OVER</div>
            <div className="tt-panel-title lost">OUTPLAYED</div>
            <div className="tt-panel-sub">
              {names[s.winner]} {SEAT_SIDE[s.winner]} takes it on <b>{s.scores[s.winner]}</b>. You finished on <b>{s.scores[0]}</b>,{" "}
              {ordinal(1 + s.scores.filter((x) => x < s.scores[0]).length)} of 4.
            </div>
            <div className="tt-panel-btns">
              <button type="button" className="tt-btn primary" onClick={() => { cardSound(3); buzz("tap"); void deal(); }}>
                Deal again
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
            game="hearts"
            gameTitle="Hearts"
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

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

function HeartsSheet({ s, names, mode, onClose }: { s: HeartsState; names: string[]; mode: "peek" | "hand" | "final"; onClose: () => void }) {
  const final = mode === "final";
  const low = Math.min(...s.scores);
  return (
    <Panel onClose={onClose} wide label="Score sheet">
      <div className="tt-panel-kicker">{final ? "FINAL SCORES" : `AFTER HAND ${s.results.length}`}</div>
      <div className="tt-panel-title">SCORE SHEET</div>
      <div className="tt-sheet-wrap">
        <table className="tt-sheet">
          <thead>
            <tr>
              <th>#</th>
              {names.map((n) => (
                <th key={n}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.results.map((r, i) => (
              <tr key={i} className={i === s.results.length - 1 ? "latest" : ""}>
                <td>{i + 1}</td>
                {r.points.map((p, k) => (
                  <td key={k} className={r.moon === k ? "lead" : p >= 13 ? "bad" : ""}>
                    {r.moon === k ? "🌙 0" : p}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total">
              <td>Σ</td>
              {s.scores.map((n, k) => (
                <td key={k} className={n === low ? "lead" : ""}>
                  {n}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {!s.results.length && <div className="tt-panel-sub">No hands finished yet. First to 100 ends it; lowest score wins.</div>}
      {mode === "hand" && (
        <div className="tt-panel-sub">
          Next hand: {s.pass === "hold" ? "no passing, hold your cards" : `pass ${PASS_LABEL[s.pass]}`} · Game ends at 100
        </div>
      )}
      <button type="button" className="tt-btn primary" onClick={onClose}>
        {final ? "See result" : mode === "hand" ? "Next hand" : "Back to the table"}
      </button>
    </Panel>
  );
}

