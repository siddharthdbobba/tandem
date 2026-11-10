// Reconnecting banner: drop the Convex WebSocket (new sockets go to a dead port), the
// banner must appear within ~3s, then vanish once sockets work again. node tests/offline.mjs
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
import { account, api, stamp } from "./helpers.mjs";
const UI = process.env.UI_URL; const email = `off-${stamp()}@test.dev`, pw = "off-pass-123";
const u = await account(email, pw, "Off Test");
const ws = await u.mutation(api.workspaces.create, { name: "offline", template: "blank" });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 100);
const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "off-"));
const proc = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(150); } }
const sock = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (sock.onopen = r));
let n = 0; const pend = new Map();
sock.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
await send("Network.enable");
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: "(() => { const W = window.WebSocket; window.__ws = []; window.WebSocket = function (...a) { const w = new W(window.__dead ? 'ws://127.0.0.1:9/' : a[0], a[1]); window.__ws.push(w); return w; }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, W); })()" });
await send("Page.navigate", { url: `${UI}/#/signin` }); await sleep(3000);
await js(`(() => { const set = (s, v) => { const el = document.querySelector(s); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('input[name=email]', '${email}'); set('input[name=password]', '${pw}'); document.querySelector('form.stack').requestSubmit(); })()`);
await sleep(4000);
await send("Page.navigate", { url: `${UI}/#/w/${ws}` }); await sleep(3500);
const before = await js("!!document.querySelector('.offline')");
await send("Network.setBlockedURLs", { urls: ["*api.tandem.siddharthbobba.com*"] });
await js("(window.__dead = true, window.__ws.forEach(w => w.close()), window.__ws.length)").then((c) => console.log("sockets closed:", c));
await js("window.dispatchEvent(new Event('offline')), true");
let shown = false; for (let i = 0; i < 25 && !shown; i++) { await sleep(1000); shown = await js("!!document.querySelector('.offline')"); }
const text = shown ? await js("document.querySelector('.offline').textContent") : "";
await send("Network.setBlockedURLs", { urls: [] });
await js("(window.__dead = false), true");
await js("window.dispatchEvent(new Event('online')), true");
let gone = false; for (let i = 0; i < 30 && !gone; i++) { await sleep(1000); gone = !(await js("!!document.querySelector('.offline')")); }
console.log(JSON.stringify({ before, shown, text, gone }));
sock.close(); proc.kill("SIGKILL"); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(!before && shown && gone ? 0 : 1);
