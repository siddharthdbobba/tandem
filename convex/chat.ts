import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
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
    // Poll votes are shown as counts plus who voted (names), never raw ids.
    const names = new Map<string, string>();
    const nameOf = async (id: string) => {
      if (!names.has(id)) names.set(id, (await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", id as any)).unique())?.name ?? "?");
      return names.get(id)!;
    };
    const me = await getAuthUserId(ctx);
    const out = [];
    for (const m of rows.reverse()) {
      const poll = m.poll && {
        question: m.poll.question,
        options: await Promise.all(m.poll.options.map(async (o) => ({
          label: o.label, count: o.votes.length, mine: !!me && o.votes.includes(me), voters: await Promise.all(o.votes.map(nameOf)),
        }))),
      };
      out.push({ _id: m._id, author: m.author, color: m.color, userId: m.userId, text: m.text, at: m._creationTime, poll });
    }
    return out;
  },
});

export const send = mutation({
  args: { workspaceId: v.id("workspaces"), text: v.string(), paneId: v.optional(v.id("panes")) },
  handler: async (ctx, { workspaceId, text, paneId }) => {
    const userId = await requireMember(ctx, workspaceId);
    const profile = await ensureProfile(ctx, userId);
    text = text.trim();
    if (!text || text.length > 4000) throw new Error("message must be 1 to 4000 characters");
    // "/poll Question? | option a | option b" makes a poll everyone can vote on.
    const pollMatch = text.match(/^\/poll\s+(.+)$/is);
    if (pollMatch) {
      const [question, ...opts] = pollMatch[1].split("|").map((x) => x.trim()).filter(Boolean);
      if (!question || opts.length < 2 || opts.length > 8) throw new Error("poll needs a question and 2 to 8 options: /poll Where? | Tahoe | Yosemite");
      await ctx.db.insert("messages", {
        workspaceId, userId, author: profile.name, color: profile.color, text: question.slice(0, 300),
        poll: { question: question.slice(0, 300), options: opts.map((label) => ({ label: label.slice(0, 120), votes: [] })) },
      });
      return { toAgent: false };
    }
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
      .map((m) => m.poll
        ? `${m.author} started a poll "${m.poll.question}": ${m.poll.options.map((o) => `${o.label} (${o.votes.length} votes)`).join(", ")}`
        : `${m.author}: ${m.text}`)
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

// Vote on a poll option (one vote per person; voting again moves your vote, same option clears it).
export const vote = mutation({
  args: { messageId: v.id("messages"), option: v.number() },
  handler: async (ctx, { messageId, option }) => {
    const m = await ctx.db.get(messageId);
    if (!m?.poll) throw new Error("not a poll");
    const userId = await requireMember(ctx, m.workspaceId);
    const had = m.poll.options[option]?.votes.includes(userId);
    if (!m.poll.options[option]) throw new Error("bad option");
    const options = m.poll.options.map((o, i) => ({
      label: o.label,
      votes: [...o.votes.filter((u) => u !== userId), ...(i === option && !had ? [userId] : [])],
    }));
    await ctx.db.patch(messageId, { poll: { ...m.poll, options } });
  },
});
