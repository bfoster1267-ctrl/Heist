// Play with friends: make a table and share its code, join one by code, or sit at an open public
// table. Once the host deals, the same Table as solo play runs, fed by the game server.
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Table } from "../table/Table";
import { Chips, CrewBadge } from "../table/pieces";
import { DRINK_IDS, type DrinkId } from "@heist/server/protocol";
import { DRINKS } from "../table/Drinks";
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
}: {
  name: string;
  chips: number;
  /** a code to join straight away (from an invite link) */
  join?: string | null;
  onExit: () => void;
  onBuyIn: (stakes: number) => void;
  onWin: (won: number) => void;
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
    if (room && seated && room.status === "playing" && sess.feed.game > 0 && paid.current !== sess.feed.game) {
      paid.current = sess.feed.game;
      onBuyIn(room.stakes);
    }
  }, [room, seated, sess.feed.game, onBuyIn]);

  const leave = () => {
    sess.leave();
    onExit();
  };

  if (room && room.status !== "lobby" && sess.feed.game > 0) {
    return <OnlineTable sess={sess} onExit={leave} onWin={onWin} />;
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

function Pick({ sess, chips, onBack }: { sess: OnlineSession; chips: number; onBack: () => void }) {
  const [players, setPlayers] = useState(4);
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
        <button className="btn ghost" onClick={onBack}>
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
        <button className="btn primary huge" disabled={!online || chips < buyIn} onClick={() => sess.client.create({ players, stakes: buyIn, isPrivate })}>
          Start a table
        </button>
        <div className="fine">Empty seats get bots when the host deals. Chips are play money only.</div>
      </div>
    </>
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

function OnlineTable({ sess, onExit, onWin }: { sess: OnlineSession; onExit: () => void; onWin: (won: number) => void }) {
  const room = sess.room!;
  const useSource = useMemo(() => onlineSource(sess), [sess]);
  const settings = useMemo(() => ({ players: room.players, name: sess.client.name ?? "", stakes: room.stakes }), [room.players, room.stakes, sess]);
  const host = room.hostId === sess.client.userId;
  const talk = useMemo(
    () => ({
      send: (text: string) => sess.client.chat(text),
      listen: (heard: (seat: number, text: string) => void) => sess.onMessage((m) => m.t === "chat" && m.seat !== null && heard(m.seat, m.text)),
      drink: (to: number, emoji: string) => {
        const d = DRINKS.find((x) => x.emoji === emoji);
        if (d && (DRINK_IDS as readonly string[]).includes(d.id)) sess.client.drink(to, d.id as DrinkId);
      },
      listenDrinks: (got: (from: number, to: number, emoji: string) => void) =>
        sess.onMessage((m) => {
          const d = m.t === "drink" && DRINKS.find((x) => x.id === m.drink);
          if (m.t === "drink" && d) got(m.from, m.to, d.emoji);
        }),
    }),
    [sess],
  );
  return (
    <>
      <Table
        key={sess.feed.game}
        settings={settings}
        seat={sess.seat ?? 0}
        useSource={useSource}
        talk={talk}
        watching={sess.seat === null}
        onExit={onExit}
        // a spectator sees the table from seat 0, but its winnings aren't theirs
        onGameOver={(won) => won && sess.seat !== null && onWin(won)}
        onAgain={() => host && sess.client.start()}
      />
      <TurnClock sess={sess} />
      {sess.status !== "online" && <div className="online-banner top">Reconnecting...</div>}
      {sess.seat === null && room.status !== "over" && <div className="online-banner">You're watching this table</div>}
      {room.status === "over" && !host && <div className="online-banner">Waiting for the host to deal again...</div>}
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
