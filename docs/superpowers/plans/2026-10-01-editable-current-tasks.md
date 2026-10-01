# Editable Current Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, project-scoped create/edit controls for live Current Tasks without losing concurrent edits or browser drafts.

**Architecture:** Extend the existing locked `RuntimeStore` task document with per-task opaque revisions, then expose single-record mutations through the validated-context localhost server. Keep the browser draft outside the polling render path; static generated preview and legacy fixtures stay read-only.

**Tech Stack:** Node.js ESM, built-in `node:test`, HTTP server, vanilla browser DOM; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-editable-current-tasks-design.md`

## Global Constraints

- Neutral engine only; no SILO code, data, GOAL, backend, or original `D:/dev/pure_harness_engineering` checkout changes. Execute in this isolated checkout and claim exact paths before writing.
- `RuntimeStore` lock, atomic persistence, validated project context, project stamp, and existing ACL/path checks remain authoritative.
- Title: trimmed, nonempty, at most 300 characters. Status: existing `TASK_STATUSES`. Branch: `null` or trimmed, nonempty, at most 120 characters and no control characters; never map `owner` to branch.
- `revision` is opaque exact equality, not time or authorization; all mutation paths rotate it, including unchanged and same-millisecond CLI upserts.
- Writes require `127.0.0.1`, exact current `Host`/`Origin`, per-process token header, JSON content type, strict small body limit, and constant-time comparison. No CORS write allowance, token persistence/logging, bulk/partial writes, or client project/path/ID generation.
- Static preview and legacy-fixture writes remain disabled. Automated code/fixture/DOM tests only; a human validates actual browser behavior.
- Run focused tests, then `npm test` and `npm run self-check`; use Korean conventional commit messages. Task-sized review after each task and whole-plan review at the end.

## Review Focus

- Duplicate IDs in an existing task document must reject a create/update without changing runtime; pin in Task 1 `duplicate_existing_ids_rejected`.
- Unicode whitespace-only title and branch must not pass trim validation; pin in Task 1 `unicode_whitespace_not_a_label`.
- A token from a prior server process must fail after restart without mutation; pin in Task 2 `token_rotates_on_restart`.
- A second polling response arriving after a newer one must not roll back the row or active conflict view; pin in Task 3 `out_of_order_poll_is_ignored`.
- A task with an invalid date must sort after dated tasks in both directions without mislabeling its timestamps; pin in Task 4 `invalid_dates_sort_last`.

---

## File map

| File | Responsibility |
| --- | --- |
| `scripts/task-records.mjs` (new) | Editable-field validation, legacy revision derivation, safe record projection and ordering keys; pure functions. |
| `scripts/runtime-state.mjs` | Locked `createTask`, `updateTask`, and revision rotation in existing `upsertTask`; no second task store. |
| `scripts/preview-server.mjs` | Validated-context task GET/POST/PUT dispatch, process token, local request gate, bounded JSON/error mapping. |
| `preview/task-editor.js` (new) | Draft/conflict state and DOM controls; preserves focus, caret, and scroll during polling. |
| `preview/dashboard.js`, `preview/index.html`, `preview/preferences.js` | Mount editor, poll data, row labels, styling and translated copy. Do not alter `scripts/generate-preview.mjs` into a writer. |
| `tests/task-records.test.mjs`, `tests/runtime-state.test.mjs`, `tests/preview-server.test.mjs`, `tests/status-preview.test.mjs` | Pure, lock/concurrency, HTTP security, and simulated-DOM/poll contracts. |

The donor checkout has no matching editable-task implementation; preserve its existing neutral patterns only. Avoid new packages. Append new test files to `tests/all.test.mjs` only if that runner does not already discover them.

### Task 1: Versioned single-task store mutations

**Files:** Create `scripts/task-records.mjs`, `tests/task-records.test.mjs`; modify `scripts/runtime-state.mjs`, `tests/runtime-state.test.mjs`, and `tests/all.test.mjs` if needed.

**Interfaces:** Produce `validateTaskFields(value: unknown): {title:string,status:string,branch:string|null}`; `taskRevision(task: object): string` (stored opaque value or deterministic hash of canonical editable fields, `created_at`, `updated_at` for legacy records); `safeTask(task: object): object`; `RuntimeStore.createTask(fields): Promise<object>`; `RuntimeStore.updateTask(id: string, revision: string, fields): Promise<{kind:'updated',task:object}|{kind:'missing'}|{kind:'conflict',task:object}>`. Store errors distinguish malformed input/duplicate IDs from conflicts; do not persist on failure. `upsertTask` remains source-compatible.

- [ ] **Step 1: Write failing pure/store tests.** In `tests/task-records.test.mjs`, assert validation trims fields, rejects unknown/client-owned fields, invalid status/control branch/overlong labels, and `unicode_whitespace_not_a_label`; assert stable legacy revision. In `tests/runtime-state.test.mjs`, assert create generates unique ID/timestamps/revision, update changes only one task and preserves owner/other revisions, stale update returns current safe record unchanged, `duplicate_existing_ids_rejected`, and two same-millisecond/unchanged upserts rotate revision.
- [ ] **Step 2: Run red checks.** `node --test tests/task-records.test.mjs tests/runtime-state.test.mjs`; expect new tests to fail for absent exports/methods.
- [ ] **Step 3: Implement pure helpers and locked store methods.** Under one `withLock`, load, validate identity and duplicate IDs, compare the exact current revision, mutate only the target, allocate `randomUUID()` ID/revision with collision checks, update derived status through existing `persist`, and emit metadata-only event (`task ID/status`, never title/branch). Do not use `mutate` for failed paths because it persists on return.
- [ ] **Step 4: Run green checks.** Same command; expect PASS. Review gate: inspect `git diff --check` and task-only diff for lock/atomicity, event privacy, and legacy compatibility.
- [ ] **Step 5: Commit.** `git add scripts/task-records.mjs scripts/runtime-state.mjs tests/task-records.test.mjs tests/runtime-state.test.mjs tests/all.test.mjs`; `git commit -m "feat: 작업별 리비전과 안전한 변경 저장 추가"` (omit `tests/all.test.mjs` if untouched).

### Task 2: Localhost task HTTP contract

**Files:** Modify `scripts/preview-server.mjs`, `tests/preview-server.test.mjs`.

**Interfaces:** Consume Task 1 store methods and `safeTask`; produce `GET /runtime/tasks` as `{...existing document, tasks:[safe records], write_token:string}` only for validated live context (legacy GET remains compatible without token); `POST /runtime/tasks` → `201` record; `PUT /runtime/tasks/:id` → `200` record; typed `400/403/404/405/409/413` responses with safe `409` current record. Token header: `X-Task-Write-Token`. Fix maximum body at 16 KiB; reject unsupported content encoding and any extra JSON keys. Do not return token in `/runtime/snapshot`.

- [ ] **Step 1: Write failing HTTP tests.** In a two-project validated fixture assert create/update and A/B isolation; malformed IDs/bodies/JSON/status/branch and client-owned fields → `400`; missing task → `404`; stale revision → `409` plus safe current record; oversized body → `413`; bad remote address/Host/Origin/token/content type → `403` or `400` per contract; `token_rotates_on_restart`; legacy/static PUT/POST → `405`; existing GETs continue working; failed requests leave task document bytes unchanged.
- [ ] **Step 2: Run red check.** `node --test tests/preview-server.test.mjs`; expect new route tests to fail.
- [ ] **Step 3: Implement guarded routes.** Gate methods before generic GET handler, use actual listening address/port for exact `Host` and `Origin`, `request.socket.remoteAddress` loopback check, `timingSafeEqual` on fixed-length token bytes, strict bounded streaming, and sanitized error mapping. Never accept project identity/path from request or log token/body.
- [ ] **Step 4: Run green check.** Same command; expect PASS. Review gate: independently read route diff for CSRF/token and response-data leakage.
- [ ] **Step 5: Commit.** `git add scripts/preview-server.mjs tests/preview-server.test.mjs`; `git commit -m "feat: 로컬 작업 변경 API 추가"`.

### Task 3: Draft-preserving add/edit controller

**Files:** Create `preview/task-editor.js`; modify `preview/dashboard.js`, `preview/index.html`, `preview/preferences.js`, `tests/status-preview.test.mjs`.

**Interfaces:** Produce `createTaskEditor(host: HTMLElement, {fetchImpl, translate}): {update(tasks: object[], writeToken: string|null): void, destroy(): void}`. Controller owns active `{mode,id,originalRevision,fields,validation,conflict}` and request-generation counter. `update` refreshes non-edited rows but does not recreate active form controls; Save/Cancel are explicit, 409 displays current record and explicit Reload/Cancel, network failure retains draft and Retry.

- [ ] **Step 1: Write failing simulated-DOM tests.** Use existing test DOM helpers (or minimal in-test DOM doubles; no dependency). Assert Add and Edit retain field values, active element, selection range, scroll and validation through `update`; successful Save adopts returned record; `409` retains draft and shows safe current record until Reload; Cancel discards; `out_of_order_poll_is_ignored`; no write from blur; static preview has no controls.
- [ ] **Step 2: Run red check.** `node --test tests/status-preview.test.mjs`; expect new controller tests to fail.
- [ ] **Step 3: Implement controller and mount.** Keep form nodes stable across 3-second `paint()` updates; separate mutable row rendering from active form. Send only complete editable fields plus revision for PUT. Avoid `innerHTML` for task text. Persist page-session sort choice in controller state, not runtime.
- [ ] **Step 4: Run green check.** Same command; expect PASS. Review gate: inspect DOM lifecycle and error paths; do not call automated tests “browser validation.”
- [ ] **Step 5: Commit.** `git add preview/task-editor.js preview/dashboard.js preview/index.html preview/preferences.js tests/status-preview.test.mjs`; `git commit -m "feat: 초안 보존 작업 편집 UI 추가"`.

### Task 4: Truthful row ordering and integration checks

**Files:** Modify `preview/task-editor.js`, `preview/preferences.js`, `tests/status-preview.test.mjs`, `tests/preview-server.test.mjs` if required by integration tests.

**Interfaces:** Extend Task 3 controller with newest-first default and explicit oldest-first toggle. Sorting key is valid `updated_at`, else valid `created_at`; dated rows precede undated rows in either direction, ID breaks ties deterministically. Rows label Created and Updated separately, status and branch separately; `owner` remains distinct and noneditable.

- [ ] **Step 1: Write failing tests.** Assert update-first ordering, created fallback, deterministic ID ties, `invalid_dates_sort_last`, truthful labels, null branch versus owner, and toggle persistence across refresh (not reload).
- [ ] **Step 2: Run red check.** `node --test tests/status-preview.test.mjs tests/preview-server.test.mjs`; expect ordering/label tests to fail.
- [ ] **Step 3: Implement minimum row/sort changes.** Parse timestamps once per render; use text nodes and translation keys for visible labels.
- [ ] **Step 4: Run focused and repository checks.** Same focused command, then `npm test` and `npm run self-check`; expect exit 0. Record actual output in runtime verification state, then task-sized diff review and whole-plan spec-coverage review.
- [ ] **Step 5: Commit.** `git add preview/task-editor.js preview/preferences.js tests/status-preview.test.mjs tests/preview-server.test.mjs`; `git commit -m "feat: 작업 시각과 정렬 표시 정정"` (omit untouched files).

## Spec-coverage self-review

- Task 1: legacy revision, concurrent same/different-task updates, owner/branch separation, validation, events, counts, project identity.
- Task 2: selected-project HTTP, write security/error codes, static/fixture read-only, restart token, unchanged GETs.
- Tasks 3–4: draft/focus/scroll/409/retry, explicit controls, truthful times, sorting/ties/toggle. Five Review Focus cases are pinned to named tests.
- Human browser appearance/interaction is deliberately outstanding for execution handoff, not claimed by these code/fixture/UI tests. No deletion, bulk operations, branch checkout, or product-specific mutation is planned.
