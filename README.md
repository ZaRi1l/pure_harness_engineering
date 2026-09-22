# Pure Harness v1

Codex-native harness for software, research, writing, planning, and data projects. It keeps SMALL work light, expands MEDIUM/LARGE work by need, records durable knowledge separately from transient state, and exposes deterministic workflow state in a browser.

## Start

Clone this repository as the base for a new project, or copy its tracked files into an existing Git repository. Keep `.codex/`, `.agents/`, `.ai/`, `scripts/`, `preview/`, `tests/`, `AGENTS.md`, and `package.json`; then add the project's own files. No global Skill installation is required.

Initialize runtime state:

```powershell
npm run init
```

Start the dashboard server:

```powershell
npm run preview
```

Open `http://127.0.0.1:8765/`. The server binds to localhost by default. Stop it with `Ctrl+C`.

Project hooks are loaded after the repository is trusted. Review and trust them with `/hooks`; Codex then records session and subagent lifecycle events automatically.

## Runtime commands

```powershell
node scripts/runtime-state.mjs goal "Prepare research synthesis" --phase planning
node scripts/runtime-state.mjs task source-review "Verify primary sources" in_progress --owner researcher
node scripts/runtime-state.mjs verify passed source-check --detail "12 primary sources checked"
node scripts/runtime-state.mjs artifact "Draft report" "/preview/features/report.html"
node scripts/runtime-state.mjs signal planner-1 worker-1 handoff "Task spec ready"
node scripts/route-task.mjs medium
```

The dashboard's Agent Signal Network automatically shows Main-to-agent delegation and agent-to-Main lifecycle return from hooks. A stop event is neutral because Codex does not provide a success outcome in `SubagentStop`; verification and task state carry completion evidence. Record other meaningful handoffs with the `signal` command. Signals contain routing metadata and a short summary, never full prompts, transcripts, or private reasoning.

The complexity argument to `route-task.mjs` is a judgment made by Main Codex or a person. The script only returns the standard role sequence; it does not classify work by file count.

## Structure

- `.codex/`: project config, custom agents, one hook source.
- `.agents/skills/`: portable repository Skills, including `token-efficiency`.
- `.ai/memory/`: curated durable knowledge.
- `.ai/runtime/`: generated state; ignored by Git except `.gitkeep`.
- `.ai/tasks/`: optional MEDIUM/LARGE Task Specs.
- `scripts/`: dependency-free Node runtime CLI, hook bridge, router, preview server, and self-check.
- `preview/`: dashboard and real feature/artifact previews when needed.

## Validate

```powershell
npm test
npm run self-check
```

No npm package installation is required; the scripts use Node built-ins only. Agent configs intentionally inherit the active Codex model and reasoning level so the repository remains portable across accounts and machines.

Requirements are Git, Node.js 20 or newer, and a Codex version that supports project agents and hooks. After cloning on another computer, run `npm run init`, open the repository in Codex, review/trust the project hooks with `/hooks`, and run `npm run self-check`.
