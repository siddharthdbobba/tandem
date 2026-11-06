import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { findFile, readContent, writeFile } from "./lib";

// File tree. Reads metadata only, so it stays cheap however big files get.
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
      size: f.size,
    }));
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces"), path: v.string() },
  handler: async (ctx, { workspaceId, path }) => {
    const file = await findFile(ctx, workspaceId, path);
    if (!file) return null;
    return { ...file, content: await readContent(ctx, file._id) };
  },
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
    if (content.length > 400_000) throw new Error("file too large");
    await writeFile(ctx, workspaceId, path, content, user, true);
  },
});
