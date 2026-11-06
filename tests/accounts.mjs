// Accounts, saved settings, permissions, and per-account subscription routing.
// Run: CONVEX_URL=https://backend WORKER_HOST=myvm node tests/accounts.mjs
import assert from "node:assert/strict";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { account, api, stamp, until, URL } from "./helpers.mjs";

const execFile = promisify(cb);
const HOST = process.env.WORKER_HOST ?? "localhost";
const sh = async (cmd) => (await execFile("ssh", [HOST, cmd], { timeout: 60_000 })).stdout.trim();

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
};

const id = stamp();
const aliceEmail = `alice-${id}@test.dev`;
const alice = await account(aliceEmail, "alice-pass-123", "Alice");
const bob = await account(`bob-${id}@test.dev`, "bob-pass-123", "Bob");
const eve = await account(`eve-${id}@test.dev`, "eve-pass-123", "Eve");
const anon = new ConvexHttpClient(URL);

await test("sign-up creates profile with given name", async () => {
  const me = await alice.query(api.profile.me, {});
  assert.equal(me.email, aliceEmail);
  assert.equal(me.profile.name, "Alice");
  assert.equal(me.profile.provider, "claude");
});

await test("wrong password, taken email, short password are rejected", async () => {
  await assert.rejects(account(aliceEmail, "nope-nope-nope", undefined, "signIn"));
  await assert.rejects(account(aliceEmail, "someone-elses-pw", "Mallory", "signUp"));
  await assert.rejects(account(`short-${id}@test.dev`, "short", "x"));
  // Re-signing up with the right password just signs in; it must not rename or reset.
  const again = await account(aliceEmail, "alice-pass-123", "Renamed", "signUp");
  assert.equal((await again.query(api.profile.me, {})).profile.name, "Alice");
});

await test("settings persist across sessions (sign in again = new device)", async () => {
  await alice.mutation(api.profile.update, { name: "Alice B", color: "#46a758", provider: "openai", model: "gpt-5.5" });
  const again = await account(aliceEmail, "alice-pass-123", undefined, "signIn");
  const me = await again.query(api.profile.me, {});
  assert.equal(me.profile.name, "Alice B");
  assert.equal(me.profile.color, "#46a758");
  assert.equal(me.profile.provider, "openai");
  assert.equal(me.profile.model, "gpt-5.5");
  await again.mutation(api.profile.update, { provider: "claude", model: null });
  assert.equal((await alice.query(api.profile.me, {})).profile.model, undefined);
});

await test("settings validation", async () => {
  await assert.rejects(alice.mutation(api.profile.update, { name: "" }));
  await assert.rejects(alice.mutation(api.profile.update, { color: "red" }));
  await assert.rejects(alice.mutation(api.profile.update, { model: "x; rm -rf /" }));
  await assert.rejects(alice.mutation(api.profile.update, { provider: "evil" }));
});

let ws, pane;
await test("signed-out and non-members are locked out", async () => {
  ws = await alice.mutation(api.workspaces.create, { name: `acct ${id}` });
  [pane] = await alice.query(api.workspaces.listPanes, { workspaceId: ws });
  assert.deepEqual(await anon.query(api.workspaces.list, {}), []);
  await assert.rejects(anon.mutation(api.workspaces.create, { name: "x" }));
  await assert.rejects(eve.query(api.workspaces.get, { id: ws }));
  await assert.rejects(eve.query(api.files.tree, { workspaceId: ws }));
  await assert.rejects(eve.query(api.workspaces.paneFeed, { paneId: pane._id }));
  await assert.rejects(eve.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: "hi" }));
  await assert.rejects(eve.mutation(api.files.save, { workspaceId: ws, path: "x.txt", content: "x" }));
  assert.equal((await eve.query(api.workspaces.list, {})).length, 0);
});

await test("invite code lets bob join; bad code rejected", async () => {
  const { inviteCode } = await alice.query(api.workspaces.get, { id: ws });
  await assert.rejects(bob.mutation(api.workspaces.join, { inviteCode: "wrongcode" }));
  assert.equal(await bob.mutation(api.workspaces.join, { inviteCode }), ws);
  assert.equal(await bob.mutation(api.workspaces.join, { inviteCode }), ws); // idempotent
  assert.equal((await bob.query(api.workspaces.list, {})).length, 1);
  assert.equal((await bob.query(api.workspaces.listPanes, { workspaceId: ws })).length, 1);
});

await test("author comes from account, not client input", async () => {
  await bob.mutation(api.profile.update, { name: "Bob" });
  await bob.mutation(api.workspaces.submitPrompt, { paneId: pane._id, prompt: "say hi" });
  const feed = await alice.query(api.workspaces.paneFeed, { paneId: pane._id });
  assert.equal(feed.at(-1).author, "Bob");
});

await test("prompt runs as the prompter's own sandbox, unconnected -> clear error", async () => {
  const feed = await until(async () => {
    const f = await bob.query(api.workspaces.paneFeed, { paneId: pane._id });
    return ["done", "error"].includes(f.at(-1).status) && f;
  }, 90_000, "bob run finished");
  const r = feed.at(-1);
  assert.equal(r.status, "error");
  assert.equal(r.provider, "claude");
  assert.match(r.events.map((e) => e.text).join("\n"), /Bob's claude subscription isn't connected/);
  const bobMe = await bob.query(api.profile.me, {});
  assert.equal(bobMe.connections.find((c) => c.provider === "claude")?.status, "error");
  // Alice's connection state is untouched by Bob's failure.
  assert.equal((await alice.query(api.profile.me, {})).connections.length, 0);
  // Ran as tdu_<bob sandboxKey>, which now exists with a private home.
  const key = bobMe.profile.sandboxKey;
  assert.match(await sh(`id -un tdu_${key}`), new RegExp(`tdu_${key}`));
  assert.match(await sh(`stat -c %a /srv/tandem/homes/tdu_${key}`), /^700$/);
});

await test("connect flow: worker produces a real auth URL in the user's sandbox", async () => {
  const flowId = await alice.mutation(api.profile.startConnect, { provider: "claude" });
  const me = await until(async () => {
    const m = await alice.query(api.profile.me, {});
    const f = m.flows.find((x) => x._id === flowId);
    return f && f.status !== "starting" && m;
  }, 60_000, "auth url");
  const f = me.flows.find((x) => x._id === flowId);
  assert.equal(f.status, "awaiting_code");
  assert.match(f.authUrl, /^https:\/\/claude\.(com|ai)\/.*oauth\/authorize/);
  // Bob cannot see or touch Alice's flow.
  assert.equal((await bob.query(api.profile.me, {})).flows.some((x) => x._id === flowId), false);
  await assert.rejects(bob.mutation(api.profile.submitCode, { flowId, code: "x" }));
  await assert.rejects(bob.mutation(api.profile.cancelConnect, { flowId }));
  // Pending state lives in Alice's sandbox home only.
  const key = me.profile.sandboxKey;
  assert.equal(await sh(`sudo test -d /srv/tandem/homes/tdu_${key}/.jcode/pending-login && echo yes`), "yes");
  // A bogus code fails cleanly and is not kept.
  await alice.mutation(api.profile.submitCode, { flowId, code: "bogus-code-123#state" });
  const after = await until(async () => {
    const m = await alice.query(api.profile.me, {});
    const x = m.flows.find((y) => y._id === flowId);
    return x && x.status !== "submitting" && x;
  }, 90_000, "submit result");
  assert.equal(after.status, "error");
  assert.equal((await alice.query(api.profile.me, {})).connections.find((c) => c.provider === "claude"), undefined);
});

await test("starting a new connect cancels the old one", async () => {
  const f1 = await alice.mutation(api.profile.startConnect, { provider: "openai" });
  const f2 = await alice.mutation(api.profile.startConnect, { provider: "claude" });
  const me = await alice.query(api.profile.me, {});
  assert.ok(!me.flows.some((f) => f._id === f1 && f.status !== "cancelled"));
  await alice.mutation(api.profile.cancelConnect, { flowId: f2 });
});

await test("sandbox users can't read each other's credentials or other workspaces", async () => {
  const bobKey = (await bob.query(api.profile.me, {})).profile.sandboxKey;
  const aliceKey = (await alice.query(api.profile.me, {})).profile.sandboxKey;
  const eveKey = (await eve.query(api.profile.me, {})).profile.sandboxKey;
  // Eve gets a sandbox via her own workspace, never joins Alice's.
  const eveWs = await eve.mutation(api.workspaces.create, { name: `eve ${id}` });
  const [evePane] = await eve.query(api.workspaces.listPanes, { workspaceId: eveWs });
  await eve.mutation(api.workspaces.submitPrompt, { paneId: evePane._id, prompt: "hi" });
  await until(async () => ["done", "error"].includes((await eve.query(api.workspaces.paneFeed, { paneId: evePane._id })).at(-1).status), 90_000, "eve run");
  const R = "/srv/tandem/workspaces";
  const as = (k, cmd) => sh(`sudo -u tdu_${k} bash -c ${JSON.stringify(cmd)} 2>&1; true`);
  assert.match(await as(eveKey, `ls ${R}`), /Permission denied/);
  assert.match(await as(eveKey, `ls ${R}/${ws}`), /Permission denied/);
  assert.match(await as(eveKey, `ls /srv/tandem/homes/tdu_${bobKey}`), /Permission denied/);
  assert.match(await as(bobKey, `ls /srv/tandem/homes/tdu_${aliceKey}`), /No such file|Permission denied/);
  assert.match(await as(bobKey, "cat /home/sid/convex-backend/admin_key"), /Permission denied/);
  assert.match(await as(bobKey, "curl -s -m3 -o /dev/null -w %{http_code} http://127.0.0.1:3310/version"), /^000/);
  // Bob is a member of Alice's workspace and was granted on his run.
  assert.doesNotMatch(await as(bobKey, `ls ${R}/${ws}`), /Permission denied/);
});

await test("worker API still rejects missing secret", async () => {
  await assert.rejects(anon.query(api.worker.loginQueue, { secret: "x" }));
  await assert.rejects(alice.query(api.worker.loginQueue, { secret: "" }));
});

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
