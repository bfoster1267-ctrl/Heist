// Minesweeper: the classic logic puzzle as a vault job. Steel deposit tiles on the felt, a cascade that
// opens like tumblers falling, an alarm on a mine and the vault door swinging open on a win.
// The server lays the field from the seed and the first click and replays every click before it pays.

import {
  applyMines, dealMines, getDailyStreak, isMinesLevel, minesGain, minesLeft, minesweeperRoom, tallyMinesXp,
  MINES_DAILY_LEVEL, MINES_DAY_XP, MINES_IDLE_S, MINES_LEVELS, MINES_LEVEL_IDS, MINES_XP,
  type MinesLevel, type MinesMove, type MinesState, type MinesTally,
} from "@heist/profile";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAccount } from "../account/useAccount";
import { buzz } from "../haptics";
import { useReducedMotion } from "../prefs";
import { card as cardSound, cardSlam, chip, chipRun, click, foundationChime, lose as loseSound, win as winSound } from "../sound";
import { FriendChallengeModal } from "../daily/FriendChallengeModal";
import { VictoryModal } from "../arcade/VictoryModal";
import "./minesweeper.css";
import { t, tNodes, tRich, type TKey } from "../i18n";

const LEVEL_KEY = "heist.mines.level";
const HOWTO_KEY = "heist.mines.howto";
/** hold this long on a tile to flag it */
const LONG_PRESS_MS = 380;
/** the board's name in the player's language (i18n/areas/minesweeper.ts) */
const levelLabel = (l: MinesLevel) => t(`ms.lv.${l}` as TKey);


interface Float {
  id: number;
  x: number;
  y: number;
  xp: number;
  tag: string | null;
}

function savedLevel(): MinesLevel {
  try {
    const q = new URLSearchParams(location.search).get("level");
    if (isMinesLevel(q)) return q;
    const v = localStorage.getItem(LEVEL_KEY);
    return isMinesLevel(v) ? v : "beginner";
  } catch {
    return "beginner";
  }
}

const tallyOf = (s: MinesState): MinesTally => ({ cells: Math.max(0, s.open - s.opening), won: s.won, level: s.level });

/** A three-digit LED readout, like the original's counters. */
const led = (n: number) => (n < 0 ? "-" + String(Math.min(99, -n)).padStart(2, "0") : String(Math.min(999, n)).padStart(3, "0"));

function MineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ms-mine-svg" aria-hidden>
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <line x1="12" y1="2.5" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="21.5" y2="12" />
        <line x1="5.3" y1="5.3" x2="18.7" y2="18.7" />
        <line x1="18.7" y1="5.3" x2="5.3" y2="18.7" />
      </g>
      <circle cx="12" cy="12" r="6.6" fill="currentColor" />
      <circle cx="9.8" cy="9.6" r="1.9" fill="rgba(255,255,255,0.75)" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ms-flag-svg" aria-hidden>
      <rect x="6" y="3" width="2.2" height="17" rx="1" fill="#d9c07a" />
      <path d="M8.2 3.6 L19 7.6 L8.2 11.8 Z" fill="#e0412b" />
      <path d="M8.2 3.6 L19 7.6 L8.2 7.9 Z" fill="rgba(255,255,255,0.25)" />
      <rect x="3.5" y="19" width="9" height="2.4" rx="1.1" fill="#b8902e" />
    </svg>
  );
}

/** The vault door that swings open on a win. */
function VaultDoor({ reduce }: { reduce: boolean }) {
  return (
    <motion.div
      className="ms-vault-door"
      initial={{ rotateY: 0 }}
      animate={reduce ? { opacity: 0 } : { rotateY: -104 }}
      transition={{ delay: reduce ? 0.2 : 0.95, duration: reduce ? 0.3 : 0.8, ease: [0.6, 0.05, 0.3, 1] }}
    >
      <svg viewBox="0 0 200 200" aria-hidden>
        <defs>
          <radialGradient id="msDoor" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#5a6170" />
            <stop offset="55%" stopColor="#2a2f38" />
            <stop offset="100%" stopColor="#14171c" />
          </radialGradient>
          <linearGradient id="msRim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f6d77a" />
            <stop offset="50%" stopColor="#b98a1f" />
            <stop offset="100%" stopColor="#f0c552" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#msRim)" />
        <circle cx="100" cy="100" r="88" fill="url(#msDoor)" />
        {Array.from({ length: 12 }, (_, k) => {
          const a = (k / 12) * Math.PI * 2;
          return <circle key={k} cx={100 + Math.cos(a) * 78} cy={100 + Math.sin(a) * 78} r="4.2" fill="#c9a24a" stroke="#6b5216" strokeWidth="1" />;
        })}
        <motion.g
          style={{ originX: "100px", originY: "100px" }}
          initial={{ rotate: 0 }}
          animate={{ rotate: reduce ? 0 : -300 }}
          transition={{ duration: 0.9, ease: [0.5, 0, 0.3, 1] }}
        >
          <circle cx="100" cy="100" r="34" fill="none" stroke="url(#msRim)" strokeWidth="5" />
          {[0, 60, 120].map((d) => (
            <rect key={d} x="96" y="40" width="8" height="120" rx="4" fill="url(#msRim)" transform={`rotate(${d} 100 100)`} />
          ))}
          <circle cx="100" cy="100" r="13" fill="#e7b53c" stroke="#6b5216" strokeWidth="2" />
        </motion.g>
      </svg>
    </motion.div>
  );
}

/** The free board area, measured, so the field always fits (upright phone, sideways phone or desktop). */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    window.addEventListener("orientationchange", read);
    return () => {
      ro?.disconnect();
      window.removeEventListener("orientationchange", read);
    };
  }, []);
  return [ref, box] as const;
}

export function Minesweeper({
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
  const reduce = useReducedMotion();
  const initialDeal = useRef(true);
  const [level, setLevel] = useState<MinesLevel>(() => (isDaily ? MINES_DAILY_LEVEL : savedLevel()));
  const [game, setGame] = useState<{ gameId: string | null; seed: number; level: MinesLevel; daily: boolean } | null>(null);
  const [s, setS] = useState<MinesState | null>(null);
  const [moves, setMoves] = useState<MinesMove[]>([]);
  const [flagMode, setFlagMode] = useState(false);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [picker, setPicker] = useState(false);
  const [armed, setArmed] = useState(false);
  const [cracking, setCracking] = useState(false);
  const [victory, setVictory] = useState(false);
  const [lostCard, setLostCard] = useState(false);
  const [fieldRef, animateField] = useAnimate<HTMLDivElement>();
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [howto, setHowto] = useState(() => {
    try {
      return !localStorage.getItem(HOWTO_KEY);
    } catch {
      return false;
    }
  });
  const [floats, setFloats] = useState<Float[]>([]);
  const floatId = useRef(0);
  /** how long each newly opened tile waits before it flips, so a cascade ripples out from the click */
  const delays = useRef(new Map<number, number>());
  const timers = useRef<number[]>([]);
  const streak = me?.progress ? getDailyStreak(me.progress, Date.now()) : 0;
  const [wrapRef, box] = useBox<HTMLDivElement>();

  // ---- banking: what the board earned, paid as it goes (the same pattern as every arcade game) ----------
  const best = useRef<MinesTally>({ cells: 0, won: false, level });
  const [drain, setDrain] = useState(0);
  const drainRef = useRef(0);
  drainRef.current = drain;
  const lastAct = useRef(Date.now());
  const banked = useRef(0);
  const live = useRef({ game, moves });
  live.current = { game, moves };
  const dayLeft = useRef(MINES_DAY_XP);

  const bank = useCallback(async (show: boolean) => {
    const { game: g, moves: ms } = live.current;
    const xp = Math.max(0, tallyMinesXp(best.current) - drainRef.current);
    if (!g?.gameId || xp <= banked.current) return;
    if (best.current.won) return;
    banked.current = xp;
    const r = await act((x) => x.minesweeperBank(g.gameId!, ms, drainRef.current));
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
    dayLeft.current = me ? minesweeperRoom(me.progress, Date.now()) : MINES_DAY_XP;
  }, [me]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const later = (f: () => void, ms: number) => {
    timers.current.push(window.setTimeout(f, ms));
  };

  const deal = useCallback(async (lv: MinesLevel) => {
    const firstSeed = initialDeal.current ? initialSeed : undefined;
    const dailyFlag = initialDeal.current ? isDaily : false;
    initialDeal.current = false;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    const g = backend ? await backend.minesweeperStart(firstSeed, dailyFlag, lv).catch(() => null) : null;
    const seed = g ? g.seed : (firstSeed ?? Math.floor(Math.random() * 2 ** 31));
    const realLevel = g?.level ?? (dailyFlag ? MINES_DAILY_LEVEL : lv);
    setLevel(realLevel);
    setGame({ gameId: g?.gameId ?? null, seed, level: realLevel, daily: dailyFlag });
    setS(dealMines(seed, realLevel));
    setMoves([]);
    setStartAt(null);
    setEndAt(null);
    setNow(Date.now());
    setArmed(false);
    setCracking(false);
    setVictory(false);
    setLostCard(false);
    setFlagMode(false);
    delays.current = new Map();
    best.current = { cells: 0, won: false, level: realLevel };
    setDrain(0);
    banked.current = 0;
    lastAct.current = Date.now();
    cardSound(3);
    buzz("tap");
  }, [backend, initialSeed, isDaily]);

  useEffect(() => {
    void deal(level);
    // first deal only: later deals come from the buttons
  }, []);

  /** Pay what this board earned, then lay a new one. */
  const newBoard = useCallback(async (lv: MinesLevel) => {
    try {
      localStorage.setItem(LEVEL_KEY, lv);
    } catch {
      /* fine without */
    }
    void bank(true);
    await deal(lv);
  }, [bank, deal]);

  const playing = !!s && !!startAt && !s.won && !s.lost;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastAct.current > MINES_IDLE_S * 1000) {
        setDrain((d) => d + 1);
        lastAct.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [playing]);

  const spawnFloat = (x: number, y: number, xp: number, tag: string | null) => {
    if (xp <= 0 && !tag) return;
    const fid = ++floatId.current;
    setFloats((fs) => [...fs, { id: fid, x, y, xp, tag }]);
    later(() => setFloats((fs) => fs.filter((f) => f.id !== fid)), 1400);
  };

  const play = (m: MinesMove, at?: { x: number; y: number }) => {
    if (!s || !game || s.won || s.lost) return;
    lastAct.current = Date.now();
    const next = applyMines(s, m);
    if (next === s) {
      if (m.k === "c" || (m.k === "r" && s.revealed[m.i])) buzz("tap");
      return;
    }
    const nextMoves = [...moves, m];
    const row = (i: number) => Math.floor(i / next.cols);
    const col = (i: number) => i % next.cols;
    const fresh: number[] = [];
    for (let i = 0; i < next.revealed.length; i++) if (next.revealed[i] && !s.revealed[i]) fresh.push(i);
    for (const c of fresh) {
      const d = Math.max(Math.abs(row(c) - row(m.i)), Math.abs(col(c) - col(m.i)));
      delays.current.set(c, reduce ? 0 : Math.min(720, d * 30));
    }
    setS(next);
    setMoves(nextMoves);
    if (!startAt && next.mines) {
      setStartAt(Date.now());
      setNow(Date.now());
    }

    // XP: whatever this click opened beyond what was already paid
    const g = minesGain(best.current, tallyOf(next));
    best.current = g.paid;
    const gainedXp = Math.min(tallyMinesXp(g.gained), Math.max(0, dayLeft.current));
    if (at && gainedXp > 0) spawnFloat(at.x, at.y, gainedXp, fresh.length > 6 ? t("ms.tiles", { n: fresh.length }) : null);

    if (m.k === "f") {
      chip();
      buzz("tap");
    } else if (next.lost) {
      const boom = next.exploded!;
      // the rest of the mines go off in a ripple from the one that blew
      next.mines!.forEach((mine, c) => {
        if (!mine || c === boom) return;
        const d = Math.max(Math.abs(row(c) - row(boom)), Math.abs(col(c) - col(boom)));
        delays.current.set(c, reduce ? 0 : 160 + d * 45);
      });
      delays.current.set(boom, 0);
      cardSlam();
      buzz("alert");
      if (!reduce && fieldRef.current) void animateField(fieldRef.current, { x: [0, -10, 9, -7, 5, -3, 0] }, { duration: 0.5 });
      setEndAt(Date.now());
      later(() => loseSound(), 260);
      later(() => setLostCard(true), reduce ? 300 : 1100);
    } else if (fresh.length > 1) {
      if (fresh.length > 10) chipRun(Math.min(12, Math.ceil(fresh.length / 6)));
      else cardSound(Math.min(3, fresh.length));
      buzz("bump");
    } else if (fresh.length === 1) {
      const n = next.adj[fresh[0]];
      if (n > 0) foundationChime(Math.min(13, n * 2));
      else click();
      buzz("tap");
    }

    if (next.won) {
      setEndAt(Date.now());
      winSound();
      buzz("win");
      setCracking(true);
      later(() => {
        setCracking(false);
        setVictory(true);
      }, reduce ? 500 : 2300);
      if (game.gameId) {
        void act((x) => x.minesweeperFinish(game.gameId!, nextMoves, drainRef.current)).then((r) => {
          if (r?.reward) showReward(r.reward);
        });
      }
    }
  };

  // ---- the field's layout: turned sideways when that gives bigger tiles (Expert on an upright phone) ----
  const rows = s?.rows ?? MINES_LEVELS[level].rows;
  const cols = s?.cols ?? MINES_LEVELS[level].cols;
  // the frame's padding and border take 18px, the wrap's padding 8px
  const W = Math.max(0, box.w - 26);
  const H = Math.max(0, box.h - 26);
  const flat = Math.min(W / cols, H / rows);
  const turned = Math.min(W / rows, H / cols);
  const rotate = cols !== rows && turned > flat * 1.08;
  const dRows = rotate ? cols : rows;
  const dCols = rotate ? rows : cols;
  const tile = Math.max(14, Math.min(46, Math.floor(rotate ? turned : flat)));
  /** the cell shown at display row dr, column dc */
  const cellAt = (dr: number, dc: number) => (rotate ? dc * cols + dr : dr * cols + dc);

  // ---- touch: tap to dig (or flag in flag mode), hold to flag, tap a number to chord; right-click flags ---
  const press = useRef<{ i: number; x: number; y: number; timer: number; long: boolean } | null>(null);
  /** when the last long press fired (a phone's own long-press menu event right after it is ignored) */
  const lastLong = useRef(0);
  const indexOf = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest?.("[data-i]") as HTMLElement | null;
    return el ? Number(el.dataset.i) : -1;
  };
  const posOf = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest?.("[data-i]") as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top } : undefined;
  };
  const tap = (i: number, at?: { x: number; y: number }, flagIt = flagMode) => {
    if (!s) return;
    if (s.revealed[i]) play({ k: "c", i }, at);
    else play(flagIt ? { k: "f", i } : { k: "r", i }, at);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!s || s.won || s.lost) return;
    const i = indexOf(e.target);
    if (i < 0) return;
    if (e.button === 1) {
      e.preventDefault();
      play({ k: "c", i }, posOf(e.target));
      return;
    }
    if (e.button !== 0) return;
    const at = posOf(e.target);
    const p = {
      i,
      x: e.clientX,
      y: e.clientY,
      long: false,
      timer: window.setTimeout(() => {
        if (press.current !== p) return;
        p.long = true;
        lastLong.current = Date.now();
        if (!s.revealed[i]) {
          // a long press does the opposite of the mode: flags while digging, digs while flagging
          tap(i, at, !flagMode);
          buzz("bump");
        }
      }, LONG_PRESS_MS),
    };
    press.current = p;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) {
      clearTimeout(p.timer);
      press.current = null;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.long) return;
    if (indexOf(e.target) !== p.i) return;
    tap(p.i, posOf(e.target));
  };
  const onPointerCancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const i = indexOf(e.target);
    if (i < 0 || !s || Date.now() - lastLong.current < 800) return;
    if (s.revealed[i]) play({ k: "c", i }, posOf(e.target));
    else play({ k: "f", i }, posOf(e.target));
  };

  // keyboard: F toggles flag mode, N asks for a new board
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "f" || e.key === "F") {
        setFlagMode((f) => !f);
        click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const elapsed = startAt ? Math.max(0, Math.floor(((endAt ?? now) - startAt) / 1000)) : 0;
  const timeStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const currentXp = Math.max(0, tallyMinesXp(s ? tallyOf(s) : best.current) - drain);
  const left = s ? minesLeft(s) : MINES_LEVELS[level].mines;
  const safeTotal = s ? s.rows * s.cols - s.mineCount : 1;
  const progressPct = s ? Math.round((s.open / safeTotal) * 100) : 0;
  const face = !s ? "idle" : s.lost ? "lost" : s.won ? "won" : "idle";

  const closeHowto = () => {
    setHowto(false);
    click();
    try {
      localStorage.setItem(HOWTO_KEY, "1");
    } catch {
      /* fine without */
    }
  };

  const cells: ReactNode[] = [];
  if (s) {
    for (let dr = 0; dr < dRows; dr++) {
      for (let dc = 0; dc < dCols; dc++) {
        const i = cellAt(dr, dc);
        const open = s.revealed[i];
        const mine = !!s.mines?.[i];
        const flag = s.flagged[i] && !open;
        const showMine = s.lost && mine && !open && !flag;
        const wrong = s.lost && flag && !mine;
        const n = s.adj[i];
        const delay = delays.current.get(i) ?? 0;
        let cls = "ms-cell";
        if (open) cls += mine ? " open boom" : ` open n${n}`;
        else if (showMine) cls += " shut mine-show";
        else cls += " shut";
        if (flag) cls += wrong ? " flag wrong" : " flag";
        if (s.won && mine) cls += " won-mine";
        cells.push(
          <div
            key={i}
            data-i={i}
            className={cls}
            style={open || showMine ? { animationDelay: `${delay}ms` } : undefined}
          >
            {open ? (mine ? <MineIcon /> : n > 0 ? <span className="ms-num">{n}</span> : null) : flag ? <FlagIcon /> : showMine ? <MineIcon /> : null}
          </div>,
        );
      }
    }
  }

  const levelInfo = { ...MINES_LEVELS[level], label: levelLabel(level) };
  const inProgress = !!s && !!startAt && !s.won && !s.lost;

  return (
    <div className="ms" data-level={level}>
      <div className="ms-felt-rim" />

      {/* Top bar */}
      <div className="ms-bar">
        <button
          className="ms-icon-btn"
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
        <div className="ms-hud">
          <div className="ms-hud-name">
            {t("ms.title")}
            <span className="arcade-trust-pill">{t("solo.free")}</span>
          </div>
          <div className="ms-hud-stats">
            <span>{game?.daily ? t("ms.daily") : ""}{levelInfo.label}</span>
            <span className="ms-dot">•</span>
            <span>{t("ms.cracked", { n: progressPct })}</span>
            <span className="ms-dot">•</span>
            <b className="ms-xp">+{currentXp} XP</b>
            <span className="ms-dot">•</span>
            <span className="arcade-streak-pill">{streak > 0 ? t("solo.streakD", { n: streak }) : t("solo.day1")}</span>
          </div>
        </div>
        <button
          className="ms-icon-btn"
          onClick={() => {
            click();
            buzz("tap");
            setPicker(true);
          }}
          title={t("ms.size")}
          aria-label={t("ms.chooseSize")}
        >
          ▦
        </button>
        <button
          className={`ms-icon-btn ${armed ? "armed" : ""}`}
          onClick={() => {
            click();
            buzz("tap");
            if (!inProgress || armed) void newBoard(level);
            else {
              setArmed(true);
              later(() => setArmed(false), 3000);
            }
          }}
          title={armed ? t("ms.layNew") : t("ms.newBoard")}
          aria-label={armed ? t("ms.confirmNew") : t("ms.newBoard")}
        >
          {armed ? <span className="ms-sure">{t("solo.NEWQ")}</span> : "↻"}
        </button>
      </div>

      {banner && <div className="ms-banner">{banner}</div>}

      {/* Counters and the vault dial */}
      <div className="ms-panel" style={{ marginTop: banner ? 46 : 0 }}>
        <div className="ms-led" aria-label={t("ms.minesLeft", { n: left })}>
          <span className="ms-led-ghost">888</span>
          <span className="ms-led-val">{led(left)}</span>
          <small>{t("ms.MINES")}</small>
        </div>
        <button
          className={`ms-dial ${face}`}
          onClick={() => {
            click();
            buzz("tap");
            if (!inProgress || armed) void newBoard(level);
            else {
              setArmed(true);
              later(() => setArmed(false), 3000);
            }
          }}
          aria-label={t("ms.newBoard")}
          title={t("ms.newBoard")}
        >
          <span className="ms-dial-ring" />
          <span className="ms-dial-face">{face === "lost" ? "✕" : face === "won" ? "★" : armed ? "?" : ""}</span>
        </button>
        <div className="ms-led" aria-label={t("ms.timeAria", { time: timeStr })}>
          <span className="ms-led-ghost">888</span>
          <span className="ms-led-val">{led(elapsed)}</span>
          <small>{t("ms.TIME")}</small>
        </div>
      </div>

      {/* The field */}
      <div className="ms-wrap" ref={wrapRef}>
        {s && (
          <div
            key={`${game?.seed}-${game?.level}`}
            ref={fieldRef}
            className={`ms-field ${s.lost ? "is-lost" : ""} ${s.won ? "is-won" : ""} ${flagMode ? "flag-mode" : ""}`}
            role="grid"
            aria-label={t("ms.field", { level: levelInfo.label, n: left })}
            style={{
              gridTemplateColumns: `repeat(${dCols}, ${tile}px)`,
              gridAutoRows: `${tile}px`,
              fontSize: Math.round(tile * 0.6),
              "--tile": `${tile}px`,
            } as CSSProperties}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerCancel}
            onContextMenu={onContextMenu}
          >
            {cells}
          </div>
        )}
      </div>

      {/* Dig / flag switch for touch */}
      <div className="ms-tools">
        <div className="ms-mode" role="radiogroup" aria-label={t("ms.tapAction")}>
          <button
            className={!flagMode ? "on" : ""}
            role="radio"
            aria-checked={!flagMode}
            onClick={() => {
              setFlagMode(false);
              click();
              buzz("tap");
            }}
          >
            <span className="ms-mode-ico">⛏</span> {t("ms.dig")}
          </button>
          <button
            className={flagMode ? "on flag" : ""}
            role="radio"
            aria-checked={flagMode}
            onClick={() => {
              setFlagMode(true);
              chip();
              buzz("tap");
            }}
          >
            <span className="ms-mode-ico"><FlagIcon /></span> {t("ms.flag")}
          </button>
        </div>
        <div className="ms-tip">{flagMode ? t("ms.tipFlag") : t("ms.tipDig")}{t("ms.tipChord")}</div>
      </div>

      {/* Floating XP */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div
            key={f.id}
            className="ms-float"
            initial={{ opacity: 0, y: f.y + 10, x: f.x, scale: 0.8 }}
            animate={{ opacity: 1, y: f.y - 34, x: f.x, scale: 1.12 }}
            exit={{ opacity: 0, y: f.y - 64, scale: 0.9 }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          >
            {f.xp > 0 && <span>+{f.xp} XP</span>}
            {f.tag && <span className="ms-float-tag">{f.tag}</span>}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* The vault cracks open */}
      <AnimatePresence>
        {cracking && (
          <motion.div className="ms-crack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="ms-crack-rays"
              initial={{ scale: 0.2, opacity: 0, rotate: 0 }}
              animate={{ scale: 1.4, opacity: 1, rotate: 40 }}
              transition={{ delay: reduce ? 0 : 1.0, duration: 1.2, ease: "easeOut" }}
            />
            <div className="ms-crack-stage">
              <motion.div
                className="ms-crack-gold"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: reduce ? 0 : 1.1, duration: 0.5 }}
              >
                ◆
              </motion.div>
              <VaultDoor reduce={reduce} />
            </div>
            <motion.div
              className="ms-crack-title"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 1.25, duration: 0.45 }}
            >
              {t("ms.crackedT")}
              <small>{t("ms.crackedSub", { level: levelInfo.label, time: timeStr, xp: MINES_XP.win[level] })}</small>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The alarm went off */}
      <AnimatePresence>
        {lostCard && s?.lost && (
          <motion.div
            className="ms-lost"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <div className="ms-lost-title">{t("ms.alarm")}</div>
            <div className="ms-lost-sub">
              {tNodes("ms.lostSub", { b: <b>{s.open}</b> }, { total: safeTotal, pct: progressPct, time: timeStr })}
            </div>
            <div className="ms-lost-btns">
              <button
                className="ms-btn gold"
                onClick={() => {
                  cardSound();
                  buzz("tap");
                  void newBoard(level);
                }}
              >
                {t("ms.NEWBOARD")}
              </button>
              <button
                className="ms-btn"
                onClick={() => {
                  click();
                  buzz("tap");
                  setPicker(true);
                }}
              >
                {t("ms.SIZE")}
              </button>
              <button
                className="ms-btn"
                onClick={() => {
                  click();
                  buzz("tap");
                  setLostCard(false);
                }}
              >
                {t("ms.SEE")}
              </button>
              <button
                className="ms-btn"
                onClick={() => {
                  click();
                  buzz("tap");
                  onExit();
                }}
              >
                {t("solo.lobby")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Board size picker */}
      <AnimatePresence>
        {picker && (
          <motion.div className="ms-sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPicker(false)}>
            <motion.div
              className="ms-sheet"
              initial={{ y: 40, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 40, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={t("ms.chooseBoard")}
            >
              <div className="ms-sheet-title">{t("ms.CHOOSE")}</div>
              {MINES_LEVEL_IDS.map((id) => {
                const L = MINES_LEVELS[id];
                return (
                  <button
                    key={id}
                    className={`ms-level ${id === level ? "on" : ""}`}
                    onClick={() => {
                      cardSound();
                      buzz("tap");
                      setPicker(false);
                      void newBoard(id);
                    }}
                  >
                    <span className="ms-level-mini" style={{ gridTemplateColumns: `repeat(${Math.min(10, L.cols / 3)}, 1fr)` }}>
                      {Array.from({ length: Math.round(Math.min(10, L.cols / 3) * Math.min(6, L.rows / 3)) }, (_, k) => (
                        <i key={k} />
                      ))}
                    </span>
                    <span className="ms-level-text">
                      <b>{levelLabel(id)}</b>
                      <small>
                        {t("ms.levelLine", { rows: L.rows, cols: L.cols, mines: L.mines, xp: MINES_XP.win[id] })}
                      </small>
                    </span>
                  </button>
                );
              })}
              <button className="ms-btn" onClick={() => setPicker(false)}>
                {t("ms.CANCEL")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* How to play, for first-timers */}
      <AnimatePresence>
        {howto && (
          <motion.div className="ms-sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeHowto}>
            <motion.div className="ms-sheet" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("ms.howAria")}>
              <div className="ms-sheet-title">{t("ms.HOW")}</div>
              <ul className="ms-howto">
                <li>{tRich("ms.r1")}</li>
                <li>{tRich("ms.r2")}</li>
                <li>{tRich("ms.r3")}</li>
                <li>{t("ms.r4")}</li>
                <li>{t("ms.r5")}</li>
              </ul>
              <button className="ms-btn gold" onClick={closeHowto}>
                {t("ms.GO")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {victory && s?.won && (
        <VictoryModal
          game="minesweeper"
          gameTitle={t("ms.gameTitle", { level: levelInfo.label })}
          moves={moves.length}
          time={timeStr}
          isDaily={!!game?.daily}
          progress={me?.progress}
          onDealAgain={() => void newBoard(level)}
          onChallengeFriend={() => setChallengeOpen(true)}
          onExit={() => onExit()}
          onHeist={onHeist ? () => onHeist() : undefined}
        />
      )}

      <AnimatePresence>
        {challengeOpen && game && (
          <FriendChallengeModal
            game="minesweeper"
            gameTitle={t("ms.gameTitle", { level: levelInfo.label })}
            seed={game.seed}
            level={game.level}
            time={s?.won ? timeStr : undefined}
            moves={s?.won ? moves.length : undefined}
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
