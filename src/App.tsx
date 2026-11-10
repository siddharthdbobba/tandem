import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import Landing from "./Landing";

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#8e4ec6", "#d6409f"];
const PROVIDERS = [
  { id: "claude", label: "Claude (Pro / Max)" },
  { id: "openai", label: "ChatGPT (Plus / Pro)" },
] as const;
type ProviderId = (typeof PROVIDERS)[number]["id"];
// From `jcode model list -p <provider>` on the server.
const MODELS: Record<ProviderId, string[]> = {
  claude: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2", "claude-opus-5", "claude-sonnet-5"],
  openai: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-5.6-sol"],
};
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
// "claude-sonnet-5-5" -> "Sonnet 5.5", "gpt-6.1-sol" -> "GPT-6.1 Sol"
const modelLabel = (m: string) =>
  m.startsWith("claude-")
    ? m.slice(7).replace(/^(\w)(\w*)-(\d+)(?:-(\d+))?$/, (_, a, b, x, y) => `${a.toUpperCase()}${b} ${x}${y ? "." + y : ""}`)
    : m.replace(/^gpt-([\d.]+)-(\w)(\w*)$/, (_, v, a, b) => `GPT-${v} ${a.toUpperCase()}${b}`);
const providerName = (p: string) => (p === "claude" ? "Claude" : "ChatGPT");

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

// Viewing through a share link: queries carry the code; writes are swapped for a sign-in prompt.
type View = { code?: string; readOnly: boolean };
const ViewCtx = createContext<View>({ readOnly: false });
const useView = () => useContext(ViewCtx);
// Sends a viewer to sign up, then back into this workspace as a member.
const goJoin = (code?: string) => {
  if (code) sessionStorage.setItem("tandem-join", code);
  location.hash = "/signup";
};

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="loading"><span className="spin" aria-hidden="true" /> Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <SignedOut />
      </Unauthenticated>
      <Authenticated>
        <SignedIn />
      </Authenticated>
    </>
  );
}

// Signed-out routes: #/signin and #/signup show the form, a #/join link shows
// sign-up and remembers the invite; everything else is the landing page.
function SignedOut() {
  const route = useRoute();
  if (route.kind === "join" && route.arg) return <Viewer code={route.arg} />;
  if (route.kind === "signin") return <SignIn initial="signIn" />;
  if (route.kind === "signup") return <SignIn initial="signUp" />;
  return <Landing />;
}

function SignIn({ initial }: { initial: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setFlow(initial), [initial]);
  const joining = !!sessionStorage.getItem("tandem-join");
  const methods = useQuery(api.authInfo.methods);
  return (
    <div className="auth">
      <a href="#/" className="brand auth__brand"><span className="brand__mark" aria-hidden="true" />Tandem</a>
      <div className="auth__card">
      <h1 className="auth__title">{flow === "signIn" ? "Sign in" : "Create your account"}</h1>
      <p className="auth__sub">
        {joining
          ? "You've been invited to a workspace. Sign in or create an account to join it."
          : flow === "signIn"
            ? "Welcome back. Your settings and workspaces are waiting."
            : "Takes a few seconds. You'll connect your AI subscription afterwards."}
      </p>
      {methods?.github && (
        <>
          <button type="button" className="btn btn--ghost btn--block btn--github" disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                // Come back to the same page (keeps a pending invite link).
                await signIn("github", { redirectTo: `${location.origin}${location.pathname}` });
              } catch {
                setError("Couldn't start GitHub sign-in. Try again.");
                setBusy(false);
              }
            }}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            Continue with GitHub
          </button>
          <div className="auth__or" aria-hidden="true"><span>or with email</span></div>
        </>
      )}
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
              : /8 characters/.test(msg) ? "Password must be at least 8 characters."
              : "Couldn't create the account. If you already have one, sign in instead.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {flow === "signUp" && (
          <label className="field">
            <span>Display name</span>
            <input name="name" required maxLength={40} autoComplete="nickname" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="field">
          <span>Password {flow === "signUp" && <em>8+ characters</em>}</span>
          <input name="password" type="password" required minLength={8}
            autoComplete={flow === "signIn" ? "current-password" : "new-password"} />
        </label>
        <button className="btn btn--primary btn--block" disabled={busy} aria-busy={busy}>
          {busy ? <span className="spin" aria-hidden="true" /> : null}
          {flow === "signIn" ? "Sign in" : "Create account"}
        </button>
        {error && <p className="err" role="alert">{error}</p>}
      </form>
      </div>
      <p className="auth__switch">
        {flow === "signIn" ? "New to Tandem? " : "Already have an account? "}
        <a href={flow === "signIn" ? "#/signup" : "#/signin"} className="textlink"
          onClick={(e) => { if (location.hash.startsWith("#/join")) { e.preventDefault(); setFlow(flow === "signIn" ? "signUp" : "signIn"); } }}>
          {flow === "signIn" ? "Create an account" : "Sign in"}
        </a>
      </p>
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
  if (!me?.profile) return <div className="loading"><span className="spin" aria-hidden="true" /> Loading…</div>;
  // Came in through an invite link before signing in? Finish joining now.
  const pendingJoin = sessionStorage.getItem("tandem-join");
  if (pendingJoin && route.kind !== "join") {
    sessionStorage.removeItem("tandem-join");
    location.hash = `/join/${pendingJoin}`;
    return null;
  }
  if (route.kind === "join") sessionStorage.removeItem("tandem-join");
  if (route.kind === "settings") return <Settings />;
  if (route.kind === "join") return <Join code={route.arg} />;
  if (route.kind === "w" && route.arg) return <Workspace id={route.arg as Id<"workspaces">} />;
  return <Home />;
}

function TopRight() {
  const me = useQuery(api.profile.me);
  const { signOut } = useAuthActions();
  const connected = me?.connections.some((c) => c.provider === me.profile?.provider && c.status === "connected");
  const { code, readOnly } = useView();
  if (readOnly) {
    return (
      <div className="topright">
        <a href="#/signin" className="textlink" onClick={() => code && sessionStorage.setItem("tandem-join", code)}>Sign in</a>
        <button className="btn btn--primary btn--sm" onClick={() => goJoin(code)}>Sign up to join</button>
      </div>
    );
  }
  return (
    <div className="topright">
      {me && !connected && (
        <a href="#/settings" className="warn-pill"><span className="warn-pill__dot" aria-hidden="true" />Connect your AI subscription</a>
      )}
      <a href="#/settings" className="me" title="Settings">
        <span className="avatar" style={{ background: me?.profile?.color }}>{me?.profile?.name[0]?.toUpperCase()}</span>
        <span className="me__name">{me?.profile?.name}</span>
      </a>
      <button className="ghost" onClick={() => signOut()}>Sign out</button>
    </div>
  );
}

function AppBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bar">
      <a href="#/" className="brand"><span className="brand__mark" aria-hidden="true" />Tandem</a>
      {children}
      <TopRight />
    </header>
  );
}

function Home() {
  const workspaces = useQuery(api.workspaces.list);
  const create = useMutation(api.workspaces.create);
  const me = useQuery(api.profile.me);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <AppBar />
      <main className="home">
        <div className="home__head">
          <h1 className="home__title">Your workspaces</h1>
          <p className="home__sub">Each workspace is one shared folder. Invite people with its link.</p>
        </div>
        <form
          className="newws"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              const id = await create({ name: name.trim() });
              location.hash = `/w/${id}`;
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="sr-only" htmlFor="newws">New workspace name</label>
          <input id="newws" placeholder="Name a new workspace, e.g. trail-weather" value={name}
            onChange={(e) => setName(e.target.value)} maxLength={60} />
          <button className="btn btn--primary" disabled={busy || !name.trim()}>Create workspace</button>
        </form>
        {workspaces === undefined ? (
          <p className="dim">Loading…</p>
        ) : workspaces.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No workspaces yet</p>
            <p className="dim">Create one above, or open an invite link someone sent you.</p>
          </div>
        ) : (
          <ul className="wslist">
            {workspaces.map((w) => (
              <li key={w._id}>
                <a href={`#/w/${w._id}`} className="wslist__row">
                  <span className="wslist__name">{w.name}</span>
                  <span className="wslist__meta">{w.owner === me?.profile?.name ? "yours" : `shared by ${w.owner}`}</span>
                  <span className="wslist__go" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
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
  return (
    <div className="loading">
      {error ? <span>{error} <a href="#/" className="textlink">Back to your workspaces</a></span>
        : <><span className="spin" aria-hidden="true" /> Joining workspace…</>}
    </div>
  );
}

function Settings() {
  const me = useQuery(api.profile.me);
  const update = useMutation(api.profile.update);
  const startConnect = useMutation(api.profile.startConnect);
  const submitCode = useMutation(api.profile.submitCode);
  const cancelConnect = useMutation(api.profile.cancelConnect);
  const [name, setName] = useState<string | null>(null);
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
      <AppBar />
      <main className="settings">
        <h1 className="home__title">Settings</h1>
        <p className="home__sub">Saved to your account, so it follows you to any device. Signed in as {me.email}.</p>

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
                    onChange={() => update({ provider: pr.id, model: null }).then(() => flash("Default saved"))} />
                  {pr.label}
                </label>
                <span className={`badge ${st?.status ?? "none"}`}>
                  {st?.status === "connected" ? "connected" : st?.status === "error" ? "needs reconnect" : "not connected"}
                </span>
                <button className={`btn btn--sm ${st?.status === "connected" ? "btn--ghost" : "btn--primary"}`}
                  onClick={() => startConnect({ provider: pr.id })}>
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

          <label htmlFor="model">Model</label>
          <select id="model" className="select" value={p.model ?? ""}
            onChange={(e) => update({ model: e.target.value || null }).then(() => flash("Model saved"))}>
            <option value="">Default for your subscription</option>
            {[...MODELS[p.provider as ProviderId], ...(p.model && !MODELS[p.provider as ProviderId].includes(p.model) ? [p.model] : [])]
              .map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={!!p.autoPoke}
              onChange={(e) => update({ autoPoke: e.target.checked }).then(() => flash(e.target.checked ? "Auto follow-up on" : "Auto follow-up off"))} />
            <span>
              <b>Auto follow-up</b>
              <span className="dim">If the agent stops with its plan unfinished, nudge it to keep going (up to 3 times). Finishes more long tasks, but uses more of your subscription.</span>
            </span>
          </label>
        </section>
        {saved && <p className="ok" role="status">{saved}</p>}
      </main>
    </div>
  );
}

// Signed out with a share link: look it up, then show the workspace read-only.
function Viewer({ code }: { code: string }) {
  const ws = useQuery(api.workspaces.peek, { code });
  if (ws === undefined) return <div className="loading"><span className="spin" aria-hidden="true" /> Loading…</div>;
  if (ws === null) return <div className="loading">This link is invalid. <a href="#/" className="textlink">Go home</a></div>;
  return (
    <ViewCtx.Provider value={{ code, readOnly: true }}>
      <Workspace id={ws._id} />
    </ViewCtx.Provider>
  );
}

function Workspace({ id }: { id: Id<"workspaces"> }) {
  const { code, readOnly } = useView();
  const me = useQuery(api.profile.me);
  const ws = useQuery(api.workspaces.get, { id, code });
  const panes = useQuery(api.workspaces.listPanes, { workspaceId: id, code });
  const addPane = useMutation(api.workspaces.addPane);
  const heartbeat = useMutation(api.presence.heartbeat);
  const [now, setNow] = useState(Date.now());
  const people = useQuery(api.presence.list, { workspaceId: id, now: Math.floor(now / 10000) * 10000, code });
  const [focusPane, setFocusPane] = useState<Id<"panes"> | undefined>();
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("tandem-sidebar") !== "0");
  const toggleSidebar = () => {
    setSidebar((s) => {
      localStorage.setItem("tandem-sidebar", s ? "0" : "1");
      return !s;
    });
  };
  // Cmd/Ctrl+B toggles the file sidebar, like most editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const beat = () => {
      if (!readOnly) heartbeat({ workspaceId: id, paneId: focusPane }).catch(() => {});
      setNow(Date.now());
    };
    beat();
    const t = setInterval(beat, 10000);
    return () => clearInterval(t);
  }, [id, focusPane, heartbeat, readOnly]);

  if (ws === null) return <div className="loading">Workspace not found. <a href="#/" className="textlink">Back to your workspaces</a></div>;
  const myId = me?.userId;

  return (
    <div className={`layout ${sidebar ? "" : "layout--nosidebar"}`}>
      <AppBar>
        <button className="sidebar-toggle" onClick={toggleSidebar} aria-pressed={sidebar}
          aria-label={sidebar ? "Hide files" : "Show files"} title={`${sidebar ? "Hide" : "Show"} files (⌘B)`}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
            {sidebar && <rect x="2.2" y="3.2" width="3.2" height="9.6" rx="1.4" fill="currentColor" opacity="0.35" />}
          </svg>
        </button>
        <span className="crumb" aria-hidden="true">/</span>
        <span className="ws-name">{ws?.name}</span>
        {readOnly ? (
          <span className="viewing-pill">View only</span>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={() => {
            navigator.clipboard.writeText(`${location.origin}${location.pathname}#/join/${ws?.inviteCode}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>
            {copied ? "Link copied" : "Copy share link"}
          </button>
        )}
        <div className="people" aria-label="People here now">
          {people?.map((p) => (
            <span key={p._id} className="avatar avatar--sm" style={{ background: p.color }} title={p.name}>
              {p.name[0]?.toUpperCase()}
            </span>
          ))}
        </div>
      </AppBar>
      {sidebar && (
        <aside>
          <FileTree workspaceId={id} open={openFile} onOpen={setOpenFile} />
        </aside>
      )}
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
                  canClose={!readOnly && (panes?.length ?? 0) > 1}
                />
              ))}
            </div>
            {!readOnly && (
              <button
                className="add-pane"
                onClick={() => addPane({ workspaceId: id, title: `Agent ${(panes?.length ?? 0) + 1}` })}
              >
                + New prompt pane
              </button>
            )}
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
  const { code, readOnly } = useView();
  const feed = useQuery(api.workspaces.paneFeed, { paneId: pane._id, code });
  const me = useQuery(api.profile.me);
  const submit = useMutation(api.workspaces.submitPrompt);
  // Per-pane model pick, remembered on this device. Empty = your Settings default.
  const pickKey = `tandem-pick2-${pane._id}`;
  const [pick, setPick] = useState<Pick>(() => {
    try { return JSON.parse(localStorage.getItem(pickKey) ?? "{}"); } catch { return {}; }
  });
  const choose = (v: Pick) => {
    setPick(v);
    localStorage.setItem(pickKey, JSON.stringify(v));
  };
  const connected = new Set(me?.connections.filter((c) => c.status === "connected").map((c) => c.provider));
  const cancel = useMutation(api.workspaces.cancelRun);
  const remove = useMutation(api.workspaces.removePane);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const running = feed?.find((r) => r.status === "running" || r.status === "queued");
  const live = feed?.find((r) => r.status === "running");
  const steer = useMutation(api.workspaces.steerRun);
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
              <span className="who">{r.author}</span>{r.steer && <span className="steer-tag">steer</span>} {r.prompt}
              {r.provider && (
                <span className="billed" title="Billed to this person's subscription">
                  {r.userId === myId ? "your" : `${r.author}'s`} {r.provider}{r.model ? ` · ${modelLabel(r.model)}` : ""}{r.effort ? ` · ${r.effort}` : ""}
                </span>
              )}
            </div>
            {r.events.map((e, i) =>
              e.kind === "todo" ? (
                // Only the newest todo snapshot of a run is shown.
                r.events.slice(i + 1).some((x) => x.kind === "todo") ? null : <TodoCard key={e._id} text={e.text} live={r.status === "running"} />
              ) : (
                <pre key={e._id} className={`ev ${e.kind}`}>
                  {e.text}
                </pre>
              ),
            )}
            <div className={`status ${r.status}`}>
              {r.status === "queued" && "queued"}
              {r.status === "running" && (
                <>
                  <span className="spin" /> working{" "}
                  {!readOnly && (
                    <button className="ghost" onClick={() => cancel({ runId: r._id })}>
                      stop
                    </button>
                  )}
                </>
              )}
              {r.status === "error" && "error"}
              {r.status === "cancelled" && (r.steeredBy ? `interrupted by ${r.steeredBy}` : "stopped")}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {readOnly ? (
        <div className="prompt-box prompt-box--locked">
          <span>Watching live. Sign up to send prompts with your own AI subscription.</span>
          <button className="btn btn--primary btn--sm" onClick={() => goJoin(code)}>Sign up to join</button>
          <a href="#/signin" className="textlink" onClick={() => code && sessionStorage.setItem("tandem-join", code)}>Sign in</a>
        </div>
      ) : (
      <form
        className="prompt-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const opts = {
            prompt: text.trim(),
            ...(pick.provider ? { provider: pick.provider, model: pick.model || undefined } : {}),
            ...(pick.effort ? { effort: pick.effort } : {}),
          };
          // Mid-run, Enter steers: stop the agent and redirect it. "Queue" waits instead.
          const queue = (e.nativeEvent as SubmitEvent).submitter?.dataset.queue === "1";
          if (live && !queue) steer({ runId: live._id, ...opts });
          else submit({ paneId: pane._id, ...opts });
          setText("");
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder={live ? `Steer the agent (Enter), or queue a follow-up...` : running ? "Queue a follow-up..." : "Ask the agent to build something..."}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="prompt-actions">
          <ModelPicker pick={pick} onChange={choose} connected={connected}
            fallback={me?.profile ? (me.profile.model ? modelLabel(me.profile.model) : providerName(me.profile.provider)) : "Default"} />
          {live ? (
            <div className="steer-btns">
              <button title="Interrupt the agent now and redirect it (Enter)">Steer</button>
              <button data-queue="1" className="btn--ghost" title="Send after the current run finishes">Queue</button>
            </div>
          ) : (
            <button>Send</button>
          )}
        </div>
      </form>
      )}
    </section>
  );
}

type Pick = { provider?: ProviderId; model?: string; effort?: Effort };

// Compact model + effort chooser for a pane's composer.
function ModelPicker({ pick, onChange, connected, fallback }: {
  pick: Pick;
  onChange: (p: Pick) => void;
  connected: Set<string>;
  fallback: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const label = pick.provider ? (pick.model ? modelLabel(pick.model) : providerName(pick.provider)) : fallback;
  const set = (p: Partial<Pick>) => onChange({ ...pick, ...p });
  return (
    <div className="picker" ref={ref}>
      <button type="button" className="picker__chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="picker__model">{label}</span>
        {pick.effort && <span className="picker__effort">{pick.effort}</span>}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div className="picker__menu" role="menu">
          <button type="button" role="menuitemradio" aria-checked={!pick.provider}
            className={`picker__item ${!pick.provider ? "on" : ""}`}
            onClick={() => { set({ provider: undefined, model: undefined }); setOpen(false); }}>
            My default <span className="picker__sub">{fallback}</span>
          </button>
          {PROVIDERS.map((pr) => {
            const ok = connected.has(pr.id);
            return (
              <div key={pr.id} className="picker__group">
                <div className="picker__heading">
                  {providerName(pr.id)}
                  {!ok && <a href="#/settings" className="picker__connect">Connect</a>}
                </div>
                {MODELS[pr.id].map((m) => {
                  const on = pick.provider === pr.id && pick.model === m;
                  return (
                    <button key={m} type="button" role="menuitemradio" aria-checked={on} disabled={!ok} data-model={`${pr.id}|${m}`}
                      className={`picker__item ${on ? "on" : ""}`}
                      onClick={() => { set({ provider: pr.id, model: m }); setOpen(false); }}>
                      {modelLabel(m)}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="picker__heading">Effort</div>
          <div className="picker__effort-row" role="radiogroup" aria-label="Reasoning effort">
            <button type="button" className={!pick.effort ? "on" : ""} onClick={() => set({ effort: undefined })}>auto</button>
            {EFFORTS.map((e) => (
              <button key={e} type="button" className={pick.effort === e ? "on" : ""} onClick={() => set({ effort: e })}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Live view of the agent's todo list, like Jcode's terminal checklist.
function TodoCard({ text, live }: { text: string; live: boolean }) {
  let items: { content: string; status: string }[] = [];
  try {
    items = JSON.parse(text);
  } catch {
    return null;
  }
  const done = items.filter((t) => t.status === "completed").length;
  const active = items.filter((t) => t.status !== "cancelled").length;
  return (
    <div className="todo-card">
      <div className="todo-card__head">
        <span>Plan</span>
        <span className="todo-card__dots" aria-label={`${done} of ${active} done`}>
          {items.filter((t) => t.status !== "cancelled").map((t, i) => <i key={i} className={t.status} />)}
        </span>
        <span className="dim">{done}/{active}</span>
      </div>
      <ul>
        {items.map((t, i) => (
          <li key={i} className={t.status}>
            <span className="todo-card__mark" aria-hidden="true">
              {t.status === "completed" ? "✓" : t.status === "cancelled" ? "×" : t.status === "in_progress" ? (live ? <span className="spin" /> : "•") : "○"}
            </span>
            {t.content}
          </li>
        ))}
      </ul>
    </div>
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
  const { code, readOnly } = useView();
  const files = useQuery(api.files.tree, { workspaceId, code });
  const save = useMutation(api.files.save);
  const [drag, setDrag] = useState(false);
  const [upErr, setUpErr] = useState("");
  const upload = async (list: FileList | null) => {
    setUpErr("");
    for (const f of Array.from(list ?? [])) {
      // Text files only: the workspace mirror stores text, and the agent reads text.
      if (f.size > 400_000) { setUpErr(`${f.name} is over 400 KB`); continue; }
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf.includes(0)) { setUpErr(`${f.name} looks binary; only text files for now`); continue; }
      const name = (f.webkitRelativePath || f.name).replace(/[^\w.\-/ ]/g, "_");
      try {
        await save({ workspaceId, path: name, content: new TextDecoder().decode(buf) });
      } catch (e) {
        setUpErr(`${f.name}: ${(e as Error).message}`);
      }
    }
  };
  const sorted = [...(files ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <div className={`tree ${drag ? "tree--drop" : ""}`}
      onDragOver={(e) => { if (readOnly) return; e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
      <div className="tree-head">
        <strong>Files</strong>
        {!readOnly && <span>
        <label className="ghost upload-btn" title="Upload text files (or drop them here)">
          ↑ upload
          <input type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
        <button
          className="ghost"
          onClick={() => {
            const p = prompt("New file path (e.g. notes.md)");
            if (p) save({ workspaceId, path: p, content: "" }).then(() => onOpen(p));
          }}
        >
          + file
        </button>
        </span>}
      </div>
      {upErr && <p className="err tree__err">{upErr}</p>}
      {sorted.length === 0 && <p className="dim">Empty. Drop files here, or let the agent write some.</p>}
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
  const { code, readOnly } = useView();
  const file = useQuery(api.files.get, { workspaceId, path, code });
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
        {readOnly ? (
          <span className="viewing-pill">Read only</span>
        ) : (
          <button
            disabled={!dirty}
            onClick={async () => {
              await save({ workspaceId, path, content: draft! });
              setDraft(null);
            }}
          >
            {dirty ? "Save" : "Saved"}
          </button>
        )}
      </div>
      <textarea
        className="code"
        spellCheck={false}
        readOnly={readOnly}
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
