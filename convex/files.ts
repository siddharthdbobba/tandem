import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// File tree without contents, so the sidebar stays light.
export const tree = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return files.map((f) => ({
      _id: f._id,
      path: f.path,
      updatedBy: f.updatedBy,
      updatedAt: f._creationTime,
      size: f.content.length,
    }));
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces"), path: v.string() },
  handler: (ctx, { workspaceId, path }) =>
    ctx.db
      .query("files")
      .withIndex("by_workspace_path", (q) =>
        q.eq("workspaceId", workspaceId).eq("path", path),
      )
      .unique(),
});

// Human edit from the browser. The worker writes it to disk.
export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    path: v.string(),
    content: v.string(),
    user: v.string(),
  },
  handler: async (ctx, { workspaceId, path, content, user }) => {
    path = path.trim();
    const parts = path.split("/");
    if (!path || path.startsWith("/") || parts.some((p) => !p || p === "." || p === ".."))
      throw new Error("bad path");
    const existing = await ctx.db
      .query("files")
      .withIndex("by_workspace_path", (q) =>
        q.eq("workspaceId", workspaceId).eq("path", path),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { content, updatedBy: user, pendingWrite: true });
    } else {
      await ctx.db.insert("files", {
        workspaceId,
        path,
        content,
        updatedBy: user,
        pendingWrite: true,
      });
    }
  },
});
