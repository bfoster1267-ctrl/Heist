// Friends: find and add players, answer requests, see who's online, message a friend, and (at a table)
// invite friends to sit down. An invite goes to the friend's phone as a notification when they've turned
// alerts on, so tapping it opens Heist from the Home Screen, full screen, straight into the table. A text
// with the table link stays as the fallback for friends without the app.

import type { Badge } from "@heist/profile";
import { useEffect, useRef, useState } from "react";
import { Avatar, Stars } from "./bits";
import { Lounge, MessageRow, type ChatLine, type FriendsSlot } from "./Lounge";
import { SYSTEM, badgeCount, friendsApi, joinTable, useFastFriends, useFriends, type Dm, type Friend, type Person, type Thread } from "./social";
import { turnOnAlerts, useAlertState } from "../alerts";
import { t } from "../i18n";
import "./friends.css";

export { joinTable };

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
          <h3>{t("friends.invites")}</h3>
          {v.invites.map((i) => (
            <div key={i.code + i.from} className="fr-row invite">
              <span className="fr-who">
                <b>{i.name}</b> {t("friends.invited_you", { name: "", code: i.code }).trim()}
                <span className="dim"> · {ago(i.at)}</span>
              </span>
              <button className="btn primary small" onClick={() => joinTable(i.code)}>
                {t("friends.join")}
              </button>
              <button className="btn ghost small" aria-label={t("friends.dismiss_invite")} onClick={() => void friendsApi.dismiss(i.code)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
      {!!v?.incoming.length && (
        <section>
          <h3>{t("friends.requests")}</h3>
          {v.incoming.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} onPlayer={onPlayer} />
              <button className="btn gold small" onClick={() => void friendsApi.accept(p.id)}>
                {t("friends.accept")}
              </button>
              <button className="btn ghost small" onClick={() => void friendsApi.remove(p.id)}>
                {t("friends.no_thanks")}
              </button>
            </div>
          ))}
        </section>
      )}
      <Groups meId={meId} onOpen={setChat} />
      <AddFriend />
      <section>
        <h3>{t("profile.tab.friends")}{v?.friends.length ? ` (${v.friends.length})` : ""}</h3>
        {!v ? (
          <div className="dim">{t("common.loading") || "Loading…"}</div>
        ) : !v.friends.length ? (
          <div className="dim fr-empty">{t("friends.empty_list")}</div>
        ) : (
          v.friends.map((f) => (
            <button key={f.id} className="fr-row fr-friend" onClick={() => setChat(f.id)}>
              <PersonTag p={f} online={f.online} />
              <span className="fr-last">
                {f.last ? (
                  <>
                    {f.last.mine ? t("friends.you") : ""}
                    {f.last.text}
                  </>
                ) : f.online ? (
                  t("career.online")
                ) : f.seen ? (
                  t("friends.seen_ago", { ago: ago(f.seen) })
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
          <h3>{t("friends.outgoing_requests")}</h3>
          {v.outgoing.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} onPlayer={onPlayer} />
              <button className="btn ghost small" onClick={() => void friendsApi.remove(p.id)}>
                {t("account.cancel")}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Group chats you're in, newest first, and a way to start one. */
function Groups({ meId, onOpen }: { meId: string; onOpen: (id: string) => void }) {
  const v = useFriends();
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v || !v.groups || !v.friends.length) return null;
  return (
    <section>
      <div className="fr-head">
        <h3>{t("friends.group_chats")}</h3>
        {!making && (
          <button className="btn gold small" onClick={() => setMaking(true)}>
            {t("friends.new_group")}
          </button>
        )}
      </div>
      {making && (
        <PickFriends
          label={t("friends.start_chat")}
          withName
          onPick={async (ids, name) => {
            try {
              const { id } = await friendsApi.createGroup(name, ids);
              setMaking(false);
              onOpen(id);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Couldn't start that chat");
            }
          }}
          onCancel={() => setMaking(false)}
        />
      )}
      {err && <div className="fr-err">{err}</div>}
      {v.groups.map((g) => (
        <button key={g.id} className="fr-row fr-friend" onClick={() => onOpen(g.id)}>
          <span className="fr-person">
            <span className="fr-faces">
              {g.members
                .filter((p) => p.id !== meId)
                .slice(0, 3)
                .map((p) => (
                  <Avatar key={p.id} name={p.name} frame={p.frame} size={26} />
                ))}
            </span>
            <span className="fr-name">{g.name || groupTitle(g.members.filter((p) => p.id !== meId).map((p) => p.name))}</span>
          </span>
          <span className="fr-last">{g.last ? `${g.last.who ? `${g.last.who}: ` : ""}${g.last.text}` : ""}</span>
          {g.unread > 0 && <span className="fr-badge">{g.unread}</span>}
        </button>
      ))}
    </section>
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
      <h3>{t("friends.add")}</h3>
      <input className="fr-search" value={q} placeholder={t("friends.search_placeholder")} maxLength={20} onChange={(e) => setQ(e.target.value)} aria-label={t("friends.search_placeholder")} />
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
  // the header's extra: unfriend (or, in a group, add friends / rename / leave)
  const [menu, setMenu] = useState<null | "menu" | "unfriend" | "add" | "rename" | "leave">(null);
  const list = useRef<HTMLDivElement>(null);
  const v = useFriends();
  const friend = v?.friends.find((f) => f.id === id);
  const [nonce, reload] = useState(0);
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
  }, [id, nonce]);
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
  const group = t?.group;
  const people = new Map((t?.people ?? []).map((p) => [p.id, p]));
  const groupRow = v?.groups?.find((g) => g.id === id);
  const name = group ? group.name || groupTitle(group.members.filter((m) => m !== meId).map((m) => people.get(m)?.name ?? "").filter(Boolean)) : (t?.friend?.name ?? friend?.name ?? groupRow?.name ?? "");
  const lastMine = t ? [...t.messages].reverse().find((m) => m.from === meId) : undefined;
  // everyone's lines look like the Lounge's: framed avatar, name, and the chat bubble they wear
  const lineOf = (m: Dm): ChatLine => {
    const p = m.from === meId ? null : group ? people.get(m.from) : t?.friend;
    return { key: `${m.from}-${m.at}`, userId: m.from, name: p?.name ?? "Someone", text: m.text, at: m.at, badge: p ? badgeOf(p) : { level: 0, prestige: 0, frame: "frame.none", title: null, chat: t?.chat } };
  };
  const act = async (f: () => Promise<unknown>) => {
    try {
      await f();
      setMenu(null);
      reload((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't do that");
    }
  };
  return (
    <div className="fr fr-chat">
      <div className="fr-chat-head">
        <button className="btn ghost small" onClick={onBack}>
          ← Friends
        </button>
        <span className="fr-chat-name" onClick={() => !group && onPlayer?.(id)}>
          {name}
          {t?.friend && <span className={"fr-dot inline" + (t.friend.online ? " on" : "")} />}
          {group && <span className="fr-chat-sub">{group.members.length} people</span>}
        </span>
        <button className="btn ghost small" aria-expanded={!!menu} onClick={() => setMenu(menu ? null : "menu")}>
          ⋯
        </button>
      </div>
      {menu === "menu" &&
        (group ? (
          <div className="fr-menu">
            <button className="btn small" onClick={() => setMenu("add")}>
              Add friends
            </button>
            <button className="btn small" onClick={() => setMenu("rename")}>
              Rename
            </button>
            <button className="btn danger small" onClick={() => setMenu("leave")}>
              Leave chat
            </button>
          </div>
        ) : (
          <div className="fr-menu">
            <button className="btn danger small" onClick={() => setMenu("unfriend")}>
              Unfriend {name}
            </button>
          </div>
        ))}
      {menu === "unfriend" && (
        <div className="fr-sure">
          Unfriend {name}? You won't be able to message each other.
          <button className="btn danger small" onClick={() => void friendsApi.remove(id).then(onBack, onBack)}>
            Unfriend
          </button>
          <button className="btn ghost small" onClick={() => setMenu(null)}>
            Cancel
          </button>
        </div>
      )}
      {menu === "leave" && group && (
        <div className="fr-sure">
          Leave {name}? You'll stop getting its messages.
          <button className="btn danger small" onClick={() => void friendsApi.leaveGroup(id).then(onBack, onBack)}>
            Leave
          </button>
          <button className="btn ghost small" onClick={() => setMenu(null)}>
            Cancel
          </button>
        </div>
      )}
      {menu === "rename" && group && <RenameGroup name={group.name} onSave={(n) => void act(() => friendsApi.renameGroup(id, n))} onCancel={() => setMenu(null)} />}
      {menu === "add" && group && (
        <PickFriends
          skip={group.members}
          label="Add"
          onPick={(ids) => void act(() => friendsApi.addToGroup(id, ids))}
          onCancel={() => setMenu(null)}
        />
      )}
      <div className="fr-msgs" ref={list}>
        {!t ? (
          <div className="dim">{err ?? "Loading…"}</div>
        ) : !t.messages.length ? (
          <div className="dim fr-empty">Say hi to {name}.</div>
        ) : (
          t.messages.map((m: Dm, i) => {
            if (m.from === SYSTEM)
              return (
                <div key={m.at + m.from} className="fr-sys">
                  {m.text}
                </div>
              );
            const mine = m.from === meId;
            // a run of lines from one person shows their avatar and name once
            return (
              <MessageRow key={m.at + m.from} line={lineOf(m)} mine={mine} first={t.messages[i - 1]?.from !== m.from} onPlayer={onPlayer}>
                {!group && m === lastMine && t.theirRead >= m.at && <span className="fr-seen">Seen</span>}
              </MessageRow>
            );
          })
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
          <input value={text} maxLength={200} placeholder={`Message ${name}`} onChange={(e) => setText(e.target.value)} aria-label="Message" enterKeyHint="send" />
          <button className="btn primary small" type="submit" disabled={!text.trim() || sending}>
            Send
          </button>
        </form>
      )}
      {t && err && <div className="fr-err">{err}</div>}
      <div className="fr-note">Heist staff can read chats to keep everyone safe.</div>
    </div>
  );
}

/** "Bo, Cy and 2 more": a group with no name goes by its people. */
function groupTitle(names: string[]) {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function RenameGroup({ name, onSave, onCancel }: { name: string; onSave: (n: string) => void; onCancel: () => void }) {
  const [n, setN] = useState(name);
  return (
    <form
      className="fr-send"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(n.trim());
      }}
    >
      <input value={n} maxLength={30} placeholder="Name the chat" autoFocus aria-label="Chat name" onChange={(e) => setN(e.target.value)} />
      <button className="btn gold small" type="submit">
        Save
      </button>
      <button className="btn ghost small" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/** Tick friends to start a group chat or add them to one. */
function PickFriends({ skip = [], label, withName, onPick, onCancel }: { skip?: string[]; label: string; withName?: boolean; onPick: (ids: string[], name: string) => void; onCancel: () => void }) {
  const v = useFriends();
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const list = (v?.friends ?? []).filter((f) => !skip.includes(f.id));
  return (
    <div className="fr-pick">
      {withName && <input className="fr-search" value={name} maxLength={30} placeholder="Name the chat (optional)" aria-label="Chat name" onChange={(e) => setName(e.target.value)} />}
      {!list.length ? (
        <div className="dim">{v?.friends.length ? "All your friends are already in this chat." : "Add some friends first."}</div>
      ) : (
        <div className="fr-pick-list">
          {list.map((f) => (
            <label key={f.id} className="fr-row fr-pick-row">
              <input type="checkbox" checked={picked.includes(f.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id)))} />
              <PersonTag p={f} online={f.online} />
            </label>
          ))}
        </div>
      )}
      <div className="fr-menu">
        <button className="btn primary small" disabled={!picked.length} onClick={() => onPick(picked, name.trim())}>
          {label}
          {picked.length ? ` (${picked.length})` : ""}
        </button>
        <button className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
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


/** A friend's invite while the app is open (their phone also buzzed, if alerts are on). */
export function InviteToast({ busy, here }: { /** in a game: hold invites until it's over */ busy?: boolean; /** the table you're at already */ here?: string | null }) {
  const v = useFriends();
  const i = busy ? undefined : v?.invites.filter((x) => x.code !== here).at(-1);
  if (!i) return null;
  return (
    <div className="fr-toast" role="alert">
      <span>
        <b>{i.name}</b> invited you to table <b>{i.code}</b>
      </span>
      <button className="btn primary small" onClick={() => joinTable(i.code)}>
        Join
      </button>
      <button className="btn ghost small" aria-label="Not now" onClick={() => void friendsApi.dismiss(i.code)}>
        ✕
      </button>
    </div>
  );
}

const badgeOf = (p: Person): Badge => ({ level: p.level, prestige: p.prestige, frame: p.frame, title: null, chat: p.chat });

/**
 * Friends inside the Lounge, the app's one chat button: its Friends tab, the count of what's waiting
 * (requests, invites, unread messages), and new messages from friends to float over the lobby.
 */
export function useFriendsSlot(meId: string | undefined, onPlayer?: (id: string) => void): FriendsSlot | undefined {
  const v = useFriends();
  if (!v || !meId) return undefined;
  const floats: ChatLine[] = [];
  for (const f of v.friends)
    if (f.unread > 0 && f.last && !f.last.mine) floats.push({ key: `dm-${f.id}-${f.last.at}`, userId: f.id, name: f.name, text: f.last.text, at: f.last.at, badge: badgeOf(f) });
  for (const g of v.groups ?? [])
    if (g.unread > 0 && g.last && g.last.who && g.last.who !== "You")
      floats.push({ key: `group-${g.id}-${g.last.at}`, userId: g.id, name: `${g.last.who} · ${g.name || "group"}`, text: g.last.text, at: g.last.at });
  return {
    unread: badgeCount(v),
    floats: floats.sort((a, b) => a.at - b.at),
    render: () => <Friends meId={meId} onPlayer={onPlayer} />,
  };
}

export function LoungeDock({ meId }: { meId?: string }) {
  const friendsSlot = useFriendsSlot(meId);
  return <Lounge friends={friendsSlot} />;
}
