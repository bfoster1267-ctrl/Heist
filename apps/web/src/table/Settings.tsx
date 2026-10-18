// The table and lobby settings popout: categorized tabs for Global, Audio, Visual, and Game settings.
// Spacious modal design that scales comfortably on mobile and desktop without cramped scrolling.

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { setPrefs, usePrefs, type MotionPref } from "../prefs";
import { chip, getMusicVolume, getVolume, isHostMuted, isPlayerMuted, onSoundChange, setMusicVolume, setMuted, setVolume } from "../sound";
import { turnOffAlerts, turnOnAlerts, useAlertState } from "../alerts";
import { t, useLanguage } from "../i18n";
import { buzz } from "../haptics";
import "./settings.css";

type LobbyTab = "general" | "audio" | "visual" | "game";
type InGameTab = "quick" | "audio" | "visual" | "all";

export function Settings({
  onClose,
  onTour,
  inGame = false,
}: {
  onClose: () => void;
  onTour: () => void;
  inGame?: boolean;
}) {
  const prefs = usePrefs();
  const [lang, setLang] = useLanguage();
  const [muted, setMute] = useState(isPlayerMuted);
  const [hostMuted, setHostMuted] = useState(isHostMuted);
  useEffect(() => onSoundChange(() => {
    setMute(isPlayerMuted());
    setHostMuted(isHostMuted());
  }), []);
  const [vol, setVol] = useState(getVolume());
  const [music, setMusic] = useState(getMusicVolume());
  const [lobbyTab, setLobbyTab] = useState<LobbyTab>("general");
  const [inGameTab, setInGameTab] = useState<InGameTab>("quick");
  const [resetDone, setResetDone] = useState(false);
  const alerts = useAlertState();

  const handleSoundToggle = (enabled: boolean) => {
    buzz("tap");
    setMuted(!enabled);
    setMute(!enabled);
  };

  const handleEffectsChange = (v: number) => {
    setVolume(v);
    setVol(v);
  };

  const handleMusicChange = (v: number) => {
    setMusicVolume(v);
    setMusic(v);
    if ((v > 0) !== prefs.tableMusic) setPrefs({ tableMusic: v > 0 });
  };

  const handleResetHints = () => {
    buzz("tap");
    setPrefs({ seen: [], walked: false });
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2500);
  };

  const currentTab = inGame ? inGameTab : lobbyTab;

  return (
    <motion.div
      className={"settings settings-modal-card" + (inGame ? " in-game" : "")}
      role="dialog"
      aria-label={t("settings.title")}
      initial={{ opacity: 0, scale: 0.96, y: inGame ? -8 : 0 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="settings-head">
        <div className="settings-head-left">
          <span className="settings-title">{inGame ? t("settings.in_game_title") : t("settings.title")}</span>
          {inGame && <span className="settings-badge">TABLE</span>}
        </div>
        <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="settings-tabs" role="tablist">
        {inGame ? (
          <>
            <button
              role="tab"
              aria-selected={inGameTab === "quick"}
              className={"settings-tab-btn" + (inGameTab === "quick" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setInGameTab("quick");
              }}
            >
              <span className="settings-tab-icon">⚡</span>
              <span>{t("settings.tab_quick")}</span>
            </button>
            <button
              role="tab"
              aria-selected={inGameTab === "audio"}
              className={"settings-tab-btn" + (inGameTab === "audio" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setInGameTab("audio");
              }}
            >
              <span className="settings-tab-icon">🔊</span>
              <span>{t("settings.tab_audio")}</span>
            </button>
            <button
              role="tab"
              aria-selected={inGameTab === "visual"}
              className={"settings-tab-btn" + (inGameTab === "visual" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setInGameTab("visual");
              }}
            >
              <span className="settings-tab-icon">👁️</span>
              <span>{t("settings.tab_visual")}</span>
            </button>
            <button
              role="tab"
              aria-selected={inGameTab === "all"}
              className={"settings-tab-btn" + (inGameTab === "all" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setInGameTab("all");
              }}
            >
              <span className="settings-tab-icon">⚙️</span>
              <span>{t("settings.tab_all")}</span>
            </button>
          </>
        ) : (
          <>
            <button
              role="tab"
              aria-selected={lobbyTab === "general"}
              className={"settings-tab-btn" + (lobbyTab === "general" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setLobbyTab("general");
              }}
            >
              <span className="settings-tab-icon">🌐</span>
              <span>{t("settings.tab_general")}</span>
            </button>
            <button
              role="tab"
              aria-selected={lobbyTab === "audio"}
              className={"settings-tab-btn" + (lobbyTab === "audio" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setLobbyTab("audio");
              }}
            >
              <span className="settings-tab-icon">🔊</span>
              <span>{t("settings.tab_audio")}</span>
            </button>
            <button
              role="tab"
              aria-selected={lobbyTab === "visual"}
              className={"settings-tab-btn" + (lobbyTab === "visual" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setLobbyTab("visual");
              }}
            >
              <span className="settings-tab-icon">👁️</span>
              <span>{t("settings.tab_visual")}</span>
            </button>
            <button
              role="tab"
              aria-selected={lobbyTab === "game"}
              className={"settings-tab-btn" + (lobbyTab === "game" ? " active" : "")}
              onClick={() => {
                buzz("tap");
                setLobbyTab("game");
              }}
            >
              <span className="settings-tab-icon">🃏</span>
              <span>{t("settings.tab_game")}</span>
            </button>
          </>
        )}
      </div>

      {/* Settings Body */}
      <div className="settings-body">
        {/* Quick Tab (in-game) */}
        {inGame && inGameTab === "quick" && (
          <>
            {/* Master Sound */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.sound")}</span>
                <span className="set-desc">{t("settings.sound_desc")}</span>
              </div>
              <div className="set-control">
                <label className="set-switch">
                  <input
                    type="checkbox"
                    checked={!muted}
                    onChange={(e) => handleSoundToggle(e.target.checked)}
                  />
                  <span className="set-slider" />
                </label>
              </div>
            </div>

            {/* Effects Volume */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.effects")}</span>
                <span className="set-desc">{t("settings.effects_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-slider-group">
                  <input
                    type="range"
                    className="set-range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vol}
                    disabled={muted}
                    onChange={(e) => handleEffectsChange(Number(e.target.value))}
                    onPointerUp={() => chip()}
                  />
                  <span className="set-val-badge">{muted ? "Muted" : `${Math.round(vol * 100)}%`}</span>
                </div>
              </div>
            </div>

            {/* Music Volume */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.music")}</span>
                <span className="set-desc">{t("settings.music_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-slider-group">
                  <input
                    type="range"
                    className="set-range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={prefs.tableMusic ? music : 0}
                    disabled={muted}
                    onChange={(e) => handleMusicChange(Number(e.target.value))}
                  />
                  <span className="set-val-badge">
                    {muted || !prefs.tableMusic || music === 0 ? "Off" : `${Math.round(music * 100)}%`}
                  </span>
                </div>
              </div>
            </div>

            {/* Coach Tips */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.coach_tips")}</span>
                <span className="set-desc">{t("settings.coach_tips_desc")}</span>
              </div>
              <div className="set-control">
                <label className="set-switch">
                  <input
                    type="checkbox"
                    checked={prefs.tips}
                    onChange={(e) => {
                      buzz("tap");
                      setPrefs({ tips: e.target.checked, ...(e.target.checked ? { seen: [] } : {}) });
                    }}
                  />
                  <span className="set-slider" />
                </label>
              </div>
            </div>

            {/* Table Tour Button */}
            <button type="button" className="set-action-btn" onClick={onTour}>
              <span>🗺️</span> {t("settings.show_tour")}
            </button>
          </>
        )}

        {/* Audio Tab */}
        {((!inGame && lobbyTab === "audio") || (inGame && inGameTab === "audio")) && (
          <>
            {/* Master Sound */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.sound")}</span>
                <span className="set-desc">{t("settings.sound_desc")}</span>
              </div>
              <div className="set-control">
                <label className="set-switch">
                  <input
                    type="checkbox"
                    checked={!muted}
                    onChange={(e) => handleSoundToggle(e.target.checked)}
                  />
                  <span className="set-slider" />
                </label>
              </div>
            </div>

            {/* Effects Volume */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.effects")}</span>
                <span className="set-desc">{t("settings.effects_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-slider-group">
                  <input
                    type="range"
                    className="set-range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vol}
                    disabled={muted}
                    onChange={(e) => handleEffectsChange(Number(e.target.value))}
                    onPointerUp={() => chip()}
                  />
                  <span className="set-val-badge">{muted ? "Muted" : `${Math.round(vol * 100)}%`}</span>
                </div>
              </div>
            </div>

            {/* Music Volume */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.music")}</span>
                <span className="set-desc">{t("settings.music_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-slider-group">
                  <input
                    type="range"
                    className="set-range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={prefs.tableMusic ? music : 0}
                    disabled={muted}
                    onChange={(e) => handleMusicChange(Number(e.target.value))}
                  />
                  <span className="set-val-badge">
                    {muted || !prefs.tableMusic || music === 0 ? "Off" : `${Math.round(music * 100)}%`}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Visual Tab */}
        {((!inGame && lobbyTab === "visual") || (inGame && inGameTab === "visual")) && (
          <>
            {/* Motion */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.motion")}</span>
                <span className="set-desc">{t("settings.motion_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-seg-group" role="radiogroup" aria-label="Motion">
                  {(
                    [
                      ["system", t("settings.motion_auto")],
                      ["full", t("settings.motion_full")],
                      ["reduce", t("settings.motion_reduced")],
                    ] as [MotionPref, string][]
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={prefs.motion === v}
                      className={"set-seg-btn" + (prefs.motion === v ? " on" : "")}
                      onClick={() => {
                        buzz("tap");
                        setPrefs({ motion: v });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Text & UI Scaling */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.text_size")}</span>
                <span className="set-desc">{t("settings.text_size_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-slider-group">
                  <span style={{ fontSize: 13, opacity: 0.6 }}>A</span>
                  <input
                    type="range"
                    className="set-range"
                    min={1}
                    max={1.8}
                    step={0.1}
                    value={prefs.textSize}
                    onChange={(e) => setPrefs({ textSize: Number(e.target.value), bigText: false })}
                  />
                  <span style={{ fontSize: 18, fontWeight: 700, color: "var(--gold)" }}>A</span>
                  <span className="set-val-badge">{`${Math.round(prefs.textSize * 100)}%`}</span>
                </div>
              </div>
            </div>

            {/* Vibration / Haptics */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.haptics")}</span>
                <span className="set-desc">{t("settings.haptics_desc")}</span>
              </div>
              <div className="set-control">
                <label className="set-switch">
                  <input
                    type="checkbox"
                    checked={prefs.haptics}
                    onChange={(e) => {
                      if (e.target.checked) buzz("tap");
                      setPrefs({ haptics: e.target.checked });
                    }}
                  />
                  <span className="set-slider" />
                </label>
              </div>
            </div>
          </>
        )}

        {/* General / Global Tab (Lobby or In-Game "All") */}
        {((!inGame && lobbyTab === "general") || (inGame && inGameTab === "all")) && (
          <>
            {/* Language Selection */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.language")}</span>
                <span className="set-desc">{t("settings.language_desc")}</span>
              </div>
              <div className="set-control">
                <div className="set-seg-group" role="radiogroup" aria-label="Language">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={lang === "en"}
                    className={"set-seg-btn" + (lang === "en" ? " on" : "")}
                    onClick={() => {
                      buzz("tap");
                      setLang("en");
                    }}
                  >
                    🇺🇸 English
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={lang === "pt-BR"}
                    className={"set-seg-btn" + (lang === "pt-BR" ? " on" : "")}
                    onClick={() => {
                      buzz("tap");
                      setLang("pt-BR");
                    }}
                  >
                    🇧🇷 Português
                  </button>
                </div>
              </div>
            </div>

            {/* Push Alerts & Notifications */}
            {alerts !== "unsupported" && (
              <div className="set-card">
                <div className="set-info">
                  <span className="set-label">{t("settings.alerts")}</span>
                  <span className="set-desc">
                    {alerts === "needs-install"
                      ? t("settings.alerts_needs_install")
                      : alerts === "blocked"
                      ? t("settings.alerts_blocked")
                      : t("settings.alerts_desc")}
                  </span>
                </div>
                <div className="set-control">
                  {alerts === "on" || alerts === "off" ? (
                    <label className="set-switch">
                      <input
                        type="checkbox"
                        checked={alerts === "on"}
                        onChange={(e) => {
                          buzz("tap");
                          void (e.target.checked ? turnOnAlerts() : turnOffAlerts());
                        }}
                      />
                      <span className="set-slider" />
                    </label>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--gold)" }}>⚠️</span>
                  )}
                </div>
              </div>
            )}

            {/* Reset Seen Hints */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.reset_tips")}</span>
                <span className="set-desc">{resetDone ? t("settings.reset_tips_done") : t("settings.coach_tips_desc")}</span>
              </div>
              <div className="set-control">
                <button type="button" className="btn small ghost" onClick={handleResetHints}>
                  {resetDone ? "✓" : t("settings.reset_tips")}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Game Tab (Lobby or In-Game "All") */}
        {((!inGame && lobbyTab === "game") || (inGame && inGameTab === "all")) && (
          <>
            {/* Coach Tips */}
            <div className="set-card">
              <div className="set-info">
                <span className="set-label">{t("settings.coach_tips")}</span>
                <span className="set-desc">{t("settings.coach_tips_desc")}</span>
              </div>
              <div className="set-control">
                <label className="set-switch">
                  <input
                    type="checkbox"
                    checked={prefs.tips}
                    onChange={(e) => {
                      buzz("tap");
                      setPrefs({ tips: e.target.checked, ...(e.target.checked ? { seen: [] } : {}) });
                    }}
                  />
                  <span className="set-slider" />
                </label>
              </div>
            </div>

            {/* Table Tour Button */}
            <button type="button" className="set-action-btn" onClick={onTour}>
              <span>🗺️</span> {t("settings.show_tour")}
            </button>
          </>
        )}
      </div>

      {/* Footer / Shortcuts */}
      <div className="settings-footer">
        <div className="settings-keys-box">
          {t("settings.keys_hint")}
        </div>
      </div>
    </motion.div>
  );
}
