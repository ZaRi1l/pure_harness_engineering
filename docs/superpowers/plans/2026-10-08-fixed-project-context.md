# Fixed Single-Project Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

The active 2026-10-08 `/goal` authorizes continuous execution without routine human-review pauses. Explicitly requested parallel implementation uses scoped writers in isolated worktrees; it supersedes a generic no-parallel-implementers warning, not the single-writer-per-checkout or path-claim rules.

**Goal:** Make normal Harness commands resolve exactly one validated `project/` child Git and its `.harness/` local state, without project-selection flags or parent-Git fallback.

**Architecture:** `project-context.mjs` owns the fixed, read-only boundary check and returns the existing branded context shape. Runtime and UI entry points consume that context; product claims can cover the child checkout or `.harness/`, while `--core` remains a separate engine-only claim path. Old external bindings remain inspectable by explicit diagnostic APIs but cannot select a project for new writes.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, Git CLI, Windows-compatible path and junction checks.

**Spec:** [Approved design](../specs/2026-10-08-pure-harness-completion-design.md) and [completion checklist](../../pure-harness-completion-checklist.md).

## Global Constraints

- One Harness installation has one product root: canonical `<harnessRoot>/project`, with an independent child `.git`; no registry, default selection, second project, or parent Git fallback.
- Local config is `<harnessRoot>/.harness/config.json` with **exactly seven keys**: `{version:1,layout:'single-project',projectPath:'project',target:'codex'|'claude'|'opencode'|'antigravity',setupId:UUID,createdAt:ISO,updatedAt:ISO}`. Reject missing/extra keys. Its path field is validated, never used to discover another root. Setup writes it last, after successful child and bridge initialization.
- Local management paths are exactly `.harness/tasks`, `.harness/memory`, `.harness/runtime`; a symlink/junction/reparse escape fails closed. The loader and diagnostics never create them.
- Every live context load revalidates the fixed canonical child and its Git identity; a config file is not proof by itself. `project/` may be used through a verified worktree of the same child Git common directory. An unrelated checkout or nested repository is not the selected product. No arbitrary root is accepted.
- `--core` claims remain engine-scoped in `.ai/core-runtime/context-v1`; they cannot claim `project/`, `.harness/`, or old selected-project management paths.
- Explicit legacy external binding and manifest APIs remain read-only diagnostics; no ordinary CLI write may route through them. No migration, cutover, or existing runtime deletion occurs in this plan.
- Preserve ACL and private-data boundaries. No product-specific policy or text is added to engine source; never claim success for unobserved native behavior.
- Product setup, native bridge/hook entry point, ignored-path rules, and package-script edits are owned by companion plans. This plan owns only fixed context, runtime CLI/path policy, catalog task links, listed reader entry points, and self-check. Serialize overlap during integration.

## File map and change budget

| File | Responsibility in this plan |
| --- | --- |
| `scripts/project-context.mjs`, `tests/project-context.test.mjs`, `tests/support/fixed-project-fixture.mjs` | Fixed branded context, own Git/worktree identity, config and canonical-path validation; reusable isolated fixture; retain old loader for diagnostics. |
| `scripts/runtime-state.mjs`, `tests/runtime-state.test.mjs` | Flagless product CLI, `.harness/` claim boundary, core claim exclusion; leave storage schema and lifecycle algorithm intact. |
| `scripts/catalog.mjs`, `tests/preview-server.test.mjs` | Task Spec URLs refer to `.harness/tasks`; catalog source still comes from canonical engine, not copied product code. |
| `scripts/status.mjs`, `scripts/watchdog.mjs`, `scripts/generate-preview.mjs`, `scripts/preview-server.mjs`, `scripts/import-telemetry.mjs`; `tests/status-preview.test.mjs`, `tests/watchdog.test.mjs`, `tests/preview-server.test.mjs`, `tests/codex-rollout-telemetry.test.mjs` | Consume fixed context with no selection flags; keep response/format/telemetry privacy behavior. |
| `scripts/self-check.mjs`, `tests/self-check.test.mjs` | Report fixed setup identity and actual child boundary, while allowing core self-check before setup. |

Budget: these 8 production scripts plus `catalog.mjs`, their focused tests, and no broad refactor. `scripts/hook-runtime.mjs` belongs to the native-bridge plan; `package.json`, guide copy, `.gitignore`, setup and cutover belong to companion plans. Stop for coordination if those ownership boundaries change.

## Review Focus

1. `project/.git` absent while Harness itself is Git: fixed loader rejects; Task 1 tests no parent fallback.
2. `project/` or `.harness/` junction points outside the Harness: loader rejects before write; Task 1 tests both.
3. `cwd` is an unrelated Git checkout or a second nested Git: it cannot silently select/override the child; Task 1 tests rejection.
4. A corrupt or stale `.harness/config.json` names any root except literal `project`: no fallback or repair write; Task 1 tests rejection and unchanged bytes.
5. Old `--project/--checkout/--binding` flags are passed to a stateful CLI: command fails before runtime files change; Task 2 tests this, while diagnostic loader still works.

---

### Task 1: Fixed branded context and child Git identity

**Files:** Modify `scripts/project-context.mjs`; create `tests/support/fixed-project-fixture.mjs`; test `tests/project-context.test.mjs`.

**Interfaces:**
- Produces `getScriptHarnessRoot(moduleUrl: string | URL): string`: absolute parent of the `scripts/` directory containing the calling script; do not search `cwd` for `.git` or `AGENTS.md`.
- Produces `loadFixedProjectContext({ harnessRoot, cwd = process.cwd(), requireSetup = true } = {}): Promise<Readonly<ProjectContext>>`. `harnessRoot` must be explicit and absolute. Return a frozen, `isValidatedProjectContext`-branded `{root, projectRoot, checkoutRoot, harnessRoot, projectId:'project', paths:{tasks,memory,runtime}, adapters:{}}`, with `root === projectRoot === realpath(<harnessRoot>/project)` and path values rooted at canonical `.harness/`. Preserve `loadProjectContext`/`diagnoseProjectContext` only for explicit legacy diagnostics.
- `requireSetup:false` permits an independently initialized child without a config file for setup preview/transaction work; it does not permit a missing child Git or create anything. If config exists, validate it in either mode. `requireSetup:true` requires valid config. Validate the fixed schema above, including UUID/timestamps; never trust its `projectPath` as a join input.
- `cwd` equal to/inside Harness (outside child) selects the primary child. `cwd` in child selects it. `cwd` in an external Git worktree selects that checkout only after matching canonical common Git directory and verified `.git` backpointer to the primary child; an unrelated Git checkout, nested second Git, symlinked location, or missing Git identity fails. Use `lstat` plus canonical paths for junction/symlink components and `git rev-parse` for exact toplevel, gitdir, common-dir, and inside-work-tree. No write during validation.

- [ ] **Step 1: Write failing tests.** Export `fixedFixture({ configured = true } = {})` from the support file, returning `{harnessRoot,projectRoot,linkedRoot,configPath}` after creating temporary Harness Git, independent child `.git`, an initial child commit (fixture-only prerequisite for `git worktree add`), optional exact config, and same-common-dir worktree sibling. In the project-context test assert frozen/branded paths, config-free `requireSetup:false`, missing-config rejection with `requireSetup:true`, same-repo worktree acceptance, unrelated/nested Git and missing child `.git` rejection. Add guarded Windows junction/symlink tests for `project/`, `.harness/`, and a management path; assert legacy diagnostic still reads its old fixture. Snapshot relevant bytes before rejected loads and assert unchanged afterward. Key test:

```js
const f = await fixedFixture();
const value = await loadFixedProjectContext({ harnessRoot: f.harnessRoot, cwd: f.projectRoot });
assert.equal(value.projectId, 'project');
assert.equal(value.projectRoot, await realpath(f.projectRoot));
assert.equal(value.paths.runtime, path.join(await realpath(f.harnessRoot), '.harness', 'runtime'));
assert.equal(isValidatedProjectContext(value), true);
assert.equal(Object.isFrozen(value.paths), true);
```
- [ ] **Step 2: Run RED.** `node --test tests/project-context.test.mjs` must fail on missing `loadFixedProjectContext`/`getScriptHarnessRoot`, not on fixture construction.
- [ ] **Step 3: Implement both exported signatures.** Reuse existing canonical containment and primary/worktree verification where applicable; replace the old general nested-root ban only in the fixed loader with the exact allowed child boundary. When `cwd` is under Harness, check its nearest Git toplevel so a nested unrelated Git is rejected, rather than treated as the primary. Validate root, child `.git`, config, checkout, and all `.harness/` components before branding; do not infer any second root from binding or manifest. Exported skeleton:

```js
export function getScriptHarnessRoot(moduleUrl) { /* parent of this script's scripts/ directory */ }
export async function loadFixedProjectContext({ harnessRoot, cwd = process.cwd(), requireSetup = true } = {}) { /* validate, freeze, brand */ }
```
- [ ] **Step 4: Run GREEN.** `node --test tests/project-context.test.mjs` passes, including old diagnostic tests. Review Focus 1–4 assertions are present.
- [ ] **Step 5: Prepare commit.** Stage only the two task files and commit with Korean conventional message `feat: 고정 단일 프로젝트 컨텍스트 검증`; if another writer is active, leave files ready for root-coordinated commit instead.

### Task 2: Runtime CLI and claim boundary

**Files:** Modify `scripts/runtime-state.mjs`; test `tests/runtime-state.test.mjs`.

**Interfaces:**
- Consumes `loadFixedProjectContext` and `getScriptHarnessRoot` from Task 1.
- Produces `contextFromArgs(argv: string[], { harnessRoot = getScriptHarnessRoot(import.meta.url), cwd = process.cwd(), requireSetup = true } = {}): Promise<{context: ProjectContext,args:string[]}>`. No project-selection flags; it returns remaining command flags, rejecting `--project`, `--checkout`, `--binding`, `--root`, duplicate/conflicting context options before any store access. `runCli(argv, {coreEngineRoot, legacyFixtureRoot, harnessRoot, cwd} = {})` uses it for normal commands; explicit `legacyFixtureRoot` remains test-only.
- Product relative/absolute claims resolve only beneath `checkoutRoot`, or under `.harness/` when prefixed `installation:` or absolute; `.harness/` claims keep `scope_kind:'installation'` distinct. Core `--core` remains an explicit first-argument mode, accepts only claim/release, and rejects `project`, `.harness`, `projects`, `.ai`, `.git`, `node_modules` scopes regardless of case on Windows.

- [ ] **Step 1: Write failing tests.** Use Task 1 fixture. `runCli(['init'], {harnessRoot,cwd:harnessRoot})` creates only `.harness/runtime/{status.json,tasks.json,...}` with `project_id:'project'`; product `claim`/`release-claim` from child and `installation:.harness/tasks/example.md` stay separate. Assert absolute engine source and `.harness` without installation marker cannot become checkout claims. Assert normal old selection flags and `--root` reject with no runtime byte changes. Extend core tests so `project/file` and `.harness/runtime/file` reject before core runtime mutation; retain old core claim and legacy fixture tests. Key assertions:

```js
const f = await fixedFixture();
await runCli(['init'], { harnessRoot: f.harnessRoot, cwd: f.harnessRoot });
assert.equal((await readFile(path.join(f.harnessRoot, '.harness/runtime/status.json'), 'utf8')).includes('"project_id": "project"'), true);
await assert.rejects(runCli(['--project','old','--checkout',f.projectRoot,'--binding',f.configPath,'goal','x'], { harnessRoot: f.harnessRoot, cwd: f.harnessRoot }));
await assert.rejects(runCli(['--core','claim','core-writer','project/file'], { coreEngineRoot: f.harnessRoot }));
```
- [ ] **Step 2: Run RED.** `node --test tests/runtime-state.test.mjs` fails on fixed CLI/claim assertions.
- [ ] **Step 3: Implement signatures and scoped path rules.** Keep `RuntimeStore` storage format, atomic writes, real IDs, turn tokens, and hook precedence unchanged. Replace only selected-project CLI discovery and the hardcoded `projects/${projectId}/` management prefix. Keep `findRoot` as a legacy/test helper, but do not use it for normal project selection; never interpret no flags as permission to fall back to core or legacy runtime. Skeleton:

```js
export async function contextFromArgs(argv, { harnessRoot = getScriptHarnessRoot(import.meta.url), cwd = process.cwd(), requireSetup = true } = {}) { /* reject legacy selection flags; return fixed context plus argv */ }
export async function runCli(argv = process.argv.slice(2), { legacyFixtureRoot, coreEngineRoot, harnessRoot, cwd } = {}) { /* --core path or fixed project path */ }
```
- [ ] **Step 4: Run GREEN.** `node --test tests/runtime-state.test.mjs` passes and no rejected test fixture changed bytes.
- [ ] **Step 5: Prepare commit.** Stage only these task files; Korean conventional message `feat: 고정 프로젝트 런타임과 점유 경계 적용`.

### Task 3: Flagless readers, static preview, and catalog links

**Files:** Modify `scripts/catalog.mjs`, `scripts/status.mjs`, `scripts/watchdog.mjs`, `scripts/generate-preview.mjs`, `scripts/preview-server.mjs`, `scripts/import-telemetry.mjs`; test `tests/status-preview.test.mjs`, `tests/watchdog.test.mjs`, `tests/preview-server.test.mjs`, `tests/codex-rollout-telemetry.test.mjs`.

**Interfaces:** Consumes `contextFromArgs(argv, options)` from Task 2. Preserve `renderStatus`, `inspectRuntime`, `renderStaticPreview`, and `createPreviewServer` callable signatures. Extend `importTelemetry(argv: string[], contextOptions = {}): Promise<void>` only to inject the fixed test fixture; its normal CLI calls with default options. `discoverTaskSpecs(fixedContext)` emits path `.harness/tasks/<filename>.md`, not `projects/project/tasks/...`; calculate task prefix by `path.relative(context.harnessRoot, context.paths.tasks)` so explicit legacy contexts keep their own old prefix. Catalog role/Skill source uses the distinct `context.harnessRoot`, never `context.checkoutRoot` or a copied product tree. Normal direct script invocations use their module-root installation and no project flags; `status --json` and `watchdog --json` remain format options, while `import-telemetry --file <absolute-rollout>` remains explicitly user-selected and does not auto-discover rollouts.

- [ ] **Step 1: Write failing integration tests.** In one isolated fixed fixture, copy the repository's `scripts/` and `preview/` directories into the fixture Harness root before spawning its scripts (so module-anchored discovery points at the fixture). Invoke `node scripts/status.mjs --json`, `watchdog.mjs --json`, `generate-preview.mjs`, and start `preview-server.mjs` without selection flags; assert each sees `project_id:'project'` and `.harness/runtime`, task spec links use `.harness/tasks`, static output stays under `.harness/runtime`, and HTTP `/runtime/snapshot`, `/runtime/catalog`, `/runtime/task-specs`, `/runtime/telemetry` return only selected child state. Exercise a blocked private URL and existing route traversal assertion. In `tests/codex-rollout-telemetry.test.mjs`, use its existing `fixture()` JSONL helper and call `importTelemetry(['--file', file], {harnessRoot,cwd:projectRoot})`; assert `missing` before import, selected `project_id` after, and no prompt/body/original source path leakage. Assert explicit legacy flags fail for these normal entry points without writes. Key assertions:

```js
const f = await fixedFixture();
const context = await loadFixedProjectContext({ harnessRoot: f.harnessRoot, cwd: f.projectRoot });
await mkdir(context.paths.tasks, { recursive: true });
await writeFile(path.join(context.paths.tasks, 'example.md'), '# Example');
assert.deepEqual(discoverTaskSpecs(context).map(x => x.path), ['.harness/tasks/example.md']);
await fixture([[meta('child-1'), cumulative(4, 2)]], async ([rolloutFile]) => {
  await importTelemetry(['--file', rolloutFile], { harnessRoot: f.harnessRoot, cwd: f.projectRoot });
});
assert.equal((await new RuntimeStore(context).readTelemetry()).project_id, 'project');
```

- [ ] **Step 2: Run RED.** `node --test tests/status-preview.test.mjs tests/watchdog.test.mjs tests/preview-server.test.mjs tests/codex-rollout-telemetry.test.mjs` fails on fixed context expectations.
- [ ] **Step 3: Implement the fixed paths.** Use `contextFromArgs` for each normal entry point; do not add project-selection options or an implicit rollout search. For `importTelemetry`, call `contextFromArgs(argv, contextOptions)`. Set catalog task prefix from the relative management path, preserving legacy diagnostic/catalog fixtures. Keep localhost/write-token and symlink asset checks intact. Entry-point pattern:

```js
const { context } = await contextFromArgs(process.argv.slice(2));
const store = new RuntimeStore(context);
```
- [ ] **Step 4: Run GREEN.** Repeat the Step 2 command, then `node tests/all.test.mjs`; both pass. If the broad suite fails in a companion-plan-owned guide test, report the exact failure and defer the guide assertion to integration rather than rewriting guide copy here.
- [ ] **Step 5: Prepare commit.** Stage only the listed scripts/tests; Korean conventional message `feat: 단일 프로젝트 상태와 미리보기 연결`.

### Task 4: Self-check reports the fixed installation honestly

**Files:** Modify `scripts/self-check.mjs`; test `tests/self-check.test.mjs`.

**Interfaces:** `checkRepository(root, options = {}): Promise<Report>` stays callable by tests; `main(argv = process.argv.slice(2), root = getScriptHarnessRoot(import.meta.url), checkOptions = {}): Promise<0|1>` uses script-anchored root, not `findRoot()`. An absent `.harness/config.json` gives a setup-not-run warning while core checks still run; present malformed config or missing/foreign child Git is a failure. A valid setup checks fixed child identity and `.harness/` paths without initializing runtime. Existing explicit legacy `projectBinding` option remains read-only inspection only; CLI `--project/--checkout/--binding` may diagnose but must not present that external binding as the normal installed product.

- [ ] **Step 1: Write failing tests.** Assert self-check on an unconfigured core reports setup missing without creating `project/` or `.harness/`; a valid fixture reports fixed identity; corrupt config, absent child `.git`, or `.harness` junction fails with unchanged bytes. Assert passing legacy binding to the test API does not initialize/choose that external checkout, and the normal no-flag CLI does not use `findRoot` from an unrelated `cwd`. Key assertion:

```js
const f = await fixedFixture();
const originalConfigBytes = await readFile(f.configPath, 'utf8');
const report = await checkRepository(f.harnessRoot, { exerciseRuntime: false, exerciseHttp: false });
assert.equal(report.failures.some(x => /fixed project|child Git|setup/i.test(x)), false);
assert.equal(await readFile(f.configPath, 'utf8'), originalConfigBytes);
```
- [ ] **Step 2: Run RED.** `node --test tests/self-check.test.mjs` fails on fixed-installation assertions.
- [ ] **Step 3: Implement `checkRepository`/`main` behavior.** Consume Task 1 loader with `{harnessRoot: root,cwd: root}` so test-supplied roots do not inherit the caller's unrelated working directory; keep existing core source/config/preview smoke and native `unverified` warnings. Do not turn filesystem presence or candidate files into native success evidence. Report config/child errors as failures, not as an implicit legacy fallback. Signature:

```js
export async function checkRepository(root, options = {}) { /* existing core checks plus fixed context diagnostic */ }
export async function main(argv = process.argv.slice(2), root = getScriptHarnessRoot(import.meta.url), checkOptions = {}) { /* report and return 0 or 1 */ }
```
- [ ] **Step 4: Run GREEN.** `node --test tests/self-check.test.mjs` passes. Then `node tests/all.test.mjs` passes after companion plans and guide assertions are integrated; record any pending cross-plan failures explicitly.
- [ ] **Step 5: Prepare commit.** Stage only these task files; Korean conventional message `test: 고정 프로젝트 자체 점검 추가`.

## Integration handoff and limits

Order: Task 1 → Task 2 → Tasks 3 and 4 (they share the context contract but not production files) → root-coordinated integration with setup/native-bridge/guide/package/ignore plans. Run each RED/GREEN cycle in an isolated Harness fixture; a worker's result alone does not approve its own task. A verifier reruns focused checks and a reviewer inspects boundary/security changes; root records actual commands and results in runtime state. After integration, run `node tests/all.test.mjs`, `npm run self-check`, and a fresh cold-start fixture from the final tested SHA. The native Codex role/Skill/hook and Node hello-app E2E, telemetry provenance, legacy cutover evidence, documentation, push, and branch cleanup are separate acceptance gates, not implied by this plan's unit tests.

No production migration is part of this plan. Do not copy or delete legacy runtime, modify `prototype/preview/data/goal.json`, mark `nativeSmoke` verified, or treat `checkCutover` as passed. If fixed-context tests expose an unowned caller such as `hook-runtime.mjs`, hand it to the bridge-plan owner before integration rather than expanding this budget silently.
