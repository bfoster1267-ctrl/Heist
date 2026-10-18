// The player's profile: career stats and trackers, the Wardrobe, the cosmetics shop, leaderboards, and their account.

import { ROLES, type RoleId } from "@heist/engine";
import {
  COSMETICS, DAILY_CHIPS, MAX_LEVEL, RANKED_LEVEL, cosmetic, levelInfo, owns, prestigeCoins, prestigeName, rankName, rankOf, rankedPublic, rarityOf, unlocked, winRate,
  type CareerStats, type Cosmetic, type EquipSlot, type RankedPublic, type Slot,
} from "@heist/profile";
import { Cigar, Preview, RarityBadge, bannerStyle } from "./items";
import { Season } from "./Season";
import { Wardrobe } from "./Wardrobe";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Chips } from "../table/pieces";
import { Avatar, Coins, Stars, XpBar } from "./bits";
import type { LeaderRow, Me } from "./backend";
import type { PublicProfile } from "@heist/profile";
import { SignIn } from "./SignIn";
import { useAccount } from "./useAccount";
import { AddFriendButton, Friends } from "./Friends";
import { badgeCount, useFriends } from "./social";
import { t } from "../i18n";
import { COIN_BUNDLES, HEIST_PRO_STRIPE_URL, useHeistPro } from "./pro";

type Tab = "career" | "wardrobe" | "season" | "shop" | "board" | "friends" | "account";

export function Profile({ onClose, tab: start = "career", chat }: { onClose: () => void; tab?: Tab; /** a friend's chat to open on the Friends tab */ chat?: string | null }) {
  const { me } = useAccount();
  const [tab, setTab] = useState<Tab>(start);
  const friends = useFriends();
  const waiting = badgeCount(friends);
  // a player card opened from the friends list
  const [card, setCard] = useState<string | null>(null);
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
      <motion.div className="acct-panel" initial={{ y: 30, scale: 0.98 }} animate={{ y: 0, scale: 1 }} role="dialog" aria-label={t("profile.title")}>
        <div className="acct-topbar">
          <button className="acct-back" onClick={onClose}>
            <span aria-hidden>←</span> {t("common.back")}
          </button>
          <button className="acct-x" onClick={onClose} aria-label={t("profile.close")}>
            ✕
          </button>
        </div>
        <Header me={me} />
        <nav className="acct-tabs">
          {(
            [
              ["career", t("profile.tab.career")],
              ["wardrobe", t("profile.tab.wardrobe")],
              ["season", t("profile.tab.season")],
              ["shop", t("profile.tab.shop")],
              ["board", t("profile.tab.board")],
              ...(friends || tab === "friends" ? [["friends", t("profile.tab.friends")] as [Tab, string]] : []),
              ["account", me.guest ? t("profile.tab.signin") : t("profile.tab.account")],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
              {k === "friends" && waiting > 0 && <span className="fr-badge tab">{waiting}</span>}
            </button>
          ))}
        </nav>
        <div className="acct-body">
          {tab === "career" && <Career me={me} />}
          {tab === "wardrobe" && <Wardrobe me={me} onGo={setTab} />}
          {tab === "season" && <Season me={me} onWardrobe={() => setTab("wardrobe")} />}
          {tab === "shop" && <Shop me={me} />}
          {tab === "board" && <Board me={me} />}
          {tab === "friends" && <Friends meId={me.id} chat={chat} onPlayer={setCard} />}
          {tab === "account" && <Account me={me} />}
        </div>
        <AnimatePresence>{card && <PlayerCard id={card} onClose={() => setCard(null)} />}</AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function Header({ me }: { me: Me }) {
  const { act, showReward } = useAccount();
  const isPro = useHeistPro();
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
          {me.name} {isPro && <span className="profile-vip-tag">👑 VIP</span>} <Stars prestige={p.prestige} />
        </div>
        <div className="acct-head-rank">
          {t("profile.level", { level: li.level })} · {rankLabel(li.level)}
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
            {t("profile.prestige")}
          </button>
        )}
      </div>
      <AnimatePresence>
        {confirm && (
          <motion.div className="acct-confirm" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div>
              {t("profile.prestige_confirm", {
                prestige: prestigeLabel(p.prestige + 1),
                coins: String(prestigeCoins(p.prestige + 1)),
              })}
            </div>
            <div className="btns center">
              <button className="btn ghost" onClick={() => setConfirm(false)}>
                {t("profile.not_yet")}
              </button>
              <button className="btn warn" onClick={doPrestige}>
                {t("profile.prestige")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

const ROMAN_NUMS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const prestigeLabel = (p: number) => (p > 0 ? `${t("profile.prestige_label")} ${ROMAN_NUMS[Math.min(p, 10)]}` : "");

const rankKey = (level: number) => {
  if (level >= 50) return "rank.legend";
  if (level >= 45) return "rank.godfather";
  if (level >= 40) return "rank.kingpin";
  if (level >= 35) return "rank.underboss";
  if (level >= 30) return "rank.lieutenant";
  if (level >= 25) return "rank.enforcer";
  if (level >= 20) return "rank.con_artist";
  if (level >= 15) return "rank.cracksman";
  if (level >= 10) return "rank.wheelman";
  if (level >= 5) return "rank.runner";
  return "rank.rookie";
};
export const rankLabel = (level: number) => t(rankKey(level)) || rankName(level);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const roleName = (r: string) => t("role." + r) || (ROLES.find((x) => x.id === r)?.name.replace(/^The /, "") ?? r);

function Career({ me }: { me: Me }) {
  const level = levelInfo(me.progress.xp).level;
  return (
    <CareerView
      stats={me.progress.stats}
      drinksSent={me.progress.drinksSent}
      ranked={rankedPublic(me.progress.ranked, Date.now())}
      rankedNote={me.guest ? t("career.ranked_guest") : level < RANKED_LEVEL ? t("career.ranked_unlocks", { level: RANKED_LEVEL }) : t("career.ranked_play")}
    />
  );
}

/** Ranked at a glance: rank, points, MMR and this season's record. Nothing about it is hidden. */
function RankedBox({ r, note }: { r: RankedPublic | null; note?: string }) {
  if (!r)
    return (
      <div className="acct-ranked none">
        <span className="acct-ranked-label">{t("career.ranked_title")}</span>
        <span className="dim">{note ?? t("career.ranked_empty")}</span>
      </div>
    );
  const rank = rankOf(r.rp);
  return (
    <div className={`acct-ranked tier-${r.tier}`}>
      <span className="acct-ranked-label">{t("career.ranked_title")}</span>
      <b className="acct-ranked-rank">{r.label}</b>
      <span>
        {r.rp.toLocaleString()} RP{r.games && rank.of ? ` · ${rank.into}/${rank.of} to the next` : ""}
      </span>
      <span>MMR {r.mmr.toLocaleString()}</span>
      <span className="dim">
        {t("career.ranked_record", { games: r.games, wins: r.wins, peak: r.peak })}
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
          <div className="acct-empty-big">{t("career.empty_title")}</div>
          {t("career.empty_desc")}
        </div>
      </>
    );
  const tiles: [string, string, string?][] = [
    [t("career.games"), s.games.toLocaleString()],
    [t("career.wins"), s.wins.toLocaleString(), "good"],
    [t("career.losses"), s.losses.toLocaleString(), "bad"],
    [t("career.win_rate"), pct(winRate(s)), "good"],
    [t("career.loss_rate"), pct(s.losses / s.games), "bad"],
    [t("career.winnings"), s.winnings.toLocaleString(), "gold"],
    [t("career.lost_buyins"), s.lost.toLocaleString()],
    [t("career.net"), (net >= 0 ? "+" : "") + net.toLocaleString(), net >= 0 ? "good" : "bad"],
    [t("career.biggest_pot"), s.biggestPot.toLocaleString(), "gold"],
    [t("career.streak"), s.streak > 0 ? `${s.streak}W` : s.streak < 0 ? `${-s.streak}L` : "–", s.streak > 0 ? "good" : s.streak < 0 ? "bad" : undefined],
    [t("career.best_streak"), `${s.bestStreak}W`],
    [t("career.drinks_sent"), drinksSent.toLocaleString()],
  ];
  const trackers: [string, number][] = [
    [t("career.footholds"), s.footholds],
    [t("career.jobs_led"), s.jobsLed],
    [t("career.jobs_won"), s.jobsWon],
    [t("career.defenses"), s.defenses],
    [t("career.double_crosses"), s.doubleCrosses],
    [t("career.loot"), s.loot],
    [t("career.busts_won"), s.bustsWon],
    [t("career.bets_won"), s.betsWon],
    [t("career.quits"), s.quits],
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
          <h3>{t("career.trackers")}</h3>
          <div className="acct-trackers">
            {trackers.map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{v.toLocaleString()}</b>
              </div>
            ))}
          </div>
          <h3>{t("career.by_table")}</h3>
          <Bars rows={[[t("career.vs_bots"), s.byMode.bots], [t("career.online"), s.byMode.online], ...[3, 4, 5, 6].map((n) => [t("career.players_count", { n }), s.byPlayers[n] ?? { g: 0, w: 0 }] as [string, { g: number; w: number }])]} />
        </section>
        <section>
          <h3>{t("career.by_role")}</h3>
          {roles.length ? <Bars rows={roles.map(([r, v]) => [roleName(r), v])} /> : <div className="dim">{t("career.roles_empty")}</div>}
          <h3>{t("career.recent_games")}</h3>
          {s.recent.length > 1 && <Trend games={s.recent} />}
          <div className="acct-recent">
            {s.recent.map((g, i) => (
              <div key={i} className={g.won ? "won" : "lost"}>
                <span className="acct-recent-wl">{g.quit ? t("career.quit") : g.won ? t("career.win") : t("career.loss")}</span>
                <span>
                  {t("career.players_count", { n: g.players })} {g.mode === "online" ? t("career.online") : t("career.vs_bots")}
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
          {t("career.last_games", {
            count: games.length,
            avg: (avg >= 0 ? "+" : "") + avg.toLocaleString(),
          })}
        </span>
        <b className={end >= 0 ? "good" : "bad"}>
          {t("career.chips_count", {
            chips: (end >= 0 ? "+" : "") + end.toLocaleString(),
          })}
        </b>
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
  ["cardBack", "shop.decks"],
  ["frame", "shop.frames"],
  ["felt", "shop.felt"],
  ["title", "shop.titles"],
  ["cigar", "shop.cigar"],
];

function Shop({ me }: { me: Me }) {
  const { act } = useAccount();
  const p = me.progress;
  const li = levelInfo(p.xp);
  const pro = useHeistPro();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, f: "buy" | "equip") => {
    setBusy(id);
    await act((b) => (f === "buy" ? b.buy(id) : b.equip(id)));
    setBusy(null);
  };
  const lockText = (c: Cosmetic) =>
    c.unlock?.prestige ? t("shop.locked_prestige", { name: prestigeLabel(c.unlock.prestige) }) : c.unlock?.level ? t("shop.locked_level", { level: c.unlock.level }) : "";
  return (
    <div className="acct-shop">
      <div className="acct-pro-hero">
        <div className="acct-pro-hero-left">
          <div className="acct-pro-pill">👑 VIP Founder Pass</div>
          <div className="acct-pro-title">VIP Founder Pass</div>
          <div className="acct-pro-sub">
            Streak Shield Protection · Gold Table Crown · Ad-Free Forever · Founder Roadmap Priority
          </div>
        </div>
        <div className="acct-pro-hero-right">
          <span className="acct-pro-hero-price">$4.99</span>
          {pro ? (
            <span className="acct-pro-active-badge">✓ VIP Active</span>
          ) : (
            <a
              href={HEIST_PRO_STRIPE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn small gold"
              aria-label="Unlock VIP Founder Pass on Stripe (opens in new tab)"
              style={{ fontWeight: 800, padding: "8px 18px", textDecoration: "none" }}
            >
              Unlock VIP
            </a>
          )}
        </div>
      </div>
      <div className="acct-shop-top">
        <Coins amount={p.coins} big />
        <span className="dim">{t("shop.coins_desc")}</span>
      </div>

      <section className="acct-bundles-section">
        <div className="acct-bundles-header">
          <h3>💰 Coin & Chip Stashes</h3>
          <span className="dim">Boost your vault or grab exclusive table gear</span>
        </div>
        <div className="acct-bundles-grid">
          {COIN_BUNDLES.map((b) => (
            <div key={b.id} className="acct-bundle-card">
              {b.badge && <span className="acct-bundle-badge">{b.badge}</span>}
              <div className="acct-bundle-name">{b.name}</div>
              <div className="acct-bundle-payout">
                <span className="acct-bundle-coin">🪙 +{b.coins.toLocaleString()} Coins</span>
                <span className="acct-bundle-chip">🎰 +{b.chips.toLocaleString()} Chips</span>
              </div>
              {b.stripeUrl ? (
                <a
                  href={b.stripeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn small gold acct-bundle-btn"
                  aria-label={`Get ${b.name} for ${b.price} on Stripe`}
                >
                  Get for {b.price}
                </a>
              ) : (
                <button
                  type="button"
                  className="btn small acct-bundle-btn"
                  disabled
                  aria-disabled="true"
                  title="Coming soon - waiting for dedicated Stripe checkout link"
                >
                  Coming Soon ({b.price})
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      {SLOTS.map(([slot, labelKey]) => (
        <section key={slot}>
          <h3>{t(labelKey)}</h3>
          <div className="acct-items">
            {COSMETICS.filter((c) => c.slot === slot).map((c) => {
              const have = owns(p, c.id);
              const on = p.equipped[slot] === c.id;
              const open = unlocked(c, li.level, p.prestige);
              const rarity = rarityOf(c);
              return (
                <motion.div
                  key={c.id}
                  className={"acct-item" + (on ? " on" : "") + (!open ? " locked" : "")}
                  data-rarity={rarity}
                  layout
                  whileHover={{ y: -3 }}
                >
                  <Preview c={c} name={me.name} />
                  <div className="acct-item-name">{c.name}</div>
                  <RarityBadge rarity={rarity} />
                  {on ? (
                    <div className="acct-item-tag">{t("shop.equipped")}</div>
                  ) : have ? (
                    <button className="btn small gold" disabled={busy === c.id} onClick={() => run(c.id, "equip")}>
                      {t("shop.equip")}
                    </button>
                  ) : !open ? (
                    <div className="acct-item-lock">{lockText(c)}</div>
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
  const isPro = useHeistPro();
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
        <div className="acct-empty-big">{t("board.empty_online")}</div>
        {t("board.empty_desc")}
      </div>
    );
  return (
    <div className="acct-board">
      <div className="seg">
        {(["winnings", "level", "wins", "ranked"] as const).map((k) => (
          <button key={k} className={by === k ? "on" : ""} onClick={() => setBy(k)}>
            {k === "winnings" ? t("board.winnings") : k === "level" ? t("board.level") : k === "wins" ? t("board.wins") : t("board.ranked")}
          </button>
        ))}
      </div>
      {!rows ? (
        <div className="dim">{t("common.loading") || "Loading…"}</div>
      ) : !rows.length ? (
        <div className="dim">{by === "ranked" ? t("board.no_ranked") : t("board.nobody")}</div>
      ) : (
        <ol className="acct-board-rows">
          {rows.map((r, i) => (
            <li key={r.id} className={r.id === me.id ? "me" : ""} role="button" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(r.id)}>
              <span className="acct-board-rank">{i + 1}</span>
              <Avatar name={r.name} frame={r.frame} level={r.level} size={34} />
              <span className="acct-board-name">
                {r.name} {(r.vip || (r.id === me.id && isPro)) && <span className="profile-vip-tag">👑 VIP</span>} <Stars prestige={r.prestige} size={10} />
              </span>
              <span className="acct-board-v">
                {by === "winnings"
                  ? r.winnings.toLocaleString()
                  : by === "level"
                  ? `Lv ${r.level}`
                  : by === "ranked"
                  ? `${r.rank} · ${r.rp?.toLocaleString()} RP · MMR ${r.mmr}`
                  : `${r.wins} ${t("board.wins").toLowerCase()}`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {rows && rows.length > 0 && !rows.some((r) => r.id === me.id) && (
        <div className="dim acct-board-you">
          {me.guest ? t("board.guests_unranked") : me.progress.stats.games ? t("board.not_top_100") : t("board.play_to_rank")}
        </div>
      )}
      <AnimatePresence>{open && <PlayerCard id={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

/** The next cosmetic the player's level (or prestige) will open up, to aim for. */
function NextUnlock({ level, prestige }: { level: number; prestige: number }) {
  const slotName: Partial<Record<Slot, string>> = {
    felt: t("wardrobe.cat.felt"),
    cardBack: t("wardrobe.cat.cardBack"),
    frame: t("wardrobe.cat.frame"),
    title: t("wardrobe.cat.title"),
  };
  const next =
    prestige === 0
      ? COSMETICS.filter((c) => c.unlock?.level !== undefined && c.unlock.prestige === undefined && c.unlock.level > level).sort((a, b) => a.unlock!.level! - b.unlock!.level!)[0]
      : undefined;
  const nextP = next ? undefined : COSMETICS.filter((c) => c.unlock?.prestige !== undefined && c.unlock.prestige > prestige).sort((a, b) => a.unlock!.prestige! - b.unlock!.prestige!)[0];
  const c = next ?? nextP;
  if (!c) return null;
  return (
    <div className="acct-next">
      {t("profile.next_unlock", {
        name: c.name,
        slot: slotName[c.slot] ?? c.slot,
        at: next ? `${t("profile.level", { level: c.unlock!.level! })}` : prestigeLabel(c.unlock!.prestige!),
      })}
    </div>
  );
}

/** A player's profile, opened from the leaderboard or by tapping their name at a table: everything you see on your own. */
export function PlayerCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { backend, me } = useAccount();
  const friends = useFriends();
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
      <motion.div className="acct-card acct-card-full" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, opacity: 0 }} role="dialog" aria-label={t("profile.title")}>
        <button className="acct-x acct-card-x" onClick={onClose} aria-label={t("profile.close")}>
          ✕
        </button>
        {err ? (
          <div className="dim">{err}</div>
        ) : !p || !s ? (
          <div className="dim">{t("common.loading") || "Loading…"}</div>
        ) : (
          <>
            <div className="acct-card-head" style={bannerStyle(p.equipped.banner)}>
              <Avatar name={p.name} frame={p.equipped.frame} level={p.level} size={56} />
              <div>
                <div className="acct-card-name">
                  {p.name} <Stars prestige={p.prestige} size={12} />
                </div>
                <div className="dim">
                  {t("profile.level", { level: p.level })} · {rankLabel(p.level)}
                  {title?.text ? ` · ${title.text}` : ""}
                </div>
                <div className="dim acct-card-joined">
                  {t("profile.playing_since", {
                    date: new Date(p.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
                  })}
                </div>
                {friends && me && me.id !== id && (
                  <div className="acct-card-friend">
                    <AddFriendButton id={id} small />
                  </div>
                )}
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
          {t("account.signed_in", {
            email: me.email ? ` ${me.email}` : "",
            providers: me.logins.map((l) => (l === "email" ? "email" : l[0].toUpperCase() + l.slice(1))).join(", "),
          })}
        </div>
      )}
      <label className="field">
        <span>{t("account.display_name")}</span>
        <div className="btns">
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button className="btn gold" disabled={!name.trim() || name === me.name} onClick={() => act((b) => b.rename(name))}>
            {t("account.save")}
          </button>
        </div>
      </label>
      {!me.guest && me.logins.includes("email") && <ChangePassword />}
      <div className="btns wrap">
        <button className="btn" disabled={p.dailyDay === today} onClick={() => act((b) => b.daily())}>
          {p.dailyDay === today ? t("account.daily_chips_done") : t("account.collect_daily", { amount: DAILY_CHIPS.toLocaleString() })}
        </button>
        {!me.guest && (
          <button className="btn ghost" onClick={() => act((b) => b.signOut())}>
            {t("account.sign_out")}
          </button>
        )}
      </div>
      <div className="acct-danger">
        {sure ? (
          <>
            <span>{backend?.kind === "server" ? t("account.delete_confirm_server") : t("account.delete_confirm_local")}</span>
            <button className="btn ghost small" onClick={() => setSure(false)}>
              {t("account.keep_it")}
            </button>
            <button
              className="btn danger small"
              onClick={async () => {
                setSure(false);
                await act((b) => b.deleteAccount());
              }}
            >
              {t("account.delete_account")}
            </button>
          </>
        ) : (
          <button className="btn ghost small" onClick={() => setSure(true)}>
            {me.guest && backend?.kind !== "server" ? t("account.reset_career") : t("account.delete_account")}
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
        {done ? t("account.password_changed") : t("account.change_password")}
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
      <input type="password" autoComplete="current-password" placeholder={t("account.current_password")} value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <input type="password" autoComplete="new-password" placeholder={t("account.new_password")} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      {note && <div className="acct-note">{note}</div>}
      <div className="btns">
        <button className="btn gold">{t("account.save_password")}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          {t("account.cancel")}
        </button>
      </div>
    </form>
  );
}
