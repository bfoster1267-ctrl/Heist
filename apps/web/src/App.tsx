import { soloBotNames } from "@heist/profile";
import { AnimatePresence } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { ProfileChip } from "./account/bits";
import { Drinks } from "./account/Drinks";
import { Profile } from "./account/Profile";
import { Rewards } from "./account/Rewards";
import { AccountProvider, useAccount } from "./account/useAccount";
import { Lobby, type LobbyChoice } from "./Lobby";
import { Table } from "./table/Table";
import type { TableSettings } from "./useTable";
import type { Answer } from "@heist/engine";
import "./account/account.css";

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
  key: number;
}

function Game() {
  const { me, act, showReward, error, clearError } = useAccount();
  const [table, setTable] = useState<Seated | null>(null);
  const [profile, setProfile] = useState(false);
  const finished = useRef(false);

  const sit = useCallback(
    async (c: LobbyChoice) => {
      if (me && c.name && c.name !== me.name) await act((b) => b.rename(c.name));
      const t = await act((b) => b.soloStart(c.players, c.stakes, c.name));
      if (!t) return;
      if (t.quit) showReward(t.quit);
      finished.current = false;
      setTable((old) => ({ ...c, seed: t.seed, gameId: t.gameId, key: (old?.key ?? 0) + 1 }));
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

  const exit = useCallback(() => {
    // walking out mid-game counts as a loss (the buy-in is already in the pot)
    if (!finished.current) void act((b) => b.soloQuit());
    finished.current = true;
    setTable(null);
  }, [act]);

  if (!me) return <div className="loading">Opening the vault…</div>;
  const chips = me.progress.chips;

  return (
    <>
      {!table ? (
        <>
          <Lobby chips={chips} onPlay={sit} onRefill={() => act((b) => b.refill())} />
          <div className="acct-corner">
            <ProfileChip me={me} onOpen={() => setProfile(true)} />
          </div>
        </>
      ) : (
        <>
          <Table
            key={table.key}
            settings={table}
            onExit={exit}
            onGameOver={gameOver}
            onAgain={() => {
              if (chips < table.stakes) return exit();
              void sit(table);
            }}
          />
          <Drinks names={[table.name || "You", ...soloBotNames(table.seed, table.players)]} />
        </>
      )}
      <AnimatePresence>{profile && !table && <Profile onClose={() => setProfile(false)} />}</AnimatePresence>
      <Rewards />
      {error && (
        <div className="acct-toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}
