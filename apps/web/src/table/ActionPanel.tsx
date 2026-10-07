import { HOME_TURF, ROLES, cardLabel, isFighter, jobBases, type Answer, type Ask, type GameState, type Side } from "@heist/engine";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { click } from "../sound";
import { CardFace } from "./pieces";

/** Which hand cards the current ask lets you select, and how many. */
export function handSelect(ask: Ask | null, s: GameState, seat: number): { max: number; allow: (id: number) => boolean } | null {
  if (!ask) return null;
  const hand = s.players[seat].hand;
  if (ask.kind === "bank") return { max: ask.max, allow: () => true };
  if (ask.kind === "discard") return { max: ask.count, allow: () => true };
  if (ask.kind === "showdown") return { max: 1, allow: (id) => hand.some((c) => c.id === id && isFighter(c)) };
  return null;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <button disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="stepper-v">{value}</span>
      <button disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

function Btn({ children, onClick, kind = "", disabled }: { children: React.ReactNode; onClick: () => void; kind?: string; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      className={"btn " + kind}
      disabled={disabled}
      onClick={() => {
        click();
        onClick();
      }}
    >
      {children}
    </motion.button>
  );
}

export function ActionPanel({ ask, s, seat, sel, setSel, answer }: { ask: Ask; s: GameState; seat: number; sel: number[]; setSel: (x: number[]) => void; answer: (a: Answer) => void }) {
  const [n, setN] = useState(1);
  const [n2, setN2] = useState(0);
  const P = s.players[seat];
  const name = (p: number) => s.players[p].name;
  useEffect(() => {
    setSel([]);
    if (ask.kind === "send") setN(Math.min(ask.max, Math.max(1, ask.max - 1)));
    else if (ask.kind === "join") {
      setN(Math.min(2, ask.max));
      setN2(0);
    } else setN(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);
  const j = s.job;
  const odds = j && j.kind === "hit" ? jobBases(s, j) : null;
  const oddsLine = odds && j ? (
    <div className="odds">
      Boss side <b>{odds.b}</b> vs Mark side <b>{odds.m}</b> <span className="dim">(crew{j.kind === "hit" ? `, home turf +${s.players[j.boss].role === "mastermind" ? 2 : HOME_TURF}` : ""}) plus the cards</span>
    </div>
  ) : null;

  let title = "";
  let body: React.ReactNode = null;
  switch (ask.kind) {
    case "keepRole":
      title = "Pick your Role";
      body = (
        <div className="role-pick">
          {ask.options.map((r) => {
            const R = ROLES.find((x) => x.id === r)!;
            return (
              <motion.button key={r} className="role-card" whileHover={{ y: -6 }} onClick={() => answer({ kind: "keepRole", role: r })}>
                <span className="role-name">{R.name}</span>
                <span className="role-text">{R.text}</span>
              </motion.button>
            );
          })}
        </div>
      );
      break;
    case "wildcard":
      title = "Wildcard: swap Roles?";
      body = (
        <div className="btns wrap">
          {ask.targets.map((t) => (
            <Btn key={t} onClick={() => answer({ kind: "wildcard", target: t })}>
              Take {name(t)}'s {ROLES.find((r) => r.id === s.players[t].role)?.name}
            </Btn>
          ))}
          <Btn kind="ghost" onClick={() => answer({ kind: "wildcard", target: null })}>
            Not now
          </Btn>
        </div>
      );
      break;
    case "fence":
      title = "Fence: pay $2 for a discarded card?";
      body = (
        <>
          <div className="pick-row">
            {[...s.discard].reverse().slice(0, 12).map((c) => (
              <span key={c.id} className="clickable" onClick={() => answer({ kind: "fence", cardId: c.id })}>
                <CardFace card={c} size="sm" />
              </span>
            ))}
          </div>
          <div className="btns">
            <Btn kind="ghost" onClick={() => answer({ kind: "fence", cardId: null })}>
              Skip
            </Btn>
          </div>
        </>
      );
      break;
    case "bank":
      title = `Bank up to ${ask.max} card${ask.max > 1 ? "s" : ""}`;
      body = (
        <>
          <div className="hint">Tap cards in your hand. Banked cards are your cash (no change given). Keep a Score or Fixer to fight with.</div>
          <div className="btns">
            <Btn kind="primary" onClick={() => answer({ kind: "bank", cardIds: sel })} disabled={!sel.length}>
              Bank {sel.length || ""} (${P.hand.filter((c) => sel.includes(c.id)).reduce((a, c) => a + c.cash, 0)})
            </Btn>
            <Btn kind="ghost" onClick={() => answer({ kind: "bank", cardIds: [] })}>
              Skip
            </Btn>
          </div>
        </>
      );
      break;
    case "hire":
      title = `Hire crew ($${ask.cost} each)`;
      body = (
        <div className="btns">
          {Array.from({ length: ask.max + 1 }, (_, k) => (
            <Btn key={k} kind={k ? "primary" : "ghost"} onClick={() => answer({ kind: "hire", count: k })}>
              {k ? `Hire ${k}` : "None"}
            </Btn>
          ))}
        </div>
      );
      break;
    case "action":
      title = "Your move";
      body = (
        <>
          <div className="btns wrap">
            {ask.canHit && (
              <Btn kind="primary big" onClick={() => answer({ kind: "action", choice: "hit" })}>
                {P.role === "mastermind" ? "Hit (pick the Mark)" : "Hit (flip for the Mark)"}
              </Btn>
            )}
            {ask.busts.map((b) => (
              <Btn key={`b${b.hideout}-${b.rival}`} kind="danger" onClick={() => answer({ kind: "action", choice: "bust", hideout: b.hideout, rival: b.rival })}>
                Bust {name(b.rival)} out of hideout {b.hideout + 1}
              </Btn>
            ))}
            {ask.wanted.map((w) => (
              <Btn key={`w${w.mark}-${w.hideout}`} kind="warn" onClick={() => answer({ kind: "action", choice: "wanted", mark: w.mark, hideout: w.hideout })}>
                Wanted: hit {name(w.mark)}'s hideout {w.hideout + 1}
              </Btn>
            ))}
            <Btn kind="ghost" onClick={() => answer({ kind: "action", choice: "pass" })}>
              Lay low
            </Btn>
          </div>
          {ask.wanted.length > 0 && <div className="hint">Wanted: {name(ask.wanted[0].leader)} leads. Hit a hideout holding their crew.</div>}
        </>
      );
      break;
    case "pickMark":
      title = ask.why === "mastermind" ? "Mastermind: pick the Mark" : "Nobody's color. Pick the Mark";
      body = (
        <>
          <div className="hint">Tap a rival at the table.</div>
          <div className="btns wrap">
            {ask.rivals.map((r) => (
              <Btn key={r} onClick={() => answer({ kind: "pickMark", mark: r })}>
                {name(r)}
              </Btn>
            ))}
          </div>
        </>
      );
      break;
    case "pickHideout":
      title = `Pick ${name(ask.mark)}'s hideout to hit`;
      body = (
        <div className="btns">
          {s.players[ask.mark].hideouts.map((h, i) => (
            <Btn key={i} onClick={() => answer({ kind: "pickHideout", hideout: i })}>
              Hideout {i + 1} · {h[ask.mark]} guard{h[ask.mark] === 1 ? "" : "s"}
            </Btn>
          ))}
        </div>
      );
      break;
    case "send":
      title = "Send your crew";
      body = (
        <>
          {oddsLine}
          <div className="btns">
            <Stepper value={n} min={1} max={ask.max} onChange={setN} />
            <Btn kind="primary" onClick={() => answer({ kind: "send", count: n })}>
              Send {n}
            </Btn>
          </div>
          <div className="hint">Win and each crew on your side leaves 1 behind as a Foothold. Lose and they all go to the Pen.</div>
        </>
      );
      break;
    case "join":
      title = "Join the job?";
      body = (
        <>
          {oddsLine}
          {ask.split ? (
            <div className="btns wrap">
              <span className="lbl">Boss</span>
              <Stepper value={n} min={0} max={ask.max - n2} onChange={setN} />
              <span className="lbl">Mark</span>
              <Stepper value={n2} min={0} max={ask.max - n} onChange={setN2} />
              <Btn kind="primary" onClick={() => answer({ kind: "join", B: n, M: n2 })}>
                Join
              </Btn>
              <Btn kind="ghost" onClick={() => answer({ kind: "join", B: 0, M: 0 })}>
                Stay out
              </Btn>
            </div>
          ) : (
            <div className="btns wrap">
              <Stepper value={n} min={1} max={ask.max} onChange={setN} />
              <Btn kind="gold" onClick={() => answer({ kind: "join", B: n, M: 0 })}>
                Back the Boss
              </Btn>
              <Btn kind="danger" onClick={() => answer({ kind: "join", B: 0, M: n })}>
                Defend the Mark
              </Btn>
              <Btn kind="ghost" onClick={() => answer({ kind: "join", B: 0, M: 0 })}>
                Stay out
              </Btn>
            </div>
          )}
          <div className="hint">Boss side wins: you leave 1 crew as a Foothold. Mark holds: defenders bank a Cut.</div>
        </>
      );
      break;
    case "doubleCross":
      title = "Play Double-Cross?";
      body = (
        <div className="btns wrap">
          {ask.targets.map((t) => (
            <Btn key={t} kind="danger" onClick={() => answer({ kind: "doubleCross", target: t })}>
              Flip {name(t)} to the other side
            </Btn>
          ))}
          <Btn kind="ghost" onClick={() => answer({ kind: "doubleCross", target: null })}>
            Hold it
          </Btn>
        </div>
      );
      break;
    case "bet": {
      title = "Side bet";
      const pick = sel.length ? P.bank.find((c) => c.id === sel[0]) : P.bank.reduce((m, c) => (c.cash < m.cash ? c : m), P.bank[0]);
      body = (
        <>
          {oddsLine}
          <div className="pick-row">
            {P.bank.map((c) => (
              <span key={c.id} className={"clickable" + (pick && pick.id === c.id ? " picked" : "")} onClick={() => setSel([c.id])}>
                <CardFace card={c} size="xs" />
              </span>
            ))}
          </div>
          <div className="btns">
            {(["B", "M"] as Side[]).map((sd) => (
              <Btn key={sd} kind={sd === "B" ? "gold" : "danger"} onClick={() => answer({ kind: "bet", side: sd, cardId: pick!.id })}>
                ${pick?.cash} on the {sd === "B" ? "Boss" : "Mark"}
              </Btn>
            ))}
            <Btn kind="ghost" onClick={() => answer({ kind: "bet", side: null })}>
              No bet
            </Btn>
          </div>
          <div className="hint">Right: your card comes back and you bank the top Job card. Wrong: you lose it.</div>
        </>
      );
      break;
    }
    case "hackerCall":
      title = "Hacker: call a number";
      body = (
        <div className="btns wrap">
          {ask.numbers.map((k) => (
            <Btn key={k} onClick={() => answer({ kind: "hackerCall", n: k })}>
              {k}
            </Btn>
          ))}
        </div>
      );
      break;
    case "showdown": {
      title = ask.as === "bust" || ask.as === "rival" ? "Bust: lay a card face down" : "Showdown: lay a card face down";
      const c = P.hand.find((x) => x.id === sel[0]);
      body = (
        <>
          {oddsLine}
          {(ask.as === "bust" || ask.as === "rival") && <div className="hint">Card plus your crew in that hideout. A Fixer counts as 0 here.</div>}
          {ask.as !== "bust" && ask.as !== "rival" && <div className="hint">Score vs Score: higher total wins, tie to the Mark. A Score beats a Fixer. Fixer vs Fixer: make a deal.</div>}
          <div className="btns">
            <Btn kind="primary big" disabled={!c} onClick={() => answer({ kind: "showdown", cardId: c!.id })}>
              {c ? `Lay down ${cardLabel(c)}` : "Tap a Score or Fixer"}
            </Btn>
          </div>
        </>
      );
      break;
    }
    case "forger":
      title = "Forger: change your Score?";
      body = (
        <div className="btns wrap">
          {ask.numbers.map((k) => (
            <Btn key={k} onClick={() => answer({ kind: "forger", n: k })}>
              {k}
            </Btn>
          ))}
          <Btn kind="ghost" onClick={() => answer({ kind: "forger", n: null })}>
            Keep it
          </Btn>
        </div>
      );
      break;
    case "backup":
      title = "Play Backup (+3)?";
      body = (
        <>
          {j && (
            <div className="odds">
              Boss <b>{j.bTotal}</b> vs Mark <b>{j.mTotal}</b> <span className="dim">(tie goes to the Mark)</span>
            </div>
          )}
          <div className="btns">
            <Btn kind="gold" onClick={() => answer({ kind: "backup", side: "B" })}>
              +3 Boss
            </Btn>
            <Btn kind="danger" onClick={() => answer({ kind: "backup", side: "M" })}>
              +3 Mark
            </Btn>
            <Btn kind="ghost" onClick={() => answer({ kind: "backup", side: null })}>
              Hold
            </Btn>
          </div>
        </>
      );
      break;
    case "dealOffer":
      title = "Fixer vs Fixer: offer a deal";
      body = (
        <>
          <div className="btns wrap">
            <Btn kind="primary" onClick={() => answer({ kind: "dealOffer", offer: "foothold" })}>
              I pay $3, I leave 1 crew
            </Btn>
            <Btn onClick={() => answer({ kind: "dealOffer", offer: "walk" })}>We both walk away</Btn>
            <Btn kind="ghost" onClick={() => answer({ kind: "dealOffer", offer: null })}>
              No deal
            </Btn>
          </div>
          <div className="hint">No deal: you and the Mark each send 2 crew to the Pen.</div>
        </>
      );
      break;
    case "dealAccept":
      title = `${j ? name(j.boss) : "The Boss"} offers a deal`;
      body = (
        <>
          <div className="odds">{ask.offer === "foothold" ? "They pay you $3 and leave 1 crew in your hideout." : "Everyone walks away. Nothing lost."}</div>
          <div className="btns">
            <Btn kind="primary" onClick={() => answer({ kind: "dealAccept", accept: true })}>
              Deal
            </Btn>
            <Btn kind="danger" onClick={() => answer({ kind: "dealAccept", accept: false })}>
              No deal (2 crew each to the Pen)
            </Btn>
          </div>
        </>
      );
      break;
    case "again":
      title = "You won. Hit again?";
      body = (
        <div className="btns">
          <Btn kind="primary" onClick={() => answer({ kind: "again", again: true })}>
            Hit again
          </Btn>
          <Btn kind="ghost" onClick={() => answer({ kind: "again", again: false })}>
            End turn
          </Btn>
        </div>
      );
      break;
    case "discard":
      title = `Discard ${ask.count} (hand limit 7)`;
      body = (
        <div className="btns">
          <Btn kind="primary" disabled={sel.length !== ask.count} onClick={() => answer({ kind: "discard", cardIds: sel })}>
            Discard {sel.length}/{ask.count}
          </Btn>
        </div>
      );
      break;
  }
  return (
    <motion.div className={"action-panel" + (ask.kind === "keepRole" ? " wide" : "")} key={ask.kind} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.25 }}>
      <div className="action-title">{title}</div>
      {body}
    </motion.div>
  );
}

