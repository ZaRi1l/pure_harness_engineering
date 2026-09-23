# Pure Harness v1.1

## Goal
Keep the lightweight Codex-native harness while adding deterministic status, claims, watchdog, and optional live UI support.

## Requirements
- Keep Node built-ins, lifecycle hooks, and localhost-only live preview.
- Add status CLI with text and JSON output.
- Make preview one-shot/static and add preview:live for the server.
- Add path-prefix write claims and conflict detection.
- Add one-shot watchdog warnings recorded in runtime state.
- Add the testing Skill and remove duplicated agent/skill catalogs.
- Show claims, warnings, and agent elapsed time in live UI.

## Out of Scope
- Daemons, extra Codex processes, network agents, databases, dependencies, autonomous recovery, and browser editing of configuration.

## Affected Area
- Runtime store, hook bridge, CLI scripts, preview, self-check, tests, README, AGENTS, and repository skills.

## Constraints
- No model or reasoning-level hard-coding.
- Generated runtime state stays ignored.
- Worker completion is distinct from lifecycle stop; verification remains independent.

## Acceptance Criteria
- The v1.1 commands in the specification run without a persistent server except preview:live.
- Claims reject overlapping path prefixes and appear in snapshot/status/UI.
- Watchdog reports listed deterministic anomalies without recovery actions.
- Agent and skill catalogs are discovered from repository configuration.
- Existing hook and traversal protections remain intact.

## Verification
- Focused runtime, status, watchdog, preview, hook, and self-check tests.
- npm test; npm run self-check; npm run status; npm run watchdog; npm run preview; short preview:live smoke test.

## Risk
Runtime schema evolution must preserve existing files; static preview generation must not become a live-server dependency.
