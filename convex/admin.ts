import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Admin cleanup for test data. Run from the CLI:
//   npx convex run admin:listUsers
//   npx convex run admin:deleteTestData '{"dryRun": true}'
// A "test" user has an email ending in one of TEST_DOMAINS. Real users are never touched.
const TEST_DOMAINS = ["@test.dev", "@tandem.test"];
const isTest = (email?: string) => !!email && TEST_DOMAINS.some((d) => email.endsWith(d));

export const listUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const real = users.filter((u) => !isTest(u.email)).map((u) => u.email ?? "(no email)");
    return { total: users.length, test: users.length - real.length, real };
  },
});

// Deletes one batch; call repeatedly until it returns done: true.
export const deleteTestData = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const users = (await ctx.db.query("users").collect()).filter((u) => isTest(u.email));
    const testIds = new Set(users.map((u) => u._id as string));
    const counts: Record<string, number> = {};
    const del = async (table: string, id: any) => {
      counts[table] = (counts[table] ?? 0) + 1;
      if (!dryRun) await ctx.db.delete(id);
    };
    let budget = 600; // stay well under Convex's 4096 reads/writes per call

    // Workspaces owned by test users, with everything inside them (a few per call).
    const workspaces = (await ctx.db.query("workspaces").collect()).filter((w) => testIds.has(w.ownerId)).slice(0, 8);
    for (const w of workspaces) {
      if (budget <= 0) break;
      for (const p of await ctx.db.query("panes").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) {
        for (const r of await ctx.db.query("runs").withIndex("by_pane", (q) => q.eq("paneId", p._id)).collect()) { await del("runs", r._id); budget--; }
        for (const e of await ctx.db.query("events").withIndex("by_pane", (q) => q.eq("paneId", p._id)).collect()) { await del("events", e._id); budget--; }
        for (const t of await ctx.db.query("threads").withIndex("by_pane_user", (q) => q.eq("paneId", p._id)).collect()) { await del("threads", t._id); budget--; }
        await del("panes", p._id); budget--;
      }
      for (const f of await ctx.db.query("files").withIndex("by_workspace_path", (q) => q.eq("workspaceId", w._id)).collect()) {
        const c = await ctx.db.query("contents").withIndex("by_file", (q) => q.eq("fileId", f._id)).unique();
        if (c) await del("contents", c._id);
        await del("files", f._id); budget -= 2;
      }
      for (const m of await ctx.db.query("members").withIndex("by_workspace_user", (q) => q.eq("workspaceId", w._id)).collect()) { await del("members", m._id); budget--; }
      for (const pr of await ctx.db.query("presence").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) { await del("presence", pr._id); budget--; }
      await del("workspaces", w._id); budget--;
    }
    if (workspaces.length && !dryRun) return { done: false, counts };

    // Test users' own rows (incl. memberships in workspaces they didn't own) and auth tables.
    for (const u of users.slice(0, 15)) {
      if (budget <= 0) break;
      const prof = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", u._id)).unique();
      if (prof) await del("profiles", prof._id);
      for (const m of await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", u._id)).collect()) await del("members", m._id);
      for (const c of await ctx.db.query("connections").withIndex("by_user_provider", (q) => q.eq("userId", u._id)).collect()) await del("connections", c._id);
      for (const f of await ctx.db.query("loginFlows").withIndex("by_user", (q) => q.eq("userId", u._id)).collect()) await del("loginFlows", f._id);
      for (const s of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u._id)).collect()) {
        for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await del("authRefreshTokens", t._id);
        await del("authSessions", s._id);
      }
      for (const a of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", u._id)).collect()) await del("authAccounts", a._id);
      await del("users", u._id);
      budget -= 10;
    }
    if (users.length > 15 && !dryRun) return { done: false, counts };
    // Any presence/run rows left pointing at deleted users (in other users' workspaces).
    for (const pr of await ctx.db.query("presence").take(500)) if (testIds.has(pr.userId)) await del("presence", pr._id);
    for (const r of await ctx.db.query("runs").take(500)) if (testIds.has(r.userId)) await del("runs", r._id);

    const done = dryRun || users.length <= 15;
    return { done, counts };
  },
});

// Workspace ids that still exist, so the VM can remove orphaned folders.
export const workspaceIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("workspaces").collect()).map((w) => w._id),
});

// Sandbox keys of remaining (real) users, so the VM keeps their Linux users.
export const sandboxKeys = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("profiles").collect()).map((p) => p.sandboxKey),
});
