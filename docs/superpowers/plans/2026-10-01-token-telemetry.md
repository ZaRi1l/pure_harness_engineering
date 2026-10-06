# Project-Scoped Token Telemetry MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show honest per-project token telemetry and exact task/agent attribution without retaining conversation content.

**Architecture:** A CLI-only explicit-path JSONL adapter streams observed counters into a versioned allowlisted aggregate. `RuntimeStore` atomically replaces one selected project's telemetry snapshot and stores metadata-only native child links; the localhost server exposes read-only safe data to a dashboard panel. Incomplete evidence remains unknown or unattributed.

**Tech Stack:** Node.js ESM (`node:test`, streams, crypto), existing `RuntimeStore` and vanilla DOM; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-token-telemetry-design.md`

## Global Constraints

- Neutral engine in this isolated checkout only; do not alter product code/data, the original checkout, project goals, or backend. Claim exact paths before writes.
- CLI import requires one or more explicit JSONL paths and a validated selected-project context. No background discovery, browser upload/write API, global database, or source-log copy.
- Normalize allowlisted aggregate and link metadata only. Never persist or expose prompts, messages, reasoning, tool arguments/output bodies, raw records, source/filesystem paths, or arbitrary labels. Bound known tool/model/role identifiers or map to `other`/`null`.
- Counts are nonnegative safe integers or `null`; unknown/unsupported/incomplete is never zero. `processed = input + output`; cached input and reasoning output are subsets, never additions. Elapsed is observed end minus start only.
- Exact native IDs are required for task/agent attribution; no title/time/proximity guesses. Import replaces, not accumulates; existing project lock, atomic path, identity/ACL checks remain authoritative.
- Automated code/fixture/DOM tests only; human validates browser presentation. Focused tests, `npm test`, and `npm run self-check` precede completion. Use Korean conventional commits and task-sized independent review gates.

## Review Focus

- A UTF-8 multibyte output and an even-size sample must produce byte-based totals and midpoint median; Task 2 `multibyte_even_median`.
- A response ID repeated with different counts across files must invalidate only its thread, not contaminate a second thread; Task 2 `conflict_is_thread_local`.
- A task link with a correct child ID but contradictory parent thread must remain unattributed; Task 3 `contradictory_parent_is_unattributed`.
- A valid empty import must not turn the last known usage into measured zero; Task 4 `empty_valid_import_is_missing`.
- An older failed refresh must not overwrite a newer successful panel response and must leave stale data explicitly marked; Task 5 `refresh_race_keeps_newest_state`.

---

## File map

| File | Responsibility |
| --- | --- |
| `scripts/telemetry-schema.mjs` (new) | Versioned allowlist, numeric/status validation, safe projection, null arithmetic. |
| `scripts/codex-rollout-telemetry.mjs` (new) | Streaming explicit-path JSONL parser; explicit record-shape recognition, thread counters, tool-output statistics and privacy filtering. |
| `scripts/import-telemetry.mjs` (new) | Operator CLI resolving validated project context, explicit paths and atomic replacement; safe diagnostics. |
| `scripts/runtime-state.mjs` | Selected-project telemetry persistence under lock and metadata-only child-link recording/updating. |
| `scripts/hook-runtime.mjs` | Pass through only exact IDs actually present in hook payload; no inferred links. Native spawn acknowledgements use the store/CLI recording boundary when available. |
| `scripts/preview-server.mjs` | Read-only `GET /runtime/telemetry` with no-store/localhost boundary. |
| `preview/telemetry-panel.js` (new), `preview/dashboard.js`, `preview/index.html`, `preview/preferences.js` | All-tasks/task-select view, coverage, null/partial/stale presentation and translated copy. |
| `tests/telemetry-schema.test.mjs`, `tests/codex-rollout-telemetry.test.mjs`, `tests/runtime-state.test.mjs`, `tests/hook-runtime.test.mjs`, `tests/preview-server.test.mjs`, `tests/status-preview.test.mjs` | Focused deterministic fixtures. |

Add new tests to `tests/all.test.mjs` if its explicit runner requires it. The current hooks do not guarantee parent, child, or root-turn IDs; lack of them remains null/unattributed.

### Task 1: Versioned aggregate and exact-link storage

**Files:** Create `scripts/telemetry-schema.mjs`, `tests/telemetry-schema.test.mjs`; modify `scripts/runtime-state.mjs`, `tests/runtime-state.test.mjs`, `tests/all.test.mjs` if needed.

**Interfaces:** Produce `normalizeTelemetry(input: unknown, projectId: string): TelemetryDocument` with `schema_version:1`, `project_id`, `observed_at`, `source`, `status`, `start_at`, `end_at`, `elapsed_ms`, `totals`, `tasks`, `roles`, `agents`, `unattributed`, `largest_tool_outputs`, `spawns`, `compactions`, `coverage`. The exact field allowlist and shapes live in this module; optional unsupported fields are omitted. Produce `normalizeChildLink(input: unknown, projectId: string): ChildLink` for `{task_id,root_turn_id,parent_agent_id,child_agent_id,role,short_task_name,fork_turns,model,reasoning_effort,spawned_at,completed_at}` plus project stamp. `RuntimeStore.readTelemetry(): Promise<TelemetryDocument|{schema_version:1,project_id:string,status:'missing'}>`; `replaceTelemetry(value): Promise<void>`; `recordChildLink(value): Promise<void>`; `completeChildLink(childAgentId:string,completedAt:string): Promise<void>`. Store links in `agent-links.json` and aggregate in `telemetry.json`, both project stamped.

- [ ] **Step 1: Write failing tests.** Assert strict allowlist (sentinel prompt/reasoning/body/path text absent from JSON), nonnegative safe integer/null rules, subset bounds, processed equation, elapsed observed-only, identity rejection, missing state, replacement rather than addition, and exact child-link acknowledgement/update semantics. A failed/attempted spawn and missing child ID must make no confirmed link.
- [ ] **Step 2: Run red checks.** `node --test tests/telemetry-schema.test.mjs tests/runtime-state.test.mjs`; expect absent exports/methods to fail.
- [ ] **Step 3: Implement schema and store boundary.** Reuse `RuntimeStore.withLock`, `atomicWrite`, `assertRuntimePath`, and `assertDocument`; do not write partial documents on failed validation. Normalize to an explicit object rather than spreading source fields. Preserve prior telemetry if replace fails. Keep links metadata-only and no prompt/task text besides bounded `short_task_name` label. Include store read in snapshot only as normalized optional aggregate.
- [ ] **Step 4: Run green checks.** Same command; expect PASS. Review gate: inspect serialized files/events for sentinel leakage and identity isolation.
- [ ] **Step 5: Commit.** `git add scripts/telemetry-schema.mjs scripts/runtime-state.mjs tests/telemetry-schema.test.mjs tests/runtime-state.test.mjs tests/all.test.mjs`; `git commit -m "feat: 프로젝트 토큰 집계 저장 경계 추가"` (omit untouched runner).

### Task 2: Streaming rollout adapter and measured statistics

**Files:** Create `scripts/codex-rollout-telemetry.mjs`, `tests/codex-rollout-telemetry.test.mjs`; modify `tests/all.test.mjs` if required.

**Interfaces:** Produce `aggregateCodexRollouts(paths: string[], {projectId:string,links:ChildLink[]}): Promise<TelemetryDocument>`. Recognize the donor-tested JSONL envelope `{timestamp,type,payload}` by shape, not an invented version marker: `session_meta` with `payload.id`, optional `session_id`, `parent_thread_id`, `agent_role`; `turn_context` with `turn_id`, `root_turn_id`, `model`, `effort`; `token_usage_record` with `response_id`, optional `thread_id`/`session_id`/`turn_id`/`root_turn_id`, and `usage.{input_tokens,output_tokens,cached_input_tokens,reasoning_output_tokens}`; `event_msg` with `payload.type === 'token_count'` and `payload.info.total_token_usage` for cumulative counters, `task_started` turn IDs, or explicit `context_compacted`/`compaction`/`compacted`; top-level `compaction`/`compacted`; and `response_item` call/output pairs (`custom_tool_call`/`function_call`, `custom_tool_call_output`/`function_call_output`) joined by `call_id` with `name`, `input`/`arguments`, and `output`. These are the record families exercised by donor `tests/token-rollout-importer.test.mjs`; donor behavior is reference only, not the new contract. Key per-response usage by exact `(thread_id,response_id)`, check duplicate equality, stable thread identity and complete coverage. For supported cumulative `total_token_usage`, validate monotonic source-order snapshots and use only the final one; mixed per-response values may aid attribution but never add to that total. No stable source-version marker is evidenced, so unknown non-usage record types are ignored, while unknown usage-bearing shapes or unrecognized counter fields mark that thread unsupported; structure that prevents safe thread isolation aborts the import. Structural failure throws `{lineNumber}` without path/content. Expose parser-private `toolOutputStats(byteLengths:number[]): {count,total_bytes,median_bytes,p95_bytes,max_bytes}` for deterministic tests.

- [ ] **Step 1: Write failing fixture tests.** Use the exact envelope and record families in the Interfaces block: `token_usage_record` for observed per-response usage, `event_msg/token_count/info.total_token_usage` for cumulative/mixed/reset, and `response_item` call/output pairs for tool bytes. Cover missing, partial, unsupported, identical dedupe, `conflict_is_thread_local`, monotonic final cumulative, ambiguous identity, unknown usage-bearing shape, malformed line-number-only diagnostic and atomic abort. Assert `input+output=processed`, subset bounds, response/tool-call optionals, explicit compaction only, start/end/elapsed, `multibyte_even_median`, nearest-rank p95, and no source/path/body sentinel in result. A recognized empty interval can be observed zero only with evidence.
- [ ] **Step 2: Run red check.** `node --test tests/codex-rollout-telemetry.test.mjs`; expect absent parser to fail.
- [ ] **Step 3: Implement streaming adapter.** `createReadStream` plus `readline` per supplied file, bounded per-thread counters/response-ID map and tool byte lengths; discard record bodies immediately. Accumulate totals only after thread coverage validation. Normalize bounded tool names; sort tool groups by total bytes descending. Never persist source records or emit error line contents.
- [ ] **Step 4: Run green check.** Same command; expect PASS. Review gate: inspect source-shape gates and no-double-count branch with fixture evidence.
- [ ] **Step 5: Commit.** `git add scripts/codex-rollout-telemetry.mjs tests/codex-rollout-telemetry.test.mjs tests/all.test.mjs`; `git commit -m "feat: 명시 경로 롤아웃 토큰 집계 추가"` (omit untouched runner).

### Task 3: Exact attribution and observed spawn links

**Files:** Modify `scripts/codex-rollout-telemetry.mjs`, `scripts/runtime-state.mjs`, `scripts/hook-runtime.mjs`, `tests/codex-rollout-telemetry.test.mjs`, `tests/runtime-state.test.mjs`, `tests/hook-runtime.test.mjs`.

**Interfaces:** Produce `attributeThreads(threads: ThreadAggregate[], links: ChildLink[]): {tasks,roles,agents,unattributed,spawns,coverage}`. A thread joins only by exact `thread_id === child_agent_id`, consistent `parent_thread_id === parent_agent_id` when observed, and exact `root_turn_id`/task linkage for turn segments. Nested children require each exact parent-child edge. `recordChildLink` accepts only successful native acknowledgement data; `completeChildLink`/follow-up update the same ID. Spawn attempts and confirmed children are separate observed counters; unavailable dimensions remain null.

- [ ] **Step 1: Write failing tests.** Assert exact task/role/agent rows, all-tasks versus selected-task arithmetic, nested child joins, orphan/missing/unmatched/`contradictory_parent_is_unattributed`, duplicate/ambiguous links, missing root turn, and no task-ID-only inference. Test successful native acknowledgement and follow-up/completion updates; hooks lacking exact IDs must not invent records. Assert observed attempt count differs from confirmed spawn count.
- [ ] **Step 2: Run red checks.** `node --test tests/codex-rollout-telemetry.test.mjs tests/runtime-state.test.mjs tests/hook-runtime.test.mjs`; expect attribution tests to fail.
- [ ] **Step 3: Implement exact joins.** Validate uniqueness before assignment; recursively verify parent chain. Treat all unmatched/contradictory segments as unattributed with nullable counts, not as zero. Hook/ack boundary forwards only explicit IDs and normalized metadata; no parsing free-text prompts or timing windows.
- [ ] **Step 4: Run green checks.** Same command; expect PASS. Review gate: inspect every join predicate and verify no guessed IDs.
- [ ] **Step 5: Commit.** `git add scripts/codex-rollout-telemetry.mjs scripts/runtime-state.mjs scripts/hook-runtime.mjs tests/codex-rollout-telemetry.test.mjs tests/runtime-state.test.mjs tests/hook-runtime.test.mjs`; `git commit -m "feat: 정확한 작업 에이전트 토큰 귀속 추가"`.

### Task 4: Operator import and safe read route

**Files:** Create `scripts/import-telemetry.mjs`; modify `scripts/preview-server.mjs`, `tests/preview-server.test.mjs`, `tests/codex-rollout-telemetry.test.mjs`.

**Interfaces:** CLI `node scripts/import-telemetry.mjs --project <id> --checkout <absolute> --binding <absolute> --file <absolute-jsonl> [--file ...]` calls `contextFromArgs`, reads selected-project links, aggregates and validates, then `replaceTelemetry` once. `GET /runtime/telemetry` returns safe document/missing state; no POST/PUT. Error output carries line number/category only, not paths/content.

- [ ] **Step 1: Write failing CLI/HTTP tests.** Assert explicit files/context required, malformed JSONL leaves prior telemetry byte-identical, `empty_valid_import_is_missing`, rerunning same files is idempotent, project A/B isolation/stamp rejection, GET no-store and localhost guard, static/legacy read compatibility, write methods 405, no sentinel text in persisted JSON/events/HTTP/errors.
- [ ] **Step 2: Run red checks.** `node --test tests/codex-rollout-telemetry.test.mjs tests/preview-server.test.mjs`; expect new import/route cases to fail.
- [ ] **Step 3: Implement import CLI and route.** Validate paths as explicit regular files but never serialize them; normalize full aggregate before one locked replace; reuse existing server GET map and no-store header. No browser write endpoint.
- [ ] **Step 4: Run green checks.** Same command; expect PASS. Review gate: examine failure atomicity and privacy diff.
- [ ] **Step 5: Commit.** `git add scripts/import-telemetry.mjs scripts/preview-server.mjs tests/preview-server.test.mjs tests/codex-rollout-telemetry.test.mjs`; `git commit -m "feat: 토큰 집계 가져오기와 읽기 API 추가"`.

### Task 5: Honest dashboard telemetry panel

**Files:** Create `preview/telemetry-panel.js`; modify `preview/dashboard.js`, `preview/index.html`, `preview/preferences.js`, `tests/status-preview.test.mjs`.

**Interfaces:** Produce `createTelemetryPanel(host:HTMLElement,{fetchImpl,translate}): {refresh():Promise<void>,setTask(taskId:string|null):void,destroy():void}`. Task selector defaults to All tasks; exact task ID rows only. Panel presents source/coverage/status, totals, role/agent rows, tool-output stats, spawn attempts/confirmed, compactions, start/end/elapsed, and unattributed count/fraction only if known numerator and positive known denominator. Selected task excludes unassigned portion explicitly. Failed reads retain previous display marked stale.

- [ ] **Step 1: Write failing simulated-DOM tests.** Assert observed/missing/partial/unsupported labels, `Unknown` for null and incompatible rates, measured zero only when observed, selected-task exact values versus all tasks, unattributed denominator guards, stale-on-read-failure, `refresh_race_keeps_newest_state`, empty state, escaped labels, and no source-path label. No automated-browser claim.
- [ ] **Step 2: Run red check.** `node --test tests/status-preview.test.mjs`; expect panel tests to fail.
- [ ] **Step 3: Implement panel and mount.** Keep task selection across 3-second polls, use text nodes, hide unsupported optional fields, and guard response generations against late arrivals. Render `Unknown` rather than numeric fallback.
- [ ] **Step 4: Run focused/full checks.** `node --test tests/telemetry-schema.test.mjs tests/codex-rollout-telemetry.test.mjs tests/runtime-state.test.mjs tests/hook-runtime.test.mjs tests/preview-server.test.mjs tests/status-preview.test.mjs`; then `npm test`; then `npm run self-check`; expect exit 0. Record actual verification output in runtime state; conduct task-sized and whole-plan review.
- [ ] **Step 5: Commit.** `git add preview/telemetry-panel.js preview/dashboard.js preview/index.html preview/preferences.js tests/status-preview.test.mjs`; `git commit -m "feat: 토큰 관측 범위 대시보드 추가"`.

## Spec-coverage self-review

- Task 1 covers allowlist/schema/project isolation/replacement/link persistence. Task 2 covers source uncertainty, counter mode precedence, statistics and privacy. Task 3 covers exact nested/task/role/agent attribution and observed spawn metadata. Task 4 covers CLI atomicity/read route/idempotence. Task 5 covers all/selected views, unknown/partial/stale display. Each Review Focus condition is pinned to a named test.
- Current native hook payloads may not contain all required exact IDs; the plan deliberately leaves those rows unattributed rather than fabricate them. Human browser appearance/interaction validation remains an execution handoff item. Cost estimates, history, scanning, cross-project analytics and content inspection remain out of scope.
