import { HOME_TURF, jobBases, type GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { CountUp, Crew, FlipCard } from "./pieces";

function CrewRow({ s, counts, extra }: { s: GameState; counts: { seat: number; k: number }[]; extra?: React.ReactNode }) {
  return (
    <div className="job-crew">
      {counts.filter((c) => c.k > 0).map((c) => (
        <span key={c.seat} className="job-crew-entry" title={s.players[c.seat].name}>
          {Array.from({ length: Math.min(c.k, 6) }, (_, i) => (
            <Crew key={i} color={s.players[c.seat].color} size={16} style={{ marginLeft: i ? -7 : 0 }} />
          ))}
          <span className="job-crew-k">{c.k}</span>
        </span>
      ))}
      {extra}
    </div>
  );
}

export function JobZone({ s }: { s: GameState }) {
  const j = s.job;
  return (
    <AnimatePresence>
      {j && (
        <motion.div
          key={`${j.kind}-${j.boss}-${j.mark}-${j.hideout}-${s.turn}`}
          className={"job" + (j.revealed ? " revealed" : "")}
          role="region"
          aria-label="Current job"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.3 }}
        >
          <JobBody s={s} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function JobBody({ s }: { s: GameState }) {
  const j = s.job!;
  const P = s.players;
  const bust = j.kind === "bust";
  const H = bust ? P[j.boss].hideouts[j.hideout] : P[j.mark].hideouts[j.hideout];
  const base = bust ? { b: H[j.boss], m: H[j.mark] } : jobBases(s, j);
  const mastermind = P[j.boss].role === "mastermind";
  const bCounts = bust ? [{ seat: j.boss, k: H[j.boss] }] : j.side.B.map((k, seat) => ({ seat, k }));
  const mCounts = bust ? [{ seat: j.mark, k: H[j.mark] }] : [{ seat: j.mark, k: H[j.mark] }, ...j.side.M.map((k, seat) => ({ seat, k })).filter((c) => c.seat !== j.mark)];
  const done = j.result === "B" || j.result === "M";
  const title = bust
    ? `BUST · ${P[j.boss].name}'s hideout ${j.hideout + 1}`
    : `${j.wanted ? "WANTED · " : ""}HIT · ${P[j.mark].name}'s hideout ${j.hideout + 1}`;
  return (
    <>
      <div className="job-title">{title}</div>
      <div className="job-sides">
        <div className={"job-side side-b" + (done && j.result === "B" ? " won" : "") + (done && j.result === "M" ? " lost" : "")} data-anchor="job-B">
          <div className="job-who">{bust ? P[j.boss].name : `Boss · ${P[j.boss].name}`}</div>
          <CrewRow s={s} counts={bCounts} extra={j.backups.B ? <span className="bonus">+{j.backups.B} backup</span> : null} />
          <FlipCard card={j.bossCard} revealed={j.revealed} size="sm" />
          <div className="job-total" data-tip={j.revealed ? "Boss total\nCard + crew + bonuses" : "Boss side so far\nCrew and bonuses. The card is still face down."}>{j.revealed ? <CountUp value={j.bTotal} /> : base.b}<span className="job-total-q">{j.revealed ? "" : " + ?"}</span></div>
        </div>
        <div className="job-vs">VS</div>
        <div className={"job-side side-m" + (done && j.result === "M" ? " won" : "") + (done && j.result === "B" ? " lost" : "")} data-anchor="job-M">
          <div className="job-who">{bust ? P[j.mark].name : `Mark · ${P[j.mark].name}`}</div>
          <CrewRow
            s={s}
            counts={mCounts}
            extra={
              <>
                {!bust && <span className="bonus">+{mastermind ? 2 : HOME_TURF} home</span>}
                {j.backups.M ? <span className="bonus">+{j.backups.M} backup</span> : null}
              </>
            }
          />
          <FlipCard card={j.markCard} revealed={j.revealed} size="sm" />
          <div className="job-total" data-tip={j.revealed ? "Mark total\nCard + crew + home turf. Ties go to the Mark." : "Mark side so far\nCrew plus home turf. The card is still face down."}>{j.revealed ? <CountUp value={j.mTotal} /> : base.m}<span className="job-total-q">{j.revealed ? "" : " + ?"}</span></div>
        </div>
      </div>
      {j.bets.length > 0 && (
        <div className="job-bets">
          {j.bets.map((b, i) => (
            <span key={i} className="bet-chip" style={{ borderColor: b.side === "B" ? "#e7b53c" : "#d6452b" }}>
              {P[b.seat].name} ${b.card.cash} on {b.side === "B" ? "Boss" : "Mark"}
            </span>
          ))}
        </div>
      )}
      {j.hackerCall && (
        <div className="job-note" data-tip={"The Hacker\nBefore cards are picked, the Hacker calls a number. If the other side's card shows it, the Hacker wins outright."}>
          {P[j.hackerCall.seat].name}'s Hacker called <b>{j.hackerCall.n}</b>. A {j.hackerCall.n} against them loses.
        </div>
      )}
      <AnimatePresence>
        {j.result && (
          <motion.div className={"job-result r-" + j.result} initial={{ scale: 2.6, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: -6 }} transition={{ type: "spring", stiffness: 320, damping: 16 }}>
            {j.result === "B" ? (bust ? "CLEARED OUT" : "BOSS WINS") : j.result === "M" ? (bust ? "HELD ON" : "MARK HOLDS") : j.result === "deal" ? "DEAL" : "NO DEAL"}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
