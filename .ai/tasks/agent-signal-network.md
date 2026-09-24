# Agent Signal Network

## Goal

Add a shared static/live Agent Signal Network and isolated deterministic demo so developers can inspect recorded agent collaboration without changing orchestration behavior.

## Requirements

- Keep Active Agents and Signal Timeline while adding a full-width interactive node/edge network.
- Use only stored lifecycle records and signals; never infer or fabricate relationships.
- Share `preview/agent-network.js` between `preview:live` and the generated static preview.
- Support node/edge details, Live/History or Snapshot History, task/failure filters, pan, zoom, fit, and reset.
- Preserve old signal records while permitting only minimal optional linkage metadata.
- Provide `demo:network` and `demo:reset` using `.ai/demo/network-runtime`, never `.ai/runtime`.
- Include the approved Planner, parallel Worker, Integrator, Verifier failure/retry/success, and Reviewer fixture flow.

## Out of Scope

- External graph dependencies, orchestration changes, databases, WebSockets, telemetry services, private conversation storage, real-agent demo spawning, and external project changes.

## Affected Area

- `preview/`, static preview generation, preview server runtime-root selection, runtime signal metadata, demo scripts/fixtures, package scripts, documentation, and focused tests.

## Constraints

- Node.js 20+ and browser built-ins only.
- Existing schema-version-1 runtime files remain compatible.
- Existing localhost, traversal, iframe, and sandbox policies remain intact.
- Writers claim non-overlapping paths and preserve the local unpushed commit `4c5bd82`.

## Acceptance Criteria

- Zero, one, and many-node snapshots render without errors.
- Every rendered edge corresponds to a stored signal and is selectable.
- Live emphasizes active recorded paths; History shows all retained records; static uses one snapshot without polling.
- Filters and details use exact stored linkages and explain missing linkage.
- Failure, blocked, retry, and reject states are visually distinct.
- Static and live use the same renderer source.
- Demo commands cannot delete or modify `.ai/runtime` and expose all requested visual scenarios.
- Existing Active Agents, Signal Timeline, Preview Lab, Task Specs, runtime, and hooks regressions remain green.

## Verification

- Focused renderer, runtime, static preview, preview server, demo safety, and fixture tests.
- `npm test`
- `npm run self-check`
- `npm run preview`
- Manual `npm run demo:network` inspection followed by `npm run demo:reset`.

## Risk

- Polling could reset selection or viewport, optional metadata could accidentally become required, static embedding could permit script termination, or demo cleanup could target the wrong directory. Tests must pin each boundary before implementation.
