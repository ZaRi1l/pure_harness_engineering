---
name: task-routing
description: Use when a new task has unclear scope, complexity, or agent choice; skip when a SMALL task and its verification are already obvious.
---

Classify by uncertainty, coupling, risk, and parallel value rather than file count.

- SMALL: one worker, then the minimum deterministic check.
- MEDIUM: planner, worker, verifier, reviewer. Combine verifier/reviewer only when independence has no value.
- LARGE: planner, impact analyzer, isolated workers only for independent tasks, integrator, verifier, reviewer, and supervisor at major checkpoints.

Add a specialist only when its named risk exists. Keep the main context to decisions, task specs, short handoffs, and final evidence. Never delegate several agents to repeat the same exploration.

Use the active runtime's available delegation and lifecycle tools. Claude, OpenCode, and Antigravity do not need Codex hooks, RuntimeStore commands, `followup_task`, or `CODEX_THREAD_ID` to route work; unavailable observability must not block the task.

## Codex-only lifecycle

Apply the following only when the active runtime explicitly supplies Codex hooks, RuntimeStore lifecycle commands, and the relevant native agent tools and IDs.

Hooks remain the primary lifecycle source. When Main receives a successful native spawn acknowledgement, best-effort record `agent-start` with that exact native instance ID and `--source orchestration`; record no fallback for a merely planned delegation. When the native result returns, best-effort record a neutral `agent-stop --outcome stopped --source orchestration` and release the agent's claim. Continue the work if observability recording fails. Hook records reconcile the same ID and take precedence; never infer completion or merge agents by role, task text, or timing.

Record the prior turn's neutral stop before sending `followup_task`. On successful acknowledgement for that stopped agent, create and retain one unique token for that follow-up, then record `agent-resume <same-id> --task <short-title> --summary <explicit-summary> --task-id <task-id> --turn-token <token> --source orchestration`; use the same token for neutral `agent-stop` on the new turn's return and for retries. If acknowledgement lacks an ID, obtain the child's exact `CODEX_THREAD_ID` and verify an existing lifecycle record for that ID first; never infer one. If the prior stop was omitted and the next turn may be active, do not issue a retroactive unguarded stop. Task IDs cannot correlate resumed hooks to turns. Keep the explicit summary under 200 characters, not a prompt body. Recording remains best effort.
