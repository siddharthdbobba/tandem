// Two real headless browsers in one workspace: checks presence, live file
// editing across users, and prompting through the actual UI.
// Run: UI_URL=https://your-ui CONVEX_URL=https://backend node tests/multiplayer-ui.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { anyApi as api } from "convex/server";
import { account, stamp } from "./helpers.mjs";

const UI = process.env.UI_URL ?? "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function browser(name, port) {
  const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), `tandem-${name}-`));
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

const id = stamp();
const creds = { alice: [`alice-${id}@test.dev`, "alice-pass-123"], bob: [`bob-${id}@test.dev`, "bob-pass-123"] };
const alice = await account(...creds.alice, "alice");
const bob = await account(...creds.bob, "bob");
const carol = await account(`carol-${id}@test.dev`, "carol-pass-123", "carol");
const wsId = await alice.mutation(api.workspaces.create, { name: "multiplayer-ui" });
const { inviteCode } = await alice.query(api.workspaces.get, { id: wsId });
await carol.mutation(api.workspaces.join, { inviteCode });
await alice.mutation(api.files.save, { workspaceId: wsId, path: "shared.md", content: "v1" });

// Real sign-in through the UI form, then open the invite link.
async function signInUI(b, [email, password]) {
  await b.send("Page.navigate", { url: `${UI}/` });
  await until(async () => (await b.js("!!document.querySelector('input[name=email]')")), 15000, "sign-in form");
  await b.js(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('input[name=email]', ${JSON.stringify(email)}); set('input[name=password]', ${JSON.stringify(password)});
    document.querySelector('form.stack').requestSubmit(); return true; })()`);
  await until(async () => (await b.js("document.body.innerText.includes('Your workspaces')")), 20000, "signed in");
  await b.send("Page.navigate", { url: `${UI}/#/join/${inviteCode}` });
}
const A = await browser("alice", 9341);
const B = await browser("bob", 9342);
try {
  await signInUI(A, creds.alice);
  await signInUI(B, creds.bob);
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
    const f = await alice.query(api.files.get, { workspaceId: wsId, path: "shared.md" });
    assert.equal(f.updatedBy, "alice");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("bob's unsaved draft is not clobbered by alice's save", async () => {
    const open = (b) => b.js("[...document.querySelectorAll('.file')].find(f=>f.textContent.startsWith('shared.md')).click(), true");
    await open(A); await open(B);
    await sleep(1000);
    await B.js(typeInto("document.querySelector('textarea.code')", "bob draft"));
    await carol.mutation(api.files.save, { workspaceId: wsId, path: "shared.md", content: "v3 from api" });
    await sleep(2000);
    assert.equal(await B.js("document.querySelector('textarea.code').value"), "bob draft");
    assert.equal(await A.js("document.querySelector('textarea.code').value"), "v3 from api");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("prompt typed in alice's UI streams into bob's UI, tagged with alice's subscription", async () => {
    await until(async () => (await A.js("!!document.querySelector('.prompt-box textarea')")), 10000, "pane");
    await A.js(typeInto("document.querySelector('.prompt-box textarea')", "Reply with exactly: hello-from-ui"));
    await A.js("document.querySelector('.prompt-box').requestSubmit(), true");
    await until(async () => (await B.js("document.querySelector('.feed').innerText")).includes("hello-from-ui"), 15000, "bob sees prompt");
    await until(async () => (await B.js("document.querySelector('.feed').innerText")).includes("alice's claude"), 30000, "bob sees billing tag");
    await until(async () => (await A.js("document.querySelector('.feed').innerText")).includes("your claude"), 5000, "alice sees 'your'");
    // No subscription connected in this test: both see the clear explanation.
    await until(async () => /subscription isn't connected/.test(await B.js("document.querySelector('.feed').innerText")), 60000, "bob sees error");
    assert.match(await A.js("document.body.innerText"), /Connect your AI subscription/);
  });

  await test("new pane added by bob appears for alice", async () => {
    const before = await A.js("document.querySelectorAll('.pane').length");
    await B.js("document.querySelector('.add-pane').click(), true");
    await until(async () => (await A.js("document.querySelectorAll('.pane').length")) === before + 1, 10000, "alice sees pane");
  });

  await test("sign-up page asks for an invite, rejects a bad one, prefills from a workspace link", async () => {
    const C = await browser("carl", 9343);
    try {
      await C.send("Page.navigate", { url: `${UI}/` });
      await until(async () => (await C.js("!!document.querySelector('form.stack')")), 15000, "form");
      await C.js("[...document.querySelectorAll('button.ghost')].find(b=>b.textContent.includes('Create an account')).click(), true");
      await until(async () => (await C.js("!!document.querySelector('input[name=invite]')")), 5000, "invite field");
      await C.js(`(() => {
        const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        set('input[name=name]', 'Carl'); set('input[name=invite]', 'notarealcode'); set('input[name=email]', 'carl-${id}@test.dev'); set('input[name=password]', 'carl-pass-123');
        document.querySelector('form.stack').requestSubmit(); return true; })()`);
      await until(async () => /invite code isn't valid/.test(await C.js("document.body.innerText")), 15000, "invite error");
      // Workspace invite link: sign-up opens with the code filled in.
      await C.send("Page.navigate", { url: `${UI}/#/join/${inviteCode}` });
      await sleep(500);
      await C.send("Page.reload");
      await until(async () => (await C.js("document.querySelector('input[name=invite]')?.value")) === inviteCode, 15000, "prefilled invite");
    } finally {
      C.ws.close(); C.proc.kill("SIGTERM");
    }
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
