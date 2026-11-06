// Live UI smoke test: loads a workspace in headless Chrome, checks that panes
// and the file tree render and that no uncaught JS errors fire.
// Run: UI_URL=https://your-ui node tests/codex/ui-smoke.mjs <workspaceId> [screenshot.png]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [id, shotPath] = process.argv.slice(2);
if (!id) throw new Error("usage: node tests/codex/ui-smoke.mjs <workspaceId> [screenshot.png]");
const UI = process.env.UI_URL ?? "http://127.0.0.1:5173";
const port = 9229;
const profile = path.resolve("tests/codex/.chrome");
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
    if (!page) await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++seq;
    const on = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id === n) { ws.removeEventListener("message", on); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  // Record uncaught errors from the very first script.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__errs=[];addEventListener('error',e=>__errs.push(e.message));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));",
  });
  await send("Page.navigate", { url: `${UI}/?name=Sid#${id}` });
  await sleep(6000);

  const text = await evalJs("document.body.innerText");
  assert.match(text, /Files/);
  assert.match(text, /Send/, "no prompt pane rendered");
  const errs = await evalJs("window.__errs");
  assert.deepEqual(errs, [], `page errors: ${errs}`);
  if (shotPath) {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shotPath, Buffer.from(data, "base64"));
  }
  console.log("PASS UI smoke: panes and files render, no page errors");
  ws.close();
} finally {
  chrome.kill("SIGTERM");
}
