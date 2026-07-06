# M35 宪法差距审计与路线图重排

版本：1.0 | 状态：M35 已采纳 | 阶段：Post-M18 产品化打磨

## 目标

M35 修正 M19-M34 后暴露的核心问题：路线图里的 `Complete` 表示“该里程碑切片完成”，但用户打开软件时会把它理解为“该能力已经产品级完整”。这种口径会掩盖 `PROJECT_CONSTITUTION.md` 第11节 UI/UX 要求、第5节数据完整性要求和第14节 Definition of Done 中仍未闭环的能力。

M35 不继续堆新 UI。它先建立一个宪法对齐的完成度审计，把“已具备主干闭环”和“仍未达到产品承诺”分开记录，并给 M36 之后的开发排序。

## 完成度口径

后续 ROADMAP 使用以下口径解释状态：

| 状态           | 含义                                         | 是否可称为产品完整   |
| -------------- | -------------------------------------------- | -------------------- |
| Complete       | 当前里程碑定义的设计、实现、测试和文档已完成 | 仅对该里程碑切片成立 |
| Slice Complete | 主干路径可用，但文档承诺的完整能力仍有缺口   | 否                   |
| Product Gap    | 与宪法、PRD 或 UI 指南存在明确差距           | 否                   |
| Deferred       | 有意暂缓，等待前置能力稳定                   | 否                   |
| Product Ready  | 能力达到文档承诺、测试覆盖和用户体验闭环     | 是                   |

M0-M34 当前应理解为：基础架构和多个产品化切片已完成，但 Novel Studio 仍处于 beta 产品化阶段，不能被描述为商业级完整体。

## 宪法差距审计

| 能力域                                  | 依据                                                                            | 当前状态                                                                              | 差距                                                                                               | 建议里程碑                        |
| --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| Dock Layout / Split View / 可拖拽 Panel | `PROJECT_CONSTITUTION.md` 第11节，`UI_GUIDELINES.md` 第4/7节                    | 只有固定工作区、Inspector、底部面板和章节标签切换                                     | 缺 Split View、可拖拽/可调整面板、布局持久化                                                       | M36 Workspace Layout              |
| 多 Tab                                  | `PROJECT_CONSTITUTION.md` 第11节，`docs/productization/m34-multi-tab-editor.md` | 章节标签可点击切换                                                                    | 缺持久打开集合、关闭 tab、dirty tab 提示、跨资产 tab                                               | M37 Editor Tabs                   |
| 自动保存与崩溃恢复 UI                   | `PROJECT_CONSTITUTION.md` 第5节，`UI_GUIDELINES.md` 第5.2节                     | M38 已写入 recovery record 并显示提示；M49 已补预览、应用和丢弃闭环                   | 仍缺可配置间隔、file-ref recovery、恢复记录归档/清理策略和 stale-lock recovery UI                  | M49 完成，后续 Recovery Hardening |
| 时间线                                  | `UI_GUIDELINES.md` 第5.3节，`docs/productization/m32-timeline-main-view.md`     | 时间线主视图列出条目并跳到 Story Bible                                                | 缺可视化时间轴、排序、结构化事件字段、正文双向定位                                                 | M39 Timeline Workspace            |
| 问题面板 / 项目健康                     | `UI_GUIDELINES.md` 第5.1/4节，TECH_DEBT TD-009                                  | 底部“问题”面板只有最小内容                                                            | 缺 schema/cache/history/recovery/reference integrity 真实诊断                                      | M40 Project Health                |
| 命令面板                                | `PROJECT_CONSTITUTION.md` 第11节，M29                                           | 可打开并执行少量 safe command                                                         | 缺搜索过滤、键盘上下选择、分组、错误通知                                                           | M41 Command Palette               |
| 插件系统                                | `PROJECT_CONSTITUTION.md` 第10节，`PLUGIN_SYSTEM.md`                            | Manifest/registry/permission engine、manifest 摘要读取、启停管理和权限详情 UI 已有    | 仍缺安装/更新、沙箱执行、Workflow 接入 UI                                                          | M42 完成，后续 Plugin Runtime/RFC |
| LLM Provider 覆盖                       | `PROJECT_CONSTITUTION.md` 第3节，TECH_DEBT TD-018                               | M43 已覆盖完整 provider 配置矩阵、schema 校验和 UI 选项                               | 仍缺多数 provider 的 runtime translator、离线响应 fixture 和可选 live benchmark                    | M43 完成，后续 LLM Adapter 批次   |
| OpenAI-compatible Streaming             | `PROJECT_CONSTITUTION.md` 第3节                                                 | M44 已补 OpenAI-compatible streaming fixture 契约、delta/usage 解析和 UI 流式预览状态 | 仍缺真实 Electron IPC live streaming、AbortController 取消传播和其他 provider streaming translator | M44 完成，后续 Streaming Runtime  |
| Workflow Branch                         | `DATA_SCHEMA.md` / `WORKFLOW_ENGINE.md`                                         | M45 已补 `choose-branch` action、`chooseWorkflowBranch()`、branch schema/fixture 契约 | 仍缺条件表达式执行、Agent 自动分支决策和 workflow graph UI                                         | M45 完成，后续 Workflow UX        |
| 编辑器体验                              | `UI_GUIDELINES.md` 第5.2节，TECH_DEBT TD-010                                    | M46 已补文档指标、large-document mode、gutter 上限、diff 摘要和快捷键冲突矩阵         | 仍缺 CodeMirror 替换、完整 visual diff editor 和用户可编辑快捷键注册表                             | M46 完成，后续 Editor Runtime     |
| 多窗口与项目锁                          | `PROJECT_CONSTITUTION.md` 第11节，TECH_DEBT TD-007                              | M47 已补本地项目锁、锁冲突检测、Application 激活前锁获取和 Project Health lock 信号   | 仍缺 stale-lock recovery UI、完整多窗口状态编排和异常退出后的用户确认恢复流程                      | M47 完成，后续 Multi-window UX    |
| 首次使用引导                            | ROADMAP M27 / M48                                                               | M48 已补工作区快速开始、示例项目入口、创建/打开项目引导和第一章行动按钮               | dismissed 状态尚未持久化；后续需决定是否进入 User Preferences schema                               | M48 完成，后续 Preferences        |

## 重新排序后的下一步

M36 应优先做 Workspace Layout，而不是项目健康检查或首次使用引导。原因：

- 这是用户最容易直接看到的 UI 差距。
- 它直接回应 `PROJECT_CONSTITUTION.md` 第11节。
- 它是 Split View、跨资产 tab、Inspector、底部面板和后续编辑器体验的布局基础。
- 如果布局状态不先稳定，后续时间线、插件、问题面板都会继续堆在同一个大组件里。

建议顺序：

1. M36 Workspace Layout：Split View、面板宽度调整、布局状态持久化的最小闭环。
2. M37 Editor Tabs：持久打开集合、关闭 tab、dirty 标记和跨资产 tab。
3. M38/M49 Autosave Recovery：自动保存恢复记录、恢复提示、预览、应用和丢弃闭环。
4. M39 Timeline Workspace：时间线可视化编辑和排序。
5. M40 Project Health：真实问题面板、引用完整性和 cache/history/recovery 健康检查。
6. M41 Command Palette：搜索、键盘选择、分组和错误反馈。
7. M42 Plugin Management：插件 manifest 读取、启停和权限详情；安装/运行时能力转入后续 Plugin Runtime/RFC。
8. M43-M47：Provider、Streaming、Workflow、Editor、多窗口安全已完成首轮补齐。
9. M48 Onboarding：已在核心入口稳定后回补 M27。
10. M50+：User Preferences、Recovery Hardening、Editor Runtime、Workflow UX 和 Plugin Runtime 按 Product Ready 口径继续推进。

## 风险与约束

- M35 不改变代码，所以不会直接改善用户当前打开的软件。
- ROADMAP 仍保留历史里程碑的 `Complete`，但必须解释为切片完成，避免和 Product Ready 混淆。
- 后续每个产品化里程碑必须说明它关闭哪个宪法/PRD/UI 指南缺口。
- 若后续发现 M36 需要跨 Repository/Application/UI 的状态持久化，应先写设计规格，不得直接在 `WorkspaceShell` 内堆状态。

## 验收标准

- M35 文档存在并列出宪法差距、完成度口径和 M36+ 排序。
- `ROADMAP.md`、`INDEX.md`、`CHANGELOG.md` 和 `TECH_DEBT.md` 同步 M35。
- 不新增业务代码，不新增真实模型调用，不修改发布产物。
- `npm run format` 通过。
