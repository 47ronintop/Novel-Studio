# M48 Onboarding

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M48回补首次使用引导缺口，让用户打开软件后能在工作台内直接创建示例项目、创建新项目、打开已有项目或新建第一章。

## Scope

- 在工作区内新增“快速开始”面板。
- 提供创建示例项目、创建新项目、打开已有项目、新建第一章四个行动按钮。
- 示例项目通过现有 Project Workflow bridge 创建本地项目和示例章节。
- 空章节工作区新增“新建第一章”行动按钮。
- Electron E2E 覆盖从 onboarding 创建示例项目并读取落盘章节。

## Non-Goals

- 独立欢迎页或营销 landing page。
- 远程模板下载、云示例项目或模板市场。
- 持久化 onboarding dismissed 状态。
- AI 自动生成示例内容。

## Data Flow

Workspace onboarding button
-> renderer `ProjectWorkflowBridge`
-> preload `api.project.create` / `api.project.createChapter`
-> Application Project Workflow
-> Repository project folder writes
-> UI refreshes active project and chapter editor

## Acceptance

- 工作区显示“快速开始”引导，并保持第一屏仍是 IDE 工作台。
- 示例项目按钮能创建本地项目和示例章节。
- 创建/打开/新建章节行动复用现有安全边界。
- E2E 验证示例章节正文写入项目 `chapters/`。

## Changelog

- v1.0 - Completed workspace-native onboarding and example project quick start.
