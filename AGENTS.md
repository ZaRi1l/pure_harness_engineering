# Pure Harness

Use judgment for decisions, Skills for repeatable reasoning, and scripts/hooks for deterministic work. Read only the files needed for the current task.

## Routing

- SMALL: use one worker and the minimum relevant verification.
- MEDIUM: plan, execute, verify, then independently review. Combine roles only when independence adds no value.
- LARGE: plan and analyze impact; isolate independent writers; integrate, verify, review, and use supervisor at checkpoints.
- Invoke specialists only when their trigger applies. Agent definitions are a menu, not a checklist.

Use `.agents/skills/task-routing/` and its profile reference for domain guidance. For MEDIUM or LARGE work, create a Task Spec under `.ai/tasks/` when it will reduce ambiguity.

## Model policy

Subagents use role-specific defaults from `.codex/config.toml` and `.codex/agents/*.toml`. Sol is for implementation and high-value judgment; Luna is for verification, collection, operations, and repetitive work. Astra is manual exceptional escalation only. Do not raise model or reasoning effort unless the task justifies it.

## Safety and scope

Preserve user changes. Do not reset, revert, overwrite, or broadly refactor outside the requested scope. If the expected change budget grows materially, stop implementation and return to planning. Parallel writers must use separate branches/worktrees and must not edit the same files concurrently.

Before writing engine-owned source, claim exact paths with `node scripts/runtime-state.mjs --core claim <agent-id> <path> [...]` and release with `node scripts/runtime-state.mjs --core release-claim <agent-id>`. For a selected project's checkout or management paths, use `node scripts/runtime-state.mjs --project <id> --checkout <absolute-checkout> --binding <absolute-binding> claim <agent-id> <path> [...]` and the same project flags for `release-claim`. Never use `--core` for project data. Prefix-overlapping claims must run sequentially unless isolated in native Git worktrees.

## Verification

Prefer real commands and artifacts over agent claims. A worker does not give final approval to its own result. Record verification evidence in runtime state; do not claim completion while required checks are missing or failing.

Use `.agents/skills/testing/` for proportionate worker tests and independent verifier/reviewer checks. `npm run watchdog` records deterministic anomalies; invoke the read-only supervisor only when Main judges escalation useful.

## Memory and runtime

Store only durable decisions, conventions, regressions, and current project facts in `.ai/memory/`. Do not store transcripts or routine logs there. Generated activity belongs in `.ai/runtime/` and is updated through `scripts/runtime-state.mjs`; never edit dashboard status by hand.

Lifecycle hooks are the primary deterministic source for delegation and return records. When Main actually invokes a native subagent, use the exact native agent instance ID returned by the successful spawn acknowledgement and best-effort record `node scripts/runtime-state.mjs agent-start <id> <role> --task <summary> --task-id <task-id> --source orchestration`; never record a planned but uninvoked delegation. After the native result actually returns, best-effort record `node scripts/runtime-state.mjs agent-stop <id> --outcome stopped --task-id <task-id> --source orchestration` and release its claim. Recording failures must not cancel the agent workflow. Hooks reconcile the same ID and take precedence; do not merge by role, task text, or timing, and do not infer task success from a return. For a meaningful agent-to-agent handoff that should appear in the dashboard network, record only metadata with `node scripts/runtime-state.mjs signal <from> <to> <kind> <short-summary>`; never store full prompts or private reasoning.

Record the prior turn's neutral stop on its return before sending `followup_task`. After a successful native follow-up acknowledgement for that stopped agent, create one unique follow-up turn token (for example a UUID), retain it for retries, and best-effort record `node scripts/runtime-state.mjs agent-resume <same-id> --task <short-title> --summary <explicit-summary> --task-id <task-id> --turn-token <token> --source orchestration`. Record `agent-stop <same-id> --outcome stopped --turn-token <same-token> --source orchestration` only when that turn returns. If acknowledgement lacks an ID, obtain the child's exact `CODEX_THREAD_ID` and confirm that ID already exists in runtime lifecycle history before recording resume. Never synthesize an ID from role, name, timing, or task text. If the prior stop was omitted and the next turn may be running, do not issue a retroactive unguarded stop. Keep summaries under 200 characters and omit prompt bodies. Task IDs are not turn IDs: hooks without an exact current-turn token cannot close a resumed turn.

Repeated failure must change the hypothesis. After two failed attempts using the same approach, summarize evidence and invoke planner or supervisor before another attempt.
