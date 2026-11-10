import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getProfile, requireMember, requireReader } from "./lib";

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
  args: { workspaceId: v.id("workspaces"), now: v.number(), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, now, code }) => {
    await requireReader(ctx, workspaceId, code);
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

// Team chat "typing" signal. The client sends it at most every few seconds while
// typing, and with typing=false when the box is cleared or the message is sent.
export const setTyping = mutation({
  args: { workspaceId: v.id("workspaces"), typing: v.boolean() },
  handler: async (ctx, { workspaceId, typing }) => {
    const userId = await requireMember(ctx, workspaceId);
    const row = await ctx.db
      .query("presence")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .unique();
    const typingAt = typing ? Date.now() : 0;
    if (row) await ctx.db.patch(row._id, { typingAt });
    else if (typing) await ctx.db.insert("presence", { workspaceId, userId, lastSeen: Date.now(), typingAt });
  },
});

// Who's typing in chat (the client hides entries older than a few seconds).
export const typing = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const out = [];
    for (const r of rows) {
      if (!r.typingAt) continue;
      const p = await getProfile(ctx, r.userId);
      out.push({ userId: r.userId, name: (p?.name ?? "?").split(" ")[0], at: r.typingAt });
    }
    return out;
  },
});
