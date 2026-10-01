# Project-Scoped Editable Current Tasks Design

## Purpose and success

Let a developer correct one Current Tasks entry from the live Pure Harness Dashboard without editing generated JSON or overwriting another writer's change. A successful edit changes only that task in the selected project's runtime, gives a clear conflict when its exact prior version is gone, and leaves an in-progress browser draft intact during polling. This is a neutral engine feature; product-specific goals, previews, and backend behavior are outside its scope.

## Chosen approach and alternatives

Extend the existing `RuntimeStore` task mutation path and localhost preview server, rather than introducing a second task store. The server is already constructed from a validated project context, and the store already locks and atomically persists project-stamped runtime files. A separate dashboard JSON file would split the source of truth; a whole-list PUT would permit lost updates to unrelated tasks. The static generated preview remains read-only.

## Contract and data flow

- `GET /runtime/tasks` returns the selected context's tasks, each with an opaque exact `revision`, plus a process-memory write token for this page. Existing task IDs, titles, statuses, owners, and timestamps remain compatible. A legacy task without a stored revision is exposed with a deterministic revision derived from its canonical editable fields and timestamps; the first successful write stores a new unpredictable revision. Every mutation path, including the existing CLI upsert, assigns a new revision under the runtime lock even if the editable values or millisecond timestamp are unchanged. The revision is an equality token, not a time estimate or an authorization credential.
- `PUT /runtime/tasks/:id` accepts a bounded JSON object containing `revision`, `title`, `status`, and `owner`. The URL ID must identify one existing task; the body cannot change its ID, `created_at`, project identity, or other server-owned fields. No create, delete, bulk update, or partial patch is accepted. Title is trimmed, nonempty, and at most 300 characters; status must be one of the store's existing task statuses; owner is either null or a bounded identifier. Unknown fields and duplicate task IDs fail validation.
- Under one runtime lock, the store loads the current selected-project document, compares the supplied revision with that exact task's current revision, and either returns a conflict without writes or replaces only its editable fields. A successful write updates `updated_at` and `revision`, persists through the existing atomic runtime path, refreshes derived status/counts, and records a concise task event without copying a free-text title into the event. Other tasks keep their data and revisions.
- The Dashboard displays tasks newest first by `created_at` with task ID as a deterministic tie-breaker, with an explicit Oldest first toggle. Missing or invalid timestamps sort after valid timestamps in either direction. The choice persists for the current page session. A selected row offers an explicit Edit/Save/Cancel flow; there is no implicit save on blur.
- Polling refreshes non-edited rows. An active draft is keyed by task ID and retains its typed fields, original revision, validation message, keyboard focus/caret, and scroll position. A background refresh may show that the server record changed but never replaces the draft. Save success adopts the returned record; a `409` retains the draft and shows the current server record with Reload/Cancel choices. Reload is explicit and discards the draft; there is no silent retry or automatic merge.

## Security, errors, and isolation

The write route exists only for a validated project context on a server bound to `127.0.0.1`; legacy fixtures and static previews are read-only. The request must arrive from loopback, with the exact current `Host` and `Origin`, the process-memory token in a dedicated header, JSON content type, and a strict small body limit. The token is compared in constant time, never written to disk or logs, and rotated on server restart. No CORS write allowance is added. These checks mitigate drive-by browser requests; the token is not a substitute for local OS access control.

Malformed input returns `400` (or `413` for size), failed local authorization `403`, unknown task `404`, stale revision `409` with the current safe task record, and unsupported method `405`. No failed request mutates runtime state. The client keeps the draft after network errors and exposes a retry action. The route never accepts a project ID or runtime path from the request; all reads and writes use the server's validated context and reject cross-project identity mismatch. Existing project ACL/path checks remain intact.

## Verification and non-goals

Automated tests cover exact revision comparison (including legacy records and same-millisecond edits), two concurrent edits to one task, concurrent edits to different tasks, invalid bodies/IDs/statuses, authorization and body limits, project A/B isolation, ordering ties, and draft/focus/scroll retention through polling and `409`. HTTP fixture tests confirm static preview and legacy-fixture writes are disabled and the existing read endpoints still work. Run the focused runtime/server/dashboard tests, then `npm test` and `npm run self-check` before implementation is called complete. Browser appearance and interaction are reserved for human validation; automated DOM/HTTP checks are not described as browser validation.

Non-goals: task creation/deletion, bulk editing, drag reordering, collaborative merge, persistent client drafts, public-network access, task-spec edits, and any product-specific GOAL or backend mutation.
