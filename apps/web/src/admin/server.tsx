import type { Metric, ServerReport } from "./api";
import { Columns, Stat, ago, num, usePoll, when } from "./bits";
import { Problem, useAdmin, type PageProps } from "./pages";

const HOUR = 3_600_000;
const hourLabel = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric" });
const money = (n: number | null | undefined) => (n == null ? "?" : `$${n.toFixed(2)}`);
const uptime = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);

/** Render's numbers in units a person reads: bytes become MB, CPU becomes % of one core. */
function scaled(m: Metric, kind: "cpu" | "bytes" | "count") {
  if (!m) return null;
  const unit = (m.unit ?? "").toLowerCase();
  const f = kind === "cpu" ? 100 : kind === "bytes" ? (unit.includes("mb") ? 1 : unit.includes("gb") ? 1024 : 1 / 2 ** 20) : 1;
  return m.points.map((p) => ({ at: p.at, value: Math.round(p.value * f * 10) / 10 }));
}

/** The last 24 hours as 24 columns, empty hours included. */
function hourly(points: { at: number; value: number }[], now: number, how: "avg" | "sum" | "max" = "avg") {
  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const buckets = Array.from({ length: 24 }, () => [] as number[]);
  for (const p of points) {
    const i = Math.floor((p.at - start) / HOUR);
    if (i >= 0 && i < 24) buckets[i].push(p.value);
  }
  return buckets.map((b, i) => ({
    label: hourLabel(start + i * HOUR),
    value: !b.length ? 0 : Math.round((how === "sum" ? b.reduce((x, y) => x + y, 0) : how === "max" ? Math.max(...b) : b.reduce((x, y) => x + y, 0) / b.length) * 10) / 10,
  }));
}

export function ServerPage({ s, onAuth }: PageProps) {
  const r = useAdmin<ServerReport>(s, "/server", onAuth);
  usePoll(r.reload, 30_000);
  const d = r.data;
  if (!d) return <Problem error={r.error} />;
  const rd = d.render.connected ? d.render : null;
  const samples = d.self.samples;
  const last = samples.at(-1);
  const memLimit = rd ? scaled(rd.metrics.memoryLimit, "bytes")?.at(-1)?.value : null;
  const limitMb = memLimit || (d.cost.plan === "starter" ? 512 : null);
  const diskUsed = d.disk?.totalMb != null && d.disk.freeMb != null ? d.disk.totalMb - d.disk.freeMb : null;
  const lastDeploy = rd?.deploys.find((x) => x.status === "live") ?? rd?.deploys[0];
  const cpu = rd ? scaled(rd.metrics.cpu, "cpu") : null;
  const mem = rd ? scaled(rd.metrics.memory, "bytes") : null;
  const reqs = rd ? scaled(rd.metrics.requests, "count") : null;
  const bw = rd ? scaled(rd.metrics.bandwidth, "bytes") : null;
  const total = (p: { value: number }[] | null) => (p ? p.reduce((n, x) => n + x.value, 0) : 0);
  return (
    <>
      <section className="stats">
        <Stat
          label="Server"
          tone="cash"
          value={rd ? (rd.service.suspended === "suspended" ? "Paused" : "Live") : "Live"}
          sub={rd ? [rd.service.plan, rd.service.region].filter(Boolean).join(" · ") : `up ${uptime(d.self.uptimeS)}`}
        />
        <Stat label="Up for" value={uptime(d.self.uptimeS)} sub={lastDeploy?.finishedAt ? `last deploy ${ago(lastDeploy.finishedAt)}` : d.self.commit ? `version ${d.self.commit}` : `since ${when(d.self.startedAt)}`} />
        <Stat label="Memory" value={`${num(d.self.rssMb)} MB`} sub={limitMb ? `of ${num(limitMb)} MB (${Math.round((d.self.rssMb / limitMb) * 100)}%)` : `${num(d.self.heapMb)} MB in use by the game`} />
        <Stat label="CPU" value={last ? `${last.cpu}%` : "…"} sub={last ? "of one core, last minute" : "first reading after a minute"} />
        <Stat label={d.disk?.kind === "database" ? "Database" : "Disk"} value={diskUsed != null ? `${num(diskUsed)} MB` : "?"} sub={d.disk?.totalMb ? `of ${num(d.disk.totalMb)} MB (${Math.round(((diskUsed ?? 0) / d.disk.totalMb) * 100)}%)` : "not measured here"} />
        <Stat label="This month" tone="gold" value={money(d.cost.soFar)} sub={`of ${money(d.cost.monthly)} a month (estimate)`} />
      </section>

      {!rd && <ConnectRender r={d.render as { connected: false; missing?: string; error?: string }} />}

      <section className="charts">
        {cpu ? (
          <Columns title="CPU, % of a core" rows={hourly(cpu, d.at)} total={`peak ${Math.max(0, ...cpu.map((p) => p.value))}%`} />
        ) : (
          <Columns title="CPU, % of a core" rows={hourly(samples.map((x) => ({ at: x.at, value: x.cpu })), d.at)} total="since the last restart" />
        )}
        {mem ? (
          <Columns title="Memory, MB" rows={hourly(mem, d.at)} total={limitMb ? `limit ${num(limitMb)} MB` : ""} />
        ) : (
          <Columns title="Memory, MB" rows={hourly(samples.map((x) => ({ at: x.at, value: x.rssMb })), d.at)} total={limitMb ? `limit ${num(limitMb)} MB` : ""} />
        )}
        {reqs && <Columns title="Requests per hour" rows={hourly(reqs, d.at, "sum")} total={`${num(total(reqs))} in 24h`} />}
        {bw && <Columns title="Traffic out, MB" rows={hourly(bw, d.at, "sum")} total={`${num(Math.round(total(bw)))} MB in 24h`} />}
        <Columns title="Connected players" rows={hourly(samples.map((x) => ({ at: x.at, value: x.sockets })), d.at, "max")} total={`${num(d.live.sockets)} now`} />
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Bill</h3>
            <a className="dim small" href="https://dashboard.render.com/billing" target="_blank" rel="noreferrer">
              Exact bill on Render →
            </a>
          </div>
          <table className="kv">
            <tbody>
              <tr>
                <td>Server ({d.cost.plan})</td>
                <td>{money(d.cost.service)} / month</td>
              </tr>
              {d.cost.disk > 0 && (
                <tr>
                  <td>Data disk ({rd?.service.diskGb ?? 1} GB)</td>
                  <td>{money(d.cost.disk)} / month</td>
                </tr>
              )}
              {!!d.cost.database && (
                <tr>
                  <td>Database</td>
                  <td>{money(d.cost.database)} / month</td>
                </tr>
              )}
              <tr className="sum">
                <td>Total</td>
                <td>{money(d.cost.monthly)} / month</td>
              </tr>
              <tr>
                <td>So far this month</td>
                <td>{money(d.cost.soFar)}</td>
              </tr>
            </tbody>
          </table>
          <p className="dim small">Render's list prices. Render doesn't let apps read the bill itself, so taxes, bandwidth overage and any other services on your account only show on Render's billing page.</p>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>{d.disk?.kind === "database" ? "What's in the database" : "What's on the disk"}</h3>
            <span className="dim small">{d.disk?.freeMb != null ? `${num(d.disk.freeMb)} MB free` : ""}</span>
          </div>
          {d.disk ? (
            <table className="kv">
              <tbody>
                {d.disk.parts.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>
                      {p.mb < 1 ? `${Math.round(p.mb * 1024)} KB` : `${num(Math.round(p.mb * 10) / 10)} MB`} <span className="dim small">· {num(p.files)} {d.disk?.kind === "database" ? (p.files === 1 ? "row" : "rows") : p.files === 1 ? "file" : "files"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dim">No data folder.</p>
          )}
          <p className="dim small">
            Node {d.self.node}
            {d.self.commit ? ` · version ${d.self.commit}` : ""}
            {d.self.branch ? ` · ${d.self.branch}` : ""}
          </p>
        </div>
      </section>

      {rd && (
        <div className="card">
          <div className="card-head">
            <h3>Deploys</h3>
            {rd.service.dashboard && (
              <a className="dim small" href={rd.service.dashboard} target="_blank" rel="noreferrer">
                Open in Render →
              </a>
            )}
          </div>
          <ul className="deploys">
            {rd.deploys.map((x) => (
              <li key={x.id}>
                <span className={`pill deploy-${x.status}`}>{x.status.replace(/_/g, " ")}</span>
                <span className="mono">{x.commit ?? ""}</span>
                <span className="msg">{x.message ?? x.trigger ?? ""}</span>
                <span className="dim small">{x.createdAt ? ago(x.createdAt) : ""}</span>
              </li>
            ))}
            {!rd.deploys.length && <li className="dim">No deploys found.</li>}
          </ul>
        </div>
      )}
    </>
  );
}

function ConnectRender({ r }: { r: { missing?: string; error?: string } }) {
  return (
    <div className="card connect">
      <div className="card-head">
        <h3>{r.error ? "Render didn't answer" : "Connect Render for the full picture"}</h3>
      </div>
      {r.error ? (
        <p className="problem">{r.error}</p>
      ) : r.missing === "service" ? (
        <p className="dim">This server isn't running on Render, so only its own numbers show.</p>
      ) : (
        <>
          <p className="dim">The numbers above come from the server itself. With a Render API key this page also shows Render's CPU, memory, requests, traffic and deploys.</p>
          <ol>
            <li>
              In Render, open <b>Account Settings → API Keys</b> and click <b>Create API Key</b>. Copy it.
            </li>
            <li>
              Open the <b>heist-server</b> service → <b>Environment</b> → <b>Add Environment Variable</b>.
            </li>
            <li>
              Name it <span className="mono">RENDER_API_KEY</span>, paste the key, and save. The server restarts and this page fills in.
            </li>
          </ol>
        </>
      )}
    </div>
  );
}
