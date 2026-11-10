// Landing/app split: a fresh visitor gets the landing without the app chunk; a signed-in
// user returning to "/" goes straight to Home. node tests/boot.mjs (CONVEX_URL, UI_URL)
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
import { account, stamp } from "./helpers.mjs";
const UI = process.env.UI_URL; const email = `boot-${stamp()}@test.dev`, pw = "boot-pass-123";
await account(email, pw, "Boot Test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9600 + Math.floor(Math.random() * 100);
const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "boot-"));
const proc = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(150); } }
const sock = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (sock.onopen = r));
let n = 0; const pend = new Map(); const loaded = [];
sock.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === "Network.requestWillBeSent") loaded.push(d.params.request.url); pend.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
await send("Network.enable");
// 1) Fresh visitor at /: landing, no Boot chunk.
await send("Page.navigate", { url: `${UI}/` }); await sleep(3500);
const landing = await js("document.body.innerText.includes('shared AI workspace')");
const bootFresh = loaded.some((u) => /\/Boot-/.test(u));
// 2) Sign in via the form.
await send("Page.navigate", { url: `${UI}/#/signin` }); await sleep(3000);
await js(`(() => { const set = (s, v) => { const el = document.querySelector(s); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('input[name=email]', '${email}'); set('input[name=password]', '${pw}'); document.querySelector('form.stack').requestSubmit(); })()`);
await sleep(4500);
const home1 = await js("document.body.innerText.includes('What are you working on')");
// 3) Returning user: reload at "/" (no hash) must go straight to Home, not marketing.
await send("Page.navigate", { url: `${UI}/` }); await sleep(4500);
const home2 = await js("document.body.innerText.includes('What are you working on')");
const errs = await js("window.__errs ?? []");
console.log(JSON.stringify({ landing, bootLoadedForFreshVisitor: bootFresh, signedInHome: home1, returningUserHome: home2 }));
sock.close(); proc.kill("SIGKILL"); fs.rmSync(profile, { recursive: true, force: true });
process.exit(landing && !bootFresh && home1 && home2 ? 0 : 1);
