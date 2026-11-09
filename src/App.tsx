import { useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#8e4ec6", "#d6409f"];
const PROVIDERS = [
  { id: "claude", label: "Claude (Pro / Max)" },
  { id: "openai", label: "ChatGPT (Plus / Pro)" },
] as const;
type ProviderId = (typeof PROVIDERS)[number]["id"];

// Routes: #/            home
//         #/settings    my config
//         #/w/<id>      workspace
//         #/join/<code> accept invite
function useRoute() {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const [, kind, arg] = hash.split("/");
  return { kind: kind ?? "", arg: arg ?? "" };
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="center dim">Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <SignedIn />
      </Authenticated>
    </>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  // Arriving from a workspace invite link? That code also lets you sign up.
  const linkCode = location.hash.match(/^#\/join\/([a-z0-9]+)/)?.[1] ?? "";
  const [flow, setFlow] = useState<"signIn" | "signUp">(linkCode ? "signUp" : "signIn");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="center">
      <h1>Tandem</h1>
      <p className="dim">Multiplayer coding agent. Shared folders, many prompts, live output. Each person's agent runs on their own AI subscription.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const fd = new FormData(e.currentTarget);
          fd.set("flow", flow);
          try {
            await signIn("password", fd);
          } catch (err) {
            const msg = String((err as { data?: string })?.data ?? (err as Error).message ?? "");
            setError(
              flow === "signIn" ? "Wrong email or password."
              : /invite/i.test(msg) ? "That invite code isn't valid. Tandem is invite-only for now."
              : /8 characters/.test(msg) ? "Password must be at least 8 characters."
              : "Couldn't create the account. If you already have one, sign in instead.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {flow === "signUp" && <input name="name" placeholder="Display name" required maxLength={40} />}
        {flow === "signUp" && (
          <input name="invite" placeholder="Invite code" required defaultValue={linkCode} autoComplete="off" />
        )}
        <input name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input name="password" type="password" placeholder="Password (8+ characters)" required minLength={8}
          autoComplete={flow === "signIn" ? "current-password" : "new-password"} />
        <button disabled={busy}>{flow === "signIn" ? "Sign in" : "Create account"}</button>
        {error && <p className="err">{error}</p>}
      </form>
      <button className="ghost" onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}>
        {flow === "signIn" ? "New here? Create an account (invite only)" : "Have an account? Sign in"}
      </button>
    </div>
  );
}

function SignedIn() {
  const init = useMutation(api.profile.init);
  const me = useQuery(api.profile.me);
  const route = useRoute();
  useEffect(() => {
    if (me && !me.profile) init();
  }, [me, init]);
  if (!me?.profile) return <div className="center dim">Loading…</div>;
  if (route.kind === "settings") return <Settings />;
  if (route.kind === "join") return <Join code={route.arg} />;
  if (route.kind === "w" && route.arg) return <Workspace id={route.arg as Id<"workspaces">} />;
  return <Home />;
}

function TopRight() {
  const me = useQuery(api.profile.me);
  const { signOut } = useAuthActions();
  const connected = me?.connections.some((c) => c.provider === me.profile?.provider && c.status === "connected");
  return (
    <div className="topright">
      {me && !connected && (
        <a href="#/settings" className="warn-pill">Connect your AI subscription</a>
      )}
      <a href="#/settings" className="ghost-link" title="Settings">
        <span className="avatar" style={{ background: me?.profile?.color }}>{me?.profile?.name[0]?.toUpperCase()}</span>
      </a>
      <button className="ghost" onClick={() => signOut()}>Sign out</button>
    </div>
  );
}

function Home() {
  const workspaces = useQuery(api.workspaces.list);
  const create = useMutation(api.workspaces.create);
  const [name, setName] = useState("");
  return (
    <div className="page">
      <header className="bar">
        <a href="#/" className="logo">Tandem</a>
        <TopRight />
      </header>
      <div className="center">
        <h2>Your workspaces</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const id = await create({ name: name.trim() });
            location.hash = `/w/${id}`;
          }}
        >
          <input placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} />
          <button>Create</button>
        </form>
        <ul className="ws-list">
          {workspaces?.map((w) => (
            <li key={w._id}>
              <a href={`#/w/${w._id}`}>{w.name}</a> <span className="dim">owner {w.owner}</span>
            </li>
          ))}
          {workspaces?.length === 0 && <li className="dim">None yet. Create one or open an invite link.</li>}
        </ul>
      </div>
    </div>
  );
}

function Join({ code }: { code: string }) {
  const join = useMutation(api.workspaces.join);
  const [error, setError] = useState("");
  useEffect(() => {
    join({ inviteCode: code })
      .then((id) => (location.hash = `/w/${id}`))
      .catch((e) => setError(String(e.message).includes("invalid") ? "This invite link is invalid." : "Could not join."));
  }, [code, join]);
  return <div className="center">{error ? <>{error} <a href="#/">Home</a></> : <span className="dim">Joining…</span>}</div>;
}

function Settings() {
  const me = useQuery(api.profile.me);
  const update = useMutation(api.profile.update);
  const startConnect = useMutation(api.profile.startConnect);
  const submitCode = useMutation(api.profile.submitCode);
  const cancelConnect = useMutation(api.profile.cancelConnect);
  const [name, setName] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState("");
  if (!me?.profile) return null;
  const p = me.profile;
  const flow = me.flows[0];
  const status = (prov: ProviderId) => me.connections.find((c) => c.provider === prov);
  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(""), 1500);
  };

  return (
    <div className="page">
      <header className="bar">
        <a href="#/" className="logo">Tandem</a>
        <TopRight />
      </header>
      <div className="center settings">
        <h2>Settings</h2>
        <p className="dim">Saved to your account, so it follows you to any device. Signed in as {me.email}.</p>

        <section>
          <h3>Profile</h3>
          <label>Display name</label>
          <div className="row">
            <input value={name ?? p.name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <button disabled={name === null || name === p.name}
              onClick={async () => { await update({ name: name! }); setName(null); flash("Name saved"); }}>Save</button>
          </div>
          <label>Color</label>
          <div className="row swatches">
            {COLORS.map((c) => (
              <button key={c} className={`swatch ${p.color === c ? "on" : ""}`} style={{ background: c }}
                aria-label={c} onClick={() => update({ color: c })} />
            ))}
          </div>
        </section>

        <section>
          <h3>AI subscription</h3>
          <p className="dim">
            Prompts you send run on <b>your</b> subscription through Jcode, in a sandbox only your account can read.
            Nobody else's prompts ever use it.
          </p>
          {PROVIDERS.map((pr) => {
            const st = status(pr.id);
            return (
              <div key={pr.id} className="provider">
                <label className="radio">
                  <input type="radio" name="provider" checked={p.provider === pr.id}
                    onChange={() => update({ provider: pr.id }).then(() => flash("Default saved"))} />
                  {pr.label}
                </label>
                <span className={`badge ${st?.status ?? "none"}`}>
                  {st?.status === "connected" ? "connected" : st?.status === "error" ? "needs reconnect" : "not connected"}
                </span>
                <button className="ghost" onClick={() => startConnect({ provider: pr.id })}>
                  {st?.status === "connected" ? "Reconnect" : "Connect"}
                </button>
              </div>
            );
          })}

          {flow && (
            <div className="connect-box">
              {flow.status === "starting" && <p className="dim"><span className="spin" /> Preparing {flow.provider} sign-in…</p>}
              {flow.status === "awaiting_code" && flow.authUrl && (
                <>
                  <p>1. <a href={flow.authUrl} target="_blank" rel="noreferrer">Open the {flow.provider === "claude" ? "Claude" : "ChatGPT"} sign-in page</a> and approve.</p>
                  <p>2. {flow.provider === "claude"
                    ? "Copy the code it shows you and paste it here."
                    : "It will end on a page that fails to load (localhost). Copy that whole URL from the address bar and paste it here."}</p>
                  <form className="row" onSubmit={async (e) => {
                    e.preventDefault();
                    if (!code.trim()) return;
                    await submitCode({ flowId: flow._id, code: code.trim() });
                    setCode("");
                  }}>
                    <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
                      placeholder={flow.provider === "claude" ? "Paste code" : "Paste the full URL"} />
                    <button>Finish</button>
                  </form>
                  <button className="ghost" onClick={() => cancelConnect({ flowId: flow._id })}>Cancel</button>
                </>
              )}
              {flow.status === "submitting" && <p className="dim"><span className="spin" /> Finishing sign-in…</p>}
              {flow.status === "error" && (
                <p className="err">Sign-in failed: {flow.error ?? "unknown error"}.{" "}
                  <button className="ghost" onClick={() => startConnect({ provider: flow.provider })}>Try again</button></p>
              )}
            </div>
          )}

          <label>Model override (optional)</label>
          <div className="row">
            <input value={model ?? p.model ?? ""} onChange={(e) => setModel(e.target.value)}
              placeholder="default for your subscription" maxLength={80} />
            <button disabled={model === null || model === (p.model ?? "")}
              onClick={async () => { await update({ model: model || null }); setModel(null); flash("Model saved"); }}>Save</button>
          </div>
        </section>
        {saved && <p className="ok">{saved}</p>}
      </div>
    </div>
  );
}

function Workspace({ id }: { id: Id<"workspaces"> }) {
  const me = useQuery(api.profile.me);
  const ws = useQuery(api.workspaces.get, { id });
  const panes = useQuery(api.workspaces.listPanes, { workspaceId: id });
  const addPane = useMutation(api.workspaces.addPane);
  const heartbeat = useMutation(api.presence.heartbeat);
  const [now, setNow] = useState(Date.now());
  const people = useQuery(api.presence.list, { workspaceId: id, now: Math.floor(now / 10000) * 10000 });
  const [focusPane, setFocusPane] = useState<Id<"panes"> | undefined>();
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const beat = () => {
      heartbeat({ workspaceId: id, paneId: focusPane }).catch(() => {});
      setNow(Date.now());
    };
    beat();
    const t = setInterval(beat, 10000);
    return () => clearInterval(t);
  }, [id, focusPane, heartbeat]);

  if (ws === null) return <div className="center">Workspace not found. <a href="#/">Back</a></div>;
  const myId = me?.userId;

  return (
    <div className="layout">
      <header>
        <a href="#/" className="logo">Tandem</a>
        <span className="ws-name">{ws?.name}</span>
        <button className="ghost" onClick={() => {
          navigator.clipboard.writeText(`${location.origin}${location.pathname}#/join/${ws?.inviteCode}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}>
          {copied ? "Copied" : "Copy invite link"}
        </button>
        <div className="people">
          {people?.map((p) => (
            <span key={p._id} className="avatar" style={{ background: p.color }} title={p.name}>
              {p.name[0]?.toUpperCase()}
            </span>
          ))}
        </div>
        <TopRight />
      </header>
      <aside>
        <FileTree workspaceId={id} open={openFile} onOpen={setOpenFile} />
      </aside>
      <main>
        {openFile ? (
          <Editor key={openFile} workspaceId={id} path={openFile} onClose={() => setOpenFile(null)} />
        ) : (
          <>
            <div className="panes">
              {panes?.map((p) => (
                <Pane
                  key={p._id}
                  pane={p}
                  myId={myId}
                  viewers={people?.filter((x) => x.paneId === p._id && x.userId !== myId) ?? []}
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

type PaneDoc = { _id: Id<"panes">; title: string };

function Pane({
  pane,
  myId,
  viewers,
  onFocus,
  canClose,
}: {
  pane: PaneDoc;
  myId?: string;
  viewers: { name: string; color: string; userId: string }[];
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
        <span className="viewers">
          {viewers.map((v) => (
            <span key={v.userId} className="dot" style={{ background: v.color }} title={`${v.name} is here`} />
          ))}
        </span>
        {canClose && (
          <button className="ghost x" onClick={() => remove({ paneId: pane._id })} title="Close pane">
            ×
          </button>
        )}
      </div>
      <div className="feed">
        {feed?.length === 0 && <p className="dim">Prompt the agent. Everyone here sees the output live. Your prompts run on your subscription.</p>}
        {feed?.map((r) => (
          <div key={r._id} className="run">
            <div className="prompt">
              <span className="who">{r.author}</span> {r.prompt}
              {r.provider && (
                <span className="billed" title="Billed to this person's subscription">
                  {r.userId === myId ? "your" : `${r.author}'s`} {r.provider}{r.model ? ` · ${r.model}` : ""}
                </span>
              )}
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
          submit({ paneId: pane._id, prompt: text.trim() });
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
  open,
  onOpen,
}: {
  workspaceId: Id<"workspaces">;
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
            if (p) save({ workspaceId, path: p, content: "" }).then(() => onOpen(p));
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
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  path: string;
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
            await save({ workspaceId, path, content: draft! });
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
            if (dirty) save({ workspaceId, path, content: draft! }).then(() => setDraft(null));
          }
        }}
      />
    </div>
  );
}
