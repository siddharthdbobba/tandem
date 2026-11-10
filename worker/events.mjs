// Turns Jcode `run --ndjson` events into Tandem pane events. Pure, so it can be
// tested by replaying real captured runs (tests/fixtures/*.jsonl).
import path from "node:path";

export const clip = (t, n = 4000) =>
  t.length > n ? t.slice(0, n) + `\n... (${t.length - n} more chars)` : t;

const FILE_TOOLS = new Set(["write", "edit", "apply_patch", "multiedit"]);

// Returns a stateful translator. Call feed(ev) per parsed line; it returns an
// array of { kind, text } to emit plus flags. Call end() when the process exits.
export function translator(dir) {
  let sessionId = null;
  let text = "";
  let failed = null;
  let touchedFiles = false;
  const tools = new Map(); // id -> { name, input }
  let lastToolId = null; // jcode sends tool_input without an id; it belongs to the latest tool_start

  const flush = (out) => {
    if (text.trim()) out.push({ kind: "message", text: text.trim() });
    text = "";
  };
  const rel = (p) => (p ? (path.isAbsolute(p) ? path.relative(dir, p) || p : p) : "");

  function feed(ev) {
    const out = [];
    switch (ev.type) {
      case "start":
        sessionId = ev.session_id ?? sessionId;
        break;
      case "text_delta":
        text += ev.text ?? "";
        break;
      case "tool_start":
        flush(out);
        tools.set(ev.id, { name: ev.name, input: "" });
        lastToolId = ev.id;
        break;
      case "tool_input": {
        const t = tools.get(ev.id ?? lastToolId);
        if (t) t.input += ev.delta ?? "";
        break;
      }
      case "tool_done": {
        const t = tools.get(ev.id) ?? { name: ev.name, input: "" };
        let input = {};
        try {
          input = JSON.parse(t.input || "{}");
        } catch {}
        const outText = ev.error ? `error: ${ev.error}` : (ev.output ?? "");
        if (t.name === "todo") {
          // Output is the full current list. Keep just what the card needs.
          try {
            const list = JSON.parse(outText);
            if (Array.isArray(list))
              out.push({ kind: "todo", text: JSON.stringify(list.map((x) => ({ content: String(x.content ?? ""), status: String(x.status ?? "pending") }))) });
          } catch {}
          tools.delete(ev.id);
          break;
        }
        if (t.name === "bash") {
          out.push({ kind: "command", text: `$ ${input.command ?? ""}\n${clip(outText.replace(/\n*--- Command finished with exit code: 0 ---\n*$/, "\n"))}`.trimEnd() });
        } else if (FILE_TOOLS.has(t.name)) {
          out.push({ kind: ev.error ? "error" : "file", text: `${t.name} ${rel(input.file_path)}`.trim() + (ev.error ? `\n${clip(outText, 800)}` : "") });
        } else {
          out.push({ kind: "command", text: `${t.name}${input.file_path ? " " + rel(input.file_path) : ""}${ev.error ? "\n" + clip(outText, 800) : ""}` });
        }
        if (t.name !== "read") touchedFiles = true;
        tools.delete(ev.id);
        break;
      }
      case "message_end":
        flush(out);
        break;
      case "done":
        flush(out);
        sessionId = ev.session_id ?? sessionId;
        break;
      case "error":
        flush(out);
        failed = ev.message ?? JSON.stringify(ev);
        out.push({ kind: "error", text: failed });
        break;
    }
    return out;
  }

  function end() {
    const out = [];
    flush(out);
    return out;
  }

  return {
    feed,
    end,
    get sessionId() { return sessionId; },
    get failed() { return failed; },
    takeTouched() { const t = touchedFiles; touchedFiles = false; return t; },
  };
}

export const AUTH_ERR = /no usable provider|not configured|re-authenticate|unauthori[sz]ed|invalid.*token|\b401\b/i;
