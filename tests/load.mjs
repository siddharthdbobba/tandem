// Burst test: many workspaces and panes at once. Checks every run finishes
// exactly once, files land in the right workspace, and the worker never runs
// more than MAX_ACTIVE agents at a time.
// Run: CONVEX_URL=https://backend WORKER_HOST=myvm node tests/load.mjs
import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const execFile = promisify(cb);
const c = new ConvexHttpClient(process.env.CONVEX_URL ?? "http://127.0.0.1:3310");
const HOST = process.env.WORKER_HOST ?? "localhost";
const WS = Number(process.env.WORKSPACES ?? 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jobs = [];
for (let w = 0; w < WS; w++) {
  const ws = await c.mutation(api.workspaces.create, { name: `load-${w}`, user: "load" });
  const [p1] = await c.query(api.workspaces.listPanes, { workspaceId: ws });
  const p2 = await c.mutation(api.workspaces.addPane, { workspaceId: ws, title: "b" });
  for (const [pane, tag] of [[p1._id, "a"], [p2, "b"]]) {
    await c.mutation(api.workspaces.submitPrompt, { paneId: pane, prompt: `Create file ${tag}.txt containing exactly "${w}-${tag}". Nothing else.`, author: "load" });
    jobs.push({ ws, pane, tag, w });
  }
}
console.log(`submitted ${jobs.length} runs`);
let peak = 0;
const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  const { stdout } = await execFile("ssh", [HOST, "ps -o pid= --ppid $(systemctl --user show -p MainPID --value tandem-worker) | wc -l"]);
  peak = Math.max(peak, Number(stdout.trim()));
  const feeds = await Promise.all(jobs.map((j) => c.query(api.workspaces.paneFeed, { paneId: j.pane })));
  const statuses = feeds.flat().map((r) => r.status);
  if (statuses.every((s) => s === "done" || s === "error")) break;
  await sleep(3000);
}
await sleep(4000);
const secs = Math.round((Date.now() - t0) / 1000);
const feeds = await Promise.all(jobs.map((j) => c.query(api.workspaces.paneFeed, { paneId: j.pane })));
const all = feeds.flat();
assert.equal(all.length, jobs.length, "run count changed");
const bad = all.filter((r) => r.status !== "done");
let wrong = 0;
for (const j of jobs) {
  const f = await c.query(api.files.get, { workspaceId: j.ws, path: `${j.tag}.txt` });
  if (f?.content.trim() !== `${j.w}-${j.tag}`) wrong++;
  const tree = await c.query(api.files.tree, { workspaceId: j.ws });
  if (tree.length !== 2) wrong++;
}
console.log({ runs: all.length, notDone: bad.length, wrongFiles: wrong, peakCodexProcs: peak, secs });
assert.equal(bad.length, 0);
assert.equal(wrong, 0);
assert.ok(peak <= Number(process.env.MAX_ACTIVE ?? 4), `peak ${peak} over cap`);
console.log("PASS load");
