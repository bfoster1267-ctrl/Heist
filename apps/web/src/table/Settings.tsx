// The table's settings popover: sound, motion, tips, and the walkthrough. The table's look is worn from
// the Wardrobe.
import { motion } from "motion/react";
import { useState } from "react";
import { setPrefs, usePrefs, type MotionPref } from "../prefs";
import { chip, getMusicVolume, getVolume, isMuted, setMusicVolume, setMuted, setVolume } from "../sound";
import { turnOffAlerts, turnOnAlerts, useAlertState } from "../alerts";

export function Settings({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const prefs = usePrefs();
  const [muted, setMute] = useState(isMuted());
  const [vol, setVol] = useState(getVolume());
  const [music, setMusic] = useState(getMusicVolume());
  const alerts = useAlertState();
  return (
    <motion.div className="settings" role="dialog" aria-label="Settings" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <div className="settings-head">
        <span>Settings</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <label className="set-row">
        <span>Sound</span>
        <input
          type="checkbox"
          checked={!muted}
          onChange={(e) => {
            setMuted(!e.target.checked);
            setMute(!e.target.checked);
          }}
        />
      </label>
      <label className="set-row">
        <span>Effects</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={vol}
          disabled={muted}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            setVol(Number(e.target.value));
          }}
          onPointerUp={() => chip()}
        />
      </label>

      <label className="set-row">
        <span>Music</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={prefs.tableMusic ? music : 0}
          disabled={muted}
          aria-valuetext={prefs.tableMusic && music > 0 ? `${Math.round(music * 100)}%` : "Off"}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMusicVolume(v);
            setMusic(v);
            if ((v > 0) !== prefs.tableMusic) setPrefs({ tableMusic: v > 0 });
          }}
        />
      </label>
      {alerts !== "unsupported" && (
        <label className="set-row">
          <span>Turn alerts</span>
          {alerts === "on" || alerts === "off" ? (
            <input type="checkbox" checked={alerts === "on"} onChange={(e) => void (e.target.checked ? turnOnAlerts() : turnOffAlerts())} />
          ) : (
            <span className="set-note">{alerts === "needs-install" ? "Add Heist to your Home Screen first" : "Allow notifications for Heist in your phone's settings"}</span>
          )}
        </label>
      )}

      <div className="set-row">
        <span>Motion</span>
        <div className="seg small" role="radiogroup" aria-label="Motion">
          {(
            [
              ["system", "Auto"],
              ["full", "Full"],
              ["reduce", "Reduced"],
            ] as [MotionPref, string][]
          ).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={prefs.motion === v} className={prefs.motion === v ? "on" : ""} onClick={() => setPrefs({ motion: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="set-row">
        <span>Haptics</span>
        <input type="checkbox" checked={prefs.haptics} onChange={(e) => setPrefs({ haptics: e.target.checked })} />
      </label>
      <label className="set-row text-size">
        <span>Text size</span>
        <span className="ts-small" aria-hidden>
          A
        </span>
        <input
          type="range"
          min={1}
          max={1.8}
          step={0.1}
          value={prefs.textSize}
          aria-valuetext={`${Math.round(prefs.textSize * 100)}%`}
          onChange={(e) => setPrefs({ textSize: Number(e.target.value), bigText: false })}
        />
        <span className="ts-big" aria-hidden>
          A
        </span>
      </label>

      <label className="set-row">
        <span>Coach tips</span>
        <input type="checkbox" checked={prefs.tips} onChange={(e) => setPrefs({ tips: e.target.checked, ...(e.target.checked ? { seen: [] } : {}) })} />
      </label>

      <button className="btn small" onClick={onTour}>
        Show the table tour
      </button>

      <div className="keys">
        <b>Keys</b> Tab to move, Enter to choose · S skip · L log · 1/2/4 speed · Esc close
      </div>
    </motion.div>
  );
}
