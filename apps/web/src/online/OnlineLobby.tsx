// Play with friends: make a table and share its code, join one by code, or sit at an open public
// table. Once the host deals, the same Table as solo play runs, fed by the game server.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Table } from "../table/Table";
import { Chips, CrewBadge } from "../table/pieces";
import { ALL_DRINKS, RANKED_LEVEL, RANKED_PLAYERS, levelInfo, rankedPublic } from "@heist/profile";
import { PlayerCard } from "../account/Profile";
import { InviteFriends, InviteToast } from "../account/Friends";
import { useAccount } from "../account/useAccount";
import { STAKES } from "../wallet";
import { session, type OnlineSession } from "./session";
import { onlineSource } from "./useOnlineTable";
import { dismissAlertsAsk, shouldAskForAlerts, turnOnAlerts, useAlertState } from "../alerts";
import { Solitaire } from "../solitaire/Solitaire";
import { ARCADE_GAMES, type ArcadeGameId } from "../arcade/ArcadeHub";
import { shareUrl, useCrazyGamesPlay } from "../crazygames";
import { buzz } from "../haptics";
import { card as cardSound, click } from "../sound";
import "../arcade/arcade.css";
import "./online.css";
import { num, t, tEn } from "../i18n";
import { rankLabel } from "../i18n/data";

function useSession(sess: OnlineSession) {
  const [, force] = useState(0);
  useEffect(() => sess.subscribe(() => force((n) => n + 1)), [sess]);
  return sess;
}

/** The table code in an invite link: ?table=ABCDE */
export function inviteCode(): string | null {
  try {
    const c = new URLSearchParams(location.search).get("table");
    return c && /^[A-Za-z2-9]{5}$/.test(c) ? c.toUpperCase() : null;
  } catch {
    return null;
  }
}

function inviteLink(code: string) {
  // on CrazyGames, their invite link to the game on their portal (see crazygames.ts)
  return shareUrl(`/?table=${code}`);
}

export function OnlineLobby({
  name,
  chips,
  join,
  onExit,
  onBuyIn,
  onWin,
  onEnd,
  onArcade,
  onOpenArcade,
}: {
  name: string;
  chips: number;
  /** a code to join straight away (from an invite link) */
  join?: string | null;
  onExit: () => void;
  onBuyIn: (stakes: number) => void;
  /** the table has played out to the end (won = chips won, 0 if not) */
  onWin: (won: number) => void;
  /** any game you sat in has finished, won or not (the account shows its rewards card) */
  onEnd?: () => void;
  /** switch to any solo arcade game while waiting in queue */
  onArcade?: (game?: ArcadeGameId) => void;
  /** open the full Arcade Hub modal */
  onOpenArcade?: () => void;
}) {
  const sess = useSession(useMemo(() => session(name), [name]));
  const room = sess.room;
  const [sol, setSol] = useState(false);
  const joined = useRef(false);
  useEffect(() => {
    if (join && !joined.current && sess.status === "online") {
      joined.current = true;
      sess.client.join(join);
      try {
        history.replaceState(null, "", location.pathname);
      } catch {
        /* ignore */
      }
    }
  }, [join, sess.status, sess]);

  // a buy-in for each game this player is dealt into
  const paid = useRef(0);
  const seated = room && sess.seat !== null;
  useEffect(() => {
    // (coming back to a game you were already dealt into starts from a sync: that buy-in was paid then)
    if (room && seated && room.status === "playing" && sess.feed.game > 0 && !sess.feed.base && paid.current !== sess.feed.game) {
      paid.current = sess.feed.game;
      onBuyIn(room.stakes);
    }
  }, [room, seated, sess.feed.game, onBuyIn]);

  const leave = () => {
    const r = sess.room;
    if (r?.status === "playing" && sess.seat !== null && !window.confirm(t("on.leaveSure"))) return;
    forgetTable();
    sess.leave();
    // after a ranked game, back to the online lobby to queue again
    if (r?.ranked && r.status === "over") return;
    onExit();
  };

  // remember the table while you're dealt in, so you can get back to it after closing the app
  useEffect(() => {
    if (room && sess.seat !== null && room.status === "playing") rememberTable(room.code);
    else if (room?.status === "over") forgetTable();
  }, [room, sess.seat]);

  // CrazyGames: a dealt table (or Solitaire while queued) is gameplay; the lobby isn't
  const atTable = !!room && room.status !== "lobby" && sess.feed.game > 0;
  useCrazyGamesPlay(atTable || (sol && !room));

  if (atTable) {
    return <OnlineTable sess={sess} onExit={leave} onWin={onWin} onEnd={onEnd} />;
  }

  // Solitaire while waiting in the queue: the queue timer rides along on top, and the table takes over
  // the moment it's dealt (the return above)
  if (sol && !room)
    return (
      <Solitaire
        onExit={() => setSol(false)}
        banner={
          sess.queue ? (
            <QueueStrip
              sess={sess}
              onSwitchGame={(g) => {
                setSol(false);
                onArcade?.(g);
              }}
              activeGame="solitaire"
              onOpenArcade={onOpenArcade}
              inline
            />
          ) : (
            <div className="queue-strip">{t("on.notQueued")}</div>
          )
        }
      />
    );

  return (
    <div className="lobby">
      {!room && (
        // the way out sits top-left, where every other screen keeps it (you stay in line: a bar on the
        // main lobby says so and brings you back)
        <button
          className="acct-back online-back"
          onClick={() => {
            click();
            buzz("tap");
            onExit();
          }}
          aria-label={t("on.backAria")}
        >
          <span aria-hidden>←</span> {t("table.lobby")}
        </button>
      )}
      <motion.div className="lobby-card online-card" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {room ? (
          <RoomView sess={sess} onLeave={() => sess.leave()} />
        ) : (
          <Pick
            sess={sess}
            chips={chips}
            onSolitaire={() => setSol(true)}
            onArcade={onArcade}
            onOpenArcade={onOpenArcade}
          />
        )}
        {sess.error && (
          <div className="online-error" onClick={() => sess.clearError()}>
            {tEn(sess.error)}
          </div>
        )}
      </motion.div>
      <InviteToast here={room?.code} />
    </div>
  );
}

const TABLE_KEY = "heist.table";
function rememberTable(code: string) {
  try {
    localStorage.setItem(TABLE_KEY, code);
  } catch {
    /* private mode */
  }
}
function forgetTable() {
  try {
    localStorage.removeItem(TABLE_KEY);
  } catch {
    /* ignore */
  }
}
function lastTable(): string | null {
  try {
    return localStorage.getItem(TABLE_KEY);
  } catch {
    return null;
  }
}

type Mode = "casual" | "ranked";
const MODE_KEY = "heist.mode";

function Pick({
  sess,
  chips,
  onSolitaire,
  onArcade,
  onOpenArcade,
}: {
  sess: OnlineSession;
  chips: number;
  onSolitaire: () => void;
  onArcade?: (game?: ArcadeGameId) => void;
  onOpenArcade?: () => void;
}) {
  const { me } = useAccount();
  // signed in or out since the socket opened: play as the account the app shows
  useEffect(() => sess.syncAccount(), [sess, me?.id]);
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "ranked" ? "ranked" : "casual";
    } catch {
      return "casual";
    }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode */
    }
  };
  const level = me ? levelInfo(me.progress.xp).level : 1;
  const locked = !me || me.guest ? t("prof.rankedGuest") : level < RANKED_LEVEL ? t("on.rankedAt", { n: RANKED_LEVEL, lv: level }) : null;
  const ranked = mode === "ranked";
  const myRank = me ? rankedPublic(me.progress.ranked, Date.now()) : null;
  const [players, setPlayers] = useState(4);
  const [back, setBack] = useState(lastTable);
  const [stake, setStake] = useState(0);
  const [isPrivate, setPrivate] = useState(true);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (sess.status !== "online") return;
    sess.client.list();
    const tm = window.setInterval(() => sess.client.list(), 5000);
    return () => clearInterval(tm);
  }, [sess, sess.status]);
  const buyIn = STAKES[stake].buyIn;
  const online = sess.status === "online";
  return (
    <>
      <div className="lobby-col">
        <div className="logo">HEIST</div>
        <div className="tagline">{t("on.tagline")}</div>
        <div className="wallet">
          <Chips amount={chips} />
          <span className="dim">{t("on.playChips")}</span>
        </div>
        {back && (
          <button
            className="btn gold big"
            disabled={!online}
            onClick={() => {
              click();
              buzz("tap");
              sess.client.join(back);
              forgetTable();
              setBack(null);
            }}
            aria-label={t("on.returnAria", { code: back })}
          >
            {t("on.return", { code: back })}
          </button>
        )}
        <div className="field">
          <span>{t("on.joinTable")}</span>
          <div className="code-row">
            <input
              className="code-input"
              value={code}
              maxLength={5}
              placeholder={t("on.code")}
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
            <button
              className="btn primary"
              disabled={!online || code.length !== 5}
              onClick={() => {
                click();
                buzz("tap");
                sess.client.join(code);
              }}
              aria-label={t("on.joinTable")}
            >
              {t("fr.join")}
            </button>
          </div>
        </div>
        <div className="field">
          <span>{t("on.openTables")}</span>
          {sess.rooms.length ? (
            <div className="open-tables">
              {sess.rooms.map((r) => (
                <button
                  key={r.code}
                  className="open-table"
                  disabled={chips < r.stakes}
                  onClick={() => {
                    click();
                    buzz("tap");
                    sess.client.join(r.code);
                  }}
                  aria-label={t("on.openAria", { code: r.code, n: r.players, buyIn: num(r.stakes) })}
                >
                  <b>{t("prof.nPlayers", { n: r.players })}</b>
                  <span>{t("on.buyIn", { n: num(r.stakes) })}</span>
                  <span className="dim">{t("on.seatsOpen", { count: r.open })}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="fine">{online ? t("on.noTables") : sess.status === "connecting" ? t("on.connecting") : t("fr.offline")}</div>
          )}
        </div>
      </div>
      <div className="lobby-col">
        <div className="seg mode-seg" role="tablist" aria-label={t("on.mode")}>
          <button
            role="tab"
            aria-selected={!ranked}
            className={!ranked ? "on" : ""}
            onClick={() => {
              click();
              buzz("tap");
              setMode("casual");
            }}
          >
            {t("on.casual")}
          </button>
          <button
            role="tab"
            aria-selected={ranked}
            className={ranked ? "on" : ""}
            onClick={() => {
              click();
              buzz("tap");
              setMode("ranked");
            }}
          >
            {t("prof.ranked")}{locked ? " 🔒" : ""}
          </button>
        </div>
        {ranked ? (
          <div className="ranked-head">
            {myRank && myRank.games ? (
              <>
                <b>{rankLabel(myRank.label)}</b>
                <span>
                  {num(myRank.rp)} RP · MMR {num(myRank.mmr)}
                </span>
              </>
            ) : (
              <b>{tEn("Unranked this season")}</b>
            )}
          </div>
        ) : (
          <div className="field">
            <span>{t("on.start")}</span>
            <div className="seg">
              {[3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  className={players === n ? "on" : ""}
                  onClick={() => {
                    click();
                    buzz("tap");
                    setPlayers(n);
                  }}
                  aria-label={t("prof.nPlayers", { n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="stakes-grid">
          {STAKES.map((st, i) => (
            <button
              key={st.name}
              className={"stake" + (stake === i ? " on" : "")}
              disabled={chips < st.buyIn}
              onClick={() => {
                click();
                buzz("tap");
                setStake(i);
              }}
              aria-label={t("on.stakeAria", { name: st.name, n: num(st.buyIn) })}
            >
              <span className="stake-name">{st.name}</span>
              <span className="stake-buy">{t("on.buyIn", { n: num(st.buyIn) })}</span>
            </button>
          ))}
        </div>
        {!ranked && (
          <div className="seg">
            <button
              className={isPrivate ? "on" : ""}
              onClick={() => {
                click();
                buzz("tap");
                setPrivate(true);
              }}
              aria-label={t("on.friendsOnly")}
            >
              {t("on.friendsOnly")}
            </button>
            <button
              className={!isPrivate ? "on" : ""}
              onClick={() => {
                click();
                buzz("tap");
                setPrivate(false);
              }}
              aria-label={t("on.openAnyone")}
            >
              {t("on.openAnyone")}
            </button>
          </div>
        )}
        {sess.queue ? (
          <QueueCard
            sess={sess}
            onSolitaire={onSolitaire}
            onArcade={onArcade}
            onOpenArcade={onOpenArcade}
          />
        ) : ranked ? (
          <div className="start-row">
            <button
              className="btn gold huge"
              disabled={!online || !!locked || chips < buyIn}
              onClick={() => {
                cardSound();
                buzz("tap");
                sess.client.queue(RANKED_PLAYERS, buyIn, true);
              }}
              aria-label={t("on.playRanked")}
            >
              {t("on.playRanked")}
            </button>
          </div>
        ) : (
          <div className="start-row">
            <button
              className="btn gold huge"
              disabled={!online || chips < buyIn}
              onClick={() => {
                cardSound();
                buzz("tap");
                sess.client.queue(players, buyIn);
              }}
              aria-label={t("on.playNow")}
            >
              {t("on.playNow")}
            </button>
            <button
              className="btn primary huge"
              disabled={!online || chips < buyIn}
              onClick={() => {
                cardSound();
                buzz("tap");
                sess.client.create({ players, stakes: buyIn, isPrivate });
              }}
              aria-label={t("on.start")}
            >
              {t("on.start")}
            </button>
          </div>
        )}
        {ranked ? (
          <div className="fine">
            {locked ?? t("on.rankedFine", { n: RANKED_PLAYERS })}
          </div>
        ) : (
          <div className="fine">{t("on.casualFine")}</div>
        )}
      </div>
    </>
  );
}

/** While you wait for a table, once: offer a phone alert for when it's your turn (never on first load). */
function AlertsAsk() {
  useAlertState();
  const [busy, setBusy] = useState(false);
  if (!shouldAskForAlerts()) return null;
  return (
    <div className="alerts-ask" role="note">
      <div>
        <b>{t("on.alertsAsk")}</b>
        <div className="fine">{t("on.alertsText")}</div>
      </div>
      <div className="alerts-ask-btns">
        <button
          className="btn gold small"
          disabled={busy}
          onClick={async () => {
            click();
            buzz("tap");
            setBusy(true);
            await turnOnAlerts();
            setBusy(false);
          }}
          aria-label={t("on.alertsOnAria")}
        >
          {t("fr.turnOn")}
        </button>
        <button
          className="btn ghost small"
          onClick={() => {
            click();
            buzz("tap");
            dismissAlertsAsk();
          }}
          aria-label={t("on.alertsNoAria")}
        >
          {t("fr.notNow")}
        </button>
      </div>
    </div>
  );
}

/** Seconds now, ticking once a second. */
function useSeconds() {
  return useSyncExternalStore(
    (cb) => {
      const t = window.setInterval(cb, 1000);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / 1000),
  );
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The queue, squeezed into one line: who's in, the timer, and a way out of line. With `onOpen` the line
 *  itself is a button back to the queue (on screens away from it). */
function QueueStrip({
  sess,
  onOpen,
  onSwitchGame,
  activeGame,
  onOpenArcade,
  inline,
}: {
  sess: OnlineSession;
  onOpen?: () => void;
  onSwitchGame?: (game: ArcadeGameId) => void;
  activeGame?: ArcadeGameId | null;
  onOpenArcade?: () => void;
  inline?: boolean;
}) {
  const q = sess.queue!;
  const now = useSeconds();
  const left = Math.max(0, Math.ceil(q.startsAt / 1000 - now));
  const waited = Math.max(0, now - Math.floor(sess.queuedSince / 1000));
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!switcherOpen) return;
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  const currentGame = ARCADE_GAMES.find((g) => g.id === activeGame);
  const currentGameLabel = currentGame ? currentGame.title : t("on.arcade");

  const words = (
    <span className="queue-strip-words">
      {q.ranked ? t("prof.ranked") : t("on.finding")} · {q.waiting}/{q.players} · <b>{mmss(waited)}</b>
      {!q.ranked && (left > 0 ? ` · ${t("on.botsIn", { time: mmss(left) })}` : ` · ${t("on.dealingLower")}`)}
    </span>
  );
  return (
    <div className="queue-strip" role="status">
      <span className="queue-strip-dot" aria-hidden />
      {onOpen ? (
        <button
          className="queue-strip-go"
          onClick={() => {
            click();
            buzz("tap");
            onOpen();
          }}
          aria-label={t("on.inLineAria")}
        >
          {words}
          <span className="queue-strip-back">
            {t("on.inLine")} <span aria-hidden>›</span>
          </span>
        </button>
      ) : (
        words
      )}
      {(onSwitchGame || onOpenArcade) && (
        <div className="queue-switcher-wrapper" ref={menuRef}>
          <button
            type="button"
            className={`queue-switcher-toggle ${switcherOpen ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              click();
              buzz("tap");
              setSwitcherOpen((o) => !o);
            }}
            aria-label={t("on.switchAria")}
            aria-expanded={switcherOpen}
            title={t("on.switch")}
          >
            <span aria-hidden>🕹️</span>
            <span>{currentGameLabel}</span>
            <span className="arrow" aria-hidden>{switcherOpen ? "▴" : "▾"}</span>
          </button>
          {switcherOpen && (
            <div
              className={`queue-switcher-menu ${inline ? "drop-down" : "drop-up"}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="queue-switcher-head">
                <div>
                  <div className="queue-switcher-head-title">{t("on.switcher")}</div>
                  <div className="queue-switcher-head-sub">{t("on.switcherSub")}</div>
                </div>
              </div>
              {ARCADE_GAMES.map((g) => {
                const isCurrent = activeGame === g.id;
                const c1 = g.art.cards[0];
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`queue-switcher-item ${isCurrent ? "active" : ""}`}
                    onClick={() => {
                      cardSound();
                      buzz("tap");
                      setSwitcherOpen(false);
                      onSwitchGame?.(g.id);
                    }}
                    aria-label={t("on.switchTo", { game: g.title })}
                  >
                    <span className={`queue-switcher-item-badge ${c1.red ? "red" : ""}`}>
                      {c1.isSymbol ? c1.rank : `${c1.rank}${c1.suit}`}
                    </span>
                    <span className="queue-switcher-item-text">
                      <span className="queue-switcher-item-title">{g.title}</span>
                      <span className="queue-switcher-item-sub">{g.subtitle}</span>
                    </span>
                    {isCurrent && <span className="queue-switcher-active-tag">{t("on.playing")}</span>}
                  </button>
                );
              })}
              {onOpenArcade && (
                <div className="queue-switcher-footer">
                  <button
                    type="button"
                    className="queue-switcher-hub-btn"
                    onClick={() => {
                      click();
                      buzz("tap");
                      setSwitcherOpen(false);
                      onOpenArcade();
                    }}
                    aria-label={t("on.browseAll")}
                  >
                    <span>{t("on.browseAll")} ⇗</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <button
        className="queue-strip-x"
        onClick={() => {
          click();
          buzz("tap");
          sess.client.unqueue();
        }}
        aria-label={t("on.leaveQueue")}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * In line for a table but somewhere else in the app (the lobby, Solitaire): a bar that says so and
 * takes you back to the queue, and takes you to the table the moment it's dealt.
 */
export function QueueBar({
  name,
  onBack,
  onDone,
  inline,
  onSwitchGame,
  activeGame,
  onOpenArcade,
}: {
  name: string;
  /** back to the online lobby (it shows the queue, or the table once dealt) */
  onBack: () => void;
  /** out of line without a table (left the queue, or the server turned it down) */
  onDone: () => void;
  /** as a strip inside a screen's own layout (Solitaire's banner) instead of floating over it */
  inline?: boolean;
  /** switch directly to any solo arcade game while staying in line */
  onSwitchGame?: (game: ArcadeGameId) => void;
  /** active solo game id */
  activeGame?: ArcadeGameId | null;
  /** open the full Arcade Hub modal */
  onOpenArcade?: () => void;
}) {
  const sess = useSession(useMemo(() => session(name), [name]));
  const dealt = !!sess.room;
  const inLine = !!sess.queue;
  const go = useRef({ onBack, onDone });
  go.current = { onBack, onDone };
  useEffect(() => {
    if (dealt) go.current.onBack();
    else if (!inLine) go.current.onDone();
  }, [dealt, inLine]);
  if (!sess.queue) return null;
  const strip = (
    <QueueStrip
      sess={sess}
      onOpen={onBack}
      onSwitchGame={onSwitchGame}
      activeGame={activeGame}
      onOpenArcade={onOpenArcade}
      inline={inline}
    />
  );
  return inline ? strip : <div className="queue-float">{strip}</div>;
}

/** Waiting in the quick queue: who's in line, and when bots fill the rest. */
function QueueCard({
  sess,
  onSolitaire,
  onArcade,
  onOpenArcade,
}: {
  sess: OnlineSession;
  onSolitaire: () => void;
  onArcade?: (game?: ArcadeGameId) => void;
  onOpenArcade?: () => void;
}) {
  const q = sess.queue!;
  const now = useSeconds();
  const left = Math.max(0, Math.ceil(q.startsAt / 1000 - now));
  return (
    <div className="queue-card" role="status">
      <div className="queue-title">{q.ranked ? t("on.findingRanked") : t("on.findingPlayers")}</div>
      <div>
        {t("on.here", { waiting: q.waiting, n: q.players })} · {t("on.buyIn", { n: num(q.stakes) })}
      </div>
      <div className="fine">
        {q.ranked ? t("on.noBotsRanked") : left > 0 ? t("on.botsFill", { time: mmss(left) }) : t("on.dealing")}
      </div>
      <button
        className="btn primary"
        onClick={() => {
          cardSound();
          buzz("tap");
          if (onArcade) onArcade("solitaire");
          else onSolitaire();
        }}
        aria-label={t("on.solWait")}
      >
        {t("on.solWait")}
      </button>
      {onOpenArcade && (
        <button
          className="btn ghost"
          onClick={() => {
            click();
            buzz("tap");
            onOpenArcade();
          }}
          aria-label={t("on.browseSolo")}
        >
          {t("on.browseSoloN")}
        </button>
      )}
      <button
        className="btn ghost"
        onClick={() => {
          click();
          buzz("tap");
          sess.client.unqueue();
        }}
        aria-label={t("on.cancelQueue")}
      >
        {t("common.cancel")}
      </button>
      <AlertsAsk />
    </div>
  );
}

/** names a player gets without choosing one: guests start as "Ace" (or "Player" on the server) */
const STOCK_NAME = /^(Ace|Player|Guest\b.*)$/;
const ASKED_KEY = "heist.askedName";
function askedName() {
  try {
    return sessionStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}
function markAskedName() {
  try {
    sessionStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* private mode: asked again next table, which is fine */
  }
}

function RoomView({ sess, onLeave }: { sess: OnlineSession; onLeave: () => void }) {
  const room = sess.room!;
  const host = room.hostId === sess.client.userId;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = inviteLink(room.code);
    try {
      if (navigator.share) await navigator.share({ title: "Heist", text: t("on.shareText", { code: room.code }), url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelled */
    }
  };
  const humans = room.seats.filter((s) => s.kind === "human").length;
  // tap your own seat to change your name; a stock name (an invited friend who's new here) is asked once
  const mine = sess.seat === null ? null : room.seats[sess.seat];
  const [editing, setEditing] = useState(() => !!mine && STOCK_NAME.test(mine.name) && !askedName());
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (editing) markAskedName();
  }, [editing]);
  if (editing && !mine) setEditing(false);
  return (
    <>
      <div className="lobby-col">
        <div className="tagline">{t("on.tableCode")}</div>
        <div className="room-code">{room.code}</div>
        {/* friends get a notification that opens the app at this table; a texted link is for everyone else */}
        <InviteFriends code={room.code} seated={room.seats.map((s) => s.userId)} onText={share} />
        <button
          className="btn gold big"
          onClick={() => {
            click();
            buzz("tap");
            void share();
          }}
          aria-label={t("on.textLink")}
        >
          {copied ? t("on.copied") : t("on.textLink")}
        </button>
        <div className="fine">
          {t("prof.nPlayers", { n: room.players })} · {t("on.buyIn", { n: num(room.stakes) })} · {room.isPrivate ? t("on.friendsOnly") : t("on.openAnyone")}
        </div>
        {sess.seat === null && <div className="fine">{t("on.watching")}</div>}
        <button
          className="btn ghost"
          onClick={() => {
            click();
            buzz("tap");
            onLeave();
          }}
          aria-label={t("table.leave")}
        >
          {t("table.leave")}
        </button>
      </div>
      <div className="lobby-col">
        <div className="field">
          <span>{t("on.seats")}</span>
          <div className="room-seats">
            {room.seats.map((s) =>
              s.seat === sess.seat && editing ? (
                <form
                  key={s.seat}
                  className="room-seat me editing"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim() && draft.trim() !== s.name) sess.client.rename(draft);
                    setEditing(false);
                  }}
                >
                  <CrewBadge color={s.seat} size={28} />
                  <input className="seat-name-input" value={draft} maxLength={20} placeholder={t("on.yourName")} autoFocus aria-label={t("on.yourName")} onChange={(e) => setDraft(e.target.value)} />
                  <button
                    className="btn gold small"
                    type="submit"
                    disabled={!draft.trim()}
                    onClick={() => {
                      click();
                      buzz("tap");
                    }}
                    aria-label={t("on.saveName")}
                  >
                    {t("common.save")}
                  </button>
                </form>
              ) : s.seat === sess.seat ? (
                <button
                  key={s.seat}
                  className="room-seat me"
                  title={t("on.changeName")}
                  aria-label={t("on.changeName")}
                  onClick={() => {
                    click();
                    buzz("tap");
                    setDraft(s.name);
                    setEditing(true);
                  }}
                >
                  <CrewBadge color={s.seat} size={28} />
                  <span>{s.name}</span>
                  {s.userId === room.hostId && <span className="tag">{t("on.host")}</span>}
                  <span className={"tag dim" + (s.userId === room.hostId ? " near" : "")}>✎ {t("on.name")}</span>
                </button>
              ) : (
                <div key={s.seat} className={"room-seat" + (s.kind === "open" ? " open" : "")}>
                  <CrewBadge color={s.seat} size={28} />
                  <span>{s.kind === "open" ? t("on.openSeat") : s.name}</span>
                  {s.kind === "human" && s.userId === room.hostId && <span className="tag">{t("on.host")}</span>}
                  {s.kind === "human" && !s.connected && <span className="tag dim">{t("on.away")}</span>}
                </div>
              ),
            )}
          </div>
          {editing && <div className="fine">{t("on.pickName")}</div>}
        </div>
        {host ? (
          <button
            className="btn primary huge"
            onClick={() => {
              cardSound(4);
              buzz("tap");
              sess.client.start();
            }}
            aria-label={t("on.dealAria")}
          >
            {humans < room.players ? t("on.dealBots", { n: room.players - humans }) : t("on.deal")}
          </button>
        ) : (
          <div className="fine waiting-host">{t("on.waitingHost")}</div>
        )}
        <AlertsAsk />
      </div>
    </>
  );
}

function OnlineTable({ sess, onExit, onWin, onEnd }: { sess: OnlineSession; onExit: () => void; onWin: (won: number) => void; onEnd?: () => void }) {
  const room = sess.room!;
  const useSource = useMemo(() => onlineSource(sess), [sess]);
  const settings = useMemo(() => ({ players: room.players, name: sess.client.name ?? "", stakes: room.stakes }), [room.players, room.stakes, sess]);
  const host = room.hostId === sess.client.userId;
  const talk = useMemo(
    () => ({
      send: (text: string) => sess.client.chat(text),
      listen: (heard: (seat: number, text: string) => void) => sess.onMessage((m) => m.t === "chat" && m.seat !== null && heard(m.seat, m.text)),
      drink: (to: number, emoji: string) => {
        const d = ALL_DRINKS.find((x) => x.emoji === emoji);
        // the server charges the coins; a "no_coins" error comes back like any other
        if (d) sess.client.drink(d.id, to);
      },
      listenDrinks: (got: (from: number, to: number, emoji: string) => void) =>
        sess.onMessage((m) => {
          const d = m.t === "drink" && ALL_DRINKS.find((x) => x.id === m.id);
          if (m.t === "drink" && d) for (const to of m.to) got(m.from, to, d.emoji);
        }),
    }),
    [sess],
  );
  const seats = room.seats;
  const mine = sess.seat === null ? null : seats[sess.seat];
  // tap a player's name for their full profile
  const [card, setCard] = useState<string | null>(null);
  // everyone's lines show in the chat bubble they wear
  const looks = useMemo(() => Object.fromEntries(seats.map((s) => [s.seat, s.badge?.chat])), [seats]);
  const tags = useMemo(() => {
    const tg: Record<number, string> = {};
    for (const s of seats) if (s.badge?.rank) tg[s.seat] = rankLabel(s.badge.rank);
    return tg;
  }, [seats]);
  const away = useMemo(() => {
    const a: Record<number, "away" | "bot"> = {};
    for (const s of seats) if (s.kind === "human" && (s.autopilot || !s.connected)) a[s.seat] = s.autopilot ? "bot" : "away";
    return a;
  }, [seats]);
  return (
    <>
      <Table
        key={sess.feed.game}
        settings={settings}
        seat={sess.seat ?? 0}
        useSource={useSource}
        talk={talk}
        bubbleLooks={looks}
        watching={sess.seat === null}
        away={away}
        clock={<TurnClock sess={sess} />}
        place={t("on.table", { code: room.code })}
        clean={room.ranked}
        tags={tags}
        onName={(seat) => {
          const id = seats[seat]?.kind === "human" ? seats[seat].userId : null;
          if (id) setCard(id);
        }}
        onExit={onExit}
        // the server says who takes the pot: never a player who wasn't there at the end, nor a spectator
        onGameOver={() => {
          const go = sess.gameOver;
          if (go && sess.seat !== null && go.paid.includes(sess.seat)) onWin(Math.floor((room.stakes * room.players) / go.paid.length));
          if (sess.seat !== null) onEnd?.();
        }}
        // a spectator can sit in for the next game; then only the host deals it (ranked tables play one game)
        onAgain={room.ranked ? undefined : host ? () => sess.client.start() : sess.seat === null ? () => sess.client.sit() : undefined}
        againLabel={!host && sess.seat === null ? t("on.takeSeat") : undefined}
        forfeit={sess.seat !== null && !!sess.gameOver?.abandoned.includes(sess.seat)}
      />
      {sess.status !== "online" && <div className="online-banner top">{t("on.reconnecting")}</div>}
      {mine?.autopilot && room.status === "playing" && (
        <div className="online-banner autopilot">
          {t("on.botForYou")}
          <button
            className="btn primary small"
            onClick={() => {
              click();
              buzz("tap");
              sess.client.autopilot(false);
            }}
            aria-label={t("on.resumeAria")}
          >
            {t("on.imBack")}
          </button>
        </div>
      )}
      {sess.seat === null && room.status !== "over" && <div className="online-banner">{t("on.watchingBanner")}</div>}

      <AnimatePresence>{card && <PlayerCard id={card} onClose={() => setCard(null)} />}</AnimatePresence>

    </>
  );
}

/** Seconds left on your decision. */
function TurnClock({ sess }: { sess: OnlineSession }) {
  const now = useSyncExternalStore(
    (cb) => {
      const t = window.setInterval(cb, 250);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / 250),
  );
  const ask = sess.ask;
  if (!ask) return null;
  const left = Math.max(0, Math.ceil((ask.deadline - now * 250) / 1000));
  if (left > 60) return null;
  return <div className={"turn-clock" + (left <= 10 ? " low" : "")}>{left}s</div>;
}
