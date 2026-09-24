# Agent Signal Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dependency-free Agent Signal Network shared by the live Dashboard and static snapshot, plus a deterministic demo that never mutates the real runtime.

**Architecture:** A classic browser script at `preview/agent-network.js` exposes `globalThis.AgentSignalNetwork` and owns model derivation, deterministic SVG layout, controls, selection, and details. Live Dashboard polling and static generation feed snapshots into that same API. Runtime changes are additive optional signal metadata and an optional exact runtime directory; the demo copies a tracked fixture into `.ai/demo/network-runtime` and points the ordinary preview server at that isolated directory.

**Tech Stack:** Node.js 20 built-ins, browser DOM/SVG APIs, existing `node:test` suite, no package dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-agent-signal-network-design.md`

## Global Constraints

- Preserve commits `4c5bd82` and `d6637ab` and all unrelated user work.
- Do not add D3, Cytoscape, another package, a build step, database, WebSocket, daemon, or orchestration behavior.
- Render one edge per stored signal; never infer an unrecorded relationship or derive task linkage from summary text.
- Never persist prompts, conversations, private reasoning, or chain-of-thought.
- Existing schema-version-1 records with `{time, from, to, kind, summary}` must remain valid.
- `npm run demo:network` and `npm run demo:reset` must never delete, rewrite, or initialize `.ai/runtime`.
- Preserve localhost binding, preview path containment, artifact iframe sandbox, Active Agents, Signal Timeline, Preview Lab, Task Specs, and catalog behavior.
- Before each writer edits, claim its exact paths with `node scripts/runtime-state.mjs claim <agent-id> <path> [...]`; release the claim at handoff.

## Review Focus

- A runtime summary containing `</script><script>` must remain inert in generated static HTML; Task 3 adds an injection regression test.
- Demo cleanup must reject every target except the exact resolved `.ai/demo/network-runtime`; Task 4 tests a sibling sentinel and real-runtime byte preservation.
- A polling update with unchanged selected node/edge must preserve selection, filter, mode, and transform; Task 2 tests controller state retention and Task 3 tests reuse of one controller.
- Free-text task titles that resemble signal summaries must not create task linkage; Task 2 tests exact `task_id` and owner matching only.
- Old signals without metadata and orphan endpoints must render without error; Tasks 1 and 2 add compatibility tests.

---

### Task 1: Add Backward-Compatible Signal Metadata and Runtime Directory Injection

**Files:**
- Modify: `scripts/runtime-state.mjs`
- Modify: `scripts/hook-runtime.mjs`
- Modify: `tests/runtime-state.test.mjs`
- Modify: `tests/hook-runtime.test.mjs`

**Interfaces:**
- Produces: `new RuntimeStore(root, { runtimeDir?, eventLimit?, lockTimeoutMs? })`, where `runtimeDir` is an exact directory containing `status.json`, `tasks.json`, `events.jsonl`, and `claims.json`.
- Produces: `RuntimeStore.addSignal(from, to, kind, summary, metadata?)`, accepting only `task_id`, `status`, `artifact_href`, and `verification_name` when nonempty.
- Produces: lifecycle methods that retain current signatures while accepting an optional final metadata object.
- Consumes: no renderer or server code.

- [ ] **Step 1: Write failing runtime compatibility and isolation tests**

Add tests that prove old and new records coexist and an injected directory leaves the default runtime untouched:

```js
test('signal metadata is optional, allowlisted, and backward compatible', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await store.addSignal('main', 'worker-ui', 'handoff', 'Implement UI');
  await store.addSignal('worker-ui', 'verifier', 'verify', 'Verify UI', {
    task_id: 'ui-task', status: 'running', artifact_href: '/preview/ui.html',
    verification_name: 'ui-tests', body: 'must not persist'
  });
  const signals = (await store.readStatus()).signals;
  assert.deepEqual(Object.keys(signals[0]).sort(), ['from', 'kind', 'summary', 'time', 'to']);
  assert.deepEqual(signals[1], {
    ...signals[1], task_id: 'ui-task', status: 'running',
    artifact_href: '/preview/ui.html', verification_name: 'ui-tests'
  });
  assert.equal('body' in signals[1], false);
});

test('an injected runtime directory never initializes the default runtime', async () => {
  const root = await temporaryRoot();
  const isolated = path.join(root, '.ai', 'demo', 'network-runtime');
  const store = new RuntimeStore(root, { runtimeDir: isolated });
  await store.initialize();
  assert.equal(existsSync(path.join(isolated, 'status.json')), true);
  assert.equal(existsSync(path.join(root, '.ai', 'runtime')), false);
});
```

- [ ] **Step 2: Run the runtime tests and verify RED**

Run: `node tests/runtime-state.test.mjs`

Expected: FAIL because `runtimeDir` is ignored and metadata is not persisted.

- [ ] **Step 3: Implement exact-directory storage and metadata allowlisting**

Use these contracts in `runtime-state.mjs`:

```js
const SIGNAL_METADATA_FIELDS = ['task_id', 'status', 'artifact_href', 'verification_name'];
function signalMetadata(value = {}) {
  return Object.fromEntries(SIGNAL_METADATA_FIELDS
    .filter(key => value[key] !== undefined && value[key] !== null && value[key] !== '')
    .map(key => [key, String(value[key]).slice(0, 500)]));
}

constructor(root, { eventLimit = 100, lockTimeoutMs = 5000, runtimeDir } = {}) {
  this.root = path.resolve(root);
  this.runtime = runtimeDir ? path.resolve(runtimeDir) : path.join(this.root, '.ai', 'runtime');
  this.statusPath = path.join(this.runtime, 'status.json');
  this.tasksPath = path.join(this.runtime, 'tasks.json');
  this.eventsPath = path.join(this.runtime, 'events.jsonl');
  this.claimsPath = path.join(this.runtime, 'claims.json');
  this.lockPath = path.join(this.runtime, '.state.lock');
  this.eventLimit = Math.max(1, eventLimit);
  this.lockTimeoutMs = lockTimeoutMs;
}

async addSignal(from, to, kind, summary, metadata = {}) {
  await this.mutate(({ status, events }) => {
    status.signals = status.signals.concat({
      time: now(), from, to, kind: String(kind).slice(0, 80),
      summary: String(summary).slice(0, 300), ...signalMetadata(metadata)
    }).slice(-50);
    events.push(this.event('agent_signal', `${from} -> ${to}: ${kind}`));
  });
}
```

Keep lifecycle-generated signals additive: copy an explicit `task_id`; result signals may store the explicit outcome as `status`. Extend the CLI `signal` action with existing `option()` parsing for `--task`, `--status`, `--artifact`, and `--verification`.

- [ ] **Step 4: Test explicit hook metadata without changing neutral defaults**

Add a hook test where `SubagentStart` supplies `task_id` and `SubagentStop` supplies `outcome: 'failed'`. Assert the delegate carries `task_id`, the result carries `status: 'failed'`, and a stop without an outcome remains `stopped`.

Run: `node tests/runtime-state.test.mjs` and `node tests/hook-runtime.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the runtime contract**

```powershell
git add scripts/runtime-state.mjs scripts/hook-runtime.mjs tests/runtime-state.test.mjs tests/hook-runtime.test.mjs
git commit -m "feat: add signal network metadata contracts"
```

---

### Task 2: Build the Shared Dependency-Free Network Renderer

**Files:**
- Create: `preview/agent-network.js`
- Create: `tests/agent-network.test.mjs`

**Interfaces:**
- Produces: `globalThis.AgentSignalNetwork.create(host, { staticMode?: boolean })` returning `{ update(snapshot, catalog), getState(), destroy() }`.
- Produces: `globalThis.AgentSignalNetwork.buildModel(snapshot, catalog, viewState)` and `layout(model, width, height)` for deterministic tests.
- Consumes: snapshot shape from the existing `/runtime/snapshot` endpoint plus optional Task 1 metadata.

- [ ] **Step 1: Create a focused fake-DOM test harness and write failing model tests**

The fixture must use literal stored data, including an orphan endpoint and free text that must not become task linkage:

```js
const snapshot = {
  status: {
    agents: [
      { id: 'worker-a', role: 'worker', status: 'completed', current_task: 'UI words only', started_at: '2026-09-25T00:00:00Z', stopped_at: '2026-09-25T00:02:00Z' },
      { id: 'verifier-1', role: 'verifier', status: 'failed', task_id: 'verify-ui' }
    ],
    active_agents: [{ id: 'worker-b', role: 'worker', status: 'running', task_id: 'api-task' }],
    signals: [
      { time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'delegate', summary: 'UI words only' },
      { time: '2026-09-25T00:01:00Z', from: 'worker-a', to: 'orphan-agent', kind: 'handoff', summary: 'Exact stored edge', task_id: 'ui-task' },
      { time: '2026-09-25T00:02:00Z', from: 'verifier-1', to: 'worker-b', kind: 'retry', summary: 'Retry requested', status: 'failed', task_id: 'verify-ui' }
    ], artifact_preview_links: [], verification: { status: 'failed', checks: [] }
  },
  tasks: { tasks: [{ id: 'ui-task', title: 'UI', owner: 'worker-a' }, { id: 'api-task', title: 'API', owner: 'worker-b' }] },
  claims: { claims: [{ agent_id: 'worker-b', scopes: ['src/api'] }] }, events: []
};

test('buildModel uses only lifecycle records and stored signal endpoints and edges', () => {
  const model = api.buildModel(snapshot, { agents: [] }, { mode: 'history', filter: 'all' });
  assert.deepEqual(model.nodes.map(node => node.id).sort(), ['main', 'orphan-agent', 'verifier-1', 'worker-a', 'worker-b']);
  assert.equal(model.edges.length, snapshot.status.signals.length);
  assert.equal(model.nodes.find(node => node.id === 'orphan-agent').status, 'unknown');
});

test('task matching requires exact task_id or task owner and never summary text', () => {
  const model = api.buildModel(snapshot, { agents: [] }, { mode: 'history', filter: 'task', taskId: 'ui-task' });
  assert.equal(model.edges[0].matchesFilter, false);
  assert.equal(model.edges[1].matchesFilter, true);
  assert.equal(model.nodes.find(node => node.id === 'worker-a').matchesFilter, true);
});
```

- [ ] **Step 2: Run the renderer tests and verify RED**

Run: `node tests/agent-network.test.mjs`

Expected: FAIL because `preview/agent-network.js` does not exist.

- [ ] **Step 3: Implement the global API and exact view-model derivation**

Use these concrete primitives inside a classic-script IIFE so the file works both as a served asset and as embedded static source:

```js
((global) => {
  'use strict';
  const FAILURE_KINDS = new Set(['failed', 'blocked', 'retry', 'reject']);
  const normalizeStatus = value => value === 'running' ? 'active' : (value || 'unknown');
  const hash = value => [...String(value)].reduce((result, character) =>
    Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const signalKey = (signal, index) => [signal.time, signal.from, signal.to, signal.kind, index].join('|');
  const exactTaskMatch = (node, edge, task) => Boolean(task) && (
    node?.task_id === task.id || task.owner === node?.id || edge?.task_id === task.id
  );
  global.AgentSignalNetwork = Object.freeze({ create, buildModel, layout });
  Object.freeze(FAILURE_KINDS);
})(globalThis);
```

`buildModel()` first merges lifecycle records by ID, adds any missing active record, and then adds missing exact signal endpoints. It maps every stored signal to one edge with `signalKey`, attaches catalog records by exact role ID, and calculates filter matches only through `exactTaskMatch`, explicit statuses, and explicit kinds. `layout()` seeds node angles with `hash(node.id)`, then runs exactly 80 synchronous iterations of pairwise repulsion, edge attraction, center gravity, collision separation, and bounds clamping. Do not use random values or timers.

- [ ] **Step 4: Add layout, mode, and filter tests**

Assert finite repeatable positions, minimum node separation, one edge per signal, active-path emphasis, history inclusion, failure emphasis, and static mode naming. Include zero-node and one-node snapshots.

Run: `node tests/agent-network.test.mjs`

Expected: PASS for model and layout tests.

- [ ] **Step 5: Write failing DOM interaction tests**

Using the repository's existing small fake-DOM pattern, assert:

```js
const controller = api.create(host, { staticMode: false });
controller.update(snapshot, catalog);
findByData(host, 'node-id', 'worker-b').click();
assert.match(detailText(host), /worker-b/);
findByData(host, 'edge-index', '2').click();
assert.match(detailText(host), /Retry requested/);
setSelect(host, 'network-filter', 'failures');
click(host, 'zoom-in');
const before = controller.getState();
controller.update(structuredClone(snapshot), catalog);
assert.deepEqual(controller.getState(), before);
```

Also test keyboard activation, Live/History, the All/Active/Failures/Current Task controls, task selector, zoom out, wheel zoom, pan, Fit, Reset, missing metadata, and removal of a selected item.

- [ ] **Step 6: Implement SVG DOM, controls, details, and responsive style injection**

Use SVG namespace creation, `<marker>` arrows, visible paths plus transparent hit paths, `role="button"`, `tabindex="0"`, and Enter/Space activation. Keep one root and update it in place. Inject renderer styles once using a fixed `data-agent-network-styles` marker. Return cleanup from `destroy()` for wheel and pointer listeners.

Run: `node tests/agent-network.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit the shared renderer**

```powershell
git add preview/agent-network.js tests/agent-network.test.mjs
git commit -m "feat: add shared agent signal network renderer"
```

---

### Task 3: Integrate the Renderer with Live and Static Preview

**Files:**
- Modify: `preview/index.html`
- Modify: `scripts/generate-preview.mjs`
- Modify: `scripts/preview-server.mjs`
- Modify: `scripts/self-check.mjs`
- Modify: `tests/preview-server.test.mjs`
- Modify: `tests/status-preview.test.mjs`
- Modify: `tests/self-check.test.mjs`

**Interfaces:**
- Consumes: `AgentSignalNetwork.create(...).update(snapshot, catalog)` from Task 2.
- Consumes: `RuntimeStore(..., { runtimeDir })` from Task 1.
- Produces: `createPreviewServer(root, host, { runtimeDir? } = {})` while retaining default behavior.
- Produces: `renderStaticPreview(snapshot, taskSpecs, catalog, networkSource)`.

- [ ] **Step 1: Write failing live integration tests**

Extend the preview-server fixture to copy `agent-network.js`, fetch it, and assert JavaScript content type. Assert the Dashboard HTML still contains `Active Agents` and `Signal Timeline`, contains one full-width `Agent Signal Network` host, and passes the whole snapshot to one retained controller.

Run: `node tests/preview-server.test.mjs`

Expected: FAIL because the asset and host are absent.

- [ ] **Step 2: Wire one live controller into the polling Dashboard**

Load the classic renderer before the existing module script:

```html
<script src="/preview/agent-network.js"></script>
<script type="module">
```

Add a full-width card without removing the existing cards:

```html
<section class="card full"><h2>Agent Signal Network</h2><div id="agent-network"></div></section>
```

Keep `let networkController` outside `paint()`. Inside `paint()`, create it only when the current host differs, then call `networkController.update(x, catalog)`. Do not replace the Network host during polling.

- [ ] **Step 3: Write failing static renderer and injection tests**

Update the static test to pass the real renderer source and a hostile summary:

```js
const hostile = structuredClone(snapshot);
hostile.status.signals = [{ time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker', kind: 'delegate', summary: '</script><script>globalThis.pwned=true</script>' }];
const html = renderStaticPreview(hostile, taskSpecs, { agents: [] }, networkSource);
assert.match(html, /Agent Signal Network/);
assert.match(html, /Snapshot History/);
assert.doesNotMatch(html, /<\/script><script>globalThis\.pwned/);
assert.doesNotMatch(html, /setInterval|runtime\/snapshot/);
```

Run: `node tests/status-preview.test.mjs`

Expected: FAIL because static preview has no shared renderer.

- [ ] **Step 4: Embed the exact renderer source and serialized snapshot safely**

Change the exported signature to:

```js
export function renderStaticPreview(snapshot, taskSpecs = [], catalog = { agents: [], skills: [] }, networkSource = '')
```

Use explicit script-safe functions:

```js
const scriptData = value => JSON.stringify(value)
  .replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const scriptSource = value => String(value).replaceAll('</script', '<\\/script');
```

The CLI reads `preview/agent-network.js`, passes `discoverCatalog(root)`, embeds the source, and initializes `{ staticMode: true }` once. It contains no fetch or interval.

- [ ] **Step 5: Add optional runtimeDir to the live server and extend self-check**

Implement:

```js
export async function createPreviewServer(root, host = '127.0.0.1', options = {}) {
  root = path.resolve(root);
  const store = new RuntimeStore(root, { runtimeDir: options.runtimeDir });
  // retain repository root for preview assets, catalog, and Task Specs
}
```

Self-check must require, copy, fetch, and recognize both `artifact-tabs.js` and `agent-network.js`. It must generate a static preview with the shared source and assert the Network marker exists.

Run: `node tests/preview-server.test.mjs`, `node tests/status-preview.test.mjs`, and `node tests/self-check.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit live/static integration**

```powershell
git add preview/index.html scripts/generate-preview.mjs scripts/preview-server.mjs scripts/self-check.mjs tests/preview-server.test.mjs tests/status-preview.test.mjs tests/self-check.test.mjs
git commit -m "feat: integrate agent network previews"
```

---

### Task 4: Add the Isolated Deterministic Demo

**Files:**
- Create: `scripts/demo-network.mjs`
- Create: `tests/demo-network.test.mjs`
- Create: `tests/fixtures/agent-network-demo/.ai/runtime/status.json`
- Create: `tests/fixtures/agent-network-demo/.ai/runtime/tasks.json`
- Create: `tests/fixtures/agent-network-demo/.ai/runtime/claims.json`
- Create: `tests/fixtures/agent-network-demo/.ai/runtime/events.jsonl`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `tests/all.test.mjs`

**Interfaces:**
- Consumes: `createPreviewServer(root, host, { runtimeDir })` from Task 3.
- Produces: `demoRuntimePath(root)`, `prepareDemo(root)`, `resetDemo(root)`, and `runDemo(root, host, port)`.
- Produces commands: `npm run demo:network` and `npm run demo:reset`.

- [ ] **Step 1: Write failing exact-target safety and isolation tests**

Use a temporary repository root with a real-runtime sentinel:

```js
test('demo preparation and reset touch only the exact demo runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-network-demo-'));
  const realRuntime = path.join(root, '.ai', 'runtime');
  await mkdir(realRuntime, { recursive: true });
  await writeFile(path.join(realRuntime, 'sentinel.txt'), 'keep');
  await prepareDemo(root, fixtureRoot);
  assert.equal(await readFile(path.join(realRuntime, 'sentinel.txt'), 'utf8'), 'keep');
  assert.equal(JSON.parse(await readFile(path.join(demoRuntimePath(root), 'status.json'))).current_goal, 'Inspect agent collaboration');
  await resetDemo(root);
  assert.equal(existsSync(demoRuntimePath(root)), false);
  assert.equal(await readFile(path.join(realRuntime, 'sentinel.txt'), 'utf8'), 'keep');
});
```

Add a rejection test by passing a target override outside `.ai/demo/network-runtime`; the helper must throw `unsafe demo runtime path` before deletion.

- [ ] **Step 2: Run demo tests and verify RED**

Run: `node tests/demo-network.test.mjs`

Expected: FAIL because the demo module and fixture do not exist.

- [ ] **Step 3: Implement safe copy/reset and demo server startup**

The only removable target is:

```js
export function demoRuntimePath(root) {
  return path.resolve(root, '.ai', 'demo', 'network-runtime');
}
function assertDemoTarget(root, target) {
  const expected = demoRuntimePath(root);
  if (path.resolve(target) !== expected) throw new Error('unsafe demo runtime path');
  return expected;
}
```

`prepareDemo()` validates, removes that exact path, creates its parent, and copies only the fixture runtime. `resetDemo()` validates and removes only that exact path. `runDemo()` prepares, calls `createPreviewServer(root, host, { runtimeDir: target })`, and listens on `PURE_HARNESS_DEMO_PORT || 8766`.

- [ ] **Step 4: Add the complete tracked fixture**

Use fixed ISO timestamps. `status.json` must contain lifecycle records for `planner-1`, `worker-ui`, `worker-api`, `integrator-1`, `verifier-1`, and `reviewer-1`, with mixed active/completed/failed/blocked/stopped states. Its stored signals must include exact records for:

```json
[
  {"from":"main","to":"planner-1","kind":"delegate","task_id":"plan","status":"completed"},
  {"from":"main","to":"worker-ui","kind":"delegate","task_id":"ui","status":"completed"},
  {"from":"main","to":"worker-api","kind":"delegate","task_id":"api","status":"active"},
  {"from":"worker-ui","to":"main","kind":"result","task_id":"ui","status":"completed","artifact_href":"/preview/demo-ui.html"},
  {"from":"worker-ui","to":"integrator-1","kind":"handoff","task_id":"integration","status":"completed"},
  {"from":"worker-api","to":"main","kind":"result","task_id":"api","status":"failed"},
  {"from":"integrator-1","to":"verifier-1","kind":"verify","task_id":"verification","status":"completed","verification_name":"integration-tests"},
  {"from":"verifier-1","to":"worker-api","kind":"result","task_id":"api","status":"failed","verification_name":"api-tests"},
  {"from":"main","to":"worker-api","kind":"retry","task_id":"api","status":"active"},
  {"from":"worker-api","to":"verifier-1","kind":"verify","task_id":"api","status":"completed","verification_name":"api-tests"},
  {"from":"verifier-1","to":"reviewer-1","kind":"review","task_id":"review","status":"active"}
]
```

Give every record `time` and `summary`. Add matching tasks, claims, verification checks, artifacts, and readable events. The fixture test asserts required kinds, statuses, parallel delegates, retry order, and all four runtime files.

- [ ] **Step 5: Register scripts and ignored working-copy path**

Add:

```json
"demo:network": "node scripts/demo-network.mjs serve",
"demo:reset": "node scripts/demo-network.mjs reset"
```

Ignore `.ai/demo/network-runtime/`, import the new test from `tests/all.test.mjs`, and run:

`node tests/demo-network.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the deterministic demo**

```powershell
git add .gitignore package.json scripts/demo-network.mjs tests/demo-network.test.mjs tests/all.test.mjs tests/fixtures/agent-network-demo
git commit -m "feat: add isolated agent network demo"
```

---

### Task 5: Document Usage and Run Integrated Verification

**Files:**
- Modify: `README.md`
- Modify: `preview/index.html` only if the Harness Guide needs the same usage text
- Modify: `.ai/tasks/agent-signal-network.md` only to record final exact verification commands if they differ from the approved task spec

**Interfaces:**
- Consumes all prior tasks; produces no new runtime API.

- [ ] **Step 1: Document the four Dashboard surfaces and demo commands**

README must state:

```powershell
# Real project runtime
npm run preview:live

# Isolated deterministic network demo (prints its own URL)
npm run demo:network

# After stopping the demo server
npm run demo:reset
```

Explain that `demo:network` uses `.ai/demo/network-runtime`, never `.ai/runtime`; static `npm run preview` contains an interactive Snapshot History but does not poll.

- [ ] **Step 2: Run focused checks**

```powershell
node tests/agent-network.test.mjs
node tests/runtime-state.test.mjs
node tests/hook-runtime.test.mjs
node tests/status-preview.test.mjs
node tests/preview-server.test.mjs
node tests/demo-network.test.mjs
node tests/self-check.test.mjs
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run the complete deterministic gates**

```powershell
npm test
npm run self-check
npm run preview
git diff --check
```

Expected: exit code 0 for every command. Report self-check environment warnings separately; do not call warnings passes or failures.

- [ ] **Step 4: Perform the demo smoke check without contaminating real runtime**

Record SHA-256 hashes for every existing file under `.ai/runtime` before starting. Run `npm run demo:network`, open the printed URL, and verify node/edge selection, Live/History, task and failure filters, retry styling, pan, zoom, Fit, Reset, Active Agents, and Signal Timeline. Stop the server, run `npm run demo:reset`, recompute the hashes and require an exact match, then require `.ai/demo/network-runtime` to be absent.

- [ ] **Step 5: Request independent verification and review**

Verifier reruns deterministic commands read-only. Reviewer checks edge provenance, private-data boundaries, static injection safety, demo deletion safety, accessibility, polling state preservation, scope drift, and test quality. Fix every Critical/Important finding and rerun affected gates.

- [ ] **Step 6: Commit documentation and final task evidence**

```powershell
git add README.md preview/index.html .ai/tasks/agent-signal-network.md
git commit -m "docs: explain agent signal network workflow"
```

Do not push or merge without a separate explicit user request after final verification.
