# INDEX — Novel Studio Documentation

Version: 1.5 | Last Updated: 2026-07-03

## Document Priority

1. `PROJECT_CONSTITUTION.md`
2. `PRODUCT_PRD.md`
3. `ARCHITECTURE.md`
4. Other technical documents

## Active Documents

| Document | Version | Status | Purpose |
|---|---:|---|---|
| `PROJECT_CONSTITUTION.md` | 1.0 | Active | Project principles, constraints, architecture rules, document order |
| `PRODUCT_PRD.md` | 1.0 | Draft for Review | Phase 1 product design, scope, user journeys, requirements |
| `ARCHITECTURE.md` | 1.0 | Draft for Review | Phase 2 system architecture, layer boundaries, runtime flow |
| `DATA_SCHEMA.md` | 1.0 | Draft for Review | Phase 3 data schema, file layout, versioning, recovery, cache boundary |
| `UI_GUIDELINES.md` | 1.0 | Draft for Review | Phase 4 UI/UX design, layout, interaction, design tokens, accessibility |
| `CODING_STANDARDS.md` | 1.0 | Draft for Review | Phase 5 development standards, language rules, layering, schema, UI implementation |
| `TESTING.md` | 1.0 | Draft for Review | Phase 5 testing standards, test pyramid, fixtures, LLM mocks, CI gates |
| `ROADMAP.md` | 1.0 | Draft for Review | Phase 6 task planning, milestones, provider order, implementation gates |
| `adr/ADR-0001-engine-runtime-language.md` | 1.0 | Accepted for Phase 2 Review | Core Engine language decision |
| `CHANGELOG.md` | 0.1.0-docs | Active | Running change history |
| `TECH_DEBT.md` | 1.0 | Active | Known risks, debt, unresolved decisions |

## Planned Documents

| Document | Phase | Status |
|---|---|---|
| `PROMPT_SYSTEM.md` | Later technical design | Not Started |
| `CONTEXT_ENGINE.md` | Later technical design | Not Started |
| `WORKFLOW_ENGINE.md` | Later technical design | Not Started |
| `PLUGIN_SYSTEM.md` | Later technical design | Not Started |
| `LLM_ADAPTER.md` | Later technical design | Not Started |
| `SECURITY.md` | Later technical design | Not Started |

## Progress Tracking

| 阶段 | 状态 | 本次产出 | 未决问题 | 下一步 |
|---|---|---|---|---|
| Phase 1 产品设计 | Complete | `PRODUCT_PRD.md v1.0`、`CHANGELOG.md`、`TECH_DEBT.md`、`INDEX.md` | v1 Provider 首批落地顺序、默认 Workflow 清单细节 | 已进入 Phase 2 |
| Phase 2 系统架构 | Complete | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md` | Workflow/Agent 层级解释需在测试规范中固化；远端仓库可达但暂无 heads | 已进入 Phase 3 |
| Phase 3 数据结构设计 | Complete | `DATA_SCHEMA.md v1.0` | JSON Schema 文件尚未生成；锁策略、迁移日志、history 归档策略待细化 | 已进入 Phase 4 |
| Phase 4 UI/UX 设计 | Complete | `UI_GUIDELINES.md v1.0` | 组件库、编辑器、快捷键冲突需 Phase 6 spike/任务验证 | 已进入 Phase 5 |
| Phase 5 开发规范 | Complete | `CODING_STANDARDS.md v1.0`、`TESTING.md v1.0` | 工具配置文件、fixture 套件、CI 门禁、dependency boundary 工具待 Phase 7 实现 | 已进入 Phase 6 |
| Phase 6 Task Planning | Draft for Review | `ROADMAP.md v1.0` | 初始提交/推送策略、Phase 7 执行方式、工具链具体选型 | 等待用户确认 |
| Phase 7 正式开发 | Not Started | 无 | 执行 M0-M9；选择 subagent-driven 或 inline execution | Phase 6 确认后启动 |
