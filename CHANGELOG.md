# CHANGELOG — Novel Studio

## v0.1.0-docs — 2026-07-03

- Created `PROJECT_CONSTITUTION.md` v1.0.
- Created `PRODUCT_PRD.md` v1.0 for Phase 1 product design.
- Created initial `INDEX.md`.
- Created initial `TECH_DEBT.md`.
- Connected Git remote `origin` to `https://github.com/47ronintop/Novel-Studio.git`.
- Created `ARCHITECTURE.md` v1.0 for Phase 2 system architecture.
- Created `adr/ADR-0001-engine-runtime-language.md`.
- Resolved the Git repository status item recorded as `TD-002`.
- Created `DATA_SCHEMA.md` v1.0 for Phase 3 data structure design.
- Defined source-of-truth rules for Markdown, JSON, history, memories, recovery records, and cache.
- Recorded that SQLite is restricted to `cache/` as a rebuildable index layer.
- Created `UI_GUIDELINES.md` v1.0 for Phase 4 UI/UX design.
- Defined the desktop IDE workspace, dark-first visual system, Command Palette, AI review UX, and core interaction states.
- Created `CODING_STANDARDS.md` v1.0 for Phase 5 development standards.
- Created `TESTING.md` v1.0 for Phase 5 testing standards.
- Defined TypeScript Strict, JSON Schema canonical contracts, Ajv validation, Repository/Adapter boundaries, CodeMirror 6 editor preference, headless UI primitive preference, shortcut registry, and fixture-first testing.
- Created `ROADMAP.md` v1.0 for Phase 6 task planning.
- Defined implementation milestones M0-M9, provider implementation order, risk register, and Phase 7 execution gates.
- Removed stray `text` paste artifacts from `PROJECT_CONSTITUTION.md`.
- Updated `TECH_DEBT.md` for resolved Provider ordering and initial documentation baseline items.
- Published the initial documentation baseline to `origin/main` and entered Phase 7.
- Updated `INDEX.md` and `TECH_DEBT.md` for M0.2 remote branch policy closure.
- Created M1 Toolchain Foundation with npm workspaces, TypeScript strict config, ESLint, Prettier, Vitest, Playwright, package lock, and fixture safety rules.
- Verified M1 commands: `typecheck`, `lint`, `format`, `test`, `test:e2e`, and `npm audit`.
- Created M2 Schema Foundation with 15 JSON Schema contracts, Ajv validation helper, valid/invalid fixtures, and 32 contract tests.
- Added `ajv`, `ajv-formats`, and Node type declarations required by the schema package and tests.
- Created M3 Repository Core with shared `Result`/Unified Error utilities, Repository ports, project file validation, atomic text writes, history snapshots, recovery records, and cache boundary protection.
- Added repository tests covering valid/missing/invalid project open, atomic write failure preservation, `before-ai-apply` and `before-rollback` snapshots, recovery writes under `history/recovery/`, and cache clear protection for `history/` and `memories/`.
- Created M4 Desktop Shell with Electron security defaults, Application IPC allowlist, preload API, React renderer entry, and desktop workspace skeleton.
- Added Application command registry with safe command `riskLevel`, shell state DTOs, and command execution boundary.
- Added UI package with Activity Bar, Navigator, Editor Area, Inspector, Bottom Panel, Command Palette, OKLCH design tokens, and Ctrl/Cmd+K shortcut handling.
- Upgraded Vitest to clear current audit findings and keep the verification gate at 0 vulnerabilities.

## Notes

- Phase 7 is active.
- M5 Editor and Version UX is the next implementation milestone.
