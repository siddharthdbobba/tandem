import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { deleteFile, ensureProfile, findFile, readContent, requireMember, requireReader, writeFile } from "./lib";

const MAX_BINARY = 20_000_000; // 20 MB per uploaded file

// Storage reports sha256 as base64 on some backends and hex on others.
export const toHex = (s: string) =>
  /^[0-9a-f]{64}$/i.test(s)
    ? s.toLowerCase()
    : Array.from(atob(s), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

function checkPath(path: string) {
  path = path.trim();
  const parts = path.split("/");
  if (!path || path.length > 400 || path.startsWith("/") || parts.some((p) => !p || p === "." || p === ".."))
    throw new Error("bad path");
  return path;
}

// File tree. Reads metadata only, so it stays cheap however big files get.
export const tree = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const files = await ctx.db
      .query("files")
      .withIndex("by_workspace_path", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return files
      // Tandem's own bookkeeping (browser frames etc.) isn't shown as files.
      .filter((f) => !f.path.startsWith(".tandem/"))
      .map((f) => ({
        _id: f._id,
        path: f.path,
        updatedBy: f.updatedBy,
        size: f.size,
        binary: !!f.blob,
      }));
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces"), path: v.string(), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, path, code }) => {
    await requireReader(ctx, workspaceId, code);
    const file = await findFile(ctx, workspaceId, path);
    if (!file) return null;
    if (file.blob) {
      return { ...file, content: "", url: await ctx.storage.getUrl(file.blob) };
    }
    return { ...file, content: await readContent(ctx, file._id), url: null };
  },
});

// Human edit from the browser. The worker writes it to disk.
export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { workspaceId, path, content }) => {
    const userId = await requireMember(ctx, workspaceId);
    const profile = await ensureProfile(ctx, userId);
    path = checkPath(path);
    if (content.length > 400_000) throw new Error("file too large");
    await writeFile(ctx, workspaceId, path, content, profile.name, true);
  },
});

// Binary upload from the browser: 1) get an upload URL, 2) POST the bytes,
// 3) call saveBinary with the storage id. The worker then writes it to disk.
export const uploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    return ctx.storage.generateUploadUrl();
  },
});

export const saveBinary = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    path: v.string(),
    blob: v.id("_storage"),
  },
  handler: async (ctx, { workspaceId, path, blob }) => {
    const userId = await requireMember(ctx, workspaceId);
    const profile = await ensureProfile(ctx, userId);
    path = checkPath(path);
    const meta = await ctx.db.system.get(blob);
    if (!meta) throw new Error("upload not found");
    if (meta.size > MAX_BINARY) {
      await ctx.storage.delete(blob);
      throw new Error("file too large (20 MB max)");
    }
    const hash = toHex(meta.sha256);
    const existing = await findFile(ctx, workspaceId, path);
    if (existing) await deleteFile(ctx, existing._id);
    await ctx.db.insert("files", {
      workspaceId, path, size: meta.size, updatedBy: profile.name, pendingWrite: true,
      updatedAt: Date.now(),
      blob, hash, mime: meta.contentType ?? "application/octet-stream",
    });
  },
});

// Latest frame of the agent browser in this workspace.
export const browserFrame = query({
  args: { workspaceId: v.id("workspaces"), code: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, code }) => {
    await requireReader(ctx, workspaceId, code);
    const f = await ctx.db
      .query("browserFrames")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (!f) return null;
    const controller = f.controllerAt && Date.now() - f.controllerAt < 15_000 ? f.controller : undefined;
    return { url: f.url, title: f.title, by: f.by, at: f.at, controller, image: await ctx.storage.getUrl(f.image) };
  },
});

// Delete a file (and remove it from the workspace disk).
export const remove = mutation({
  args: { workspaceId: v.id("workspaces"), path: v.string() },
  handler: async (ctx, { workspaceId, path }) => {
    await requireMember(ctx, workspaceId);
    path = checkPath(path);
    const f = await findFile(ctx, workspaceId, path);
    if (f) await deleteFile(ctx, f._id);
    await ctx.db.insert("deletions", { workspaceId, path });
  },
});

// Rename / move a text file.
export const move = mutation({
  args: { workspaceId: v.id("workspaces"), from: v.string(), to: v.string() },
  handler: async (ctx, { workspaceId, from, to }) => {
    const userId = await requireMember(ctx, workspaceId);
    const p = await ensureProfile(ctx, userId);
    from = checkPath(from);
    to = checkPath(to);
    if (from === to) return;
    const f = await findFile(ctx, workspaceId, from);
    if (!f) throw new Error("file not found");
    if (await findFile(ctx, workspaceId, to)) throw new Error("a file with that name already exists");
    if (f.blob) {
      await ctx.db.patch(f._id, { path: to, pendingWrite: true, updatedBy: p.name, updatedAt: Date.now() });
    } else {
      await writeFile(ctx, workspaceId, to, await readContent(ctx, f._id), p.name, true);
      await deleteFile(ctx, f._id);
    }
    await ctx.db.insert("deletions", { workspaceId, path: from });
  },
});
