# Pure Harness Preview Guide Catalog Design

## Intent

Extend the existing Pure Harness dashboard into a Korean explanation and design-review surface. The result must help a project owner understand how the harness works, inspect the purpose of each configured agent and repository skill, and review proposed UI before any workflow-changing feature is implemented.

## Scope

The implementation remains a dependency-free, single-page interface in `preview/index.html`. It has five views:

1. **Live Dashboard** retains the current runtime snapshot, task state, verification state, artifact links, and agent signal network.
2. **Preview Lab** shows clearly labelled, non-persistent mock screens for a future dashboard, goal workspace, and discussion log. Buttons and inputs are disabled or explain that they are a design preview.
3. **Agent Catalog** provides a list and detail panel for every configured agent. Details cover responsibility, when to use the role, typical inputs and outputs, and the source configuration path.
4. **Skill Catalog** provides the same read-only treatment for repository skills, including their trigger and what repeatable procedure they provide.
5. **Guide** explains the runtime lifecycle, task routing, hooks, state files, dashboard operation, and common PowerShell commands.

## Data and Rendering

Live Dashboard data continues to come exclusively from `GET /runtime/snapshot`. The new guide, agent, skill, and Preview Lab content is static client-side data derived from the committed project configuration. This keeps the existing server API and runtime schema unchanged.

The top-level navigation switches views without a page load. Detail cards are rendered from compact client-side records rather than manually duplicated markup. The active view and selected catalog entry may be retained in the URL fragment, but no browser action writes runtime state or repository files.

## Safety Boundaries

The UI must label Preview Lab interactions as non-functional. Agent and skill screens are inspection-only: no configuration upload, source editing, or reload mechanism is exposed. Artifact links remain ordinary same-origin links protected by the existing preview server path checks.

## Verification

The existing Node test suite and self-check must pass. A browser review must confirm that navigation works, every view is readable on desktop and narrow screens, the original live dashboard data still refreshes, and Preview Lab cannot be mistaken for a live control surface.
