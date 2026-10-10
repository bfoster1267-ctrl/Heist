import type { Answer } from "@heist/engine";
import { ALL_DRINKS, type Reward } from "@heist/profile";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProfileChip } from "./account/bits";
import { Profile } from "./account/Profile";
import { Rewards } from "./account/Rewards";
import { WhatLostYou, type LostAsk } from "./account/WhatLostYou";
import { AccountProvider, useAccount } from "./account/useAccount";
import "./account/account.css";
import { Lobby, type LobbyChoice, type LobbyPage } from "./Lobby";
import { OnlineLobby, inviteCode } from "./online/OnlineLobby";
import { session } from "./online/session";
import { Table } from "./table/Table";
import { trackScreen } from "./track";
import type { TableSettings } from "./useTable";

export function App() {
  return (
    <AccountProvider>
      <Game />
    </AccountProvider>
  );
}

interface Seated extends TableSettings {
  seed: number;
  gameId: string;
}

function Game() {
  const { me, backend, failed, suspended, act, showReward, error, clearError } = useAccount();
  // can't reach the server: check back every few seconds and reload once it answers
  useEffect(() => {
    if (!failed) return;
    const base = import.meta.env.VITE_SERVER_URL === "same-origin" ? "" : ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? "").replace(/\/$/, "");
    const t = window.setInterval(() => {
      fetch(`${base}/api/config`, { cache: "no-store" }).then((r) => r.ok && location.reload(), () => {});
    }, 5000);
    return () => clearInterval(t);
  }, [failed]);
  const [table, setTable] = useState<Seated | null>(null);
  const [round, setRound] = useState(0);
  // the profile sheet and which tab it opens on (false = closed)
  const [profile, setProfile] = useState<false | LobbyPage | "account">(false);
  const finished = useRef(false);
  // "What lost you?": a brand-new player's first visit to the tables, asked once when they walk out of a
  // game or head back to the lobby (after finishing one, if they did)
  const firstGame = useRef(false);
  const finishedOne = useRef(false);
  const turnRef = useRef(0);
  const [ask, setAsk] = useState<LostAsk | null>(null);
  // an upright phone needs no asking: the table draws itself sideways (turn.ts)
  const enter = (go: () => void) => go();
  // online: the player's name, set while the friends lobby or an online table is open
  const [online, setOnline] = useState<string | null>(() =>
    inviteCode() ? savedName() : null,
  );
  // After an online game the server sends what it earned. It usually lands while the table is still
  // playing the last moves, so it's held until the table shows the end, then shown like a game vs bots.
  const onlineEnd = useRef<{ reward: Reward | null; ended: boolean }>({
    reward: null,
    ended: false,
  });
  useEffect(() => {
    if (online === null) return;
    return session(online).onMessage((m) => {
      if (m.t === "frames" && m.frames[0]?.i === 0)
        onlineEnd.current = { reward: null, ended: false };
      if (m.t !== "reward") return;
      void act((b) => b.me());
      if (onlineEnd.current.ended) showReward(m.reward);
      else onlineEnd.current.reward = m.reward;
    });
  }, [online, showReward, act]);
  // the owner's activity log: which screen the player is on
  useEffect(() => {
    trackScreen(profile ? `Profile: ${profile}` : table ? (table.stage ? `Campaign table ${table.stage}` : "Table vs bots") : online !== null ? "Online" : "Lobby");
  }, [profile, table, online]);
  const onlineTableEnded = useCallback(() => {
    const e = onlineEnd.current;
    if (e.reward) showReward(e.reward);
    onlineEnd.current = { reward: null, ended: !e.reward };
  }, [showReward]);

  // The buy-in is paid and the seed comes from the account (the server, when there is one), so the
  // finished game can be checked and counted toward the career.
  const sit = useCallback(
    async (c: LobbyChoice) => {
      if (me && c.name && c.name !== me.name)
        await act((b) => b.rename(c.name));
      const t = await act((b) => b.soloStart(c.players, c.stakes, c.name, c.campaign, c.coached));
      if (!t) return;
      if (t.quit) showReward(t.quit);
      finished.current = false;
      turnRef.current = 0;
      if (me && !firstGame.current)
        firstGame.current = backend?.kind === "server" && !me.asked && !lostAsked() && !me.progress.coachGames && !me.progress.stats.games && !me.progress.xp;
      setTable({
        players: t.players ?? c.players,
        name: c.name,
        stakes: t.stage || c.coached ? 0 : c.stakes,
        coached: c.coached,
        gentle: t.gentle,
        seed: t.seed,
        levels: t.levels,
        stage: t.stage,
        gameId: t.gameId,
      });
      setRound((r) => r + 1);
    },
    [me, backend, act, showReward],
  );

  const gameOver = useCallback(
    async (_won: number, answers: Answer[]) => {
      if (!table || finished.current) return;
      finished.current = true;
      if (firstGame.current) finishedOne.current = true;
      const r = await act((b) => b.soloFinish(table.gameId, answers));
      if (r) showReward(r.reward);
    },
    [table, act, showReward],
  );

  // Walking out mid-game counts as a loss: the buy-in is already in the pot.
  const exit = useCallback(() => {
    if (!finished.current) void act((b) => b.soloQuit());
    if (firstGame.current && table && !me?.asked) {
      firstGame.current = false;
      markLostAsked();
      setAsk({ when: finishedOne.current || finished.current ? "finished" : "left", round: finishedOne.current || finished.current ? null : turnRef.current, coached: !!table.coached });
    }
    finished.current = true;
    setTable(null);
  }, [act, table, me]);

  const buyDrink = useCallback(
    async (emoji: string, count: number) => {
      const d = ALL_DRINKS.find((x) => x.emoji === emoji);
      return !!d && !!(await act((b) => b.drink(d.id, count)));
    },
    [act],
  );

  if (suspended)
    return (
      <div className="loading loading-failed">
        <div>Account suspended</div>
        <p>{suspended}</p>
        <p>If you think this is a mistake, email support@playheist.net.</p>
      </div>
    );
  if (!me)
    return failed ? (
      <div className="loading loading-failed">
        <div>Can't reach the vault</div>
        <p>The game server didn't answer, maybe it's restarting. Your account and chips are safe, and this page reconnects by itself when it's back.</p>
        <button className="btn primary big" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    ) : (
      <div className="loading">Opening the vault…</div>
    );
  const chips = me.progress.chips;

  // Online games settle chips, XP and stats on the server (the socket signs in as this account), so the
  // lobby only needs to re-read the account when money moves.
  if (online !== null)
    return (
      <>
        <OnlineLobby
          name={online}
          chips={chips}
          join={inviteCode()}
          onExit={() => {
            setOnline(null);
            void act((b) => b.me());
          }}
          onBuyIn={() => void act((b) => b.me())}
          onWin={() => {}}
          onEnd={() => {
            onlineTableEnded();
            void act((b) => b.me());
          }}
        />
        <Rewards />
      </>
    );

  return (
    <>
      {!table ? (
        <>
          <Lobby
            chips={chips}
            defaultName={
              me.guest && me.name.startsWith("Guest") ? undefined : me.name
            }
            onPlay={(c) => enter(() => void sit(c))}
            onRefill={() => act((b) => b.refill())}
            onOnline={(n) => enter(() => setOnline(n))}
            onOpen={setProfile}
            onSignIn={() => setProfile("account")}
            cleared={me.progress.campaign ?? 0}
            newbie={!me.progress.coachGames && !me.progress.xp && !me.progress.prestige}
          />
          <div className="acct-corner">
            <ProfileChip me={me} onOpen={() => setProfile("career")} />
          </div>
        </>
      ) : (
        <Table
          key={round}
          settings={table}
          onExit={exit}
          onGameOver={gameOver}
          buyDrink={buyDrink}
          mistakes={me.progress.mistakes}
          turnRef={turnRef}
          onAgain={() => {
            if (chips < table.stakes) return exit();
            void sit({ ...table, campaign: table.stage });
          }}
        />
      )}
      <AnimatePresence>
        {profile && (
          <Profile
            key={profile}
            tab={profile}
            onClose={() => setProfile(false)}
          />
        )}
      </AnimatePresence>
      <Rewards onSave={() => setProfile("account")} />
      <AnimatePresence>{ask && !table && <WhatLostYou key="lost" ask={ask} onDone={() => setAsk(null)} />}</AnimatePresence>
      {error && (
        <div className="acct-toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}

const LOST_KEY = "heist.lostAsked";
function lostAsked() {
  try {
    return !!localStorage.getItem(LOST_KEY);
  } catch {
    return false;
  }
}
function markLostAsked() {
  try {
    localStorage.setItem(LOST_KEY, "1");
  } catch {
    // storage blocked: the server still remembers
  }
}

function savedName() {
  try {
    return localStorage.getItem("heist.name") || "Ace";
  } catch {
    return "Ace";
  }
}
