import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ensureProfile, requireMember, requireReader } from "./lib";

// Team chat beside the agent. Messages starting with "@ai" are also sent to the
// agent in the workspace's first pane, with the recent chat as context.
const AI_TAG = /^@(ai|agent|tandem)\b[:,]?\s*/i;

export const list = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(200);
    return rows.reverse().map((m) => ({ _id: m._id, author: m.author, color: m.color, userId: m.userId, text: m.text, at: m._creationTime }));
  },
});

export const send = mutation({
  args: { workspaceId: v.id("workspaces"), text: v.string(), paneId: v.optional(v.id("panes")) },
  handler: async (ctx, { workspaceId, text, paneId }) => {
    const userId = await requireMember(ctx, workspaceId);
    const profile = await ensureProfile(ctx, userId);
    text = text.trim();
    if (!text || text.length > 4000) throw new Error("message must be 1 to 4000 characters");
    await ctx.db.insert("messages", { workspaceId, userId, author: profile.name, color: profile.color, text });
    if (!AI_TAG.test(text)) return { toAgent: false };

    // Hand it to the agent, with the last few chat lines so it knows the context.
    const pane =
      (paneId && (await ctx.db.get(paneId))?.workspaceId === workspaceId ? await ctx.db.get(paneId) : null) ??
      (await ctx.db.query("panes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).first());
    if (!pane) return { toAgent: false };
    const recent = (
      await ctx.db.query("messages").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(15)
    )
      .reverse()
      .map((m) => `${m.author}: ${m.text}`)
      .join("\n");
    const ask = text.replace(AI_TAG, "");
    if (!ask) return { toAgent: false };
    await ctx.db.insert("runs", {
      workspaceId, paneId: pane._id, prompt: ask.slice(0, 100_000), userId, author: profile.name, status: "queued",
      context: `Recent team chat:\n${recent}`.slice(0, 20_000), fromChat: true,
    });
    return { toAgent: true, paneId: pane._id };
  },
});
