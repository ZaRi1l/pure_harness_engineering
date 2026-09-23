# Role model policy v1.1.1

## Goal

Apply cost-aware model and reasoning defaults to existing subagent roles without changing v1.1 orchestration.

## Requirements

- Keep Main model inherited.
- Use Luna/medium as the generic subagent policy.
- Add supported model and reasoning overrides to existing role TOMLs.
- Show role policy and current source in read-only catalogs.

## Out of scope

New agents, model routing, automatic escalation, runtime/watchdog redesign, and model entitlement probing.

## Acceptance criteria

- Strict Codex config validation accepts the policy.
- All discovered agents use Sol or Luna with low, medium, or high effort.
- No Astra, xhigh, or max default exists.
- Tests and self-check pass, with entitlement reported as unverified.

## Verification

`npm test`, `npm run self-check`, `npm run status`, and `codex --strict-config doctor --json`.
