// Templates, team chat (@ai), and workspace settings. Run against the live backend:
// CONVEX_URL=https://api.tandem.siddharthbobba.com WORKER_HOST=rach node tests/workspace-features.mjs
import assert from "node:assert/strict";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { account, api, stamp, until, URL } from "./helpers.mjs";

const HOST = process.env.WORKER_HOST ?? "localhost";
const sh = async (cmd) => (await promisify(cb)("ssh", [HOST, cmd], { timeout: 30_000 })).stdout.trim();
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
};

const id = stamp();
const ann = await account(`ann-${id}@test.dev`, "ann-pass-123", "Ann");
const ben = await account(`ben-${id}@test.dev`, "ben-pass-123", "Ben");
const cat = await account(`cat-${id}@test.dev`, "cat-pass-123", "Cat");
const anon = new ConvexHttpClient(URL);

await test("templates are listed and a trip workspace is seeded with files + instructions", async () => {
  const ts = await ann.query(api.workspaces.templates, {});
  assert.deepEqual(ts.map((t) => t.id), ["trip", "school", "app", "study", "party", "side", "blank"]);
  const ws = await ann.mutation(api.workspaces.create, { name: "Yosemite", template: "trip" });
  const tree = await ann.query(api.files.tree, { workspaceId: ws });
  assert.deepEqual(tree.map((f) => f.path).sort(), ["budget.md", "itinerary.md", "packing.md"]);
  const w = await ann.query(api.workspaces.get, { id: ws });
  assert.match(w.instructions, /group trip/);
  assert.equal(w.template, "trip");
  assert.equal(w.owner, true);
  const sug = await ann.query(api.workspaces.suggestions, { workspaceId: ws });
  assert.ok(sug.length >= 2);
  // Seeded files reach the workspace disk.
  await until(async () => (await sh(`test -f /srv/tandem/workspaces/${ws}/itinerary.md && echo ok || true`)) === "ok", 20000, "on disk");
});

await test("blank and unknown templates seed nothing; workspace list shows template", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Blank one", template: "nope" });
  assert.equal((await ann.query(api.files.tree, { workspaceId: ws })).length, 0);
  assert.equal((await ann.query(api.workspaces.get, { id: ws })).instructions, "");
  const list = await ann.query(api.workspaces.list, {});
  assert.ok(list.some((l) => l.name === "Yosemite" && l.template === "trip"));
});

await test("team chat: members talk, viewers read with link, outsiders blocked, @ai queues a run", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Chatty" });
  const { inviteCode } = await ann.query(api.workspaces.get, { id: ws });
  await ben.mutation(api.workspaces.join, { inviteCode });
  await ann.mutation(api.chat.send, { workspaceId: ws, text: "hey ben" });
  const r = await ben.mutation(api.chat.send, { workspaceId: ws, text: "hi! lets go saturday" });
  assert.equal(r.toAgent, false);
  const msgs = await ann.query(api.chat.list, { workspaceId: ws });
  assert.deepEqual(msgs.map((m) => `${m.author}:${m.text}`), ["Ann:hey ben", "Ben:hi! lets go saturday"]);
  assert.equal((await anon.query(api.chat.list, { workspaceId: ws, code: inviteCode })).length, 2);
  await assert.rejects(cat.query(api.chat.list, { workspaceId: ws }));
  await assert.rejects(cat.mutation(api.chat.send, { workspaceId: ws, text: "intruder" }));
  await assert.rejects(anon.mutation(api.chat.send, { workspaceId: ws, text: "anon" }));
  const ai = await ben.mutation(api.chat.send, { workspaceId: ws, text: "@ai which day did we pick?" });
  assert.equal(ai.toAgent, true);
  const feed = await ann.query(api.workspaces.paneFeed, { paneId: ai.paneId });
  const run = feed.find((x) => x.fromChat);
  assert.ok(run, "run from chat");
  assert.equal(run.prompt, "which day did we pick?"); // context is hidden from the pane
  assert.equal(run.author, "Ben");
  await ann.mutation(api.workspaces.cancelRun, { runId: run._id });
});

await test("settings: rename + instructions by members; reset link + delete owner-only; leave", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Settings" });
  const { inviteCode } = await ann.query(api.workspaces.get, { id: ws });
  await ben.mutation(api.workspaces.join, { inviteCode });
  await ben.mutation(api.workspaces.rename, { workspaceId: ws, name: "Renamed" });
  await ben.mutation(api.workspaces.setInstructions, { workspaceId: ws, instructions: "Be brief." });
  const w = await ann.query(api.workspaces.get, { id: ws });
  assert.equal(w.name, "Renamed");
  assert.equal(w.instructions, "Be brief.");
  await assert.rejects(cat.mutation(api.workspaces.rename, { workspaceId: ws, name: "x" }));
  await assert.rejects(ben.mutation(api.workspaces.resetLink, { workspaceId: ws }));
  await assert.rejects(ben.mutation(api.workspaces.remove, { workspaceId: ws }));
  const members = await ann.query(api.workspaces.members, { workspaceId: ws });
  assert.deepEqual(members.map((m) => `${m.name}${m.owner ? "*" : ""}`).sort(), ["Ann*", "Ben"]);
  // Non-members (viewers) don't get the invite code from get().
  assert.equal((await anon.query(api.workspaces.get, { id: ws, code: inviteCode })).inviteCode, undefined);
  // Reset: old link stops working.
  const fresh = await ann.mutation(api.workspaces.resetLink, { workspaceId: ws });
  assert.notEqual(fresh, inviteCode);
  await assert.rejects(anon.query(api.workspaces.listPanes, { workspaceId: ws, code: inviteCode }));
  await assert.rejects(cat.mutation(api.workspaces.join, { inviteCode }));
  // Leave.
  await assert.rejects(ann.mutation(api.workspaces.leave, { workspaceId: ws }));
  await ben.mutation(api.workspaces.leave, { workspaceId: ws });
  await assert.rejects(ben.query(api.workspaces.listPanes, { workspaceId: ws }));
  // Delete: access gone immediately, rows purged soon after.
  await ann.mutation(api.workspaces.remove, { workspaceId: ws });
  await assert.rejects(ann.query(api.workspaces.listPanes, { workspaceId: ws }));
  assert.ok(!(await ann.query(api.workspaces.list, {})).some((l) => l._id === ws));
});

await test("instructions limit and name validation", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Limits" });
  await assert.rejects(ann.mutation(api.workspaces.setInstructions, { workspaceId: ws, instructions: "x".repeat(4001) }));
  await assert.rejects(ann.mutation(api.workspaces.rename, { workspaceId: ws, name: "   " }));
  await assert.rejects(ann.mutation(api.chat.send, { workspaceId: ws, text: "  " }));
});

await test("change log: diff + undo a modify, an add and a delete; undo reaches disk", async () => {
  // Simulate a run's changes via the worker API path: write files as the agent would, then record.
  const ws = await ann.mutation(api.workspaces.create, { name: "Undo" });
  const [pane] = await ann.query(api.workspaces.listPanes, { workspaceId: ws });
  await ann.mutation(api.files.save, { workspaceId: ws, path: "a.md", content: "old\n" });
  await until(async () => (await sh(`cat /srv/tandem/workspaces/${ws}/a.md 2>/dev/null || true`)) === "old", 20000, "a on disk");
  // An agent "run": modify a.md, add b.md (through the disk, like the agent does).
  const runId = await ann.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: "pretend" });
  await ann.mutation(api.workspaces.cancelRun, { runId });
  const secret = (await sh("cat ~/convex-backend/worker_secret")).trim();
  if (!secret) throw new Error("no worker secret available to simulate a run");
  const { ConvexHttpClient } = await import("convex/browser");
  const w = new ConvexHttpClient(URL);
  await w.mutation(api.worker.recordChanges, { secret, runId, items: [
    { path: "a.md", kind: "modified", before: "old\n", after: "new\n" },
    { path: "b.md", kind: "added", after: "added\n" },
    { path: "c.md", kind: "deleted", before: "gone\n" },
  ] });
  await ann.mutation(api.files.save, { workspaceId: ws, path: "a.md", content: "new\n" });
  await ann.mutation(api.files.save, { workspaceId: ws, path: "b.md", content: "added\n" });
  const list = await ben.query(api.changes.forRun, { runId }).catch(() => null);
  assert.equal(list, null, "non-member can't read changes");
  const ch = await ann.query(api.changes.forRun, { runId });
  assert.deepEqual(ch.map((c) => c.kind).sort(), ["added", "deleted", "modified"]);
  const d = await ann.query(api.changes.diff, { changeId: ch.find((c) => c.path === "a.md")._id });
  assert.equal(d.before, "old\n"); assert.equal(d.after, "new\n");
  assert.equal(await ann.mutation(api.changes.revertRun, { runId }), 3);
  assert.equal((await ann.query(api.files.get, { workspaceId: ws, path: "a.md" })).content, "old\n");
  assert.equal(await ann.query(api.files.get, { workspaceId: ws, path: "b.md" }), null);
  assert.equal((await ann.query(api.files.get, { workspaceId: ws, path: "c.md" })).content, "gone\n");
  await until(async () => (await sh(`cat /srv/tandem/workspaces/${ws}/a.md; test -e /srv/tandem/workspaces/${ws}/b.md && echo B; cat /srv/tandem/workspaces/${ws}/c.md`)) === "old\ngone", 20000, "undo on disk");
  assert.ok((await ann.query(api.changes.forRun, { runId })).every((c) => c.reverted));
  assert.equal(await ann.mutation(api.changes.revertRun, { runId }), 0, "idempotent");
});

await test("files: delete and rename reach disk; outsiders blocked", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Files" });
  await ann.mutation(api.files.save, { workspaceId: ws, path: "x.md", content: "x\n" });
  await until(async () => (await sh(`cat /srv/tandem/workspaces/${ws}/x.md 2>/dev/null || true`)) === "x", 20000, "x on disk");
  await assert.rejects(cat.mutation(api.files.remove, { workspaceId: ws, path: "x.md" }));
  await ann.mutation(api.files.move, { workspaceId: ws, from: "x.md", to: "notes/y.md" });
  await until(async () => (await sh(`test -e /srv/tandem/workspaces/${ws}/x.md && echo X; cat /srv/tandem/workspaces/${ws}/notes/y.md 2>/dev/null || true`)) === "x", 20000, "moved on disk");
  await assert.rejects(ann.mutation(api.files.move, { workspaceId: ws, from: "notes/y.md", to: "../evil" }));
  await ann.mutation(api.files.remove, { workspaceId: ws, path: "notes/y.md" });
  await until(async () => (await sh(`test -e /srv/tandem/workspaces/${ws}/notes/y.md && echo Y || echo gone`)) === "gone", 20000, "deleted on disk");
  assert.equal((await ann.query(api.files.tree, { workspaceId: ws })).length, 0);
});

await test("polls: create, vote, move vote, unvote; viewers read; @ai sees tallies; pane rename", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Polls" });
  const { inviteCode } = await ann.query(api.workspaces.get, { id: ws });
  await ben.mutation(api.workspaces.join, { inviteCode });
  await assert.rejects(ann.mutation(api.chat.send, { workspaceId: ws, text: "/poll Only one | a" }));
  await ann.mutation(api.chat.send, { workspaceId: ws, text: "/poll Where to? | Tahoe | Yosemite | Big Sur" });
  let [p] = await ann.query(api.chat.list, { workspaceId: ws });
  assert.equal(p.poll.question, "Where to?");
  assert.deepEqual(p.poll.options.map((o) => o.label), ["Tahoe", "Yosemite", "Big Sur"]);
  await ann.mutation(api.chat.vote, { messageId: p._id, option: 1 });
  await ben.mutation(api.chat.vote, { messageId: p._id, option: 1 });
  await ben.mutation(api.chat.vote, { messageId: p._id, option: 0 }); // moves Ben's vote
  [p] = await ann.query(api.chat.list, { workspaceId: ws });
  assert.deepEqual(p.poll.options.map((o) => o.count), [1, 1, 0]);
  assert.equal(p.poll.options[1].mine, true);
  assert.deepEqual(p.poll.options[0].voters, ["Ben"]);
  await ann.mutation(api.chat.vote, { messageId: p._id, option: 1 }); // same option clears
  [p] = await ann.query(api.chat.list, { workspaceId: ws });
  assert.deepEqual(p.poll.options.map((o) => o.count), [1, 0, 0]);
  await assert.rejects(cat.mutation(api.chat.vote, { messageId: p._id, option: 0 }));
  await assert.rejects(anon.mutation(api.chat.vote, { messageId: p._id, option: 0 }));
  assert.equal((await anon.query(api.chat.list, { workspaceId: ws, code: inviteCode }))[0].poll.options[0].count, 1);
  // Pane rename.
  const [pane] = await ann.query(api.workspaces.listPanes, { workspaceId: ws });
  await ben.mutation(api.workspaces.renamePane, { paneId: pane._id, title: "Itinerary" });
  assert.equal((await ann.query(api.workspaces.listPanes, { workspaceId: ws }))[0].title, "Itinerary");
  await assert.rejects(cat.mutation(api.workspaces.renamePane, { paneId: pane._id, title: "x" }));
  await assert.rejects(ann.mutation(api.workspaces.renamePane, { paneId: pane._id, title: "  " }));
});

await test("publish: a single file becomes a public page; only that file; unpublish kills it", async () => {
  const ws = await ann.mutation(api.workspaces.create, { name: "Pub", template: "trip" });
  await assert.rejects(cat.mutation(api.publish.publish, { workspaceId: ws, path: "itinerary.md" }));
  await assert.rejects(ann.mutation(api.publish.publish, { workspaceId: ws, path: "nope.md" }));
  const code = await ann.mutation(api.publish.publish, { workspaceId: ws, path: "itinerary.md" });
  assert.equal(await ann.mutation(api.publish.publish, { workspaceId: ws, path: "itinerary.md" }), code, "idempotent");
  const page = await anon.query(api.publish.view, { code });
  assert.equal(page.path, "itinerary.md");
  assert.match(page.content, /Trip itinerary/);
  assert.equal(page.workspace, "Pub");
  // The page code is not a workspace code: it doesn't open the workspace.
  await assert.rejects(anon.query(api.files.tree, { workspaceId: ws, code }));
  // Live: edits show up.
  await ann.mutation(api.files.save, { workspaceId: ws, path: "itinerary.md", content: "# Updated\n" });
  assert.equal((await anon.query(api.publish.view, { code })).content, "# Updated\n");
  assert.equal((await ann.query(api.publish.status, { workspaceId: ws, path: "itinerary.md" })).code, code);
  await ann.mutation(api.publish.unpublish, { workspaceId: ws, path: "itinerary.md" });
  assert.equal(await anon.query(api.publish.view, { code }), null);
  assert.equal(await anon.query(api.publish.view, { code: "bogus" }), null);
});

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
