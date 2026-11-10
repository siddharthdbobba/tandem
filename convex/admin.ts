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
        if (f.blob && !dryRun) await ctx.storage.delete(f.blob);
        await del("files", f._id); budget -= 2;
      }
      for (const m of await ctx.db.query("members").withIndex("by_workspace_user", (q) => q.eq("workspaceId", w._id)).collect()) { await del("members", m._id); budget--; }
      for (const pr of await ctx.db.query("presence").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) { await del("presence", pr._id); budget--; }
      for (const fr of await ctx.db.query("browserFrames").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) {
        if (!dryRun) await ctx.storage.delete(fr.image);
        await del("browserFrames", fr._id); budget--;
      }
      for (const bi of await ctx.db.query("browserInputs").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) { await del("browserInputs", bi._id); budget--; }
      for (const m of await ctx.db.query("messages").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) { await del("messages", m._id); budget--; }
      for (const c of await ctx.db.query("changes").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect()) { await del("changes", c._id); budget--; }
      for (const pb of await ctx.db.query("publishes").withIndex("by_workspace_path", (q) => q.eq("workspaceId", w._id)).collect()) { await del("publishes", pb._id); budget--; }
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
      for (const c of await ctx.db.query("connectors").withIndex("by_user", (q) => q.eq("userId", u._id)).collect()) await del("connectors", c._id);
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

// Operator-only (CLI) helpers for live end-to-end checks on a real account.
// Queue a prompt as a given user in a given pane, exactly like the UI would.
export const queueAs = internalMutation({
  args: {
    email: v.string(),
    paneId: v.id("panes"),
    prompt: v.string(),
    model: v.optional(v.string()),
    steerRunId: v.optional(v.id("runs")),
  },
  handler: async (ctx, { email, paneId, prompt, model, steerRunId }) => {
    const user = (await ctx.db.query("users").collect()).find((u) => u.email === email);
    if (!user) throw new Error("no such user");
    const profile = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const pane = await ctx.db.get(paneId);
    if (!profile || !pane) throw new Error("missing profile or pane");
    if (steerRunId) {
      const r = await ctx.db.get(steerRunId);
      if (r && (r.status === "running" || r.status === "queued"))
        await ctx.db.patch(steerRunId, { status: "cancelled", steeredBy: profile.name, finishedAt: Date.now() });
    }
    return ctx.db.insert("runs", {
      workspaceId: pane.workspaceId, paneId, prompt, userId: user._id, author: profile.name,
      status: "queued", steer: !!steerRunId, wantProvider: "claude", wantModel: model,
    });
  },
});

// Make a scratch workspace + pane owned by a user (for live checks).
export const scratchWorkspace = internalMutation({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, { email, name }) => {
    const user = (await ctx.db.query("users").collect()).find((u) => u.email === email);
    if (!user) throw new Error("no such user");
    const id = await ctx.db.insert("workspaces", { name, ownerId: user._id, inviteCode: Math.random().toString(36).slice(2, 14) });
    await ctx.db.insert("members", { workspaceId: id, userId: user._id });
    const paneId = await ctx.db.insert("panes", { workspaceId: id, title: "Main" });
    return { workspaceId: id, paneId };
  },
});

// Remove a scratch workspace and everything in it.
export const dropWorkspace = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    for (const t of ["members", "panes", "files", "presence", "browserFrames"] as const) {
      const rows = await ctx.db.query(t as any).filter((q: any) => q.eq(q.field("workspaceId"), workspaceId)).collect();
      for (const r of rows as any[]) {
        if (r.blob) await ctx.storage.delete(r.blob);
        if (r.image) await ctx.storage.delete(r.image);
        if (t === "files") {
          const c = await ctx.db.query("contents").withIndex("by_file", (q) => q.eq("fileId", r._id)).unique();
          if (c) await ctx.db.delete(c._id);
        }
        await ctx.db.delete(r._id);
      }
    }
    const runs = await ctx.db.query("runs").filter((q) => q.eq(q.field("workspaceId"), workspaceId)).collect();
    for (const r of runs) {
      for (const e of await ctx.db.query("events").filter((q) => q.eq(q.field("runId"), r._id)).collect()) await ctx.db.delete(e._id);
      await ctx.db.delete(r._id);
    }
    await ctx.db.delete(workspaceId);
  },
});

// Read a pane's runs and events compactly.
export const paneLog = internalQuery({
  args: { paneId: v.id("panes") },
  handler: async (ctx, { paneId }) => {
    const runs = await ctx.db.query("runs").withIndex("by_pane", (q) => q.eq("paneId", paneId)).collect();
    const out = [];
    for (const r of runs) {
      const ev = await ctx.db.query("events").withIndex("by_pane", (q) => q.eq("paneId", paneId)).collect();
      out.push({ id: r._id, author: r.author, steer: !!r.steer, status: r.status, steeredBy: r.steeredBy,
        prompt: r.prompt.slice(0, 60), events: ev.filter((e) => e.runId === r._id).map((e) => `${e.kind}: ${e.text.slice(0, 120)}`) });
    }
    return out;
  },
});

// Operator-only: attach a provider login (e.g. GitHub) to an existing user and
// remove the empty duplicate user it created. Refuses if the duplicate owns anything.
export const mergeDuplicate = internalMutation({
  args: { keepUserId: v.id("users"), dropUserId: v.id("users") },
  handler: async (ctx, { keepUserId, dropUserId }) => {
    if (keepUserId === dropUserId) throw new Error("same user");
    const owned = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", dropUserId)).first();
    if (owned) throw new Error("duplicate belongs to a workspace; not merging");
    const accounts = await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", dropUserId)).collect();
    for (const a of accounts) await ctx.db.patch(a._id, { userId: keepUserId });
    for (const s of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", dropUserId)).collect()) {
      for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(t._id);
      await ctx.db.delete(s._id);
    }
    for (const p of await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", dropUserId)).collect()) await ctx.db.delete(p._id);
    await ctx.db.delete(dropUserId);
    return { moved: accounts.map((a) => a.provider) };
  },
});

// Live e2e: send a take-control browser action as a user (skips auth, still members only).
export const browserInputAs = internalMutation({
  args: { email: v.string(), workspaceId: v.id("workspaces"), action: v.any() },
  handler: async (ctx, { email, workspaceId, action }) => {
    const user = (await ctx.db.query("users").collect()).find((u) => u.email === email);
    if (!user) throw new Error("no such user");
    const m = await ctx.db.query("members").withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", user._id)).unique();
    if (!m) throw new Error("not a member");
    await ctx.db.insert("browserInputs", { workspaceId, userId: user._id, action });
  },
});
