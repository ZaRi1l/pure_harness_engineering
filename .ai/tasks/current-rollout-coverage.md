# Current rollout tool-output coverage

## Goal
Make current native tool names and text-only tool-output byte coverage accurate without changing token-usage status.

## Requirements
- Recognize only the observed `send_message` and `request_user_input` aliases; unknown names remain `other`.
- Count matched tool calls with measured string or all-text array output separately from calls with missing, malformed, or non-text output.
- Show bilingual measured/unmeasured output counts near byte rankings; never treat unmeasured bytes as zero or retain output bodies.

## Out of Scope
Token accounting, attribution, browser UI interaction, main-branch integration, and new dependencies.

## Affected Area
Rollout parser, telemetry normalizer, preview telemetry panel/translations, and focused tests.

## Constraints
Only validated exact call IDs join outputs. Coverage counters include all parsed threads independently of token status; ranked byte rows retain their existing token-status gate. Older telemetry lacking the counters stays compatible and displays no output-coverage claim.

## Acceptance Criteria
Sanitized fixtures prove recognized aliases, unknown-name fallback, measured/unmeasured call coverage, missing/non-text output honesty, schema validation, and UI wording. Real rollout aggregates numerically without exposing source content.

## Verification
Focused parser/schema/panel tests, `npm test`, `npm run self-check`, `git diff --check`, read-only aggregate of named rollout.

## Risk
Coverage is by matched call ID, not proof that a tool finished successfully; byte statistics cover text output only.
