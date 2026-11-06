// Live, black-box QA for Tandem.
// Run: CONVEX_URL=https://backend WORKER_HOST=myvm WORKSPACES_DIR=/home/me/tandem-workspaces node tests/codex/tandem-e2e.mjs
// WORKER_HOST is an ssh host used to inspect the worker box (disk contents, processes).
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const execFile = promisify(execFileCb);
const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
const HOST = process.env.WORKER_HOST ?? "localhost";
const WS_DIR = process.env.WORKSPACES_DIR ?? "~/tandem-workspaces";
const api = anyApi;
const http = new ConvexHttpClient(URL);
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function eventually(check, timeout = 90_000, every = 500) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(every);
  }
  throw last ?? new Error(`timed out after ${timeout}ms`);
}

async function workspace(label) {
  const id = await http.mutation(api.workspaces.create, {
    name: `codex-test ${stamp} ${label}`,
    user: "codex-qa",
  });
  const panes = await http.query(api.workspaces.listPanes, { workspaceId: id });
  return { id, main: panes[0]._id };
}

async function feed(paneId) {
  return http.query(api.workspaces.paneFeed, { paneId });
}

async function runDone(paneId, runId, timeout = 90_000) {
  return eventually(async () => {
    const run = (await feed(paneId)).find((r) => r._id === runId);
    if (run?.status === "error") throw new Error(`agent error: ${JSON.stringify(run.events)}`);
    return run?.status === "done" ? run : false;
  }, timeout);
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.stack ?? String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await test("empty workspace and two-user presence", async () => {
  const { id } = await workspace("presence");
  assert.deepEqual(await http.query(api.files.tree, { workspaceId: id }), []);
  await Promise.all([
    http.mutation(api.presence.heartbeat, { workspaceId: id, name: "codex-alice", color: "#111111" }),
    http.mutation(api.presence.heartbeat, { workspaceId: id, name: "codex-bob", color: "#222222" }),
  ]);
  const people = await eventually(async () => {
    const rows = await http.query(api.presence.list, { workspaceId: id, now: Date.now() });
    return rows.length === 2 ? rows : false;
  });
  assert.deepEqual(new Set(people.map((p) => p.name)), new Set(["codex-alice", "codex-bob"]));
});

await test("worker functions reject calls without the secret", async () => {
  const { id, main } = await workspace("worker-auth");
  const runId = await http.mutation(api.workspaces.submitPrompt, { paneId: main, prompt: "noop", author: "codex" });
  const attempts = [
    ["queued", () => http.query(api.worker.queued, { secret: "" })],
    ["claim", () => http.mutation(api.worker.claim, { secret: "", runId })],
    ["runStatus", () => http.query(api.worker.runStatus, { secret: "", runId })],
    ["appendEvent", () => http.mutation(api.worker.appendEvent, { secret: "", runId, kind: "message", text: "x" })],
    ["finish", () => http.mutation(api.worker.finish, { secret: "", runId, status: "done" })],
    ["syncFiles", () => http.mutation(api.worker.syncFiles, { secret: "", workspaceId: id, upserts: [], deletes: [] })],
    ["filePaths", () => http.query(api.worker.filePaths, { secret: "", workspaceId: id })],
    ["pendingWrites", () => http.query(api.worker.pendingWrites, { secret: "" })],
    ["markWritten", () => http.mutation(api.worker.markWritten, { secret: "", fileId: "invalid" })],
  ];
  for (const [label, call] of attempts) await assert.rejects(call, /unauthorized|ArgumentValidationError/, label);
  await http.mutation(api.workspaces.cancelRun, { runId });
});

await test("file path validation rejects traversal and absolute paths", async () => {
  const { id } = await workspace("paths");
  for (const path of ["../x", "/etc/x", "", "a/../../x"]) {
    await assert.rejects(() => http.mutation(api.files.save, { workspaceId: id, path, content: "bad", user: "codex" }), /bad path/);
  }
});

await test("two panes run concurrently and subscribed output arrives before finish", async () => {
  const { id, main } = await workspace("concurrent");
  const second = await http.mutation(api.workspaces.addPane, { workspaceId: id, title: "Second" });
  const client = new ConvexClient(URL);
  let sawEventBeforeDone = false;
  let unsub;
  try {
    unsub = client.onUpdate(api.workspaces.paneFeed, { paneId: main }, (runs) => {
      const run = runs.find((r) => r.prompt.includes("CONCURRENT_A"));
      if (run?.events.length && run.status !== "done") sawEventBeforeDone = true;
    });
    const [a, b] = await Promise.all([
      http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex-alice", prompt: "Run this shell command exactly, then reply done: printf CONCURRENT_A; sleep 8; printf A_END" }),
      http.mutation(api.workspaces.submitPrompt, { paneId: second, author: "codex-bob", prompt: "Run this shell command exactly, then reply done: printf CONCURRENT_B; sleep 8; printf B_END" }),
    ]);
    await eventually(async () => {
      const [fa, fb] = await Promise.all([feed(main), feed(second)]);
      const ra = fa.find((r) => r._id === a);
      const rb = fb.find((r) => r._id === b);
      return ra?.status === "running" && rb?.status === "running";
    }, 45_000);
    await Promise.all([runDone(main, a), runDone(second, b)]);
    await eventually(() => sawEventBeforeDone, 10_000);
  } finally {
    unsub?.();
    client.close();
  }
});

await test("three rapid prompts in one pane are ordered and run once", async () => {
  const { main } = await workspace("queue");
  const tokens = ["QUEUE_ONE", "QUEUE_TWO", "QUEUE_THREE"];
  const ids = await Promise.all(tokens.map((token) => http.mutation(api.workspaces.submitPrompt, {
    paneId: main, author: "codex", prompt: `Run exactly this shell command and then stop: printf '${token}\\n' >> queue.log`,
  })));
  await Promise.all(ids.map((id) => runDone(main, id, 150_000)));
  const data = await eventually(async () => {
    const file = await http.query(api.files.get, { workspaceId: (await http.query(api.workspaces.list, {})).find((x) => x.name.includes(`${stamp} queue`))._id, path: "queue.log" });
    return file?.content === `${tokens.join("\n")}\n` ? file.content : false;
  }, 30_000);
  assert.equal(data, `${tokens.join("\n")}\n`);
  const rows = await feed(main);
  assert.deepEqual(ids.map((id) => rows.findIndex((r) => r._id === id)), [0, 1, 2]);
  assert(ids.every((id) => rows.filter((r) => r._id === id).length === 1));
});

await test("follow-up retains the pane conversation context", async () => {
  const { main } = await workspace("context");
  const token = `CONTEXT_${stamp}`;
  const first = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: `Reply with exactly ${token}. Do not use tools or write files.` });
  await runDone(main, first);
  const second = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: "What exact token did you just give me? Reply with only that token. Do not use tools." });
  const done = await runDone(main, second);
  assert(done.events.some((e) => e.text.includes(token)), "follow-up did not remember the previous response");
});

await test("agent file sync, browser overwrite, deletion, binary/big skip", async () => {
  const { id, main } = await workspace("files");
  const create = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: "Run exactly: mkdir -p nested/deeper; printf 'agent-one' > nested/deeper/agent.txt; printf '\\0BIN' > binary.dat; dd if=/dev/zero of=big.dat bs=400001 count=1 status=none" });
  await runDone(main, create);
  await eventually(async () => {
    const rows = await http.query(api.files.tree, { workspaceId: id });
    return rows.some((f) => f.path === "nested/deeper/agent.txt") && !rows.some((f) => f.path === "binary.dat" || f.path === "big.dat");
  }, 30_000);
  let f = await http.query(api.files.get, { workspaceId: id, path: "nested/deeper/agent.txt" });
  assert.equal(f?.content, "agent-one");
  await http.mutation(api.files.save, { workspaceId: id, path: "nested/deeper/agent.txt", content: "browser-two", user: "codex-browser" });
  await eventually(async () => (await http.query(api.files.get, { workspaceId: id, path: "nested/deeper/agent.txt" }))?.pendingWrite === false, 30_000);
  const disk = await execFile("ssh", [HOST, `cat ${WS_DIR}/${id}/nested/deeper/agent.txt`], { timeout: 20_000 });
  assert.equal(disk.stdout, "browser-two");
  const remove = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: "Run exactly this shell command and then stop: rm nested/deeper/agent.txt" });
  await runDone(main, remove);
  await eventually(async () => !(await http.query(api.files.tree, { workspaceId: id })).some((x) => x.path === "nested/deeper/agent.txt"), 30_000);
});

await test("unicode quotes/newlines and long output complete", async () => {
  const { main } = await workspace("edge-output");
  const special = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: "Reply exactly with: café 'quoted' \"double\"\n第二行. Do not use tools." });
  await runDone(main, special);
  const long = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: "Run exactly this shell command and then stop: yes x | head -c 7000" });
  const done = await runDone(main, long);
  assert(done.events.some((e) => e.text.length >= 3900), "long output was not streamed/clipped as a command event");
});

await test("cancelled run stays cancelled and its codex process disappears", async () => {
  const { id, main } = await workspace("cancel");
  const runId = await http.mutation(api.workspaces.submitPrompt, { paneId: main, author: "codex", prompt: `Run exactly this shell command and wait for it: sleep 120 # CANCEL_${id}` });
  await eventually(async () => (await feed(main)).find((r) => r._id === runId)?.status === "running", 45_000);
  await http.mutation(api.workspaces.cancelRun, { runId });
  await eventually(async () => (await feed(main)).find((r) => r._id === runId)?.status === "cancelled", 20_000);
  await eventually(async () => {
    const { stdout } = await execFile("ssh", [HOST, `ps -eo args | grep -F 'CANCEL_${id}' | grep -v grep || true`], { timeout: 20_000 });
    return stdout.trim() === "";
  }, 30_000, 1_000);
});

await test("removing a running pane does not strand its run", async () => {
  const { id, main } = await workspace("remove-pane");
  const second = await http.mutation(api.workspaces.addPane, { workspaceId: id, title: "Disposable" });
  const runId = await http.mutation(api.workspaces.submitPrompt, { paneId: second, author: "codex", prompt: "Run exactly this shell command and then stop: sleep 5" });
  await eventually(async () => (await feed(second)).find((r) => r._id === runId)?.status === "running", 45_000);
  await http.mutation(api.workspaces.removePane, { paneId: second });
  await sleep(12_000);
  // paneFeed remains callable after deletion, which lets us detect a stranded run.
  const run = (await feed(second)).find((r) => r._id === runId);
  assert(run && ["done", "cancelled", "error"].includes(run.status), `run stranded after pane deletion: ${run?.status}`);
});

console.log("\nRESULTS\n" + results.map((r) => `${r.status} ${r.name}${r.error ? `\n${r.error}` : ""}`).join("\n"));
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
