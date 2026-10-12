// Friends, as the app sees them: the list (with who's online and unread messages), requests both ways, and
// invites to a friend's table. Kept in one place and refreshed every few seconds while the app is open, so
// the lobby's badge, the Friends sheet and the table's invite list all agree. Server accounts only.

import { useEffect, useSyncExternalStore } from "react";
import { ServerBackend, type Backend } from "./backend";

export interface Person {
  id: string;
  name: string;
  level: number;
  prestige: number;
  frame: string;
  /** the chat bubble they wear */
  chat?: string;
}

export interface Friend extends Person {
  online: boolean;
  seen: number | null;
  /** they get invites as phone notifications */
  alerts: boolean;
  unread: number;
  last: { text: string; at: number; mine: boolean } | null;
}

export interface Invite {
  from: string;
  name: string;
  code: string;
  at: number;
}

export interface FriendsView {
  friends: Friend[];
  incoming: (Person & { at: number })[];
  outgoing: (Person & { at: number })[];
  invites: Invite[];
}

export interface Dm {
  from: string;
  text: string;
  at: number;
}

export interface Thread {
  friend: Person & { online: boolean };
  /** the bubble your own messages show in */
  chat?: string;
  friends: boolean;
  messages: Dm[];
  theirRead: number;
}

/** how often the list refreshes while the app is open (faster while the Friends sheet is up) */
const SLOW_MS = 20_000;
const FAST_MS = 5_000;

let server: ServerBackend | null = null;
let view: FriendsView | null = null;
let timer = 0;
let fast = 0;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

function api() {
  if (!server) throw new Error("Friends need the game server");
  return server;
}

export async function refreshFriends() {
  if (!server) return;
  try {
    view = await server.request<FriendsView>("/api/friends");
    changed();
  } catch {
    /* offline for a moment: the next tick tries again */
  }
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(
    async () => {
      if (document.visibilityState === "visible") await refreshFriends();
      schedule();
    },
    fast > 0 ? FAST_MS : SLOW_MS,
  );
}

/** Start keeping the friends list fresh (once the account has loaded). */
export function useFriendsSync(backend: Backend | null, signedIn: boolean) {
  useEffect(() => {
    if (!(backend instanceof ServerBackend) || !signedIn) return;
    server = backend;
    void refreshFriends();
    schedule();
    const back = () => document.visibilityState === "visible" && void refreshFriends();
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      clearTimeout(timer);
    };
  }, [backend, signedIn]);
}

/** Refresh faster while a friends screen is open. */
export function useFastFriends() {
  useEffect(() => {
    fast++;
    void refreshFriends();
    schedule();
    return () => {
      fast--;
    };
  }, []);
}

export function useFriends(): FriendsView | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => view,
  );
}

/** Requests waiting on you, unread messages and live invites, for a badge. */
export function badgeCount(v: FriendsView | null) {
  if (!v) return 0;
  return v.incoming.length + v.invites.length + v.friends.reduce((n, f) => n + f.unread, 0);
}

const after = async <T>(p: Promise<T>) => {
  const r = await p;
  void refreshFriends();
  return r;
};

export const friendsApi = {
  search: (q: string) => api().request<{ people: Person[] }>(`/api/friends/search?q=${encodeURIComponent(q)}`).then((r) => r.people),
  request: (id: string) => after(api().request<{ status: "sent" | "friends" }>("/api/friends/request", { id })),
  accept: (id: string) => after(api().request("/api/friends/accept", { id })),
  remove: (id: string) => after(api().request("/api/friends/remove", { id })),
  invite: (id: string, code: string) => api().request<{ devices: number; online: boolean }>("/api/friends/invite", { id, code }),
  dismiss: (code: string) => {
    if (view) {
      view = { ...view, invites: view.invites.filter((i) => i.code !== code) };
      changed();
    }
    return api().request("/api/friends/dismiss", { code }).catch(() => {});
  },
  thread: (id: string) => api().request<Thread>(`/api/dm?with=${encodeURIComponent(id)}`),
  send: (to: string, text: string) => api().request<{ message: Dm }>("/api/dm/send", { to, text }),
};
