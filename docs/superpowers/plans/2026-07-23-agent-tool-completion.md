# Novel Studio Agent 工具补全实施计划

**目标：** 在保持现有 Agent 写入事务、审批、恢复和项目根隔离的前提下，按依赖图补齐搜索、文件生命周期、受控任务、Git 只读、网络读取和插件/MCP 工具接入。

**设计依据：** `docs/superpowers/specs/2026-07-23-agent-tool-completion-design.md`  
**实现基线：** `5a9a72b`<br>
**计划状态：** Candidate，设计合同与阶段门禁已对齐，未实施

## 范围锁定

本计划交付：

- 现有 9 个工具保持兼容。
- 新增 13 个静态工具，最终达到 22 个静态工具 ID。
- 插件/MCP 工具以冻结、命名空间化的动态描述符接入。
- Permission Summary、Change Set、事务 journal 和 run event 的向后兼容升级。
- 新工具的权限展示、审批卡、时间线、诊断和 E2E。
- Main-owned 的 feature flag、Task Catalog、Network、Plugin/MCP 控制面和 kill switch。

本计划不交付：

- 任意原始 Shell。
- Phase C 首版的联网项目任务、非 Windows 平台任务执行或任何不受控 fallback launcher。
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
6. 按依赖图推进：Phase 0 是共同基座；A、B、D 在依赖满足后可独立推进；C.0 是本地第三方进程能力的资格门；插件、本地 MCP、远程 MCP 分别依赖各自的安全边界。不得把无关 Phase 强制串行化。
7. 安全 readiness 必须来自独立黑盒 probe 的外部可观察结果；生产 validator、自报 DTO、Mock Port 和源码分支检查只能作为补充证据。
8. 每个 OS 隔离测试都必须有普通 `spawn` 或故意关闭保护的负对照，证明测试能够发现保护缺失；负对照未暴露预置 canary 时，资格测试自身无效。
9. 任一安全能力为 missing、unknown、partial、stale 或 drift 时均按 unavailable 处理；不允许“尽力而为”或降级路径。
10. Phase C 以及 Phase E 的本地进程路径必须验证打包产物中的真实 helper、摘要、策略和进程行为，不能只验证源码或测试 fixture。
11. 每个 Phase 必须在本阶段交付 registry/权限、Main/Application 执行、用户控制或审批 UI、持久化恢复、诊断和 feature flag；最终阶段只做跨阶段回归与发布检查。

## Phase 0：扩展注册表与权限基座

### Task 0.1：定义工作区感知的工具能力快照

**新增文件**

- `packages/agent-engine/src/agent-tool-capabilities.ts`
- `packages/agent-engine/src/agent-tool-schema.ts`
- `packages/agent-engine/test/agent-tool-capabilities.test.ts`
- `packages/agent-engine/test/agent-tool-schema.test.ts`
- `packages/application/src/agent-tool-provider-mapping.ts`
- `packages/application/test/agent-tool-provider-mapping.test.ts`
- `apps/desktop/src/main/agent-feature-flags.ts`
- `apps/desktop/test/agent-feature-flags.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/src/index.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/workspace-activation-context.ts`
- `packages/application/src/agent-run-draft-session.ts`
- `packages/application/src/agent-run-model-driver.ts`
- `packages/application/test/agent-run-draft-session.test.ts`

**实施步骤**

1. 新增服务器生成的 `AgentToolCapabilitySnapshot`，至少包含 `workspaceKind`、搜索、文件操作、任务、Git、网络、external tool flags/revisions 和当前 feature-flag revision；任务/Git 能力只能引用 Main qualification service 当前进程内 store 生成的 opaque attestation ID。
2. 建立不可变 canonical static catalog，拆分 `CoreAgentToolName`、命名空间 canonical ID、用户可读名称和 provider-safe `providerName`；映射由 Main 在 run start 生成、校验碰撞并冻结，不能由 renderer、模型或项目文件提交。
3. 所有静态/动态描述符使用严格 JSON Schema 子集校验；拒绝未知关键字、远程 `$ref`、递归引用、危险正则和控制字符，并限制 schema、description、名称和总目录字节预算。来源提供的 description/schema 文本始终是不可信目录元数据，不能成为系统指导。
4. `listAgentTools` 接受 Main 生成的 capability snapshot；未提供时按旧 v1 能力关闭所有新增工具，静态 registry revision 仍从完整 canonical catalog 计算，避免通过过滤结果间接枚举版本。
5. 在 provider adapter 发送前预编译 schema，并按当前 provider 的名称、schema、tool-count 和请求字节限制做无损校验；无法映射的工具整体不注册，不弱化 schema 继续。
6. 在流式组装参数阶段、JSON parse 之前执行单次 1 MiB 上限；同时建立 model round/run 累计结果字节/token 预算，超限返回稳定错误并只允许摘要/`toolResultRef` 回填。
7. 每个 Phase flag 默认关闭、由 Main 持有并带 revision/kill switch；renderer 只能读取状态，不能改变能力快照或 forbidden 列表。

**验收**

- 所有 feature flag 关闭时，四种旧矩阵仍为 6/4/7/5。
- capability snapshot 和 sandbox attestation 不能由 renderer DTO、项目文件、模型输出、任务目录或 adapter 调用方构造。
- 同名动态工具、非法命名空间、provider 名称碰撞、schema/description 超预算和 provider 不支持的 schema 被拒绝。
- 参数超限在 parse 前被拒绝并终止；单轮和 run 累计结果预算耗尽时不会继续向模型注入原始结果。

### Task 0.2：升级 Permission Summary

**新增文件**

- `packages/agent-engine/src/effective-capability-state.ts`
- `packages/agent-engine/test/effective-capability-state.test.ts`

**修改文件**

- `packages/agent-engine/src/permission-summary.ts`
- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/test/permission-summary.test.ts`
- `packages/application/src/agent-permission-session.ts`
- `packages/application/test/agent-permission-session.test.ts`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/test/agent-composer.test.tsx`

**实施步骤**

1. 增加 Permission Summary v1.1 类型和 v1.0 归一化读取；同时建立不可变的 `EffectiveCapabilityState`，只允许缩权并记录撤销原因、revision 和检查时间。
2. 新增 `workspaceKind`、execution/external/data-egress capabilities、任务/网络/external/provider mapping/feature-flag revisions，以及 sandbox host digest、attestation ID、policy/test-vector revision、有效期和 Git boundary fingerprint。
3. 把固定 forbidden 列表改为服务器按已启用阶段计算；调用方仍无权传入该数组。
4. registry revision 覆盖所有静态 descriptor，并在 run start 单独绑定本次动态 descriptor revision。
5. 扩展 drift 检查和 checksum；旧摘要可读取，但不能被误判为已授权新能力。
6. UI 按读取、修改提案、任务、网络、外部工具和禁止能力分组展示，同时区分历史批准与当前仍有效的能力。

**验收**

- v1.0 fixture 可读取并默认拒绝所有新增能力。
- 工具、任务 allowlist、sandbox attestation/host/policy/test-vector、Git boundary、网络域或插件 schema 任一漂移都会阻断 run start。
- “本次自动修改”不会移除 delete/move/task/network/external 的确认要求。
- App 重启、attestation/连接过期或 feature flag 关闭不会复活旧批准；模型请求、直接调用和 UI 都只使用 Permission Summary 与 Effective Capability State 的交集。

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
6. execute port 只接受 `AgentTaskSandboxPort` 返回的结构化结果；Application、Agent Runtime 和 task session 通过边界测试禁止导入 `node:child_process`。
7. 为 `external_action` 固定 `idempotency_key_required`/`never_automatic` 重试语义；远程工具无法证明请求是否送达时返回 `outcome_unknown`，不自动重试。

### Task 0.4：升级 Run Snapshot/Event 合同

**修改文件**

- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/src/transaction-journal.ts`
- `packages/agent-engine/test/stage5-event-contract.test.ts`
- `packages/repository/src/agent-run-repository.ts`
- `packages/repository/test/agent-run-repository.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/test/agent-run-session.test.ts`

**实施步骤**

1. 保留 v1.0/v1.1 读取兼容；新增审批等待、能力撤销、进程输出和不确定外部终态时写 Run Snapshot/Event v1.2，不向既有 v1.1 严格枚举追加新值。
2. 让 snapshot 冻结 canonical/provider 映射、descriptor digest、Effective Capability revision、数据外发授权和待执行调用队列。
3. 重载时只恢复可证明的等待/补偿状态；旧审批、过期 attestation、失效连接和关闭 flag 均恢复为不可执行，不产生新进程或外部调用。

**验收**

- v1.0/v1.1 fixture 可读，新增状态/事件以 v1.2 写入。
- 重放、崩溃恢复和未知外部终态都有确定结果，未执行的副作用调用不会在内存丢失或自动重放。

**Phase 0 定向门禁**

```powershell
npm test -- packages/agent-engine/test/tool-registry.test.ts packages/agent-engine/test/agent-tool-schema.test.ts packages/agent-engine/test/permission-summary.test.ts packages/agent-engine/test/effective-capability-state.test.ts packages/agent-engine/test/stage5-event-contract.test.ts packages/application/test/agent-tool-provider-mapping.test.ts packages/application/test/agent-permission-session.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/agent-feature-flags.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts
npm run typecheck
npm run lint
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

1. 定义 `searchText` 和 `findReferences` 端口，结果包含相对路径、stable ref、显式 `range.unit`（UTF-16 offset 或 1-based line/column）、snippet、source checksum、result digest 和截断信息。
2. creative project 复用现有章节/Story Bible 索引；补项目文本索引和稳定 ref。
3. engineering workspace 使用有界遍历，忽略 `.git`、`node_modules`、构建输出、缓存、二进制、symlink 和超大文件。
4. 对 query、include/exclude glob、最大结果、单条 snippet 和总字节数设置硬上限；稳定排序、digest 和截断状态必须在相同索引版本下可复现。
5. 升级搜索 cache schema/version；旧索引只能确定地丢弃重建，不能按新结构原地解释。索引构建和查询都不能跟随 reparse point，也不能返回绝对路径。
6. 搜索索引只作为可重建缓存；索引损坏、版本未知或 workspace fingerprint 漂移时回到重建/不可用状态，不返回混合版本结果。

**验收**

- 恶意 `../`、反斜杠、设备名、绝对路径和 symlink fixture 全部拒绝。
- 超限结果有确定排序和 `truncated: true`。
- 搜索结果不能包含 `.git`、secret 配置目录或二进制正文。
- 旧 cache fixture 会重建；同一命中范围单位明确，source checksum/result digest 可验证。

### Task A.2：接入 `search_project_text` 与 `find_project_references`

**新增文件**

- `packages/application/src/agent-search-tool-session.ts`
- `packages/application/test/agent-search-tool-session.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-run-model-driver.ts`
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
4. 只把工具消息实际回填的有界 snippet/元数据写入 Context Snapshot；已进入 tool message 的内容必须计入本轮与 run 累计预算，完整正文继续通过既有读取工具按需取得。
5. 增加 planning/execution、writing/general_file 四组合和 `workspaceKind` 漂移 E2E，证明工具注册、Repository 注入和 source envelope 使用同一 Main-owned workspace identity。
6. 本阶段同步交付搜索时间线、截断/重建诊断和重载兼容；Phase A flag 关闭后旧 run 不得发起新搜索。

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

1. 增加 Change Set v1.1 operation union：modify/create_file/move_file/delete_file/create_directory；每项包含稳定 `operationId`、`dependsOn` 和原始 toolCall/idempotency binding。
2. 保留 v1.0 modify-only 读取和 checksum 校验；新 Change Set 只写 v1.1。
3. 审批前构建 operation dependency DAG 并整体 preflight；拒绝环、交换移动、路径冲突、隐式父目录和缺失依赖。部分选择必须包含依赖闭包，move/delete/mkdir 只能整项选择。
4. checksum 和 approval token 覆盖 operation ID/kind/dependencies、源/目标路径、base checksum、候选内容和 idempotency binding。
5. 同一 toolCall 重放只返回已有提案或终态，不分配新的章节 ID、不重复创建；新的调用必须使用新的 operation ID。
6. Review UI 对 create/move/delete/mkdir 使用明确标签和依赖关系；删除不得显示成空 replacement。

**验收**

- 更改 operation kind、目标路径或 base checksum 会让 approval token 失效。
- v1.0 persisted fixture 仍能审批和应用。
- delete/move/mkdir 不接受部分 hunk 选择。
- 环、路径冲突、未选择依赖和同一 toolCall 重放在 mutation 前被确定拒绝。

### Task B.2：扩展事务 journal、补偿和撤销

**新增文件**

- `packages/repository/src/no-follow-file-operations.ts`
- `packages/repository/test/no-follow-file-operations.test.ts`
- `packages/repository/test/agent-file-operation-race.test.ts`

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
6. 首版 create/modify/move/delete 只接受策略允许的 UTF-8 文本文件；二进制文件即使只移动或删除也保持不可用。
7. move/delete/create 的最终 mutation 通过平台 no-follow、已打开句柄和 file identity 校验执行；不能只在 `lstat/realpath` 后按字符串路径 rename/remove。平台适配器无法证明时隐藏 destructive tools。
8. 所有操作复用项目锁、canonical Path Guard、dirty/stale 检查、版本组和恢复 journal。
9. 注入逐步骤失败和验证后路径替换 fixture，验证任意中点失败可补偿，symlink/junction/reparse point/hardlink 与竞争替换不能改变边界外文件。

**验收**

- 不存在递归删除路径。
- symlink/reparse、目标竞争创建、dirty buffer、项目锁丢失和 stale base 均在 mutation 前阻断。
- 应用崩溃后重启可继续补偿，run 级撤销可恢复 create/move/delete。
- destructive adapter 的黑盒 race 测试证明验证后替换不会绕过项目根或操作错误的 file identity。

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

1. 每个工具只生成带 operation ID、依赖和 idempotency binding 的 Change Set operation，不直接 mutation。
2. 章节创建由 Repository 分配/校验稳定 chapter ID 和目标路径；模型不能提交绝对路径。
3. Story Bible 写入先走结构化 schema validation，再生成候选文件内容。
4. move/rename、delete、mkdir 强制人工批准，即使 write policy 为 `user_preapproved_run`。
5. 同一模型轮次如混有 proposal 和 read/control，沿用现有 proposal 优先规则，并拒绝互相冲突的 operation。
6. 为批准、拒绝、部分选择、依赖闭包、重复 toolCall、stale、路径竞争、应用失败、补偿、重载和 undo 增加 E2E。
7. 本阶段交付文件操作时间线、独立 destructive 审批卡和恢复诊断；Phase B flag 关闭后只能完成既有 journal 的安全补偿，不能创建新 operation。

**Phase B 定向门禁**

```powershell
npm test -- packages/agent-engine/test/change-set.test.ts packages/application/test/change-set-session.test.ts packages/application/test/agent-file-operation-session.test.ts packages/repository/test/agent-write-transaction.test.ts packages/repository/test/no-follow-file-operations.test.ts packages/repository/test/agent-file-operation-race.test.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts
npm run typecheck
npm run lint
npm run build
```

## Phase C：受控任务与 Git 只读

Phase C 首版只支持 Windows x64，项目任务网络模式固定为 `none`。C.0 是不可绕过的资格门：未完成原生边界、独立探针、负对照、故障注入和打包验证时，可以继续交付 Phase A/B，但不得开始注册 `run_project_task`、本地 stdio MCP 或任何声称受控的外部进程工具。

### Task C.0：建立可证伪的 Windows 任务沙箱资格门

**新增文件**

- `adr/ADR-0002-agent-task-sandbox.md`
- `apps/desktop/native/agent-task-sandbox/`（锁定依赖的 Rust workspace，包含 host 与独立 probe）
- `apps/desktop/native/agent-task-sandbox/rust-toolchain.toml`
- `apps/desktop/native/agent-task-sandbox/deny.toml`
- `apps/desktop/src/main/agent-task-sandbox.ts`
- `apps/desktop/src/main/agent-sandbox-qualification.ts`
- `apps/desktop/test/agent-task-sandbox-blackbox.test.ts`
- `apps/desktop/test/agent-task-sandbox-negative-control.test.ts`
- `apps/desktop/test/agent-task-sandbox-fail-closed.test.ts`
- `apps/desktop/test/agent-task-no-fallback-boundary.test.ts`
- `apps/desktop/test/agent-task-sandbox-process-tree.test.ts`
- `scripts/verify-packaged-agent-sandbox.mjs`
- `scripts/verify-packaged-git-runtime.mjs`

**修改文件**

- `package.json`
- `.github/workflows/ci.yml`
- `apps/desktop/electron-builder.config.cjs`
- `scripts/package-check.mjs`
- `scripts/artifact-secret-scan.mjs`
- `apps/desktop/src/main/application-composition.ts`

**实施步骤**

1. ADR 明确威胁模型与信任边界，并固定 Windows 首版 profile：原生 host 使用 AppContainer/LowBox identity 强制文件/网络边界，任务网络 capability 为空；使用 Windows Job Object 且禁止 breakaway、启用 `KILL_ON_JOB_CLOSE`。App elevated、存在非 IPC inherited handle、任务请求提权、不支持或无法证明这些原语时返回 unavailable。
2. 原生 host 以 suspended 状态创建任务进程，先加入 Job Object 再恢复，避免用户代码在 containment 前抢跑。取消、超时、IPC 断联和 host 崩溃都关闭 job 并等待独立观察者确认整棵进程树退出。
3. 每次执行使用独立 identity/profile。首版把 no-follow 校验后的普通文件复制到 disposable workspace projection，不使用 hardlink，也不直接递归授权 live workspace；projection builder 通过已打开 handle 校验 volume/file identity、link count、逐文件 digest 和整棵 manifest，竞争或漂移即失败。任务只写 per-run state/output，结果不自动回写项目。确需 direct-read 的 runtime/dependency 路径逐项授权并拒绝 hardlink/reparse point。teardown 撤销临时 ACL/grant 并复核；回收失败使 session attestation 失效。
4. Desktop adapter 是生产代码唯一允许导入 `node:child_process` 的任务相关模块，而且只能在校验签名/摘要后启动原生 host。host 缺失、篡改或协议不匹配直接 unavailable；绝不启动任务 executable 作为 fallback。
5. 独立 probe 不导入生产 path guard、readiness 或 Git validator，并只操作 harness 创建、带 nonce 的临时 canary。它实际尝试：允许/禁止文件读写，父目录、用户目录和 AppData canary，绝对/UNC/`\\?\`/8.3 路径，symlink/junction/reparse point/hardlink，路径替换竞争，环境 secret 枚举，IPv4/IPv6 loopback、DNS、局域网、直接 IP、proxy，以及子/孙/detached/shell/spawn-storm 进程。
6. 测试 harness 通过外部 sentinel checksum、测试监听器连接数、OS PID/Job 查询和 heartbeat 判定，不信任 probe 或 adapter 的 `ready` 字段。CI/package qualification 中，同一 probe 必须先经普通 `spawn` 负对照并观测到越界读取/网络连接/残留进程，再清理测试资源；当前机器 session probe 只运行生产 sandbox 并绑定已验证的 test-vector revision。负对照未暴露预期行为时测试向量无效并失败。
7. qualification service 只有在 package qualification 与当前机器 session probe 都通过时才生成 opaque `SandboxAttestation`，绑定 host SHA-256/签名、OS/架构、协议、policy/test-vector revision、文件/网络/环境/Job profile、证据 ID、生成时间和失效时间。每个维度只允许 `verified | unavailable`。Attestation 只存在 Main 当前进程内 store，不跨 App restart 持久化；每个 session 重跑机器 probe，每次 launch 前按 ID 回查 store 并检查有效期和 drift。
8. 故障注入覆盖 host 缺失/篡改、摘要不符、畸形或部分握手、未知字段、probe 超时、Job assignment 失败、loopback exemption、ACL 回收失败、teardown 失败、App 重启、运行中 policy drift。每种情况都断言没有任务 PID。
9. 固定 Rust toolchain 与 `Cargo.lock`，在 `package.json` 增加 `agent-sandbox:audit`，统一执行锁定构建、漏洞、许可证和供应链策略审计；CI 禁止未锁定下载、未知 build script 和未记录的 native artifact。
10. 生产 attestation 的 host digest 必须锚定到 Authenticode/发布签名或不同权限域的可信 manifest；unsigned 开发构建只能产生 development qualification，不能被生产通道接受。
11. 打包配置携带摘要匹配的 host/probe、Git runtime 与 policy manifest；`package:check` 校验清单/SBOM，artifact scan 拒绝额外 launcher，两个 packaged verifier 必须针对 `latest-package-dir.txt` 指向的真实解包产物重复资格验证。
12. Job/profile 同时强制活动进程数、CPU 时间/速率、提交内存、句柄、I/O、stdout/stderr、scratch 磁盘和墙钟配额；任一超限进入稳定终态并完成 teardown。

**验收**

- 普通 spawn 负对照必然触发至少一个外部 sentinel、测试监听器或残留 PID 告警；相同 probe 在生产 sandbox 中全部被 OS 边界阻断。
- 允许的 workspace 操作成功，所有外部 canary checksum 不变、输出无 secret、网络连接数为零；取消/超时/断联/崩溃后所有后代 PID 消失。
- 任一维度无法证明时不生成 attestation；不存在 `partial`、`assumed` 或仅由 adapter 自报的 ready。
- 源码测试与打包产物测试都证明没有任务 executable 的普通 spawn fallback。

### Task C.1：建立冻结的项目任务目录

**新增文件**

- `packages/repository/src/project-task-catalog-repository.ts`
- `packages/repository/test/project-task-catalog-repository.test.ts`
- `packages/application/src/agent-task-session.ts`
- `packages/application/test/agent-task-session.test.ts`
- `packages/agent-engine/src/task-execution-snapshot.ts`
- `packages/agent-engine/test/task-execution-snapshot.test.ts`
- `apps/desktop/src/main/agent-task-projection.ts`
- `apps/desktop/test/agent-task-projection.test.ts`
- `packages/ui/src/agent-task-catalog-panel.tsx`
- `packages/ui/test/agent-task-catalog-panel.test.tsx`

**修改文件**

- `packages/repository/src/index.ts`
- `packages/application/src/agent-tool-ports.ts`
- `packages/application/src/ipc-contract.ts`
- `packages/application/src/novel-studio-api.ts`
- `apps/desktop/src/main/ipc-allowlist.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/main/application-composition.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`

**实施步骤**

1. 从受支持项目清单生成 task candidate；用户在专用 Task Catalog UI 查看、授权、撤销或刷新后才写入 app-local 目录。目录记录固定 launcher/argv 模板、参数 schema、相对 cwd、只读/可写文件 profile、风险、资源配额、超时、task source digest、catalog revision 和 `network: none`。
2. 不向模型展示原始命令；工具输入只接受 task ID 和 schema 验证后的结构化参数。用户管理与审批 UI 必须显示准确的规范化 executable/argv、cwd 和来源；项目 script 可能间接使用 shell 也要明确标记，script/manifest 漂移立即使目录项和审批失效。
3. 首版只接受 sandbox policy 能表达的任务。声明网络、交互 TTY、后台常驻、提权、workspace 外路径或无法枚举 launcher 的 candidate 直接拒绝，不进入可授权列表。
4. 文件 profile 默认 workspace read-only；确需构建输出时只开放声明的可写子目录。任务不得因 cwd 位于 workspace 而自动获得整个 workspace 写权限。
5. 每个待执行调用生成不可变 `TaskExecutionSnapshot`，绑定规范化 executable/argv、参数策略与实际参数 digest、入口/相关源码 manifest、runtime/lockfile/package-manager digest、projection manifest、cwd、文件 profile、资源配额、workspace identity 和 catalog revision。
6. projection builder 从已打开 handle 复制并生成逐文件 identity/digest manifest；任务启动前与 snapshot 复核，任何文件、shim、runtime 或 manifest 漂移均要求重新审批。
7. 定义 `AgentTaskSandboxPort`，其 launch 输入必须包含 qualification service 生成的 attestation reference 和 TaskExecutionSnapshot；port 无权自行把 unavailable 改成 verified。
8. 支持 AbortSignal、超时、stdout/stderr 分流和全部资源上限；环境只注入显式 allowlist，不继承 secret、proxy、credential 或用户 HOME 配置。
9. Task Catalog 控制面通过专用 IPC/preload DTO 暴露候选、有效状态和撤销动作；renderer 不能提交 launcher、argv、绝对路径、attestation 或 catalog revision。
10. task catalog、TaskExecutionSnapshot、sandbox attestation/host/policy/test-vector 和 workspace fingerprint 在 run start/调用前复核；变化触发拒绝或终止。

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
2. 使用可辨识 `ToolApprovalBinding`；task binding 覆盖 run/Effective Capability revision、toolCallId、descriptor/provider mapping revision、TaskExecutionSnapshot digest、参数策略与实际参数 digest、catalog/attestation/policy revision 和过期时间。
3. UI 显示任务名、准确的规范化 executable/argv、cwd 相对位置、来源、风险、文件 profile、资源上限和超时；不显示 secret 环境。
4. 只有参数仍落在同一已批准策略内、source/file profile/snapshot 均未漂移的精确 run-scoped grant 才可免重复确认；只绑定 task ID 的宽泛 grant 无效。
5. 增加重放旧审批、伪造 renderer capability、attestation 过期/漂移和 Application 重启恢复测试；所有路径都必须在创建进程前拒绝。

### Task C.3：接入 `run_project_task`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/test/agent-permission-plan.e2e.ts`
- `apps/desktop/test/agent-diagnostics.e2e.ts`

**实施步骤**

1. 只在 engineering + general_file + execution、task capability enabled、`network: none` 且 opaque sandbox attestation 完整 verified 并与冻结 revision 匹配时注册。
2. 每次调用先持久化审批 checkpoint 和 `TaskExecutionSnapshot`，再重新校验 task source、参数、runtime、projection、workspace、attestation、文件 profile 和资源配额，最后只能经 `AgentTaskSandboxPort` 启动。
3. 结构化回填 exit code、duration、stdout/stderr 摘要和 truncation；输出作为不可信数据。
4. stop/cancel/timeout/resource-exhausted 必须终止进程树并产生唯一终态；App 重载后运行中任务只能恢复为已终止/需确认，不得重新 launch。
5. host 缺失/崩溃、资格不确定、direct IPC、持久化 call replay 和 revision drift 返回 `AGENT_TASK_SANDBOX_UNAVAILABLE`；测试以 launch counter、PID observer 和外部 marker 共同证明没有 fallback。

### Task C.4：实现 `git_status` 和 `git_diff`

**新增文件**

- `packages/application/src/agent-git-tool-session.ts`
- `packages/application/test/agent-git-tool-session.test.ts`
- `apps/desktop/src/main/git-read-adapter.ts`
- `apps/desktop/test/git-read-adapter.test.ts`
- `apps/desktop/test/git-read-boundary-blackbox.test.ts`
- `apps/desktop/test/fixtures/malicious-git-repositories.ts`
- `apps/desktop/resources/git/manifest.json`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/application-composition.ts`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/electron-builder.config.cjs`
- `scripts/write-build-manifest.mjs`
- `scripts/package-check.mjs`

**实施步骤**

1. Git discovery 与 status/diff 全部复用 C.0 原生 host 的只读、无网络 profile；只使用随应用打包、版本/许可证明确并进入 build manifest/SBOM 的 Git runtime，不从项目 PATH、用户 PATH、配置或系统安装发现 executable。
2. 固定 Git executable、DLL/资源摘要并使用参数数组，不通过 shell，也不在验证后裸 spawn Git；runtime 升级会改变 attestation/审批 binding。
3. 用 no-follow/reparse-safe 解析 canonical worktree、`.git` file/directory、gitdir、common-dir、object database 和 alternates；全部必须位于允许的 workspace/state 边界。首版拒绝外置/不确定 linked worktree、外部 `core.worktree`、config `include/includeIf`、symlink/junction/reparse point。
4. 清空继承的 `GIT_*`、`HOME`、`XDG_CONFIG_HOME`、credential/proxy 环境；禁用 system/global config、prompt、pager、hooks、credential helper、fsmonitor、external diff、textconv，设置 literal pathspec、`GIT_TERMINAL_PROMPT=0` 和 `GIT_OPTIONAL_LOCKS=0`。
5. Git sandbox 只读授予 worktree 与已验证内部 Git 存储；独立 temp 接收输出。即使 validator 漏判或 `.git` 在验证后被替换，OS boundary 也必须阻止外部文件读取和仓库写入。
6. diff pathspec 再经过 canonical Path Guard，拒绝 pathspec magic、绝对/父级路径和 symlink；输出超限返回统计与截断摘要，不返回外部 canary。
7. 恶意仓库矩阵覆盖绝对/相对外置 gitdir、commondir、object alternates、`core.worktree`、`config.worktree`、submodule gitdir、config include、fsmonitor、external diff、textconv、pager、credential helper、父进程环境注入、hardlink/reparse point、UNC/device/8.3 路径、linked worktree 和 TOCTOU 替换。每例断言拒绝或安全完成、外部 marker/checksum 不变、测试监听器连接数为零、输出无 canary、Git/worktree 内容 checksum 不变。
8. 不实现任何 Git mutation 或网络子命令；Git adapter unavailable 或边界不确定时两个工具都不注册，direct call 同样 fail closed。

**Phase C 定向门禁**

```powershell
cargo test --locked --manifest-path apps/desktop/native/agent-task-sandbox/Cargo.toml
npm run agent-sandbox:audit
npm exec vitest -- run --passWithNoTests apps/desktop/test/agent-task-sandbox-blackbox.test.ts apps/desktop/test/agent-task-sandbox-negative-control.test.ts apps/desktop/test/agent-task-sandbox-fail-closed.test.ts apps/desktop/test/agent-task-no-fallback-boundary.test.ts apps/desktop/test/agent-task-sandbox-process-tree.test.ts packages/repository/test/project-task-catalog-repository.test.ts packages/application/test/agent-task-session.test.ts packages/application/test/agent-git-tool-session.test.ts apps/desktop/test/git-read-adapter.test.ts apps/desktop/test/git-read-boundary-blackbox.test.ts apps/desktop/test/agent-permission-plan.e2e.ts
npm run typecheck
npm run lint
npm run build
npm run package:dir:built
node scripts/verify-packaged-agent-sandbox.mjs
node scripts/verify-packaged-git-runtime.mjs
```

上述 sandbox/Git 黑盒测试必须在受支持的 Windows CI runner 和发布参考机执行，不得因缺少原生 host、权限或平台能力而 skip；这类情况应让 Phase C gate 失败，但不得影响 Phase A/B 的独立发布。资格 harness 还必须证明故意不安全的普通 spawn 负对照会失败，否则禁止把 Phase C 标为 Complete。

## Phase D：网络读取

Phase D 只依赖 Phase 0，独立于 Phase C。它只交付由 Main/provider adapter 主动发起、逐跳校验的宿主网络读取，不为任意项目子进程开放 socket。项目任务联网需要独立后续 RFC、强制 broker 和 direct-egress 黑盒证明。

### Task D.1：建立网络策略与 provider 端口

**新增文件**

- `packages/application/src/agent-network-policy.ts`
- `packages/application/src/agent-network-tool-session.ts`
- `packages/application/src/agent-network-settings-session.ts`
- `packages/application/test/agent-network-policy.test.ts`
- `packages/application/test/agent-network-tool-session.test.ts`
- `packages/application/test/agent-network-settings-session.test.ts`
- `apps/desktop/src/main/agent-network-runtime.ts`
- `apps/desktop/test/agent-network-runtime.test.ts`
- `packages/ui/src/agent-network-settings-panel.tsx`
- `packages/ui/test/agent-network-settings-panel.test.tsx`

**修改文件**

- `packages/schemas/schema/settings.schema.json`
- `packages/application/src/model-settings-session.ts`
- `packages/application/src/ipc-contract.ts`
- `packages/application/src/novel-studio-api.ts`
- `packages/repository/src/settings-repository.ts`
- `apps/desktop/src/main/ipc-allowlist.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/main/application-composition.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`

**实施步骤**

1. 增加 Main-owned、默认关闭的网络设置、provider profile、精确 host/port 允许域、数据外发策略和 policy revision；secret 只以 `secret://` ref 穿过 DTO，明文留在 `safeStorage`/Main adapter。
2. 通过专用 IPC/preload/UI 提供测试连接、启停、域规则、secret ref 更新和撤销；renderer 不能提交 policy revision、解析后 IP 或明文 secret。
3. 实现受控 dialer：规范化 URL，拒绝 userinfo/file/data、localhost/私网/link-local，校验全部 DNS 候选后把实际 socket 固定到批准 IP，同时保留正确 TLS SNI/Host；每次重定向重复完整校验，不能交回会再次解析的普通 fetch。
4. `fetch_url` 首版只允许 GET/HEAD，不携带请求正文、cookie、浏览器登录态或 Authorization；限制连接/总超时、重定向、内容类型和并发数。
5. 对解压后的响应流逐块计数，到达上限立即 abort；不能先完整缓冲或只限制压缩包大小。
6. 将搜索 query、URL/path/query 和远程参数按数据外发类别分类；可能包含项目正文时要求逐次确认或精确 run-scoped egress grant。
7. 错误和审计只记录脱敏 host/path/payload 摘要，不记录 query secret、Authorization 或响应原文。

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

1. 工具只在 Phase D flag、network policy、provider、数据外发许可和 Effective Capability State 同时满足时注册。
2. `web_search` 返回标题、URL、摘要、provider 和时间；`fetch_url` 返回来源元数据和有界文本。
3. 所有远程内容使用 `untrusted_remote_data` 包络，不能改变系统指导、工具权限或审批策略。
4. 网络审批使用 network binding，覆盖目标、request digest、egress class、provider/policy/effective-capability revision 和过期时间；审批卡显示目标、payload 类别、长度和脱敏摘要。
5. 设置关闭、provider 失效、域不允许、DNS 漂移、连接未固定、重定向越界、解压炸弹、超时和累计预算超限均覆盖测试。
6. 本阶段交付网络时间线、来源/截断诊断和重载行为；关闭 flag、撤销域或连接过期时当前能力立即缩权，旧 run 不可继续发起请求。

**Phase D 定向门禁**

```powershell
npm test -- packages/application/test/agent-network-policy.test.ts packages/application/test/agent-network-settings-session.test.ts packages/application/test/agent-network-tool-session.test.ts packages/ui/test/agent-network-settings-panel.test.tsx apps/desktop/test/agent-network-runtime.test.ts apps/desktop/test/agent-context-runtime.e2e.ts
npm run typecheck
npm run lint
npm audit
```

## Phase E：插件/MCP 动态工具

Phase E 不是单一门禁：插件工具依赖 C.0 和真实插件执行器；本地 stdio MCP 依赖 C.0 的独立 MCP sandbox profile；远程 MCP 只依赖 Phase D 的网络/端点/secret 控制。三类来源分别启停、撤销和发布，不能共享 `sandboxReady` 或用另一 transport 的证明代替。

### Task E.1：交付真实插件工具执行路径

**新增文件**

- `packages/application/src/plugin-sandbox-port.ts`
- `packages/application/test/plugin-sandbox-port.test.ts`
- `apps/desktop/src/main/plugin-sandbox-runtime.ts`
- `apps/desktop/test/plugin-sandbox-runtime.test.ts`

**修改文件**

- `packages/schemas/schema/plugin-manifest.schema.json`
- `packages/schemas/test/schema-contract.test.ts`
- `packages/plugin-engine/src/plugin-engine.ts`
- `packages/plugin-engine/test/plugin-engine.test.ts`
- `packages/application/src/plugin-runtime-session.ts`
- `packages/application/test/plugin-runtime-session.test.ts`
- `packages/repository/src/plugin-registry-repository.ts`
- `packages/repository/test/plugin-registry-repository.test.ts`
- `apps/desktop/src/main/application-composition.ts`

**实施步骤**

1. 新增 tool contribution：canonical tool ID、description、input schema、权限声明、timeout 和最大输出；来源声明的 effect/readOnly/destructive/idempotent 只是不可信 hint，最终策略由 Main 收窄计算。
2. 实现生产 `PluginSandboxPort`，通过 C.0 原生 host 的独立插件 profile 执行已签名/明确受信代码；现有 deterministic fixture/prototype 只能继续用于旧契约测试，不能生成 attestation 或启用第三方源码。
3. 只有签名/信任、插件 identity/version、权限和插件 profile attestation 全部满足时才生成 `plugin:<pluginId>/<toolId>` descriptor；插件不能声明 sandbox policy 禁止的 shell/network/model/asset-write 能力。
4. 插件 host 缺失、篡改、崩溃、超时、teardown 或 attestation drift 时撤销该来源的 Effective Capability，不回退到 worker fixture、普通 spawn 或 Main 内执行。
5. 插件调用遵守进程/CPU/内存/输出/scratch 配额，run 结束必须 teardown；打包产物重复验证真实插件 host/profile。

### Task E.2：接入本地 stdio MCP

**新增文件**

- `packages/application/src/mcp-settings-session.ts`
- `packages/application/src/agent-external-tool-session.ts`
- `packages/application/test/mcp-settings-session.test.ts`
- `packages/application/test/agent-external-tool-session.test.ts`
- `packages/repository/src/mcp-settings-repository.ts`
- `packages/repository/test/mcp-settings-repository.test.ts`
- `apps/desktop/src/main/local-mcp-runtime.ts`
- `apps/desktop/test/local-mcp-runtime.test.ts`

**修改文件**

- `packages/schemas/schema/settings.schema.json`
- `packages/application/src/agent-tool-ports.ts`
- `apps/desktop/src/main/application-composition.ts`

**实施步骤**

1. 本地 server 默认 disabled；command/argv、secret ref、工作目录和文件 profile 只存在 Main/Repository 边界，renderer 不能提交可执行命令或绝对路径。
2. 使用 C.0 host 的独立 MCP sandbox profile、独立 probe 和 opaque attestation；生命周期最多绑定单个 run，并限制进程树、CPU、内存、输出、scratch 和墙钟。
3. 客户端首版只实现初始化、`tools/list` 与 `tools/call` 所需最小协议；不提供 roots、sampling、elicitation、resources/prompts 注入或 server 发起的模型调用，未知通知、无限分页和协议漂移 fail closed。
4. 连接时严格校验 schema/description，生成 `mcp:<serverId>/<toolId>` canonical descriptor；运行中 schema、identity、attestation 或配置变化只会撤销当前能力。
5. cancel、timeout、断线、host crash 和 teardown 失败都终止整个 server 进程树；不切换普通 spawn、远程 transport 或未隔离重连。

### Task E.3：接入远程 MCP

**新增文件**

- `apps/desktop/src/main/remote-mcp-runtime.ts`
- `apps/desktop/test/remote-mcp-runtime.test.ts`

**修改文件**

- `packages/application/src/mcp-settings-session.ts`
- `packages/application/src/agent-external-tool-session.ts`
- `packages/repository/src/mcp-settings-repository.ts`
- `packages/schemas/schema/settings.schema.json`
- `apps/desktop/src/main/agent-network-runtime.ts`

**实施步骤**

1. 远程 MCP 复用 Phase D 的受控 dialer、允许域、TLS SNI/Host、endpoint identity、secret ref、数据外发策略和连接 revision；它不要求、也不能伪造本地进程 sandbox attestation。
2. 默认 disabled，固定 transport/endpoint；重定向、endpoint/TLS identity/schema/协议版本变化立即撤销当前连接，不静默切换 transport 或 server。
3. 与本地 MCP 一样只启用 tools 最小子集，拒绝 roots、sampling、elicitation、resources/prompts 注入、未知通知和失控分页。
4. 远程 descriptor 默认计算为 `external_action + remote_tool_arguments + never_automatic`；只有 Main-owned 的可信来源策略可收窄，server hint 无权扩大权限。
5. 调用断线、超时或取消后无法证明请求未送达时写入 `outcome_unknown`，禁止自动重试；只有来源验证 idempotency key 时才允许显式受控重试。

### Task E.4：接入动态目录、管理 UI 和统一审批

**新增文件**

- `packages/ui/src/agent-tool-source-panel.tsx`
- `packages/ui/test/agent-tool-source-panel.test.tsx`
- `apps/desktop/test/agent-tool-source-ipc.test.ts`

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/src/permission-summary.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-permission-session.ts`
- `packages/application/src/ipc-contract.ts`
- `packages/application/src/novel-studio-api.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/ipc-allowlist.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/src/agent-run-timeline.tsx`
- `apps/desktop/test/agent-permission-plan.e2e.ts`
- `apps/desktop/test/agent-diagnostics.e2e.ts`

**实施步骤**

1. 用户通过专用 Main-owned 控制面安装/配置来源、查看身份和权限、测试连接、启停、撤销信任并选择本次 run 的工具；超过预算时提供来源选择器，不要求手改 JSON。
2. Run start 对每个来源先整体校验严格 schema/description，再生成 canonical ID/providerName 映射并冻结 descriptor/revision；任一名称碰撞或非法 schema 拒绝整个来源，不静默截断工具。
3. 动态工具按 Main 计算的 effect、data-egress 和 retry semantics 走统一审批；external action 不继承文件自动审批，approval binding 覆盖来源/descriptor/argument/idempotency/effective-capability revision。
4. 同一模型轮次最多进入一个待审批副作用调用；其余调用持久化为未执行/需重新规划，恢复后不会自动发送。
5. 审计记录来源 identity/version、canonical/provider tool ID、耗时、输入摘要、结果大小、截断和脱敏错误；`outcome_unknown` 在 UI、事件和恢复状态中明确可见。
6. 插件、本地 MCP、远程 MCP 各有独立 flag/kill switch；disabled、untrusted、schema drift、timeout、cancel、crash、connection/attestation drift 和 teardown 失败均有稳定诊断与恢复测试。

**Phase E 共用合同门禁**

```powershell
npm test -- packages/schemas/test packages/application/test/mcp-settings-session.test.ts packages/application/test/agent-external-tool-session.test.ts packages/ui/test/agent-tool-source-panel.test.tsx apps/desktop/test/agent-tool-source-ipc.test.ts apps/desktop/test/agent-permission-plan.e2e.ts
npm run typecheck
npm run lint
npm audit
```

**插件/本地 stdio MCP 门禁（依赖 C.0）**

```powershell
npm test -- packages/plugin-engine/test packages/application/test/plugin-runtime-session.test.ts packages/application/test/plugin-sandbox-port.test.ts apps/desktop/test/plugin-sandbox-runtime.test.ts apps/desktop/test/local-mcp-runtime.test.ts
npm run build
npm run package:dir:built
node scripts/verify-packaged-agent-sandbox.mjs
```

**远程 MCP 门禁（依赖 Phase D）**

```powershell
npm test -- packages/application/test/mcp-settings-session.test.ts packages/application/test/agent-external-tool-session.test.ts apps/desktop/test/remote-mcp-runtime.test.ts apps/desktop/test/agent-network-runtime.test.ts
```

打包验证只门禁插件和本地 stdio MCP；远程 MCP 不因缺少本地原生 host 而失败。三类来源分别记录完成状态。

## 最终汇总回归与发布门禁

各 Phase 的 UI、控制面、诊断和恢复是本阶段完成条件，不能留到 Phase F。Phase F 不首次引入产品行为，只验证跨阶段组合和发布产物。

### Task F.1：执行跨阶段合同与产品回归

**修改文件**

- `packages/agent-engine/test/stage5-event-contract.test.ts`
- `packages/repository/test/agent-run-repository.test.ts`
- `apps/desktop/test/agent-run.e2e.ts`
- `apps/desktop/test/agent-run-autonomy.e2e.ts`
- `apps/desktop/test/agent-permission-plan.e2e.ts`
- `apps/desktop/test/agent-diagnostics.e2e.ts`

**验收**

- 用户发送前看见历史批准与当前有效的 read/propose/execute/network/external 权限；delete/move/task/external action 有独立审批和拒绝入口。
- 搜索、Git、任务、网络和 external 时间线可理解；准确任务命令只在受控 UI 显示，绝对路径、secret、Authorization 和完整敏感参数不进入模型或 renderer DTO。
- 旧 Permission Summary、Change Set、Run Snapshot/Event 和 journal fixture 可读；新状态写 v1.2。
- awaiting approval、运行中任务、待审批文件操作、外部 `outcome_unknown` 和补偿中事务在重载后都有确定状态，不自动重放副作用。
- 关闭任一 flag 或撤销当前能力后，只允许完成必要的安全补偿/teardown，不允许发起新工具调用。

### Task F.2：同步产品文档和发布状态

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

| 层           | 文件                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Engine | `tool-registry.ts`、`agent-tool-schema.ts`、`permission-summary.ts`、`effective-capability-state.ts`、`change-set.ts`、`agent-run-types.ts`、`task-execution-snapshot.ts`、`transaction-journal.ts`  |
| Application  | `agent-run-session.ts`、`agent-run-model-driver.ts`、`agent-tool-provider-mapping.ts`、`change-set-session.ts`、`agent-permission-session.ts`、`ipc-contract.ts`、`novel-studio-api.ts`              |
| Repository   | `search-index-repository.ts`、`no-follow-file-operations.ts`、`agent-write-transaction.ts`、`agent-run-repository.ts`、`settings-repository.ts`、`ports.ts`                                          |
| Desktop Main | `agent-feature-flags.ts`、`agent-run-runtime.ts`、`agent-task-sandbox.ts`、`agent-network-runtime.ts`、`plugin-sandbox-runtime.ts`、`local-mcp-runtime.ts`、`remote-mcp-runtime.ts`、IPC/composition |
| UI/Renderer  | Agent permission/run/timeline、Change Set review、Task Catalog、Network settings、tool-source management panels and bridges                                                                          |

### 主要新增实现文件

| 能力          | 新文件                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 工具合同/权限 | `agent-tool-capabilities.ts`、`agent-tool-schema.ts`、`agent-tool-provider-mapping.ts`、`effective-capability-state.ts` |
| 搜索          | `agent-project-search-repository.ts`、`agent-search-tool-session.ts`                                                    |
| 文件操作      | `agent-file-operation-session.ts`、`no-follow-file-operations.ts`、竞态黑盒测试                                         |
| 任务沙箱      | 原生 host/probe、`agent-task-sandbox.ts`、`agent-sandbox-qualification.ts`、projection/qualification verifier           |
| 任务目录/执行 | `project-task-catalog-repository.ts`、`agent-task-session.ts`、`task-execution-snapshot.ts`、Task Catalog UI            |
| Git           | 打包 Git runtime/manifest、`agent-git-tool-session.ts`、`git-read-adapter.ts`、恶意仓库 fixture/黑盒测试                |
| 网络          | `agent-network-policy.ts`、settings/tool sessions、固定连接 runtime、Network settings UI                                |
| Plugin/MCP    | `plugin-sandbox-port.ts`、plugin/local-MCP/remote-MCP runtimes、MCP settings/tool session、tool-source management UI    |

## 最终验证

每个 Phase 的定向测试通过后，最终运行：

```powershell
npm run format
npm run lint
npm run build
npm run test
npm run test:e2e:built
npm run package:verify
npm run release:check
npm run alpha:verify
npm audit
npm run package:dir:built
node scripts/verify-packaged-agent-sandbox.mjs
node scripts/verify-packaged-git-runtime.mjs
git diff --check
```

`npm run build` 已包含 TypeScript build，`npm test` 已包含 schema contract，`package:dir:built` 已包含 artifact secret scan；最终链路不得再次嵌套重复执行这些门禁。Phase C 另外执行 Rust 依赖审计、黑盒负对照、故障注入、恶意 Git fixture 和两个打包产物 verifier。

最终人工验证至少覆盖：

1. 创作项目规划模式搜索章节/Story Bible 引用，不出现写工具。
2. 创作执行创建章节和修改 Story Bible，审批、重载、应用和 undo 完整。
3. 工程执行创建、移动、重命名和删除文本文件，中点失败可补偿。
4. 普通 spawn 负对照可以读取外部 canary/连接测试 listener/留下后代；相同 probe 经打包后的 sandbox host 运行时全部被阻断。
5. 任务调用必须审批、可取消、可超时；取消、超时、host 断联和崩溃后由独立 PID observer 证明没有残留进程，外部文件 checksum、网络连接数和临时 ACL/grant 均符合预期。
6. host 缺失/篡改、partial/unknown/stale attestation、revision drift、旧审批重放和 direct IPC 时，任务工具在 registry/Permission Summary/模型请求中不可见，直接调用也不产生 PID。
7. Git status/diff 在只读 sandbox 中运行；外置 gitdir/commondir/alternates/config include、恶意 fsmonitor/diff/textconv/helper、环境注入和 TOCTOU fixture 不能读取外部 canary、执行 marker 或修改仓库。
8. 网络默认关闭；开启后拒绝私网/重定向逃逸并显示来源，且不会因此给项目任务开放网络。
9. 插件和本地 MCP 无真实、对应 profile 的 sandbox attestation 时不可用；远程 MCP 不依赖本地 attestation，但必须通过 Phase D endpoint/TLS/secret/egress 门禁。三者拒绝 roots/sampling/elicitation，schema 或连接漂移立即缩权。
10. 外部动作无法确认是否送达时显示并恢复为 `outcome_unknown`，不会自动重试。
11. Task Catalog、Network、Plugin/MCP 和工具源选择均可在 UI 管理；renderer 不能伪造 capability、revision、命令或 secret。
12. 所有 feature flag 关闭时，现有 9 工具和旧 E2E 行为无回归。

## 完成定义

- 设计文件中的 22 个静态工具全部按条件注册、执行和审计。
- 六类能力缺口均至少有一个安全、可用的工具闭环。
- 动态插件/MCP 工具不绕过 registry revision、Permission Summary 或审批。
- canonical ID/providerName 映射无碰撞并随 run 冻结；严格 schema/description 校验和单次/累计上下文预算全部生效。
- Permission Summary 保持不可变，Effective Capability State 只缩权；新增 run 状态/事件写 v1.2，旧版本可读但不能授权新能力。
- 每个 Phase 已交付自己的 Main-owned flag、用户控制/审批 UI、诊断和恢复；Phase F 只做汇总回归。
- 没有新增直接 mutation、任意 Shell、Git 写操作、项目根逃逸或任务/Git 普通 spawn fallback 路径。
- Phase C 只有在普通 spawn 负对照、生产 sandbox 黑盒、故障注入、恶意 Git 矩阵和打包产物资格验证全部通过后才能标为 Complete；任一环境无法证明时工具保持 unavailable。
- 插件、本地 MCP、远程 MCP 各自满足对应依赖门禁；未完成的来源可以独立保持 unavailable，不阻塞无依赖 Phase 的发布。
- 全部门禁通过，文档只把真实交付的 Phase 标为 Complete。
