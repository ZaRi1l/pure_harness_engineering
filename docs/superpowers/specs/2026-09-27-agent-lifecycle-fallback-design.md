# Agent Lifecycle Fallback Design

Pure Harness keeps lifecycle hooks as the primary deterministic source and adds an explicit orchestration fallback only at real native subagent boundaries. Main records a neutral start immediately after a successful spawn acknowledgement and a neutral stop after the native result returns. A planned delegation never creates runtime data, and a missing return leaves the agent active for stale detection.

Identity is the native agent instance ID. `agent-start` and `agent-stop` reconcile exact IDs, preserve the first start and stop timestamps, and create at most one lifecycle delegate and one lifecycle result signal/event. Lifecycle records retain the observed sources, with `hook` taking canonical precedence over `orchestration`. The runtime never merges records by role, task text, or timing because those are ambiguous for concurrent workers.

Hook handlers record the exact dispatched hook name as structured runtime evidence. Watchdog diagnostics report missing lifecycle dispatch only when orchestration fallback evidence exists in the current runtime and no corresponding SubagentStart/SubagentStop hook evidence has been observed. Absence of SessionStart by itself remains informational because resetting `.ai/runtime` during an open Codex session legitimately removes that history.

No new graph data source is introduced. Active Agents and Agent Signal Network continue to consume stored agent lifecycle records and stored signals. The fallback uses those same records, so static and live previews require no separate renderer changes. Stop remains a neutral lifecycle state and never means task completion, verification success, or reviewer approval.

Observability is best-effort policy: runtime recording failures must not cancel the native agent workflow. Exact-ID reconciliation is intentionally the only deduplication contract; when a host does not expose a stable matching ID to Main and hooks, Pure Harness reports separate records instead of guessing a relationship.
