import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#8e4ec6", "#d6409f"];

function useUser() {
  const [name, setName] = useState(
    () => new URLSearchParams(location.search).get("name") ?? localStorage.getItem("tandem-name") ?? "",
  );
  const color = COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const save = (n: string) => {
    localStorage.setItem("tandem-name", n);
    setName(n);
  };
  return { name, color, save };
}

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const user = useUser();
  const hash = useHash();
  if (!user.name) return <NamePrompt onSave={user.save} />;
  if (!hash) return <Home user={user.name} />;
  return <Workspace id={hash as Id<"workspaces">} user={user.name} color={user.color} />;
}

function NamePrompt({ onSave }: { onSave: (n: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="center">
      <h1>Tandem</h1>
      <p className="dim">Multiplayer coding agent. Shared folders, many prompts, live output.</p>
      <form onSubmit={(e) => (e.preventDefault(), v.trim() && onSave(v.trim()))}>
        <input autoFocus placeholder="Your name" value={v} onChange={(e) => setV(e.target.value)} />
        <button>Join</button>
      </form>
    </div>
  );
}

function Home({ user }: { user: string }) {
  const workspaces = useQuery(api.workspaces.list);
  const create = useMutation(api.workspaces.create);
  const [name, setName] = useState("");
  return (
    <div className="center">
      <h1>Tandem</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = await create({ name: name.trim(), user });
          location.hash = id;
        }}
      >
        <input placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} />
        <button>Create</button>
      </form>
      <ul className="ws-list">
        {workspaces?.map((w) => (
          <li key={w._id}>
            <a href={`#${w._id}`}>{w.name}</a> <span className="dim">by {w.createdBy}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Workspace({ id, user, color }: { id: Id<"workspaces">; user: string; color: string }) {
  const ws = useQuery(api.workspaces.get, { id });
  const panes = useQuery(api.workspaces.listPanes, { workspaceId: id });
  const addPane = useMutation(api.workspaces.addPane);
  const heartbeat = useMutation(api.presence.heartbeat);
  const [now, setNow] = useState(Date.now());
  const people = useQuery(api.presence.list, { workspaceId: id, now: Math.floor(now / 10000) * 10000 });
  const [focusPane, setFocusPane] = useState<Id<"panes"> | undefined>();
  const [openFile, setOpenFile] = useState<string | null>(null);

  useEffect(() => {
    const beat = () => {
      heartbeat({ workspaceId: id, name: user, color, paneId: focusPane });
      setNow(Date.now());
    };
    beat();
    const t = setInterval(beat, 10000);
    return () => clearInterval(t);
  }, [id, user, color, focusPane, heartbeat]);

  if (ws === null) return <div className="center">Workspace not found. <a href="#">Back</a></div>;

  return (
    <div className="layout">
      <header>
        <a href="#" className="logo">Tandem</a>
        <span className="ws-name">{ws?.name}</span>
        <button className="ghost" onClick={() => navigator.clipboard.writeText(location.href)}>
          Copy invite link
        </button>
        <div className="people">
          {people?.map((p) => (
            <span key={p._id} className="avatar" style={{ background: p.color }} title={p.name}>
              {p.name[0]?.toUpperCase()}
            </span>
          ))}
        </div>
      </header>
      <aside>
        <FileTree workspaceId={id} user={user} open={openFile} onOpen={setOpenFile} />
      </aside>
      <main>
        {openFile ? (
          <Editor key={openFile} workspaceId={id} path={openFile} user={user} onClose={() => setOpenFile(null)} />
        ) : (
          <>
            <div className="panes">
              {panes?.map((p) => (
                <Pane
                  key={p._id}
                  pane={p}
                  user={user}
                  viewers={people?.filter((x) => x.paneId === p._id && x.name !== user) ?? []}
                  onFocus={() => setFocusPane(p._id)}
                  canClose={(panes?.length ?? 0) > 1}
                />
              ))}
            </div>
            <button
              className="add-pane"
              onClick={() => addPane({ workspaceId: id, title: `Agent ${(panes?.length ?? 0) + 1}` })}
            >
              + New prompt pane
            </button>
          </>
        )}
      </main>
    </div>
  );
}

type PaneDoc = { _id: Id<"panes">; title: string; threadId?: string };

function Pane({
  pane,
  user,
  viewers,
  onFocus,
  canClose,
}: {
  pane: PaneDoc;
  user: string;
  viewers: { name: string; color: string }[];
  onFocus: () => void;
  canClose: boolean;
}) {
  const feed = useQuery(api.workspaces.paneFeed, { paneId: pane._id });
  const submit = useMutation(api.workspaces.submitPrompt);
  const cancel = useMutation(api.workspaces.cancelRun);
  const remove = useMutation(api.workspaces.removePane);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const running = feed?.find((r) => r.status === "running" || r.status === "queued");
  const eventCount = feed?.reduce((n, r) => n + r.events.length, 0);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [feed?.length, eventCount]);

  return (
    <section className="pane" onFocus={onFocus} onClick={onFocus}>
      <div className="pane-head">
        <strong>{pane.title}</strong>
        {pane.threadId && <span className="dim">· keeps context</span>}
        <span className="viewers">
          {viewers.map((v) => (
            <span key={v.name} className="dot" style={{ background: v.color }} title={`${v.name} is here`} />
          ))}
        </span>
        {canClose && (
          <button className="ghost x" onClick={() => remove({ paneId: pane._id })} title="Close pane">
            ×
          </button>
        )}
      </div>
      <div className="feed">
        {feed?.length === 0 && <p className="dim">Prompt the agent. Everyone in this workspace sees the output live.</p>}
        {feed?.map((r) => (
          <div key={r._id} className="run">
            <div className="prompt">
              <span className="who">{r.author}</span> {r.prompt}
            </div>
            {r.events.map((e) => (
              <pre key={e._id} className={`ev ${e.kind}`}>
                {e.text}
              </pre>
            ))}
            <div className={`status ${r.status}`}>
              {r.status === "queued" && "queued"}
              {r.status === "running" && (
                <>
                  <span className="spin" /> working{" "}
                  <button className="ghost" onClick={() => cancel({ runId: r._id })}>
                    stop
                  </button>
                </>
              )}
              {r.status === "error" && "error"}
              {r.status === "cancelled" && "stopped"}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="prompt-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          submit({ paneId: pane._id, prompt: text.trim(), author: user });
          setText("");
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder={running ? "Queue a follow-up..." : "Ask the agent to build something..."}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button>Send</button>
      </form>
    </section>
  );
}

function FileTree({
  workspaceId,
  user,
  open,
  onOpen,
}: {
  workspaceId: Id<"workspaces">;
  user: string;
  open: string | null;
  onOpen: (p: string) => void;
}) {
  const files = useQuery(api.files.tree, { workspaceId });
  const save = useMutation(api.files.save);
  const sorted = [...(files ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <div className="tree">
      <div className="tree-head">
        <strong>Files</strong>
        <button
          className="ghost"
          onClick={() => {
            const p = prompt("New file path (e.g. notes.md)");
            if (p) save({ workspaceId, path: p, content: "", user }).then(() => onOpen(p));
          }}
        >
          + file
        </button>
      </div>
      {sorted.length === 0 && <p className="dim">Empty. Files the agent writes show up here.</p>}
      {sorted.map((f) => {
        const depth = f.path.split("/").length - 1;
        return (
          <div
            key={f._id}
            className={`file ${open === f.path ? "active" : ""}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => onOpen(f.path)}
            title={`last change: ${f.updatedBy}`}
          >
            {f.path.split("/").pop()}
            {depth > 0 && <span className="dim"> {f.path.split("/").slice(0, -1).join("/")}/</span>}
          </div>
        );
      })}
    </div>
  );
}

function Editor({
  workspaceId,
  path,
  user,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  path: string;
  user: string;
  onClose: () => void;
}) {
  const file = useQuery(api.files.get, { workspaceId, path });
  const save = useMutation(api.files.save);
  const [draft, setDraft] = useState<string | null>(null);
  const dirty = draft !== null && draft !== file?.content;
  // If someone else changes the file while you have no local edits, you see it live.
  const value = draft ?? file?.content ?? "";

  return (
    <div className="editor">
      <div className="pane-head">
        <button className="ghost" onClick={onClose}>
          ← panes
        </button>
        <strong>{path}</strong>
        <span className="dim">last change by {file?.updatedBy ?? "?"}</span>
        {file?.pendingWrite && <span className="dim">· syncing to disk</span>}
        <button
          disabled={!dirty}
          onClick={async () => {
            await save({ workspaceId, path, content: draft!, user });
            setDraft(null);
          }}
        >
          {dirty ? "Save" : "Saved"}
        </button>
      </div>
      <textarea
        className="code"
        spellCheck={false}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            if (dirty) save({ workspaceId, path, content: draft!, user }).then(() => setDraft(null));
          }
        }}
      />
    </div>
  );
}
