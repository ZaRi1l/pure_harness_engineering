---
name: model-routing
description: Use when spawning a configured subagent requires a model-availability fallback.
---

# Model routing

Apply the GPT-6 Sol/Luna to GPT-5.6 route below only when the role or target explicitly configures a Codex model policy. For Claude, OpenCode, and Antigravity `inherit`, defer to target-native model availability; do not invent a model override or fallback.

Use the role's configured GPT-6 Sol or Luna model first. When native spawn-time model override is available, preserve the role, task, sandbox, and reasoning effort.

Retry exactly once with the corresponding GPT-5.6 model only when the first spawn fails specifically because the model is unavailable, disabled, unsupported, not permitted, or not exposed by the current workspace/account. Do not retry for tool, test, implementation, permission, timeout, or task failures.

Keep any GPT-6-unavailable observation only in the current Main context; do not store it in durable memory or runtime state. Do not include Astra in this route.
