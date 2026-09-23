---
name: testing
description: Use when a worker, verifier, or reviewer needs to plan, run, or assess deterministic verification.
---

# Testing

- Test observable changed behavior; prefer the repository's existing test style.
- For a bug fix, add regression coverage when it is practical.
- Run narrow tests first, then the relevant module or package, then broader checks.
- Workers may write and run tests, but their result is not final completion evidence.
- Verifiers independently rerun commands and never edit implementation or tests.
- Reviewers assess correctness, weak or missing tests, edge cases, unsupported claims, and scope drift; they do not author the tests.
- Do not add meaningless tests for trivial changes.
- Report actual commands and outcomes. Never report a failed check as passed.
