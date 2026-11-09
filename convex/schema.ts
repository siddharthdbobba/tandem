import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const provider = v.union(v.literal("claude"), v.literal("openai"));

export default defineSchema({
  ...authTables,

  // Invite-only signup codes (see convex/invites.ts).
  signupInvites: defineTable({
    code: v.string(),
    uses: v.number(),
    maxUses: v.number(),
    expiresAt: v.optional(v.number()),
    note: v.optional(v.string()),
  }).index("by_code", ["code"]),

  // Saved per-account settings. One row per user.
  profiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    color: v.string(),
    provider: provider, // which of their subscriptions to run on
    model: v.optional(v.string()), // optional model override, e.g. claude-opus-4-6
    sandboxKey: v.string(), // stable id of their Linux sandbox user on the VM
  }).index("by_user", ["userId"]),

  // Which subscriptions a user has connected. Tokens never live here: they sit
  // in the user's own sandbox home on the VM. This is status only.
  connections: defineTable({
    userId: v.id("users"),
    provider: provider,
    status: v.union(v.literal("connected"), v.literal("error")),
    detail: v.optional(v.string()),
  }).index("by_user_provider", ["userId", "provider"]),

  // A pending browser login for a subscription, driven by the worker.
  loginFlows: defineTable({
    userId: v.id("users"),
    provider: provider,
    status: v.union(
      v.literal("starting"), // worker should generate an auth URL
      v.literal("awaiting_code"), // user must visit authUrl and paste code
      v.literal("submitting"), // user pasted; worker should finish
      v.literal("done"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    authUrl: v.optional(v.string()),
    inputKind: v.optional(v.string()),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_user", ["userId"]),

  // A shared project folder, like a Google Drive folder.
  workspaces: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    inviteCode: v.string(),
  }).index("by_invite", ["inviteCode"]),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
  })
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_user", ["userId"]),

  // A prompt pane. All panes in a workspace share one directory.
  panes: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
  }).index("by_workspace", ["workspaceId"]),

  // Agent conversation per (pane, person): each person's agent keeps its own
  // context, stored in their own sandbox, and billed to their subscription.
  threads: defineTable({
    paneId: v.id("panes"),
    userId: v.id("users"),
    sessionId: v.string(),
  }).index("by_pane_user", ["paneId", "userId"]),

  // One prompt submitted to a pane. The worker claims queued runs.
  runs: defineTable({
    workspaceId: v.id("workspaces"),
    paneId: v.id("panes"),
    prompt: v.string(),
    userId: v.id("users"),
    author: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    provider: v.optional(v.string()), // what it actually ran on
    model: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_pane", ["paneId"])
    .index("by_status", ["status"]),

  // Streamed output lines for a run.
  events: defineTable({
    runId: v.id("runs"),
    paneId: v.id("panes"),
    kind: v.union(
      v.literal("message"),
      v.literal("command"),
      v.literal("file"),
      v.literal("error"),
    ),
    text: v.string(),
  }).index("by_pane", ["paneId"]),

  // Mirror of the workspace directory on the VM. Metadata only, so the file
  // tree query stays small no matter how big the files are.
  files: defineTable({
    workspaceId: v.id("workspaces"),
    path: v.string(),
    size: v.number(),
    updatedBy: v.string(),
    pendingWrite: v.boolean(), // edited in browser, worker must write to disk
  })
    .index("by_workspace_path", ["workspaceId", "path"])
    .index("by_pending", ["pendingWrite"]),

  // File contents, one row per file, read only when a file is opened.
  contents: defineTable({
    fileId: v.id("files"),
    content: v.string(),
  }).index("by_file", ["fileId"]),

  // Who is here right now.
  presence: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    paneId: v.optional(v.id("panes")),
    lastSeen: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),
});
