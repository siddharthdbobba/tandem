import { internalMutation } from "./_generated/server";
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
