import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ensureProfile, getProfile, randomCode, requireMember, requireReader, requireUser } from "./lib";

// Workspaces I belong to.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const ms = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const m of ms) {
      const w = await ctx.db.get(m.workspaceId);
      if (w) out.push({ _id: w._id, name: w.name, owner: (await getProfile(ctx, w.ownerId))?.name ?? "?" });
    }
    return out.reverse();
  },
});

export const get = query({
  args: { id: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { id, code }) => {
    await requireReader(ctx, id, code);
    const w = await ctx.db.get(id);
    const userId = await getAuthUserId(ctx);
    const member = userId
      ? !!(await ctx.db
          .query("members")
          .withIndex("by_workspace_user", (q) => q.eq("workspaceId", id).eq("userId", userId))
          .unique())
      : false;
    return w && { _id: w._id, name: w.name, inviteCode: w.inviteCode, member };
  },
});

// Resolve a share link to its workspace, for read-only viewing. No sign-in needed.
export const peek = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_invite", (q) => q.eq("inviteCode", code.trim()))
      .unique();
    return w && { _id: w._id, name: w.name };
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    await ensureProfile(ctx, userId);
    name = name.trim();
    if (!name || name.length > 60) throw new Error("name must be 1 to 60 chars");
    const id = await ctx.db.insert("workspaces", { name, ownerId: userId, inviteCode: randomCode(12) });
    await ctx.db.insert("members", { workspaceId: id, userId });
    await ctx.db.insert("panes", { workspaceId: id, title: "Main" });
    return id;
  },
});

// Join with an invite code from a share link.
export const join = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const userId = await requireUser(ctx);
    await ensureProfile(ctx, userId);
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_invite", (q) => q.eq("inviteCode", inviteCode.trim()))
      .unique();
    if (!w) throw new Error("invite link is invalid");
    const m = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", w._id).eq("userId", userId))
      .unique();
    if (!m) await ctx.db.insert("members", { workspaceId: w._id, userId });
    return w._id;
  },
});

export const listPanes = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    return ctx.db
      .query("panes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

// Is any agent working in this workspace right now?
export const busy = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const running = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .filter((q) => q.eq(q.field("workspaceId"), workspaceId))
      .first();
    return !!running;
  },
});

export const addPane = mutation({
  args: { workspaceId: v.id("workspaces"), title: v.string() },
  handler: async (ctx, { workspaceId, title }) => {
    await requireMember(ctx, workspaceId);
    return ctx.db.insert("panes", { workspaceId, title: title.trim().slice(0, 40) || "Agent" });
  },
});

export const removePane = mutation({
  args: { paneId: v.id("panes") },
  handler: async (ctx, { paneId }) => {
    const pane = await ctx.db.get(paneId);
    if (!pane) return;
    await requireMember(ctx, pane.workspaceId);
    // Cancel anything in flight so the worker stops it, then drop history.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_pane", (q) => q.eq("paneId", paneId))
      .collect();
    for (const r of runs) {
      if (r.status === "queued" || r.status === "running") {
        await ctx.db.patch(r._id, { status: "cancelled", finishedAt: Date.now() });
      }
    }
    const events = await ctx.db
      .query("events")
      .withIndex("by_pane", (q) => q.eq("paneId", paneId))
      .collect();
    for (const e of events) await ctx.db.delete(e._id);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_pane_user", (q) => q.eq("paneId", paneId))
      .collect();
    for (const t of threads) await ctx.db.delete(t._id);
    await ctx.db.delete(paneId);
  },
});

// Everything a pane needs to render: its latest runs and their output, live.
// Bounded so long-lived panes stay within Convex read limits.
export const paneFeed = query({
  args: { paneId: v.id("panes"), code: v.optional(v.string()) },
  handler: async (ctx, { paneId, code }) => {
    const pane = await ctx.db.get(paneId);
    if (!pane) return [];
    await requireReader(ctx, pane.workspaceId, code);
    const runs = (
      await ctx.db
        .query("runs")
        .withIndex("by_pane", (q) => q.eq("paneId", paneId))
        .order("desc")
        .take(30)
    ).reverse();
    if (!runs.length) return [];
    const events = await ctx.db
      .query("events")
      .withIndex("by_pane", (q) =>
        q.eq("paneId", paneId).gte("_creationTime", runs[0]._creationTime),
      )
      .collect();
    return runs.map((r) => ({
      _id: r._id,
      prompt: r.prompt,
      author: r.author,
      userId: r.userId,
      status: r.status,
      provider: r.provider,
      model: r.model,
      effort: r.effort,
      steer: r.steer,
      steeredBy: r.steeredBy,
      events: events.filter((e) => e.runId === r._id),
    }));
  },
});

export const submitPrompt = mutation({
  args: {
    paneId: v.id("panes"),
    prompt: v.string(),
    provider: v.optional(v.union(v.literal("claude"), v.literal("openai"))),
    model: v.optional(v.string()),
    effort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("xhigh"), v.literal("max"))),
  },
  handler: async (ctx, { paneId, prompt, provider, model, effort }) => {
    if (model && !/^[A-Za-z0-9._:\-/\[\]]{1,80}$/.test(model)) throw new Error("bad model name");
    const pane = await ctx.db.get(paneId);
    if (!pane) throw new Error("pane not found");
    const userId = await requireMember(ctx, pane.workspaceId);
    const profile = await ensureProfile(ctx, userId);
    prompt = prompt.trim();
    if (!prompt || prompt.length > 100_000) throw new Error("prompt must be 1 to 100k chars");
    return ctx.db.insert("runs", {
      workspaceId: pane.workspaceId,
      paneId,
      prompt,
      userId,
      author: profile.name,
      status: "queued",
      wantProvider: provider,
      wantModel: model || undefined,
      effort,
    });
  },
});

export const cancelRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await requireMember(ctx, run.workspaceId);
    if (run.status === "queued" || run.status === "running") {
      await ctx.db.patch(runId, { status: "cancelled", finishedAt: Date.now() });
    }
  },
});

// Redirect the agent mid-run. Any member can steer, not just the original
// prompter: the current run is stopped (its progress is kept in the pane's
// memory) and this message goes next, on the steerer's own subscription.
export const steerRun = mutation({
  args: {
    runId: v.id("runs"),
    prompt: v.string(),
    provider: v.optional(v.union(v.literal("claude"), v.literal("openai"))),
    model: v.optional(v.string()),
    effort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("xhigh"), v.literal("max"))),
  },
  handler: async (ctx, { runId, prompt, provider, model, effort }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    const userId = await requireMember(ctx, run.workspaceId);
    if (model && !/^[A-Za-z0-9._:\-/\[\]]{1,80}$/.test(model)) throw new Error("bad model name");
    prompt = prompt.trim();
    if (!prompt || prompt.length > 100_000) throw new Error("prompt must be 1 to 100k chars");
    const profile = await ensureProfile(ctx, userId);
    if (run.status === "queued" || run.status === "running") {
      await ctx.db.patch(runId, { status: "cancelled", steeredBy: profile.name, finishedAt: Date.now() });
    }
    return ctx.db.insert("runs", {
      workspaceId: run.workspaceId,
      paneId: run.paneId,
      prompt,
      userId,
      author: profile.name,
      status: "queued",
      steer: true,
      wantProvider: provider,
      wantModel: model || undefined,
      effort,
    });
  },
});
