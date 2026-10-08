import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AuthError, get, type AccountDetail, type AccountRow, type ActivityEvent, type GameView, type Live, type Overview, type Session } from "./api";
import { Columns, FAMILIES, Link, Stat, ago, day, detailOf, familyOf, go, labelOf, num, usePoll, when } from "./bits";

type Load<T> = { data: T | null; error: string | null; reload: () => void; loading: boolean };

/** Fetch an admin route; errors other than an expired sign-in show in the page. */
function useAdmin<T>(s: Session, path: string | null, onAuth: (e: unknown) => void): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    get<T>(path, s).then(
      (d) => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        setLoading(false);
        if (e instanceof AuthError) onAuth(e);
        else setError(String(e?.message ?? e));
      },
    );
  }, [s, path, onAuth]);
  useEffect(reload, [reload]);
  return { data, error, reload, loading };
}

export interface PageProps {
  s: Session;
  onAuth: (e: unknown) => void;
  query: URLSearchParams;
  param?: string;
}

const withParam = (q: URLSearchParams, k: string, v: string) => {
  const p = new URLSearchParams(q.toString());
  p.set(k, v);
  return p;
};

const Problem = ({ error }: { error: string | null }) => (error ? <div className="problem">{error}</div> : null);
const short = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ------------------------------------------------------------------ dashboard

export function Dashboard({ s, onAuth }: PageProps) {
  const o = useAdmin<Overview>(s, "/overview", onAuth);
  usePoll(o.reload, 15_000);
  const d = o.data;
  if (!d) return <Problem error={o.error} />;
  const sum = (k: "signups" | "games" | "guests") => d.daily.reduce((n, r) => n + r[k], 0);
  const live = d.live;
  const seated = live ? live.rooms.reduce((n, r) => n + r.seats.filter((x) => x.kind === "human" && x.connected).length, 0) : 0;
  return (
    <>
      <Problem error={o.error} />
      <section className="stats">
        <Stat label="Accounts" value={num(d.accounts.registered)} sub={`+ ${num(d.accounts.guests)} guests`} tone="gold" />
        <Stat label="Active today" value={num(d.active.day)} sub={`${num(d.active.week)} this week · ${num(d.active.month)} this month`} />
        <Stat label="Online now" value={num(live?.sockets ?? 0)} sub={`${num(seated)} at ${num(live?.rooms.length ?? 0)} tables · ${num(live?.queued ?? 0)} in queue`} tone="cash" />
        <Stat label="Games played" value={num(d.economy.gamesPlayed)} sub={`${num(sum("games"))} in the last 30 days`} />
        <Stat label="Chips held" value={num(d.economy.chips)} sub={`${num(d.economy.coins)} coins`} />
        <Stat label="Packs bought" value={num(d.economy.packsBought)} sub={`${num(d.economy.drinksSent)} drinks sent`} />
      </section>
      <section className="charts">
        <Columns title="Sign-ups per day" rows={d.daily.map((r) => ({ label: short(r.day), value: r.signups }))} total={`${num(sum("signups"))} in 30 days`} />
        <Columns title="Players active per day" rows={d.daily.map((r) => ({ label: short(r.day), value: r.active }))} total={`${num(d.active.month)} in 30 days`} />
        <Columns title="Games finished per day" rows={d.daily.map((r) => ({ label: short(r.day), value: r.games }))} total={`${num(sum("games"))} in 30 days`} />
      </section>
      <section className="split">
        <div className="card">
          <div className="card-head">
            <h3>Newest accounts</h3>
            <Link to="/players?sort=new">All players →</Link>
          </div>
          <PlayerTable rows={d.newest} compact />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Last 24 hours</h3>
            <Link to="/activity">Activity log →</Link>
          </div>
          {d.today.length === 0 ? (
            <p className="dim">Nothing yet.</p>
          ) : (
            <ul className="kinds">
              {d.today.slice(0, 14).map((k) => (
                <li key={k.kind}>
                  <Link to={`/activity?kinds=${encodeURIComponent(k.kind)}`}>
                    <span className={`fam fam-${familyOf(k.kind)}`} />
                    {labelOf(k.kind)}
                  </Link>
                  <b>{num(k.count)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {live && <LiveTables live={live} />}
    </>
  );
}

// ------------------------------------------------------------------ live

export function LivePage({ s, onAuth }: PageProps) {
  const l = useAdmin<Live>(s, "/live", onAuth);
  usePoll(l.reload, 5000);
  if (!l.data) return <Problem error={l.error} />;
  const up = l.data.uptimeS;
  return (
    <>
      <section className="stats">
        <Stat label="Connected" value={num(l.data.sockets)} tone="cash" />
        <Stat label="Tables" value={num(l.data.rooms.length)} sub={`${l.data.rooms.filter((r) => r.status === "playing").length} playing`} />
        <Stat label="Quick queue" value={num(l.data.queued)} />
        <Stat label="Server memory" value={`${num(l.data.rssMb)} MB`} sub={`up ${up > 3600 ? `${Math.floor(up / 3600)}h ` : ""}${Math.floor((up % 3600) / 60)}m`} />
      </section>
      <LiveTables live={l.data} />
    </>
  );
}

function LiveTables({ live }: { live: Live }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Tables right now</h3>
        <span className="dim">refreshes by itself</span>
      </div>
      {live.rooms.length === 0 ? (
        <p className="dim">No tables open.</p>
      ) : (
        <div className="tables">
          {live.rooms.map((r) => (
            <div key={r.id} className={`felt-card ${r.status}`}>
              <div className="felt-top">
                <b className="code">{r.code}</b>
                <span className={`pill ${r.status}`}>{r.status}</span>
              </div>
              <div className="dim small">
                {r.players} seats · {r.stakes ? `${num(r.stakes)} chips` : "free"} · {r.isPrivate ? "private" : "public"} · game {r.games}
                {r.spectators ? ` · ${r.spectators} watching` : ""}
              </div>
              <ul className="seats">
                {r.seats.map((x) => (
                  <li key={x.seat} className={x.kind}>
                    <span className={`dot ${x.kind === "human" ? (x.connected ? "on" : "off") : ""}`} />
                    {x.kind === "human" && x.userId ? <Link to={`/players/${x.userId}`}>{x.name}</Link> : <span>{x.kind === "open" ? "open seat" : x.name}</span>}
                    {x.kind === "bot" && <em>bot</em>}
                    {x.autopilot && <em>autopilot</em>}
                    {x.kind === "human" && !x.connected && <em>away</em>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ players

const SORTS: [string, string][] = [
  ["seen", "Last seen"],
  ["new", "Newest"],
  ["games", "Most games"],
  ["chips", "Most chips"],
  ["winnings", "Winnings"],
  ["level", "Level"],
  ["rating", "Skill rating"],
];

export function Players({ s, onAuth, query }: PageProps) {
  const [q, setQ] = useState(query.get("q") ?? "");
  const sort = query.get("sort") ?? "seen";
  const show = query.get("show") ?? "registered";
  const offset = Number(query.get("offset") ?? 0);
  const qs = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ q, sort, show, offset: String(offset), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    const drop: string[] = [];
    p.forEach((v, k) => (!v || (k === "offset" && v === "0")) && drop.push(k));
    for (const k of drop) p.delete(k);
    return `/players?${p}`;
  };
  const path = `/accounts?${new URLSearchParams({ q: query.get("q") ?? "", sort, show: show === "all" ? "" : show, offset: String(offset) })}`;
  const l = useAdmin<{ total: number; rows: AccountRow[] }>(s, path, onAuth);
  return (
    <div className="card">
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          go(qs({ offset: 0 }));
        }}
      >
        <input className="search" placeholder="Search name, email or id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={show} onChange={(e) => go(qs({ show: e.target.value, offset: 0 }))}>
          <option value="registered">Accounts</option>
          <option value="guests">Guests</option>
          <option value="all">Everyone</option>
        </select>
        <select value={sort} onChange={(e) => go(qs({ sort: e.target.value, offset: 0 }))}>
          {SORTS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn primary">Search</button>
        {l.data && <span className="dim count">{num(l.data.total)} found</span>}
      </form>
      <Problem error={l.error} />
      {l.data && <PlayerTable rows={l.data.rows} />}
      {l.data && l.data.total > 100 && (
        <div className="pager">
          <button className="btn" disabled={offset === 0} onClick={() => go(qs({ offset: Math.max(0, offset - 100) }))}>
            ← Newer
          </button>
          <span className="dim">
            {offset + 1}–{Math.min(l.data.total, offset + 100)} of {num(l.data.total)}
          </span>
          <button className="btn" disabled={offset + 100 >= l.data.total} onClick={() => go(qs({ offset: offset + 100 }))}>
            More →
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerTable({ rows, compact }: { rows: AccountRow[]; compact?: boolean }) {
  if (!rows.length) return <p className="dim">Nobody here yet.</p>;
  return (
    <div className="scroll-x">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Player</th>
            {!compact && <th>Sign-in</th>}
            <th className="r">Level</th>
            {!compact && <th className="r">Chips</th>}
            <th className="r">Games</th>
            {!compact && <th className="r">Win %</th>}
            {!compact && <th className="r">Rating</th>}
            <th>{compact ? "Joined" : "Last seen"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => go(`/players/${r.id}`)}>
              <td>
                <div className="who">
                  <span className="avatar">{r.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <b>{r.name}</b>
                    <div className="dim small">{r.email ?? (r.guest ? "guest" : r.id)}</div>
                  </div>
                </div>
              </td>
              {!compact && <td className="dim">{r.guest ? "guest" : r.providers.join(", ")}</td>}
              <td className="r">
                {r.prestige ? <span className="prestige">P{r.prestige}</span> : null}
                {r.level}
              </td>
              {!compact && <td className="r">{num(r.chips)}</td>}
              <td className="r">{num(r.games)}</td>
              {!compact && <td className="r">{r.games ? `${Math.round((100 * r.wins) / r.games)}%` : "–"}</td>}
              {!compact && <td className="r">{r.rating}</td>}
              <td className="dim">{compact ? ago(r.createdAt) : ago(r.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ one player

export function Player({ s, onAuth, param, query }: PageProps) {
  const l = useAdmin<AccountDetail>(s, param ? `/accounts/${param}` : null, onAuth);
  const [raw, setRaw] = useState(false);
  const d = l.data;
  if (!d) return <Problem error={l.error} />;
  const a = d.account;
  const r = d.row;
  const p = a.progress as Record<string, any>;
  const stats = p.stats ?? {};
  return (
    <>
      <div className="card player-head">
        <span className="avatar big">{r.name.slice(0, 1).toUpperCase()}</span>
        <div className="grow">
          <h2>{r.name}</h2>
          <div className="dim">
            {a.email ?? "no email"} · {a.guest ? "guest" : a.logins.map((x) => x.provider).join(", ")} · joined {day(a.createdAt)} · last seen {ago(r.lastSeen)}
          </div>
          <div className="dim small mono">{a.id}</div>
        </div>
        <button className="btn" onClick={() => setRaw((x) => !x)}>
          {raw ? "Hide raw record" : "Raw record"}
        </button>
      </div>
      {raw && <pre className="card raw">{JSON.stringify(a, null, 2)}</pre>}
      <section className="stats">
        <Stat label="Chips" value={num(r.chips)} tone="gold" />
        <Stat label="Coins" value={num(r.coins)} />
        <Stat label="Level" value={`${r.prestige ? `P${r.prestige} · ` : ""}${r.level}`} sub={`${num(p.xp)} XP`} />
        <Stat label="Games" value={num(r.games)} sub={`${num(r.wins)} won · ${r.games ? Math.round((100 * r.wins) / r.games) : 0}%`} />
        <Stat label="Winnings" value={num(r.winnings)} tone="cash" />
        <Stat label="Skill rating" value={r.rating} sub={`${num(p.ratedGames)} rated games · campaign ${p.campaign ?? 0}/12`} />
      </section>
      <section className="split">
        <div className="card">
          <div className="card-head">
            <h3>Recent games</h3>
            <Link to={`/activity?user=${a.id}&kinds=game.`}>All games →</Link>
          </div>
          <GameList s={s} onAuth={onAuth} userId={a.id} />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Everything they've done</h3>
            <span className="dim small">since the log started</span>
          </div>
          <ul className="kinds">
            {Object.entries(d.counts)
              .sort((x, y) => y[1] - x[1])
              .map(([k, n]) => (
                <li key={k}>
                  <Link to={`/activity?user=${a.id}&kinds=${encodeURIComponent(k)}`}>
                    <span className={`fam fam-${familyOf(k)}`} />
                    {labelOf(k)}
                  </Link>
                  <b>{num(n)}</b>
                </li>
              ))}
          </ul>
          <div className="owned">
            <h4>Wearing</h4>
            <div className="chips-row">
              {Object.entries(a.progress.equipped ?? {}).map(([slot, id]) => (
                <span key={slot} className="tag">
                  {slot}: {id}
                </span>
              ))}
            </div>
            <h4>Owns ({a.progress.owned?.length ?? 0})</h4>
            <div className="chips-row">
              {(a.progress.owned ?? []).map((id) => (
                <span key={id} className="tag">
                  {id}
                </span>
              ))}
            </div>
            <h4>Career</h4>
            <div className="dim small">
              {Object.entries(stats)
                .filter(([, v]) => typeof v === "number")
                .map(([k, v]) => `${k} ${num(v as number)}`)
                .join(" · ")}
            </div>
          </div>
        </div>
      </section>
      <Activity s={s} onAuth={onAuth} query={withParam(query, "user", a.id)} embedded />
    </>
  );
}

function GameList({ s, onAuth, userId }: { s: Session; onAuth: (e: unknown) => void; userId: string }) {
  const l = useAdmin<{ events: ActivityEvent[] }>(s, `/activity?user=${userId}&kinds=game.&limit=12`, onAuth);
  if (!l.data) return <Problem error={l.error} />;
  if (!l.data.events.length) return <p className="dim">No games yet.</p>;
  return (
    <ul className="games">
      {l.data.events.map((e) => {
        const d = e.data as Record<string, any>;
        const res = d.abandoned ? "abandoned" : d.quit ? "quit" : d.won ? "won" : "lost";
        return (
          <li key={`${e.at}${d.gameId}`} onClick={() => d.gameId && go(`/games/${d.gameId}`)}>
            <span className={`result ${res}`}>{res}</span>
            <span>
              {e.kind === "game.online" ? "Online" : d.stage ? `Campaign ${d.stage}` : "Vs bots"} · {d.players}p · {d.stakes ? num(d.stakes) : "free"}
            </span>
            <span className="dim">{d.payout ? `+${num(d.payout)}` : ""}</span>
            <span className="dim">{ago(e.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ activity log

const PAGE = 150;

export function Activity({ s, onAuth, query, embedded }: PageProps & { embedded?: boolean }) {
  const user = query.get("user") ?? "";
  const [text, setText] = useState(query.get("text") ?? "");
  const [fams, setFams] = useState<string[]>(() => {
    const k = query.get("kinds");
    return k && FAMILIES.some((f) => f.id === k) ? [k] : [];
  });
  const exact = query.get("kinds") && !FAMILIES.some((f) => f.id === query.get("kinds")) ? query.get("kinds")! : "";
  const [from, setFrom] = useState(query.get("from") ?? "");
  const [to, setTo] = useState(query.get("to") ?? "");
  const [live, setLive] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const params = useMemo(() => {
    const kinds = exact ? exact.split(",") : FAMILIES.filter((f) => fams.includes(f.id)).flatMap((f) => f.kinds);
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (user) p.set("user", user);
    if (kinds.length) p.set("kinds", kinds.join(","));
    if (query.get("text")) p.set("text", query.get("text")!);
    if (from) p.set("from", String(new Date(from + "T00:00").getTime()));
    if (to) p.set("to", String(new Date(to + "T23:59:59").getTime()));
    return p;
  }, [user, fams, exact, query, from, to]);

  const load = useCallback(
    (older?: number) => {
      const p = new URLSearchParams(params);
      if (older) p.set("before", String(older));
      get<{ events: ActivityEvent[] }>(`/activity?${p}`, s).then(
        (r) => {
          setError(null);
          setMore(r.events.length >= PAGE);
          setEvents((cur) => (older ? [...cur, ...r.events] : r.events));
        },
        (e) => {
          if (e instanceof AuthError) onAuth(e);
          else setError(String(e?.message ?? e));
        },
      );
    },
    [params, s, onAuth],
  );
  useEffect(() => load(), [load]);
  usePoll(() => load(), 5000, live && !params.has("to"));

  const setQuery = (o: Record<string, string>) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(o)) v ? p.set(k, v) : p.delete(k);
    go(`${embedded ? `/players/${user}` : "/activity"}?${p}`);
  };

  let lastDay = "";
  return (
    <div className="card">
      <div className="card-head">
        <h3>{embedded ? "Activity" : "Newest first"}</h3>
        <label className="toggle">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
        </label>
      </div>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ text });
        }}
      >
        <input className="search" placeholder="Search anything: a name, an item, a chat line, an IP…" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="date">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date">
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn primary">Search</button>
      </form>
      <div className="fams">
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`fam-chip ${fams.includes(f.id) ? "on" : ""}`}
            onClick={() => {
              if (exact) setQuery({ kinds: "" });
              setFams((x) => (x.includes(f.id) ? x.filter((y) => y !== f.id) : [...x, f.id]));
            }}
          >
            <span className={`fam fam-${f.id}`} />
            {f.label}
          </button>
        ))}
        {exact && (
          <button type="button" className="fam-chip on" onClick={() => setQuery({ kinds: "" })}>
            {exact.split(",").map(labelOf).join(", ")} ✕
          </button>
        )}
        {user && !embedded && (
          <button type="button" className="fam-chip on" onClick={() => setQuery({ user: "" })}>
            one player ✕
          </button>
        )}
      </div>
      <Problem error={error} />
      {events.length === 0 ? (
        <p className="dim">Nothing matches.</p>
      ) : (
        <ol className="feed">
          {events.map((e, i) => {
            const dk = new Date(e.at).toDateString();
            const head = dk !== lastDay;
            lastDay = dk;
            const d = e.data as Record<string, any> | undefined;
            return (
              <Fragment key={`${e.at}-${i}`}>
                {head && <li className="day">{day(e.at)}</li>}
                <li className={`ev ${e.ok === false ? "failed" : ""} ${open === i ? "open" : ""}`} onClick={() => setOpen(open === i ? null : i)}>
                  <time>{new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
                  <span className={`fam fam-${familyOf(e.kind)}`} title={e.kind} />
                  <span className="who">
                    {e.userId ? (
                      <Link to={`/players/${e.userId}`}>{e.name ?? e.userId}</Link>
                    ) : (
                      <span className="dim">{e.ip ?? "—"}</span>
                    )}
                  </span>
                  <span className="what">
                    <b>{labelOf(e.kind)}</b> <span className="detail">{detailOf(e)}</span>
                    {e.ok === false && <span className="err"> failed: {e.error}</span>}
                  </span>
                  {d?.gameId ? (
                    <Link to={`/games/${d.gameId}`} className="btn small ghost">
                      moves
                    </Link>
                  ) : (
                    <span />
                  )}
                  {open === i && (
                    <pre className="raw" onClick={(x) => x.stopPropagation()}>
                      {JSON.stringify(e, null, 2)}
                    </pre>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
      {more && (
        <div className="pager">
          <button className="btn" onClick={() => load(events[events.length - 1].at)}>
            Load older
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one game, move by move

export function Game({ s, onAuth, param }: PageProps) {
  const l = useAdmin<GameView>(s, param ? `/games/${param}` : null, onAuth);
  const [only, setOnly] = useState<"all" | "moves" | number>("all");
  const g = l.data;
  if (!g) return <Problem error={l.error} />;
  const moves = g.moments.filter((m) => m.t === "move").length;
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {g.mode === "online" ? `Online table ${g.code ?? ""}` : "Game vs bots"} <span className="dim small mono">{g.gameId}</span>
          </h2>
          <span className="dim">
            {when(g.startedAt)}
            {g.endedAt ? ` · ${Math.round((g.endedAt - g.startedAt) / 60000)} min` : " · still running"}
          </span>
        </div>
        <div className="seat-row">
          {g.seats.map((x, i) => (
            <button key={i} className={`seat-chip s${i} ${only === i ? "on" : ""} ${g.winners.includes(i) ? "won" : ""}`} onClick={() => setOnly(only === i ? "all" : i)}>
              <span className="dot" />
              {x.name}
              {x.bot ? <em>bot</em> : null}
              {g.winners.includes(i) && <em className="crown">winner</em>}
              {x.userId && (
                <a href={`#/players/${x.userId}`} onClick={(e) => e.stopPropagation()}>
                  profile
                </a>
              )}
            </button>
          ))}
        </div>
        <div className="dim small">
          {g.stakes ? `${num(g.stakes)} chip buy-in` : "No buy-in"} · {num(moves)} decisions{g.quit ? " · the player walked out" : ""}
          {g.broken && ` · replay stopped early (${g.broken})`}
        </div>
        <div className="fams">
          <button className={`fam-chip ${only === "all" ? "on" : ""}`} onClick={() => setOnly("all")}>
            Everything
          </button>
          <button className={`fam-chip ${only === "moves" ? "on" : ""}`} onClick={() => setOnly("moves")}>
            Decisions only
          </button>
        </div>
      </div>
      <ol className="card story">
        {g.moments.map((m, i) => {
          if (m.t === "say") return only === "all" ? <li key={i} className="say">{m.msg}</li> : null;
          if (typeof only === "number" && m.seat !== only) return null;
          return (
            <li key={i} className={`move s${m.seat}`}>
              <span className="n">#{m.n}</span>
              <b>{m.name}</b>
              <span className="ask">{m.ask}</span>
              <code>{JSON.stringify(m.answer)}</code>
              {m.by !== "player" && <em>{m.by}</em>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
