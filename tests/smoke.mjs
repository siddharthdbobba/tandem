// Quick authenticated black-box checks against a live Tandem deployment.
import assert from "node:assert/strict";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { account, api, stamp, until, URL } from "./helpers.mjs";

const execFile = promisify(cb);
const HOST = process.env.WORKER_HOST ?? "localhost";
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); } };
const skip = (name) => results.push(`SKIP ${name} (no connected test account)`);
const id = stamp();
const alice = await account(`smoke-alice-${id}@test.dev`, "alice-pass-123", "Smoke Alice");
const bob = await account(`smoke-bob-${id}@test.dev`, "bob-pass-123", "Smoke Bob");
const eve = await account(`smoke-eve-${id}@test.dev`, "eve-pass-123", "Smoke Eve");
const anon = new ConvexHttpClient(URL);

async function workspace(client, label) {
  const workspaceId = await client.mutation(api.workspaces.create, { name: `smoke ${id} ${label}` });
  const [pane] = await client.query(api.workspaces.listPanes, { workspaceId });
  return { workspaceId, paneId: pane._id };
}
async function connectedAccount() {
  const email = process.env.TANDEM_TEST_EMAIL;
  const password = process.env.TANDEM_TEST_PASSWORD;
  if (!email || !password) return null;
  const client = await account(email, password, undefined, "signIn");
  const me = await client.query(api.profile.me, {});
  assert.equal(me.connections.find((c) => c.provider === me.profile.provider)?.status, "connected", "test account provider is not connected");
  return client;
}

await test("auth and membership are required", async () => {
  const { workspaceId, paneId } = await workspace(alice, "access");
  assert.deepEqual(await anon.query(api.workspaces.list, {}), []);
  await assert.rejects(anon.mutation(api.workspaces.create, { name: "nope" }));
  await assert.rejects(eve.query(api.workspaces.get, { id: workspaceId }));
  await assert.rejects(eve.query(api.files.tree, { workspaceId }));
  await assert.rejects(eve.query(api.workspaces.paneFeed, { paneId }));
  await assert.rejects(eve.mutation(api.workspaces.submitPrompt, { paneId, prompt: "nope" }));
  await assert.rejects(eve.mutation(api.files.save, { workspaceId, path: "nope.txt", content: "nope" }));
});
await test("worker functions reject a bad secret", async () => {
  await workspace(alice, "worker-secret");
  await assert.rejects(anon.query(api.worker.queued, { secret: "nope" }));
  await assert.rejects(alice.query(api.worker.pendingWrites, { secret: "" }));
});
await test("path traversal is rejected", async () => {
  const { workspaceId } = await workspace(alice, "paths");
  for (const path of ["../x", "/etc/x", "a/../../x", "", "  ", "a//b", "./x"])
    await assert.rejects(alice.mutation(api.files.save, { workspaceId, path, content: "x" }), `accepted ${JSON.stringify(path)}`);
});
await test("browser save reaches the workspace disk", async () => {
  const { workspaceId } = await workspace(alice, "disk");
  const path = "deep/dir/note.txt";
  const content = `magic-${id}`;
  await alice.mutation(api.files.save, { workspaceId, path, content });
  await until(async () => (await alice.query(api.files.get, { workspaceId, path }))?.pendingWrite === false, 45_000, "browser write on disk");
  const { stdout } = await execFile("ssh", [HOST, `cat /srv/tandem/workspaces/${workspaceId}/${path}`], { timeout: 20_000 });
  assert.equal(stdout, content);
});
await test("removing a pane with queued work does not wedge later work", async () => {
  const { workspaceId, paneId } = await workspace(alice, "remove");
  await alice.mutation(api.workspaces.submitPrompt, { paneId, prompt: "first queued prompt" });
  await alice.mutation(api.workspaces.submitPrompt, { paneId, prompt: "second queued prompt" });
  await alice.mutation(api.workspaces.removePane, { paneId });
  const nextPane = await alice.mutation(api.workspaces.addPane, { workspaceId, title: "after removal" });
  const runId = await alice.mutation(api.workspaces.submitPrompt, { paneId: nextPane, prompt: "finish with no subscription" });
  await until(async () => {
    const run = (await alice.query(api.workspaces.paneFeed, { paneId: nextPane })).find((r) => r._id === runId);
    return run && ["done", "error", "cancelled"].includes(run.status);
  }, 90_000, "post-removal run finished");
});
await test("unconnected queue is one-at-a-time and every run finishes once", async () => {
  const { paneId } = await workspace(alice, "queue");
  const ids = [];
  for (const n of [1, 2, 3]) ids.push(await alice.mutation(api.workspaces.submitPrompt, { paneId, prompt: `queued ${n}` }));
  const terminalTransitions = new Map(ids.map((runId) => [runId, 0]));
  const last = new Map();
  await until(async () => {
    const rows = await alice.query(api.workspaces.paneFeed, { paneId });
    assert.ok(rows.filter((r) => r.status === "running").length <= 1, "more than one run was running");
    for (const row of rows) {
      if (["done", "error", "cancelled"].includes(row.status) && !["done", "error", "cancelled"].includes(last.get(row._id))) terminalTransitions.set(row._id, terminalTransitions.get(row._id) + 1);
      last.set(row._id, row.status);
    }
    return ids.every((runId) => ["done", "error", "cancelled"].includes(rows.find((r) => r._id === runId)?.status));
  }, 120_000, "queued runs finished", 500);
  const rows = await alice.query(api.workspaces.paneFeed, { paneId });
  assert.equal(rows.filter((r) => ids.includes(r._id)).length, ids.length);
  assert.deepEqual(ids.map((runId) => rows.find((r) => r._id === runId)._id), ids);
  assert.deepEqual([...terminalTransitions.values()], [1, 1, 1]);
});
await test("presence shows two joined users", async () => {
  const { workspaceId, paneId } = await workspace(alice, "presence");
  const { inviteCode } = await alice.query(api.workspaces.get, { id: workspaceId });
  await bob.mutation(api.workspaces.join, { inviteCode });
  await Promise.all([alice.mutation(api.presence.heartbeat, { workspaceId, paneId }), bob.mutation(api.presence.heartbeat, { workspaceId })]);
  const people = await until(async () => {
    const rows = await alice.query(api.presence.list, { workspaceId, now: Date.now() });
    return rows.length === 2 ? rows : false;
  }, 15_000, "two presences");
  assert.deepEqual(new Set(people.map((p) => p.name)), new Set(["Smoke Alice", "Smoke Bob"]));
});
const connected = await connectedAccount();
if (!connected) skip("connected agent writes a file");
else await test("connected agent writes a file", async () => {
  const { workspaceId, paneId } = await workspace(connected, "agent-file");
  const token = `agent-${id}`;
  const runId = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: `Create result.txt containing exactly ${token}.` });
  await until(async () => (await connected.query(api.workspaces.paneFeed, { paneId })).find((r) => r._id === runId)?.status === "done", 180_000, "agent file run");
  const file = await until(async () => {
    const f = await connected.query(api.files.get, { workspaceId, path: "result.txt" });
    return f?.content === token && f;
  }, 45_000, "agent file sync");
  assert.equal(file.content, token);
});
console.log(results.join("\n"));
console.log(`SUMMARY ${results.filter((r) => r.startsWith("PASS")).length} passed, ${results.filter((r) => r.startsWith("SKIP")).length} skipped, ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
