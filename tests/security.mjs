// Authorization probe: signed-out and non-member callers must be denied on every
// member-only endpoint. node tests/security.mjs (needs CONVEX_URL)
import { ConvexHttpClient } from "convex/browser";
import { account, api, stamp } from "./helpers.mjs";
const URL = process.env.CONVEX_URL;
const owner = await account(`sec-o-${stamp()}@test.dev`, "sec-pass-123", "Owner");
const stranger = await account(`sec-s-${stamp()}@test.dev`, "sec-pass-123", "Stranger");
const anon = new ConvexHttpClient(URL);
const ws = await owner.mutation(api.workspaces.create, { name: "sec", template: "trip" });
await owner.mutation(api.chat.send, { workspaceId: ws, text: "hi" });
const msg = (await owner.query(api.chat.list, { workspaceId: ws }))[0]._id;
const tries = [
  ["anon away.since", () => anon.query(api.away.since, { workspaceId: ws, since: 0 })],
  ["stranger away.since", () => stranger.query(api.away.since, { workspaceId: ws, since: 0 })],
  ["anon presence.typing", () => anon.query(api.presence.typing, { workspaceId: ws })],
  ["stranger presence.typing", () => stranger.query(api.presence.typing, { workspaceId: ws })],
  ["stranger setTyping", () => stranger.mutation(api.presence.setTyping, { workspaceId: ws, typing: true })],
  ["stranger chat.react", () => stranger.mutation(api.chat.react, { messageId: msg, emoji: "👍" })],
  ["owner chat.react bad emoji", () => owner.mutation(api.chat.react, { messageId: msg, emoji: "<img>" })],
  ["stranger setEmoji", () => stranger.mutation(api.workspaces.setEmoji, { workspaceId: ws, emoji: "🌊" })],
  ["owner setEmoji text", () => owner.mutation(api.workspaces.setEmoji, { workspaceId: ws, emoji: "hello" })],
  ["anon worker.ping", () => anon.mutation(api.worker.ping, { secret: "nope" })],
  ["anon worker.existingWorkspaces", () => anon.query(api.worker.existingWorkspaces, { secret: "nope", ids: [ws] })],
  ["stranger rename", () => stranger.mutation(api.workspaces.rename, { workspaceId: ws, name: "pwned" })],
  ["stranger leave", () => stranger.mutation(api.workspaces.leave, { workspaceId: ws })],
  ["stranger remove", () => stranger.mutation(api.workspaces.remove, { workspaceId: ws })],
  ["stranger duplicate", () => stranger.mutation(api.workspaces.duplicate, { workspaceId: ws })],
  ["anon duplicate", () => anon.mutation(api.workspaces.duplicate, { workspaceId: ws })],
];
let bad = 0;
for (const [name, fn] of tries) {
  try { const r = await fn(); console.log(`ALLOWED ${name}`, JSON.stringify(r)?.slice(0, 80)); bad++; }
  catch (e) { console.log(`denied  ${name}: ${String(e.message).split("\n").find(l => /Error:/.test(l))?.replace(/.*Error: /, "") ?? "error"}`); }
}
const open = await anon.query(api.worker.lastSeen, {});
console.log("public worker.lastSeen ->", typeof open);
const p = await anon.query(api.workspaces.peek, { code: (await owner.query(api.workspaces.get, { id: ws })).inviteCode });
console.log("peek keys:", Object.keys(p).join(","), "people:", JSON.stringify(p.people));
// Owner duplicates: new workspace with the template's text files, only the owner as member.
const dup = await owner.mutation(api.workspaces.duplicate, { workspaceId: ws });
const srcFiles = (await owner.query(api.files.tree, { workspaceId: ws })).map((f) => f.path).sort().join(",");
const dupFiles = (await owner.query(api.files.tree, { workspaceId: dup.id })).map((f) => f.path).sort().join(",");
const dupWs = await owner.query(api.workspaces.get, { id: dup.id });
const dupChat = await owner.query(api.chat.list, { workspaceId: dup.id });
const dupOk = dupFiles === srcFiles && dupWs.name === "sec (copy)" && dupChat.length === 0;
console.log(`duplicate: files match=${dupFiles === srcFiles} name=${dupWs.name} chat=${dupChat.length}`);
if (!dupOk) bad++;
console.log(bad ? `FAIL ${bad} allowed` : "ALL DENIED");
process.exit(bad ? 1 : 0);
