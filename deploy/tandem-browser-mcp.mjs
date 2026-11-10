#!/usr/bin/env node
// tandem-browser-mcp <screenshot-dir>
//
// Wraps Playwright MCP for Tandem agents. Each agent gets a clean, in-memory
// Chromium profile (never anyone's login). After every browser action we take
// a screenshot into <screenshot-dir>/live.jpg so people in the workspace can
// watch the agent browse. Speaks MCP over stdio in both directions.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const shotDir = process.argv[2];
const BIN = "/opt/tandem-browser/node_modules/.bin/playwright-mcp";
const outDir = path.join(process.env.HOME ?? "/tmp", "tmp", "playwright");
fs.mkdirSync(outDir, { recursive: true });

const child = spawn(
  BIN,
  [
    "--headless", "--isolated", "--browser", "chromium", "--no-sandbox",
    "--viewport-size", "1280,800", "--output-dir", outDir,
    "--image-responses", "omit", "--caps", "vision",
  ],
  { stdio: ["pipe", "pipe", "inherit"], env: process.env },
);

// Our own requests to the child (screenshots) use ids the agent never sees.
let ownId = 0;
const own = new Map();
const PREFIX = "tandem-shot-";

let out = "";
child.stdout.on("data", (chunk) => {
  out += chunk;
  let i;
  while ((i = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, i);
    out = out.slice(i + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(line + "\n"); continue; }
    if (typeof msg.id === "string" && msg.id.startsWith(PREFIX)) {
      own.get(msg.id)?.(msg);
      own.delete(msg.id);
      continue;
    }
    process.stdout.write(line + "\n");
    // Remember the page the agent is on (navigation responses include it).
    const txt = msg.result?.content?.map?.((c) => c.text ?? "").join("\n") ?? "";
    const u = txt.match(/Page URL: (\S+)/);
    if (u) { page = { url: u[1], title: (txt.match(/Page Title: (.*)/) ?? [])[1] ?? "" }; opened = true; }
    // After any browser action the agent ran, refresh the live screenshot.
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.delete(msg.id);
      shoot();
    }
  }
});

const pending = new Set();
let inp = "";
process.stdin.on("data", (chunk) => {
  inp += chunk;
  let i;
  while ((i = inp.indexOf("\n")) >= 0) {
    const line = inp.slice(0, i);
    inp = inp.slice(i + 1);
    try {
      const msg = JSON.parse(line);
      if (msg.method === "tools/call" && msg.id !== undefined && msg.params?.name !== "browser_take_screenshot") {
        // Daily soft cap per person, so one account can't hammer the web from our server.
        if (!underCap()) {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text",
            text: `Daily browser limit reached (${CAP} actions). It resets tomorrow. Tell the user, and use webfetch/websearch instead if possible.` }] } }) + "\n");
          continue;
        }
        pending.add(msg.id);
      }
    } catch {}
    child.stdin.write(line + "\n");
  }
});

const CAP = Number(process.env.TANDEM_BROWSE_CAP ?? 200);
const capFile = path.join(process.env.HOME ?? "/tmp", ".tandem-browse-count.json");
function underCap() {
  const today = new Date().toISOString().slice(0, 10);
  let c = { day: today, n: 0 };
  try { const r = JSON.parse(fs.readFileSync(capFile, "utf8")); if (r.day === today) c = r; } catch {}
  if (c.n >= CAP) return false;
  c.n++;
  try { fs.writeFileSync(capFile, JSON.stringify(c)); } catch {}
  return true;
}
process.stdin.on("end", () => child.stdin.end());
child.on("exit", (code) => process.exit(code ?? 0));

let shooting = false;
let again = false;
let page = { url: "", title: "" };
let opened = false; // true once the agent has opened a page (no blank frames before that)

// Call one of the child's tools on our own behalf (ids the agent never sees).
function callOwn(name, args, timeoutMs = 15000) {
  const id = PREFIX + ++ownId;
  return new Promise((resolve) => {
    own.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    setTimeout(() => { own.delete(id); resolve(null); }, timeoutMs);
  });
}
const urlFrom = (res) => {
  const txt = res?.result?.content?.map?.((c) => c.text ?? "").join("\n") ?? "";
  const u = txt.match(/Page URL: (\S+)/);
  if (u) page = { url: u[1], title: (txt.match(/Page Title: (.*)/) ?? [])[1] ?? "" };
};

// People in the workspace can drive the browser too. The worker appends their
// actions to <shotDir>/input.jsonl; we replay new lines here.
const inputFile = shotDir ? path.join(shotDir, "input.jsonl") : null;
let inputPos = 0;
try { if (inputFile) inputPos = fs.statSync(inputFile).size; } catch {}
let handling = false;
async function pollInput() {
  if (!inputFile || handling) return;
  let size = 0;
  try { size = fs.statSync(inputFile).size; } catch { return; }
  if (size < inputPos) inputPos = 0; // file was reset
  if (size === inputPos) return;
  handling = true;
  try {
    const fd = fs.openSync(inputFile, "r");
    const buf = Buffer.alloc(Math.min(size - inputPos, 64_000));
    fs.readSync(fd, buf, 0, buf.length, inputPos);
    fs.closeSync(fd);
    inputPos += buf.length;
    for (const line of buf.toString("utf8").split("\n")) {
      let a;
      try { a = JSON.parse(line); } catch { continue; }
      if (!opened && a.kind !== "navigate") continue;
      const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
      let res = null;
      if (a.kind === "click") res = await callOwn("browser_mouse_click_xy", { x: n(a.x, 1280), y: n(a.y, 800) });
      else if (a.kind === "scroll") res = await callOwn("browser_mouse_wheel", { deltaX: 0, deltaY: Math.max(-3000, Math.min(3000, Number(a.dy) || 0)) });
      else if (a.kind === "key" && /^[A-Za-z0-9 ]$|^(Enter|Backspace|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageDown|PageUp|Home|End|Delete)$/.test(a.key ?? ""))
        res = await callOwn("browser_press_key", { key: a.key });
      else if (a.kind === "type" && typeof a.text === "string") {
        for (const ch of a.text.slice(0, 500)) await callOwn("browser_press_key", { key: ch === "\n" ? "Enter" : ch }, 5000);
      } else if (a.kind === "back") res = await callOwn("browser_navigate_back", {});
      else if (a.kind === "reload" && page.url) res = await callOwn("browser_navigate", { url: page.url });
      else if (a.kind === "navigate" && /^https?:\/\/[^\s]{1,2000}$/.test(a.url ?? "")) { res = await callOwn("browser_navigate", { url: a.url }, 30000); opened = true; }
      urlFrom(res);
      await shoot();
    }
  } catch {}
  handling = false;
}
setInterval(pollInput, 250).unref();
// Keep the view moving while pages load or animate, not only after tool calls.
setInterval(() => { if (opened) shoot(); }, 1500).unref();

async function shoot() {
  if (!shotDir) return;
  if (shooting) { again = true; return; }
  shooting = true;
  try {
    const id = PREFIX + ++ownId;
    const res = await new Promise((resolve) => {
      own.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call",
        params: { name: "browser_take_screenshot", arguments: { type: "jpeg", filename: path.join(outDir, "tandem-live.jpeg") } } }) + "\n");
      setTimeout(() => resolve(null), 15000);
    });
    const src = path.join(outDir, "tandem-live.jpeg");
    if (res && !res.result?.isError && fs.existsSync(src)) {
      fs.mkdirSync(shotDir, { recursive: true });
      const tmp = path.join(shotDir, ".live.tmp");
      fs.copyFileSync(src, tmp);
      fs.renameSync(tmp, path.join(shotDir, "live.jpg"));
      fs.writeFileSync(path.join(shotDir, "live.json"), JSON.stringify({ ...page, at: Date.now() }));
    }
  } catch {}
  shooting = false;
  if (again) { again = false; shoot(); }
}
