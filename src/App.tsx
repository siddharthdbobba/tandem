import { renderMarkdown, tidyPaths } from "./markdown";
import { PeakMark } from "./art";
import { RunChanges } from "./Changes";
// The editor (CodeMirror) is big; load it only when a file is opened.
const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));
import { ViewCtx, goJoin, useView } from "./view";
import { SidePanel } from "./SidePanel";
import { Tour } from "./Tour";
import { Away } from "./Away";
import { Shortcuts } from "./Shortcuts";
import { PublicPage } from "./Publish";
import Privacy from "./Privacy";
import { Palette, type Command } from "./Palette";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import Landing from "./Landing";

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#8e4ec6", "#d6409f"];
const PROVIDERS = [
  { id: "claude", label: "Claude", plans: "Pro or Max" },
  { id: "openai", label: "ChatGPT", plans: "Plus or Pro" },
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

export default function App() {
  // Published pages are public and identical for everyone, signed in or not.
  const route = useRoute();
  if (route.kind === "p" && route.arg) return <PublicPage code={route.arg} />;
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
  if (route.kind === "privacy") return <Privacy />;
  if (route.kind === "signin") return <SignIn initial="signIn" />;
  if (route.kind === "signup") return <SignIn initial="signUp" />;
  return <Landing />;
}

function SignIn({ initial }: { initial: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFlow(initial); }, [initial]);
  const joinCode = sessionStorage.getItem("tandem-join");
  const joining = !!joinCode;
  const invite = useQuery(api.workspaces.peek, joinCode ? { code: joinCode } : "skip");
  const methods = useQuery(api.authInfo.methods);
  return (
    <div className="auth">
      <a href="#/" className="brand auth__brand"><PeakMark />Tandem</a>
      <div className="auth__card">
      <h1 className="auth__title">{flow === "signIn" ? "Sign in" : "Create your account"}</h1>
      <p className="auth__sub">
        {invite
          ? `${invite.owner ? `${invite.owner} invited you to` : "You're joining"} “${invite.name}”. ${flow === "signIn" ? "Sign in" : "Create a free account"} and you're in.`
          : joining
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
  if (route.kind === "privacy") return <Privacy />;
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
      <button className="ghost topright__signout" onClick={() => signOut()}>Sign out</button>
    </div>
  );
}

function AppBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bar">
      <a href="#/" className="brand"><PeakMark />Tandem</a>
      {children}
      <TopRight />
    </header>
  );
}

// A finished run's low-level steps (commands, file writes, page visits) fold into one
// "Edited 2 files, ran 3 commands" line so the AI's actual answer stands out. While
// the run is live everything stays visible so people can watch it work.
type Ev = { _id: string; kind: string; text: string };
const STEP_KINDS = new Set(["command", "file", "browse", "tool"]);
function groupSteps<E extends Ev>(events: E[], live: boolean): (E | { steps: E[] })[] {
  if (live) return events;
  const out: (E | { steps: E[] })[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (!STEP_KINDS.has(e.kind)) out.push(e);
    else if (last && "steps" in last) last.steps.push(e);
    else out.push({ steps: [e] });
  }
  // A lone step isn't worth a fold.
  return out.flatMap((x) => ("steps" in x && x.steps.length < 2 ? x.steps : [x]));
}
function stepSummary(steps: Ev[]) {
  const files = steps.filter((s) => s.kind === "file").length;
  const pages = steps.filter((s) => s.kind === "browse").length;
  const other = steps.length - files - pages;
  const parts = [
    files && `${files === 1 ? "edited a file" : `edited ${files} files`}`,
    pages && `${pages === 1 ? "visited a page" : `${pages} browser steps`}`,
    other && `${other === 1 ? "ran a command" : `ran ${other} commands`}`,
  ].filter(Boolean);
  return parts.join(", ").replace(/^./, (c) => c.toUpperCase());
}

// "5m ago", "3h ago", "2d ago".
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

const TEMPLATE_ICON: Record<string, string> = { trip: "🏔️", school: "📚", app: "🛠️", study: "🧠", party: "🎉", side: "🚀", blank: "⛺" };

function Home() {
  const workspaces = useQuery(api.workspaces.list);
  const templates = useQuery(api.workspaces.templates);
  const create = useMutation(api.workspaces.create);
  const me = useQuery(api.profile.me);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const connected = me?.connections.some((c) => c.status === "connected");
  const first = me?.profile?.name.split(" ")[0];
  const start = async (template: string, n: string) => {
    if (!n.trim()) return;
    setBusy(true);
    try {
      const id = await create({ name: n.trim(), template });
      location.hash = `/w/${id}`;
    } finally {
      setBusy(false);
    }
  };
  const tpl = templates?.find((t) => t.id === picked);
  return (
    <div className="page">
      <AppBar />
      <main className="home">
        <div className="home__head">
          <h1 className="home__title">{first ? `Hey ${first}.` : "Welcome."} What are you working on?</h1>
          <p className="home__sub">Every workspace has shared files, an AI that can browse and build, and a link to bring friends in.</p>
        </div>

        {me && !connected && (
          <a href="#/settings" className="setup-nudge">
            <span className="setup-nudge__step">1</span>
            <span><b>Connect Claude or ChatGPT</b><span className="dim"> so the AI can work for you. Takes about 30 seconds and uses the plan you already pay for.</span></span>
            <span className="setup-nudge__go" aria-hidden="true">→</span>
          </a>
        )}

        <section aria-labelledby="start-h" className="start">
          <h2 id="start-h" className="section-label">Start something</h2>
          <div className="tpl-grid">
            {templates?.map((t) => (
              <button key={t.id} type="button" className={`tpl ${picked === t.id ? "on" : ""}`}
                onClick={() => { setPicked(t.id); setName(t.id === "blank" ? "" : t.name.replace(/^Plan a /, "Our ").replace(/^Build an app$/, "Our app").replace(/^School \/ group project$/, "Group project").replace(/^Study group$/, "Study group").replace(/^Plan an event$/, "Our event").replace(/^Side project$/, "Our side project")); }}>
                <span className="tpl__icon" aria-hidden="true">{TEMPLATE_ICON[t.id] ?? t.emoji}</span>
                <span className="tpl__name">{t.name}</span>
                <span className="tpl__blurb">{t.blurb}</span>
              </button>
            ))}
          </div>
          {tpl && (
            <form className="newws" onSubmit={(e) => { e.preventDefault(); start(tpl.id, name); }}>
              <label className="sr-only" htmlFor="newws">Workspace name</label>
              <input id="newws" autoFocus placeholder="Name it, e.g. Yosemite weekend" value={name}
                onChange={(e) => setName(e.target.value)} maxLength={60} />
              <button className="btn btn--primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create workspace"}
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="mine-h">
          <h2 id="mine-h" className="section-label">Your workspaces</h2>
          {workspaces === undefined ? (
            <p className="dim">Loading…</p>
          ) : workspaces.length === 0 ? (
            <div className="empty">
              <p className="empty__title">No workspaces yet</p>
              <p className="dim">Pick a starting point above, or open a link a friend sent you.</p>
            </div>
          ) : (
            <ul className="wslist">
              {workspaces.map((w) => (
                <li key={w._id}>
                  <a href={`#/w/${w._id}`} className="wslist__row">
                    <span className="wslist__icon" aria-hidden="true">{w.emoji ?? TEMPLATE_ICON[w.template ?? "blank"] ?? "⛺"}</span>
                    <span className="wslist__text">
                      <span className="wslist__name">{w.name}</span>
                      {w.activity && <span className="wslist__activity">{w.activity.text} · {ago(w.activity.at)}</span>}
                    </span>
                    <span className="wslist__meta">
                      {w.people > 1 ? `${w.people} people` : "just you"}{w.owner === me?.profile?.name ? "" : ` · ${w.owner}'s`}
                    </span>
                    <span className="wslist__go" aria-hidden="true">→</span>
                  </a>
                  <RowMenu w={w} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

// "⋯" on a Home row: rename, copy invite link, leave (members) or delete (owner).
function RowMenu({ w }: { w: { _id: Id<"workspaces">; name: string; mine: boolean; inviteCode: string } }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const rename = useMutation(api.workspaces.rename);
  const leave = useMutation(api.workspaces.leave);
  const remove = useMutation(api.workspaces.remove);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const act = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    try { await fn(); } catch (e) { setNote(String((e as Error).message).split("\n")[0].replace(/^.*Error: /, "")); }
  };
  return (
    <div className="rowmenu" ref={ref}>
      <button className="ghost rowmenu__btn" aria-label={`Options for ${w.name}`} aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="rowmenu__list" role="menu">
          <button className="ghost" role="menuitem" onClick={() => act(async () => {
            const name = prompt("Rename workspace", w.name)?.trim();
            if (name && name !== w.name) await rename({ workspaceId: w._id, name });
          })}>Rename</button>
          <button className="ghost" role="menuitem" onClick={() => act(async () => {
            await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/join/${w.inviteCode}`);
            setNote("Link copied"); setTimeout(() => setNote(""), 1500);
          })}>Copy invite link</button>
          {w.mine ? (
            <button className="ghost rowmenu__danger" role="menuitem" onClick={() => act(async () => {
              if (confirm(`Delete "${w.name}" for everyone? Files and chat are removed.`)) await remove({ workspaceId: w._id });
            })}>Delete…</button>
          ) : (
            <button className="ghost rowmenu__danger" role="menuitem" onClick={() => act(async () => {
              if (confirm(`Leave "${w.name}"? You can rejoin with the invite link.`)) await leave({ workspaceId: w._id });
            })}>Leave</button>
          )}
        </div>
      )}
      {note && <span className="rowmenu__note" role="status">{note}</span>}
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
  const { signOut } = useAuthActions();
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
          <h3>Your AI</h3>
          {me.connections.some((c) => c.status === "connected") && !flow && (
            <p className="ok-banner">✓ You're connected. <a className="textlink" href="#/">Back to your workspaces →</a></p>
          )}
          <p className="dim">
            Connect the Claude or ChatGPT plan you already pay for. Your prompts run on it, from a private
            sandbox only your account can read. Friends' prompts never use your plan. <a className="textlink" href="#/privacy">How this works</a>
          </p>
          {PROVIDERS.map((pr) => {
            const st = status(pr.id);
            return (
              <div key={pr.id} className="provider">
                <label className="radio">
                  <input type="radio" name="provider" checked={p.provider === pr.id}
                    onChange={() => update({ provider: pr.id, model: null }).then(() => flash("Default saved"))} />
                  <span className="provider-name">{pr.label}<small>{pr.plans}</small></span>
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
              .map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
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
          <h3>Account</h3>
          <button className="btn btn--sm" onClick={() => signOut()}>Sign out</button>
        </section>
        {saved && <p className="ok" role="status">{saved}</p>}
      </main>
    </div>
  );
}

// Signed out with a share link: a welcome card first, then the live read-only view.
function Viewer({ code }: { code: string }) {
  const ws = useQuery(api.workspaces.peek, { code });
  const [peeking, setPeeking] = useState(() => sessionStorage.getItem(`tandem-peek-${code}`) === "1");
  if (ws === undefined) return <div className="loading"><span className="spin" aria-hidden="true" /> Loading…</div>;
  if (ws === null) return <div className="loading">This link is invalid. <a href="#/" className="textlink">Go home</a></div>;
  if (!peeking) {
    return (
      <div className="invite">
        <a href="#/" className="brand invite__brand"><PeakMark />Tandem</a>
        <div className="invite__card">
          <div className="invite__icon" aria-hidden="true">{ws.emoji ?? TEMPLATE_ICON[ws.template ?? "blank"] ?? "⛺"}</div>
          <p className="eyebrow">{ws.owner ? `${ws.owner} invited you to` : "You're invited to"}</p>
          <h1>{ws.name}</h1>
          {ws.people.length > 0 && (
            <div className="invite__people">
              <span className="invite__avatars">
                {ws.people.slice(0, 6).map((p, i) => <span key={i} className="avatar avatar--sm" style={{ background: p.color }}>{p.name[0]?.toUpperCase()}</span>)}
              </span>
              <span>{ws.people.length === 1 ? `${ws.people[0].name} is here` : `${ws.people.slice(0, 2).map((p) => p.name).join(", ")}${ws.people.length > 2 ? ` and ${ws.people.length - 2} more` : ""} are here`}</span>
            </div>
          )}
          <p className="invite__lede">A shared space for your group's files, chat, and an AI that plans, writes and builds while everyone watches.</p>
          <button className="btn btn--primary btn--lg" onClick={() => goJoin(code)}>Join with a free account</button>
          <a href="#/signin" className="textlink" onClick={() => sessionStorage.setItem("tandem-join", code)}>I already have an account</a>
          <button className="ghost invite__peek" onClick={() => { sessionStorage.setItem(`tandem-peek-${code}`, "1"); setPeeking(true); }}>Just look around first →</button>
        </div>
      </div>
    );
  }
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
  const busy = useQuery(api.workspaces.busy, { workspaceId: id, code });
  const addPane = useMutation(api.workspaces.addPane);
  const heartbeat = useMutation(api.presence.heartbeat);
  const [now, setNow] = useState(Date.now());
  const people = useQuery(api.presence.list, { workspaceId: id, now: Math.floor(now / 10000) * 10000, code });
  const [focusPane, setFocusPane] = useState<Id<"panes"> | undefined>();
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [tourShowing, setTourShowing] = useState(() => !localStorage.getItem("tandem-tour-done"));
  const [copied, setCopied] = useState(false);
  // Right panel: team chat or workspace settings. Remembered per device.
  const [panel, setPanel] = useState<"chat" | "settings" | null>(() => (localStorage.getItem("tandem-panel") as "chat" | "settings" | null) ?? null);
  useEffect(() => { if (panel) localStorage.setItem("tandem-panel", panel); else localStorage.removeItem("tandem-panel"); }, [panel]);
  const togglePanel = (t: "chat" | "settings") => setPanel((p) => (p === t ? null : t));
  // Unread chat: messages since you last had the chat open.
  const msgs = useQuery(api.chat.list, { workspaceId: id, code });
  const seenKey = `tandem-seen-${id}`;
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(seenKey) ?? 0));
  const lastAt = msgs?.at(-1)?.at ?? 0;
  useEffect(() => {
    if (panel === "chat" && lastAt > seen) { setSeen(lastAt); localStorage.setItem(seenKey, String(lastAt)); }
  }, [panel, lastAt, seen, seenKey]);
  const unread = msgs?.filter((m) => m.at > seen && m.userId !== me?.userId).length ?? 0;

  // Tab title shows activity; a desktop notification fires when the AI finishes while you're away.
  const lastDone = useQuery(api.workspaces.lastFinished, { workspaceId: id, code });
  const firstDone = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastDone === undefined) return;
    const key = lastDone?._id ?? null;
    if (firstDone.current === undefined) { firstDone.current = key; return; } // ignore what was already done
    if (!lastDone || key === firstDone.current) return;
    firstDone.current = key;
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      new Notification(lastDone.status === "done" ? "The AI finished" : "The AI hit a problem", {
        body: `${ws?.name ?? "Tandem"}: ${lastDone.prompt}`,
        tag: `tandem-${id}`,
      });
    }
  }, [lastDone, id, ws?.name]);
  useEffect(() => {
    const base = ws?.name ? `${ws.name} · Tandem` : "Tandem";
    document.title = busy ? `● ${base}` : unread ? `(${unread}) ${base}` : base;
    return () => { document.title = "Tandem"; };
  }, [busy, unread, ws?.name]);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("tandem-sidebar") !== "0");
  const toggleSidebar = () => {
    setSidebar((s) => {
      localStorage.setItem("tandem-sidebar", s ? "0" : "1");
      return !s;
    });
  };
  // Cmd/Ctrl+B toggles the file sidebar; Cmd/Ctrl+K opens the command palette.
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelp((h) => !h);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
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
  const tree = useQuery(api.files.tree, { workspaceId: id, code });
  const shareLink = ws?.inviteCode ? `${location.origin}${location.pathname}#/join/${ws.inviteCode}` : "";
  const commands: Command[] = [
    ...(readOnly ? [] : [
      { id: "pane", group: "Workspace", label: "New prompt pane", run: () => addPane({ workspaceId: id, title: `Agent ${(panes?.length ?? 0) + 1}` }) },
      { id: "share", group: "Workspace", label: "Copy share link", run: () => navigator.clipboard.writeText(shareLink) },
    ]),
    { id: "chat", group: "Workspace", label: "Open team chat", run: () => setPanel("chat") },
    { id: "settings", group: "Workspace", label: "Workspace settings (name, AI instructions, people)", run: () => setPanel("settings") },
    { id: "files", group: "Workspace", label: "Toggle file sidebar", hint: "⌘B", run: toggleSidebar },
    { id: "help", group: "Workspace", label: "Keyboard shortcuts", hint: "?", run: () => setHelp(true) },
    ...(readOnly ? [] : [{ id: "models", group: "Account", label: "Connect Claude or ChatGPT / default model", run: () => { location.hash = "/settings"; } }]),
    { id: "home", group: "Account", label: "All workspaces", run: () => { location.hash = "/"; } },
    ...(tree ?? []).map((f) => ({ id: `f:${f.path}`, group: "Files", label: f.path, run: () => setOpenFile(f.path) })),
  ];

  return (
    <div className={`layout ${sidebar ? "" : "layout--nosidebar"} ${panel ? "layout--panel" : ""}`}>
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
        {ws && <span className="ws-emoji" aria-hidden="true">{ws.emoji ?? TEMPLATE_ICON[ws.template ?? "blank"] ?? "⛺"}</span>}
        <span className="ws-name">{ws?.name}</span>
        {readOnly ? (
          <span className="viewing-pill">View only</span>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={async () => {
            const url = `${location.origin}${location.pathname}#/join/${ws?.inviteCode}`;
            // Phones/tablets: open the system share sheet (Messages, WhatsApp...). Desktop: copy.
            if (navigator.share && matchMedia("(pointer: coarse)").matches) {
              try { await navigator.share({ title: `Join ${ws?.name} on Tandem`, text: `Join "${ws?.name}" on Tandem`, url }); return; }
              catch (e) { if ((e as Error).name === "AbortError") return; /* share failed: copy instead */ }
            }
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>
            {copied ? "Link copied" : <><span className="hide-sm">Copy share link</span><span className="show-sm">Share</span></>}
          </button>
        )}
        <div className="people" aria-label="People here now">
          {people?.map((p) => (
            <span key={p._id} className="avatar avatar--sm" style={{ background: p.color }} title={p.name}>
              {p.name[0]?.toUpperCase()}
            </span>
          ))}
        </div>
        <button className={`panel-toggle ${panel ? "on" : ""}`} aria-pressed={!!panel}
          onClick={() => togglePanel("chat")} title="Team chat">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          Chat{unread > 0 && panel !== "chat" ? <span className="side__badge">{unread}</span> : null}
        </button>
        <button className="panel-toggle icon" aria-label="Workspace settings" title="Workspace settings"
          onClick={() => togglePanel("settings")}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </AppBar>
      {sidebar && (
        <aside>
          <FileTree workspaceId={id} open={openFile} onOpen={setOpenFile} />
        </aside>
      )}
      <main>
        {openFile ? (
          <Suspense fallback={<div className="loading"><span className="spin" aria-hidden="true" /> Opening…</div>}>
            <Editor key={openFile} workspaceId={id} path={openFile} onClose={() => setOpenFile(null)} />
          </Suspense>
        ) : (
          <>
            {!readOnly && <Tour onDone={() => setTourShowing(false)} />}
            <Away key={id} workspaceId={id} readOnly={readOnly} tourShowing={tourShowing}
              onOpenFile={setOpenFile} onOpenChat={() => setPanel("chat")} />
            <BrowserView workspaceId={id} live={!!busy} />
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
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      {panel && (
        <SidePanel workspaceId={id} tab={panel} setTab={(t) => setPanel(t)} onClose={() => setPanel(null)} unread={unread} />
      )}
    </div>
  );
}

type PaneDoc = { _id: Id<"panes">; title: string; workspaceId: Id<"workspaces"> };

// Live view of the agent's browser. Everyone in the workspace sees the same
// frames, including people watching through a share link.
function BrowserView({ workspaceId, live }: { workspaceId: Id<"workspaces">; live: boolean }) {
  const { code } = useView();
  const frame = useQuery(api.files.browserFrame, { workspaceId, code });
  const [open, setOpen] = useState(() => localStorage.getItem("tandem-browser") !== "0");
  const [big, setBig] = useState(false);
  if (!frame) return null;
  const fresh = live && Date.now() - frame.at < 60_000;
  const toggle = () => {
    localStorage.setItem("tandem-browser", open ? "0" : "1");
    setOpen(!open);
  };
  return (
    <section className={`browser ${open ? "" : "browser--closed"} ${big ? "browser--big" : ""}`} aria-label="Agent browser">
      <div className="browser__bar">
        <span className="browser__dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="browser__url" title={frame.url}>{frame.url || "about:blank"}</span>
        <span className={`browser__who ${fresh ? "live" : ""}`}>
          {fresh ? <><span className="browser__pulse" aria-hidden="true" />{frame.by}'s agent is browsing</> : <>Last browsed by {frame.by}'s agent</>}
        </span>
        {open && <button className="ghost" onClick={() => setBig(!big)} title={big ? "Smaller" : "Bigger"}>{big ? "–" : "⤢"}</button>}
        <button className="ghost" onClick={toggle} aria-expanded={open}>{open ? "Hide" : "Show browser"}</button>
      </div>
      {open && frame.image && (
        <a href={frame.image} target="_blank" rel="noreferrer" className="browser__frame" title={frame.title}>
          <img src={frame.image} alt={`Agent browser: ${frame.title || frame.url}`} />
        </a>
      )}
    </section>
  );
}

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
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [renaming, setRenaming] = useState(false);
  const renamePane = useMutation(api.workspaces.renamePane);
  const suggestions = useQuery(api.workspaces.suggestions, { workspaceId: pane.workspaceId, code });
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
        {renaming ? (
          <input className="pane-title-input" autoFocus defaultValue={pane.title} maxLength={40} aria-label="Pane name"
            onBlur={(e) => { const t = e.target.value.trim(); setRenaming(false); if (t && t !== pane.title) renamePane({ paneId: pane._id, title: t }); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = pane.title; e.currentTarget.blur(); } }} />
        ) : (
          <strong className="pane-title" title={readOnly ? undefined : "Double-click to rename"} onDoubleClick={() => !readOnly && setRenaming(true)}>{pane.title}</strong>
        )}
        <span className="viewers">
          {viewers.map((v) => (
            <span key={v.userId} className="dot" style={{ background: v.color }} title={`${v.name} is here`} />
          ))}
        </span>
        {canClose && (
          <button className="ghost x" onClick={() => remove({ paneId: pane._id })} title="Close pane" aria-label="Close pane">
            ×
          </button>
        )}
      </div>
      <div className="feed" aria-live="polite" aria-relevant="additions">
        {feed?.length === 0 && (
          <div className="pane-empty">
            <p className="pane-empty__title">Ask the AI to get started</p>
            <p className="dim">Everyone here sees it work live{readOnly ? "" : ", and can jump in"}.</p>
            {!readOnly && me && connected.size === 0 && (
              <div className="pane-empty__connect">
                <span>First, connect Claude or ChatGPT so the AI runs on your own plan. It takes about 30 seconds.</span>
                <a className="btn btn--primary btn--sm" href="#/settings">Connect</a>
              </div>
            )}
            {!readOnly && suggestions && (
              <div className="chips">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => { setText(s); textRef.current?.focus(); }}>{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
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
            {groupSteps(r.events, r.status === "running").map((e, i) =>
              "steps" in e ? (
                <details key={`g${i}`} className="steps-group">
                  <summary>{stepSummary(e.steps)}</summary>
                  {e.steps.map((s) => <pre key={s._id} className={`ev ${s.kind}`}>{tidyPaths(s.text)}</pre>)}
                </details>
              ) : e.kind === "todo" ? (
                // Only the newest todo snapshot of a run is shown.
                [...r.events].reverse().find((x) => x.kind === "todo")?._id !== e._id ? null : <TodoCard key={e._id} text={e.text} live={r.status === "running"} />
              ) : e.kind === "message" ? (
                <div key={e._id} className="ev message md" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.text) }} />
              ) : e.kind === "error" && /subscription isn't connected/.test(e.text) ? (
                <div key={e._id} className="ev error ev-connect">
                  <span>{e.text.replace(/ Connect it in Settings, then send this again\.$/, "")}</span>
                  {r.userId === myId && !readOnly && (
                    <span className="ev-connect__actions">
                      <a className="btn btn--primary btn--sm" href="#/settings">Connect in Settings</a>
                      <button className="btn btn--ghost btn--sm" onClick={() => submit({ paneId: pane._id, prompt: r.prompt })}>Try again</button>
                    </span>
                  )}
                </div>
              ) : (
                <pre key={e._id} className={`ev ${e.kind}`}>
                  {tidyPaths(e.text)}
                </pre>
              ),
            )}
            {(r.status === "done" || r.status === "error" || r.status === "cancelled") && (
              <RunChanges runId={r._id} code={code} readOnly={readOnly} />
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
          // First prompt: ask once if we can ping you when the AI finishes.
          if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
          // Mid-run, Enter steers: stop the agent and redirect it. "Queue" waits instead.
          const queue = (e.nativeEvent as SubmitEvent).submitter?.dataset.queue === "1";
          if (live && !queue) steer({ runId: live._id, ...opts });
          else submit({ paneId: pane._id, ...opts });
          setText("");
        }}
      >
        <textarea
          ref={textRef}
          rows={2}
          value={text}
          placeholder={live ? "Redirect the AI (Enter), or queue a follow-up…" : running ? "Queue a follow-up…" : "Ask the AI anything: plan, research, write, build…"}
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

// A small glyph per file type so the tree is scannable.
const fileIcon = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt"].includes(ext)) return "📝";
  if (ext === "pdf") return "📕";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["html", "htm"].includes(ext)) return "🌐";
  if (["csv", "xlsx", "json"].includes(ext)) return "📊";
  if (["js", "ts", "tsx", "jsx", "py", "css", "mjs"].includes(ext)) return "⌨️";
  return "📄";
};

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
  const uploadUrl = useMutation(api.files.uploadUrl);
  const move = useMutation(api.files.move);
  const removeFile = useMutation(api.files.remove);
  const saveBinary = useMutation(api.files.saveBinary);
  const [drag, setDrag] = useState(false);
  const [upErr, setUpErr] = useState("");
  const [uploading, setUploading] = useState(0);
  const upload = async (list: FileList | null) => {
    setUpErr("");
    for (const f of Array.from(list ?? [])) {
      const name = (f.webkitRelativePath || f.name).replace(/[^\w.\-/ ]/g, "_");
      if (f.size > 20_000_000) { setUpErr(`${f.name} is over 20 MB`); continue; }
      setUploading((n) => n + 1);
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        // Small text files go in as editable text; everything else (PDFs, images...) as a binary.
        const looksText = f.size <= 400_000 && !buf.includes(0) && !/\.(pdf|png|jpe?g|gif|webp|ico|zip|mp[34]|wav|webm|woff2?|ttf|docx?|xlsx?|pptx?)$/i.test(name);
        if (looksText) {
          await save({ workspaceId, path: name, content: new TextDecoder().decode(buf) });
        } else {
          const res = await fetch(await uploadUrl({ workspaceId }), {
            method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f,
          });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const { storageId } = await res.json();
          await saveBinary({ workspaceId, path: name, blob: storageId });
        }
      } catch (e) {
        setUpErr(`${f.name}: ${(e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const all = [...(files ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const sorted = q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
  return (
    <div className={`tree ${drag ? "tree--drop" : ""}`}
      onDragOver={(e) => { if (readOnly) return; e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
      <div className="tree-head">
        <strong>Files</strong>
        {!readOnly && <span>
        <label className="ghost upload-btn" title="Upload files: code, PDFs, images (or drop them here)">
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
      {uploading > 0 && <p className="dim tree__err"><span className="spin" /> Uploading {uploading}…</p>}
      {all.length >= 8 && (
        <input className="tree__filter" type="search" value={filter} placeholder="Find a file" aria-label="Find a file"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && sorted[0]) onOpen(sorted[0].path);
            if (e.key === "Escape") setFilter("");
          }} />
      )}
      {all.length === 0 && <p className="dim">Empty. Drop files here, or let the agent write some.</p>}
      {all.length > 0 && sorted.length === 0 && <p className="dim tree__err">No files match “{filter}”.</p>}
      {sorted.map((f) => {
        const depth = f.path.split("/").length - 1;
        const name = f.path.split("/").pop()!;
        return (
          <div key={f._id} className={`file ${open === f.path ? "active" : ""}`} style={{ paddingLeft: 8 + depth * 12 }}
            role="button" tabIndex={0} onClick={() => onOpen(f.path)} title={`last change: ${f.updatedBy}`}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.currentTarget.click(); } }}>
            <span className="file__icon" aria-hidden="true">{fileIcon(name)}</span>
            <span className="file__name">{name}{depth > 0 && <span className="dim"> {f.path.split("/").slice(0, -1).join("/")}/</span>}</span>
            {!readOnly && (
              <span className="file__actions" onClick={(e) => e.stopPropagation()}>
                <button className="ghost" title="Rename" aria-label={`Rename ${name}`} onClick={async () => {
                  const to = prompt("Rename to", f.path)?.trim();
                  if (!to || to === f.path) return;
                  try { await move({ workspaceId, from: f.path, to }); if (open === f.path) onOpen(to); }
                  catch (e) { setUpErr(String((e as Error).message).split("\n")[0].replace(/^.*Error: /, "")); }
                }}>✎</button>
                <button className="ghost" title="Delete" aria-label={`Delete ${name}`} onClick={async () => {
                  if (!confirm(`Delete ${f.path} for everyone?`)) return;
                  await removeFile({ workspaceId, path: f.path });
                }}>🗑</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
