// Functions only the VM worker calls. Guarded by a shared secret so browsers
// can't impersonate the worker.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { deleteFile, findFile, getProfile, readContent, writeFile } from "./lib";
import { provider } from "./schema";

function check(secret: string) {
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) {
    throw new Error("unauthorized");
  }
}

export const queued = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    return ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
  },
});

// Atomic claim: Convex mutations are transactions, so two workers can never
// both grab the same run.
export const claim = mutation({
  args: { secret: v.string(), runId: v.id("runs") },
  handler: async (ctx, { secret, runId }) => {
    check(secret);
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return null;
    const busy = await ctx.db
      .query("runs")
      .withIndex("by_pane", (q) => q.eq("paneId", run.paneId))
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (busy) return null; // one run per pane at a time
    const pane = await ctx.db.get(run.paneId);
    const profile = await getProfile(ctx, run.userId);
    if (!pane || !profile) {
      await ctx.db.patch(runId, { status: "error", finishedAt: Date.now() });
      return null;
    }
    // Bill the person who typed the prompt: their provider, their sandbox.
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_pane_user", (q) => q.eq("paneId", run.paneId).eq("userId", run.userId))
      .unique();
    await ctx.db.patch(runId, { status: "running", provider: profile.provider, model: profile.model });
    return {
      run,
      sandboxKey: profile.sandboxKey,
      provider: profile.provider,
      model: profile.model ?? null,
      sessionId: thread?.sessionId ?? null,
    };
  },
});

export const runStatus = query({
  args: { secret: v.string(), runId: v.id("runs") },
  handler: async (ctx, { secret, runId }) => {
    check(secret);
    return (await ctx.db.get(runId))?.status ?? null;
  },
});

export const appendEvent = mutation({
  args: {
    secret: v.string(),
    runId: v.id("runs"),
    kind: v.union(
      v.literal("message"),
      v.literal("command"),
      v.literal("file"),
      v.literal("error"),
    ),
    text: v.string(),
  },
  handler: async (ctx, { secret, runId, kind, text }) => {
    check(secret);
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.db.insert("events", { runId, paneId: run.paneId, kind, text: text.slice(0, 20_000) });
  },
});

export const finish = mutation({
  args: {
    secret: v.string(),
    runId: v.id("runs"),
    status: v.union(v.literal("done"), v.literal("error")),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, { secret, runId, status, sessionId }) => {
    check(secret);
    const run = await ctx.db.get(runId);
    if (!run) return;
    if (run.status === "running") {
      await ctx.db.patch(runId, { status, finishedAt: Date.now() });
    }
    if (!sessionId || !(await ctx.db.get(run.paneId))) return;
    const t = await ctx.db
      .query("threads")
      .withIndex("by_pane_user", (q) => q.eq("paneId", run.paneId).eq("userId", run.userId))
      .unique();
    if (t) await ctx.db.patch(t._id, { sessionId });
    else await ctx.db.insert("threads", { paneId: run.paneId, userId: run.userId, sessionId });
  },
});

// ---------- subscription logins ----------

export const loginQueue = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    const out = [];
    for (const status of ["starting", "submitting"] as const) {
      const flows = await ctx.db
        .query("loginFlows")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const f of flows) {
        const p = await getProfile(ctx, f.userId);
        if (p) out.push({ ...f, sandboxKey: p.sandboxKey });
      }
    }
    return out;
  },
});

export const loginUpdate = mutation({
  args: {
    secret: v.string(),
    flowId: v.id("loginFlows"),
    from: v.string(), // only apply if the flow is still in this state
    status: v.union(
      v.literal("awaiting_code"),
      v.literal("done"),
      v.literal("error"),
    ),
    authUrl: v.optional(v.string()),
    inputKind: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { secret, flowId, from, status, authUrl, inputKind, error }) => {
    check(secret);
    const f = await ctx.db.get(flowId);
    if (!f || f.status !== from) return false;
    await ctx.db.patch(flowId, {
      status,
      authUrl,
      inputKind,
      error: error?.slice(0, 500),
      code: undefined, // never keep the code once used
    });
    if (status === "done" || status === "error") {
      const c = await ctx.db
        .query("connections")
        .withIndex("by_user_provider", (q) => q.eq("userId", f.userId).eq("provider", f.provider))
        .unique();
      if (status === "done") {
        if (c) await ctx.db.patch(c._id, { status: "connected", detail: undefined });
        else await ctx.db.insert("connections", { userId: f.userId, provider: f.provider, status: "connected" });
      }
    }
    return true;
  },
});

// Worker reports whether a user's stored login still works (e.g. after a run
// fails with an auth error).
export const setConnection = mutation({
  args: {
    secret: v.string(),
    sandboxKey: v.string(),
    provider,
    status: v.union(v.literal("connected"), v.literal("error")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { secret, sandboxKey, provider, status, detail }) => {
    check(secret);
    const p = await ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("sandboxKey"), sandboxKey))
      .first();
    if (!p) return;
    const c = await ctx.db
      .query("connections")
      .withIndex("by_user_provider", (q) => q.eq("userId", p.userId).eq("provider", provider))
      .unique();
    if (c) await ctx.db.patch(c._id, { status, detail: detail?.slice(0, 300) });
    else await ctx.db.insert("connections", { userId: p.userId, provider, status, detail: detail?.slice(0, 300) });
  },
});

// Called once at worker startup: anything still "running" was owned by a
// previous worker process that died, so it will never finish.
export const failStale = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    for (const r of runs) {
      await ctx.db.patch(r._id, { status: "error", finishedAt: Date.now() });
      await ctx.db.insert("events", {
        runId: r._id,
        paneId: r.paneId,
        kind: "error",
        text: "worker restarted while this was running",
      });
    }
    return runs.length;
  },
});

// Disk -> Convex. Skips files a human just edited that haven't hit disk yet.
export const syncFiles = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    upserts: v.array(v.object({ path: v.string(), content: v.string() })),
    deletes: v.array(v.string()),
  },
  handler: async (ctx, { secret, workspaceId, upserts, deletes }) => {
    check(secret);
    for (const { path, content } of upserts) {
      const existing = await findFile(ctx, workspaceId, path);
      if (existing?.pendingWrite) continue; // human edit wins until it hits disk
      if (existing && (await readContent(ctx, existing._id)) === content) continue;
      await writeFile(ctx, workspaceId, path, content, "agent", false);
    }
    for (const path of deletes) {
      const existing = await findFile(ctx, workspaceId, path);
      if (existing && !existing.pendingWrite) await deleteFile(ctx, existing._id);
    }
  },
});

export const filePaths = query({
  args: { secret: v.string(), workspaceId: v.id("workspaces") },
  handler: async (ctx, { secret, workspaceId }) => {
    check(secret);
    const files = await ctx.db
      .query("files")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return files.map((f) => f.path);
  },
});

// Convex -> disk. Returns pending files with their content.
export const pendingWrites = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    const files = await ctx.db
      .query("files")
      .withIndex("by_pending", (q) => q.eq("pendingWrite", true))
      .take(20);
    return Promise.all(
      files.map(async (f) => ({ ...f, content: await readContent(ctx, f._id) })),
    );
  },
});

export const markWritten = mutation({
  args: { secret: v.string(), fileId: v.id("files"), content: v.string() },
  handler: async (ctx, { secret, fileId, content }) => {
    check(secret);
    const f = await ctx.db.get(fileId);
    // Only clear if nobody edited again since we wrote it.
    if (f && (await readContent(ctx, fileId)) === content) {
      await ctx.db.patch(fileId, { pendingWrite: false });
    }
  },
});
