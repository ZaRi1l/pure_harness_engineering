# Preview Lab tabs and copied-runtime guidance

## Goal

Make Preview Lab practical for reviewing multiple screens while documenting how to start a copied harness with fresh project runtime state.

## Requirements

- Render zero, one, or many registered UI artifacts as accessible tabs with one large selected preview.
- Support distinct route, path, hash, or query-string URLs without changing the existing `label` + `href` registry contract.
- Provide Refresh and Open separately controls.
- Preserve same-origin/localhost eligibility checks and `sandbox="allow-scripts"`; external URLs remain link-only.
- Preserve one-shot static preview, live preview, Task Specs, and dashboard behavior.
- Add easy-to-find PowerShell copy/reset guidance to README and Harness Guide.
- Explain that `npm run init` preserves existing runtime and that `.ai/tasks` and `.ai/memory` must not be deleted indiscriminately.

## Out of Scope

- A new artifact metadata schema or group/app/screen persistence.
- A `reset-runtime` command.
- Dashboard or runtime architecture refactoring.
- Changes to `harness_test_game`.

## Affected Area

- `preview/`, Preview-related tests, `README.md`, and this Task Spec.

## Constraints

- Dependency-free Node.js/browser implementation.
- Existing registry data and runtime schema remain compatible.
- Runtime write claims and unrelated user changes must be preserved.

## Acceptance Criteria

- Empty, single, and multi-artifact states render naturally.
- Tab selection swaps the sole iframe and survives live snapshot polling.
- Refresh reloads the selected safe iframe; Open separately uses a protected new-tab link.
- Unsafe/external artifacts are never embedded.
- Preview height is approximately 70–80vh and uses the main content width.
- Copy guidance includes the requested five-command PowerShell sequence and preservation warnings.

## Verification

- `node tests/preview-artifacts.test.mjs`
- `node tests/preview-server.test.mjs`
- `node tests/status-preview.test.mjs`
- `node tests/task-specs.test.mjs`
- `npm test`
- `npm run self-check`
- `npm run preview`
- Live preview endpoint and asset smoke checks.

## Risk

- The live page has no DOM test dependency, so a small in-repository DOM fixture must exercise user-visible tab behavior without becoming a browser-framework substitute.
