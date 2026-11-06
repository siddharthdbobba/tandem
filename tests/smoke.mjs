// Quick end-to-end checks against a live Tandem deployment.
// Usage: CONVEX_URL=https://... node tests/smoke.mjs
import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";
import assert from "node:assert/strict";

const c = new ConvexHttpClient(process.env.CONVEX_URL ?? "http://127.0.0.1:3310");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}
async function waitRuns(paneId, n, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = await c.query(api.workspaces.paneFeed, { paneId });
    if (f.length >= n && f.every((r) => ["done", "error", "cancelled"].includes(r.status))) return f;
    await sleep(2000);
  }
  throw new Error("timeout waiting for runs");
}
const ws = await c.mutation(api.workspaces.create, { name: "smoke " + new Date().toISOString(), user: "smoke" });
const [pane] = await c.query(api.workspaces.listPanes, { workspaceId: ws });

await test("worker functions reject missing secret", async () => {
  await assert.rejects(c.query(api.worker.queued, { secret: "nope" }));
  await assert.rejects(c.query(api.worker.pendingWrites, { secret: "" }));
});

await test("path traversal rejected", async () => {
  for (const p of ["../x", "/etc/x", "a/../../x", "", "  ", "a//b", "./x"]) {
    await assert.rejects(c.mutation(api.files.save, { workspaceId: ws, path: p, content: "x", user: "t" }), `accepted ${JSON.stringify(p)}`);
  }
});

await test("queue: 3 prompts in one pane run in order, once each", async () => {
  for (const i of [1, 2, 3])
    await c.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: `Append the line "${i}" to order.txt (create if missing). No other output.`, author: "smoke" });
  const f = await waitRuns(pane._id, 3);
  assert.deepEqual(f.map((r) => r.status), ["done", "done", "done"]);
  await sleep(4000);
  const file = await c.query(api.files.get, { workspaceId: ws, path: "order.txt" });
  assert.equal(file?.content.trim().split("\n").join(","), "1,2,3");
});

await test("browser save reaches disk and agent sees it", async () => {
  await c.mutation(api.files.save, { workspaceId: ws, path: "deep/dir/note.txt", content: "magic-word-4471", user: "smoke" });
  await sleep(3000);
  const f = await c.query(api.files.get, { workspaceId: ws, path: "deep/dir/note.txt" });
  assert.equal(f.pendingWrite, false, "worker did not write to disk");
  await c.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: "Print the contents of deep/dir/note.txt with cat.", author: "smoke" });
  const feed = await waitRuns(pane._id, 4);
  assert.ok(JSON.stringify(feed.at(-1).events).includes("magic-word-4471"));
});

await test("cancel stops a long run", async () => {
  const p2 = await c.mutation(api.workspaces.addPane, { workspaceId: ws, title: "cancel" });
  const runId = await c.mutation(api.workspaces.submitPrompt, { paneId: p2, prompt: "Run the shell command `sleep 300` and wait for it.", author: "smoke" });
  for (let i = 0; i < 30; i++) { if ((await c.query(api.workspaces.paneFeed, { paneId: p2 }))[0].status === "running") break; await sleep(1000); }
  await sleep(5000);
  await c.mutation(api.workspaces.cancelRun, { runId });
  await sleep(1000);
  assert.equal((await c.query(api.workspaces.paneFeed, { paneId: p2 }))[0].status, "cancelled");
});

await test("removing a pane mid-run does not wedge the worker", async () => {
  const p3 = await c.mutation(api.workspaces.addPane, { workspaceId: ws, title: "doomed" });
  await c.mutation(api.workspaces.submitPrompt, { paneId: p3, prompt: "Say hi.", author: "smoke" });
  await sleep(3000);
  await c.mutation(api.workspaces.removePane, { paneId: p3 });
  await c.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: "Reply with exactly: still-alive", author: "smoke" });
  const feed = await waitRuns(pane._id, 5);
  assert.equal(feed.at(-1).status, "done");
});

await test("agent delete removes file from tree", async () => {
  await c.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: "Delete order.txt with rm.", author: "smoke" });
  await waitRuns(pane._id, 6);
  await sleep(4000);
  const tree = await c.query(api.files.tree, { workspaceId: ws });
  assert.ok(!tree.some((f) => f.path === "order.txt"));
});

for (const r of results) console.log(r.join("  "));
console.log("workspace", ws);
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
