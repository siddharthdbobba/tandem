import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { renderMarkdown } from "./markdown";
import { useView } from "./view";

// What kind of viewer a file gets.
const kindOf = (path: string, binary: boolean) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  return binary ? "binary" : "text";
};

export function Editor({
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
  const kind = kindOf(path, !!file?.blob);
  // Markdown and HTML open as a preview; the source is one click away.
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const dirty = draft !== null && draft !== file?.content;
  // If someone else changes the file while you have no local edits, you see it live.
  const value = draft ?? file?.content ?? "";
  const previewable = kind === "markdown" || kind === "html";
  const showSource = !file?.blob && (!previewable || mode === "source");

  return (
    <div className="editor">
      <div className="pane-head">
        <button className="ghost" onClick={onClose}>
          ← panes
        </button>
        <strong>{path}</strong>
        <span className="dim">last change by {file?.updatedBy ?? "?"}</span>
        {file?.pendingWrite && <span className="dim">· syncing to disk</span>}
        {previewable && (
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={mode === "preview"} className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>Preview</button>
            <button role="tab" aria-selected={mode === "source"} className={mode === "source" ? "on" : ""} onClick={() => setMode("source")}>Source</button>
          </div>
        )}
        {file?.url && <a className="textlink" href={file.url} target="_blank" rel="noreferrer" download={path.split("/").pop()}>Download</a>}
        {showSource && (readOnly ? (
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
        ))}
      </div>
      {file === undefined ? (
        <div className="viewer"><span className="spin" /></div>
      ) : file === null ? (
        <div className="viewer dim">This file was removed.</div>
      ) : showSource ? (
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
      ) : kind === "markdown" ? (
        <div className="viewer viewer--doc"><article className="md doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /></div>
      ) : kind === "html" ? (
        // Sandboxed: scripts run but can't reach Tandem's origin, cookies or storage.
        <iframe className="viewer viewer--frame" title={path} sandbox="allow-scripts allow-forms allow-modals" srcDoc={value} />
      ) : kind === "pdf" && file.url ? (
        <iframe className="viewer viewer--frame" title={path} src={file.url} />
      ) : kind === "image" && file.url ? (
        <div className="viewer viewer--media"><img src={file.url} alt={path} /></div>
      ) : kind === "video" && file.url ? (
        <div className="viewer viewer--media"><video src={file.url} controls /></div>
      ) : kind === "audio" && file.url ? (
        <div className="viewer viewer--media"><audio src={file.url} controls /></div>
      ) : (
        <div className="viewer dim">
          No preview for this file type ({Math.round((file.size ?? 0) / 1024)} KB).{" "}
          {file.url && <a className="textlink" href={file.url} target="_blank" rel="noreferrer">Download it</a>}
        </div>
      )}
    </div>
  );
}
