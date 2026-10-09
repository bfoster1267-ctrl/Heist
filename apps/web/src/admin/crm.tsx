import { useState } from "react";
import { AuthError, post, type AccountDetail, type Crm, type Session } from "./api";
import { Link, ago, day, when } from "./bits";

const PRESET_TAGS = ["VIP", "Whale", "Tester", "Streamer", "Friend", "Watch", "Cheater", "Toxic"];
const BAN_LENGTHS: [string, number | null][] = [
  ["1 day", 1],
  ["7 days", 7],
  ["30 days", 30],
  ["For good", null],
];

/** The owner's file on a player: status, tags, notes, and the addresses they play from. */
export function CrmPanel({ s, onAuth, d }: { s: Session; onAuth: (e: unknown) => void; d: AccountDetail }) {
  const [crm, setCrm] = useState<Crm>(d.account.crm);
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banning, setBanning] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState<number | null>(7);
  const id = d.account.id;

  const run = async (what: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ crm: Crm }>(`/accounts/${id}/${what}`, body, s);
      setCrm(r.crm);
      return true;
    } catch (e) {
      if (e instanceof AuthError) onAuth(e);
      else setError(String((e as Error).message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const banActive = crm.ban && (crm.ban.until === null || crm.ban.until > Date.now()) ? crm.ban : null;
  const suggestions = [...new Set([...PRESET_TAGS, ...d.tagsInUse.map((t) => t.tag)])].filter((t) => !crm.tags.includes(t));
  const setTags = (tags: string[]) => run("tags", { tags });

  return (
    <div className={`card crm ${banActive ? "is-banned" : crm.flag ? "is-flagged" : ""}`}>
      <div className="card-head">
        <h3>Your file on {d.account.name}</h3>
        <span className="dim small">only you can see this</span>
      </div>
      {error && <div className="problem">{error}</div>}

      <div className="crm-status">
        {banActive ? (
          <div className="status-box banned">
            <b>Suspended</b> {banActive.until ? `until ${when(banActive.until)}` : "for good"}
            {banActive.reason && <span> · {banActive.reason}</span>}
            <span className="dim small"> · since {day(banActive.at)}</span>
            <button className="btn small" disabled={busy} onClick={() => run("ban", { days: 0 })}>
              Lift suspension
            </button>
          </div>
        ) : banning ? (
          <form
            className="status-box banning"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run("ban", { reason: banReason, days: banDays })) setBanning(false);
            }}
          >
            <b>Suspend {d.account.name}</b>
            <span className="dim small">They're signed out of every table right away and can't sign in until it ends.</span>
            <input placeholder="Reason (they'll see it)" value={banReason} onChange={(e) => setBanReason(e.target.value)} maxLength={300} />
            <div className="seg-row">
              {BAN_LENGTHS.map(([label, days]) => (
                <button type="button" key={label} className={`fam-chip ${banDays === days ? "on" : ""}`} onClick={() => setBanDays(days)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="seg-row">
              <button className="btn danger" disabled={busy}>
                Suspend
              </button>
              <button type="button" className="btn ghost" onClick={() => setBanning(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {crm.flag && (
          <div className="status-box flagged">
            <b>Flagged</b> {crm.flag.reason && <span>· {crm.flag.reason}</span>}
            <span className="dim small"> · {ago(crm.flag.at)}</span>
            <button className="btn small" disabled={busy} onClick={() => run("flag", { reason: null })}>
              Clear flag
            </button>
          </div>
        )}
        <div className="seg-row">
          {!crm.flag && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                const reason = prompt("Why flag this player? (optional)");
                if (reason !== null) void run("flag", { reason });
              }}
            >
              ⚑ Flag
            </button>
          )}
          {!banActive && !banning && (
            <button className="btn danger" disabled={busy} onClick={() => setBanning(true)}>
              Suspend…
            </button>
          )}
        </div>
      </div>

      <h4>Tags</h4>
      <div className="chips-row">
        {crm.tags.map((t) => (
          <span key={t} className="tag crm-tag">
            <Link to={`/players?tag=${encodeURIComponent(t)}&show=all`}>{t}</Link>
            <button aria-label={`Remove ${t}`} disabled={busy} onClick={() => setTags(crm.tags.filter((x) => x !== t))}>
              ✕
            </button>
          </span>
        ))}
        {!crm.tags.length && <span className="dim small">No tags yet.</span>}
      </div>
      <div className="chips-row suggest">
        {suggestions.slice(0, 12).map((t) => (
          <button key={t} className="fam-chip" disabled={busy} onClick={() => setTags([...crm.tags, t])}>
            + {t}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tag.trim()) void setTags([...crm.tags, tag.trim()]).then(() => setTag(""));
          }}
        >
          <input className="tag-input" placeholder="New tag" value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} />
        </form>
      </div>

      <h4>Notes</h4>
      <form
        className="note-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("note", { text: note })) setNote("");
        }}
      >
        <textarea placeholder="Write a note about this player…" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} rows={2} />
        <button className="btn primary" disabled={busy || !note.trim()}>
          Add note
        </button>
      </form>
      <ul className="notes">
        {crm.notes.map((n) => (
          <li key={n.id}>
            <div className="note-meta">
              {when(n.at)}
              <button className="btn ghost small" disabled={busy} onClick={() => confirm("Delete this note?") && run("unnote", { id: n.id })}>
                Delete
              </button>
            </div>
            <div className="note-text">{n.text}</div>
          </li>
        ))}
      </ul>

      <h4>Played from</h4>
      <div className="chips-row">
        {d.ips.slice(0, 8).map((x) => (
          <Link key={x.ip} to={`/activity?text=${encodeURIComponent(x.ip)}`} className="tag mono">
            {x.ip} · {ago(x.at)}
          </Link>
        ))}
        {!d.ips.length && <span className="dim small">No addresses recorded yet.</span>}
      </div>
      {d.sameIp.length > 0 && (
        <div className="same-ip">
          <span className="dim small">Other accounts seen on the same address: </span>
          {d.sameIp.map((x, i) => (
            <span key={x.id}>
              {i > 0 && ", "}
              <Link to={`/players/${x.id}`}>{x.name}</Link>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
