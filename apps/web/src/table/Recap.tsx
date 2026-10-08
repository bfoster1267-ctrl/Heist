// The after-game recap: a Foothold race chart, each player's numbers, the big moments, and the full
// hand history grouped by turn.
import { CREWS, type GameState } from "@heist/engine";
import { useMemo, useState } from "react";
import type { HistoryEntry } from "../useTable";
import { Crew } from "./pieces";

interface Line {
  hitsWon: number;
  hitsLost: number;
  held: number;
  fell: number;
  doubleCrosses: number;
  toPen: number;
  loot: number;
}

function stats(h: HistoryEntry[], n: number) {
  const per: Line[] = Array.from({ length: n }, () => ({ hitsWon: 0, hitsLost: 0, held: 0, fell: 0, doubleCrosses: 0, toPen: 0, loot: 0 }));
  const moments: { turn: number; text: string; weight: number }[] = [];
  for (const e of h) {
    const ev = e.ev;
    if (ev.t === "result" && e.mark !== null) {
      const margin = Math.abs(ev.bTotal - ev.mTotal);
      if (ev.winner === "B") {
        per[e.boss].hitsWon++;
        per[e.mark].fell++;
      } else {
        per[e.boss].hitsLost++;
        per[e.mark].held++;
      }
      if (margin <= 1) moments.push({ turn: e.turn, text: `Photo finish: ${ev.bTotal} vs ${ev.mTotal}. ${e.msg}`, weight: 3 });
      else if (margin >= 12) moments.push({ turn: e.turn, text: `Blowout: ${ev.bTotal} vs ${ev.mTotal}. ${e.msg}`, weight: 2 });
    } else if (ev.t === "doubleCross") {
      per[ev.seat].doubleCrosses++;
      moments.push({ turn: e.turn, text: e.msg, weight: 4 });
    } else if (ev.t === "hacked") moments.push({ turn: e.turn, text: e.msg, weight: 4 });
    else if (ev.t === "toPen") per[ev.seat].toPen += ev.count;
    else if (ev.t === "loot") per[ev.to].loot += ev.amount;
    else if (ev.t === "lastCall") moments.push({ turn: e.turn, text: "Last Call.", weight: 1 });
    else if (ev.t === "deal") moments.push({ turn: e.turn, text: e.msg, weight: 2 });
  }
  moments.sort((a, b) => b.weight - a.weight || a.turn - b.turn);
  return { per, moments: moments.slice(0, 5).sort((a, b) => a.turn - b.turn) };
}

function RaceChart({ h, s }: { h: HistoryEntry[]; s: GameState }) {
  const W = 460, H = 150, pad = 22;
  // One point per turn: footholds at the end of that turn.
  const byTurn = new Map<number, number[]>();
  for (const e of h) byTurn.set(e.turn, e.fh);
  const turns = [...byTurn.keys()].sort((a, b) => a - b);
  const maxT = Math.max(1, turns.length - 1);
  const maxY = Math.max(s.target, ...[...byTurn.values()].flat());
  const x = (i: number) => pad + (i / maxT) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / maxY) * (H - pad * 2);
  return (
    <svg className="race" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Footholds over the game, per player">
      {Array.from({ length: maxY + 1 }, (_, v) => (
        <g key={v}>
          <line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" />
          <text x={pad - 8} y={y(v) + 4} textAnchor="end" className="race-axis">
            {v}
          </text>
        </g>
      ))}
      <line x1={pad} x2={W - pad} y1={y(s.target)} y2={y(s.target)} stroke="rgba(231,181,60,0.5)" strokeDasharray="4 4" />
      {s.players.map((p) => {
        const pts = turns.map((t, i) => `${x(i)},${y(byTurn.get(t)![p.seat] ?? 0)}`).join(" ");
        const win = s.winners?.includes(p.seat);
        return <polyline key={p.seat} points={pts} fill="none" stroke={CREWS[p.color].hex} strokeWidth={win ? 3.5 : 2} strokeLinejoin="round" opacity={win ? 1 : 0.8} />;
      })}
      <text x={W - pad} y={H - 4} textAnchor="end" className="race-axis">
        turns →
      </text>
    </svg>
  );
}

export function Recap({ h, s }: { h: HistoryEntry[]; s: GameState }) {
  const [tab, setTab] = useState<"recap" | "history">("recap");
  const { per, moments } = useMemo(() => stats(h, s.n), [h, s.n]);
  const turns = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of h) {
      if (e.ev.t === "setup" || e.ev.t === "role") continue;
      if (!m.has(e.turn)) m.set(e.turn, []);
      m.get(e.turn)!.push(e.msg);
    }
    return [...m.entries()];
  }, [h]);
  return (
    <div className="recap">
      <div className="seg small recap-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "recap"} className={tab === "recap" ? "on" : ""} onClick={() => setTab("recap")}>
          Recap
        </button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
          Hand history
        </button>
      </div>
      {tab === "recap" ? (
        <>
          <RaceChart h={h} s={s} />
          <table className="recap-stats">
            <thead>
              <tr>
                <th />
                <th data-tip="Hits won as Boss">Hits</th>
                <th data-tip="Defended as the Mark">Held</th>
                <th data-tip="Crew sent to the Pen">Pen</th>
                <th data-tip="Loot taken">Loot</th>
                <th data-tip="Double-Crosses played">✕</th>
              </tr>
            </thead>
            <tbody>
              {s.players.map((p) => (
                <tr key={p.seat} className={s.winners?.includes(p.seat) ? "win" : ""}>
                  <td>
                    <Crew color={p.color} size={14} /> {p.name}
                  </td>
                  <td>
                    {per[p.seat].hitsWon}/{per[p.seat].hitsWon + per[p.seat].hitsLost}
                  </td>
                  <td>
                    {per[p.seat].held}/{per[p.seat].held + per[p.seat].fell}
                  </td>
                  <td>{per[p.seat].toPen}</td>
                  <td>${per[p.seat].loot}</td>
                  <td>{per[p.seat].doubleCrosses}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {moments.length > 0 && (
            <ul className="moments">
              {moments.map((m, i) => (
                <li key={i}>
                  <span className="dim">Turn {m.turn}</span> {m.text}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="history" tabIndex={0}>
          {turns.map(([turn, msgs]) => (
            <div key={turn} className="history-turn">
              <div className="history-head">Turn {turn}</div>
              {msgs.map((m, i) => (
                <div key={i} className="history-line">
                  {m}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
