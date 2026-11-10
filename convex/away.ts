import { query } from "./_generated/server";
import { v } from "convex/values";
import { getProfile, requireMember } from "./lib";

export const since = query({
  args: { workspaceId: v.id("workspaces"), since: v.number() },
  handler: async (ctx, { workspaceId, since }) => {
    const userId = await requireMember(ctx, workspaceId);
    const profile = await getProfile(ctx, userId);
    const name = profile?.name ?? "";
    const files = (await ctx.db
      .query("files")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId))
      .take(500))
      .filter((file) => (file.updatedAt ?? 0) > since && file.updatedBy !== name)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const paths = [...new Set(files.map((file) => file.path))];
    const runs = (await ctx.db
      .query("runs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(200))
      .filter((run) => run._creationTime > since && run.userId !== userId).length;
    const messages = (await ctx.db
      .query("messages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(200))
      .filter((message) => message._creationTime > since && message.userId !== userId).length;
    return { files: paths.slice(0, 3), fileCount: paths.length, lastEditor: files[0]?.updatedBy ?? null, runs, messages };
  },
});
