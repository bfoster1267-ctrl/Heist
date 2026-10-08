// Play with friends: make a table and share its code, join one by code, or sit at an open public
// table. Once the host deals, the same Table as solo play runs, fed by the game server.
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Table } from "../table/Table";
import { Chips, CrewBadge } from "../table/pieces";
import { ALL_DRINKS } from "@heist/profile";
import { STAKES } from "../wallet";
import { session, type OnlineSession } from "./session";
import { onlineSource } from "./useOnlineTable";
import "./online.css";

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
  const u = new URL(location.href);
  u.search = `?table=${code}`;
  u.hash = "";
  return u.toString();
}

export function OnlineLobby({
  name,
  chips,
  join,
  onExit,
  onBuyIn,
  onWin,
  onEnd,
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
}) {
  const sess = useSession(useMemo(() => session(name), [name]));
  const room = sess.room;
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
    if (r?.status === "playing" && sess.seat !== null && !window.confirm("Leave this game? You'll lose your buy-in, and you can't come back to this game.")) return;
    forgetTable();
    sess.leave();
    onExit();
  };

  // remember the table while you're dealt in, so you can get back to it after closing the app
  useEffect(() => {
    if (room && sess.seat !== null && room.status === "playing") rememberTable(room.code);
    else if (room?.status === "over") forgetTable();
  }, [room, sess.seat]);

  if (room && room.status !== "lobby" && sess.feed.game > 0) {
    return <OnlineTable sess={sess} onExit={leave} onWin={onWin} onEnd={onEnd} />;
  }

  return (
    <div className="lobby">
      <motion.div className="lobby-card online-card" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {room ? <RoomView sess={sess} onLeave={() => sess.leave()} /> : <Pick sess={sess} chips={chips} onBack={onExit} />}
        {sess.error && (
          <div className="online-error" onClick={() => sess.clearError()}>
            {sess.error}
          </div>
        )}
      </motion.div>
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

function Pick({ sess, chips, onBack }: { sess: OnlineSession; chips: number; onBack: () => void }) {
  const [players, setPlayers] = useState(4);
  const [back, setBack] = useState(lastTable);
  const [stake, setStake] = useState(0);
  const [isPrivate, setPrivate] = useState(true);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (sess.status !== "online") return;
    sess.client.list();
    const t = window.setInterval(() => sess.client.list(), 5000);
    return () => clearInterval(t);
  }, [sess, sess.status]);
  const buyIn = STAKES[stake].buyIn;
  const online = sess.status === "online";
  return (
    <>
      <div className="lobby-col">
        <div className="logo">HEIST</div>
        <div className="tagline">Play with friends</div>
        <div className="wallet">
          <Chips amount={chips} />
          <span className="dim">play chips</span>
        </div>
        {back && (
          <button
            className="btn gold big"
            disabled={!online}
            onClick={() => {
              sess.client.join(back);
              forgetTable();
              setBack(null);
            }}
          >
            Back to your table ({back})
          </button>
        )}
        <div className="field">
          <span>Join a table</span>
          <div className="code-row">
            <input
              className="code-input"
              value={code}
              maxLength={5}
              placeholder="CODE"
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
            <button className="btn primary" disabled={!online || code.length !== 5} onClick={() => sess.client.join(code)}>
              Join
            </button>
          </div>
        </div>
        <div className="field">
          <span>Open tables</span>
          {sess.rooms.length ? (
            <div className="open-tables">
              {sess.rooms.map((r) => (
                <button key={r.code} className="open-table" disabled={chips < r.stakes} onClick={() => sess.client.join(r.code)}>
                  <b>{r.players} players</b>
                  <span>Buy-in {r.stakes.toLocaleString()}</span>
                  <span className="dim">
                    {r.open} seat{r.open > 1 ? "s" : ""} open
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="fine">{online ? "No open tables right now. Start one!" : sess.status === "connecting" ? "Connecting..." : "Offline"}</div>
          )}
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            if (sess.queue) sess.client.unqueue();
            onBack();
          }}
        >
          Back
        </button>
      </div>
      <div className="lobby-col">
        <div className="field">
          <span>Start a table</span>
          <div className="seg">
            {[3, 4, 5, 6].map((n) => (
              <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="stakes-grid">
          {STAKES.map((st, i) => (
            <button key={st.name} className={"stake" + (stake === i ? " on" : "")} disabled={chips < st.buyIn} onClick={() => setStake(i)}>
              <span className="stake-name">{st.name}</span>
              <span className="stake-buy">Buy-in {st.buyIn.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={isPrivate ? "on" : ""} onClick={() => setPrivate(true)}>
            Friends only
          </button>
          <button className={!isPrivate ? "on" : ""} onClick={() => setPrivate(false)}>
            Open to anyone
          </button>
        </div>
        {sess.queue ? (
          <QueueCard sess={sess} />
        ) : (
          <div className="start-row">
            <button className="btn gold huge" disabled={!online || chips < buyIn} onClick={() => sess.client.queue(players, buyIn)}>
              Play now
            </button>
            <button className="btn primary huge" disabled={!online || chips < buyIn} onClick={() => sess.client.create({ players, stakes: buyIn, isPrivate })}>
              Start a table
            </button>
          </div>
        )}
        <div className="fine">Play now seats you with other players looking for the same game; bots fill any seats still empty after 2 minutes. Chips are play money only.</div>
      </div>
    </>
  );
}

/** Waiting in the quick queue: who's in line, and when bots fill the rest. */
function QueueCard({ sess }: { sess: OnlineSession }) {
  const q = sess.queue!;
  const now = useSyncExternalStore(
    (cb) => {
      const t = window.setInterval(cb, 1000);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / 1000),
  );
  const left = Math.max(0, Math.ceil(q.startsAt / 1000 - now));
  return (
    <div className="queue-card" role="status">
      <div className="queue-title">Finding players...</div>
      <div>
        {q.waiting} of {q.players} here · Buy-in {q.stakes.toLocaleString()}
      </div>
      <div className="fine">{left > 0 ? `Bots fill the empty seats in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Dealing..."}</div>
      <button className="btn ghost" onClick={() => sess.client.unqueue()}>
        Cancel
      </button>
    </div>
  );
}

function RoomView({ sess, onLeave }: { sess: OnlineSession; onLeave: () => void }) {
  const room = sess.room!;
  const host = room.hostId === sess.client.userId;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = inviteLink(room.code);
    try {
      if (navigator.share) await navigator.share({ title: "Heist", text: `Join my Heist table: ${room.code}`, url });
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
  return (
    <>
      <div className="lobby-col">
        <div className="tagline">Table code</div>
        <div className="room-code">{room.code}</div>
        <button className="btn gold big" onClick={share}>
          {copied ? "Link copied" : "Invite friends"}
        </button>
        <div className="fine">
          {room.players} players · Buy-in {room.stakes.toLocaleString()} · {room.isPrivate ? "Friends only" : "Open to anyone"}
        </div>
        {sess.seat === null && <div className="fine">You're watching this table.</div>}
        <button className="btn ghost" onClick={onLeave}>
          Leave table
        </button>
      </div>
      <div className="lobby-col">
        <div className="field">
          <span>Seats</span>
          <div className="room-seats">
            {room.seats.map((s) => (
              <div key={s.seat} className={"room-seat" + (s.kind === "open" ? " open" : "") + (s.seat === sess.seat ? " me" : "")}>
                <CrewBadge color={s.seat} size={28} />
                <span>{s.kind === "open" ? "Open seat" : s.name}</span>
                {s.kind === "human" && s.userId === room.hostId && <span className="tag">host</span>}
                {s.kind === "human" && !s.connected && <span className="tag dim">away</span>}
              </div>
            ))}
          </div>
        </div>
        {host ? (
          <button className="btn primary huge" onClick={() => sess.client.start()}>
            Deal{humans < room.players ? ` (bots fill ${room.players - humans})` : ""}
          </button>
        ) : (
          <div className="fine waiting-host">Waiting for the host to deal...</div>
        )}
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
        watching={sess.seat === null}
        away={away}
        clock={<TurnClock sess={sess} />}
        onExit={onExit}
        // the server says who takes the pot: never a player who wasn't there at the end, nor a spectator
        onGameOver={() => {
          const go = sess.gameOver;
          if (go && sess.seat !== null && go.paid.includes(sess.seat)) onWin(Math.floor((room.stakes * room.players) / go.paid.length));
          if (sess.seat !== null) onEnd?.();
        }}
        // a spectator can sit in for the next game; then only the host deals it
        onAgain={host ? () => sess.client.start() : sess.seat === null ? () => sess.client.sit() : undefined}
        againLabel={!host && sess.seat === null ? "Take a seat" : undefined}
        forfeit={sess.seat !== null && !!sess.gameOver?.abandoned.includes(sess.seat)}
      />
      {sess.status !== "online" && <div className="online-banner top">Reconnecting...</div>}
      {mine?.autopilot && room.status === "playing" && (
        <div className="online-banner autopilot">
          A bot is playing for you.
          <button className="btn primary small" onClick={() => sess.client.autopilot(false)}>
            I'm back
          </button>
        </div>
      )}
      {sess.seat === null && room.status !== "over" && <div className="online-banner">You're watching this table</div>}

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
