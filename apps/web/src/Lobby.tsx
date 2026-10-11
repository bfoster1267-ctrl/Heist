import { CREWS } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LESSONS, STAGES, cosmetic, lesson, lessonNo, passTrack, seasonAt } from "@heist/profile";
import { Campaign } from "./Campaign";
import { CrewBadge } from "./table/pieces";
import { Rules } from "./table/Rules";
import { Settings } from "./table/Settings";
import { createPortal } from "react-dom";
import { isIOS, isStandalone } from "./appShell";
import { setPrefs, usePrefs } from "./prefs";
import { REFILL_TO, STAKES } from "./wallet";

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
  defaultName,
  cleared = 0,
  newbie = false,
  nextLesson,
  tour,
  onTour,
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
  const [rules, setRules] = useState(false);
  // How to play, once the first lesson is done: another game with the coach, or the rules
  const [learn, setLearn] = useState(false);
  const [camp, setCamp] = useState(false);
  const [games, setGames] = useState(false);
  const [settings, setSettings] = useState(false);
  const [options, setOptions] = useState(false);
  const prefs = usePrefs();
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
  // a first visit goes straight into the one-hand first lesson: no question screen first
  // (players with an account sign in from the lobby afterwards)
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !newbie || flag("heist.welcomed")) return;
    started.current = true;
    setFlag("heist.welcomed");
    coach();
  }, []);
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
      <button className="lobby-gear" onClick={() => setSettings(true)} aria-label="Settings">
        ⚙
      </button>
      <div className="logo lobby-topname" aria-hidden="true">
        HEIST
      </div>
      <motion.div className="lobby-main" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="logo">HEIST</div>

        <div className="lobby-hero">
          {newbie ? (
            <>
              <button className="btn primary lobby-big" onClick={coach}>
                Learn to play
                <span className="lobby-sub">Play one hand with a coach. Free.</span>
              </button>
              <p className="lobby-locked">Quick Play and online tables open after your first lesson.</p>
              {onSignIn && (
                <button className="lobby-change" onClick={onSignIn}>
                  I already have an account
                </button>
              )}
            </>
          ) : (
            <>
        {broke ? (
          <button className="btn primary lobby-big" onClick={onRefill}>
            Free chips
            <span className="lobby-sub">Top up to {REFILL_TO.toLocaleString()} and play</span>
          </button>
        ) : (
          <button className={"btn lobby-big" + (newbie ? "" : " primary")} onClick={() => go(table)}>
            Quick Play
            <span className="lobby-sub">
              {players} players · {STAKES[table].name} · buy-in {STAKES[table].buyIn.toLocaleString()}
            </span>
          </button>
        )}
        <button className="lobby-change" onClick={() => setOptions(true)}>
          Change table
        </button>
            </>
          )}
        </div>

        <div className="lobby-modes">
          <Mode icon="online" label="Play online" sub={newbie ? "After your first lesson" : "Real people"} disabled={newbie || !onOnline} onClick={() => onOnline?.(nm())} />
          {onSolitaire && <Mode icon="cards" label="More games" sub="Solitaire · earns season XP" onClick={() => setGames(true)} />}
          <Mode icon="map" label="Campaign" sub={newbie ? "After your first lesson" : `${Math.min(cleared, STAGES.length)} of ${STAGES.length} stages`} disabled={newbie} onClick={() => setCamp(true)} />
          <Mode icon="book" label="How to play" sub={newbie ? "The rules" : nextLesson ? `Lesson ${lessonNo(nextLesson)} of ${LESSONS.length} next` : "Coach game or the rules"} onClick={() => (newbie ? setRules(true) : setLearn(true))} />
        </div>
        <InstallHint />
        <div className="fine">
          Play money only ·{" "}
          <a className="lobby-privacy" href="./privacy.html" target="_blank" rel="noreferrer">
            Privacy
          </a>
        </div>
      </motion.div>

      <AnimatePresence>
        {options && (
          <Sheet title="Your table" onClose={() => setOptions(false)}>
            <label className="field">
              <span>Your name</span>
              <input value={name} maxLength={14} placeholder="Ace" onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field">
              <span>Players</span>
              <div className="seg">
                {[3, 4, 5, 6].map((n) => (
                  <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Table</span>
              <div className="stakes-grid">
                {STAKES.map((st, i) => (
                  <button key={st.name} className={"stake" + (table === i ? " on" : "")} disabled={chips < st.buyIn} onClick={() => setStake(i)}>
                    <span className="stake-name">{st.name}</span>
                    <span className="stake-buy">Buy-in {st.buyIn.toLocaleString()}</span>
                    <span className="stake-pot">Pot {(st.buyIn * players).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
            {chips < REFILL_TO && !broke && (
              <button className="btn ghost" onClick={onRefill}>
                Free refill to {REFILL_TO.toLocaleString()} chips
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
              Deal me in
            </button>
          </Sheet>
        )}
      </AnimatePresence>
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
        {games && onSolitaire && (
          <Sheet title="More games" onClose={() => setGames(false)}>
            <button
              className="btn lobby-big lobby-game"
              onClick={() => {
                setGames(false);
                onSolitaire();
              }}
            >
              <span className="lobby-game-art" aria-hidden="true">
                <span className="lobby-game-card">A<i>♠</i></span>
                <span className="lobby-game-card red">K<i>♥</i></span>
              </span>
              <span className="lobby-game-text">
                Solitaire
                <span className="lobby-sub">Classic Klondike. Wins earn XP and season pass XP.</span>
              </span>
            </button>
            <p className="dim lobby-games-more">More card games are on the way.</p>
          </Sheet>
        )}
      </AnimatePresence>
      <AnimatePresence>{rules && <Rules target={players === 3 ? 3 : 4} fixed onClose={() => setRules(false)} />}</AnimatePresence>
      <AnimatePresence>
        {learn && (
          <Sheet title="How to play" onClose={() => setLearn(false)}>
            <button
              className="btn primary lobby-big"
              onClick={() => {
                setLearn(false);
                coach();
              }}
            >
              Play with a coach
              <span className="lobby-sub">{nextLesson ? `Lesson ${lessonNo(nextLesson)} of ${LESSONS.length}: ${lesson(nextLesson)?.name}. Free.` : "A short game with tips on every move. Free."}</span>
            </button>
            <button
              className="btn lobby-big"
              onClick={() => {
                setLearn(false);
                setRules(true);
              }}
            >
              Read the rules
            </button>
          </Sheet>
        )}
      </AnimatePresence>
      <AnimatePresence>{settings && <LobbySettings onClose={() => setSettings(false)} />}</AnimatePresence>
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
        <b>Your stuff lives here</b>
        <span>The Season pass, your look, the shop and your stats. Tap your card to see the prize at the top of the pass.</span>
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
      <p className="welcome-q">You're all set. What's next?</p>
      <div className="welcome-choices">
        <button className="btn primary lobby-big" data-track="tour-coach" onClick={onCoach}>
          Continue coaching
          <span className="lobby-sub">{nextLesson ? `Lesson ${lessonNo(nextLesson)} of ${LESSONS.length}: ${lesson(nextLesson)?.name}. Free.` : "A game with tips on every move. Free."}</span>
        </button>
        {onSave && (
          <button className="btn lobby-big" data-track="tour-save" onClick={onSave}>
            Save your progress
            <span className="lobby-sub">{prize ? `Free. Keeps your XP and the ${prize} you just won.` : "Free. Keeps your XP and everything you've won."}</span>
          </button>
        )}
      </div>
      <button className="lobby-change" data-track="tour-lobby" onClick={onLobby}>
        Go to lobby
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

type InstallEvent = Event & { prompt(): Promise<void> };

/** Nudge toward the home-screen app: Safari's Share menu on iPhone, the install prompt elsewhere. */
function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("heist.installHint") === "off";
    } catch {
      return false;
    }
  });
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const f = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", f);
    return () => window.removeEventListener("beforeinstallprompt", f);
  }, []);
  if (hidden || isStandalone() || location.protocol === "file:") return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem("heist.installHint", "off");
    } catch {
      /* storage blocked */
    }
  };
  if (isIOS())
    return (
      <div className="install" role="note">
        <span>
          <b>Play it like an app.</b> Tap Share{" "}
          <svg className="share" viewBox="0 0 14 16" aria-label="Share" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M7 1v9M3.5 4.5 7 1l3.5 3.5M4 7H2v8h10V7h-2" />
          </svg>{" "}
          then <b>Add to Home Screen</b>. It opens full screen and works offline.
        </span>
        <button className="x" onClick={close} aria-label="Hide">
          ✕
        </button>
      </div>
    );
  if (!deferred) return null;
  return (
    <div className="install" role="note">
      <span>
        <b>Install Heist</b> to play full screen, even offline.
      </span>
      <button className="btn small primary" onClick={() => void deferred.prompt().then(close)}>
        Install
      </button>
      <button className="x" onClick={close} aria-label="Hide">
        ✕
      </button>
    </div>
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
      <div onClick={(e) => e.stopPropagation()}>
        <Settings
          onClose={onClose}
          onTour={() => {
            setPrefs({ walked: false, tips: true, seen: [] });
            onClose();
          }}
        />
      </div>
    </motion.div>,
    document.body,
  );
}
