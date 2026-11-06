# Tandem adversarial QA report — 2026-11-05

| Test | Result |
|---|---|
| Empty workspace; two-user presence | PASS |
| `worker.*` rejects a missing secret | PASS |
| File traversal/absolute/empty path validation | PASS on re-run (maintainer fix deployed during test) |
| Two-pane concurrent runs; live event subscription before completion | PASS |
| Three same-pane prompts, ordered and single-run | PASS |
| Follow-up thread context | PASS |
| Agent file sync, browser overwrite to disk, deletion, binary/large skip | PASS |
| Unicode/newlines and 7 KB output | PASS |
| Cancel long run and verify remote process absence | PASS |
| Remove running pane | FAIL; reproduced twice |
| Headless-CDP UI smoke (workspace, panes, files) | PASS |

## Bug: deleting a running pane strands its run

Repro: create a second pane, submit `sleep 5`, wait for `running`, then call `workspaces.removePane`. The agent exits, but `worker.finish` fails trying to update the now-deleted pane; Convex rolls back the status update. Two orphaned runs remain `running`:

- `jn7aesqg333yk4mtfeq579tpvn8hq5jt` / `jd75fccav2hkkx5awrzd0fesms8hqrbp`
- `jn77hbm4we8d59n2219bzd2dwn8hq3b9` / `jd77w28jk3hhbdt16890tvax5n8hqdpe`

Observed worker log: `Update on nonexistent document ID ...` from `worker:finish`; expected: the run reaches a terminal state (or is cancelled) and no orphan remains. Suspected cause: `convex/worker.ts:89` patched a deleted pane in the previously deployed revision, causing the preceding `runs` patch to roll back transactionally. Suggested fix: guard the pane lookup before patching it, and have `removePane` cancel its queued/running runs (and have the worker kill active children) before deletion.

Note: the checked-out `convex/worker.ts` now contains the pane-existence guard, but the live worker logs show the old behavior; deploy/restart synchronization is still required. The fresh retry also showed a queued-then-removed pane can end as `cancelled`, so explicitly define that lifecycle and test both timing races.
