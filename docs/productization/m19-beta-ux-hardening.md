# M19 Beta UX 产品化打磨

Version: 1.0 | Status: Complete | Phase: Post-M18 Productization

## 目标

M19 解决安装版启动后“看得到进程和窗口，但像半成品、很多入口不可点击、菜单仍是英文”的 beta 体验问题。它不扩展新的 AI 能力、不改变项目数据结构、不新增真实模型调用，而是把 M0-M18 已完成的核心能力包装成安装后可理解、可点击、可验证的桌面软件入口。

## 范围

M19 包含：

- 左侧 Activity Bar 可点击，并能切换 Workspace、Search、Timeline、AI、Studio、Settings 六个主入口。
- 顶部 Electron 应用菜单本地化为中文，避免暴露默认英文菜单。
- 工作区主要可见 UI 文案中文化，技术 ID、provider ID、schema ID 和日志 code 保持英文。
- 未完成的功能入口显示明确中文空状态，不再表现为无响应按钮。
- 继续保持 renderer 不直接访问文件系统，项目选择仍经由 preload 与 main-process IPC。
- AI 写入仍保持建议态，用户确认前不得修改正式项目资产。

M19 不包含：

- 插件市场、云发布、自动更新托管或安装包签名。
- 新的模型 provider 接入。
- 复杂搜索索引、可视化时间线编辑器或完整 Studio 表单重做。
- 项目文件 schema 变更。

## 设计边界

Activity Bar 的选中状态先保存在 renderer shell state 中，不写入项目文件，也不新增持久化 schema。切换非 Workspace 入口时，UI 显示对应主视图的中文空状态或当前已有能力入口；Workspace 仍显示项目导航、章节编辑器、Inspector 与底部面板。

Electron 菜单由 main process 构建，使用标准 role 保留复制、粘贴、撤销、缩放、开发者工具等桌面行为。菜单项不直接读取项目文件；后续如果菜单项需要触发项目命令，必须继续走 Application IPC allowlist。

本地化采用当前阶段的显式中文文案映射，不引入完整 i18n 框架。等 UI 面积扩大到多语言切换需求时，再单独设计 i18n 资源结构。

## 验收标准

- 点击左侧六个 Activity Bar 图标时，选中态移动，并且主区域显示对应中文视图。
- Search、Timeline、Studio、Settings 至少有中文空状态和下一步入口提示；AI 入口能显示当前 AI Workflow 控制区。
- 顶部应用菜单显示 `文件`、`编辑`、`视图`、`窗口`、`帮助`。
- `WorkspaceShell` component tests 覆盖中文标签、Activity click callback、active `aria-current` 和非 Workspace 空状态。
- main process menu builder 测试覆盖中文顶级菜单。
- Electron E2E 覆盖左栏点击后视图切换。
- `format`、`typecheck`、`lint`、unit tests、contract tests、E2E 和 package checks 继续通过。

## 风险与后续

M19 只让入口可点击、可理解，不代表 Search、Timeline、Studio、Settings 的完整业务闭环已全部实现。后续应继续拆分：

- M20 Search and Index UX：项目全文搜索与可重建索引。
- M21 Story Bible Editing UX：人物、世界观、大纲、时间线和记忆的完整编辑表单。（已完成）
- M22 Settings UX Completion：模型 profile、快捷键、插件和隐私设置的完整界面。
