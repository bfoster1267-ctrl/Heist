// The player's profile: career stats and trackers, the Wardrobe, the cosmetics shop, leaderboards, and their account.

import { type RoleId } from "@heist/engine";
import { date, num, t, tEn, tNodes, type TKey } from "../i18n";
import { cosName, rankLabel, rankTitle, roleShort } from "../i18n/data";
import {
  COSMETICS, DAILY_CHIPS, MAX_LEVEL, RANKED_LEVEL, cosmetic, levelInfo, owns, prestigeCoins, prestigeName, rankOf, rankedPublic, rarityOf, unlocked, winRate,
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
      <motion.div className="acct-panel" initial={{ y: 30, scale: 0.98 }} animate={{ y: 0, scale: 1 }} role="dialog" aria-label={t("prof.aria")}>
        <div className="acct-topbar">
          <button className="acct-back" onClick={onClose}>
            <span aria-hidden>←</span> {t("table.lobby")}
          </button>
          <button className="acct-x" onClick={onClose} aria-label={t("prof.close")}>
            ✕
          </button>
        </div>
        <Header me={me} />
        <nav className="acct-tabs">
          {(
            [
              ["career", t("prof.tab.career")],
              ["wardrobe", t("prof.tab.wardrobe")],
              ["season", t("prof.tab.season")],
              ["shop", t("prof.tab.shop")],
              ["board", t("prof.tab.board")],
              ...(friends || tab === "friends" ? [["friends", t("prof.tab.friends")] as [Tab, string]] : []),
              ["account", me.guest ? t("signin.signIn") : t("prof.tab.account")],
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
          {t("prof.level", { n: li.level })} · {rankTitle(li.level)}
          {cosmetic(p.equipped.title)?.text ? ` · “${tEn(cosmetic(p.equipped.title)!.text)}”` : ""}
        </div>
        <XpBar xp={p.xp} />
        <NextUnlock level={li.level} prestige={p.prestige} />
      </div>
      <div className="acct-head-wallet">
        <Chips amount={p.chips} />
        <Coins amount={p.coins} big />
        {canPrestige && (
          <button className="btn warn" onClick={() => setConfirm(true)}>
            {t("prof.prestige")} ★
          </button>
        )}
      </div>
      <AnimatePresence>
        {confirm && (
          <motion.div className="acct-confirm" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div>
              {tNodes("prof.prestigeConfirm", { name: <b>{tEn(prestigeName(p.prestige + 1))}</b>, coins: <Coins amount={prestigeCoins(p.prestige + 1)} /> })}
            </div>
            <div className="btns center">
              <button className="btn ghost" onClick={() => setConfirm(false)}>
                {t("prof.notYet")}
              </button>
              <button className="btn warn" onClick={doPrestige}>
                {t("prof.prestige")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const roleName = (r: string) => roleShort(r as RoleId);

function Career({ me }: { me: Me }) {
  const level = levelInfo(me.progress.xp).level;
  return (
    <CareerView
      stats={me.progress.stats}
      drinksSent={me.progress.drinksSent}
      ranked={rankedPublic(me.progress.ranked, Date.now())}
      rankedNote={me.guest ? t("prof.rankedGuest") : level < RANKED_LEVEL ? t("prof.rankedAt", { n: RANKED_LEVEL }) : t("prof.rankedWhere")}
    />
  );
}

/** Ranked at a glance: rank, points, MMR and this season's record. Nothing about it is hidden. */
function RankedBox({ r, note }: { r: RankedPublic | null; note?: string }) {
  if (!r)
    return (
      <div className="acct-ranked none">
        <span className="acct-ranked-label">{t("prof.ranked")}</span>
        <span className="dim">{note ?? t("prof.noRanked")}</span>
      </div>
    );
  const rank = rankOf(r.rp);
  return (
    <div className={`acct-ranked tier-${r.tier}`}>
      <span className="acct-ranked-label">{t("prof.ranked")}</span>
      <b className="acct-ranked-rank">{rankLabel(r.label)}</b>
      <span>
        {num(r.rp)} RP{r.games && rank.of ? ` · ${t("prof.toNext", { into: rank.into, of: rank.of })}` : ""}
      </span>
      <span>MMR {num(r.mmr)}</span>
      <span className="dim">
        {t("prof.rankedRecord", { games: r.games, wins: r.wins, peak: rankLabel(r.peak) })}
        {r.last ? ` · ${rankLabel(r.last)}` : ""}
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
          <div className="acct-empty-big">{t("prof.noGames")}</div>
          {t("prof.noGamesText")}
        </div>
      </>
    );
  const W = t("prof.w"), L = t("prof.l");
  const tiles: [string, string, string?][] = [
    [t("prof.games"), num(s.games)],
    [t("prof.wins"), num(s.wins), "good"],
    [t("prof.losses"), num(s.losses), "bad"],
    [t("prof.winRate"), pct(winRate(s)), "good"],
    [t("prof.lossRate"), pct(s.losses / s.games), "bad"],
    [t("prof.winnings"), num(s.winnings), "gold"],
    [t("prof.buyIns"), num(s.lost)],
    [t("prof.net"), (net >= 0 ? "+" : "") + num(net), net >= 0 ? "good" : "bad"],
    [t("prof.biggestPot"), num(s.biggestPot), "gold"],
    [t("prof.streak"), s.streak > 0 ? `${s.streak}${W}` : s.streak < 0 ? `${-s.streak}${L}` : "–", s.streak > 0 ? "good" : s.streak < 0 ? "bad" : undefined],
    [t("prof.bestStreak"), `${s.bestStreak}${W}`],
    [t("prof.drinks"), num(drinksSent)],
  ];
  const trackers: [string, number][] = [
    [t("prof.tr.footholds"), s.footholds],
    [t("prof.tr.jobsLed"), s.jobsLed],
    [t("prof.tr.jobsWon"), s.jobsWon],
    [t("prof.tr.defenses"), s.defenses],
    [t("prof.tr.doubleCrosses"), s.doubleCrosses],
    [t("prof.tr.loot"), s.loot],
    [t("prof.tr.busts"), s.bustsWon],
    [t("prof.tr.bets"), s.betsWon],
    [t("prof.tr.quits"), s.quits],
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
          <h3>{t("prof.trackers")}</h3>
          <div className="acct-trackers">
            {trackers.map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{num(v)}</b>
              </div>
            ))}
          </div>
          <h3>{t("prof.byTable")}</h3>
          <Bars rows={[[t("prof.vsBots"), s.byMode.bots], [t("prof.online"), s.byMode.online], ...[3, 4, 5, 6].map((n) => [t("prof.nPlayers", { n }), s.byPlayers[n] ?? { g: 0, w: 0 }] as [string, { g: number; w: number }])]} />
        </section>
        <section>
          <h3>{t("prof.byRole")}</h3>
          {roles.length ? <Bars rows={roles.map(([r, v]) => [roleName(r), v])} /> : <div className="dim">{t("prof.rolesLater")}</div>}
          <h3>{t("prof.recent")}</h3>
          {s.recent.length > 1 && <Trend games={s.recent} />}
          <div className="acct-recent">
            {s.recent.map((g, i) => (
              <div key={i} className={g.won ? "won" : "lost"}>
                <span className="acct-recent-wl">{g.quit ? t("prof.quit") : g.won ? t("prof.win") : t("prof.loss")}</span>
                <span>
                  {t(g.mode === "online" ? "prof.recentOnline" : "prof.recentBots", { n: g.players })}
                  {g.role ? ` · ${roleName(g.role)}` : ""}
                </span>
                <span className={g.net >= 0 ? "good" : "bad"}>{(g.net >= 0 ? "+" : "") + num(g.net)}</span>
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
          {t("prof.trend", { n: games.length, avg: (avg >= 0 ? "+" : "") + num(avg) })}
        </span>
        <b className={end >= 0 ? "good" : "bad"}>{t("common.chips", { n: (end >= 0 ? "+" : "") + num(end) })}</b>
      </div>
    </div>
  );
}

function ago(at: number) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (m < 1) return t("ago.now");
  if (m < 60) return t("ago.m", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("ago.h", { n: h });
  const d = Math.round(h / 24);
  return d < 30 ? t("ago.d", { n: d }) : date(at);
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
const SLOTS: [EquipSlot, TKey][] = [
  ["cardBack", "shop.cardBack"],
  ["frame", "shop.frame"],
  ["felt", "shop.felt"],
  ["title", "shop.title"],
  ["cigar", "shop.cigar"],
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
    c.unlock?.prestige ? tEn(prestigeName(c.unlock.prestige)) : c.unlock?.level ? t("prof.level", { n: c.unlock.level }) : "";
  return (
    <div className="acct-shop">
      <div className="acct-shop-top">
        <Coins amount={p.coins} big />
        <span className="dim">{t("shop.earn")}</span>
      </div>
      {SLOTS.map(([slot, label]) => (
        <section key={slot}>
          <h3>{t(label)}</h3>
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
                  <div className="acct-item-name">{cosName(c)}</div>
                  <RarityBadge rarity={rarity} />
                  {on ? (
                    <div className="acct-item-tag">{t("shop.equipped")}</div>
                  ) : have ? (
                    <button className="btn small gold" disabled={busy === c.id} onClick={() => run(c.id, "equip")}>
                      {t("shop.equip")}
                    </button>
                  ) : !open ? (
                    <div className="acct-item-lock">🔒 {lockText(c)}</div>
                  ) : (
                    <button className="btn small primary" disabled={busy === c.id || p.coins < c.price} onClick={() => run(c.id, "buy")}>
                      <span className="acct-coin" /> {num(c.price)}
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
        <div className="acct-empty-big">{t("lb.offline")}</div>
        {t("lb.offlineText")}
      </div>
    );
  return (
    <div className="acct-board">
      <div className="seg">
        {(["winnings", "level", "wins", "ranked"] as const).map((k) => (
          <button key={k} className={by === k ? "on" : ""} onClick={() => setBy(k)}>
            {k === "winnings" ? t("prof.winnings") : k === "level" ? t("lb.level") : k === "wins" ? t("prof.wins") : t("prof.ranked")}
          </button>
        ))}
      </div>
      {!rows ? (
        <div className="dim">{t("common.loading")}</div>
      ) : !rows.length ? (
        <div className="dim">{by === "ranked" ? t("lb.emptyRanked") : t("lb.empty")}</div>
      ) : (
        <ol className="acct-board-rows">
          {rows.map((r, i) => (
            <li key={r.id} className={r.id === me.id ? "me" : ""} role="button" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(r.id)}>
              <span className="acct-board-rank">{i + 1}</span>
              <Avatar name={r.name} frame={r.frame} level={r.level} size={34} />
              <span className="acct-board-name">
                {r.name} <Stars prestige={r.prestige} size={10} />
              </span>
              <span className="acct-board-v">{by === "winnings" ? num(r.winnings) : by === "level" ? t("rw.lv", { n: r.level }) : by === "ranked" ? `${rankLabel(r.rank)} · ${num(r.rp ?? 0)} RP · MMR ${num(r.mmr ?? 0)}` : t("lb.wins", { count: r.wins })}</span>
            </li>
          ))}
        </ol>
      )}
      {rows && rows.length > 0 && !rows.some((r) => r.id === me.id) && (
        <div className="dim acct-board-you">{me.guest ? t("lb.guest") : me.progress.stats.games ? t("lb.notTop") : t("lb.playOne")}</div>
      )}
      <AnimatePresence>{open && <PlayerCard id={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

/** The next cosmetic the player's level (or prestige) will open up, to aim for. */
function NextUnlock({ level, prestige }: { level: number; prestige: number }) {
  const slotName: Partial<Record<Slot, string>> = { felt: t("slot.felt"), cardBack: t("slot.cardBack"), frame: t("slot.frame"), title: t("slot.title") };
  const next =
    prestige === 0
      ? COSMETICS.filter((c) => c.unlock?.level !== undefined && c.unlock.prestige === undefined && c.unlock.level > level).sort((a, b) => a.unlock!.level! - b.unlock!.level!)[0]
      : undefined;
  const nextP = next ? undefined : COSMETICS.filter((c) => c.unlock?.prestige !== undefined && c.unlock.prestige > prestige).sort((a, b) => a.unlock!.prestige! - b.unlock!.prestige!)[0];
  const c = next ?? nextP;
  if (!c) return null;
  return (
    <div className="acct-next">
      {t("prof.next", { name: cosName(c), slot: slotName[c.slot] ?? "", at: next ? t("prof.levelLower", { n: c.unlock!.level! }) : tEn(prestigeName(c.unlock!.prestige!)) })}
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
    backend?.player(id).then(setP, (e) => setErr(e instanceof Error ? tEn(e.message) : t("prof.loadErr")));
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
      <motion.div className="acct-card acct-card-full" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, opacity: 0 }} role="dialog" aria-label={t("prof.card")}>
        <button className="acct-x acct-card-x" onClick={onClose} aria-label={t("prof.closeCard")}>
          ✕
        </button>
        {err ? (
          <div className="dim">{err}</div>
        ) : !p || !s ? (
          <div className="dim">{t("common.loading")}</div>
        ) : (
          <>
            <div className="acct-card-head" style={bannerStyle(p.equipped.banner)}>
              <Avatar name={p.name} frame={p.equipped.frame} level={p.level} size={56} />
              <div>
                <div className="acct-card-name">
                  {p.name} <Stars prestige={p.prestige} size={12} />
                </div>
                <div className="dim">
                  {t("prof.level", { n: p.level })} · {tEn(p.rank)}
                  {title?.text ? ` · ${tEn(title.text)}` : ""}
                </div>
                <div className="dim acct-card-joined">{t("prof.since", { when: date(p.joined, { month: "short", year: "numeric" }) })}</div>
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
          {t(me.email ? "acc.signedAs" : "acc.signed", { email: me.email ?? "", with: me.logins.map((l) => (l === "email" ? t("signin.email") : l[0].toUpperCase() + l.slice(1))).join(", ") })}
        </div>
      )}
      <label className="field">
        <span>{t("signin.displayName")}</span>
        <div className="btns">
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button className="btn gold" disabled={!name.trim() || name === me.name} onClick={() => act((b) => b.rename(name))}>
            {t("common.save")}
          </button>
        </div>
      </label>
      {!me.guest && me.logins.includes("email") && <ChangePassword />}
      <div className="btns wrap">
        <button className="btn" disabled={p.dailyDay === today} onClick={() => act((b) => b.daily())}>
          {p.dailyDay === today ? t("acc.dailyDone") : t("acc.daily", { n: DAILY_CHIPS })}
        </button>
        {!me.guest && (
          <button className="btn ghost" onClick={() => act((b) => b.signOut())}>
            {t("acc.signOut")}
          </button>
        )}
      </div>
      <div className="acct-danger">
        {sure ? (
          <>
            <span>{backend?.kind === "server" ? t("acc.deleteSure") : t("acc.wipeSure")}</span>
            <button className="btn ghost small" onClick={() => setSure(false)}>
              {t("acc.keep")}
            </button>
            <button
              className="btn danger small"
              onClick={async () => {
                setSure(false);
                await act((b) => b.deleteAccount());
              }}
            >
              {t("acc.delete")}
            </button>
          </>
        ) : (
          <button className="btn ghost small" onClick={() => setSure(true)}>
            {me.guest && backend?.kind !== "server" ? t("acc.reset") : t("acc.deleteAccount")}
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
        {done ? t("acc.pwChanged") : t("acc.changePw")}
      </button>
    );
  return (
    <form
      className="acct-email"
      onSubmit={async (e) => {
        e.preventDefault();
        setNote(null);
        const ok = await act((b) => b.changePassword(current, next), { inline: true }).catch((err: Error) => (setNote(tEn(err.message)), null));
        if (ok) {
          setOpen(false);
          setDone(true);
          setCurrent("");
          setNext("");
        }
      }}
    >
      <input type="password" autoComplete="current-password" placeholder={t("acc.currentPw")} value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <input type="password" autoComplete="new-password" placeholder={t("acc.newPw")} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      {note && <div className="acct-note">{note}</div>}
      <div className="btns">
        <button className="btn gold">{t("acc.savePw")}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}

        </button>
      </div>
    </form>
  );
}
