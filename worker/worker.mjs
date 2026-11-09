// Tandem worker: runs on the VM. Watches Convex for queued prompts, runs a
// Jcode agent in the workspace directory as the prompter's own sandboxed Linux
// user (so it bills their subscription), streams output back, and keeps the
// directory and the Convex file mirror in sync both ways.
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AUTH_ERR, clip, translator } from "./events.mjs";

const api = anyApi;
const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
const SECRET = process.env.WORKER_SECRET;
const ROOT = process.env.WORKSPACES_DIR ?? "/srv/tandem/workspaces";
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
  // Batch by size so one mutation never carries more than ~2 MB.
  const batches = [[]];
  let bytes = 0;
  for (const u of upserts) {
    if (bytes + u.content.length > 2_000_000 && batches.at(-1).length) {
      batches.push([]);
      bytes = 0;
    }
    batches.at(-1).push(u);
    bytes += u.content.length;
  }
  for (let i = 0; i < batches.length; i++) {
    if (!batches[i].length && !deletes.length) break;
    await client.mutation(api.worker.syncFiles, {
      ...s,
      workspaceId,
      upserts: batches[i],
      deletes: i === 0 ? deletes : [],
    });
  }
  // Only advance after Convex has everything, so a failed push is retried.
  snapshots.set(workspaceId, now);
}

const syncing = new Set();
async function safeSync(workspaceId) {
  if (syncing.has(workspaceId)) return;
  syncing.add(workspaceId);
  try {
    await syncWorkspace(workspaceId);
  } catch (e) {
    snapshots.delete(workspaceId); // re-diff against Convex next time
    log("sync error", workspaceId, e.message);
  } finally {
    syncing.delete(workspaceId);
  }
}

// Poll every workspace dir. Cheap at toy scale, catches edits made by
// commands as well as by the agent's file tool.
setInterval(() => {
  for (const id of fs.readdirSync(ROOT)) if (!id.startsWith(".")) safeSync(id);
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

// ---------- agent runs (Jcode, as the prompter's sandbox user) ----------

// Every agent and login runs through the root launcher as the account's own
// Linux user, with HOME/JCODE_HOME in that user's private directory. That is
// what keeps one person's subscription tokens away from everyone else.
const SANDBOX = process.env.TANDEM_AS ?? "/usr/local/sbin/tandem-as";
function jcodeAs(sandboxKey, cwd, args) {
  return spawn("sudo", ["-n", SANDBOX, sandboxKey, cwd, "--", "jcode", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runOne(run, job) {
  const dir = dirFor(run.workspaceId);
  const prompt =
    `[Tandem shared workspace. Prompt from ${run.author}. Other people and agents may be ` +
    `editing files in this directory at the same time, so re-read files before editing them. ` +
    `Keep all work inside the current directory.]\n\n${run.prompt}`;
  // Events are written in order: each waits for the previous one.
  let chain = Promise.resolve();
  const emit = (kind, text) =>
    (chain = chain.then(() =>
      client.mutation(api.worker.appendEvent, { ...s, runId: run._id, kind, text }).catch(() => {}),
    ));

  const args = ["run", "--ndjson", "--no-update", "--quiet", "-p", job.provider];
  if (job.model) args.push("-m", job.model);
  if (job.sessionId) args.push("--resume", job.sessionId);
  args.push(prompt);

  log("run", run._id, "as", job.sandboxKey, job.provider, job.sessionId ? "(resume)" : "(new)");
  // Give this member's sandbox user access to this one workspace (idempotent).
  await new Promise((res) => {
    const g = spawn("sudo", ["-n", SANDBOX, job.sandboxKey, dir, "--grant"], { stdio: "ignore" });
    g.on("close", res);
  });
  const child = jcodeAs(job.sandboxKey, dir, args);
  active.set(run._id, child);

  // Stop the agent if anyone hits cancel.
  let cancelled = false;
  const unsub = client.onUpdate(api.worker.runStatus, { ...s, runId: run._id }, (st) => {
    if (st === "cancelled" && !cancelled) {
      cancelled = true;
      child.kill("SIGTERM");
      // sudo forwards SIGTERM to jcode, which stops its tools. Escalate if it hangs.
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 10_000).unref();
    }
  });

  const tr = translator(dir);
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
      for (const e of tr.feed(ev)) {
        // Login problems get one friendly message at the end instead of jcode's raw text.
        if (e.kind === "error" && AUTH_ERR.test(e.text)) continue;
        emit(e.kind, e.text);
      }
      if (tr.takeTouched()) safeSync(run.workspaceId);
    }
  });
  child.stderr.on("data", (c) => (stderr = (stderr + c).slice(-2000)));

  const code = await new Promise((res) => child.on("close", res));
  unsub();
  for (const e of tr.end()) emit(e.kind, e.text);
  active.delete(run._id);
  const failed = tr.failed;
  if (code !== 0 && !cancelled && !failed) emit("error", `agent exited ${code}\n${stderr.trim()}`);
  const why = failed ?? stderr;
  if (code !== 0 && !cancelled && AUTH_ERR.test(why)) {
    emit("error", `${run.author}'s ${job.provider === "claude" ? "Claude" : "ChatGPT"} subscription isn't connected yet. Connect it in Settings, then send this again.`);
    await client.mutation(api.worker.setConnection, {
      ...s, sandboxKey: job.sandboxKey, provider: job.provider, status: "error", detail: clip(why, 280),
    }).catch(() => {});
  } else if (code === 0) {
    // A successful run proves the login works.
    await client.mutation(api.worker.setConnection, {
      ...s, sandboxKey: job.sandboxKey, provider: job.provider, status: "connected",
    }).catch(() => {});
  }
  await chain;
  await safeSync(run.workspaceId);
  await client.mutation(api.worker.finish, {
    ...s,
    runId: run._id,
    status: code === 0 ? "done" : "error",
    sessionId: tr.sessionId ?? undefined,
  });
  log("finished", run._id, code);
}

// ---------- subscription logins ----------

// Run a short jcode command in the user's sandbox and parse its last JSON line.
function jcodeJson(sandboxKey, args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = jcodeAs(sandboxKey, LOGIN_CWD, args);
    let out = "";
    let err = "";
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      clearTimeout(t);
      // Whole output may be one pretty-printed object; else take the last JSON line.
      let json = null;
      try { json = JSON.parse(out.trim()); } catch {
        for (const l of out.trim().split("\n").reverse()) {
          try { json = JSON.parse(l); break; } catch {}
        }
      }
      resolve({ code, json, err: err.trim() });
    });
  });
}
const LOGIN_CWD = path.join(ROOT, ".login");
fs.mkdirSync(LOGIN_CWD, { recursive: true });

const loginBusy = new Set();
async function handleLogin(f) {
  if (loginBusy.has(f._id)) return;
  loginBusy.add(f._id);
  const flowId = `f${String(f._id).replace(/[^A-Za-z0-9]/g, "").slice(0, 60)}`;
  try {
    if (f.status === "starting") {
      const r = await jcodeJson(f.sandboxKey, [
        "login", f.provider, "--print-auth-url", "--json", "--flow-id", flowId, "--no-update", "--no-browser",
      ]);
      if (r.json?.auth_url) {
        await client.mutation(api.worker.loginUpdate, {
          ...s, flowId: f._id, from: "starting", status: "awaiting_code",
          authUrl: r.json.auth_url, inputKind: r.json.input_kind ?? "auth_code_or_callback_url",
        });
        log("login url ready", f.provider, f.sandboxKey);
      } else {
        await client.mutation(api.worker.loginUpdate, {
          ...s, flowId: f._id, from: "starting", status: "error", error: r.json?.error ?? (r.err || "could not start login"),
        });
      }
    } else if (f.status === "submitting") {
      const code = f.code ?? "";
      const asUrl = /^https?:\/\//.test(code) || code.startsWith("?") || code.includes("code=");
      const r = await jcodeJson(f.sandboxKey, [
        "login", f.provider, "--json", "--flow-id", flowId, "--no-update",
        asUrl ? "--callback-url" : "--auth-code", code,
      ], 90_000);
      // Don't trust the exit code alone: ask jcode whether this sandbox now
      // actually has a usable login for the provider.
      const st = await jcodeJson(f.sandboxKey, ["auth", "status", "--json", "--no-update"], 60_000);
      const prov = st.json?.providers?.find((p) => p.id === f.provider);
      const ok = r.code === 0 && prov?.status === "available";
      const err = (r.err || r.json?.error || r.json?.message || "login failed")
        .toString().split("\n")[0].replace(/^Error:\s*/, "");
      await client.mutation(api.worker.loginUpdate, {
        ...s, flowId: f._id, from: "submitting", status: ok ? "done" : "error",
        error: ok ? undefined : /state mismatch/i.test(err)
          ? "That code didn't match this sign-in. Click Try again and paste the newest code."
          : err,
      });
      log("login finished", f.provider, f.sandboxKey, ok ? "ok" : `failed (${prov?.status ?? "?"})`);
    }
  } catch (e) {
    log("login error", e.message);
  } finally {
    loginBusy.delete(f._id);
  }
}
client.onUpdate(api.worker.loginQueue, s, (flows) => {
  for (const f of flows) handleLogin(f);
});

const stale = await client.mutation(api.worker.failStale, s);
if (stale) log("marked", stale, "stale runs as error");

// Cap parallel agents so a burst of prompts can't swamp a small VM. Extra
// runs just stay queued until a slot frees up.
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE ?? 4);
let dispatching = false;
async function dispatch(runs) {
  if (dispatching) return;
  dispatching = true;
  try {
    for (const run of runs) {
      if (active.size >= MAX_ACTIVE) break;
      if (active.has(run._id)) continue;
      const claimed = await client.mutation(api.worker.claim, { ...s, runId: run._id }).catch(() => null);
      if (!claimed) continue;
      active.set(run._id, null); // reserve the slot before spawning
      runOne(claimed.run, claimed)
        .catch((e) => log("run error", e))
        .finally(() => {
          active.delete(run._id);
          poll();
        });
    }
  } finally {
    dispatching = false;
  }
}
const poll = () => client.query(api.worker.queued, s).then(dispatch).catch(() => {});

// Convex pushes the queue to us the moment anyone submits a prompt.
client.onUpdate(api.worker.queued, s, dispatch);

// Safety net in case a push is dropped while we were busy dispatching.
setInterval(poll, 3000);

log("tandem worker up", URL, ROOT);
