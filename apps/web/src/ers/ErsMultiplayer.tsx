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
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { serverUrl } from "../online/session";
import { card as cardSound, click, win as winSound } from "../sound";
import "./ers.css";

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
        setToast(m.room.lastEvent);
        setToastKey((k) => k + 1);
      }
    });

    c.on("ers_flip", (m) => {
      cardSound();
      setTurnElapsed(0);
    });

    c.on("ers_slap", (m) => {
      if (m.valid) {
        winSound();
        buzz("win");
        setShaking(true);
        setTimeout(() => setShaking(false), 240);
        const reasonText = (m.reason || "SLAP").toUpperCase();
        triggerFloat(`⚡ ${reasonText}!`);
      } else {
        buzz("alert");
        triggerFloat("⚠️ FALSE SLAP! -1");
      }
    });

    c.on("ers_over", (m) => {
      winSound();
      buzz("win");
    });

    void c.connect().then(() => {
      setClient(c);
      if (initialCode) {
        c.ersJoin(initialCode.toUpperCase());
        setMode("room");
      }
    }).catch(() => {
      setToast("Failed to connect to server");
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
    client.ersJoin(codeToJoin.trim().toUpperCase());
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

  const handleCopyCode = useCallback(() => {
    if (!room?.code) return;
    click();
    buzz("tap");
    void navigator.clipboard?.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [room?.code]);

  const isMyTurn = room?.status === "playing" && room.turn === seat;
  const myCount = room?.you.cardCount ?? 0;
  const oppCount = room?.opponent?.cardCount ?? 0;
  const oppName = room?.opponent?.name ?? "Waiting...";
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
            title="Leave table"
            aria-label="Leave table"
          >
            <Icon d="M15 19l-7-7 7-7" />
          </button>

          <div className="ers-hud">
            <span className="ers-hud-name">
              {room ? `ERS ROOM: ${room.code}` : "MULTIPLAYER ERS"}
            </span>
            <span className="ers-hud-stats">
              {connected ? (
                <span style={{ color: "#2ecc71" }}>● LIVE SERVER</span>
              ) : (
                <span style={{ color: "#e74c3c" }}>CONNECTING...</span>
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
            title="Rules & Slap conditions"
            aria-label="Rules & Slap conditions"
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
                title={oppConnected ? "Connected" : "Disconnected"}
              />
              <span className="ers-count-pill">{oppCount} CARDS</span>
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
                👑 CHALLENGE! {room.challenge.chances}{" "}
                {room.challenge.chances === 1 ? "CHANCE" : "CHANCES"} LEFT
              </div>
            )}

            <div
              className="ers-pot-container"
              onClick={handleSlap}
              role="button"
              tabIndex={0}
              aria-label="Slap center pot"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSlap();
                }
              }}
              title="Tap anywhere in pot to SLAP!"
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
                  EMPTY POT
                </div>
              )}

              {/* Pot Card Count Badge */}
              <div className="ers-pot-badge">
                POT: {room?.potCount ?? 0} CARDS
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
                  ? `⚡ YOUR TURN TO FLIP (${turnElapsed}s)`
                  : `WAITING FOR ${oppName.toUpperCase()} (${turnElapsed}s)`}
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
              <span className="ers-count-pill">{myCount} CARDS</span>
            </div>

            {/* Action buttons: FLIP and Giant SLAP */}
            <div className="ers-actions">
              <button
                type="button"
                className={`ers-flip-btn ${isMyTurn ? "your-turn" : ""}`}
                onClick={handleFlip}
                disabled={!isMyTurn || myCount === 0}
                aria-label="Flip card"
              >
                <span>FLIP CARD</span>
              </button>

              <button
                type="button"
                className="ers-slap-btn"
                onClick={handleSlap}
                aria-label="Slap pot"
              >
                SLAP!
              </button>
            </div>
          </div>
        </div>

        {/* Lobby overlay when waiting for opponent */}
        {room && room.status === "waiting" && (
          <div className="ers-lobby-overlay">
            <div className="ers-lobby-box">
              <div className="ers-lobby-title">WAITING FOR PLAYER 2</div>
              <div className="ers-lobby-desc">
                Share this room code with a friend or open it in another browser window to duel:
              </div>

              <div className="ers-code-big">{room.code}</div>

              <button
                type="button"
                className="ers-btn-primary"
                onClick={handleCopyCode}
                aria-label="Copy room code"
              >
                {copied ? "COPIED TO CLIPBOARD!" : "COPY ROOM CODE"}
              </button>

              <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>
                Game begins automatically when opponent joins.
              </div>

              <button
                type="button"
                className="ers-btn-secondary"
                onClick={() => {
                  click();
                  buzz("tap");
                  if (client) client.ersLeave();
                  setRoom(null);
                  setMode("lobby");
                }}
                aria-label="Cancel and return to lobby"
              >
                Cancel / Return to Lobby
              </button>
            </div>
          </div>
        )}

        {/* Initial Lobby / Join Modal when not in a room */}
        {mode === "lobby" && !room && (
          <div className="ers-lobby-overlay">
            <div className="ers-lobby-box">
              <div className="ers-lobby-title">MULTIPLAYER DUEL</div>
              <div className="ers-lobby-desc">
                Play real-time Egyptian Rat Screw head-to-head with live card flips and instant slaps.
              </div>

              <button
                type="button"
                className="ers-btn-primary"
                onClick={handleCreateRoom}
                disabled={!connected}
                aria-label="Create new table"
              >
                CREATE NEW TABLE
              </button>

              <div style={{ color: "#777", fontSize: 13, margin: "4px 0" }}>— OR JOIN TABLE —</div>

              <input
                type="text"
                className="ers-code-input"
                placeholder="ENTER CODE"
                maxLength={5}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoinRoom(joinCodeInput);
                }}
              />

              <button
                type="button"
                className="ers-btn-secondary"
                onClick={() => handleJoinRoom(joinCodeInput)}
                disabled={!connected || !joinCodeInput.trim()}
                aria-label="Join table with code"
              >
                JOIN TABLE
              </button>

              <button
                type="button"
                className="ers-btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  click();
                  buzz("tap");
                  onExit();
                }}
                aria-label="Back to Solitaire and Solo games"
              >
                Back to Solitaire & Solo
              </button>
            </div>
          </div>
        )}

        {/* Game Over Screen */}
        {room && room.status === "over" && (
          <div className="ers-lobby-overlay">
            <div className="ers-lobby-box">
              <div className="ers-lobby-title">
                {room.winner === seat ? "🏆 YOU WIN! 🏆" : "DEFEAT"}
              </div>

              <div style={{ fontSize: 15, color: "#fff", fontWeight: 700 }}>
                {room.winReason || (room.winner === seat ? "You swept the entire deck!" : "Opponent swept the deck!")}
              </div>

              {/* Scorecard Table */}
              <table className="ers-scorecard-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>METRIC</th>
                    <th>YOU</th>
                    <th>OPPONENT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ textAlign: "left" }}>Cards Won</td>
                    <td>{room.stats.cardsWon[seat ?? 0]}</td>
                    <td>{room.stats.cardsWon[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>Valid Slaps</td>
                    <td>{room.stats.slaps[seat ?? 0]}</td>
                    <td>{room.stats.slaps[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>Challenges Won</td>
                    <td>{room.stats.faceChallengesWon[seat ?? 0]}</td>
                    <td>{room.stats.faceChallengesWon[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>False Slap Burns</td>
                    <td>{room.stats.falseSlaps[seat ?? 0]}</td>
                    <td>{room.stats.falseSlaps[(seat ?? 0) === 0 ? 1 : 0]}</td>
                  </tr>
                </tbody>
              </table>

              <button
                type="button"
                className="ers-btn-primary"
                onClick={handleRematch}
                aria-label="Request rematch"
              >
                REQUEST REMATCH
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
                aria-label="Exit to Menu"
              >
                Exit to Menu
              </button>
            </div>
          </div>
        )}

        {/* Rules Drawer Modal */}
        {showRules && (
          <div className="ers-rules-overlay" onClick={() => setShowRules(false)}>
            <div className="ers-rules-card" onClick={(e) => e.stopPropagation()}>
              <div className="ers-rules-title">HOW TO PLAY ERS</div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">🎯 OBJECTIVE</div>
                <div className="ers-rules-text">
                  Collect all 52 cards by slapping valid card combinations on the pot and winning face-card challenges.
                </div>
              </div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">⚡ SLAP CONDITIONS</div>
                <div className="ers-rules-text">
                  • <b>Doubles:</b> Two cards in a row of the same rank (e.g., 7, 7)<br />
                  • <b>Sandwiches:</b> Two cards of the same rank separated by one card (e.g., 9, 3, 9)<br />
                  • <b>Marriage:</b> King and Queen played right next to each other<br />
                  • <b>Tens:</b> Two cards in a row whose ranks sum to 10 (e.g., 6+4, A+9)<br />
                  • <b>Top-Bottom:</b> The top card matches the rank of the first card in the pot
                </div>
              </div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">👑 FACE CARD CHALLENGES</div>
                <div className="ers-rules-text">
                  When a player plays a face card, the other player must play tribute cards:<br />
                  • <b>Ace:</b> 4 chances<br />
                  • <b>King:</b> 3 chances<br />
                  • <b>Queen:</b> 2 chances<br />
                  • <b>Jack:</b> 1 chance<br />
                  If a face card is answered with another face card, the challenge switches!
                </div>
              </div>

              <div className="ers-rules-section">
                <div className="ers-rules-heading">⚠️ BURNS</div>
                <div className="ers-rules-text">
                  A false slap penalty burns 1 card from your draw pile to the bottom of the pot.
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
                aria-label="Close rules"
              >
                GOT IT
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
