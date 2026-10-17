// The Feedback tab in the Lounge: a board where players report bugs, suggest features, flag balance and
// leave other feedback. Everyone votes up or down and comments; the best scored rise to the top,
// and the Heist team tags each post (Looking at it, Planned, In progress, Shipped, Not now) and answers in
// gold from the admin panel. A confirmed bug or a shipped post pays its author coins, and everyone who
// upvoted it a few too.
// The server side is packages/server/src/board.ts.

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Backend, BoardComment, BoardKind, BoardRow, BoardStatus, BoardVote, BoardVoted } from "./backend";
import { Avatar } from "./bits";
import { MessageRow } from "./Lounge";
import "./board.css";
import { date, t, tEn, type TKey } from "../i18n";

const REFRESH_MS = 30_000;

const Icon = ({ children }: { children: ReactNode }) => (
  <svg className="board-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

/** a kind's icon, and its label, ask and hint in the active language (board.<kind>.*), read each time they show */
const kindText = (k: BoardKind, icon: ReactNode) => ({
  icon,
  get label() {
    return t(`board.${k}.label` as TKey);
  },
  get ask() {
    return t(`board.${k}.ask` as TKey);
  },
  get hint() {
    return t(`board.${k}.hint` as TKey);
  },
});

export const KINDS: Record<BoardKind, { readonly label: string; readonly ask: string; readonly hint: string; icon: ReactNode }> = {
  bug: kindText(
    "bug",
    (
      <Icon>
        <rect x="7" y="8" width="10" height="12" rx="5" />
        <path d="M12 8V5M9 5l1.5 2M15 5l-1.5 2M7 12H4M20 12h-3M7 17l-2.5 1.5M17 17l2.5 1.5M12 12v8" />
      </Icon>
    )),
  idea: kindText(
    "idea",
    (
      <Icon>
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
      </Icon>
    )),
  balance: kindText(
    "balance",
    (
      <Icon>
        <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z" />
      </Icon>
    )),
  other: kindText(
    "other",
    (
      <Icon>
        <path d="M4 5h16v10H9l-4 4v-4H4z" />
      </Icon>
    )),
};

const statusText = (s: BoardStatus) => (s === "new" ? "" : t(`board.status.${s}` as TKey));

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return t("ago.now");
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d` : date(at, { month: "short", day: "numeric" });
};

/** what this phone or computer is, sent with a bug so it can be reproduced */
function deviceNote(): string {
  try {
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    return `${innerWidth}x${innerHeight} @${devicePixelRatio}x${standalone ? " · home screen app" : ""} · ${navigator.userAgent}`.slice(0, 300);
  } catch {
    return "";
  }
}

const STOP = new Set(["the", "and", "for", "with", "when", "that", "this", "game", "please", "should", "would", "could", "have", "from", "your", "there", "make", "more", "about"]);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

type View = { at: "list" } | { at: "post"; id: number } | { at: "new" };

export function FeedbackBoard({ backend, me, onPlayer }: { backend: Backend; me: string; onPlayer: (userId: string) => void }) {
  const [sort, setSort] = useState<"top" | "new">("top");
  const [posts, setPosts] = useState<BoardRow[] | null>(null);
  const [can, setCan] = useState<{ canPost: boolean; why?: string; reward: number; voterReward: number }>({ canPost: false, reward: 0, voterReward: 0 });
  const [view, setView] = useState<View>({ at: "list" });
  const [err, setErr] = useState<string | null>(null);

  const pull = useCallback(async () => {
    if (!backend.board) return;
    try {
      const v = await backend.board(sort);
      setPosts(v.posts);
      setCan({ canPost: v.canPost, why: v.why, reward: v.reward, voterReward: v.voterReward });
      setErr(null);
    } catch (x) {
      setErr(x instanceof Error ? tEn(x.message) : t("board.errLoad"));
    }
  }, [backend, sort]);
  useEffect(() => {
    void pull();
    const t = window.setInterval(() => document.visibilityState !== "hidden" && void pull(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [pull]);

  const vote = async (p: BoardRow, dir: BoardVote) => {
    if (!backend.boardVote || !can.canPost) return setErr(can.why ? tEn(can.why) : t("board.firstVote"));
    // show it at once; the server's count wins when it answers
    setPosts((ps) => ps?.map((x) => (x.id === p.id ? { ...x, ...voted(x, dir) } : x)) ?? ps);
    try {
      const r = await backend.boardVote(p.id, dir);
      setPosts((ps) => ps?.map((x) => (x.id === p.id ? { ...x, ...r } : x)) ?? ps);
    } catch (x) {
      setErr(x instanceof Error ? tEn(x.message) : t("board.errVote"));
      void pull();
    }
  };

  return (
    <div className="board">
      <AnimatePresence mode="wait" initial={false}>
        {view.at === "list" && (
          <motion.div key="list" className="board-page" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
            <div className="board-bar">
              <div className="board-sort" role="tablist" aria-label={t("board.sort")}>
                {(["top", "new"] as const).map((s) => (
                  <button key={s} role="tab" aria-selected={sort === s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>
                    {s === "top" ? t("board.top") : t("board.new")}
                  </button>
                ))}
              </div>
              <button className="btn gold board-post-btn" onClick={() => (can.canPost ? setView({ at: "new" }) : setErr(can.why ? tEn(can.why) : t("board.firstPost")))}>
                <span aria-hidden>+</span> {t("board.post")}
              </button>
            </div>
            <p className="board-lede">
              {can.voterReward ? t("board.ledeReward", { n: can.voterReward }) : t("board.lede")}
            </p>
            {err && (
              <div className="board-err" onClick={() => setErr(null)}>
                {err}
              </div>
            )}
            <div className="board-list">
              {posts === null && <p className="lounge-empty">{t("board.opening")}</p>}
              {posts?.length === 0 && <p className="lounge-empty">{t("board.empty")}</p>}
              {posts?.map((p) => (
                <PostCard key={p.id} p={p} onVote={(d) => void vote(p, d)} onOpen={() => setView({ at: "post", id: p.id })} />
              ))}
            </div>
          </motion.div>
        )}
        {view.at === "post" && (
          <motion.div key={`post-${view.id}`} className="board-page" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }}>
            <PostView
              backend={backend}
              id={view.id}
              me={me}
              canPost={can.canPost}
              why={can.why}
              onPlayer={onPlayer}
              onVoted={(id, r) => setPosts((ps) => ps?.map((x) => (x.id === id ? { ...x, ...r } : x)) ?? ps)}
              onBack={() => {
                setView({ at: "list" });
                void pull();
              }}
            />
          </motion.div>
        )}
        {view.at === "new" && (
          <motion.div key="new" className="board-page" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.18 }}>
            <NewPost
              backend={backend}
              posts={posts ?? []}
              reward={can.reward}
              voterReward={can.voterReward}
              onVote={(p, d) => void vote(p, d)}
              onOpen={(id) => setView({ at: "post", id })}
              onCancel={() => setView({ at: "list" })}
              onPosted={(p) => {
                setPosts((ps) => [p, ...(ps ?? [])]);
                setView({ at: "post", id: p.id });
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** What a vote does to the counts, before the server answers. */
function voted(p: BoardRow, dir: BoardVote): BoardVoted {
  const ups = p.ups - (p.mine === 1 ? 1 : 0) + (dir === 1 ? 1 : 0);
  const downs = p.downs - (p.mine === -1 ? 1 : 0) + (dir === -1 ? 1 : 0);
  return { ups, downs, score: ups - downs, mine: dir };
}

const Arrow = ({ down }: { down?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d={down ? "M12 19l7-9H5z" : "M12 5l7 9H5z"} />
  </svg>
);

/** Up, the score, down. Tapping your own vote again takes it back. */
function VoteButton({ p, onVote, big }: { p: BoardRow; onVote: (dir: BoardVote) => void; big?: boolean }) {
  const up = p.kind === "bug" ? t("board.meToo") : t("board.voteUp");
  const press = (dir: 1 | -1) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onVote(p.mine === dir ? 0 : dir);
  };
  return (
    <div className={"board-vote" + (p.mine === 1 ? " up" : p.mine === -1 ? " down" : "") + (big ? " big" : "")} onClick={(e) => e.stopPropagation()}>
      <button className="board-vote-up" onClick={press(1)} aria-pressed={p.mine === 1} aria-label={p.mine === 1 ? t("board.unUp") : up}>
        <Arrow />
        {big && <span>{p.mine === 1 ? (p.kind === "bug" ? t("board.youToo") : t("board.voted")) : up}</span>}
      </button>
      <b aria-label={t("board.scoreAria", { score: p.score, ups: p.ups, downs: p.downs })}>{p.score}</b>
      <button className="board-vote-down" onClick={press(-1)} aria-pressed={p.mine === -1} aria-label={p.mine === -1 ? t("board.unDown") : t("board.voteDown")}>
        <Arrow down />
      </button>
    </div>
  );
}

function StatusPill({ s }: { s: BoardStatus }) {
  return statusText(s) ? <span className={`board-status s-${s}`}>{statusText(s)}</span> : null;
}

function PostCard({ p, onVote, onOpen }: { p: BoardRow; onVote: (dir: BoardVote) => void; onOpen: () => void }) {
  const k = KINDS[p.kind];
  return (
    <div className={`board-card k-${p.kind}` + (p.status === "shipped" || p.status === "wont" ? " done" : "")} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <VoteButton p={p} onVote={onVote} />
      <div className="board-card-main">
        <div className="board-card-top">
          <span className={`board-kind k-${p.kind}`}>
            {k.icon}
            {k.label}
          </span>
          <StatusPill s={p.status} />
        </div>
        <div className="board-title">{p.title}</div>
        {p.body && <div className="board-snippet">{p.body}</div>}
        <div className="board-meta">
          <span>{p.name}</span>
          <span>· {ago(p.at)}</span>
          {p.comments > 0 && <span>· {t("board.comments", { count: p.comments })}</span>}
          {p.answered && <span className="board-team-tag">{t("board.teamReplied")}</span>}
        </div>
      </div>
    </div>
  );
}

function PostView({
  backend, id, me, canPost, why, onPlayer, onVoted, onBack,
}: {
  backend: Backend;
  id: number;
  me: string;
  canPost: boolean;
  why?: string;
  onPlayer: (userId: string) => void;
  onVoted: (id: number, r: BoardVoted) => void;
  onBack: () => void;
}) {
  const [post, setPost] = useState<(BoardRow & { thread: BoardComment[] }) | null>(null);
  const [gone, setGone] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    backend
      .boardPost?.(id)
      .then((r) => live && setPost(r.post))
      .catch(() => live && setGone(true));
    return () => {
      live = false;
    };
  }, [backend, id]);

  const vote = async (dir: BoardVote) => {
    if (!post || !backend.boardVote) return;
    if (!canPost) return setErr(why ? tEn(why) : t("board.firstVote"));
    try {
      const r = await backend.boardVote(post.id, dir);
      setPost({ ...post, ...r });
      onVoted(post.id, r);
    } catch (x) {
      setErr(x instanceof Error ? tEn(x.message) : t("board.errVote"));
    }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!post || !body || busy || !backend.boardComment) return;
    setBusy(true);
    setErr(null);
    try {
      const { comment } = await backend.boardComment(post.id, body);
      setText("");
      setPost({ ...post, thread: [...post.thread, comment], comments: post.comments + 1 });
    } catch (x) {
      setErr(x instanceof Error ? tEn(x.message) : t("lg.errSend"));
    } finally {
      setBusy(false);
    }
  };
  const report = async (c?: BoardComment) => {
    if (!post || !backend.boardReport) return;
    if (!window.confirm(c ? t("board.reportComment", { name: c.name }) : t("board.reportPost"))) return;
    await backend.boardReport(post.id, c?.id).catch(() => {});
    if (c) setPost({ ...post, thread: post.thread.filter((x) => x.id !== c.id) });
    setNote(t("lg.reported"));
  };

  return (
    <>
      <div className="board-bar">
        <button className="board-back" onClick={onBack}>
          <span aria-hidden>‹</span> {t("board.all")}
        </button>
      </div>
      {gone && <p className="lounge-empty">{t("board.gone")}</p>}
      {!post && !gone && <p className="lounge-empty">{t("board.openingPost")}</p>}
      {post && (
        <div className="board-list board-thread">
          <article className={`board-full k-${post.kind}`}>
            <div className="board-card-top">
              <span className={`board-kind k-${post.kind}`}>
                {KINDS[post.kind].icon}
                {KINDS[post.kind].label}
              </span>
              <StatusPill s={post.status} />
            </div>
            <h3 className="board-title big">{post.title}</h3>
            {post.body && <p className="board-body">{post.body}</p>}
            <div className="board-by">
              <button className="board-by-who" onClick={() => onPlayer(post.userId)}>
                <Avatar name={post.name} frame={post.badge?.frame ?? "frame.none"} level={post.badge?.level} size={26} />
                <span>{post.userId === me ? t("fr.youName") : post.name}</span>
              </button>
              <span>{ago(post.at)}</span>
              {post.userId !== me && (
                <button className="board-report" onClick={() => void report()}>
                  {t("lg.report")}
                </button>
              )}
            </div>
            <VoteButton p={post} onVote={(d) => void vote(d)} big />
          </article>
          <div className="board-comments-head">{post.thread.length ? t("board.comments", { count: post.thread.length }) : t("board.noComments")}</div>
          {post.thread.map((c, i) =>
            c.team ? (
              <div key={c.id} className="board-team">
                <div className="board-team-name">
                  <span className="board-team-mark" aria-hidden>
                    H
                  </span>
                  {t("board.team")}
                </div>
                <div className="board-team-text">{c.text}</div>
              </div>
            ) : (
              <MessageRow
                key={c.id}
                line={{ key: `board-${c.id}`, userId: c.userId, name: c.name, text: c.text, at: c.at, badge: c.badge }}
                mine={c.userId === me}
                first={post.thread[i - 1]?.userId !== c.userId || !!post.thread[i - 1]?.team}
                onPlayer={onPlayer}
              />
            ),
          )}
        </div>
      )}
      {note && (
        <div className="lounge-note" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
      {err && (
        <div className="board-err" onClick={() => setErr(null)}>
          {err}
        </div>
      )}
      {post &&
        (canPost ? (
          <form className="lounge-form" onSubmit={send}>
            <input className="lounge-input" value={text} maxLength={500} placeholder={t("board.addComment")} aria-label={t("board.addComment")} enterKeyHint="send" onChange={(e) => setText(e.target.value)} />
            <button className="btn gold" type="submit" disabled={busy || !text.trim()}>
              {t("common.send")}
            </button>
          </form>
        ) : (
          <div className="lounge-locked">{why ? tEn(why) : t("board.commentLocked")}</div>
        ))}
    </>
  );
}

function NewPost({
  backend, posts, reward, voterReward, onVote, onOpen, onCancel, onPosted,
}: {
  backend: Backend;
  posts: BoardRow[];
  reward: number;
  voterReward: number;
  onVote: (p: BoardRow, dir: BoardVote) => void;
  onOpen: (id: number) => void;
  onCancel: () => void;
  onPosted: (p: BoardRow) => void;
}) {
  const [kind, setKind] = useState<BoardKind | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // posts that sound the same: vote on one of them instead of posting it again
  const like = useMemo(() => {
    const mine = words(title);
    if (mine.size === 0) return [];
    return posts
      .map((p) => ({ p, n: [...words(p.title)].filter((w) => mine.has(w)).length }))
      .filter((x) => x.n > 0 && x.p.status !== "wont")
      .sort((a, b) => b.n - a.n || b.p.score - a.p.score)
      .slice(0, 3)
      .map((x) => x.p);
  }, [title, posts]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind || busy || !backend.boardNew) return;
    setBusy(true);
    setErr(null);
    try {
      const { post } = await backend.boardNew({ kind, title: title.trim(), body: body.trim(), ...(kind === "bug" ? { device: deviceNote() } : {}) });
      onPosted(post);
    } catch (x) {
      setErr(x instanceof Error ? tEn(x.message) : t("board.errPost"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="board-bar">
        <button className="board-back" onClick={kind ? () => setKind(null) : onCancel}>
          <span aria-hidden>‹</span> {kind ? t("common.back") : t("common.cancel")}
        </button>
      </div>
      {!kind ? (
        <div className="board-list">
          <h3 className="board-ask">{t("board.about")}</h3>
          <div className="board-kinds">
            {(Object.keys(KINDS) as BoardKind[]).map((k) => (
              <button key={k} className={`board-kind-pick k-${k}`} onClick={() => setKind(k)}>
                <span className="board-kind-pick-icon">{KINDS[k].icon}</span>
                <span>
                  <b>{KINDS[k].ask}</b>
                  <small>{KINDS[k].hint}</small>
                </span>
              </button>
            ))}
          </div>
          {reward > 0 && (
            <p className="board-lede">
              {voterReward ? t("board.rewardVoters", { n: reward, v: voterReward }) : t("board.reward", { n: reward })}
            </p>
          )}
        </div>
      ) : (
        <form className="board-list board-form" onSubmit={send}>
          <h3 className="board-ask">
            <span className={`board-kind k-${kind}`}>
              {KINDS[kind].icon}
              {KINDS[kind].label}
            </span>
          </h3>
          <label className="board-field">
            <span>{kind === "bug" ? t("board.wrong") : kind === "idea" ? t("board.ideaLine") : t("board.inLine")}</span>
            <input value={title} maxLength={80} autoFocus placeholder={kind === "bug" ? t("board.egBug") : kind === "idea" ? t("board.egIdea") : kind === "balance" ? t("board.egBalance") : t("board.sayLine")} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {like.length > 0 && (
            <div className="board-like">
              <div className="board-like-head">{t("board.already")}</div>
              {like.map((p) => (
                <div key={p.id} className="board-like-row">
                  <VoteButton p={p} onVote={(d) => onVote(p, d)} />
                  <button className="board-like-title" type="button" onClick={() => onOpen(p.id)}>
                    {p.title}
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="board-field">
            <span>{kind === "bug" ? t("board.doing") : t("board.detail")}</span>
            <textarea value={body} maxLength={1000} rows={5} onChange={(e) => setBody(e.target.value)} />
          </label>
          {kind === "bug" && <p className="board-fine">{t("board.attach")}</p>}
          {err && <div className="board-err">{err}</div>}
          <button className="btn gold big board-submit" type="submit" disabled={busy || title.trim().length < 4}>
            {busy ? t("board.posting") : t("board.postIt")}

          </button>
        </form>
      )}
    </>
  );
}
