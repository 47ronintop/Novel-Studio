# Novel Studio 会话式审稿中心 V1 实施计划

**日期：** 2026-08-08

**状态：** Proposed；等待当前 Agent 完善计划完成后实施

**对应设计：** `docs/superpowers/specs/2026-08-08-conversational-review-center-design.md`

**前置计划：** `docs/superpowers/plans/2026-08-02-agent-completion-and-system-guidance-v3-implementation.md`

---

## 1. 实施边界

本计划只交付当前章节/当前选区的只读审稿闭环。Reviewer 生产代码不得与尚未完成的 Agent B7/B8/B9 并行修改共享热点。

开始 R0 前必须同时满足：

1. 当前 Agent 完善计划已完成并提交，或已有明确、稳定的集成基线提交。
2. `agent-run-runtime.ts`、`application-composition.ts`、Composer、会话 workspace 等共享热点不存在来自其他工作流的未提交修改。
3. 重新核对最终接口；若基线变化，只调整本计划的接线点，不复制或替换现有 runtime。

全程遵守以下约束：

- 只有一个 Application-owned `EditorialReviewSession`，三个入口共用。
- Reviewer 模型阶段只读，不公开 mutation tools，不接受 patch/replacement。
- 保持 `WritingTaskIntent@1.0` 和 Writing Generation Guidance 2.0 合同不变。
- 复用现有模型设置/driver、Prompt Artifact、usage、取消、History/Workflow Run、保存协调、selection/scroll 和 AI 写作 rewrite diff/apply。
- 不执行 Studio 中任意 Prompt/Agent/Workflow JSON。
- 不新增左侧 Activity、第二套会话、全书审稿或编辑器 decoration subsystem。

## 2. 批次与提交

### R0：合同、validator 与历史存储

#### R0.1 Typed invocation 与 bounded routing

新增窄合同模块，负责：

- 构造并严格解析 `EditorialReviewInvocationV1`、rubric identity、baseline、context manifest/basis ref、artifact 和 issue。
- Reviewer classifier 只读取本次用户请求、app-owned quick action 和“是否有选区”事实。
- 明确“审稿/审阅/校对/点评当前章”进入 Reviewer；普通“分析/讨论/为什么”不命中。
- “审稿并修改”仍返回只读 Reviewer invocation，不产生 body-generation intent。
- 默认审稿产生全部 focus；“检查文风与一致性”固定产生 `style + continuity`；明确“只看……”才缩小 focus。
- classifier 未命中后才调用现有 `createWritingTaskIntent`。

预计文件：

- `packages/application/src/editorial-review-contract.ts`
- `packages/application/src/editorial-review-invocation.ts`
- `packages/application/src/index.ts`
- `packages/application/test/editorial-review-contract.test.ts`
- `packages/application/test/editorial-review-invocation.test.ts`

#### R0.2 Effect-specific output validator

同一 validator 路径按 issue source 规范化模型、文风和连续性结果，不建立三套 artifact：

- editorial model 只允许 `category/confidence/title/explanation/suggestion/evidence/basisRefIds`；去重后的 basis 必须非空、都是 frozen manifest 的 `model_input`，且至少包含 chapter basis。exact excerpt 通过 scope-local hint 或唯一匹配锚定，再转换为章节绝对 UTF-16 range。
- Style adapter 使用现有 evaluator 的空 baseline 全量扫描结果，但丢弃 `introduced/pre_existing` 语义；selection hit 平移到章节 offset，medium/high 展开、low 折叠。
- Story Analysis adapter 只读取同 checksum、completed、仍可读的 run，将 code-point offset 转成 UTF-16 并重新 slice 校验；selection 仅保留完全落在范围内的 evidence，失败项不投影且不触发重跑。
- 拒绝未知字段、未知/non-model-input basis、patch/replacement、无法锚定、excerpt 不匹配、选区越界和超限数组。
- Application 按设计中的冻结映射生成 ID、severity、source、disposition 和时间字段，并完成稳定去重/排序。
- 固定 source-category pairing：editorial model 不得产生 style，Style evaluator 只能产生 style，Story Analysis 只能产生 continuity；rubric version/checksum 必须绑定 Prompt Artifact 和 review record。
- 固定并测试 24 个模型 issue、48 个最终 issue、4 个 evidence/issue、512 UTF-16 excerpt 上限。

测试必须覆盖 rubric identity/source-category pairing、emoji/代理对、code-point→UTF-16、selection offset 平移、Style exact matched range、有效/未知 basis、唯一/重复 excerpt、重复 evidence、恶意正文指令、带 patch 输出以及 issue/evidence 上限。

#### R0.3 复用 Workflow Run 历史

在现有项目 History repository 中增加窄 `EditorialReviewHistoryPort`：

- 按 project/conversation/chapter 写入、读取和列出 review artifact。
- 同一章节同一 conversation 只允许一个 active run。
- `reviewRunId` 使用现有 Workflow Run ID；artifact 保存 Prompt Artifact、usage 和 terminal/error/cancel evidence 引用。
- artifact 保存 `recordRevision + recordChecksum`；checksum 的 canonical input 排除 checksum 自身。status/disposition 变更采用现有 checksum/CAS 和锁模式，completed 内容/baseline 不可替换。
- 读取 DTO/view 时根据当前正文计算 `isStale`，不把 stale 写回 status/disposition；stale 记录只读，除重新审稿外拒绝 transition/handoff。

预计热点：

- `packages/repository/src/ports.ts`
- `packages/repository/src/history-repository.ts`
- 对应 repository tests

验证：运行 R0 新增 application/repository tests、两包 typecheck、Prettier 和 `git diff --check`。

推荐提交：`feat(review): add editorial review contracts and history`

### R1：Reviewer session、模型执行与 IPC

#### R1.1 Main-owned 审稿依据与 context packing

新增 `EditorialReviewContextBuilder`，只使用 Main 读取的已保存数据：

- 当前章节审稿将完整章节作为 required atomic source；选区审稿使用新 Main-owned paragraph-window helper，将选区作为 required，并按段落边界带前后各最多 2,000 UTF-16 code units 的 local context，evidence 仍限制在选区。
- 只复用 Story Analysis 的 Story Bible catalog/read ports，不复用 `loadStoryAnalysisContext/recallReasons`。以 `statuses: ["active"]` 列 catalog 并只读取候选；优先级固定为 app-owned Composer 明确引用、frontmatter/outline ID、catalog title 命中、已读取资产的一跳 relation。V1 不做无索引的 alias 全库扫描。
- schema-validate `outline_main`/`timeline_main` parent 后，构造最多 3 个 current/neighbor outline entry、8 个 timeline event、16 个其他 Story Bible asset 的字段级 projection；synthetic ref 绑定 parent checksum + entry ID/revision，绝不读取相邻章节原文。
- 使用同一 tokenizer 先执行 3/8/16 item cap 和 story aggregate quota，再调用 `calculateContextBudget`/`planDeterministicContextPacking`。故事资料上限为 `min(12_000 tokens, floor(safeInputBudget * 0.25), required 后剩余预算)`；pinned 计入上限且超限/放不下 fail closed，automatic 省略时生成 `partial` coverage 和 omitted count。
- 既往 assistant/conversation summary、draft/archived/deleted Story Bible 和 fresh Story Analysis 输出不进入 editorial model prompt。Story Analysis 仍在 session 结果阶段独立合并。
- 持久化 context snapshot、budget snapshot、basis refs/checksums/delivery、omitted story count 和 coverage；Renderer 只能查看 manifest，不能提交上下文内容。

预计文件：

- `packages/application/src/editorial-review-context.ts`
- `packages/application/test/editorial-review-context.test.ts`
- 必要的现有 Story Bible read/index port 接线

定向测试覆盖 active-only port 调用、不得调用旧 recall、召回优先级、singleton entry synthetic binding、固定 item/group-token 上限的 pre-pack、selection paragraph range、atomic chapter fail、pinned insufficient budget、automatic truncation、stable ordering/checksum，以及不带相邻正文/旧 assistant 文本。

#### R1.2 Application session

新增唯一 `EditorialReviewSession`：

1. Main 提供已保存章节和经过复验的 selection，context builder 冻结 baseline、basis manifest 和预算快照。
2. 复用当前 Composer 模型 profile；没有模型、预算不足或正文超限时 fail closed。
3. 通过现有 model driver、Prompt Artifact、usage 和 cancellation ports，使用 app-owned `editorial-review-rubric@1` system contract 和 builder 产出的 frozen context 发起非流式 JSON 调用；不得创建直接 provider client 或平行账本。
4. 严格校验 editorial output，再通过 R0.2 的 source adapters 合并 Style 2.0 observation 和可用的 fresh Story Analysis 引用。
5. 记录 queued/running/completed/failed/cancelled、usage 和诊断信息。
6. AbortSignal 只取消本次 review model request，不改变正文或其他 run。

预计文件：

- `packages/application/src/editorial-review-session.ts`
- `packages/application/test/editorial-review-session.test.ts`
- 必要的现有 model/usage port 接线文件

定向测试覆盖成功、malformed/unknown-basis output、模型未配置、预算失败、Prompt Artifact/usage/context snapshot 绑定、取消、稳定并发 conflict、fresh/stale Story Analysis 和 Style 2.0 observation 映射。

#### R1.3 Main composition 与 IPC

在现有 composition/IPC/preload 链增加最小命令：

- `analyze`
- `list`
- `read`
- `transition-disposition`
- `cancel`

Main 必须自行读取活动项目/章节/Story Bible、执行保存后 revision/checksum/selection 校验，并严格解析 IPC 输入输出。Renderer 不能提交正文/故事资料/context manifest、伪造 artifact 或授予模型工具。

预计热点：

- `apps/desktop/src/main/application-composition.ts`
- `packages/application/src/ipc-contract.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/main/ipc-allowlist.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- 对应 IPC/composition tests

验证：运行 Reviewer session、IPC、preload/composition 定向测试，再运行 application/desktop typecheck、Prettier 和 `git diff --check`。

推荐提交：`feat(review): run read-only editorial review sessions`

### R2：Composer、紧凑总览、中央审稿详情与编辑器定位

#### R2.1 Composer `+` 快捷操作

在现有 `AgentPopover` 内增加“快捷操作”分组并真正渲染 `quickActions`：

- 审稿当前章节。
- 有非空选区时显示审稿当前选区。
- 将现有“检查文风与一致性”改接同一个只读 Reviewer session（有选区则 selection，否则 chapter）；保留“改写当前选区”的既有行为。
- popover 固定宽度、限制最大高度、内容滚动；保持现有字号、Escape、focus return、键盘 roving 和 viewport positioning。
- 点击只生成可移除 task chip；发送后才产生模型请求。
- Renderer-owned `pendingEditorialInvocation` 持有 chip/scope/focus；remove、成功 send、取消、章节切换或 selection/revision 失效时清空。自然语言只在 submit 时分类，并把同一标签写入 run header。

主要文件：

- `packages/ui/src/workspace-shell-types.ts`
- `packages/ui/src/agent-composer.tsx`
- Composer 样式文件
- `packages/ui/test/agent-composer.test.tsx`

#### R2.2 会话路由和审稿面板

在现有 creative conversation send path 前运行窄 Reviewer classifier：

- quick action 和自然语言命中都转换为相同 invocation/preflight。
- dirty chapter 只提供现有“保存并继续/取消”；保存后重新校验 selection。
- 扩展现有 `AgentConversationMainReview` union，增加 `editorial_review` variant；`EditorialReviewPanel` 在中央 review surface 显示完整筛选、历史、issue evidence 和状态动作。
- 右侧 `AgentConversationView` 只显示状态/count、最多 3 个 open issue 摘要和“查看完整审稿/重新审稿”，不塞入完整详情。
- 右侧增加“资料充分/有限/不可用”徽标；中央“审稿依据”区显示 rubric/focus，并按 model input / local evaluator / post-review projection 分组列出正文范围、资料名称、数量和 omitted count，不展示大段原始 JSON。
- 中央 issue 卡显示经校验的 basis refs，并只包含查看原文、解释、接受方向、忽略、已解决、生成修改；不显示直接应用正文按钮。
- running/error/cancelled/stale 复用当前会话状态语言和错误呈现。

主要文件：

- `packages/ui/src/editorial-review-panel.tsx`
- `packages/ui/src/workspace-shell-types.ts`
- `packages/ui/src/agent-conversation-view.tsx`
- `packages/ui/src/workspace-shell.tsx`
- `apps/desktop/src/renderer/editorial-review-bridge.ts`
- `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- 最小 App/workspace 接线与对应 tests

#### R2.3 编辑器定位

- 编辑器只显示紧凑的 Reviewer 状态/count。
- 新增 app-owned `closeMainReviewAndLocateEvidence` 接线：清除 current/pending `mainReview` → 等待同 chapter/checksum 的 editor selection callback 注册 → 调用现有 selection/scroll 定位 UTF-16 range。Panel 不直接访问 DOM，基线失配时丢弃待定位请求。
- 右侧摘要和编辑器 count 可重新打开同一详情。
- 章节或 checksum 改变时清除当前定位并显示 stale；不实现波浪线或 gutter marker。

预计接线热点包括 `apps/desktop/src/renderer/workspace-navigation.ts`、`agent-conversation-workspace.ts` 和 `App.tsx`；测试必须证明先恢复 editor surface 再定位，并覆盖返回期间章节/checksum 变化。

验证：运行 Composer、conversation workspace、review panel、chapter editor 和 renderer bridge 定向测试；随后运行 UI/desktop typecheck、lint、Prettier 与 `git diff --check`。

推荐提交：`feat(review): add conversational editorial review UI`

### R3：显式 rewrite handoff 与端到端资格验证

#### R3.1 Selected issues → existing rewrite

增加一个窄 handoff validator，而不是新的写入 backend：

- 输入只能引用 fresh artifact ID/checksum、一个或多个存在的 issue ID、fresh chapter revision/checksum 和用户补充要求。
- artifact view 为 stale、issue 不存在、selection 失效或正文变化时拒绝。
- Application 重新读取正文，复验 record checksum 与 selected issue/evidence，并构造 app-owned rewrite request；Reviewer 的模型生成 title/explanation/suggestion 始终作为 untrusted data，不能成为 system/tool/capability/approval 指令。
- 单一选区问题进入现有 selection rewrite；章节/多范围问题进入现有 chapter generation preview。
- 后续复用现有 `AiWritingWorkflowSession` 候选正文、diff、接受/拒绝和 `chapterEditorSession.applyAiEdit`/save 协调；不得为 Reviewer 新建 apply backend。
- 不虚称该 legacy AI 写作路径已经过 Agent Change Set、Approval Ledger 或 Version Group；若后续基线统一了写作 apply，只在 R0 integration checkpoint 更新接线点。
- Reviewer artifact 和 disposition 都不能作为 apply capability 或 approval proof。

不得在 Reviewer issue 卡或 review IPC 中新增 `apply` 命令。

#### R3.2 集成资格验证

至少覆盖以下跨层场景：

1. `+` 菜单审稿当前章节，右侧显示紧凑总览，中央 review 显示完整详情。
2. 当前选区审稿，点击 issue 精确定位 emoji 后的 UTF-16 range。
3. 自然语言“审稿”进入同一 session；普通分析仍进入通用 Agent。
4. dirty 正文取消后不发起模型调用；保存后 artifact 绑定新 checksum。
5. 审稿依据显示实际纳入的 active Story Bible、outline/timeline 数量和 coverage；预算裁剪可见，且不会带入整库、相邻正文或旧 assistant 文本。
6. Style 静态 observation 不显示 introduced 标签；Story Analysis emoji evidence 经 code-point→UTF-16 后精确定位。
7. 恶意正文、Reviewer suggestion 指令和带 patch/未知 basis 的模型输出均不能造成写入或提权。
8. 正文变化后 artifact 只在 view 中 stale，disposition 和 rewrite handoff 都被拒绝。
9. fresh artifact 的 selected issues 生成独立 diff，只有现有 AI 写作明确接受链能够应用。
10. B7/B8/B9 原有 capability gates 和回归测试保持通过。

验证顺序：最窄跨层测试 → `npm run typecheck` → `npm run lint` → 相关 Vitest suites → 必要的 desktop E2E → Prettier → `git diff --check`。

推荐提交：`feat(review): hand editorial issues to reviewed rewrites`

## 3. 完成定义

只有设计中的 11 项最小验收全部有自动化证据，且 Reviewer 无任何隐式正文写入路径时，V1 才完成。

以下内容不得为完成 V1 临时追加：全书/卷级审稿、多 Reviewer、执行 Studio Workflow、常驻编辑器 decorations、报告导出或独立审稿模型设置。它们只能作为后续单独设计。
