import { CREWS } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { STAGES } from "@heist/profile";
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

/** the player's own screens, opened from the bar along the bottom */
export type LobbyPage = "career" | "season" | "shop" | "board";

export function Lobby({
  chips,
  onPlay,
  onRefill,
  onOnline,
  onOpen,
  defaultName,
  cleared = 0,
  newbie = false,
}: {
  chips: number;
  onPlay: (c: LobbyChoice) => void;
  onRefill: () => void;
  onOnline?: (name: string) => void;
  onOpen?: (page: LobbyPage) => void;
  defaultName?: string;
  /** campaign stages cleared */
  cleared?: number;
  /** never played a game: Learn to play leads */
  newbie?: boolean;
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
  const [camp, setCamp] = useState(false);
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
        {newbie && (
          <button className="btn primary lobby-big" onClick={coach}>
            Learn to play
            <span className="lobby-sub">A quick game with a coach. Free.</span>
          </button>
        )}
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
        </div>

        <div className="lobby-modes">
          {!newbie && <Mode icon="coach" label="Learn to play" sub="Free game with a coach" onClick={coach} />}
          <Mode icon="online" label="Play online" sub="Real people" disabled={!onOnline} onClick={() => onOnline?.(nm())} />
          <Mode icon="map" label="Campaign" sub={`${Math.min(cleared, STAGES.length)} of ${STAGES.length} stages`} onClick={() => setCamp(true)} />
          <Mode icon="book" label="How to play" sub="The rules" onClick={() => setRules(true)} />
        </div>
        <InstallHint />
        <div className="fine">
          Play money only ·{" "}
          <a className="lobby-privacy" href="./privacy.html" target="_blank" rel="noreferrer">
            Privacy
          </a>
        </div>
      </motion.div>

      {onOpen && (
        <nav className="lobby-dock" aria-label="Your stuff">
          {DOCK.map(([page, label]) => (
            <button key={page} onClick={() => onOpen(page)}>
              <Icon name={page} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

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
      <AnimatePresence>{rules && <Rules target={players === 3 ? 3 : 4} fixed onClose={() => setRules(false)} />}</AnimatePresence>
      <AnimatePresence>{settings && <LobbySettings onClose={() => setSettings(false)} />}</AnimatePresence>
    </div>
  );
}

const DOCK: [LobbyPage, string][] = [
  ["season", "Season pass"],
  ["shop", "Shop"],
  ["board", "Leaders"],
  ["career", "Career"],
];

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
    map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14" />,
    book: <path d="M4 5c2.5-1.3 5.5-1.3 8 0v15c-2.5-1.3-5.5-1.3-8 0V5ZM12 5c2.5-1.3 5.5-1.3 8 0v15c-2.5-1.3-5.5-1.3-8 0" />,
    season: <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7ZM10 7v10" />,
    shop: <path d="M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2" />,
    board: <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4c0 3 1.5 5 4 5M16 6h4c0 3-1.5 5-4 5M12 13v4M8 20h8" />,
    career: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  };
  return (
    <svg className="lobby-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
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
