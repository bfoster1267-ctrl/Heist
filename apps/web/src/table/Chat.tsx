// Emotes and quick chat: speech bubbles over the seats. You pick from a tray; bots react to what
// happens at the table (a betrayal, a lost hideout, a big win) now and then, so the table feels alive.
// Online, the same bubbles will come from other players through the server.
import type { GameEvent, GameState } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { pop } from "../sound";

export interface Bubble {
  seat: number;
  text: string;
  key: number;
}

export const EMOTES = ["😎", "😂", "😡", "🤝", "👀", "💰", "😱", "🫡"];
export const LINES = ["Nice hit.", "Traitor!", "Deal?", "Watch your back.", "Not my crew!", "Good game."];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** What a bot might say after an event. Each entry: who speaks, and their lines. */
function botLines(ev: GameEvent, s: GameState): { seat: number; lines: string[] }[] {
  const j = s.job;
  switch (ev.t) {
    case "doubleCross":
      return [
        { seat: ev.target, lines: ["Traitor!", "😡", "Seriously?", "You'll pay for that."] },
        { seat: ev.seat, lines: ["😈", "Nothing personal.", "Business is business."] },
      ];
    case "result":
      if (!j) return [];
      return ev.winner === "B"
        ? [
            { seat: j.boss, lines: ["Too easy.", "😎", "💰", "Thanks for the hospitality."] },
            { seat: j.mark, lines: ["Get out of my house!", "😡", "I'll remember that.", "Lucky flip."] },
          ]
        : [
            { seat: j.mark, lines: ["Not today.", "🫡", "Nice try.", "Home turf, baby."] },
            { seat: j.boss, lines: ["😱", "Ugh.", "Next time."] },
          ];
    case "mark":
      return [{ seat: ev.mark, lines: ["Why me?", "👀", "Bring it.", "Come and try."] }];
    case "hacked":
      return [{ seat: ev.seat, lines: ["Called it.", "😎", "I'm in."] }];
    case "bustResult":
      return [{ seat: ev.winner, lines: ["My house, my rules.", "😤", "Out!"] }];
    case "gameOver":
      return ev.winners.map((w) => ({ seat: w, lines: ["Good game.", "🏆", "Pleasure doing business."] }));
    case "lastCall":
      return [{ seat: s.boss, lines: ["Last call!", "😱", "Now or never."] }];
    default:
      return [];
  }
}

export function useBubbles(human: number) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const n = useRef(0);
  const last = useRef(0);
  const say = useCallback((seat: number, text: string) => {
    const b = { seat, text, key: ++n.current };
    pop();
    setBubbles((bs) => [...bs.filter((x) => x.seat !== seat), b]);
    window.setTimeout(() => setBubbles((bs) => bs.filter((x) => x !== b)), 2800);
  }, []);
  /** Let the bots react to a table event, sometimes. At most one line every few seconds. */
  const react = useCallback(
    (ev: GameEvent | null, s: GameState) => {
      if (!ev || performance.now() - last.current < 3500) return;
      const options = botLines(ev, s).filter((o) => o.seat !== human && s.players[o.seat]?.bot);
      if (!options.length || Math.random() > (ev.t === "gameOver" || ev.t === "doubleCross" ? 0.85 : 0.45)) return;
      const o = pick(options);
      last.current = performance.now();
      window.setTimeout(() => say(o.seat, pick(o.lines)), 350);
    },
    [human, say],
  );
  return { bubbles, say, react };
}

export function Bubbles({ bubbles, pos }: { bubbles: Bubble[]; pos: (seat: number) => [number, number] }) {
  return (
    <AnimatePresence>
      {bubbles.map((b) => {
        const [x, y] = pos(b.seat);
        const emoji = [...b.text].length <= 2;
        return (
          <motion.div
            key={b.key}
            className={"bubble" + (emoji ? " emoji" : "")}
            style={{ left: x, top: y - 62 }}
            initial={{ scale: 0.3, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
            role="status"
          >
            {b.text}
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

export function ChatTray({ onSay, onClose }: { onSay: (t: string) => void; onClose: () => void }) {
  const [cool, setCool] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const send = (t: string) => {
    if (cool) return;
    onSay(t);
    setCool(true);
    window.setTimeout(() => setCool(false), 1500);
    onClose();
  };
  return (
    <motion.div className="chat-tray" role="dialog" aria-label="Emotes and quick chat" initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}>
      <div className="chat-emotes">
        {EMOTES.map((e) => (
          <button key={e} onClick={() => send(e)} aria-label={`Send ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="chat-lines">
        {LINES.map((l) => (
          <button key={l} className="btn small" onClick={() => send(l)}>
            {l}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
