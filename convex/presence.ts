import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getProfile, requireMember } from "./lib";

const STALE_MS = 30_000;

export const heartbeat = mutation({
  args: { workspaceId: v.id("workspaces"), paneId: v.optional(v.id("panes")) },
  handler: async (ctx, { workspaceId, paneId }) => {
    const userId = await requireMember(ctx, workspaceId);
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { paneId, lastSeen: Date.now() });
    else await ctx.db.insert("presence", { workspaceId, userId, paneId, lastSeen: Date.now() });
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, { workspaceId, now }) => {
    await requireMember(ctx, workspaceId);
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const out = [];
    for (const r of rows) {
      if (now - r.lastSeen >= STALE_MS) continue;
      const p = await getProfile(ctx, r.userId);
      out.push({ _id: r._id, userId: r.userId, paneId: r.paneId, name: p?.name ?? "?", color: p?.color ?? "#888888" });
    }
    return out;
  },
});
