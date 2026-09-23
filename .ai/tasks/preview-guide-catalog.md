# Preview guide catalog

## Goal
Expand the localhost dashboard into a Korean, navigable guide and UI-preview surface for the Pure Harness.

## Requirements
- Keep the existing live runtime dashboard and agent signal network.
- Add a preview-only workspace for proposed dashboard, goal, and discussion screens.
- Add detailed, read-only catalogs for configured agents and repository skills.
- Explain the harness lifecycle and common commands in Korean.

## Out of Scope
- Editing agent TOML files or skill files from the browser.
- Persisting goal edits, discussions, or preview data.
- Adding dependencies, authentication, or a new server API.

## Affected Area
- `preview/index.html`
- Dashboard smoke assertions only if needed to cover the new navigation shell.

## Constraints
- The dashboard remains dependency-free and localhost-only.
- Preview-only controls must state that they do not save or trigger agents.
- Existing runtime endpoints and artifact links must continue to work.

## Acceptance Criteria
- A user can switch among live dashboard, preview lab, agent catalog, skill catalog, and usage guide.
- Each configured agent is represented with its actual responsibility.
- Each repository skill is represented with its actual trigger and purpose.
- The preview lab visually separates proposed UI from live runtime data.

## Verification
- `npm test`
- `npm run self-check`
- Start `npm run preview` and inspect the dashboard in a browser.

## Risk
The single-file UI can become too dense; retain small renderer functions and avoid adding mutable server behavior.
