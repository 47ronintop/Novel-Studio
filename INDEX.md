# INDEX - Novel Studio 文档索引

Version: 1.11 | Last Updated: 2026-07-04

## 文档优先级

1. `PROJECT_CONSTITUTION.md`
2. `PRODUCT_PRD.md`
3. `ARCHITECTURE.md`
4. 其他技术文档

当文档之间出现冲突时，按以上顺序解释；实现必须优先遵守项目宪法、产品范围和架构边界。

## 当前有效文档

| 文档                                      | 版本       | 状态                        | 用途                                                                 |
| ----------------------------------------- | ---------- | --------------------------- | -------------------------------------------------------------------- |
| `PROJECT_CONSTITUTION.md`                 | 1.0        | Active                      | 项目原则、约束、架构规则、文档优先级                                 |
| `PRODUCT_PRD.md`                          | 1.0        | Accepted                    | Phase 1 产品设计、范围、用户路径、需求                               |
| `ARCHITECTURE.md`                         | 1.0        | Accepted                    | Phase 2 系统架构、分层边界、运行时流程                               |
| `DATA_SCHEMA.md`                          | 1.0        | Accepted                    | Phase 3 数据结构、文件布局、版本、恢复、缓存边界                     |
| `UI_GUIDELINES.md`                        | 1.0        | Accepted                    | Phase 4 UI/UX、布局、交互、设计 tokens、可访问性                     |
| `CODING_STANDARDS.md`                     | 1.0        | Accepted                    | Phase 5 开发规范、语言规则、分层、schema、UI 实现                    |
| `TESTING.md`                              | 1.0        | Accepted                    | Phase 5 测试规范、测试金字塔、fixtures、LLM mock、CI 门禁            |
| `ROADMAP.md`                              | 1.0        | Active                      | Phase 6 任务规划、里程碑、Provider 顺序、实现门禁                    |
| `LLM_ADAPTER.md`                          | 1.0        | Accepted for M6             | Provider-neutral 模型调用边界、mock provider、错误、重试、usage/cost |
| `WORKFLOW_ENGINE.md`                      | 1.0        | Accepted for M7.1           | 确定性工作流状态机、next action、确认 gate                           |
| `CONTEXT_ENGINE.md`                       | 1.0        | Accepted for M7.2           | Context Bundle 构建、token budget、exclusion/source trace            |
| `AGENT_ENGINE.md`                         | 1.0        | Accepted for M7.3           | Agent 输入/输出校验、LLM Adapter 调用、结构化 handoff JSON           |
| `docs/spikes/editor.md`                   | 1.0        | Accepted for M5             | Markdown 编辑器选型 spike 和结论                                     |
| `docs/performance/m9-alpha-baseline.md`   | 1.0        | Accepted for M9             | 大型项目 fixture 与 alpha 性能基线                                   |
| `docs/packaging/m10-beta-packaging.md`    | 1.0        | Accepted for M10            | Renderer 打包、electron-builder 配置、package preflight gate         |
| `adr/ADR-0001-engine-runtime-language.md` | 1.0        | Accepted for Phase 2 Review | Core Engine 运行时语言决策                                           |
| `CHANGELOG.md`                            | 0.1.0-docs | Active                      | 变更记录                                                             |
| `TECH_DEBT.md`                            | 1.0        | Active                      | 已知风险、技术债、未决决策                                           |

## 计划中文档

| 文档               | 阶段         | 状态        |
| ------------------ | ------------ | ----------- |
| `PROMPT_SYSTEM.md` | 后续技术设计 | Not Started |
| `PLUGIN_SYSTEM.md` | 后续技术设计 | Not Started |
| `SECURITY.md`      | 后续技术设计 | Not Started |

## 进度跟踪

| 阶段                  | 状态        | 当前产出                                                                                                                                                                 | 未决问题                                                           | 下一步                         |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------ |
| Phase 1 产品设计      | Complete    | `PRODUCT_PRD.md v1.0`、`CHANGELOG.md`、`TECH_DEBT.md`、`INDEX.md`                                                                                                        | Provider rollout 细节按 roadmap 分批推进                           | 已完成                         |
| Phase 2 系统架构      | Complete    | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md`                                                                                                        | Workflow/Agent 边界继续用自动化检查固化                            | 已完成                         |
| Phase 3 数据结构设计  | Complete    | `DATA_SCHEMA.md v1.0`                                                                                                                                                    | locking、migration log、archive policy 是后续 hardening            | 已完成                         |
| Phase 4 UI/UX 设计    | Complete    | `UI_GUIDELINES.md v1.0`                                                                                                                                                  | 编辑器与组件选择已通过实现继续验证                                 | 已完成                         |
| Phase 5 开发规范      | Complete    | `CODING_STANDARDS.md v1.0`、`TESTING.md v1.0`                                                                                                                            | 远端 CI、coverage、dependency boundary 工具继续补强                | 已完成                         |
| Phase 6 Task Planning | Complete    | `ROADMAP.md v1.0`                                                                                                                                                        | 后续专题文档在相关实现前补齐                                       | 已完成                         |
| Phase 7 正式开发      | In Progress | M0-M10 已完成：Repository、Toolchain、Schema、Desktop Shell、Editor UX、LLM Adapter、Agent/Context/Workflow、Studio、Alpha gate、Vite renderer bundle、package preflight | schema codegen、dependency boundary 工具、`package:dir` 环境稳定性 | 稳定真实 package artifact 执行 |

## 当前本地提交状态

- `main` 本地领先 `origin/main` 12 个提交。
- 不允许擅自 push；需要推送前必须先告知用户。
- 最近完成的里程碑是 M10 Beta Packaging Foundation。
