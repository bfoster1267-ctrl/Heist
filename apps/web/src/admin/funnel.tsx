// Where new players drop off: how far each new person got, from the first visit through the coached game,
// a second game, coming back and signing up, with the step most people stop at called out.

import { useState } from "react";
import type { Funnel } from "./api";
import { ARCADE, Link, Stat, day, go, labelOf, num, usePoll, when, PlayerNum } from "./bits";
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
  const game = query.get("game") ?? "all";
  const source = query.get("source") ?? "all";
  const [from, setFrom] = useState(query.get("from") ?? "");
  const [to, setTo] = useState(query.get("to") ?? "");
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const qs = (o: Record<string, string>) => {
    const next = new URLSearchParams(query);
    for (const [k, v] of Object.entries(o)) {
      if (!v || ((k === "game" || k === "source") && v === "all")) next.delete(k);
      else next.set(k, v);
    }
    return `/dropoff?${next}`;
  };
  const p = new URLSearchParams();
  const preset = RANGES.find((r) => r[0] === range);
  // a preset's start moves with the clock: rounded to the minute so the fetch stays put between renders
  if (preset) p.set("from", String(preset[2] === null ? 0 : Math.floor((Date.now() - preset[2]) / 60_000) * 60_000));
  else {
    p.set("from", query.get("from") ? String(new Date(query.get("from") + "T00:00").getTime()) : "0");
    if (query.get("to")) p.set("to", String(new Date(query.get("to") + "T23:59:59").getTime()));
  }
  if (game && game !== "all") p.set("game", game);
  if (source !== "all") p.set("source", source);
  const r = useAdmin<Funnel>(s, `/funnel?${p}`, onAuth);
  usePoll(r.reload, 60_000);
  const f = r.data;
  const start = f?.steps[0]?.reached ?? 0;
  const worst = f?.worst ? f.steps.find((x) => x.key === f.worst!.step) : undefined;
  const stSelected = f?.steps.find((x) => x.key === selectedStep);
  const filteredNewest = selectedStep
    ? f?.newest.filter((x) => x.stepKey === selectedStep || x.step === stSelected?.label) ?? []
    : f?.newest ?? [];

  return (
    <>
      <div className="card">
        <div className="filters">
          <select value={game} onChange={(e) => go(qs({ game: e.target.value }))}>
            <option value="all">All game types</option>
            <option value="arcade">All arcade card games</option>
            {ARCADE.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
            <option value="heist">Heist (Solo & Online)</option>
          </select>
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" className={`fam-chip ${range === k ? "on" : ""}`} onClick={() => go(qs({ range: k, from: "", to: "" }))}>
              {label}
            </button>
          ))}
          <form
            className="filters inline"
            onSubmit={(e) => {
              e.preventDefault();
              go(qs({ range: "", from, to }));
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
        {f?.sources && f.sources.length > 0 && (
          <div className="filters source-filter">
            <span className="dim small">Came from</span>
            <button type="button" className={`fam-chip ${source === "all" ? "on" : ""}`} onClick={() => go(qs({ source: "all" }))}>
              Everyone <span className="dim">{num(f.sources.reduce((n, x) => n + x.people, 0))}</span>
            </button>
            {f.sources.map((x) => (
              <button key={x.key} type="button" className={`fam-chip ${source === x.key ? "on" : ""}`} onClick={() => go(qs({ source: x.key }))}>
                {x.label} <span className="dim">{num(x.people)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="dim small">Counts people whose first visit falls in this range. Your own play, Claude's testing and <Link to="/bots">bot visits</Link> are left out.</p>
        {(source === "ads" || source === "meta") && <p className="dim small">Ad visitors are told apart by the ad link they arrive on (Google's or Meta's click id, or ?play=1), recorded from Oct 20, 2026. Meta ads are the ones with Meta's click id or arriving from Facebook or Instagram.</p>}
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
              <span className="dim small">tap any step to inspect players who stopped there and study what they did before</span>
            </div>
            <ol className="funnel">
              {f.steps.map((st, i) => {
                const isSelected = selectedStep === st.key;
                const isWorst = st.key === f.worst?.step;
                const isLast = i === f.steps.length - 1;
                return (
                  <li
                    key={st.key}
                    className={`funnel-item ${isWorst ? "worst" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedStep(isSelected ? null : st.key)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isSelected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedStep(isSelected ? null : st.key);
                      }
                    }}
                  >
                    <div className="funnel-step">
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <b>{st.label}</b>
                        <span className="funnel-expand-icon">{isSelected ? "▲" : "▼"}</span>
                      </div>
                      <span className="dim small">{st.note}</span>
                    </div>
                    <span className="hbar">
                      <i style={{ width: `${(st.reached / Math.max(1, start)) * 100}%` }} />
                    </span>
                    <div className="funnel-n">
                      <b>{num(st.reached)}</b> <span className="dim">{pct(st.reached, start)}</span>
                    </div>
                    <div className="funnel-left">
                      {!isLast && st.stopped > 0 ? (
                        <>
                          <span className="down">{num(st.stopped)} stopped here</span>
                          <span className="dim small">
                            {" "}
                            after {mins(st.minutes)}
                            {st.last[0] && `; last: ${st.last.slice(0, 2).map((l) => `${said(l.what)} (${l.count})`).join(", ")}`}
                          </span>
                          <span className="funnel-click-hint">{isSelected ? "Hide players ▲" : "Tap to see players ▼"}</span>
                        </>
                      ) : isLast && st.reached > 0 ? (
                        <>
                          <span className="up">made it all the way</span>
                          {st.stopped > 0 && <span className="dim small"> ({num(st.stopped)} signed up)</span>}
                          <span className="funnel-click-hint">{isSelected ? "Hide players ▲" : "Tap to see players ▼"}</span>
                        </>
                      ) : (
                        <>
                          <span className="dim small">0 stopped here</span>
                          <span className="funnel-click-hint">{isSelected ? "Hide details ▲" : "Tap to see details ▼"}</span>
                        </>
                      )}
                    </div>

                    {isSelected && (
                      <div className="funnel-drilldown" onClick={(e) => e.stopPropagation()}>
                        <div className="funnel-drilldown-header">
                          <div className="funnel-drilldown-title">
                            <h4>
                              Players who stopped at "{st.label}" ({num(st.people?.length ?? st.stopped)})
                            </h4>
                            <span className="dim small">
                              {st.stopped > 0
                                ? `Median time on site: ${mins(st.minutes)}. Tap any player or "Study player →" to inspect their complete activity history.`
                                : `All ${num(st.reached)} players who reached this step kept going.`}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => setSelectedStep(null)}
                            aria-label="Close details"
                          >
                            Close ✕
                          </button>
                        </div>

                        {!st.people || st.people.length === 0 ? (
                          <p className="dim small" style={{ margin: "8px 0" }}>
                            No player records found for this step in this timeframe.
                          </p>
                        ) : (
                          <div className="funnel-drilldown-list">
                            {st.people.map((p) => (
                              <div
                                key={p.person}
                                className="funnel-player-card"
                                onClick={() => go(`/players/${p.userId}`)}
                                title={`Study ${p.name || "Guest"}'s full activity`}
                              >
                                <div className="funnel-player-top">
                                  <div className="funnel-player-identity">
                                    <span className="funnel-player-avatar">👤</span>
                                    <Link
                                      to={`/players/${p.userId}`}
                                      className="funnel-player-name"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {p.name || "Guest"}
                                    </Link>
                                    <PlayerNum id={p.userId} />
                                    <span className="dim small">· {mins(p.minutes ?? ((p.last - p.first) / 60_000))} on site</span>
                                    <span className="dim small">· {when(p.last)}</span>
                                  </div>
                                  <Link
                                    to={`/players/${p.userId}`}
                                    className="btn small primary funnel-study-btn"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Study player →
                                  </Link>
                                </div>

                                {p.recent && p.recent.length > 0 ? (
                                  <div className="funnel-player-history">
                                    <span className="dim small">Trail before leaving:</span>
                                    <div className="funnel-history-chips">
                                      {p.recent.map((act, idx) => (
                                        <span key={idx} className="funnel-history-crumb">
                                          {idx > 0 && <span className="crumb-arrow">→</span>}
                                          <span className="crumb-bubble">{said(act)}</span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ) : p.lastWhat ? (
                                  <div className="funnel-player-history">
                                    <span className="dim small">Last action:</span>
                                    <span className="crumb-bubble">{said(p.lastWhat)}</span>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="dim small">
              {f.turnsSince ? `Turn-by-turn tracking started ${when(f.turnsSince)}; people before that show no turns.` : "Turn-by-turn tracking hasn't seen a game yet, so the turn steps will appear once people play."}
              {f.logStart && f.from < f.logStart && ` The log on hand starts ${when(f.logStart)}.`}
            </p>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>
                {selectedStep && stSelected
                  ? `Newest people who stopped at "${stSelected.label}" (${filteredNewest.length})`
                  : "Newest people and where they stopped"}
              </h3>
              {selectedStep && (
                <button type="button" className="btn small" onClick={() => setSelectedStep(null)}>
                  Show all steps ✕
                </button>
              )}
            </div>
            {filteredNewest.length === 0 ? (
              <p className="dim small" style={{ padding: "12px 0" }}>
                No newest players stopped at this step in the recent sample.
              </p>
            ) : (
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>First visit</th>
                      <th>Came from</th>
                      <th className="r">Time on site</th>
                      <th>Got as far as</th>
                      <th>Last action / Study</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNewest.map((x) => (
                      <tr key={x.person} onClick={() => go(`/players/${x.userId}`)} style={{ cursor: "pointer" }}>
                        <td>
                          <Link to={`/players/${x.userId}`} onClick={(e) => e.stopPropagation()}>
                            {x.name || "Guest"}
                          </Link>{" "}
                          <PlayerNum id={x.userId} />
                        </td>
                        <td>{when(x.first)}</td>
                        <td className="dim small">{x.source ?? "–"}</td>
                        <td className="r">{mins(x.minutes ?? ((x.last - x.first) / 60_000))}</td>
                        <td>
                          {x.step}
                          {x.turn && !x.step.startsWith("Reached turn") ? <span className="dim small"> (turn {x.turn})</span> : null}
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span className="dim small">{x.lastWhat ? said(x.lastWhat) : "–"}</span>
                            <Link
                              to={`/players/${x.userId}`}
                              className="btn small primary"
                              onClick={(e) => e.stopPropagation()}
                              style={{ whiteSpace: "nowrap" }}
                            >
                              Study →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
