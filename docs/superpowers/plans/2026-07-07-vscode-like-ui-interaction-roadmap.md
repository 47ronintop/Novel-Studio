# VSCode-Like UI and Interaction Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Novel Studio 的主工作区推进到接近 VSCode/Cursor 的小说创作 IDE：左侧项目资产树、中间真实编辑器、右侧可审计 AI/Inspector、底部 Problems/Search/Logs 面板都必须是可用功能，不是视觉摆设。

**Architecture:** 以现有 Electron + React + Application Session 架构为边界，Renderer 只消费 Application/Bridge DTO，不直接扫描或写项目文件。每个任务单独交付、单独验收、单独更新文档状态；高风险编辑器、多标签、流式取消等工作必须先做范围复核和回归测试。保留 local-first、可恢复、可审计、用户最终确认这些产品约束。

**Tech Stack:** TypeScript strict, React, Electron IPC/preload bridge, Vite, Vitest, Playwright, existing OpenAI-compatible provider runtime, existing editor runtime/CodeMirror adapter gate.

---

## 1. 输入来源与取舍结论

本计划合并了桌面上的两份提示词：

- `C:\Users\ALIENWARE\Desktop\新建文本文档 (3).txt`
- `C:\Users\ALIENWARE\Desktop\新建文本文档 (4).txt`

取舍结论：

- 第一份提示词适合作为需求池：它指出了 AI 面板、编辑器、设置页、VSCode 化布局、AI 腔治理等体验方向，但范围过大，且把正常文风打磨与“过朱雀/规避 AI 检测”混在一起，不适合作为执行提示词。
- 第二份提示词适合作为执行骨架：它把工作拆成可验收任务，并明确禁止检测规避类功能。
- 本计划采用第二份的拆分方式，补上当前代码库真实模块、文件阈值、现有 UI/实现错位点，以及更合理的执行顺序。

## 2. 明确不做与允许做的范围

以下内容不进入本轮任务，也不应在实现中顺手加入：

- 绕过朱雀、GPTZero 或其他 AI 内容检测系统的功能。
- 故意插入错别字、故意降低文本完整度、随机打乱句式来伪装“人写”的功能。
- 以检测规避为目的的 `DeAiSettings`、检测规避 quick command、检测规避专用参数面板。
- 插件市场、任意第三方插件源码执行、生产级插件分发生态。
- 完整知识图谱、Timeline 深编辑、有声书导出、复杂角色配音。
- 多会话 AI 对话管理，除非完成本计划的真实多轮单会话后再单独立项。

可以做的写作质量能力：

- AI 腔治理 / 文风去模板化：减少 AI 写作常见套话、套句、解释腔和机械重复，不以通过检测为目标。
- 请求前规则注入：在生成/改写请求中加入项目文风规则、禁用/慎用表达、句式约束和正向写法。
- 生成后本地扫描：提示“疑似模板表达”，例如反复的“像……像……”“不是……是……”“冷冷”“压下去”等，让用户决定是否重写。
- 文笔打磨：减少模板化句式、增强细节、贴合作品语气。
- 审稿：检查逻辑、人物一致性、节奏、伏笔、设定冲突。
- 可审计 AI：上下文来源、模型 profile、token/cost、结构化输出、diff 审阅。

## 3. 已核实的关键文件与现状

| 路径                                                      |             当前行数 | 现状一句话                                                                                                                 |
| --------------------------------------------------------- | -------------------: | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/workspace-shell.tsx`                     |                  900 | 主工作区壳已存在 VSCode 式区域，但超过 UI 800 行警戒线，继续加功能前必须优先拆分或把新增逻辑放入子组件。                   |
| `apps/desktop/src/renderer/App.tsx`                       |                 1017 | Renderer 编排层已接近 UI 硬阈值，新增桥接状态前必须避免继续堆在本文件。                                                    |
| `packages/application/src/ai-writing-workflow-session.ts` |                  974 | VUI-01 已先拆出 LLM request helper，低于 Application 1000 行硬阈值；后续仍接近边界，继续新增 AI session 行为前要优先拆分。 |
| `packages/ui/src/workspace-shell-ai.tsx`                  |                  495 | AI 面板标题像对话，但当前仍以单条 instruction + 派生 reply 为主，是真实多轮对话的首要改造点。                              |
| `packages/ui/src/chapter-editor.tsx`                      |       未超本轮硬门禁 | 章节编辑器存在基础编辑 UI，需要补齐编辑器观感、字数、查找替换、专注模式等 IDE 级体验。                                     |
| `apps/desktop/src/renderer/editor-runtime.ts`             | 未纳入本轮行数门禁表 | 已有 editor runtime / CodeMirror gate 相关工作，启用 CodeMirror 前必须盘点，不得重写。                                     |
| `packages/ui/src/model-settings-panel.tsx`                |                  550 | 模型设置 UI 存在，但模型列表动态发现、设置分区、连接测试反馈仍需升级。                                                     |
| `apps/desktop/src/main/model-runtime.ts`                  |                  513 | 真实 provider runtime 存在；`stream()` 当前直接调用 provider stream，需要补齐与 `complete()` 一致的校验/兜底/取消路径。    |
| `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts` |       未超本轮硬门禁 | Renderer 侧已有 AI workflow bridge，但输入仍围绕 instruction，流式和停止需要真实端到端贯通。                               |
| `packages/application/src/story-bible-session.ts`         |       未超本轮硬门禁 | 已有 `buildContextCandidates` 能力，主工作区还没有把候选上下文作为可操作 Inspector 能力充分暴露。                          |

## 4. 当前 UI 与实现错位清单

### UI 显示了但功能没有完整实现

- AI 面板显示“对话式写作助手”，但 `workspace-shell-ai.tsx` 仍主要展示开场白、当前 instruction、当前 reply，不是真实按时间追加的消息线程。
- AI 面板有 `streaming` / `streamPreview` UI 状态，但桌面 runtime 的 `stream()` 路径还没有与 `complete()` 一样的校验和兜底逻辑，停止生成也需要贯通到真实请求取消。
- 底部面板已有“工作流运行 / 问题 / 搜索 / 日志”标签，但 Logs 主要是静态说明，Problems 在没有健康 DTO 时也显示产品化缺口文案，不是完整 IDE 诊断台。
- `inspectorCollapsed` 已在 Application shell state 和 preferences 中存在，但主工作区右侧区域仍固定渲染为 AI 面板，折叠状态没有完整影响右侧 Inspector/AI 区域。
- 设置页已有模型配置卡片，但模型名仍偏手动输入，没有共享的 provider `/models` 动态发现能力。

### 代码实现了但 UI 暴露不足

- `packages/application/src/story-bible-session.ts` 和 IPC/preload 已有上下文候选构建能力，主 UI 只展示 Story Bible 摘要和“可进入上下文”标记，缺少候选列表、纳入/排除原因、token 预算等 Inspector 控制。
- Application shell 已有 bottom panel tab state、bottom panel visibility、inspector collapsed state，UI 还没有把这些状态变成完整可恢复、可操作的 IDE layout。
- AI workflow history 已存在运行记录摘要，但对话区和底部运行面板没有形成“点击历史查看详情/上下文/模型/失败诊断”的完整闭环。

## 5. 全局执行规则

- 一次只执行一个任务，完成后运行自动化验证，再进行人工验收。
- 每个任务开始前运行文件行数检查；如果目标文件已超过警戒线，优先拆分职责，不继续堆代码。
- UI/renderer 单文件：800 行警戒，1200 行强制拆分。
- Application session 单文件：700 行警戒，1000 行强制拆分。
- 测试文件：700 行警戒。
- Renderer 不直接访问文件系统；项目文件读写必须走 Application/Repository/IPC 既有边界。
- AI 输出必须保持建议态，写入正文前必须可审阅、可撤销、可追踪。
- 每个任务完成后更新 `ROADMAP.md` 或对应 release/plan 文档状态，不把未完成能力标成完成。

通用前置命令：

```powershell
(Get-Content -LiteralPath 'packages\ui\src\workspace-shell.tsx').Count
(Get-Content -LiteralPath 'apps\desktop\src\renderer\App.tsx').Count
(Get-Content -LiteralPath 'packages\application\src\ai-writing-workflow-session.ts').Count
npm run typecheck
npm test
```

## 6. 推荐执行顺序

### VUI-00: Scope Gate 与结构保护

**Status:** Complete on 2026-07-07. `ROADMAP.md` 已新增 `Scope Review - 2026-07-07 before VUI-01`；`npm run typecheck` 和 `npm test` 已通过。

**目标：** 在任何 UI 功能实现前，先确认 v1.1 工作不会破坏 M93/M94/M98 已建立的保存、恢复、项目锁和真实 provider 路径。

**Files:**

- Modify: `ROADMAP.md`
- Read: `PRODUCT.md`
- Read: `UI_GUIDELINES.md`
- Read: `docs/releases/m98-v1-ship-readiness.md`
- Read: `docs/superpowers/plans/2026-07-07-vscode-like-ui-interaction-roadmap.md`

**Steps:**

- [x] 记录新的 v1.1 Scope Review，说明本轮目标是 IDE 体验升级，不是补 v1 blocker。
- [x] 记录当前行数：`workspace-shell.tsx = 900`、`App.tsx = 1017`、`ai-writing-workflow-session.ts = 994`，并确认后续任务如何避开硬阈值。
- [x] 明确本轮不新增 M99/M100 到 v1 主线；如需路线图编号，使用 v1.1 UI/Interaction 子阶段。
- [x] 确认所有任务继续遵守“AI 建议可审阅可撤销”和“用户最终确认”原则。

**Verification:**

```powershell
npm run typecheck
npm test
```

Result on 2026-07-07: `npm run typecheck` passed; `npm test` passed with 72 test files and 374 tests.

**Manual acceptance:** 打开 `ROADMAP.md` 能看到新增 Scope Review，说明为什么开始 VSCode 化体验升级，以及为什么它不推翻 v1 conditional ship 结论。

**Commit message:** `docs: add v1.1 ui scope review`

### VUI-01: AI 面板真实多轮对话

**Status:** Complete on 2026-07-07. Application session 已保留单 session 消息历史，第二轮请求会携带上一轮对话；bridge 成功发送后清空输入框；UI 渲染真实消息列表。

**目标：** 把当前单条 instruction/reply 改成当前章节编辑 session 内真实追加的消息历史；不做流式、不做多会话管理。

**Files:**

- Modify: `packages/application/src/ai-writing-workflow-types.ts`
- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify or split from: `packages/ui/src/workspace-shell-ai.tsx`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Test: `packages/application/test/ai-writing-workflow-session.test.ts`
- Test: `packages/ui/test/ai-writing-workflow.test.tsx`
- Test: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`

**Steps:**

- [x] 在 Application 类型层增加当前 session 消息模型：message id、role、content、createdAt、status、optional suggestion/run id。
- [x] 先写 failing test：连续两次发送相关问题后，session 中保留两条 user message 和两条 assistant message，第二次 request 的 prompt/context 能包含前一轮摘要或消息历史。
- [x] 把 `ai-writing-workflow-session.ts` 中与 prompt 构建、历史追加有关的逻辑拆到新 helper，避免该文件超过 1000 行硬阈值。
- [x] UI 输入框改为“发送后清空”，消息列表按时间顺序渲染并可滚动。
- [x] 保留现有失败态、诊断、应用建议、diff/preview 入口，确保改造不回退现有 AI 建议闭环。
- [x] 不添加检测规避、人性化错别字、绕过检测等 quick command；AI 腔治理放到 VUI-03A 作为写作质量功能处理。

**Verification:**

```powershell
npm test -- packages/application/test/ai-writing-workflow-session.test.ts packages/ui/test/ai-writing-workflow.test.tsx apps/desktop/test/ai-writing-workflow-bridge.test.ts
npm run typecheck
```

Result on 2026-07-07: target tests passed with 3 files and 16 tests; `npm run typecheck` passed.

**Manual acceptance:** 打开一个章节，先问“续写这段”，AI 回复后再问“再短一点”。两轮问答同时留在消息历史里，第二轮能参考第一轮，不覆盖第一轮。

**Commit message:** `feat: add single-session ai chat history`

**VUI-02 Status:** Complete on 2026-07-07. 已完成真实 provider stream 校验/兜底/AbortSignal 传递、Application session 流式建议生成、IPC/preload `start/next/cancel` 通道、renderer bridge/UI 真流式追加与停止。验证：`npm run typecheck`、VUI-02 目标测试组、`npm test` 均通过。

### VUI-02: AI 流式输出与真实停止

**目标：** 在 VUI-01 的消息线程上接入真实增量输出，并让“停止生成”取消后端请求。

**Files:**

- Modify: `apps/desktop/src/main/model-runtime.ts`
- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify or split from: `packages/ui/src/workspace-shell-ai.tsx`
- Test: `apps/desktop/test/m95-real-provider-runtime.test.ts`
- Test: `apps/desktop/test/ai-writing-workflow-ipc.test.ts`
- Test: `packages/ui/test/ai-writing-workflow.test.tsx`

**Steps:**

- [ ] 给 `createAiProvider().stream()` 补齐与 `complete()` 一致的 profile 校验、missing key 处理、demo fallback、error mapping。
- [ ] 在 IPC/bridge/session 中传递 `AbortSignal` 或等价 cancellation token，停止按钮必须中止真实 provider stream。
- [ ] UI 中 assistant message 进入 streaming 状态后增量追加 delta，不等完整结果返回。
- [ ] 停止后把消息标记为 canceled 或 stopped，保留已生成片段，不写入正式建议态。
- [ ] 增加测试覆盖：stream 未验证 profile 时不会绕过校验；stop 后不会继续追加 delta。

**Verification:**

```powershell
npm test -- apps/desktop/test/m95-real-provider-runtime.test.ts apps/desktop/test/ai-writing-workflow-ipc.test.ts packages/ui/test/ai-writing-workflow.test.tsx
npm run typecheck
```

**Manual acceptance:** 触发较长生成，1 秒内看到文字开始增长；生成中点击停止，后端请求终止，UI 不再继续追加文字。

**Commit message:** `feat: stream ai chat with real cancellation`

Completion note on 2026-07-07: all VUI-02 checklist items are implemented. Added regression coverage for unverified/missing provider stream fallback, real fetch abort, session streaming suggestion creation, IPC/preload cancellation, and bridge stop-after-delta behavior.

### VUI-03: 共享模型发现与受控推理强度

**目标：** Settings 与 AI 面板共享 provider 模型发现能力；无法发现时优雅回退到手动输入。

**Files:**

- Create: `packages/application/src/model-discovery-session.ts`
- Modify: `packages/application/src/model-settings-session.ts`
- Modify: `apps/desktop/src/main/model-runtime.ts`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/workspace-shell-ai.tsx`
- Test: `packages/application/test/model-settings-session.test.ts`
- Test: `apps/desktop/test/settings-bridge.test.ts`
- Test: `packages/ui/test/settings-and-studio.test.tsx`

**Steps:**

- [ ] 为 OpenAI-compatible profile 增加 `GET {baseUrl}/models` 发现路径，返回 normalized `{ id, displayName, provider, contextWindow? }`。
- [ ] discovery 失败时返回 typed fallback state，不抛出阻塞 UI 的异常。
- [ ] Settings 模型名字段在 discovery 成功时显示下拉，失败时保持手动输入并显示原因。
- [ ] AI 面板顶部模型选择器复用同一 discovery DTO，不写第二套模型列表逻辑。
- [ ] 推理强度控件只对显式白名单模型模式显示；执行前查阅目标 provider 官方文档，把参数名和取值范围写入实现注释或测试名。
- [ ] 未知模型不显示推理强度控件，不猜测 provider 参数。

**Verification:**

```powershell
npm test -- packages/application/test/model-settings-session.test.ts apps/desktop/test/settings-bridge.test.ts packages/ui/test/settings-and-studio.test.tsx
npm run typecheck
```

**Manual acceptance:** 配置真实 DeepSeek 或 OpenAI-compatible profile 后，Settings 和 AI 面板都显示真实模型列表；换成不支持 `/models` 的自定义端点时，UI 回退为手动输入且不崩溃。

**Commit message:** `feat: share provider model discovery`

**Execution status (2026-07-07):** Done.

- Added shared `ModelDiscoverySnapshot` DTO and `ModelDiscoveryPort`.
- Added OpenAI-compatible `GET {baseUrl}/models` discovery in desktop runtime with typed fallback on missing key, HTTP error, non-JSON response, or malformed payload.
- Settings and AI panel now reuse the same discovery DTO; Settings uses a discovered-model dropdown on success and keeps manual entry on fallback.
- AI panel model selector saves the selected model back to the default profile, so later generation uses the existing runtime profile path.
- Reasoning strength is exposed only for an explicit OpenAI-style whitelist with `reasoning_effort: low | medium | high`; unknown models keep the control hidden.

### VUI-03A: AI 腔治理与文风规则注入

**目标：** 把“减少 AI 味”定义为写作质量控制：在生成/改写请求前注入文风规则，减少常见 AI 套话、模板句和机械表达；生成后给出本地规则命中提示。该任务不做检测规避，不承诺通过任何 AI 内容检测系统。

**Files:**

- Create: `packages/application/src/ai-writing-style-rules.ts`
- Modify: `packages/application/src/ai-writing-llm-requests.ts`
- Modify: `packages/application/src/ai-writing-workflow-types.ts`
- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `packages/application/src/ai-writing-streaming-session.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `packages/ui/src/workspace-shell-ai.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/application/test/ai-writing-workflow-session.test.ts`
- Test: `packages/ui/test/ai-writing-workflow.test.tsx`
- Test: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`
- Test: `apps/desktop/test/ai-writing-workflow-ipc.test.ts`
- Test: `packages/application/test/desktop-ai-writing-workflow.test.ts`

**Default rule pack:**

- 慎用高频比喻叠句：连续“像……像……”。
- 慎用解释性对照句：“不是……是……”。
- 慎用机械情绪描写：“冷冷”“压下去”“呼吸一滞”“指尖发紧”“心口一沉”等。
- 慎用总结式心理旁白：直接解释人物动机、替读者总结情绪。
- 优先使用具体动作、环境反馈、人物选择、对白潜台词来表达情绪。
- 保留角色口吻和当前章节叙事视角，不为了“变化”破坏作品语气。

**Steps:**

- [x] 新建 `ai-writing-style-rules.ts`，定义 `AiWritingStyleRulePack`、`AiWritingStyleRule`、`AiWritingStyleHit`，并内置默认中文小说规则包。
- [x] 写 failing test：章节建议和选区改写生成的 request messages 中包含启用的文风规则，但不包含“过检测”“规避检测”等措辞。
- [x] 在 `ai-writing-llm-requests.ts` 中把规则注入到 LLM request：生成整章建议、流式整章建议和选区改写都走同一 helper，避免两套 prompt 拼接。
- [x] 增加本地扫描 helper：对 proposedBody/proposedText 扫描规则命中，返回命中词、规则 id、位置摘要、建议处理方式。
- [x] 在 `AiWritingSuggestion` 和 `AiWritingSelectionPreview` 中加入 `styleReview` DTO，bridge 透传到 UI。
- [x] AI 面板显示轻量结果：没有命中时显示“未发现明显模板表达”；有命中时列出命中规则和短片段。本阶段不添加“按文风规则重写”按钮，避免 UI 出现未实现命令。
- [x] 不添加错别字、随机破坏句子、检测分数、检测平台名称、绕过检测承诺。

**Verification:**

```powershell
npm test -- packages/application/test/ai-writing-workflow-session.test.ts packages/ui/test/ai-writing-workflow.test.tsx apps/desktop/test/ai-writing-workflow-bridge.test.ts
npm run typecheck
```

Result on 2026-07-07: target tests passed with 3 files and 21 tests; `npm run typecheck`
passed; full `npm test` passed with 72 files and 391 tests.

**Manual acceptance:** 输入“写第一章开头”并生成建议时，请求后台应包含默认文风规则；返回内容若出现“像……像……”“不是……是……”“冷冷”“压下去”等表达，AI 面板能标出疑似模板表达。界面不得出现“过朱雀”“过检测”“检测分数”等承诺。

**Commit message:** `feat: add ai writing style rules`

**VUI-03A Status:** Complete on 2026-07-07. 已完成默认文风规则包、章节/选区请求注入、返回文本本地扫描、`styleReview` DTO、renderer 透传和 AI 面板轻量展示；该功能按写作质量处理，不做检测规避。

### VUI-04: 编辑器 Runtime 盘点与 CodeMirror 默认启用

**目标：** 在不破坏保存、选择区 AI 改写、历史 diff 的前提下，把默认编辑体验从普通 textarea 推进到真实软件编辑器观感。

**Files:**

- Modify: `ROADMAP.md`
- Read: `apps/desktop/src/renderer/editor-runtime.ts`
- Read: `packages/ui/src/chapter-editor.tsx`
- Modify: `apps/desktop/src/renderer/app-shell-support.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `apps/desktop/test/editor-runtime.test.ts`
- Test: `apps/desktop/test/app-shell-support.test.ts`
- Test: `packages/ui/test/chapter-editor.test.tsx`
- Test: `packages/ui/test/editor-runtime-workflow-ux.test.tsx`
- Test: `apps/desktop/test/project-workflow.e2e.ts`

**Steps:**

- [x] 在 `ROADMAP.md` 写 Scope Review：说明这次启用 CodeMirror 是产品定位要求的 IDE 观感升级，不伪造“textarea 已被证明不够用”的理由。
- [x] 盘点现有 editor runtime、CodeMirror adapter、feature flag、selection command、visual diff gate，形成 10 行以内结论写进 Scope Review 或本计划执行记录。
- [x] 如果现有 adapter 已覆盖输入、保存、selection、AI rewrite 所需事件，则把 CodeMirror 设为默认；否则先补最小 adapter parity test。
- [x] 保留 textarea fallback，fallback 只在 adapter 初始化失败或 feature flag 关闭时出现。
- [x] 调整字体、行高、gutter、光标、选区、滚动、内边距，让编辑区像 IDE 编辑器而不是浏览器默认表单。

**Verification:**

```powershell
npm test -- apps/desktop/test/editor-runtime.test.ts apps/desktop/test/app-shell-support.test.ts packages/ui/test/chapter-editor.test.tsx packages/ui/test/editor-runtime-workflow-ux.test.tsx
npx playwright test apps/desktop/test/project-workflow.e2e.ts
npm test
npm run typecheck
npm run build
```

Execution status on 2026-07-07: implemented CodeMirror as the default editor runtime, kept explicit textarea rollback through resolver options, moved selection-preview command creation onto the default runtime helper, and marked CodeMirror editor surfaces for IDE styling. Existing adapter coverage already included body change, selection, save, command, visual/local diff metadata and selection AI preview DTOs, so no new adapter layer was needed.

Verification result on 2026-07-07: targeted runtime/UI tests passed, Electron project workflow E2E passed, full Vitest suite passed, typecheck passed, build passed with existing Vite browser-externalization/chunk-size warnings, and `git diff --check` reported no whitespace errors.

**Manual acceptance:** 打开任意章节，编辑器呈现真实编辑器观感；输入、选择区 AI 改写、保存、查看历史 diff 都不回归。

**Commit message:** `feat: enable codemirror editor runtime`

### VUI-05: 编辑器基础功能补齐

**目标：** 补齐写作 IDE 的基础编辑工具：实时字数、阅读时间、查找替换、专注模式、字体/行高设置。

**Files:**

- Create: `packages/ui/src/editor-toolbar.tsx`
- Create: `packages/ui/src/editor-find-replace.tsx`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `apps/desktop/src/renderer/app-shell-support.ts`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/editor-toolbar.test.tsx`
- Test: `packages/ui/test/editor-find-replace.test.ts`
- Test: `packages/ui/test/chapter-editor.test.tsx`
- Test: `packages/ui/test/workspace-shell.test.tsx`
- Test: `packages/application/test/user-preferences-session.test.ts`
- Test: `packages/application/test/desktop-application.test.ts`
- Test: `packages/repository/test/user-preferences-repository.test.ts`

**Steps:**

- [x] 增加实时字数和阅读时间计算；中文按字符计数，英文按词计数，空白不计入中文字符。
- [x] 增加 `Ctrl+H` 查找替换条，支持上一处/下一处、区分大小写、替换当前、全部替换。
- [x] 增加专注模式命令：隐藏 Navigator、AI/Inspector、Bottom Panel，只保留编辑器和状态栏。
- [x] 增加字体和行高偏好，写入 user preferences，重启后恢复。
- [x] 所有工具按钮使用图标、tooltip、accessible label，不使用大段说明文字占据编辑器。

**Verification:**

```powershell
npm test -- packages/ui/test/editor-find-replace.test.ts packages/ui/test/editor-toolbar.test.tsx packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx packages/application/test/user-preferences-session.test.ts packages/application/test/desktop-application.test.ts packages/repository/test/user-preferences-repository.test.ts apps/desktop/test/app-shell-support.test.ts
npm test
npm run typecheck
npm run build
npx playwright test apps/desktop/test/project-workflow.e2e.ts
```

Execution status on 2026-07-07: implemented compact editor toolbar metrics, find/replace pure operations and UI strip, focus mode command/layout markers, and persisted editor font/line-height preferences. Full save/recovery/history flow remains unchanged; find/replace applies through the existing editor body change callback.

Verification result on 2026-07-07: targeted VUI-05 tests passed, full Vitest suite passed, typecheck passed, build passed with existing Vite browser-externalization/chunk-size warnings, Electron project workflow E2E passed, and `git diff --check` reported no whitespace errors. A separate headless browser smoke was attempted but skipped because no Playwright/browser executable was installed in the local profile; Electron E2E covered the desktop renderer path.

**Manual acceptance:** 输入正文后字数和阅读时间实时变化；按 `Ctrl+H` 能查找、跳转和替换；专注模式只保留写作核心区；字体/行高调整后重启仍保留。

**Commit message:** `feat: add editor toolbar basics`

### VUI-06: 左侧 Navigator 文件树 VSCode 化

**目标：** 把左侧导航从列表感提升为项目资产树：分组、折叠、搜索、上下文菜单、元数据。

**Files:**

- Create: `packages/ui/src/workspace-navigator.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/application/test/project-workflow-session.test.ts`
- Test: `packages/ui/test/workspace-navigator.test.tsx`
- Test: `apps/desktop/test/project-workflow-bridge.test.ts`

**Steps:**

- [x] 从 `workspace-shell.tsx` 拆出 Navigator 子组件，降低主 shell 文件行数。
- [x] Navigator 数据使用 Application DTO：章节、Story Bible、Prompt、Agent、Workflow，不直接读文件系统。
- [x] 分组支持展开/折叠，状态写入 user preferences。
- [x] 增加搜索框，章节和 Story Bible 资产按标题/状态/正文过滤并高亮命中；Studio 资产使用现有 DTO 展示标题与类型。
- [x] 增加 Navigator 新建章节入口和章节更多菜单：重命名、复制、删除；删除必须二次确认并走软删除。
- [x] 每个章节条目展示最少必要元数据：dirty、字数、状态、最近修改。

**Verification:**

```powershell
npm test -- packages/application/test/project-workflow-session.test.ts apps/desktop/test/project-workflow-bridge.test.ts packages/ui/test/workspace-navigator.test.tsx packages/application/test/user-preferences-session.test.ts packages/repository/test/user-preferences-repository.test.ts
npm run typecheck
```

**Manual acceptance:** Navigator 内能新建章节；章节更多菜单能重命名、复制、删除；分组可折叠；搜索能过滤并高亮章节或故事资产；操作不绕过保存/恢复逻辑。

**Commit message:** `feat: upgrade workspace navigator`

### VUI-07: Settings 面板 VSCode 化

**目标：** 把设置页改成左侧分类导航 + 右侧设置内容的 IDE 设置界面，并复用 VUI-03 的模型发现能力。

**Files:**

- Modify or split from: `packages/ui/src/model-settings-panel.tsx`
- Create: `packages/ui/src/settings-panel-tabs.tsx`
- Modify: `packages/application/src/model-settings-session.ts`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Test: `packages/ui/test/settings-and-studio.test.tsx`
- Test: `packages/application/test/model-settings-session.test.ts`
- Test: `apps/desktop/test/settings-bridge.test.ts`

**Steps:**

- [ ] 拆出 Settings tabs：模型、写作、外观、插件、高级。
- [ ] 模型页复用 VUI-03 discovery DTO，不重复实现 `/models` 请求。
- [ ] API Key 输入只在编辑表单中支持显示/隐藏；已存储 secret 不展示明文，只展示存在状态和 secret ref。
- [ ] 连接测试增加 testing/success/failure 状态和动画，错误信息脱敏。
- [ ] 外观页接入主题、字体、行高、密度偏好；写作页接入默认编辑器偏好、保存行为偏好和 VUI-03A 的文风规则启用/强度/自定义禁用表达。
- [ ] 自定义文风规则必须以“写作质量/项目语气”为标签保存，不使用“检测规避”“过检测”等标签。

**Verification:**

```powershell
npm test -- packages/ui/test/settings-and-studio.test.tsx packages/application/test/model-settings-session.test.ts apps/desktop/test/settings-bridge.test.ts
npm run typecheck
```

**Manual acceptance:** 设置页左侧分类可切换；API Key 默认隐藏且不会展示已存储明文；连接测试有进行中动画和清晰结果；模型列表复用真实 discovery；写作页能开关 AI 腔治理并添加项目级慎用表达。

**Commit message:** `feat: redesign settings workspace`

### VUI-08: Inspector 与底部面板真实化

**目标：** 把右侧 Inspector 和底部 Problems/Search/Logs/Workflow Run 从“有标签”推进到“可诊断、可追踪、可操作”。

**Files:**

- Create: `packages/ui/src/workspace-inspector.tsx`
- Create: `packages/ui/src/workspace-bottom-panel.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/story-bible-session.ts`
- Modify: `apps/desktop/src/renderer/app-shell-support.ts`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/ai-writing-workflow.test.tsx`
- Test: `packages/application/test/desktop-project-workflow.test.ts`
- Test: `packages/application/test/desktop-ai-writing-workflow.test.ts`

**Steps:**

- [ ] 从 `workspace-shell.tsx` 拆出 Inspector 和 Bottom Panel，确保主 shell 行数下降或不继续上升。
- [ ] `inspectorCollapsed` 必须真实控制右侧区域显示；折叠后编辑器区域扩展，状态持久化。
- [ ] Inspector 显示当前文档元数据、版本历史入口、Story Bible 上下文候选、AI run context trace。
- [ ] 上下文候选显示纳入/排除原因、token 预算、来源资产，可跳转到对应资产。
- [ ] Problems 面板显示 project health、schema、恢复草稿、Story Bible 冲突；没有问题时显示可执行空态。
- [ ] Logs 面板显示本地审计日志摘要：workflow run、provider test、save/recovery、error trace id；不得记录明文密钥或完整敏感请求体。
- [ ] Workflow Run 面板支持点击历史运行，查看模型、上下文、token/cost、失败诊断。

**Verification:**

```powershell
npm test -- packages/ui/test/ai-writing-workflow.test.tsx packages/application/test/desktop-project-workflow.test.ts packages/application/test/desktop-ai-writing-workflow.test.ts
npm run typecheck
```

**Manual acceptance:** `Ctrl+Shift+I` 或对应按钮能折叠/展开 Inspector；底部 Problems 显示真实项目健康或空态；Logs 显示真实本地事件摘要；点击一次 AI 运行能查看上下文和模型信息。

**Commit message:** `feat: make inspector and bottom panel actionable`

### VUI-09: 多标签编辑器，最后实现

**目标：** 在保存、恢复、项目锁、多窗口安全不回退的前提下实现多标签编辑器。

**Files:**

- Modify: `ROADMAP.md`
- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `packages/application/src/chapter-editor-session.ts`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Test: `packages/application/test/project-workflow-session.test.ts`
- Test: `packages/application/test/desktop-project-workflow.test.ts`
- Test: `apps/desktop/test/project-workflow.e2e.ts`

**Steps:**

- [ ] 在 `ROADMAP.md` 增加多标签专项 Scope Review，回答多标签 dirty state、autosave、recovery、project lock、multi-window 的状态模型。
- [ ] 先写 failing E2E：打开 3 个章节，分别编辑但不保存，模拟异常退出，重启后 3 个草稿都能恢复。
- [ ] Application 层增加 open editor tabs DTO：tab id、asset ref、dirty、recovery ref、last active time。
- [ ] 每个 tab 的 draft/recovery 独立保存，不以全局 active chapter 覆盖其他 tab。
- [ ] UI tabs 显示 dirty 点、关闭按钮、缺失文件诊断；关闭 dirty tab 必须确认保存/丢弃/取消。
- [ ] 多标签完成后重跑 M93/M94 核心写作旅程和数据不丢失测试。

**Verification:**

```powershell
npm test -- packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts
npm run test:e2e -- apps/desktop/test/project-workflow.e2e.ts
npm run typecheck
```

**Manual acceptance:** 连续打开 3 个章节分别编辑但不保存，模拟异常退出后重新打开应用，3 个标签的草稿都能通过恢复流程找回，不能只恢复最后一个。

**Commit message:** `feat: add recoverable editor tabs`

## 7. 执行优先级理由

推荐顺序是：

1. VUI-00 Scope Gate
2. VUI-01 AI 多轮对话
3. VUI-02 流式输出与真实停止
4. VUI-03 共享模型发现
5. VUI-03A AI 腔治理与文风规则注入
6. VUI-04 CodeMirror 默认启用
7. VUI-05 编辑器基础功能
8. VUI-06 Navigator 文件树
9. VUI-07 Settings 面板
10. VUI-08 Inspector + Bottom Panel
11. VUI-09 多标签编辑器

理由：

- AI 多轮对话是当前 UI 文案与真实行为差距最大的点，且是流式输出的前置。
- 模型发现同时服务 Settings 和 AI 面板，应做成共享能力，避免两套实现。
- AI 腔治理属于 AI 写作主链路，应在基础对话、流式、模型能力之后尽早进入请求构建和结果审阅，不应等到最后才做。
- CodeMirror 默认启用会影响输入、选择区、保存、diff，必须先盘点已有 adapter，不应重写。
- Navigator、Settings、Inspector/Bottom Panel 都是 VSCode 化体验的组成部分，但它们不应抢在 AI 对话和编辑器主路径之前。
- 多标签编辑器风险最高，会触碰 autosave/recovery/project lock，因此必须最后做，并单独通过数据不丢失验收。

## 8. 完成定义

本计划完成时，至少满足以下场景：

- 用户打开项目后，第一屏像小说创作 IDE，而不是聊天产品或卡片首页。
- 左侧能管理项目资产；中间能稳定写作、搜索替换、保存恢复；右侧能与 AI 多轮对话并审阅建议；底部能看问题、搜索、日志和运行记录。
- 真实 provider、模型配置、流式输出和停止生成形成端到端闭环。
- AI 写作请求能注入项目文风规则，默认减少常见 AI 腔模板表达，并在结果中提示疑似模板表达命中。
- AI 输出仍然默认是建议态，正式写入前必须经过用户确认。
- 关闭、重启、异常退出后不丢正文、不丢多个标签草稿、不丢关键偏好。
- 文档如实记录完成状态，没有把 UI 占位或半成品标成完整实现。
