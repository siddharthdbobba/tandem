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
  assert.deepEqual(ts.map((t) => t.id), ["trip", "school", "app", "blank"]);
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

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
