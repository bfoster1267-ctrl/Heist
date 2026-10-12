// The players' feedback board (the Lounge's Feedback tab), best scored first: tag each post's status
// (players see it, the author gets a buzz, and a confirmed bug or a shipped post pays its author and every
// player who upvoted it coins), answer as
// the Heist team, merge duplicates, and take down or bring back what players reported.

import { useState } from "react";
import { post, type Session } from "./api";
import { ago, go, num, usePoll } from "./bits";
import { Problem, useAdmin, type PageProps } from "./pages";

type Kind = "bug" | "idea" | "balance" | "other";
type Status = "new" | "review" | "planned" | "doing" | "shipped" | "wont";
interface Comment {
  id: number;
  at: number;
  userId: string;
  name: string;
  text: string;
  team?: boolean;
  reports?: string[];
  hidden?: boolean;
}
interface Post {
  id: number;
  at: number;
  kind: Kind;
  title: string;
  body: string;
  userId: string;
  name: string;
  score: number;
  votes: string[];
  downs?: string[];
  comments: Comment[];
  status: Status;
  statusAt?: number;
  device?: string;
  mergedInto?: number;
  reports?: string[];
  hidden?: boolean;
  rewarded?: boolean;
}

const KIND: Record<Kind, string> = { bug: "Bug", idea: "Idea", balance: "Balance", other: "Feedback" };
const STATUSES: [Status, string][] = [
  ["new", "New"],
  ["review", "Looking at it"],
  ["planned", "Planned"],
  ["doing", "In progress"],
  ["shipped", "Shipped"],
  ["wont", "Not now"],
];
type Show = "open" | "done" | "reported" | "all";

export function BoardPage({ s, onAuth }: PageProps) {
  const r = useAdmin<{ posts: Post[]; reward: number; voterReward: number }>(s, "/board", onAuth);
  usePoll(r.reload, 60_000);
  const [show, setShow] = useState<Show>("open");
  const [kind, setKind] = useState<Kind | "all">("all");
  if (!r.data) return <Problem error={r.error} />;
  const all = r.data.posts.filter((p) => !p.mergedInto);
  const reported = (p: Post) => p.hidden || !!p.reports?.length || p.comments.some((c) => c.hidden || c.reports?.length);
  const shown = all.filter(
    (p) =>
      (kind === "all" || p.kind === kind) &&
      (show === "all" ||
        (show === "reported" ? reported(p) : show === "done" ? !p.hidden && (p.status === "shipped" || p.status === "wont") : !p.hidden && p.status !== "shipped" && p.status !== "wont")),
  );
  const count = (k: Kind) => all.filter((p) => p.kind === k && !p.hidden && p.status !== "shipped" && p.status !== "wont").length;
  return (
    <>
      <Problem error={r.error} />
      <section className="stats">
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <div key={k} className={"stat" + (kind === k ? " gold" : "")} onClick={() => setKind(kind === k ? "all" : k)} style={{ cursor: "pointer" }}>
            <div className="stat-label">{KIND[k]}s open</div>
            <div className="stat-value">{num(count(k))}</div>
          </div>
        ))}
      </section>
      <div className="chips" style={{ display: "flex", gap: 6, margin: "8px 0 14px", flexWrap: "wrap" }}>
        {(["open", "done", "reported", "all"] as Show[]).map((x) => (
          <button key={x} className={"btn small " + (show === x ? "gold" : "ghost")} onClick={() => setShow(x)}>
            {x === "open" ? "Open" : x === "done" ? "Shipped & not now" : x === "reported" ? `Reported (${all.filter(reported).length})` : "Everything"}
          </button>
        ))}
        {kind !== "all" && (
          <button className="btn small ghost" onClick={() => setKind("all")}>
            {KIND[kind]}s only ✕
          </button>
        )}
      </div>
      {!shown.length ? (
        <p className="dim">Nothing here.</p>
      ) : (
        shown.map((p) => <PostCard key={p.id} p={p} s={s} reward={r.data!.reward} onChange={r.reload} />)
      )}
      <p className="dim small">
        Best score (up minus down) first. Setting a bug to Planned, In progress or Shipped, or any other post to Shipped, pays its author {r.data.reward} coins and everyone who voted it up {r.data.voterReward} coins (once), and buzzes them.
      </p>
    </>
  );
}

function PostCard({ p, s, reward, onChange }: { p: Post; s: Session; reward: number; onChange: () => void }) {
  const [reply, setReply] = useState("");
  const [merge, setMerge] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (body: object, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await post<{ paid?: number; voters?: number }>(`/board/${p.id}`, body, s);
      setMsg(out.paid ? `Paid ${p.name} ${out.paid} coins${out.voters ? ` and ${out.voters} backer${out.voters === 1 ? "" : "s"}` : ""}.` : (done ?? null));
      onChange();
      return true;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't work");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ opacity: p.hidden ? 0.6 : 1 }}>
      <div className="card-head" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ textAlign: "center", minWidth: 48 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{num(p.score)}</div>
          <div className="dim small">
            ▲{num(p.votes.length)} ▼{num(p.downs?.length ?? 0)}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dim small">
            #{p.id} · {KIND[p.kind]} · <a onClick={() => go(`/players/${p.userId}`)}>{p.name}</a> · {ago(p.at)}
            {p.rewarded ? ` · paid ${reward}` : ""}
            {p.hidden ? " · TAKEN DOWN" : ""}
            {p.reports?.length ? ` · reported by ${p.reports.length}` : ""}
          </div>
          <h3 style={{ margin: "4px 0" }}>{p.title}</h3>
          {p.body && <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 8px" }}>{p.body}</p>}
          {p.device && <p className="dim small" style={{ wordBreak: "break-all" }}>Device: {p.device}</p>}
        </div>
        <select value={p.status} disabled={busy} onChange={(e) => void act({ status: e.target.value })}>
          {STATUSES.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {p.comments.length > 0 && (
        <div style={{ margin: "6px 0 10px" }}>
          {p.comments.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0", opacity: c.hidden ? 0.5 : 1 }}>
              <b style={{ color: c.team ? "var(--gold2, #f6d77a)" : undefined }}>{c.name}</b>
              <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{c.text}</span>
              <span className="dim small">
                {ago(c.at)}
                {c.reports?.length ? ` · reported by ${c.reports.length}` : ""}
              </span>
              <button className="btn small ghost" disabled={busy} onClick={() => void act({ commentId: c.id, hideComment: !c.hidden })}>
                {c.hidden ? "Bring back" : "Take down"}
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (reply.trim() && (await act({ reply: reply.trim() }, "Replied as the Heist team."))) setReply("");
        }}
      >
        <input style={{ flex: "1 1 260px" }} value={reply} maxLength={500} placeholder="Reply as the Heist team" onChange={(e) => setReply(e.target.value)} />
        <button className="btn small gold" disabled={busy || !reply.trim()}>
          Reply
        </button>
        <input style={{ width: 90 }} value={merge} placeholder="Merge into #" inputMode="numeric" onChange={(e) => setMerge(e.target.value.replace(/\D/g, ""))} />
        <button
          type="button"
          className="btn small ghost"
          disabled={busy || !merge}
          onClick={() => window.confirm(`Merge #${p.id} into #${merge}? Its votes move there and it leaves the board.`) && void act({ mergeInto: Number(merge) }, `Merged into #${merge}.`)}
        >
          Merge
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => void act({ hide: !p.hidden }, p.hidden ? "Back on the board." : "Taken down.")}>
          {p.hidden ? "Bring back" : "Take down"}
        </button>
      </form>
      {msg && <p className="small" style={{ marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
