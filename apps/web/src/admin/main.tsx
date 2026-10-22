// The owner's back office at /admin: its own sign-in, then every account, the activity log, live tables
// and any game move by move, plus the moderation tools (notes, flags, suspensions, the feedback board).

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../fonts/fonts.css";
import "./admin.css";
import { AuthError, forget, get, login, saved, type Session } from "./api";
import { setNums } from "./bits";
import { Activity, Dashboard, Game, LivePage, Player, Players, type PageProps } from "./pages";
import { ServerPage } from "./server";
import { EconomyPage } from "./economy";
import { TeamPage } from "./team";
import { FunnelPage } from "./funnel";
import { BotsPage } from "./bots";
import { FeedbackPage } from "./feedback";
import { BoardPage } from "./board";
import { LoungeWatch } from "./conduct";

function useRoute() {
  const read = () => {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?");
    return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(qs ?? "") };
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => {
      setR(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return r;
}

const NAV: [string, string][] = [
  ["", "Overview"],
  ["players", "Players"],
  ["activity", "Activity"],
  ["dropoff", "Drop-off"],
  ["bots", "Bots"],
  ["live", "Live tables"],
  ["economy", "Economy"],
  ["board", "Player board"],
  ["lounge", "Lounge watch"],
  ["feedback", "Feedback"],
  ["server", "Server"],
];

function Admin() {
  const [s, setS] = useState<Session | null>(saved);
  const { parts, query } = useRoute();
  const onAuth = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      forget();
      setS(null);
    }
  }, []);
  // sign out when the session runs out
  useEffect(() => {
    if (!s) return;
    const t = window.setTimeout(() => {
      forget();
      setS(null);
    }, Math.max(0, s.expires - Date.now()));
    return () => clearTimeout(t);
  }, [s]);

  // player numbers for the #1234 next to names; new players turn up, so they're reloaded every minute
  useEffect(() => {
    if (!s) return;
    const load = () => get<{ nums: Record<string, number> }>("/nums", s).then((r) => setNums(r.nums), onAuth);
    load();
    const t = window.setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [s, onAuth]);

  if (!s) return <SignIn onIn={setS} />;
  const props: PageProps = { s, onAuth, query, param: parts[1] };
  const page = parts[0] ?? "";
  const titles: Record<string, string> = { "": "Overview", players: parts[1] ? "Player" : "Players", activity: "Activity log", dropoff: "Where new players drop off", bots: "Bot visits", live: "Live tables", server: "Server & bill", economy: "Economy", feedback: "What lost them", board: "Player board", team: "Admins", games: "Game replay", lounge: "Lounge watch" };
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/">
          HEIST <span>back office</span>
        </a>
        <nav>
          {[...NAV, ...(s.role === "owner" ? [["team", "Admins"] as [string, string]] : [])].map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={page === k ? "on" : ""}>
              {label}
            </a>
          ))}
        </nav>
        <button
          className="btn ghost small"
          onClick={() => {
            forget();
            setS(null);
          }}
        >
          Sign out{s.user ? ` ${s.user}` : ""}
        </button>
      </header>
      <main>
        <h1>{titles[page] ?? "Not found"}</h1>
        {page === "" && <Dashboard {...props} />}
        {page === "players" && (parts[1] ? <Player key={parts[1]} {...props} /> : <Players key={query.toString()} {...props} />)}
        {page === "activity" && <Activity key={query.toString()} {...props} />}
        {page === "dropoff" && <FunnelPage key={query.toString()} {...props} />}
        {page === "bots" && <BotsPage key={query.toString()} {...props} />}
        {page === "live" && <LivePage {...props} />}
        {page === "server" && <ServerPage {...props} />}
        {page === "economy" && <EconomyPage {...props} />}
        {page === "feedback" && <FeedbackPage {...props} />}
        {page === "board" && <BoardPage {...props} />}
        {page === "lounge" && <LoungeWatch {...props} />}
        {page === "team" && <TeamPage {...props} />}
        {page === "games" && <Game key={parts[1]} {...props} />}
      </main>
    </div>
  );
}

function SignIn({ onIn }: { onIn: (s: Session) => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="vault">
      <form
        className="vault-door"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onIn(await login(user, password));
          } catch (x) {
            setError(String((x as Error).message ?? x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dial" aria-hidden />
        <h1>
          HEIST <span>back office</span>
        </h1>
        <p className="dim">Owner access only. This is not your player account.</p>
        <label>
          Username
          <input autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="problem">{error}</div>}
        <button className="btn primary huge" disabled={busy || !user || !password}>
          {busy ? "Opening…" : "Open the vault"}
        </button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
);
