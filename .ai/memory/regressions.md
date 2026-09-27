# Regressions

Record only failures that actually occurred and need a durable prevention rule. Include symptom, cause, fix, and verification.

- 2026-09-27 / v1.1.1: A host reported lifecycle hooks as installed/active but dispatched no SessionStart or SubagentStart/Stop events, leaving Active Agents and Agent Signal Network empty during real delegation. Hooks remain primary, but Main now records best-effort orchestration lifecycle only at successful native spawn/result boundaries using the exact native instance ID. Runtime writes reconcile idempotently with hook precedence; unknown/interrupted agents are never promoted to success, and watchdog warns only from positive fallback evidence. Covered by hook-only, fallback-only, duplicate, stale, reset, capped-history, controlled-clock, and legacy id-less signal regressions (`npm test` 87/87).
