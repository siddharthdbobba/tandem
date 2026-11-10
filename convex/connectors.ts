// Per-person connected apps (remote MCP servers). Everything here is scoped to
// the signed-in person: you only ever see and change your own connectors, and
// only your own prompts get their tools. The worker does the VM side.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { ensureProfile, getProfile, requireUser } from "./lib";

// Built-in catalog. All use OAuth except DeepWiki (public, no sign-in).
export const CATALOG = [
  { id: "notion", label: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth", blurb: "Read and update your pages and databases" },
  { id: "linear", label: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth", blurb: "Find, create, and update issues" },
  { id: "github", label: "GitHub", url: "https://api.githubcopilot.com/mcp/", auth: "token", blurb: "Repos, issues, and pull requests (personal access token)" },
  { id: "atlassian", label: "Jira & Confluence", url: "https://mcp.atlassian.com/v2/mcp", auth: "oauth", blurb: "Jira issues and Confluence pages" },
  { id: "deepwiki", label: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", auth: "none", blurb: "Ask questions about any public GitHub repo" },
] as const;

const URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/+-]*)?$/;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{1,4000}$/;
const MAX = 20;

const view = (c: Doc<"connectors">) => ({
  _id: c._id,
  name: c.name,
  label: c.label,
  url: c.url,
  auth: c.auth,
  status: c.status,
  authUrl: c.status === "awaiting_code" ? c.authUrl : undefined,
  tools: c.tools,
  error: c.error,
});

export const catalog = query({
  args: {},
  handler: async () => CATALOG.map((c) => ({ ...c })),
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db.query("connectors").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return rows.map(view);
  },
});

export const add = mutation({
  args: {
    catalogId: v.optional(v.string()),
    label: v.optional(v.string()),
    url: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { catalogId, label, url, token }) => {
    const userId = await requireUser(ctx);
    await ensureProfile(ctx, userId);
    const existing = await ctx.db.query("connectors").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    token = token?.trim() || undefined;
    if (token && !TOKEN_RE.test(token)) throw new Error("That token has characters we can't use.");

    let row: { name: string; label: string; url: string; auth: "oauth" | "token" | "none" };
    if (catalogId) {
      const c = CATALOG.find((x) => x.id === catalogId);
      if (!c) throw new Error("Unknown app");
      if (c.auth === "token" && !token) throw new Error(`${c.label} needs a token.`);
      row = { name: c.id, label: c.label, url: c.url, auth: c.auth };
    } else {
      url = (url ?? "").trim();
      if (!URL_RE.test(url) || url.length > 300) throw new Error("Use a full https:// address.");
      label = (label ?? "").trim().slice(0, 40) || new URL(url).hostname;
      const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "app";
      let name = /^[a-z]/.test(base) ? base : `app-${base}`.slice(0, 20);
      const taken = new Set([...existing.map((e) => e.name), ...CATALOG.map((c) => c.id), "browser"]);
      for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 16)}-${i}`;
      // Custom servers: a token means bearer auth, else try OAuth (servers
      // without auth just connect).
      row = { name, label, url, auth: token ? "token" : "oauth" };
    }
    const same = existing.find((e) => e.name === row.name);
    if (same) {
      if (same.status === "connected") throw new Error(`${row.label} is already connected.`);
      await ctx.db.delete(same._id); // retry a failed or stuck one
    } else if (existing.length >= MAX) {
      throw new Error(`You can connect up to ${MAX} apps.`);
    }
    return ctx.db.insert("connectors", { userId, ...row, status: "adding", token });
  },
});

export const submitCode = mutation({
  args: { id: v.id("connectors"), code: v.string() },
  handler: async (ctx, { id, code }) => {
    const userId = await requireUser(ctx);
    const c = await ctx.db.get(id);
    if (!c || c.userId !== userId) throw new Error("not found");
    if (c.status !== "awaiting_code") throw new Error("This app isn't waiting for a sign-in link.");
    code = code.trim();
    // We only accept the localhost callback the app's sign-in page redirects to.
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/callback\?\S{1,4000}$/.test(code)) {
      throw new Error("Paste the whole address from the page that failed to load (it starts with http://127.0.0.1).");
    }
    await ctx.db.patch(id, { status: "submitting", code, error: undefined });
  },
});

export const remove = mutation({
  args: { id: v.id("connectors") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const c = await ctx.db.get(id);
    if (!c || c.userId !== userId) throw new Error("not found");
    await ctx.db.patch(id, { status: "removing", token: undefined, code: undefined, authUrl: undefined });
  },
});

// ---------- worker side ----------

function check(secret: string) {
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) throw new Error("unauthorized");
}

export const queue = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    const out = [];
    for (const status of ["adding", "submitting", "removing"] as const) {
      for (const c of await ctx.db.query("connectors").withIndex("by_status", (q) => q.eq("status", status)).take(50)) {
        const p = await getProfile(ctx, c.userId);
        if (p) out.push({ _id: c._id, name: c.name, url: c.url, auth: c.auth, status: c.status, token: c.token, code: c.code, sandboxKey: p.sandboxKey });
      }
    }
    return out;
  },
});

export const update = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectors"),
    from: v.string(),
    status: v.union(v.literal("awaiting_code"), v.literal("connected"), v.literal("error"), v.literal("deleted")),
    authUrl: v.optional(v.string()),
    tools: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { secret, id, from, status, authUrl, tools, error }) => {
    check(secret);
    const c = await ctx.db.get(id);
    if (!c || c.status !== from) return false;
    if (status === "deleted") {
      await ctx.db.delete(id);
      return true;
    }
    await ctx.db.patch(id, {
      status,
      authUrl,
      tools,
      error: error?.slice(0, 300),
      token: undefined, // never keep a token once the worker has stored it
      code: undefined,
    });
    return true;
  },
});
