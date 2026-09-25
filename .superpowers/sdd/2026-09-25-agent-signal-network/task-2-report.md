# Task 2 report: shared Agent Signal Network renderer

## Changed artifacts

- `preview/agent-network.js`: dependency-free classic-script API with exact stored-signal model, deterministic 80-pass layout, SVG graph, mode/filter/task controls, details, accessible selection, and view transform handling.
- `tests/agent-network.test.mjs`: literal runtime fixture and focused model, layout, interaction, accessibility, and compatibility tests.
- `tests/all.test.mjs`: includes the renderer tests in `npm test`.

## Evidence

- Initial RED: `node tests/agent-network.test.mjs` exited 1 with `ENOENT` for the missing renderer file.
- Initial GREEN: the focused command passed 7/7.
- Self-review RED: a new keyboard-focus assertion failed because an SVG redraw replaced the focused node.
- Focus fix GREEN: `node tests/agent-network.test.mjs` passed 8/8.
- Full suite after the focus fix: first `npm test` run reported 48/49 with one failure; its middle output was truncated by the tool, so the failed test name was not captured. An immediate diagnostic rerun of the same full command passed 49/49, exit 0. This is an intermittent suite result, not claimed as a clean first pass.
- `git diff --check` exited 0 before commit.

## Self-review

- Edges are one-to-one with `status.signals`; the model introduces only lifecycle or exact signal-endpoint nodes. Text summaries cannot create task associations.
- Missing optional metadata and signal-only endpoints render without invented status or links. Node and edge details use text nodes for untrusted strings.
- Controller updates preserve valid selection, mode, filter, task, and transform. Missing selected records clear selection.
- The SVG focus fix restores keyboard focus after a selection redraw. The graph retains all stored history in Live mode and mutes nonmatching context.

## Concerns and remaining work

- The full suite had one intermittent failure on the first post-fix run. The diagnostic rerun was clean, but the first run's failed test name was unavailable due to output truncation.
- Live Dashboard and static-preview wiring belong to Task 3; this task provides only the shared renderer and tests.

## Review-fix handoff

- `preview/agent-network.js`: selected edges now use their stored signal fields plus a duplicate ordinal counted from the newest matching record. This keeps a retained edge's key stable when older signals are pruned. Background pan captures its pointer and clears drag on release, cancellation, or lost capture. Mode, filter, and task selects have explicit accessible names.
- `tests/agent-network.test.mjs`: regressions cover duplicate edge identity through two pruning updates and pointer release outside the graph. The control test asserts exact accessible names and exercises Active and Failures through select change events and rendered emphasis.
- Verification in this fix round: `node tests/agent-network.test.mjs` exited 0, 11/11 passed; `npm test` exited 0, 52/52 passed; `git diff --check` exited 0. The earlier intermittent full-suite failure described above did not recur in this run.
- Remaining integration work is unchanged: Task 3 wires the renderer into live and static views.

## Writer-owned signal identity recovery

- The approved contract is recorded in the design, plan, and Task Spec: new lifecycle and explicit signals get writer-owned UUIDs inside the locked append; caller metadata and CLI input cannot set the ID. Schema version 1 and existing id-less records remain unchanged.
- `scripts/runtime-state.mjs` uses one append helper for delegate, result, and explicit signals. The renderer selects ID-bearing edges by stored ID. Legacy records retain best-effort content/occurrence keys; selection clears when an update changes the selected match count or the sequence cannot be explained by append-only or head-prune-only updates.
- TDD RED before source changes: `node tests/runtime-state.test.mjs` exited 1, 12/16 passed; `node tests/agent-network.test.mjs` exited 1, 10/14 passed. The failures were missing writer IDs, content-based edge keys, and legacy selection retargeting. After implementation, the focused commands passed 17/17 and 15/15. A further single-match legacy replacement regression failed 15/16 before its one-line fix; the final renderer run passed 16/16.
- Final focused evidence: runtime 17/17 passed; renderer 16/16 passed. Tests cover duplicate IDs, lifecycle and explicit signals, caller/CLI spoof attempts, unchanged old v1 records, the 51st-signal retention boundary, stable ID selection, pruned ID clearing, duplicate append, and ambiguous legacy changes. The earlier pan, accessibility, and filter regressions remain in the renderer suite.
- Full-suite evidence is mixed. Before the final legacy regression, the first `npm test` run exited 1 with 58/59 passed: only `event history stays readable during atomic capped updates` failed on Windows `EPERM` renaming `events.jsonl`; a subsequent run passed 59/59. After the final legacy change, `npm test` exited 1 with 59/60 passed on the same test and `EPERM` rename. The test repeatedly reads the file while the writer atomically renames it. The failure-recovery procedure stopped further identical broad reruns; the file-sharing boundary will be diagnosed separately.
- Legacy records without an ID cannot distinguish a replacement when two snapshots are byte-for-byte identical. The renderer clears selection for observable ambiguous changes; durable identity applies to newly written signals.
