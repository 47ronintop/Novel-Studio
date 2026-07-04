# INDEX - Novel Studio Documentation

Version: 1.9 | Last Updated: 2026-07-04

## Document Priority

1. `PROJECT_CONSTITUTION.md`
2. `PRODUCT_PRD.md`
3. `ARCHITECTURE.md`
4. Other technical documents

## Active Documents

| Document                                  | Version    | Status                      | Purpose                                                                            |
| ----------------------------------------- | ---------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `PROJECT_CONSTITUTION.md`                 | 1.0        | Active                      | Project principles, constraints, architecture rules, document order                |
| `PRODUCT_PRD.md`                          | 1.0        | Accepted                    | Phase 1 product design, scope, user journeys, requirements                         |
| `ARCHITECTURE.md`                         | 1.0        | Accepted                    | Phase 2 system architecture, layer boundaries, runtime flow                        |
| `DATA_SCHEMA.md`                          | 1.0        | Accepted                    | Phase 3 data schema, file layout, versioning, recovery, cache boundary             |
| `UI_GUIDELINES.md`                        | 1.0        | Accepted                    | Phase 4 UI/UX design, layout, interaction, design tokens, accessibility            |
| `CODING_STANDARDS.md`                     | 1.0        | Accepted                    | Phase 5 development standards, language rules, layering, schema, UI implementation |
| `TESTING.md`                              | 1.0        | Accepted                    | Phase 5 testing standards, test pyramid, fixtures, LLM mocks, CI gates             |
| `ROADMAP.md`                              | 1.0        | Active                      | Phase 6 task planning, milestones, provider order, implementation gates            |
| `LLM_ADAPTER.md`                          | 1.0        | Accepted for M6             | Provider-neutral model call boundary, mock provider, errors, retry, usage/cost     |
| `WORKFLOW_ENGINE.md`                      | 1.0        | Accepted for M7.1           | Deterministic workflow state machine, next actions, confirmation gate              |
| `CONTEXT_ENGINE.md`                       | 1.0        | Accepted for M7.2           | Context bundle construction, token budget, exclusion and source trace              |
| `AGENT_ENGINE.md`                         | 1.0        | Accepted for M7.3           | Agent input/output validation, LLM Adapter calls, structured handoff JSON          |
| `docs/performance/m9-alpha-baseline.md`   | 1.0        | Accepted for M9             | Synthetic large project fixture and alpha performance smoke baseline               |
| `adr/ADR-0001-engine-runtime-language.md` | 1.0        | Accepted for Phase 2 Review | Core Engine language decision                                                      |
| `CHANGELOG.md`                            | 0.1.0-docs | Active                      | Running change history                                                             |
| `TECH_DEBT.md`                            | 1.0        | Active                      | Known risks, debt, unresolved decisions                                            |

## Planned Documents

| Document           | Phase                  | Status      |
| ------------------ | ---------------------- | ----------- |
| `PROMPT_SYSTEM.md` | Later technical design | Not Started |
| `PLUGIN_SYSTEM.md` | Later technical design | Not Started |
| `SECURITY.md`      | Later technical design | Not Started |

## Progress Tracking

| Phase                      | Status      | Current Output                                                                                                                                         | Open Issues                                                    | Next Step                         |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------- |
| Phase 1 Product Design     | Complete    | `PRODUCT_PRD.md v1.0`, `CHANGELOG.md`, `TECH_DEBT.md`, `INDEX.md`                                                                                      | Provider rollout details remain staged by roadmap              | Complete                          |
| Phase 2 Architecture       | Complete    | `ARCHITECTURE.md v1.0`, `adr/ADR-0001-engine-runtime-language.md`                                                                                      | Workflow/Agent boundaries require continued automated checks   | Complete                          |
| Phase 3 Data Schema        | Complete    | `DATA_SCHEMA.md v1.0`                                                                                                                                  | Locking, migration logs, and archive policy remain future work | Complete                          |
| Phase 4 UI/UX              | Complete    | `UI_GUIDELINES.md v1.0`                                                                                                                                | Editor and component choices continue through tests            | Complete                          |
| Phase 5 Standards          | Complete    | `CODING_STANDARDS.md v1.0`, `TESTING.md v1.0`                                                                                                          | Remote CI and dependency tooling remain future hardening       | Complete                          |
| Phase 6 Task Planning      | Complete    | `ROADMAP.md v1.0`                                                                                                                                      | Later technical docs are written before related implementation | Complete                          |
| Phase 7 Formal Development | In Progress | M0-M9 local alpha hardening complete: Repository, Toolchain, Schema, Desktop Shell, Editor UX, LLM Adapter, Agent/Context/Workflow, Studio, Alpha gate | schema codegen, dependency tooling, installer-grade packaging  | Run alpha review / beta packaging |
