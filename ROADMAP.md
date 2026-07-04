# Novel Studio v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Novel Studio v1 as a local-first, project-based AI novel creation IDE with reliable project files, version history, controlled AI workflows, and a desktop writing workspace.

**Architecture:** The implementation follows the approved layered architecture: Frontend → Application → Service → Agent Engine → Context Engine → Workflow Engine → LLM Adapter → Repository → Storage. Project files are Markdown/JSON source of truth; SQLite is restricted to rebuildable cache. All core runtime code uses TypeScript Strict.

**Tech Stack:** TypeScript Strict, React, Electron, Tailwind CSS, JSON Schema, Ajv, Vitest, Playwright, ESLint, Prettier, CodeMirror 6 spike, headless UI primitives spike.

---

Version: 1.0 | Status: Active | Phase: 7 Formal Development

## 1. Planning Principles

- Document decisions before code.
- Build vertical slices that can be verified independently.
- Establish toolchain and quality gates before feature breadth.
- Protect user data before adding advanced AI behavior.
- Mock LLM calls in CI; real model calls are offline evaluation only.
- Keep every task aligned with P1-P10 and the approved Phase 1-5 documents.

## 2. Milestone Overview

| Milestone | Name                   | Goal                                                                           | Exit Criteria                                                       |
| --------- | ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| M0        | Repository Baseline    | Commit current documents and establish branch discipline                       | Initial commit exists, remote configured, docs unchanged by tooling |
| M1        | Toolchain Foundation   | Create monorepo, TypeScript strict, lint, format, test runner                  | `typecheck`, `lint`, `format`, `test` commands pass                 |
| M2        | Schema Foundation      | Implement canonical JSON Schema and generated/derived TS types                 | Schema fixtures validate, invalid fixtures fail                     |
| M3        | Repository Core        | Implement project file IO, atomic writes, history, recovery, cache boundary    | Repository tests pass with temp projects                            |
| M4        | Desktop Shell          | Build Electron/React shell, layout, command palette skeleton                   | App opens local project fixture without direct FS access in UI      |
| M5        | Editor and Version UX  | Build Markdown editor, autosave state, version history, diff review foundation | Chapter edit/save/recover/version path works with tests             |
| M6        | LLM Adapter            | Implement provider-neutral LLM Adapter with mock and first providers           | Mock provider tests pass; no real model in CI                       |
| M7        | Agent/Context/Workflow | Implement structured workflow execution and context budget trace               | Review workflow runs end-to-end on mock LLM                         |
| M8        | Studio and Settings    | Prompt/Agent/Workflow editors, model profile settings, secret references       | Config edit/version/rollback path works                             |
| M9        | Hardening and Alpha    | Security, accessibility, performance, packaging, release checklist             | Alpha candidate passes required gates                               |

## 3. Cross-Cutting Gates

Before any feature task is considered complete:

- [ ] TypeScript strict passes.
- [ ] ESLint passes.
- [ ] Prettier check passes.
- [ ] Relevant unit tests pass.
- [ ] Relevant contract/integration tests pass.
- [ ] No direct cross-layer import violations.
- [ ] No hardcoded Prompt or model parameter outside editable assets.
- [ ] No plaintext API key in project files, logs, fixtures, or tests.
- [ ] Documentation or `TECH_DEBT.md` updated.

## 4. M0 — Repository Baseline

### Task M0.1: Initial Documentation Commit

**Files:**

- Include: `PROJECT_CONSTITUTION.md`
- Include: `PRODUCT_PRD.md`
- Include: `ARCHITECTURE.md`
- Include: `DATA_SCHEMA.md`
- Include: `UI_GUIDELINES.md`
- Include: `CODING_STANDARDS.md`
- Include: `TESTING.md`
- Include: `ROADMAP.md`
- Include: `CHANGELOG.md`
- Include: `TECH_DEBT.md`
- Include: `INDEX.md`
- Include: `adr/ADR-0001-engine-runtime-language.md`

- [x] Confirm `origin` is `https://github.com/47ronintop/Novel-Studio.git`.
- [x] Run `rg -n "\b(TODO|TBD)\b|待补|占位" -g "*.md"`.
- [x] Run `git status --short --branch`.
- [x] Commit documents with message `docs: establish Novel Studio foundation`.
- [x] Do not push until user confirms remote branch policy.

**Verification:** Git has one local commit on `main`; working tree is clean.

### Task M0.2: Remote Branch Policy

**Files:**

- Modify: `TECH_DEBT.md`
- Modify: `INDEX.md`

- [x] Confirm whether remote is intentionally empty.
- [x] If empty, push `main` with upstream after user approval.
- [x] Resolve or update `TD-006`.

**Verification:** local `main` tracks `origin/main`; external `git ls-remote --heads origin` should return `refs/heads/main` when GitHub connectivity is available.

## 5. M1 — Toolchain Foundation

### Task M1.1: Workspace Scaffold

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml` or equivalent package manager workspace file
- Create: `tsconfig.base.json`
- Create: `apps/desktop/package.json`
- Create: `packages/shared/package.json`
- Create: `packages/schemas/package.json`

- [x] Choose package manager.
- [x] Define root scripts: `typecheck`, `lint`, `format`, `test`, `test:contract`, `test:e2e`.
- [x] Configure TypeScript strict baseline.
- [x] Keep workspace minimal; no business code yet.

**Verification:** package manager install succeeds; empty typecheck/lint/test scripts execute.

### Task M1.2: Formatting and Linting

**Files:**

- Create: `eslint.config.*`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `.editorconfig`

- [x] Enforce no explicit `any`.
- [x] Enforce import boundaries or prepare boundary config.
- [x] Enforce formatting for Markdown, TypeScript, JSON.

**Verification:** `lint` and `format` pass on documentation and scaffold files.

### Task M1.3: Test Runner Foundation

**Files:**

- Create: `vitest.config.mjs`
- Create: `playwright.config.ts`
- Create: `fixtures/README.md`

- [x] Configure Vitest workspace.
- [x] Configure Playwright smoke suite placeholder.
- [x] Add fixture safety rules.

**Verification:** `test` runs with no failing tests; Playwright config loads.

## 6. M2 — Schema Foundation

### Task M2.1: Schema Package Structure

**Files:**

- Create: `packages/schemas/src/index.ts`
- Create: `packages/schemas/schema/*.schema.json`
- Create: `packages/schemas/test/*.test.ts`
- Create: `fixtures/schemas/valid/`
- Create: `fixtures/schemas/invalid/`

- [x] Add schemas for project metadata, settings, chapter frontmatter, unified error.
- [x] Add valid and invalid fixtures.
- [x] Add Ajv validation helpers.

**Verification:** valid fixtures pass; invalid fixtures fail with stable validation errors.

### Task M2.2: Core Asset Schemas

**Files:**

- Create: story asset schemas.
- Create: prompt template schema.
- Create: agent config schema.
- Create: workflow definition schema.
- Create: memory schema.

- [x] Cover all required fields from `DATA_SCHEMA.md`.
- [x] Preserve unknown field policy explicitly.
- [x] Add fixture tests.

**Verification:** contract tests cover every schema listed in `DATA_SCHEMA.md`.

### Task M2.3: Runtime Contract Schemas

**Files:**

- Create: context bundle schema.
- Create: agent handoff schema.
- Create: LLM request/response schema.
- Create: version record schema.
- Create: recovery record schema.

- [x] Validate Agent handoff JSON.
- [x] Validate LLM usage/cost structures.
- [x] Validate recovery record safety.

**Verification:** contract tests fail for malformed handoff, missing schemaVersion, and plaintext secret-like fields where applicable.

## 7. M3 — Repository Core

### Task M3.1: Repository Ports and Result Types

**Files:**

- Create: `packages/shared/src/result.ts`
- Create: `packages/shared/src/errors.ts`
- Create: `packages/repository/src/ports.ts`
- Create: `packages/repository/src/index.ts`

- [x] Define `Result<T, E>`.
- [x] Define Unified Error type from schema.
- [x] Define repository interfaces for project, history, recovery, cache.

**Verification:** unit tests confirm error shape and result helpers.

### Task M3.2: Project File Reader

**Files:**

- Create: `packages/repository/src/project-repository.ts`
- Test: `packages/repository/test/repository-core.test.ts`

- [x] Read `project.json` and `settings.json`.
- [x] Validate before returning typed DTO.
- [x] Return diagnostic for missing or invalid files.

**Verification:** temp fixture project opens; corrupted fixture returns validation error without mutation.

### Task M3.3: Atomic Write and History

**Files:**

- Create: `packages/repository/src/atomic-write.ts`
- Create: `packages/repository/src/history-repository.ts`
- Test: repository tests.

- [x] Implement temp write + atomic rename.
- [x] Create `before-ai-apply` and `before-rollback` snapshots.
- [x] Ensure write failure preserves previous file.

**Verification:** tests simulate write failure and prove previous file remains intact.

### Task M3.4: Recovery and Cache Guard

**Files:**

- Create: `packages/repository/src/recovery-repository.ts`
- Create: `packages/repository/src/cache-repository.ts`

- [x] Write recovery records under `history/recovery/`.
- [x] Implement cache clear that only touches `cache/`.
- [x] Add tests protecting `history/` and `memories/`.

**Verification:** cache clear test proves history and memories remain.

## 8. M4 — Desktop Shell

### Task M4.1: Electron Security Baseline

**Files:**

- Create: `apps/desktop/src/main/`
- Create: `apps/desktop/src/preload/`
- Create: `apps/desktop/src/renderer/`

- [x] Disable direct Node access in renderer.
- [x] Define IPC allowlist.
- [x] Expose Application Layer commands through preload only.

**Verification:** security tests confirm renderer cannot directly access filesystem.

### Task M4.2: Workspace Shell UI

**Files:**

- Create: `packages/ui/src/`
- Create: `apps/desktop/src/renderer/App.tsx`
- Create: design token CSS.

- [x] Implement Activity Bar, Navigator, Editor Area, Inspector, Bottom Panel skeleton.
- [x] Use OKLCH tokens from `UI_GUIDELINES.md`.
- [x] Keep UI components business-free.

**Verification:** Playwright smoke opens app shell and verifies landmark regions.

### Task M4.3: Command Palette Foundation

**Files:**

- Create: shortcut registry.
- Create: command registry.
- Create: Command Palette component.

- [x] Add `Ctrl/Cmd + K`.
- [x] Add safe commands only.
- [x] Add command risk level.

**Verification:** keyboard test opens palette and executes safe command.

## 9. M5 — Editor and Version UX

### Task M5.1: Editor Spike

**Files:**

- Create: spike notes under `docs/spikes/editor.md`.
- Create minimal CodeMirror prototype in feature branch during implementation.

- [ ] Compare CodeMirror 6 and Monaco against Markdown, large text, diff, shortcut integration.
- [ ] Confirm or revise editor decision.

**Verification:** spike document records decision, tradeoffs, and recommendation.

### Task M5.2: Chapter Editor Vertical Slice

**Files:**

- Create editor package/component.
- Wire Application save use case.

- [ ] Open chapter fixture.
- [ ] Edit content.
- [ ] Show dirty/saving/saved.
- [ ] Save through Repository only.

**Verification:** Playwright edits chapter and repository test verifies file update.

### Task M5.3: Version History and Diff

**Files:**

- Create Version History panel.
- Create diff review component.

- [ ] List snapshots.
- [ ] Preview snapshot.
- [ ] Restore with `before-rollback`.
- [ ] Show AI suggestion diff without applying by default.

**Verification:** integration test restores version and creates rollback snapshot.

## 10. M6 — LLM Adapter

### Task M6.1: Adapter Contract

**Files:**

- Create: `packages/llm-adapter/src/`
- Test: adapter contract tests.

- [x] Define provider-neutral request/response.
- [x] Implement mock provider.
- [x] Implement streaming and non-streaming interfaces.

**Verification:** mock provider passes streaming and non-streaming tests.

### Task M6.2: First Provider Set

Initial provider order:

1. OpenAI Compatible API
2. OpenAI
3. Anthropic
4. Google Gemini
5. Ollama

- [x] Implement OpenAI Compatible first.
- [x] Add provider normalization tests.
- [x] Add rate limit and timeout fixtures.

**Verification:** provider tests use fixtures only; no real network in CI.

### Task M6.3: Cost and Token Reporting

- [x] Add token usage model.
- [x] Add cost estimate model.
- [x] Surface unknown/estimated/actual status.

**Verification:** adapter returns usage reports for fixture responses.

## 11. M7 — Agent / Context / Workflow

### Task M7.1: Workflow State Machine

**Files:**

- Create: `packages/workflow-engine/src/`
- Test: workflow state tests.

- [x] Parse Workflow Definition.
- [x] Evaluate next step.
- [x] Enforce user confirmation gate.
- [x] Keep Workflow Engine from calling Agent Engine upward.

**Verification:** dependency boundary and unit tests prove state machine behavior.

### Task M7.2: Context Engine

**Files:**

- Create: `packages/context-engine/src/`
- Test: context budget tests.

- [ ] Build Context Bundle from chapter, memory, character, world, timeline refs.
- [ ] Enforce budget.
- [ ] Record exclusions and reasons.
- [ ] Filter unconfirmed memories.

**Verification:** tests prove no full-novel blind stuffing and trace is produced.

### Task M7.3: Agent Engine

**Files:**

- Create: `packages/agent-engine/src/`
- Test: handoff and validation tests.

- [ ] Validate agent input.
- [ ] Call LLM Adapter through allowed layer.
- [ ] Validate structured output.
- [ ] Produce Agent Handoff JSON.

**Verification:** malformed JSON fixture fails safely; valid fixture produces structured result.

## 12. M8 — Studio and Settings

### Task M8.1: Model Settings

- [ ] Add model profile editor.
- [ ] Use `apiKeyRef`, never plaintext persistence.
- [ ] Add test connection using Adapter.
- [ ] Redact logs and UI detail.

**Verification:** settings tests prove no API Key appears in project files.

### Task M8.2: Prompt / Agent / Workflow Studio

- [ ] Add Prompt editor with schema validation.
- [ ] Add Agent editor with input/output schema refs.
- [ ] Add Workflow editor with step graph/list.
- [ ] Add version history and rollback.

**Verification:** invalid config cannot become active; rollback creates version record.

## 13. M9 — Hardening and Alpha

### Task M9.1: Accessibility and Keyboard Pass

- [ ] Verify focus order.
- [ ] Verify labels for icon buttons.
- [ ] Verify reduced motion.
- [ ] Verify contrast.

**Verification:** Playwright/a11y smoke tests and manual review checklist pass.

### Task M9.2: Performance Fixture

- [ ] Create synthetic 100万字 project fixture.
- [ ] Measure open project path.
- [ ] Ensure cache rebuild does not block basic edit.

**Verification:** performance baseline recorded.

### Task M9.3: Packaging and Alpha Checklist

- [ ] Build Electron package.
- [ ] Run release candidate gates.
- [ ] Verify no real secrets in artifacts.
- [ ] Update docs and TECH_DEBT.

**Verification:** alpha build created locally and passes smoke tests.

## 14. Provider Roadmap

Architectural support target:

- OpenAI Compatible API
- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- DeepSeek
- 智谱
- 通义千问
- Ollama
- LM Studio
- vLLM

Implementation order:

1. OpenAI Compatible API
2. OpenAI
3. Anthropic
4. Google Gemini
5. Ollama
6. OpenRouter
7. DeepSeek
8. LM Studio
9. vLLM
10. 智谱
11. 通义千问

Reasoning: OpenAI Compatible unlocks many providers early; local-first is supported by Ollama in the first batch; specialized Chinese providers can follow once adapter contract is stable.

## 15. Risk Register

| Risk                                   | Impact                | Mitigation                                     | Owner Phase |
| -------------------------------------- | --------------------- | ---------------------------------------------- | ----------- |
| Toolchain setup consumes too much time | Delays vertical slice | Keep M1 minimal; defer nonessential tooling    | M1          |
| Schema/codegen drift                   | Runtime failures      | Canonical schema + contract tests              | M2          |
| Repository write bugs                  | Data loss             | Atomic write and temp project tests first      | M3          |
| Editor choice wrong                    | Rework UI             | Run explicit CodeMirror/Monaco spike           | M5          |
| LLM provider variance                  | Adapter instability   | Mock fixtures and provider-normalized errors   | M6          |
| Workflow/Agent circular dependency     | Violates architecture | Boundary tests and import rules                | M7          |
| History grows too fast                 | Git usability issue   | Archive strategy task after core history works | M9          |
| Security leakage                       | User trust failure    | Secret scan, redaction tests, IPC allowlist    | M8/M9       |

## 16. Data Flow

Implementation flow:

```text
Documents
→ Toolchain
→ Schemas
→ Repository
→ Application use cases
→ Desktop shell
→ Editor
→ LLM Adapter
→ Context / Workflow / Agent
→ Studio / Settings
→ Hardening
```

## 17. Module Relationship

- M1 creates the workspace and package boundaries.
- M2 creates schemas consumed by every later milestone.
- M3 creates Repository source-of-truth access.
- M4 creates UI shell and Application bridge.
- M5 builds the core writing loop.
- M6 enables provider-neutral model calls.
- M7 enables structured AI workflows.
- M8 exposes configuration editing.
- M9 hardens for alpha.

## 18. Design Reasons

The roadmap prioritizes data integrity and tooling before AI breadth. Novel Studio can survive a limited first UI, but it cannot survive unclear schemas, unsafe writes, unmocked model paths, or cross-layer dependencies. The first useful vertical slice is not “AI writes a chapter”; it is “a local project opens, a chapter edits safely, history and recovery work, then AI suggestions can be applied under user control.”

## 19. Pros and Cons

### Pros

- Reduces early architectural drift.
- Makes data safety testable before AI workflows.
- Gives Phase 7 a clear order of operations.
- Keeps provider expansion behind a stable Adapter contract.

### Cons

- The first visible app may arrive later than a quick prototype.
- Tooling and schema work are front-loaded.
- Full provider support is intentionally staged.
- Some UI decisions require spike tasks before final implementation.

## 20. Future Extensions

- Phase 6.1 can split M6/M7 into separate implementation plans if scope grows.
- ROADMAP v1.1 should add explicit issue IDs after the repository is pushed.
- ROADMAP v1.2 should add release channels and alpha/beta criteria.
- Future RFCs can add cloud sync, collaboration, and plugin marketplace tracks.

## 21. Phase 6 Changelog

- v1.0 - 2026-07-03：创建 Phase 6 Task Planning 初稿。
- v1.0 - 2026-07-03：定义 M0-M9 里程碑、Provider 实现顺序、风险 register、验证门禁。
- v1.0 - 2026-07-03：明确 Phase 7 首要顺序为工具链、Schema、Repository、桌面壳、编辑器，再进入 LLM 与 Agent 工作流。

## 22. Progress Tracking

| 阶段                  | 状态        | 本次产出                                                                                          | 未决问题                                        | 下一步                         |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| Phase 1 产品设计      | Complete    | `PRODUCT_PRD.md v1.0`                                                                             | 无阻塞                                          | 已完成                         |
| Phase 2 系统架构      | Complete    | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md`                                 | Workflow/Agent 边界需实现时用 import rules 固化 | 已完成                         |
| Phase 3 数据结构设计  | Complete    | `DATA_SCHEMA.md v1.0`                                                                             | JSON Schema 文件待 Phase 7 实现                 | 已完成                         |
| Phase 4 UI/UX 设计    | Complete    | `UI_GUIDELINES.md v1.0`                                                                           | CodeMirror/组件 primitive 需 spike              | 已完成                         |
| Phase 5 开发规范      | Complete    | `CODING_STANDARDS.md v1.0`、`TESTING.md v1.0`                                                     | 工具配置待实现                                  | 已完成                         |
| Phase 6 Task Planning | Complete    | `ROADMAP.md v1.0`                                                                                 | 后续专题文档需在相关实现前补齐                  | 已完成                         |
| Phase 7 正式开发      | In Progress | M0、M1、M2、M3 Repository Core、M4 Desktop Shell、M5 Editor and Version UX、M6 LLM Adapter 已完成 | schema codegen、dependency boundary 工具待选择  | 执行 M7 Agent/Context/Workflow |
