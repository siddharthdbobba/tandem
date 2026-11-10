import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ensureProfile, findFile, randomCode, readContent, requireMember, requireReader } from "./lib";

// Publish one file as a clean, read-only public page: tandem.../#/p/<code>.
// The page always shows the file's latest content until it's unpublished.

export const status = query({
  args: { workspaceId: v.id("workspaces"), path: v.string(), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, path, code }) => {
    await requireReader(ctx, workspaceId, code);
    const p = await ctx.db
      .query("publishes")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId).eq("path", path))
      .unique();
    return p ? { code: p.code } : null;
  },
});

export const publish = mutation({
  args: { workspaceId: v.id("workspaces"), path: v.string() },
  handler: async (ctx, { workspaceId, path }) => {
    const userId = await requireMember(ctx, workspaceId);
    const profile = await ensureProfile(ctx, userId);
    if (!(await findFile(ctx, workspaceId, path))) throw new Error("file not found");
    const existing = await ctx.db
      .query("publishes")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId).eq("path", path))
      .unique();
    if (existing) return existing.code;
    const code = randomCode(14);
    await ctx.db.insert("publishes", { workspaceId, path, code, by: profile.name });
    return code;
  },
});

export const unpublish = mutation({
  args: { workspaceId: v.id("workspaces"), path: v.string() },
  handler: async (ctx, { workspaceId, path }) => {
    await requireMember(ctx, workspaceId);
    const p = await ctx.db
      .query("publishes")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId).eq("path", path))
      .unique();
    if (p) await ctx.db.delete(p._id);
  },
});

// Public: anyone with the page code. Returns only this one file.
export const view = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const p = await ctx.db.query("publishes").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!p) return null;
    const w = await ctx.db.get(p.workspaceId);
    const f = await findFile(ctx, p.workspaceId, p.path);
    if (!w || !f) return null;
    return {
      path: p.path, workspace: w.name, by: p.by, updatedBy: f.updatedBy, updatedAt: f._creationTime,
      content: f.blob ? "" : await readContent(ctx, f._id),
      url: f.blob ? await ctx.storage.getUrl(f.blob) : null,
      mime: f.mime ?? null,
    };
  },
});
