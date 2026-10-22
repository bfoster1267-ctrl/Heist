// The Lounge: one chat room for everyone in the app. A button in the corner of the lobby (and the online
// lobby) opens it; every line shows in the chat bubble its sender wears from the Wardrobe, next to their
// framed avatar, level and title. Tap a line to see the player, send them a drink (coins), mute them (just
// for you) or report it. A drink shows in the Lounge for everyone.
// The server stars out swears and refuses slurs and links; see packages/server/src/lounge.ts.
//
// The Lounge is the app's one way into chat: given a `friends` slot it gains a Friends tab (direct
// messages and groups, built in Friends.tsx), one unread count covers both, and friends' new messages
// float up over the lobby with the Lounge's. MessageRow draws a line the same way everywhere.

import { ALL_DRINKS, DRINKS, cosmetic } from "@heist/profile";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Backend, LoungeMsg } from "./backend";
import type { Badge } from "@heist/profile";
import { Avatar } from "./bits";
import { chatStyle } from "./items";
import { PlayerCard } from "./Profile";
import { useAccount, useLook } from "./useAccount";
import { VaultGlass, isVault } from "../vault";
import { Emoji } from "../emoji";
import { FeedbackBoard } from "./Board";
import { t } from "../i18n";

const SEEN_KEY = "heist.lounge.seen";
const MUTED_KEY = "heist.lounge.muted";
/** how often to look for new lines: while it's open, and while it's closed (for the unread count) */
const OPEN_MS = 4_000;
const CLOSED_MS = 8_000;
/** how long a new line floats over the lobby before it fades, and how many float at once */
const FLOAT_MS = 7_000;
const FLOATS = 2;
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

/** A line of chat from anywhere (the Lounge, a friend, a group), as MessageRow and the floats draw it. */
export interface ChatLine {
  /** unique across sources, e.g. "lounge-12" or "dm-u_abc-40" */
  key: string;
  userId: string;
  name: string;
  text: string;
  at: number;
  /** level, frame, title, rank and the chat bubble the sender wears */
  badge?: Badge;
}

/** The Friends tab inside the Lounge: what it shows, its unread count, and its new lines for the lobby floats. */
export interface FriendsSlot {
  unread: number;
  /** recent incoming friend messages, newest last; new keys float up over the lobby */
  floats?: ChatLine[];
  render: (o: { onClose: () => void }) => ReactNode;
}

type Tab = "lounge" | "friends" | "board";

/** The chat button for the lobby, and the chat itself when it's open. Nothing without the game server. */
export function Lounge({ friends, float = true }: { friends?: FriendsSlot; /** new lines float up over the screen (the main lobby only: elsewhere they'd cover buttons) */ float?: boolean } = {}) {
  const { backend, me } = useAccount();
  if (!backend?.lounge || !me) return null;
  return <LoungeRoom backend={backend} me={me.id} friends={friends} float={float} />;
}

const bubbleOf = (badge: Badge | undefined) => chatStyle(cosmetic(badge?.chat ?? "chat.house") ?? cosmetic("chat.house"));

/**
 * One line of chat: the sender's framed avatar and name (on the first of a run), then the text in the
 * chat bubble they wear. Your own lines sit on the right without the avatar. `children` go under the bubble.
 */
export function MessageRow({
  line, mine, first, onPlayer, onTap, expanded, children,
}: {
  line: ChatLine;
  mine: boolean;
  first: boolean;
  onPlayer?: (userId: string) => void;
  onTap?: () => void;
  expanded?: boolean;
  children?: ReactNode;
}) {
  const b = line.badge;
  const emoji = [...line.text].length <= 2;
  const time = new Date(line.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className={"lounge-row" + (mine ? " mine" : "") + (first ? " first" : "")}>
      {!mine && (
        <span className="lounge-who">
          {first && (
            <button className="lounge-avatar" onClick={() => onPlayer?.(line.userId)} aria-label={`See ${line.name}'s player card`}>
              <Avatar name={line.name} frame={b?.frame ?? "frame.none"} level={b?.level} size={34} />
            </button>
          )}
        </span>
      )}
      <div className="lounge-say">
        {first && !mine && (
          <div className="lounge-name">
            {line.name}
            {b?.title && <span className="lounge-tag">{b.title}</span>}
            {b?.rank && <span className="lounge-tag rank">{b.rank}</span>}
          </div>
        )}
        {onTap ? (
          <button className={"lounge-bubble" + (emoji ? " emoji" : "")} style={bubbleOf(b)} onClick={onTap} aria-expanded={expanded} title={time}>
            {emoji ? <Emoji e={line.text} /> : line.text}
          </button>
        ) : (
          <span className={"lounge-bubble" + (emoji ? " emoji" : "")} style={bubbleOf(b)} title={time}>
            {emoji ? <Emoji e={line.text} /> : line.text}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

const lineOf = (m: LoungeMsg): ChatLine & { drink?: LoungeMsg["drink"] } => ({ ...m, key: `lounge-${m.id}` });

function LoungeRoom({ backend, me, friends, float }: { backend: Backend; me: string; friends?: FriendsSlot; float: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("lounge");
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

  const mute = (userId: string, on: boolean) => {
    const next = on ? [...new Set([...muted, userId])] : muted.filter((x) => x !== userId);
    setMuted(next);
    save(MUTED_KEY, JSON.stringify(next));
    void backend.loungeMute?.(userId, on).catch(() => {});
  };

  const fromFriends = friends?.unread ?? 0;
  const floats = [...shown.map(lineOf), ...(friends?.floats ?? [])].sort((a, b) => a.at - b.at);
  return (
    <>
      {!open && (
        <LoungeDock
          lines={float ? floats : []}
          firstLook={float ? shown.slice(-2).map(lineOf) : []}
          me={me}
          here={info.here}
          unread={unread + fromFriends}
          onOpen={(key) => {
            // a friend's message (or only friends' news waiting) opens the Friends tab
            setTab(friends && (key ? !key.startsWith("lounge-") : fromFriends > 0 && !unread) ? "friends" : "lounge");
            setOpen(true);
          }}
        />
      )}
      <AnimatePresence>
        {open && (
          <LoungePanel
            key="lounge"
            tab={friends || tab !== "friends" ? tab : "lounge"}
            onTab={setTab}
            friends={friends}
            loungeUnread={unread}
            backend={backend}
            me={me}
            msgs={shown}
            here={info.here}
            canPost={info.canPost}
            why={info.why}
            mutedCount={muted.length}
            onMute={(id) => mute(id, true)}
            onUnmuteAll={() => {
              for (const id of muted) void backend.loungeMute?.(id, false).catch(() => {});
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

/**
 * The Lounge over the lobby: new lines (the Lounge's and friends') float up from the bottom in their
 * senders' bubbles and fade after a few seconds, above a small "The Lounge" pill. Tapping any of it opens it.
 */
function LoungeDock({
  lines, firstLook, me, here, unread, onOpen,
}: {
  lines: (ChatLine & { drink?: LoungeMsg["drink"] })[];
  /** what floats on the first look, so the lobby shows the room is alive */
  firstLook: (ChatLine & { drink?: LoungeMsg["drink"] })[];
  me: string;
  here: number;
  unread: number;
  onOpen: (key?: string) => void;
}) {
  const [floats, setFloats] = useState<(ChatLine & { drink?: LoungeMsg["drink"] })[]>([]);
  const floated = useRef<Set<string> | null>(null);
  useEffect(() => {
    let fresh: typeof lines;
    if (floated.current === null) {
      // nothing to show yet: wait for the first feed
      if (!lines.length) return;
      floated.current = new Set(lines.map((l) => l.key));
      fresh = firstLook;
    } else {
      fresh = lines.filter((l) => !floated.current!.has(l.key) && l.userId !== me);
      for (const l of lines) floated.current.add(l.key);
    }
    if (!fresh.length) return;
    setFloats((fs) => [...fs, ...fresh].slice(-FLOATS));
    const keys = new Set(fresh.map((l) => l.key));
    window.setTimeout(() => setFloats((fs) => fs.filter((f) => !keys.has(f.key))), FLOAT_MS);
  }, [lines, firstLook, me]);
  return (
    <div className="lounge-dock">
      <div className="lounge-floats" aria-live="polite">
        <AnimatePresence initial={false}>
          {floats.map((m) => (
            <motion.button
              key={m.key}
              layout
              className="lounge-float"
              onClick={() => onOpen(m.key)}
              initial={{ opacity: 0, y: 18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.5 } }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
            >
              {m.drink ? (
                <span className="lounge-drink">
                  {isVault(m.drink.emoji) ? <VaultGlass size={22} /> : <span className="lounge-drink-emoji"><Emoji e={m.drink.emoji} /></span>}
                  <span>
                    <b>{m.userId === me ? "You" : m.name}</b> sent <b>{m.drink.toId === me ? "you" : m.drink.to}</b> a {m.text}
                  </span>
                </span>
              ) : (
                <>
                  <Avatar name={m.name} frame={m.badge?.frame ?? "frame.none"} size={28} />
                  <span className="lounge-float-say">
                    <span className="lounge-float-name">
                      {m.userId === me ? "You" : m.name}
                      {!m.key.startsWith("lounge-") && <span className="lounge-float-dm"> · to you</span>}
                    </span>
                    <span className="lounge-bubble" style={bubbleOf(m.badge)}>
                      {m.text}
                    </span>
                  </span>
                </>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <button className={"lounge-pill" + (unread ? " fresh" : "")} onClick={() => onOpen()} aria-label={unread ? t("lounge.open_aria_unread", { unread }) : t("lounge.open_aria")}>
        <BubbleIcon />
        <span className="lounge-pill-name">{t("lounge.pill_name")}</span>
        <span className="lounge-pill-here">
          <span className="lounge-live" aria-hidden /> {here > 1 ? t("lounge.here", { count: here }) : t("lounge.chat")}
        </span>
        {unread > 0 && <span className="lounge-btn-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
    </div>
  );
}

function LoungePanel({
  tab, onTab, friends, loungeUnread, backend, me, msgs, here, canPost, why, mutedCount, onMute, onUnmuteAll, onSaid, onGone, onPull, onClose,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  friends?: FriendsSlot;
  loungeUnread: number;
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
  }, [msgs.length, tab]);
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
    if (!backend.loungeReport || !window.confirm(t("lounge.report_confirm", { name: m.name }))) return;
    onGone(m.id);
    setNote(t("lounge.report_thanks"));
    await backend.loungeReport(m.id).catch(() => {});
    void onPull().catch(() => {});
  };

  return (
    <motion.div className="lounge-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="lounge" role="dialog" aria-label={t("lounge.title")} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        <div className="lounge-head">
          {friends || backend.board ? (
            <div className="lounge-tabs" role="tablist" aria-label={t("lounge.chat")}>
              <button role="tab" aria-selected={tab === "lounge"} className={tab === "lounge" ? "on" : ""} onClick={() => onTab("lounge")}>
                {t("lounge.tab_lounge")}
                {tab !== "lounge" && loungeUnread > 0 && <span className="lounge-tab-count">{loungeUnread > 9 ? "9+" : loungeUnread}</span>}
              </button>
              {friends && (
                <button role="tab" aria-selected={tab === "friends"} className={tab === "friends" ? "on" : ""} onClick={() => onTab("friends")}>
                  {t("lounge.tab_friends")}
                  {friends.unread > 0 && <span className="lounge-tab-count">{friends.unread > 9 ? "9+" : friends.unread}</span>}
                </button>
              )}
              {backend.board && (
                <button role="tab" aria-selected={tab === "board"} className={tab === "board" ? "on" : ""} onClick={() => onTab("board")}>
                  {t("lounge.tab_feedback")}
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="lounge-title">{t("lounge.title")}</div>
              <div className="lounge-sub">
                <span className="lounge-live" aria-hidden /> {here > 1 ? t("lounge.here_now", { count: here }) : t("lounge.chat_everyone")}
              </div>
            </div>
          )}
          <button className="acct-x" onClick={onClose} aria-label={t("lounge.close_aria")}>
            ×
          </button>
        </div>
        {tab === "friends" && friends ? (
          <div className="lounge-friends">{friends.render({ onClose })}</div>
        ) : tab === "board" && backend.board ? (
          <FeedbackBoard backend={backend} me={me} onPlayer={setCard} />
        ) : (
        <>
        {(friends || backend.board) && (
          <div className="lounge-sub lounge-sub-tabbed">
            <span className="lounge-live" aria-hidden /> {here > 1 ? t("lounge.here_now", { count: here }) : t("lounge.chat_everyone")}
          </div>
        )}
        <div
          className="lounge-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {!msgs.length && <p className="lounge-empty">{t("lounge.empty")}</p>}
          {msgs.map((m, i) => {
            if (m.drink) {
              const glass = isVault(m.drink.emoji) ? <VaultGlass size={26} /> : <span className="lounge-drink-emoji"><Emoji e={m.drink.emoji} /></span>;
              return (
                <div key={m.id} className={"lounge-drink" + (m.drink.toId === me ? " for-me" : "")}>
                  {glass}
                  <span>
                    <b>{m.userId === me ? t("lounge.you") : m.name}</b> sent <b>{m.drink.toId === me ? t("lounge.you_lower") : m.drink.to}</b> a {m.text}
                  </span>
                </div>
              );
            }
            const mine = m.userId === me;
            // a run of lines from one player shows their name and avatar once
            const first = msgs[i - 1]?.userId !== m.userId || !!msgs[i - 1]?.drink;
            return (
              <MessageRow
                key={m.id}
                line={lineOf(m)}
                mine={mine}
                first={first}
                onPlayer={setCard}
                expanded={picked === m.id}
                onTap={() => {
                  setPour(null);
                  setPicked(picked === m.id ? null : m.id);
                }}
              >
                {pour === m.id && (
                  <div className="lounge-pour" role="group" aria-label={`Send ${m.name} a drink`}>
                    {drinks.map((d) => (
                      <button key={d.id} className={isVault(d.emoji) ? "chat-vault" : undefined} onClick={() => void sendDrink(m, d.id)} aria-label={`Send ${m.name} a ${d.name}, ${d.price ? `${d.price} coins` : "free"}`} title={`${d.name}: ${d.price ? `${d.price} coins` : "free"}`}>
                        {isVault(d.emoji) ? <VaultGlass size={24} /> : <Emoji e={d.emoji} />}
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
                      {t("lounge.send_drink")}
                    </button>
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        setPicked(null);
                        setCard(m.userId);
                      }}
                    >
                      {t("lounge.player_card")}
                    </button>
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        setPicked(null);
                        onMute(m.userId);
                        setNote(t("lounge.muted_note", { name: m.name }));
                      }}
                    >
                      {t("lounge.mute")}
                    </button>
                    <button className="btn small ghost danger" onClick={() => void report(m)}>
                      {t("lounge.report")}
                    </button>
                  </div>
                )}
              </MessageRow>
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
              placeholder={t("lounge.placeholder")}
              aria-label={t("lounge.input_aria")}
              enterKeyHint="send"
              onChange={(e) => {
                setText(e.target.value);
                setErr(null);
              }}
            />
            <button className="btn gold" type="submit" disabled={busy || !text.trim()}>
              {t("lounge.send")}
            </button>
          </form>
        ) : (
          <div className="lounge-locked">{why ?? t("lounge.locked")}</div>
        )}
        <div className="lounge-fine">
          {err ? <span className="lounge-err">{err}</span> : t("lounge.fine")}
          {mutedCount > 0 && (
            <button className="lounge-unmute" onClick={onUnmuteAll}>
              {t("lounge.unmute", { count: mutedCount })}
            </button>
          )}
        </div>
        </>
        )}
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
