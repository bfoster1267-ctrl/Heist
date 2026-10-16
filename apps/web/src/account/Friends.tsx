// Friends: find and add players, answer requests, see who's online, message a friend, and (at a table)
// invite friends to sit down. An invite goes to the friend's phone as a notification when they've turned
// alerts on, so tapping it opens Heist from the Home Screen, full screen, straight into the table. A text
// with the table link stays as the fallback for friends without the app.

import type { Badge } from "@heist/profile";
import { useEffect, useRef, useState } from "react";
import { Avatar, Stars } from "./bits";
import { MessageRow, type ChatLine, type FriendsSlot } from "./Lounge";
import { SYSTEM, badgeCount, friendsApi, useFastFriends, useFriends, type Dm, type Friend, type Person, type Thread } from "./social";
import { turnOnAlerts, useAlertState } from "../alerts";
import "./friends.css";
import { t, tEn, tNodes } from "../i18n";

/** Open a table from an invite: the app reloads into it (from the lobby, Solitaire or another table's lobby). */
export function joinTable(code: string) {
  location.assign(new URL(`./?table=${encodeURIComponent(code)}`, location.href).href);
}

function ago(at: number | null) {
  if (!at) return "";
  const m = Math.floor((Date.now() - at) / 60_000);
  if (m < 1) return t("ago.now");
  if (m < 60) return t("ago.m", { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? t("ago.h", { n: h }) : t("ago.d", { n: Math.floor(h / 24) });
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
          <h3>{t("fr.invites")}</h3>
          {v.invites.map((i) => (
            <div key={i.code + i.from} className="fr-row invite">
              <span className="fr-who">
                {tNodes("fr.invited", { name: <b>{i.name}</b>, code: <b>{i.code}</b> })}
                <span className="dim"> · {ago(i.at)}</span>
              </span>
              <button className="btn primary small" onClick={() => joinTable(i.code)}>
                {t("fr.join")}
              </button>
              <button className="btn ghost small" aria-label={t("fr.dismiss")} onClick={() => void friendsApi.dismiss(i.code)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
      {!!v?.incoming.length && (
        <section>
          <h3>{t("fr.requests")}</h3>
          {v.incoming.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} onPlayer={onPlayer} />
              <button className="btn gold small" onClick={() => void friendsApi.accept(p.id)}>
                {t("fr.accept")}
              </button>
              <button className="btn ghost small" onClick={() => void friendsApi.remove(p.id)}>
                {t("fr.noThanks")}
              </button>
            </div>
          ))}
        </section>
      )}
      <Groups meId={meId} onOpen={setChat} />
      <AddFriend />
      <section>
        <h3>{t("prof.tab.friends")}{v?.friends.length ? ` (${v.friends.length})` : ""}</h3>
        {!v ? (
          <div className="dim">{t("common.loading")}</div>
        ) : !v.friends.length ? (
          <div className="dim fr-empty">{t("fr.none")}</div>
        ) : (
          v.friends.map((f) => (
            <button key={f.id} className="fr-row fr-friend" onClick={() => setChat(f.id)}>
              <PersonTag p={f} online={f.online} />
              <span className="fr-last">
                {f.last ? (
                  <>
                    {f.last.mine ? t("fr.you") : ""}
                    {f.last.text}
                  </>
                ) : f.online ? (
                  t("fr.online")
                ) : f.seen ? (
                  t("fr.seenAgo", { ago: ago(f.seen) })
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
          <h3>{t("fr.sent")}</h3>
          {v.outgoing.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} onPlayer={onPlayer} />
              <button className="btn ghost small" onClick={() => void friendsApi.remove(p.id)}>
                {t("common.cancel")}
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
        <h3>{t("fr.groups")}</h3>
        {!making && (
          <button className="btn gold small" onClick={() => setMaking(true)}>
            {t("fr.newGroup")}
          </button>
        )}
      </div>
      {making && (
        <PickFriends
          label={t("fr.startChat")}
          withName
          onPick={async (ids, name) => {
            try {
              const { id } = await friendsApi.createGroup(name, ids);
              setMaking(false);
              onOpen(id);
            } catch (e) {
              setErr(e instanceof Error ? tEn(e.message) : t("fr.errStart"));
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
          <span className="fr-last">{g.last ? `${g.last.who ? `${g.last.who === "You" ? t("fr.youName") : g.last.who}: ` : ""}${g.last.text}` : ""}</span>
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
        {online !== undefined && <span className={"fr-dot" + (online ? " on" : "")} aria-label={online ? t("fr.online") : t("fr.offline")} />}
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
    return <div className="fr-nudge">{t("fr.nudgeInstall")}</div>;
  if (s === "off")
    return (
      <div className="fr-nudge">
        {t("fr.nudgeOff")}
        <button className="btn gold small" onClick={() => void turnOnAlerts()}>
          {t("fr.turnOn")}
        </button>
      </div>
    );
  if (s === "blocked") return <div className="fr-nudge">{t("fr.nudgeBlocked")}</div>;
  return null;
}

function AddFriend() {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setPeople(null);
    const tm = window.setTimeout(() => {
      friendsApi.search(term).then(setPeople, () => setPeople([]));
    }, 300);
    return () => clearTimeout(tm);
  }, [q]);
  return (
    <section>
      <h3>{t("fr.add")}</h3>
      <input className="fr-search" value={q} placeholder={t("fr.search")} maxLength={20} onChange={(e) => setQ(e.target.value)} aria-label={t("fr.searchAria")} />
      {people &&
        (people.length ? (
          people.map((p) => (
            <div key={p.id} className="fr-row">
              <PersonTag p={p} />
              <AddFriendButton id={p.id} small />
            </div>
          ))
        ) : (
          <div className="dim">{t("fr.nobody")}</div>
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
  if (v.friends.some((f) => f.id === id)) return <span className="fr-state">✓ {t("prof.tab.friends")}</span>;
  if (v.outgoing.some((p) => p.id === id)) return <span className="fr-state">{t("fr.requestSent")}</span>;
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
            setErr(e instanceof Error ? tEn(e.message) : t("fr.errSend"));
          }
          setBusy(false);
        }}
      >
        {theyAsked ? t("fr.acceptRequest") : t("fr.addFriend")}
      </button>
      {err && <span className="fr-err">{err}</span>}
    </>
  );
}

function Chat({ id, meId, onBack, onPlayer }: { id: string; meId: string; onBack: () => void; onPlayer?: (id: string) => void }) {
  const [th, setT] = useState<Thread | null>(null);
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
        (e) => live && setErr(e instanceof Error ? tEn(e.message) : t("fr.errLoad")),
      );
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, nonce]);
  const count = th?.messages.length ?? 0;
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
      setErr(e instanceof Error ? tEn(e.message) : t("fr.errSend"));
    }
    setSending(false);
  };
  const group = th?.group;
  const people = new Map((th?.people ?? []).map((p) => [p.id, p]));
  const groupRow = v?.groups?.find((g) => g.id === id);
  const name = group ? group.name || groupTitle(group.members.filter((m) => m !== meId).map((m) => people.get(m)?.name ?? "").filter(Boolean)) : (th?.friend?.name ?? friend?.name ?? groupRow?.name ?? "");
  const lastMine = th ? [...th.messages].reverse().find((m) => m.from === meId) : undefined;
  // everyone's lines look like the Lounge's: framed avatar, name, and the chat bubble they wear
  const lineOf = (m: Dm): ChatLine => {
    const p = m.from === meId ? null : group ? people.get(m.from) : th?.friend;
    return { key: `${m.from}-${m.at}`, userId: m.from, name: p?.name ?? t("fr.someone"), text: m.text, at: m.at, badge: p ? badgeOf(p) : { level: 0, prestige: 0, frame: "frame.none", title: null, chat: th?.chat } };
  };
  const act = async (f: () => Promise<unknown>) => {
    try {
      await f();
      setMenu(null);
      reload((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? tEn(e.message) : t("fr.errDo"));
    }
  };
  return (
    <div className="fr fr-chat">
      <div className="fr-chat-head">
        <button className="btn ghost small" onClick={onBack}>
          ← {t("prof.tab.friends")}
        </button>
        <span className="fr-chat-name" onClick={() => !group && onPlayer?.(id)}>
          {name}
          {th?.friend && <span className={"fr-dot inline" + (th.friend.online ? " on" : "")} />}
          {group && <span className="fr-chat-sub">{t("fr.people", { count: group.members.length })}</span>}
        </span>
        <button className="btn ghost small" aria-expanded={!!menu} onClick={() => setMenu(menu ? null : "menu")}>
          ⋯
        </button>
      </div>
      {menu === "menu" &&
        (group ? (
          <div className="fr-menu">
            <button className="btn small" onClick={() => setMenu("add")}>
              {t("fr.addFriends")}
            </button>
            <button className="btn small" onClick={() => setMenu("rename")}>
              {t("fr.rename")}
            </button>
            <button className="btn danger small" onClick={() => setMenu("leave")}>
              {t("fr.leaveChat")}
            </button>
          </div>
        ) : (
          <div className="fr-menu">
            <button className="btn danger small" onClick={() => setMenu("unfriend")}>
              {t("fr.unfriendName", { name })}
            </button>
          </div>
        ))}
      {menu === "unfriend" && (
        <div className="fr-sure">
          {t("fr.unfriendSure", { name })}
          <button className="btn danger small" onClick={() => void friendsApi.remove(id).then(onBack, onBack)}>
            {t("fr.unfriend")}
          </button>
          <button className="btn ghost small" onClick={() => setMenu(null)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {menu === "leave" && group && (
        <div className="fr-sure">
          {t("fr.leaveSure", { name })}
          <button className="btn danger small" onClick={() => void friendsApi.leaveGroup(id).then(onBack, onBack)}>
            {t("fr.leave")}
          </button>
          <button className="btn ghost small" onClick={() => setMenu(null)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {menu === "rename" && group && <RenameGroup name={group.name} onSave={(n) => void act(() => friendsApi.renameGroup(id, n))} onCancel={() => setMenu(null)} />}
      {menu === "add" && group && (
        <PickFriends
          skip={group.members}
          label={t("fr.addBtn")}
          onPick={(ids) => void act(() => friendsApi.addToGroup(id, ids))}
          onCancel={() => setMenu(null)}
        />
      )}
      <div className="fr-msgs" ref={list}>
        {!th ? (
          <div className="dim">{err ?? t("common.loading")}</div>
        ) : !th.messages.length ? (
          <div className="dim fr-empty">{t("fr.sayHi", { name })}</div>
        ) : (
          th.messages.map((m: Dm, i) => {
            if (m.from === SYSTEM)
              return (
                <div key={m.at + m.from} className="fr-sys">
                  {tEn(m.text)}
                </div>
              );
            const mine = m.from === meId;
            // a run of lines from one person shows their avatar and name once
            return (
              <MessageRow key={m.at + m.from} line={lineOf(m)} mine={mine} first={th.messages[i - 1]?.from !== m.from} onPlayer={onPlayer}>
                {!group && m === lastMine && th.theirRead >= m.at && <span className="fr-seen">{t("fr.seen")}</span>}
              </MessageRow>
            );
          })
        )}
      </div>
      {th && !th.friends ? (
        <div className="dim">{t("fr.notFriends")}</div>
      ) : (
        <form
          className="fr-send"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input value={text} maxLength={200} placeholder={t("fr.messageTo", { name })} onChange={(e) => setText(e.target.value)} aria-label={t("fr.message")} enterKeyHint="send" />
          <button className="btn primary small" type="submit" disabled={!text.trim() || sending}>
            {t("common.send")}
          </button>
        </form>
      )}
      {th && err && <div className="fr-err">{err}</div>}
      <div className="fr-note">{t("fr.staff")}</div>
    </div>
  );
}

/** "Bo, Cy and 2 more": a group with no name goes by its people. */
function groupTitle(names: string[]) {
  if (names.length <= 3) return names.join(", ");
  return t("fr.andMore", { names: names.slice(0, 2).join(", "), n: names.length - 2 });
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
      <input value={n} maxLength={30} placeholder={t("fr.nameChat")} autoFocus aria-label={t("fr.chatName")} onChange={(e) => setN(e.target.value)} />
      <button className="btn gold small" type="submit">
        {t("common.save")}
      </button>
      <button className="btn ghost small" type="button" onClick={onCancel}>
        {t("common.cancel")}
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
      {withName && <input className="fr-search" value={name} maxLength={30} placeholder={t("fr.nameChatOpt")} aria-label={t("fr.chatName")} onChange={(e) => setName(e.target.value)} />}
      {!list.length ? (
        <div className="dim">{v?.friends.length ? t("fr.allIn") : t("fr.addFirst")}</div>
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
          {t("common.cancel")}
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
    return <div className="fine">{t("fr.inviteHint")}</div>;
  if (!list.length) return null;
  const invite = async (f: Friend) => {
    setSent((s) => ({ ...s, [f.id]: "sending" }));
    try {
      const r = await friendsApi.invite(f.id, code);
      setSent((s) => ({ ...s, [f.id]: r.devices > 0 ? "buzzed" : "app" }));
    } catch (e) {
      setSent((s) => ({ ...s, [f.id]: e instanceof Error ? tEn(e.message) : t("fr.errInvite") }));
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
                {t("fr.invite")}
              </button>
            ) : s === "sending" ? (
              <span className="fr-state">{t("common.sending")}</span>
            ) : s === "buzzed" ? (
              <span className="fr-state">✓ {t("fr.sentPhone")}</span>
            ) : s === "app" ? (
              f.online ? (
                <span className="fr-state">✓ {t("fr.sentShort")}</span>
              ) : (
                <span className="fr-state">
                  {t("fr.noAlerts")}{" "}
                  <button className="fr-link" onClick={onText}>
                    {t("fr.textThem")}
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
        {tNodes("fr.invited", { name: <b>{i.name}</b>, code: <b>{i.code}</b> })}
      </span>
      <button className="btn primary small" onClick={() => joinTable(i.code)}>
        {t("fr.join")}
      </button>
      <button className="btn ghost small" aria-label={t("fr.notNow")} onClick={() => void friendsApi.dismiss(i.code)}>
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
      floats.push({ key: `group-${g.id}-${g.last.at}`, userId: g.id, name: `${g.last.who} · ${g.name || t("fr.group")}`,
 text: g.last.text, at: g.last.at });
  return {
    unread: badgeCount(v),
    floats: floats.sort((a, b) => a.at - b.at),
    render: () => <Friends meId={meId} onPlayer={onPlayer} />,
  };
}
