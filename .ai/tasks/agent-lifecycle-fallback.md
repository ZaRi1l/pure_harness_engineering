# Agent Lifecycle Fallback

## Goal

Keep Codex lifecycle hooks as the primary source while recording a thin, explicit orchestration fallback when Main actually invokes and receives a native subagent.

## Requirements

- Reconcile hook and orchestration lifecycle writes by the same native agent instance ID.
- Make repeated start/stop writes idempotent across agent records, signals, and events.
- Preserve neutral lifecycle outcomes; never infer task success.
- Record actual hook dispatch evidence and warn only when fallback delegation exists without matching hook dispatch evidence.
- Keep interrupted fallback agents active so the existing stale-agent watchdog can report them.
- Document best-effort fallback writes and runtime reset behavior centrally.

## Out of Scope

- Agent execution, process polling, wrappers, daemons, databases, message buses, or inferred relationships.
- Private messages, prompts, or chain-of-thought storage.
- Automatic stale-to-completed transitions.

## Affected Areas

- `scripts/runtime-state.mjs`
- `scripts/hook-runtime.mjs`
- `scripts/watchdog.mjs`
- `scripts/self-check.mjs`
- `AGENTS.md`, `.agents/skills/task-routing/SKILL.md`, `README.md`
- Runtime, hook, watchdog, and self-check tests

## Acceptance Criteria

- Hook-only, fallback-only, and hook-plus-fallback flows retain one agent, one delegate edge, and one result edge per agent instance.
- Hook provenance becomes canonical when a hook reconciles an orchestration fallback.
- A fallback-only returned agent leaves Active Agents without being marked completed and retains history.
- An interrupted fallback remains active and becomes a stale warning after the configured threshold.
- Fallback evidence without lifecycle hook dispatch produces a diagnostic warning; missing SessionStart alone does not.
- Existing Agent Signal Network, Active Agents, Signal Timeline, claims, demo, static preview, and live preview remain compatible.

## Verification

- Targeted Node tests for runtime lifecycle, hooks, watchdog, and self-check.
- `npm test`
- `npm run self-check`
- `npm run demo:network`
- `npm run preview`
- `npm run preview:live`

## Risks

- Hook/fallback deduplication requires Main and the hook payload to use the same stable native agent instance ID. Different host IDs cannot be safely guessed or merged.
- Event and signal caps can remove old dispatch evidence; diagnostics must avoid claiming a platform fault without positive current-runtime fallback evidence.
