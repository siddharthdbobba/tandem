// Functions only the VM worker calls. Guarded by a shared secret so browsers
// can't impersonate the worker.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
    if (!pane) {
      await ctx.db.patch(runId, { status: "error", finishedAt: Date.now() });
      return null;
    }
    await ctx.db.patch(runId, { status: "running" });
    return { run, threadId: pane.threadId ?? null };
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
    await ctx.db.insert("events", { runId, paneId: run.paneId, kind, text });
  },
});

export const finish = mutation({
  args: {
    secret: v.string(),
    runId: v.id("runs"),
    status: v.union(v.literal("done"), v.literal("error")),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, { secret, runId, status, threadId }) => {
    check(secret);
    const run = await ctx.db.get(runId);
    if (!run) return;
    if (run.status === "running") {
      await ctx.db.patch(runId, { status, finishedAt: Date.now() });
    }
    if (threadId && (await ctx.db.get(run.paneId))) await ctx.db.patch(run.paneId, { threadId });
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
      const existing = await ctx.db
        .query("files")
        .withIndex("by_workspace_path", (q) =>
          q.eq("workspaceId", workspaceId).eq("path", path),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("files", {
          workspaceId,
          path,
          content,
          updatedBy: "agent",
          pendingWrite: false,
        });
      } else if (!existing.pendingWrite && existing.content !== content) {
        await ctx.db.patch(existing._id, { content, updatedBy: "agent" });
      }
    }
    for (const path of deletes) {
      const existing = await ctx.db
        .query("files")
        .withIndex("by_workspace_path", (q) =>
          q.eq("workspaceId", workspaceId).eq("path", path),
        )
        .unique();
      if (existing && !existing.pendingWrite) await ctx.db.delete(existing._id);
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

// Convex -> disk.
export const pendingWrites = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    return ctx.db
      .query("files")
      .withIndex("by_pending", (q) => q.eq("pendingWrite", true))
      .collect();
  },
});

export const markWritten = mutation({
  args: { secret: v.string(), fileId: v.id("files"), content: v.string() },
  handler: async (ctx, { secret, fileId, content }) => {
    check(secret);
    const f = await ctx.db.get(fileId);
    // Only clear if nobody edited again since we wrote it.
    if (f && f.content === content) await ctx.db.patch(fileId, { pendingWrite: false });
  },
});
