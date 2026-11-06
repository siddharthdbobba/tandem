// Live black-box QA. Model-success checks use only TANDEM_TEST_EMAIL/PASSWORD.
import assert from "node:assert/strict";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { account, api, sleep, stamp, until, URL } from "../helpers.mjs";

const execFile = promisify(cb);
const HOST = process.env.WORKER_HOST ?? "localhost";
const WS_DIR = "/srv/tandem/workspaces";
const results = [];
const id = stamp();
const test = async (name, fn) => { try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); } };
const skip = (name) => results.push(`SKIP ${name} (no connected test account)`);
const owner = await account(`e2e-owner-${id}@test.dev`, "owner-pass-123", "E2E Owner");
const guest = await account(`e2e-guest-${id}@test.dev`, "guest-pass-123", "E2E Guest");
const anon = new ConvexHttpClient(URL);
async function workspace(client, label) {
  const workspaceId = await client.mutation(api.workspaces.create, { name: `e2e ${id} ${label}` });
  const [pane] = await client.query(api.workspaces.listPanes, { workspaceId });
  return { workspaceId, paneId: pane._id };
}
async function terminal(client, paneId, runId, timeout = 180_000) {
  return until(async () => {
    const run = (await client.query(api.workspaces.paneFeed, { paneId })).find((x) => x._id === runId);
    return run && ["done", "error", "cancelled"].includes(run.status) ? run : false;
  }, timeout, `run ${runId}`);
}
async function connectedAccount() {
  if (!process.env.TANDEM_TEST_EMAIL || !process.env.TANDEM_TEST_PASSWORD) return null;
  const client = await account(process.env.TANDEM_TEST_EMAIL, process.env.TANDEM_TEST_PASSWORD, undefined, "signIn");
  const me = await client.query(api.profile.me, {});
  assert.equal(me.connections.find((x) => x.provider === me.profile.provider)?.status, "connected", "test account provider is not connected");
  return client;
}

await test("signed-out and non-members cannot access a workspace", async () => {
  const { workspaceId, paneId } = await workspace(owner, "access");
  assert.deepEqual(await anon.query(api.workspaces.list, {}), []);
  await assert.rejects(anon.mutation(api.workspaces.create, { name: "x" }));
  await assert.rejects(guest.query(api.files.tree, { workspaceId }));
  await assert.rejects(guest.query(api.workspaces.paneFeed, { paneId }));
  await assert.rejects(guest.mutation(api.workspaces.submitPrompt, { paneId, prompt: "x" }));
});
await test("invite membership and two-user presence work", async () => {
  const { workspaceId, paneId } = await workspace(owner, "presence");
  const { inviteCode } = await owner.query(api.workspaces.get, { id: workspaceId });
  assert.equal(await guest.mutation(api.workspaces.join, { inviteCode }), workspaceId);
  await Promise.all([owner.mutation(api.presence.heartbeat, { workspaceId, paneId }), guest.mutation(api.presence.heartbeat, { workspaceId })]);
  const people = await until(async () => {
    const rows = await owner.query(api.presence.list, { workspaceId, now: Date.now() });
    return rows.length === 2 ? rows : false;
  }, 15_000, "presence");
  assert.deepEqual(new Set(people.map((x) => x.name)), new Set(["E2E Owner", "E2E Guest"]));
});
await test("worker API rejects a bad secret", async () => {
  const { workspaceId, paneId } = await workspace(owner, "worker");
  const runId = await owner.mutation(api.workspaces.submitPrompt, { paneId, prompt: "noop" });
  const calls = [
    () => anon.query(api.worker.queued, { secret: "" }),
    () => owner.mutation(api.worker.claim, { secret: "", runId }),
    () => owner.query(api.worker.runStatus, { secret: "", runId }),
    () => owner.mutation(api.worker.appendEvent, { secret: "", runId, kind: "message", text: "x" }),
    () => owner.mutation(api.worker.finish, { secret: "", runId, status: "done" }),
    () => owner.mutation(api.worker.syncFiles, { secret: "", workspaceId, upserts: [], deletes: [] }),
    () => owner.query(api.worker.filePaths, { secret: "", workspaceId }),
    () => owner.query(api.worker.pendingWrites, { secret: "" }),
    () => owner.mutation(api.worker.markWritten, { secret: "", fileId: "invalid", content: "x" }),
  ];
  for (const call of calls) await assert.rejects(call);
  await owner.mutation(api.workspaces.cancelRun, { runId });
});
await test("path validation rejects traversal and absolute paths", async () => {
  const { workspaceId } = await workspace(owner, "paths");
  for (const path of ["../x", "/etc/x", "", "a/../../x", "a//b", "./x"])
    await assert.rejects(owner.mutation(api.files.save, { workspaceId, path, content: "bad" }));
});
await test("browser save is written to the VM workspace", async () => {
  const { workspaceId } = await workspace(owner, "browser-disk");
  const path = "nested/browser.txt";
  const content = `browser-${id}`;
  await owner.mutation(api.files.save, { workspaceId, path, content });
  await until(async () => (await owner.query(api.files.get, { workspaceId, path }))?.pendingWrite === false, 45_000, "disk write");
  const { stdout } = await execFile("ssh", [HOST, `cat ${WS_DIR}/${workspaceId}/${path}`], { timeout: 20_000 });
  assert.equal(stdout, content);
});

const connected = await connectedAccount();
if (!connected) {
  for (const name of ["agent streams before finish", "agent queue preserves file order", "agent follow-up keeps context", "agent unicode and long output", "agent cancellation stops a long run"]) skip(name);
} else {
  await test("agent streams before finish", async () => {
    const { paneId } = await workspace(connected, "stream");
    const live = new ConvexClient(URL);
    // The subscription must be authenticated too, not merely the HTTP client.
    live.setAuth(async () => connected.token);
    let sawEventBeforeFinish = false;
    const unsub = live.onUpdate(api.workspaces.paneFeed, { paneId }, (runs) => {
      const run = runs.find((x) => x.prompt.includes("STREAM_TOKEN"));
      if (run?.events.length && run.status !== "done") sawEventBeforeFinish = true;
    });
    try {
      const runId = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: "Run exactly: printf STREAM_TOKEN; sleep 4; printf STREAM_END" });
      const run = await terminal(connected, paneId, runId);
      assert.equal(run.status, "done");
      await until(() => sawEventBeforeFinish, 15_000, "stream before done");
    } finally { unsub(); live.close(); }
  });
  await test("agent queue preserves file order", async () => {
    const { workspaceId, paneId } = await workspace(connected, "queue-files");
    const tokens = ["ONE", "TWO", "THREE"];
    const ids = [];
    for (const token of tokens) ids.push(await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: `Run exactly: printf '${token}\\n' >> order.txt` }));
    const runs = await Promise.all(ids.map((runId) => terminal(connected, paneId, runId, 240_000)));
    assert.deepEqual(runs.map((run) => run.status), ["done", "done", "done"]);
    const file = await until(async () => {
      const f = await connected.query(api.files.get, { workspaceId, path: "order.txt" });
      return f?.content === `${tokens.join("\n")}\n` && f;
    }, 45_000, "ordered file");
    assert.equal(file.content, `${tokens.join("\n")}\n`);
  });
  await test("agent follow-up keeps context", async () => {
    const { paneId } = await workspace(connected, "context");
    const token = `CONTEXT_${id}`;
    const first = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: `Reply with exactly ${token}. Do not use tools.` });
    assert.equal((await terminal(connected, paneId, first)).status, "done");
    const second = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: "What exact token did you just give me? Reply only with it." });
    const run = await terminal(connected, paneId, second);
    assert.equal(run.status, "done");
    assert.ok(run.events.some((event) => event.text.includes(token)), "follow-up lost context");
  });
  await test("agent unicode and long output complete", async () => {
    const { paneId } = await workspace(connected, "output");
    const unicode = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: "Reply exactly: café 'quoted' \"double\"\n第二行. Do not use tools." });
    assert.equal((await terminal(connected, paneId, unicode)).status, "done");
    const long = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: "Run exactly: yes x | head -c 7000" });
    const run = await terminal(connected, paneId, long);
    assert.equal(run.status, "done");
    assert.ok(run.events.some((event) => event.text.length >= 3900), "long output was not streamed");
  });
  await test("agent cancellation stops a long run", async () => {
    const { workspaceId, paneId } = await workspace(connected, "cancel");
    const runId = await connected.mutation(api.workspaces.submitPrompt, { paneId, prompt: `Run exactly and wait: sleep 120 # CANCEL_${workspaceId}` });
    await until(async () => (await connected.query(api.workspaces.paneFeed, { paneId })).find((x) => x._id === runId)?.status === "running", 60_000, "run started");
    await connected.mutation(api.workspaces.cancelRun, { runId });
    assert.equal((await terminal(connected, paneId, runId, 30_000)).status, "cancelled");
    await until(async () => (await execFile("ssh", [HOST, `ps -eo args | grep -F 'CANCEL_${workspaceId}' | grep -v grep || true`], { timeout: 20_000 })).stdout.trim() === "", 30_000, "cancelled process", 1_000);
  });
}
console.log(results.join("\n"));
console.log(`SUMMARY ${results.filter((r) => r.startsWith("PASS")).length} passed, ${results.filter((r) => r.startsWith("SKIP")).length} skipped, ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
