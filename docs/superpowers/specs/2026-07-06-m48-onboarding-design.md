# M48 Onboarding Design Spec

## Scope

M48回补 M27 暂缓的安装后首次使用引导，但不做 marketing landing page。首屏仍是工作台；onboarding 作为工作区内的可操作引导面板出现，帮助用户完成创建示例项目、创建新项目、打开已有项目和新建第一章。

## Design

`WorkspaceShell` 接收一个可选 `onboarding` DTO。它包含可见状态、步骤完成状态和四个行动回调：创建示例项目、创建新项目、打开项目、新建第一章。UI 只调用回调，不直接访问文件系统，符合 P8 分层边界。

`ProjectWorkflowBridge` 新增 `createExampleProject()`。它复用现有目录选择/输入路径策略和 `api.project.create()`，创建一个普通 local-first 项目，然后立即通过 `api.project.createChapter()` 写入示例章节。示例内容是普通 Markdown 章节正文，不新增模板系统、不新增模型调用、不上传数据。

`App` 负责把 onboarding DTO 组装到 UI。M48 的 dismissed 状态只保存在 renderer 运行期内，避免在未设计 schema 前写项目文件。后续如果需要持久化欢迎状态，应先补 settings schema 或 user preferences 设计。

## Non-Goals

- 不做独立欢迎页或营销式 landing page。
- 不新增官方云模板或远程示例项目下载。
- 不新增项目模板市场。
- 不持久化 onboarding dismissed 状态。
- 不调用真实模型生成示例内容。

## Acceptance

- 工作区能显示“快速开始”引导面板和明确的创建/打开/示例/新建章节行动按钮。
- 示例项目按钮通过 renderer bridge 创建项目并创建示例章节。
- 空章节状态提供新建章节行动按钮。
- Electron E2E 能用临时目录创建示例项目并看到示例章节正文。
- 所有项目创建仍通过 preload/IPC/Application/Repository 边界。

## Changelog

- v1.0 - Initial M48 onboarding design.
