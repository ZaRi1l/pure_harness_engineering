# Dashboard Integration and Final End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The root agent coordinates integration, native observations, and release; this document is a plan, not evidence of completion.

The active `/goal` authorizes scoped continuous execution without routine human-review pauses. Explicit parallel work uses isolated branches/worktrees; overlapping writers remain serialized.

**Goal:** Integrate the restored dashboard and beginner guide, prove the real modules and fixed single-project installation work together, then accept only an observed Codex cold start before documenting and releasing the exact tested core.

**Architecture:** Keep `preview/` widgets as their existing modules and mount them in the dashboard without substitute implementations. Consume the fixed `project/` context and `.harness/` runtime interfaces produced by the companion core plans; run the final acceptance against a remote-free copy of one tested core SHA, then document only observations from that copy. Native Codex availability and actual supported schemas are measured, never inferred from candidate files or model prose.

**Tech Stack:** Node.js 20+ built-ins and `node:test`, Git, PowerShell 7, existing browser-facing ES modules and local HTTP server, installed Codex native CLI/app.

**Spec:** `docs/superpowers/specs/2026-10-08-pure-harness-completion-design.md`; acceptance checklist `docs/pure-harness-completion-checklist.md`.

## Global Constraints

- One Harness installation owns exactly one fixed `project/` child Git; local config/tasks/memory/runtime live under ignored `.harness/`. Core Git ignores both `project/**` and `.harness/**`.
- The agreed fixed context API is `loadFixedProjectContext({ harnessRoot, cwd, requireSetup = true })`, returning compatible `root`, `checkoutRoot`, `projectId: 'project'`, `paths`, and `harnessRoot`. Setup API is `planProjectSetup({ harnessRoot, mode, source, target })` and `applyProjectSetup({ harnessRoot, plan })`; selected target is one of `codex`, `claude`, `opencode`, `antigravity`.
- `.harness/config.json` schema is `{ version: 1, layout: 'single-project', projectPath: 'project', target, setupId, createdAt, updatedAt }`. The fixed-context planner owns the catalog `taskPrefix` correction to `.harness/tasks`; setup consumes that context. Do not independently invent context flags or a second registry.
- Parent `AGENTS.md` scope, current-document ACLs, generated-file ownership, and private artifact boundaries remain enforced. No product policy, credential, rollout path, or prompt/output body enters neutral core or the dashboard.
- No global model/provider/auth/concurrency/fork changes. Native Codex is the required live target; the other three remain `unverified` without their own native evidence.
- Final native acceptance uses a persistent, non-ephemeral Codex session that can produce an actual rollout for telemetry. Do not bypass hook trust or weaken default/global trust settings to force a pass; an unsupported permission path remains unverified.
- Do not mark a native hook, role, Skill, permission, or cutover passed from a fixture, candidate file, elapsed time, or model statement. Legacy runtime migration and source-project cleanup are out of scope.
- Workers claim exact engine paths with `node scripts/runtime-state.mjs --core claim <native-agent-id> <path>...`, release with `--core release-claim`, use isolated worktrees for parallel writes, and make Korean conventional commits. Root serializes overlapping integration writes and owns final merge/push.
- UI checks use real `createTaskEditor`, `createTelemetryPanel`, `renderArtifactTabs`, `createGuidePanel`, `PreviewPreferences`, and `AgentSignalNetwork` implementations. A small DOM shim may supply platform primitives; no fake replacement widget/controller is an acceptance test.

## Review Focus

1. A selected task survives a fresh telemetry poll, but failed refresh shows stale data without replacing it with zero — pinned in Task 2's integrated DOM test.
2. A blocked external/private URL and a malformed URL never become an iframe or a live-app link — pinned in Task 2's integrated DOM and HTTP tests.
3. A slow earlier response cannot replace a newer tasks/snapshot response, and draft/focus/scroll survive tab and locale changes — pinned in Task 2's integrated DOM test.
4. Missing/future lifecycle timestamps never become live-agent claims or active counts based on age — pinned in Task 3's dashboard regression test.
5. An empty neutral child with no product artifacts and no rollout still boots from core alone, with `missing` telemetry rather than fabricated usage — pinned in Task 5's cold-start test and Task 6's live smoke record.

## Goal, exclusions, acceptance, and change budget

This plan owns the dashboard/guide integration, integrated UI checks, final neutral cold-start and native smoke choreography, observation-based docs, and release provenance. It does not redesign the fixed setup, bridge, runtime, cutover, or telemetry APIs: those are predecessors delivered and reviewed under companion plans. Required outcomes are the checklist's screen/guide, native Codex, final app E2E, actual-procedure documentation, and final cleanup rows. A failed native capability stays explicitly incomplete; it does not widen scope to global settings or other tools.

Change budget: three UI modules plus index/style and focused UI tests; one read-only provenance inventory script and its test if needed; README/first-use/advanced/setup/guide/native worksheet and progress evidence only after observed success; minimal `package.json` and `tests/all.test.mjs` serialization after all worker tests land. If an integration needs changes in setup, context, cutover, or product source, return it to that owner/root instead of silently expanding this budget.

## File and owner map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Integrated shell | `preview/dashboard.js`, `preview/index.html`, `preview/preferences.js`, `preview/guide-panel.js` | Actual four dashboard panes, navigation, locale, current guide copy |
| Existing widgets | `preview/task-editor.js`, `preview/telemetry-panel.js`, `preview/artifact-tabs.js`, `preview/agent-network.js` | Imported/loaded as real implementations; Task 3 owns only task-editor's remaining visible-message locale repair |
| UI gates | `tests/dashboard-tabs.test.mjs`, `tests/guide-panel.test.mjs`, `tests/dashboard-integration.test.mjs`, `tests/preview-server.test.mjs`, `tests/status-preview.test.mjs`, `tests/preview-preferences.test.mjs` | Focused and connected-DOM/HTTP assertions |
| Final test wiring | `tests/all.test.mjs`, `package.json` | Include new suites once; serialize only dependent fixtures/integration phases |
| Release inventory | `scripts/worktree-inventory.mjs`, `tests/worktree-inventory.test.mjs` | Read-only, exact branch/worktree/dirty/ignored/provenance report; never delete |
| Observed docs | `README.md`, `docs/first-use.md`, `docs/advanced-first-use.md`, `docs/setup-reference.md`, `docs/native-smoke-worksheet.md`, `docs/pure-harness-completion-progress.md` | Successful commands, failure/recovery, and evidence references; root coordinates overlapping writes |

## Dependencies and ordered tasks

Tasks 1–3 can be prepared while core workers finish, but Task 4 consumes their reviewed fixed-context/setup/bridge/runtime APIs. Task 5 is run only from the fully integrated and tested exact SHA. Task 6 requires a new native session in that copy. Task 7 follows only successful live steps. Task 8 follows E2E and documentation replay. No phase is accepted solely because a later phase ran.

### Task 1: Merge the prepared UI and guide work without losing either

**Files:** Modify `preview/dashboard.js`, `preview/index.html`, `preview/preferences.js`, `preview/guide-panel.js`; create/modify `tests/dashboard-tabs.test.mjs`, `tests/guide-panel.test.mjs`, `tests/preview-preferences.test.mjs`, `tests/preview-server.test.mjs`.

**Interfaces:** Consumes existing `createTaskEditor(host,{fetchImpl,translate})`, `createTelemetryPanel(host,{fetchImpl,translate})`, `renderArtifactTabs(host,artifacts,options)`, and global `AgentSignalNetwork.create(host,options)` / `PreviewPreferences.create(document)`. Produces four mounted dashboard panes and a `createGuidePanel({document,translate})` guide route. No new widget implementation.

- [ ] **Step 1:** On the integration branch, record `git status --short`, `git log -1 --format=%H` for each source worktree, and `git diff --check`; require clean source changes or inventory them before cherry-picking. Cherry-pick `f3424b7`, then `551168e` (depends on restored dashboard), then `60c8c2e`; resolve overlaps by preserving the real widget mounts and all guide translations. Root handles commit serialization.
- [ ] **Step 2:** Run `node --test tests/dashboard-tabs.test.mjs tests/guide-panel.test.mjs tests/preview-preferences.test.mjs tests/status-preview.test.mjs tests/preview-server.test.mjs`. Expected: all pass, including locale and route tests; record count and exit code.
- [ ] **Step 3:** Inspect `preview/index.html` module/script registrations and `preview/dashboard.js` imports after merge. Assert `createGuidePanel` and the four existing widget modules are genuinely loaded, and no stale hard-coded `guide.body` route masks the selected new/existing/connected decision panel.
- [ ] **Step 4:** Commit the conflict resolution only if needed with a Korean conventional message; retain all source SHAs in the progress record. Do not claim a passed full suite yet.

### Task 2: Prove the connected dashboard, navigation, privacy, and freshness

**Files:** Create `tests/dashboard-integration.test.mjs`; modify `tests/all.test.mjs`; modify `preview/dashboard.js` or `preview/index.html` only for demonstrated failures. Reuse `tests/preview-server.test.mjs` for HTTP route/security assertions.

**Interfaces:** Consumes Task 1 shell and real modules above, real `createGuidePanel`, plus `/runtime/snapshot`, `/runtime/tasks`, `/runtime/telemetry`, `/runtime/task-specs` response shapes. Produces test-local `mountIntegratedDashboard({ fetchImpl, hash = '#dashboard' }) -> { document, navigate(hash), tick(), settle(), preferences }` that executes actual modules together; platform-only element/document/fetch shims are allowed, widget stubs are not.

- [ ] **Step 1:** Write failing `dashboard-integrated-navigation-keeps-real-widgets` test: import the three ES widget functions and artifact renderer, evaluate the real global preferences/network scripts, execute `dashboard.js` against a DOM fixture, and assert each pane's real nodes/controllers are present. Select Tasks, Agents, Telemetry, Preview, and Guide; assert `aria-selected`, hidden panes, keyboard tab change, guide new/existing/connected copy, and return to Dashboard.

  ```js
  const ui = await mountIntegratedDashboard({ fetchImpl });
  assert.ok(ui.document.querySelector('#tasks [data-task-action="add"]'));
  assert.ok(ui.document.querySelector('#telemetry [data-telemetry-task="selector"]'));
  assert.ok(ui.document.querySelector('#agent-network svg'));
  ui.document.querySelector('#dashboard-tab-tasks').click();
  assert.equal(ui.document.querySelector('#dashboard-tab-tasks').getAttribute('aria-selected'), 'true');
  ui.navigate('#guide');
  assert.ok(ui.document.querySelector('[data-guide-choice="existing"]'));
  ```
- [ ] **Step 2:** In that test, make a task draft and selected telemetry task; poll with a new snapshot and telemetry document; change locale; assert draft, selected task, focus, scroll, controller state, and actual translated nodes persist. Resolve an older pending `/runtime/tasks` and `/runtime/snapshot` response last; assert its title/token/agent data did not overwrite the newer result. Then reject telemetry refresh: assert last measured values remain with `data-telemetry-state="stale"` and no invented zero.

  ```js
  const draft = ui.document.querySelector('#tasks [data-task-field="title"]');
  draft.value = 'unsaved'; draft.focus(); draft.scrollTop = 17;
  ui.preferences.setLocale('ko'); await ui.tick();
  assert.equal(draft.value, 'unsaved');
  assert.equal(ui.document.activeElement, draft);
  assert.equal(draft.scrollTop, 17);
  olderTasks.resolve({ tasks: [{ title: 'stale' }], write_token: 'stale-token' });
  await ui.settle();
  assert.doesNotMatch(ui.document.querySelector('#tasks').textContent, /stale/);
  assert.equal(ui.document.querySelector('[data-telemetry-state="stale"]') !== null, true);
  ```
- [ ] **Step 3:** Write failing `dashboard-integrated-artifact-privacy` test through the Preview pane with one registered same-origin local artifact, one foreign HTTPS private URL, and one malformed/scheme-blocked URL. Assert only allowed local content gets an iframe; blocked entries show safety copy and have no iframe, no credentials/body rendered, and no claimed verified live-app link. Keep `sketch:<id>` registry resolution in its existing preview tests; do not assume that unresolved scheme is directly embeddable. Reuse HTTP fixture to assert traversal/symlink/private paths stay 403/404 and `/runtime/telemetry` never leaks rollout path, prompt, or output sentinel.

  ```js
  ui.navigate('#preview'); await ui.settle();
  assert.equal(ui.document.querySelectorAll('#preview-artifacts iframe').length, 1);
  ui.document.querySelectorAll('#preview-artifacts [role="tab"]')[1].click();
  assert.equal(ui.document.querySelectorAll('#preview-artifacts iframe').length, 0);
  assert.doesNotMatch(ui.document.querySelector('#preview-artifacts').textContent, /SECRET_BODY|private-rollout\.jsonl/);
  ```
- [ ] **Step 4:** Run `node --test tests/dashboard-integration.test.mjs tests/preview-server.test.mjs`; expected red for the new assertions, then minimally repair only actual failures in the shell/route modules and rerun green. Do not replace the other widgets with markup or use `file://` as a live-dashboard pass.
- [ ] **Step 5:** Add the new test import exactly once to `tests/all.test.mjs`; rerun `node tests/all.test.mjs` after Tasks 3–4 integrations are complete. Commit focused UI changes with a Korean conventional message.

### Task 3: Finish visible errors and honest lifecycle copy

**Files:** Modify `preview/dashboard.js`, `preview/preferences.js`, `preview/task-editor.js`, `tests/dashboard-tabs.test.mjs`, `tests/status-preview.test.mjs` as indicated by failing tests. Do not change runtime event semantics in UI code.

**Interfaces:** Consumes Task 1–2 translations and snapshot fields. Extends existing `createTaskEditor(...).relocalize()` from `551168e` to refresh visible validation/conflict/save/network messages as well as form labels without resetting a draft. Produces locale-aware dashboard snapshot, task fetch, preview fetch, and telemetry refresh notices; reported-running labels remain explicitly non-live.

- [ ] **Step 1:** Add a failing locale regression that forces `/runtime/tasks`, `/runtime/snapshot`, `/runtime/task-specs`, and `/runtime/telemetry` failures separately, toggles English→Korean→English while errors remain visible, and asserts localized labels and bounded error text update without losing task draft. In `tests/status-preview.test.mjs`, exercise all four persistent task-editor message kinds: validation, conflict, save failure, network failure. Use translation keys for safe generic failure copy; do not translate arbitrary exception messages as facts or expose private URL/path fragments.

  ```js
  // Existing taskDOM(), action(), field(), and find() helpers in status-preview.test.mjs.
  const editor = createTaskEditor(host, { fetchImpl, translate: key => preferences.t(key) });
  editor.update([], 'write-token');
  action(host, 'add').click(); action(host, 'save').click();
  assert.equal(find(host, 'task-message', 'validation').textContent, preferences.t('task.invalidTitle'));
  preferences.setLocale('ko'); editor.relocalize();
  assert.equal(find(host, 'task-message', 'validation').textContent, '300자 이하의 제목을 입력하세요.');
  assert.equal(field(host, 'title').value, '');
  // Repeat with 409/current, non-OK save, and rejected fetch; retain each draft and message kind.
  ```
- [ ] **Step 2:** Add fixed-time cases for agent start exactly one hour ago, older, missing, invalid, and future. Assert all remain only “reported running / liveness unconfirmed”; age bucket is not a native live count, and missing/future is “unknown/outside,” never zero live agents.

  ```js
  const text = await renderDashboardAt('2026-09-25T12:00:00Z', [
    { id: 'edge', started_at: '2026-09-25T11:00:00Z' },
    { id: 'unknown' }, { id: 'future', started_at: '2026-09-25T12:00:01Z' }
  ]);
  assert.match(text, /liveness unconfirmed/);
  assert.match(text, /future start/);
  assert.doesNotMatch(text, /0 live agents|confirmed live/);
  ```
- [ ] **Step 3:** Run `node --test tests/dashboard-tabs.test.mjs tests/status-preview.test.mjs tests/dashboard-integration.test.mjs`; expected red then green after the smallest locale/label repair. Preserve the task-editor `relocalize()` form-label update from `551168e` and the telemetry panel's stale/selection behavior.
- [ ] **Step 4:** Commit only this focused correction. A reviewer verifies the visible failure path and one normal route in the integrated fixture, not merely string-key presence.

### Task 4: Integrate all approved implementations and freeze the tested core

**Files:** Root-owned merge resolutions, `package.json`, `tests/all.test.mjs`, and only the focused files that conflict. No product source or legacy data.

**Interfaces:** Consumes reviewed companion deliverables: fixed context API and schema from Global Constraints; setup plan/apply; child-Git boundary; `.harness/tasks|memory|runtime`; native bridge and supported hook command contract; lifecycle/telemetry/cutover safety; Tasks 1–3 UI. Produces `CODE_SHA`, the complete tested core commit for the first cold-start/native fixture.

- [ ] **Step 1:** Root inventories each branch/worktree HEAD, dirty and ignored files, exact claims, test evidence, and cherry-pick/merge provenance. Merge each approved branch once; handle `package.json` and `tests/all.test.mjs` in a single serialized resolution so all suites are included once, and keep any `npm run setup` command added by setup owner. Run `git diff --check` and source/target SHA comparison.
- [ ] **Step 2:** Add/run fixed-context smoke assertions on the integrated command layer: `npm run setup` plans without writes; Apply uses `project/`; `npm run status` and `npm run preview:live` derive context without `--project --checkout --binding`; child `.git` missing rejects parent fallback; `.harness/` and `project/` remain ignored. Use companion owners' tests, not an alternate UI-only context implementation.
- [ ] **Step 3:** Run focused affected suites first, then `npm test` once on the fully integrated tree, then `npm run self-check`. Expected: exit 0 for each required command; record exact command, counts, commit SHA, and failures. Any required failure blocks fixture creation until corrected and rerun.
- [ ] **Step 4:** Record `git rev-parse HEAD` as `CODE_SHA` only after tests pass and working tree source is clean. Do not use an earlier UI or setup commit as the cold-start source.

### Task 5: Prove neutral, remote-free cold start from the exact core SHA

**Files:** Add `tests/cold-start-e2e.test.mjs` if deterministic fixture coverage is missing; use a disposable temporary directory for manual native acceptance. No legacy/source-product modifications.

**Interfaces:** Consumes Task 4 `CODE_SHA`, `planProjectSetup({harnessRoot,mode:'new',source:undefined,target:'codex'})`, `applyProjectSetup({harnessRoot,plan})`, `loadFixedProjectContext`, and the installed bridge. Produces a recorded fixture digest, setup/runtime/status/UI results, and a neutral child suitable for Task 6.

- [ ] **Step 1:** Clone the exact `CODE_SHA` into a fresh temp directory from the approved local core repository, then remove only the copy's `origin` remote. Require `git rev-parse HEAD` in the copy to equal `CODE_SHA` and `git remote -v` to be empty; inventory tracked relative paths and SHA-256 hashes against the source commit (account only for documented generated files). Assert no dependency on the old product path. Create empty `project/`; before Apply assert no child `.git`, `.ai/`, `.codex/`, `.agents/`, `scripts/`, remote, package dependencies, or product files. The source repo and its remote are untouched.
- [ ] **Step 2:** Run the new-project plan twice against the fixture and hash all bytes before/after. Expected: no writes, same proposed owned paths, explicit conflict/backup/verification list. Apply only that reviewed plan; assert child Git has its own top-level root and no remote, core `git status --short --ignored` never exposes child files as additions, and `.harness/config.json` matches the agreed schema. Attempt context loading with child `.git` removed in a separate fixture: expected rejection, not parent Git fallback.

  ```js
  const before = await inventoryBytes(fixtureRoot);
  const options = { harnessRoot: fixtureRoot, mode: 'new', source: undefined, target: 'codex' };
  const plan = await planProjectSetup(options);
  assert.deepEqual(await planProjectSetup(options), plan);
  assert.deepEqual(await inventoryBytes(fixtureRoot), before);
  await applyProjectSetup({ harnessRoot: fixtureRoot, plan });
  assert.equal((await loadFixedProjectContext({ harnessRoot: fixtureRoot, cwd: fixtureRoot })).projectId, 'project');
  assert.equal((await readJson(path.join(fixtureRoot, '.harness/config.json'))).layout, 'single-project');
  assert.equal(await git(fixtureRoot, 'check-ignore', 'project/.git'), 'project/.git');
  ```
- [ ] **Step 3:** In separate fixtures, test existing-project inventory and Apply with mixed `.ai/`, `.codex/`, `.agents/`, AGENTS, untracked and ignored files; compare source byte hashes and child history/remote afterward. Force destination conflict, symlink/reparse escape, concurrent hash change, interrupted Apply, and retry/rollback; assert only owned target bytes are restored and no original source is changed. Record unsupported or permission-limited cases rather than deleting evidence.
- [ ] **Step 4:** From the neutral fixture run `npm run status` and a bounded `npm run preview:live` server, GET `/runtime/snapshot`, `/runtime/tasks`, `/runtime/telemetry`, `/preview/dashboard.js`, and `/#guide`. Expected selected child context, working tasks/UI, telemetry `missing`/unknown without rollout, no private payload. Separately run `npm run preview`: it writes one static snapshot at `.harness/runtime/preview.html`, not an offline gallery. Verify the existing offline gallery/Preview Lab through its own registered-artifact and local-server path; if an offline gallery is expected but not implemented, report that gap rather than relabeling `preview.html`. Static role/Skill file contents must be consumable without invoking Node in the child session. Do not call file existence alone native discovery.

  ```js
  assert.equal((await fetch(`${base}/runtime/telemetry`).then(r => r.json())).status, 'missing');
  assert.equal((await fetch(`${base}/preview/dashboard.js`)).status, 200);
  assert.match(await readFile(path.join(fixtureRoot, '.harness/runtime/preview.html'), 'utf8'), /Pure Harness snapshot/i);
  assert.equal(await git(path.join(fixtureRoot, 'project'), 'remote', '-v'), '');
  ```
- [ ] **Step 5:** Run static repo/import/path purity checks and the runtime independence tests from the companion plan; test a fixture with old product source inaccessible. `node --test tests/cold-start-e2e.test.mjs` and then `npm test` must pass. If this step requires code changes, integrate them, rerun Task 4 full suite, record a new `CODE_SHA`, and recreate the fixture; never patch only the copied fixture and retain its old provenance.

### Task 6: Observe a real Codex session and an actual hello application

**Files:** Evidence in the approved runtime/progress location, not source-product logs or credentials; optional focused regression tests if a discovered defect is repaired. `harness/compatibility.json` changes only after independently reviewed, feature-specific evidence.

**Interfaces:** Consumes Task 5 exact fixture, installed Codex version and actual native schema/help/tool response, generated child bridge, the bridge owner's five-hook contract, and real rollout import API. Produces an evidence record with native instance IDs, turn tokens, hook events, commands, outputs, and exit codes.

- [ ] **Step 1:** Use a persistent, non-ephemeral session in the remote-free fixture so the real rollout can later be inspected. Record `codex --version`, `codex --help`, actual installed native role/tool schema or equivalent app tool metadata, selected model, session permission setting, candidate digests, and observed IDs. Probe `agent_type` through the actual supported spawn/tool call, not by asking a model whether it exists. If unsupported, record exact response and leave that capability incomplete; do not silently dispatch a default role. Do not change default/global trust or use a dangerous hook-trust bypass to manufacture hook evidence.
- [ ] **Step 2:** Start a fresh native Codex session with working directory the fixture's `project/`. Observe role registration/invocation by ID, Skill discovery and consumption, and parent-AGENTS versus child instruction scope. Test read-only planner effective controls with harmless bytes and alternate write route as in `docs/native-smoke-worksheet.md`; separately observe worker's authorized write. Record permission prompts and actual final bytes, not just generated TOML.
- [ ] **Step 3:** Ask the supported worker to create a dependency-free Node `hello` CLI and its `node:test` test under child Git, with a test that checks literal stdout `hello\n` and exit code 0. Run the app (`node <observed-entry-file>`) and tests (`node --test <observed-test-file>`) from `project/`; record commands, stdout bytes, stderr, exit codes, `git -C project status --short`, and file hashes. Do not preseed the app or count the model's success claim as execution.
- [ ] **Step 4:** Across start, one follow-up turn, stop/resume when supported, and end, correlate exact native agent ID and unique turn token with the bridge's task, claim, hook, and orchestration records. The five hook names/arguments are taken from the installed version's verified support; unsupported events remain unverified. A delayed or absent response never implies death, completion, or success. Test failure of runtime recording without cancelling a harmless user operation; UI shows recording quality.
- [ ] **Step 5:** Before rollout import, assert `/runtime/telemetry` is `missing`/unknown. Only after this session produces a real rollout, explicitly import only the selected project/session source and inspect partial and unattributed counts, task selection, stale-on-refresh-failure, and no prompt/body/credential/source-path leakage. Record actual values without expected token counts. Independently review the native evidence before any `nativeSmoke` status change; Claude Code, OpenCode, Antigravity stay `unverified`.

### Task 7: Publish only observed first-use and recovery instructions

**Files:** Modify `README.md`, `docs/first-use.md`, `docs/advanced-first-use.md`, `docs/setup-reference.md`, `preview/guide-panel.js`, `preview/preferences.js`, `docs/native-smoke-worksheet.md`, and progress evidence only as needed. Do not edit the GOAL source or legacy product docs.

**Interfaces:** Consumes Task 6 successful command/exit-code record and setup owner's final CLI contract. Produces matching beginner new/existing/tool-change steps and a separately marked advanced/manual recovery path. `CODE_SHA` names the exact Task 6 native-tested commit; `RELEASE_SHA` names the post-documentation final commit, which may differ. Native evidence carries forward only with a reviewed unchanged native-critical source/output digest.

- [ ] **Step 1:** Add a failing doc/guide consistency test for `npm run setup` plan→review→Apply, fixed `project/` start, `status`, `preview:live`, exact choice labels, no old mandatory three-flag flow in beginner copy, and no claim that candidate output is native proof. Keep advanced legacy commands marked as legacy/manual, not current default.

  ```js
  const start = await readFile(new URL('../docs/first-use.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(start, /npm run setup/);
  assert.match(start, /project\//);
  assert.match(start, /npm run status/);
  assert.match(start, /npm run preview:live/);
  assert.doesNotMatch(start, /--project\s+.*--checkout\s+.*--binding/);
  assert.match(readme, /처음 사용|시작하기/);
  // In guide-panel.test.mjs, assert new/existing/connected choices render the same current paths.
  ```
- [ ] **Step 2:** Update the short README entry, situation-specific first-use guide, existing-source connection and tool-change review, ownership/conflict/rollback recovery, Node-optional static role/Skill use, and guide panel translations from Task 6's actual successful commands and limitations. Include the real observed app/test commands only if they passed. Keep other-target statuses and cutover exclusions explicit.
- [ ] **Step 3:** From a fresh disposable copy, follow the written new and existing steps verbatim; run `node --test tests/guide-panel.test.mjs tests/preview-preferences.test.mjs` and focused documentation/link tests, then `npm test`. Record discrepancies and repair/replay. Commit docs/UI and record `RELEASE_SHA`; rerun full code tests, self-check, and Task 5 cold start from that exact SHA because guide/UI output changed. Compare `CODE_SHA` versus `RELEASE_SHA` SHA-256 digests for the exact native-critical dependency closure actually used in Task 6: setup/bridge/hook/runtime entrypoints and their imports, generated role/Skill/config outputs, `package.json`, `.gitignore`, and root `AGENTS.md`. Inventory/report the file list so unrelated documentation or a read-only release utility does not trigger a needless paid session. If all are unchanged, retain the independently reviewed native smoke evidence tied to `CODE_SHA` with this explicit equivalence proof; if any differ or proof is incomplete, repeat Task 6 on `RELEASE_SHA`. Do not claim that the two commit SHAs themselves are equal.

  ```js
  assert.notEqual(typeof releaseSha, 'undefined');
  assert.deepEqual(await nativeCriticalDigest(releaseSha), await nativeCriticalDigest(codeSha));
  assert.equal(await git(releaseFixture, 'rev-parse', 'HEAD'), releaseSha);
  assert.equal(await git(releaseFixture, 'remote', '-v'), '');
  ```
- [ ] **Step 4:** Update `docs/pure-harness-completion-progress.md` with timestamped command, exit code, artifact/hash reference, tested SHA, and truthful incomplete features. Do not rewrite `prototype/preview/data/goal.json`.

### Task 8: Reconcile provenance, push, and clean only proved task-owned Git work

**Files:** Create `scripts/worktree-inventory.mjs` and `tests/worktree-inventory.test.mjs` if existing Git commands cannot make the inventory reproducible; no generic delete command. Root owns merge/push and any task-specific cleanup.

**Interfaces:** Consumes post-doc `RELEASE_SHA`, the remote-free fixture inventory and successful full-suite/native evidence (directly on `CODE_SHA` or refreshed if native-critical bytes changed), and all branch/worktree provenance. Produces read-only `inventoryWorktrees({ root, ownerByPath }) -> Promise<{ entries: Candidate[] }>` and pure `assessRemovalCandidate(candidate) -> { safeToRemove: boolean, reasons: string[] }`. `Candidate` includes owner, clean, ignoredPreserved, provenanceReviewed, inclusion (`ancestor` / `reviewed-identical-patch` / `unproved`), path, branch, head. The inventory script has no mutation or `--force` option.

- [ ] **Step 1:** Write failing inventory tests around `git worktree list --porcelain`, `git branch --format`, per-worktree `git status --porcelain --untracked-files=all`, ignored-file inventory, `git merge-base --is-ancestor`, and explicit `git diff`/patch-equivalence checks. Assert unknown owner, dirty worktree, ignored useful file, unproved equivalence, or mismatched SHA yields `safeToRemove:false`; reviewed identical patch alone records potential inclusion but cannot yet bypass `git branch -d`. The script only prints path, branch, HEAD, owner/provenance, dirty/ignored, inclusion proof, and reasons; it cannot remove anything.

  ```js
  const base = { owner: 'this-task', clean: true, ignoredPreserved: true,
    provenanceReviewed: true, inclusion: 'ancestor', path: fixturePath, branch: 'codex/ui', head: fixtureSha };
  assert.equal(assessRemovalCandidate(base).safeToRemove, true);
  assert.equal(assessRemovalCandidate({ ...base, owner: 'unknown' }).safeToRemove, false);
  assert.equal(assessRemovalCandidate({ ...base, clean: false }).safeToRemove, false);
  assert.equal(assessRemovalCandidate({ ...base, inclusion: 'unproved' }).safeToRemove, false);
  assert.equal(assessRemovalCandidate({ ...base, inclusion: 'reviewed-identical-patch' }).safeToRemove, false);
  ```
- [ ] **Step 2:** Run the inventory on the exact target worktrees and branches; preserve task-unrelated and any uncommitted/ignored useful artifacts. Compare required changes with reviewed main patch/cherry-pick equivalence, not just branch names. For a task-owned clean non-ancestor whose entire patch is reviewed identical, use a normal reviewed merge to establish ancestry only if it leaves the tree identical; then re-inventory and allow normal `git branch -d`. If the merge changes content or provenance is uncertain, preserve the branch and report a blocker. Record the resulting final `RELEASE_SHA`; any new merge commit requires full tests and a new remote-free cold-start copy at that SHA. Native smoke can be carried forward only after the same unchanged native-critical digest proof as Task 7; otherwise rerun it.
- [ ] **Step 3:** Only after successful final E2E and documentation replay, remove each verified clean, task-owned worktree/branch by exact path/ref with ordinary non-force Git commands; never use a glob, recursive filesystem delete, or broad pruning. Leave uncertain cases in place as named blockers. This cleanup is not authorization to clean the original product source or migrate legacy runtime.
- [ ] **Step 4:** Root pushes the approved `main` to the approved remote, checks `git rev-parse main`, `git ls-remote <approved-remote> refs/heads/main`, the copy's exact final `RELEASE_SHA`, final test evidence, native-critical digest link to `CODE_SHA`, and a final read-only branch/worktree inventory. Report any unpushed/mismatched SHA or remaining task-owned branch honestly; no completion claim while required gates fail.

## Verification and risk handoff

Evidence gates are: focused UI tests → integrated real-module DOM + HTTP tests → all relevant `npm test` and self-check on one SHA → neutral remote-free fixture of that SHA → native Codex session/hello commands and rollout → observed docs replay → provenance-safe cleanup/push verification. Risk is highest at nested child Git identity, generated ownership/rollback, accidental private telemetry exposure, false lifecycle liveness, unsupported native hook/role schemas, and SHA drift after documentation. Each has an explicit failing fixture or native observation above. If a native feature cannot be exercised, retain `unverified` and report the exact blocker; do not broaden authority or substitute a simulated pass.
