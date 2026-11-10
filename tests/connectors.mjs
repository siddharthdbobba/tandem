// Per-person app connectors and take-control browser input. Live backend:
// CONVEX_URL=https://api.tandem.siddharthbobba.com WORKER_HOST=rach node tests/connectors.mjs
import assert from "node:assert/strict";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { account, api, stamp, until, URL } from "./helpers.mjs";

const HOST = process.env.WORKER_HOST ?? "localhost";
const sh = async (cmd, timeout = 60_000) => (await promisify(cb)("ssh", [HOST, cmd], { timeout })).stdout.trim();
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${process.env.VERBOSE ? e.message + (e.stderr ?? "") + (e.stdout ?? "") : e.message.split("\n")[0]}`); }
};
const rejects = async (p, re) => {
  try { await p; } catch (e) { if (re) assert.match(e.message, re); return; }
  throw new Error("expected rejection");
};

const id = stamp();
const ann = await account(`ann-${id}@test.dev`, "ann-pass-123", "Ann");
const ben = await account(`ben-${id}@test.dev`, "ben-pass-123", "Ben");
const anon = new ConvexHttpClient(URL);
const annKey = (await ann.query(api.profile.me, {})).profile.sandboxKey;
const benKey = (await ben.query(api.profile.me, {})).profile.sandboxKey;
// What servers would this person's agent see? (Runs the launcher, which rebuilds mcp.json.)
const serversFor = async (key) =>
  JSON.parse(await sh(`sudo -n /usr/local/sbin/tandem-as ${key} /srv/tandem/workspaces/.login -- jcode mcp list --json 2>/dev/null`))
    .map((s) => s.name).sort();
const mine = (c, name) => c.query(api.connectors.mine, {}).then((r) => r.find((x) => x.name === name));

await test("catalog lists the five built-in apps", async () => {
  const cat = await ann.query(api.connectors.catalog, {});
  assert.deepEqual(cat.map((c) => c.id), ["notion", "linear", "github", "atlassian", "deepwiki"]);
});

await test("signed-out and bad input are rejected", async () => {
  await rejects(anon.mutation(api.connectors.add, { catalogId: "deepwiki" }));
  await rejects(ann.mutation(api.connectors.add, { catalogId: "nope" }), /Unknown/);
  await rejects(ann.mutation(api.connectors.add, { url: "http://insecure.example/mcp" }), /https/);
  await rejects(ann.mutation(api.connectors.add, { url: "https://evil.example/mcp\"; rm -rf /" }), /https/);
  await rejects(ann.mutation(api.connectors.add, { catalogId: "github" }), /token/);
  await rejects(ann.mutation(api.connectors.add, { catalogId: "github", token: "abc def\n" }), /characters/);
});

await test("DeepWiki connects with real tools for Ann only", async () => {
  await ann.mutation(api.connectors.add, { catalogId: "deepwiki" });
  const c = await until(async () => { const r = await mine(ann, "deepwiki"); return ["connected", "error"].includes(r?.status) && r; }, 90_000, "deepwiki connected");
  assert.equal(c.status, "connected", c.error);
  assert.ok(c.tools >= 1);
  assert.deepEqual(await ben.query(api.connectors.mine, {}), []);
});

await test("Ann's connector reaches only Ann's sandbox", async () => {
  assert.deepEqual(await serversFor(annKey), ["browser", "deepwiki"]);
  assert.deepEqual(await serversFor(benKey), ["browser"]);
  // The stored list is root-only.
  const perm = await sh(`sudo stat -c '%U %a' /srv/tandem/connectors/tdu_${annKey}.json`);
  assert.equal(perm, "root 600");
});

await test("Ben can't see, finish, or remove Ann's connector", async () => {
  const c = await mine(ann, "deepwiki");
  await rejects(ben.mutation(api.connectors.remove, { id: c._id }), /not found/);
  await rejects(ben.mutation(api.connectors.submitCode, { id: c._id, code: "http://127.0.0.1:1/callback?code=x" }), /not found/);
  assert.equal((await mine(ann, "deepwiki")).status, "connected");
});

await test("a bearer token is stored on the VM, never kept in Convex", async () => {
  // Fake GitHub token: saving works, connecting fails (401), the token is gone from Convex.
  await ben.mutation(api.connectors.add, { catalogId: "github", token: "github_pat_fake123" });
  const c = await until(async () => { const r = await mine(ben, "github"); return ["connected", "error"].includes(r?.status) && r; }, 90_000, "github settled");
  assert.equal(c.status, "error");
  assert.equal("token" in c, false);
  const stored = await sh(`sudo cat /srv/tandem/connectors/tdu_${benKey}.json`);
  assert.match(stored, /Bearer github_pat_fake123/);
  assert.equal((await sh(`sudo grep -c github_pat_fake123 /srv/tandem/connectors/tdu_${annKey}.json || true`)), "0");
  await ben.mutation(api.connectors.remove, { id: c._id });
  await until(async () => !(await mine(ben, "github")), 60_000, "github removed");
  assert.doesNotMatch(await sh(`sudo cat /srv/tandem/connectors/tdu_${benKey}.json`), /github/);
});

await test("OAuth app gives a sign-in link; bad pastes are refused; wrong state fails safely", async () => {
  await ben.mutation(api.connectors.add, { catalogId: "linear" });
  const c = await until(async () => { const r = await mine(ben, "linear"); return ["awaiting_code", "error"].includes(r?.status) && r; }, 90_000, "linear link");
  assert.equal(c.status, "awaiting_code", c.error);
  assert.match(c.authUrl, /^https:\/\/mcp\.linear\.app\/authorize\?.*redirect_uri=http%3A%2F%2F127\.0\.0\.1/);
  await rejects(ben.mutation(api.connectors.submitCode, { id: c._id, code: "https://evil.example/callback?code=x" }), /127\.0\.0\.1/);
  await ben.mutation(api.connectors.submitCode, { id: c._id, code: "http://127.0.0.1:1234/callback?code=fake&state=wrong" });
  const after = await until(async () => { const r = await mine(ben, "linear"); return r?.status === "error" && r; }, 60_000, "linear error");
  assert.match(after.error, /different sign-in/);
  // No Linear for Ann, ever.
  assert.deepEqual(await serversFor(annKey), ["browser", "deepwiki"]);
});

await test("removing a connector drops it from the sandbox", async () => {
  const c = await mine(ann, "deepwiki");
  await ann.mutation(api.connectors.remove, { id: c._id });
  await until(async () => !(await mine(ann, "deepwiki")), 60_000, "deepwiki removed");
  assert.deepEqual(await serversFor(annKey), ["browser"]);
});

// ---------- take control of the agent browser ----------

await test("browser input: members only, only during a run, http(s) only", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Browse" });
  await rejects(ben.mutation(api.browser.input, { workspaceId: ws, action: { kind: "click", x: 1, y: 1 } }), /member/);
  await rejects(anon.mutation(api.browser.input, { workspaceId: ws, action: { kind: "back" } }));
  await rejects(ann.mutation(api.browser.input, { workspaceId: ws, action: { kind: "back" } }), /idle/);
  assert.deepEqual(await ann.query(api.browser.status, { workspaceId: ws }), { running: false });
  await rejects(ben.query(api.browser.status, { workspaceId: ws }), /member/);
});

await test("browser wrapper replays human clicks/typing and keeps frames fresh", async () => {
  // Drive the real wrapper as a sandbox user: agent opens a page, then a
  // "person" types into input.jsonl like the worker does.
  const out = await sh(`bash -s <<'EOF'
set -e
D=$(mktemp -d /tmp/tbr.XXXX); chmod 777 $D
cat > $D/drive.mjs <<'JS'
import { spawn } from "node:child_process";
import fs from "node:fs";
const dir = process.argv[2];
const p = spawn("/opt/tandem-browser/bin/tandem-browser-mcp", [dir], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/opt/tandem-browser/browsers" }, stdio: ["pipe", "pipe", "ignore"] });
let b = ""; const w = new Map();
p.stdout.on("data", (c) => { b += c; let i; while ((i = b.indexOf("\\n")) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
let n = 0; const rpc = (method, params) => new Promise((r) => { const id = ++n; w.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n"); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
await rpc("tools/call", { name: "browser_navigate", arguments: { url: "https://example.com/" } });
// Turn the page into a form with an input on top and a big link under it.
await rpc("tools/call", { name: "browser_evaluate", arguments: { function: "() => { document.body.innerHTML = '<input id=q style=\\"display:block;width:600px;height:80px\\"><a href=https://www.iana.org/ style=\\"display:block;width:600px;height:300px\\">go</a>'; document.body.style.cssText = 'margin:0;padding:0;width:auto;max-width:none'; }" } });
await sleep(1500);
const m1 = JSON.parse(fs.readFileSync(dir + "/live.json")).at;
await sleep(2500);
const m2 = JSON.parse(fs.readFileSync(dir + "/live.json")).at;
console.log("periodic", m2 > m1);
fs.appendFileSync(dir + "/input.jsonl", JSON.stringify({ kind: "click", x: 50, y: 40 }) + "\\n" + JSON.stringify({ kind: "type", text: "hi" }) + "\\n" + JSON.stringify({ kind: "navigate", url: "javascript:alert(1)" }) + "\\n");
await sleep(4000);
const snap = await rpc("tools/call", { name: "browser_evaluate", arguments: { function: "() => document.querySelector('#q').value" } });
console.log("typed", JSON.stringify(snap.result.content[0].text).includes("hi"));
fs.appendFileSync(dir + "/input.jsonl", JSON.stringify({ kind: "click", x: 100, y: 200 }) + "\\n");
await sleep(5000);
console.log("url", JSON.parse(fs.readFileSync(dir + "/live.json")).url);
p.kill(); process.exit(0);
JS
sudo -u tdu_${benKey} env -i HOME=/srv/tandem/homes/tdu_${benKey} TMPDIR=/srv/tandem/homes/tdu_${benKey}/tmp PATH=/usr/local/bin:/usr/bin:/bin timeout 60 node $D/drive.mjs $D/shots
sudo rm -rf -- "$D"
EOF`, 90_000);
  assert.match(out, /periodic true/);
  assert.match(out, /typed true/);
  assert.match(out, /url https:\/\/www\.iana\.org\//);
});

for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
