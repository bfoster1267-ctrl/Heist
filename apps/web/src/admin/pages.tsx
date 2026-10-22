import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AuthError, get, post, type AccountDetail, type AccountRow, type ActivityEvent, type Economy, type GameView, type Live, type Overview, type ServerReport, type Session } from "./api";
import { CrmPanel } from "./crm";
import { ChatsPanel } from "./chats";
import { ConductPanel } from "./conduct";
import { ARCADE, Columns, FAMILIES, GAME_KINDS, HEIST_GAMES, Link, Stat, ago, day, detailOf, familyOf, go, labelOf, num, usePoll, when, PlayerNum } from "./bits";

type Load<T> = { data: T | null; error: string | null; reload: () => void; loading: boolean };

/** Fetch an admin route; errors other than an expired sign-in show in the page. */
export function useAdmin<T>(s: Session, path: string | null, onAuth: (e: unknown) => void): Load<T> {
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

export const Problem = ({ error }: { error: string | null }) => (error ? <div className="problem">{error}</div> : null);
const short = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ------------------------------------------------------------------ dashboard

type Ctx = { d: Overview; eco: Economy | null; srv: ServerReport | null };
type Widget = { id: string; label: string; group: "stat" | "chart" | "card"; needs?: "eco" | "srv"; render: (c: Ctx) => React.ReactNode };

const sumDaily = (d: Overview, k: "signups" | "games" | "people") => d.daily.reduce((n, r) => n + r[k], 0);
const ecoTotal = (e: Economy, k: "day" | "week" | "month", sign: 1 | -1) => Object.values(e.flows).reduce((n, f) => n + (Math.sign(f[k]) === sign ? f[k] : 0), 0);

/** Everything the Overview can show. Each admin picks which, and in what order. */
const WIDGETS: Widget[] = [
  {
    id: "people", label: "Players (unique people)", group: "stat",
    render: ({ d }) => {
      const ac = d.accounts;
      return (
        <Stat
          label="Players (unique people)"
          value={num(ac.people)}
          sub={
            <>
              {num(ac.signedUp)} signed up · <Link to="/players?show=all">{num(ac.total)} accounts in all</Link>
              {ac.yours > 0 && <> · {num(ac.yours)} of yours left out</>}
              {!!ac.claude && <> · {num(ac.claude)} from Claude's testing left out</>}
              {!!ac.bots && <> · <Link to="/bots">{num(ac.bots)} bot visits left out</Link></>}
              {ac.untrackedGuests > 0 && <> · {num(ac.untrackedGuests)} older guests can't be told apart</>}
              {!!ac.untouched && <> · {num(ac.untouched)} guests who never played left out (removed after {ac.untouchedRemovedAfter ?? 30} days away)</>}
            </>
          }
          tone="gold"
        />
      );
    },
  },
  { id: "active", label: "People active today", group: "stat", render: ({ d }) => <Stat label="People active today" value={num(d.active.day)} sub={`${num(d.active.week)} this week · ${num(d.active.month)} this month`} /> },
  {
    id: "online", label: "Online now", group: "stat",
    render: ({ d }) => {
      const live = d.live;
      const seated = live ? live.rooms.reduce((n, r) => n + r.seats.filter((x) => x.kind === "human" && x.connected).length, 0) + (live.ers ?? []).reduce((n, r) => n + r.seats.filter((x) => x.connected).length, 0) : 0;
      const tables = (live?.rooms.length ?? 0) + (live?.ers?.length ?? 0);
      return <Stat label="Online now" value={num(live?.sockets ?? 0)} sub={`${num(seated)} at ${num(tables)} tables · ${num(live?.queued ?? 0)} in queue`} tone="cash" />;
    },
  },
  {
    id: "acquisition",
    label: "Visitors & ad landings today",
    group: "stat",
    render: ({ d }) => {
      const acq = d.acquisitionToday;
      if (!acq) return null;
      return (
        <Stat
          label="Today's visitors & ads"
          value={num(acq.visitors)}
          sub={
            <>
              {acq.played !== undefined ? (
                <>
                  {num(acq.played)} played a game · <Link to="/players?game=none">{num(Math.max(0, acq.visitors - acq.played))} landed without playing</Link>
                </>
              ) : (
                <>{num(acq.active)} active today</>
              )}
              {acq.adLandings > 0 && <> · <Link to="/dropoff?range=1d&source=ads">{num(acq.adLandings)} from ads</Link></>}
            </>
          }
          tone="cash"
        />
      );
    },
  },
  {
    id: "crazygames",
    label: "CrazyGames players",
    group: "stat",
    render: ({ d }) => {
      const cg = d.crazyGames;
      if (!cg) return null;
      return (
        <Stat
          label="From CrazyGames"
          value={<Link to="/players?source=cg">{num(cg.players)}</Link>}
          sub={`${num(cg.newToday)} new today · ${num(cg.activeToday)} active today · ${num(cg.activeWeek)} this week`}
        />
      );
    },
  },
  { id: "games", label: "Games played", group: "stat", render: ({ d }) => <Stat label="Games, all time" value={num(d.economy.gamesPlayed)} sub={`${num(d.economy.heistGames)} Heist games · ${num(d.economy.arcadeGames)} side-game wins · ${num(sumDaily(d, "games"))} finished in 30 days`} /> },
  { id: "chips", label: "Chips held", group: "stat", render: ({ d }) => <Stat label="Chips held" value={num(d.economy.chips)} sub={`${num(d.economy.coins)} coins`} /> },
  { id: "packs", label: "Packs bought", group: "stat", render: ({ d }) => <Stat label="Packs bought" value={num(d.economy.packsBought)} sub={`${num(d.economy.drinksSent)} drinks sent`} /> },
  { id: "signups", label: "Sign-ups (30 days)", group: "stat", render: ({ d }) => <Stat label="Sign-ups, 30 days" value={num(sumDaily(d, "signups"))} sub={`${d.accounts.people ? Math.round((d.accounts.signedUp / d.accounts.people) * 100) : 0}% of people have signed up`} /> },
  { id: "eco.added", label: "Chips added today", group: "stat", needs: "eco", render: ({ eco }) => eco && <Stat label="Chips added today" tone="cash" value={num(ecoTotal(eco, "day", 1))} sub={`${num(ecoTotal(eco, "week", 1))} this week · daily, refills, bots`} /> },
  { id: "eco.removed", label: "Chips taken out today", group: "stat", needs: "eco", render: ({ eco }) => eco && <Stat label="Chips taken out today" value={num(-ecoTotal(eco, "day", -1))} sub={`${num(-ecoTotal(eco, "week", -1))} this week · bots, packs`} /> },
  {
    id: "eco.up", label: "Players up on their start", group: "stat", needs: "eco",
    render: ({ eco }) => eco && <Stat label="Players up on their start" value={eco.players.played ? `${Math.round((eco.players.up / eco.players.played) * 100)}%` : "–"} sub={`${num(eco.players.up)} of ${num(eco.players.played)} who've played`} />,
  },
  { id: "eco.circ", label: "Chips in circulation", group: "stat", needs: "eco", render: ({ eco }) => eco && <Stat label="Chips in circulation" tone="gold" value={num(eco.circulation.chips)} sub={<Link to="/economy">See the economy →</Link>} /> },
  { id: "srv.memory", label: "Server memory", group: "stat", needs: "srv", render: ({ srv }) => srv && <Stat label="Server memory" value={`${num(srv.self.rssMb)} MB`} sub={<Link to="/server">up {Math.floor(srv.self.uptimeS / 3600)}h · server page →</Link>} /> },
  { id: "srv.bill", label: "Hosting bill", group: "stat", needs: "srv", render: ({ srv }) => srv && <Stat label="Hosting this month" value={`$${(srv.cost.soFar ?? 0).toFixed(2)}`} sub={`of $${(srv.cost.monthly ?? 0).toFixed(2)} a month`} /> },
  { id: "c.people", label: "Chart: new people per day", group: "chart", render: ({ d }) => <Columns title="New people per day" rows={d.daily.map((r) => ({ label: short(r.day), value: r.people }))} total={`${num(sumDaily(d, "people"))} in 30 days · ${num(sumDaily(d, "signups"))} signed up`} /> },
  { id: "c.active", label: "Chart: people active per day", group: "chart", render: ({ d }) => <Columns title="People active per day" rows={d.daily.map((r) => ({ label: short(r.day), value: r.active }))} total={`${num(d.active.month)} in 30 days`} /> },
  { id: "c.games", label: "Chart: games per day", group: "chart", render: ({ d }) => <Columns title="Games finished per day (all games)" rows={d.daily.map((r) => ({ label: short(r.day), value: r.games }))} total={`${num(sumDaily(d, "games"))} in 30 days`} /> },
  { id: "c.signups", label: "Chart: sign-ups per day", group: "chart", render: ({ d }) => <Columns title="Sign-ups per day" rows={d.daily.map((r) => ({ label: short(r.day), value: r.signups }))} total={`${num(sumDaily(d, "signups"))} in 30 days`} /> },
  { id: "c.added", label: "Chart: chips added per day", group: "chart", needs: "eco", render: ({ eco }) => eco && <Columns title="Chips added per day" rows={eco.daily.map((r) => ({ label: short(r.day), value: r.added }))} total={`${num(ecoTotal(eco, "month", 1))} in 30 days`} /> },
  { id: "c.removed", label: "Chart: chips taken out per day", group: "chart", needs: "eco", render: ({ eco }) => eco && <Columns title="Chips taken out per day" rows={eco.daily.map((r) => ({ label: short(r.day), value: r.removed }))} total={`${num(-ecoTotal(eco, "month", -1))} in 30 days`} /> },
  {
    id: "newest", label: "Newest accounts", group: "card",
    render: ({ d }) => (
      <div className="card">
        <div className="card-head">
          <h3>Newest accounts</h3>
          <Link to="/players?sort=new">All players →</Link>
        </div>
        <PlayerTable rows={d.newest} compact />
      </div>
    ),
  },
  {
    id: "games_by_type",
    label: "Games by type",
    group: "card",
    render: ({ d }) => {
      const gAll = d.gamesByType ?? {};
      const gToday = d.gamesTodayByType ?? {};
      // all time is wins (side games only keep wins); the last 24 hours is games finished
      const rows: { id: string; label: string; link: string; all: number; today: number; title?: string }[] = [
        ...ARCADE.map((g) => ({ id: g.id, label: g.label, link: g.id, all: gAll[g.id] ?? 0, today: gToday[g.id] ?? 0 })),
        {
          id: "heist", label: "Heist (vs bots & online)", link: "any", all: gAll.heist ?? 0, today: (gToday.heist_solo ?? 0) + (gToday.heist_online ?? 0),
          title: `last 24 hours: ${num(gToday.heist_solo ?? 0)} vs bots · ${num(gToday.heist_online ?? 0)} online`,
        },
      ];
      return (
        <div className="card">
          <div className="card-head">
            <h3>Games by type</h3>
            <span className="dim small">wins all time · (+ finished, last 24 h)</span>
            <Link to="/players?game=arcade">All arcade players →</Link>
          </div>
          <ul className="kinds">
            {rows.map((r) => (
              <li key={r.id} title={r.title}>
                <Link to={`/players?game=${r.link}`}>
                  <span className="fam fam-games" />
                  {r.label}
                </Link>
                <span>
                  <b>{num(r.all)}</b>
                  {r.today > 0 && <span className="dim small" style={{ marginLeft: 6 }}>(+{num(r.today)})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    },
  },
  {
    id: "today", label: "Last 24 hours", group: "card",
    render: ({ d }) => (
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
    ),
  },
  {
    id: "top", label: "Biggest stacks", group: "card", needs: "eco",
    render: ({ eco }) =>
      eco && (
        <div className="card">
          <div className="card-head">
            <h3>Biggest stacks</h3>
            <Link to="/economy">Economy →</Link>
          </div>
          <PlayerTable rows={eco.top.slice(0, 6)} />
        </div>
      ),
  },
  { id: "tables", label: "Tables right now", group: "card", render: ({ d }) => d.live && <LiveTables live={d.live} /> },
];

const DEFAULT_LAYOUT = ["people", "active", "online", "acquisition", "crazygames", "eco.added", "eco.up", "chips", "c.people", "c.active", "c.games", "games_by_type", "newest", "today", "tables"];

export function Dashboard({ s, onAuth }: PageProps) {
  const o = useAdmin<Overview>(s, "/overview", onAuth);
  const me = useAdmin<{ layout: string[] | null }>(s, "/me", onAuth);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const layout = (draft ?? saved ?? me.data?.layout ?? DEFAULT_LAYOUT).filter((id) => WIDGETS.some((w) => w.id === id));
  const shown = layout.map((id) => WIDGETS.find((w) => w.id === id)!);
  const eco = useAdmin<Economy>(s, shown.some((w) => w.needs === "eco") ? "/economy" : null, onAuth);
  const srv = useAdmin<ServerReport>(s, shown.some((w) => w.needs === "srv") ? "/server" : null, onAuth);
  usePoll(() => (o.reload(), eco.reload(), srv.reload()), 15_000);
  const d = o.data;
  if (!d) return <Problem error={o.error} />;
  const ctx: Ctx = { d, eco: eco.data, srv: srv.data };
  const group = (g: Widget["group"]) => shown.filter((w) => w.group === g);
  const save = async (next: string[] | null) => {
    try {
      await post("/layout", { layout: next }, s);
      setSaved(next ?? DEFAULT_LAYOUT);
      setDraft(null);
    } catch (e) {
      onAuth(e);
    }
  };
  const cards = group("card");
  return (
    <>
      <Problem error={o.error} />
      <div className="dash-tools">
        {draft ? (
          <>
            <button className="btn primary small" onClick={() => save(draft)}>
              Save layout
            </button>
            <button className="btn ghost small" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn ghost small" onClick={() => save(null)}>
              Reset to default
            </button>
          </>
        ) : (
          <button className="btn ghost small" onClick={() => setDraft(layout)}>
            Customize
          </button>
        )}
      </div>
      {draft && <Customizer draft={draft} setDraft={setDraft} />}
      {group("stat").length > 0 && <section className="stats">{group("stat").map((w) => <Fragment key={w.id}>{w.render(ctx)}</Fragment>)}</section>}
      {group("chart").length > 0 && <section className="charts">{group("chart").map((w) => <Fragment key={w.id}>{w.render(ctx)}</Fragment>)}</section>}
      {cards.length > 0 && (
        <section className="split">
          {cards.map((w) => (
            <Fragment key={w.id}>{w.render(ctx)}</Fragment>
          ))}
        </section>
      )}
    </>
  );
}

/** Pick widgets and their order. Tiles, charts and cards each keep their own row. */
function Customizer({ draft, setDraft }: { draft: string[]; setDraft: (d: string[]) => void }) {
  const move = (id: string, by: number) => {
    const i = draft.indexOf(id);
    const g = WIDGETS.find((w) => w.id === id)!.group;
    // swap with the nearest shown widget of the same kind
    let j = i + by;
    while (j >= 0 && j < draft.length && WIDGETS.find((w) => w.id === draft[j])?.group !== g) j += by;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  const groups: [Widget["group"], string][] = [
    ["stat", "Number tiles"],
    ["chart", "Charts"],
    ["card", "Lists"],
  ];
  return (
    <div className="card customizer">
      <div className="card-head">
        <h3>Your Overview</h3>
        <span className="dim small">tick what you want to see; arrows change the order</span>
      </div>
      <div className="cust-groups">
        {groups.map(([g, title]) => (
          <div key={g}>
            <h4>{title}</h4>
            <ul>
              {[...draft.filter((id) => WIDGETS.find((w) => w.id === id)?.group === g), ...WIDGETS.filter((w) => w.group === g && !draft.includes(w.id)).map((w) => w.id)].map((id) => {
                const w = WIDGETS.find((x) => x.id === id)!;
                const on = draft.includes(id);
                return (
                  <li key={id} className={on ? "on" : ""}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => setDraft(on ? draft.filter((x) => x !== id) : [...draft, id])} />
                      {w.label}
                    </label>
                    {on && (
                      <span className="arrows">
                        <button className="btn ghost small" aria-label={`Move ${w.label} up`} onClick={() => move(id, -1)}>
                          ↑
                        </button>
                        <button className="btn ghost small" aria-label={`Move ${w.label} down`} onClick={() => move(id, 1)}>
                          ↓
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
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
        <Stat label="ERS 1v1 rooms" value={num(l.data.ers?.length ?? 0)} sub={`${(l.data.ers ?? []).filter((r) => r.status === "playing").length} playing`} />
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
      {live.rooms.length === 0 && !live.ers?.length ? (
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
                    {x.kind === "human" && x.userId ? <><Link to={`/players/${x.userId}`}>{x.name}</Link> <PlayerNum id={x.userId} /></> : <span>{x.kind === "open" ? "open seat" : x.name}</span>}
                    {x.kind === "bot" && <em>bot</em>}
                    {x.autopilot && <em>autopilot</em>}
                    {x.kind === "human" && !x.connected && <em>away</em>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {(live.ers ?? []).map((r) => (
            <div key={`ers-${r.code}`} className={`felt-card ${r.status}`}>
              <div className="felt-top">
                <b className="code">{r.code}</b>
                <span className={`pill ${r.status}`}>{r.status}</span>
              </div>
              <div className="dim small">Egyptian Rat Screw 1v1 · {r.isPrivate ? "private" : "public"}</div>
              <ul className="seats">
                {r.seats.map((x, i) => (
                  <li key={i} className="human">
                    <span className={`dot ${x.connected ? "on" : "off"}`} />
                    {x.userId ? <><Link to={`/players/${x.userId}`}>{x.name}</Link> <PlayerNum id={x.userId} /></> : <span>{x.name}</span>}
                    {!x.connected && <em>away</em>}
                  </li>
                ))}
                {r.seats.length < 2 && <li className="open"><span className="dot" /><span>open seat</span></li>}
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
  const show = query.get("show") ?? "people";
  const game = query.get("game") ?? "all";
  // where they came from: "" everywhere, "cg" CrazyGames, "web" everywhere else
  const source = query.get("source") ?? "";
  const mine = query.get("mine") === "1";
  const offset = Number(query.get("offset") ?? 0);
  const tag = query.get("tag") ?? "";
  const qs = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({
      q,
      sort,
      show,
      game: game === "all" ? "" : game,
      source,
      tag,
      mine: mine ? "1" : "",
      offset: String(offset),
      ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])),
    });
    const drop: string[] = [];
    p.forEach((v, k) => (!v || (k === "offset" && v === "0") || (k === "game" && v === "all")) && drop.push(k));
    for (const k of drop) p.delete(k);
    return `/players?${p}`;
  };
  const path = `/accounts?${new URLSearchParams({
    q: query.get("q") ?? "",
    sort,
    show: show === "all" ? "" : show,
    game: game === "all" ? "" : game,
    source,
    offset: String(offset),
    tag,
    mine: mine ? "1" : "",
  })}`;
  const l = useAdmin<{ total: number; rows: AccountRow[] }>(s, path, onAuth);

  const exportOptIns = () => {
    const optIns = (l.data?.rows ?? []).filter((r) => r.marketingConsent && r.email);
    if (!optIns.length) {
      alert("No opted-in emails in the currently loaded accounts.");
      return;
    }
    const csv = "Name,Email,Joined\n" + optIns.map((r) => `"${r.name.replace(/"/g, '""')}","${r.email}","${new Date(r.createdAt).toISOString()}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `heist-optin-emails-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card">
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          go(qs({ offset: 0 }));
        }}
      >
        <input className="search" placeholder="Search name, #number, email or id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={show} onChange={(e) => go(qs({ show: e.target.value, offset: 0 }))}>
          <option value="people">One row per person</option>
          <option value="registered">Signed-up accounts</option>
          <option value="guests">Guest accounts</option>
          <option value="all">Every account</option>
          <option value="flagged">Flagged</option>
          <option value="banned">Suspended</option>
          <option value="bots">Bot visits</option>
        </select>
        <select value={game} onChange={(e) => go(qs({ game: e.target.value, offset: 0 }))}>
          <option value="all">All game types</option>
          <option value="any">Played any game</option>
          <option value="none">No games played / landings</option>
          <option value="arcade">All arcade card games</option>
          {[...ARCADE, ...HEIST_GAMES].map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => go(qs({ source: e.target.value, offset: 0 }))}>
          <option value="">Every source</option>
          <option value="cg">From CrazyGames</option>
          <option value="web">playheist.net and the rest</option>
        </select>
        <select value={sort} onChange={(e) => go(qs({ sort: e.target.value, offset: 0 }))}>
          {SORTS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn primary">Search</button>
        <label className="toggle">
          <input type="checkbox" checked={mine} onChange={(e) => go(qs({ mine: e.target.checked ? "1" : "", offset: 0 }))} /> Include mine, Claude's and bots
        </label>
        {game && game !== "all" && (
          <button type="button" className="fam-chip on" onClick={() => go(qs({ game: "", offset: 0 }))}>
            game: {game} ✕
          </button>
        )}
        {tag && (
          <button type="button" className="fam-chip on" onClick={() => go(qs({ tag: "", offset: 0 }))}>
            tag: {tag} ✕
          </button>
        )}
        {source && (
          <button type="button" className="fam-chip on" onClick={() => go(qs({ source: "", offset: 0 }))}>
            source: {source === "cg" ? "CrazyGames" : "playheist.net"} ✕
          </button>
        )}
        {l.data && <span className="dim count">{num(l.data.total)} found</span>}
        {l.data && (
          <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={exportOptIns} title="Download CSV of players who consented to email updates">
            ✉️ Export Opt-in CSV
          </button>
        )}
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

const GAME_LABELS: Record<string, string> = Object.fromEntries([...ARCADE, ...HEIST_GAMES].map((g) => [g.id, g.badge]));

function Badges({ r }: { r: AccountRow }) {
  return (
    <>
      {r.you && <span className="badge you">you</span>}
      {r.claude && <span className="badge claude">Claude</span>}
      {r.bot && <span className="badge bot" title={r.bot}>bot</span>}
      {r.source === "cg" && (
        <span className="badge cg" title="Came through CrazyGames">
          CrazyGames
        </span>
      )}
      {r.marketingConsent && (
        <span className="badge" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.3)" }} title="Consented to email updates">
          ✉️ opt-in
        </span>
      )}
      {r.personAccounts > 1 && <span className="badge note">+{r.personAccounts - 1} {r.personAccounts === 2 ? "account" : "accounts"}</span>}
      {r.banned && <span className="badge banned">suspended</span>}
      {r.flagged && <span className="badge flagged">⚑ flagged</span>}
      {r.tags.slice(0, 3).map((t) => (
        <span key={t} className="badge">
          {t}
        </span>
      ))}
      {r.notes > 0 && <span className="badge note">✎ {r.notes}</span>}
      {r.gamesPlayed?.slice(0, 3).map((g) => (
        <span key={g} className="badge note" title={`Played ${g}`}>
          {GAME_LABELS[g] ?? g}
        </span>
      ))}
      {(r.gamesPlayed?.length ?? 0) > 3 && (
        <span className="badge note" title={r.gamesPlayed?.slice(3).join(", ")}>
          +{(r.gamesPlayed?.length ?? 0) - 3}
        </span>
      )}
    </>
  );
}

export function PlayerTable({ rows, compact }: { rows: AccountRow[]; compact?: boolean }) {
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
            {!compact && <th className="r" title="Heist games only: side games only keep wins">Heist win %</th>}
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
                    <b>{r.name}</b> <PlayerNum id={r.id} /> <Badges r={r} />
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
              <td className="r" title={r.arcadeGames ? `${num(r.games)} Heist · ${num(r.arcadeGames)} Arcade wins` : undefined}>
                {num(r.totalGames ?? r.games)}
              </td>
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
          <h2>
            {r.name} <PlayerNum id={r.id} /> <Badges r={r} />
          </h2>
          <div className="dim">
            {a.email ?? "no email"} {r.marketingConsent ? "· ✉️ marketing opt-in" : ""} · {a.guest ? "guest" : a.logins.map((x) => x.provider).join(", ")} · joined {day(a.createdAt)} · last seen {ago(r.lastSeen)}
          </div>
          <div className="dim small mono">{a.id}</div>
        </div>
        <button className="btn" onClick={() => setRaw((x) => !x)}>
          {raw ? "Hide raw record" : "Raw record"}
        </button>
      </div>
      {raw && <pre className="card raw">{JSON.stringify(a, null, 2)}</pre>}
      <CrmPanel key={a.id} s={s} onAuth={onAuth} d={d} />
      <ConductPanel key={`lounge-${a.id}`} s={s} onAuth={onAuth} id={a.id} />
      <ChatsPanel key={`chats-${a.id}`} s={s} onAuth={onAuth} id={a.id} />
      <section className="stats">
        <Stat label="Chips" value={num(r.chips)} tone="gold" />
        <Stat label="Coins" value={num(r.coins)} />
        <Stat label="Level" value={`${r.prestige ? `P${r.prestige} · ` : ""}${r.level}`} sub={`${num(p.xp)} XP`} />
        <Stat
          label="Games"
          value={num(r.totalGames ?? r.games)}
          sub={`${num(r.wins + (r.arcadeGames ?? 0))} won · ${num(r.games)} Heist${r.arcadeGames ? ` · ${num(r.arcadeGames)} Arcade` : ""}`}
        />
        <Stat label="Winnings" value={num(r.winnings)} tone="cash" />
        <Stat label="Skill rating" value={r.rating} sub={`${num(p.ratedGames)} rated games · campaign ${p.campaign ?? 0}/12`} />
      </section>
      <section className="split">
        <div className="card">
          <div className="card-head">
            <h3>Recent games</h3>
            <Link to={`/activity?user=${a.id}&kinds=${ALL_GAMES_KINDS}`}>All games →</Link>
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

const ALL_GAMES_KINDS = GAME_KINDS.join(",");

function GameList({ s, onAuth, userId }: { s: Session; onAuth: (e: unknown) => void; userId: string }) {
  const l = useAdmin<{ events: ActivityEvent[] }>(s, `/activity?user=${userId}&kinds=${ALL_GAMES_KINDS}&limit=12`, onAuth);
  if (!l.data) return <Problem error={l.error} />;
  if (!l.data.events.length) return <p className="dim">No games yet.</p>;
  return (
    <ul className="games">
      {l.data.events.map((e, idx) => {
        const d = (e.data ?? {}) as Record<string, any>;
        const isArcade = !e.kind.startsWith("game.") && !e.kind.startsWith("solo.");
        const res = isArcade ? (e.kind.endsWith(".finish") ? "won" : e.kind.endsWith(".bank") ? "banked" : "started") : d.abandoned ? "abandoned" : d.quit ? "quit" : d.won ? "won" : "lost";
        const title = isArcade ? labelOf(e.kind) : e.kind === "game.online" ? "Online Heist" : d.stage ? `Campaign ${d.stage}` : "Vs bots";
        return (
          <li key={`${e.at}-${idx}-${d.gameId ?? ""}`} onClick={() => d.gameId && go(`/games/${d.gameId}`)}>
            <span className={`result ${res}`}>{res}</span>
            <span>
              {title} {d.players ? `· ${d.players}p` : ""} {d.stakes ? `· ${num(d.stakes)}` : ""}
            </span>
            <span className="dim">{d.payout ? `+${num(d.payout)}` : d.score ? `score ${num(d.score)}` : ""}</span>
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
  const mine = query.get("mine") === "1";
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
    // one player's own file shows everything they did, even when they're you or Claude
    if (mine || user) p.set("mine", "1");
    return p;
  }, [user, fams, exact, query, from, to, mine]);

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
        {!user && (
          <label className="toggle" title="Players only unless this is ticked">
            <input type="checkbox" checked={mine} onChange={(e) => setQuery({ mine: e.target.checked ? "1" : "" })} /> Include mine, Claude's and bots
          </label>
        )}
      </div>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ text });
        }}
      >
        <input className="search" placeholder="Search anything: a name, a #number, an item, a chat line, an IP…" value={text} onChange={(e) => setText(e.target.value)} />
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
                <li className={`ev ${e.ok === false ? "failed" : ""} ${e.claude || e.you || e.bot ? "not-player" : ""} ${open === i ? "open" : ""}`} onClick={() => setOpen(open === i ? null : i)}>
                  <time>{new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
                  <span className={`fam fam-${familyOf(e.kind)}`} title={e.kind} />
                  <span className="who">
                    {e.userId ? (
                      <>
                        <Link to={`/players/${e.userId}`}>{e.name ?? e.userId}</Link> <PlayerNum id={e.userId} />
                      </>
                    ) : (
                      <span className="dim">{e.ip ?? "—"}</span>
                    )}
                  </span>
                  <span className="what">
                    {e.you && <span className="badge you">you</span>}
                    {e.claude && <span className="badge claude">Claude</span>}
                    {e.bot && <span className="badge bot">bot</span>} <b>{labelOf(e.kind)}</b> <span className="detail">{detailOf(e)}</span>
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
              <PlayerNum id={x.userId} />
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
