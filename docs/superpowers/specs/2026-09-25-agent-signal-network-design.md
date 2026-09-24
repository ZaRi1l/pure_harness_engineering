# Agent Signal Network Design

## Purpose

Add a lightweight observability view that lets a developer understand which Codex agents participated in a workflow, which recorded signals connected them, what is active now, and where failures or retries occurred. The feature visualizes existing Pure Harness runtime state; it does not introduce a new orchestration engine, infer hidden relationships, or retain conversations or private reasoning.

The existing Dashboard responsibilities remain distinct:

- **Active Agents** is the compact current-run summary.
- **Agent Signal Network** visualizes recorded collaboration relationships.
- **Signal Timeline** remains the chronological signal list.
- **Preview Lab** displays UI artifacts produced by the work.

## Scope

The live Dashboard and one-shot static preview share one dependency-free renderer in `preview/agent-network.js`. The live view updates that renderer from `/runtime/snapshot` every three seconds. The static generator embeds the same renderer source and initializes it once with the generation-time snapshot; it performs no polling.

The implementation also provides an isolated deterministic demo runtime. It never reads from or writes to `.ai/runtime`.

Out of scope:

- An orchestration engine, message bus, database, WebSocket service, or telemetry platform.
- D3, Cytoscape, or another graph dependency.
- Agent conversation, prompt, private reasoning, or chain-of-thought storage.
- Inferred signals, inferred task relationships, or synthetic workflow events.
- Automated spawning of real Codex agents for demo data.
- Changes to external projects or `harness_test_game`.

## Data Contract

### Nodes

The renderer builds its node set from the union of:

1. `status.agents`, the retained lifecycle registry.
2. `status.active_agents`, so an active agent cannot disappear from the graph.
3. Exact `from` and `to` identifiers present in stored signals, including `main`.

Lifecycle-backed nodes may display only fields that exist in the snapshot: `id`, `role`, `status`, `current_task`, `started_at`, and `stopped_at`. Model and reasoning values come from the real Agent Catalog record matching the node role. Claims come from `snapshot.claims.claims`. A signal-only endpoint has no fabricated lifecycle metadata.

Status presentation normalizes only explicit values:

- `running` is displayed as `active`.
- `active`, `waiting`, `completed`, `failed`, and `blocked` retain their meaning.
- Neutral hook outcome `stopped` remains `stopped`; it is not treated as success.
- A signal-only endpoint with no lifecycle status is `unknown`.

### Edges

Every edge corresponds one-to-one with an entry in `status.signals`. The renderer never creates an edge to make the graph look complete. Existing records with only `{time, from, to, kind, summary}` remain valid.

The signal writer may accept these optional additive fields:

- `task_id`
- `status`
- `artifact_href`
- `verification_name`

These fields are omitted when unavailable. No new required fields or signal-kind enum is introduced, and schema version 1 remains compatible. Lifecycle hooks may copy an explicit `task_id` or outcome when supplied by the hook payload, but they do not derive semantic metadata from free text.

### Retention and History

History means the data still retained by the current runtime: currently up to 30 lifecycle agents and 50 signals. The UI explains this bounded scope and does not imply permanent telemetry storage.

## Shared Renderer

`preview/agent-network.js` is a classic browser script that exposes a small `globalThis.AgentSignalNetwork` API. This avoids a build step and lets the exact same source run in both environments:

- The live page loads `/preview/agent-network.js` and calls `create(host, options)` followed by `update(snapshot, catalog)`.
- `scripts/generate-preview.mjs` reads the same file, safely embeds its source into the generated HTML, and initializes it once with a serialized snapshot and catalog.

The renderer owns:

- Snapshot-to-view-model conversion.
- Deterministic graph layout.
- SVG creation and updates.
- Live/History mode and filters.
- Node and edge selection.
- Detail rendering.
- Pan, zoom, fit, and reset state.
- Responsive behavior and renderer-specific styles.

The Dashboard keeps the controller instance across polling updates. `update()` preserves the selected item, mode, filter, task selection, and transform when those values remain valid. Static preview uses `staticMode: true`, which removes live-only controls and labels the mode `Snapshot History`.

## Graph Layout and Interaction

The graph uses SVG with deterministic initial positions derived from stable node identifiers and a bounded force-layout pass. Repulsion, link distance, centering, and collision spacing minimize overlap for the retained maximum of 30 agents. Multiple edges between the same endpoints use curved offsets. Arrow markers show direction; self-links, if recorded, render as loops.

Controls provide:

- Zoom in and out.
- Wheel zoom centered on the pointer.
- Background drag to pan.
- `Fit` to fit the current graph bounds.
- `Reset` to restore the deterministic layout and default transform.

Nodes and edges are mouse- and keyboard-selectable. Visible SVG elements and enlarged transparent edge hit targets support selection without making thin paths difficult to click. Selected and keyboard-focused elements have visible focus treatment.

The panel is full-width. On wide screens the graph and detail panel sit side by side; on narrow screens the detail panel moves below the graph.

## Modes and Filters

### Live

Live mode emphasizes active nodes and the exact stored signal paths connected to them. Historical context remains visible but muted. If no agent is active, the graph remains available and displays `No active flow` rather than becoming empty.

### History and Snapshot History

History displays all retained nodes and signals. Static preview presents the same behavior as `Snapshot History` and never polls.

### Filters

- `All` keeps every element in the current mode at normal mode opacity.
- `Active` emphasizes active nodes and their directly connected stored edges.
- `Failures` emphasizes explicit `failed` or `blocked` nodes and signals whose exact `kind` or optional `status` is `failed`, `blocked`, `retry`, or `reject`.
- `Current Task` uses only exact agent task linkage, task ownership, or signal `task_id`.
- The task selector lists snapshot tasks and highlights only agents and signals with exact task linkage.

Nonmatching elements are muted rather than removed so workflow context remains understandable. When a selected task has no linked network data, the UI states that fact. It does not guess based on summaries.

## Detail Panel

Selecting a node shows available values for Agent, Role, Status, Model, Reasoning, Current/Last Task, Started, Finished, Elapsed, Claims, and inbound/outbound Signals. Verification and artifacts appear only when explicitly linked by stored metadata.

Selecting an edge shows From, To, Kind, Summary, Sent, and any stored `task_id`, `status`, `artifact_href`, or `verification_name`. It never displays source prompts, full messages, or private reasoning.

An empty selection shows a short usage hint and graph counts. If there are no agents or signals, the Network card displays a valid empty state while Active Agents and Signal Timeline continue to render normally.

## Failure and Recovery Presentation

Normal, active, completed, warning/retry, and failed/blocked states use distinct colors and line treatments that remain understandable without animation. `retry` is visually emphasized as a recovery relationship. A failed verifier followed by an explicit worker retry and later successful verification therefore remains visible as three recorded relationships; the renderer does not collapse them into a single inferred state.

## Isolated Demo Runtime

Tracked fixture files live under `tests/fixtures/agent-network-demo/.ai/runtime/`. The fixture contains:

- Main delegating to Planner.
- Main delegating in parallel to Worker A and Worker B.
- Worker result signals to Main.
- Worker handoff to Integrator.
- Successful verification.
- Failed verification, explicit Worker retry, and later successful verification.
- Reviewer participation.
- A mix of active, completed, failed, stopped, and blocked lifecycle states.
- Tasks, claims, artifact links, verification records, and optional signal metadata needed to exercise filters and details.

`npm run demo:network` performs these steps:

1. Resolve and validate the exact repository-local target `.ai/demo/network-runtime`.
2. Remove only that target if it exists.
3. Copy the tracked fixture runtime into that target.
4. Start the normal preview UI against the copied demo runtime on a documented localhost port.

`npm run demo:reset` resolves and validates the same exact target and removes only it. Neither command mutates `.ai/runtime`. `npm run preview:live` continues to use the real runtime.

The preview server gains only an optional runtime-root parameter. Static asset, catalog, task-spec, localhost, traversal, and sandbox policies remain unchanged.

## Static Preview

`npm run preview` still writes `.ai/runtime/preview.html`, because that is the requested output artifact. Reading the real snapshot and writing the output file are its only runtime interactions. The embedded Network is initialized from that snapshot once and supports selection, details, Snapshot History filters, pan, zoom, fit, and reset entirely client-side.

The generated HTML escapes serialized data and embedded script boundaries so runtime summaries cannot terminate a script element or inject markup.

## Error Handling and Compatibility

- Missing `agents`, `active_agents`, `signals`, tasks, claims, catalog records, or optional metadata become empty collections or omitted detail rows.
- Orphan signal endpoints still render as `unknown` nodes because the stored edge names them.
- Duplicate, cyclic, parallel, and self-directed stored signals remain distinct selectable edges.
- Invalid timestamps display as unknown rather than throwing.
- A live fetch failure leaves the last valid graph visible and uses the existing Dashboard error message.
- Old schema-version-1 runtime files remain readable without migration.
- Active Agents and Signal Timeline retain their existing source data and purpose.

## Testing and Verification

Tests use only repository fixtures and dependency-free test utilities.

Renderer tests cover:

- Zero agents and zero signals.
- One agent.
- Multiple agents and parallel/cyclic/multiple edges.
- Delegate, handoff, result, verify, review, failed, blocked, retry, and reject presentation.
- Live, History, and static Snapshot History modes.
- All, Active, Failures, Current Task, and task-selector behavior.
- Node and edge keyboard/mouse selection and exact detail fields.
- Selection and transform retention across updates.
- Deterministic finite layout, collision spacing, zoom, fit, and reset.
- Missing metadata and orphan endpoints.

Integration tests cover:

- Live Dashboard asset serving and polling integration.
- Static preview embedding the shared renderer and snapshot without polling.
- Existing Active Agents and Signal Timeline.
- Optional signal metadata backward compatibility.
- Demo fixture completeness and isolated copy/reset path safety.
- Existing Preview Lab, Task Specs, catalog, runtime, hook, traversal, and iframe policies.

Required verification commands are:

```powershell
npm test
npm run self-check
npm run preview
npm run demo:network
```

The demo server is manually inspected at its printed localhost URL, then stopped and cleaned with `npm run demo:reset`. A real-Codex hook smoke test remains a documented manual E2E step; it is not part of deterministic unit tests and does not modify product files.

## Risks and Constraints

- SVG layout quality is intentionally optimized for the retained small graph, not unbounded telemetry volumes.
- History is capped by the existing runtime retention limits.
- Task, artifact, and verification detail is sparse until callers record explicit optional metadata.
- Browser behavior is primarily covered by deterministic DOM tests and localhost smoke checks; manual demo inspection remains the final visual check.
- The change must not introduce a package dependency, schema migration, background daemon, or broad Dashboard/runtime refactor.
