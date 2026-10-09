// Talks to the game server's /api/admin routes. The admin session lives in this tab only (sessionStorage)
// and is separate from any player account.

import { deviceId } from "../device";

const set = import.meta.env.VITE_SERVER_URL as string | undefined;
export const BASE = (set === "same-origin" || !set ? location.origin : set).replace(/\/$/, "");
const KEY = "heist.admin";

export interface Session {
  token: string;
  expires: number;
}

export function saved(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.expires > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function forget() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // private mode
  }
}

export class AuthError extends Error {}

export async function login(user: string, password: string): Promise<Session> {
  // the same install id the game uses in this browser, so your own accounts are left out of the numbers
  const r = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json", "x-heist-device": deviceId() }, body: JSON.stringify({ user, password }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 404 ? "The admin panel is turned off on this server (no ADMIN_PASSWORD set)." : (body.error ?? "Couldn't sign in"));
  try {
    sessionStorage.setItem(KEY, JSON.stringify(body));
  } catch {
    // private mode: signed in for this page only
  }
  return body;
}

export async function get<T>(path: string, s: Session): Promise<T> {
  const r = await fetch(`${BASE}/api/admin${path}`, { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) throw new AuthError(body.error ?? "Please sign in");
  if (!r.ok) throw new Error(body.error ?? `Error ${r.status}`);
  return body as T;
}

export async function post<T>(path: string, body: object, s: Session): Promise<T> {
  const r = await fetch(`${BASE}/api/admin${path}`, { method: "POST", headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (r.status === 401) throw new AuthError(out.error ?? "Please sign in");
  if (!r.ok) throw new Error(out.error ?? `Error ${r.status}`);
  return out as T;
}

// ------------------------------------------------------------------ shapes (mirror packages/server/src/accounts/admin.ts)

export interface AccountRow {
  id: string;
  name: string;
  email: string | null;
  guest: boolean;
  providers: string[];
  createdAt: number;
  lastSeen: number | null;
  level: number;
  prestige: number;
  chips: number;
  coins: number;
  games: number;
  wins: number;
  winnings: number;
  rating: number;
  tags: string[];
  flagged: boolean;
  banned: boolean;
  notes: number;
  person: string;
  personAccounts: number;
  you: boolean;
}

export interface Crm {
  notes: { id: string; at: number; text: string }[];
  tags: string[];
  flag: { reason: string; at: number } | null;
  ban: { reason: string; at: number; until: number | null } | null;
}

export interface SeatInfo {
  seat: number;
  kind: "open" | "human" | "bot";
  name: string;
  userId: string | null;
  connected: boolean;
  autopilot: boolean;
}

export interface RoomInfo {
  id: string;
  code: string;
  status: "lobby" | "playing" | "over";
  players: number;
  stakes: number;
  isPrivate: boolean;
  seats: SeatInfo[];
  spectators: number;
  games: number;
  botLevel: string;
}

export interface Live {
  sockets: number;
  queued: number;
  rssMb: number;
  uptimeS: number;
  rooms: RoomInfo[];
}

export type Point = { at: number; value: number };
export type Metric = { unit: string | null; points: Point[] } | null;
export interface Deploy {
  id: string;
  status: string;
  trigger: string | null;
  commit: string | null;
  message: string | null;
  createdAt: number | null;
  finishedAt: number | null;
}
export interface ServerReport {
  at: number;
  self: {
    startedAt: number;
    uptimeS: number;
    rssMb: number;
    heapMb: number;
    node: string;
    commit: string | null;
    branch: string | null;
    instance: string | null;
    samples: { at: number; cpu: number; rssMb: number; heapMb: number; sockets: number }[];
  };
  disk: { totalMb: number | null; freeMb: number | null; parts: { name: string; mb: number; files: number }[] } | null;
  render:
    | { connected: false; missing?: "key" | "service"; error?: string }
    | {
        connected: true;
        service: { name: string | null; plan: string | null; region: string | null; url: string | null; instances: number | null; suspended: string | null; dashboard: string | null; diskGb: number | null; updatedAt: string | null };
        deploys: Deploy[];
        metrics: { cpu: Metric; memory: Metric; memoryLimit: Metric; cpuLimit: Metric; requests: Metric; bandwidth: Metric };
      };
  cost: { plan: string; service: number | null; disk: number; monthly: number | null; soFar: number | null };
  live: Live;
}

export interface Overview {
  at: number;
  accounts: {
    total: number;
    registered: number;
    guests: number;
    /** unique people (accounts grouped by device, guests also by address), not counting you */
    people: number;
    /** signed-up accounts that aren't yours */
    signedUp: number;
    /** guest accounts with no device or address on record, which can't be told apart */
    untrackedGuests: number;
    emptyGuests: number;
    /** accounts seen on your devices or address */
    yours: number;
  };
  active: { day: number; week: number; month: number };
  economy: { chips: number; coins: number; packsBought: number; gamesPlayed: number; drinksSent: number };
  daily: { day: string; signups: number; people: number; games: number; active: number }[];
  today: { kind: string; count: number }[];
  newest: AccountRow[];
  live: Live | null;
}

export interface ActivityEvent {
  at: number;
  kind: string;
  userId?: string;
  name?: string;
  ip?: string;
  source?: "app";
  ok?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface AccountDetail {
  row: AccountRow;
  account: {
    id: string;
    name: string;
    createdAt: number;
    guest: boolean;
    email?: string;
    logins: { provider: string; subject: string }[];
    hasPassword: boolean;
    crm: Crm;
    sessions: number;
    solo: { gameId: string; stakes: number; players: number; startedAt: number } | null;
    progress: Record<string, unknown> & {
      stats: { recent: { at: number; mode: string; players: number; stakes: number; won: boolean; payout: number; quit?: boolean; role?: string | null }[] } & Record<string, unknown>;
      owned: string[];
      equipped: Record<string, string>;
    };
  };
  counts: Record<string, number>;
  ips: { ip: string; at: number }[];
  samePerson: { id: string; name: string; guest: boolean; games: number; createdAt: number }[];
  sameIp: { id: string; name: string }[];
  tagsInUse: { tag: string; count: number }[];
}

export type Moment =
  | { t: "say"; msg: string }
  | { t: "move"; n: number; seat: number; name: string; by: "player" | "bot" | "autopilot"; ask: string; answer: unknown };

export interface GameView {
  gameId: string;
  mode: "online" | "solo";
  seats: { name: string; bot: boolean; userId: string | null }[];
  stakes: number;
  startedAt: number;
  endedAt: number | null;
  winners: number[];
  code?: string;
  quit?: boolean;
  moments: Moment[];
  broken?: string;
}
