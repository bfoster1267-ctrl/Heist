// The admin panel's Server page: what this process can measure about itself, plus Render's own numbers
// (service, deploys, CPU/memory/traffic) when a Render API key is set. Render has no billing API, so cost
// is worked out from the plan's list price.
import { readdir, stat, statfs } from "node:fs/promises";
import { join } from "node:path";

/** Render list prices (USD per month), for the cost estimate. */
const PLAN_PRICES: Record<string, number> = { free: 0, starter: 7, standard: 25, pro: 85, pro_plus: 175, pro_max: 225, pro_ultra: 450 };
const DISK_PER_GB = 0.25;
const HOUR = 3_600_000;

export interface HostingOptions {
  dataDir?: string;
  /** Render API key (Account Settings > API Keys); without it only the server's own numbers show */
  renderKey?: string;
  /** set by Render on every service */
  serviceId?: string;
  /** what the Blueprint asks for, used for cost when Render can't be asked */
  plan?: string;
  diskGb?: number;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface Sample {
  at: number;
  /** share of one CPU core this process used since the last sample, 0-100+ */
  cpu: number;
  rssMb: number;
  heapMb: number;
  sockets: number;
}

export type Point = { at: number; value: number };
export type Metric = { unit: string | null; points: Point[] };

export class Hosting {
  private samples: Sample[] = [];
  private lastCpu = process.cpuUsage();
  private lastAt: number;
  private timer: NodeJS.Timeout | null = null;
  private render: { at: number; data: Promise<RenderReport> } | null = null;
  readonly started: number;

  constructor(private o: HostingOptions = {}) {
    this.started = this.now;
    this.lastAt = this.now;
  }

  private get now() {
    return this.o.now?.() ?? Date.now();
  }

  /** Take a reading every minute, keeping the last day. */
  start(sockets: () => number, everyMs = 60_000) {
    this.stop();
    this.timer = setInterval(() => this.sample(sockets()), everyMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sample(sockets: number): Sample {
    const now = this.now;
    const cpu = process.cpuUsage(this.lastCpu);
    const ms = Math.max(1, now - this.lastAt);
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
    const m = process.memoryUsage();
    const s = { at: now, cpu: Math.round(((cpu.user + cpu.system) / 1000 / ms) * 1000) / 10, rssMb: mb(m.rss), heapMb: mb(m.heapUsed), sockets };
    this.samples.push(s);
    while (this.samples.length && this.samples[0].at < now - 24 * HOUR) this.samples.shift();
    return s;
  }

  async report() {
    const now = this.now;
    const m = process.memoryUsage();
    const render = await this.fromRender();
    const svc = render.connected ? render.service : null;
    return {
      at: now,
      self: {
        startedAt: this.started,
        uptimeS: Math.round((now - this.started) / 1000),
        rssMb: mb(m.rss),
        heapMb: mb(m.heapUsed),
        node: process.version,
        commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
        branch: process.env.RENDER_GIT_BRANCH ?? null,
        instance: process.env.RENDER_INSTANCE_ID ?? null,
        samples: this.samples,
      },
      disk: await this.diskCached(),
      render,
      cost: this.cost((svc?.plan as string) ?? null, (svc?.diskGb as number) ?? null),
    };
  }

  private diskAt: { at: number; data: ReturnType<Hosting["disk"]> } | null = null;
  /** walking the games folder isn't free: at most every 5 minutes */
  private diskCached() {
    if (!this.diskAt || this.now - this.diskAt.at > 5 * 60_000) this.diskAt = { at: this.now, data: this.disk() };
    return this.diskAt.data;
  }

  /** The data disk: how full it is, and what's on it. */
  private async disk() {
    const dir = this.o.dataDir;
    if (!dir) return null;
    const out: { totalMb: number | null; freeMb: number | null; parts: { name: string; mb: number; files: number }[] } = { totalMb: null, freeMb: null, parts: [] };
    try {
      const fs = await statfs(dir);
      out.totalMb = mb(fs.blocks * fs.bsize);
      out.freeMb = mb(fs.bavail * fs.bsize);
    } catch {
      /* not on this platform */
    }
    const parts: [string, string][] = [
      ["Activity log", "activity"],
      ["Online games", "games"],
      ["Accounts", "accounts.json"],
    ];
    for (const [name, rel] of parts) {
      const u = await usage(join(dir, rel));
      out.parts.push({ name, mb: Math.round(u.bytes / 2 ** 20 * 100) / 100, files: u.files });
    }
    return out;
  }

  /** Render's view, asked at most once a minute. */
  private fromRender(): Promise<RenderReport> {
    if (!this.o.renderKey || !this.o.serviceId) return Promise.resolve({ connected: false, missing: !this.o.renderKey ? "key" : "service" });
    if (this.render && this.now - this.render.at < 60_000) return this.render.data;
    const data = this.askRender().catch((e): RenderReport => ({ connected: false, error: String(e?.message ?? e) }));
    this.render = { at: this.now, data };
    return data;
  }

  private async askRender(): Promise<RenderReport> {
    const id = this.o.serviceId!;
    const f = this.o.fetch ?? fetch;
    const call = async (path: string) => {
      const r = await f(`https://api.render.com/v1${path}`, { headers: { authorization: `Bearer ${this.o.renderKey}`, accept: "application/json" } });
      if (r.status === 401) throw new Error("Render turned the API key down. Make a new key and paste it into RENDER_API_KEY.");
      if (!r.ok) throw new Error(`Render answered ${r.status} for ${path.split("?")[0]}`);
      return r.json();
    };
    const end = new Date(this.now);
    const start = new Date(this.now - 24 * HOUR);
    const range = `resource=${encodeURIComponent(id)}&startTime=${start.toISOString()}&endTime=${end.toISOString()}&resolutionSeconds=3600`;
    const metric = (name: string, extra = "") => call(`/metrics/${name}?${range}${extra}`).then((b): Metric => ({ unit: (Array.isArray(b) && b[0]?.unit) || null, points: series(b) }), () => null);
    const [svc, deploys, cpu, memory, memoryLimit, cpuLimit, requests, bandwidth] = await Promise.all([
      call(`/services/${id}`),
      call(`/services/${id}/deploys?limit=8`).catch(() => []),
      metric("cpu", "&aggregationMethod=AVG"),
      metric("memory", "&aggregationMethod=AVG"),
      metric("memory-limit"),
      metric("cpu-limit"),
      metric("http-requests"),
      metric("bandwidth"),
    ]);
    const d = svc?.serviceDetails ?? {};
    return {
      connected: true,
      service: {
        name: svc?.name ?? null,
        plan: d.plan ?? null,
        region: d.region ?? null,
        url: d.url ?? null,
        instances: d.numInstances ?? null,
        suspended: svc?.suspended ?? null,
        createdAt: svc?.createdAt ?? null,
        updatedAt: svc?.updatedAt ?? null,
        dashboard: svc?.dashboardUrl ?? null,
        diskGb: d.disk?.sizeGB ?? null,
      },
      deploys: (Array.isArray(deploys) ? deploys : []).map((x: { deploy?: Record<string, any> }) => x.deploy ?? x).map((x: Record<string, any>) => ({
        id: x.id,
        status: x.status,
        trigger: x.trigger ?? null,
        commit: x.commit?.id?.slice(0, 7) ?? null,
        message: typeof x.commit?.message === "string" ? x.commit.message.split("\n")[0].slice(0, 120) : null,
        createdAt: x.createdAt ? Date.parse(x.createdAt) : null,
        finishedAt: x.finishedAt ? Date.parse(x.finishedAt) : null,
      })),
      metrics: { cpu, memory, memoryLimit, cpuLimit, requests, bandwidth },
    };
  }

  /** What the month costs: the plan's list price plus the disk, and the share of it used so far. */
  cost(plan: string | null, diskGb: number | null): Cost {
    const name = (plan ?? this.o.plan ?? "starter").toLowerCase();
    const service = PLAN_PRICES[name] ?? null;
    const disk = (diskGb ?? this.o.diskGb ?? 0) * DISK_PER_GB;
    const monthly = service === null ? null : Math.round((service + disk) * 100) / 100;
    const d = new Date(this.now);
    const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const into = (d.getUTCDate() - 1 + (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440) / days;
    return { plan: name, service, disk: Math.round(disk * 100) / 100, monthly, soFar: monthly === null ? null : Math.round(monthly * into * 100) / 100 };
  }
}

export interface Cost {
  plan: string;
  service: number | null;
  disk: number;
  monthly: number | null;
  /** this calendar month so far, at the monthly rate */
  soFar: number | null;
}

export type RenderReport =
  | { connected: false; missing?: "key" | "service"; error?: string }
  | {
      connected: true;
      service: Record<string, string | number | boolean | null>;
      deploys: { id: string; status: string; trigger: string | null; commit: string | null; message: string | null; createdAt: number | null; finishedAt: number | null }[];
      metrics: Record<string, Metric | null>;
    };

/** Render returns one series per instance/label: add them up per timestamp. */
export function series(body: unknown): Point[] {
  const list = Array.isArray(body) ? body : [];
  const by = new Map<number, number>();
  for (const s of list) {
    for (const v of (s as { values?: { timestamp: string; value: number }[] })?.values ?? []) {
      const at = Date.parse(v.timestamp);
      if (Number.isFinite(at) && Number.isFinite(v.value)) by.set(at, (by.get(at) ?? 0) + v.value);
    }
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([at, value]) => ({ at, value }));
}

const mb = (bytes: number) => Math.round(bytes / 2 ** 20);

async function usage(path: string): Promise<{ bytes: number; files: number }> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return { bytes: s.size, files: 1 };
    let bytes = 0;
    let files = 0;
    for (const e of await readdir(path, { withFileTypes: true })) {
      const u = await usage(join(path, e.name));
      bytes += u.bytes;
      files += u.files;
    }
    return { bytes, files };
  } catch {
    return { bytes: 0, files: 0 };
  }
}
