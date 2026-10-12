// Visits that were robots (link previews, search engines, crawlers), kept apart from the players: each with
// why it was called a bot and where it came from, so the owner can check the call.

import type { Bots } from "./api";
import { Link, Stat, go, num, usePoll, when } from "./bits";
import { Problem, useAdmin, type PageProps } from "./pages";

const DAY = 24 * 60 * 60_000;
const RANGES: [string, string, number | null][] = [
  ["1d", "Last 24 hours", DAY],
  ["7d", "Last 7 days", 7 * DAY],
  ["all", "Everything", null],
];

export function BotsPage({ s, onAuth, query }: PageProps) {
  const range = query.get("range") ?? "7d";
  const preset = RANGES.find((r) => r[0] === range) ?? RANGES[1];
  const p = new URLSearchParams();
  if (preset[2] !== null) p.set("from", String(Math.floor((Date.now() - preset[2]) / 60_000) * 60_000));
  const r = useAdmin<Bots>(s, `/bots?${p}`, onAuth);
  usePoll(r.reload, 60_000);
  const b = r.data;
  return (
    <>
      <div className="card">
        <div className="filters">
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" className={`fam-chip ${range === k ? "on" : ""}`} onClick={() => go(`/bots?range=${k}`)}>
              {label}
            </button>
          ))}
        </div>
        <p className="dim small">
          These visits are left out of the Overview, Activity, Players and Drop-off. A visit counts as a bot when its browser says it's a robot, its address belongs to a
          search engine or a cloud server, or it never tapped anything at all (a first visit starts the lesson on its own, so a link preview looks like someone
          sitting down for one turn). Anyone who tapped, played or signed up is never counted as a bot.
        </p>
      </div>
      <Problem error={r.error} />
      {b && (
        <>
          <section className="stats">
            <Stat label="Bot visits" tone="gold" value={num(b.total)} sub={preset[1].toLowerCase()} />
            <Stat label="Robot browsers or addresses" value={num(b.kinds.crawler)} sub="said so themselves" />
            <Stat label="Never tapped anything" value={num(b.kinds.untouched)} sub="opened and sat still" />
          </section>
          {b.sources.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>Where they came from</h3>
              </div>
              <table className="grid-table">
                <tbody>
                  {b.sources.map((x) => (
                    <tr key={x.source}>
                      <td>{x.source}</td>
                      <td className="r">
                        <b>{num(x.count)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h3>Newest bot visits</h3>
              {b.total > b.rows.length && <span className="dim small">the newest {num(b.rows.length)} of {num(b.total)}</span>}
            </div>
            {!b.rows.length ? (
              <p className="dim">No bot visits in this range.</p>
            ) : (
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Why it's a bot</th>
                      <th>From</th>
                      <th>Address</th>
                      <th>Browser</th>
                      <th>Did</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((x) => (
                      <tr key={x.person}>
                        <td>
                          <Link to={`/players/${x.id}`}>{when(x.firstSeen)}</Link>
                          {x.accounts > 1 && <div className="dim small">{num(x.accounts)} visits</div>}
                        </td>
                        <td>{x.reason}</td>
                        <td>{x.source ?? <span className="dim">unknown</span>}</td>
                        <td>
                          {x.ips.map((ip) => (
                            <div key={ip.ip}>
                              {ip.ip}
                              {ip.host && <div className="dim small">{ip.host}</div>}
                            </div>
                          ))}
                        </td>
                        <td className="bot-ua dim">{x.ua ?? "not recorded (before this page existed)"}</td>
                        <td>
                          {num(x.events)} events
                          <div className="dim small">last: {x.last}</div>
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
