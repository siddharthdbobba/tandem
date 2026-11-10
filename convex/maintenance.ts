import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { deleteFile } from "./lib";

// Mark runs whose pane no longer exists as cancelled.
// Run with: npx convex run maintenance:cleanupOrphans
export const cleanupOrphans = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const status of ["queued", "running"] as const) {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const r of runs) {
        if (!(await ctx.db.get(r.paneId))) {
          await ctx.db.patch(r._id, { status: "cancelled", finishedAt: Date.now() });
          n++;
        }
      }
    }
    return n;
  },
});

// Remove file rows with invalid paths (written before path validation existed).
// Run with: npx convex run maintenance:removeBadPaths
export const removeBadPaths = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const f of await ctx.db.query("files").collect()) {
      const parts = f.path.split("/");
      if (!f.path.trim() || f.path.startsWith("/") || parts.some((p) => !p || p === "." || p === "..")) {
        await deleteFile(ctx, f._id);
        n++;
      }
    }
    return n;
  },
});

// Delete a workspace and everything in it, a batch at a time (re-schedules
// itself until done). The workspace folder on disk is removed by the worker's
// orphan sweep.
export const purgeWorkspace = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    let budget = 400;
    const drop = async (id: any) => { await ctx.db.delete(id); budget--; };
    for (const p of await ctx.db.query("panes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect()) {
      for (const e of await ctx.db.query("events").withIndex("by_pane", (q) => q.eq("paneId", p._id)).take(budget)) await drop(e._id);
      if (budget <= 0) break;
      for (const r of await ctx.db.query("runs").withIndex("by_pane", (q) => q.eq("paneId", p._id)).take(budget)) await drop(r._id);
      for (const t of await ctx.db.query("threads").withIndex("by_pane_user", (q) => q.eq("paneId", p._id)).collect()) await drop(t._id);
      if (budget <= 0) break;
      await drop(p._id);
    }
    if (budget > 0) {
      for (const f of await ctx.db.query("files").withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId)).take(Math.max(1, budget / 2))) {
        await deleteFile(ctx, f._id);
        budget -= 2;
      }
    }
    if (budget > 0) {
      for (const m of await ctx.db.query("messages").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(budget)) await drop(m._id);
      for (const c of await ctx.db.query("changes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(budget)) await drop(c._id);
      for (const pb of await ctx.db.query("publishes").withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId)).collect()) await drop(pb._id);
      for (const pr of await ctx.db.query("presence").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect()) await drop(pr._id);
      for (const fr of await ctx.db.query("browserFrames").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect()) {
        await ctx.storage.delete(fr.image);
        await drop(fr._id);
      }
    }
    if (budget <= 0) {
      await ctx.scheduler.runAfter(0, internal.maintenance.purgeWorkspace, { workspaceId });
      return;
    }
    if (await ctx.db.get(workspaceId)) await ctx.db.delete(workspaceId);
  },
});

// Remove rows whose workspace was already deleted (from older cleanup versions).
export const sweepOrphans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const t of ["messages", "changes", "publishes", "browserFrames", "files", "deletions"] as const) {
      for (const r of await ctx.db.query(t as any).take(1000) as any[]) {
        if (await ctx.db.get(r.workspaceId)) continue;
        if (t === "files") { await deleteFile(ctx, r._id); }
        else { if (r.image) await ctx.storage.delete(r.image); await ctx.db.delete(r._id); }
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    return counts;
  },
});
