import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: (ctx) => ctx.db.query("workspaces").order("desc").collect(),
});

export const get = query({
  args: { id: v.id("workspaces") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: { name: v.string(), user: v.string() },
  handler: async (ctx, { name, user }) => {
    const id = await ctx.db.insert("workspaces", { name, createdBy: user });
    await ctx.db.insert("panes", { workspaceId: id, title: "Main" });
    return id;
  },
});

export const listPanes = query({
  args: { workspaceId: v.id("workspaces") },
  handler: (ctx, { workspaceId }) =>
    ctx.db
      .query("panes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect(),
});

export const addPane = mutation({
  args: { workspaceId: v.id("workspaces"), title: v.string() },
  handler: (ctx, args) => ctx.db.insert("panes", args),
});

export const removePane = mutation({
  args: { paneId: v.id("panes") },
  handler: (ctx, { paneId }) => ctx.db.delete(paneId),
});

// Everything a pane needs to render: its runs and their output, live.
export const paneFeed = query({
  args: { paneId: v.id("panes") },
  handler: async (ctx, { paneId }) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_pane", (q) => q.eq("paneId", paneId))
      .collect();
    const events = await ctx.db
      .query("events")
      .withIndex("by_pane", (q) => q.eq("paneId", paneId))
      .collect();
    return runs.map((r) => ({
      ...r,
      events: events.filter((e) => e.runId === r._id),
    }));
  },
});

export const submitPrompt = mutation({
  args: { paneId: v.id("panes"), prompt: v.string(), author: v.string() },
  handler: async (ctx, { paneId, prompt, author }) => {
    const pane = await ctx.db.get(paneId);
    if (!pane) throw new Error("pane not found");
    return ctx.db.insert("runs", {
      workspaceId: pane.workspaceId,
      paneId,
      prompt,
      author,
      status: "queued",
    });
  },
});

export const cancelRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run && (run.status === "queued" || run.status === "running")) {
      await ctx.db.patch(runId, { status: "cancelled", finishedAt: Date.now() });
    }
  },
});
