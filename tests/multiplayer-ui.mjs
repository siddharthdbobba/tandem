// Two real headless browsers in one workspace: checks presence, live file
// editing across users, and prompting through the actual UI.
// Run: UI_URL=https://your-ui CONVEX_URL=https://backend node tests/multiplayer-ui.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";

const UI = process.env.UI_URL ?? "http://127.0.0.1:5173";
const c = new ConvexHttpClient(process.env.CONVEX_URL ?? "http://127.0.0.1:3310");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function browser(name, port) {
  const profile = path.resolve(`tests/.chrome-${name}`);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run"], { stdio: "ignore" });
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
    if (!page) await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++seq;
    const on = ({ data }) => { const m = JSON.parse(data); if (m.id === n) { ws.removeEventListener("message", on); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const js = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__errs=[];addEventListener('error',e=>__errs.push(e.message));" });
  return { proc, ws, send, js, name };
}

// Sets a React-controlled textarea's value so onChange fires.
const typeInto = (selector, text) => `(() => {
  const el = ${selector};
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

async function until(fn, ms = 20000, label = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(500); }
  throw new Error(`timeout: ${label}`);
}

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); } };

const wsId = await c.mutation(api.workspaces.create, { name: "multiplayer-ui", user: "alice" });
await c.mutation(api.files.save, { workspaceId: wsId, path: "shared.md", content: "v1", user: "alice" });
const A = await browser("alice", 9341);
const B = await browser("bob", 9342);
try {
  await A.send("Page.navigate", { url: `${UI}/?name=alice#${wsId}` });
  await B.send("Page.navigate", { url: `${UI}/?name=bob#${wsId}` });
  await sleep(5000);

  await test("both users see each other in presence", async () => {
    await until(async () => (await A.js("[...document.querySelectorAll('.people .avatar')].map(a=>a.title).sort().join(',')")) === "alice,bob", 25000, "presence");
    assert.equal(await B.js("[...document.querySelectorAll('.people .avatar')].map(a=>a.title).sort().join(',')"), "alice,bob");
  });

  await test("file edit by alice shows live in bob's open editor", async () => {
    const open = (b) => b.js("[...document.querySelectorAll('.file')].find(f=>f.textContent.startsWith('shared.md')).click(), true");
    await until(async () => (await B.js("!!document.querySelector('.file')")), 10000, "tree");
    await open(A); await open(B);
    await until(async () => (await B.js("document.querySelector('textarea.code')?.value")) === "v1", 10000, "bob sees v1");
    await A.js(typeInto("document.querySelector('textarea.code')", "v2 from alice"));
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent==='Save').click(), true");
    await until(async () => (await B.js("document.querySelector('textarea.code')?.value")) === "v2 from alice", 10000, "bob sees v2");
    const f = await c.query(api.files.get, { workspaceId: wsId, path: "shared.md" });
    assert.equal(f.updatedBy, "alice");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("bob's unsaved draft is not clobbered by alice's save", async () => {
    const open = (b) => b.js("[...document.querySelectorAll('.file')].find(f=>f.textContent.startsWith('shared.md')).click(), true");
    await open(A); await open(B);
    await sleep(1000);
    await B.js(typeInto("document.querySelector('textarea.code')", "bob draft"));
    await c.mutation(api.files.save, { workspaceId: wsId, path: "shared.md", content: "v3 from api", user: "carol" });
    await sleep(2000);
    assert.equal(await B.js("document.querySelector('textarea.code').value"), "bob draft");
    assert.equal(await A.js("document.querySelector('textarea.code').value"), "v3 from api");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("prompt typed in alice's UI streams into bob's UI", async () => {
    await until(async () => (await A.js("!!document.querySelector('.prompt-box textarea')")), 10000, "pane");
    await A.js(typeInto("document.querySelector('.prompt-box textarea')", "Reply with exactly: hello-from-ui"));
    await A.js("document.querySelector('.prompt-box').requestSubmit(), true");
    await until(async () => (await B.js("document.querySelector('.feed').innerText")).includes("hello-from-ui"), 90000, "bob sees output");
    assert.match(await B.js("document.querySelector('.feed').innerText"), /alice/);
  });

  await test("new pane added by bob appears for alice", async () => {
    const before = await A.js("document.querySelectorAll('.pane').length");
    await B.js("document.querySelector('.add-pane').click(), true");
    await until(async () => (await A.js("document.querySelectorAll('.pane').length")) === before + 1, 10000, "alice sees pane");
  });

  await test("no page errors in either browser", async () => {
    assert.deepEqual(await A.js("window.__errs"), []);
    assert.deepEqual(await B.js("window.__errs"), []);
  });
} finally {
  for (const b of [A, B]) { b.ws.close(); b.proc.kill("SIGTERM"); }
}
console.log(results.join("\n"));
console.log("workspace", wsId);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
