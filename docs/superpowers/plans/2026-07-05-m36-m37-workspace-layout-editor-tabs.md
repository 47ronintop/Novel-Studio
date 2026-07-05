# M36-M37 Workspace Layout and Editor Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add minimal Split View/layout state and runtime closeable editor tabs.

**Architecture:** Application owns safe shell layout commands. Renderer project workflow bridge owns runtime open chapter tabs. UI renders both through existing props and callbacks without direct filesystem access.

**Tech Stack:** TypeScript strict, React, Vitest, Electron IPC bridge.

---

### Task 1: Application Layout State

**Files:**

- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/command-registry.ts`
- Test: `packages/application/test/desktop-application.test.ts`

- [ ] Add failing tests for default `workspaceLayout` and layout commands.
- [ ] Add `WorkspaceLayoutState` to `DesktopShellState`.
- [ ] Add safe command ids for split view and panel width changes.
- [ ] Implement reducer clamping for navigator and inspector widths.
- [ ] Run the focused application test.

### Task 2: Runtime Editor Tabs

**Files:**

- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Test: `apps/desktop/test/project-workflow-bridge.test.ts`

- [ ] Add failing tests for open tab tracking and closing active tab fallback.
- [ ] Add `openChapterTabIds` and `onCloseChapterTab` to `ProjectWorkflowProps`.
- [ ] Track open ids inside the bridge.
- [ ] Close tabs without filesystem access; select a neighbor when closing active tab.
- [ ] Run the focused bridge test.

### Task 3: Shell UI

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/workspace-shell.test.tsx`

- [ ] Add failing tests for split view markup, layout CSS variables, close buttons, and dirty tab marker.
- [ ] Render layout controls using existing command callback.
- [ ] Render only open chapter tabs.
- [ ] Add a close icon button per closeable tab.
- [ ] Add split reference pane and responsive CSS.
- [ ] Run the focused UI test.

### Task 4: Renderer Wiring and Docs

**Files:**

- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/test/command-execution-bridge.test.ts`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [ ] Update renderer fallback shell state with layout defaults.
- [ ] Wire `onCloseChapterTab`.
- [ ] Update command bridge fixture shell states.
- [ ] Mark M36/M37 complete in docs.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run format`, and focused tests.

## Self Review

- The plan covers the accepted M36/M37 spec.
- No task writes directly to project files.
- Layout persistence is runtime shell-state only; disk persistence remains out of scope.
