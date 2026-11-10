// Screenshot logged-in pages: creates a test account, a trip workspace, and shoots
// home, workspace, settings. node tests/app-shots.mjs <outDir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { account, api, stamp } from "./helpers.mjs";

const out = process.argv[2];
const UI = process.env.UI_URL ?? "https://tandem.siddharthbobba.com";
const id = stamp();
const email = `shots-${id}@test.dev`, pw = "shots-pass-123";
const u = await account(email, pw, "Sid Test");
const ws = await u.mutation(api.workspaces.create, { name: "Yosemite weekend", template: "trip" });
await u.mutation(api.workspaces.create, { name: "CNIT 519 project", template: "school" });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9800 + Math.floor(Math.random() * 100);
const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "appshot-"));
const proc = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(150); } }
const sock = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (sock.onopen = r));
let n = 0; const pend = new Map();
sock.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const shoot = async (name, w = 1440, h = 900) => {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(800);
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(out, name), Buffer.from(s.data, "base64"));
};
const kill = setTimeout(() => { proc.kill("SIGKILL"); process.exit(2); }, 90000);
await send("Page.navigate", { url: `${UI}/#/signin` }); await sleep(3000);
await js(`(() => { const set = (s, v) => { const el = document.querySelector(s); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('input[name=email]', '${email}'); set('input[name=password]', '${pw}'); document.querySelector('form.stack').requestSubmit(); })()`);
await sleep(4000);
await shoot("home.png");
await js("document.querySelector('.tpl')?.click()"); await sleep(500); await shoot("home-picked.png");
await send("Page.navigate", { url: `${UI}/#/w/${ws}` }); await sleep(4500);
await shoot("workspace.png");
await js("[...document.querySelectorAll('.file')].find(f=>f.textContent.startsWith('itinerary.md'))?.click()"); await sleep(1500);
await shoot("doc.png");
await send("Page.navigate", { url: `${UI}/#/settings` }); await sleep(3000);
await shoot("settings.png");
await send("Page.navigate", { url: `${UI}/#/w/${ws}` }); await sleep(3500);
await shoot("workspace-m.png", 390, 844);
clearTimeout(kill); sock.close(); proc.kill("SIGKILL");
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log("ok", ws);
process.exit(0);
