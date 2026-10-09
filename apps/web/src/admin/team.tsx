import { useState } from "react";
import { AuthError, post, type TeamMember } from "./api";
import { ago, day } from "./bits";
import { Problem, useAdmin, type PageProps } from "./pages";

/** The owner adds and removes the other people who can open the back office. */
export function TeamPage({ s, onAuth }: PageProps) {
  const r = useAdmin<{ members: TeamMember[] }>(s, "/team", onAuth);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const list = members ?? r.data?.members;
  const run = async (path: string, body: object, ok: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setMembers((await post<{ members: TeamMember[] }>(path, body, s)).members);
      setDone(ok);
      return true;
    } catch (e) {
      if (e instanceof AuthError) onAuth(e);
      else setError(String((e as Error).message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!list) return <Problem error={r.error} />;
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>Admins</h3>
          <span className="dim small">people who can sign in here besides you</span>
        </div>
        <table className="grid-table team">
          <thead>
            <tr>
              <th>Username</th>
              <th>Added</th>
              <th>Last signed in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <b>{s.user ?? "you"}</b> <span className="badge you">owner</span>
              </td>
              <td className="dim">set in Render (ADMIN_USER)</td>
              <td className="dim">now</td>
              <td />
            </tr>
            {list.map((m) => (
              <tr key={m.user}>
                <td>
                  <b>{m.user}</b>
                </td>
                <td className="dim">{day(m.createdAt)}</td>
                <td className="dim">{m.lastLogin ? ago(m.lastLogin) : "never"}</td>
                <td className="r">
                  <button className="btn ghost small" disabled={busy} onClick={() => confirm(`Remove ${m.user}? They're signed out right away.`) && run("/team/remove", { user: m.user }, `${m.user} removed.`)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="card team-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("/team", { user, password }, `${user.trim().toLowerCase()} can sign in now.`)) {
            setUser("");
            setPassword("");
          }
        }}
      >
        <div className="card-head">
          <h3>Add an admin, or reset one's password</h3>
        </div>
        <p className="dim small">They see everything you see and can add notes, tags, flags and suspensions. Only you can manage admins. Send them the password yourself.</p>
        <div className="seg-row">
          <input placeholder="Username" autoComplete="off" value={user} maxLength={32} onChange={(e) => setUser(e.target.value)} />
          <input placeholder="Password (12+ characters)" type="password" autoComplete="new-password" value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn primary" disabled={busy || !user.trim() || password.length < 12}>
            Save admin
          </button>
        </div>
        {error && <div className="problem">{error}</div>}
        {done && <div className="dim">{done}</div>}
      </form>
    </>
  );
}
