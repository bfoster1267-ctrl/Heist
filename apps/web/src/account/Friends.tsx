// Friends: find and add players, answer requests, see who's online, message a friend, and (at a table)
// invite friends to sit down. An invite goes to the friend's phone as a notification when they've turned
// alerts on, so tapping it opens Heist from the Home Screen, full screen, straight into the table. A text
// with the table link stays as the fallback for friends without the app.

import { useEffect, useRef, useState } from "react";
import { Avatar, Stars } from "./bits";
import { badgeCount, friendsApi, useFastFriends, useFriends, type Dm, type Friend, type Person, type Thread } from "./friends";
import { turnOnAlerts, useAlertState } from "../alerts";
import "./friends.css";

/** Open a table from an invite: the app reloads into it (from the lobby, Solitaire or another table's lobby). */
export function joinTable(code: string) {
  location.assign(`/?table=${encodeURIComponent(code)}`);
}

function ago(t: number | null) {
  if (!t) return "";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** The Friends page in the profile sheet. `chat` opens straight into a conversation (from a notification). */
export function Friends({ meId, chat: start = null, onPlayer }: { meId: string; chat?: string | null; onPlayer?: (id: string) => void }) {
  useFastFriends();
  const v = useFriends();
  const [chat, setChat] = useState<string | null>(start);
  if (chat) return <Chat id={chat} meId={meId} onBack={() => setChat(null)} onPlayer={onPlayer} />;
  return (
    <div className="fr">
      <AlertsNudge />
      {!!v?.invites.length && (
        <section>
          <h3>Invites</h3>
          {v.invites.map((i) => (
            <div key={i.code + i.from} className="fr-row invite">
              <span className="fr-who">
                <b>{i.name}</b> invited you to table <b>{i.code}</b>
                <span className="dim"> · {ago(i.at)}</span>
              </span>
              <button className="btn primary small" onClick={() => joinTable(i.code)}>
                Join
              </button>
              <button className="btn ghost small" aria-label="Dismiss invite" onClick={() => void friendsApi.dismiss(i.code)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
      {!!v?.incoming.length && (
        <section>
          <h3>Friend requests</h3>
          {v.incoming.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} onPlayer={onPlayer} />
              <button className="btn gold small" onClick={() => void friendsApi.accept(p.id)}>
                Accept
              </button>
              <button className="btn ghost small" onClick={() => void friendsApi.remove(p.id)}>
                No thanks
              </button>
            </div>
          ))}
        </section>
      )}
      <AddFriend />
      <section>
        <h3>Friends{v?.friends.length ? ` (${v.friends.length})` : ""}</h3>
        {!v ? (
          <div className="dim">Loading…</div>
        ) : !v.friends.length ? (
          <div className="dim fr-empty">No friends yet. Find someone by name above, or tap a player's name at a table and add them.</div>
        ) : (
          v.friends.map((f) => (
            <button key={f.id} className="fr-row fr-friend" onClick={() => setChat(f.id)}>
              <PersonTag p={f} online={f.online} />
              <span className="fr-last">
                {f.last ? (
                  <>
                    {f.last.mine ? "You: " : ""}
                    {f.last.text}
                  </>
                ) : f.online ? (
                  "Online"
                ) : f.seen ? (
                  `Seen ${ago(f.seen)}`
                ) : (
                  ""
                )}
              </span>
              {f.unread > 0 && <span className="fr-badge">{f.unread}</span>}
            </button>
          ))
        )}
      </section>
      {!!v?.outgoing.length && (
        <section>
          <h3>Requests you sent</h3>
          {v.outgoing.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} onPlayer={onPlayer} />
              <button className="btn ghost small" onClick={() => void friendsApi.remove(p.id)}>
                Cancel
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function PersonTag({ p, online, onPlayer }: { p: Person; online?: boolean; onPlayer?: (id: string) => void }) {
  return (
    <span className="fr-person" onClick={onPlayer ? (e) => (e.stopPropagation(), onPlayer(p.id)) : undefined}>
      <span className="fr-avatar">
        <Avatar name={p.name} frame={p.frame} level={p.level} size={38} />
        {online !== undefined && <span className={"fr-dot" + (online ? " on" : "")} aria-label={online ? "Online" : "Offline"} />}
      </span>
      <span className="fr-name">
        {p.name} <Stars prestige={p.prestige} size={10} />
      </span>
    </span>
  );
}

/** Invites only buzz a phone that has alerts on: say so where it helps. */
function AlertsNudge() {
  const s = useAlertState();
  if (s === "needs-install")
    return <div className="fr-nudge">Add Heist to your Home Screen (Share, then Add to Home Screen) so friends' invites arrive as notifications and open the app full screen.</div>;
  if (s === "off")
    return (
      <div className="fr-nudge">
        Turn on notifications so friends can invite you to a table, even when Heist is closed.
        <button className="btn gold small" onClick={() => void turnOnAlerts()}>
          Turn on
        </button>
      </div>
    );
  if (s === "blocked") return <div className="fr-nudge">Notifications are blocked for Heist. Turn them on in your phone's settings to get friends' invites.</div>;
  return null;
}

function AddFriend() {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setPeople(null);
    const t = window.setTimeout(() => {
      friendsApi.search(term).then(setPeople, () => setPeople([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <section>
      <h3>Add a friend</h3>
      <input className="fr-search" value={q} placeholder="Search by player name" maxLength={20} onChange={(e) => setQ(e.target.value)} aria-label="Search players by name" />
      {people &&
        (people.length ? (
          people.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} />
              <AddFriendButton id={p.id} small />
            </div>
          ))
        ) : (
          <div className="dim">Nobody by that name.</div>
        ))}
    </section>
  );
}

/** Add friend / Requested / Friends, for any player (search results, player cards). */
export function AddFriendButton({ id, small }: { id: string; small?: boolean }) {
  const v = useFriends();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v) return null;
  const cls = "btn" + (small ? " small" : "");
  if (v.friends.some((f) => f.id === id)) return <span className="fr-state">✓ Friends</span>;
  if (v.outgoing.some((p) => p.id === id)) return <span className="fr-state">Request sent</span>;
  const theyAsked = v.incoming.some((p) => p.id === id);
  return (
    <>
      <button
        className={cls + " gold"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await (theyAsked ? friendsApi.accept(id) : friendsApi.request(id));
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Couldn't send that");
          }
          setBusy(false);
        }}
      >
        {theyAsked ? "Accept request" : "Add friend"}
      </button>
      {err && <span className="fr-err">{err}</span>}
    </>
  );
}

function Chat({ id, meId, onBack, onPlayer }: { id: string; meId: string; onBack: () => void; onPlayer?: (id: string) => void }) {
  const [t, setT] = useState<Thread | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sure, setSure] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const friend = useFriends()?.friends.find((f) => f.id === id);
  useEffect(() => {
    let live = true;
    const load = () =>
      friendsApi.thread(id).then(
        (x) => live && (setT(x), setErr(null)),
        (e) => live && setErr(e instanceof Error ? e.message : "Couldn't load the chat"),
      );
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);
  const count = t?.messages.length ?? 0;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { message } = await friendsApi.send(id, body);
      setText("");
      setT((x) => (x ? { ...x, messages: [...x.messages, message] } : x));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send that");
    }
    setSending(false);
  };
  const name = t?.friend.name ?? friend?.name ?? "";
  const lastMine = t ? [...t.messages].reverse().find((m) => m.from === meId) : undefined;
  return (
    <div className="fr fr-chat">
      <div className="fr-chat-head">
        <button className="btn ghost small" onClick={onBack}>
          ← Friends
        </button>
        <span className="fr-chat-name" onClick={() => onPlayer?.(id)}>
          {name}
          {t && <span className={"fr-dot inline" + (t.friend.online ? " on" : "")} />}
        </span>
        {sure ? (
          <span className="fr-sure">
            Unfriend?
            <button
              className="btn danger small"
              onClick={async () => {
                await friendsApi.remove(id).catch(() => {});
                onBack();
              }}
            >
              Yes
            </button>
            <button className="btn ghost small" onClick={() => setSure(false)}>
              No
            </button>
          </span>
        ) : (
          <button className="btn ghost small" onClick={() => setSure(true)}>
            Unfriend
          </button>
        )}
      </div>
      <div className="fr-msgs" ref={list}>
        {!t ? (
          <div className="dim">{err ?? "Loading…"}</div>
        ) : !t.messages.length ? (
          <div className="dim fr-empty">Say hi to {name}. Messages here are just between the two of you.</div>
        ) : (
          t.messages.map((m: Dm) => (
            <div key={m.at + m.from} className={"fr-msg" + (m.from === meId ? " mine" : "")}>
              <span>{m.text}</span>
              {m === lastMine && t.theirRead >= m.at && <span className="fr-seen">Seen</span>}
            </div>
          ))
        )}
      </div>
      {t && !t.friends ? (
        <div className="dim">You're not friends any more, so you can't send messages.</div>
      ) : (
        <form
          className="fr-send"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input value={text} maxLength={300} placeholder={`Message ${name}`} onChange={(e) => setText(e.target.value)} aria-label="Message" enterKeyHint="send" />
          <button className="btn primary small" type="submit" disabled={!text.trim() || sending}>
            Send
          </button>
        </form>
      )}
      {t && err && <div className="fr-err">{err}</div>}
    </div>
  );
}

/** At a table that hasn't dealt: invite friends with one tap each. */
export function InviteFriends({ code, seated, onText }: { code: string; /** user ids already at the table */ seated: (string | null)[]; onText: () => void }) {
  useFastFriends();
  const v = useFriends();
  const [sent, setSent] = useState<Record<string, "sending" | "buzzed" | "app" | string>>({});
  if (!v) return null;
  const list: Friend[] = v.friends.filter((f) => !seated.includes(f.id));
  if (!v.friends.length)
    return <div className="fine">Add friends from their player card or your profile, and you can invite them here with one tap.</div>;
  if (!list.length) return null;
  const invite = async (f: Friend) => {
    setSent((s) => ({ ...s, [f.id]: "sending" }));
    try {
      const r = await friendsApi.invite(f.id, code);
      setSent((s) => ({ ...s, [f.id]: r.devices > 0 ? "buzzed" : "app" }));
    } catch (e) {
      setSent((s) => ({ ...s, [f.id]: e instanceof Error ? e.message : "Couldn't invite" }));
    }
  };
  return (
    <div className="fr-invite-list">
      {list.slice(0, 12).map((f) => {
        const s = sent[f.id];
        return (
          <div key={f.id} className="fr-row">
            <span className="fr-person">
              <span className="fr-avatar">
                <Avatar name={f.name} frame={f.frame} level={f.level} size={30} />
                <span className={"fr-dot" + (f.online ? " on" : "")} />
              </span>
              <span className="fr-name">{f.name}</span>
            </span>
            {!s ? (
              <button className="btn gold small" onClick={() => void invite(f)}>
                Invite
              </button>
            ) : s === "sending" ? (
              <span className="fr-state">Sending…</span>
            ) : s === "buzzed" ? (
              <span className="fr-state">✓ Sent to their phone</span>
            ) : s === "app" ? (
              f.online ? (
                <span className="fr-state">✓ Sent</span>
              ) : (
                <span className="fr-state">
                  No notifications on.{" "}
                  <button className="fr-link" onClick={onText}>
                    Text them
                  </button>
                </span>
              )
            ) : (
              <span className="fr-err">{s}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The lobby's way into friends: a button with a count of what's waiting. */
export function FriendsButton({ onOpen }: { onOpen: () => void }) {
  const n = badgeCount(useFriends());
  return (
    <button className="fr-open" onClick={onOpen} aria-label={n ? `Friends: ${n} waiting` : "Friends"}>
      <span aria-hidden>👥</span> Friends
      {n > 0 && <span className="fr-badge">{n}</span>}
    </button>
  );
}
