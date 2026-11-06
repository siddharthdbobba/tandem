// Tandem worker: runs on the VM. Watches Convex for queued prompts, runs the
// Codex agent in the workspace directory, streams output back, and keeps the
// directory and the Convex file mirror in sync both ways.
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const api = anyApi;
const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
const SECRET = process.env.WORKER_SECRET;
const ROOT = process.env.WORKSPACES_DIR ?? path.join(process.env.HOME, "tandem-workspaces");
const MAX_FILE = 400_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", "dist", ".next"]);

if (!SECRET) throw new Error("WORKER_SECRET is required");
fs.mkdirSync(ROOT, { recursive: true });
const client = new ConvexClient(URL);
const s = { secret: SECRET };

const active = new Map(); // runId -> child process
const snapshots = new Map(); // workspaceId -> Map(path -> content)
const log = (...a) => console.log(new Date().toISOString(), ...a);

const dirFor = (workspaceId) => {
  const d = path.join(ROOT, workspaceId);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---------- file sync: disk -> Convex ----------

function readTree(dir) {
  const out = new Map();
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(path.join(abs, ent.name), path.join(rel, ent.name));
      } else if (ent.isFile()) {
        const p = path.join(abs, ent.name);
        if (fs.statSync(p).size > MAX_FILE) continue;
        const buf = fs.readFileSync(p);
        if (buf.includes(0)) continue; // binary
        out.set(path.join(rel, ent.name), buf.toString("utf8"));
      }
    }
  };
  walk(dir, "");
  return out;
}

async function syncWorkspace(workspaceId) {
  const now = readTree(dirFor(workspaceId));
  let prev = snapshots.get(workspaceId);
  if (!prev) {
    // First sync after start: diff against what Convex has.
    const paths = await client.query(api.worker.filePaths, { ...s, workspaceId });
    prev = new Map(paths.map((p) => [p, null]));
  }
  const upserts = [];
  for (const [p, c] of now) if (prev.get(p) !== c) upserts.push({ path: p, content: c });
  const deletes = [...prev.keys()].filter((p) => !now.has(p));
  snapshots.set(workspaceId, now);
  for (let i = 0; i < Math.max(upserts.length, 1); i += 25) {
    const batch = upserts.slice(i, i + 25);
    if (!batch.length && !deletes.length) break;
    await client.mutation(api.worker.syncFiles, {
      ...s,
      workspaceId,
      upserts: batch,
      deletes: i === 0 ? deletes : [],
    });
  }
}

const syncing = new Set();
async function safeSync(workspaceId) {
  if (syncing.has(workspaceId)) return;
  syncing.add(workspaceId);
  try {
    await syncWorkspace(workspaceId);
  } catch (e) {
    log("sync error", workspaceId, e.message);
  } finally {
    syncing.delete(workspaceId);
  }
}

// Poll every workspace dir. Cheap at toy scale, catches edits made by
// commands as well as by the agent's file tool.
setInterval(() => {
  for (const id of fs.readdirSync(ROOT)) safeSync(id);
}, 2000);

// ---------- file sync: Convex -> disk ----------

client.onUpdate(api.worker.pendingWrites, s, async (files) => {
  for (const f of files) {
    const abs = path.join(dirFor(f.workspaceId), f.path);
    if (!abs.startsWith(dirFor(f.workspaceId) + path.sep)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
    snapshots.get(f.workspaceId)?.set(f.path, f.content);
    await client.mutation(api.worker.markWritten, { ...s, fileId: f._id, content: f.content });
    log("wrote", f.workspaceId, f.path, "by", f.updatedBy);
  }
});

// ---------- agent runs ----------

const clip = (t, n = 4000) => (t.length > n ? t.slice(0, n) + `\n... (${t.length - n} more chars)` : t);

function codexArgs(threadId, prompt) {
  const common = ["--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
  return threadId
    ? ["exec", "resume", ...common, threadId, prompt]
    : ["exec", ...common, prompt];
}

async function runOne(run, threadId) {
  const dir = dirFor(run.workspaceId);
  const prompt =
    `[Tandem shared workspace. Prompt from ${run.author}. Other people and agents may be ` +
    `editing files in this directory at the same time, so re-read files before editing them. ` +
    `Keep all work inside the current directory.]\n\n${run.prompt}`;
  const emit = (kind, text) =>
    client.mutation(api.worker.appendEvent, { ...s, runId: run._id, kind, text }).catch(() => {});

  log("run", run._id, "pane", run.paneId, threadId ? "(resume)" : "(new)");
  const child = spawn("codex", codexArgs(threadId, prompt), {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.set(run._id, child);

  // Stop the agent if anyone hits cancel.
  const unsub = client.onUpdate(api.worker.runStatus, { ...s, runId: run._id }, (st) => {
    if (st === "cancelled") child.kill("SIGTERM");
  });

  let newThread = null;
  let buf = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "thread.started") newThread = ev.thread_id;
      const it = ev.item;
      if (ev.type === "item.completed" && it) {
        if (it.type === "agent_message") emit("message", it.text);
        else if (it.type === "command_execution")
          emit("command", `$ ${it.command}\n${clip(it.aggregated_output ?? "")}`);
        else if (it.type === "file_change" && it.status === "completed")
          emit(
            "file",
            it.changes.map((c) => `${c.kind} ${path.relative(dir, c.path) || c.path}`).join("\n"),
          );
        if (it.type !== "agent_message") safeSync(run.workspaceId);
      }
      if (ev.type === "error" || ev.type === "turn.failed")
        emit("error", ev.message ?? ev.error?.message ?? JSON.stringify(ev));
    }
  });
  child.stderr.on("data", (c) => (stderr = (stderr + c).slice(-2000)));

  const code = await new Promise((res) => child.on("close", res));
  unsub();
  active.delete(run._id);
  if (code !== 0 && !child.killed) await emit("error", `agent exited ${code}\n${stderr}`);
  await safeSync(run.workspaceId);
  await client.mutation(api.worker.finish, {
    ...s,
    runId: run._id,
    status: code === 0 ? "done" : "error",
    threadId: newThread ?? threadId ?? undefined,
  });
  log("finished", run._id, code);
}

// Convex pushes the queue to us the moment anyone submits a prompt.
client.onUpdate(api.worker.queued, s, async (runs) => {
  for (const run of runs) {
    if (active.has(run._id)) continue;
    const claimed = await client.mutation(api.worker.claim, { ...s, runId: run._id });
    if (claimed) runOne(claimed.run, claimed.threadId).catch((e) => log("run error", e));
  }
});

// When a run finishes, other queued runs on the same pane become claimable.
// Re-check the queue on an interval as a simple safety net.
setInterval(async () => {
  const runs = await client.query(api.worker.queued, s).catch(() => []);
  for (const run of runs) {
    if (active.has(run._id)) continue;
    const claimed = await client.mutation(api.worker.claim, { ...s, runId: run._id }).catch(() => null);
    if (claimed) runOne(claimed.run, claimed.threadId).catch((e) => log("run error", e));
  }
}, 3000);

log("tandem worker up", URL, ROOT);
