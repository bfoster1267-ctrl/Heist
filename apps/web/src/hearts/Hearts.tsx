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
import { ordinal, t, tNodes, tRich, type TKey } from "../i18n";

const PASS_KEY = { left: "hr.passLeft", right: "hr.passRight", across: "hr.passAcross", hold: "hr.passHold" } as const;
/** which way this hand's cards go, in words */
const passDir = (p: keyof typeof PASS_KEY) => t(PASS_KEY[p]);
const seatSide = (seat: number) => (seat ? t(`hr.side${seat}` as TKey) : "");

interface Sweep {
  plays: Play[];
  winner: Seat;
  go: boolean;
  handEnd: boolean;
}

/** Why a card can't be played, in words. */
function whyNot(s: HeartsState, c: PlayingCard): string {
  const tr = s.t;
  const hand = tr.hands[0];
  if (tr.count === 0 && tr.trick.length === 0 && hand.includes(TWO_OF_CLUBS)) return t("hr.twoLeads");
  if (tr.trick.length) {
    const led = cardSuit(tr.trick[0].card);
    if (hand.some((x) => cardSuit(x) === led) && cardSuit(c) !== led) return t("tt.follow", { suit: SUITS[led] });
    if (tr.count === 0 && heartsPoints(c) > 0) return t("hr.noPoints");
  } else if (!s.broken && cardSuit(c) === HEARTS) return t("hr.notBroken");
  return t("tt.cantPlay");
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
    if (!prev.broken && next.broken && !handEnd) setToast(t("hr.broken"));
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
          add(p.x, p.y - 40, `+${gained} XP`, r?.moon === 0 ? t("hr.moon") : t("hr.dodged", { n: 26 - (r?.points[0] ?? 26) }));
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

  const names = useMemo(() => [me?.name ?? t("tt.you"), CREW.lou.name, CREW.duchess.name, CREW.nails.name], [me?.name]);
  const room = me ? heartsRoom(me.progress, Date.now()) : HEARTS_DAY_XP;
  const xpNow = s ? Math.max(0, tallyHeartsXp(heartsTallyOf(s)) - drain) : 0;
  const over = !!s && s.phase === "over" && !sweep && sheet === null;
  const handPts = s ? s.t.taken.map((cs) => cs.reduce((a, c) => a + heartsPoints(c), 0)) : [0, 0, 0, 0];

  const seatView = (i: number): SeatView => {
    const crew = HEARTS_CREW[i];
    return {
      crew: crew?.id ?? null,
      name: names[i],
      role: crew?.role ?? (me?.guest ? t("tt.guest") : t("tt.you")),
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
        title={t("hr.title")}
        stats={
          s ? (
            <>
              {tNodes("tt.handN", { b: <b>{s.hand + 1}</b> })}
              <span className="tt-dot">•</span>
              {s.phase === "over" ? t("hr.final") : t("hr.pass", { dir: passDir(s.pass) })}
              <span className="tt-dot">•</span>
              <b className="xp">+{xpNow} XP</b>
              <span className="tt-dot">•</span>
              <span>{t("tt.leftToday", { n: room })}</span>
              <span className="tt-dot">•</span>
              <span className="arcade-streak-pill">{streak > 0 ? t("solo.streakD", { n: streak }) : t("solo.day1")}</span>
            </>
          ) : (
            t("tt.shuffling")
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
                  {tNodes("hr.passPrompt", { name: <b>{names[passTo]}</b> }, { dir: passDir(s.pass), n: picked.length })}
                </span>
                <button type="button" className="tt-btn primary small" disabled={picked.length !== 3} onClick={onPass}>
                  {t("hr.passBtn", { arrow: s.pass === "left" ? "←" : s.pass === "right" ? "→" : "↑" })}
                </button>
              </div>
            )}
            {yourLead && !toast && (
              <div className="tt-toast" style={{ top: L.cy - 12 }}>
                {s.t.count === 0 ? t("hr.leadTwo") : t("tt.yourLead")}
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
            title={t("hr.name")}
            onClose={closeHowto}
            rules={[
              <>{tRich("hr.r1")}</>,
              <>{t("hr.r2")}</>,
              <>{tRich("hr.r3")}</>,
              <>{t("hr.r4")}</>,
              <>{tRich("hr.r5")}</>,
              <>{t("hr.r6", { n: HEARTS_DAY_XP })}</>,
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
          <Panel label={t("tt.gameOver")}>
            <div className="tt-panel-kicker">{t("tt.gameOverK")}</div>
            <div className="tt-panel-title lost">{t("hr.outplayed")}</div>
            <div className="tt-panel-sub">
              {tNodes(
                "hr.lost",
                { score: <b>{s.scores[s.winner]}</b>, mine: <b>{s.scores[0]}</b> },
                { name: names[s.winner], side: seatSide(s.winner), place: ordinal(1 + s.scores.filter((x) => x < s.scores[0]).length) },
              )}
            </div>
            <div className="tt-panel-btns">
              <button type="button" className="tt-btn primary" onClick={() => { cardSound(3); buzz("tap"); void deal(); }}>
                {t("hr.again")}
              </button>
              <button type="button" className="tt-btn" onClick={() => { click(); onExit(); }}>
                {t("tt.lobby")}
              </button>
            </div>
            {onHeist && (
              <button type="button" className="tt-btn small" onClick={() => { click(); onHeist(); }}>
                {t("tt.tryHeist")}
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


function HeartsSheet({ s, names, mode, onClose }: { s: HeartsState; names: string[]; mode: "peek" | "hand" | "final"; onClose: () => void }) {
  const final = mode === "final";
  const low = Math.min(...s.scores);
  return (
    <Panel onClose={onClose} wide label={t("tt.sheet")}>
      <div className="tt-panel-kicker">{final ? t("tt.finalScores") : t("hr.after", { n: s.results.length })}</div>
      <div className="tt-panel-title">{t("tt.sheetTitle")}</div>
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
      {!s.results.length && <div className="tt-panel-sub">{t("hr.none")}</div>}
      {mode === "hand" && (
        <div className="tt-panel-sub">
          {t("hr.nextHand", { what: s.pass === "hold" ? t("hr.holdNext") : t("hr.passNext", { dir: passDir(s.pass) }) })}
        </div>
      )}
      <button type="button" className="tt-btn primary" onClick={onClose}>
        {final ? t("tt.seeResult") : mode === "hand" ? t("tt.nextHand") : t("tt.backTable")}

      </button>
    </Panel>
  );
}

