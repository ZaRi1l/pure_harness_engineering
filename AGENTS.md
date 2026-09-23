# Pure Harness

Use judgment for decisions, Skills for repeatable reasoning, and scripts/hooks for deterministic work. Read only the files needed for the current task.

## Routing

- SMALL: use one worker and the minimum relevant verification.
- MEDIUM: plan, execute, verify, then independently review. Combine roles only when independence adds no value.
- LARGE: plan and analyze impact; isolate independent writers; integrate, verify, review, and use supervisor at checkpoints.
- Invoke specialists only when their trigger applies. Agent definitions are a menu, not a checklist.

Use `.agents/skills/task-routing/` and its profile reference for domain guidance. For MEDIUM or LARGE work, create a Task Spec under `.ai/tasks/` when it will reduce ambiguity.

## Safety and scope

Preserve user changes. Do not reset, revert, overwrite, or broadly refactor outside the requested scope. If the expected change budget grows materially, stop implementation and return to planning. Parallel writers must use separate branches/worktrees and must not edit the same files concurrently.

Before writing, claim the intended path with `node scripts/runtime-state.mjs claim <agent-id> <path> [...]`; release it when finished. Prefix-overlapping claims must run sequentially unless isolated in native Git worktrees.

## Verification

Prefer real commands and artifacts over agent claims. A worker does not give final approval to its own result. Record verification evidence in runtime state; do not claim completion while required checks are missing or failing.

Use `.agents/skills/testing/` for proportionate worker tests and independent verifier/reviewer checks. `npm run watchdog` records deterministic anomalies; invoke the read-only supervisor only when Main judges escalation useful.

## Memory and runtime

Store only durable decisions, conventions, regressions, and current project facts in `.ai/memory/`. Do not store transcripts or routine logs there. Generated activity belongs in `.ai/runtime/` and is updated through `scripts/runtime-state.mjs`; never edit dashboard status by hand.

Lifecycle hooks record delegation and results automatically. For a meaningful agent-to-agent handoff that should appear in the dashboard network, record only metadata with `node scripts/runtime-state.mjs signal <from> <to> <kind> <short-summary>`; never store full prompts or private reasoning.

Repeated failure must change the hypothesis. After two failed attempts using the same approach, summarize evidence and invoke planner or supervisor before another attempt.
