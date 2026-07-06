# M68-M69 Sandbox Policy Workflow Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add denied-by-default plugin sandbox policy DTOs plus Workflow Studio node selection and save validation gating.

**Architecture:** M68 is an Application-layer policy report with no plugin execution. M69 is renderer/UI state and callback plumbing that keeps workflow persistence on the existing config asset save path.

**Tech Stack:** TypeScript strict, React server-render UI tests, Vitest, Prettier.

---

### Task 1: Documentation Baseline

**Files:**

- Create: `docs/productization/m68-m69-sandbox-policy-workflow-selection.md`
- Create: `docs/superpowers/specs/2026-07-06-m68-m69-sandbox-policy-workflow-selection-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m68-m69-sandbox-policy-workflow-selection.md`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [x] Record M68/M69 scope and non-goals.
- [x] Update roadmap/index/changelog/tech debt after implementation passes.

### Task 2: Plugin Sandbox Policy DTOs

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`

- [x] Write failing tests for denied-by-default sandbox policy decisions.
- [x] Implement `PluginSandboxPolicyInput`, `PluginSandboxPolicyDecision`, and `createPluginSandboxPolicyReport()`.
- [x] Verify policy tests pass without executing adapter code.

### Task 3: Workflow Node Selection and Save Gate

**Files:**

- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/src/renderer/studio-bridge.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/test/studio-bridge.test.ts`

- [x] Write failing UI tests for selectable graph nodes and selected inspector target.
- [x] Add `selectedWorkflowNodeId` and `onWorkflowNodeSelect` props.
- [x] Write failing Studio bridge tests for selected node state and invalid graph save blocking.
- [x] Implement `StudioBridge.selectWorkflowNode()` and save validation gate.
- [x] Wire App handler to Studio bridge.

### Task 4: Verification and Commit

**Files:**

- All touched files.

- [x] Run focused tests for plugin runtime, studio bridge, and Studio UI.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add sandbox policy workflow selection`.
