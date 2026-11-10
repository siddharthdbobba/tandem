// Take control of the live agent browser. Any member of the workspace can
// click, type, scroll, or open a page while an agent is running there. Inputs
// are validated here, queued, and replayed by the worker into that run's browser.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getProfile, requireMember, requireReader } from "./lib";

const KEYS = /^([A-Za-z0-9 ]|Enter|Backspace|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageDown|PageUp|Home|End|Delete)$/;

export const input = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    action: v.object({
      kind: v.union(
        v.literal("click"), v.literal("scroll"), v.literal("key"), v.literal("type"),
        v.literal("back"), v.literal("reload"), v.literal("navigate"),
      ),
      x: v.optional(v.number()),
      y: v.optional(v.number()),
      dy: v.optional(v.number()),
      key: v.optional(v.string()),
      text: v.optional(v.string()),
      url: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { workspaceId, action: a }) => {
    const userId = await requireMember(ctx, workspaceId);
    const live = await ctx.db
      .query("runs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(20);
    if (!live.some((r) => r.status === "running")) throw new Error("The browser is idle. Ask the AI to open a page first.");

    const clean: typeof a = { kind: a.kind };
    const num = (n: number | undefined, lo: number, hi: number) => {
      if (n === undefined || !Number.isFinite(n)) throw new Error("bad input");
      return Math.max(lo, Math.min(hi, Math.round(n)));
    };
    if (a.kind === "click") { clean.x = num(a.x, 0, 1280); clean.y = num(a.y, 0, 800); }
    else if (a.kind === "scroll") clean.dy = num(a.dy, -3000, 3000);
    else if (a.kind === "key") {
      if (!a.key || !KEYS.test(a.key)) throw new Error("bad key");
      clean.key = a.key;
    } else if (a.kind === "type") {
      const t = (a.text ?? "").slice(0, 500);
      if (!t) throw new Error("bad input");
      clean.text = t;
    } else if (a.kind === "navigate") {
      let u = (a.url ?? "").trim();
      if (u && !/^[a-z]+:/i.test(u)) u = `https://${u}`;
      let parsed: URL;
      try { parsed = new URL(u); } catch { throw new Error("That isn't a web address."); }
      if (!/^https?:$/.test(parsed.protocol) || u.length > 2000 || /\s/.test(u)) throw new Error("Only http and https pages can be opened.");
      clean.url = parsed.toString();
    }

    // A small backlog limit so nobody can flood the browser.
    const pending = await ctx.db.query("browserInputs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(30);
    if (pending.length >= 30) throw new Error("Slow down a little, the browser is catching up.");
    await ctx.db.insert("browserInputs", { workspaceId, userId, action: clean });

    const p = await getProfile(ctx, userId);
    const frame = await ctx.db.query("browserFrames").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    if (frame) await ctx.db.patch(frame._id, { controller: p?.name ?? "Someone", controllerAt: Date.now() });
  },
});

// Is an agent running here right now (so the browser can take input)?
export const status = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const recent = await ctx.db
      .query("runs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(20);
    return { running: recent.some((r) => r.status === "running") };
  },
});

// ---------- worker side ----------

function check(secret: string) {
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) throw new Error("unauthorized");
}

export const pending = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    return (await ctx.db.query("browserInputs").take(100)).map((r) => ({ _id: r._id, workspaceId: r.workspaceId, action: r.action }));
  },
});

export const done = mutation({
  args: { secret: v.string(), ids: v.array(v.id("browserInputs")) },
  handler: async (ctx, { secret, ids }) => {
    check(secret);
    for (const id of ids) if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});
