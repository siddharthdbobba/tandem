// Two real headless browsers in one workspace: checks presence, live file
// editing across users, and prompting through the actual UI.
// Run: UI_URL=https://your-ui CONVEX_URL=https://backend node tests/multiplayer-ui.mjs
import assert from "node:assert/strict";
import { spawn, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { anyApi as api } from "convex/server";
import { account, stamp } from "./helpers.mjs";

const UI = process.env.UI_URL ?? "http://127.0.0.1:5173";
// Shell on the VM that hosts the workspaces (to check bytes landed on disk).
const VM = process.env.WORKER_HOST ?? "localhost";
const sh = async (cmd) => (await promisify(execFileCb)("ssh", [VM, cmd], { timeout: 30_000 })).stdout.trim();
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
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__errs=[];addEventListener('error',e=>__errs.push(e.message+' @ '+String(e.error&&e.error.stack||'').slice(0,300)));" });
  return { proc, ws, send, js, name };
}

// Sets a React-controlled textarea's value so onChange fires.
// CodeMirror helpers: read the doc text, and replace it like a user typing.
const cmText = "(() => { const c = document.querySelector('.cm-content'); return c ? [...c.querySelectorAll('.cm-line')].map(l => l.textContent).join('\\n') : null; })()";
const cmType = (text) => `(() => { const c = document.querySelector('.cm-content'); c.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, ${JSON.stringify(text)}); return true; })()`;
const cmReadOnly = "document.querySelector('.cm-content')?.getAttribute('contenteditable') === 'false'";
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
await alice.mutation(api.files.save, { workspaceId: wsId, path: "shared.txt", content: "v1" });
await alice.mutation(api.files.save, { workspaceId: wsId, path: "notes.md", content: "" });

// Real sign-in through the UI form, then open the invite link.
async function signInUI(b, [email, password]) {
  await b.send("Page.navigate", { url: `${UI}/#/signin` });
  await until(async () => (await b.js("!!document.querySelector('input[name=email]')")), 15000, "sign-in form");
  await b.js(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('input[name=email]', ${JSON.stringify(email)}); set('input[name=password]', ${JSON.stringify(password)});
    document.querySelector('form.stack').requestSubmit(); return true; })()`);
  await until(async () => (await b.js("document.body.innerText.toLowerCase().includes('your workspaces')")), 20000, "signed in");
  await b.send("Page.navigate", { url: `${UI}/#/join/${inviteCode}` });
}
const A = await browser("alice", 9341);
const B = await browser("bob", 9342);
try {
  await signInUI(A, creds.alice);
  await signInUI(B, creds.bob);
  await sleep(5000);

  await test("first-run tour shows, steps through, and stays dismissed", async () => {
    await until(async () => (await A.js("!!document.querySelector('.tour')")), 10000, "tour");
    for (const label of ["Next", "Next", "Got it"]) {
      await A.js(`[...document.querySelectorAll('.tour button')].find(b=>b.textContent==='${label}').click(), true`);
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(await A.js("!!document.querySelector('.tour')"), false);
    assert.equal(await A.js("localStorage.getItem('tandem-tour-done')"), "1");
    await B.js("localStorage.setItem('tandem-tour-done','1'), true");
  });

  await test("both users see each other in presence", async () => {
    await until(async () => (await A.js("[...document.querySelectorAll('.people .avatar')].map(a=>a.title).sort().join(',')")) === "alice,bob", 25000, "presence");
    assert.equal(await B.js("[...document.querySelectorAll('.people .avatar')].map(a=>a.title).sort().join(',')"), "alice,bob");
  });

  await test("pasting a Google Doc into a .md file becomes markdown", async () => {
    await until(async () => (await A.js("[...document.querySelectorAll('.file__name')].some(f=>f.textContent.startsWith('notes.md'))")), 15000, "notes.md in tree");
    await A.js("[...document.querySelectorAll('.file')].find(f=>f.querySelector('.file__name').textContent.startsWith('notes.md')).click(), true");
    await until(async () => (await A.js("!!document.querySelector('.cm-content')")), 10000, "editor");
    await A.js(`(() => { const c = document.querySelector('.cm-content'); c.focus();
      const dt = new DataTransfer();
      dt.setData('text/html', '<b style="font-weight:normal"><h2><span>Packing</span></h2><ul><li><p><span style="font-weight:700">Tent</span></p></li><li><p><a href="https://rei.com">Stove</a></p></li></ul></b>');
      dt.setData('text/plain', 'Packing Tent Stove');
      c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
    await until(async () => (await A.js(cmText)).includes("## Packing"), 5000, "converted");
    assert.equal((await A.js(cmText)).trim(), "## Packing\n\n- **Tent**\n- [Stove](https://rei.com)");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("file edit by alice shows live in bob's open editor", async () => {
    const open = (b) => b.js("[...document.querySelectorAll('.file')].find(f=>f.querySelector('.file__name').textContent.startsWith('shared.txt')).click(), true");
    await until(async () => (await B.js("!!document.querySelector('.file')")), 10000, "tree");
    await open(A); await open(B);
    await until(async () => (await B.js(cmText)) === "v1", 10000, "bob sees v1");
    await until(async () => (await A.js(cmText)) === "v1", 10000, "alice sees v1");
    await A.js(cmType("v2 from alice"));
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent==='Save').click(), true");
    await until(async () => (await B.js(cmText)) === "v2 from alice", 10000, "bob sees v2");
    const f = await alice.query(api.files.get, { workspaceId: wsId, path: "shared.txt" });
    assert.equal(f.updatedBy, "alice");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("bob's unsaved draft is not clobbered by alice's save", async () => {
    const open = (b) => b.js("[...document.querySelectorAll('.file')].find(f=>f.querySelector('.file__name').textContent.startsWith('shared.txt')).click(), true");
    await open(A); await open(B);
    await sleep(1000);
    await B.js(cmType("bob draft"));
    await carol.mutation(api.files.save, { workspaceId: wsId, path: "shared.txt", content: "v3 from api" });
    await sleep(2000);
    assert.equal(await B.js(cmText), "bob draft");
    assert.equal(await A.js(cmText), "v3 from api");
    await A.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
  });

  await test("prompt typed in alice's UI streams into bob's UI, tagged with alice's subscription", async () => {
    await until(async () => (await A.js("!!document.querySelector('.prompt-box textarea')")), 10000, "pane");
    await A.js(typeInto("document.querySelector('.prompt-box textarea')", "Reply with exactly: hello-from-ui"));
    await A.js("document.querySelector('.prompt-box').requestSubmit(), true");
    await until(async () => (await B.js("document.querySelector('.feed').innerText")).includes("hello-from-ui"), 15000, "bob sees prompt");
    await until(async () => /alice's claude/i.test(await B.js("document.querySelector('.feed').innerText")), 30000, "bob sees billing tag");
    await until(async () => /your claude/i.test(await A.js("document.querySelector('.feed').innerText")), 5000, "alice sees 'your'");
    // No subscription connected in this test: both see the clear explanation.
    await until(async () => /subscription isn't connected/.test(await B.js("document.querySelector('.feed').innerText")), 60000, "bob sees error");
    assert.match(await A.js("document.body.innerText"), /Connect your AI subscription/i);
    await until(async () => await A.js("!!document.querySelector('.ev-connect a[href=\"#/settings\"]')"), 5000, "connect button for prompter");
    assert.equal(await B.js("!!document.querySelector('.ev-connect a[href=\"#/settings\"]')"), false, "not shown to others");
  });

  await test("new pane added by bob appears for alice", async () => {
    const before = await A.js("document.querySelectorAll('.pane').length");
    await B.js("document.querySelector('.add-pane').click(), true");
    await until(async () => (await A.js("document.querySelectorAll('.pane').length")) === before + 1, 10000, "alice sees pane");
  });

  await test("share link: signed-out viewer sees live, read-only; sign-up makes them a member", async () => {
    const C = await browser("carl", 9343);
    try {
      await C.send("Page.navigate", { url: `${UI}/` });
      await until(async () => /shared AI workspace/.test(await C.js("document.body.innerText")), 15000, "landing");
      assert.ok(await C.js("!!document.querySelector('a[href=\"#/signup\"]')"), "landing has a sign-up CTA");
      // Share link, signed out: the workspace is visible live but read-only.
      await C.send("Page.navigate", { url: `${UI}/#/join/${inviteCode}` });
      await until(async () => (await C.js("document.querySelector('.ws-name')?.textContent")) === "multiplayer-ui", 15000, "viewer sees workspace");
      await until(async () => /hello-from-ui/.test(await C.js("document.querySelector('.feed')?.innerText ?? ''")), 10000, "viewer sees others' prompts");
      await until(async () => /shared\.txt/.test(await C.js("document.querySelector('.tree').innerText")), 10000, "viewer sees files");
      assert.equal(await C.js("!!document.querySelector('.prompt-box textarea')"), false, "no prompt box");
      assert.equal(await C.js("!!document.querySelector('.add-pane')"), false, "no add pane");
      assert.equal(await C.js("!!document.querySelector('.upload-btn')"), false, "no upload");
      assert.equal(await C.js("document.querySelector('.viewing-pill')?.textContent"), "View only");
      // Opening a file is read-only too.
      await C.js("[...document.querySelectorAll('.file')].find(f=>f.querySelector('.file__name').textContent.startsWith('shared.txt')).click(), true");
      await until(async () => await C.js(cmReadOnly), 10000, "read-only editor");
      await C.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
      // Sign up from the viewer, then land in the workspace as a member.
      await C.js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign up to join').click(), true");
      await until(async () => await C.js("!!document.querySelector('input[name=name]')"), 15000, "sign-up form");
      assert.match(await C.js("document.body.innerText"), /invited to a workspace/);
      await C.js(`(() => {
        const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        set('input[name=name]', 'Carl'); set('input[name=email]', 'carl-${id}@test.dev'); set('input[name=password]', 'carl-pass-123');
        document.querySelector('form.stack').requestSubmit(); return true; })()`);
      await until(async () => (await C.js("location.hash")) === `#/w/${wsId}`, 20000, "lands in workspace");
      await until(async () => (await C.js("document.querySelector('.ws-name')?.textContent")) === "multiplayer-ui", 10000, "workspace name");
      await until(async () => await C.js("!!document.querySelector('.prompt-box textarea')"), 10000, "member can prompt");
    } finally {
      C.ws.close(); C.proc.kill("SIGTERM");
    }
  });

  await test("uploads: text stays editable; a PNG and a PDF go to storage, reach disk, and open in viewers", async () => {
    // A real 1x1 PNG and a minimal valid PDF.
    await A.js(`(() => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      const pdf = '%PDF-1.1\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';
      const input = document.querySelector('.upload-btn input[type=file]');
      const dt = new DataTransfer();
      dt.items.add(new File(['uploaded by alice\\n'], 'upload-${id}.txt', { type: 'text/plain' }));
      dt.items.add(new File([png], 'pic-${id}.png', { type: 'image/png' }));
      dt.items.add(new File([pdf], 'doc-${id}.pdf', { type: 'application/pdf' }));
      dt.items.add(new File(['# Hello\\n\\n- one\\n- **two**\\n<script>window.__pwned=1</script>'], 'readme-${id}.md', { type: 'text/markdown' }));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    for (const n of [`upload-${id}.txt`, `pic-${id}.png`, `doc-${id}.pdf`, `readme-${id}.md`])
      await until(async () => (await B.js("document.querySelector('.tree').innerText")).includes(n), 20000, `bob sees ${n}`);
    assert.equal((await bob.query(api.files.get, { workspaceId: wsId, path: `upload-${id}.txt` })).content, "uploaded by alice\n");
    const png = await bob.query(api.files.get, { workspaceId: wsId, path: `pic-${id}.png` });
    assert.ok(png.blob && png.url && png.mime === "image/png", JSON.stringify({ mime: png.mime, url: !!png.url }));
    // Worker writes the binary to the workspace disk with identical bytes.
    await until(async () => !(await bob.query(api.files.get, { workspaceId: wsId, path: `pic-${id}.png` })).pendingWrite, 20000, "png on disk");
    const disk = await sh(`sha256sum /srv/tandem/workspaces/${wsId}/pic-${id}.png | cut -c1-64`);
    assert.equal(disk, png.hash);
    // Bob opens each in the viewer.
    const open = (n) => B.js(`[...document.querySelectorAll('.file')].find(f=>f.querySelector('.file__name').textContent.startsWith('${n}')).click(), true`);
    const back = () => B.js("[...document.querySelectorAll('.editor button')].find(b=>b.textContent.includes('panes')).click(), true");
    await open(`pic-${id}.png`);
    await until(async () => await B.js("(() => { const i = document.querySelector('.viewer--media img'); return !!i && i.complete && i.naturalWidth === 1; })()"), 15000, "image renders");
    await back();
    await open(`doc-${id}.pdf`);
    await until(async () => await B.js("!!document.querySelector('iframe.viewer--frame[src]')"), 15000, "pdf viewer");
    await back();
    await open(`readme-${id}.md`);
    await until(async () => await B.js("document.querySelector('.viewer--doc h1')?.textContent === 'Hello'"), 15000, "markdown preview");
    assert.equal(await B.js("!!document.querySelector('.viewer--doc strong')"), true);
    assert.equal(await B.js("!!document.querySelector('.viewer--doc script') || !!window.__pwned"), false, "markdown is sanitized");
    await B.js("[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='Source').click(), true");
    await until(async () => ((await B.js(cmText)) ?? "").startsWith("# Hello"), 5000, "source view");
    await back();
  });

  await test("pane model picker: friendly names, unconnected disabled, effort selectable", async () => {
    await A.js("document.querySelector('.picker__chip').click(), true");
    await until(async () => await A.js("!!document.querySelector('.picker__menu')"), 5000, "menu opens");
    const items = await A.js("[...document.querySelectorAll('.picker__item[data-model]')].map(b => b.dataset.model + '=' + b.textContent + (b.disabled ? '!' : ''))");
    assert.ok(items.includes("claude|claude-sonnet-5-5=Sonnet 5.5!"), items.join(","));
    assert.ok(items.includes("openai|gpt-6.1-sol=GPT-6.1 Sol!"), items.join(","));
    await A.js("[...document.querySelectorAll('.picker__effort-row button')].find(b => b.textContent === 'high').click(), true");
    await until(async () => (await A.js("document.querySelector('.picker__chip').textContent")).includes("high"), 3000, "chip shows effort");
    await A.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true");
    await until(async () => !(await A.js("!!document.querySelector('.picker__menu')")), 3000, "menu closes");
  });

  await test("team chat: alice's message appears live for bob with an unread badge; settings tab shows people", async () => {
    await A.js("[...document.querySelectorAll('.panel-toggle')].find(b=>b.textContent.includes('Chat')).click(), true");
    await until(async () => await A.js("!!document.querySelector('.chat__box textarea')"), 8000, "chat opens");
    // Bob keeps chat closed so he gets an unread badge.
    await B.js("localStorage.removeItem('tandem-panel'); true");
    await A.js(typeInto("document.querySelector('.chat__box textarea')", "who's bringing the stove?"));
    await A.js("document.querySelector('.chat__box').requestSubmit(), true");
    await until(async () => /who's bringing the stove/.test(await A.js("document.querySelector('.chat__log').innerText")), 8000, "alice sees own msg");
    await until(async () => (await B.js("document.querySelector('.panel-toggle .side__badge')?.textContent")) === "1", 15000, "bob unread badge");
    await B.js("[...document.querySelectorAll('.panel-toggle')].find(b=>b.textContent.includes('Chat')).click(), true");
    await until(async () => /who's bringing the stove/.test(await B.js("document.querySelector('.chat__log')?.innerText ?? ''")), 8000, "bob reads it");
    await until(async () => !(await B.js("!!document.querySelector('.panel-toggle .side__badge')")), 5000, "badge clears");
    await B.js("[...document.querySelectorAll('.side__tabs button')].find(b=>b.textContent==='Workspace').click(), true");
    await until(async () => /alice/.test(await B.js("document.querySelector('.members')?.innerText ?? ''")), 8000, "members list");
    await B.js("document.querySelector('.side__close').click(), true");
    await A.js("document.querySelector('.side__close').click(), true");
  });

  await test("download as .zip builds a real zip containing the workspace files", async () => {
    // Capture the blob the export creates instead of letting Chrome save it.
    await A.js(`(() => { window.__zip = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__zip = b; return orig(b); }; return true; })()`);
    await A.js("[...document.querySelectorAll('.panel-toggle')].find(b=>b.getAttribute('aria-label')==='Workspace settings').click(), true");
    await until(async () => await A.js("!!document.querySelector('.ws-settings')"), 8000, "settings open");
    await A.js("[...document.querySelectorAll('.ws-settings button')].find(b=>b.textContent.includes('.zip')).click(), true");
    await until(async () => await A.js("!!window.__zip"), 30000, "zip created");
    const info = await A.js("(async () => { const b = new Uint8Array(await window.__zip.arrayBuffer()); const s = new TextDecoder('latin1').decode(b); return { size: b.length, pk: s.slice(0,2), hasShared: s.includes('shared.txt') }; })()");
    assert.equal(info.pk, "PK");
    assert.ok(info.hasShared, "zip lists shared.txt");
    await A.js("document.querySelector('.side__close').click(), true");
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
