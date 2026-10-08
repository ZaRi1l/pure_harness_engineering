---
name: task-routing
description: Use when a new task has unclear scope, complexity, or agent choice; skip when a SMALL task and its verification are already obvious.
---

Classify by uncertainty, coupling, risk, and parallel value rather than file count.

- SMALL: one worker, then the minimum deterministic check.
- MEDIUM: planner, worker, verifier, reviewer. Combine verifier/reviewer only when independence has no value.
- LARGE: planner, impact analyzer, isolated workers only for independent tasks, integrator, verifier, reviewer, and supervisor at major checkpoints.

Add a specialist only when its named risk exists. Keep the main context to decisions, task specs, short handoffs, and final evidence. Never delegate several agents to repeat the same exploration.

Use the active runtime's available delegation tools and the selected project's project-declared runtime entrypoint for claims and observability. If the runtime entrypoint or observability is unavailable, maintain cooperative single-writer safety, report the gap, and continue work that can be done safely; unavailable observability is nonblocking.

For Codex lifecycle recording, read [references/codex-lifecycle.md](references/codex-lifecycle.md) only when the active runtime supplies the relevant native tools and IDs. Other targets use their own available lifecycle facilities.
