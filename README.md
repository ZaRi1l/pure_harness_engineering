# Pure Harness v1.1.1

Pure Harness is a thin, Codex-native workflow harness. Main Codex makes orchestration decisions; Skills provide repeatable procedures; specialist agents are used only when an independent context or judgment is worthwhile. Scripts and hooks hold deterministic state and checks.

Node.js is used for lightweight scripts and hooks. A persistent Node server is **not** required for normal harness operation. The server is only needed for the optional live dashboard.

## Start

1. Prepare a separate staged local installation from the tracked neutral engine files; keep the project checkout independent.
2. Declare one project and its management paths, then configure a local binding for the selected checkout.
3. Validate that binding before any stateful command. Open the project checkout in Codex and verify agent, skill, and hook discovery there.
4. Run the engine tests and self-check. Use project commands only with the validated context.

```powershell
npm test
npm run self-check
# For a Node-backed staged installation with a prepared local binding:
node scripts/project-diagnostic.mjs --checkout <checkout-root> --binding <binding-path> --project <project-id>
```

With a validated selected project context, `npm run preview` writes one snapshot to that project's declared runtime path and exits. `npm run preview:live` starts an optional localhost dashboard that refreshes selected-project runtime state every three seconds.

Preview Lab is read-only. It shows Planner Task Specs from the selected project's declared management path and registered UI artifacts. Multiple artifacts appear as tabs with one large selected preview, so route, state, hash, or query-string variants of one app can be reviewed separately. Ask Codex to change a goal or Task Spec; do not edit runtime state through the dashboard.

### Agent Signal Network

Four surfaces answer different questions: **Active Agents** shows current runners; **Agent Signal Network** shows recorded relationships and workflow; **Signal Timeline** shows the latest ten stored signals, newest first; **Preview Lab** shows result UI and registered artifacts. On the live Dashboard, select an agent or signal for details. Use Live/History, All/Active/Failures/Current Task filters, task selection, drag to pan, wheel or buttons to zoom, and Fit/Reset to navigate the network. Failure and retry signals have distinct styling. The graph uses actual recorded signals only; it does not infer a handoff from task ownership, claims, or timing. If there are no recorded signals, there are no inferred edges.

```powershell
# Real project runtime; open the URL printed by the server
npm run preview:live

# Isolated deterministic network demo; open its printed URL
npm run demo:network

# After stopping the demo server
npm run demo:reset
```

The demo reads fixture data from `.ai/demo/network-runtime`, never `.ai/runtime`. `npm run demo:reset` removes exactly `.ai/demo/network-runtime`; it does not clear real runtime state. In the demo Dashboard, select a node and edge, switch Live/History, try task and failure filters, and inspect Active Agents and Signal Timeline. `npm run preview` writes a static HTML snapshot with an interactive network labeled **Snapshot History** and snapshot-based filters; the saved file does not poll or update after generation. The live dashboard refreshes every three seconds while its server runs.

### Staged Local Installation

Start from a clean neutral engine export in a separate staged local installation, not from a copy of an existing project's runtime. Declare the selected project's Task Spec, memory, and runtime management paths in its project manifest; keep local checkout/binding paths in ignored local configuration. The engine export excludes its own development Task Specs and memory. In a portable/no-Node workflow, use the declared management paths without assuming a source-checkout `.ai/` location.

Preserve existing project runtime, Task Specs, memory, claims, and open sessions. Do not reset or migrate them during installation. Inventory and review any later migration separately, with quiescence, backup, validation, and rollback evidence. If there is no validated selected project context, stop before stateful commands rather than guessing a default project. In a Node-backed staging setup, use `scripts/project-diagnostic.mjs` with explicit checkout, binding, and project arguments to check the binding; then run `npm test` and `npm run self-check` from the staged engine and verify native discovery in a fresh selected-project session.

## Runtime

Hooks automatically record session and subagent lifecycle metadata and remain the primary deterministic source. Hook configuration being installed does not prove that the current host dispatched it: `npm run self-check` reports dispatch as **observed**, **not yet observed**, or **suspected unavailable**. A suspected-unavailable warning requires positive orchestration fallback evidence with no corresponding subagent hook evidence; missing `SessionStart` alone is not enough. `npm run watchdog` stores the same evidence-based fallback warning for the Dashboard.

Main also uses a thin fallback only around an actual native subagent call. After a successful spawn acknowledgement it records the exact native agent instance ID with `--source orchestration`; after the native result returns it records a neutral stop and releases the claim. A planned delegation creates no fallback record, and an interrupted agent with no return stays active until stale detection warns about it. Hook and fallback writes reconcile by exact ID, with hook provenance taking precedence. Pure Harness never guesses that differently named records are the same agent.

A subagent stop is neutral, not success: task state plus verification evidence determine completion.

```powershell
node scripts/runtime-state.mjs goal "Implement connector" --phase execution
node scripts/runtime-state.mjs task implementation "Implement connector" in_progress --owner worker-1
node scripts/runtime-state.mjs claim worker-1 src/backend/
node scripts/runtime-state.mjs verify passed unit-tests --detail "npm test"
node scripts/runtime-state.mjs release-claim worker-1
node scripts/runtime-state.mjs signal planner worker handoff "Task spec ready"

# Main orchestration fallback examples; use only at actual native boundaries
node scripts/runtime-state.mjs agent-start <native-agent-id> worker --task "Implement connector" --task-id implementation --source orchestration
node scripts/runtime-state.mjs agent-stop <native-agent-id> --outcome stopped --task-id implementation --source orchestration
node scripts/runtime-state.mjs release-claim <native-agent-id>
```

Claims use normalized file/directory prefixes. `src/` conflicts with `src/backend/`; `src/backend/` and `src/frontend/` do not. Conflicting writers work sequentially or use native Git worktree isolation.

`npm run watchdog` is one-shot, deterministic anomaly detection. It records warnings for stale agents, orphaned owners, incomplete verification, failed/blocked verification, and overlapping claims. Main Codex decides recovery; supervisor is a read-only, on-demand audit role rather than a daemon.

## Workflow

- SMALL: one worker and only proportionate verification.
- MEDIUM: plan, execute, independent verification, then review when it adds value.
- LARGE: add impact analysis, isolated writers/worktrees, integration, and supervisor checkpoints as justified.

Workers may write implementation and tests. Verifiers rerun checks read-only and independently. Reviewers assess correctness, regressions, scope, and evidence; neither verifier nor reviewer edits tests to make a result pass. See `.agents/skills/testing/SKILL.md` for the reusable testing procedure.

## Model policy

Main Codex remains user-selected/inherited. Subagent defaults are configured in `.codex/config.toml` and role overrides in `.codex/agents/*.toml` are the source of truth:

- Planner, reviewer, supervisor, integrator, security, and performance: Sol / High.
- Worker and impact analysis: Sol / Medium.
- Verifier, researcher, environment, and release work: Luna / Medium.
- Context curation and preview work: Luna / Low.

The Main Codex model and reasoning level remain user-selected/inherited. Subagents use the explicit role-specific model and reasoning defaults defined in `.codex/config.toml` and `.codex/agents/`.

The policy is an optimization, not a harness requirement. A spawn-time override may raise a single difficult task when supported, but use the cheapest reliable model/effort by default. Astra is manual exceptional escalation only; it is never a default. Model entitlement is not validated by repository self-check.

### Model compatibility fallback

The validated v1.1.1 configuration uses explicit role-specific GPT-6 Sol/Luna defaults. When a supported native spawn-time override reports that the preferred GPT-6 model is unavailable, disabled, unsupported, not permitted, or not exposed by the workspace, Main may retry the same role once with the matching GPT-5.6 Sol/Luna model and the same reasoning effort. Ordinary implementation, test, tool, timeout, and task failures never trigger this route. The reusable procedure is `.agents/skills/model-routing/SKILL.md`.

Pure Harness does not run a daemon or script that intercepts Codex-native spawn errors. If the configured role models are unavailable, you may still manually remove affected model overrides and inherit the active Main Codex model. That portable compatibility fallback is outside strict model-policy validation, so self-check may fail until the standard role configuration is restored.

## Structure

- `.codex/agents/` and `.codex/config.toml`: agent catalog source of truth.
- `.agents/skills/`: repository Skills, discovered from `SKILL.md` frontmatter.
- `projects/`: neutral project schema/example; each selected project's declared installation runtime path owns generated state.
- `scripts/`: dependency-free Node built-in CLI, hook bridge, watchdog, preview, and self-check.
- `preview/`: optional live dashboard and UI proposals.

No package installation is required. Use Node.js 20+, Git, and a Codex version with project agents and hooks.
