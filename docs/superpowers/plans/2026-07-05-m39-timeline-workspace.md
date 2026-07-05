# M39 Timeline Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Story Bible timeline asset details as an event-level Timeline workspace.

**Architecture:** Renderer bridge parses structured timeline events from the existing Story Bible snapshot. UI receives typed timeline event props through `StoryBibleEditorEntry` and renders a dense event rail. Repository and Application data contracts remain unchanged.

**Tech Stack:** TypeScript strict, React, Vitest, existing Story Bible bridge and WorkspaceShell.

---

### Task 1: Renderer Mapping

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `apps/desktop/src/renderer/story-bible-bridge.ts`
- Test: `apps/desktop/test/story-bible-bridge.test.ts`

- [x] Add a failing test for parsing `timeline.details.events`.
- [x] Add `StoryTimelineEvent` to UI entry props.
- [x] Map event details into typed timeline event props.

### Task 2: Timeline UI

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/workspace-shell.test.tsx`

- [x] Add a failing UI test for event-level timeline rendering.
- [x] Render metrics and ordered event rail.
- [x] Keep edit callback wired to the parent timeline asset id.

### Task 3: Documentation and Gates

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update M39 docs and roadmap state.
- [x] Run full verification gates.
