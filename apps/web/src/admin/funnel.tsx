// Where new players drop off: how far each new person got, from the first visit through the coached game,
// a second game, coming back and signing up, with the step most people stop at called out.

import { useState } from "react";
import type { Funnel } from "./api";
import { Link, Stat, day, go, labelOf, num, usePoll, when } from "./bits";
import { Problem, useAdmin, type PageProps } from "./pages";

const DAY = 24 * 60 * 60_000;
const RANGES: [string, string, number | null][] = [
  ["1d", "Last 24 hours", DAY],
  ["7d", "Last 7 days", 7 * DAY],
  ["30d", "Last 30 days", 30 * DAY],
  ["all", "Everything", null],
];

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
/** the server names taps and screens in words, other events by their kind */
const said = (w: string) => (w.includes(" ") ? w : labelOf(w));
const mins = (m: number | null) => (m === null ? "–" : m < 1 ? `${Math.round(m * 60)} sec` : m < 90 ? `${Math.round(m)} min` : `${Math.round(m / 60)} h`);

export function FunnelPage({ s, onAuth, query }: PageProps) {
  const range = query.get("range") ?? (query.get("from") || query.get("to") ? "" : "7d");
  const [from, setFrom] = useState(query.get("from") ?? "");
  const [to, setTo] = useState(query.get("to") ?? "");
  const p = new URLSearchParams();
  const preset = RANGES.find((r) => r[0] === range);
  // a preset's start moves with the clock: rounded to the minute so the fetch stays put between renders
  if (preset) p.set("from", String(preset[2] === null ? 0 : Math.floor((Date.now() - preset[2]) / 60_000) * 60_000));
  else {
    p.set("from", query.get("from") ? String(new Date(query.get("from") + "T00:00").getTime()) : "0");
    if (query.get("to")) p.set("to", String(new Date(query.get("to") + "T23:59:59").getTime()));
  }
  const r = useAdmin<Funnel>(s, `/funnel?${p}`, onAuth);
  usePoll(r.reload, 60_000);
  const f = r.data;
  const start = f?.steps[0]?.reached ?? 0;
  const worst = f?.worst ? f.steps.find((x) => x.key === f.worst!.step) : undefined;

  return (
    <>
      <div className="card">
        <div className="filters">
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" className={`fam-chip ${range === k ? "on" : ""}`} onClick={() => go(`/dropoff?range=${k}`)}>
              {label}
            </button>
          ))}
          <form
            className="filters inline"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new URLSearchParams();
              if (from) q.set("from", from);
              if (to) q.set("to", to);
              go(`/dropoff?${q}`);
            }}
          >
            <label className="date">
              From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="date">
              To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button className="btn primary" disabled={!from && !to}>
              Show
            </button>
          </form>
        </div>
        <p className="dim small">Counts people whose first visit falls in this range. Your own play and Claude's testing are left out.</p>
      </div>
      <Problem error={r.error} />
      {!f ? null : f.people === 0 ? (
        <div className="card">
          <p className="dim">No new people in this range.</p>
        </div>
      ) : (
        <>
          {f.worst && worst && (
            <div className="card dropoff-callout">
              <div className="dim small">Most people leave after</div>
              <h2>{f.worst.label}</h2>
              <p>
                {num(f.worst.stopped)} of {num(f.worst.of)} new people ({pct(f.worst.stopped, f.worst.of)}) got this far and no further.
                {worst.minutes !== null && ` They spent about ${mins(worst.minutes)} on the site in all.`}
                {worst.last[0] && ` The last thing most of them did: ${said(worst.last[0].what)}.`}
              </p>
            </div>
          )}
          <section className="stats">
            <Stat label="New people" tone="gold" value={num(f.people)} sub={day(f.from || f.logStart || Date.now()) + " to " + day(Math.min(f.to, Date.now()))} />
            {(["lesson", "finish", "back", "signup"] as const).map((k) => {
              const st = f.steps.find((x) => x.key === k);
              return st ? <Stat key={k} label={st.label} value={pct(st.reached, start)} sub={`${num(st.reached)} people`} /> : null;
            })}
          </section>
          <div className="card">
            <div className="card-head">
              <h3>How far new people got</h3>
              <span className="dim small">each person counts at every step up to the furthest one they reached</span>
            </div>
            <ol className="funnel">
              {f.steps.map((st, i) => (
                <li key={st.key} className={st.key === f.worst?.step ? "worst" : ""}>
                  <div className="funnel-step">
                    <b>{st.label}</b>
                    <span className="dim small">{st.note}</span>
                  </div>
                  <span className="hbar">
                    <i style={{ width: `${(st.reached / Math.max(1, start)) * 100}%` }} />
                  </span>
                  <div className="funnel-n">
                    <b>{num(st.reached)}</b> <span className="dim">{pct(st.reached, start)}</span>
                  </div>
                  <div className="funnel-left">
                    {i < f.steps.length - 1 && st.stopped > 0 ? (
                      <>
                        <span className="down">{num(st.stopped)} stopped here</span>
                        <span className="dim small">
                          {" "}
                          after {mins(st.minutes)}
                          {st.last[0] && `; last: ${st.last.slice(0, 2).map((l) => `${said(l.what)} (${l.count})`).join(", ")}`}
                        </span>
                      </>
                    ) : i === f.steps.length - 1 && st.reached > 0 ? (
                      <span className="up">made it all the way</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <p className="dim small">
              {f.turnsSince ? `Turn-by-turn tracking started ${when(f.turnsSince)}; people before that show no turns.` : "Turn-by-turn tracking hasn't seen a game yet, so the turn steps will appear once people play."}
              {f.logStart && f.from < f.logStart && ` The log on hand starts ${when(f.logStart)}.`}
            </p>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Newest people and where they stopped</h3>
            </div>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>First visit</th>
                    <th className="r">Time on site</th>
                    <th>Got as far as</th>
                  </tr>
                </thead>
                <tbody>
                  {f.newest.map((x) => (
                    <tr key={x.person}>
                      <td>
                        <Link to={`/players/${x.userId}`}>{x.name || "Guest"}</Link>
                      </td>
                      <td>{when(x.first)}</td>
                      <td className="r">{mins((x.last - x.first) / 60_000)}</td>
                      <td>
                        {x.step}
                        {x.turn && !x.step.startsWith("Reached turn") ? <span className="dim small"> (turn {x.turn})</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
