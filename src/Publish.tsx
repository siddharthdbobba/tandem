import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { PeakMark, RidgeDivider } from "./art";
import { renderMarkdown } from "./markdown";

// Public read-only page for one published file: #/p/<code>.
export function PublicPage({ code }: { code: string }) {
  const page = useQuery(api.publish.view, { code });
  if (page === undefined) return <div className="loading"><span className="spin" aria-hidden="true" /> Loading…</div>;
  if (page === null) return <div className="loading">This page isn't published anymore. <a href="#/" className="textlink">Go to Tandem</a></div>;
  const ext = page.path.split(".").pop()?.toLowerCase();
  document.title = `${page.path.split("/").pop()} · ${page.workspace}`;
  return (
    <div className="pub">
      <header className="pub__bar">
        <span className="pub__where">{page.workspace} <span className="dim">/ {page.path}</span></span>
        <a href="#/" className="brand pub__brand"><PeakMark />Made with Tandem</a>
      </header>
      <main className="pub__body">
        {page.url && page.mime?.startsWith("image/") ? (
          <img src={page.url} alt={page.path} className="pub__img" />
        ) : page.url ? (
          <p><a className="textlink" href={page.url} target="_blank" rel="noreferrer">Download {page.path.split("/").pop()}</a></p>
        ) : ext === "md" || ext === "markdown" || ext === "txt" ? (
          <article className="md doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.content) }} />
        ) : ext === "html" || ext === "htm" ? (
          <iframe className="pub__frame" title={page.path} sandbox="allow-scripts allow-forms allow-modals" srcDoc={page.content} />
        ) : (
          <pre className="pub__code">{page.content}</pre>
        )}
      </main>
      <footer className="pub__foot">
        <RidgeDivider />
        <p className="dim">Shared by {page.by}. Last edited by {page.updatedBy}. <a className="textlink" href="#/signup">Plan your own with Tandem →</a></p>
      </footer>
    </div>
  );
}

// "Publish" control in the editor header.
export function PublishButton({ workspaceId, path, code, readOnly }: { workspaceId: Id<"workspaces">; path: string; code?: string; readOnly: boolean }) {
  const st = useQuery(api.publish.status, { workspaceId, path, code });
  const publish = useMutation(api.publish.publish);
  const unpublish = useMutation(api.publish.unpublish);
  const [copied, setCopied] = useState(false);
  if (st === undefined || (readOnly && !st)) return null;
  const url = (c: string) => `${location.origin}${location.pathname}#/p/${c}`;
  const copy = (c: string) => { navigator.clipboard.writeText(url(c)); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  if (!st) {
    return (
      <button className="btn btn--ghost btn--sm" title="Make a clean public page anyone can open"
        onClick={async () => copy(await publish({ workspaceId, path }))}>Publish</button>
    );
  }
  return (
    <span className="pub-ctl">
      <a className="textlink" href={url(st.code)} target="_blank" rel="noreferrer">Public page ↗</a>
      <button className="btn btn--ghost btn--sm" onClick={() => copy(st.code)}>{copied ? "Copied" : "Copy link"}</button>
      {!readOnly && <button className="ghost" onClick={() => unpublish({ workspaceId, path })} title="Stop sharing this page">Unpublish</button>}
    </span>
  );
}
