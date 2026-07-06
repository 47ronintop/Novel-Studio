# INDEX - Novel Studio 文档索引

Version: 1.48 | Last Updated: 2026-07-06

## 文档优先级

1. `PROJECT_CONSTITUTION.md`
2. `PRODUCT_PRD.md`
3. `ARCHITECTURE.md`
4. 其他技术文档

当文档之间出现冲突时，按以上顺序解释；实现必须优先遵守项目宪法、产品范围和架构边界。

## 当前有效文档

| 文档                                                            | 版本       | 状态                 | 用途                                                     |
| --------------------------------------------------------------- | ---------- | -------------------- | -------------------------------------------------------- |
| `PROJECT_CONSTITUTION.md`                                       | 1.0        | Active               | 项目原则、约束、架构规则、文档优先级                     |
| `PRODUCT_PRD.md`                                                | 1.0        | Accepted             | 产品设计、范围、用户路径、需求                           |
| `ARCHITECTURE.md`                                               | 1.0        | Accepted             | 系统架构、分层边界、运行时流程                           |
| `DATA_SCHEMA.md`                                                | 1.0        | Accepted             | 数据结构、文件布局、版本、恢复、缓存边界                 |
| `UI_GUIDELINES.md`                                              | 1.0        | Accepted             | UI/UX、布局、交互、设计 tokens、可访问性                 |
| `CODING_STANDARDS.md`                                           | 1.0        | Accepted             | 开发规范、语言规则、分层、schema、UI 实现                |
| `TESTING.md`                                                    | 1.0        | Accepted             | 测试规范、fixtures、LLM mock、CI 门禁                    |
| `ROADMAP.md`                                                    | 1.36       | Active               | 当前里程碑、后续路线、完成状态                           |
| `STORY_BIBLE.md`                                                | 1.0        | Accepted for M16     | Story Bible 资产、仓储、Context 候选和最小 UI 闭环       |
| `docs/packaging/m17-installer-release-channel.md`               | 1.0        | Accepted for M17     | 安装器目标、发布通道 manifest、release notes 和签名策略  |
| `PLUGIN_SYSTEM.md`                                              | 1.0        | Accepted for M18     | 插件 manifest、权限、注册表、运行时边界和测试要求        |
| `docs/productization/m19-beta-ux-hardening.md`                  | 1.0        | Complete             | beta 安装版入口、中文菜单、可点击导航和空状态验收标准    |
| `docs/productization/m20-search-index-ux.md`                    | 1.0        | Complete             | 项目全文搜索、可重建索引、Search UI 和验收标准           |
| `docs/productization/m21-story-bible-editing-ux.md`             | 1.0        | Complete             | Story Bible 编辑入口、表单、保存闭环和验收标准           |
| `docs/productization/m22-settings-ux-completion.md`             | 1.0        | Complete             | 设置页模型配置、连接测试、隐私安全提示和验收标准         |
| `docs/productization/m23-studio-ux-completion.md`               | 1.0        | Complete             | Studio 配置资产选择、JSON 编辑、保存和版本恢复闭环       |
| `docs/productization/m24-workflow-run-observability.md`         | 1.0        | Complete             | AI 工作流运行 trace、模型、token/cost 和步骤状态展示     |
| `docs/productization/m25-workflow-run-history.md`               | 1.0        | Complete             | AI 工作流最近运行历史、脱敏详情和本地审计记录            |
| `docs/productization/m26-workflow-failure-retry.md`             | 1.0        | Complete             | 工作流失败诊断、重试策略展示和用户触发重试入口           |
| `docs/productization/m28-global-usability-audit.md`             | 1.0        | Complete             | 全局高可见入口可用性盘点、禁用原因和无反馈入口治理       |
| `docs/productization/m29-functional-completion-audit.md`        | 1.0        | Complete             | 可见入口完成度审计、核心缺口排序和命令面板执行闭环       |
| `docs/productization/m30-bottom-panel-workspace.md`             | 1.0        | Complete             | 底部面板 tabs 真实切换和最小内容闭环                     |
| `docs/productization/m31-search-result-navigation.md`           | 1.0        | Complete             | 搜索结果点击跳转到章节或故事圣经条目                     |
| `docs/productization/m32-timeline-main-view.md`                 | 1.0        | Complete             | 时间线入口真实主视图和条目跳转闭环                       |
| `docs/productization/m33-plugin-management-ui.md`               | 1.0        | Complete             | 设置页插件注册表只读管理 UI                              |
| `docs/productization/m34-multi-tab-editor.md`                   | 1.0        | Complete             | 工作区章节标签可点击切换                                 |
| `docs/productization/m35-constitution-gap-audit.md`             | 1.0        | Complete             | 宪法差距审计、完成度口径和 M36+ 路线重排                 |
| `docs/productization/m36-m37-workspace-layout-editor-tabs.md`   | 1.0        | Complete             | Split View、布局尺寸状态和运行期可关闭编辑器标签         |
| `docs/productization/m38-autosave-recovery.md`                  | 1.0        | Complete             | 章节编辑恢复记录、可恢复草稿提示和 recovery UI 切片      |
| `docs/productization/m39-timeline-workspace.md`                 | 1.0        | Complete             | 时间线结构化事件轨道、指标和父时间线编辑入口             |
| `docs/productization/m40-m41-project-health-command-palette.md` | 1.0        | Complete             | 项目健康诊断和命令面板交互增强                           |
| `docs/productization/m42-plugin-management.md`                  | 1.0        | Complete             | 插件 manifest 摘要、权限详情和启用/禁用管理              |
| `docs/productization/m43-provider-matrix.md`                    | 1.0        | Complete             | 模型 provider 配置矩阵、schema 校验和 Settings UI 覆盖   |
| `docs/productization/m44-streaming-ux.md`                       | 1.0        | Complete             | OpenAI-compatible 流式契约和 AI 流式预览状态             |
| `docs/productization/m45-workflow-branch.md`                    | 1.0        | Complete             | Workflow Engine branch action 和分支选择状态转换         |
| `docs/productization/m46-editor-hardening.md`                   | 1.0        | Complete             | 编辑器大文档指标、gutter 上限、diff 摘要和快捷键冲突矩阵 |
| `docs/productization/m47-multi-window-safety.md`                | 1.0        | Complete             | 本地项目锁、打开/创建前锁获取和锁冲突保护                |
| `docs/productization/m48-onboarding.md`                         | 1.0        | Complete             | 工作区快速开始、示例项目和第一章行动入口                 |
| `docs/productization/m49-recovery-review.md`                    | 1.0        | Complete             | 可恢复草稿预览、应用和丢弃闭环                           |
| `docs/productization/m50-user-preferences.md`                   | 1.0        | Complete             | onboarding 和布局等用户级偏好持久化                      |
| `docs/productization/m51-recovery-hardening.md`                 | 1.0        | Complete             | clean recovery 隐藏和 file-ref typed error               |
| `docs/productization/m52-editor-runtime.md`                     | 1.0        | Complete             | 编辑器 runtime 状态条和可替换 adapter 边界               |
| `docs/productization/m53-workflow-ux.md`                        | 1.0        | Complete             | Workflow rail、branch choice 和 selected branch 展示     |
| `docs/productization/m54-m56-runtime-rfcs.md`                   | 1.0        | Complete             | Plugin、Editor、Workflow runtime RFC 批次完成口径        |
| `docs/productization/m57-m58-plugin-runtime-workflow.md`        | 1.0        | Complete             | Plugin Runtime host commands 和 workflow-step adapter    |
| `docs/productization/m59-m60-editor-runtime-workflow-graph.md`  | 1.0        | Complete             | Textarea editor runtime adapter 和 workflow graph 投影   |
| `docs/productization/m61-m62-codemirror-workflow-graph-view.md` | 1.0        | Complete             | CodeMirror adapter flag 和 Workflow Studio 只读 graph    |
| `docs/rfcs/RFC-0001-plugin-runtime.md`                          | 1.0        | Accepted for M54     | Plugin Runtime、权限、adapter 和 workflow contribution   |
| `docs/rfcs/RFC-0002-editor-runtime-engine.md`                   | 1.0        | Accepted for M55     | Editor Runtime Engine、CodeMirror adapter 和 visual diff |
| `docs/rfcs/RFC-0003-workflow-designer.md`                       | 1.0        | Accepted for M56     | Workflow Designer、graph projection 和 validation        |
| `LLM_ADAPTER.md`                                                | 1.0        | Accepted for M6      | Provider-neutral 模型调用边界                            |
| `WORKFLOW_ENGINE.md`                                            | 1.0        | Accepted for M7.1    | 确定性 workflow 状态机                                   |
| `CONTEXT_ENGINE.md`                                             | 1.0        | Accepted for M7.2    | Context Bundle、token budget、trace                      |
| `AGENT_ENGINE.md`                                               | 1.0        | Accepted for M7.3    | Agent 执行、结构化 handoff                               |
| `docs/spikes/editor.md`                                         | 1.0        | Accepted for M5      | 编辑器选型 spike                                         |
| `docs/performance/m9-alpha-baseline.md`                         | 1.0        | Accepted for M9      | 大型项目 fixture 与 alpha 性能基线                       |
| `docs/packaging/m10-beta-packaging.md`                          | 1.2        | Accepted for M10-M13 | 打包配置、artifact 稳定化、真实 e2e 与 CI gate           |
| `docs/releases/v0.1.0-beta-readiness.md`                        | 1.0        | Review Complete      | v0.1.0 beta 发布验收记录、产物、验证证据和剩余风险       |
| `adr/ADR-0001-engine-runtime-language.md`                       | 1.0        | Accepted             | Core Engine 运行时语言决策                               |
| `CHANGELOG.md`                                                  | 0.1.0-docs | Active               | 变更记录                                                 |
| `TECH_DEBT.md`                                                  | 1.0        | Active               | 已知风险、技术债、未决项                                 |

## 进度跟踪

| 阶段                  | 状态     | 当前产出                            | 下一步     |
| --------------------- | -------- | ----------------------------------- | ---------- |
| Phase 1 产品设计      | Complete | `PRODUCT_PRD.md`                    | 已完成     |
| Phase 2 系统架构      | Complete | `ARCHITECTURE.md`、ADR-0001         | 已完成     |
| Phase 3 数据结构设计  | Complete | `DATA_SCHEMA.md`                    | 已完成     |
| Phase 4 UI/UX 设计    | Complete | `UI_GUIDELINES.md`                  | 已完成     |
| Phase 5 开发规范      | Complete | `CODING_STANDARDS.md`、`TESTING.md` | 已完成     |
| Phase 6 Task Planning | Complete | `ROADMAP.md`                        | 已完成     |
| Phase 7 正式开发      | Complete | M0-M18 已完成                       | 已完成     |
| Post-M18 产品化打磨   | Active   | M19-M62 已完成                      | 下一步 M63 |

## 当前本地状态

- 当前已完成 M0-M18。
- 当前已完成 M19 Beta UX 产品化打磨。
- 当前已完成 M20 Search and Index UX。
- 当前已完成 M21 Story Bible Editing UX。
- 当前已完成 M22 Settings UX Completion。
- 当前已完成 M23 Studio UX Completion。
- 当前已完成 M24 工作流运行观测。
- 当前已完成 M25 工作流运行历史。
- 当前已完成 M26 工作流失败诊断与重试策略。
- 当前已完成 M28 全局功能可用性盘点。
- 当前已完成 M29 功能完成度盘点与命令面板执行闭环。
- 当前已完成 M30 底部面板工作区。
- 当前已完成 M31 搜索结果点击跳转。
- 当前已完成 M32 时间线主视图。
- 当前已完成 M33 插件管理 UI。
- 当前已完成 M34 多标签编辑器。
- 当前已完成 M35 宪法差距审计与路线图重排。
- 当前已完成 M36 Workspace Layout 与 M37 Editor Tabs。
- 当前已完成 M38 Autosave Recovery。
- 当前已完成 M39 Timeline Workspace。
- 当前已完成 M40 Project Health 与 M41 Command Palette。
- 当前已完成 M42 Plugin Management。
- 当前已完成 M43 Provider Matrix。
- 当前已完成 M44 Streaming UX 与 M45 Workflow Branch。
- 当前已完成 M46 Editor Hardening 与 M47 Multi-window Safety。
- 当前已完成 M48 Onboarding，M27 安装后首次使用引导缺口已回补。
- 当前已完成 M49 Recovery Review。
- 当前已完成 M50 User Preferences 与 M51 Recovery Hardening。
- 当前已完成 M52 Editor Runtime 与 M53 Workflow UX。
- 当前已完成 M54 Plugin Runtime RFC、M55 Editor Runtime Engine RFC 与 M56 Workflow Designer RFC。
- 当前已完成 M57 Plugin Runtime Host Commands 与 M58 Plugin Workflow Step Adapter。
- 当前已完成 M59 Editor Runtime Adapter 与 M60 Workflow Graph Projection。
- 当前已完成 M61 CodeMirror Adapter Flag 与 M62 Workflow Studio Graph Read-only View。
- 当前 `Complete` 只表示里程碑切片完成；产品完整度以 M35 的 `Product Ready` 口径为准。
- 未经用户确认不得 push。
- 当前本地 artifact 位于被忽略的 `release/` 目录，不提交到仓库。
