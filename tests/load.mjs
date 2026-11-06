// Burst test: it only runs model work with the connected account from the environment.
import assert from "node:assert/strict";
import { execFile as cb } from "node:child_process";
import { promisify } from "node:util";
import { account, api, sleep, stamp } from "./helpers.mjs";
const execFile = promisify(cb);
const HOST = process.env.WORKER_HOST ?? "localhost";
const WS = Number(process.env.WORKSPACES ?? 8);
const email = process.env.TANDEM_TEST_EMAIL;
const password = process.env.TANDEM_TEST_PASSWORD;
if (!email || !password) { console.log("SKIP load (no connected test account)"); process.exit(0); }
const c = await account(email, password, undefined, "signIn");
const me = await c.query(api.profile.me, {});
assert.equal(me.connections.find((x) => x.provider === me.profile.provider)?.status, "connected", "test account provider is not connected");
const jobs = [];
const tag = stamp();
for (let w = 0; w < WS; w++) {
  const workspaceId = await c.mutation(api.workspaces.create, { name: `load-${tag}-${w}` });
  const [first] = await c.query(api.workspaces.listPanes, { workspaceId });
  const second = await c.mutation(api.workspaces.addPane, { workspaceId, title: "b" });
  for (const [paneId, side] of [[first._id, "a"], [second, "b"]]) {
    await c.mutation(api.workspaces.submitPrompt, { paneId, prompt: `Create ${side}.txt containing exactly ${w}-${side}.` });
    jobs.push({ workspaceId, paneId, side, w });
  }
}
console.log(`submitted ${jobs.length} runs`);
let peak = 0;
const start = Date.now();
while (Date.now() - start < 600_000) {
  const { stdout } = await execFile("ssh", [HOST, "ps -o pid= --ppid $(systemctl --user show -p MainPID --value tandem-worker) | wc -l"]);
  peak = Math.max(peak, Number(stdout.trim()));
  const feeds = await Promise.all(jobs.map((job) => c.query(api.workspaces.paneFeed, { paneId: job.paneId })));
  if (feeds.flat().every((run) => ["done", "error", "cancelled"].includes(run.status))) break;
  await sleep(3_000);
}
await sleep(4_000);
const runs = (await Promise.all(jobs.map((job) => c.query(api.workspaces.paneFeed, { paneId: job.paneId })))).flat();
assert.equal(runs.length, jobs.length, "run count changed");
assert.equal(runs.filter((run) => run.status !== "done").length, 0, "some model runs failed");
let wrongFiles = 0;
for (const job of jobs) {
  const file = await c.query(api.files.get, { workspaceId: job.workspaceId, path: `${job.side}.txt` });
  if (file?.content.trim() !== `${job.w}-${job.side}`) wrongFiles++;
}
assert.equal(wrongFiles, 0, "wrong file contents");
assert.ok(peak <= Number(process.env.MAX_ACTIVE ?? 4), `peak ${peak} over cap`);
console.log(`SUMMARY PASS load: ${runs.length} runs in ${Math.round((Date.now() - start) / 1000)}s, peak ${peak}`);
