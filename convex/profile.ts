// The signed-in user's saved configuration.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ensureProfile, getProfile, requireUser } from "./lib";
import { provider } from "./schema";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const profile = await getProfile(ctx, userId);
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId))
      .collect();
    const flows = await ctx.db
      .query("loginFlows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);
    return {
      userId,
      email: user?.email ?? null,
      profile,
      connections: connections.map((c) => ({ provider: c.provider, status: c.status, detail: c.detail })),
      flows: flows
        .filter((f) => ["starting", "awaiting_code", "submitting", "error"].includes(f.status))
        .map((f) => ({ _id: f._id, provider: f.provider, status: f.status, authUrl: f.authUrl, inputKind: f.inputKind, error: f.error })),
    };
  },
});

// Called right after sign-in so the profile exists before anything else.
export const init = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return (await ensureProfile(ctx, userId))._id;
  },
});

export const update = mutation({
  args: {
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    provider: v.optional(provider),
    model: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const p = await ensureProfile(ctx, userId);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name || name.length > 40) throw new Error("name must be 1 to 40 chars");
      patch.name = name;
    }
    if (args.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(args.color)) throw new Error("bad color");
      patch.color = args.color;
    }
    if (args.provider !== undefined) patch.provider = args.provider;
    if (args.model !== undefined) {
      const m = args.model?.trim();
      if (m && !/^[A-Za-z0-9._:\-/]{1,80}$/.test(m)) throw new Error("bad model name");
      patch.model = m || undefined;
    }
    await ctx.db.patch(p._id, patch);
  },
});

// Start connecting a subscription. The worker picks this up, runs
// `jcode login --print-auth-url` inside the user's sandbox, and fills authUrl.
export const startConnect = mutation({
  args: { provider },
  handler: async (ctx, { provider }) => {
    const userId = await requireUser(ctx);
    await ensureProfile(ctx, userId);
    const open = await ctx.db
      .query("loginFlows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const f of open) {
      if (["starting", "awaiting_code", "submitting"].includes(f.status)) {
        await ctx.db.patch(f._id, { status: "cancelled", code: undefined });
      }
    }
    return ctx.db.insert("loginFlows", { userId, provider, status: "starting" });
  },
});

export const submitCode = mutation({
  args: { flowId: v.id("loginFlows"), code: v.string() },
  handler: async (ctx, { flowId, code }) => {
    const userId = await requireUser(ctx);
    const f = await ctx.db.get(flowId);
    if (!f || f.userId !== userId) throw new Error("not found");
    if (f.status !== "awaiting_code") throw new Error("login is not waiting for a code");
    code = code.trim();
    if (!code || code.length > 4000) throw new Error("bad code");
    await ctx.db.patch(flowId, { status: "submitting", code });
  },
});

export const cancelConnect = mutation({
  args: { flowId: v.id("loginFlows") },
  handler: async (ctx, { flowId }) => {
    const userId = await requireUser(ctx);
    const f = await ctx.db.get(flowId);
    if (!f || f.userId !== userId) throw new Error("not found");
    await ctx.db.patch(flowId, { status: "cancelled", code: undefined });
  },
});
