# Final whole-branch fix wave — 2026-10-06

Base: `63ac047` in the isolated neutral engineering stage. One writer; original and product checkouts untouched.

## Resolved findings

1. Telemetry task IDs now have a separate bounded opaque-ID boundary from native thread IDs. Exact legacy IDs containing spaces, Korean text, slashes, dots, or colons survive link normalization, rollout parsing, aggregation, persistence, CLI import, and safe HTTP readback. Control characters and IDs over 500 UTF-16 code units remain invalid. `short_task_name` is the exact task ID only when it fits the conservative ASCII label grammar; otherwise it is `null`. Hook prompt text is never used to derive either field. New schema, hook, rollout, and CLI/HTTP tests cover this flow and prompt sentinels.
2. Add drafts generate one UUID request ID and retain their first submitted payload through an ambiguous response. The server accepts the optional UUID only on POST; the store holds its ID and canonical-field hash with the task and checks both inside the existing project lock. A same-ID/same-payload replay returns the original/current safe task without another persist or event; a changed payload returns `409` without writes. DOM, store concurrency, and HTTP tests cover commit-then-discarded-response, retry, restart, conflict, and project isolation. Existing Host, Origin, peer, token, content-type, size, and selected-project guards remain in force.
3. Both approved implementation plans have no product-specific checkout or `SILO` references. Their generic isolation and verification requirements remain, and the editable-task plan records the add-request replay contract.
4. Current Task rows display translated status labels, including Korean, and conflict copy translates the server status. The Korean DOM regression covers the row.

## Verification evidence

- RED: the new telemetry schema/hook/rollout and create store/HTTP/DOM tests failed against base behavior for the expected missing boundaries (6 failures in the first focused run); the short-label and Korean-status tests were also observed failing before their fixes.
- GREEN: focused six-suite run, 154 tests passed, 0 failed.
- `npm test`: 447 tests, 445 passed, 2 platform skips, 0 failed; exit 0.
- `npm run self-check`: exit 0. Its only warnings are pre-existing observational limits: no lifecycle hook dispatch yet in the isolated runtime, and model entitlement not verified.
- `git diff --check`: exit 0. Exact scan of the two plans for `SILO`, `Silo_server`, and `D:/dev/chrome_extension`: no matches.
- Evidence also recorded in isolated core runtime under `.ai/runtime/combined-review-fix/`; no pre-existing untracked runtime directory was removed or staged.

## Tradeoffs and remaining validation

- Idempotency is guaranteed for new UI adds and API clients that supply `request_id`; older POST callers omitting it retain their previous create semantics because an identical body could be an intentional second task.
- The retry reuses the first payload and makes add fields read-only after an uncertain failure. To change that task, the user cancels and starts a new add after checking the current list. This avoids silently turning a retry into a second distinct create.
- The identifier boundary trusts explicit task-ID metadata as an identifier, while ignoring prompt/body fields; exact source provenance is still required for telemetry attribution. No source-log path or arbitrary prompt text is persisted as a short label.
- Human browser appearance/interaction validation and native Codex smoke remain outstanding, as stated in the approved plans. The `127.0.0.2` peer allowlist and encoded-dot `405` issues remain deferred minor availability/diagnostic limitations; security gates were not relaxed.
