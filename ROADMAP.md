# Novel Studio Roadmap

Version: 1.4 | Status: Active | Last Updated: 2026-07-05

## 目标

Novel Studio v1 是一个 local-first、project-based 的 AI 小说创作 IDE。核心目标是可靠管理项目文件、章节编辑、版本历史、可控 AI workflow、模型配置和桌面写作工作区。

项目文件以 Markdown/JSON 为 source of truth；SQLite 只能作为 `cache/` 下可重建索引层。所有核心运行时代码使用 TypeScript Strict。

## 已完成里程碑

| Milestone | 名称                            | 作用                                                                   | 状态     |
| --------- | ------------------------------- | ---------------------------------------------------------------------- | -------- |
| M0        | Repository Baseline             | 建立仓库、文档 baseline、分支纪律                                      | Complete |
| M1        | Toolchain Foundation            | 建立 npm workspaces、TypeScript strict、lint、format、test             | Complete |
| M2        | Schema Foundation               | 建立 JSON Schema、fixtures、contract tests                             | Complete |
| M3        | Repository Core                 | 项目读取、原子写入、history、recovery、cache 边界                      | Complete |
| M4        | Desktop Shell                   | Electron/React shell、IPC 安全边界、基础工作区 UI                      | Complete |
| M5        | Editor and Version UX           | 章节编辑、保存状态、版本历史、diff/restore 基础                        | Complete |
| M6        | LLM Adapter                     | Provider-neutral LLM Adapter、mock provider、OpenAI-compatible fixture | Complete |
| M7        | Agent/Context/Workflow          | Workflow 状态机、Context Engine、Agent Engine                          | Complete |
| M8        | Studio and Settings             | 模型设置、Prompt/Agent/Workflow 编辑和回滚                             | Complete |
| M9        | Hardening and Alpha             | 可访问性、性能 fixture、alpha gate、secret scan                        | Complete |
| M10       | Beta Packaging Foundation       | Vite renderer bundle、electron-builder 配置、package preflight         | Complete |
| M11       | Package Artifact Stabilization  | 稳定 `package:dir`、unpacked artifact、artifact secret scan            | Complete |
| M12       | Project Workflow Vertical Slice | 创建/打开项目、章节管理、编辑保存、版本回滚的可用闭环                  | Complete |
| M13       | Real E2E and CI Gate            | 真实 Electron E2E smoke、GitHub Actions、packaging gate                | Complete |
| M14       | AI Writing Workflow UX          | 生成 AI 写作建议、预览 diff、用户确认后应用到章节编辑器                | Complete |
| M15       | Real Provider Profiles          | 真实模型 profile 配置、secret ref 校验、离线连接测试和运行时解析       | Complete |

## M15 完成内容

- settings schema 将首批可配置 provider 收敛为 `openai-compatible`、`openai`、`ollama`，并继续拒绝明文 `apiKey`。
- Application 层新增 profile 保存校验：不支持 provider 或非 `secret://` 密钥引用会在写入前失败，错误信息保持脱敏。
- 新增默认 model profile 运行时解析，将项目 `settings.json` 的默认 profile 转换为 LLM Adapter 的 `modelProfile` 和生成参数。
- AI writing workflow 支持生成时动态解析 runtime profile，避免切换默认模型后仍使用旧配置。
- Desktop 组合接入项目 `settings.json` 的 ModelSettingsSession，支持通过 IPC 列出、保存、设为默认和测试 profile。
- 连接测试继续通过依赖注入执行；CI 和默认桌面 AI workflow 仍不访问真实模型 endpoint。

## 当前状态

- Phase 1-6 已完成。
- Phase 7 当前定义的 M0-M15 已完成。
- 下一步建议进入 M16：Story Bible Modules。
- 未经用户确认不得 push。

## 建议后续路线

| 下一步 | 名称                          | 作用                                                                   |
| ------ | ----------------------------- | ---------------------------------------------------------------------- |
| M16    | Story Bible Modules           | 人物、世界观、大纲、时间线、记忆管理，给 Context Engine 提供高质量素材 |
| M17    | Installer and Release Channel | installer target、icon、签名、版本号、release notes、beta 发布流程     |
| M18    | Plugin System                 | 插件接口、权限、隔离、插件目录或市场                                   |

## 当前技术债重点

- coverage threshold 尚未实现；当前 CI 已覆盖测试门禁，但没有数字覆盖率门槛。
- Installer target、应用 icon、signing/notarization 和 release channel 尚未配置。
- schema codegen 和更强 dependency boundary 工具尚未最终选择。
- history 归档/压缩策略、项目锁、多窗口冲突处理仍需后续设计。
- 更多 Provider 的 fixtures 和 contract tests 需按批次补齐。
