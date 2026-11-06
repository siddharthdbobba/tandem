import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function findFile(ctx: QueryCtx, workspaceId: Id<"workspaces">, path: string) {
  return ctx.db
    .query("files")
    .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId).eq("path", path))
    .unique();
}

export async function readContent(ctx: QueryCtx, fileId: Id<"files">) {
  const row = await ctx.db
    .query("contents")
    .withIndex("by_file", (q) => q.eq("fileId", fileId))
    .unique();
  return row?.content ?? "";
}

// Create or update a file and its content row.
export async function writeFile(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  path: string,
  content: string,
  updatedBy: string,
  pendingWrite: boolean,
) {
  const existing = await findFile(ctx, workspaceId, path);
  if (!existing) {
    const fileId = await ctx.db.insert("files", {
      workspaceId,
      path,
      size: content.length,
      updatedBy,
      pendingWrite,
    });
    await ctx.db.insert("contents", { fileId, content });
    return fileId;
  }
  await ctx.db.patch(existing._id, { size: content.length, updatedBy, pendingWrite });
  const row = await ctx.db
    .query("contents")
    .withIndex("by_file", (q) => q.eq("fileId", existing._id))
    .unique();
  if (row) await ctx.db.patch(row._id, { content });
  else await ctx.db.insert("contents", { fileId: existing._id, content });
  return existing._id;
}

export async function deleteFile(ctx: MutationCtx, fileId: Id<"files">) {
  const row = await ctx.db
    .query("contents")
    .withIndex("by_file", (q) => q.eq("fileId", fileId))
    .unique();
  if (row) await ctx.db.delete(row._id);
  await ctx.db.delete(fileId);
}
