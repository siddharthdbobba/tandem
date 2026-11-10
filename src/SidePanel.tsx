import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { renderMarkdown } from "./markdown";
import { goJoin, useView } from "./view";
import { ExportButton } from "./Export";

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

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Chat({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { code, readOnly } = useView();
  const msgs = useQuery(api.chat.list, { workspaceId, code });
  const send = useMutation(api.chat.send);
  const vote = useMutation(api.chat.vote);
  const me = useQuery(api.profile.me);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
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
                <div className={`msg__text md ${ai ? "to-ai" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
              )}
            </div>
          );
        })}
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
          try { await send({ workspaceId, text: t }); } catch (x) { setText(t); setErr(String((x as Error).message).split("\n")[0].replace(/^.*Error: /, "")); }
        }}>
          <textarea rows={1} value={text} placeholder="Message the group… (@ai to ask the AI)" aria-label="Message the group"
            onChange={(e) => setText(e.target.value)}
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
