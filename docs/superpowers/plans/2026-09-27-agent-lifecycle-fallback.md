# Agent Lifecycle Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve hook-first lifecycle tracking while adding an explicit, idempotent Main orchestration fallback and evidence-based diagnostics.

**Architecture:** Extend the existing lifecycle API with minimal source metadata and exact-ID reconciliation. Hooks and Main write through the same runtime methods; watchdog and self-check consume structured dispatch evidence without inventing lifecycle events.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON runtime files, existing dashboard renderer.

**Spec:** `docs/superpowers/specs/2026-09-27-agent-lifecycle-fallback-design.md`

## Global Constraints

- Hooks remain the primary lifecycle source; orchestration is fallback only.
- Only actual native spawn/result boundaries may create fallback lifecycle records.
- Never infer success, relationships, SessionStart, or process state.
- No new dependency, wrapper, daemon, database, message bus, or polling.
- Exact native agent instance ID is the deduplication key.
- Runtime writes are best-effort and must not block agent execution.

## Review Focus

- Repeated and reversed-order hook/fallback writes must not duplicate signals or events.
- A stop for an unknown agent must not fabricate a successful agent history.
- Missing SessionStart alone must not trigger an unavailable-hook warning.
- Old schema-version-1 snapshots without diagnostics metadata must remain readable.
- Claim release must remain scoped to deterministic hook stop behavior.

---

### Task 1: Idempotent lifecycle runtime

**Files:**
- Modify: `tests/runtime-state.test.mjs`
- Modify: `scripts/runtime-state.mjs`

**Interfaces:**
- Produces: `agentStarted(id, role, task, { task_id, source })` and `agentStopped(id, outcome, { task_id, source })` with exact-ID reconciliation.

- [ ] Add failing tests for repeated start, repeated stop, reversed hook/fallback order, unknown stop, CLI metadata, and concurrent agents.
- [ ] Run the runtime-state tests and confirm failures are caused by duplicate lifecycle writes/missing provenance.
- [ ] Implement additive source metadata, hook precedence, stable timestamps, and one lifecycle signal/event per phase.
- [ ] Run the runtime-state tests and the full suite.

### Task 2: Hook evidence and diagnostics

**Files:**
- Modify: `tests/hook-runtime.test.mjs`
- Modify: `tests/watchdog.test.mjs`
- Modify: `tests/self-check.test.mjs`
- Modify: `scripts/hook-runtime.mjs`
- Modify: `scripts/watchdog.mjs`
- Modify: `scripts/self-check.mjs`

**Interfaces:**
- Consumes: Task 1 lifecycle source metadata.
- Produces: exact hook dispatch events and evidence-based watchdog/self-check messages.

- [ ] Add failing tests for hook-plus-fallback deduplication, fallback-only warning, interrupted stale fallback, and reset-without-SessionStart.
- [ ] Run targeted tests and confirm the expected diagnostic failures.
- [ ] Record exact hook dispatch evidence and add watchdog/self-check diagnostics that require positive fallback evidence.
- [ ] Run targeted tests and the full suite.

### Task 3: Orchestration policy and user guidance

**Files:**
- Modify: `AGENTS.md`
- Modify: `.agents/skills/task-routing/SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: lifecycle CLI `--source orchestration` and exact-ID contract.

- [ ] Document the actual-spawn-only, best-effort fallback sequence in the central policy and routing skill.
- [ ] Document that resetting runtime during an open session can remove SessionStart evidence without implying harness failure.
- [ ] Confirm existing guide command coverage and keep instructions free of inferred success semantics.

### Task 4: Full regression and independent review

**Files:**
- Verify only; fix only findings covered by a failing regression test.

- [ ] Run `npm test` and `npm run self-check`.
- [ ] Run static preview, live preview, and isolated network demo smoke checks.
- [ ] Confirm real `.ai/runtime` is not modified by the demo.
- [ ] Obtain independent verifier and reviewer evidence; address material findings.
