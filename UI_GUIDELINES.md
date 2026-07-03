# UI GUIDELINES — Novel Studio
Version: 1.0 | Status: Draft for Review | Phase: 4 UI/UX Design

## 1. 文档目的

本文定义 Novel Studio v1 的 UI/UX 设计原则、信息架构、布局系统、核心界面、交互规范、设计 token、可访问性、状态设计、响应式策略与风险边界。本文受 `PROJECT_CONSTITUTION.md`、`PRODUCT_PRD.md`、`ARCHITECTURE.md` 和 `DATA_SCHEMA.md` 约束。

本文不编写业务代码，不定义最终组件实现 API，不进入开发规范或任务拆分。

## 2. 产品体验定位

Novel Studio 是专业创作 IDE，不是聊天产品、营销页面或一键生成工具。v1 UI 应像长期工作台：安静、高密度、键盘优先、低干扰、可审计、可恢复。

参考气质：

- Cursor：AI 与编辑器共存，但编辑器仍是主角。
- VS Code：Dock、Panel、Command Palette、快捷键、可扩展。
- Obsidian：本地知识库、文件可见、创作资产可链接。
- Linear：信息密度、状态表达、响应速度和克制视觉。
- Raycast：命令入口清晰，键盘操作快速。

设计场景句：作者在夜间或长时间写作环境中维护百万字项目，需要在章节、设定、时间线和 AI 建议之间快速切换，界面应像低眩光编辑室，而不是展示型网站。

## 3. UX 原则

- 写作优先：章节编辑区域永远是主工作面，不被 AI 面板、装饰或导航抢占。
- 项目优先：导航围绕项目资产，而不是聊天会话（P2）。
- 用户最终确认：AI 结果默认是建议态，正式写入前必须由用户确认（P1）。
- 可解释：AI 结果必须能查看上下文来源、模型配置、token/成本和结构化输出。
- 可恢复：保存、恢复、版本历史和回滚入口必须可见但不打扰。
- 可编辑：Prompt、Agent、Workflow、Context 策略和模型配置在 UI 中可被找到、编辑、校验和回滚（P3）。
- 模型无关：模型配置 UI 不暗示任何单一供应商优先（P4）。
- 键盘优先：高频操作必须可通过 Command Palette 或快捷键完成。

## 4. 信息架构

主界面由六个区域组成：

```text
┌──────────────────────────────────────────────────────────────┐
│ Title Bar / Command Center / Project Status                  │
├──────────────┬───────────────────────────────┬───────────────┤
│ Activity Bar │ Editor Area                   │ Inspector     │
│ + Navigator  │ Tabs + Split View             │ Context/Meta  │
│              │ Chapter / Asset / Config      │ History/AI    │
├──────────────┴───────────────────────────────┴───────────────┤
│ Bottom Panel: Workflow Run / Problems / Search / Logs        │
└──────────────────────────────────────────────────────────────┘
```

区域职责：

- Title Bar / Command Center：项目名、全局搜索、Command Palette、模型状态、保存状态。
- Activity Bar：Workspace、Search、Timeline、AI Workflow、Prompt/Agent/Workflow Studio、Settings。
- Navigator：项目树、章节树、人物、世界观、大纲、时间线、记忆。
- Editor Area：章节编辑器、多 Tab、Split View、资产编辑器、配置编辑器。
- Inspector：当前文档元数据、版本历史、上下文来源、AI 结果、引用关系。
- Bottom Panel：Workflow 运行、问题诊断、全文搜索、可审计日志。

## 5. 核心界面

### 5.1 Project Home

目的：打开项目后的状态总览，而不是营销欢迎页。

内容：

- 最近编辑章节。
- 项目字数、章节数、未解决一致性问题数。
- 最近 AI Workflow 运行记录。
- 数据健康状态：Schema、cache、history、recovery。
- 快捷动作：继续写作、运行审稿、打开 Command Palette。

不得出现：

- 大面积 hero。
- 装饰卡片堆叠。
- 与当前项目无关的宣传文案。

### 5.2 Writing Workspace

编辑器布局：

- 中央为 Markdown 编辑器。
- 顶部 Tab 显示章节、资产、配置文件。
- 右侧 Inspector 默认显示章节元数据和版本状态。
- AI 建议以可接受/拒绝的 diff 或 patch 形式呈现。

写作状态：

- `Saved`
- `Saving`
- `Unsaved`
- `Recovery available`
- `Snapshot created`
- `Conflict detected`

原则：

- 保存状态必须明确，但不能频繁闪烁。
- 自动保存不应抢焦点。
- 版本回滚必须有预览和确认。

### 5.3 Story Asset Workspace

用于人物、世界观、大纲、时间线、记忆。

结构：

- 左侧资产列表。
- 中央结构化表单/Markdown 说明。
- 右侧引用关系、出场章节、最近修改。

要求：

- 人物、地点、时间线之间的引用必须可点击。
- 缺失引用显示为诊断问题，不直接删除。
- AI 建议新增设定时必须以建议态显示。

### 5.4 AI Workflow Panel

用于运行、观察和审计 AI 工作流。

必须显示：

- Workflow 名称与步骤。
- 当前步骤状态。
- 使用的 Agent。
- Context Bundle 摘要。
- 模型 Profile。
- token 估算/实际使用。
- 成本估算。
- 结构化输出。
- 用户确认入口。

状态：

- `idle`
- `building-context`
- `waiting-model`
- `streaming-preview`
- `validating-output`
- `needs-user-confirmation`
- `applied`
- `failed`

流式 token 只用于过程展示，不作为 Agent handoff 契约（P9）。

### 5.5 Prompt / Agent / Workflow Studio

这是高级用户编辑创作系统的地方。

布局：

- 左侧配置资产列表。
- 中央编辑器。
- 右侧 Schema 校验、版本历史、依赖关系。
- 底部测试运行结果。

要求：

- 保存前校验。
- 无效配置不得激活。
- 回滚入口必须可见。
- 版本差异以结构化 diff 显示。

### 5.6 Settings

设置分区：

- Project
- Autosave & History
- Model Profiles
- Privacy & Security
- Keyboard Shortcuts
- Plugins
- Advanced

密钥规则：

- API Key 使用密钥引用，不展示明文。
- 提供“测试连接”按钮。
- 日志与错误不得展示明文密钥。

## 6. Navigation Model

### 6.1 Activity Bar

固定主入口：

- Workspace
- Search
- Timeline
- AI
- Studio
- Settings

使用图标 + tooltip；当前项高亮。Activity Bar 不使用彩色装饰，只使用状态点或选中指示。

### 6.2 Navigator

Navigator 是项目资产树：

```text
Project
├── Chapters
├── Characters
├── World
├── Outline
├── Timeline
├── Memories
├── Prompts
├── Agents
└── Workflows
```

规则：

- 支持搜索和过滤。
- 支持折叠/展开。
- 右键或更多菜单提供低频操作。
- 删除或归档必须进入确认流程。

### 6.3 Command Palette

Command Palette 是键盘优先入口。

命令类别：

- Open asset
- Run workflow
- Search project
- Create asset
- Toggle panel
- Switch model profile
- Show history
- Restore recovery draft

要求：

- `Ctrl/Cmd + K` 打开。
- 支持模糊搜索。
- 每条命令显示名称、范围、快捷键、风险等级。
- 危险命令必须二次确认。

## 7. Layout and Density

### 7.1 Desktop First

v1 聚焦 Electron 桌面端。目标窗口：

- 最小可用宽度：1280px。
- 推荐宽度：1440px 以上。
- 小窗口时侧栏可折叠，Inspector 可进入底部或临时覆盖层。

### 7.2 Panel Widths

建议默认值：

- Activity Bar：48px。
- Navigator：260px，范围 220-420px。
- Inspector：320px，范围 280-520px。
- Bottom Panel：默认 260px 高，可折叠。
- Editor 最大正文行长：72-82 字符，正文区域居中但不做卡片包装。

### 7.3 Split View

Split View 支持：

- 章节 + 人物。
- 章节 + 世界观。
- 章节 + AI 建议。
- Prompt + 测试输出。
- Workflow + 运行 trace。

不得将多个大面板嵌套成卡片套卡片。面板是布局区域，卡片只用于列表项、弹层和重复实体摘要。

## 8. Visual System

### 8.1 Color Strategy

策略：Restrained product UI。深色模式优先，低眩光，中性表面，teal 作为主行动与选中状态，amber 作为少量注意/警告/版本提示。避免紫蓝渐变、米色纸张、深蓝单调、咖啡棕调。

基础 palette 使用 OKLCH：

```css
:root {
  --ns-bg: oklch(0.105 0.000 0);
  --ns-surface: oklch(0.155 0.006 180);
  --ns-surface-raised: oklch(0.205 0.008 180);
  --ns-border: oklch(0.300 0.010 180);
  --ns-ink: oklch(0.920 0.006 180);
  --ns-muted: oklch(0.690 0.010 180);
  --ns-primary: oklch(0.620 0.110 180);
  --ns-primary-strong: oklch(0.700 0.130 180);
  --ns-accent: oklch(0.720 0.120 75);
  --ns-danger: oklch(0.650 0.170 28);
  --ns-warning: oklch(0.760 0.130 80);
  --ns-success: oklch(0.670 0.120 150);
  --ns-info: oklch(0.680 0.110 230);
}
```

Usage：

- Primary：主按钮、当前选中、焦点环、活动状态。
- Accent：版本提示、重要但非危险的状态、少量标记。
- Danger：删除、密钥错误、不可恢复操作。
- Warning：Schema 迁移、引用缺失、恢复草稿。
- Success：保存成功、校验通过。
- Info：模型连接、索引状态。

### 8.2 Light Mode

Light mode 必须支持，但不是默认优先。

```css
:root[data-theme="light"] {
  --ns-bg: oklch(1.000 0.000 0);
  --ns-surface: oklch(0.970 0.004 180);
  --ns-surface-raised: oklch(0.940 0.006 180);
  --ns-border: oklch(0.820 0.010 180);
  --ns-ink: oklch(0.180 0.010 180);
  --ns-muted: oklch(0.430 0.012 180);
  --ns-primary: oklch(0.500 0.105 180);
  --ns-primary-strong: oklch(0.430 0.120 180);
  --ns-accent: oklch(0.570 0.130 75);
}
```

### 8.3 Typography

字体策略：

- UI：Inter / system-ui / Segoe UI / sans-serif。
- Editor：用户可选，默认使用清晰长文阅读字体；中文环境优先系统中文字体。
- Monospace：JetBrains Mono / SFMono-Regular / Consolas / monospace。

字号建议：

- UI label：12px。
- Body/UI text：13px。
- Dense list：12px。
- Editor body：16px。
- Document title：18px。
- Panel heading：13px semibold。

规则：

- 产品 UI 不使用 display font。
- 不使用流式 viewport 字号。
- 标题不使用负 letter spacing。
- 长文正文行高建议 1.65，UI 行高建议 1.35-1.45。

### 8.4 Shape and Borders

- 面板半径：0-6px。
- 卡片半径：6-8px。
- 按钮半径：6px。
- 输入框半径：6px。
- 弹层半径：8px。

禁止：

- 32px 以上过度圆角卡片。
- border + 大模糊 shadow 的 ghost-card 模式。
- 彩色粗侧边框作为默认强调。
- 装饰性玻璃拟态。

### 8.5 Icons

实现阶段使用 lucide icons 或等价一致图标库。

规则：

- 工具按钮优先使用图标。
- 不熟悉图标必须有 tooltip。
- 图标尺寸：16px 默认，Activity Bar 18-20px。
- 不手绘临时 SVG 作为图标系统。

## 9. Components

### 9.1 Buttons

类型：

- Primary：执行主要动作，如 Apply、Run、Save。
- Secondary：普通动作。
- Ghost：工具栏图标按钮。
- Danger：删除、清理、撤销不可逆动作。

状态：

- default
- hover
- focus
- active
- disabled
- loading

规则：

- 按钮文字不得溢出。
- 危险按钮默认不使用饱和大面积红色，确认态才增强。
- 图标按钮必须有 tooltip 和 accessible label。

### 9.2 Tabs

Tabs 用于 Editor Area 中打开的章节、资产和配置。

要求：

- 显示 dirty 状态。
- 支持关闭。
- 支持最近使用排序。
- 文件不存在或引用失效时显示诊断状态。

### 9.3 Forms

用于结构化资产和设置。

要求：

- 标签固定左对齐或顶部对齐，按密度选择。
- 错误信息靠近字段。
- 高级字段可折叠。
- 不用 modal 承载长表单。

### 9.4 Tables and Lists

用于角色列表、Workflow run、版本历史、问题诊断。

要求：

- 支持排序、过滤、键盘选择。
- 行高紧凑但可读，默认 32-36px。
- 空态解释下一步，不只是“无数据”。

### 9.5 Diff and Review

AI 修改建议必须以 diff 或 patch 审阅方式呈现。

要求：

- 支持逐块接受/拒绝。
- 支持查看原文、建议和理由。
- 应用前创建 `before-ai-apply` 版本快照。

## 10. State Design

### 10.1 Loading

- 面板级加载使用 skeleton。
- Workflow 步骤使用状态行。
- 不在大面积编辑器中央长期显示 spinner。

### 10.2 Empty States

空态必须给出可执行下一步：

- 无章节：创建第一章、导入 Markdown。
- 无人物：创建角色、从章节提取候选角色。
- 无模型：添加模型 Profile、导入 OpenAI Compatible 配置。
- 无历史：说明历史会在保存或手动打点后出现。

### 10.3 Error States

错误展示遵循 Unified Error：

- stable code。
- 人类可读 message。
- suggested action。
- trace id。
- 详情可展开，敏感内容脱敏。

### 10.4 Conflict States

冲突包括：

- 文件被外部修改。
- 引用资产缺失。
- Schema 版本不兼容。
- Workflow 输出校验失败。
- 恢复草稿与当前正文冲突。

冲突解决必须给预览，不得静默覆盖。

## 11. AI Interaction UX

### 11.1 AI Result Model

AI 输出分三层：

- Preview：流式展示，可中断，不作为正式契约。
- Structured Result：Schema 校验后的 JSON，作为审计对象。
- Apply Candidate：用户可接受/拒绝的写入建议。

### 11.2 Context Trace

每次 AI 运行必须能查看：

- 使用的章节片段。
- 使用的人物/世界观/时间线/记忆。
- 被排除的候选上下文及原因。
- token budget。
- 模型 Profile。
- Agent 和 Workflow Step。

### 11.3 Trust Controls

必须提供：

- 停止生成。
- 重新运行。
- 改用模型。
- 查看原始结构化结果。
- 应用/部分应用/拒绝。
- 写入前版本快照提示。

## 12. Keyboard and Shortcuts

默认快捷键建议：

| Action | Shortcut |
|---|---|
| Command Palette | Ctrl/Cmd + K |
| Quick Open | Ctrl/Cmd + P |
| Save | Ctrl/Cmd + S |
| New Chapter | Ctrl/Cmd + N |
| Run Current Workflow | Ctrl/Cmd + Enter |
| Toggle Navigator | Ctrl/Cmd + B |
| Toggle Inspector | Ctrl/Cmd + Shift + I |
| Search Project | Ctrl/Cmd + Shift + F |
| Show Version History | Ctrl/Cmd + Shift + H |

规则：

- 快捷键必须可配置。
- 冲突快捷键在设置中诊断。
- 菜单项显示快捷键。

## 13. Accessibility

最低要求：

- 正文和 UI 文本对比度满足 WCAG AA，正文目标达到更高对比。
- 所有交互控件可键盘访问。
- Focus ring 明显，不只依赖颜色。
- 图标按钮有 accessible label。
- 状态变化有文本表达。
- 支持 reduced motion。
- 不用颜色作为唯一状态信号。

## 14. Motion

原则：动作表达状态，不做装饰。

允许：

- 面板打开/关闭 150-220ms。
- Command Palette 淡入/轻微位移 120-160ms。
- 保存状态切换 crossfade。
- Workflow step 状态进度过渡。

禁止：

- 页面加载编排动画。
- 编辑器内容进入动画。
- 装饰性粒子、渐变漂移、玻璃模糊动效。

Reduced motion：

- 所有动画必须有 `prefers-reduced-motion` 替代。

## 15. Responsive and Multi-window

v1 以桌面为主，但必须支持小窗口。

响应策略：

- 1280px 以下：Inspector 默认折叠。
- 1100px 以下：Navigator 可 overlay，Editor 保持可用。
- 900px 以下：进入紧凑模式，仅保证基础编辑、保存、Command Palette。

多窗口：

- 每个窗口显示项目和当前文件状态。
- 文件冲突必须可见。
- 同一项目多窗口编辑需配合 Repository 锁/冲突检测，具体实现后续定义。

## 16. Onboarding

首次体验目标：让用户创建项目并开始写作，不要求理解 Agent 系统。

流程：

1. 创建/打开项目。
2. 选择作品类型和保存位置。
3. 可选配置模型。
4. 创建第一章或导入 Markdown。
5. 进入 Writing Workspace。

原则：

- 模型配置可跳过。
- Prompt/Agent/Workflow Studio 不在首次流程强推。
- 示例项目可作为学习材料，但不得上传用户数据。

## 17. Data and UX Mapping

UI 与数据结构映射：

- `chapters/*.md` → Writing Workspace + Tabs + Version History。
- `characters/*.json` → Character editor + relationship panel。
- `world/**/*.json` → World editor + references。
- `timeline/events.json` → Timeline view。
- `memories/**/*.json` → Memory panel + Context eligibility。
- `prompts/*.json` → Prompt Studio。
- `agents/*.json` → Agent Studio。
- `workflow/*.json` → Workflow Studio。
- `history/**` → Version History + Recovery。
- `cache/**` → Index health，默认不直接暴露给普通用户。

## 18. Data Flow

### 18.1 编辑章节

```text
User types
→ Editor dirty state
→ autosave indicator
→ Repository save result
→ version/recovery state update
→ UI status line
```

### 18.2 应用 AI 建议

```text
Workflow result
→ structured validation display
→ diff preview
→ user accepts selected changes
→ before-ai-apply snapshot notice
→ updated chapter / asset
```

### 18.3 查看上下文

```text
AI run
→ Context Trace
→ Inspector sections
→ source refs open in split view
→ user adjusts context policy later in Studio
```

## 19. Module Relationship

UI 模块与架构模块关系：

- Workspace Shell 调用 Application Layer，不访问文件系统。
- Navigator 展示 Repository 读取后的 DTO，不直接扫描项目文件。
- Editor 通过 Application 用例保存，不直接写 `chapters/`。
- Inspector 展示 metadata、history、context trace、error DTO。
- AI Workflow Panel 只控制 Workflow 用例，不直接调用 LLM Adapter。
- Studio 编辑 Prompt/Agent/Workflow DTO，通过 Schema 校验后保存。
- Settings 使用密钥引用，不展示明文密钥。

## 20. Design Reasons

采用深色优先、克制、高密度设计，是因为长篇写作是长时间认知工作；界面应降低眩光和干扰，让正文、设定和审稿信息成为主角。采用 IDE 式布局，是因为项目资产种类多、引用关系密集、AI 工作流需要可审计，比聊天式 UI 更适合长期项目（P2）。

将 AI 输出设计为建议态和 diff 审阅，是为了落实用户最终决策权（P1）。将 Context Trace、token、模型 Profile 和结构化输出放进 Inspector/Workflow Panel，是为了让 AI 行为可解释、可回放、可调试。

## 21. Pros and Cons

### Pros

- 熟悉的 IDE 模式降低复杂项目管理成本。
- 深色低眩光适合长时间写作。
- Command Palette 和快捷键提高高频操作效率。
- Inspector 把版本、引用、上下文和 AI 审计集中到一个稳定位置。
- Prompt/Agent/Workflow Studio 为高级用户提供可控性。

### Cons

- 对新用户比普通聊天界面更复杂。
- Dock、Split View、多 Tab、多 Panel 会增加实现成本。
- 高密度 UI 对视觉层级和空态要求高。
- AI 审计信息如果展示不当会干扰写作。

## 22. Future Extensions

- 可定制布局 presets。
- 项目类型专属工作区：剧本、漫画脚本、游戏剧情。
- 插件贡献面板和命令。
- 多窗口布局记忆。
- 可视化人物关系图、地图和时间线插件。
- 专门的 Focus Writing Mode。

## 23. Risk Analysis

| 风险 | 涉及条款 | 影响 | 缓解方案 |
|---|---|---|---|
| UI 复杂度过高 | 第11节、P10 | 新用户难以上手 | 默认只显示写作必要面板，高级功能渐进披露 |
| AI 面板喧宾夺主 | P1、P2 | 用户误以为 AI 是作者 | AI 结果默认建议态，编辑器主导布局 |
| 高密度导致可读性下降 | 第11节 | 长时间写作疲劳 | Editor 字号/行高独立设置，UI 密度可配置 |
| 多面板状态不一致 | P8 | 保存、版本、恢复状态混乱 | 状态统一来自 Application DTO |
| 设计系统过早复杂 | P10 | Phase 7 实现负担过高 | v1 只定义必要 tokens 和组件状态 |
| 深色模式色彩单调 | 第11节 | 产品缺乏辨识度 | 使用 restrained teal + amber 策略，避免单一深蓝/紫蓝 |

## 24. Phase 4 Changelog

- v1.0 - 2026-07-03：创建 UI/UX 设计初稿。
- v1.0 - 2026-07-03：定义 Workspace Shell、Writing Workspace、AI Workflow Panel、Prompt/Agent/Workflow Studio、Settings、Command Palette。
- v1.0 - 2026-07-03：定义深色优先设计 tokens、状态设计、AI 审计 UX、键盘快捷键和响应策略。

## 25. Progress Tracking

| 阶段 | 状态 | 本次产出 | 未决问题 | 下一步 |
|---|---|---|---|---|
| Phase 1 产品设计 | Complete | `PRODUCT_PRD.md v1.0` | v1 Provider 首批落地顺序仍需 ROADMAP 排序 | 已完成 |
| Phase 2 系统架构 | Complete | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md` | Workflow/Agent 层级解释需在测试规范中固化 | 已完成 |
| Phase 3 数据结构设计 | Complete | `DATA_SCHEMA.md v1.0` | JSON Schema 文件、锁策略、迁移日志后续细化 | 已完成 |
| Phase 4 UI/UX 设计 | Draft for Review | `UI_GUIDELINES.md v1.0` | 最终组件库选型、编辑器技术选型、具体快捷键冲突表 | 等待确认后进入 Phase 5 开发规范 |
| Phase 5 开发规范 | Not Started | 无 | Monorepo 工具链、lint/type/test/CI 规则 | Phase 4 确认后启动 |
| Phase 6 Task Planning | Not Started | 无 | 任务拆分、里程碑、风险缓冲 | Phase 5 后启动 |
| Phase 7 正式开发 | Not Started | 无 | 代码实现排期 | Phase 6 后启动 |
