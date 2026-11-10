import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ensureProfile, getProfile, randomCode, requireMember, requireReader, requireUser, writeFile } from "./lib";
import { TEMPLATES, templateById } from "./templates";

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
      if (!w) continue;
      // Latest activity: newest chat message or AI prompt, whichever is more recent.
      const msg = await ctx.db.query("messages").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).order("desc").first();
      let run: { _creationTime: number; author: string; prompt: string } | null = null;
      for (const p of await ctx.db.query("panes").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) {
        const r = await ctx.db.query("runs").withIndex("by_pane", (q) => q.eq("paneId", p._id)).order("desc").first();
        if (r && (!run || r._creationTime > run._creationTime)) run = r;
      }
      const activity =
        msg && (!run || msg._creationTime > run._creationTime)
          ? { at: msg._creationTime, text: `${msg.author}: ${msg.poll ? "📊 " + msg.poll.question : msg.text}`.slice(0, 90) }
          : run
            ? { at: run._creationTime, text: `${run.author} asked the AI: ${run.prompt}`.slice(0, 90) }
            : null;
      const people = (await ctx.db.query("members").withIndex("by_workspace_user", (q) => q.eq("workspaceId", w._id)).collect()).length;
      out.push({ _id: w._id, name: w.name, template: w.template, owner: (await getProfile(ctx, w.ownerId))?.name ?? "?", activity, people, at: activity?.at ?? w._creationTime });
    }
    return out.sort((a, b) => b.at - a.at);
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
    return w && { _id: w._id, name: w.name, inviteCode: member ? w.inviteCode : undefined, member, owner: !!userId && w.ownerId === userId, instructions: w.instructions ?? "", template: w.template };
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
    if (!w) return null;
    // For the invite card: who started it and who's in (first names + colors only).
    const owner = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", w.ownerId)).unique();
    const rows = await ctx.db.query("members").withIndex("by_workspace_user", (q) => q.eq("workspaceId", w._id)).take(12);
    const people = [];
    for (const m of rows) {
      const p = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", m.userId)).unique();
      if (p) people.push({ name: p.name.split(" ")[0], color: p.color });
    }
    return { _id: w._id, name: w.name, template: w.template ?? null, owner: owner?.name.split(" ")[0] ?? null, people };
  },
});

export const create = mutation({
  args: { name: v.string(), template: v.optional(v.string()) },
  handler: async (ctx, { name, template }) => {
    const userId = await requireUser(ctx);
    const profile = await ensureProfile(ctx, userId);
    name = name.trim();
    if (!name || name.length > 60) throw new Error("name must be 1 to 60 chars");
    const t = templateById(template);
    const id = await ctx.db.insert("workspaces", {
      name, ownerId: userId, inviteCode: randomCode(12),
      template: t?.id, instructions: t?.instructions || undefined,
    });
    await ctx.db.insert("members", { workspaceId: id, userId });
    await ctx.db.insert("panes", { workspaceId: id, title: "Main" });
    // Seed starter files; the worker writes them to disk like any browser edit.
    for (const f of t?.files ?? []) await writeFile(ctx, id, f.path, f.content, profile.name, true);
    return id;
  },
});

// Starter templates for the "new workspace" picker.
export const templates = query({
  args: {},
  handler: async () => TEMPLATES.map(({ id, name, emoji, blurb }) => ({ id, name, emoji, blurb })),
});

// Suggested first prompts for a workspace (from its template).
export const suggestions = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const w = await ctx.db.get(workspaceId);
    return (templateById(w?.template) ?? templateById("blank"))!.prompts;
  },
});

// ---------- workspace settings ----------

async function requireOwner(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const userId = await requireMember(ctx, workspaceId);
  const w = await ctx.db.get(workspaceId);
  if (!w || w.ownerId !== userId) throw new Error("only the workspace owner can do that");
  return { userId, w };
}

export const rename = mutation({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, { workspaceId, name }) => {
    await requireMember(ctx, workspaceId);
    name = name.trim();
    if (!name || name.length > 60) throw new Error("name must be 1 to 60 chars");
    await ctx.db.patch(workspaceId, { name });
  },
});

// "How the AI should behave here". Any member can edit; sent with every prompt.
export const setInstructions = mutation({
  args: { workspaceId: v.id("workspaces"), instructions: v.string() },
  handler: async (ctx, { workspaceId, instructions }) => {
    await requireMember(ctx, workspaceId);
    if (instructions.length > 4000) throw new Error("instructions must be under 4000 characters");
    await ctx.db.patch(workspaceId, { instructions: instructions.trim() || undefined });
  },
});

// New share link; the old one stops working (for viewing and joining).
export const resetLink = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireOwner(ctx, workspaceId);
    const inviteCode = randomCode(12);
    await ctx.db.patch(workspaceId, { inviteCode });
    return inviteCode;
  },
});

export const members = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const w = await ctx.db.get(workspaceId);
    const ms = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const out = [];
    for (const m of ms) {
      const p = await getProfile(ctx, m.userId);
      out.push({ userId: m.userId, name: p?.name ?? "?", color: p?.color ?? "#888888", owner: w?.ownerId === m.userId });
    }
    return out;
  },
});

export const leave = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await requireMember(ctx, workspaceId);
    const w = await ctx.db.get(workspaceId);
    if (w?.ownerId === userId) throw new Error("the owner can't leave; delete the workspace instead");
    const m = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .unique();
    if (m) await ctx.db.delete(m._id);
  },
});

// Owner deletes a workspace. Rows are removed in batches by a scheduled job.
export const remove = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireOwner(ctx, workspaceId);
    // Revoke access immediately, then clean up.
    for (const m of await ctx.db.query("members").withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId)).collect())
      await ctx.db.delete(m._id);
    await ctx.db.patch(workspaceId, { inviteCode: randomCode(24) });
    await ctx.scheduler.runAfter(0, internal.maintenance.purgeWorkspace, { workspaceId });
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

// The most recently finished run in this workspace (for "AI finished" notifications).
export const lastFinished = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const panes = await ctx.db.query("panes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    let best: { _id: string; finishedAt: number; author: string; prompt: string; status: string } | null = null;
    for (const p of panes) {
      const r = await ctx.db.query("runs").withIndex("by_pane", (q) => q.eq("paneId", p._id)).order("desc").first();
      if (r?.finishedAt && (r.status === "done" || r.status === "error") && (!best || r.finishedAt > best.finishedAt))
        best = { _id: r._id, finishedAt: r.finishedAt, author: r.author, prompt: r.prompt.slice(0, 120), status: r.status };
    }
    return best;
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
      fromChat: r.fromChat,
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

export const renamePane = mutation({
  args: { paneId: v.id("panes"), title: v.string() },
  handler: async (ctx, { paneId, title }) => {
    const pane = await ctx.db.get(paneId);
    if (!pane) throw new Error("pane not found");
    await requireMember(ctx, pane.workspaceId);
    title = title.trim();
    if (!title || title.length > 40) throw new Error("pane name must be 1 to 40 characters");
    await ctx.db.patch(paneId, { title });
  },
});
