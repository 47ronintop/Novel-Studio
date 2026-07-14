# Agentic Writing Loop Stage 4 多会话管理设计

版本：1.0
日期：2026-07-14
基线设计：Agentic Writing Loop v1.4
状态：已确认，可进入实现

## 1. 结论摘要

Stage 4 采用独立的 Conversation 聚合层。`conversationId` 只把多个 Agent run 组织成一个可恢复的对话，不改变 run、Plan Artifact、Change Set、Version Group、transaction journal 或 run-level undo 的事实边界。

交付分为同一阶段内连续执行的两个 gate：

- Stage 4A：项目绑定修复、会话持久化、新建、切换、归档/恢复、重载恢复和旧 run 兼容。
- Stage 4B：当前项目内会话搜索、跨 run 上下文摘要、摘要注入、专项 Electron E2E 和 package gate。

两个 gate 都通过才算 Stage 4 完成。Stage 4 不增加后台无人值守、应用关闭后继续运行、多 Agent、跨项目同步或新的写入权限。

## 2. 目标与非目标

### 2.1 目标

- 一个 conversation 聚合当前项目内按时间发生的多个 Agent run。
- 用户可以新建、切换、归档、恢复和搜索 conversation。
- 应用重载后恢复选中的 conversation、其 run 列表、待回答问题、待审批 Change Set 和 rollback review。
- 同一 conversation 的新 run 可以获得受限、可审计的跨 run 上下文摘要。
- 新建 conversation 从空的模型对话上下文开始。
- 旧的 Stage 1-3 run 仍可读取，不批量改写既有审计记录。
- Stage 2-3 的人工确认、自动写入授权、版本点、事务 journal、冲突处理和 undo 行为保持不变。
- 会话列表和搜索在记录损坏或摘要过期时可局部降级，不让一个坏记录阻断整个项目。

### 2.2 非目标

- 删除 conversation 或删除其 run/history。
- 手工重命名、置顶、标签、文件夹或分享 conversation。
- 跨项目 conversation、云同步或跨设备同步。
- 后台队列、同时运行多个 run、应用关闭后继续执行。
- conversation 级自动写入授权或 conversation 级 undo。
- 把旧的单次 AI suggestion workflow 迁移进 Agent conversation。
- 用额外 provider 请求在后台生成标题或摘要。
- 搜索候选文件全文、原始 provider frame、凭证、隐藏推理或内部 journal。

## 3. 已选架构

```text
Renderer
  -> AgentConversationBridge
       -> Conversation 列表、选择、搜索、归档/恢复
       -> 选中 conversation 的 run 分页与恢复
  -> AgentRunBridge
       -> 当前选中/活动 run 的事件、审批、停止和撤销

Desktop Main / Application
  -> Project-scoped Agent Runtime Manager
       -> AgentConversationSession
       -> AgentRunSession
       -> shared project-bound repositories

Repository
  -> history/conversations/<conversationId>/conversation.json
  -> history/conversations/<conversationId>/summaries/<revision>.json
  -> history/agent-runs/<runId>/...（保持现有结构）
```

Conversation 是元数据和上下文聚合层。run 仍是执行、事件、审批和撤销的唯一作用域。Change Set、Version Group 和 journal 不增加 `conversationId`，它们继续通过 `runId` 关联。

## 4. 先修复项目绑定

当前 desktop Agent runtime 在应用启动时使用固定 `projectRoot` 创建，UI 后续打开其他项目不会自动重建同一套 run repository。Stage 4 的多会话持久化会放大该问题，因此 Stage 4A 首先修复项目绑定。

要求：

- Main 持有 project-scoped runtime manager，而不是一个永久固定目录的 session。
- runtime 只能由已打开 workspace 的规范化 project handle/root 创建；renderer 不传可信根路径。
- ConversationSession 和 AgentRunSession 必须共享同一个 project binding。
- 切换项目时，如果旧项目存在非终态 run，先要求停止或回到旧项目处理；不能让旧 run 静默成为后台任务。
- 项目切换成功后清空 renderer 中旧项目的 conversation/run 选择、写入策略确认和错误状态。
- 任一 conversation/run command 的 `projectId` 与 runtime project 不一致时在 Repository 访问前拒绝。

## 5. 数据合同

### 5.1 Conversation Record

```ts
interface AgentConversationRecord {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Conversation record 不保存 `runIds[]`。新 run 的 `AgentRunSnapshot.conversationId` 是 run 到 conversation 归属的唯一持久化事实，避免 conversation record 与 run snapshot 双写分裂。

新 conversation 初始标题为“新会话”。第一个 run 成功创建后，Application 用首条用户请求生成确定性标题：去除首尾空白、折叠换行、最多 48 个 Unicode code point。该行为不调用模型。

### 5.2 Run 关联

- `StartAgentRunCommand` 在生产 API/IPC 路径上必须携带 `conversationId`。
- `AgentRunSnapshot` 增加 `conversationId: string | null`。
- 新 run 的 `conversationId` 必须是同一项目内、状态为 `active` 的真实 conversation。
- planning run 进入 execution 时，新 execution run 继承 source planning run 的 `conversationId`。
- `AgentRunEvent` 不重复存 `conversationId`；Application/Renderer 通过 `runId -> snapshot.conversationId` 解析归属。
- 旧 snapshot 缺少该字段时读取为 `null`，不改写原文件。

### 5.3 Conversation Summary Revision

```ts
interface AgentConversationSummaryRevision {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly revision: number;
  readonly sourceRunIds: readonly string[];
  readonly throughRunId: string;
  readonly throughRunRevision: number;
  readonly throughRunLastSequence: number;
  readonly content: string;
  readonly createdAt: string;
}
```

Summary revision 不可原地修改。同 revision 已存在且内容不同必须返回 conflict。摘要绑定最后纳入的 run revision 和 event sequence；后续产生 undo 审计事件时，旧摘要标记 stale，并在下一次读取/运行前生成新 revision。

### 5.4 Public Summary DTO

Conversation 列表只返回轻量 DTO：ID、标题、状态、revision、创建/更新时间、runCount、lastRunId、lastRunStatus、preview 和 summary freshness。详细 run events 只在选择 conversation/run 后读取。

列表按 `updatedAt DESC, conversationId ASC` 稳定排序。默认页大小 30，最大 100；cursor 由 Application 生成，renderer 不构造存储路径。

## 6. Repository 设计

新增独立 `AgentConversationFileRepository`，使用 safe ID、原子 JSON 写入、项目根目录内固定系统路径和大小上限。

最小端口：

- `createConversation(record, commandReceipt)`
- `readConversation(conversationId)`
- `listConversations({ projectId, status, cursor, limit })`
- `updateConversation({ conversationId, expectedRevision, title?, status? })`
- `readCommandReceipt(conversationId, commandId)`
- `writeSummary(summaryRevision)`
- `readLatestSummary(conversationId)`
- `listSummaryRevisions(conversationId)`
- `searchConversations({ projectId, query, includeArchived, cursor, limit })`

Run 查询仍由 AgentRun repository 提供，但增加按 `conversationId` 的过滤和稳定分页。Repository 不复制 Plan、Change Set、Version Group 或事件正文到 conversation record。

存储布局：

```text
history/
  conversations/<conversationId>/conversation.json
  conversations/<conversationId>/command-receipts/<commandId>.json
  conversations/<conversationId>/summaries/<revision>.json
  agent-runs/<runId>/...
cache/
  indexes/conversations.json  # 可删除、可重建，不是事实来源
```

坏记录处理：列表和搜索跳过单个损坏 conversation/run，并返回可折叠诊断摘要；直接读取该 ID 时返回稳定错误。搜索缓存损坏时重建，不能把缓存错误升级成 history 丢失。

搜索文档由 Application 从 conversation metadata、latest summary 和关联 run 的 `userRequest` 组装，再交给 Repository 写入可重建索引。Repository 不为了搜索扫描原始 provider frame、候选正文或 transaction journal。

## 7. Application 与 IPC

新增 `AgentConversationSession`：

- `createConversation`
- `listConversations`
- `readConversation`
- `archiveConversation`
- `restoreConversation`
- `searchConversations`
- `readConversationContext`
- `refreshConversationSummary`

有副作用命令携带 `commandId`；archive/restore 携带 `expectedConversationRevision`。重复 command 返回首次 receipt，过期 revision 返回最新 conversation summary。

ConversationSession 与 AgentRunSession 通过窄接口协作：

1. start 前确认 conversation 属于当前项目且为 active。
2. 读取同 conversation 的最新有效摘要和最近 run turns。
3. AgentRunSession 把该上下文作为明确的 conversation data envelope 注入 model messages。
4. run 成功创建后更新 conversation 的标题和 `updatedAt`。
5. run 事件到达时只更新 renderer 和可重建搜索索引；终态后刷新持久化 summary。

start 的事实写入顺序固定为“验证 conversation -> 持久化 run snapshot -> 返回 run started -> 更新 conversation metadata”。最后一步失败时不能删除或重建已启动的 run，也不能让 IPC 重试启动第二个 run；conversation 列表从 run snapshot 推导最新活动并标记 metadata repair，下次读取同步修复标题和 `updatedAt`。

归档限制：conversation 存在非终态 run、待回答问题、待审批 Change Set 或 rollback review 时拒绝归档。归档 conversation 仍可 read/search/restore，但不能创建新 run。

新增 IPC channel 必须同时进入 typed API、allowlist、main handler、preload TypeScript 和 `index.cts`，并通过 `structuredClone` 合同测试。命令 parser 严格检查 ID、revision、query、limit 和 allowed keys，不能只做裸 `isRecord` 强转。

## 8. 跨 Run 上下文

Stage 4 不发起后台摘要模型请求。摘要由 Application 从已持久化事实确定性生成：

- 每个 run 的 `userRequest`；
- 完整 model round 的可见 assistant text；
- 已完成工具的摘要；
- Plan goal/step 状态；
- Change Set 的目标路径与最终状态；
- write/undo/rollback 的结果摘要；
- run 终态和错误码。

Stage 4 开始在每个 model round 可见文本结束后写入 `assistant_text_completed`，提供稳定 transcript 边界。读取旧 run 时允许聚合连续 `assistant_text_delta` 作为兼容 fallback。

摘要最多 8 KiB，最近 6 个 run 的 user/assistant turn 作为 recent context，单条内容有明确上限。更早 run 只保留结构化摘要。压缩必须保留用户目标、批准的 Plan 关联、未解决问题和写入/撤销结果，不能保留隐藏推理或原始 provider frame。

Conversation summary 是数据，不是授权来源。它不能改变 operation mode、context mode、write policy、工具集、项目根目录、Change Set approval 或 undo 决策。新 conversation 不读取其他 conversation 的摘要；搜索结果也不会自动注入上下文。

摘要刷新失败不改变已经成功的 run 终态。Conversation 显示“摘要待刷新”，下次读取或新 run 前同步重建；若重建仍失败，新 run 明确提示并允许用户选择不带历史摘要继续，不能静默使用 stale 摘要。

## 9. UI 与交互

AI activity 使用工作型三栏布局：

- 左侧：紧凑 conversation navigator，包含搜索、Plus 新建、active/archived 筛选和会话行。
- 主区：选中 conversation 的 turn/run 历史、当前 AgentRunPanel 和 composer。
- 右侧 inspector：只显示选中 run 的模式、权限、状态和审批入口，不重复整段对话。

Conversation 行显示标题、更新时间和状态；不用卡片。新建、搜索、归档和恢复使用 Lucide 图标并带 tooltip/aria-label。归档操作放在行菜单；归档项提供恢复按钮。

切换规则：

- 当前项目仍最多一个非终态 run。
- 用户可以浏览其他 conversation，但活动 run 不会因此停止。
- 非活动 conversation 的 composer 禁用，并显示“Conversation X 正在运行”和“返回活动会话”。
- 不允许启动第二个 run，也不提供后台队列。
- 该行为只允许在应用保持打开且项目活动状态持续可见时发生，不增加隐藏 provider session、无人值守调度或应用关闭后继续执行能力。
- 待审批、待回答和 rollback review 明确显示所属 conversation；切换不能把它们附到当前 conversation。
- `user_preapproved_run` 的 acknowledgement 在 run 终态或 conversation 切换后复位；新 conversation 始终默认 `write_before_confirmation`。

窄窗口隐藏右侧 inspector，但主 conversation 区仍保留停止、回答、审批、undo 和错误恢复能力。键盘可完成搜索、列表选择、新建、归档/恢复和返回活动会话；选中行使用 `aria-current`。

## 10. 旧数据兼容

Stage 1-3 snapshot 没有 `conversationId`。这些 run 在 UI 中归入只读虚拟项“历史 Agent 运行”：

- 虚拟项不写入磁盘，不伪造 conversation record。
- 旧 run、Change Set、Version Group、undo 和 rollback review 仍可逐个读取和操作。
- 虚拟项不能启动新 run；用户点击“新建会话继续”时创建真实 conversation，并可把旧 run 的确定性摘要作为一次显式引用加入首个请求。
- 不批量重写旧 `run.json`，避免改变审计历史。

所有新生产 run 必须关联真实 conversation。测试或兼容适配层若直接构造旧 snapshot，只能走明确的 legacy normalization，不能进入 desktop start IPC。

## 11. 错误、恢复与安全

- Conversation ID、project ID 和 command ID 使用与 run 相同的 safe ID 约束。
- 所有存储路径由 Repository 固定拼装，renderer/模型不能传路径。
- conversation/project 不匹配在读取 summary 或 run 前拒绝。
- 创建空 conversation 后 run 创建失败是合法状态；空 conversation 可继续使用或归档。
- 归档不删除任何 run/history/version/journal/undo baseline。
- 搜索只限当前项目；默认不包含 archived。
- Conversation 文本、标题和摘要均视为不可信数据，不能作为权限指令。
- 切换项目或 conversation 不继承 write policy acknowledgement、approval token 或 selected Change Set checksum。
- active run、awaiting 状态和写入事务仍遵守 Stage 1-3 的停止与不可抢占规则。
- post-terminal summary hook 异常只产生 conversation recovery 状态，不把已完成 run 伪装成失败。

## 12. 测试策略

### 12.1 Repository

- create/read/list/update 的 revision、幂等和稳定排序。
- archive/restore 不删除任何关联历史。
- 同项目隔离、非法 ID、路径穿越、reparse point 和损坏记录隔离。
- immutable summary revision 与 checksum/source boundary。
- 搜索中文、大小写、空查询、归档过滤、分页和缓存重建。
- 旧 run 缺少 `conversationId` 的兼容读取。

### 12.2 Application

- 新 run 必须绑定 active conversation 和同一 project。
- planning-to-execution 继承 conversation。
- 单项目第二个活动 run 仍被拒绝。
- 新 conversation 不继承之前的消息或自动写入授权。
- 跨 run context 只来自当前 conversation，摘要不能改变权限。
- 归档阻断 pending question/approval/rollback review。
- summary stale、重建失败和用户选择无历史继续。
- 切换 workspace 后 runtime 使用新的 canonical root。

### 12.3 IPC 与 Renderer

- 所有 conversation DTO 可 structured clone。
- preload 两份实现和 allowlist 完整一致。
- 项目切换清空旧选择；conversation 事件不串流。
- 显式选择 conversation/run 后 hydrate 正确 events 和 review。
- 非当前选中但仍活动的 conversation 事件更新其状态，但不覆盖当前浏览内容。
- write policy acknowledgement 切换后复位。

### 12.4 UI

- 空会话、新建、选择、搜索无结果、归档/恢复和虚拟历史项。
- active/failed/awaiting approval 状态和“返回活动会话”。
- 键盘焦点、`aria-current`、tooltip 和窄窗口操作完整性。
- AI activity 不重复渲染两份完整 conversation。

### 12.5 Electron E2E

新增 `agent-conversations.e2e.ts`，覆盖：

1. 会话 A 完成 run，新建 B 后模型上下文为空。
2. 切回 A 恢复多个 turn、摘要和 timeline。
3. reload 后选中会话、归档和搜索结果仍在。
4. 归档后 run、Version Group 和 run undo 仍可读取/执行。
5. 待回答、待审批和 rollback review 从所属 conversation 恢复。
6. A 的自动写入授权不进入 B。
7. 浏览 B 时 A 的活动 run 仍是项目唯一活动 run，B 不能启动 run。
8. 切换项目后 conversation/run 数据写入新项目根目录。

现有 `agent-run.e2e.ts`、`agent-write.e2e.ts` 和 `agent-run-autonomy.e2e.ts` 继续作为强制回归门，不重写其安全合同。

## 13. 交付门禁

### Stage 4A Gate

- project-scoped runtime binding 测试通过。
- Conversation Repository/Application/IPC/UI 的 create/list/read/archive/restore 测试通过。
- 旧 run 虚拟会话和重载恢复通过。
- Stage 1-3 focused tests、typecheck 和 build 通过。

### Stage 4B Gate

- summary revision、context injection、search 和事件隔离测试通过。
- `agent-conversations.e2e.ts` 通过。
- 三个既有 Agent E2E 继续通过。
- package check 包含 Stage 4 数据隔离、会话 E2E 和 Stage 2-3 回归门。
- lint、typecheck、build、full test、package check 和 `git diff --check` 全部通过。

## 14. 验收标准

- 用户能在当前项目创建、切换、搜索、归档和恢复 conversation。
- Conversation A 的多个 run 能恢复为同一上下文；Conversation B 不继承 A。
- 每个新 run 有且只有一个 conversation，旧 run 不被改写。
- 一个项目始终最多一个活动 run；多会话不引入并行或后台队列。
- Plan、Change Set、Version Group、journal 和 undo 仍以 run 为唯一作用域。
- 归档不造成数据或撤销能力丢失。
- 搜索和摘要不读取项目外数据、不包含敏感 provider 数据、不能扩大权限。
- 切换 workspace 后所有 conversation/run I/O 使用新的 canonical project root。
- Stage 2-3 的默认人工确认、仅本次自动写入和冲突感知 undo 行为无回归。

## 15. 自审结论

- Stage 4 已拆成 4A/4B 两个可独立验收但连续交付的 gate。
- Conversation 与 run 的所有权边界明确，没有复制 Change Set/Version Group 事实。
- 旧 run 使用只读虚拟聚合，不改写审计历史。
- 项目根目录绑定问题被列为 4A 前置条件，不允许会话数据写错项目。
- 搜索、摘要、归档和 UI 切换均未引入新的写权限或后台运行能力。
- 文档没有待定项；标题生成、摘要生成、归档阻断、活动 run 切换和 stale 行为均有确定规则。
