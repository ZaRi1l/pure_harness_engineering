# Preview Guide Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Pure Harness preview into a Korean live dashboard, UI-preview lab, and read-only agent and skill guide.

**Architecture:** Keep the server and runtime schema unchanged. Rework `preview/index.html` as a dependency-free client-side view router: the Dashboard view reads the existing snapshot, while Preview Lab, Agent Catalog, Skill Catalog, and Guide render compact static records derived from repository configuration. Update the preview-manager role narrowly so it owns this UI surface without gaining authority to alter runtime state or configuration from the browser.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-23-preview-guide-catalog-design.md`

## Global Constraints

- Do not add dependencies, server endpoints, browser-to-file writes, or runtime-schema fields.
- Live runtime information comes only from `/runtime/snapshot`.
- Preview Lab controls must visibly state that they are non-persistent UI mockups.
- Agent and skill screens are read-only and accurately reflect the committed configuration.
- Preserve artifact-link behavior and preview server traversal protection.

## Review Focus

- The active navigation view must never prevent the live dashboard from refreshing when it is selected again.
- Preview controls must not imply that a goal, discussion, agent, or skill change has been saved.
- All fourteen configured agents and five repository skills must be represented once, with no invented roles.
- The signal-network selection behavior must continue to work after the dashboard is moved into a routed view.
- Narrow screens must keep navigation and catalog detail readable without horizontal overflow.

### Task 1: Establish the dashboard navigation contract

**Files:**
- Modify: `tests/preview-server.test.mjs:10-27`
- Modify: `preview/index.html`

**Interfaces:**
- Consumes: `GET /runtime/snapshot` with `{ status, tasks, events }`.
- Produces: A static page whose navigation includes `Live Dashboard`, `Preview Lab`, `Agent Catalog`, `Skill Catalog`, and `Guide`.

- [ ] **Step 1: Write the failing navigation-contract test**

  Add the assertions after the existing `Agent Signal Network` assertion:

  ```js
  assert.match(html, /Preview Lab/);
  assert.match(html, /Agent Catalog/);
  assert.match(html, /Skill Catalog/);
  assert.match(html, /Harness Guide/);
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `node --test tests/preview-server.test.mjs`

  Expected: FAIL because the served HTML lacks `Preview Lab`.

- [ ] **Step 3: Implement the navigation shell and preserve the live renderer**

  Replace the single-grid body in `preview/index.html` with a responsive sidebar or top navigation and a main content region. Add a hash-based `renderView()` router. Move the current snapshot cards, network renderer, `refresh()` logic, and three-second refresh interval into a `renderDashboard(snapshot)` path; keep `renderNetwork(status)` and `showAgent(agent, status)` behavior intact. Mark the Dashboard item `Live Dashboard` and keep its data source label explicit.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `node --test tests/preview-server.test.mjs`

  Expected: PASS.

- [ ] **Step 5: Commit the navigation contract**

  ```bash
  git add preview/index.html tests/preview-server.test.mjs
  git commit -m "feat: add Pure Harness preview navigation"
  ```

### Task 2: Add Preview Lab and Korean harness guide

**Files:**
- Modify: `preview/index.html`
- Test: `tests/preview-server.test.mjs`

**Interfaces:**
- Consumes: client-side static preview records only.
- Produces: `renderPreviewLab()` and `renderGuide()` renderers selected by the navigation router.

- [ ] **Step 1: Extend the navigation-contract test with safety labels**

  Add assertions that the served document contains the following exact labels:

  ```js
  assert.match(html, /UI Preview Only/);
  assert.match(html, /Changes are not saved/);
  assert.match(html, /SMALL/);
  assert.match(html, /MEDIUM/);
  assert.match(html, /LARGE/);
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `node --test tests/preview-server.test.mjs`

  Expected: FAIL because Preview Lab labels are absent.

- [ ] **Step 3: Implement static Preview Lab and guide content**

  Add `renderPreviewLab()` with three labelled mock panels: a dashboard summary, a goal-edit form, and a decision/discussion log. Make all form controls disabled and show the text `UI Preview Only` and `Changes are not saved` beside them. Add `renderGuide()` in Korean, covering initialization, hooks, SMALL/MEDIUM/LARGE routing, runtime state, the localhost dashboard, and the existing `npm run init`, `npm run preview`, `npm test`, and `npm run self-check` commands.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `node --test tests/preview-server.test.mjs`

  Expected: PASS.

- [ ] **Step 5: Commit the Preview Lab and guide**

  ```bash
  git add preview/index.html tests/preview-server.test.mjs
  git commit -m "feat: add harness UI preview and guide"
  ```

### Task 3: Add read-only agent and skill catalogs

**Files:**
- Modify: `preview/index.html`
- Modify: `tests/preview-server.test.mjs`
- Modify: `.codex/agents/preview-manager.toml`

**Interfaces:**
- Consumes: static records matching `.codex/config.toml` and repository `SKILL.md` frontmatter.
- Produces: `renderAgentCatalog()` and `renderSkillCatalog()` with selectable detail panels.

- [ ] **Step 1: Add failing catalog coverage**

  Add the following assertions to the first preview-server test:

  ```js
  assert.match(html, /preview-manager/);
  assert.match(html, /task-routing/);
  assert.match(html, /Read only catalog/);
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `node --test tests/preview-server.test.mjs`

  Expected: FAIL because the page does not yet contain catalog records.

- [ ] **Step 3: Implement catalog records and detail rendering**

  Create compact client-side records for every configured agent: `planner`, `worker`, `reviewer`, `supervisor`, `context-curator`, `preview-manager`, `verifier`, `impact-analyzer`, `integrator`, `environment-doctor`, `researcher`, `security-auditor`, `performance-analyzer`, and `release-manager`. For each, render responsibility, appropriate trigger, expected deliverable, limits, and its `.codex/agents/<name>.toml` source path.

  Create records for `task-routing`, `task-spec`, `failure-recovery`, `context-curation`, and `token-efficiency`. Render each skill's trigger, practical use, source path, and whether it affects planning, execution, verification, or durable memory.

  Add the shared `Read only catalog` notice, list/detail selection controls, keyboard-accessible buttons, and no form submission or mutation calls.

- [ ] **Step 4: Narrowly update preview-manager ownership**

  Update `.codex/agents/preview-manager.toml` so its instructions permit maintaining static Preview Lab mockups, guide content, and read-only catalog presentation. Retain the prohibition against inventing runtime state, editing routine status manually, or changing agent/skill configuration through the dashboard.

- [ ] **Step 5: Run focused verification**

  Run: `node --test tests/preview-server.test.mjs`

  Expected: PASS.

- [ ] **Step 6: Commit the catalog and ownership update**

  ```bash
  git add preview/index.html tests/preview-server.test.mjs .codex/agents/preview-manager.toml
  git commit -m "feat: document harness agents and skills in preview"
  ```

### Task 4: Verify the finished dashboard in browser and repository checks

**Files:**
- Verify: `preview/index.html`
- Verify: `tests/preview-server.test.mjs`

**Interfaces:**
- Consumes: the final static page and existing preview server.
- Produces: evidence that the UI is served safely and readable.

- [ ] **Step 1: Run the complete automated suite**

  Run: `npm test`

  Expected: PASS with all Node tests succeeding.

- [ ] **Step 2: Run the project structural check**

  Run: `npm run self-check`

  Expected: PASS, or only the documented sandbox warning for unavailable `codex.exe`.

- [ ] **Step 3: Run the preview server and inspect each view**

  Run: `npm run preview`

  Expected: the server reports `http://127.0.0.1:8765/`; inspect Live Dashboard, Preview Lab, Agent Catalog, Skill Catalog, and Guide at desktop and narrow widths. Confirm Preview Lab controls cannot save data and the Agent Signal Network still responds to node selection.

- [ ] **Step 4: Commit verification-only changes if any are required**

  ```bash
  git status --short
  ```

  Expected: only intentionally modified files are present; do not commit unrelated user changes.

## Self Review

- **Spec coverage:** Tasks 1 through 3 cover all five views, static catalog data, safety labels, and preview-manager ownership. Task 4 covers automated and visual verification.
- **Placeholder scan:** No TODO, TBD, or unspecified implementation steps remain.
- **Type consistency:** Every view is selected by `renderView()`; only `renderDashboard(snapshot)` accepts runtime data.
- **Review focus:** Task 1 preserves dashboard refresh and agent-network behavior; Task 2 enforces non-persistent preview labels; Task 3 fixes the full catalog population and read-only boundary; Task 4 checks responsive layout and server behavior.
