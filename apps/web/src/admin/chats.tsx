// A player's private chats (with friends, and group chats), for the owner to check when needed. Opening
// them is a deliberate tap, and each look is written to the activity log as admin.chats.
import { useState } from "react";
import { AuthError, get, type Session } from "./api";
import { when } from "./bits";

interface ChatRecord {
  id: string;
  kind: "dm" | "group";
  name: string;
  members: { id: string; name: string }[];
  messages: { from: string; name: string; text: string; at: number }[];
}

export function ChatsPanel({ s, onAuth, id }: { s: Session; onAuth: (e: unknown) => void; id: string }) {
  const [chats, setChats] = useState<ChatRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setError(null);
    try {
      const r = await get<{ chats: ChatRecord[] }>(`/accounts/${id}/chats`, s);
      setChats(r.chats);
      setOpen(r.chats[0]?.id ?? null);
    } catch (e) {
      if (e instanceof AuthError) onAuth(e);
      else setError(String((e as Error).message ?? e));
    }
  };
  return (
    <section className="card">
      <h4>Chats</h4>
      {!chats ? (
        <button className="btn" onClick={() => void load()}>
          Show this player's chats
        </button>
      ) : !chats.length ? (
        <div className="dim small">No private or group chats.</div>
      ) : (
        chats.map((c) => (
          <div key={c.id} className="admin-chat">
            <button className="btn small" onClick={() => setOpen(open === c.id ? null : c.id)}>
              {c.kind === "group" ? "Group" : "With"}: {c.name || c.members.map((m) => m.name).join(", ")} · {c.messages.length} messages
            </button>
            {open === c.id && (
              <div className="admin-chat-lines">
                {c.kind === "group" && <div className="dim small">Members now: {c.members.map((m) => m.name).join(", ") || "nobody"}</div>}
                {c.messages.map((m) => (
                  <div key={m.at + m.from} className={m.from === id ? "me" : m.from === "system" ? "sys" : ""}>
                    <span className="dim small">{when(m.at)}</span> {m.from !== "system" && <b>{m.name}: </b>}
                    {m.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      {error && <div className="problem">{error}</div>}
    </section>
  );
}
