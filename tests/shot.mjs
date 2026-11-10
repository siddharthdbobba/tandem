// Screenshot helper: node tests/shot.mjs <url> <out.png> [width] [height] [jsBeforeShot]
// Uses headless Chrome over CDP. Waits for network idle-ish, then captures.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [url, out, w = "1280", h = "860", pre = ""] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "shot-"));
const proc = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  `--window-size=${w},${h}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 40; i++) {
  try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(150); }
}
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const timeout = setTimeout(() => { proc.kill("SIGKILL"); process.exit(2); }, 45000);
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 600 });
await send("Page.navigate", { url });
await sleep(3500);
if (pre) { await send("Runtime.evaluate", { expression: pre, awaitPromise: true }); await sleep(1500); }
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
clearTimeout(timeout);
ws.close();
proc.kill("SIGKILL");
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
