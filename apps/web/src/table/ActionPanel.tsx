import { HOME_TURF, isFighter, jobBases, type Answer, type Ask, type GameState, type Side } from "@heist/engine";
import { motion, useIsPresent } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { buzz } from "../haptics";
import { click } from "../sound";
import { panelRoom } from "./layout";
import { pressable } from "./Seat";
import { CardFace, Crew, RoleCard } from "./pieces";
import { t as tr, tNodes } from "../i18n";
import { cardName, roleName } from "../i18n/data";

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
      <button aria-label={tr("act.fewer")} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="stepper-v" aria-live="polite">{value}</span>
      <button aria-label={tr("act.more")} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

function Btn({ children, onClick, kind = "", disabled, label }: { children: React.ReactNode; onClick: () => void; kind?: string; disabled?: boolean; label?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      className={"btn " + kind}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => {
        click();
        buzz("tap");
        onClick();
      }}
    >
      {children}
    </motion.button>
  );
}

export function ActionPanel({
  ask,
  s,
  seat,
  sel,
  setSel,
  answer,
  clock,
  coach,
}: {
  ask: Ask;
  s: GameState;
  seat: number;
  sel: number[];
  setSel: (x: number[]) => void;
  answer: (a: Answer) => void;
  /** shown in the title row (online: the turn clock) */
  clock?: ReactNode;
  /** Coached play: the coach's short read, sitting just above the decision buttons */
  coach?: ReactNode;
}) {
  const [n, setN] = useState(1);
  const [n2, setN2] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  // Each move swaps in a new panel while the old one fades; mark the old one so it can be told apart
  const present = useIsPresent();
  // Move keyboard focus to the first choice so the game plays from the keyboard.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body && !panel.current?.contains(document.activeElement)) return;
      panel.current?.querySelector<HTMLElement>(".btn.primary:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, [ask]);
  // On a phone held sideways the panel grows up from the bottom corner; stop it under the seat above
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = panel.current, canvas = el?.closest<HTMLElement>(".canvas");
      if (el && canvas) setRoom(panelRoom(el, canvas));
    };
    fit();
    // seats grow a moment later when it's their turn, and the window can turn
    const t = window.setTimeout(fit, 450);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", fit);
    };
  }, [ask]);
  const P = s.players[seat];
  const name = (p: number) => s.players[p].name;
  const color = (p: number) => s.players[p].color;
  const me = seat;
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
  // Already have crew in the job's hideout? Winning leaves no new Foothold there, so all of yours come home.
  const alreadyIn = !!j && j.kind === "hit" && s.players[j.mark].hideouts[j.hideout][seat] > 0;
  const odds = j && j.kind === "hit" ? jobBases(s, j) : null;
  const oddsLine = odds && j ? (
    <div className="odds">
      {tNodes("act.odds", { b: <b>{odds.b}</b>, m: <b>{odds.m}</b> })}{" "}
      <span className="dim">{j.kind === "hit" ? tr("act.oddsCrewTurf", { n: s.players[j.boss].role === "mastermind" ? 2 : HOME_TURF }) : tr("act.oddsCrew")}</span>
    </div>
  ) : null;

  let title = "";
  let body: React.ReactNode = null;
  switch (ask.kind) {
    case "keepRole":
      title = tr("act.pickRole");
      body = (
        <div className="role-pick">
          {ask.options.map((r, i) => (
            <motion.button
              key={r}
              className="role-card"
              aria-label={tr("act.keepRole", { role: roleName(r) })}
              initial={{ rotateY: 90, y: 20 }}
              animate={{ rotateY: 0, y: 0 }}
              transition={{ delay: 0.15 + i * 0.15, type: "spring", stiffness: 200, damping: 20 }}
              whileHover={{ y: -8 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                click();
                buzz("bump");
                answer({ kind: "keepRole", role: r });
              }}
            >
              <RoleCard role={r} />
            </motion.button>
          ))}
        </div>
      );
      break;
    case "wildcard":
      title = tr("act.wildcard");
      body = (
        <div className="btns wrap">
          {ask.targets.map((t) => (
            <Btn key={t} onClick={() => answer({ kind: "wildcard", target: t })}>
              {tr("act.takeRole", { name: name(t), role: roleName(s.players[t].role) })}
            </Btn>
          ))}
          <Btn kind="ghost" onClick={() => answer({ kind: "wildcard", target: null })}>
            {tr("act.notNow")}
          </Btn>
        </div>
      );
      break;
    case "fence":
      title = tr("act.fence");
      body = (
        <>
          <div className="pick-row">
            {[...s.discard].reverse().slice(0, 12).map((c) => (
              <span key={c.id} className="clickable" {...pressable(() => answer({ kind: "fence", cardId: c.id }), tr("act.buy", { card: cardName(c) }))}>
                <CardFace card={c} size="sm" />
              </span>
            ))}
          </div>
          <div className="btns">
            <Btn kind="ghost" onClick={() => answer({ kind: "fence", cardId: null })}>
              {tr("act.skip")}
            </Btn>
          </div>
        </>
      );
      break;
    case "bank":
      title = tr("act.bankTitle", { count: ask.max });
      body = (
        <>
          <div className="hint">{tr("act.bankHint")}</div>
          <div className="btns">
            <Btn kind="primary" onClick={() => answer({ kind: "bank", cardIds: sel })} disabled={!sel.length}>
              {tr("act.bank", { n: sel.length || "", cash: P.hand.filter((c) => sel.includes(c.id)).reduce((a, c) => a + c.cash, 0) })}
            </Btn>
            <Btn kind="ghost" onClick={() => answer({ kind: "bank", cardIds: [] })}>
              {tr("act.skip")}
            </Btn>
          </div>
        </>
      );
      break;
    case "hire":
      title = tr("act.hireTitle", { cost: ask.cost });
      body = (
        <div className="btns">
          {Array.from({ length: ask.max + 1 }, (_, k) => (
            <Btn key={k} kind={k ? "primary" : "ghost"} onClick={() => answer({ kind: "hire", count: k })}>
              {k ? tr("act.hire", { n: k }) : tr("act.none")}
            </Btn>
          ))}
        </div>
      );
      break;
    case "action": {
      title = tr("act.yourMove");
      // Short buttons: the rival's crew shape and the hideout's number, so the panel stays clear of the seats
      const where = (p: number, h: number, inThere = false) => (
        <span className="move-target">
          <Crew color={color(p)} size={22} />
          <span className="ho-num">{h + 1}</span>
          {inThere && <span className="ho-in">{tr("act.in")}</span>}
        </span>
      );
      body = (
        <div className="move-grid">
          <div className="btns">
            {ask.canHit && (
              <Btn kind="primary big" label={P.role === "mastermind" ? tr("act.hitPick") : tr("act.hitFlip")} onClick={() => answer({ kind: "action", choice: "hit" })}>
                {tr("act.hit")}
              </Btn>
            )}
            <Btn kind="ghost" onClick={() => answer({ kind: "action", choice: "pass" })}>
              {tr("act.layLow")}
            </Btn>
          </div>
          {ask.busts.length > 0 && (
            <div className="btns wrap">
              <span className="lbl">{tr("act.bust")}</span>
              {ask.busts.map((b) => (
                <Btn key={`b${b.hideout}-${b.rival}`} kind="danger target" label={tr("act.bustAria", { name: name(b.rival), h: b.hideout + 1 })} onClick={() => answer({ kind: "action", choice: "bust", hideout: b.hideout, rival: b.rival })}>
                  {where(b.rival, b.hideout)}
                </Btn>
              ))}
            </div>
          )}
          {ask.wanted.length > 0 && (
            <div className="btns wrap">
              <span className="lbl">{tr("act.wanted")}</span>
              {ask.wanted.map((w) => {
                const inThere = s.players[w.mark].hideouts[w.hideout][seat] > 0;
                return (
                  <Btn key={`w${w.mark}-${w.hideout}`} kind="warn target" label={tr("act.wantedAria", { name: name(w.mark), h: w.hideout + 1 }) + (inThere ? tr("act.alreadyInParen") : "")} onClick={() => answer({ kind: "action", choice: "wanted", mark: w.mark, hideout: w.hideout })}>
                    {where(w.mark, w.hideout, inThere)}
                  </Btn>
                );
              })}
            </div>
          )}
          {ask.wanted.length > 0 && (
            <div className="hint">
              <Crew color={color(ask.wanted[0].leader)} size={14} /> {tr("act.leads", { name: name(ask.wanted[0].leader) })}
            </div>
          )}
        </div>
      );
      break;
    }
    case "pickMark":
      title = ask.why === "mastermind" ? tr("act.pickMarkMastermind") : tr("act.pickMarkNobody");
      body = (
        <>
          <div className="hint">{tr("act.tapRival")}</div>
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
      title = tr("act.pickHideout", { name: name(ask.mark) });
      body = (
        <>
          <div className="btns hideout-picks">
            {s.players[ask.mark].hideouts.map((h, i) => {
              // who else already lives there, so you can see a rival's Foothold even if the table hides it
              const others = h.map((k, seat) => ({ k, seat })).filter((e) => e.k > 0 && e.seat !== ask.mark);
              return (
                <Btn key={i} kind="hideout-pick" onClick={() => answer({ kind: "pickHideout", hideout: i })}>
                  <span>
                    {tr("act.hideoutGuards", { h: i + 1, count: h[ask.mark] })}
                  </span>
                  <span className="hp-others">
                    {others.length === 0
                      ? tr("act.noFootholds")
                      : others.map(({ k, seat }) => (
                          <span key={seat} className="hp-other">
                            <Crew color={s.players[seat].color} size={14} />
                            {seat === me ? tr("act.you") : s.players[seat].name}
                            {k > 1 ? ` ×${k}` : ""}
                          </span>
                        ))}
                  </span>
                </Btn>
              );
            })}
          </div>
          {s.players[ask.mark].hideouts.some((h) => h[me] > 0) && <div className="hint">{tr("act.noNewFoothold")}</div>}
        </>
      );
      break;
    case "send":
      title = tr("act.sendTitle");
      body = (
        <>
          {oddsLine}
          <div className="btns">
            <Stepper value={n} min={1} max={ask.max} onChange={setN} />
            <Btn kind="primary" onClick={() => answer({ kind: "send", count: n })}>
              {tr("act.send", { n })}
            </Btn>
          </div>
          <div className="hint">
            {alreadyIn
              ? tr("act.sendHintIn")
              : tr("act.sendHint")}
          </div>
        </>
      );
      break;
    case "join":
      title = tr("act.joinTitle");
      body = (
        <>
          {oddsLine}
          {alreadyIn && <div className="already-in">{tr("act.alreadyInJoin")}</div>}
          {ask.split ? (
            <div className="btns wrap">
              <span className="lbl">{tr("act.boss")}{alreadyIn ? tr("act.alreadyInParen") : ""}</span>
              <Stepper value={n} min={0} max={ask.max - n2} onChange={setN} />
              <span className="lbl">{tr("act.mark")}</span>
              <Stepper value={n2} min={0} max={ask.max - n} onChange={setN2} />
              <Btn kind="primary" onClick={() => answer({ kind: "join", B: n, M: n2 })}>
                {tr("act.join")}
              </Btn>
              <Btn kind="ghost" onClick={() => answer({ kind: "join", B: 0, M: 0 })}>
                {tr("act.stayOut")}
              </Btn>
            </div>
          ) : (
            <div className="btns wrap">
              <Stepper value={n} min={1} max={ask.max} onChange={setN} />
              <Btn kind="gold" onClick={() => answer({ kind: "join", B: n, M: 0 })}>
                {tr("act.backBoss")}{alreadyIn ? tr("act.alreadyInParen") : ""}
              </Btn>
              <Btn kind="danger" onClick={() => answer({ kind: "join", B: 0, M: n })}>
                {tr("act.defendMark")}
              </Btn>
              <Btn kind="ghost" onClick={() => answer({ kind: "join", B: 0, M: 0 })}>
                {tr("act.stayOut")}
              </Btn>
            </div>
          )}
          <div className="hint">
            {alreadyIn
              ? tr("act.joinHintIn")
              : tr("act.joinHint")}
          </div>
        </>
      );
      break;
    case "doubleCross":
      title = tr("act.doubleTitle");
      body = (
        <div className="btns wrap">
          {ask.targets.map((t) => (
            <Btn key={t} kind="danger" onClick={() => answer({ kind: "doubleCross", target: t })}>
              {tr("act.flip", { name: name(t) })}
            </Btn>
          ))}
          <Btn kind="ghost" onClick={() => answer({ kind: "doubleCross", target: null })}>
            {tr("act.holdIt")}
          </Btn>
        </div>
      );
      break;
    case "bet": {
      title = tr("act.betTitle");
      const pick = sel.length ? P.bank.find((c) => c.id === sel[0]) : P.bank.reduce((m, c) => (c.cash < m.cash ? c : m), P.bank[0]);
      body = (
        <>
          {oddsLine}
          <div className="pick-row">
            {P.bank.map((c) => (
              <span key={c.id} className={"clickable" + (pick && pick.id === c.id ? " picked" : "")} {...pressable(() => setSel([c.id]), tr("act.betAria", { n: c.cash }))}>
                <CardFace card={c} size="xs" />
              </span>
            ))}
          </div>
          <div className="btns">
            {(["B", "M"] as Side[]).map((sd) => (
              <Btn key={sd} kind={sd === "B" ? "gold" : "danger"} onClick={() => answer({ kind: "bet", side: sd, cardId: pick!.id })}>
                {tr(sd === "B" ? "act.betBoss" : "act.betMark", { n: pick?.cash })}
              </Btn>
            ))}
            <Btn kind="ghost" onClick={() => answer({ kind: "bet", side: null })}>
              {tr("act.noBet")}
            </Btn>
          </div>
          <div className="hint">{tr("act.betHint")}</div>
        </>
      );
      break;
    }
    case "hackerCall":
      title = tr("act.hacker");
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
      title = ask.as === "bust" || ask.as === "rival" ? tr("act.showdownBust") : tr("act.showdown");
      const c = P.hand.find((x) => x.id === sel[0]);
      body = (
        <>
          {oddsLine}
          {(ask.as === "bust" || ask.as === "rival") && <div className="hint">{tr("act.bustHint")}</div>}
          {ask.as !== "bust" && ask.as !== "rival" && <div className="hint">{tr("act.showdownHint")}</div>}
          <div className="btns">
            <Btn kind="primary big" disabled={!c} onClick={() => answer({ kind: "showdown", cardId: c!.id })}>
              {c ? tr("act.layDown", { card: cardName(c) }) : tr("act.tapFighter")}
            </Btn>
          </div>
        </>
      );
      break;
    }
    case "forger":
      title = tr("act.forger");
      body = (
        <div className="btns wrap">
          {ask.numbers.map((k) => (
            <Btn key={k} onClick={() => answer({ kind: "forger", n: k })}>
              {k}
            </Btn>
          ))}
          <Btn kind="ghost" onClick={() => answer({ kind: "forger", n: null })}>
            {tr("act.keepIt")}
          </Btn>
        </div>
      );
      break;
    case "backup":
      title = tr("act.backupTitle");
      body = (
        <>
          {j && (
            <div className="odds">
              {tr("act.backupOdds", { b: j.bTotal, m: j.mTotal })} <span className="dim">{tr("act.tieMark")}</span>
            </div>
          )}
          <div className="btns">
            <Btn kind="gold" onClick={() => answer({ kind: "backup", side: "B" })}>
              {tr("act.plusBoss")}
            </Btn>
            <Btn kind="danger" onClick={() => answer({ kind: "backup", side: "M" })}>
              {tr("act.plusMark")}
            </Btn>
            <Btn kind="ghost" onClick={() => answer({ kind: "backup", side: null })}>
              {tr("act.hold")}
            </Btn>
          </div>
        </>
      );
      break;
    case "dealOffer":
      title = tr("act.dealOfferTitle");
      body = (
        <>
          <div className="btns wrap">
            <Btn kind="primary" onClick={() => answer({ kind: "dealOffer", offer: "foothold" })}>
              {tr("act.dealFoothold")}
            </Btn>
            <Btn onClick={() => answer({ kind: "dealOffer", offer: "walk" })}>{tr("act.dealWalk")}</Btn>
            <Btn kind="ghost" onClick={() => answer({ kind: "dealOffer", offer: null })}>
              {tr("act.noDeal")}
            </Btn>
          </div>
          <div className="hint">{tr("act.noDealHint")}</div>
        </>
      );
      break;
    case "dealAccept":
      title = tr("act.dealFrom", { name: j ? name(j.boss) : tr("act.theBoss") });
      body = (
        <>
          <div className="odds">{ask.offer === "foothold" ? tr("act.dealTermsFoothold") : tr("act.dealTermsWalk")}</div>
          <div className="btns">
            <Btn kind="primary" onClick={() => answer({ kind: "dealAccept", accept: true })}>
              {tr("act.deal")}
            </Btn>
            <Btn kind="danger" onClick={() => answer({ kind: "dealAccept", accept: false })}>
              {tr("act.noDealPen")}
            </Btn>
          </div>
        </>
      );
      break;
    case "again":
      title = tr("act.againTitle");
      body = (
        <div className="btns">
          <Btn kind="primary" onClick={() => answer({ kind: "again", again: true })}>
            {tr("act.hitAgain")}
          </Btn>
          <Btn kind="ghost" onClick={() => answer({ kind: "again", again: false })}>
            {tr("act.endTurn")}
          </Btn>
        </div>
      );
      break;
    case "discard":
      title = tr("act.discardTitle", { n: ask.count });
      body = (
        <div className="btns">
          <Btn kind="primary" disabled={sel.length !== ask.count} onClick={() => answer({ kind: "discard", cardIds: sel })}>
            {tr("act.discard", { n: sel.length, total: ask.count })}

          </Btn>
        </div>
      );
      break;
  }
  return (
    <motion.div
      ref={panel}
      className={"action-panel" + (ask.kind === "keepRole" ? " wide" : ask.kind === "action" ? " compact" : "")}
      data-leaving={present ? undefined : ""}
      style={room ? { maxHeight: room, overflowY: "auto" } : undefined}
      key={ask.kind}
      role="group"
      aria-labelledby="action-title"
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="action-title" id="action-title">
        <span className="your-move-dot" aria-hidden />
        {title}
        {clock}
      </div>
      {body}
      {coach}
    </motion.div>
  );
}

