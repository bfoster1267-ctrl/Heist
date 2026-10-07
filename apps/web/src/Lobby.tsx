import { CREWS } from "@heist/engine";
import { motion } from "motion/react";
import { useState } from "react";
import { Chips, CrewBadge } from "./table/pieces";
import { REFILL_TO, STAKES } from "./wallet";

const FLOAT_POS = [
  { left: "6%", top: "12%" },
  { left: "10%", top: "48%" },
  { left: "5%", top: "80%" },
  { right: "6%", top: "14%" },
  { right: "10%", top: "50%" },
  { right: "5%", top: "78%" },
];

export interface LobbyChoice {
  players: number;
  name: string;
  stakes: number;
}

export function Lobby({ chips, onPlay, onRefill }: { chips: number; onPlay: (c: LobbyChoice) => void; onRefill: () => void }) {
  const [players, setPlayers] = useState(4);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("heist.name") || "";
    } catch {
      return "";
    }
  });
  const [stake, setStake] = useState(1);
  const go = (i: number) => {
    try {
      localStorage.setItem("heist.name", name);
    } catch {
      /* ignore */
    }
    onPlay({ players, name: name.trim() || "Ace", stakes: STAKES[i].buyIn });
  };
  return (
    <div className="lobby">
      <div className="lobby-bg">
        {CREWS.map((c, i) => (
          <motion.span
            key={c.id}
            className="lobby-float"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: [0, -14, 0], opacity: 0.85 }}
            transition={{ y: { duration: 4 + i * 0.4, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 1, delay: i * 0.1 } }}
            style={FLOAT_POS[i]}
          >
            <CrewBadge color={i} size={54} />
          </motion.span>
        ))}
      </div>
      <motion.div className="lobby-card" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="logo">HEIST</div>
        <div className="tagline">Plan the job. Pick your crew. Trust no one.</div>
        <div className="wallet">
          <Chips amount={chips} />
          <span className="dim">play chips</span>
          {chips < REFILL_TO && (
            <button className="btn small" onClick={onRefill}>
              Free refill
            </button>
          )}
        </div>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={14} placeholder="Ace" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span>Players</span>
          <div className="seg">
            {[3, 4, 5, 6].map((n) => (
              <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Table</span>
          <div className="stakes-grid">
            {STAKES.map((st, i) => (
              <button key={st.name} className={"stake" + (stake === i ? " on" : "")} disabled={chips < st.buyIn} onClick={() => setStake(i)}>
                <span className="stake-name">{st.name}</span>
                <span className="stake-buy">Buy-in {st.buyIn.toLocaleString()}</span>
                <span className="stake-pot">Pot {(st.buyIn * players).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        <button className="btn primary huge" disabled={chips < STAKES[stake].buyIn} onClick={() => go(stake)}>
          Quick Match
        </button>
        <div className="lobby-row">
          <button className="btn ghost" disabled title="Coming with online play">
            Invite friends
          </button>
          <button className="btn ghost" disabled title="Coming with online play">
            Queue with friends
          </button>
        </div>
        <div className="fine">Online tables are coming. Quick Match seats you with bots for now. Chips are play money only.</div>
      </motion.div>
    </div>
  );
}
