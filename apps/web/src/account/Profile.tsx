// The player's profile: career stats and trackers, the cosmetics shop, leaderboards, and their account.

import { ROLES, type RoleId } from "@heist/engine";
import {
  COSMETICS, DAILY_CHIPS, MAX_LEVEL, cosmetic, levelInfo, owns, prestigeCoins, prestigeName, rankName, unlocked, winRate,
  type Cosmetic, type Slot,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Chips } from "../table/pieces";
import { Avatar, Coins, Stars, XpBar } from "./bits";
import type { LeaderRow, Me } from "./backend";
import { SignIn } from "./SignIn";
import { useAccount } from "./useAccount";

type Tab = "career" | "shop" | "board" | "account";

export function Profile({ onClose, tab: start = "career" }: { onClose: () => void; tab?: Tab }) {
  const { me } = useAccount();
  const [tab, setTab] = useState<Tab>(start);
  if (!me) return null;
  return (
    <motion.div className="acct-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="acct-panel" initial={{ y: 30, scale: 0.98 }} animate={{ y: 0, scale: 1 }} role="dialog" aria-label="Your profile">
        <Header me={me} />
        <nav className="acct-tabs">
          {(
            [
              ["career", "Career"],
              ["shop", "Shop"],
              ["board", "Leaderboard"],
              ["account", me.guest ? "Sign in" : "Account"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
          <button className="acct-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </nav>
        <div className="acct-body">
          {tab === "career" && <Career me={me} />}
          {tab === "shop" && <Shop me={me} />}
          {tab === "board" && <Board me={me} />}
          {tab === "account" && <Account me={me} />}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Header({ me }: { me: Me }) {
  const { act, showReward } = useAccount();
  const p = me.progress;
  const li = levelInfo(p.xp);
  const [confirm, setConfirm] = useState(false);
  const canPrestige = li.maxed && p.prestige < 10;
  const doPrestige = async () => {
    setConfirm(false);
    const r = await act((b) => b.prestige());
    if (r) showReward({ xp: 0, coins: r.coins, lines: [{ label: prestigeName(r.me.progress.prestige), xp: 0, coins: r.coins }], payout: 0, levelBefore: MAX_LEVEL, levelAfter: 1, xpBefore: 0, xpAfter: 0, unlocked: r.unlocked, canPrestige: false });
  };
  return (
    <header className="acct-head">
      <Avatar name={me.name} frame={p.equipped.frame} level={li.level} size={84} />
      <div className="acct-head-id">
        <div className="acct-head-name">
          {me.name} <Stars prestige={p.prestige} />
        </div>
        <div className="acct-head-rank">
          Level {li.level} · {rankName(li.level)}
          {cosmetic(p.equipped.title)?.text ? ` · “${cosmetic(p.equipped.title)!.text}”` : ""}
        </div>
        <XpBar xp={p.xp} />
      </div>
      <div className="acct-head-wallet">
        <Chips amount={p.chips} />
        <Coins amount={p.coins} big />
        {canPrestige && (
          <button className="btn warn" onClick={() => setConfirm(true)}>
            Prestige ★
          </button>
        )}
      </div>
      <AnimatePresence>
        {confirm && (
          <motion.div className="acct-confirm" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div>
              Go back to level 1 with <b>{prestigeName(p.prestige + 1)}</b>, <Coins amount={prestigeCoins(p.prestige + 1)} /> coins and prestige-only cosmetics. Your stats and items stay.
            </div>
            <div className="btns center">
              <button className="btn ghost" onClick={() => setConfirm(false)}>
                Not yet
              </button>
              <button className="btn warn" onClick={doPrestige}>
                Prestige
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const roleName = (r: string) => ROLES.find((x) => x.id === r)?.name.replace(/^The /, "") ?? r;

function Career({ me }: { me: Me }) {
  const s = me.progress.stats;
  const net = s.winnings - s.lost;
  if (!s.games)
    return (
      <div className="acct-empty">
        <div className="acct-empty-big">No games yet</div>
        Play a table and your career starts here: wins, winnings, streaks and every job you pull.
      </div>
    );
  const tiles: [string, string, string?][] = [
    ["Games", s.games.toLocaleString()],
    ["Wins", s.wins.toLocaleString(), "good"],
    ["Losses", s.losses.toLocaleString(), "bad"],
    ["Win rate", pct(winRate(s)), "good"],
    ["Loss rate", pct(s.losses / s.games), "bad"],
    ["Winnings", s.winnings.toLocaleString(), "gold"],
    ["Buy-ins lost", s.lost.toLocaleString()],
    ["Net", (net >= 0 ? "+" : "") + net.toLocaleString(), net >= 0 ? "good" : "bad"],
    ["Biggest pot", s.biggestPot.toLocaleString(), "gold"],
    ["Streak", s.streak > 0 ? `${s.streak}W` : s.streak < 0 ? `${-s.streak}L` : "–", s.streak > 0 ? "good" : s.streak < 0 ? "bad" : undefined],
    ["Best streak", `${s.bestStreak}W`],
    ["Drinks sent", me.progress.drinksSent.toLocaleString()],
  ];
  const trackers: [string, number][] = [
    ["Footholds taken", s.footholds],
    ["Jobs run as Boss", s.jobsLed],
    ["Jobs pulled off", s.jobsWon],
    ["Jobs fought off", s.defenses],
    ["Double-crosses", s.doubleCrosses],
    ["Loot collected", s.loot],
    ["Busts won", s.bustsWon],
    ["Bets won", s.betsWon],
  ];
  const roles = Object.entries(s.byRole).sort((a, b) => b[1]!.g - a[1]!.g) as [RoleId, { g: number; w: number }][];
  return (
    <div className="acct-career">
      <div className="acct-tiles">
        {tiles.map(([k, v, tone], i) => (
          <motion.div key={k} className={"acct-tile " + (tone ?? "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <div className="acct-tile-v">{v}</div>
            <div className="acct-tile-k">{k}</div>
          </motion.div>
        ))}
      </div>

      <div className="acct-cols">
        <section>
          <h3>Trackers</h3>
          <div className="acct-trackers">
            {trackers.map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{v.toLocaleString()}</b>
              </div>
            ))}
          </div>
          <h3>By table</h3>
          <Bars rows={[["vs bots", s.byMode.bots], ["Online", s.byMode.online], ...[3, 4, 5, 6].map((n) => [`${n} players`, s.byPlayers[n] ?? { g: 0, w: 0 }] as [string, { g: number; w: number }])]} />
        </section>
        <section>
          <h3>By Role</h3>
          {roles.length ? <Bars rows={roles.map(([r, v]) => [roleName(r), v])} /> : <div className="dim">Roles show up after your first game.</div>}
          <h3>Recent games</h3>
          <div className="acct-recent">
            {s.recent.map((g, i) => (
              <div key={i} className={g.won ? "won" : "lost"}>
                <span className="acct-recent-wl">{g.quit ? "LEFT" : g.won ? "WIN" : "LOSS"}</span>
                <span>
                  {g.players}p {g.mode === "online" ? "online" : "vs bots"}
                  {g.role ? ` · ${roleName(g.role)}` : ""}
                </span>
                <span className={g.net >= 0 ? "good" : "bad"}>{(g.net >= 0 ? "+" : "") + g.net.toLocaleString()}</span>
                <span className="dim">+{g.xp} XP</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: [string, { g: number; w: number }][] }) {
  return (
    <div className="acct-bars">
      {rows.map(([k, v]) => (
        <div key={k} className="acct-bar">
          <span className="acct-bar-k">{k}</span>
          <span className="acct-bar-track">
            <motion.span className="acct-bar-fill" initial={{ width: 0 }} animate={{ width: v.g ? pct(v.w / v.g) : 0 }} transition={{ duration: 0.8 }} />
          </span>
          <span className="acct-bar-v">{v.g ? `${pct(v.w / v.g)} · ${v.w}/${v.g}` : "–"}</span>
        </div>
      ))}
    </div>
  );
}

const SLOTS: [Slot, string][] = [
  ["felt", "Table felt"],
  ["cardBack", "Card backs"],
  ["frame", "Avatar frames"],
  ["title", "Titles"],
];

function Shop({ me }: { me: Me }) {
  const { act } = useAccount();
  const p = me.progress;
  const li = levelInfo(p.xp);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, f: "buy" | "equip") => {
    setBusy(id);
    await act((b) => (f === "buy" ? b.buy(id) : b.equip(id)));
    setBusy(null);
  };
  const lockText = (c: Cosmetic) =>
    c.unlock?.prestige ? `${prestigeName(c.unlock.prestige)}` : c.unlock?.level ? `Level ${c.unlock.level}` : "";
  return (
    <div className="acct-shop">
      <div className="acct-shop-top">
        <Coins amount={p.coins} big />
        <span className="dim">Earn coins by playing, winning and leveling up. Coins can't be bought.</span>
      </div>
      {SLOTS.map(([slot, label]) => (
        <section key={slot}>
          <h3>{label}</h3>
          <div className="acct-items">
            {COSMETICS.filter((c) => c.slot === slot).map((c) => {
              const have = owns(p, c.id);
              const on = p.equipped[slot] === c.id;
              const open = unlocked(c, li.level, p.prestige);
              return (
                <motion.div key={c.id} className={"acct-item" + (on ? " on" : "") + (!open ? " locked" : "")} layout whileHover={{ y: -3 }}>
                  <Preview c={c} name={me.name} />
                  <div className="acct-item-name">{c.name}</div>
                  {on ? (
                    <div className="acct-item-tag">Equipped</div>
                  ) : have ? (
                    <button className="btn small gold" disabled={busy === c.id} onClick={() => run(c.id, "equip")}>
                      Equip
                    </button>
                  ) : !open ? (
                    <div className="acct-item-lock">🔒 {lockText(c)}</div>
                  ) : (
                    <button className="btn small primary" disabled={busy === c.id || p.coins < c.price} onClick={() => run(c.id, "buy")}>
                      <span className="acct-coin" /> {c.price.toLocaleString()}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Preview({ c, name }: { c: Cosmetic; name: string }) {
  const [a, b] = c.colors ?? ["#333", "#111"];
  if (c.slot === "felt") return <div className="acct-prev acct-prev-felt" style={{ background: `radial-gradient(ellipse at 50% 40%, ${a}, ${b})` }} />;
  if (c.slot === "cardBack")
    return (
      <div className="acct-prev acct-prev-backwrap">
        <div className="acct-prev-back" data-pattern={c.pattern} style={{ ["--back" as string]: a, ["--back2" as string]: b }}>
          <span>H</span>
        </div>
      </div>
    );
  if (c.slot === "frame")
    return (
      <div className="acct-prev acct-prev-frame">
        <Avatar name={name} frame={c.id} size={50} />
      </div>
    );
  return <div className="acct-prev acct-prev-title">{c.text ? `“${c.text}”` : "—"}</div>;
}

function Board({ me }: { me: Me }) {
  const { backend } = useAccount();
  const [by, setBy] = useState<"winnings" | "level" | "wins">("winnings");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    backend?.leaderboard(by).then(setRows, () => setRows([]));
  }, [backend, by]);
  if (backend?.kind !== "server")
    return (
      <div className="acct-empty">
        <div className="acct-empty-big">Leaderboards go live with online play</div>
        They rank signed-in players by winnings, level and wins across every device.
      </div>
    );
  return (
    <div className="acct-board">
      <div className="seg">
        {(["winnings", "level", "wins"] as const).map((k) => (
          <button key={k} className={by === k ? "on" : ""} onClick={() => setBy(k)}>
            {k === "winnings" ? "Winnings" : k === "level" ? "Level" : "Wins"}
          </button>
        ))}
      </div>
      {!rows ? (
        <div className="dim">Loading…</div>
      ) : !rows.length ? (
        <div className="dim">Nobody's on the board yet. Sign in and play to be first.</div>
      ) : (
        <ol className="acct-board-rows">
          {rows.map((r, i) => (
            <li key={r.id} className={r.id === me.id ? "me" : ""}>
              <span className="acct-board-rank">{i + 1}</span>
              <Avatar name={r.name} frame={r.frame} level={r.level} size={34} />
              <span className="acct-board-name">
                {r.name} <Stars prestige={r.prestige} size={10} />
              </span>
              <span className="acct-board-v">{by === "winnings" ? r.winnings.toLocaleString() : by === "level" ? `Lv ${r.level}` : `${r.wins} wins`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Account({ me }: { me: Me }) {
  const { act, backend } = useAccount();
  const [name, setName] = useState(me.name);
  useEffect(() => setName(me.name), [me.name]);
  const [sure, setSure] = useState(false);
  const p = me.progress;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="acct-account">
      {me.guest ? (
        <SignIn />
      ) : (
        <div className="acct-signed">
          Signed in{me.email ? ` as ${me.email}` : ""} with {me.logins.map((l) => (l === "email" ? "email" : l[0].toUpperCase() + l.slice(1))).join(", ")}.
        </div>
      )}
      <label className="field">
        <span>Display name</span>
        <div className="btns">
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button className="btn gold" disabled={!name.trim() || name === me.name} onClick={() => act((b) => b.rename(name))}>
            Save
          </button>
        </div>
      </label>
      <div className="btns wrap">
        <button className="btn" disabled={p.dailyDay === today} onClick={() => act((b) => b.daily())}>
          {p.dailyDay === today ? "Daily chips collected" : `Collect ${DAILY_CHIPS} daily chips`}
        </button>
        {!me.guest && (
          <button className="btn ghost" onClick={() => act((b) => b.signOut())}>
            Sign out
          </button>
        )}
      </div>
      <div className="acct-danger">
        {sure ? (
          <>
            <span>{backend?.kind === "server" ? "Delete your account, career and items for good?" : "Wipe this browser's career and items?"}</span>
            <button className="btn ghost small" onClick={() => setSure(false)}>
              Keep it
            </button>
            <button
              className="btn danger small"
              onClick={async () => {
                setSure(false);
                await act((b) => b.deleteAccount());
              }}
            >
              Delete
            </button>
          </>
        ) : (
          <button className="btn ghost small" onClick={() => setSure(true)}>
            {me.guest && backend?.kind !== "server" ? "Reset career" : "Delete account"}
          </button>
        )}
      </div>
    </div>
  );
}
