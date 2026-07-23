# Novel Studio Agent 工具补全实施计划

**目标：** 在保持现有 Agent 写入事务、审批、恢复和项目根隔离的前提下，分五期补齐搜索、文件生命周期、受控任务、Git 只读、网络读取和插件/MCP 工具接入。

**设计依据：** `docs/superpowers/specs/2026-07-23-agent-tool-completion-design.md`  
**实现基线：** `08318d4`  
**计划状态：** Candidate，未实施

## 范围锁定

本计划交付：

- 现有 9 个工具保持兼容。
- 新增 13 个静态工具，最终达到 22 个静态工具 ID。
- 插件/MCP 工具以冻结、命名空间化的动态描述符接入。
- Permission Summary、Change Set、事务 journal 和 run event 的向后兼容升级。
- 新工具的权限展示、审批卡、时间线、诊断和 E2E。

本计划不交付：

- 任意原始 Shell。
- Git 写操作和远程 Git 操作。
- 递归删除目录、项目外文件操作或二进制编辑。
- 浏览器自动操作、登录态复用和无限制网页抓取。
- 多 Agent、后台云任务或无人值守长期运行。

## 实施原则

1. 每个 Phase 先写契约/失败测试，再实现最小闭环。
2. 每个 Phase 都有独立 feature flag，关闭时不得向模型暴露工具。
3. 新增变更工具必须先进入 Change Set，再进入审批和事务；不得直接调用 Repository mutation。
4. 工具输入只接受项目相对路径、稳定 ID 或结构化参数。
5. Renderer 只提交用户意图和审批决定，不提交能力清单、绝对路径、命令字符串或 provider secret。
6. 完成当前 Phase 的定向门禁后才能开始下一 Phase。

## Phase 0：扩展注册表与权限基座

### Task 0.1：定义工作区感知的工具能力快照

**新增文件**

- `packages/agent-engine/src/agent-tool-capabilities.ts`
- `packages/agent-engine/test/agent-tool-capabilities.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/src/index.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/workspace-activation-context.ts`
- `packages/application/src/agent-run-draft-session.ts`
- `packages/application/test/agent-run-draft-session.test.ts`

**实施步骤**

1. 新增服务器生成的 `AgentToolCapabilitySnapshot`，至少包含 `workspaceKind`、搜索、文件操作、任务、Git、网络和 external tool flags/revisions。
2. 把 `AgentToolName` 拆成 `CoreAgentToolName` 与受模板字面量约束的 `NamespacedExternalToolName`。
3. 扩展 descriptor 的 `kind/effect`，保留已有描述符序列和 schema 不变。
4. `listAgentTools` 接受 capability snapshot；未提供时按旧 v1 能力关闭所有新增工具，确保现有调用方兼容。
5. 增加 22 个静态 ID 的唯一性、名称、schema 大小和模式矩阵测试。
6. 增加每轮静态/动态描述符数量和描述字节预算；超限返回稳定错误。

**验收**

- 所有 feature flag 关闭时，四种旧矩阵仍为 6/4/7/5。
- capability snapshot 不能由 renderer DTO 或项目文件构造。
- 同名动态工具、非法命名空间和 schema 超预算被拒绝。

### Task 0.2：升级 Permission Summary

**修改文件**

- `packages/agent-engine/src/permission-summary.ts`
- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/test/permission-summary.test.ts`
- `packages/application/src/agent-permission-session.ts`
- `packages/application/test/agent-permission-session.test.ts`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/test/agent-composer.test.tsx`

**实施步骤**

1. 增加 Permission Summary v1.1 类型和 v1.0 归一化读取。
2. 新增 `workspaceKind`、execution/external capabilities 及任务、网络、external registry revisions。
3. 把固定 forbidden 列表改为服务器按已启用阶段计算；调用方仍无权传入该数组。
4. registry revision 覆盖所有静态 descriptor，并在 run start 单独绑定本次动态 descriptor revision。
5. 扩展 drift 检查和 checksum；旧摘要可读取，但不能被误判为已授权新能力。
6. UI 按读取、修改提案、任务、网络、外部工具和禁止能力分组展示。

**验收**

- v1.0 fixture 可读取并默认拒绝所有新增能力。
- 工具、任务 allowlist、网络域或插件 schema 任一漂移都会阻断 run start。
- “本次自动修改”不会移除 delete/move/task/network/external 的确认要求。

### Task 0.3：为多种工具效果建立执行端口

**新增文件**

- `packages/application/src/agent-tool-ports.ts`
- `packages/application/test/agent-tool-ports.test.ts`

**修改文件**

- `packages/application/src/agent-run-session.ts`
- `packages/application/src/index.ts`
- `packages/application/test/agent-run-session.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/test/desktop-agent-run-runtime.test.ts`

**实施步骤**

1. 保留 `AgentReadToolExecutor` 兼容入口，并新增 search、execute、external executor ports。
2. 把 `handleToolCall` 的 descriptor 分类和结果包络抽到小型 dispatcher；run session 继续拥有事件顺序、计数、重试和终态。
3. 所有读取结果统一返回 summary/data/source/truncated；所有外部结果标记来源和不可信数据策略。
4. 未注入对应 executor 时返回稳定的 `AGENT_TOOL_RUNTIME_UNAVAILABLE`，不得回退成文本模拟。
5. 保持 duplicate toolCallId、schema、大小、连续失败和总调用数限制。

**Phase 0 定向门禁**

```powershell
npm test -- packages/agent-engine/test/tool-registry.test.ts packages/agent-engine/test/permission-summary.test.ts packages/application/test/agent-permission-session.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts
npm run typecheck
```

## Phase A：项目搜索与引用

### Task A.1：实现受限 Agent 搜索 Repository

**新增文件**

- `packages/repository/src/agent-project-search-repository.ts`
- `packages/repository/test/agent-project-search-repository.test.ts`

**修改文件**

- `packages/repository/src/index.ts`
- `packages/repository/src/search-index-repository.ts`
- `packages/repository/test/search-index-repository.test.ts`
- `packages/schemas/schema/search-index.schema.json`
- `packages/schemas/test/schema-contract.test.ts`

**实施步骤**

1. 定义 `searchText` 和 `findReferences` 端口，结果包含相对路径、ref、范围、snippet、checksum 和截断信息。
2. creative project 复用现有章节/Story Bible 索引；补项目文本索引和稳定 ref。
3. engineering workspace 使用有界遍历，忽略 `.git`、`node_modules`、构建输出、缓存、二进制、symlink 和超大文件。
4. 对 query、include/exclude glob、最大结果、单条摘要和总字节数设置硬上限。
5. 索引重建与查询不能跟随 reparse point，不能返回绝对路径。

**验收**

- 恶意 `../`、反斜杠、设备名、绝对路径和 symlink fixture 全部拒绝。
- 超限结果有确定排序和 `truncated: true`。
- 搜索结果不能包含 `.git`、secret 配置目录或二进制正文。

### Task A.2：接入 `search_project_text` 与 `find_project_references`

**新增文件**

- `packages/application/src/agent-search-tool-session.ts`
- `packages/application/test/agent-search-tool-session.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/index.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/application-composition.ts`
- `apps/desktop/test/agent-context-runtime.e2e.ts`
- `packages/ui/src/agent-run-timeline.tsx`
- `packages/ui/test/agent-run-panel.test.tsx`

**实施步骤**

1. 为两个工具添加严格 JSON Schema；第一版引用查询只接受 stable ref/path，不接受任意正则。
2. 在 Main/Application 根据 workspace activation 注入正确 Repository。
3. 将结果放入 `untrusted_project_data` 包络；用户可读事件只记录查询摘要、命中数量和截断状态。
4. 搜索结果加入 Context Snapshot 时只保存用户/模型实际读取的命中，不把全部搜索正文自动塞入上下文。
5. 增加 planning/execution、writing/general_file 四组合 E2E。

**Phase A 定向门禁**

```powershell
npm test -- packages/repository/test/agent-project-search-repository.test.ts packages/application/test/agent-search-tool-session.test.ts packages/agent-engine/test/tool-registry.test.ts apps/desktop/test/agent-context-runtime.e2e.ts
npm run typecheck
npm run lint
```

## Phase B：领域创建与文件生命周期

### Task B.1：把 Change Set 升级为操作型 v1.1

**修改文件**

- `packages/agent-engine/src/change-set.ts`
- `packages/agent-engine/src/index.ts`
- `packages/agent-engine/test/change-set.test.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/test/change-set-session.test.ts`
- `packages/repository/src/agent-run-repository.ts`
- `packages/repository/test/agent-run-repository.test.ts`
- `packages/ui/src/change-set-review.tsx`
- `packages/ui/test/change-set-review.test.tsx`

**实施步骤**

1. 增加 Change Set v1.1 operation union：modify/create_file/move_file/delete_file/create_directory。
2. 保留 v1.0 modify-only 读取和 checksum 校验；新 Change Set 只写 v1.1。
3. selection 从“文件+hunks”扩展为“operation+hunks”；move/delete/mkdir 只能整项选择。
4. checksum 和 approval token 覆盖 operation kind、源/目标路径、base checksum 和候选内容。
5. Review UI 对 create/move/delete/mkdir 使用明确标签；删除不得显示成空 replacement。

**验收**

- 更改 operation kind、目标路径或 base checksum 会让 approval token 失效。
- v1.0 persisted fixture 仍能审批和应用。
- delete/move/mkdir 不接受部分 hunk 选择。

### Task B.2：扩展事务 journal、补偿和撤销

**修改文件**

- `packages/repository/src/ports.ts`
- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/src/history-repository.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/src/atomic-write.ts`
- `packages/repository/test/agent-write-transaction.test.ts`
- `packages/repository/test/history-versions.test.ts`
- `packages/repository/test/repository-core.test.ts`
- `packages/agent-engine/src/transaction-journal.ts`
- `packages/agent-engine/test/version-group.test.ts`

**实施步骤**

1. journal entry 增加 operation kind、源/目标路径和应用/补偿状态，保留旧 entry 归一化。
2. create_file：目标必须不存在；失败补偿只删除本事务成功创建且 checksum 未变的文件。
3. move_file：校验源 checksum 和目标不存在；补偿执行逆向移动并再次校验。
4. delete_file：应用前写受保护 baseline；补偿/undo 从 baseline 原路径恢复。
5. create_directory：只创建单层受管目录；补偿只删除本事务创建且仍为空的目录。
6. 所有操作复用项目锁、canonical Path Guard、dirty/stale 检查、版本组和恢复 journal。
7. 注入逐步骤失败 fixture，验证任意中点失败后项目内容恢复到事务前状态。

**验收**

- 不存在递归删除路径。
- symlink/reparse、目标竞争创建、dirty buffer、项目锁丢失和 stale base 均在 mutation 前阻断。
- 应用崩溃后重启可继续补偿，run 级撤销可恢复 create/move/delete。

### Task B.3：实现 6 个创建/文件操作工具

**新增文件**

- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/test/agent-file-operation-session.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/agent-run-session.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/application-composition.ts`
- `packages/repository/src/chapter-repository.ts`
- `packages/repository/src/story-bible-repository.ts`
- `packages/repository/src/engineering-workspace-repository.ts`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/test/agent-write.e2e.ts`
- `apps/desktop/test/agent-run-autonomy.e2e.ts`

**工具**

- `propose_chapter_create`
- `propose_story_bible_write`
- `propose_file_create`
- `propose_file_move`
- `propose_file_delete`
- `propose_directory_create`

**实施步骤**

1. 每个工具只生成 Change Set operation，不直接 mutation。
2. 章节创建由 Repository 分配/校验稳定 chapter ID 和目标路径；模型不能提交绝对路径。
3. Story Bible 写入先走结构化 schema validation，再生成候选文件内容。
4. move/rename、delete、mkdir 强制人工批准，即使 write policy 为 `user_preapproved_run`。
5. 同一模型轮次如混有 proposal 和 read/control，沿用现有 proposal 优先规则，并拒绝互相冲突的 operation。
6. 为批准、拒绝、部分选择、stale、应用失败、补偿、重载和 undo 增加 E2E。

**Phase B 定向门禁**

```powershell
npm test -- packages/agent-engine/test/change-set.test.ts packages/application/test/change-set-session.test.ts packages/application/test/agent-file-operation-session.test.ts packages/repository/test/agent-write-transaction.test.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts
npm run typecheck
npm run lint
npm run build
```

## Phase C：受控任务与 Git 只读

### Task C.1：建立冻结的项目任务目录

**新增文件**

- `packages/repository/src/project-task-catalog-repository.ts`
- `packages/repository/test/project-task-catalog-repository.test.ts`
- `packages/application/src/agent-task-session.ts`
- `packages/application/test/agent-task-session.test.ts`
- `apps/desktop/src/main/agent-task-sandbox.ts`
- `apps/desktop/test/agent-task-sandbox.test.ts`

**修改文件**

- `packages/repository/src/index.ts`
- `packages/application/src/agent-tool-ports.ts`
- `apps/desktop/src/main/application-composition.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`

**实施步骤**

1. 从受支持项目清单生成 task candidate；用户明确授权后才写入 app-local 任务目录。目录记录 launcher、参数 schema、cwd、文件范围、网络模式、风险等级和 revision。
2. 不向模型展示原始命令；工具输入只接受 task ID 和 schema 验证后的参数数组。项目 script 可能间接使用 shell，必须在审批 UI 中如实标记。
3. 定义 `AgentTaskSandboxPort` 和 readiness report。只有 workspace 文件隔离、网络策略、最小环境、进程树 containment、超时和 teardown 全部 ready 时才允许注册任务工具。
4. Desktop adapter 通过 sandbox 启动任务；禁止在 sandbox 不可用时回退到普通 `spawn`。cwd 只是工作目录，不得被当作文件系统隔离。
5. 支持 AbortSignal、超时、进程树终止、stdout/stderr 分流和输出上限；环境默认不继承 secret。
6. 任务目录和 sandbox revision 在 run start 冻结并加入 Permission Summary；运行中变化触发拒绝或终止。

### Task C.2：增加工具调用审批状态机

**修改文件**

- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/src/agent-run-coordinator.ts`
- `packages/agent-engine/test/agent-run-coordinator.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/ipc-contract.ts`
- `packages/application/src/novel-studio-api.ts`
- `apps/desktop/src/main/ipc-allowlist.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- `apps/desktop/src/renderer/agent-run-bridge.ts`
- `packages/ui/src/agent-run-panel.tsx`
- `packages/ui/test/agent-run-panel.test.tsx`
- `apps/desktop/test/agent-run-ipc.test.ts`

**实施步骤**

1. 新增 `tool_approval_requested/resolved` 事件、`awaiting_tool_approval` 状态和幂等 resolve command。
2. 审批记录绑定 run revision、toolCallId、descriptor revision、参数摘要、task catalog revision 和过期时间。
3. UI 显示任务名、cwd 相对位置、风险、参数摘要和超时；不显示 secret 环境。
4. 只有明确的 run-scoped task allowlist 可免同任务重复确认；拒绝、取消、重载和过期都不得执行。

### Task C.3：接入 `run_project_task`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/test/agent-permission-plan.e2e.ts`
- `apps/desktop/test/agent-diagnostics.e2e.ts`

**实施步骤**

1. 只在 engineering + general_file + execution、task capability enabled 且 sandbox readiness 为 ready 时注册。
2. 每次调用先持久化审批 checkpoint，再启动进程。
3. 结构化回填 exit code、duration、stdout/stderr 摘要和 truncation；输出作为不可信数据。
4. stop/cancel 必须终止进程树并产生唯一终态。

### Task C.4：实现 `git_status` 和 `git_diff`

**新增文件**

- `packages/application/src/agent-git-tool-session.ts`
- `packages/application/test/agent-git-tool-session.test.ts`
- `apps/desktop/src/main/git-read-adapter.ts`
- `apps/desktop/test/git-read-adapter.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/application-composition.ts`
- `packages/ui/src/agent-run-timeline.tsx`

**实施步骤**

1. 用固定 executable 和参数数组执行 status/diff；隔离 HOME/global/system config，关闭可交互输入、pager、credential prompt、fsmonitor、external diff 和 textconv。
2. 仅在 canonical worktree root 和 Git directory 都位于允许的 workspace/state 边界时注册；首版拒绝外置 gitdir/worktree 指针。
3. 设置 `GIT_TERMINAL_PROMPT=0` 和 `GIT_OPTIONAL_LOCKS=0`，不读取用户 credential/helper 配置。
4. diff pathspec 经过 Path Guard；输出超限时返回统计和截断摘要。
5. 不实现任何 Git mutation 或网络子命令。

**Phase C 定向门禁**

```powershell
npm test -- packages/repository/test/project-task-catalog-repository.test.ts packages/application/test/agent-task-session.test.ts apps/desktop/test/agent-task-sandbox.test.ts packages/application/test/agent-git-tool-session.test.ts apps/desktop/test/git-read-adapter.test.ts apps/desktop/test/agent-permission-plan.e2e.ts
npm run typecheck
npm run lint
```

## Phase D：网络读取

### Task D.1：建立网络策略与 provider 端口

**新增文件**

- `packages/application/src/agent-network-policy.ts`
- `packages/application/src/agent-network-tool-session.ts`
- `packages/application/test/agent-network-policy.test.ts`
- `packages/application/test/agent-network-tool-session.test.ts`
- `apps/desktop/src/main/agent-network-runtime.ts`
- `apps/desktop/test/agent-network-runtime.test.ts`

**修改文件**

- `packages/schemas/schema/settings.schema.json`
- `packages/application/src/model-settings-session.ts`
- `packages/repository/src/settings-repository.ts`
- `packages/ui/src/model-settings-panel.tsx`
- `apps/desktop/src/main/application-composition.ts`

**实施步骤**

1. 增加默认关闭的网络设置、provider profile、允许域和 policy revision；secret 仍使用现有 secret seam。
2. 实现 URL 规范化、协议限制、DNS/IP 校验、私网/localhost/link-local 拒绝和逐跳重定向校验。
3. 限制连接/总超时、重定向次数、内容类型、压缩后大小和并发数。
4. 错误和审计只记录脱敏 host/path 摘要，不记录 query secret、Authorization 或响应原文。

### Task D.2：接入 `web_search` 与 `fetch_url`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-run-session.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/test/agent-context-runtime.e2e.ts`

**实施步骤**

1. 工具只在 network policy、provider 和本次 run 许可同时满足时注册。
2. `web_search` 返回标题、URL、摘要、provider 和时间；`fetch_url` 返回来源元数据和有界文本。
3. 所有远程内容使用 `untrusted_remote_data` 包络，不能改变系统指导、工具权限或审批策略。
4. 设置关闭、provider 失效、域不允许、DNS 漂移、重定向越界、超时和超限均覆盖测试。

**Phase D 定向门禁**

```powershell
npm test -- packages/application/test/agent-network-policy.test.ts packages/application/test/agent-network-tool-session.test.ts apps/desktop/test/agent-network-runtime.test.ts apps/desktop/test/agent-context-runtime.e2e.ts
npm run typecheck
npm run lint
npm audit
```

## Phase E：插件/MCP 动态工具

### Task E.1：扩展插件 manifest 的 Agent 工具贡献点

**修改文件**

- `packages/schemas/schema/plugin-manifest.schema.json`
- `packages/schemas/test/schema-contract.test.ts`
- `packages/plugin-engine/src/plugin-engine.ts`
- `packages/plugin-engine/test/plugin-engine.test.ts`
- `packages/application/src/plugin-runtime-session.ts`
- `packages/application/test/plugin-runtime-session.test.ts`
- `packages/repository/src/plugin-registry-repository.ts`
- `packages/repository/test/plugin-registry-repository.test.ts`

**实施步骤**

1. 新增 tool contribution：tool ID、description、input schema、effect、permissions、timeout 和最大输出。
2. 只有签名/信任满足、isolation readiness 为 ready、权限满足的贡献进入 Agent tool catalog。
3. 规范化为 `plugin:<pluginId>/<toolId>`；拒绝冲突、非法字符和超预算 schema。
4. 插件不能声明其 sandbox policy 明确禁止的 shell/network/model/asset-write 能力。

### Task E.2：建立 MCP server 配置与冻结目录

**新增文件**

- `packages/application/src/mcp-settings-session.ts`
- `packages/application/src/agent-external-tool-session.ts`
- `packages/application/test/mcp-settings-session.test.ts`
- `packages/application/test/agent-external-tool-session.test.ts`
- `packages/repository/src/mcp-settings-repository.ts`
- `packages/repository/test/mcp-settings-repository.test.ts`
- `apps/desktop/src/main/mcp-runtime.ts`
- `apps/desktop/test/mcp-runtime.test.ts`

**修改文件**

- `packages/schemas/schema/settings.schema.json`
- `packages/application/src/agent-tool-ports.ts`
- `apps/desktop/src/main/application-composition.ts`

**实施步骤**

1. MCP server 配置默认 disabled；命令/URL、环境 secret 和工作目录只存在 Main/Repository 安全边界。本地 stdio server 必须复用 task sandbox，远程 server 必须复用 network policy。
2. 连接时发现工具，校验 schema 和权限，生成 `mcp:<serverId>/<toolId>` 描述符及 revision。
3. Run start 冻结本次工具目录；运行中 server 变化不得扩权。
4. 每次调用执行超时、取消、输出大小和 teardown；断线不自动切换到不受控 transport。

### Task E.3：接入动态 Tool Registry 和统一审批

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/src/permission-summary.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-permission-session.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/test/agent-permission-plan.e2e.ts`
- `apps/desktop/test/agent-diagnostics.e2e.ts`

**实施步骤**

1. 将冻结的动态 descriptor 合并到静态列表，并执行总数量/字节预算。
2. 动态工具按 effect 走已有 read/propose/tool approval 路径；external effect 不继承文件写入自动审批。
3. 审计记录来源、版本、tool ID、耗时、输入摘要、结果大小和脱敏错误。
4. 插件/MCP disabled、untrusted、schema drift、timeout、cancel、crash 和 teardown 失败均有稳定诊断。

**Phase E 定向门禁**

```powershell
npm test -- packages/schemas/test packages/plugin-engine/test packages/application/test/plugin-runtime-session.test.ts packages/application/test/agent-external-tool-session.test.ts apps/desktop/test/mcp-runtime.test.ts apps/desktop/test/agent-permission-plan.e2e.ts
npm run typecheck
npm run lint
npm audit
```

## 最终 UI、诊断和产品门禁

### Task F.1：完成用户可见状态

**修改文件**

- `packages/ui/src/agent-composer.tsx`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/src/agent-run-panel.tsx`
- `packages/ui/src/agent-run-timeline.tsx`
- `packages/ui/src/agent-error-card.tsx`
- `packages/ui/src/change-set-review.tsx`
- `packages/ui/src/styles.css`
- `packages/ui/test/agent-composer.test.tsx`
- `packages/ui/test/agent-run-panel.test.tsx`
- `packages/ui/test/change-set-review.test.tsx`
- `apps/desktop/test/agent-diagnostics.e2e.ts`

**验收**

- 用户在发送前能看见本次 read/propose/execute/network/external 权限。
- delete/move/task/external 副作用有独立审批卡和明确拒绝入口。
- 搜索、Git、任务、网络和 external 工具都有可理解的时间线标签。
- 原始命令、绝对路径、API key、Authorization 和完整敏感参数不进入 renderer。

### Task F.2：补全持久化兼容和恢复矩阵

**修改文件**

- `packages/repository/src/agent-run-repository.ts`
- `packages/repository/test/agent-run-repository.test.ts`
- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/src/transaction-journal.ts`
- `packages/agent-engine/test/stage5-event-contract.test.ts`
- `apps/desktop/test/agent-run.e2e.ts`
- `apps/desktop/test/agent-run-autonomy.e2e.ts`

**验收**

- 旧 Permission Summary、Change Set、run snapshot/event、journal fixtures 全部可读。
- awaiting tool approval、运行中任务、待审批文件操作和 external tool 失败在重载后都有确定恢复状态。
- 关闭 feature flag 后恢复旧 run 时只允许完成已有安全恢复，不允许发起新增调用。

### Task F.3：同步产品文档和发布状态

**修改文件**

- `ROADMAP.md`
- `INDEX.md`
- `CHANGELOG.md`
- `TECH_DEBT.md`
- `AGENT_ENGINE.md`
- `PLUGIN_SYSTEM.md`
- `docs/releases/m98-v1-ship-readiness.md`

只在相应 Phase 真实通过后更新状态；不得提前把 Candidate 写成 Complete。

## 实施文件总表

### 核心修改文件

| 层           | 文件                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Engine | `tool-registry.ts`、`permission-summary.ts`、`change-set.ts`、`agent-run-types.ts`、`transaction-journal.ts`                          |
| Application  | `agent-run-session.ts`、`change-set-session.ts`、`agent-permission-session.ts`、`ipc-contract.ts`、`novel-studio-api.ts`              |
| Repository   | `agent-project-read-repository.ts`、`search-index-repository.ts`、`agent-write-transaction.ts`、`agent-run-repository.ts`、`ports.ts` |
| Desktop Main | `agent-run-runtime.ts`、`application-composition.ts`、`ipc-handlers.ts`、`ipc-allowlist.ts`                                           |
| UI/Renderer  | `agent-run-bridge.ts`、`agent-permission-menu.tsx`、`agent-run-panel.tsx`、`agent-run-timeline.tsx`、`change-set-review.tsx`          |

### 主要新增实现文件

| 能力          | 新文件                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| 工具能力/端口 | `agent-tool-capabilities.ts`、`agent-tool-ports.ts`                                                         |
| 搜索          | `agent-project-search-repository.ts`、`agent-search-tool-session.ts`                                        |
| 文件操作      | `agent-file-operation-session.ts`                                                                           |
| 任务          | `project-task-catalog-repository.ts`、`agent-task-session.ts`、`agent-task-sandbox.ts`                      |
| Git           | `agent-git-tool-session.ts`、`git-read-adapter.ts`                                                          |
| 网络          | `agent-network-policy.ts`、`agent-network-tool-session.ts`、`agent-network-runtime.ts`                      |
| External/MCP  | `mcp-settings-session.ts`、`agent-external-tool-session.ts`、`mcp-settings-repository.ts`、`mcp-runtime.ts` |

## 最终验证

每个 Phase 的定向测试通过后，最终运行：

```powershell
npm run format
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run build
npm run package:check
npm audit
git diff --check
```

最终人工验证至少覆盖：

1. 创作项目规划模式搜索章节/Story Bible 引用，不出现写工具。
2. 创作执行创建章节和修改 Story Bible，审批、重载、应用和 undo 完整。
3. 工程执行创建、移动、重命名和删除文本文件，中点失败可补偿。
4. 任务调用必须审批、可取消、可超时，停止 run 后无残留子进程。
5. Git status/diff 只读且超限可见，不触发 hook、凭据或网络。
6. 网络默认关闭；开启后拒绝私网/重定向逃逸并显示来源。
7. 插件/MCP 未签名、未 ready 或 schema 漂移时不出现在模型工具清单。
8. 所有 feature flag 关闭时，现有 9 工具和旧 E2E 行为无回归。

## 完成定义

- 设计文件中的 22 个静态工具全部按条件注册、执行和审计。
- 六类能力缺口均至少有一个安全、可用的工具闭环。
- 动态插件/MCP 工具不绕过 registry revision、Permission Summary 或审批。
- 没有新增直接 mutation、任意 Shell、Git 写操作或项目根逃逸路径。
- 全部门禁通过，文档只把真实交付的 Phase 标为 Complete。
