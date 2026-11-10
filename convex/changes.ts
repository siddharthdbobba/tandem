import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deleteFile, ensureProfile, findFile, readContent, requireMember, requireReader, writeFile } from "./lib";

// What an agent run changed, for the "Changes" review under each run.

export const forRun = query({
  args: { runId: v.id("runs"), code: v.optional(v.string()) },
  handler: async (ctx, { runId, code }) => {
    const run = await ctx.db.get(runId);
    if (!run) return [];
    await requireReader(ctx, run.workspaceId, code);
    const rows = await ctx.db.query("changes").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    return rows.map((c) => ({
      _id: c._id, path: c.path, kind: c.kind, binary: !!c.binary, reverted: !!c.reverted,
    }));
  },
});

export const diff = query({
  args: { changeId: v.id("changes"), code: v.optional(v.string()) },
  handler: async (ctx, { changeId, code }) => {
    const c = await ctx.db.get(changeId);
    if (!c) return null;
    await requireReader(ctx, c.workspaceId, code);
    return { path: c.path, kind: c.kind, binary: !!c.binary, before: c.before ?? "", after: c.after ?? "", reverted: !!c.reverted };
  },
});

// Put one file back the way it was before the run.
async function revertOne(ctx: MutationCtx, changeId: Id<"changes">, who: string) {
  const c = await ctx.db.get(changeId);
  if (!c || c.reverted || c.binary) return false;
  if (c.kind === "added") {
    const f = await findFile(ctx, c.workspaceId, c.path);
    if (f) {
      // Delete on disk too: an empty pending write is not enough, so mark it for the worker.
      await deleteFile(ctx, f._id);
      await ctx.db.insert("deletions", { workspaceId: c.workspaceId, path: c.path });
    }
  } else {
    await writeFile(ctx, c.workspaceId, c.path, c.before ?? "", who, true);
  }
  await ctx.db.patch(changeId, { reverted: true });
  return true;
}

export const revert = mutation({
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => {
    const c = await ctx.db.get(changeId);
    if (!c) throw new Error("change not found");
    const userId = await requireMember(ctx, c.workspaceId);
    const p = await ensureProfile(ctx, userId);
    if (c.binary) throw new Error("binary files can't be undone yet");
    return revertOne(ctx, changeId, p.name);
  },
});

export const revertRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    const userId = await requireMember(ctx, run.workspaceId);
    const p = await ensureProfile(ctx, userId);
    let n = 0;
    for (const c of await ctx.db.query("changes").withIndex("by_run", (q) => q.eq("runId", runId)).collect())
      if (await revertOne(ctx, c._id, p.name)) n++;
    return n;
  },
});

// Is the file still what the run left? Used to warn before undoing over newer edits.
export const isCurrent = query({
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => {
    const c = await ctx.db.get(changeId);
    if (!c) return false;
    await requireReader(ctx, c.workspaceId);
    const f = await findFile(ctx, c.workspaceId, c.path);
    if (c.kind === "deleted") return !f;
    return !!f && !f.blob && (await readContent(ctx, f._id)) === (c.after ?? "");
  },
});
