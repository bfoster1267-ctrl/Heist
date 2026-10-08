import type { Answer } from "@heist/engine";
import { DRINKS } from "@heist/profile";
import { AnimatePresence } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { ProfileChip } from "./account/bits";
import { Profile } from "./account/Profile";
import { Rewards } from "./account/Rewards";
import { AccountProvider, useAccount } from "./account/useAccount";
import "./account/account.css";
import { Lobby, type LobbyChoice } from "./Lobby";
import { Table } from "./table/Table";
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
  const { me, act, showReward, error, clearError } = useAccount();
  const [table, setTable] = useState<Seated | null>(null);
  const [round, setRound] = useState(0);
  // the profile sheet and which tab it opens on (false = closed)
  const [profile, setProfile] = useState<false | "career" | "account">(false);
  const finished = useRef(false);

  // The buy-in is paid and the seed comes from the account (the server, when there is one), so the
  // finished game can be checked and counted toward the career.
  const sit = useCallback(
    async (c: LobbyChoice) => {
      if (me && c.name && c.name !== me.name) await act((b) => b.rename(c.name));
      const t = await act((b) => b.soloStart(c.players, c.stakes, c.name));
      if (!t) return;
      if (t.quit) showReward(t.quit);
      finished.current = false;
      setTable({ players: c.players, name: c.name, stakes: c.stakes, seed: t.seed, gameId: t.gameId });
      setRound((r) => r + 1);
    },
    [me, act, showReward],
  );

  const gameOver = useCallback(
    async (_won: number, answers: Answer[]) => {
      if (!table || finished.current) return;
      finished.current = true;
      const r = await act((b) => b.soloFinish(table.gameId, answers));
      if (r) showReward(r.reward);
    },
    [table, act, showReward],
  );

  // Walking out mid-game counts as a loss: the buy-in is already in the pot.
  const exit = useCallback(() => {
    if (!finished.current) void act((b) => b.soloQuit());
    finished.current = true;
    setTable(null);
  }, [act]);

  const buyDrink = useCallback(
    async (emoji: string, count: number) => {
      const d = DRINKS.find((x) => x.emoji === emoji);
      return !!d && !!(await act((b) => b.drink(d.id, count)));
    },
    [act],
  );

  if (!me) return <div className="loading">Opening the vault…</div>;
  const chips = me.progress.chips;

  return (
    <>
      {!table ? (
        <>
          <Lobby
            chips={chips}
            defaultName={me.guest && me.name.startsWith("Guest") ? undefined : me.name}
            onPlay={sit}
            onRefill={() => act((b) => b.refill())}
            top={<ProfileChip me={me} onOpen={() => setProfile("career")} />}
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
          onAgain={() => {
            if (chips < table.stakes) return exit();
            void sit(table);
          }}
        />
      )}
      <AnimatePresence>{profile && <Profile key={profile} tab={profile} onClose={() => setProfile(false)} />}</AnimatePresence>
      <Rewards onSave={() => setProfile("account")} />
      {error && (
        <div className="acct-toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}
