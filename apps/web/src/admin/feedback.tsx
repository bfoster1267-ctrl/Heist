// Answers to "What lost you?", the one-tap question a new player gets after their first game: how many
// picked each answer, split by walking out vs finishing, and every comment. Yours and Claude's are left out.

import type { Feedback } from "./api";
import { Stat, ago, go, num, usePoll } from "./bits";
import { Problem, useAdmin, type PageProps } from "./pages";

export const REASONS: { key: keyof Feedback["totals"]; label: string }[] = [
  { key: "lost", label: "Didn't know what to do" },
  { key: "roles", label: "The roles" },
  { key: "buttons", label: "Too many buttons" },
  { key: "notForMe", label: "Just not my thing" },
  { key: "liked", label: "Nothing, liked it" },
  { key: "skip", label: "Closed it without answering" },
];
const labelOf = (k: string) => REASONS.find((r) => r.key === k)?.label ?? k;

export function FeedbackPage({ s, onAuth }: PageProps) {
  const r = useAdmin<Feedback>(s, "/feedback", onAuth);
  usePoll(r.reload, 60_000);
  const f = r.data;
  if (!f) return <Problem error={r.error} />;
  const most = Math.max(1, ...REASONS.map((x) => f.totals[x.key].left + f.totals[x.key].finished));
  const left = f.rows.filter((x) => x.when === "left").length;
  const pct = (n: number) => (f.asked ? `${Math.round((n / f.asked) * 100)}%` : "–");
  return (
    <>
      <Problem error={r.error} />
      <section className="stats">
        <Stat label="Players asked" tone="gold" value={num(f.asked)} sub={`${num(left)} walked out · ${num(f.asked - left)} finished`} />
        <Stat label="Answered" value={num(f.answered)} sub={`${pct(f.answered)} of those asked`} />
        <Stat label="Comments" value={num(f.comments)} />
      </section>

      <div className="card chart">
        <div className="chart-head">
          <h3>What lost them</h3>
          <div className="chart-total">walked out / finished</div>
        </div>
        <ul className="hbars">
          {REASONS.map((x) => {
            const t = f.totals[x.key];
            return (
              <li key={x.key}>
                <span>{x.label}</span>
                <span className="hbar">
                  <i style={{ width: `${((t.left + t.finished) / most) * 100}%` }} />
                </span>
                <b>
                  {num(t.left)} / {num(t.finished)}
                </b>
              </li>
            );
          })}
        </ul>
        <p className="dim small">Asked once, when a new player leaves their first game or goes back to the lobby after finishing it. Your own and Claude's test answers are left out.</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Every answer</h3>
          <span className="dim small">newest first</span>
        </div>
        {!f.rows.length ? (
          <p className="dim">No answers yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Answer</th>
                  <th>When</th>
                  <th>Comment</th>
                  <th>Asked</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((x) => (
                  <tr key={x.id} onClick={() => go(`/players/${x.id}`)}>
                    <td>
                      <b>{x.name}</b>
                      <div className="dim small">{x.guest ? "guest" : "signed up"}</div>
                    </td>
                    <td>{labelOf(x.reason)}</td>
                    <td className="dim">
                      {x.when === "left" ? `walked out${x.round !== null ? ` on turn ${x.round + 1}` : ""}` : "finished"}
                      {x.coached ? " · coached" : ""}
                    </td>
                    <td style={{ whiteSpace: "normal", minWidth: 200 }}>{x.comment ?? <span className="dim">–</span>}</td>
                    <td className="dim">{ago(x.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
