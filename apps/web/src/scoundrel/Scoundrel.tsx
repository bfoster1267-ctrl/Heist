// Scoundrel: 44-card roguelike dungeon crawler (Zach Gage & Kurt Bieg).
// Full feature parity: undo, queue banner, floating XP, haptics, sounds, win/loss states.

import {
  applyScoundrel, cardRank, cardRed, cardSuit, dealScoundrel,
  scoundrelCardKind, scoundrelCardValue, scoundrelGain, scoundrelPay,
  scoundrelRoom, SCOUNDREL_DAY_XP, SCOUNDREL_IDLE_S, SCOUNDREL_XP,
  tallyScoundrel, tallyScoundrelXp, type PlayingCard, type ScoundrelMove,
  type ScoundrelState, type ScoundrelTally,
} from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { reducedMotion } from "../prefs";
import { card as cardSound, click, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { shareDailyResult } from "../daily/shareHelpers";
import { VictoryModal } from "../arcade/VictoryModal";
import { getDailyStreak, getStreakMultiplier } from "@heist/profile";
import "./scoundrel.css";
import { t, tNodes } from "../i18n";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

const NOTHING: ScoundrelTally = { monstersSlayed: 0, roomsCleared: 0, hpLeft: 20, won: false };

export function Scoundrel({
  onExit,
  onHeist,
  banner,
  initialSeed,
  isDaily = false,
  challengerTime,
  challengerMoves,
  challengerScore,
}: {
  onExit: () => void;
  onHeist?: () => void;
  banner?: ReactNode;
  initialSeed?: number;
  isDaily?: boolean;
  challengerTime?: string | null;
  challengerMoves?: number | null;
  challengerScore?: number | null;
}) {
  const { backend, act, showReward, me } = useAccount();
  const initialDeal = useRef(true);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [game, setGame] = useState<{ gameId: string | null; seed: number } | null>(null);
  const [hist, setHist] = useState<ScoundrelState[]>([]);
  const [moves, setMoves] = useState<ScoundrelMove[]>([]);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [combatChoice, setCombatChoice] = useState<{ roomIndex: number; card: PlayingCard; pos: { x: number; y: number } } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const k = hist[hist.length - 1];
  const reduce = reducedMotion();
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;

  const tally = useMemo(() => {
    if (!game) return null;
    try {
      return tallyScoundrel(game.seed, moves);
    } catch {
      return null;
    }
  }, [game, moves]);

  const best = useRef(NOTHING);
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const banked = useRef(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  const meNow = useRef(me);
  meNow.current = me;
  const dayLeft = useRef(0);
  const live = useRef({ game, moves });
  live.current = { game, moves };

  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    const xp = Math.max(0, tallyScoundrelXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.scoundrelBank(g.gameId!, ms, drainRef.current));
    if (r?.reward && (show || r.reward.levelAfter > r.reward.levelBefore)) showReward(r.reward);
  }, [act, showReward]);

  useEffect(() => () => void bank(true), [bank]);
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") void bank(false);
      else lastAct.current = Date.now();
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [bank]);

  useEffect(() => {
    dayLeft.current = me ? scoundrelRoom(me.progress, Date.now()) : SCOUNDREL_DAY_XP;
  }, [me]);

  const deal = useCallback(async () => {
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    const g = backend ? await backend.scoundrelStart(firstSeed, dailyFlag).catch(() => null) : null;
    const seed = g ? g.seed : (firstSeed ?? Math.floor(Math.random() * 2 ** 31));
    const initial = dealScoundrel(seed);
    setGame({ gameId: g?.gameId ?? null, seed });
    setHist([initial]);
    setMoves([]);
    setArmed(false);
    setDone(false);
    setCombatChoice(null);
    setStarted(Date.now());
    setNow(Date.now());
    best.current = NOTHING;
    setDrain(0);
    banked.current = 0;
    cardSound();
    buzz("tap");
  }, [backend, initialSeed, isDaily]);

  useEffect(() => {
    void deal();
  }, [deal]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastAct.current > SCOUNDREL_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [done]);

  const spawnFloat = (x: number, y: number, xp: number, tag: string | null) => {
    if (xp <= 0) return;
    const fid = ++floatId.current;
    setFloats((fs) => [...fs, { id: fid, x, y, xp, tag }]);
    setTimeout(() => {
      setFloats((fs) => fs.filter((f) => f.id !== fid));
    }, 1400);
  };

  const applyMove = useCallback((m: ScoundrelMove, floatPos?: { x: number; y: number }, tag?: string) => {
    if (!k || k.dead || k.escaped) return;
    lastAct.current = Date.now();
    const next = applyScoundrel(k, m);
    if (next === k) return;

    const nextMoves = [...moves, m];
    setHist((h) => [...h, next]);
    setMoves(nextMoves);
    setCombatChoice(null);

    const prevTally = tally ?? NOTHING;
    const nextTally = tallyScoundrel(game?.seed ?? 0, nextMoves);
    const g = scoundrelGain(best.current, nextTally);
    best.current = g.paid;

    if (floatPos) {
      const xpGained = tallyScoundrelXp(g.gained);
      if (xpGained > 0) {
        spawnFloat(floatPos.x, floatPos.y, xpGained, tag ?? null);
      }
    }

    if (next.escaped && !done) {
      setDone(true);
      winSound();
      buzz("win");
      if (game?.gameId) {
        void act((x) => x.scoundrelFinish(game.gameId!, nextMoves, drainRef.current)).then((r) => {
          if (r?.reward) showReward(r.reward);
        });
      }
    } else if (next.dead) {
      buzz("alert");
    }
  }, [k, moves, tally, game, done, act, showReward]);

  const onCardClick = (roomIndex: number, card: PlayingCard, e: React.MouseEvent) => {
    if (!k || k.dead || k.escaped) return;
    const kind = scoundrelCardKind(card);
    const val = scoundrelCardValue(card);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = { x: rect.left + rect.width / 2, y: rect.top };

    if (kind === "potion") {
      cardSound();
      buzz("tap");
      const heals = !k.potionUsedThisRoom ? Math.min(val, k.maxHp - k.hp) : 0;
      applyMove({ kind: "pick", roomIndex }, pos, heals > 0 ? t("sc.hp", { n: heals }) : t("sc.discarded"));
      return;
    }

    if (kind === "weapon") {
      cardSound();
      buzz("bump");
      applyMove({ kind: "pick", roomIndex }, pos, t("sc.weaponTag", { n: val }));
      return;
    }

    if (kind === "monster") {
      if (k.weapon) {
        // Prompt combat choice between weapon and barehanded
        setCombatChoice({ roomIndex, card, pos });
      } else {
        // Barehanded fight
        cardSound();
        buzz("bump");
        applyMove({ kind: "pick", roomIndex, useWeapon: false }, pos, t("sc.monsterTag"));
      }
    }
  };

  const onFlee = () => {
    if (!k || k.dead || k.escaped || !k.canFlee || k.cardsResolvedInRoom > 0) return;
    click();
    buzz("tap");
    applyMove({ kind: "flee" });
  };

  const onUndo = () => {
    if (hist.length <= 1 || done) return;
    cardSound();
    buzz("tap");
    setHist((h) => h.slice(0, -1));
    setMoves((m) => m.slice(0, -1));
    setCombatChoice(null);
  };

  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs < 10 ? "0" : ""}${secs}`;

  const currentXp = Math.max(0, tallyScoundrelXp(tally ?? NOTHING) - drain);

  return (
    <div className="sc" ref={board}>
      <div className="sc-felt-rim" />

      {/* Top action bar */}
      <div className="sc-bar">
        <button
          className="sc-icon-btn"
          onClick={() => {
            click();
            buzz("tap");
            onExit();
          }}
          title={t("solo.exit")}
          aria-label={t("solo.exit")}
        >
          ✕
        </button>

        <div className="sc-hud">
          <div className="sc-hud-name">
            {t("arc.scoundrel.title").toUpperCase()}
            <span className="arcade-trust-pill">{t("solo.free")}</span>
          </div>
          <div className="sc-hud-stats">
            <span>{timeStr}</span>
            <span className="sc-dot">•</span>
            <span>{tNodes("sc.rooms", { b: <b>{k?.roomsCleared ?? 0}</b> })}</span>
            <span className="sc-dot">•</span>
            <span>{tNodes("sc.monsters", { b: <b>{k?.monstersSlayed ?? 0}</b> })}</span>
            <span className="sc-dot">•</span>
            <b className="sc-xp">+{currentXp} XP</b>
            <span className="sc-dot">•</span>
            <span className="arcade-streak-pill">{streak > 0 ? t("solo.streakD", { n: streak }) : t("solo.day1")}</span>
          </div>
        </div>

        <button
          className="sc-icon-btn"
          onClick={onUndo}
          disabled={hist.length <= 1 || done}
          title={t("solo.undo")}
          aria-label={t("solo.undo")}
        >
          ↶
        </button>

        <button
          className={`sc-icon-btn ${armed ? "armed" : ""}`}
          onClick={() => {
            click();
            buzz("tap");
            if (armed) void deal();
            else {
              setArmed(true);
              setTimeout(() => setArmed(false), 3000);
            }
          }}
          title={armed ? t("sc.newQ") : t("sc.new")}
          aria-label={armed ? t("sc.newConfirm") : t("sc.new")}
        >
          {armed ? <span className="sc-sure">{t("solo.NEWQ")}</span> : "↻"}
        </button>
      </div>

      {banner && (
        <div style={{ position: "absolute", top: 52, left: 0, right: 0, zIndex: 590, display: "flex", justifyContent: "center" }}>
          {banner}
        </div>
      )}

      {/* Main Board */}
      <div className="sc-board" style={{ marginTop: banner ? 46 : 6 }}>
        {k && (
          <>
            {/* Status Panel: Health Bar & Equipment */}
            <div className="sc-status-panel">
              {/* HP Bar */}
              <div className="sc-hp-box">
                <div className="sc-hp-label">
                  <span>{t("sc.health")}</span>
                </div>
                <div className="sc-hp-track">
                  <div
                    className="sc-hp-fill"
                    style={{ width: `${Math.max(0, (k.hp / k.maxHp) * 100)}%` }}
                  />
                </div>
                <div className="sc-hp-val">
                  {k.hp} / {k.maxHp}
                </div>
              </div>

              {/* Weapon & Dungeon Count Row */}
              <div className="sc-equip-row">
                <div className="sc-weapon-box">
                  <span className="sc-weapon-icon">⚔️</span>
                  <div className="sc-weapon-info">
                    <span className="sc-weapon-title">
                      {k.weapon ? t("sc.equipped", { n: k.weapon.power }) : t("sc.bare")}
                    </span>
                    <span className="sc-weapon-sub">
                      {k.weapon
                        ? k.weapon.lastDefeated !== undefined
                          ? t("sc.canAttack", { n: k.weapon.lastDefeated })
                          : t("sc.fresh", { n: k.weapon.power })
                        : t("sc.fullDmg")}
                    </span>
                  </div>
                </div>

                <div className="sc-dungeon-count">
                  <span>{t("sc.dungeon")}</span>
                  <b>{t("sc.left", { n: k.dungeon.length })}</b>
                </div>
              </div>
            </div>

            {/* Dungeon Room Cards */}
            <div className="sc-room-wrap">
              <div className="sc-room-header">
                <span>{k.dungeon.length === 0 ? t("sc.roomAll") : t("sc.roomPick")}</span>
                <span>
                  {tNodes("sc.resolved", { b: <b>{k.cardsResolvedInRoom} / {k.dungeon.length === 0 ? k.room.filter((c) => c !== null).length + k.cardsResolvedInRoom : 3}</b> })}
                </span>
              </div>

              <div className="sc-cards-grid">
                {k.room.map((card, idx) => {
                  if (card === null) {
                    return <div key={idx} className="sc-card-slot" />;
                  }

                  const kind = scoundrelCardKind(card);
                  const val = scoundrelCardValue(card);
                  const rank = cardRank(card);
                  const suit = cardSuit(card);
                  const red = cardRed(card);

                  let badgeLabel = "";
                  if (kind === "monster") badgeLabel = t("sc.monster", { n: val });
                  else if (kind === "weapon") badgeLabel = t("sc.weapon", { n: val });
                  else if (kind === "potion") {
                    badgeLabel = k.potionUsedThisRoom ? t("sc.discard") : t("sc.heal", { n: val });
                  }

                  return (
                    <div key={idx} className="sc-card-slot">
                      <div
                        className={`sc-card ${red ? "red" : ""}`}
                        onClick={(e) => onCardClick(idx, card, e)}
                        role="button"
                        tabIndex={0}
                        aria-label={t("sc.cardAria", { label: badgeLabel, rank: RANKS[rank], suit: SUITS[suit] })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onCardClick(idx, card, e as any);
                          }
                        }}
                      >
                        <div className={`sc-card-badge ${kind}`}>{badgeLabel}</div>

                        <div className="sc-card-corner">
                          <span className="sc-card-rank">{RANKS[rank]}</span>
                          <span className="sc-card-suit">{SUITS[suit]}</span>
                        </div>

                        <div className="sc-card-center">
                          {kind === "monster" ? "💀" : kind === "weapon" ? "🗡️" : "🧪"}
                        </div>

                        <div className="sc-card-desc">
                          {kind === "monster"
                            ? t("sc.atk", { n: val })
                            : kind === "weapon"
                            ? t("sc.pwr", { n: val })
                            : k.potionUsedThisRoom
                            ? t("sc.discard")
                            : t("sc.hp", { n: val })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions Row */}
            <div className="sc-actions-row">
              <button
                className="sc-action-btn flee"
                onClick={onFlee}
                disabled={!k.canFlee || k.cardsResolvedInRoom > 0 || k.dungeon.length === 0 || k.room.filter((c) => c !== null).length < 4}
                aria-label={t("sc.fleeAria")}
                title={
                  !k.canFlee
                    ? t("sc.noFleeTwice")
                    : k.cardsResolvedInRoom > 0
                    ? t("sc.fleeBefore")
                    : k.dungeon.length === 0
                    ? t("sc.fleeEmpty")
                    : t("sc.fleeHow")
                }
              >
                {t("sc.flee")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Combat Choice Modal */}
      {combatChoice && k && (
        <div className="sc-choice-overlay" onClick={() => setCombatChoice(null)}>
          <div className="sc-choice-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-choice-title">{t("sc.fight")}</div>
            {(() => {
              const val = scoundrelCardValue(combatChoice.card);
              const weapon = k.weapon;
              const canUseWeapon =
                weapon && (weapon.lastDefeated === undefined || val <= weapon.lastDefeated);
              const weaponDmg = weapon ? Math.max(0, val - weapon.power) : val;

              return (
                <>
                  <div className="sc-choice-sub">
                    {tNodes("sc.monsterHas", { b: <b>{t("sc.power", { n: val })}</b> })}
                  </div>

                  <div className="sc-choice-btns">
                    <button
                      className="sc-choice-btn primary"
                      disabled={!canUseWeapon}
                      aria-label={t("sc.useAria", { n: weapon?.power ?? 0 })}
                      onClick={() => {
                        cardSound();
                        buzz("bump");
                        applyMove(
                          {
                            kind: "pick",
                            roomIndex: combatChoice.roomIndex,
                            useWeapon: true,
                          },
                          combatChoice.pos,
                          t("sc.slayed")
                        );
                      }}
                    >
                      <span>{t("sc.use", { n: weapon?.power ?? 0 })}</span>
                      <span>{t("sc.take", { n: weaponDmg })}</span>
                    </button>
                    {!canUseWeapon && weapon && (
                      <small style={{ color: "#ff8a80", fontSize: "11px" }}>
                        {t("sc.durability", { n: weapon.lastDefeated ?? 0 })}
                      </small>
                    )}

                    <button
                      className="sc-choice-btn"
                      aria-label={t("sc.bareAria", { n: val })}
                      onClick={() => {
                        cardSound();
                        buzz("bump");
                        applyMove(
                          {
                            kind: "pick",
                            roomIndex: combatChoice.roomIndex,
                            useWeapon: false,
                          },
                          combatChoice.pos,
                          t("sc.barehandedTag")
                        );
                      }}
                    >
                      <span>{t("sc.bareBtn")}</span>
                      <span>{t("sc.take", { n: val })}</span>
                    </button>
                  </div>

                  <button
                    className="sc-choice-cancel"
                    onClick={() => {
                      click();
                      buzz("tap");
                      setCombatChoice(null);
                    }}
                    aria-label={t("sc.cancelAria")}
                  >
                    {t("common.cancel")}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Floating XP numbers */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="sc-float"
            initial={{ opacity: 0, y: f.y + 10, x: f.x, scale: 0.8 }}
            animate={{ opacity: 1, y: f.y - 30, x: f.x, scale: 1.15 }}
            exit={{ opacity: 0, y: f.y - 60, scale: 0.9 }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          >
            <span>+{f.xp} XP</span>
            {f.tag && <span className="sc-float-tag">{f.tag}</span>}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Game Over Screen */}
      {k?.dead && (
        <motion.div
          className="sc-modal-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="sc-result-card">
            <div className="sc-result-title dead">{t("sc.died")}</div>
            <div className="sc-result-sub">
              {tNodes("sc.slain", {
                m: <b>{t("sc.nMonsters", { count: k.monstersSlayed })}</b>,
                r: <b>{t("sc.nRooms", { count: k.roomsCleared })}</b>,
              })}
            </div>
            <div className="sc-result-btns">
              {hist.length > 1 && (
                <button
                  className="sc-result-btn secondary"
                  onClick={onUndo}
                  aria-label={t("sc.undoAria")}
                >
                  {t("sc.undo")}
                </button>
              )}
              <button
                className="sc-result-btn"
                onClick={() => {
                  cardSound();
                  buzz("tap");
                  void deal();
                }}
                aria-label={t("sc.againAria")}
              >
                {t("sc.again")}
              </button>
              <button
                className="sc-result-btn secondary"
                onClick={() => {
                  click();
                  buzz("tap");
                  onExit();
                }}
                aria-label={t("solo.back")}
              >
                {t("solo.lobby")}

              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Victory Modal */}
      {k?.escaped && !k.dead && (
        <VictoryModal
          game="scoundrel"
          gameTitle="Scoundrel"
          moves={moves.length}
          score={k.hp}
          isDaily={isDaily}
          progress={me?.progress}
          onDealAgain={() => void deal()}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="scoundrel"
            gameTitle="Scoundrel"
            seed={game.seed}
            score={k?.hp}
            challengerTime={challengerTime}
            challengerMoves={challengerMoves}
            challengerScore={challengerScore}
            onClose={() => setChallengeOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
