import { useMutation, useQuery } from "convex/react";
import { diffLines } from "diff";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// "What changed" under a finished agent run: file list, a diff per file, and undo.
export function RunChanges({ runId, code, readOnly }: { runId: Id<"runs">; code?: string; readOnly: boolean }) {
  const changes = useQuery(api.changes.forRun, { runId, code });
  const revertRun = useMutation(api.changes.revertRun);
  const [open, setOpen] = useState<Id<"changes"> | null>(null);
  const [busy, setBusy] = useState(false);
  if (!changes?.length) return null;
  const live = changes.filter((c) => !c.reverted);
  const undoable = live.filter((c) => !c.binary);
  return (
    <div className="changes">
      <div className="changes__head">
        <span className="changes__title">Changed {changes.length} file{changes.length === 1 ? "" : "s"}</span>
        {!readOnly && undoable.length > 0 && (
          <button className="ghost changes__undo-all" disabled={busy}
            onClick={async () => {
              if (!confirm(`Undo the AI's changes to ${undoable.length} file${undoable.length === 1 ? "" : "s"}?`)) return;
              setBusy(true);
              try { await revertRun({ runId }); } finally { setBusy(false); }
            }}>
            Undo all
          </button>
        )}
      </div>
      <ul className="changes__list">
        {changes.map((c) => (
          <li key={c._id}>
            <button type="button" className={`changes__file ${c.reverted ? "reverted" : ""}`} aria-expanded={open === c._id}
              onClick={() => setOpen(open === c._id ? null : c._id)}>
              <span className={`changes__kind ${c.kind}`}>{c.kind === "added" ? "+" : c.kind === "deleted" ? "−" : "~"}</span>
              <span className="changes__path">{c.path}</span>
              {c.reverted && <span className="changes__tag">undone</span>}
              {c.binary && <span className="changes__tag">binary</span>}
            </button>
            {open === c._id && <Diff changeId={c._id} code={code} readOnly={readOnly} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Diff({ changeId, code, readOnly }: { changeId: Id<"changes">; code?: string; readOnly: boolean }) {
  const d = useQuery(api.changes.diff, { changeId, code });
  const revert = useMutation(api.changes.revert);
  const [err, setErr] = useState("");
  if (!d) return <div className="diff dim">Loading…</div>;
  if (d.binary) return <div className="diff dim">Binary file ({d.kind}). Open it from the file list to view.</div>;
  const parts = diffLines(d.before, d.after);
  // Show changed lines plus 2 lines of context, collapsing long unchanged runs.
  const rows: { t: "add" | "del" | "ctx" | "gap"; s: string }[] = [];
  parts.forEach((p, i) => {
    const lines = p.value.replace(/\n$/, "").split("\n");
    if (p.added) lines.forEach((s) => rows.push({ t: "add", s }));
    else if (p.removed) lines.forEach((s) => rows.push({ t: "del", s }));
    else if (lines.length <= 5 || (i === 0 && parts.length === 1)) lines.forEach((s) => rows.push({ t: "ctx", s }));
    else {
      if (i > 0) lines.slice(0, 2).forEach((s) => rows.push({ t: "ctx", s }));
      rows.push({ t: "gap", s: `${lines.length - (i > 0 ? 2 : 0) - (i < parts.length - 1 ? 2 : 0)} unchanged lines` });
      if (i < parts.length - 1) lines.slice(-2).forEach((s) => rows.push({ t: "ctx", s }));
    }
  });
  return (
    <div className="diff">
      <pre className="diff__body">
        {rows.slice(0, 600).map((r, i) => (
          <div key={i} className={`diff__row ${r.t}`}>
            <span className="diff__sign" aria-hidden="true">{r.t === "add" ? "+" : r.t === "del" ? "−" : r.t === "gap" ? "⋯" : " "}</span>
            {r.s || " "}
          </div>
        ))}
      </pre>
      {!readOnly && !d.reverted && (
        <div className="diff__actions">
          <button className="ghost" onClick={() => revert({ changeId }).catch((e) => setErr(String(e.message).split("\n")[0]))}>
            Undo this file
          </button>
          {err && <span className="err">{err}</span>}
        </div>
      )}
    </div>
  );
}
