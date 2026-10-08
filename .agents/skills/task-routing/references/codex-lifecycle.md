# Codex lifecycle recording

Apply this reference only when the active Codex runtime supplies native agent tools, exact IDs, and a project-declared runtime entrypoint with lifecycle commands. Hooks are the primary lifecycle source; orchestration records are best effort and must not block work when observability fails.

After a successful native spawn acknowledgement, record `agent-start` with the exact native instance ID and `--source orchestration`; do not record a merely planned delegation. When that result returns, record a neutral `agent-stop --outcome stopped --source orchestration` and release its claim. Hook records for the same ID take precedence. Never infer completion or merge agents by role, task text, or timing.

Record the prior turn's neutral stop before sending `followup_task`. After a successful acknowledgement for that stopped agent, create and retain one unique turn token for the follow-up, including retries. Record `agent-resume <same-id> --task <short-title> --summary <explicit-summary> --task-id <task-id> --turn-token <token> --source orchestration`, then record the new turn's neutral `agent-stop` with the same token only when its result returns. A task ID does not identify a turn; a hook without proof of the current turn token cannot close a resumed turn.

If acknowledgement lacks an ID, obtain the child's exact `CODEX_THREAD_ID` and verify an existing lifecycle record for that ID before recording resume. Never synthesize an ID from role, name, timing, or task text. If the prior stop was omitted and the next turn may be active, do not issue a retroactive unguarded stop. Keep the explicit summary under 200 characters and omit prompt bodies.
