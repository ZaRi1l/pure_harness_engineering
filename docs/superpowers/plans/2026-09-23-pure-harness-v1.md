# Pure Harness v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a dependency-free, Codex-native Pure AI Agent Harness v1 with routing, durable memory, deterministic runtime state, lifecycle hooks, project profiles, and a live dashboard.

**Architecture:** Codex configuration selects narrowly instructed custom agents. Dependency-free Node.js scripts atomically maintain generated runtime JSON and serve a static dashboard, while Markdown profiles and skills hold reusable procedures and durable knowledge.

**Tech Stack:** Codex CLI configuration, TOML, JSON, Node.js built-ins, HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-23-pure-harness-v1-design.md`

## Global Constraints

- Do not install dependencies or hardcode a model.
- Preserve existing repository content and user changes.
- Keep generated runtime state out of version control.
- Use one hook representation per config layer.
- Keep SMALL work to one worker by default.

## Review Focus

- Concurrent hook writes must not corrupt JSON.
- Malformed hook input must fail safely without blocking Codex.
- Dashboard paths must not expose arbitrary workspace files.
- Missing runtime files must produce a usable initialized state.
- Unknown task or verification states must be rejected.

---

### Task 1: Deterministic runtime core

**Files:** Create `tests/runtime-state.test.mjs`, `scripts/runtime-state.mjs`, and `.ai/schemas/*.json`.

**Interfaces:** Produces `RuntimeStore`, its CLI, and the three runtime files consumed by hooks and preview.

- [ ] Write behavior tests for initialization, task transitions, verification, event retention, and malformed input.
- [ ] Run the tests and confirm they fail because the module is absent.
- [ ] Implement the smallest atomic runtime store and CLI that passes.
- [ ] Run the runtime tests and the full suite.

### Task 2: Hooks, profiles, agents, and skills

**Files:** Create `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/*.toml`, `.agents/skills/*`, and `.ai/memory/*`.

**Interfaces:** Hooks call `scripts/hook-runtime.mjs`; routing guidance consumes Skill references and custom-agent descriptions.

- [ ] Add a failing structural self-check test for Codex files and routing fixtures.
- [ ] Run it and confirm required files are missing.
- [ ] Add concise native configuration, roles, profiles, memory templates, and hook bridge.
- [ ] Run structural and runtime tests.

### Task 3: Dashboard and self-check

**Files:** Create `preview/index.html`, `scripts/preview-server.mjs`, `scripts/self-check.mjs`, tests, and usage documentation.

**Interfaces:** The server exposes `/runtime/status`, `/runtime/tasks`, and `/runtime/events`; the dashboard renders those endpoints.

- [ ] Add failing HTTP behavior tests for runtime endpoints, static assets, and traversal rejection.
- [ ] Run them and confirm the server module is absent.
- [ ] Implement the localhost server, dashboard, and end-to-end self-check.
- [ ] Run all tests and the self-check.

### Task 4: Portable token-efficiency skill and final validation

**Files:** Create `.agents/skills/token-efficiency/SKILL.md`, `.gitignore`, and `README.md`.

**Interfaces:** Codex discovers the repository skill on every computer where the project is cloned.

- [ ] Validate the skill frontmatter and concise handoff contract.
- [ ] Keep the skill repository-local and avoid user-home changes.
- [ ] Run strict Codex config parsing, tests, self-check, and a dashboard smoke test.
