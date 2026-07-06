# Product Ready Remaining Work Implementation Plan

> **Status:** Candidate gap inventory only. This plan was scope-reviewed after creation and must not be executed as a fixed M92-M100 route. Use `ROADMAP.md` as the source of truth; items here require v1 ship relevance or explicit v2/backlog approval before implementation.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current M91 beta productization state into a bounded M92-M100 Product Ready route, with each remaining gap mapped to a milestone, file area, tests, and completion evidence.

**Architecture:** Keep the existing P8 layering: renderer/UI remains callback-driven, Application owns product workflows, Repository owns project-file persistence, engines stay deterministic, and providers/plugins stay behind adapters. M92-M94 close the three largest Product Gaps; M95-M100 close data safety, provider/runtime, release, quality, and final readiness gaps.

**Tech Stack:** TypeScript strict, Electron, React, Vite, Vitest, Playwright, JSON Schema, local project files, existing npm scripts.

---

## Milestone Queue

| Milestone | Name                                          | Primary Gap                    | Done When                                                                                                                                  |
| --------- | --------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| M92       | Plugin Runtime Repository Persistence         | TD-035                         | Trust store and plugin audit records persist through Repository and Settings has a trust operation loop.                                   |
| M93       | Workflow Designer Completion Gate             | TD-034                         | Complex workflow graph editing has robust form state, delete confirmation, validation, and E2E coverage.                                   |
| M94       | Editor Runtime Rollout UX                     | TD-033                         | CodeMirror is user opt-in, rollback is visible, inline diff review is real, and benchmark evidence is stored.                              |
| M95       | Recovery, History, and Multi-window Hardening | TD-007, TD-008, TD-030         | Recovery archive, history retention, stale-lock recovery, and multi-window conflict UX are defined and tested.                             |
| M96       | Repository Integrity and Timeline Editing     | TD-009, TD-026                 | Project Health checks cross-file references, and Timeline supports event editing, ordering, and source navigation.                         |
| M97       | Provider Runtime and Streaming                | TD-018, TD-028                 | Provider translators, offline fixtures, streaming IPC, and cancellation propagation are implemented for the next supported provider batch. |
| M98       | Quality Gates and Boundary Tooling            | TD-005, TD-014, TD-015, TD-017 | Coverage threshold, dependency boundary checks, schema/type drift checks, and workflow package boundary tests are enforced.                |
| M99       | Release and Distribution Hardening            | M17 residual risk              | Signing/notarization policy, hosted update manifest, certificate handling, and release verification are documented and gated.              |
| M100      | Product Ready Audit                           | TD-024                         | Product Ready checklist is run against constitution, PRD, UI guidelines, tests, packaging, and known technical debt.                       |

## Execution Rules

- Do not mark a milestone `Complete` unless its productization record, tests, implementation, `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md` are synchronized.
- Every milestone must state what remains out of scope. If the out-of-scope item is still a product promise, create or update a `TECH_DEBT.md` row.
- Use focused tests first, then full local gates: `npm run lint`, `npm run format`, `npm run typecheck -- --pretty false`, `npm run build`, `npm run test`, and `git diff --check`.
- Keep real provider calls and third-party plugin execution out of CI. Use fixtures, injected adapters, and optional manual benchmark records.

### Task 1: M92 Plugin Runtime Repository Persistence

**Files:**

- Create: `docs/productization/m92-plugin-runtime-repository-persistence.md`
- Create: `docs/superpowers/specs/2026-07-06-m92-plugin-runtime-repository-persistence-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m92-plugin-runtime-repository-persistence.md`
- Create: `packages/repository/src/plugin-runtime-audit-repository.ts`
- Create: `packages/repository/test/plugin-runtime-audit-repository.test.ts`
- Modify: `packages/repository/src/ports.ts`
- Modify: `packages/repository/src/index.ts`
- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/plugin-settings-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Write Repository tests for saving/loading trust store snapshots under `.novel-studio/plugin-trust.json`.
- [ ] Write Repository tests for appending redacted audit JSONL records under `history/plugin-audit/YYYY-MM-DD.jsonl`.
- [ ] Implement Repository helpers using existing atomic-write and cache-boundary conventions.
- [ ] Wire Application sessions so Settings trust/revoke actions call Repository-backed helpers, not transient DTO-only projections.
- [ ] Add Settings UI controls for trust, revoke, and audit summary refresh.
- [ ] Verify arbitrary plugin execution, marketplace install, and network access remain blocked.
- [ ] Run `vitest run packages/repository/test/plugin-runtime-audit-repository.test.ts packages/application/test/plugin-runtime-session.test.ts packages/ui/test/settings-and-studio.test.tsx`.
- [ ] Run full local gates and update tracking docs.

### Task 2: M93 Workflow Designer Completion Gate

**Files:**

- Create: `docs/productization/m93-workflow-designer-completion-gate.md`
- Create: `docs/superpowers/specs/2026-07-06-m93-workflow-designer-completion-gate-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m93-workflow-designer-completion-gate.md`
- Modify: `packages/application/src/config-studio-session.ts`
- Modify: `packages/application/test/config-studio-session.test.ts`
- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/test/electron-smoke.spec.ts`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Add tests for edge edit form state that preserves draft values across node selection changes.
- [ ] Add tests for branch edit validation covering empty branches, missing targets, and duplicate labels.
- [ ] Add tests for delete confirmation requiring explicit selected-node confirmation before graph mutation.
- [ ] Implement form-state helpers in Application-facing config workflow edit APIs.
- [ ] Render graph editing controls without nested cards and without renderer filesystem access.
- [ ] Add an Electron smoke covering open Studio, select workflow, edit branch, confirm delete, save draft, and see validation.
- [ ] Run focused tests for `config-studio-session`, `settings-and-studio`, and Electron smoke.
- [ ] Run full local gates and update tracking docs.

### Task 3: M94 Editor Runtime Rollout UX

**Files:**

- Create: `docs/productization/m94-editor-runtime-rollout-ux.md`
- Create: `docs/superpowers/specs/2026-07-06-m94-editor-runtime-rollout-ux-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m94-editor-runtime-rollout-ux.md`
- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `packages/application/test/user-preferences-session.test.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Add tests for user-level CodeMirror opt-in preference and explicit textarea rollback.
- [ ] Add tests for migration gate evidence requiring opt-in, parity, E2E, benchmark, and rollback success.
- [ ] Add tests for inline diff review controls that accept/reject specific hunks instead of only metadata labels.
- [ ] Implement preference-backed adapter selection while preserving textarea fallback when any gate fails.
- [ ] Render visible opt-in, rollback, and inline diff review controls in editor surfaces.
- [ ] Add or update a large-document benchmark fixture record that can be run offline.
- [ ] Run focused editor-runtime, user-preferences, and chapter-editor tests.
- [ ] Run full local gates and update tracking docs.

### Task 4: M95 Recovery, History, and Multi-window Hardening

**Files:**

- Create: `docs/productization/m95-recovery-history-multi-window-hardening.md`
- Create: `docs/superpowers/specs/2026-07-06-m95-recovery-history-multi-window-hardening-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m95-recovery-history-multi-window-hardening.md`
- Modify: `packages/repository/src/recovery-repository.ts`
- Modify: `packages/repository/src/history-repository.ts`
- Modify: `packages/repository/src/project-lock-repository.ts`
- Modify: `packages/repository/test/history-versions.test.ts`
- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `packages/application/test/chapter-autosave-recovery.test.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/test/editor-runtime-workflow-ux.test.tsx`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Define recovery archive retention rules that never delete `history/`, `memories/`, or dirty recovery data silently.
- [ ] Add tests for `file-ref` recovery dereference policy using project-root containment and explicit preview.
- [ ] Add tests for history retention summaries without deleting snapshots by default.
- [ ] Add stale-lock detection tests for expired owner metadata and user-confirmed recovery.
- [ ] Implement UI states for stale lock, active lock, recovery archive preview, and manual retention actions.
- [ ] Run focused recovery/history/project-lock tests.
- [ ] Run full local gates and update tracking docs.

### Task 5: M96 Repository Integrity and Timeline Editing

**Files:**

- Create: `docs/productization/m96-repository-integrity-timeline-editing.md`
- Create: `docs/superpowers/specs/2026-07-06-m96-repository-integrity-timeline-editing-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m96-repository-integrity-timeline-editing.md`
- Modify: `packages/repository/src/story-bible-repository.ts`
- Modify: `packages/repository/test/project-workflow.test.ts`
- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `packages/application/src/story-bible-session.ts`
- Modify: `packages/application/test/project-workflow-session.test.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/test/editor-runtime-workflow-ux.test.tsx`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Add Project Health tests for missing Story Bible references, broken chapter refs, orphan timeline refs, and cache rebuild hints.
- [ ] Add Timeline editing tests for event field edits, ordering, and safe chapter/source navigation.
- [ ] Implement Repository integrity report DTOs using validated JSON reads.
- [ ] Implement Application timeline edit helpers that write through Story Bible Repository.
- [ ] Render timeline event edit, move up/down, and source navigation controls.
- [ ] Run focused story-bible, project-workspace, and UI tests.
- [ ] Run full local gates and update tracking docs.

### Task 6: M97 Provider Runtime and Streaming

**Files:**

- Create: `docs/productization/m97-provider-runtime-streaming.md`
- Create: `docs/superpowers/specs/2026-07-06-m97-provider-runtime-streaming-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m97-provider-runtime-streaming.md`
- Modify: `packages/llm-adapter/src/types.ts`
- Modify: `packages/llm-adapter/src/adapter.ts`
- Modify: `packages/llm-adapter/src/openai-compatible-provider.ts`
- Modify: `packages/llm-adapter/test/llm-adapter.test.ts`
- Modify: `packages/llm-adapter/test/openai-compatible-provider.test.ts`
- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Pick one provider batch after OpenAI-compatible: OpenAI, Ollama, and Anthropic are the recommended first runtime translators because they cover hosted, local, and non-OpenAI APIs.
- [ ] Add offline fixtures for each selected provider translator, including success, malformed response, rate limit, timeout, and cancellation cases.
- [ ] Add tests for streaming IPC event channel, ordered deltas, terminal usage, and AbortController propagation.
- [ ] Implement provider translators behind LLM Adapter interfaces without leaking provider-specific errors upward.
- [ ] Wire Application and Desktop streaming events while preserving non-streaming fallback.
- [ ] Run focused LLM Adapter, Application workflow, and Desktop bridge tests.
- [ ] Run full local gates and update tracking docs.

### Task 7: M98 Quality Gates and Boundary Tooling

**Files:**

- Create: `docs/productization/m98-quality-gates-boundary-tooling.md`
- Create: `docs/superpowers/specs/2026-07-06-m98-quality-gates-boundary-tooling-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m98-quality-gates-boundary-tooling.md`
- Modify: `package.json`
- Modify: `vitest.config.mjs`
- Modify: `eslint.config.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/*/test/*boundary*.test.ts`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Add coverage provider configuration and enforce a conservative threshold that the current suite can meet after one calibration run.
- [ ] Add package boundary tests for Workflow Engine, Agent Engine, Context Engine, Repository, Application, and renderer import directions.
- [ ] Add a schema/type drift check script if codegen is still not selected; otherwise document and implement the selected codegen path.
- [ ] Add CI jobs for coverage, dependency boundary checks, typecheck, lint, tests, and package check.
- [ ] Run `npm run test -- --coverage` or the selected coverage command and record threshold evidence.
- [ ] Run full local gates and update tracking docs.

### Task 8: M99 Release and Distribution Hardening

**Files:**

- Create: `docs/productization/m99-release-distribution-hardening.md`
- Create: `docs/superpowers/specs/2026-07-06-m99-release-distribution-hardening-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m99-release-distribution-hardening.md`
- Modify: `docs/packaging/m17-installer-release-channel.md`
- Modify: `docs/releases/v0.1.0-beta-readiness.md`
- Modify: `scripts/release-check.mjs`
- Modify: `scripts/package-check.mjs`
- Modify: `release-channel/beta.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [ ] Define production signing/notarization inputs, secret names, local unsigned fallback, and failure behavior.
- [ ] Add release-channel manifest validation for hosted update metadata, artifact hash, version monotonicity, and release notes link.
- [ ] Add certificate handling documentation that never stores private material in project files.
- [ ] Add release scripts that fail on missing hashes, missing notes, unpackaged schemas, or leaked secrets.
- [ ] Run package/release checks and record artifact evidence.
- [ ] Run full local gates and update tracking docs.

### Task 9: M100 Product Ready Audit

**Files:**

- Create: `docs/productization/m100-product-ready-audit.md`
- Create: `docs/superpowers/specs/2026-07-06-m100-product-ready-audit-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m100-product-ready-audit.md`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/releases/v0.1.0-beta-readiness.md` or create the next release readiness document

- [ ] Audit `PROJECT_CONSTITUTION.md`, `PRODUCT_PRD.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `UI_GUIDELINES.md`, `CODING_STANDARDS.md`, and `TESTING.md` against implemented behavior.
- [ ] Verify every active `TECH_DEBT.md` item is either resolved, explicitly deferred beyond v1, or assigned to a dated post-v1 RFC.
- [ ] Run full local gates, E2E, package checks, release checks, and artifact secret scans.
- [ ] Create a Product Ready evidence table with command outputs, package artifacts, release notes, and known limitations.
- [ ] Update `ROADMAP.md` so `Product Ready` is only used for areas with evidence, not for slice completion.
- [ ] Update `INDEX.md` and `CHANGELOG.md` with the final readiness state.

## Backlog Beyond M100

These items should not block M100 unless product leadership changes v1 scope:

- Full plugin marketplace install/update flow.
- Safe execution of arbitrary third-party plugin source outside fixture/prototype adapters.
- Cloud sync, collaboration, mobile apps, and SaaS hosting.
- Publisher/platform integrations beyond plugin boundaries.
- Dedicated templates marketplace and official prompt/agent marketplace.
