import { useCallback, useState } from "react";
import { Lobby, type LobbyChoice } from "./Lobby";
import { Table } from "./table/Table";
import type { TableSettings } from "./useTable";
import { REFILL_TO, loadChips, saveChips } from "./wallet";

export function App() {
  const [chips, setChipsState] = useState(loadChips);
  const [table, setTable] = useState<TableSettings | null>(null);
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
  };

  if (!table) return <Lobby chips={chips} onPlay={sit} onRefill={() => setChips((c) => Math.max(c, REFILL_TO))} />;
  return (
    <Table
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
