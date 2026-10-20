// How players behave in the Lounge: a watch list of everyone with something on their record (worst first),
// and each player's own record in their file: what they said lately, lines the filter refused or starred,
// reports against them, lines the room took down, and how many players muted them.
import { useCallback, useEffect, useState } from "react";
import { AuthError, get, type Session } from "./api";
import { ago, go, num, usePoll, when, PlayerNum } from "./bits";
import type { PageProps } from "./pages";

interface Conduct {
  name: string;
  said: number;
  lines: { id: number; at: number; text: string; gone?: boolean }[];
  refused: { at: number; text: string; why: string }[];
  starred: number;
  reports: { at: number; by: string; msgId: number; text: string }[];
  takenDown: number;
  mutedBy: string[];
  score: number;
}
interface Row {
  userId: string;
  name: string;
  said: number;
  refused: number;
  starred: number;
  reports: number;
  takenDown: number;
  muted: number;
  score: number;
  last: number;
}

const HOW = "Score: refused line ×3, line taken down by reports ×5, report ×1, muted by a player ×2, starred swear ×1.";

function useGet<T>(s: Session, path: string, onAuth: (e: unknown) => void, on = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await get<T>(path, s));
      setError(null);
    } catch (e) {
      if (e instanceof AuthError) onAuth(e);
      else setError(String((e as Error).message ?? e));
    }
  }, [s, path, onAuth]);
  useEffect(() => {
    if (on) void load();
  }, [load, on]);
  return { data, error, load };
}

export function LoungeWatch({ s, onAuth }: PageProps) {
  const r = useGet<{ players: Row[] }>(s, "/lounge", onAuth);
  usePoll(() => void r.load(), 60_000);
  if (!r.data) return r.error ? <div className="problem">{r.error}</div> : null;
  return (
    <>
      {r.error && <div className="problem">{r.error}</div>}
      <section className="card">
        <h4>Lounge watch</h4>
        {!r.data.players.length ? (
          <p className="dim">Nobody has anything on their record yet.</p>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Score</th>
                <th>Refused</th>
                <th>Taken down</th>
                <th>Reports</th>
                <th>Muted by</th>
                <th>Swears</th>
                <th>Lines</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {r.data.players.map((p) => (
                <tr key={p.userId} onClick={() => go(`/players/${p.userId}`)} style={{ cursor: "pointer" }}>
                  <td>
                    {p.name} <PlayerNum id={p.userId} />
                  </td>
                  <td>
                    <b>{num(p.score)}</b>
                  </td>
                  <td>{num(p.refused)}</td>
                  <td>{num(p.takenDown)}</td>
                  <td>{num(p.reports)}</td>
                  <td>{num(p.muted)}</td>
                  <td>{num(p.starred)}</td>
                  <td>{num(p.said)}</td>
                  <td className="dim">{ago(p.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="dim small">{HOW} Tap a player for their lines; suspend from their file.</p>
      </section>
    </>
  );
}

/** In a player's file: their Lounge record. */
export function ConductPanel({ s, onAuth, id }: { s: Session; onAuth: (e: unknown) => void; id: string }) {
  const r = useGet<{ conduct: Conduct | null }>(s, `/accounts/${id}/lounge`, onAuth);
  const [all, setAll] = useState(false);
  const c = r.data?.conduct;
  if (!r.data) return r.error ? <div className="problem">{r.error}</div> : null;
  if (!c) return null;
  const lines = all ? c.lines : c.lines.slice(-15);
  return (
    <section className="card">
      <h4>
        Lounge record · score {num(c.score)}
      </h4>
      <div className="dim small" style={{ marginBottom: 8 }}>
        {num(c.said)} lines · {num(c.refused.length)} refused · {num(c.takenDown)} taken down · {num(c.reports.length)} reports · muted by {num(c.mutedBy.length)} · {num(c.starred)} with swears starred
      </div>
      {c.refused.length > 0 && (
        <>
          <div className="small">
            <b>Refused by the filter</b>
          </div>
          <div className="admin-chat-lines">
            {c.refused.slice(-20).map((x) => (
              <div key={x.at}>
                <span className="dim small">{when(x.at)}</span> {x.text} <span className="dim small">({x.why})</span>
              </div>
            ))}
          </div>
        </>
      )}
      {c.reports.length > 0 && (
        <>
          <div className="small">
            <b>Reported lines</b>
          </div>
          <div className="admin-chat-lines">
            {c.reports.slice(-20).map((x) => (
              <div key={x.at + x.by}>
                <span className="dim small">{when(x.at)}</span> {x.text} <span className="dim small">(by <a onClick={() => go(`/players/${x.by}`)}>a player</a>)</span>
              </div>
            ))}
          </div>
        </>
      )}
      {c.lines.length > 0 && (
        <>
          <div className="small">
            <b>Lines in the Lounge</b> {c.lines.length > 15 && <a onClick={() => setAll((x) => !x)}>{all ? "show fewer" : `show all ${c.lines.length}`}</a>}
          </div>
          <div className="admin-chat-lines">
            {lines.map((x) => (
              <div key={x.id} style={{ opacity: x.gone ? 0.55 : 1 }}>
                <span className="dim small">{when(x.at)}</span> {x.text}
                {x.gone && <span className="dim small"> (taken down)</span>}
              </div>
            ))}
          </div>
        </>
      )}
      <p className="dim small">{HOW}</p>
    </section>
  );
}
