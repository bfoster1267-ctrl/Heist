import { useCallback, useState } from "react";
import { Lobby, type LobbyChoice } from "./Lobby";
import { OnlineLobby, inviteCode } from "./online/OnlineLobby";
import { Table } from "./table/Table";
import type { TableSettings } from "./useTable";
import { REFILL_TO, loadChips, saveChips } from "./wallet";

export function App() {
  const [chips, setChipsState] = useState(loadChips);
  const [table, setTable] = useState<TableSettings | null>(null);
  const [round, setRound] = useState(0);
  // online: the player's name, set while the friends lobby or an online table is open
  const [online, setOnline] = useState<string | null>(() => (inviteCode() ? savedName() : null));
  const setChips = useCallback((f: (c: number) => number) => {
    setChipsState((c) => {
      const v = f(c);
      saveChips(v);
      return v;
    });
  }, []);

  const sit = (c: LobbyChoice) => {
    setChips((x) => x - c.stakes);
    setTable({ ...c, seed: undefined });
    setRound((r) => r + 1);
  };

  if (online !== null)
    return (
      <OnlineLobby
        name={online}
        chips={chips}
        join={inviteCode()}
        onExit={() => setOnline(null)}
        onBuyIn={(stakes) => setChips((c) => Math.max(0, c - stakes))}
        onWin={(won) => setChips((c) => c + won)}
      />
    );
  if (!table) return <Lobby chips={chips} onPlay={sit} onRefill={() => setChips((c) => Math.max(c, REFILL_TO))} onOnline={setOnline} />;
  return (
    <Table
      key={round}
      settings={table}
      onExit={() => setTable(null)}
      onGameOver={(won) => won && setChips((c) => c + won)}
      onAgain={() => {
        if (chips < table.stakes) return setTable(null);
        sit(table);
      }}
    />
  );
}

function savedName() {
  try {
    return localStorage.getItem("heist.name") || "Ace";
  } catch {
    return "Ace";
  }
}
