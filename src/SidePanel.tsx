import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { renderMarkdown } from "./markdown";
import { goJoin, useView } from "./view";
import { ExportButton } from "./Export";

// Same set the server allows (convex/chat.ts REACTIONS).
const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🏔️"];

// Right-hand panel in a workspace: team chat (default) and workspace settings.
export function SidePanel({ workspaceId, onClose, tab, setTab, unread }: {
  workspaceId: Id<"workspaces">;
  onClose: () => void;
  tab: "chat" | "settings";
  setTab: (t: "chat" | "settings") => void;
  unread: number;
}) {
  return (
    <aside className="side" aria-label="Workspace panel">
      <div className="side__tabs" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          Chat{unread > 0 && tab !== "chat" ? <span className="side__badge">{unread}</span> : null}
        </button>
        <button role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
          Workspace
        </button>
        <button className="ghost side__close" onClick={onClose} aria-label="Close panel" title="Close">×</button>
      </div>
      {tab === "chat" ? <Chat workspaceId={workspaceId} /> : <WorkspaceSettings workspaceId={workspaceId} />}
    </aside>
  );
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Wrap @Name (first names of members) and @ai in a highlight span, in already-sanitized HTML text.
const highlightMentions = (html: string, names: string[]) => {
  const firsts = ["ai", ...names.map((n) => n.split(" ")[0])].filter(Boolean).map(escapeRe);
  if (!firsts.length) return html;
  const re = new RegExp(`(^|[\\s>(])@(${firsts.join("|")})\\b`, "gi");
  return html.replace(re, (_m, pre, n) => `${pre}<span class="mention">@${n}</span>`);
};

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Chat({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { code, readOnly } = useView();
  const msgs = useQuery(api.chat.list, { workspaceId, code });
  const send = useMutation(api.chat.send);
  const vote = useMutation(api.chat.vote);
  const react = useMutation(api.chat.react);
  const me = useQuery(api.profile.me);
  // Typing indicator: ping at most every 3s while typing; others hide pings older than 6s.
  const setTyping = useMutation(api.presence.setTyping);
  const typers = useQuery(api.presence.typing, { workspaceId, code });
  const lastPing = useRef(0);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 2000); return () => clearInterval(t); }, []);
  // Track when each ping arrived on THIS device's clock, so server/client clock skew doesn't matter.
  const seenAt = useRef(new Map<string, { at: number; local: number }>());
  for (const t of typers ?? []) {
    const prev = seenAt.current.get(t.userId);
    if (!prev || prev.at !== t.at) seenAt.current.set(t.userId, { at: t.at, local: Date.now() });
  }
  const typingNames = (typers ?? []).filter((t) => t.userId !== me?.userId && tick - (seenAt.current.get(t.userId)?.local ?? 0) < 6000).map((t) => t.name);
  const onType = (v: string) => {
    if (readOnly) return;
    if (!v.trim()) { if (lastPing.current) { lastPing.current = 0; setTyping({ workspaceId, typing: false }).catch(() => {}); } return; }
    if (Date.now() - lastPing.current > 3000) { lastPing.current = Date.now(); setTyping({ workspaceId, typing: true }).catch(() => {}); }
  };
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Reply: quote the first line of a message, mention its author, focus the box.
  const reply = (author: string, msg: string) => {
    const line = msg.replace(/^\/poll\s*/, "").split("\n").find((l) => l.trim() && !l.startsWith(">"))?.trim() ?? "";
    const quote = line.length > 120 ? `${line.slice(0, 117)}…` : line;
    setText(`> **${author}:** ${quote}\n\n@${author.split(" ")[0]} `);
    setTimeout(() => { const t = box.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 0);
  };
  const members = useQuery(api.workspaces.members, { workspaceId, code });
  const names = (members ?? []).map((x) => x.name);
  const myName = me?.profile?.name ?? "";
  const mentionsMe = (t: string) => !!myName && new RegExp(`@${escapeRe(myName.split(" ")[0])}\\b`, "i").test(t);
  // "@ma" at the end of the input suggests matching people (and the AI).
  const partial = text.match(/@([\w-]*)$/)?.[1];
  const suggest = partial === undefined ? [] : ["ai", ...names.map((n) => n.split(" ")[0])]
    .filter((n, i, a) => a.indexOf(n) === i && n.toLowerCase().startsWith(partial.toLowerCase()) && n.toLowerCase() !== partial.toLowerCase())
    .slice(0, 5);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);
  return (
    <div className="chat">
      <div className="chat__log" aria-live="polite">
        {msgs?.length === 0 && (
          <div className="chat__empty">
            <p><b>Talk it through here.</b></p>
            <p className="dim">Plans, "who's driving?". Start with <code>@ai</code> to hand a question to the AI with the chat as context.</p>
            <p className="dim">Can't decide? <code>/poll Where? | Tahoe | Yosemite</code></p>
          </div>
        )}
        {msgs?.map((m, i) => {
          const same = i > 0 && msgs[i - 1].userId === m.userId && m.at - msgs[i - 1].at < 5 * 60_000;
          const mine = m.userId === me?.userId;
          const ai = /^@(ai|agent|tandem)\b/i.test(m.text);
          return (
            <div key={m._id} className={`msg ${mine ? "mine" : ""} ${same ? "cont" : ""}`}>
              {!same && (
                <div className="msg__head">
                  <span className="msg__dot" style={{ background: m.color }} />
                  <b>{m.author}</b>
                  <span className="dim">{time(m.at)}</span>
                </div>
              )}
              {m.poll ? (
                <div className="poll">
                  <p className="poll__q">📊 {m.poll.question}</p>
                  {m.poll.options.map((o, oi) => {
                    const total = m.poll!.options.reduce((n, x) => n + x.count, 0) || 1;
                    return (
                      <button key={oi} type="button" className={`poll__opt ${o.mine ? "mine" : ""}`} disabled={readOnly}
                        title={o.voters.join(", ") || "No votes yet"} onClick={() => vote({ messageId: m._id, option: oi })}>
                        <span className="poll__bar" style={{ width: `${(o.count / total) * 100}%` }} />
                        <span className="poll__label">{o.mine ? "✓ " : ""}{o.label}</span>
                        <span className="poll__count">{o.count}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={`msg__text md ${ai ? "to-ai" : ""} ${mentionsMe(m.text) ? "mentions-me" : ""}`}
                  dangerouslySetInnerHTML={{ __html: highlightMentions(renderMarkdown(m.text), names) }} />
              )}
              {(m.reactions.length > 0 || !readOnly) && (
                <div className="reacts">
                  {m.reactions.map((r) => (
                    <button key={r.emoji} type="button" className={`react ghost ${r.mine ? "mine" : ""}`} disabled={readOnly}
                      title={r.who.join(", ")} aria-label={`${r.emoji} ${r.count}, ${r.mine ? "remove yours" : "add yours"}`}
                      onClick={() => react({ messageId: m._id, emoji: r.emoji })}>
                      {r.emoji} <span>{r.count}</span>
                    </button>
                  ))}
                  {!readOnly && (
                    <span className="react-add">
                      {REACTIONS.filter((e) => !m.reactions.some((r) => r.emoji === e)).map((e) => (
                        <button key={e} type="button" className="react react--pick ghost" aria-label={`React ${e}`}
                          onClick={() => react({ messageId: m._id, emoji: e })}>{e}</button>
                      ))}
                      <button type="button" className="react react--pick ghost" aria-label={`Reply to ${m.author}`} title="Reply"
                        onClick={() => reply(m.author, m.poll ? m.poll.question : m.text)}>↩</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <p className="typing" aria-live="polite"><span className="typing__dots" aria-hidden="true"><i /><i /><i /></span>
            {typingNames.length === 1 ? `${typingNames[0]} is typing` : typingNames.length === 2 ? `${typingNames[0]} and ${typingNames[1]} are typing` : "Several people are typing"}</p>
        )}
        <div ref={end} />
      </div>
      {readOnly ? (
        <div className="chat__locked"><button className="btn btn--primary btn--sm" onClick={() => goJoin(code)}>Sign up to chat</button></div>
      ) : (
        <form className="chat__box" onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const t = text;
          setText("");
          setErr("");
          lastPing.current = 0; setTyping({ workspaceId, typing: false }).catch(() => {});
          try { await send({ workspaceId, text: t }); } catch (x) { setText(t); setErr(String((x as Error).message).split("\n")[0].replace(/^.*Error: /, "")); }
        }}>
          {suggest.length > 0 && (
            <div className="mention-pop" role="listbox" aria-label="Mention someone">
              {suggest.map((n) => (
                <button key={n} type="button" role="option" aria-selected="false"
                  onClick={() => setText(text.replace(/@[\w-]*$/, `@${n} `))}>@{n}{n === "ai" ? <span className="dim"> · ask the AI</span> : null}</button>
              ))}
            </div>
          )}
          <textarea ref={box} rows={1} value={text} placeholder="Message the group, or @ai…" aria-label="Message the group"
            onChange={(e) => { setText(e.target.value); onType(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
          <button disabled={!text.trim()} aria-label="Send message">↑</button>
          {err && <p className="err chat__err">{err}</p>}
        </form>
      )}
    </div>
  );
}

function WorkspaceSettings({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { code, readOnly } = useView();
  const ws = useQuery(api.workspaces.get, { id: workspaceId, code });
  const members = useQuery(api.workspaces.members, { workspaceId, code });
  const rename = useMutation(api.workspaces.rename);
  const setInstructions = useMutation(api.workspaces.setInstructions);
  const resetLink = useMutation(api.workspaces.resetLink);
  const leave = useMutation(api.workspaces.leave);
  const remove = useMutation(api.workspaces.remove);
  const [name, setName] = useState<string | null>(null);
  const [instr, setInstr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 1800); };
  if (!ws) return <div className="ws-settings dim">Loading…</div>;
  const link = ws.inviteCode ? `${location.origin}${location.pathname}#/join/${ws.inviteCode}` : "";
  return (
    <div className="ws-settings">
      <label className="field">Name
        <div className="row">
          <input value={name ?? ws.name} maxLength={60} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
          {!readOnly && <button disabled={name === null || !name.trim() || name === ws.name}
            onClick={async () => { await rename({ workspaceId, name: name! }); setName(null); flash("Renamed"); }}>Save</button>}
        </div>
      </label>

      <label className="field">How the AI should work here
        <em>Sent with every prompt, for everyone. e.g. "Keep a budget under $300 each" or "Write at a 10th grade level".</em>
        <textarea rows={5} maxLength={4000} disabled={readOnly} value={instr ?? ws.instructions}
          placeholder="Optional instructions for the AI in this workspace" onChange={(e) => setInstr(e.target.value)} />
        {!readOnly && instr !== null && instr !== ws.instructions && (
          <button className="btn btn--primary btn--sm" onClick={async () => { await setInstructions({ workspaceId, instructions: instr }); setInstr(null); flash("Instructions saved"); }}>
            Save instructions
          </button>
        )}
      </label>

      <div className="field">People
        <ul className="members">
          {members?.map((m) => (
            <li key={m.userId}><span className="avatar avatar--sm" style={{ background: m.color }}>{m.name[0]?.toUpperCase()}</span>{m.name}{m.owner && <span className="dim"> · owner</span>}</li>
          ))}
        </ul>
      </div>

      {ws.member && (
        <div className="field">Share link
          <em>Anyone with the link can watch live. They sign up to join in.</em>
          <div className="row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <button className="btn btn--ghost btn--sm" onClick={() => { navigator.clipboard.writeText(link); flash("Link copied"); }}>Copy</button>
          </div>
          {ws.owner && (
            <button className="ghost danger-link" onClick={async () => {
              if (!confirm("Make a new link? The old one will stop working for anyone who hasn't joined yet.")) return;
              await resetLink({ workspaceId }); flash("New link created");
            }}>Reset link</button>
          )}
        </div>
      )}

      <div className="field">Files
        <em>Download everything in this workspace.</em>
        <ExportButton workspaceId={workspaceId} name={ws.name} code={code} />
      </div>

      {ws.member && (
        <div className="field danger-zone">
          {ws.owner ? (
            <button className="ghost danger-link" onClick={async () => {
              if (!confirm(`Delete "${ws.name}" for everyone? Files, chat and history will be removed.`)) return;
              await remove({ workspaceId }); location.hash = "/";
            }}>Delete workspace</button>
          ) : (
            <button className="ghost danger-link" onClick={async () => {
              if (!confirm(`Leave "${ws.name}"? You can rejoin with the link.`)) return;
              await leave({ workspaceId }); location.hash = "/";
            }}>Leave workspace</button>
          )}
        </div>
      )}
      {note && <p className="ok" role="status">{note}</p>}
    </div>
  );
}
