# M81-M83 Selection Plugin Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selection review controls, plugin trust/permission visibility, and workflow graph layout persistence.

**Architecture:** Keep review state in renderer/UI props, plugin policy projection in Application helpers, and workflow layout as draft JSON saved through the existing Studio Application path. No renderer filesystem calls and no plugin source execution.

**Tech Stack:** TypeScript strict, React, Vitest, Electron renderer bridge contracts.

---

### Task 1: Documentation

**Files:**

- Create: `docs/productization/m81-m83-selection-plugin-workflow-review.md`
- Create: `docs/superpowers/specs/2026-07-06-m81-m83-selection-plugin-workflow-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m81-m83-selection-plugin-workflow.md`

- [x] Write M81-M83 productization record.
- [x] Write M81-M83 design spec.
- [x] Write this implementation plan.

### Task 2: M81 Selection Apply Review UX

**Files:**

- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: related tests.

- [x] Add failing tests for selection review metadata and reject/undo state.
- [x] Implement explicit selection review props in the bridge.
- [x] Render compare, accept, reject, and undo controls without applying automatically.

### Task 3: M82 Plugin Signing and Permission UI

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: related tests.

- [x] Add failing tests for plugin trust/audit projection.
- [x] Map sandbox signing, denied capabilities, and audit readiness into settings props.
- [x] Render trust and permission rows in plugin settings.

### Task 4: M83 Workflow Designer Interaction

**Files:**

- Modify: `packages/application/src/config-studio-session.ts`
- Modify: `apps/desktop/src/renderer/studio-bridge.ts`
- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: related tests.

- [x] Add failing tests for layout edits being persisted into workflow draft JSON.
- [x] Add helper to apply layout to workflow content.
- [x] Add directional graph movement controls and save through the existing Studio path.

### Task 5: Tracking and Verification

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update roadmap/index/changelog/tech debt for M81-M83.
- [x] Run focused tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add selection plugin workflow review`.
