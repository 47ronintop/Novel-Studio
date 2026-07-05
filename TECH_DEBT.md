# TECH_DEBT - Novel Studio

Version: 1.0 | Status: Active

## Active Items

| ID     | Source                                     | Debt / Risk                                                                             | Impact                                       | Planned Resolution                                                     | Status |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| TD-005 | `ARCHITECTURE.md` 第 5/7 节                | Workflow Engine 位于 Agent Engine 下层，需要持续用接口和测试固化状态机边界              | 若团队误解，可能违反 P8 分层调用规则         | 用接口契约、import rules 和 package boundary tests 固化                | Open   |
| TD-007 | `DATA_SCHEMA.md` 第 20/21 节               | migration log 路径、项目锁、多窗口冲突策略尚未定稿                                      | 后续 Repository 并发和恢复策略可能受影响     | 后续 hardening 明确 locking、migration log 和冲突处理                  | Open   |
| TD-008 | `DATA_SCHEMA.md` 第 17 节                  | history 体积增长策略尚未量化                                                            | 长篇项目可能产生大量快照，影响 Git 体验      | 定义归档、压缩、手动保留策略；默认不得误删                             | Open   |
| TD-009 | `DATA_SCHEMA.md` 第 3/8/23 节              | M40 已加入初版 Project Health，但完整跨 JSON 文件引用图检查尚未落成                     | 引用失效会影响 UI、Context 和 AI workflow    | 后续增加 Repository integrity check 和完整引用图诊断                   | Open   |
| TD-010 | `UI_GUIDELINES.md` / `CODING_STANDARDS.md` | CodeMirror 6 方向已验证基础路径，但仍缺完整大文件和 diff 体验评估                       | 影响 Markdown 编辑、diff 审阅和性能体验      | 继续补齐 editor spike 的性能与交互结论                                 | Open   |
| TD-011 | `CODING_STANDARDS.md` 第 14 节             | shortcut registry 已有基础路径，但冲突矩阵尚未生成                                      | 系统快捷键和编辑器快捷键可能冲突             | 补充 shortcut conflict matrix 和自动化检查                             | Open   |
| TD-012 | `CODING_STANDARDS.md` 第 13 节             | UI 使用本地组件推进，但 headless primitive 库选择尚未最终定稿                           | 影响可访问性、表单和弹层一致性               | 根据 UI 扩展需要决定是否引入 headless primitive 库                     | Open   |
| TD-014 | `CODING_STANDARDS.md` 第 6 节              | 已有相对 import 限制和 package boundary tests，但 dedicated 工具未选型                  | 分层规则仍可能需要更强自动化检查             | 评估 ESLint boundaries 或 dependency graph 工具                        | Open   |
| TD-015 | `TESTING.md` 第 7/8 节                     | GitHub Actions 已建立，但 coverage threshold 尚未实现                                   | CI 能阻止回归，但不能提供覆盖率数字门槛      | 后续引入 coverage provider 并设置合理 threshold                        | Open   |
| TD-017 | `ROADMAP.md` M2/M3                         | JSON Schema 已落地；Repository 使用手写 DTO 接入，schema codegen 未选型                 | TS 类型未由 Schema 自动派生，长期可能漂移    | 先保持 contract tests，后续评估 codegen 是否值得引入                   | Open   |
| TD-018 | `ROADMAP.md` M6                            | 除 OpenAI-compatible 外的 provider fixtures 尚未准备                                    | 多 provider 扩展可能延迟                     | 后续 Provider 批次进入 roadmap 后补 fixtures 和 tests                  | Open   |
| TD-024 | `ROADMAP.md` M19-M34                       | 历史 `Complete` 容易被误解为产品完整，而实际多项能力仍是切片完成                        | 用户预期和软件真实完成度不一致               | M35 已建立 Product Ready 口径；后续里程碑必须引用缺口表                | Open   |
| TD-025 | `ROADMAP.md` M38                           | M38 只显示可恢复草稿并持久化 recovery record，尚未提供 apply/discard 审阅流             | 用户仍不能在 UI 中选择恢复或丢弃草稿         | 后续 recovery review 面板补齐内容预览、应用和清理策略                  | Open   |
| TD-026 | `ROADMAP.md` M39                           | M39 只展示结构化时间线事件，尚未提供事件级编辑、拖拽排序或正文双向定位                  | 时间线仍依赖 Story Bible 父资产编辑          | 后续 Timeline Workspace 迭代补齐事件表单、排序和跳转                   | Open   |
| TD-027 | `ROADMAP.md` M42 / `PLUGIN_SYSTEM.md`      | M42 已补 manifest 摘要与启停管理，但仍无插件安装、沙箱执行和 Workflow contribution 激活 | 插件系统仍只能管理本地注册声明，不能运行能力 | 后续 Plugin Runtime/Marketplace RFC 明确沙箱、权限审批和 workflow 接入 | Open   |

## Resolved Items

| ID     | Resolved In | Resolution                                                                                                                                                                                                                        |
| ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-001 | 2026-07-03  | 已删除 `PROJECT_CONSTITUTION.md` 中误粘贴的独立 `text` 段留。                                                                                                                                                                     |
| TD-002 | 2026-07-03  | 当前目录已确认为有效 Git 仓库，并已连接 `origin` 到 `https://github.com/47ronintop/Novel-Studio.git`。                                                                                                                            |
| TD-003 | 2026-07-03  | `ROADMAP.md` 已定义 Provider 实现顺序。                                                                                                                                                                                           |
| TD-004 | 2026-07-03  | `adr/ADR-0001-engine-runtime-language.md` 已明确 Core Engine 使用 TypeScript Strict，Python 仅限插件/外部工具边界。                                                                                                               |
| TD-006 | 2026-07-03  | 用户已发布初始提交到远端；本地 `main` 已跟踪 `origin/main`。                                                                                                                                                                      |
| TD-013 | 2026-07-03  | M1 已创建 npm workspaces、TypeScript strict、ESLint、Prettier、Vitest、Playwright 和 fixture 基础配置。                                                                                                                           |
| TD-016 | 2026-07-03  | 已创建初始文档提交，并完成 remote branch policy 闭环。                                                                                                                                                                            |
| TD-019 | 2026-07-03  | M2 已创建 15 类核心 JSON Schema、Ajv validation helper、valid/invalid fixtures 和 32 个 contract tests。                                                                                                                          |
| TD-020 | 2026-07-03  | M3 已创建 Repository Core：项目读取校验、原子写入、history snapshot、recovery record、cache clear guard 和对应 focused tests。                                                                                                    |
| TD-021 | 2026-07-04  | M11 已定位 `package:dir` 超时根因为默认 GitHub Electron runtime 下载源不可达，并配置 Electron mirror、单一输出目录和 artifact secret scan。                                                                                       |
| TD-023 | 2026-07-04  | M13 已增加真实 Electron Playwright smoke、GitHub Actions CI gate、package gate 和 M13 回归测试。                                                                                                                                  |
| TD-022 | 2026-07-05  | M17 added Windows NSIS installer configuration, app icon asset, schema-validated beta release channel, release notes, and unsigned local beta signing policy. Production signing/notarization remains future work outside TD-022. |
