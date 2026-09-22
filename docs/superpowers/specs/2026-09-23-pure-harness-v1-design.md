# Pure Harness v1 Design

## Intent

Build a reusable Codex harness for coding, research, writing, planning, and data work. The harness routes small work cheaply, expands only when complexity warrants it, records durable project knowledge, updates transient workflow state deterministically, and exposes that state in a browser dashboard.

## Architecture

Codex-native configuration lives in `.codex/`: project agent declarations, standalone custom-agent files, and one `hooks.json` source. Reusable reasoning procedures and compact project profiles live in `.agents/skills/`. Dependency-free Node scripts own `.ai/runtime/`, while durable human-curated knowledge lives in `.ai/memory/`.

The dashboard is static HTML and JavaScript served by a localhost-only, dependency-free Node.js server. It reads runtime JSON endpoints and never invents agent status. Feature previews are links registered in runtime state; no placeholder feature pages are generated.

The dashboard also renders a clickable agent signal network. Lifecycle hooks create delegation and result edges automatically; explicit handoffs store only sender, recipient, type, and a short summary. Node details come from the runtime agent registry.

## Routing

- SMALL: one worker and the minimum deterministic verification.
- MEDIUM: planner, worker, verifier, and reviewer; roles may be combined when independence is not material.
- LARGE: planner and impact analysis, isolated workers when tasks are independent, integrator, verifier, reviewer, and supervisor at checkpoints or on anomalies.

Routing remains a judgment by the orchestrator. Profiles provide decision cues rather than file-count thresholds. Subagents inherit the active model because model availability is account and client dependent.

## Runtime and Hooks

`status.json`, `tasks.json`, and `events.jsonl` are generated state. Updates use atomic file replacement and a short cross-process lock. Events are capped, do not contain full prompts or tool output, and record only lifecycle and explicit important events. Session and subagent lifecycle hooks call the same script on Windows and POSIX.

## Safety and Scope

Agent instructions impose a change budget, prohibit unrelated refactors, keep reviewers and supervisors read-only, and require deterministic evidence before completion. Parallel writers use separate branches or worktrees and never edit the same files concurrently.

## Verification

The Node built-in test suite exercises runtime transitions, event retention, dashboard serving, route/profile/config validation, and a mock SMALL/MEDIUM lifecycle. `self-check.mjs` validates config loading, JSON, skill frontmatter, hook commands, agent paths, runtime behavior, and dashboard endpoints without modifying live runtime state.
