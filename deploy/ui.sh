#!/bin/bash
# Build and deploy the UI. Fails loudly (non-zero) if any step fails.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit -p .
VITE_CONVEX_URL=https://api.tandem.siddharthbobba.com npx vite build >/dev/null
out=$(npx -y wrangler deploy 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -q "Current Version ID" || { echo "$out"; echo "wrangler did not finish"; exit 1; }
js=$(grep -o 'assets/index-[^"]*\.js' dist/index.html | head -1)
# The edge can take a few seconds to pick up a new version: retry for ~30s.
for i in $(seq 1 15); do
  curl -sf "https://tandem.siddharthbobba.com/" | grep -q "$js" && break
  [ "$i" = 15 ] && { echo "live site isn't serving $js after 30s"; exit 1; }
  sleep 2
done
echo "UI deployed: $js"
