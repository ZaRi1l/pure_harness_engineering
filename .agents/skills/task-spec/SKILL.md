---
name: task-spec
description: Use when MEDIUM/LARGE work has meaningful ambiguity or coordination needs; skip for clear SMALL changes.
---

Use the selected project's declared Task Spec directory (`context.paths.tasks` when a validated Node context is available; the declared management path in a portable/no-Node workflow). If no project or Task Spec path is declared, resolve it before writing; do not assume a source-checkout directory. Write `<task-spec-directory>/<task-id>.md` with: Goal, Requirements, Out of Scope, Affected Area, Constraints, Acceptance Criteria, Verification, and Risk. Use observable criteria and exact commands when known. Keep it short enough for every assigned agent to read.
