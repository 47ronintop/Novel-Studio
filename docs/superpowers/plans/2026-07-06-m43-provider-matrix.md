# M43 Provider Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand model profile support to the full constitution-required provider matrix without adding real provider network calls to CI.

**Architecture:** Provider IDs are cataloged in the Application/LLM Adapter boundary and mirrored in the settings JSON Schema. Repository remains schema-driven, Application validates profile DTOs, and UI receives provider options as props instead of owning model-call behavior.

**Tech Stack:** TypeScript strict, JSON Schema, Vitest, React static rendering tests, Electron IPC/preload contracts.

---

### Task 1: Schema and Fixture Contract

**Files:**

- Modify: `packages/schemas/schema/settings.schema.json`
- Modify: `fixtures/schemas/valid/settings.json`
- Modify: `packages/schemas/test/schema-contract.test.ts`

- [x] Write failing schema tests proving the valid fixture covers every provider and unsupported providers still fail.
- [x] Expand the settings schema provider enum.
- [x] Update the valid settings fixture with one profile per provider.
- [x] Run `npm run test -- packages/schemas/test/schema-contract.test.ts`.

### Task 2: LLM Adapter and Application Provider Catalog

**Files:**

- Modify: `packages/llm-adapter/src/types.ts`
- Create: `packages/application/src/model-provider-catalog.ts`
- Modify: `packages/application/src/model-settings-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/model-settings-session.test.ts`

- [x] Write failing Application tests for accepting every catalog provider and resolving runtime profiles.
- [x] Expand `LlmProviderId`.
- [x] Add the Application provider catalog.
- [x] Use the catalog in `ModelSettingsSession` validation and runtime profile resolution.
- [x] Run `npm run test -- packages/application/test/model-settings-session.test.ts`.

### Task 3: Settings Bridge and UI Provider Options

**Files:**

- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Modify: `apps/desktop/test/settings-bridge.test.ts`

- [x] Write failing UI/bridge tests for provider option rendering and default provider options.
- [x] Add provider options to `ModelSettingsPanelProps`.
- [x] Render provider options in the Provider select.
- [x] Pass catalog options from SettingsBridge.
- [x] Run `npm run test -- packages/ui/test/settings-and-studio.test.tsx apps/desktop/test/settings-bridge.test.ts`.

### Task 4: Docs and Full Gates

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/productization/m43-provider-matrix.md`
- Modify: `docs/superpowers/plans/2026-07-06-m43-provider-matrix.md`

- [x] Mark M43 docs complete and update M44 next-step references.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run test:e2e`.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add provider matrix support`.
