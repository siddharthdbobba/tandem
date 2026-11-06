import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const STALE_MS = 30_000;

export const heartbeat = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    color: v.string(),
    paneId: v.optional(v.id("panes")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_workspace_name", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("name", args.name),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, lastSeen: Date.now() });
    } else {
      await ctx.db.insert("presence", { ...args, lastSeen: Date.now() });
    }
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, { workspaceId, now }) => {
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return rows.filter((r) => now - r.lastSeen < STALE_MS);
  },
});
