# INDEX — Novel Studio Documentation

Version: 1.8 | Last Updated: 2026-07-03

## Document Priority

1. `PROJECT_CONSTITUTION.md`
2. `PRODUCT_PRD.md`
3. `ARCHITECTURE.md`
4. Other technical documents

## Active Documents

| Document                                  |    Version | Status                      | Purpose                                                                            |
| ----------------------------------------- | ---------: | --------------------------- | ---------------------------------------------------------------------------------- |
| `PROJECT_CONSTITUTION.md`                 |        1.0 | Active                      | Project principles, constraints, architecture rules, document order                |
| `PRODUCT_PRD.md`                          |        1.0 | Accepted                    | Phase 1 product design, scope, user journeys, requirements                         |
| `ARCHITECTURE.md`                         |        1.0 | Accepted                    | Phase 2 system architecture, layer boundaries, runtime flow                        |
| `DATA_SCHEMA.md`                          |        1.0 | Accepted                    | Phase 3 data schema, file layout, versioning, recovery, cache boundary             |
| `UI_GUIDELINES.md`                        |        1.0 | Accepted                    | Phase 4 UI/UX design, layout, interaction, design tokens, accessibility            |
| `CODING_STANDARDS.md`                     |        1.0 | Accepted                    | Phase 5 development standards, language rules, layering, schema, UI implementation |
| `TESTING.md`                              |        1.0 | Accepted                    | Phase 5 testing standards, test pyramid, fixtures, LLM mocks, CI gates             |
| `ROADMAP.md`                              |        1.0 | Active                      | Phase 6 task planning, milestones, provider order, implementation gates            |
| `LLM_ADAPTER.md`                          |        1.0 | Accepted for M6             | Provider-neutral model call boundary, mock provider, errors, retry, usage/cost     |
| `WORKFLOW_ENGINE.md`                      |        1.0 | Accepted for M7.1           | Deterministic workflow state machine, next actions, confirmation gate              |
| `CONTEXT_ENGINE.md`                       |        1.0 | Accepted for M7.2           | Context bundle construction, token budget, exclusion and source trace              |
| `AGENT_ENGINE.md`                         |        1.0 | Accepted for M7.3           | Agent input/output validation, LLM Adapter calls, structured handoff JSON          |
| `adr/ADR-0001-engine-runtime-language.md` |        1.0 | Accepted for Phase 2 Review | Core Engine language decision                                                      |
| `CHANGELOG.md`                            | 0.1.0-docs | Active                      | Running change history                                                             |
| `TECH_DEBT.md`                            |        1.0 | Active                      | Known risks, debt, unresolved decisions                                            |

## Planned Documents

| Document           | Phase                  | Status      |
| ------------------ | ---------------------- | ----------- |
| `PROMPT_SYSTEM.md` | Later technical design | Not Started |
| `PLUGIN_SYSTEM.md` | Later technical design | Not Started |
| `SECURITY.md`      | Later technical design | Not Started |

## Progress Tracking

| 阶段                  | 状态        | 本次产出                                                                                          | 未决问题                                                                     | 下一步                         |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| Phase 1 产品设计      | Complete    | `PRODUCT_PRD.md v1.0`、`CHANGELOG.md`、`TECH_DEBT.md`、`INDEX.md`                                 | v1 Provider 首批落地顺序、默认 Workflow 清单细节                             | 已进入 Phase 2                 |
| Phase 2 系统架构      | Complete    | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md`                                 | Workflow/Agent 层级解释需在实现时用 import rules 固化                        | 已进入 Phase 3                 |
| Phase 3 数据结构设计  | Complete    | `DATA_SCHEMA.md v1.0`                                                                             | 锁策略、迁移日志、history 归档策略待 M3/M9 细化                              | 已进入 Phase 4                 |
| Phase 4 UI/UX 设计    | Complete    | `UI_GUIDELINES.md v1.0`                                                                           | 组件库、编辑器、快捷键冲突需 Phase 6 spike/任务验证                          | 已进入 Phase 5                 |
| Phase 5 开发规范      | Complete    | `CODING_STANDARDS.md v1.0`、`TESTING.md v1.0`                                                     | 工具配置文件、fixture 套件、CI 门禁、dependency boundary 工具待 Phase 7 实现 | 已进入 Phase 6                 |
| Phase 6 Task Planning | Complete    | `ROADMAP.md v1.0`                                                                                 | 后续专题文档需在相关实现前补齐                                               | 已进入 Phase 7                 |
| Phase 7 正式开发      | In Progress | M0、M1、M2、M3 Repository Core、M4 Desktop Shell、M5 Editor and Version UX、M6 LLM Adapter 已完成 | schema codegen、dependency boundary 工具待选择                               | 执行 M7 Agent/Context/Workflow |
