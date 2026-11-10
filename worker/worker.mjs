// Tandem worker: runs on the VM. Watches Convex for queued prompts, runs a
// Jcode agent in the workspace directory as the prompter's own sandboxed Linux
// user (so it bills their subscription), streams output back, and keeps the
// directory and the Convex file mirror in sync both ways.
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
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
const MAX_POKES = 3;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const dirFor = (workspaceId) => {
  const d = path.join(ROOT, workspaceId);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---------- file sync: disk -> Convex ----------

// Binary files (images, PDFs...) sync through Convex file storage, up to this size.
const MAX_BINARY = 20_000_000;
const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", ico: "image/x-icon", pdf: "application/pdf", zip: "application/zip",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
};
const mimeOf = (p) => MIME[path.extname(p).slice(1).toLowerCase()] ?? "application/octet-stream";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
// A snapshot value for a binary file: its hash, so changes are detected cheaply.
const BIN = "\u0000sha256:";

function readTree(dir) {
  const out = new Map();
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(path.join(abs, ent.name), path.join(rel, ent.name));
      } else if (ent.isFile()) {
        const p = path.join(abs, ent.name);
        const r = path.join(rel, ent.name);
        if (r.startsWith(".tandem" + path.sep)) continue; // browser frames etc.: not files
        const size = fs.statSync(p).size;
        if (size > MAX_BINARY) continue;
        const buf = fs.readFileSync(p);
        const text = size <= MAX_FILE && !buf.includes(0) && !/\.(pdf|png|jpe?g|gif|webp|ico|zip|mp[34]|wav|webm|woff2?|ttf)$/i.test(r);
        out.set(r, text ? buf.toString("utf8") : BIN + sha(buf));
      }
    }
  };
  walk(dir, "");
  return out;
}

async function uploadBinary(workspaceId, rel) {
  const abs = path.join(dirFor(workspaceId), rel);
  const buf = fs.readFileSync(abs);
  const storageId = await upload(buf, mimeOf(rel));
  await client.mutation(api.worker.putBinary, { ...s, workspaceId, path: rel, blob: storageId, mime: mimeOf(rel) });
}

// Upload bytes to Convex storage over the local backend URL.
async function upload(buf, type) {
  const u = new globalThis.URL(await client.mutation(api.worker.uploadUrl, s));
  const res = await fetch(URL.replace(/\/$/, "") + u.pathname + u.search, { method: "POST", headers: { "Content-Type": type }, body: buf });
  if (!res.ok) throw new Error(`upload: ${res.status}`);
  return (await res.json()).storageId;
}

// ---------- live browser view ----------

// While an agent runs, push its browser's newest screenshot to Convex.
// The browser folder is writable by sandboxed agents, so never follow a
// symlink there: the worker (not the agent) would be the one reading/writing.
function browserDir(workspaceId) {
  const root = dirFor(workspaceId);
  const dir = path.join(root, ".tandem", "browser");
  try {
    if (fs.realpathSync(dir) !== dir) return null;
  } catch { return null; }
  return dir;
}
function readPlain(file, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > max) throw new Error("not a plain file");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
const frameSeen = new Map(); // workspaceId -> live.json mtime
async function pushFrame(workspaceId, by) {
  const dir = browserDir(workspaceId);
  if (!dir) return;
  try {
    const metaPath = path.join(dir, "live.json");
    const st = fs.lstatSync(metaPath);
    if (frameSeen.get(workspaceId) === st.mtimeMs) return;
    frameSeen.set(workspaceId, st.mtimeMs);
    const meta = JSON.parse(readPlain(metaPath, 20_000).toString("utf8"));
    const img = readPlain(path.join(dir, "live.jpg"), 5_000_000);
    const image = await upload(img, "image/jpeg");
    await client.mutation(api.worker.putFrame, {
      ...s, workspaceId, image, url: String(meta.url ?? ""), title: String(meta.title ?? ""), by,
    });
  } catch {}
}

// People taking control of the live browser: append their actions to the
// workspace's input.jsonl, which the browser wrapper replays.
const liveWorkspaces = new Map(); // workspaceId -> number of running runs
let inputBusy = false;
client.onUpdate(api.browser.pending, s, async (rows) => {
  if (inputBusy || !rows.length) return;
  inputBusy = true;
  try {
    for (const r of rows) {
      const dir = liveWorkspaces.get(r.workspaceId) ? browserDir(r.workspaceId) : null;
      if (dir) {
        try {
          const fd = fs.openSync(path.join(dir, "input.jsonl"),
            fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o660);
          try {
            if (fs.fstatSync(fd).isFile()) fs.writeSync(fd, JSON.stringify(r.action) + "\n");
          } finally { fs.closeSync(fd); }
        } catch (e) { log("browser input failed", e.message); }
      }
    }
    await client.mutation(api.browser.done, { ...s, ids: rows.map((r) => r._id) });
  } catch (e) {
    log("browser input error", e.message);
  } finally {
    inputBusy = false;
  }
});

async function syncWorkspace(workspaceId) {
  const now = readTree(dirFor(workspaceId));
  let prev = snapshots.get(workspaceId);
  if (!prev) {
    // First sync after start: diff against what Convex has.
    const paths = await client.query(api.worker.filePaths, { ...s, workspaceId });
    prev = new Map(paths.map((p) => [p, null]));
    for (const b of await client.query(api.worker.binaryHashes, { ...s, workspaceId })) prev.set(b.path, BIN + b.hash);
  }
  const upserts = [];
  const binaries = [];
  for (const [p, c] of now) {
    if (prev.get(p) === c) continue;
    if (c.startsWith(BIN)) binaries.push(p);
    else upserts.push({ path: p, content: c });
  }
  for (const p of binaries) await uploadBinary(workspaceId, p);
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
    if (f.blob) {
      // Uploaded binary: fetch from storage and check the hash before writing.
      try {
        const local = new globalThis.URL(f.blobUrl);
        const buf = Buffer.from(await (await fetch(URL.replace(/\/$/, "") + local.pathname + local.search)).arrayBuffer());
        if (sha(buf) !== f.hash) throw new Error("hash mismatch");
        fs.writeFileSync(abs, buf);
        snapshots.get(f.workspaceId)?.set(f.path, BIN + f.hash);
        await client.mutation(api.worker.markWritten, { ...s, fileId: f._id, content: f.hash });
        log("wrote binary", f.workspaceId, f.path, "by", f.updatedBy);
      } catch (e) {
        log("binary write failed", f.path, e.message);
      }
      continue;
    }
    fs.writeFileSync(abs, f.content);
    snapshots.get(f.workspaceId)?.set(f.path, f.content);
    await client.mutation(api.worker.markWritten, { ...s, fileId: f._id, content: f.content });
    log("wrote", f.workspaceId, f.path, "by", f.updatedBy);
  }
});

// ---------- deletions from the browser -> disk ----------

client.onUpdate(api.worker.pendingDeletions, s, async (rows) => {
  for (const d of rows) {
    try {
      const root = dirFor(d.workspaceId);
      const abs = path.join(root, d.path);
      if (abs.startsWith(root + path.sep)) {
        // Refuse to follow symlinks out of the workspace; lstat the target itself.
        const st = fs.lstatSync(abs, { throwIfNoEntry: false });
        if (st && (st.isFile() || st.isSymbolicLink())) fs.unlinkSync(abs);
        snapshots.get(d.workspaceId)?.delete(d.path);
      }
    } catch (e) {
      log("delete failed", d.path, e.message);
    }
    await client.mutation(api.worker.doneDeletion, { ...s, id: d._id }).catch(() => {});
  }
});

// ---------- per-run change log (diff + undo) ----------

const MAX_DIFF_TEXT = 200_000;
async function recordChanges(run, dir, before) {
  const after = readTree(dir);
  const items = [];
  for (const [p, c] of after) {
    const old = before.get(p);
    if (old === c) continue;
    const bin = c.startsWith(BIN) || (old ?? "").startsWith(BIN);
    items.push({
      path: p,
      kind: old === undefined ? "added" : "modified",
      binary: bin,
      before: bin || old === undefined ? undefined : old.slice(0, MAX_DIFF_TEXT),
      after: bin ? undefined : c.slice(0, MAX_DIFF_TEXT),
    });
  }
  for (const [p, old] of before) {
    if (after.has(p)) continue;
    const bin = old.startsWith(BIN);
    items.push({ path: p, kind: "deleted", binary: bin, before: bin ? undefined : old.slice(0, MAX_DIFF_TEXT) });
  }
  if (!items.length) return;
  // Keep each mutation well under Convex's argument size limit.
  let batch = [], bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await client.mutation(api.worker.recordChanges, { ...s, runId: run._id, items: batch });
    batch = []; bytes = 0;
  };
  for (const it of items.slice(0, 200)) {
    const size = (it.before?.length ?? 0) + (it.after?.length ?? 0);
    if (bytes + size > 1_500_000) await flush();
    batch.push(it); bytes += size;
  }
  await flush();
}

// ---------- agent runs (Jcode, as the prompter's sandbox user) ----------

// Every agent and login runs through the root launcher as the account's own
// Linux user, with HOME/JCODE_HOME in that user's private directory. That is
// what keeps one person's subscription tokens away from everyone else.
const SANDBOX = process.env.TANDEM_AS ?? "/usr/local/sbin/tandem-as";
// Run a launcher subcommand (grant, session hand-off) and return its stdout.
const sandboxCmd = (argv) =>
  new Promise((res) => {
    let out = "";
    const p = spawn("sudo", ["-n", SANDBOX, ...argv], { stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.on("data", (c) => (out += c));
    p.on("close", () => res(out));
  });
function jcodeAs(sandboxKey, cwd, args, effort, autoPoke) {
  const pre = [...(effort ? ["--effort", effort] : []), ...(autoPoke ? ["--auto-poke"] : [])];
  return spawn("sudo", ["-n", SANDBOX, sandboxKey, cwd, "--", "jcode", ...pre, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runOne(run, job) {
  const dir = dirFor(run.workspaceId);
  const prompt =
    `[Tandem shared workspace. Prompt from ${run.author}. Other people and agents may be ` +
    `editing files in this directory at the same time, so re-read files before editing them. ` +
    `Keep all work inside the current directory, and refer to files by paths relative to it ` +
    `(never mention the absolute directory path). Format replies in Markdown. You have a ` +
    `private, logged-out web browser via the browser_* tools; people in the workspace can watch it live.]\n\n` +
    (run.steer
      ? `[${run.author} interrupted your previous turn to steer you. Your last tool call may not have ` +
        `finished; check before assuming it ran. Adjust course using this message:]\n\n`
      : "") +
    (job.instructions ? `[Workspace instructions from the group:]\n${job.instructions}\n\n` : "") +
    (run.context ? `[${run.context}]\n\n` : "") +
    run.prompt;
  // Events are written in order: each waits for the previous one.
  let chain = Promise.resolve();
  const emit = (kind, text) =>
    (chain = chain.then(() =>
      client.mutation(api.worker.appendEvent, { ...s, runId: run._id, kind, text }).catch(() => {}),
    ));

  // Tandem's own browser (MCP, logged out, watched live) replaces Jcode's desktop-bridge browser.
  const args = ["run", "--ndjson", "--no-update", "--quiet", "-p", job.provider, "--disabled-tools", "browser", "--mcp-tools", "eager"];
  if (job.model) args.push("-m", job.model);

  log("run", run._id, "as", job.sandboxKey, job.provider, job.model ?? "", job.effort ?? "");
  // Give this member's sandbox user access to this one workspace (idempotent).
  await sandboxCmd([job.sandboxKey, dir, "--grant"]);
  // One memory per pane: hand the pane's session to whoever is prompting now.
  const paneKey = String(run.paneId);
  const shared = (await sandboxCmd([job.sandboxKey, dir, "--put-session", paneKey])).trim();
  if (/^session_[a-z0-9_]+$/.test(shared)) args.push("--resume", shared);
  args.push(prompt);
  const child = jcodeAs(job.sandboxKey, dir, args, job.effort, job.autoPoke);
  active.set(run._id, child);
  // Snapshot the folder so we can show (and undo) exactly what this run changed.
  let before = null;
  try { before = readTree(dir); } catch {}
  // Stream the agent's browser to everyone watching.
  const frames = setInterval(() => pushFrame(run.workspaceId, run.author), 700);
  liveWorkspaces.set(run.workspaceId, (liveWorkspaces.get(run.workspaceId) ?? 0) + 1);

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
  let pokes = 0;
  let capped = false;
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
      // Re-prompting is opt-in and capped so a stuck agent can't drain a subscription.
      if (ev.type === "auto_poke" && ++pokes > MAX_POKES && !capped && !cancelled) {
        capped = true;
        emit("error", `Stopped after ${MAX_POKES} automatic follow-ups with todos still open. Send a prompt to continue.`);
        child.kill("SIGTERM");
        setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 10_000).unref();
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
  clearInterval(frames);
  const left = (liveWorkspaces.get(run.workspaceId) ?? 1) - 1;
  if (left > 0) liveWorkspaces.set(run.workspaceId, left); else liveWorkspaces.delete(run.workspaceId);
  await pushFrame(run.workspaceId, run.author);
  const ok = code === 0 || capped;
  unsub();
  for (const e of tr.end()) emit(e.kind, e.text);
  active.delete(run._id);
  const failed = tr.failed;
  if (!ok && !cancelled && !failed) emit("error", `agent exited ${code}\n${stderr.trim()}`);
  const why = failed ?? stderr;
  if (!ok && !cancelled && AUTH_ERR.test(why)) {
    emit("error", `${run.author}'s ${job.provider === "claude" ? "Claude" : "ChatGPT"} subscription isn't connected yet. Connect it in Settings, then send this again.`);
    await client.mutation(api.worker.setConnection, {
      ...s, sandboxKey: job.sandboxKey, provider: job.provider, status: "error", detail: clip(why, 280),
    }).catch(() => {});
  } else if (ok) {
    // A successful run proves the login works.
    await client.mutation(api.worker.setConnection, {
      ...s, sandboxKey: job.sandboxKey, provider: job.provider, status: "connected",
    }).catch(() => {});
  }
  await chain;
  await safeSync(run.workspaceId);
  if (before) await recordChanges(run, dir, before).catch((e) => log("changes error", e.message));
  // Save the conversation back as the pane's shared memory (also after a stop/steer).
  if (tr.sessionId && /^session_[a-z0-9_]+$/.test(tr.sessionId)) {
    await sandboxCmd([job.sandboxKey, dir, "--take-session", paneKey, tr.sessionId]);
  }
  await client.mutation(api.worker.finish, {
    ...s,
    runId: run._id,
    status: ok ? "done" : "error",
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

// ---------- per-person app connectors (remote MCP servers) ----------

// Run a launcher subcommand with stdin and wait for it to exit.
const sandboxIn = (argv, input) =>
  new Promise((res) => {
    let err = "";
    const p = spawn("sudo", ["-n", SANDBOX, ...argv], { stdio: ["pipe", "ignore", "pipe"] });
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (code) => res({ code, err: err.trim() }));
    p.stdin.end(input);
  });
// Run a jcode command in the user's sandbox and collect its text output.
function jcodeText(sandboxKey, args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = jcodeAs(sandboxKey, LOGIN_CWD, args);
    let out = "";
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
// jcode only reads mcp.json when the launcher writes it at the start of a
// jcode run, so every connector command goes through jcodeText/jcodeAs.
async function testConnector(c) {
  const r = await jcodeText(c.sandboxKey, ["mcp", "test", c.name], 60_000);
  const n = Number((r.out.match(/Tools: (\d+)/) ?? [])[1]);
  return r.code === 0 && Number.isFinite(n) ? { ok: true, tools: n } : { ok: false, out: r.out };
}
const firstLine = (t) => (t || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-1)[0]?.replace(/^Error:\s*/, "").slice(0, 200) || "Couldn't connect";

const pendingOAuth = new Map(); // connector id -> { child, port, state, done: Promise }
const connBusy = new Set();
async function handleConnector(c) {
  if (connBusy.has(c._id)) return;
  connBusy.add(c._id);
  const upd = (from, status, extra = {}) => client.mutation(api.connectors.update, { ...s, id: c._id, from, status, ...extra }).catch(() => {});
  try {
    if (c.status === "removing") {
      pendingOAuth.get(c._id)?.child.kill("SIGTERM");
      pendingOAuth.delete(c._id);
      await jcodeText(c.sandboxKey, ["mcp", "logout", c.name], 30_000);
      const r = await sandboxIn([c.sandboxKey, LOGIN_CWD, "--remove-connector", c.name], "");
      if (r.code !== 0) log("remove connector failed", c.name, r.err);
      await upd("removing", "deleted");
      log("connector removed", c.name, c.sandboxKey);
      return;
    }
    if (c.status === "adding") {
      const body = JSON.stringify({ url: c.url, ...(c.token ? { token: c.token } : {}) });
      const r = await sandboxIn([c.sandboxKey, LOGIN_CWD, "--add-connector", c.name], body);
      if (r.code !== 0) return void (await upd("adding", "error", { error: r.err || "Couldn't save that app" }));
      // Already works (no sign-in needed, or a token)? Then we're done.
      const t = await testConnector(c);
      if (t.ok) {
        await upd("adding", "connected", { tools: t.tools });
        log("connector connected", c.name, c.sandboxKey, t.tools, "tools");
        return;
      }
      if (c.auth !== "oauth") return void (await upd("adding", "error", { error: firstLine(t.out) }));
      // Start the OAuth sign-in. jcode waits (up to 5 min) for the browser to
      // hit its loopback callback; the person pastes that URL back to us.
      const child = jcodeAs(c.sandboxKey, LOGIN_CWD, ["mcp", "login", c.name, "--no-browser"]);
      let out = "";
      const done = new Promise((res) => child.on("close", (code) => res({ code, out })));
      const authUrl = await new Promise((res) => {
        const t = setTimeout(() => res(null), 45_000);
        const onData = (d) => {
          out += d;
          const m = out.match(/https:\/\/\S+redirect_uri=\S+/);
          if (m) { clearTimeout(t); res(m[0]); }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("close", () => { clearTimeout(t); res(null); });
      });
      const u = authUrl && new globalThis.URL(authUrl);
      const redirect = u && new globalThis.URL(u.searchParams.get("redirect_uri") ?? "");
      if (!u || !redirect || redirect.hostname !== "127.0.0.1") {
        child.kill("SIGTERM");
        return void (await upd("adding", "error", { error: firstLine(out) }));
      }
      pendingOAuth.set(c._id, { child, port: redirect.port, state: u.searchParams.get("state"), done });
      done.then(() => setTimeout(() => pendingOAuth.delete(c._id), 1000));
      await upd("adding", "awaiting_code", { authUrl });
      log("connector awaiting sign-in", c.name, c.sandboxKey);
      // Timed out without a paste: let the person try again.
      done.then(async (r) => {
        if (pendingOAuth.has(c._id) && !connBusy.has(c._id) && r.code !== 0) {
          await upd("awaiting_code", "error", { error: "Sign-in timed out. Click Try again." });
        }
      });
      return;
    }
    if (c.status === "submitting") {
      const p = pendingOAuth.get(c._id);
      if (!p) return void (await upd("submitting", "error", { error: "That sign-in expired. Click Try again." }));
      // Deliver only the code and state to the sandbox's own listener. We
      // build the URL ourselves from the port jcode chose, never the pasted host.
      const pasted = new globalThis.URL(c.code);
      if (pasted.searchParams.get("state") !== p.state) {
        p.child.kill("SIGTERM");
        pendingOAuth.delete(c._id);
        return void (await upd("submitting", "error", { error: "That link is from a different sign-in. Click Try again." }));
      }
      const q = new URLSearchParams();
      for (const k of ["code", "state", "error", "error_description", "iss"]) {
        const val = pasted.searchParams.get(k);
        if (val !== null) q.set(k, val);
      }
      try {
        await fetch(`http://127.0.0.1:${p.port}/callback?${q}`, { signal: AbortSignal.timeout(15_000) });
      } catch {}
      const r = await Promise.race([p.done, new Promise((res) => setTimeout(() => res(null), 45_000))]);
      pendingOAuth.delete(c._id);
      if (!r || r.code !== 0) {
        p.child.kill("SIGTERM");
        return void (await upd("submitting", "error", { error: firstLine(r?.out ?? "Sign-in didn't finish") }));
      }
      const t = await testConnector(c);
      await upd("submitting", t.ok ? "connected" : "error", t.ok ? { tools: t.tools } : { error: firstLine(t.out) });
      log("connector sign-in", c.name, c.sandboxKey, t.ok ? "ok" : "failed");
    }
  } catch (e) {
    log("connector error", e.message);
    await upd(c.status, "error", { error: "Something went wrong. Try again." });
  } finally {
    connBusy.delete(c._id);
  }
}
client.onUpdate(api.connectors.queue, s, (rows) => {
  for (const c of rows) handleConnector(c);
});

const stale = await client.mutation(api.worker.failStale, s);
if (stale) log("marked", stale, "stale runs as error");

// Cap parallel agents so a burst of prompts can't swamp a small VM. Extra
// runs just stay queued until a slot frees up.
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE ?? 4);
let dispatching = false;
const paneOf = new Map(); // runId -> paneId, for runs whose process hasn't fully finished
async function dispatch(runs) {
  if (dispatching) return;
  dispatching = true;
  try {
    // Steers jump the line so a redirect isn't stuck behind queued follow-ups.
    runs = [...runs].sort((a, b) => (b.steer ? 1 : 0) - (a.steer ? 1 : 0));
    for (const run of runs) {
      if (active.size >= MAX_ACTIVE) break;
      if (active.has(run._id)) continue;
      // A steered/stopped run on this pane may still be saving its memory. Wait for it.
      if ([...paneOf.values()].includes(String(run.paneId))) continue;
      const claimed = await client.mutation(api.worker.claim, { ...s, runId: run._id }).catch(() => null);
      if (!claimed) continue;
      active.set(run._id, null); // reserve the slot before spawning
      paneOf.set(run._id, String(run.paneId));
      runOne(claimed.run, claimed)
        .catch((e) => log("run error", e))
        .finally(() => {
          active.delete(run._id);
          paneOf.delete(run._id);
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

// Heartbeat so the UI can tell "waiting for the AI server" from "queued".
const ping = () => client.mutation(api.worker.ping, s).catch(() => {});
ping();
setInterval(ping, 20000);

// Hourly: remove folders of workspaces that no longer exist in Convex.
async function pruneDeleted() {
  try {
    const dirs = fs.readdirSync(ROOT).filter((d) => /^[a-z0-9]{20,40}$/.test(d));
    for (let i = 0; i < dirs.length; i += 100) {
      const batch = dirs.slice(i, i + 100);
      const alive = new Set(await client.query(api.worker.existingWorkspaces, { ...s, ids: batch }));
      for (const d of batch) {
        if (alive.has(d)) continue;
        fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
        log("pruned deleted workspace dir", d);
      }
    }
  } catch (e) { log("prune error", e); }
}
setTimeout(pruneDeleted, 60_000);
setInterval(pruneDeleted, 60 * 60_000);

log("tandem worker up", URL, ROOT);
