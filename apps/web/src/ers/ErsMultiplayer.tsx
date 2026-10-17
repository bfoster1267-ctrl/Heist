// Egyptian Rat Screw (ERS) Real-Time Head-to-Head Multiplayer (PvP)
// 2-player real-time card duel over WebSockets with live card flips,
// instant server-adjudicated slaps, face-card challenge rounds, dynamic card stacking,
// haptic & audio feedback, live turn timers, and win/loss resolution.

import {
  cardRank, cardRed, cardSuit,
  type PlayingCard, type SlapReason,
} from "@heist/profile";
import { HeistClient } from "@heist/server/client";
import type { ErsRoomView, ErsStats } from "@heist/server/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InviteFriends } from "../account/Friends";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { serverUrl } from "../online/session";
import { card as cardSound, click, win as winSound } from "../sound";
import "./ers.css";
import { t, tEn, tRich } from "../i18n";

export function ersInviteLink(code: string) {
  const u = new URL(location.href);
  u.pathname = "/ers";
  u.search = `?join=${code}`;
  u.hash = "";
  return u.toString();
}

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  text: string;
}

export function ErsMultiplayer({
  initialCode,
  onExit,
  banner,
}: {
  initialCode?: string;
  onExit: () => void;
  banner?: ReactNode;
}) {
  const { me } = useAccount();
  const [client, setClient] = useState<HeistClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<ErsRoomView | null>(null);
  const [seat, setSeat] = useState<0 | 1 | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [mode, setMode] = useState<"lobby" | "room">(initialCode ? "room" : "lobby");
  const [toast, setToast] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);

  // Turn timer tracking (seconds elapsed in current turn)
  const [turnElapsed, setTurnElapsed] = useState(0);

  const playerName = me?.name || "Player";
  const playerToken = typeof localStorage !== "undefined" ? localStorage.getItem("heist.token") ?? undefined : undefined;

  // Initialize and connect WebSocket client
  useEffect(() => {
    const c = new HeistClient(serverUrl(), {
      name: playerName,
      token: playerToken,
    });

    c.onConnection((up) => {
      setConnected(up);
    });

    c.on("ers_welcome", (m) => {
      setSeat(m.seat);
    });

    c.on("ers_sync", (m) => {
      setRoom(m.room);
      setSeat(m.room.you.seat);
      if (m.room.lastEvent) {
        setToast(tEn(m.room.lastEvent));
        setToastKey((k) => k + 1);
      }
    });

    c.on("ers_flip", () => {
      cardSound();
      setTurnElapsed(0);
    });

    c.on("ers_slap", (m) => {
      if (m.valid) {
        winSound();
        buzz("win");
        setShaking(true);
        setTimeout(() => setShaking(false), 240);
        const reasonText = m.reason ? tEn(m.reason).toUpperCase() : t("ers.slap").replace(/!$/, "");
        triggerFloat(`⚡ ${reasonText}!`);
      } else {
        buzz("alert");
        triggerFloat(t("ers.falseFloat"));
      }
    });

    c.on("ers_over", () => {
      winSound();
      buzz("win");
    });

    c.on("error", (m) => {
      setToast(tEn(m.msg) || t("ers.tableError"));
      setRoom(null);
      setMode("lobby");
    });

    void c.connect().then(() => {
      setClient(c);
      if (initialCode) {
        let code = initialCode.trim();
        if (code.includes("?") || code.includes("/")) {
          try {
            const u = new URL(code.startsWith("http") ? code : `https://${code}`);
            const fromParam = u.searchParams.get("join") || u.searchParams.get("joinErs") || u.searchParams.get("table");
            if (fromParam) code = fromParam;
          } catch {
            /* fallback */
          }
        }
        const clean = code.slice(0, 5).toUpperCase();
        c.ersJoin(clean);
        setMode("room");
      }
    }).catch(() => {
      setToast(t("ers.noConnect"));
    });

    return () => {
      c.close();
    };
  }, [playerName, playerToken, initialCode]);

  // Turn timer ticker
  useEffect(() => {
    if (!room || room.status !== "playing") return;
    const interval = setInterval(() => {
      setTurnElapsed((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [room?.status, room?.turn]);

  const triggerFloat = useCallback((text: string) => {
    const id = ++floatId.current;
    setFloats((f) => [
      ...f,
      { id, x: window.innerWidth / 2, y: window.innerHeight / 2, text },
    ]);
    setTimeout(() => {
      setFloats((f) => f.filter((x) => x.id !== id));
    }, 1200);
  }, []);

  const handleCreateRoom = useCallback(() => {
    if (!client) return;
    click();
    buzz("tap");
    client.ersCreate();
    setMode("room");
  }, [client]);

  const handleJoinRoom = useCallback((codeToJoin: string) => {
    if (!client || !codeToJoin.trim()) return;
    click();
    buzz("tap");
    let code = codeToJoin.trim();
    if (code.includes("?") || code.includes("/")) {
      try {
        const u = new URL(code.startsWith("http") ? code : `https://${code}`);
        const fromParam = u.searchParams.get("join") || u.searchParams.get("joinErs") || u.searchParams.get("table");
        if (fromParam) code = fromParam;
      } catch {
        /* fallback */
      }
    }
    const clean = code.slice(0, 5).toUpperCase();
    client.ersJoin(clean);
    setMode("room");
  }, [client]);

  const handleFlip = useCallback(() => {
    if (!client || !room || room.turn !== seat || room.status !== "playing") return;
    cardSound();
    buzz("tap");
    client.ersPlay();
  }, [client, room, seat]);

  const handleSlap = useCallback(() => {
    if (!client || !room || room.status !== "playing") return;
    click();
    buzz("bump");
    setShaking(true);
    setTimeout(() => setShaking(false), 240);
    client.ersSlap(Date.now());
  }, [client, room]);

  const handleRematch = useCallback(() => {
    if (!client) return;
    click();
    buzz("tap");
    client.ersRematch();
  }, [client]);

  const handleShareInvite = useCallback(async () => {
    if (!room?.code) return;
    click();
    buzz("tap");
    const url = ersInviteLink(room.code);
    try {
      if (navigator.share) {
        await navigator.share({
          title: t("ers.shareTitle"),
          text: t("ers.shareText", { code: room.code }),
          url,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user dismissed native share */
    }
  }, [room?.code]);

  const handleCopyRawCode = useCallback(async () => {
    if (!room?.code) return;
    click();
    buzz("tap");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(room.code);
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch {
      /* ignore */
    }
  }, [room?.code]);

  const isMyTurn = room?.status === "playing" && room.turn === seat;
  const myCount = room?.you.cardCount ?? 0;
  const oppCount = room?.opponent?.cardCount ?? 0;
  const oppName = room?.opponent?.name ?? t("ers.waiting");
  const oppConnected = room?.opponent?.connected ?? false;

  return (
    <div className={`ers ${shaking ? "shaking" : ""}`}>
      <div className="ers-felt-rim" />

      <div className="ers-board">
        {/* Header Bar */}
        <header className="ers-bar">
          <button
            type="button"
            className="ers-icon-btn"
            onClick={() => {
              click();
              buzz("tap");
              if (client) client.ersLeave();
              onExit();
            }}
            title={t("ers.leaveTable")}
            aria-label={t("ers.leaveTable")}
          >
            <Icon d="M15 19l-7-7 7-7" />
          </button>

          <div className="ers-hud">
            <span className="ers-hud-name">
              {room ? t("ers.room", { code: room.code }) : t("ers.multi")}
            </span>
            <span className="ers-hud-stats">
              {connected ? (
                <span style={{ color: "#2ecc71" }}>{t("ers.live")}</span>
              ) : (
                <span style={{ color: "#e74c3c" }}>{t("ers.connecting")}</span>
              )}
            </span>
          </div>

          <button
            type="button"
            className="ers-icon-btn"
            onClick={() => {
              click();
              buzz("tap");
              setShowRules(true);
            }}
            title={t("ers.rulesAria")}
            aria-label={t("ers.rulesAria")}
          >
            <Icon d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2a2 2 0 011-3.73A2.5 2.5 0 0013 7a2.5 2.5 0 00-5 0h2a.5.5 0 011 0c0 .83-.67 1.5-1.5 1.5S8 9.17 8 10h2a1 1 0 001-1 1 1 0 012 0c0 .55-.45 1-1 1v3z" />
          </button>
        </header>

        {/* Main Head-to-Head Arena */}
        <div className="ers-arena">
          {/* Opponent Zone at Top */}
          <div className="ers-bot-zone">
            <div
              className={`ers-fighter-tag ${
                room?.status === "playing" && room.turn !== seat
                  ? "ers-active-turn-ring"
                  : ""
              }`}
            >
              <span className="ers-avatar">👤</span>
              <span className="ers-fighter-name">{oppName}</span>
              <span
                className={`ers-dot ${oppConnected ? "online" : "offline"}`}
                title={oppConnected ? t("ers.connected") : t("ers.disconnected")}
              />
              <span className="ers-count-pill">{t("ers.cards", { count: oppCount })}</span>
            </div>

            {/* Opponent Deck Stack */}
            <div style={{ position: "relative", width: 90, height: 128 }}>
              {oppCount > 0 && (
                <div className="ers-card face-down">
                  <span className="ers-back-mark">H</span>
                </div>
              )}
            </div>
          </div>

          {/* Center Table Pot Zone with Dynamic 3D Card Stacking */}
          <div className="ers-center-zone">
            {room?.challenge && (
              <div className="ers-challenge-banner">
                👑 {t("ers.challenge", { count: room.challenge.chances })}
              </div>
            )}

            <div
              className="ers-pot-container"
              onClick={handleSlap}
              role="button"
              tabIndex={0}
              aria-label={t("ers.slapPot")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSlap();
                }
              }}
              title={t("ers.tapPot")}
            >
              {/* Stacked top cards in pot */}
              {room?.topCards && room.topCards.length > 0 ? (
                room.topCards.map((card, idx) => {
                  const isTop = idx === room.topCards.length - 1;
                  // Calculate dynamic rotation and translation offsets based on card index and card rank
                  const rot =
                    (idx - (room.topCards.length - 1)) * 7 +
                    ((card * 17) % 7) -
                    3;
                  const dx = ((card * 13) % 9) - 4;
                  const dy = ((card * 19) % 7) - 3;
                  const opacity = isTop ? 1 : 0.65 + idx * 0.1;

                  return (
                    <div
                      key={`${card}-${idx}`}
                      className="ers-card face-up"
                      style={{
                        transform: `rotate(${rot}deg) translate(${dx}px, ${dy}px)`,
                        zIndex: idx + 1,
                        opacity,
                      }}
                    >
                      <CardFace card={card} />
                    </div>
                  );
                })
              ) : (
                <div
                  style={{
                    width: 90,
                    height: 128,
                    border: "2px dashed rgba(231, 181, 60, 0.25)",
                    borderRadius: 8,
                    display: "grid",
                    placeItems: "center",
                    color: "rgba(231, 181, 60, 0.3)",
                    fontFamily: "var(--cond)",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {t("ers.emptyPot")}
                </div>
              )}

              {/* Pot Card Count Badge */}
              <div className="ers-pot-badge">
                {t("ers.pot", { count: room?.potCount ?? 0 })}
              </div>
            </div>

            {/* Live event toast banner */}
            {toast && (
              <div key={toastKey} className="ers-event-toast">
                {toast}
              </div>
            )}
          </div>

          {/* Player Zone at Bottom */}
          <div className="ers-player-zone">
            {/* Live Turn Timer / Indicator */}
            {room?.status === "playing" && (
              <div
                className={`ers-turn-indicator ${
                  isMyTurn ? "mine" : "opp"
                }`}
              >
                {isMyTurn
                  ? t("ers.yourTurn", { s: turnElapsed })
                  : t("ers.waitingFor", { name: oppName.toUpperCase(), s: turnElapsed })}
              </div>
            )}

            {/* Player's Fighter Tag */}
            <div
              className={`ers-fighter-tag ${
                isMyTurn ? "ers-active-turn-ring" : ""
              }`}
            >
              <span className="ers-avatar">🤠</span>
              <span className="ers-fighter-name">{playerName}</span>
              <span className="ers-count-pill">{t("ers.cards", { count: myCount })}</span>
            </div>

            {/* Action buttons: FLIP and Giant SLAP */}
            <div className="ers-actions">
              <button
                type="button"
                className={`ers-flip-btn ${isMyTurn ? "your-turn" : ""}`}
                onClick={handleFlip}
                disabled={!isMyTurn || myCount === 0}
                aria-label={t("ers.flipAria")}
              >
                <span>{t("ers.flip")}</span>
              </button>

              <button
                type="button"
                className="ers-slap-btn"
                onClick={handleSlap}
                aria-label={t("ers.slapAria")}
              >
                {t("ers.slap")}
              </button>
            </div>
          </div>
        </div>

        {/* Lobby overlay when waiting for opponent */}
        {room && room.status === "waiting" && (
          <div className="ers-lobby-overlay">
            <div className="ers-lobby-box" style={{ maxWidth: 380 }}>
              <div className="ers-lobby-title">{t("ers.waitOpp")}</div>
              <div className="ers-lobby-desc" style={{ marginBottom: 4 }}>
                {t("ers.shareInvite")}
              </div>

              <div className="tagline" style={{ textTransform: "uppercase", letterSpacing: 2, fontSize: 12, opacity: 0.7 }}>
                {t("ers.tableCode")}
              </div>
              <div
                className="room-code"
                onClick={handleCopyRawCode}
                title={t("ers.tapCopy")}
                aria-label={t("ers.codeAria", { code: room.code })}
              >
                {room.code}
              </div>

              {/* Friends get a notification that opens the app at this table; a texted link is for everyone else */}
              <InviteFriends code={room.code} seated={[me?.id ?? null]} onText={handleShareInvite} />

              <button
                type="button"
                className="btn gold big"
                style={{ width: "100%", height: 50, fontSize: 16 }}
                onClick={handleShareInvite}
                aria-label={t("ers.textInvite")}
              >
                {copied ? t("ers.linkCopied") : t("ers.textInvite")}
              </button>

              <button
                type="button"
                className="btn ghost small"
                style={{ margin: "2px auto 0", display: "block" }}
                onClick={handleCopyRawCode}
                aria-label={t("ers.copyCodeAria")}
              >
                {copiedCode ? t("ers.codeCopied") : t("ers.copyCode")}
              </button>

              <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginTop: 4 }}>
                {t("ers.autoStart")}
              </div>

              <button
                type="button"
                className="btn ghost"
                style={{ width: "100%", marginTop: 6 }}
                onClick={() => {
                  click();
                  buzz("tap");
                  if (client) client.ersLeave();
                  setRoom(null);
                  setMode("lobby");
                }}
                aria-label={t("ers.cancelAria")}
              >
                {t("ers.cancel")}
              </button>
            </div>
          </div>
        )}

        {/* Initial Lobby / Join Modal when not in a room */}
        {mode === "lobby" && !room && (
          <div className="ers-lobby-overlay">
            <div className="ers-lobby-box" style={{ maxWidth: 380 }}>
              <div className="ers-lobby-title">{t("ers.multiTitle")}</div>
              <div className="ers-lobby-desc">
                {t("ers.multiDesc")}
              </div>

              <button
                type="button"
                className="btn gold big"
                style={{ width: "100%", height: 50, fontSize: 16 }}
                onClick={handleCreateRoom}
                disabled={!connected}
                aria-label={t("ers.createAria")}
              >
                {t("ers.create")}
              </button>

              <div style={{ color: "#777", fontSize: 13, margin: "10px 0 6px" }}>{t("ers.or")}</div>

              <input
                type="text"
                className="ers-code-input"
                placeholder={t("ers.codePh")}
                value={joinCodeInput}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  if (val.includes("?") || val.includes("/")) {
                    try {
                      const u = new URL(val.startsWith("http") ? val : `https://${val}`);
                      const c = u.searchParams.get("join") || u.searchParams.get("joinErs") || u.searchParams.get("table");
                      if (c) {
                        setJoinCodeInput(c.slice(0, 5).toUpperCase());
                        return;
                      }
                    } catch {}
                  }
                  setJoinCodeInput(val.slice(0, 5).toUpperCase());
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && joinCodeInput.trim()) handleJoinRoom(joinCodeInput);
                }}
                aria-label={t("ers.codeInputAria")}
              />

              <button
                type="button"
                className="btn primary"
                style={{ width: "100%", marginTop: 6 }}
                onClick={() => handleJoinRoom(joinCodeInput)}
                disabled={!connected || !joinCodeInput.trim()}
                aria-label={t("ers.joinAria")}
              >
                {t("ers.join")}
              </button>

              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 12, width: "100%" }}
                onClick={() => {
                  click();
                  buzz("tap");
                  onExit();
                }}
                aria-label={t("ers.backArcade")}
              >
                {t("ers.backArcade")}
              </button>
            </div>
          </div>
        )}

        {/* Game Over Screen */}
        {room && room.status === "over" && (
          <div className="ers-lobby-overlay">
            <div className="ers-lobby-box">
              <div className="ers-lobby-title">
                {room.winner === seat ? t("ers.youWinOnline") : t("ers.defeat")}
              </div>

              <div style={{ fontSize: 15, color: "#fff", fontWeight: 700 }}>
                {tEn(room.winReason) || (room.winner === seat ? t("ers.youSwept") : t("ers.oppSwept"))}
              </div>

              {/* Scorecard Table */}
              <table className="ers-scorecard-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>{t("ers.metric")}</th>
                    <th>{t("ers.you")}</th>
                    <th>{t("ers.opponent")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ textAlign: "left" }}>{t("ers.cardsWon")}</td>
                    <td>{room.stats.cardsWon[seat ?? 0]}</td>
                    <td>{room.stats.cardsWon[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>{t("ers.validSlaps")}</td>
                    <td>{room.stats.slaps[seat ?? 0]}</td>
                    <td>{room.stats.slaps[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>{t("ers.chWon")}</td>
                    <td>{room.stats.faceChallengesWon[seat ?? 0]}</td>
                    <td>{room.stats.faceChallengesWon[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>{t("ers.burns")}</td>
                    <td>{room.stats.falseSlaps[seat ?? 0]}</td>
                    <td>{room.stats.falseSlaps[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                </tbody>
              </table>

              <button
                type="button"
                className="ers-btn-primary"
                onClick={handleRematch}
                aria-label={t("ers.rematchAria")}
              >
                {t("ers.rematch")}
              </button>

              <button
                type="button"
                className="ers-btn-secondary"
                onClick={() => {
                  click();
                  buzz("tap");
                  if (client) client.ersLeave();
                  onExit();
                }}
                aria-label={t("ers.exitMenu")}
              >
                {t("ers.exitMenu")}
              </button>
            </div>
          </div>
        )}

        {/* Rules Drawer Modal */}
        {showRules && (
          <div className="ers-rules-overlay" onClick={() => setShowRules(false)}>
            <div className="ers-rules-card" onClick={(e) => e.stopPropagation()}>
              <div className="ers-rules-title">{t("ers.howTitle")}</div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">{t("ers.objective")}</div>
                <div className="ers-rules-text">
                  {t("ers.objectiveText")}
                </div>
              </div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">{t("ers.slapHead")}</div>
                <div className="ers-rules-text">
                  • {tRich("ers.r2.double")}<br />
                  • {tRich("ers.r2.sandwich")}<br />
                  • {tRich("ers.r2.marriage")}<br />
                  • {tRich("ers.r2.tens")}<br />
                  • {tRich("ers.r2.topbottom")}
                </div>
              </div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">{t("ers.faceHead")}</div>
                <div className="ers-rules-text">
                  {t("ers.faceIntro2")}<br />
                  • {tRich("ers.r.ace")}<br />
                  • {tRich("ers.r.king")}<br />
                  • {tRich("ers.r.queen")}<br />
                  • {tRich("ers.r.jack")}<br />
                  {t("ers.faceSwitch2")}
                </div>
              </div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">{t("ers.burnHead")}</div>
                <div className="ers-rules-text">
                  {t("ers.burnText2")}
                </div>
              </div>

              <button
                type="button"
                className="ers-rules-close-btn"
                onClick={() => {
                  click();
                  buzz("tap");
                  setShowRules(false);
                }}
                aria-label={t("ers.closeRules")}
              >
                {t("ers.gotIt")}

              </button>
            </div>
          </div>
        )}

        {/* Floating notifications */}
        {floats.map((f) => (
          <div
            key={f.id}
            className="ers-float"
            style={{ left: f.x, top: f.y }}
          >
            {f.text}
          </div>
        ))}

        {/* Celebration cascade when winning */}
        {room?.winner === seat && (
          <WinCascade
            from={() => ({
              x: window.innerWidth / 2 - 45,
              y: window.innerHeight / 2 - 64,
            })}
            cw={90}
            ch={128}
          />
        )}

        {banner}
      </div>
    </div>
  );
}

function CardFace({ card }: { card: PlayingCard }) {
  const r = cardRank(card);
  const s = cardSuit(card);
  const red = cardRed(card);
  return (
    <>
      <div className={`ers-corner ${red ? "ers-red" : "ers-black"}`}>
        <span className="ers-corner-rank">{RANKS[r]}</span>
        <span className="ers-corner-suit">{SUITS[s]}</span>
      </div>
      <div className={`ers-center-suit ${red ? "ers-red" : "ers-black"}`}>
        {SUITS[s]}
      </div>
      <div
        className={`ers-corner ${red ? "ers-red" : "ers-black"}`}
        style={{ transform: "rotate(180deg)", alignSelf: "flex-end" }}
      >
        <span className="ers-corner-rank">{RANKS[r]}</span>
        <span className="ers-corner-suit">{SUITS[s]}</span>
      </div>
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function WinCascade({
  from,
  cw,
  ch,
}: {
  from: () => { x: number; y: number };
  cw: number;
  ch: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    g.scale(dpr, dpr);
    const queue: PlayingCard[] = [];
    for (let r = 12; r >= 0; r--) {
      for (let s = 0; s < 4; s++) {
        queue.push(s * 13 + r);
      }
    }
    const live: {
      img: HTMLCanvasElement;
      x: number;
      y: number;
      vx: number;
      vy: number;
    }[] = [];
    let last = 0;
    let raf = 0;
    const step = (t: number) => {
      if (queue.length && t - last > 180) {
        last = t;
        const c = queue.shift()!;
        const o = from();
        live.push({
          img: cardSprite(c, cw, ch, dpr),
          x: o.x,
          y: o.y,
          vx: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5),
          vy: -3 - Math.random() * 6,
        });
      }
      for (const p of live) {
        p.vy += 0.55;
        p.x += p.vx;
        p.y += p.vy;
        if (p.y + ch > H) {
          p.y = H - ch;
          p.vy = -p.vy * 0.74;
        }
        g.drawImage(p.img, p.x, p.y, cw, ch);
      }
      for (let i = live.length - 1; i >= 0; i--) {
        if (live[i].x < -cw || live[i].x > W) live.splice(i, 1);
      }
      if (queue.length || live.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cw, ch, from]);
  return <canvas ref={ref} className="ers-cascade" />;
}

function cardSprite(c: PlayingCard, cw: number, ch: number, dpr: number) {
  const cv = document.createElement("canvas");
  cv.width = cw * dpr;
  cv.height = ch * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  const r = Math.max(4, cw * 0.08);
  g.beginPath();
  g.roundRect(0.5, 0.5, cw - 1, ch - 1, r);
  const bg = g.createLinearGradient(0, 0, cw * 0.4, ch);
  bg.addColorStop(0, "#fffdf6");
  bg.addColorStop(0.55, "#f6eedb");
  bg.addColorStop(1, "#eadfc4");
  g.fillStyle = bg;
  g.fill();
  g.strokeStyle = "rgba(0, 0, 0, 0.35)";
  g.stroke();
  const rank = cardRank(c);
  const suit = cardSuit(c);
  const red = cardRed(c);
  g.fillStyle = red ? "#c0301b" : "#17191d";
  g.font = `bold ${Math.round(cw * 0.22)}px sans-serif`;
  g.fillText(RANKS[rank], 4, cw * 0.22);
  g.font = `${Math.round(cw * 0.18)}px sans-serif`;
  g.fillText(SUITS[suit], 4, cw * 0.42);
  g.font = `${Math.round(cw * 0.45)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(SUITS[suit], cw / 2, ch / 2);
  return cv;
}
