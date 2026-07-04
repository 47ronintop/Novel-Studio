# Novel Studio Roadmap

Version: 1.1 | Status: Active | Last Updated: 2026-07-04

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

## M12 完成内容

- Repository 支持创建项目目录，并写入 `project.json` 与 `settings.json`。
- Repository 支持列出 chapters、创建 chapter Markdown，并按 `order` 排序。
- Application 新增 `ProjectWorkspaceSession`，支持 `open/create/list/createChapter/selectChapter`。
- `DesktopApplication` 将 project workspace 与 active chapter editor 串联。
- IPC/preload 暴露 project workflow allowlist channels，renderer 不直接访问文件系统。
- `WorkspaceShell` 增加项目路径输入、Open/Create/New Chapter 和章节选择列表。
- Renderer bridge 将 UI 操作转换为 preload API 调用，并刷新 shell/chapter editor。
- M12 tests 覆盖 Repository、Application、IPC/preload、renderer bridge 和 UI shell。

## 当前状态

- Phase 1-6 已完成。
- Phase 7 当前定义的 M0-M12 已完成。
- 当前没有未完成的既定步骤。
- 未经用户确认不得 push。

## 建议后续路线

| 下一步 | 名称                          | 作用                                                                                  |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| M13    | Real E2E and CI Gate          | 增加真实 Playwright e2e、GitHub Actions、coverage/packaging gate，锁住 M12 主流程     |
| M14    | AI Writing Workflow UX        | 把 Workflow/Context/Agent/LLM 串到 UI：生成建议、预览 diff、用户确认后应用            |
| M15    | Real Provider Profiles        | 接入真实模型配置和连接测试，优先 OpenAI Compatible/OpenAI/Ollama；CI 仍不调用真实模型 |
| M16    | Story Bible Modules           | 人物、世界观、大纲、时间线、记忆管理，给 Context Engine 提供高质量素材                |
| M17    | Installer and Release Channel | installer target、icon、签名、版本号、release notes、beta 发布流程                    |
| M18    | Plugin System                 | 插件接口、权限、隔离、插件目录或市场                                                  |

## 当前技术债重点

- 远端 CI、coverage threshold 和真实 Playwright smoke 尚未实现。
- Installer target、应用 icon、signing/notarization 和 release channel 尚未配置。
- schema codegen 和更强 dependency boundary 工具尚未最终选择。
- history 归档/压缩策略、项目锁、多窗口冲突处理仍需后续设计。
- 更多 Provider 的 fixtures 和 contract tests 需按批次补齐。
