// Accessibility audit (axe-core) of the main pages. Prints serious/critical violations.
// node tests/a11y.mjs   (CONVEX_URL / UI_URL as for the other suites)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { account, api, stamp } from "./helpers.mjs";

const UI = process.env.UI_URL ?? "https://tandem.siddharthbobba.com";
const AXE = fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const id = stamp();
const email = `a11y-${id}@test.dev`, pw = "a11y-pass-123";
const u = await account(email, pw, "Ally Test");
const ws = await u.mutation(api.workspaces.create, { name: "Yosemite weekend", template: "trip" });
await u.mutation(api.chat.send, { workspaceId: ws, text: "who's bringing the stove?" });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9700 + Math.floor(Math.random() * 100);
const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "a11y-"));
const proc = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(150); } }
const sock = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (sock.onopen = r));
let n = 0; const pend = new Map();
sock.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const kill = setTimeout(() => { proc.kill("SIGKILL"); process.exit(2); }, 120000);

let total = 0;
async function audit(name) {
  await js(AXE + ";true");
  const res = await js(`axe.run(document, { resultTypes: ["violations"] }).then(r => r.violations
    .filter(v => v.impact === "serious" || v.impact === "critical")
    .map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\\n").slice(1, 2).join(" ").trim()) })))`);
  total += res.length;
  console.log(`\n== ${name}: ${res.length} serious/critical`);
  for (const v of res) { console.log(`- [${v.impact}] ${v.id}: ${v.help}`); for (const x of v.nodes) console.log(`    ${x}`); }
}

await send("Page.navigate", { url: `${UI}/` }); await sleep(3000); await audit("landing");
await send("Page.navigate", { url: `${UI}/#/signin` }); await sleep(2500); await audit("signin");
await js(`(() => { const set = (s, v) => { const el = document.querySelector(s); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('input[name=email]', '${email}'); set('input[name=password]', '${pw}'); document.querySelector('form.stack').requestSubmit(); })()`);
await sleep(4000); await audit("home");
await send("Page.navigate", { url: `${UI}/#/w/${ws}` }); await sleep(4000); await audit("workspace");
await js("localStorage.setItem('tandem-tour-done','1'); [...document.querySelectorAll('.panel-toggle')].find(b=>b.textContent.includes('Chat'))?.click()"); await sleep(1500); await audit("chat");
await send("Page.navigate", { url: `${UI}/#/settings` }); await sleep(3000); await audit("settings");

clearTimeout(kill); sock.close(); proc.kill("SIGKILL");
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`\nTOTAL serious/critical: ${total}`);
process.exit(0);
