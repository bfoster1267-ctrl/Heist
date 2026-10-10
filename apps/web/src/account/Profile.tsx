// The player's profile: career stats and trackers, the cosmetics shop, leaderboards, and their account.

import { ROLES, type RoleId } from "@heist/engine";
import {
  COSMETICS, DAILY_CHIPS, MAX_LEVEL, RANKED_LEVEL, cosmetic, levelInfo, owns, prestigeCoins, prestigeName, rankName, rankOf, rankedPublic, unlocked, winRate,
  type CareerStats, type Cosmetic, type EquipSlot, type RankedPublic, type Slot,
} from "@heist/profile";
import { Cigar, Preview, bannerStyle } from "./items";
import { Season } from "./Season";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Chips } from "../table/pieces";
import { Avatar, Coins, Stars, XpBar } from "./bits";
import type { LeaderRow, Me } from "./backend";
import type { PublicProfile } from "@heist/profile";
import { SignIn } from "./SignIn";
import { useAccount } from "./useAccount";

type Tab = "career" | "season" | "shop" | "board" | "account";

export function Profile({ onClose, tab: start = "career" }: { onClose: () => void; tab?: Tab }) {
  const { me } = useAccount();
  const [tab, setTab] = useState<Tab>(start);
  // signing in from here lands on the career that just loaded
  const guest = me?.guest;
  const [wasGuest, setWasGuest] = useState(guest);
  if (guest !== wasGuest) {
    setWasGuest(guest);
    if (wasGuest && guest === false) setTab("career");
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  if (!me) return null;
  return (
    <motion.div
      className="acct-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // a tap on the dimmed backdrop closes it, like any sheet
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div className="acct-panel" initial={{ y: 30, scale: 0.98 }} animate={{ y: 0, scale: 1 }} role="dialog" aria-label="Your profile">
        <div className="acct-topbar">
          <button className="acct-back" onClick={onClose}>
            <span aria-hidden>←</span> Lobby
          </button>
          <button className="acct-x" onClick={onClose} aria-label="Close profile">
            ✕
          </button>
        </div>
        <Header me={me} />
        <nav className="acct-tabs">
          {(
            [
              ["career", "Career"],
              ["season", "Season"],
              ["shop", "Shop"],
              ["board", "Leaderboard"],
              ["account", me.guest ? "Sign in" : "Account"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="acct-body">
          {tab === "career" && <Career me={me} />}
          {tab === "season" && <Season me={me} />}
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
    <header className={"acct-head" + (bannerStyle(p.equipped.banner) ? " bannered" : "")} style={bannerStyle(p.equipped.banner)}>
      <span className="acct-head-avatar">
        <Avatar name={me.name} frame={p.equipped.frame} level={li.level} size={84} />
        <Cigar id={p.equipped.cigar} size={44} />
      </span>
      <div className="acct-head-id">
        <div className="acct-head-name">
          {me.name} <Stars prestige={p.prestige} />
        </div>
        <div className="acct-head-rank">
          Level {li.level} · {rankName(li.level)}
          {cosmetic(p.equipped.title)?.text ? ` · “${cosmetic(p.equipped.title)!.text}”` : ""}
        </div>
        <XpBar xp={p.xp} />
        <NextUnlock level={li.level} prestige={p.prestige} />
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
  const level = levelInfo(me.progress.xp).level;
  return (
    <CareerView
      stats={me.progress.stats}
      drinksSent={me.progress.drinksSent}
      ranked={rankedPublic(me.progress.ranked, Date.now())}
      rankedNote={me.guest ? "Sign in to play Ranked." : level < RANKED_LEVEL ? `Ranked unlocks at level ${RANKED_LEVEL}.` : "Play Ranked from Play online."}
    />
  );
}

/** Ranked at a glance: rank, points, MMR and this season's record. Nothing about it is hidden. */
function RankedBox({ r, note }: { r: RankedPublic | null; note?: string }) {
  if (!r)
    return (
      <div className="acct-ranked none">
        <span className="acct-ranked-label">Ranked</span>
        <span className="dim">{note ?? "No ranked games yet."}</span>
      </div>
    );
  const rank = rankOf(r.rp);
  return (
    <div className={`acct-ranked tier-${r.tier}`}>
      <span className="acct-ranked-label">Ranked</span>
      <b className="acct-ranked-rank">{r.label}</b>
      <span>
        {r.rp.toLocaleString()} RP{r.games && rank.of ? ` · ${rank.into}/${rank.of} to the next` : ""}
      </span>
      <span>MMR {r.mmr.toLocaleString()}</span>
      <span className="dim">
        {r.games} games · {r.wins} wins this season · best {r.peak}
        {r.last ? ` · ${r.last}` : ""}
      </span>
    </div>
  );
}

/** A career, yours or another player's: everyone sees the same stats. */
function CareerView({ stats: s, drinksSent, ranked, rankedNote }: { stats: CareerStats; drinksSent: number; ranked: RankedPublic | null; rankedNote?: string }) {
  const net = s.winnings - s.lost;
  if (!s.games)
    return (
      <>
        {ranked && <RankedBox r={ranked} />}
        <div className="acct-empty">
          <div className="acct-empty-big">No games yet</div>
          Play a table and the career starts here: wins, winnings, streaks and every job pulled.
        </div>
      </>
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
    ["Drinks sent", drinksSent.toLocaleString()],
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
    ["Games abandoned", s.quits],
  ];
  const roles = Object.entries(s.byRole).sort((a, b) => b[1]!.g - a[1]!.g) as [RoleId, { g: number; w: number }][];
  return (
    <div className="acct-career">
      <RankedBox r={ranked} note={rankedNote} />
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
          {s.recent.length > 1 && <Trend games={s.recent} />}
          <div className="acct-recent">
            {s.recent.map((g, i) => (
              <div key={i} className={g.won ? "won" : "lost"}>
                <span className="acct-recent-wl">{g.quit ? "QUIT" : g.won ? "WIN" : "LOSS"}</span>
                <span>
                  {g.players}p {g.mode === "online" ? "online" : "vs bots"}
                  {g.role ? ` · ${roleName(g.role)}` : ""}
                </span>
                <span className={g.net >= 0 ? "good" : "bad"}>{(g.net >= 0 ? "+" : "") + g.net.toLocaleString()}</span>
                <span className="dim">{ago(g.at)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Chips up or down over the recent games, oldest on the left. */
function Trend({ games }: { games: CareerStats["recent"] }) {
  const pts = [0];
  for (const g of [...games].reverse()) pts.push(pts[pts.length - 1] + g.net);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const W = 300;
  const H = 64;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => (hi === lo ? H / 2 : 4 + (1 - (v - lo) / (hi - lo)) * (H - 8));
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const end = pts[pts.length - 1];
  const avg = Math.round(end / games.length);
  return (
    <div className="acct-trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="acct-trend-zero" />
        <motion.path d={d} className={end >= 0 ? "up" : "down"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
      </svg>
      <div className="acct-trend-k">
        <span>
          Last {games.length} games · {avg >= 0 ? "+" : ""}
          {avg.toLocaleString()} a game
        </span>
        <b className={end >= 0 ? "good" : "bad"}>{(end >= 0 ? "+" : "") + end.toLocaleString()} chips</b>
      </div>
    </div>
  );
}

function ago(at: number) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(at).toLocaleDateString();
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

// the shop sells these; season items live in the Season tab
const SLOTS: [EquipSlot, string][] = [
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

function Board({ me }: { me: Me }) {
  const { backend } = useAccount();
  const [by, setBy] = useState<"winnings" | "level" | "wins" | "ranked">("winnings");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
        {(["winnings", "level", "wins", "ranked"] as const).map((k) => (
          <button key={k} className={by === k ? "on" : ""} onClick={() => setBy(k)}>
            {k === "winnings" ? "Winnings" : k === "level" ? "Level" : k === "wins" ? "Wins" : "Ranked"}
          </button>
        ))}
      </div>
      {!rows ? (
        <div className="dim">Loading…</div>
      ) : !rows.length ? (
        <div className="dim">{by === "ranked" ? "Nobody has played Ranked this season yet." : "Nobody's on the board yet. Sign in and play to be first."}</div>
      ) : (
        <ol className="acct-board-rows">
          {rows.map((r, i) => (
            <li key={r.id} className={r.id === me.id ? "me" : ""} role="button" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(r.id)}>
              <span className="acct-board-rank">{i + 1}</span>
              <Avatar name={r.name} frame={r.frame} level={r.level} size={34} />
              <span className="acct-board-name">
                {r.name} <Stars prestige={r.prestige} size={10} />
              </span>
              <span className="acct-board-v">{by === "winnings" ? r.winnings.toLocaleString() : by === "level" ? `Lv ${r.level}` : by === "ranked" ? `${r.rank} · ${r.rp?.toLocaleString()} RP · MMR ${r.mmr}` : `${r.wins} wins`}</span>
            </li>
          ))}
        </ol>
      )}
      {rows && rows.length > 0 && !rows.some((r) => r.id === me.id) && (
        <div className="dim acct-board-you">{me.guest ? "Guests aren't ranked. Save your career to an account to get on the board." : me.progress.stats.games ? "You're not in the top 100 yet. Keep playing." : "Play a game to get on the board."}</div>
      )}
      <AnimatePresence>{open && <PlayerCard id={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

/** The next cosmetic the player's level (or prestige) will open up, to aim for. */
function NextUnlock({ level, prestige }: { level: number; prestige: number }) {
  const slotName: Partial<Record<Slot, string>> = { felt: "felt", cardBack: "card back", frame: "frame", title: "title" };
  const next =
    prestige === 0
      ? COSMETICS.filter((c) => c.unlock?.level !== undefined && c.unlock.prestige === undefined && c.unlock.level > level).sort((a, b) => a.unlock!.level! - b.unlock!.level!)[0]
      : undefined;
  const nextP = next ? undefined : COSMETICS.filter((c) => c.unlock?.prestige !== undefined && c.unlock.prestige > prestige).sort((a, b) => a.unlock!.prestige! - b.unlock!.prestige!)[0];
  const c = next ?? nextP;
  if (!c) return null;
  return (
    <div className="acct-next">
      Next: {c.name} {slotName[c.slot]} at {next ? `level ${c.unlock!.level}` : prestigeName(c.unlock!.prestige!)}
    </div>
  );
}

/** A player's profile, opened from the leaderboard or by tapping their name at a table: everything you see on your own. */
export function PlayerCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { backend } = useAccount();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    backend?.player(id).then(setP, (e) => setErr(e instanceof Error ? e.message : "Couldn't load that player"));
  }, [backend, id]);
  useEffect(() => {
    // Esc closes just this card, not the whole profile under it
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  // the phone's back gesture closes the card: it gets its own history entry while open
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    let popped = false;
    history.pushState({ heistCard: true }, "");
    const pop = () => {
      popped = true;
      close.current();
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (!popped && history.state?.heistCard) history.back();
    };
  }, []);
  const s = p?.stats;
  const title = p ? cosmetic(p.equipped.title) : undefined;
  // portalled to <body>: inside the sliding profile panel, "fixed" would pin it to the panel, not the screen
  return createPortal(
    <motion.div className="acct-card-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="acct-card acct-card-full" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, opacity: 0 }} role="dialog" aria-label="Player card">
        <button className="acct-x acct-card-x" onClick={onClose} aria-label="Close player card">
          ✕
        </button>
        {err ? (
          <div className="dim">{err}</div>
        ) : !p || !s ? (
          <div className="dim">Loading…</div>
        ) : (
          <>
            <div className="acct-card-head" style={bannerStyle(p.equipped.banner)}>
              <Avatar name={p.name} frame={p.equipped.frame} level={p.level} size={56} />
              <div>
                <div className="acct-card-name">
                  {p.name} <Stars prestige={p.prestige} size={12} />
                </div>
                <div className="dim">
                  Level {p.level} · {p.rank}
                  {title?.text ? ` · ${title.text}` : ""}
                </div>
                <div className="dim acct-card-joined">Playing since {new Date(p.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</div>
              </div>
            </div>
            <div className="acct-card-body">
              <CareerView stats={s} drinksSent={p.drinksSent ?? 0} ranked={p.ranked ?? null} />
            </div>
          </>
        )}
      </motion.div>
    </motion.div>,
    document.body,
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
      {!me.guest && me.logins.includes("email") && <ChangePassword />}
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

function ChangePassword() {
  const { act } = useAccount();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!open)
    return (
      <button className="btn ghost small" onClick={() => (setOpen(true), setDone(false))}>
        {done ? "Password changed" : "Change password"}
      </button>
    );
  return (
    <form
      className="acct-email"
      onSubmit={async (e) => {
        e.preventDefault();
        setNote(null);
        const ok = await act((b) => b.changePassword(current, next), { inline: true }).catch((err: Error) => (setNote(err.message), null));
        if (ok) {
          setOpen(false);
          setDone(true);
          setCurrent("");
          setNext("");
        }
      }}
    >
      <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      {note && <div className="acct-note">{note}</div>}
      <div className="btns">
        <button className="btn gold">Save password</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
