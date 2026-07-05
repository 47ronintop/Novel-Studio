# INDEX - Novel Studio 文档索引

Version: 1.19 | Last Updated: 2026-07-05

## 文档优先级

1. `PROJECT_CONSTITUTION.md`
2. `PRODUCT_PRD.md`
3. `ARCHITECTURE.md`
4. 其他技术文档

当文档之间出现冲突时，按以上顺序解释；实现必须优先遵守项目宪法、产品范围和架构边界。

## 当前有效文档

| 文档                                              | 版本       | 状态                 | 用途                                                    |
| ------------------------------------------------- | ---------- | -------------------- | ------------------------------------------------------- |
| `PROJECT_CONSTITUTION.md`                         | 1.0        | Active               | 项目原则、约束、架构规则、文档优先级                    |
| `PRODUCT_PRD.md`                                  | 1.0        | Accepted             | 产品设计、范围、用户路径、需求                          |
| `ARCHITECTURE.md`                                 | 1.0        | Accepted             | 系统架构、分层边界、运行时流程                          |
| `DATA_SCHEMA.md`                                  | 1.0        | Accepted             | 数据结构、文件布局、版本、恢复、缓存边界                |
| `UI_GUIDELINES.md`                                | 1.0        | Accepted             | UI/UX、布局、交互、设计 tokens、可访问性                |
| `CODING_STANDARDS.md`                             | 1.0        | Accepted             | 开发规范、语言规则、分层、schema、UI 实现               |
| `TESTING.md`                                      | 1.0        | Accepted             | 测试规范、fixtures、LLM mock、CI 门禁                   |
| `ROADMAP.md`                                      | 1.7        | Active               | 当前里程碑、后续路线、完成状态                          |
| `STORY_BIBLE.md`                                  | 1.0        | Accepted for M16     | Story Bible 资产、仓储、Context 候选和最小 UI 闭环      |
| `docs/packaging/m17-installer-release-channel.md` | 1.0        | Accepted for M17     | 安装器目标、发布通道 manifest、release notes 和签名策略 |
| `PLUGIN_SYSTEM.md`                                | 1.0        | Accepted for M18     | 插件 manifest、权限、注册表、运行时边界和测试要求       |
| `docs/productization/m19-beta-ux-hardening.md`    | 1.0        | Complete             | beta 安装版入口、中文菜单、可点击导航和空状态验收标准   |
| `LLM_ADAPTER.md`                                  | 1.0        | Accepted for M6      | Provider-neutral 模型调用边界                           |
| `WORKFLOW_ENGINE.md`                              | 1.0        | Accepted for M7.1    | 确定性 workflow 状态机                                  |
| `CONTEXT_ENGINE.md`                               | 1.0        | Accepted for M7.2    | Context Bundle、token budget、trace                     |
| `AGENT_ENGINE.md`                                 | 1.0        | Accepted for M7.3    | Agent 执行、结构化 handoff                              |
| `docs/spikes/editor.md`                           | 1.0        | Accepted for M5      | 编辑器选型 spike                                        |
| `docs/performance/m9-alpha-baseline.md`           | 1.0        | Accepted for M9      | 大型项目 fixture 与 alpha 性能基线                      |
| `docs/packaging/m10-beta-packaging.md`            | 1.2        | Accepted for M10-M13 | 打包配置、artifact 稳定化、真实 e2e 与 CI gate          |
| `docs/releases/v0.1.0-beta-readiness.md`          | 1.0        | Review Complete      | v0.1.0 beta 发布验收记录、产物、验证证据和剩余风险      |
| `adr/ADR-0001-engine-runtime-language.md`         | 1.0        | Accepted             | Core Engine 运行时语言决策                              |
| `CHANGELOG.md`                                    | 0.1.0-docs | Active               | 变更记录                                                |
| `TECH_DEBT.md`                                    | 1.0        | Active               | 已知风险、技术债、未决项                                |

## 进度跟踪

| 阶段                  | 状态     | 当前产出                            | 下一步           |
| --------------------- | -------- | ----------------------------------- | ---------------- |
| Phase 1 产品设计      | Complete | `PRODUCT_PRD.md`                    | 已完成           |
| Phase 2 系统架构      | Complete | `ARCHITECTURE.md`、ADR-0001         | 已完成           |
| Phase 3 数据结构设计  | Complete | `DATA_SCHEMA.md`                    | 已完成           |
| Phase 4 UI/UX 设计    | Complete | `UI_GUIDELINES.md`                  | 已完成           |
| Phase 5 开发规范      | Complete | `CODING_STANDARDS.md`、`TESTING.md` | 已完成           |
| Phase 6 Task Planning | Complete | `ROADMAP.md`                        | 已完成           |
| Phase 7 正式开发      | Complete | M0-M18 已完成                       | 已完成           |
| Post-M18 产品化打磨   | Active   | M19 Beta UX 产品化打磨已完成        | 下一步拆 M20-M22 |

## 当前本地状态

- 当前已完成 M0-M18。
- 当前已完成 M19 Beta UX 产品化打磨。
- 未经用户确认不得 push。
- 当前本地 artifact 位于被忽略的 `release/` 目录，不提交到仓库。
