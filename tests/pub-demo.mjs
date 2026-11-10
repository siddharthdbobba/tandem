// Publish a trip itinerary from a test account and print the public URL.
import { account, api, stamp } from "./helpers.mjs";
const u = await account(`pub-${stamp()}@test.dev`, "pub-pass-123", "Maya");
const ws = await u.mutation(api.workspaces.create, { name: "Yosemite weekend", template: "trip" });
await u.mutation(api.files.save, { workspaceId: ws, path: "itinerary.md", content: "# Yosemite weekend\n\n- **Where:** Tuolumne Meadows\n- **When:** Sat to Sun\n- **Who:** Maya, Jay, Sid\n\n## Day 1\n- Drive in, Tunnel View at sunset\n- Camp at Tuolumne (site 42)\n\n## Day 2\n- Cathedral Lakes hike (7 mi)\n- Drive home\n\n| Item | Cost | Paid by |\n|---|---|---|\n| Campsite | $36 | Maya |\n| Gas | $60 | Jay |\n" });
const code = await u.mutation(api.publish.publish, { workspaceId: ws, path: "itinerary.md" });
console.log(`https://tandem.siddharthbobba.com/#/p/${code}`);
process.exit(0);
