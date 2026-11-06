import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------- auth ----------

export async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("not signed in");
  return userId;
}

export async function requireMember(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const userId = await requireUser(ctx);
  const m = await ctx.db
    .query("members")
    .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .unique();
  if (!m) throw new Error("not a member of this workspace");
  return userId;
}

export async function getProfile(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#8e4ec6", "#d6409f"];

// Create the profile row on first use.
export async function ensureProfile(ctx: MutationCtx, userId: Id<"users">) {
  const existing = await getProfile(ctx, userId);
  if (existing) return existing;
  const user = await ctx.db.get(userId);
  const name = (user?.name ?? user?.email ?? "user").split("@")[0].slice(0, 40);
  const n = [...String(userId)].reduce((a, c) => a + c.charCodeAt(0), 0);
  // Sandbox key: lowercase alnum, derived from the user id so it is stable.
  const sandboxKey = String(userId).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 28);
  const id = await ctx.db.insert("profiles", {
    userId,
    name,
    color: COLORS[n % COLORS.length],
    provider: "claude",
    sandboxKey,
  });
  return (await ctx.db.get(id))!;
}

export function randomCode(len = 10) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) s += a[b % a.length];
  return s;
}

// ---------- files ----------

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
