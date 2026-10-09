import { CREWS } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { STAGES } from "@heist/profile";
import { Campaign } from "./Campaign";
import { Chips, CrewBadge } from "./table/pieces";
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

export function Lobby({
  chips,
  onPlay,
  onRefill,
  onOnline,
  defaultName,
  top,
  cleared = 0,
}: {
  chips: number;
  onPlay: (c: LobbyChoice) => void;
  onRefill: () => void;
  onOnline?: (name: string) => void;
  defaultName?: string;
  top?: ReactNode;
  /** campaign stages cleared */
  cleared?: number;
}) {
  const [players, setPlayers] = useState(4);
  const [name, setName] = useState(() => {
    try {
      return defaultName || localStorage.getItem("heist.name") || "";
    } catch {
      return "";
    }
  });
  const [stake, setStake] = useState(1);
  const [rules, setRules] = useState(false);
  const [camp, setCamp] = useState(false);
  const [settings, setSettings] = useState(false);
  const prefs = usePrefs();
  const go = (i: number, campaign?: number) => {
    try {
      localStorage.setItem("heist.name", name);
    } catch {
      /* ignore */
    }
    onPlay({ players, name: name.trim() || "Ace", stakes: campaign ? 0 : STAKES[i].buyIn, campaign });
  };
  const coach = () => {
    try {
      localStorage.setItem("heist.name", name);
    } catch {
      /* ignore */
    }
    onPlay({ players: 3, name: name.trim() || "Ace", stakes: 0, coached: true });
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
      <motion.div className="lobby-card" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {top && <div className="acct-in-lobby">{top}</div>}
        <div className="lobby-col">
          <div className="logo">HEIST</div>
          <div className="tagline">Plan the job. Pick your crew. Trust no one.</div>
          <div className="wallet">
            <Chips amount={chips} />
            <span className="dim">play chips</span>
            {chips < REFILL_TO && (
              <button className="btn small" onClick={onRefill}>
                Free refill
              </button>
            )}
          </div>

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
        </div>

        <div className="lobby-col">
          <div className="field">
            <span>Table</span>
            <div className="stakes-grid">
              {STAKES.map((st, i) => (
                <button key={st.name} className={"stake" + (stake === i ? " on" : "")} disabled={chips < st.buyIn} onClick={() => setStake(i)}>
                  <span className="stake-name">{st.name}</span>
                  <span className="stake-buy">Buy-in {st.buyIn.toLocaleString()}</span>
                  <span className="stake-pot">Pot {(st.buyIn * players).toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>

          <button className="btn primary huge" disabled={chips < STAKES[stake].buyIn} onClick={() => go(stake)}>
            Quick Match
          </button>
          <InstallHint />
          <div className="lobby-row">
            <button className="btn ghost" onClick={() => setCamp(true)}>
              Campaign <span className="dim">{Math.min(cleared, STAGES.length)}/{STAGES.length}</span>
            </button>
            <button className="btn ghost" disabled={!onOnline} onClick={() => onOnline?.(name.trim() || "Ace")}>
              Play with friends
            </button>
          </div>
          <button className="btn ghost" onClick={coach} data-tip="A 3-player game against two easy bots, with a coach who explains every move. Free to play, small XP, doesn't count in your career.">
            Coached play <span className="dim">learn with a coach</span>
          </button>
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
          <button className="btn ghost how-to" onClick={() => setRules(true)}>
            <span className="how-to-q">?</span> New here? How to play
          </button>
          <AnimatePresence>{rules && <Rules target={players === 3 ? 3 : 4} fixed onClose={() => setRules(false)} />}</AnimatePresence>
          <button className="btn ghost how-to" onClick={() => setSettings(true)}>
            <span className="how-to-q">⚙</span> Settings: sound, text size, table color
          </button>
          <AnimatePresence>{settings && <LobbySettings onClose={() => setSettings(false)} />}</AnimatePresence>
          {prefs.walked ? (
            <button className="btn ghost small learn" onClick={() => setPrefs({ walked: false, tips: true, seen: [] })}>
              Show me the tour again next game
            </button>
          ) : (
            <div className="fine">Your first game starts with a quick tour of the table.</div>
          )}
          <div className="fine">Quick Match seats you with bots. Campaign is twelve tougher tables in a row. Coached play is a free game with a coach at your side. Play with friends makes an online table you can share. Chips are play money only.</div>
          <div className="fine">
            <a className="lobby-privacy" href="./privacy.html" target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </div>
        </div>
      </motion.div>
    </div>
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
