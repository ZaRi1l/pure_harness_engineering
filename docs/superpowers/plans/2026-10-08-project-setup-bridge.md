# Fixed Project Setup and Native Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

The active 2026-10-08 `/goal` authorizes continuous scoped execution without routine human-review pauses. Explicit parallel implementation uses isolated branches/worktrees; overlapping paths in one checkout remain serialized.

**Goal:** Let a first-time user plan and explicitly apply a safe new or existing product project in the sole `project/` child Git repository, then consume Harness-owned native role/Skill files without copying the engine into that child.

**Architecture:** Keep `harness/agents/`, `.agents/skills/`, and the four existing renderers as canonical sources. A read-only setup plan snapshots the source, destination, and desired bridge; an apply transaction revalidates that snapshot, stages the product Git tree and read-only desired bridge plan, atomically publishes the canonical `project/`, applies reviewed managed files there, then writes `.harness/config.json` last. Native static files work without Node; hooks call the installed engine by its anchored path only when Node is available.

**Tech Stack:** Node ESM and `node:test`, native Git CLI, existing Harness renderers/ownership utilities; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-08-pure-harness-completion-design.md`; acceptance ledger: `docs/pure-harness-completion-checklist.md`.

## Global Constraints

- The only product destination is `<harnessRoot>/project/`, with its own `.git`; local installation state is `<harnessRoot>/.harness/`. Core Git ignores both. No project registry, arbitrary project ID, external selected checkout, or inherited parent-Git fallback.
- `.harness/config.json` has exactly `{version:1,layout:'single-project',projectPath:'project',target,setupId,createdAt,updatedAt}`. `target` is one of `codex|claude|opencode|antigravity`; `setupId` is a UUID and timestamps are ISO strings. The fixed-context task owns its loader; setup writes this file last and does not invent extra keys.
- Consume `loadFixedProjectContext({harnessRoot,cwd=process.cwd(),requireSetup=true})` and `getScriptHarnessRoot(import.meta.url)` from `scripts/project-context.mjs` after their separate task lands. `requireSetup=false` still requires a child Git, so pre-Git setup planning validates the uninitialized layout independently. The returned context has `root`, `projectRoot`, `checkoutRoot`, `harnessRoot`, `projectId:'project'`, and `paths:{tasks,memory,runtime}`.
- Never change provider/auth, global tool settings, model policy, concurrency, fork policy, legacy binding/runtime, or the source product. Do not change `nativeSmoke` to verified or relax the candidate-only `exportBundle` / disposable-trial `installBundle` gates based on file existence. The new bridge may Apply its own managed files for all four targets while honestly reporting unverified native execution; it must never add a hook-trust bypass default.
- The bridge must not import or execute a prior product's `.ai/`, `.codex/`, or `.agents/`. Inspect those only as optional input to a conservative inventory; preserve every source file. No credential, prompt body, file body, or raw rollout path in analytics/UI. Local byte backups are allowed under ignored `.harness/`.
- A writer claims exact paths before edits. Use Korean conventional commit messages on the implementation branch. `package.json`, context internals, dashboard, cutover, and final integration/E2E belong to their separate plans; this plan names their required interfaces only.
- Change budget: six bounded tasks; three focused engine modules, one CLI module, the existing hook file, four canonical guidance files, one guidance reference, and six focused test files. If safe TOML/JSON merge or source Git preservation requires a generic rewrite or broader project cleanup, stop for architectural review.

## Review Focus

- A local source with dirty tracked, untracked, ignored, or private files retains exact bytes and Git identity in the child; Task 2 tests it, while the inventory never prints bodies.
- A remote moves between plan and Apply: Task 2 rejects the changed HEAD OID before publishing `project/`.
- An existing `.codex/config.toml`, `.codex/hooks.json`, or `AGENTS.md` has comments, unrelated keys, or hook order: Task 3 tests preservation and conflicts rather than replacement.
- A source link/reparse point escapes its root, or the destination `project/` links elsewhere: Task 1/2 reject before a destination write.
- A generated managed file or config changes after planning or installation: Task 3/4 block update/rollback without overwriting it, retaining recovery evidence.

## File map and shared interfaces

| File | Responsibility |
| --- | --- |
| `harness/source-inventory.mjs` | Read-only local/remote Git fingerprint and content-aware `.ai/.codex/.agents` audit; no bytes in returned report. |
| `harness/native-bridge.mjs` | Render canonical roles/Skills and target-specific managed native files; plan/check/update/rollback with scoped manifest and byte backups. |
| `harness/project-setup.mjs` | Read-only plan and locked new/existing/update Apply transaction, Git staging, snapshot revalidation, config commit. |
| `scripts/setup.mjs` | Interactive prompt and noninteractive plan/apply CLI; no implicit Apply. |
| `scripts/hook-runtime.mjs` | Anchor project hook context at script location, not current Git root; best-effort exact lifecycle metadata. |
| `tests/source-inventory.test.mjs`, `tests/native-bridge.test.mjs`, `tests/project-setup.test.mjs`, `tests/setup-cli.test.mjs`, `tests/hook-runtime.test.mjs` | Deterministic isolated fixtures; extend the existing hook test file. |
| `AGENTS.md`, `.agents/skills/testing/SKILL.md`, `.agents/skills/task-routing/SKILL.md`, `.agents/skills/task-routing/references/codex-lifecycle.md` | Generic core-versus-project guidance, focused verification defaults, and Codex-only lifecycle detail. |
| `tests/harness-skills.test.mjs` | Guidance portability and scope regression tests. |

Contract handed to the context/integration workers: `buildBridgePlan({harnessRoot,projectRoot,target,setupId,profile='core',inputRoot=projectRoot}) -> BridgePlan`; `applyBridgePlan({harnessRoot,plan}) -> BridgeResult`; `checkNativeBridge({harnessRoot,projectRoot,target}) -> BridgeCheck`; `planBridgeUpdate({harnessRoot,projectRoot,target,setupId,profile='core'}) -> BridgePlan`; `rollbackNativeBridge({harnessRoot,projectRoot,target,setupId}) -> BridgeResult`. `inputRoot` lets read-only planning inspect a local source or staged Git tree that will become `project/`, or an absent empty child; it never changes the canonical destination. The public bridge Apply has **no `stagingRoot` parameter** and writes only to the validated canonical `projectRoot` after setup publishes it. Before writing, Apply rechecks published bytes against the planned input snapshot, so a source copy, remote clone, or outside writer cannot silently change a reviewed action. Setup exports `planProjectSetup({harnessRoot,mode,source,target}) -> ProjectSetupPlan` and `applyProjectSetup({harnessRoot,plan}) -> SetupResult`, where `mode` is `new|existing|update`, `source` is omitted except for `existing`, and `plan` is serializable with `schemaVersion:1`, canonical destination, `setupId`, `createdAt`, `updatedAt`, source fingerprint/inventory, bridge action summary, conflicts, expected hashes, and `planSha256`. Apply accepts only an unmodified plan whose digest and all observed hashes still match. Both modules may take a test-only `beforeWrite` callback as a second argument for fault injection; never expose it in CLI.

Bridge ownership record is `.harness/adapters/<target>.json`, version 1, with `setupId`, `target`, and exact file actions `{path,kind,beforeSha256|null,afterSha256,backupSha256|null,ownership}`. Backups are `.harness/backups/<setupId>/<target>/<sha256(path)>` and the pending transaction journal is `.harness/setup-journal.json`. Every relative path is allowlisted and collision-checked; a manifest is not permission to own a pre-existing file whose baseline hash differs. The bridge does not use the old product-side `harness-adapter/install-state.json`.

### Task 1: Read-only source and target inventory

**Files:** Create `harness/source-inventory.mjs`; test `tests/source-inventory.test.mjs`.

**Interfaces:** Produce `inspectSetupSource({harnessRoot,mode,source}) -> {kind,canonicalSource?,git:{head,gitDirKind,remotes,refs,dirty},files:[{path,sha256,size,gitClass,classification,ownership,reason}],fingerprint}` and `assertSafeSetupDestination({harnessRoot,destination}) -> {canonicalHarnessRoot,destinationState}`. `gitClass` is `tracked|modified|untracked|ignored|git-metadata`; `classification` is `generic|product|private-runtime|mixed|needs-review|not-applicable`; `ownership` is `source-user|harness-generated|unknown`. Local remote URLs are represented as names, redacted display URLs, and URL hashes, never credential-bearing raw values. A remote source accepts credential-free `https://`, `ssh://`, or `git@host:path` Git URLs (not `ext::`/file transports), uses `git ls-remote --symref ... HEAD`, records exact HEAD OID and redacted display URL, and returns `files:[]` with `remote-content-not-yet-inspected` warning; reject embedded passwords/tokens/query secrets. A local source requires its own directory `.git`; a linked worktree source is a declared conflict requiring a primary checkout, never a copied `.git` pointer.

- [ ] **Step 1: Write failing tests** for a local Git fixture with commits/remotes plus modified, untracked, ignored files; assert hashes and classifications, no file bodies, unchanged filesystem byte inventory before/after. Add a remote fixture asserting pinned HEAD, and reject destination path/link escape, linked-worktree `.git` file, duplicate/case-colliding destination names, and non-regular/reparse escape. Ambiguous content must be `mixed` or `needs-review`, not automatically extracted as generic.

  ```js
  const before = await snapshotTree(source);
  const report = await inspectSetupSource({ harnessRoot, mode: 'existing', source });
  assert.equal(report.files.find(file => file.path === '.ai/runtime/private.json').classification, 'private-runtime');
  assert.equal(JSON.stringify(report).includes('SECRET_SENTINEL'), false);
  assert.deepEqual(await snapshotTree(source), before);
  ```
- [ ] **Step 2: Run** `node --test tests/source-inventory.test.mjs`; expect failure because the exports do not exist.
- [ ] **Step 3: Implement the two exports.** Enumerate local files with `lstat` and safe relative paths, hash streaming bytes, use Git porcelain/ignored listings only for classification, and inspect text in memory for generic/product/private/mixed clues. `.ai` runtime/log/credential-like material is always private; do not emit snippets. Reject a source that equals/contains/is contained by the Harness root, a `.git` with external `core.worktree`, links that would resolve outside source or destination, and Windows reparse/junction types that cannot be proven safe. For remote reads, do not clone or create directories during plan.
- [ ] **Step 4: Run** `node --test tests/source-inventory.test.mjs`; expect pass. Commit with `feat: 설정 원본 읽기 전용 점검 추가`.

### Task 2: Fixed child setup plan and safe Git acquisition

**Files:** Create `harness/project-setup.mjs`; test `tests/project-setup.test.mjs`.

**Interfaces:** Consume Task 1 and Task 3's `buildBridgePlan`/`applyBridgePlan` (a narrow stub may stand in while Task 3 is being built). Produce the `planProjectSetup`/`applyProjectSetup` contract above. `SetupResult` reports `projectRoot`, `setupId`, `target`, `changedPaths`, and verification results; no native-smoke claim. `planProjectSetup` does not create `.harness`, `project/`, locks, or temp files. `update` requires the already configured exact child Git and preserves the same `setupId`/`createdAt` while changing `target` and `updatedAt` only at final commit.

- [ ] **Step 1: Write failing fixture tests**: new mode plans against an absent or empty canonical `project/` with no byte changes; Apply creates a separate child Git with no remote, while core `git status --short --untracked-files=all` never lists `project/` or `.harness/`. Existing local mode copies committed history, all remotes, tracked modifications, untracked and ignored bytes without touching source. Existing remote mode pins the planned HEAD. A nonempty destination, missing child `.git` on update, second product source, changed plan/source/destination hash, or symlink/reparse escape blocks before publish. Inject failures after staging, after canonical publish, and during bridge Apply; assert no configured project, exact prior owned bytes and previous empty destination directory, recoverable journal/backups, and successful retry or scoped rollback without overwriting outside changes.

  ```js
  const plan = await planProjectSetup({ harnessRoot, mode: 'new', target: 'codex' });
  assert.equal(await exists(path.join(harnessRoot, '.harness/config.json')), false);
  await applyProjectSetup({ harnessRoot, plan });
  assert.equal(gitTop(path.join(harnessRoot, 'project')), path.join(harnessRoot, 'project'));
  assert.equal(gitTop(harnessRoot), harnessRoot);
  assert.deepEqual(JSON.parse(await readFile(path.join(harnessRoot, '.harness/config.json'))).projectPath, 'project');
  ```
- [ ] **Step 2: Run** `node --test tests/project-setup.test.mjs`; expect missing exports/failing assertions.
- [ ] **Step 3: Implement read-only plan** with a canonical serialization/digest (hash excludes `planSha256`) and a deterministic action/conflict summary. New mode is valid only for an empty child; existing local mode includes the full file/Git fingerprint from Task 1 and uses that source as the bridge `inputRoot`; remote mode pins HEAD and marks both file-level conflicts and untracked/ignored inventory unavailable until staged clone preflight. If staged remote content conflicts with bridge ownership, Apply aborts before publishing and requires a new reviewed plan from a local checkout. If setup already exists, `new`/`existing` conflict and only `update` is offered. No inferred legacy runtime migration.
- [ ] **Step 4: Implement Apply** under an exclusive `.harness/setup.lock`: recompute all source/destination/plan hashes, then use same-volume `.harness/staging/<setupId>/project` and atomic rename into the sole `project/`. For a pre-existing empty destination, first recheck emptiness and move that exact directory to the transaction backup; restore it on failure. New uses `git init --initial-branch=main` in staging. Local existing copies the independent `.git` directory and all inventoried source bytes (including dirty/untracked/ignored) without `git add`, verifies hashes/remotes/refs/HEAD, and never alters source. Remote existing clones into staging then verifies the pinned HEAD and origin; no forced checkout or source cleanup. Compute and verify the desired bridge plan **read-only** against staged Git bytes, publish canonical `project/` atomically, then invoke `applyBridgePlan({harnessRoot,plan})` against that canonical destination (adapter lock nests after setup lock). Atomically write/verify the seven-key config last. On failure use the owned transaction journal and byte backups to restore only owned bridge actions and the prior destination state, including a previous empty directory; fail closed if an outside writer changed them. `update` uses the same bridge/config hash gate without restaging the product.
- [ ] **Step 5: Run** `node --test tests/project-setup.test.mjs`; expect pass. Commit with `feat: 고정 프로젝트 설정 트랜잭션 추가`.

### Task 3: Managed four-target bridge, merge, update, and rollback

**Files:** Create `harness/native-bridge.mjs`; test `tests/native-bridge.test.mjs`; modify only if necessary `harness/export-bundle.mjs` to share a pure renderer helper, without changing its candidate manifest/status or old installer gate.

**Interfaces:** The five bridge functions in File map. Serializable `BridgePlan` has `schemaVersion:1`, canonical `projectRoot`, `inputRoot`, `target`, `setupId`, `profile`, per-path `create|unchanged|append-managed-block|replace-owned|conflict` actions with before/after hashes, `planSha256`, `nativeSmoke:'unverified'`, and source role/Skill hashes. `planBridgeUpdate` is `buildBridgePlan` against an installed target manifest, not a second writer path. The target-specific adapter table uses current renderers: Codex `.codex/agents/*.toml`, `.codex/config.toml`, `.agents/skills/*`, optional `.codex/hooks.json`; Claude `.claude/agents/*.md` and `.claude/skills/*`; OpenCode `.opencode/agents/*.md` and `.agents/skills/*`; Antigravity `.agents/agents/*/agent.md` and `.agents/skills/*`. Do not invent unverified global or provider files. Static role/Skill files contain no Node invocation requirement.

- [ ] **Step 1: Write failing tests** for every target's exact role/Skill paths and body/source hashes; `nativeSmoke` stays `unverified`. Codex tests preserve an unrelated TOML section/comment and JSON hook order/entries, append only owned role registrations and five explicitly candidate hook entries, and preserve an existing product `AGENTS.md` while adding a bounded project-scope block. Test conflicting role IDs, edited owned bytes, malformed TOML/JSON, case collisions, absent Node, user file outside the allowed paths, and no `harness/`, scripts, `.ai/`, or runtime copied into child. Assert `check`, `update`, and `rollback` leave all unrelated bytes unchanged; rollback refuses drift.

  ```js
  const plan = await buildBridgePlan({ harnessRoot, projectRoot, target: 'codex', setupId });
  assert.equal(plan.nativeSmoke, 'unverified');
  await applyBridgePlan({ harnessRoot, plan });
  assert.match(await readFile(path.join(projectRoot, '.codex/config.toml'), 'utf8'), /# user comment/);
  assert.deepEqual(JSON.parse(await readFile(path.join(projectRoot, '.codex/hooks.json'))).hooks.SessionStart[0], userHook);
  assert.equal((await checkNativeBridge({ harnessRoot, projectRoot, target: 'codex' })).nativeSmoke, 'unverified');
  ```
- [ ] **Step 2: Run** `node --test tests/native-bridge.test.mjs`; expect missing exports/failing assertions.
- [ ] **Step 3: Implement pure rendering and planning.** Use `loadRoles`, `listSkills`, `renderRole`, and `makeGeneratedFile`; include only portable canonical source bytes. Merge Codex TOML by preserving untouched lines/comments and adding namespaced role stanzas only when IDs are free; an existing conflicting `[agents.<id>]`, effective contradictory `[features]`/`[agents]` setting, or unsupported syntax is a review conflict, never silently rewritten. Merge hooks by preserving existing arrays/order and adding uniquely identifiable owned entries for the installed Codex 0.161 app-server's five schema-confirmed events (`SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `Stop`); actual dispatch, trust, and native role-spawn support remain unverified until a fresh session observes them. Never emit a hook-trust bypass. No command uses `git rev-parse --show-toplevel`. Project `AGENTS.md` gets a bounded managed scope paragraph that says product instructions govern `project/`, while parent core-maintenance/`--core` claim instructions apply only to engine files; it names the exact installed absolute engine runtime command with shell-safe quoting, `.harness/` task/memory/runtime locations, and a Node-absent cooperative single-writer fallback. User text is not replaced. If an existing AGENTS instruction conflicts with that boundary, mark review conflict.
- [ ] **Step 4: Implement Apply/check/update/rollback.** Revalidate plan and on-disk hashes under `.harness/adapter.lock` (always acquired after the outer setup lock, when present), save prior bytes in ignored backups, atomically write only allowlisted managed paths and per-target manifest, then verify file hashes. An injected partial failure restores the exact owned actions in reverse; if rollback would overwrite a changed user file, stop and retain journal/backups for manual review. Update is another reviewed plan. Switching tools adds/revises the selected target and changes only the fixed config target at Task 2's final commit; do not delete previously managed target files silently. `checkNativeBridge` verifies manifest ownership but reports discovery/permission/hook support separately as `unverified` until native evidence exists.
- [ ] **Step 5: Run** `node --test tests/native-bridge.test.mjs tests/harness-export.test.mjs tests/harness-install.test.mjs tests/harness-render.test.mjs`; expect pass. Commit with `feat: 네이티브 설정 관리 브리지 추가`.

### Task 4: Setup command and anchored optional hook runtime

**Files:** Create `scripts/setup.mjs`; modify `scripts/hook-runtime.mjs`; test `tests/setup-cli.test.mjs` and `tests/hook-runtime.test.mjs`.

**Interfaces:** `main(argv=process.argv.slice(2),io={stdin:process.stdin,stdout:process.stdout,stderr:process.stderr}) -> Promise<number>` in setup CLI; tests may supply `io.harnessRoot` as a fixture-only override, while production always uses `getScriptHarnessRoot(import.meta.url)`. The separate integration worker adds `"setup":"node scripts/setup.mjs"` to `package.json`. `handleHook(payload,context)` remains export-compatible; executable hook mode derives `harnessRoot = getScriptHarnessRoot(import.meta.url)` and calls the fixed loader with payload `cwd`, not Git root or project flags. A hook outside the verified selected checkout is best-effort skipped with a short non-private diagnostic, never recorded against core or another project.

- [ ] **Step 1: Write failing CLI/hook tests**. Interactive setup asks new/existing, source only for existing, and target default Codex; prints the full read-only plan, conflicts/backups/verification limits, then requires exact `apply <first-12-planSha256>` before writes. `--mode new|existing --source <absolute-path-or-remote> --target <id> --plan` writes one serializable JSON plan to stdout and no files. `--apply <plan-file>` is the only noninteractive write form, disallows conflicting mode/source flags, validates digest and current hashes, and returns nonzero on conflict. `--target claude --plan` on an already configured child produces `update`, not a second project. A hook launched from inside child reaches `.harness` even when child `git rev-parse` points at itself; a hook from outside is ignored; session/agent IDs and turn token are not fabricated, and no prompt body is saved.

  ```js
  assert.equal(await main(['--mode', 'new', '--target', 'codex', '--plan'], capturedIo), 0);
  assert.equal(JSON.parse(capturedIo.stdout).mode, 'new');
  assert.equal(await exists(path.join(harnessRoot, '.harness/config.json')), false);
  assert.equal(await main(['--apply', planFile], capturedIo), 0);
  assert.equal(JSON.parse(await readFile(path.join(harnessRoot, '.harness/config.json'))).target, 'codex');
  ```
- [ ] **Step 2: Run** `node --test tests/setup-cli.test.mjs tests/hook-runtime.test.mjs`; expect failure at missing CLI/new context behavior.
- [ ] **Step 3: Implement CLI** with strict argument parsing and TTY prompts; default execution without `--apply` is plan-only until the exact interactive confirmation. Display plan hash and warning that Claude/OpenCode/Antigravity and current Codex native discovery are not proven by generated files. No separate project selector, binding, or project ID prompts.
- [ ] **Step 4: Anchor hook** to the installed script's core root and fixed project context. Generated hook command embeds the safely quoted absolute engine script path on Windows/Unix, with no parent/current Git discovery; retain the five schema-confirmed Codex event names without declaring actual dispatch verified. The later native gate must query fixture hook trust before the turn and cannot use a global or default bypass. Static roles/Skills remain usable when Node is absent, with hook/runtime quality shown as unavailable, not task failure. Keep existing `handleHook` fixture semantics for exact IDs and duplicate/stale turns.
- [ ] **Step 5: Run** `node --test tests/setup-cli.test.mjs tests/hook-runtime.test.mjs tests/project-setup.test.mjs tests/native-bridge.test.mjs`; expect pass. Commit with `feat: 대화형 설정과 고정 훅 연결 추가`.

### Task 5: Independent setup/bridge acceptance gate

**Files:** Extend only the four new focused tests and `tests/hook-runtime.test.mjs` if a missing assertion is found; no new production surface.

**Interfaces:** This is the handoff gate to root integration, not native smoke or final E2E. Return actual commands, exit codes, changed paths, project/core Git status, unresolved target discovery, and rollback observations.

- [ ] **Step 1: Build two disposable Harness-root + child fixtures** from current core code: one empty child with no `.ai/.codex/.agents` or external remote, one unrelated existing project with mixed artifacts. Assert plan emits no writes, setup uses only canonical core sources, native static files parse without starting Node, and the second fixture preserves private/user bytes. Check static imports/path references for legacy product dependency, as well as runtime behavior when that source is inaccessible.

  ```js
  assert.equal(await exists(path.join(child, 'harness')), false);
  assert.equal(await exists(path.join(child, 'scripts')), false);
  assert.equal(await exists(path.join(child, '.ai')), false);
  assert.equal((await readFile(path.join(child, '.agents/skills/testing/SKILL.md'), 'utf8')).includes('SECRET_SENTINEL'), false);
  assert.deepEqual(await snapshotTree(originalSource), sourceBefore);
  ```
- [ ] **Step 2: Run** `node --test tests/source-inventory.test.mjs tests/native-bridge.test.mjs tests/project-setup.test.mjs tests/setup-cli.test.mjs tests/hook-runtime.test.mjs tests/harness-export.test.mjs tests/harness-install.test.mjs tests/harness-render.test.mjs`; expect all pass. Run `git status --short --untracked-files=all` in both core and child fixtures and capture distinct Git roots.
- [ ] **Step 3: Review exceptions** against the spec/checklist. Keep Codex native role/Skill/hook status `unverified` until root's fresh real session proves tool schema, discovery, call response, and the supported five-event contract. Other three targets remain candidates, not completed support. Commit only any targeted test corrections with `test: 프로젝트 설정 경계 검증 보강`.

### Task 6: Generic core and child guidance boundary

**Files:** Modify `AGENTS.md`, `.agents/skills/testing/SKILL.md`, `.agents/skills/task-routing/SKILL.md`; create `.agents/skills/task-routing/references/codex-lifecycle.md`; test `tests/harness-skills.test.mjs` and Task 3's `tests/native-bridge.test.mjs`.

**Interfaces:** No runtime API. Core `AGENTS.md` governs engine edits only; generated `project/AGENTS.md` (Task 3) governs product edits, points to the exact absolute engine command and actual `context.paths`, and remains useful if Node is absent. Canonical Skills remain portable across product names and targets. This task is the approved generic guidance audit, not a product-specific policy copy, UI task, or new lifecycle implementation.

- [ ] **Step 1: Write failing guidance tests**: core AGENTS describes Root ownership of overall request, SMALL delegation, nonduplicated scopes, user review for meaningful architecture, evidence-based completion, and `--core` claim only for engine files. Product AGENTS has an exact shell-quoted installed engine command for the current OS and real `.harness` task/memory/runtime paths, but no instruction to run nonexistent child `scripts/` or `.ai/` commands; if Node is absent it requires cooperative single-writer safety and marks runtime unavailable. Testing Skill requires a focused behavioral regression test or recorded reason when impractical, and real-module DOM tests of normal, failure, and navigation UI flows when no computer-use path is available. Task-routing points to a project-declared runtime entrypoint and keeps exact Codex old-turn stop/token/proof-race rules only in the Codex reference. Assert `listSkills(root,'all')` remains portable.

  ```js
  const core = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const routing = await readFile(path.join(root, '.agents/skills/task-routing/SKILL.md'), 'utf8');
  const lifecycle = await readFile(path.join(root, '.agents/skills/task-routing/references/codex-lifecycle.md'), 'utf8');
  assert.match(core, /--core.*engine|engine.*--core/i);
  assert.match(routing, /project-declared runtime/i);
  assert.match(lifecycle, /turn token|turn-token/i);
  assert.equal((await listSkills(root, 'all')).length > 0, true);
  ```

- [ ] **Step 2: Run** `node --test tests/harness-skills.test.mjs tests/native-bridge.test.mjs`; expect missing guidance/reference or failed assertions.
- [ ] **Step 3: Revise only the four canonical guidance files.** Keep Root guidance concise and generic: coordinate/avoid duplicate work, user-facing architectural decisions, scope and claims, actual verification, and separate engine/product authority. Move detailed Codex lifecycle races and old turn-token reconciliation from general routing prose into the new Codex-only reference; make other targets' unavailable observability nonblocking. Keep portable Skill text free of product names, machine paths, credentials, and direct engine script basename (`assertPortableText` rejects that); runtime command construction belongs in the locally generated child AGENTS only. Do not rewrite user-owned product AGENTS outside Task 3's reviewed managed block.
- [ ] **Step 4: Run** `node --test tests/harness-skills.test.mjs tests/native-bridge.test.mjs tests/harness-export.test.mjs`; expect pass. Commit with `docs: 코어와 제품 작업 지침 범위 분리`.

## Dependency and integration handoff

Task 1 inventory producer fingerprint and Task 3 bridge actions/digests can start in parallel in isolated worktrees; Task 2 setup consumes both completed contracts (order: T1 + T3 → T2). Task 4 CLI/hook anchoring follows T2/T3. Task 6 may develop canonical guidance in parallel, but its generated child AGENTS block and paths depend on T3: after guidance changes, T3 must rerender and recheck generated hashes/ownership before integration. Task 5 independent setup/bridge acceptance follows T1–T4 and T6. The fixed-context worker and integration worker own the context loader, root ignore, CLI wiring in `package.json`, status/preview consumers, and combined suite; coordinate the exact seven-key config and context return shape above. Root performs independent review and native Codex cold-start evidence, then documents actual successful commands. Existing candidate export/disposable trial gates stay separate from new managed bridge Apply; neither file generation nor setup tests approve native smoke, legacy cutover, or original source cleanup.
