# Pure Harness

Use judgment for decisions, Skills for repeatable reasoning, and scripts/hooks for deterministic work. This file governs maintenance of the engine checkout, not work inside an installed product checkout; the selected product's own guidance governs its files. Read only the files needed for the current task.

## Routing

- Root owns the overall request and conversation. Delegate even SMALL repository changes to one scoped worker, then obtain the minimum relevant verification. Root handles narrow read-only scoping and final synthesis without duplicating the worker's investigation or edits.
- MEDIUM: plan, execute, verify, then independently review. Combine roles only when independence adds no value.
- LARGE: plan and analyze impact; isolate independent writers; integrate, verify, review, and use supervisor at checkpoints.
- Give agents nonduplicated scopes. Invoke specialists only when their trigger applies; agent definitions are a menu, not a checklist. Bring meaningful architectural choices to the user before implementation.

Use `.agents/skills/task-routing/` and its profile reference for domain guidance. For MEDIUM or LARGE work, use the selected project's declared Task Spec location when a spec will reduce ambiguity.

## Model policy

Subagents use role-specific defaults from `.codex/config.toml` and `.codex/agents/*.toml`. Sol is for implementation and high-value judgment; Luna is for verification, collection, operations, and repetitive work. Astra is manual exceptional escalation only. Do not raise model or reasoning effort unless the task justifies it.

## Safety and scope

Preserve user changes. Do not reset, revert, overwrite, or broadly refactor outside the requested scope. If the expected change budget grows materially, stop implementation and return to planning. Parallel writers must use separate branches/worktrees and must not edit the same files concurrently.

Before writing engine-owned source, claim exact paths with `node scripts/runtime-state.mjs --core claim <agent-id> <path> [...]` and release with `node scripts/runtime-state.mjs --core release-claim <agent-id>`. The `--core` mode is for engine files only; use the installed product's declared runtime entrypoint and guidance for product files. If its runtime is unavailable, preserve cooperative single-writer safety and report that observability is unavailable. Prefix-overlapping claims must run sequentially unless isolated in native Git worktrees.

## Verification

Base completion on actual commands, artifacts, and verification evidence, not an agent's claim. A worker does not give final approval to its own result. Record evidence through the applicable runtime when available; report missing or failing checks honestly.

Use `.agents/skills/testing/` for proportionate worker tests and independent verifier/reviewer checks. `npm run watchdog` records deterministic anomalies; invoke the read-only supervisor only when Main judges escalation useful.

## Memory and runtime

Keep durable decisions, conventions, regressions, and current project facts in the declared memory location; put generated activity in the declared runtime location through its supported entrypoint. Do not store transcripts or routine logs as memory, or edit generated dashboard status by hand.

Use available native lifecycle hooks as the primary delegation record. Apply runtime-specific recording only when its tools and exact IDs are available; unavailable observability must not block the work. Keep handoff metadata short and omit prompts or private reasoning. See the task-routing Skill for the relevant runtime procedure.

Repeated failure must change the hypothesis. After two failed attempts using the same approach, summarize evidence and invoke planner or supervisor before another attempt.
