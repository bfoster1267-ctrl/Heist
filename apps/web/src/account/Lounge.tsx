// The Lounge: one chat room for everyone in the app. A button in the corner of the lobby (and the online
// lobby) opens it; every line shows in the chat bubble its sender wears from the Wardrobe, next to their
// framed avatar, level and title. Tap a line to see the player, send them a drink (coins), mute them (just
// for you) or report it. A drink shows in the Lounge for everyone.
// The server stars out swears and refuses slurs and links; see packages/server/src/lounge.ts.

import { ALL_DRINKS, DRINKS, cosmetic } from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Backend, LoungeMsg } from "./backend";
import { Avatar } from "./bits";
import { chatStyle } from "./items";
import { PlayerCard } from "./Profile";
import { useAccount, useLook } from "./useAccount";
import { VaultGlass, isVault } from "../vault";

const SEEN_KEY = "heist.lounge.seen";
const MUTED_KEY = "heist.lounge.muted";
/** how often to look for new lines: while it's open, and while it's closed (for the unread count) */
const OPEN_MS = 4_000;
const CLOSED_MS = 30_000;
const KEEP = 100;

const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: lasts this visit */
  }
};

function useFeed(backend: Backend, open: boolean) {
  const [msgs, setMsgs] = useState<LoungeMsg[]>([]);
  const [info, setInfo] = useState<{ here: number; canPost: boolean; why?: string }>({ here: 0, canPost: false });
  const last = useRef(0);
  const pull = useCallback(async () => {
    if (!backend.lounge) return;
    const f = await backend.lounge(last.current);
    last.current = Math.max(last.current, f.last);
    setInfo({ here: f.here, canPost: f.canPost, why: f.why });
    setMsgs((ms) => {
      const gone = new Set(f.gone);
      const have = new Set(ms.map((m) => m.id));
      const next = [...ms, ...f.msgs.filter((m) => !have.has(m.id))].filter((m) => !gone.has(m.id));
      return next.length === ms.length && !f.gone.some((id) => have.has(id)) ? ms : next.slice(-KEEP);
    });
  }, [backend]);
  useEffect(() => {
    let timer = 0;
    let stop = false;
    const tick = async () => {
      // a phone in a pocket doesn't need the news
      if (document.visibilityState !== "hidden") await pull().catch(() => {});
      if (!stop) timer = window.setTimeout(tick, open ? OPEN_MS : CLOSED_MS);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [pull, open]);
  return { msgs, setMsgs, info, pull };
}

/** The Lounge button for a lobby corner, and the Lounge itself when it's open. Nothing without the game server. */
export function Lounge() {
  const { backend, me } = useAccount();
  if (!backend?.lounge || !me) return null;
  return <LoungeRoom backend={backend} me={me.id} />;
}

function LoungeRoom({ backend, me }: { backend: Backend; me: string }) {
  const [open, setOpen] = useState(false);
  const { msgs, setMsgs, info, pull } = useFeed(backend, open);
  const [seen, setSeen] = useState(() => Number(load(SEEN_KEY)) || 0);
  const [muted, setMuted] = useState<string[]>(() => {
    try {
      return JSON.parse(load(MUTED_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const shown = msgs.filter((m) => !muted.includes(m.userId));
  const newest = msgs.at(-1)?.id ?? 0;
  useEffect(() => {
    if (open && newest > seen) {
      setSeen(newest);
      save(SEEN_KEY, String(newest));
    }
  }, [open, newest, seen]);
  const unread = shown.filter((m) => m.id > seen && m.userId !== me).length;
  const peek = shown.at(-1);

  const mute = (userId: string, on: boolean) => {
    const next = on ? [...new Set([...muted, userId])] : muted.filter((x) => x !== userId);
    setMuted(next);
    save(MUTED_KEY, JSON.stringify(next));
  };

  return (
    <>
      <button className={"lounge-btn" + (unread ? " fresh" : "")} onClick={() => setOpen(true)} aria-label={unread ? `Open the Lounge: ${unread} new` : "Open the Lounge, the chat for everyone"}>
        <BubbleIcon />
        <span className="lounge-btn-text">
          <span className="lounge-btn-name">Lounge</span>
          <span className="lounge-btn-peek">{peek ? `${peek.name}: ${peek.text}` : info.here > 1 ? `${info.here} here` : "Chat with everyone"}</span>
        </span>
        {unread > 0 && <span className="lounge-btn-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <LoungePanel
            key="lounge"
            backend={backend}
            me={me}
            msgs={shown}
            here={info.here}
            canPost={info.canPost}
            why={info.why}
            mutedCount={muted.length}
            onMute={(id) => mute(id, true)}
            onUnmuteAll={() => {
              setMuted([]);
              save(MUTED_KEY, "[]");
            }}
            onSaid={(m) => setMsgs((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m].slice(-KEEP)))}
            onGone={(id) => setMsgs((ms) => ms.filter((x) => x.id !== id))}
            onPull={pull}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function LoungePanel({
  backend, me, msgs, here, canPost, why, mutedCount, onMute, onUnmuteAll, onSaid, onGone, onPull, onClose,
}: {
  backend: Backend;
  me: string;
  msgs: LoungeMsg[];
  here: number;
  canPost: boolean;
  why?: string;
  mutedCount: number;
  onMute: (userId: string) => void;
  onUnmuteAll: () => void;
  onSaid: (m: LoungeMsg) => void;
  onGone: (id: number) => void;
  onPull: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pour, setPour] = useState<number | null>(null);
  const { act } = useAccount();
  const { owned } = useLook();
  // one drink at a time here: rounds are for tables
  const drinks = [...DRINKS, ...ALL_DRINKS.filter((d) => owned.includes(d.id))].filter((d) => !d.round);
  const list = useRef<HTMLDivElement>(null);
  // stick to the bottom while the reader is at the bottom; leave them be if they scrolled up to read
  const atBottom = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !card && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, card]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy || !backend.loungeSay) return;
    setBusy(true);
    setErr(null);
    try {
      const { msg } = await backend.loungeSay(t);
      setText("");
      atBottom.current = true;
      onSaid(msg);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That didn't send");
    } finally {
      setBusy(false);
    }
  };

  const sendDrink = async (m: LoungeMsg, id: string) => {
    setPour(null);
    setPicked(null);
    setErr(null);
    try {
      const r = await act((b) => b.loungeDrink!(m.id, id), { inline: true });
      if (r) {
        atBottom.current = true;
        onSaid(r.msg);
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That drink didn't go through");
    }
  };

  const report = async (m: LoungeMsg) => {
    setPicked(null);
    if (!backend.loungeReport || !window.confirm(`Report this line from ${m.name}? It's hidden for you now, and taken down for everyone if others report it too.`)) return;
    onGone(m.id);
    setNote("Thanks. We'll take a look.");
    await backend.loungeReport(m.id).catch(() => {});
    void onPull().catch(() => {});
  };

  return (
    <motion.div className="lounge-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="lounge" role="dialog" aria-label="The Lounge" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        <div className="lounge-head">
          <div>
            <div className="lounge-title">The Lounge</div>
            <div className="lounge-sub">
              <span className="lounge-live" aria-hidden /> {here > 1 ? `${here} here now` : "Chat with everyone playing Heist"}
            </div>
          </div>
          <button className="acct-x" onClick={onClose} aria-label="Close the Lounge">
            ×
          </button>
        </div>
        <div
          className="lounge-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {!msgs.length && <p className="lounge-empty">It's quiet in here. Say hi, or ask who's up for a game.</p>}
          {msgs.map((m, i) => {
            if (m.drink) {
              const glass = isVault(m.drink.emoji) ? <VaultGlass size={26} /> : <span className="lounge-drink-emoji">{m.drink.emoji}</span>;
              return (
                <div key={m.id} className={"lounge-drink" + (m.drink.toId === me ? " for-me" : "")}>
                  {glass}
                  <span>
                    <b>{m.userId === me ? "You" : m.name}</b> sent <b>{m.drink.toId === me ? "you" : m.drink.to}</b> a {m.text}
                  </span>
                </div>
              );
            }
            const mine = m.userId === me;
            // a run of lines from one player shows their name and avatar once
            const first = msgs[i - 1]?.userId !== m.userId || !!msgs[i - 1]?.drink;
            const title = m.badge?.title;
            return (
              <div key={m.id} className={"lounge-row" + (mine ? " mine" : "") + (first ? " first" : "")}>
                {!mine && (
                  <span className="lounge-who">
                    {first && (
                      <button className="lounge-avatar" onClick={() => setCard(m.userId)} aria-label={`See ${m.name}'s player card`}>
                        <Avatar name={m.name} frame={m.badge?.frame ?? "frame.none"} level={m.badge?.level} size={34} />
                      </button>
                    )}
                  </span>
                )}
                <div className="lounge-say">
                  {first && !mine && (
                    <div className="lounge-name">
                      {m.name}
                      {title && <span className="lounge-tag">{title}</span>}
                      {m.badge?.rank && <span className="lounge-tag rank">{m.badge.rank}</span>}
                    </div>
                  )}
                  <button
                    className={"lounge-bubble" + ([...m.text].length <= 2 ? " emoji" : "")}
                    style={chatStyle(cosmetic(m.badge?.chat ?? "chat.house") ?? cosmetic("chat.house"))}
                    onClick={() => {
                      setPour(null);
                      setPicked(picked === m.id ? null : m.id);
                    }}
                    aria-expanded={picked === m.id}
                    title={new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  >
                    {m.text}
                  </button>
                  {pour === m.id && (
                    <div className="lounge-pour" role="group" aria-label={`Send ${m.name} a drink`}>
                      {drinks.map((d) => (
                        <button key={d.id} className={isVault(d.emoji) ? "chat-vault" : undefined} onClick={() => void sendDrink(m, d.id)} aria-label={`Send ${m.name} a ${d.name}, ${d.price ? `${d.price} coins` : "free"}`} title={`${d.name}: ${d.price ? `${d.price} coins` : "free"}`}>
                          {isVault(d.emoji) ? <VaultGlass size={24} /> : d.emoji}
                          <span className="chat-price">{d.price || "free"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {picked === m.id && !mine && (
                    <div className="lounge-acts">
                      <button
                        className="btn small gold"
                        onClick={() => {
                          setPicked(null);
                          setPour(m.id);
                        }}
                      >
                        Send a drink
                      </button>
                      <button className="btn small ghost" onClick={() => {
                          setPicked(null);
                          setCard(m.userId);
                        }}>
                        Player card
                      </button>
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          setPicked(null);
                          onMute(m.userId);
                          setNote(`${m.name} is muted. You won't see them here.`);
                        }}
                      >
                        Mute
                      </button>
                      <button className="btn small ghost danger" onClick={() => void report(m)}>
                        Report
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {note && (
          <div className="lounge-note" onClick={() => setNote(null)}>
            {note}
          </div>
        )}
        {canPost ? (
          <form className="lounge-form" onSubmit={send}>
            <input
              className="lounge-input"
              value={text}
              maxLength={200}
              placeholder="Say something to everyone"
              aria-label="Message the Lounge"
              enterKeyHint="send"
              onChange={(e) => {
                setText(e.target.value);
                setErr(null);
              }}
            />
            <button className="btn gold" type="submit" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        ) : (
          <div className="lounge-locked">{why ?? "You can read along. Talking opens after your first game."}</div>
        )}
        <div className="lounge-fine">
          {err ? <span className="lounge-err">{err}</span> : "Be nice. Swears get starred out; links and slurs don't send."}
          {mutedCount > 0 && (
            <button className="lounge-unmute" onClick={onUnmuteAll}>
              Unmute {mutedCount}
            </button>
          )}
        </div>
      </motion.div>
      <AnimatePresence>{card && <PlayerCard key={card} id={card} onClose={() => setCard(null)} />}</AnimatePresence>
    </motion.div>
  );
}

function BubbleIcon() {
  return (
    <svg className="lounge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v10H9l-4 4v-4H4z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}
