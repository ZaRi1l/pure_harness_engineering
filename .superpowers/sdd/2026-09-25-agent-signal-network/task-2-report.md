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
