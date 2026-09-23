# Pure Harness v1.1 Design

## Intent

Pure Harness remains a thin Codex-native harness. Node runs short-lived CLI and hook commands for normal operation; the HTTP server is retained only for preview:live.

## Runtime

RuntimeStore owns status, tasks, events, and a new claims.json. Claims use normalized repository-relative file or directory prefixes. A claim overlaps when either normalized prefix contains the other; unrelated siblings do not conflict. The snapshot exposes claims and derived watchdog warnings without prompts or private reasoning.

watchdog.mjs is a one-shot detector. It checks stale active agents, unknown task owners, completed work without passed verification, failed or blocked verification, overlapping claims, and basic runtime consistency. It records warnings/events only; Main Codex decides whether to invoke supervisor.

## Interfaces

status.mjs renders a concise text view from one snapshot and supports --json. generate-preview.mjs writes a standalone HTML snapshot to the ignored runtime directory and prints its path. preview:live continues to serve preview/index.html on localhost and polls the same snapshot endpoint.

Agents are discovered from .codex/config.toml plus agent TOML files; skills are discovered from .agents/skills/SKILL.md directories. Shared discovery helpers eliminate manual catalog arrays in self-check and the preview.

## Safety

No daemon, dependency, model configuration, autonomous repair, filesystem UI edit, or full transcript storage is added. Existing lock, atomic write, hook, and traversal protections are preserved.
