# Pure Harness v1.1

Pure Harness is a thin, Codex-native workflow harness. Main Codex makes orchestration decisions; Skills provide repeatable procedures; specialist agents are used only when an independent context or judgment is worthwhile. Scripts and hooks hold deterministic state and checks.

Node.js is used for lightweight scripts and hooks. A persistent Node server is **not** required for normal harness operation. The server is only needed for the optional live dashboard.

## Start

1. Clone or copy the tracked harness files into a Git repository.
2. Run `npm run init`.
3. Open the repository in Codex, inspect and trust hooks with `/hooks`.
4. Run `npm run self-check`.
5. Use Codex normally. Use `npm run status` when you need a terminal snapshot.

```powershell
npm run init
npm run status
npm run preview
npm run preview:live
npm run watchdog
npm test
npm run self-check
```

`npm run preview` creates `.ai/runtime/preview.html` from one runtime snapshot and exits. `npm run preview:live` starts an optional dashboard at `http://127.0.0.1:8765/`; it is localhost-only and refreshes runtime state every three seconds.

## Runtime

Hooks automatically record session and subagent lifecycle metadata. A subagent stop is neutral, not success: task state plus verification evidence determine completion.

```powershell
node scripts/runtime-state.mjs goal "Implement connector" --phase execution
node scripts/runtime-state.mjs task implementation "Implement connector" in_progress --owner worker-1
node scripts/runtime-state.mjs claim worker-1 src/backend/
node scripts/runtime-state.mjs verify passed unit-tests --detail "npm test"
node scripts/runtime-state.mjs release-claim worker-1
node scripts/runtime-state.mjs signal planner worker handoff "Task spec ready"
```

Claims use normalized file/directory prefixes. `src/` conflicts with `src/backend/`; `src/backend/` and `src/frontend/` do not. Conflicting writers work sequentially or use native Git worktree isolation.

`npm run watchdog` is one-shot, deterministic anomaly detection. It records warnings for stale agents, orphaned owners, incomplete verification, failed/blocked verification, and overlapping claims. Main Codex decides recovery; supervisor is a read-only, on-demand audit role rather than a daemon.

## Workflow

- SMALL: one worker and only proportionate verification.
- MEDIUM: plan, execute, independent verification, then review when it adds value.
- LARGE: add impact analysis, isolated writers/worktrees, integration, and supervisor checkpoints as justified.

Workers may write implementation and tests. Verifiers rerun checks read-only and independently. Reviewers assess correctness, regressions, scope, and evidence; neither verifier nor reviewer edits tests to make a result pass. See `.agents/skills/testing/SKILL.md` for the reusable testing procedure.

## Structure

- `.codex/agents/` and `.codex/config.toml`: agent catalog source of truth.
- `.agents/skills/`: repository Skills, discovered from `SKILL.md` frontmatter.
- `.ai/runtime/`: ignored generated goal/task/event/claim state.
- `scripts/`: dependency-free Node built-in CLI, hook bridge, watchdog, preview, and self-check.
- `preview/`: optional live dashboard and UI proposals.

No package installation is required. Use Node.js 20+, Git, and a Codex version with project agents and hooks. Agent definitions inherit the active Codex model and reasoning level; the repository never hard-codes one.
