// The signed-in player, shared across the app, plus the look they've equipped (felt and card backs are
// CSS variables on the page, so the table picks them up without knowing about cosmetics).

import { cosmetic, type Reward } from "@heist/profile";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BackendError, openBackend, type Backend, type Me } from "./backend";

interface AccountCtx {
  backend: Backend | null;
  me: Me | null;
  /** the account couldn't load (server unreachable after retries) */
  failed: boolean;
  /** the last error from an action, for a toast */
  error: string | null;
  clearError(): void;
  /** run a backend call that returns the updated player */
  act<T extends Me | { me: Me }>(f: (b: Backend) => Promise<T>): Promise<T | null>;
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

  useEffect(() => {
    let live = true;
    openBackend().then(async (b) => {
      const m = await b.me().catch(() => null);
      if (!live) return;
      setBackend(b);
      setMe(m);
      setFailed(!m);
    });
    return () => {
      live = false;
    };
  }, []);

  const act = useCallback(
    async <T extends Me | { me: Me }>(f: (b: Backend) => Promise<T>): Promise<T | null> => {
      if (!backend) return null;
      try {
        const r = await f(backend);
        setMe("me" in r && typeof r.me === "object" ? (r as { me: Me }).me : (r as Me));
        return r;
      } catch (e) {
        setError(e instanceof BackendError ? e.message : "Couldn't reach the game server. Try again in a moment.");
        return null;
      }
    },
    [backend],
  );

  useEquippedLook(me);
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const value = useMemo(() => ({ backend, me, failed, error, clearError: () => setError(null), act, reward, showReward }), [backend, me, failed, error, act, reward]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
