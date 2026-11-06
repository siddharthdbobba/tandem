// Replays real captured `jcode run --ndjson` output through the worker's
// translator and checks what panes would show. No network needed.
// Run: node tests/translator.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { AUTH_ERR, translator } from "../worker/events.mjs";

const load = (f) =>
  fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));

function replay(file, dir = "/ws") {
  const tr = translator(dir);
  const out = [];
  let touched = 0;
  for (const ev of load(file)) {
    out.push(...tr.feed(ev));
    if (tr.takeTouched()) touched++;
  }
  out.push(...tr.end());
  return { out, tr, touched };
}

const results = [];
const test = (name, fn) => {
  try { fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
};

test("multi-tool run: edit, write, bash ok, bash fail, final text, in order", () => {
  const { out, tr, touched } = replay("jcode-tools.jsonl");
  const kinds = out.map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k !== "message"), ["file", "file", "command", "command"]);
  assert.equal(out.find((e) => e.kind === "file").text, "edit notes.txt");
  assert.equal(out.filter((e) => e.kind === "file")[1].text, "write sub/new.py");
  const [ok, bad] = out.filter((e) => e.kind === "command");
  assert.match(ok.text, /^\$ python3 sub\/new\.py\n42$/);
  assert.doesNotMatch(ok.text, /Command finished/); // success footer trimmed
  assert.match(bad.text, /^\$ cat missing-file\.txt\n/);
  assert.match(bad.text, /exit code: 1/); // failures keep the exit code
  assert.equal(out.at(-1).kind, "message"); // final summary last
  assert.ok(out.at(-1).text.length > 0);
  assert.match(tr.sessionId, /^session_/);
  assert.equal(tr.failed, null);
  assert.equal(touched, 4);
});

test("simple run: absolute paths become workspace-relative, text not split per delta", () => {
  const { out, tr } = replay("jcode-simple.jsonl");
  assert.equal(out.find((e) => e.kind === "file").text, "write hi.txt");
  assert.match(out.find((e) => e.kind === "command").text, /^\$ cat hi\.txt\nhi$/);
  const msgs = out.filter((e) => e.kind === "message");
  assert.equal(msgs.length, 1); // 3 text_delta chunks -> one message
  assert.match(msgs[0].text, /printed `hi`/);
  assert.ok(tr.sessionId);
});

test("no-auth run: error surfaced once and recognised as an auth problem", () => {
  const { out, tr } = replay("jcode-noauth.jsonl");
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "error");
  assert.ok(AUTH_ERR.test(tr.failed));
  assert.ok(tr.sessionId);
});

test("interleaved tool inputs are attributed by id", () => {
  const tr = translator("/ws");
  tr.feed({ type: "tool_start", id: "a", name: "bash" });
  tr.feed({ type: "tool_start", id: "b", name: "write" });
  tr.feed({ type: "tool_input", id: "a", delta: '{"command":"ls"}' });
  tr.feed({ type: "tool_input", id: "b", delta: '{"file_path":"/ws/x.txt"}' });
  const b = tr.feed({ type: "tool_done", id: "b", name: "write", output: "ok", error: null });
  const a = tr.feed({ type: "tool_done", id: "a", name: "bash", output: "x\n", error: null });
  assert.equal(b[0].text, "write x.txt");
  assert.match(a[0].text, /^\$ ls\n/);
});

test("tool error becomes an error event, unknown events ignored", () => {
  const tr = translator("/ws");
  assert.deepEqual(tr.feed({ type: "connection_phase", phase: "x" }), []);
  tr.feed({ type: "tool_start", id: "e", name: "edit" });
  tr.feed({ type: "tool_input", id: "e", delta: '{"file_path":"a.txt"}' });
  const r = tr.feed({ type: "tool_done", id: "e", name: "edit", output: null, error: "old_string not found" });
  assert.equal(r[0].kind, "error");
  assert.match(r[0].text, /^edit a\.txt\nerror: old_string not found/);
});

test("huge bash output is clipped", () => {
  const tr = translator("/ws");
  tr.feed({ type: "tool_start", id: "h", name: "bash" });
  tr.feed({ type: "tool_input", id: "h", delta: '{"command":"yes"}' });
  const r = tr.feed({ type: "tool_done", id: "h", name: "bash", output: "y\n".repeat(50_000), error: null });
  assert.ok(r[0].text.length < 4200);
  assert.match(r[0].text, /more chars\)$/);
});

test("AUTH_ERR does not fire on ordinary failures", () => {
  assert.ok(!AUTH_ERR.test("cat: missing.txt: No such file or directory"));
  assert.ok(!AUTH_ERR.test("compiled 4013 modules"));
  assert.ok(AUTH_ERR.test("HTTP 401 Unauthorized"));
});

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
