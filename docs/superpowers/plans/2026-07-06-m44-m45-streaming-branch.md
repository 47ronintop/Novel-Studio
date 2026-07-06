# M44/M45 Streaming UX and Workflow Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete deterministic streaming UX contract support and Workflow Engine branch actions without adding real provider calls to CI.

**Architecture:** LLM streaming stays behind LLM Adapter and provider transports. UI receives explicit streaming props from renderer bridges. Workflow branch behavior is pure engine state transition logic and does not call Agent, Context, Repository, or UI layers.

**Tech Stack:** TypeScript strict, Vitest, React static rendering tests, JSON Schema, existing docs.

---

### Task 1: OpenAI-Compatible Streaming Contract

**Files:**

- Modify: `packages/llm-adapter/src/openai-compatible-provider.ts`
- Modify: `packages/llm-adapter/test/openai-compatible-provider.test.ts`

- [x] Write a failing test that maps streaming requests to `stream: true` and emits parsed delta/usage events.
- [x] Write a failing test that normalizes malformed streaming chunks.
- [x] Add optional streaming transport support and chunk parsing.
- [x] Run `npm run test -- packages/llm-adapter/test/openai-compatible-provider.test.ts`.

### Task 2: AI Streaming UX Props and Bridge State

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/test/ai-writing-workflow.test.tsx`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`

- [x] Write failing UI and bridge tests for streaming preview and cancel state.
- [x] Add `streaming` / `cancelled` statuses, preview text, and cancel handler props.
- [x] Render streaming preview and cancel command in the AI workflow panel.
- [x] Add bridge helpers for beginning, appending, and cancelling a stream preview.
- [x] Run `npm run test -- packages/ui/test/ai-writing-workflow.test.tsx apps/desktop/test/ai-writing-workflow-bridge.test.ts`.

### Task 3: Workflow Branch Engine

**Files:**

- Modify: `packages/workflow-engine/src/types.ts`
- Modify: `packages/workflow-engine/src/workflow-engine.ts`
- Modify: `packages/workflow-engine/src/index.ts`
- Modify: `packages/workflow-engine/test/workflow-engine.test.ts`
- Modify: `packages/schemas/schema/workflow-definition.schema.json`
- Modify: `fixtures/schemas/valid/workflow-definition.json`

- [x] Write failing engine tests for branch action evaluation, branch selection, and invalid branch targets.
- [x] Add branch metadata types and parser validation.
- [x] Add `choose-branch` action and `chooseWorkflowBranch()` transition.
- [x] Update workflow definition schema and fixture.
- [x] Run `npm run test -- packages/workflow-engine/test/workflow-engine.test.ts packages/schemas/test/schema-contract.test.ts`.

### Task 4: Docs, Gates, and Commit

**Files:**

- Create: `docs/productization/m44-streaming-ux.md`
- Create: `docs/productization/m45-workflow-branch.md`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/productization/m35-constitution-gap-audit.md`
- Modify: `docs/superpowers/plans/2026-07-06-m44-m45-streaming-branch.md`

- [x] Mark M44 and M45 complete in productization docs and roadmap.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run test:e2e`.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add streaming ux and workflow branching`.
