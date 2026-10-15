// Egyptian Rat Screw (ERS / Ratslap)
// Fast-reaction card duel against "The Shark" / "Viper" bot.
// Pure rules for turn flips, face card challenges (A=4, K=3, Q=2, J=1),
// and instant slaps on Doubles, Sandwiches, Marriages, Tens, and Top-Bottom.
// Visual polish: oxblood card backs, ivory faces, haptics, screen-shake, floating XP, win cascade.

import {
  applyErs, cardRank, cardRed, cardSuit, checkSlap, dealErs,
  ERS_DAY_XP, ersPay, ersRoom, tallyErs, tallyErsXp,
  type ErsMove, type ErsState, type ErsTally, type PlayingCard, type SlapReason,
} from "@heist/profile";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { card as cardSound, click, win as winSound } from "../sound";
import { ErsMultiplayer } from "./ErsMultiplayer";
import "./ers.css";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: ErsTally = { cardsCaptured: 0, slaps: 0, faceChallengesWon: 0, won: false };

export function Ers({ onExit, onHeist, banner }: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
}) {
  const { backend, act, showReward, me } = useAccount();
  const [pvp, setPvp] = useState(() => {
    try {
      const p = new URLSearchParams(location.search);
      return p.has("pvp") || p.has("join") || location.pathname.startsWith("/ers/pvp");
    } catch {
      return false;
    }
  });
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [state, setState] = useState<ErsState | null>(null);
  const [moves, setMoves] = useState<ErsMove[]>([]);
  const [shaking, setShaking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  const best = useRef(NOTHING);
  const banked = useRef(0);
  const meNow = useRef(me);
  meNow.current = me;

  const botTimer = useRef<number | null>(null);
  const slapTimer = useRef<number | null>(null);

  // Load new deal
  const deal = useCallback(async () => {
    if (botTimer.current) clearTimeout(botTimer.current);
    if (slapTimer.current) clearTimeout(slapTimer.current);
    try {
      const g = backend ? await backend.ersStart().catch(() => null) : null;
      if (g) {
        setGame(g);
        setState(dealErs(g.seed));
      } else {
        const seed = Math.floor(Math.random() * 2 ** 31);
        setGame({ gameId: null, seed });
        setState(dealErs(seed));
      }
      setMoves([]);
      setDone(false);
      setToast("Ready! Tap Flip to start");
      best.current = NOTHING;
      banked.current = 0;
    } catch {
      const seed = Math.floor(Math.random() * 2 ** 31);
      setGame({ gameId: null, seed });
      setState(dealErs(seed));
      setMoves([]);
      setDone(false);
      setToast("Ready! Tap Flip to start");
      best.current = NOTHING;
      banked.current = 0;
    }
  }, [backend]);

  useEffect(() => {
    void deal();
    return () => {
      if (botTimer.current) clearTimeout(botTimer.current);
      if (slapTimer.current) clearTimeout(slapTimer.current);
    };
  }, [deal]);

  // Current tally
  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallyErs(game.seed, moves);
    } catch {
      return null;
    }
  }, [game, moves]);

  // Bank progress on slaps or challenges
  useEffect(() => {
    if (!game || !tally) return;
    const cur = tally;
    const b = best.current;
    if (cur.slaps > b.slaps || cur.faceChallengesWon > b.faceChallengesWon) {
      best.current = cur;
      const gainedXp = tallyErsXp(cur) - banked.current;
      if (gainedXp > 0) {
        banked.current = tallyErsXp(cur);
        const id = ++floatId.current;
        setFloats((f) => [...f, { id, x: window.innerWidth / 2, y: window.innerHeight / 2, xp: gainedXp, tag: "SLAP!" }]);
        setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1200);
      }
      if (game.gameId) {
        void act((x) => x.ersBank(game.gameId!, moves, 0));
      }
    }
  }, [game, tally, moves, act]);

  // Check victory
  useEffect(() => {
    if (!state || done) return;
    if (state.winner === 0) {
      setDone(true);
      winSound();
      buzz("win");
      setToast("🏆 YOU WIN THE DECK! 🏆");
      if (game?.gameId) {
        void act((x) => x.ersFinish(game.gameId!, moves, 0))
          .then((r) => {
            if (r?.reward) showReward(r.reward);
          })
          .catch(() => {});
      }
    } else if (state.winner === 1) {
      setDone(true);
      buzz("alert");
      setToast("Viper swept the deck! Game Over.");
    }
  }, [state, done, game, moves, act, showReward]);

  // Bot logic: reactions and flips
  useEffect(() => {
    if (!state || done || state.winner !== null) return;

    // 1. Check if there is an active slap condition on the pot
    const slapCond = checkSlap(state.pot);
    if (slapCond && !slapTimer.current) {
      // Bot reaction delay: 520ms - 820ms
      const delay = 520 + Math.random() * 300;
      slapTimer.current = window.setTimeout(() => {
        slapTimer.current = null;
        setState((prev) => {
          if (!prev || checkSlap(prev.pot) === null) return prev;
          const next = applyErs(prev, "slap:1");
          setMoves((m) => [...m, "slap:1"]);
          buzz("bump");
          setToast(`Viper slapped ${slapCond.toUpperCase()}! (+${prev.pot.length} cards)`);
          return next;
        });
      }, delay);
    } else if (!slapCond && slapTimer.current) {
      clearTimeout(slapTimer.current);
      slapTimer.current = null;
    }

    // 2. Bot turn to flip
    if (state.turn === 1 && !botTimer.current) {
      const delay = 600 + Math.random() * 300;
      botTimer.current = window.setTimeout(() => {
        botTimer.current = null;
        setState((prev) => {
          if (!prev || prev.turn !== 1 || prev.p1.length === 0) return prev;
          cardSound();
          const next = applyErs(prev, "play:1");
          setMoves((m) => [...m, "play:1"]);
          if (next.lastEvent) setToast(next.lastEvent);
          return next;
        });
      }, delay);
    } else if (state.turn !== 1 && botTimer.current) {
      clearTimeout(botTimer.current);
      botTimer.current = null;
    }
  }, [state, done]);

  // Player flips a card
  const handleFlip = useCallback(() => {
    if (!state || done || state.winner !== null) return;
    if (state.turn !== 0) {
      buzz("tap");
      setToast("Wait for Viper's flip!");
      return;
    }
    if (state.p0.length === 0) return;

    cardSound();
    buzz("tap");
    const next = applyErs(state, "play:0");
    setMoves((m) => [...m, "play:0"]);
    setState(next);
    if (next.lastEvent) setToast(next.lastEvent);
  }, [state, done]);

  // Player slaps
  const handleSlap = useCallback(() => {
    if (!state || done || state.winner !== null) return;

    // Trigger visual shake
    setShaking(true);
    setTimeout(() => setShaking(false), 220);

    const slapCond: SlapReason = checkSlap(state.pot);
    if (slapCond) {
      // Successful slap!
      if (slapTimer.current) {
        clearTimeout(slapTimer.current);
        slapTimer.current = null;
      }
      winSound();
      buzz("win");
      const potCount = state.pot.length;
      const next = applyErs(state, "slap:0");
      setMoves((m) => [...m, "slap:0"]);
      setState(next);
      setToast(`⚡ SLAP! You caught a ${slapCond.toUpperCase()}! (+${potCount} cards)`);
    } else {
      // False slap! Burn penalty
      buzz("alert");
      const next = applyErs(state, "slap:0");
      setMoves((m) => [...m, "slap:0"]);
      setState(next);
      if (next.lastEvent) {
        setToast(next.lastEvent);
      } else {
        setToast("⚠️ False slap! Burned 1 card to the pot.");
      }
    }
  }, [state, done]);

  const p0Count = state?.p0.length ?? 26;
  const p1Count = state?.p1.length ?? 26;
  const pot = state?.pot ?? [];
  const topCard = pot.length > 0 ? pot[pot.length - 1] : null;
  const underCard = pot.length > 1 ? pot[pot.length - 2] : null;

  const room = me ? ersRoom(me.progress, Date.now()) : ERS_DAY_XP;

  if (pvp) {
    return (
      <ErsMultiplayer
        initialCode={typeof window !== "undefined" ? (new URLSearchParams(location.search).get("join") ?? undefined) : undefined}
        onExit={() => setPvp(false)}
        banner={banner}
      />
    );
  }

  return (
    <div className={`ers ${shaking ? "shaking" : ""}`}>
      <div className="ers-felt-rim" />

      <div className="ers-board">
        {/* Top Header Bar */}
        <header className="ers-bar">
          <button
            type="button"
            className="ers-icon-btn"
            onClick={() => { click(); buzz("tap"); onExit(); }}
            title="Leave ERS"
            aria-label="Back to the lobby"
          >
            <Icon d="M15 19l-7-7 7-7" />
          </button>

          <div className="ers-hud">
            <span className="ers-hud-name">EGYPTIAN RAT SCREW</span>
            <span className="ers-hud-stats">
              DAILY CAP: <span className="ers-hud-val">{room} XP ROOM</span>
            </span>
          </div>

          <button
            type="button"
            className="ers-icon-btn"
            onClick={() => { click(); buzz("tap"); setShowRules(true); }}
            title="Rules & Slap conditions"
            aria-label="Rules & Slap conditions"
          >
            <Icon d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2a2 2 0 011-3.73A2.5 2.5 0 0013 7a2.5 2.5 0 00-5 0h2a.5.5 0 011 0c0 .83-.67 1.5-1.5 1.5S8 9.17 8 10h2a1 1 0 001-1 1 1 0 012 0c0 .55-.45 1-1 1v3z" />
          </button>

          <button
            type="button"
            className="ers-icon-btn"
            style={{ width: "auto", padding: "0 10px", fontSize: 13, fontFamily: "var(--cond)", fontWeight: 800, color: "var(--gold)" }}
            onClick={() => { click(); buzz("tap"); setPvp(true); }}
            title="Play 2-Player Real-time PvP Duel"
            aria-label="Play 2-Player Real-time PvP Duel"
          >
            ⚔️ 2P DUEL
          </button>

          <button
            type="button"
            className={`ers-icon-btn ${armed ? "armed" : ""}`}
            onClick={() => {
              click();
              buzz("tap");
              if (armed) {
                setArmed(false);
                void deal();
              } else {
                setArmed(true);
                setTimeout(() => setArmed(false), 2600);
              }
            }}
            title={armed ? "Confirm new deal" : "New deal"}
            aria-label="New deal"
          >
            {armed ? <span className="ers-sure">NEW?</span> : <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
          </button>
        </header>

        {/* Main Arena */}
        <div className="ers-arena">
          {/* Opponent Bot Zone */}
          <div className="ers-bot-zone">
            <div className={`ers-fighter-tag ${state?.turn === 1 ? "ers-active-turn-ring" : ""}`}>
              <span className="ers-avatar">🐍</span>
              <span className="ers-fighter-name">VIPER</span>
              <span className="ers-count-pill">{p1Count} CARDS</span>
            </div>

            {/* Bot Deck stack */}
            <div style={{ position: "relative", width: 90, height: 128 }}>
              {p1Count > 0 && (
                <div className="ers-card face-down">
                  <span className="ers-back-mark">H</span>
                </div>
              )}
            </div>
          </div>

          {/* Center Table Pot Zone */}
          <div className="ers-center-zone">
            {state?.challenge && (
              <div className="ers-challenge-banner">
                CHALLENGE! {state.challenge.chances} {state.challenge.chances === 1 ? "CHANCE" : "CHANCES"} LEFT
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
            >
              {/* Overlapping card underneath for realistic depth */}
              {underCard !== null && (
                <div
                  className="ers-card face-up"
                  style={{ transform: "rotate(-8deg) translate(-4px, 4px)", opacity: 0.7 }}
                >
                  <CardFace card={underCard} />
                </div>
              )}

              {/* Top card in pot */}
              {topCard !== null ? (
                <div
                  className="ers-card face-up"
                  style={{ transform: "rotate(3deg)", zIndex: 2 }}
                >
                  <CardFace card={topCard} />
                </div>
              ) : (
                <div
                  className="ers-card"
                  style={{
                    border: "2px dashed rgba(231, 181, 60, 0.3)",
                    background: "rgba(0, 0, 0, 0.2)",
                    display: "grid",
                    placeItems: "center",
                    color: "rgba(231, 181, 60, 0.4)",
                    fontFamily: "var(--cond)",
                    fontSize: 12,
                    letterSpacing: 1.5,
                  }}
                >
                  EMPTY POT
                </div>
              )}

              <div className="ers-pot-badge">
                POT: {pot.length} {pot.length === 1 ? "CARD" : "CARDS"}
              </div>
            </div>

            {toast && (
              <div className="ers-event-toast">
                {toast}
              </div>
            )}
          </div>

          {/* Player Zone */}
          <div className="ers-player-zone">
            {/* Player Deck stack */}
            <div
              style={{ position: "relative", width: 90, height: 128, cursor: "pointer" }}
              onClick={handleFlip}
              role="button"
              tabIndex={0}
              aria-label="Flip card from your deck"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleFlip();
                }
              }}
            >
              {p0Count > 0 && (
                <div
                  className={`ers-card face-down ${state?.turn === 0 ? "ers-active-turn-ring" : ""}`}
                >
                  <span className="ers-back-mark">H</span>
                </div>
              )}
            </div>

            <div className={`ers-fighter-tag ${state?.turn === 0 ? "ers-active-turn-ring" : ""}`}>
              <span className="ers-avatar">👤</span>
              <span className="ers-fighter-name">YOU</span>
              <span className="ers-count-pill">{p0Count} CARDS</span>
            </div>

            {/* Actions: Giant Slap & Flip */}
            <div className="ers-actions">
              <button
                type="button"
                className={`ers-flip-btn ${state?.turn === 0 ? "your-turn" : ""}`}
                onClick={handleFlip}
                disabled={done || state?.turn !== 0}
                aria-label="Flip card"
              >
                <span>FLIP CARD</span>
                <span style={{ fontSize: 18 }}>🎴</span>
              </button>

              <button
                type="button"
                className="ers-slap-btn"
                onClick={handleSlap}
                disabled={done}
                aria-label="Slap pot"
              >
                ⚡ SLAP! ⚡
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating XP */}
      {floats.map((f) => (
        <div key={f.id} className="ers-float" style={{ left: f.x, top: f.y }}>
          +{f.xp} XP {f.tag}
        </div>
      ))}

      {/* Rules Modal */}
      {showRules && (
        <div className="ers-rules-overlay" onClick={() => setShowRules(false)}>
          <div className="ers-rules-card" onClick={(e) => e.stopPropagation()}>
            <div className="ers-rules-title">EGYPTIAN RAT SCREW RULES</div>

            <div className="ers-rules-section">
              <div className="ers-rules-heading">⚡ SLAP CONDITIONS</div>
              <div className="ers-rules-text">
                • <b>Doubles:</b> Two cards in a row of the same rank (e.g. 7, 7).<br />
                • <b>Sandwiches:</b> Two matching cards with one card between them (e.g. 9, K, 9).<br />
                • <b>Marriages:</b> King and Queen played directly together (K-Q or Q-K).<br />
                • <b>Tens:</b> Top two cards sum up to 10 (A=1, so 9+A, 8+2, 7+3, 6+4, 5+5).<br />
                • <b>Top-Bottom:</b> Top card matches the very first card placed in the pot.
              </div>
            </div>

            <div className="ers-rules-section">
              <div className="ers-rules-heading">👑 FACE CARD CHALLENGES</div>
              <div className="ers-rules-text">
                When a player flips a face card, the opponent must pay tribute with face-card chances:<br />
                • <b>Ace:</b> 4 chances<br />
                • <b>King:</b> 3 chances<br />
                • <b>Queen:</b> 2 chances<br />
                • <b>Jack:</b> 1 chance<br />
                If the challenger's opponent flips another face card, the challenge switches! If they fail, the challenger wins the pot.
              </div>
            </div>

            <div className="ers-rules-section">
              <div className="ers-rules-heading">⚠️ BURNS</div>
              <div className="ers-rules-text">
                Slapping when there is no valid slap condition burns 1 of your cards to the bottom of the pot.
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

      {/* Win Celebration Cascade */}
      {state?.winner === 0 && (
        <WinCascade from={() => ({ x: window.innerWidth / 2 - 45, y: window.innerHeight / 2 - 64 })} cw={90} ch={128} />
      )}

      {/* Online queue timer banner overlay */}
      {banner}
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
      <div className={`ers-corner ${red ? "ers-red" : "ers-black"}`} style={{ transform: "rotate(180deg)", alignSelf: "flex-end" }}>
        <span className="ers-corner-rank">{RANKS[r]}</span>
        <span className="ers-corner-suit">{SUITS[s]}</span>
      </div>
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function WinCascade({ from, cw, ch }: { from: () => { x: number; y: number }; cw: number; ch: number }) {
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
    for (let r = 12; r >= 0; r--) for (let s = 0; s < 4; s++) queue.push(s * 13 + r);
    const live: { img: HTMLCanvasElement; x: number; y: number; vx: number; vy: number }[] = [];
    let last = 0;
    let raf = 0;
    const step = (t: number) => {
      if (queue.length && t - last > 180) {
        last = t;
        const c = queue.shift()!;
        const o = from();
        live.push({ img: cardSprite(c, cw, ch, dpr), x: o.x, y: o.y, vx: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5), vy: -3 - Math.random() * 6 });
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
      for (let i = live.length - 1; i >= 0; i--) if (live[i].x < -cw || live[i].x > W) live.splice(i, 1);
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
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = cardRed(c) ? "#c0301b" : "#17191d";
  g.textBaseline = "top";
  const fs = Math.round(cw * 0.3);
  g.font = `${fs}px "Bebas Neue", Impact, sans-serif`;
  g.fillText(RANKS[cardRank(c)], cw * 0.08, ch * 0.05);
  g.font = `${Math.round(fs * 0.8)}px sans-serif`;
  g.textAlign = "right";
  g.fillText(SUITS[cardSuit(c)], cw * 0.92, ch * 0.06);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `${Math.round(cw * 0.5)}px sans-serif`;
  g.fillText(SUITS[cardSuit(c)], cw / 2, ch * 0.6);
  return cv;
}
