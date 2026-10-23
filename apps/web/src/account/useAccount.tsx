// The signed-in player, shared across the app, plus the look they've equipped (felt and card backs are
// CSS variables on the page, so the table picks them up without knowing about cosmetics).

import { cosmetic, type Reward } from "@heist/profile";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bootStep } from "../boot";
import { BackendError, openBackend, type Backend, type Me } from "./backend";
import { getHeistProSession, setHeistPro, useHeistPro } from "./pro";

interface AccountCtx {
  backend: Backend | null;
  me: Me | null;
  /** the account couldn't load (server unreachable after retries) */
  failed: boolean;
  /** the account is suspended: the reason the server gave */
  suspended: string | null;
  /** the last error from an action, for a toast */
  error: string | null;
  clearError(): void;
  /** run a backend call that returns the updated player */
  act<T extends Me | { me: Me }>(f: (b: Backend) => Promise<T>, o?: { inline?: boolean }): Promise<T | null>;
  /** a reward waiting to be shown (after a game, a prestige) */
  reward: Reward | null;
  showReward(r: Reward | null): void;
}

const Ctx = createContext<AccountCtx | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reward, showReward] = useState<Reward | null>(null);
  const [failed, setFailed] = useState(false);
  const [suspended, setSuspended] = useState<string | null>(null);
  const banned = (e: unknown) => e instanceof BackendError && e.status === 403 && /suspended/i.test(e.message) && (setSuspended(e.message), true);

  useEffect(() => {
    let live = true;
    let bInstance: Backend | null = null;
    openBackend().then(
      async (b) => {
        bInstance = b;
        bootStep("server", { ok: true });
        let out = false;
        let why = "";
        const m = await b.me().catch((e) => ((why = e instanceof Error ? e.message : String(e)), (out = !!banned(e)), null));
        bootStep("guest", m ? { ok: true } : { ok: false, err: why });
        if (!live) {
          b.dispose?.();
          return;
        }
        setBackend(b);
        setMe(m);
        setFailed(!m && !out);
      },
      (e) => {
        bootStep("server", { ok: false, err: e instanceof Error ? e.message : String(e) });
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      bInstance?.dispose?.();
    };
  }, []);

  const act = useCallback(
    async <T extends Me | { me: Me }>(f: (b: Backend) => Promise<T>, o?: { inline?: boolean }): Promise<T | null> => {
      if (!backend) return null;
      try {
        const r = await f(backend);
        setMe("me" in r && typeof r.me === "object" ? (r as { me: Me }).me : (r as Me));
        return r;
      } catch (e) {
        if (banned(e)) return null;
        // inline: the caller shows the message next to its own form instead of a toast
        if (o?.inline) throw e instanceof BackendError ? e : new BackendError("Couldn't reach the game server. Try again in a moment.");
        setError(e instanceof BackendError ? e.message : "Couldn't reach the game server. Try again in a moment.");
        return null;
      }
    },
    [backend],
  );

  const isPro = useHeistPro();
  const effectiveMe = useMemo(() => {
    if (!me) return null;
    if (isPro) {
      if (me.progress.vip) return me;
      return {
        ...me,
        progress: {
          ...me.progress,
          vip: true,
        },
      };
    }
    return me;
  }, [me, isPro]);

  useEffect(() => {
    if (!backend || !me) return;
    // on the server, the account says who is VIP: a paid pass shows on every device, and a local flag
    // nobody paid for is dropped once the server turns its receipt down
    if (backend.kind === "server" && me.progress.vip && !isPro) setHeistPro(true);
    else if (isPro && !me.progress.vip) {
      backend.claimVip(getHeistProSession() ?? undefined).then(setMe, () => {
        if (backend.kind === "server") setHeistPro(false);
      });
    }
  }, [backend, me, isPro]);

  useEquippedLook(effectiveMe);
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const value = useMemo(
    () => ({ backend, me: effectiveMe, failed, suspended, error, clearError: () => setError(null), act, reward, showReward }),
    [backend, effectiveMe, failed, suspended, error, act, reward],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** What the player owns and has on, or nothing outside the account (no throw, for table pieces). */
export function useLook() {
  const me = useContext(Ctx)?.me;
  return { owned: me?.progress.owned ?? [], equipped: me?.progress.equipped };
}

/** The account, or null outside it (for table pieces that also run without one). */
export function useAccountMaybe() {
  return useContext(Ctx);
}

export function useAccount() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccount outside AccountProvider");
  return c;
}

function useEquippedLook(me: Me | null) {
  const felt = me?.progress.equipped.felt;
  const back = me?.progress.equipped.cardBack;
  const frame = me?.progress.equipped.frame;
  const chat = me?.progress.equipped.chat;
  useEffect(() => {
    const c = cosmetic(chat ?? "")?.chat;
    const root = document.documentElement.style;
    for (const [k, i] of [["--chat-bg", 0], ["--chat-ink", 1], ["--chat-edge", 2]] as const) {
      if (c && chat !== "chat.house") root.setProperty(k, c[i]);
      else root.removeProperty(k);
    }
  }, [chat]);
  useEffect(() => {
    const root = document.documentElement.style;
    const f = cosmetic(felt ?? "")?.colors;
    const b = cosmetic(back ?? "");
    const fr = cosmetic(frame ?? "")?.colors;
    const set = (k: string, v: string | undefined) => (v ? root.setProperty(k, v) : root.removeProperty(k));
    set("--cfelt", f?.[0]);
    set("--cfelt2", f?.[1]);
    document.documentElement.dataset.felt = felt && felt !== "felt.classic" ? "custom" : "house";
    set("--back", b?.colors?.[0]);
    set("--back2", b?.colors?.[1]);
    set("--frame", fr?.[0]);
    set("--frame2", fr?.[1]);
    document.documentElement.dataset.back = b?.pattern ?? "classic";
    document.documentElement.dataset.frame = fr ? "on" : "off";
  }, [felt, back, frame]);
}
