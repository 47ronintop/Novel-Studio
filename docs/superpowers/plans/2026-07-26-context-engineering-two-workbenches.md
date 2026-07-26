# Novel Studio 双工作台上下文工程实施计划

- **日期：** 2026-07-26
- **状态：** Candidate（批次 4/5 完成后实施；当前仅允许 C0 阻断修复）
- **实现基线：** `c523748`（当前 HEAD；批次 3 v2 tool facade/lifecycle 已合入）
- **设计依据：** `docs/superpowers/specs/2026-07-26-context-engineering-two-workbenches-design.md`
- **上位计划：** `docs/superpowers/plans/2026-07-26-agent-tool-functional-priorities.md`（批次 4 多 Provider、批次 5 网络读取/远程 MCP 尚未完成；本计划不得提前解除 §12 的完整延期）

## 1. 当前决定

- 写作（creativeProject × writing）、创作通用文件（creativeProject × general_file）、工程（engineeringWorkspace）升级为三个显式 Context Profile，各自拥有系统提示装配、初始上下文最小集、预算参数与压缩模板。
- 规划两类用户可写项目约定文件：工程 `AGENTS.md`、创作 `conventions/writing.md`，以 workspace trust 约束的 user/data message 注入；不得进入同一个 trusted system role。
- 引入服务器构建的定向块（章节清单 + Story Bible 索引 / 有界目录骨架），作为初始上下文数据消息。
- `toolReserve`/`systemReserve` 诚实化。
- 批次 4/5 完成前继续延期：profile 全量落地、项目约定、定向块、动态预算、模型摘要；当前只修运行阻断、泄漏、负预算、旧内容复活和显式引用损坏。向量/语义检索、自动注入、跨模型降级、记忆自动写入继续延期。
- 不新增模型可见工具、不改审批/Change Set/事务链路；所有项目文件仍走 data envelope，约定文件也不获得 system authority（见设计 §4.2/§6）。

## 2. 批次划分

依赖顺序：C0 → 上位计划批次 4 → 上位计划批次 5 → C1 →（C2 ∥ C3）→ C4 → C5。C0 可在延期期间实施；C1-C5 以批次 4/5 的 Provider、工具目录、网络/MCP 和审批合同为前置。C4 必须排在批次 5 后，避免反复重算工具 schema、结果预算和外发策略。

### 批次 C0：运行时上下文闭环与延期期间修复

**目标：** 只修复上位计划 §12 允许的运行阻断，不引入 Context Profile 或新的自动检索能力。

1. 建立唯一 server-side prompt materializer；start、每轮调用、refresh、exclude、compact、hydrate 都从活动 source/artifact 重新生成真实 model messages。
2. 修复 start budget binding、运行时压力接线、preview/start/round 的 fail-closed 行为；在 context window 未验证时不得猜测可用预算。
3. 修复 stale reader、旧内容错误复活、显式 Story Bible/selection 引用和 Context Draft/Run Draft 绑定校验。
4. 增加 spy model driver 的 start/refresh/exclude/compact/reload 测试，断言 Provider 实际收到的消息和工具目录。

**完成条件：** 现有功能链路中不存在“snapshot 已排除但 prompt 仍有正文”“reload 丢失初始 refs”“预算为空仍可启动/压缩”的路径；不改变工具集合。

### 批次 C1：Context Profile 骨架与指导 v2（批次 4/5 后）

**目标：** 三 profile 显式化，指导文字升级并纳入检索层，不引入任何新 IO。

1. 由 `packages/application` 拥有策略并新增 `agent-context-profile.ts`：`AgentContextProfileId`、`resolveAgentContextProfile(workspaceKind, contextMode)`、冻结 runtime facts 结构和 profile 元数据（身份指导、检索指导、压缩模板文本、约定文件相对路径、定向块参数）。`packages/agent-engine` 只承载无 IO 的共享值对象/校验，不决定上下文选择策略。
2. `buildAgentSystemGuidance` 重构为 `buildAgentSystemPrompt(profile, { conventionsArtifact? })`：system role 只装配 app-authored 层；约定 artifact 作为 user/data message 接入，`AGENT_SYSTEM_GUIDANCE_VERSION` → `2.0`；风格包仅 writing。保留旧函数导出别名直到调用点全部迁移。
3. system_guidance 审计源 refId 升级为 `system_guidance:{profileId}`；新 run 的 profile/template/artifact 版本在 start 时冻结，hydrate 只恢复持久化 artifact，不能用当前 builder 重写旧 run 输入。
4. `estimateAgentSystemReserveTokens` 升级为按完整装配文本估算（签名接收 profile；约定文本参数 C2 接通）。
5. 测试：三 profile 装配快照、冻结 runtime facts、风格包仅 writing、版本号与 refId、artifact 恢复、工程 × writing 预检拒绝回归保持绿。

**完成条件：** 每轮 systemPrompt 由 profile 驱动；`agent-run-session.ts` 不再按裸 contextMode 拼指导；全量套件绿。

### 批次 C2：项目约定文件（受信任的用户/数据层）

**目标：** 用户可写约定文件端到端注入 + 审计 + staleness。

1. main 侧 start preflight 读取约定文件：路径固定（AGENTS.md / conventions/writing.md），只经 `AgentProjectReadRepository.readText`（守卫复用，`.md` 已在允许扩展名内）；缺失 → 静默无约定层；超 4000 token → 截断 + 结果里标记。
2. 注入：作为带 `instructionPolicy`、workspace trust 状态和来源信息的 user/data message；同时记为 Context Snapshot 新 sourceKind `project_conventions`。保存原文 checksum、注入片段 checksum、截断范围和 artifact id。
3. staleness：`findStaleContextSources` 对 `project_conventions` 参与比较（它不在 `layer==="system"` 跳过名单）；运行中被改 → 现有 `context_stale` → `awaiting_context_refresh` 流程。
4. 预算：约定文本进 `systemReserve`（C1 预留的参数接通）；`previewContextBudget` 与 start 用同一解析函数。
5. UI（小步）：composer 上下文菜单"查看来源"显示约定文件条目；设置或项目面板提供"创建约定文件"入口（可延到 C5 一并做）。
6. 测试：存在/缺失/超限/运行中修改/staleness 恢复/路径越界拒绝/工程与创作各自路径正确；schema 校验新 sourceKind。

**完成条件：** 用户在项目里写约定文件，新 run 的 user/data context 可见（审计源可证）、改文件触发 stale；无任何新文件系统权限面。

### 批次 C3：工作区定向块

**目标：** 三 profile 的初始上下文最小集成型。

1. main 侧新增受 canonical-root/no-symlink 守卫保护的 metadata/index port：
   - 工程/创作通用：递归深 ≤ 2、条目 ≤ 200，并同时限制扫描 entry/byte/time；
   - 写作：章节清单（id/标题/字数）+ Story Bible 资产索引（assetId/名称/类型，无正文），不得为索引读取整章正文。
2. start preflight 把定向块追加为 initialContextSources 之一：sourceKind `workspace_outline`，走现有 `untrusted_project_data` 数据消息管线；目标 ≤ 1500 token，超预算先裁定向块。
3. 压缩分类：`agent-compaction-composer.ts` 把 `workspace_outline` 归可驱逐 `rereadable_body`（指针注明可用 list/search 重读）；`project_conventions` 归受保护事实。
4. 测试：封顶与截断标注、blockedRoots 过滤、无 Story Bible 降级、空目录、压缩驱逐与指针、E2E（工程新 run 首轮含目录骨架；写作新 run 含章节清单 + 设定索引）。

**完成条件：** 工程 Agent 不再从零摸目录；写作 Agent 开局知道有哪些章节与设定可查；压缩正确分类两种新源。

### 批次 C4：预算诚实化（排在上位计划批次 4/5 后）

**目标：** 预算操作数与真实注入一致。

1. `toolReserve`：对 run 冻结的 provider-specific 工具目录（含 v2、网络/MCP descriptors）及最大工具结果摘要做确定性估算，替换 `agent-run-runtime.ts` 两处写死的 0。
2. 三处（preview / start / round / compaction 重算）统一走同一 `resolveBudgetInputs` 扩展，计入 wrapper、conversation、system/data message、schema、结果摘要和 artifact pointer，禁止分叉。
3. 压缩摘要模板按 profile 接入 `CompactionModelAssistantPort`；端口必须返回摘要正文、provenance、tokenCount、checksum 和 precision，结果 Snapshot 写入新的 summary artifact。
4. 测试：toolReserve 随 Provider/v2/network/MCP 目录变化、preview=start=round=compaction、两套摘要模板断言、未达目标 fail-closed、预算不足错误路径回归。

**完成条件：** `safeInputBudget` 的每个操作数可解释、可审计；同一 run 的 preview/start/round/compaction 四处预算一致。

### 批次 C5：提及建议与 UI 收尾（P2，可裁剪）

1. 确定性别名提及扫描（Story Bible 资产名/别名 × 当前章节与用户请求的字符串匹配）→ composer"建议引用"chips，用户点选才注入（复用 ContextDraft refs 管线）。
2. 约定文件创建入口、定向块与约定层在"查看来源"面板的完整展示。
3. E2E 补全 + 全量门禁（`--no-file-parallelism` 套件、typecheck、lint、agent-context-runtime E2E）。

**完成条件：** 建议不自动注入；全部门禁绿。

## 3. 风险与回退

| 风险                                         | 缓解                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 约定文件被用于提示注入攻击                   | 不进入 system role；workspace trust + 显式启用 + data envelope + token 封顶 + 恶意约定/网络/写入工具测试       |
| 定向块超预算挤占正文                         | 1500 token 封顶 + 最先被裁 + 可驱逐可重读                                                                      |
| guidance/profile/约定版本升级破坏旧 run 恢复 | 保存 profileVersion、template checksum、conventions artifact、原文/注入 checksum；旧 run 只重放不可变 artifact |
| systemReserve 增大导致小窗口模型预算不足     | 现有 `AGENT_CONTEXT_BUDGET_INSUFFICIENT` fail-closed 路径已覆盖；约定层超限先截断                              |
| 批次 4/5 改变工具/Provider/网络合同          | C4 明确排在批次 5 后；先锁定共享 resolver 接口，禁止提前写死最终 reserve                                       |

## 4. 执行与验证原则

1. 每批次先完成一个真实用户纵向闭环再进入下一批次；开发中跑最窄相关测试，批次结束跑对应套件 + typecheck + lint。
2. 全量 Vitest 验证一律 `--no-file-parallelism`（已知两个负载敏感用例）。
3. application 测试依赖 agent-engine 编译产物：改 agent-engine 后先 `npx tsc -b packages/agent-engine` 再跑 application 测试。
4. 所有新文本（指导、模板、头部声明）随 profile 版本冻结，改文字必须升版本。
5. 不得以任何形式把项目文件内容提升为系统权威；约定文件只能作为受信任的 user/data context，必须有 workspace trust、显式启用和可审计 artifact。
6. 批次 4/5 完成前，不把 C1-C5 标记为已开始或已实现；任何提前提交仅限 C0 阻断修复。

## 5. 下一步

C0 可立即开始。建议提交序：C0 → 上位计划批次 4 → 上位计划批次 5 → C1 → C2 + C3 → C4 → C5。批次 4/5 完成后先更新本计划与设计的实现基线，再进入 C1。
