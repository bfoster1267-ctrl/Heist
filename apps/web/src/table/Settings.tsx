// The table's settings popover: sound, motion, tips, and the walkthrough. The table's look is worn from
// the Wardrobe.
import { motion } from "motion/react";
import { useState } from "react";
import { setPrefs, usePrefs, type Lang, type MotionPref } from "../prefs";
import { chip, getMusicVolume, getVolume, isMuted, setMusicVolume, setMuted, setVolume } from "../sound";
import { turnOffAlerts, turnOnAlerts, useAlertState } from "../alerts";
import { LOCALES, t, useLocale } from "../i18n";

export function Settings({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const prefs = usePrefs();
  const [muted, setMute] = useState(isMuted());
  const [vol, setVol] = useState(getVolume());
  const [music, setMusic] = useState(getMusicVolume());
  const alerts = useAlertState();
  useLocale();
  return (
    <motion.div className="settings" role="dialog" aria-label={t("settings.title")} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <div className="settings-head">
        <span>{t("settings.title")}</span>
        <button className="icon-btn" onClick={onClose} aria-label={t("settings.close")}>
          ✕
        </button>
      </div>

      <LanguageRow />

      <label className="set-row">
        <span>{t("settings.sound")}</span>
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
        <span>{t("settings.effects")}</span>
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
        <span>{t("settings.music")}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={prefs.tableMusic ? music : 0}
          disabled={muted}
          aria-valuetext={prefs.tableMusic && music > 0 ? `${Math.round(music * 100)}%` : t("settings.off")}
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
          <span>{t("settings.alerts")}</span>
          {alerts === "on" || alerts === "off" ? (
            <input type="checkbox" checked={alerts === "on"} onChange={(e) => void (e.target.checked ? turnOnAlerts() : turnOffAlerts())} />
          ) : (
            <span className="set-note">{alerts === "needs-install" ? t("settings.alertsInstall") : t("settings.alertsBlocked")}</span>
          )}
        </label>
      )}

      <div className="set-row">
        <span>{t("settings.motion")}</span>
        <div className="seg small" role="radiogroup" aria-label={t("settings.motion")}>
          {(
            [
              ["system", t("settings.motionAuto")],
              ["full", t("settings.motionFull")],
              ["reduce", t("settings.motionReduced")],
            ] as [MotionPref, string][]
          ).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={prefs.motion === v} className={prefs.motion === v ? "on" : ""} onClick={() => setPrefs({ motion: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="set-row">
        <span>{t("settings.haptics")}</span>
        <input type="checkbox" checked={prefs.haptics} onChange={(e) => setPrefs({ haptics: e.target.checked })} />
      </label>
      <label className="set-row text-size">
        <span>{t("settings.textSize")}</span>
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
        <span>{t("settings.tips")}</span>
        <input type="checkbox" checked={prefs.tips} onChange={(e) => setPrefs({ tips: e.target.checked, ...(e.target.checked ? { seen: [] } : {}) })} />
      </label>

      <button className="btn small" onClick={onTour}>
        {t("settings.tour")}
      </button>

      <div className="keys">
        <b>{t("settings.keys")}</b> {t("settings.keysHelp")}
      </div>
    </motion.div>
  );
}

/** The language picker: Auto (the browser's), English, Português (Brasil). Shared by the lobby and the table. */
export function LanguageRow() {
  const prefs = usePrefs();
  useLocale();
  const opts: [Lang, string][] = [["auto", t("settings.langAuto")], ...LOCALES.map((l): [Lang, string] => [l.id, l.name])];
  return (
    <label className="set-row set-lang">
      <span>{t("settings.language")}</span>
      <select value={prefs.lang} onChange={(e) => setPrefs({ lang: e.target.value as Lang })} aria-label={t("settings.language")}>
        {opts.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

