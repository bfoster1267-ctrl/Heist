import type { Economy } from "./api";
import { Columns, Link, Stat, day, num, usePoll } from "./bits";
import { PlayerTable, Problem, useAdmin, type PageProps } from "./pages";

const short = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}`;

/** Each place chips come from or go to, in words. */
export const SOURCES: { key: keyof Economy["flows"]; label: string; note: string }[] = [
  { key: "start", label: "Starting stacks", note: "every new account starts with 10,000" },
  { key: "daily", label: "Free daily chips", note: "500 a day per player" },
  { key: "refill", label: "Refills", note: "broke players topping back up to 2,500" },
  { key: "botsWon", label: "Won off bots", note: "pots won at bot tables: the bots' buy-ins are new chips" },
  { key: "botsLost", label: "Lost to bots", note: "buy-ins lost at bot tables leave the game" },
  { key: "online", label: "Online tables (net)", note: "mostly moves chips between players; bots' seats add some" },
  { key: "packs", label: "Packs bought with chips", note: "3,000 chips each" },
];

export function EconomyPage({ s, onAuth }: PageProps) {
  const r = useAdmin<Economy>(s, "/economy", onAuth);
  usePoll(r.reload, 30_000);
  const e = r.data;
  if (!e) return <Problem error={r.error} />;
  const f = e.flows;
  const total = (k: "day" | "week" | "month" | "all", sign: 1 | -1) => SOURCES.reduce((n, x) => n + (Math.sign(f[x.key][k]) === sign ? f[x.key][k] : 0), 0);
  const p = e.players;
  const pct = (n: number) => (p.played ? `${Math.round((n / p.played) * 100)}%` : "–");
  const bots = f.botsWon.all + f.botsLost.all;
  return (
    <>
      <Problem error={r.error} />
      <section className="stats">
        <Stat label="Chips in circulation" tone="gold" value={num(e.circulation.chips)} sub={`${num(e.circulation.registered)} signed up · ${num(e.circulation.guests)} guests`} />
        <Stat label="Chips added today" tone="cash" value={signed(total("day", 1))} sub={`${signed(total("week", 1))} this week`} />
        <Stat label="Chips taken out today" value={signed(total("day", -1))} sub={`${signed(total("week", -1))} this week`} />
        <Stat label="Players up on their start" value={pct(p.up)} sub={`${num(p.up)} up · ${num(p.down)} down · ${num(p.broke)} near broke`} />
        <Stat label="Bots, net" value={signed(bots)} sub={bots >= 0 ? "players have won more off bots than they lost" : "bots have taken more than they paid"} />
        <Stat label="Coins in circulation" value={num(e.circulation.coins)} sub={`${num(e.coinsEarned)} earned from games`} />
      </section>

      <section className="charts">
        <Columns title="Chips added per day" rows={e.daily.map((d) => ({ label: short(d.day), value: d.added }))} total={`${num(total("month", 1))} in 30 days`} />
        <Columns title="Chips taken out per day" rows={e.daily.map((d) => ({ label: short(d.day), value: d.removed }))} total={`${num(-total("month", -1))} in 30 days`} />
        <div className="card chart">
          <div className="chart-head">
            <h3>Where players' stacks sit</h3>
            <div className="chart-total">{num(p.played)} who've played</div>
          </div>
          <ul className="hbars">
            {p.buckets.map((b) => (
              <li key={b.label}>
                <span>{b.label}</span>
                <span className="hbar">
                  <i style={{ width: `${(b.count / Math.max(1, ...p.buckets.map((x) => x.count))) * 100}%` }} />
                </span>
                <b>{num(b.count)}</b>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="card">
        <div className="card-head">
          <h3>Where chips come from and go</h3>
          <span className="dim small">{e.trackedSince ? `tracked since ${day(e.trackedSince)}` : ""}</span>
        </div>
        <div className="scroll-x">
          <table className="grid-table flows">
            <thead>
              <tr>
                <th>Source</th>
                <th className="r">Today</th>
                <th className="r wide">7 days</th>
                <th className="r wide">30 days</th>
                <th className="r">All time</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((x) => (
                <tr key={x.key}>
                  <td>
                    <b>{x.label}</b>
                    <div className="dim small">{x.note}</div>
                  </td>
                  {(["day", "week", "month", "all"] as const).map((k) => (
                    <td key={k} className={`r ${k === "week" || k === "month" ? "wide" : ""} ${f[x.key][k] > 0 ? "up" : f[x.key][k] < 0 ? "down" : "dim"}`}>
                      {signed(f[x.key][k])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="sum">
                <td>Net change</td>
                {(["day", "week", "month", "all"] as const).map((k) => (
                  <td key={k} className={`r ${k === "week" || k === "month" ? "wide" : ""}`}>
                    {signed(total(k, 1) + total(k, -1))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="dim small">
          {num(e.circulation.chips)} chips are in players' hands now.
          {e.circulation.untracked !== 0 && ` ${signed(e.circulation.untracked)} of that isn't explained by the log (play before tracking started, or online buy-ins that hit the zero floor).`}
          {e.unknownRefills > 0 && ` ${num(e.unknownRefills)} older refills had no amount recorded.`} Your own accounts are left out.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Biggest stacks</h3>
          <Link to="/players?sort=chips&show=all">All by chips →</Link>
        </div>
        <PlayerTable rows={e.top} />
      </div>
    </>
  );
}
