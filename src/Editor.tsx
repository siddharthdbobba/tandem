import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { renderMarkdown } from "./markdown";
import { useView } from "./view";

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

function languageFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) return javascript({ jsx: ["jsx", "tsx"].includes(ext), typescript: ["ts", "tsx"].includes(ext) });
  if (["html", "htm"].includes(ext)) return html();
  if (ext === "css") return css();
  if (["md", "markdown"].includes(ext)) return markdown();
  if (ext === "py") return python();
  if (ext === "json") return json();
  return [];
}

const remoteUpdate = Annotation.define<boolean>();

function CodeEditor({ content, path, readOnly, onChange, onSave }: {
  content: string;
  path: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const language = useRef(new Compartment());
  const editing = useRef(new Compartment());
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), history(), indentOnInput(), bracketMatching(), highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle),
        language.current.of(languageFor(path)),
        editing.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        keymap.of([...historyKeymap, indentWithTab, { key: "Mod-s", run: () => { onSaveRef.current(); return true; } }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(remoteUpdate))) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => view.current?.destroy();
  }, []);

  useEffect(() => { view.current?.dispatch({ effects: language.current.reconfigure(languageFor(path)) }); }, [path]);
  useEffect(() => { view.current?.dispatch({ effects: editing.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) }); }, [readOnly]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === content) return;
    const cursor = editor.state.selection.main;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
      selection: { anchor: Math.min(cursor.anchor, content.length), head: Math.min(cursor.head, content.length) },
      annotations: remoteUpdate.of(true),
    });
  }, [content]);

  return <div className="code cm-wrap" ref={host} />;
}

type Asset = { path: string; type: "style" | "script" };

function attr(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "i").exec(tag);
  return match?.[2] ?? match?.[3];
}

function resolveAssetPath(pagePath: string, href: string) {
  const clean = href.split(/[?#]/, 1)[0];
  if (!clean || /^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith("/")) return null;
  const parts = pagePath.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/");
}

function assetsIn(htmlSource: string, pagePath: string) {
  const assets = new Map<string, Asset>();
  const collect = (tag: string, type: Asset["type"]) => {
    const href = attr(tag, type === "style" ? "href" : "src");
    const resolved = href && resolveAssetPath(pagePath, href);
    if (resolved) assets.set(`${type}:${resolved}`, { path: resolved, type });
  };
  for (const tag of htmlSource.match(/<link\b[^>]*>/gi) ?? []) if (/\brel\s*=\s*(["'])?stylesheet\1/i.test(tag)) collect(tag, "style");
  for (const tag of htmlSource.match(/<script\b[^>]*\bsrc\s*=/gi) ?? []) collect(tag, "script");
  return [...assets.values()].slice(0, 12);
}

function AssetFile({ workspaceId, code, asset, onLoaded }: {
  workspaceId: Id<"workspaces">;
  code: string | undefined;
  asset: Asset;
  onLoaded: (asset: Asset, content: string | null) => void;
}) {
  const file = useQuery(api.files.get, { workspaceId, path: asset.path, code });
  useEffect(() => { if (file !== undefined) onLoaded(asset, file?.blob ? null : file?.content ?? null); }, [asset, file, onLoaded]);
  return null;
}

function HtmlPreview({ workspaceId, code, path, content }: {
  workspaceId: Id<"workspaces">;
  code: string | undefined;
  path: string;
  content: string;
}) {
  const assets = useMemo(() => assetsIn(content, path), [content, path]);
  const [loaded, setLoaded] = useState<Map<string, string>>(new Map());
  const [refresh, setRefresh] = useState(0);
  const assetKey = (asset: Asset) => `${asset.type}:${asset.path}`;
  useEffect(() => {
    const valid = new Set(assets.map(assetKey));
    setLoaded((current) => new Map([...current].filter(([key]) => valid.has(key))));
  }, [assets]);
  const onLoaded = useCallback((asset: Asset, assetContent: string | null) => {
    const key = assetKey(asset);
    setLoaded((current) => {
      const next = new Map(current);
      if (assetContent === null) next.delete(key); else next.set(key, assetContent);
      return next;
    });
  }, []);
  const srcDoc = useMemo(() => {
    const inline = (tag: string, type: Asset["type"]) => {
      const href = attr(tag, type === "style" ? "href" : "src");
      const resolved = href && resolveAssetPath(path, href);
      const assetContent = resolved && loaded.get(`${type}:${resolved}`);
      if (typeof assetContent !== "string") return tag;
      const escaped = assetContent.replace(new RegExp(`</${type}`, "gi"), `<\\/${type}`);
      return type === "style" ? `<style>${escaped}</style>` : `<script>${escaped}</script>`;
    };
    return content
      .replace(/<link\b[^>]*>/gi, (tag) => /\brel\s*=\s*(["'])?stylesheet\1/i.test(tag) ? inline(tag, "style") : tag)
      .replace(/<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?<\/script>/gi, (tag) => inline(tag, "script"));
  }, [content, loaded, path]);
  const openPreview = () => {
    const url = URL.createObjectURL(new Blob([srcDoc], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return <>
    {assets.map((asset) => <AssetFile key={assetKey(asset)} workspaceId={workspaceId} code={code} asset={asset} onLoaded={onLoaded} />)}
    <div className="preview-tools">
      <button className="ghost" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      <button className="ghost" onClick={openPreview}>Open in new tab</button>
    </div>
    <iframe key={refresh} className="viewer viewer--frame" title={path} sandbox="allow-scripts allow-forms allow-modals" srcDoc={srcDoc} />
  </>;
}

export function Editor({ workspaceId, path, onClose }: { workspaceId: Id<"workspaces">; path: string; onClose: () => void }) {
  const { code, readOnly } = useView();
  const file = useQuery(api.files.get, { workspaceId, path, code });
  const save = useMutation(api.files.save);
  const [draft, setDraft] = useState<string | null>(null);
  const kind = kindOf(path, !!file?.blob);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const dirty = draft !== null && draft !== file?.content;
  const value = draft ?? file?.content ?? "";
  const previewable = kind === "markdown" || kind === "html";
  const showSource = !file?.blob && (!previewable || mode === "source");
  const saveDraft = useCallback(async () => {
    if (draft === null || draft === file?.content) return;
    await save({ workspaceId, path, content: draft });
    setDraft(null);
  }, [draft, file?.content, path, save, workspaceId]);

  return <div className="editor">
    <div className="pane-head">
      <button className="ghost" onClick={onClose}>← panes</button>
      <strong>{path}</strong>
      <span className="dim">last change by {file?.updatedBy ?? "?"}</span>
      {file?.pendingWrite && <span className="dim">· syncing to disk</span>}
      {previewable && <div className="seg" role="tablist" aria-label="View">
        <button role="tab" aria-selected={mode === "preview"} className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>Preview</button>
        <button role="tab" aria-selected={mode === "source"} className={mode === "source" ? "on" : ""} onClick={() => setMode("source")}>Source</button>
      </div>}
      {file?.url && <a className="textlink" href={file.url} target="_blank" rel="noreferrer" download={path.split("/").pop()}>Download</a>}
      {showSource && (readOnly ? <span className="viewing-pill">Read only</span> : <button disabled={!dirty} onClick={saveDraft}>{dirty ? "Save" : "Saved"}</button>)}
    </div>
    {file === undefined ? <div className="viewer"><span className="spin" /></div>
      : file === null ? <div className="viewer dim">This file was removed.</div>
      : showSource ? <CodeEditor content={value} path={path} readOnly={readOnly} onChange={setDraft} onSave={saveDraft} />
      : kind === "markdown" ? <div className="viewer viewer--doc"><article className="md doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /></div>
      : kind === "html" ? <HtmlPreview workspaceId={workspaceId} code={code} path={path} content={value} />
      : kind === "pdf" && file.url ? <iframe className="viewer viewer--frame" title={path} src={file.url} />
      : kind === "image" && file.url ? <div className="viewer viewer--media"><img src={file.url} alt={path} /></div>
      : kind === "video" && file.url ? <div className="viewer viewer--media"><video src={file.url} controls /></div>
      : kind === "audio" && file.url ? <div className="viewer viewer--media"><audio src={file.url} controls /></div>
      : <div className="viewer dim">No preview for this file type ({Math.round((file.size ?? 0) / 1024)} KB). {file.url && <a className="textlink" href={file.url} target="_blank" rel="noreferrer">Download it</a>}</div>}
  </div>;
}
