import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // A shared project folder, like a Google Drive folder.
  workspaces: defineTable({
    name: v.string(),
    createdBy: v.string(),
  }),

  // A prompt pane. Each pane is its own agent conversation, all panes in a
  // workspace share the same directory.
  panes: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    threadId: v.optional(v.string()), // codex thread, so follow-ups keep context
  }).index("by_workspace", ["workspaceId"]),

  // One prompt submitted to a pane. The worker claims queued runs.
  runs: defineTable({
    workspaceId: v.id("workspaces"),
    paneId: v.id("panes"),
    prompt: v.string(),
    author: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
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

  // Mirror of the workspace directory on the VM.
  files: defineTable({
    workspaceId: v.id("workspaces"),
    path: v.string(),
    content: v.string(),
    updatedBy: v.string(),
    pendingWrite: v.boolean(), // edited in browser, worker must write to disk
  })
    .index("by_workspace_path", ["workspaceId", "path"])
    .index("by_pending", ["pendingWrite"]),

  // Who is here right now.
  presence: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    color: v.string(),
    paneId: v.optional(v.id("panes")),
    lastSeen: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_name", ["workspaceId", "name"]),
});
