import { CREWS } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { LESSONS, STAGES, cosmetic, lesson, lessonNo, passTrack, seasonAt, type Progress } from "@heist/profile";
import { CrewBadge } from "./table/pieces";
import { createPortal } from "react-dom";
import { isStandalone } from "./appShell";
import { onCrazyGames } from "./crazygames";
import { setPrefs, usePrefs } from "./prefs";
import { REFILL_TO, STAKES } from "./wallet";
import { ChallengeBanner } from "./daily/ChallengeBanner";
import { MobileInstallModal, isMobileDevice } from "./arcade/MobileInstallModal";
import { t, useLanguage } from "./i18n";
import { click } from "./sound";
import { buzz } from "./haptics";
import { isHeistPro, onProChange } from "./account/pro";

const Campaign = lazy(() => import("./Campaign").then((m) => ({ default: m.Campaign })));
const ArcadeHub = lazy(() => import("./arcade/ArcadeHub").then((m) => ({ default: m.ArcadeHub })));
const Rules = lazy(() => import("./table/Rules").then((m) => ({ default: m.Rules })));
const Settings = lazy(() => import("./table/Settings").then((m) => ({ default: m.Settings })));

const FLOAT_POS = [
  { left: "6%", top: "12%" },
  { left: "10%", top: "48%" },
  { left: "5%", top: "80%" },
  { right: "6%", top: "14%" },
  { right: "10%", top: "50%" },
  { right: "5%", top: "78%" },
];

export interface LobbyChoice {
  players: number;
  name: string;
  stakes: number;
  /** a campaign stage (sets the table; no buy-in) */
  campaign?: number;
  /** Coached play: a real game vs bots with a coach; free, small XP, not in the career */
  coached?: boolean;
}

/** the player's own screens, the tabs behind the player card */
export type LobbyPage = "career" | "wardrobe" | "season" | "shop" | "board";

/**
 * The lobby tour after a new player's first hand: tap the player card (nothing else can be tapped),
 * which opens the Season pass, then pick what's next: more coaching, saving the account, or the lobby.
 */
export type TourStep = "profile" | "next";

export function Lobby({
  chips,
  onPlay,
  onRefill,
  onOnline,
  onOpen,
  onSignIn,
  onSave,
  onSolitaire,
  onFreeCell,
  onTriPeaks,
  onErs,
  onSpider,
  onPyramid,
  onYukon,
  onScoundrel,
  onMinesweeper,
  onSudoku,
  onCheckers,
  onHearts,
  onSpades,
  defaultName,
  cleared = 0,
  newbie = false,
  nextLesson,
  tour,
  onTour,
  progress,
  onOpenDaily,
  onOpenPro,
}: {
  chips: number;
  onPlay: (c: LobbyChoice) => void;
  onRefill: () => void;
  onOnline?: (name: string) => void;
  onOpen?: (page: LobbyPage) => void;
  /** sign in to an account made before (a new player's way past the lesson) */
  onSignIn?: () => void;
  /** a guest's way to save their progress to an account (none: they have one) */
  onSave?: () => void;
  /** open Solitaire */
  onSolitaire?: () => void;
  /** open FreeCell */
  onFreeCell?: () => void;
  /** open TriPeaks */
  onTriPeaks?: () => void;
  /** open Egyptian Rat Screw */
  onErs?: () => void;
  /** open Spider Solitaire */
  onSpider?: () => void;
  /** open Pyramid Solitaire */
  onPyramid?: () => void;
  /** open Yukon Solitaire */
  onYukon?: () => void;
  /** open Scoundrel */
  onScoundrel?: () => void;
  /** open Minesweeper */
  onMinesweeper?: () => void;
  /** open Sudoku */
  onSudoku?: () => void;
  /** open Checkers vs bot */
  onCheckers?: () => void;
  /** open Hearts vs bots */
  onHearts?: () => void;
  /** open Spades vs bots */
  onSpades?: () => void;
  defaultName?: string;
  /** campaign stages cleared */
  cleared?: number;
  /** never played a game: Learn to play leads */
  newbie?: boolean;
  /** the Coached play lesson they'd play next (none: they've done them all) */
  nextLesson?: number;
  /** the lobby tour step showing now (none: no tour) */
  tour?: TourStep | null;
  /** move the tour on (null: it's over) */
  onTour?: (step: TourStep | null) => void;
  progress?: Progress;
  onOpenDaily?: () => void;
  onOpenPro?: () => void;
}) {
  const [players, setPlayers] = useState(() => remembered("heist.players", [3, 4, 5, 6], 4));
  const [name, setName] = useState(() => {
    try {
      return defaultName || localStorage.getItem("heist.name") || "";
    } catch {
      return "";
    }
  });
  const [stake, setStake] = useState(() => remembered("heist.stake", [0, 1, 2, 3], 1));
  const [isPro, setIsPro] = useState(isHeistPro);
  useEffect(() => onProChange(setIsPro), []);
  const [rules, setRules] = useState(false);
  // How to play, once the first lesson is done: another game with the coach, or the rules
  const [learn, setLearn] = useState(false);
  const [camp, setCamp] = useState(false);
  const [games, setGames] = useState(false);
  const [settings, setSettings] = useState(false);
  const [options, setOptions] = useState(false);
  const prefs = usePrefs();
  const [lang, setLang] = useLanguage();
  // the table you picked last time, or the best one you can still afford
  const table = chips >= STAKES[stake].buyIn ? stake : Math.max(0, STAKES.filter((st) => chips >= st.buyIn).length - 1);
  const broke = chips < STAKES[0].buyIn;
  const save = () => {
    try {
      localStorage.setItem("heist.name", name);
      localStorage.setItem("heist.players", String(players));
      localStorage.setItem("heist.stake", String(stake));
    } catch {
      /* ignore */
    }
  };
  const nm = () => name.trim() || "Ace";
  const go = (i: number, campaign?: number) => {
    save();
    onPlay({ players, name: nm(), stakes: campaign ? 0 : STAKES[i].buyIn, campaign });
  };
  const coach = () => {
    save();
    onPlay({ players: 3, name: nm(), stakes: 0, coached: true });
  };
  return (
    <div className={"lobby" + (prefs.textSize > 1 ? " big-text" : "")} style={{ "--ts": prefs.textSize } as React.CSSProperties}>
      <div className="lobby-bg">
        {CREWS.map((c, i) => (
          <motion.span
            key={c.id}
            className="lobby-float"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: [0, -14, 0], opacity: 0.85 }}
            transition={{ y: { duration: 4 + i * 0.4, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 1, delay: i * 0.1 } }}
            style={FLOAT_POS[i]}
          >
            <CrewBadge color={i} size={54} />
          </motion.span>
        ))}
      </div>
      <button className="lobby-gear" onClick={() => setSettings(true)} aria-label={t("settings.title")}>
        ⚙
      </button>
      <button
        className="lobby-lang-btn"
        onClick={() => setLang(lang === "en" ? "pt-BR" : "en")}
        aria-label="Alternar idioma / Switch language"
        title={lang === "en" ? "Mudar para Português (Brasil)" : "Switch to English"}
      >
        <span className="lobby-lang-flag">{lang === "en" ? "🇧🇷" : "🇺🇸"}</span>
        <span className="lobby-lang-code">{lang === "en" ? "PT" : "EN"}</span>
      </button>
      {onOpenPro && (
        <button
          className={"lobby-pro-btn" + (isPro ? " active" : "")}
          onClick={() => {
            click();
            buzz("tap");
            onOpenPro();
          }}
          aria-label={isPro ? "VIP Founder Status Active" : "Heist VIP Founder Pass"}
          title={isPro ? "VIP Founder Status Active" : "Unlock Heist VIP Founder Pass"}
        >
          <span className="lobby-pro-icon">👑</span>
          <span className="lobby-pro-text">{isPro ? "VIP" : "PRO"}</span>
        </button>
      )}
      <div className="logo lobby-topname" aria-hidden="true">
        HEIST
      </div>
      <motion.div className="lobby-main" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="logo">HEIST</div>

        <div className="lobby-hero">
          {newbie ? (
            <>
              <button
                type="button"
                className="btn primary lobby-big"
                onClick={coach}
              >
                {t("lobby.learn_heist")}
                <span className="lobby-sub">{t("lobby.learn_heist_sub")}</span>
              </button>

              <button
                type="button"
                className="btn lobby-big"
                onClick={() => setGames(true)}
              >
                {t("lobby.play_solo_hub")}
                <span className="lobby-sub">{t("lobby.play_solo_hub_sub")}</span>
              </button>

              {onSignIn && (
                <button className="lobby-change" onClick={onSignIn}>
                  {t("lobby.have_account")}
                </button>
              )}
            </>
          ) : (
            <>
        {broke ? (
          <button className="btn primary lobby-big" onClick={onRefill}>
            {t("lobby.free_chips")}
            <span className="lobby-sub">{t("lobby.top_up")} ({REFILL_TO.toLocaleString()})</span>
          </button>
        ) : (
          <button className={"btn lobby-big" + (newbie ? "" : " primary")} onClick={() => go(table)}>
            {t("lobby.quick_play")}
            <span className="lobby-sub">
              {players} {t("table.players").toLowerCase()} · {STAKES[table].name} · {t("table.buy_in").toLowerCase()} {STAKES[table].buyIn.toLocaleString()}
            </span>
          </button>
        )}
        <button className="lobby-change" onClick={() => setOptions(true)}>
          {t("lobby.change_table")}
        </button>

        {onSave && (
          <button
            type="button"
            className="lobby-save-nudge"
            onClick={onSave}
          >
            <div className="lobby-save-nudge-left">
              <span className="lobby-save-nudge-badge">{t("lobby.save_progress_nudge")}</span>
              <span className="lobby-save-nudge-sub">{t("lobby.save_progress_sub")}</span>
            </div>
            <span className="lobby-save-nudge-arrow">➔</span>
          </button>
        )}
            </>
          )}
        </div>

        {onOpenDaily && (
          <div className="lobby-daily-wrap">
            <ChallengeBanner progress={progress} onOpenDaily={onOpenDaily} />
          </div>
        )}

        <div className="lobby-modes">
          <Mode icon="online" label={t("lobby.play_online")} sub={newbie ? t("lobby.first_lesson_sub") : t("lobby.real_people")} disabled={newbie || !onOnline} onClick={() => onOnline?.(nm())} />
          {(onSolitaire || onFreeCell || onTriPeaks || onErs || onSpider || onPyramid || onYukon || onScoundrel || onCheckers || onMinesweeper || onSudoku || onHearts || onSpades) && (
            <Mode
              icon="cards"
              label={t("lobby.solo_arcade")}
              sub={t("lobby.arcade_count_sub", { count: 13 }, `13 ${t("arcade.tab_all")} · ${t("lobby.arcade_sub")}`)}
              onClick={() => setGames(true)}
            />
          )}
          <Mode icon="map" label={t("lobby.campaign")} sub={newbie ? t("lobby.first_lesson_sub") : t("campaign.stages_count", { cleared: Math.min(cleared, STAGES.length), total: STAGES.length })} disabled={newbie} onClick={() => setCamp(true)} />
          <Mode icon="book" label={t("lobby.how_to_play")} sub={newbie ? t("lobby.the_rules") : nextLesson ? t("lobby.lesson_next", { lesson: lessonNo(nextLesson) ?? 1, total: LESSONS.length }) : t("lobby.coach_rules")} onClick={() => (newbie ? setRules(true) : setLearn(true))} />
        </div>
        <InstallHint />
        <div className="fine">
          {t("lobby.play_money")} ·{" "}
          <a className="lobby-privacy" href="./privacy.html" target="_blank" rel="noreferrer">
            {t("lobby.privacy")}
          </a>
        </div>
      </motion.div>

      <AnimatePresence>
        {options && (
          <Sheet title={t("table.your_table", "Your table")} onClose={() => setOptions(false)}>
            <label className="field">
              <span>{t("table.your_name", "Your name")}</span>
              <input value={name} maxLength={14} placeholder="Ace" onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field">
              <span>{t("table.players", "Players")}</span>
              <div className="seg">
                {[3, 4, 5, 6].map((n) => (
                  <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>{t("table.table", "Table")}</span>
              <div className="stakes-grid">
                {STAKES.map((st, i) => (
                  <button key={st.name} className={"stake" + (table === i ? " on" : "")} disabled={chips < st.buyIn} onClick={() => setStake(i)}>
                    <span className="stake-name">{st.name}</span>
                    <span className="stake-buy">{t("table.buy_in", "Buy-in")} {st.buyIn.toLocaleString()}</span>
                    <span className="stake-pot">{t("table.pot", "Pot")} {(st.buyIn * players).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
            {chips < REFILL_TO && !broke && (
              <button className="btn ghost" onClick={onRefill}>
                {t("lobby.free_chips")} ({REFILL_TO.toLocaleString()})
              </button>
            )}
            <button
              className="btn primary huge"
              disabled={broke}
              onClick={() => {
                setOptions(false);
                go(table);
              }}
            >
              {t("table.deal_me_in", "Deal me in")}
            </button>
          </Sheet>
        )}
      </AnimatePresence>
      <Suspense fallback={null}>
        <AnimatePresence>
          {camp && (
            <Campaign
              cleared={cleared}
              onClose={() => setCamp(false)}
              onPlay={(n) => {
                setCamp(false);
                go(0, n);
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {games && (
            <ArcadeHub
              progress={progress}
              onOpenDaily={onOpenDaily}
              onClose={() => setGames(false)}
              onSelectGame={(id) => {
                setGames(false);
                switch (id) {
                  case "solitaire":
                    onSolitaire?.();
                    break;
                  case "freecell":
                    onFreeCell?.();
                    break;
                  case "spider":
                    onSpider?.();
                    break;
                  case "tripeaks":
                    onTriPeaks?.();
                    break;
                  case "pyramid":
                    onPyramid?.();
                    break;
                  case "yukon":
                    onYukon?.();
                    break;
                  case "ers":
                    onErs?.();
                    break;
                  case "scoundrel":
                    onScoundrel?.();
                    break;
                  case "minesweeper":
                    onMinesweeper?.();
                    break;
                  case "sudoku":
                    onSudoku?.();
                    break;
                  case "checkers":
                    onCheckers?.();
                    break;
                  case "hearts":
                    onHearts?.();
                    break;
                  case "spades":
                    onSpades?.();
                    break;
                }
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>{rules && <Rules target={players === 3 ? 3 : 4} fixed onClose={() => setRules(false)} />}</AnimatePresence>
      </Suspense>
      <AnimatePresence>
        {learn && (
          <Sheet title={t("lobby.how_to_play", "How to play")} onClose={() => setLearn(false)}>
            <button
              className="btn primary lobby-big"
              onClick={() => {
                setLearn(false);
                coach();
              }}
            >
              {t("lobby.play_with_coach", "Play with a coach")}
              <span className="lobby-sub">
                {nextLesson
                  ? t("lobby.lesson_sub", {
                      num: lessonNo(nextLesson) ?? 1,
                      total: LESSONS.length,
                      name: t(`lesson.${nextLesson}.name`, lesson(nextLesson)?.name || ""),
                    })
                  : t("lobby.coached_short_sub", "A short game with tips on every move. Free.")}
              </span>
            </button>
            <button
              className="btn lobby-big"
              onClick={() => {
                setLearn(false);
                setRules(true);
              }}
            >
              {t("lobby.the_rules", "Read the rules")}
            </button>
          </Sheet>
        )}
      </AnimatePresence>
      <Suspense fallback={null}>
        <AnimatePresence>{settings && <LobbySettings onClose={() => setSettings(false)} />}</AnimatePresence>
      </Suspense>
      <AnimatePresence>
        {tour && onTour && onOpen && (tour === "next" ? (
          <TourNext
            key="next"
            nextLesson={nextLesson}
            onCoach={() => {
              onTour(null);
              coach();
            }}
            onSave={
              onSave &&
              (() => {
                onTour(null);
                onSave();
              })
            }
            onLobby={() => onTour(null)}
          />
        ) : (
          <TourSpot
            key={tour}
            onTap={() => {
              onTour("next");
              onOpen("season");
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** The tour's spotlight: the lobby dims, the player card shines, and only it can be tapped. */
function TourSpot({ onTap }: { onTap: () => void }) {
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    const measure = () => setR(document.querySelector(".acct-corner .acct-chip")?.getBoundingClientRect() ?? null);
    measure();
    // the lobby animates in, and phones turn: keep the spotlight on the card
    const t = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const pad = 6;
  const below = r ? r.top < window.innerHeight / 2 : false;
  return createPortal(
    <motion.div className="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-label="Your stuff">
      {r && (
        <button
          className="tour-hole"
          data-track="tour-profile"
          style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }}
          onClick={onTap}
          aria-label="Open your profile"
        />
      )}
      <motion.div
        className="tour-card"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        style={r ? (below ? { top: r.bottom + 18 } : { bottom: window.innerHeight - r.top + 18 }) : undefined}
      >
        <b>{t("tour.spot_title", "Your stuff lives here")}</b>
        <span>{t("tour.spot_desc", "The Season pass, your look, the shop and your stats. Tap your card to see the prize at the top of the pass.")}</span>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** the season pass item the first hand gives (tier 1), to name on the save button */
function firstPrize() {
  const s = seasonAt(Date.now());
  const first = s && passTrack(s)[0];
  return first && first.kind === "item" ? cosmetic(first.id)?.name : undefined;
}

/** The tour's last stop: more lessons with the coach, saving a guest's progress, or the lobby. */
function TourNext({ nextLesson, onCoach, onSave, onLobby }: { nextLesson?: number; onCoach: () => void; onSave?: () => void; onLobby: () => void }) {
  const prize = firstPrize();
  return createPortal(
    <motion.div className="welcome tour-next" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-label="What's next">
      <div className="logo">HEIST</div>
      <p className="welcome-q">{t("lobby.tour_all_set", "You're all set. What's next?")}</p>
      <div className="welcome-choices">
        <button className="btn primary lobby-big" data-track="tour-coach" onClick={onCoach}>
          {t("lobby.continue_coaching", "Continue coaching")}
          <span className="lobby-sub">
            {nextLesson
              ? t("lobby.lesson_sub", {
                  num: lessonNo(nextLesson) ?? 1,
                  total: LESSONS.length,
                  name: t(`lesson.${nextLesson}.name`, lesson(nextLesson)?.name || ""),
                })
              : t("lobby.coached_short_sub", "A game with tips on every move. Free.")}
          </span>
        </button>
        {onSave && (
          <button className="btn lobby-big" data-track="tour-save" onClick={onSave}>
            {t("lobby.save_progress", "Save your progress")}
            <span className="lobby-sub">{prize ? `Free. Keeps your XP and the ${prize} you just won.` : "Free. Keeps your XP and everything you've won."}</span>
          </button>
        )}
      </div>
      <button className="lobby-change" data-track="tour-lobby" onClick={onLobby}>
        {t("common.back_to_lobby", "Go to lobby")}
      </button>
    </motion.div>,
    document.body,
  );
}

/** One of the lobby's ways to play: an icon, a name, and a line saying what it is. */
function Mode({ icon, label, sub, onClick, disabled }: { icon: string; label: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn lobby-mode" onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
      <span className="lobby-mode-text">
        <span className="lobby-mode-name">{label}</span>
        <span className="lobby-mode-sub">{sub}</span>
      </span>
    </button>
  );
}

/** Small line icons for the lobby (they take the text color). */
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    coach: <path d="M12 3 2 8l10 5 10-5-10-5ZM6 10v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 8v6" />,
    online: (
      <>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M14 15.5c.9-.6 1.9-.9 3-.9 2.8 0 5 2.2 5 5" />
      </>
    ),
    cards: (
      <>
        <rect x="3" y="6" width="11" height="15" rx="2" />
        <path d="M8 6V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-5" />
      </>
    ),
    map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14" />,
    book: <path d="M4 5c2.5-1.3 5.5-1.3 8 0v15c-2.5-1.3-5.5-1.3-8 0V5ZM12 5c2.5-1.3 5.5-1.3 8 0v15c-2.5-1.3-5.5-1.3-8 0" />,
  };
  return (
    <svg className="lobby-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function flag(key: string) {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}

function setFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage blocked: asks again next visit */
  }
}

/** Quick Play at the table the lobby would pick (last players and stake, else the best one you can afford); null when broke. */
export function quickPlay(chips: number, name: string): LobbyChoice | null {
  const players = remembered("heist.players", [3, 4, 5, 6], 4);
  const stake = remembered("heist.stake", [0, 1, 2, 3], 1);
  if (chips < STAKES[0].buyIn) return null;
  const table = chips >= STAKES[stake].buyIn ? stake : Math.max(0, STAKES.filter((st) => chips >= st.buyIn).length - 1);
  return { players, name, stakes: STAKES[table].buyIn };
}

function remembered(key: string, allowed: number[], fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** A small sheet over the lobby (the table picker). */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <motion.div className="lobby-sheet-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="lobby-sheet" role="dialog" aria-label={title} initial={{ y: 30 }} animate={{ y: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="lobby-sheet-head">
          <span>{title}</span>
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Nudge toward the home-screen app: Safari's Share menu on iPhone, the install prompt elsewhere. */
function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("heist.installHint") === "off";
    } catch {
      return false;
    }
  });
  const [modalOpen, setModalOpen] = useState(false);

  if (hidden || onCrazyGames || isStandalone() || location.protocol === "file:" || !isMobileDevice()) return null;

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem("heist.installHint", "off");
    } catch {
      /* storage blocked */
    }
  };

  return (
    <>
      <div className="install" role="note" onClick={() => setModalOpen(true)} style={{ cursor: "pointer" }}>
        <span>
          <b>📱 {t("install.banner_text")}</b>
        </span>
        <button
          type="button"
          className="btn small primary"
          onClick={(e) => {
            e.stopPropagation();
            setModalOpen(true);
          }}
          style={{ whiteSpace: "nowrap", marginLeft: "auto" }}
        >
          {t("install.banner_btn")}
        </button>
        <button
          className="x"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          aria-label={t("profile.close")}
        >
          ✕
        </button>
      </div>
      <MobileInstallModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

/** The table's settings, opened from the lobby. The tour starts with the next game. */
function LobbySettings({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <motion.div className="lobby-settings-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <Settings
        onClose={onClose}
        onTour={() => {
          setPrefs({ walked: false, tips: true, seen: [] });
          onClose();
        }}
      />
    </motion.div>,
    document.body,
  );
}
