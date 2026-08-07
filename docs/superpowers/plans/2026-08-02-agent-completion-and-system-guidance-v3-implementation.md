# Novel Studio Agent 完整化与 System Guidance 3.0 实施计划

**目标：** 在保留现有 Agent loop、Context Profile、Change Set、审批、事务恢复和 Provider 接线的前提下，使四种 profile 的系统权限、真实工具、上下文分享、Plan/Act、写入审批和完成证据保持一致；补齐写作领域 CRUD、创作普通 UTF-8 文件 list/read/search/replace/create/move/delete，以及工程工作区内经过 hardened backend 资格化的 UTF-8 文本文件查、增、改、删、移动/重命名与单层目录创建。

**日期：** 2026-08-02<br>
**设计依据：** `docs/superpowers/specs/2026-08-02-agent-completion-and-system-guidance-v3-design.md`<br>
**前次已提交设计版本：** `9453448`（本文同时以当前工作树中的同步修订为合同源头）<br>
**计划实现基线：** `5c234d4`<br>
**计划状态：** Candidate。本文是实施合同和验收顺序，不是完成记录；任何能力只有在生产接线、用户控制、安全资格和打包 E2E 同时存在后才能标为 Complete。
**2026-08-07 范围修订：** 保留 creative lifecycle、engineering `create-directory`、multi-file/recovery、editor/tree/index sync 和文风 2.0 的完整功能；只通过复用现有管线、单一 native 实现链、参数化测试、Windows CI artifact 和并行工作流缩短工期。

## 1. 范围锁定

本计划交付：

- 内置 Guidance Registry，逐字冻结历史 `2.1`，新 Run 使用 System Guidance `3.0`。
- 单一逻辑 authority、消息顺序 2.0、统一不可信数据封套、Provider 最小披露和可恢复的严格 artifact 合同。
- 从最终 Provider 工具目录反推的 runtime facts、Permission Summary、逐 operation 审批规则与 proposal-level 审批证明。
- 首次发送预览、后续 round 发送账本、sharing defaults/run grant、确定性预算和 stale/capability-changed 门禁。
- Plan/Act 与“请求批准/替我审批”分层：Plan 当前始终只读，只保存未来 Act 的审批策略草稿；进入 Act 时按真实 operation 子集重新确认。
- writing 的章节和 Story Bible 领域 CRUD，包括章节改名、排序/卷归属、archive、tombstone delete/restore、完整 metadata history、dirty editor 协调和 UI 同步。
- `creative_general` 普通 UTF-8 文本 list/read/search/replace/create/move/delete；各 operation 独立资格，但全部属于本计划交付。
- engineering 的 root-handle list/read/search/index、文件 replace/create/move/delete 和单层 create-directory，配套 raw-byte mutation V2、审批 binding v2、Engineering V2 Journal、同卷可恢复删除、启动恢复门禁和 editor/tree 同步。
- 文风规则 2.0、跨 Provider 合同矩阵、安全/隐私/恢复 E2E 和发布证据。

本计划不交付：

- 任意 Shell、`run_project_task`、模型提供的命令字符串或本地任务目录。
- Agent Git、commit/reset/checkout/push 或内置 Git runtime。
- AppContainer 任务沙箱、插件进程、本地 stdio MCP 或本地项目代码执行。
- 二进制、大文件、递归目录删除、目录覆盖、跨卷 move、物理 purge 或工作区外 mutation。
- 向量检索、自动记忆写入、无用户确认的语义上下文扩张或整项目自动上传。
- 把“安全文件 CRUD 的工程 Agent”宣传成能够运行测试、构建和 Git 的完整工程执行 Agent。

网络读取和远程 MCP 是独立可选资格。创作普通文件 create/move/delete 与工程 create-directory 使用独立资格门和逐 operation fail-closed，但不是可从本计划删除或延后的功能；缺少任一项都不能标记 Agent Core Complete。任何未通过资格的能力都必须同时满足：工具不进入目录、runtime facts 表示不可用、UI 隐藏或禁用、发布证据标为 Disabled/Incomplete；不得用降级实现冒充完成。

## 2. 基线事实与不可绕过的前置决定

| 领域                                   | `5c234d4` 基线                                                | 本计划的目标变化                                                                                    |
| -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| System Guidance                        | `2.1`，正文由当前 builder 生成                                | 注册并冻结 `2.1`；新增注册的 `3.0` builder 和 materialization proof                                 |
| Prompt Artifact                        | `1.1`                                                         | 新增不兼容 `2.0` artifact；保存 registry key、冻结输入和独立 checksum                               |
| Agent Run Tool Catalog                 | `1.0`，facade v1/v2 名称可能并存于代码                        | 新增 catalog 2.0；新 Run 只公开收敛后的 facade，旧 catalog 只按 legacy reader 恢复                  |
| Context Snapshot                       | `1.4`                                                         | 新写入固定为 `2.0` authority/provenance/sharing 合同；旧 snapshot 只走旧 reader                     |
| Message order                          | `1.0`                                                         | 新 Run 使用 `2.0`；current request 为首轮最后一条真实 user 指令                                     |
| Untrusted envelope                     | 多个 legacy family                                            | 新增严格 `2.0` writer/parser；未知 kind/version 或 role 映射拒绝                                    |
| Packed context manifest                | `1.2`                                                         | 新增 `2.0` canonical source/order/sharing/round identity                                            |
| Canonical round manifest               | 无                                                            | 新增 `2.0`，与消息协议版本同步                                                                      |
| Runtime facts/task intent              | 无                                                            | 分别新增 `1.0`，只从 app-owned frozen inputs 派生                                                   |
| Writing generation guidance            | 旧永久文风包                                                  | 新增 `2.0`，只在正文生成/改写 task intent 注入                                                      |
| Permission Summary                     | `1.1`                                                         | 新增 `2.0` 单一能力真值和逐 operation approval rules                                                |
| Provider semantic version set          | 无                                                            | 新增严格 `1.0` version-set/checksum，统一绑定 artifact/预算/上下文/预览/cache/native proof          |
| Approval rule/proof                    | 无                                                            | 新增 Schema/proof `1.0`；rule-set 实例使用不可变 version/checksum                                   |
| Change Set                             | `1.0 / 1.1`，含确定性 `approvalToken`                         | 新 mutation 使用 `2.0`；公开 display checksum 与 Main-only apply capability 分离                    |
| Approval binding/ledger                | 确定性 token                                                  | 新增 `2.0` Main-only capability 与 durable ledger；旧 token 不迁移                                  |
| Run Snapshot/Event                     | `1.3`                                                         | 新增 `2.0` authority/protocol/finish/capability-changed/pending 状态合同                            |
| Run Draft/Plan Artifact/Plan Execution | `1.1 / 1.0 / 1.0`                                             | 新增 `2.0` policy-draft/handoff 合同；旧记录只能恢复为请求逐项批准                                  |
| Engineering journal                    | legacy/shared namespace                                       | 新增独立 Engineering V2 Journal namespace/schema/repository/reader；旧 journal 只走 legacy recovery |
| Engineering                            | pathname read/save 与测试 lifecycle port；生产 Agent 实质只读 | root-handle access + mutation V2 通过安装包资格后逐 operation 开放                                  |
| Writing                                | 正文、创建和 Story Bible 多数提案已存在                       | 补齐专用查询、领域 lifecycle、metadata/outline inverse、审批 proof 和 editor sync                   |
| `creative_general`                     | 普通文件 UI/可信后端已存在，Agent schema 边界仍需证明         | 复用现有 lifecycle/session/backend，逐项资格化 replacement/create/move/delete 并全部纳入完成定义    |

### 2.1 工程 native adapter 的架构闸门

`docs/superpowers/plans/2026-07-26-agent-tool-functional-priorities.md` 已正式取消 Rust 文件宿主、AppContainer、任务、Git、插件和本地 MCP，并清理对应构建链。新设计只重新打开 hardened 工程文件访问/写入后端，不能默认为恢复旧实现。

因此 Batch 0 必须先新增 `adr/ADR-0003-engineering-file-access-adapter.md`，至少裁决：

1. access/mutation 后端使用的 OS API、实现语言、IPC 边界和支持平台；
2. 与 `ADR-0001` TypeScript Strict Core 的关系，以及为什么 native 仅是受限 Repository adapter；
3. root handle、directory-relative traversal、raw-byte blob、durability、receipt 和 recovery-root 的可验证合同；
4. 源码、构建、签名、摘要、打包、qualification probe 与安装包 E2E 的精确路径；
5. unsupported/missing/drift 平台的 fail-closed/read-only 行为；
6. 明确不恢复 Shell、任务、Git、AppContainer、插件或本地 stdio MCP。

ADR 未 Accepted、打包实现未通过独立黑盒正/负对照前，所有 engineering mutation flags 必须保持关闭；普通 Node pathname API、`trusted_creative` 或测试 port 都不能取得 `hardened_native` 资格。

### 2.2 审批 UI trusted computing base 的前置闸门

Desktop Main/security architecture owner 必须在 Batch 0 接受 `adr/ADR-0004-agent-approval-ui-trust-boundary.md`，并在 Task 1.5 冻结 Plan/Act IPC 之前决定：Renderer 是否属于审批 trusted computing base；人工 Change Set 确认和一次性 Act 预授权分别使用何种可信表面；如何证明 human intent、隔离不可信预览内容并测试 IPC replay/伪造。

ADR 未 Accepted 时默认 Renderer 不受信，所有 profile 的 `limited_run_preapproval` 保持关闭；mutation 只有在已有独立资格的受信人工确认表面时才能保留“请求批准”，否则对应写能力也关闭为只读。若 ADR 判定 Renderer 不属于 TCB，则人工确认和 `user_preapproved_run` 的 Act 边界确认都必须改用 Main-owned/隔离表面；nonce/MAC 只能绑定内容和防重放，不能把不可信 Renderer 点击变成人类授权。该决定由 security architecture owner 签署，Desktop Main owner 负责实现与资格证据，Task 1.5、7.1 和 Batch 9 release gate 共同消费同一 ADR 结论。

## 3. 依赖图与执行批次

```text
Batch 0  合同冻结、版本策略、ADR-0003、ADR-0004
   |
   +--> Batch 1  Guidance/authority/能力真值/审批 proof/finish
            |
            +--> Batch 2  消息协议、sharing、preview、round ledger
            |       |
            |       +--> Batch 3  工作台命名和能力摘要 UI
            |
            +--> Batch 4  Writing 领域 CRUD backend prep（启用/E2E 等 Batch 2）
            |
            +--> Batch 5  creative_general backend prep（启用/E2E 等 Batch 2）
            |
            +--> Batch 6  Engineering hardened backend prep（启用/E2E 等 Batch 2）
                        |
                        +--> Batch 7  Engineering mutation V2 + replace/create
                                    |
                                    +--> Batch 8  move/delete/recovery/editor sync

Batch 2/3/4/5/8 完成后 --> Batch 9  跨 Provider 评测、打包 E2E、发布证据
```

| 批次 | 主要交付                                                       | 前置                     | 可并行关系                    | 阻塞门槛                                 |
| ---- | -------------------------------------------------------------- | ------------------------ | ----------------------------- | ---------------------------------------- |
| 0    | 历史冻结、版本矩阵、native/审批 TCB ADR                        | 无                       | 两个 ADR 可并行               | ADR/兼容测试通过                         |
| 1    | authority、Guidance 3.0、共享 Change Set/审批授权、finish 合同 | 0                        | 无                            | P0 安全测试全绿                          |
| 2    | 消息协议 2.0、sharing、preview/ledger                          | 1                        | 可与 4 的 Repository 准备并行 | spy Provider 隐私与 preview binding 通过 |
| 3    | 工作台命名和能力摘要 UI                                        | 1、2 的 DTO              | 可与 4/5 后端并行             | 展示与最终目录/Permission Summary 一致   |
| 4    | Writing 领域 CRUD                                              | 1；启用/E2E 还需 2       | Repository 可与 2、5、6 并行  | 领域事务、dirty/editor sync、安装包 E2E  |
| 5    | creative 文件全 lifecycle、文风 2.0                            | 1；启用/E2E 还需 2       | 后端/语料可与 2、4、6 并行    | 全 operation 闭环和检测 precision        |
| 6    | Engineering hardened access/read/index                         | 0、1、ADR；启用/E2E 需 2 | backend 可与 2、4、5 并行     | 正/负资格 probe；否则只读                |
| 7    | Engineering mutation V2、replace/create                        | 1、2、6                  | 无                            | raw-byte/receipt/WAL/重放测试            |
| 8    | move/delete/create-directory/recovery/multi-file/editor sync   | 1、2、7                  | directory gate 可独立验证     | 全 CRUD 安装包 E2E                       |
| 9    | 全局评测和发布收口                                             | 2-8 中准备发布的核心批次 | 无                            | release evidence 不得超报                |

共享热点 `tool-registry.ts`、`agent-run-session.ts`、`agent-run-runtime.ts`、IPC 合同、Change Set/approval 和 Run schema 由主集成分支持有；并行任务通过新增小模块和已冻结接口对接，避免多个执行者同时重写共享文件。

设计分批与本计划的对应关系：

| 设计阶段                     | 本计划批次                   | 约束                                                                                      |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| P0 安全与合同修复            | Batch 0-1                    | authority、版本、目录、Plan/Act 授权边界、审批 proof 和 finish 安全测试不得推迟到发布收口 |
| P1 消息协议 2.0 与上下文工程 | Batch 2                      | preview、sharing、budget、cache、hydrate 使用同一 v2 materializer                         |
| P2 核心 Agent 用户闭环       | Batch 3-8                    | writing、creative、engineering 分别按真实 capability 和 packaged evidence 开放            |
| P3 质量与发布门禁            | Batch 5 的文风资格 + Batch 9 | 只验证和汇总已接线能力，不在 P3 首次实现安全合同                                          |

## 4. 版本、feature flag 与回滚策略

### 4.1 版本策略

1. `2.1` guidance 正文和 renderer 必须先从基线提取为不可变 fixture；任何字符变化都算回归。
2. 新 Run 只使用已注册 `3.0`；旧 Run hydrate 按其 registry key 使用历史 renderer，绝不由当前 builder 重写。2.1 只允许 hydrate/view/export/确定性历史回放；新的 Provider round 或 proposal 必须 handoff 为 3.0。
3. Prompt Artifact、Agent Run Tool Catalog、message order、untrusted envelope、Runtime Facts/Task Intent/Generation Guidance、Provider Semantic Version Set、Context Snapshot、packed/canonical round manifest、Permission Summary、Approval Rule/Proof、Change Set、Approval Binding/Ledger、Run Snapshot/Event、Run Draft/Plan Artifact/Plan Execution 和 Engineering Journal 全部按设计 7.2 的字面目标版本创建新 writer/strict parser；不得给旧 strict schema 静默加 required 字段。
4. 旧 reader/normalizer 只恢复旧行为和旧权限。旧 Run 不因 hydrate 获得新 tools、sharing grant、write policy 或 auto-review rule。
5. 未知 guidance、message order、envelope、rule set、proof 或 artifact 版本一律 fail closed。
6. 旧 pending Change Set 的确定性 `approvalToken` 不能用于 v2 apply。升级后只允许查看/拒绝；需要执行时按当前内容重建 v2 Change Set 并重新审批。
7. 旧 prepared WAL 只能由注册的 legacy recovery reader 处理；不得迁移成新 transaction 后继续 apply。无法认证时进入只读 recovery review。
8. 每个新 schema 都提供 validator、canonical serializer、旧版本 reader/normalizer 或明确拒绝路径，并写 downgrade/rollback 测试。

### 4.2 建议 feature flags

以下名称是 Main-owned 实现目标，默认关闭，并进入 capability revision：

| Flag                           | 默认 | 依赖                     | 关闭/回滚行为                                                                                                                                                       |
| ------------------------------ | ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentGuidanceV3`              | off  | Batch 1                  | 开发期沿用现有 v1 管线且所有 v3 capability 关闭；发布后紧急关闭时阻止所有新 Agent Run，不把 v3 Run 或 standalone 降级为 2.1；历史 2.1 仅 hydrate/view/export/replay |
| `agentMessageProtocolV2`       | off  | Guidance v3              | 不创建 v2 Run；不把 v2 snapshot 降级发送                                                                                                                            |
| `agentPlanActPolicyV2`         | off  | Batch 1                  | 保持 planning 无 mutation authorization；未完成新确认边界时不得启用有限预授权                                                                                       |
| `phaseD_networkReadEnabled`    | off  | Batch 1、2、9            | 移除 `web_search/fetch_url`，令 `networkRead=false`；revision 变化使旧 Run `capability_changed`，未知远程 outcome 不重释为成功                                      |
| `phaseE_remoteMcpEnabled`      | off  | network gate、Batch 1、9 | 移除全部 remote MCP descriptor/tool，令 `externalTools=none`；保留当前对 network gate 的依赖，撤销时不重放未知外部 action                                           |
| `writingDomainCrudV2`          | off  | Batch 1、2、4            | 隐藏新增领域 mutation；保留已验证的旧只读/正文能力                                                                                                                  |
| `creativeTrustedReplaceV2`     | off  | Batch 1、2、5            | `creative_general` 回到只读 Agent，普通编辑器不受影响                                                                                                               |
| `creativeFileCreateV2`         | off  | Batch 1、2、5 独立资格   | 资格完成前只移除 create 工具、operation 和 UI 标签；不得从本计划完成范围省略                                                                                        |
| `creativeFileMoveV2`           | off  | Batch 1、2、5 独立资格   | 资格完成前只移除 move 工具、operation 和 UI 标签；不得从本计划完成范围省略                                                                                          |
| `creativeFileDeleteV2`         | off  | Batch 1、2、5 独立资格   | 资格完成前只移除 delete 工具、operation 和 UI 标签；不得从本计划完成范围省略                                                                                        |
| `engineeringHardenedAccessV1`  | off  | ADR、Batch 2、6          | engineering Agent 全部只读或不可索引；绝不 fallback pathname reader                                                                                                 |
| `engineeringReplaceV2`         | off  | Batch 1、2、7            | 只移除 replace operation；不得影响其他已资格 operation                                                                                                              |
| `engineeringCreateV2`          | off  | Batch 1、2、7            | 只移除 create operation；不得影响其他已资格 operation                                                                                                               |
| `engineeringMoveV2`            | off  | Batch 1、2、8            | 只移除 move/rename operation；不得影响其他已资格 operation                                                                                                          |
| `engineeringDeleteV2`          | off  | Batch 1、2、8            | 只移除 delete/recovery operation；不得影响其他已资格 operation                                                                                                      |
| `engineeringDirectoryCreateV1` | off  | Batch 1、2、8 独立资格   | 资格完成前只移除 create-directory operation；本计划完成前必须通过                                                                                                   |
| `approvalBindingV2`            | off  | Batch 1                  | 禁止所有 v2 mutation apply；不回退 deterministic token；因此 writing/creative/engineering 新 mutation 均不可标记 Complete                                           |
| `writingStyleRulesV2`          | off  | Batch 1、2、5            | 回到旧检测展示；不得改变已冻结 Run guidance                                                                                                                         |

能力撤销、flag 变化、root/policy/provider projection 漂移不在同一 Run 内热替换 guidance/tools；旧 Run进入 `capability_changed`，停止新的 Provider 调用，并要求显式创建 execution handoff 或新 Run。

默认关闭和逐 operation 独立资格表示 fail-closed 发布门禁，不表示可以删除功能。creative create/move/delete 与 engineering create-directory 必须在本计划结束前各自通过资格；只有网络读取和远程 MCP 仍可按真实产品决定保持 Disabled。

### 4.3 回滚单位

- Batch 1/2 是协议原子组：可以停止创建 v2 Run，但不能把已持久化 v2 artifact 当 v1 读取。
- writing、creative 和 engineering operation 按独立 capability bit 回滚；UI、runtime facts、Permission Summary 和 Provider 目录必须来自同一次冻结计算。
- engineering backend 资格漂移时立即撤销全部 mutation capability；read/index 是否继续可用由独立 access attestation 决定。
- recovery gate 和 legacy recovery reader 不受产品 flag 关闭影响。已存在 prepared/failed transaction 必须先恢复或进入 review，不能通过关 flag 遗忘。
- 发布证据只描述当前默认开启且通过安装包验证的能力；实验 flag 不计 Complete。

## 5. 执行与模型分工原则

1. 每个批次先写严格合同/失败测试，再实现最小纵向闭环；文案、样式和纯配置不机械执行测试先行。
2. `gpt-5.6-sol` 的高推理档用于 authority、审批、恢复、native 边界、schema migration 和跨模块安全审查。
3. `gpt-5.6-terra` 的 max 档用于边界清晰的 DTO/validator、UI、fixture、文件清单、普通 adapter 和定向测试。
4. 主代理持有共享热点、接口冻结、集成、最终 diff 和门禁；子任务不得独立提交共享工作区。
5. 每个子任务开始前声明独占文件、依赖接口和目标测试；交付时报告实际修改、实际测试、跳过项和残余风险。
6. 批次内只跑最窄测试；批次门禁统一跑相关 suite、`typecheck` 和 `lint`，避免每个小任务重复跑全仓。
7. 涉及 native、恢复或安装包安全的结论必须有真实 packaged black-box probe 和故意关闭保护的负对照；Mock/源码分支检查只能作补充。

### 5.1 保留功能的执行压缩与 Windows CI

本节只压缩重复实现和等待，不修改设计范围、完成定义或安全资格：

1. Batch 5 的 creative lifecycle、文风 2.0 与 Batch 6 的 native source stream 在 Batch 1 接口冻结后并行启动；启用和 production E2E 仍分别等待 Batch 2，不得把另一个工作流的完成作为 source 开发前置。
2. 复用现有 `creative-project-file-session.ts`、`agent-file-operation-session.ts`、`trusted-creative-file-operations.ts`、Change Set 2.0、Approval Binding/Ledger、Version Group、save coordinator 和 editor/tree/index sync。creative 的 replace/create/move/delete 使用一条按 operation 参数化的 proposal/apply 编排路径和 effect-specific validator，不建立四套 session/backend、profile-specific approval token 或第二套应用层文件操作框架。
3. ADR-0003 的 access、mutation、receipt 与 recovery primitives 在同一个 Windows C++ Node-API addon、CMake 工程、manifest、签名链和 probe harness 中实现。B6 可同时落下后续 primitive，但只开放 access；replace/create 仍由 B7 gate，move/delete/create-directory 仍由 B8 gate。
4. Engineering V2 Journal 的 schema/namespace/repository/strict reader、raw-byte blob/staging/receipt 与 recovery scanner 保持独立，不复用 writing/creative legacy journal。共享的是上层 Change Set、审批、版本组和 UI 合同，不是 durable authority。
5. 共用合同和 happy-path 测试按 profile/operation 参数化，每个 operation 只另增 effect-specific 安全差异用例；native 保护负对照、trusted creative 竞态、Engineering V2 Journal 故障点和 packaged E2E 仍分别保留，不能用参数化 mock 代替。
6. native 规范构建 workflow 固定为 `.github/workflows/engineering-file-access-native.yml`，在 `windows-latest` 使用 MSVC、Windows SDK 和 CMake，记录 toolchain/source identity，运行正向 probe、故意关闭保护的负对照和 fault probe，并上传 `.node`、manifest、SHA-256 与 probe report。本地机器可只消费校验后的 CI artifact，不要求安装 Visual Studio/Build Tools。
7. 未签名 CI artifact 只能用于开发构建和 probe；production capability 仍要求安装包内 digest、Authenticode publisher、detached CMS、owner trust store 和 packaged qualification，不能由下载成功或普通 SHA 自洽代替。
8. creative/language/native/application integration/qualification 分别提交；主代理持有共享热点与最终 gate，避免跨批次积累未提交改动或在上下文压缩后重复实施。
9. 各 Task 的“修改文件”是候选 touchpoint，不是要求重写每个文件的清单。先审计已有能力与测试，只补缺失合同；批次以行为闭环和 gate 证据完成，不以修改文件数或新增代码量完成。

## 6. Batch 0：冻结基线与架构资格

### Task 0.1：冻结历史 Guidance 2.1 和现有协议 fixture

**新增文件**

- `packages/application/src/agent-guidance-registry.ts`
- `packages/application/test/fixtures/agent-system-guidance-2.1/standalone.txt`
- `packages/application/test/fixtures/agent-system-guidance-2.1/writing.txt`
- `packages/application/test/fixtures/agent-system-guidance-2.1/creative_general.txt`
- `packages/application/test/fixtures/agent-system-guidance-2.1/engineering.txt`
- `packages/application/test/fixtures/agent-system-guidance-2.1/manifest.json`
- `packages/application/test/agent-guidance-registry.test.ts`
- `apps/desktop/test/fixtures/agent-legacy-contract-matrix.json`
- `apps/desktop/test/agent-legacy-contract-matrix.test.ts`

**修改文件**

- `packages/application/src/agent-system-prompt.ts`
- `packages/application/test/agent-prompt-materializer.test.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/repository/test/agent-run-repository.test.ts`

**实施步骤**

1. 从 `5c234d4` 仅按四个 profile 各生成一份 byte-for-byte `2.1` fixture，并记录 checksum；当前 builder 不随 operation/capability 变化，不能把四份 fixture 描述成 operation 组合矩阵。
2. 将现有 `buildAgentSystemPrompt` 的 2.1 正文生成逻辑提取/绑定为 registry-owned historical renderer，保持 public compatibility API 和四份输出逐字不变；建立只注册四个 `profile@2.1` 的严格 lookup、模板 checksum 与 historical materialize/compare seam，本任务不加入 3.0 行为。
3. manifest 将已知历史偏差标为 `replay_only`：profile-only 能力陈述、writing 内嵌 foreshadow v1.0 完整 JSON/ID 合同、`paid-off` 强制 `actualPayoffChapterId` 和永久文风包。它们不是当前 Story Bible/权限合同，也不能作为新 Run 的 fixture。
4. 建立历史侧测试：start/hydrate/compact 对旧 Run 重建同一正文；未知版本和正文篡改即使重算普通 SHA 也被拒绝。manifest 同时登记由 Task 1.1/1.6 完成的新合同侧断言，本任务不引用尚未实现的 3.0 builder。
5. 在 `agent-legacy-contract-matrix.json` 逐项登记所有当前 schema/version、strict writer/parser、cache/budget identity、legacy WAL reader、目标 reader disposition 和承载测试；`agent-legacy-contract-matrix.test.ts` 校验无遗漏/重复、命名测试存在且 legacy 项不会映射到新权限。本任务只冻结事实，不改行为。
6. 冻结含确定性 `approvalToken` 的旧 pending Change Set fixture 与迁移期望（只可查看/拒绝）；本任务不提前伪造尚未实现的 v2 apply。Task 1.2b 消费该 fixture，完成“旧 token 不可 apply”的实际拒绝测试。

**验收**

- 四份 2.1 fixture 与基线逐字一致。
- manifest 的已知偏差与 fixture checksum 一起冻结；任何测试都不能把 `replay_only` 文案解释成新 Run 合同。
- 任何历史正文、profile、version 或 checksum 交叉不变量变化都无法成为 authority。
- worktree 只包含 fixture/测试和必要的 registry 接缝，不包含 3.0 行为变化。

### Task 0.2：接受 ADR-0003 并冻结 native qualification 合同

**新增文件**

- `adr/ADR-0003-engineering-file-access-adapter.md`
- `packages/agent-engine/src/engineering-file-contracts.ts`
- `packages/agent-engine/test/engineering-file-contracts.test.ts`
- `apps/desktop/src/main/engineering-file-access-qualification.ts`
- `apps/desktop/test/engineering-file-access-qualification.test.ts`
- `.github/workflows/engineering-file-access-native.yml`（Batch 0 落合同骨架，Batch 6 实现构建/probe job）

**修改文件**

- `adr/ADR-0001-engine-runtime-language.md`（只增加 ADR-0003 关联，不改原决定）
- `apps/desktop/src/main/agent-feature-flags.ts`
- `apps/desktop/test/agent-feature-flags.test.ts`
- `apps/desktop/electron-builder.config.cjs`
- `scripts/package-check.mjs`
- `package.json`（仅在 ADR 决定需要新增构建/资格命令时）
- `.github/workflows/ci.yml`（接入 native artifact/qualification 汇总门）

**实施步骤**

1. ADR 采用本设计已固定的 `.github/workflows/engineering-file-access-native.yml`，并冻结唯一 addon 的 native 源码、产物、本机 artifact 消费及其他构建/打包精确路径。Batch 0 只落可验证的 workflow 合同骨架，Batch 6 在该固定路径补全实际构建与 probe；禁止创建猜测性 host 工程或第二套构建链。
2. 定义 root/access/mutation/recovery attestation，missing、partial、unknown、stale、digest/signature mismatch、OS 不支持都归一化为 unavailable。
3. qualification service 只由 Main 创建，Renderer、模型、项目文件和 IPC 输入不能构造或刷新 attestation。
4. 建立正/负 probe 合同：负对照故意关闭 root-relative/no-follow/receipt/durability 保护，必须暴露 canary，否则 probe 无效。
5. 明确开发包和发布包的资格差异；Windows CI 可以使用 MSVC/Windows SDK/CMake 构建并上传开发 artifact，使本地 C++ 工具链成为可选，但未签名/开发 host 不得产生 production attestation。

**验收**

- ADR 状态为 Accepted，且列出源、构建、签名、打包、probe 和平台支持的精确路径。
- 资格不存在时 engineering runtime 仍可只读，但所有 mutation flags、tools 和 UI 能力均关闭。
- 仓库、CI 和安装包没有重新引入任务、Git、AppContainer、插件或本地 MCP。

### Task 0.3：接受 ADR-0004 并冻结审批 UI 信任边界

**新增文件**

- `adr/ADR-0004-agent-approval-ui-trust-boundary.md`

**实施步骤**

1. security architecture owner 明确 Renderer 是否属于 TCB，并分别裁决人工 Change Set 确认、Plan-to-Act 确认和 `user_preapproved_run` 一次性授权的可信输入表面。
2. ADR 定义不可信 preview/content 与确认控件的隔离、Main-owned binding、可验证 human-intent evidence、IPC replay/伪造边界、无障碍/窗口身份要求和可测试负例。
3. 若 Renderer 不属于 TCB，确定 Main-owned/隔离确认表面的实现落点；若 Renderer 属于 TCB，列出使该假设成立的加固、内容隔离和签名/打包前提。
4. 未决或资格证据缺失时默认关闭 `limited_run_preapproval`；nonce/MAC、display checksum 或普通 Renderer IPC 均不能代替本决定。

**验收**

- ADR 状态为 Accepted，并由 security architecture owner 与 Desktop Main owner 签署责任边界。
- Task 1.5 的 IPC/DTO 和 Task 1.2b 的授权 ledger 可以引用一个确定的可信确认来源，不需要在 profile 写入批次返工权限边界。
- 未实现 ADR 所需可信表面时，所有 profile 至少保持只读；只有已独立资格化的受信人工表面可保留“请求批准”，UI 不显示可用的“替我审批”。

**Batch 0 门禁与建议提交**

```powershell
npm exec vitest -- run packages/application/test/agent-guidance-registry.test.ts packages/application/test/agent-prompt-materializer.test.ts packages/application/test/agent-run-session.test.ts packages/agent-engine/test/engineering-file-contracts.test.ts packages/repository/test/agent-run-repository.test.ts apps/desktop/test/agent-legacy-contract-matrix.test.ts apps/desktop/test/engineering-file-access-qualification.test.ts apps/desktop/test/agent-feature-flags.test.ts --no-file-parallelism
npm run typecheck
npm run lint
npm run package:check
git diff --check
```

Batch 0 只冻结 native artifact/probe/打包合同，并让缺失 host 得到 `unavailable`；不生成 production attestation，也不把任何 native 产物称为已资格化。实际 packaged 正/负 probe、故意关闭保护的 canary 和 `package:dir:built` 在 Batch 6 实现后执行；若 Batch 0 实施时提前产生任何候选 native artifact，则本批次必须同步执行这些真实产物门禁，否则 ADR 不能 Accepted。

建议提交：

1. `test(agent): freeze guidance 2.1 and legacy protocol fixtures`
2. `docs(adr): choose hardened engineering file access adapter`
3. `docs(adr): freeze approval UI trust boundary`
4. `feat(engineering): add fail-closed access qualification contract`

## 7. Batch 1：Authority、Guidance 3.0 与能力真值

### Task 1.1：实现 Guidance Registry 和 System Guidance 3.0

**新增文件**

- `packages/agent-engine/src/provider-semantic-version-set.ts`
- `packages/agent-engine/test/provider-semantic-version-set.test.ts`
- `packages/application/src/agent-runtime-facts.ts`
- `packages/application/src/agent-guidance-budget.ts`
- `packages/application/src/writing-task-intent.ts`
- `packages/application/test/agent-runtime-facts.test.ts`
- `packages/application/test/agent-guidance-budget.test.ts`
- `packages/application/test/writing-task-intent.test.ts`

**修改文件**

- `packages/application/src/agent-guidance-registry.ts`
- `packages/application/src/agent-system-prompt.ts`
- `packages/application/src/agent-context-profile.ts`
- `packages/application/src/agent-prompt-materializer.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-run-draft-session.ts`
- `packages/application/test/agent-context-profile.test.ts`
- `packages/application/test/agent-prompt-materializer.test.ts`
- `packages/application/test/agent-run-draft-session.test.ts`
- `packages/application/test/agent-run-session.test.ts`

**实施步骤**

1. 注册不可变 `profileId@guidanceVersion`，模板 checksum 对稳定模板/AST 字节计算；materialized checksum 对 renderer 最终正文计算，二者禁止复用。
2. 新 3.0 builder 固定按 `AUTHORITY + SANITIZED_RUNTIME_FACTS + OPERATION + PROFILE + TOOL/EVIDENCE + COMPLETION + optional writing generation` 装配；Provider-visible Runtime Facts 与 Writing Task Intent 的 strict writer 分别固定 `schemaVersion: "1.0"`，unknown version 拒绝。
3. builder 输入使用完整 frozen profile、operation mode、task intent、最终工具投影和 Effective Capability State；不得只按 `profileId` 或项目正文猜能力。
4. 从 system 删除 foreshadow v1.0 Schema、ID 正则、系统字段、永久完整文风包和远程自由文本；只保留稳定行为合同。
5. planning 永远生成 `writeCapability=none`、空 mutation arrays、`writeApprovalPolicy=not_applicable`；execution 根据实际 operation 子集生成只读/部分/完整说明。
6. task intent 只使用当前请求、显式选区和 app-owned composer action；项目/网页/工具文本不能参与分类。`unknown/mixed` 若会改变写入目标或范围，先请求用户确认，不静默扩张。
7. Prompt Artifact `2.0` 保存 registry key、规范化输入、task intent、`writingGenerationGuidanceVersion: "not_applicable" | "2.0"`、Provider-visible runtime facts、四类 checksum 和实际正文。Batch 1 只建立 fragment slot/strict validator，未注册时一律写 `not_applicable`；Task 5.2 首次注册不可变 `2.0` 后，只有 writing + `bodyGeneration=true` 才可选择。hydrate 从对应 registry 重建并比较，正文不能自举为 authority。
8. 新增 `schemaVersion: "1.0"` 的 strict `ProviderSemanticVersionSetV1` writer/parser 和 canonical checksum，覆盖设计 7.2 列出的全部 Provider-semantic 合同及本轮不可变 approval rule-set version/checksum；它进入 Prompt Artifact 和 materialized proof，unknown/缺项/额外字段或同 version 不同 checksum 拒绝。
9. 用固定版本 `AgentTokenEstimator` profile `guidance-budget-v1` 对完整 materialized authority 建立 token gate：枚举四 profile × 合法 mode × 最大合法 operation/approval rule/task-intent 输入，snapshot 冻结 estimator ID/version、provider version-set checksum、输入 checksum、正文 checksum 和 count；writing `<=1200`，standalone/creative_general/engineering `<=900`，超限使注册测试失败。
10. 与 2.1 manifest 做成对回归：新 Run 只能选 3.0，3.0 排除 foreshadow v1.0 Schema/ID 合同和 profile-only 静态能力文案；Task 1.6 另断言 v1.1 缺 `actualPayoffChapterId` 只产生固定 warning code。

**验收**

- 2.1 fixture 不变；新 Run 使用 3.0。
- 四 profile × 合法 mode 快照准确，engineering 无 Shell/任务/Git 声明。
- 每个 profile 的最大合法 materialization 均通过固定 estimator 的硬上限；变更 estimator、模板或最大输入会显式更新并复审快照。
- writing guidance 不包含旧 Story Bible Schema；非正文 task 不注入 writing generation guidance。
- artifact 篡改、未知 renderer、profile/version 不匹配 fail closed。
- Provider semantic version-set 任一字面版本或 rule-set checksum 变化都会改变 artifact/budget identity。

### Task 1.2：统一 Effective Capability、Permission Summary 和审批规则

**新增文件**

- `packages/agent-engine/src/approval-rule-registry.ts`
- `packages/agent-engine/src/approval-decision-proof.ts`
- `packages/agent-engine/test/approval-rule-registry.test.ts`
- `packages/agent-engine/test/approval-decision-proof.test.ts`
- `packages/repository/src/approval-decision-proof-repository.ts`
- `packages/repository/test/approval-decision-proof-repository.test.ts`

**修改文件**

- `packages/agent-engine/src/agent-tool-capabilities.ts`
- `packages/agent-engine/src/effective-capability-state.ts`
- `packages/agent-engine/src/permission-summary.ts`
- `packages/agent-engine/src/agent-run-tool-catalog.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/src/index.ts`
- `packages/agent-engine/test/effective-capability-state.test.ts`
- `packages/agent-engine/test/permission-summary.test.ts`
- `packages/agent-engine/test/agent-run-tool-catalog.test.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-permission-session.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/agent-tool-provider-mapping.ts`
- `packages/application/test/agent-permission-session.test.ts`
- `packages/application/test/agent-tool-provider-mapping.test.ts`
- `apps/desktop/src/main/application-composition.ts`

**实施步骤**

1. 把 writing domain operations 和 workspace file operations 拆成逐 operation capability；旧 `fileLifecycleEnabled=true` 不能解释成全 CRUD。
2. 新 Run 写 `AgentRunToolCatalog 2.0`；catalog 1.0 的 v1/v2 facade 只由 legacy reader 按冻结 descriptor 恢复，不能调用当前 registry 重建。目录流水线固定为 canonical descriptor -> sanitizer -> Provider projection -> frozen directory -> Effective Capability/Permission/budget/cache/native payload。
3. Approval Rule/Proof Schema 从 `1.0` 起步；每个公开 mutation 恰好映射一条规则。每个 rule-set 实例冻结独立 `approvalRuleSetVersion + approvalRuleSetChecksum + canonical approvalRules + effect-rule definition checksum`，同 version/ID 内容不可变；operation mapping、review mode、判定代码、阈值或证据语义变化必须注册新 effect-rule ID（如适用）和新 rule-set version，并触发 `capability_changed`。`always_human` 与 `conditional_auto_review(effectRuleId)` 不能由工具名布尔值代替，unknown/mismatched rule set 拒绝。
4. proposal 冻结后由 Main 生成 `schemaVersion: "1.0"` 的严格 `MainOnlyApprovalDecisionProofV1`，绑定精确 rule-set version/checksum，并使用 JCS/RFC 8785 canonical JSON UTF-8 + SHA-256；未知 schema、混合或缺证取最严格结果。
5. Main 原子持久化 proof 后，Change Set、proposal event、审批 UI 和 approval binding 只引用同一 proof ref；apply 前重算所有绑定事实，任何变化使 proof stale。
6. Provider/tool result 只收到脱敏 summary；proofId、root/workspace/policy identity 和原始 evidence 不离开 Main 审计域。
7. Permission Summary `2.0` 从最终 providerName mapping 反推；allowed/forbidden 互斥，动态 network/MCP 不再同时出现在固定 forbidden。
8. 建立唯一、穷尽的 policy projection：planning 或无 mutation execution -> `none/not_applicable`，并把 rule-set version/checksum 一并规范化为 `not_applicable`、rules 置空；`write_before_confirmation` -> `propose/confirm_each_change_set`；只有已确认的 `user_preapproved_run` -> `propose/limited_run_preapproval`；未确认/失效预授权 start fail closed。`executionWritePolicyDraft` 不进入该映射。

**验收**

- runtime facts、Permission Summary、UI DTO 和 Provider tools 对 operation 子集逐项相等。
- app-owned execution policy 与 Provider-visible `writeApprovalPolicy` 的每个合法/非法组合都有穷尽映射测试，draft 不能成为授权。
- planning 无 proposal proof；execution catalog facts 不引用尚不存在的 proposal。
- proof schema、稳定排序、checksum、ref、stale 复验、混合组降级和脱敏均有篡改测试。
- rule-set 同 version 不同正文拒绝；注册新 version 后旧 Run 不被当前规则重释。
- backend/feature/release evidence 任一缺失时对应工具不注册。

### Task 1.2b：前置升级共享 Change Set 2.0 与 Main-only 审批授权

**新增文件**

- `packages/agent-engine/src/approval-binding-v2.ts`
- `packages/agent-engine/test/approval-binding-v2.test.ts`
- `packages/agent-engine/test/transaction-journal.test.ts`
- `packages/repository/src/approval-authorization-ledger.ts`
- `packages/repository/test/approval-authorization-ledger.test.ts`

**修改文件**

- `packages/agent-engine/src/change-set.ts`
- `packages/agent-engine/src/approval-gate.ts`
- `packages/agent-engine/src/transaction-journal.ts`
- `packages/agent-engine/test/change-set.test.ts`
- `packages/agent-engine/test/approval-gate.test.ts`
- `packages/application/src/agent-write-authorization.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/version-group-session.ts`
- `packages/application/test/change-set-session.test.ts`
- `packages/application/test/version-group-session.test.ts`
- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/test/agent-write-transaction.test.ts`

**实施步骤**

1. 在任何新增 writing/creative/engineering mutation 可 apply 前完成共享升级。Change Set `2.0` 将确定性值改为 Renderer 可见 `displayBindingChecksum`；它只证明预览一致，永远不能 apply。每份新 Change Set 绑定创建它的 `providerSemanticVersionSetChecksum`，版本集合不匹配必须重建提案。
2. Approval Binding strict writer/validator 固定 `schemaVersion: "2.0"`。Main 在人工确认或合格 auto-review 后签发不可预测 opaque capability 或 app-owned MAC，完整绑定 provider version-set checksum、workspace/root/run/change-set/revision/selection/order/source/target/base/candidate、rule-set version/checksum、proof/policy/capability/expiry/nonce；unknown/legacy binding version 不能进入 2.0 apply。Schema 预留 delete-only 的 `recoveryRootBindingId + recoveryGrantRevision + recoverySideEffectChecksum`：delete 时三者必填且进入 MAC/capability，非 delete 必须按 strict schema 省略/`not_applicable`，不能混用。
3. Authorization Ledger record 固定 `schemaVersion: "2.0"`，绑定同一 provider version-set checksum，并实现 `issued -> reserved(transactionId) -> consumed | revoked`；只有未过期 issued 可原子 reserve，reserved 只允许同 transaction resume/query，授权过期不打断已开始的认证 recovery，commit/确定性 rollback/拒绝后消费或撤销。旧 token/ledger 只按 legacy reader 查看或撤销，不 normalize 成 2.0。
4. reserve-WAL 间崩溃启动时撤销孤立 reservation 且零写入；prepared WAL 必须引用同一 reservation。共享 version-group/transaction/recovery 入口只接受已 reserve 的 v2 authorization，不能按 profile 回退 deterministic token。
5. capability 不进入 Provider、Renderer state、工具参数/结果、遥测或恢复摘要；Renderer 只提交绑定预览的 approve/reject。
6. 消费 Accepted ADR-0004 的可信确认来源并绑定 ledger issuance；若 ADR 要求 Main-owned/隔离确认表面，则 Task 1.5 的表面及 human-intent/IPC 负例必须先通过资格。不得由后续 profile 批次重新决定 TCB，也不得在证据缺失时发布 auto-review。

**验收**

- display checksum 不能 apply；capability 篡改、重放、过期、跨 Run/workspace/revision/operation 全拒绝。
- selection/order/base/candidate/proof/policy/capability 任一变化要求重新预览审批。
- 旧 pending Change Set 不可用旧 approvalToken 进入 v2 apply；Task 0.1 冻结的 fixture 只可查看/拒绝。
- provider version-set 或 rule-set version/checksum 篡改拒绝。
- delete 缺少或篡改任一 recovery-root/grant/side-effect 字段拒绝，非 delete 夹带这些字段也拒绝。
- ADR-0004 未满足时 `limited_run_preapproval` 保持关闭，人工/预授权确认来源不能由普通 Renderer 伪造。
- Batch 4/5/7/8 只能消费这套共享授权核心；不得实现 profile-specific apply token 或兼容回退。

### Task 1.3：强制单一 authority 和净化 Provider/远程工具

**新增文件**

- `packages/application/src/agent-untrusted-envelope.ts`
- `packages/application/test/agent-untrusted-envelope.test.ts`
- `packages/application/test/agent-provider-authority-contract.test.ts`

**修改文件**

- `packages/application/src/agent-run-model-driver.ts`
- `packages/application/src/agent-prompt-materializer.ts`
- `packages/application/src/agent-external-tool-session.ts`
- `packages/application/test/agent-run-model-driver.test.ts`
- `packages/application/test/agent-external-tool-session.test.ts`
- `packages/llm-adapter/src/openai-compatible-provider.ts`
- `packages/llm-adapter/src/anthropic-provider.ts`
- `packages/llm-adapter/src/gemini-provider.ts`
- `packages/llm-adapter/test/openai-compatible-provider.test.ts`
- `packages/llm-adapter/test/anthropic-provider.test.ts`
- `packages/llm-adapter/test/gemini-provider.test.ts`

**实施步骤**

1. 新 writer 只生成 Provider-visible untrusted envelope `2.0`；strict parser 按 version/artifact kind 限制 role、source metadata 和配对关系，unknown version、额外字段或 kind-role 不变量失败即拒绝。legacy envelope 只由旧 reader 恢复，不能 normalize 后取得 2.0 权限。
2. 规范化 `LlmRequest` 只允许一个 app-authored logical authority。当前三类生产 adapter 分别映射恰好一个 native authority：generic OpenAI-compatible 与官方 OpenAI 选择都由 `openai-compatible-provider.ts` 承担但作为两个配置 case 测试，Anthropic/Gemini 各用自身 adapter；遇到第二个 authority block 直接拒绝，不 join/coalesce 或降级到 user。
3. 孤立工具/恢复摘要不能生成 system；可证明配对时恢复 tool，否则丢弃并留本地诊断，确需保留时用 `untrusted_recovery_data` user/data。
4. Provider-visible envelope 只保留最小 source metadata；workspaceId、绝对路径、artifact/dependency/cache/account identity 只留本地 snapshot。
5. 若远程 MCP 保持启用，先限制原始字节/深度/节点数，再递归删除不可信 title/description/default/examples/$comment/pattern；property/required 只接受安全机器标识，enum/const 只接受类型匹配、长度受限且无自然语言/控制符的机器 token，并用 app-authored 或用户明确审阅的本地 connector 摘要重建 descriptor。无法可靠调用的工具整体拒绝；未完成时远程 MCP flag 保持关闭。

**验收**

- canonical request 恰好一个 logical authority；四个 Provider 选择 case 覆盖三类 adapter，每个 adapter 恰好一个 native authority。
- 恶意恢复、项目、网页、工具结果和 MCP schema 文本不能增加权限或第二 authority。
- spy payload 不含内部 provenance、绝对路径、用户名、workspace/root identity。

### Task 1.4：结构化 finish 与 pending 状态

**新增文件**

- `packages/agent-engine/src/finish-report.ts`
- `packages/agent-engine/test/finish-report.test.ts`

**修改文件**

- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/src/agent-run-coordinator.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/agent-run-coordinator.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-tool-call-pipeline.ts`
- `packages/application/test/agent-tool-call-pipeline.test.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/repository/src/agent-run-repository.ts`
- `packages/repository/test/agent-run-repository.test.ts`

**实施步骤**

1. 新 Run 只写严格 `AgentRunSnapshotV20` / `AgentRunEventV20`，显式承载 authority/protocol/catalog/capability-changed/finish/pending 合同，并绑定 `providerSemanticVersionSetChecksum` 与适用本地合同字面版本；1.0–1.3 只由注册 legacy reader 恢复，旧记录不能 normalize 成 v2 后取得新 tools、sharing、policy 或状态。
2. `finish` 输入升级为严格 `completed | blocked` + result/changes/verification/limitations/evidence refs。
3. Application 用已应用 version group、工具事件、验证事件和 pending state 校验 report；模型文字不能单独证明完成。
4. `awaiting_write_approval`、`awaiting_context_share_approval`、`context_stale`、`recovery_required` 不调用 finish；模型 loop 在边界暂停。
5. `blocked` 持久化为独立 `run_blocked`，不得伪装 `run_completed`；证据不足的 completed 请求稳定拒绝。
6. 截断/不完整 tool arguments 在 parse/strict schema 阶段拒绝；纯读取才可在同一 snapshot 并行，含 propose/external action 的批次按模型顺序串行且不能越过审批点。
7. 取消传播到 Provider、读取、网络/MCP 和 pending handler；只对已证明无副作用的读取做有界重试，未知 action outcome 不自动重复。轮次、调用数、参数和结果预算继续使用硬上限。
8. `request_user_input` 只用于会实质改变结果的选择、可信事实冲突、新审批/分享授权或用户可解除的能力阻塞；可通过项目读取或安全默认解决的事项不打断用户。

### Task 1.5：分离 planning mode 与 execution policy draft

**条件新增/修改文件**

- ADR-0004 指定的 Main-owned/隔离确认 surface、Desktop Main/preload IPC、attestation 与窗口身份/content-isolation/human-intent/forge/replay 负例测试文件

**修改文件**

- `packages/agent-engine/src/agent-run-draft.ts`
- `packages/agent-engine/src/plan-artifact.ts`
- `packages/agent-engine/src/plan-execution.ts`
- `packages/agent-engine/test/agent-run-draft.test.ts`
- `packages/agent-engine/test/plan-artifact.test.ts`
- `packages/agent-engine/test/plan-execution.test.ts`
- `packages/application/src/agent-plan-execution-session.ts`
- `packages/application/src/agent-run-draft-session.ts`
- `packages/application/test/agent-plan-execution-session.test.ts`
- `packages/application/test/agent-run-draft-session.test.ts`
- `apps/desktop/src/renderer/agent-run-bridge.ts`
- `apps/desktop/test/agent-run-bridge.test.ts`
- `packages/ui/src/agent-composer.tsx`
- `packages/ui/src/agent-permission-menu.tsx`
- `packages/ui/src/plan-artifact-review.tsx`
- `packages/ui/test/agent-composer.test.tsx`

**实施步骤**

1. 先消费 Accepted ADR-0004 冻结可信确认来源和 IPC ownership；若 ADR 未决或所需可信表面未实现，UI 保持“替我审批”禁用，不能先按普通 Renderer callback 定型。
2. planning snapshot 强制 `writeCapability=none`、`writeApprovalPolicy=not_applicable`，目录只含 read/list/search、`finish_plan` 和必要 input/external_read。
3. Run Draft、Plan Artifact 和 Plan Execution 新 writer 固定写 `2.0`，新增 app-owned `executionWritePolicyDraft` 与 handoff acknowledgement；不得复用 execution 有效授权回调，不进入 planning Provider payload。planning draft 不把自身 version-set checksum 当成未来授权；Act handoff 必须重新物化并绑定精确 execution `providerSemanticVersionSetChecksum`。旧 1.1/1.0 reader 只能恢复为 `write_before_confirmation` 且 `executionWritePolicyAcknowledged=false`，unknown version fail closed。
4. Plan Composer 始终显示“执行阶段审批策略”和“当前计划：只读”；无可写工具时选项可见但禁用并说明原因。
5. 手动切 Act 或批准 Plan 时始终展示即将启用的 operation/rules 和策略。`write_before_confirmation` 创建逐 Change Set 请求批准的 execution Run，不设置预授权 acknowledgement；只有选择 `user_preapproved_run` 且通过 ADR-0004 指定的可信表面显式确认，才创建 `executionWritePolicyAcknowledged=true` 的 execution Run。
6. Plan revision、workspace/root/capability/policy 变化使确认失效；新 Run 默认“请求批准”，不能继承上一 Run 的预授权。
7. 实际 operation 比预览更多或更严格时停在确认边界，不自动扩大。
8. 若 ADR-0004 判定普通 Renderer 不在 TCB，本任务先实现 ADR 指定的 Main-owned/隔离确认 surface、Main/preload IPC 和 attestation，并通过窗口身份、内容隔离、human-intent、IPC forge/replay 负例；若判定 Renderer 在 TCB，则实现 ADR 要求的等价加固和资格测试。Task 1.2b 与后续 profile 写入任务只消费该可信来源，不补做 UI 信任边界。

**验收**

- Plan 中选择“替我审批”不会增加工具、runtime facts、token 或授权记录。
- Act handoff 未完成前没有 mutation tools；`write_before_confirmation` handoff 后只开放最终资格化的 propose 子集且 acknowledgement 保持 false，`user_preapproved_run` 只有可信确认后才为 true。
- `always_human` operation 在有限预授权中仍暂停；新 Run 重置。
- ADR/可信确认表面缺失时 `limited_run_preapproval` 在 DTO、UI、Run start 和 Provider facts 四层均不可用。
- 旧 draft/artifact/execution hydrate 后只能请求逐 Change Set 批准，绝不合成 acknowledged 或有限预授权。

### Task 1.6：隔离 profile schema 并统一 Story Bible 创建合同

**修改文件**

- `packages/schemas/src/story-bible.ts`
- `packages/schemas/test/story-bible-reference-integrity.test.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/src/agent-tool-capabilities.ts`
- `packages/agent-engine/src/effective-capability-state.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/story-bible-agent-tool-session.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/test/story-bible-agent-tool-session.test.ts`
- `packages/application/test/agent-run-session.test.ts`
- `apps/desktop/src/main/agent-feature-flags.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`

**实施步骤**

1. 冻结 catalog 2.0 收敛规则：新 Guidance 3.0 Run 只公开 profile-specific 目标名称；`propose_chapter_write`、`propose_chapter_create`、`propose_story_bible_write` 等只供历史 catalog/内部 command dispatch，`manage_path` 不进入任何新目录。同义 legacy/新名称不得在同一 frozen directory 并存，旧 catalog 仍按旧 registry 恢复。
2. writing Provider schema 移除普通 `file:` read/edit/create/move/delete/mkdir 分支。
3. 把 `fileLifecycleEnabled`/`phaseB_fileLifecycleEnabled` 降为 legacy 兼容输入；没有新的逐 operation 资格位时一律归一化为 disabled，不能把旧 `true` 解释成 writing/creative/engineering 全 lifecycle。
4. `create_resource` 在 writing 只允许 chapter；Story Bible 创建唯一链路是 describe type -> `create_story_bible`。
5. patch/status/restore 分别强制 current read、type contract、必要引用影响和 fresh revision/checksum。
6. `paid-off` 语义保持 v1.1：至少一个 payoff milestone；缺 `actualPayoffChapterId` 只产生固定 warning code，Schema/session/UI 同源。
7. Story Bible archive 使用普通 status transition，restore 只接受 deleted boundary；outline/timeline singleton 在 schema 和 session 层继续拒绝删除，Agent 不公开物理 purge。
8. 每个 search result 只公开本轮可继续读取的 stable ref；memory/internal-only 命中转换或留作本地 ranking。

**验收**

- Provider-visible 目录恰好一个 Story Bible create 入口。
- 新 catalog 不含 legacy 同义工具或 `manage_path`；历史 catalog 1.0（facade v1/v2）hydrate 仍逐字恢复且不会取得新增 operation。
- writing schema 不再接受普通文件 lifecycle，旧 broad flag 不会自动打开任何新 operation。
- 新 guidance、tool description、Schema、UI 对 `paid-off`、archive/deleted/restore 无冲突。

**Batch 1 门禁与建议提交**

```powershell
npm exec vitest -- run packages/application/test/agent-guidance-registry.test.ts packages/application/test/agent-runtime-facts.test.ts packages/application/test/agent-guidance-budget.test.ts packages/application/test/writing-task-intent.test.ts packages/application/test/agent-context-profile.test.ts packages/application/test/agent-provider-authority-contract.test.ts packages/application/test/agent-untrusted-envelope.test.ts packages/application/test/agent-prompt-materializer.test.ts packages/application/test/agent-run-model-driver.test.ts packages/application/test/agent-external-tool-session.test.ts packages/application/test/agent-run-session.test.ts packages/application/test/agent-plan-execution-session.test.ts packages/application/test/agent-run-draft-session.test.ts packages/application/test/agent-permission-session.test.ts packages/application/test/agent-tool-provider-mapping.test.ts packages/application/test/agent-tool-call-pipeline.test.ts packages/application/test/story-bible-agent-tool-session.test.ts packages/application/test/change-set-session.test.ts packages/application/test/version-group-session.test.ts packages/agent-engine/test/provider-semantic-version-set.test.ts packages/agent-engine/test/approval-rule-registry.test.ts packages/agent-engine/test/approval-decision-proof.test.ts packages/agent-engine/test/approval-binding-v2.test.ts packages/agent-engine/test/transaction-journal.test.ts packages/agent-engine/test/change-set.test.ts packages/agent-engine/test/approval-gate.test.ts packages/agent-engine/test/effective-capability-state.test.ts packages/agent-engine/test/permission-summary.test.ts packages/agent-engine/test/agent-run-tool-catalog.test.ts packages/agent-engine/test/finish-report.test.ts packages/agent-engine/test/agent-run-coordinator.test.ts packages/agent-engine/test/agent-run-draft.test.ts packages/agent-engine/test/plan-artifact.test.ts packages/agent-engine/test/plan-execution.test.ts packages/agent-engine/test/tool-registry.test.ts packages/repository/test/approval-decision-proof-repository.test.ts packages/repository/test/approval-authorization-ledger.test.ts packages/repository/test/agent-write-transaction.test.ts packages/repository/test/agent-run-repository.test.ts packages/schemas/test/story-bible-reference-integrity.test.ts packages/ui/test/agent-composer.test.tsx apps/desktop/test/agent-run-bridge.test.ts packages/llm-adapter/test/openai-compatible-provider.test.ts packages/llm-adapter/test/anthropic-provider.test.ts packages/llm-adapter/test/gemini-provider.test.ts --no-file-parallelism
npm run typecheck
npm run lint
npm run build
npm run test:e2e:built -- apps/desktop/test/agent-permission-plan.e2e.ts
git diff --check
```

另运行 ADR-0004 指定的可信确认 surface/attestation 资格测试；若该表面尚未实现，本批次可以保留请求逐项批准的路径，但 `limited_run_preapproval` 必须保持关闭，不能进入发布证据。

建议提交：

1. `feat(agent): register guidance 3.0 and frozen runtime facts`
2. `feat(agent): unify capability and approval decision proofs`
3. `feat(agent): add non-replayable shared approval binding v2`
4. `fix(agent): enforce one provider authority and safe envelopes`
5. `feat(agent): validate structured completion evidence`
6. `feat(agent): separate Plan mode from execution approval policy`
7. `fix(agent): contain writing schemas and Story Bible creation`

## 8. Batch 2：消息协议 2.0、上下文分享与发送证明

### Task 2.1：升级消息顺序、封套和 canonical round manifest

**新增文件**

- `packages/agent-engine/src/canonical-round-manifest.ts`
- `packages/agent-engine/test/canonical-round-manifest.test.ts`

**修改文件**

- `packages/agent-engine/src/context-snapshot.ts`
- `packages/agent-engine/src/packed-agent-context.ts`
- `packages/agent-engine/src/context-compaction.ts`
- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/test/context-snapshot.test.ts`
- `packages/agent-engine/test/packed-agent-context.test.ts`
- `packages/agent-engine/test/context-compaction.test.ts`
- `packages/application/src/agent-prompt-materializer.ts`
- `packages/application/src/agent-context-session.ts`
- `packages/application/src/agent-conversation-session.ts`
- `packages/application/src/agent-compaction-summary.ts`
- `packages/application/test/agent-context-session.test.ts`
- `packages/application/test/agent-context-session-compaction.test.ts`
- `packages/application/test/agent-conversation-session.test.ts`

**实施步骤**

1. 新初轮顺序固定为 authority/tools -> conventions -> prior summary -> outline -> explicit refs -> active resource -> current user request。
2. start/preview/refresh/exclude/compact/hydrate/Plan-to-Act 使用同一个 materializer 和 `messageOrderVersion=2.0`。
3. control events 使用固定 role/envelope 映射；compaction 保留用户决定和副作用状态，不改变 authority/approval 分类。
4. canonical round manifest 覆盖有序正文、source refs、sharing revision、投影后工具目录和完整 `ProviderSemanticVersionSetV1`/checksum；不得只挑 guidance/message-order/envelope/task-intent 几项。transport secret、requestId、AbortSignal、cache handle 排除。
5. 新 writer 明确写 `ContextSnapshot 2.0`、`Packed Agent Context Manifest 2.0` 和 `Canonical Round Manifest 2.0`，三者绑定同一个 provider version-set checksum；1.4/1.2 只由 legacy reader 恢复且不补写新 authority/sharing。2.0 strict parser 对 unknown kind/version、额外字段、version-set mismatch、role-envelope 不匹配和 source reorder fail closed。

**验收**

- current user request 始终是初轮最后一条真实 user 指令。
- compact/hydrate 后 authority 数量、来源分类、审批状态和顺序不漂移。
- v1 旧 Run 按旧 reader 恢复；v2 不被旧 parser 接受或降级。
- 三种 2.0 writer/reader 都有 unknown-version、额外字段、legacy no-upgrade 和 canonical serializer 测试。
- 任一 Provider-semantic 合同版本或 rule-set checksum 变化都会改变三种 manifest identity。

### Task 2.2：实现 sharing defaults、run grant、JIT 审批和确定性预算

**新增文件**

- `packages/application/src/agent-model-sharing.ts`
- `packages/application/test/agent-model-sharing.test.ts`

**修改文件**

- `apps/desktop/src/main/workspace-context-policy-store.ts`
- `apps/desktop/test/workspace-context-policy-store.test.ts`
- `packages/application/src/agent-context-budget.ts`
- `packages/application/src/agent-context-session.ts`
- `packages/application/test/agent-context-budget.test.ts`
- `packages/application/test/agent-context-session.test.ts`
- `packages/agent-engine/src/context-draft.ts`
- `packages/agent-engine/src/context-budget.ts`
- `packages/agent-engine/test/context-draft.test.ts`
- `packages/agent-engine/test/context-budget.test.ts`

**实施步骤**

1. trust 与 sharing 分离；首次项目内使用必须冻结用户选择，未选择前不发送。
2. defaults 和 run grant 只由 Main/app UI 建立；用户显式 ref 只授权本 Run，项目文本和模型不能开启自动分享。
3. `deny` 的 read-result 类型移除对应工具；`ask` 在执行读取前进入 `awaiting_context_share_approval`，不能先读取再丢弃。
4. 工程 outline 在本地过滤敏感名和 ignored/managed 路径；隐藏项只保留本地计数，不泄露名称或规则。
5. packing 先确定 required/active/pinned/summary/automatic 的最终取舍再调用 Provider。active/pinned 超限时阻止并要求用户处理，不能静默丢弃。
6. defaults/grant revision 进入 preview、snapshot、round identity、budget proof 和 cache identity。

**验收**

- standalone 永不出现项目 sharing 项。
- active/pinned 内容不会静默丢失；automatic 可有界截断且预览说明原因。
- 未授权正文、敏感名称和旧 workspace/profile 内容不进入 spy Provider。
- 超预算 payload 永不到 Provider。

### Task 2.3：首次发送预览、TOCTOU 重验和后续 round 账本

**新增文件**

- `packages/application/src/agent-send-preview-session.ts`
- `packages/application/test/agent-send-preview-session.test.ts`
- `packages/repository/src/agent-send-ledger-repository.ts`
- `packages/repository/test/agent-send-ledger-repository.test.ts`

**修改文件**

- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- `apps/desktop/src/renderer/agent-run-bridge.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/test/desktop-agent-run-runtime.test.ts`
- `apps/desktop/test/agent-run-ipc.test.ts`
- `apps/desktop/test/agent-run-bridge.test.ts`
- `packages/ui/src/agent-conversation-inspector.tsx`
- `packages/ui/src/agent-context-menu.tsx`
- `packages/ui/test/agent-context-menu.test.tsx`

**实施步骤**

1. Main prepare 冻结首轮 semantic payload 与完整 provider version-set checksum，返回 `previewId + canonicalPayloadChecksum`；Renderer 只能确认 opaque binding，不能回传 source body、tool schema 或 policy。
2. Main-only preview record 另绑 request revision、Provider/model/account/adapter policy、tool projection、sharing grant、expiry。
3. UI 展示可展开完整 guidance、runtime facts、准确 tools/schema、最终 source 正文/状态/token、目标连接 label 和 checksum。
4. send 前重验 request、target identity、source、sharing、task intent、capability 和 tools；任一变化返回 `preview_stale` 并重建预览。
5. 后续每 round 保存新增 assistant/tool/JIT/refresh 内容和 checksum；Inspector 以增量账本展示，不把后续内容冒充首轮预览。
6. Provider adapter 保存绑定同一 provider version-set checksum 的 native semantic checksum/serialization proof，但不能替代 canonical binding。

**验收**

- 首次 UI 预览与 spy 捕获的首 round canonical semantic payload 逐字一致。
- 切换 request/Provider/model/account/adapter/source/policy 后旧 preview 必须 stale。
- Renderer 修改显示 DTO、重放 previewId 或伪造 checksum 均不能改变发送内容。
- 后续每 round manifest 与实际请求一致。

### Task 2.4：能力漂移和恢复一致性

**修改文件**

- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-run-model-driver.ts`
- `packages/application/src/agent-prompt-cache.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/application/test/agent-run-model-driver.test.ts`
- `packages/application/test/agent-prompt-cache.test.ts`
- `packages/repository/src/agent-run-repository.ts`
- `packages/repository/test/agent-run-repository.test.ts`
- `apps/desktop/src/main/agent-runtime-manager.ts`
- `apps/desktop/test/agent-runtime-manager.test.ts`

**实施步骤**

1. 每次 Provider round 前比较 frozen capability/tool projection/root/sharing/policy revision；任何缩权或漂移转为 `capability_changed`。
2. 旧 Run 不在原地重物化 3.0 facts 或新增工具；继续执行必须显式 handoff，生成新 snapshot/preview/guidance/catalog。
3. cache identity 加入完整 `ProviderSemanticVersionSetV1` checksum、provider adapter/policy、profile/effective capability/sharing/tool projection；不得以手工列举 guidance/message-order 等部分字段代替完整集合。outline、active resource、request 和 tool result 保持动态层。
4. hydrate 只恢复已持久化、版本已知且交叉不变量成立的 messages/catalog/artifacts；孤立结果不重新发送。

### Task 2.5：记录最小本地运行指标并禁止正文遥测

**修改文件**

- `packages/agent-engine/src/agent-usage-record.ts`
- `packages/agent-engine/src/agent-run-types.ts`
- `packages/agent-engine/test/agent-usage-record.test.ts`
- `packages/application/src/agent-usage-types.ts`
- `packages/application/src/agent-usage-session.ts`
- `packages/application/test/agent-usage-session.test.ts`
- `packages/repository/src/agent-usage-repository.ts`
- `packages/repository/test/agent-usage-repository.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`

**实施步骤**

1. 仅在本地记录 guidance/profile/message-order/catalog 版本、Run/pending/recovery outcome、轮次/工具/审批等待、来源 token/截断、cache 和 Change Set 状态。
2. 文风统计只保存 rule/version/confidence 与用户处理结果，不保存章节或文件正文。
3. API key、secret、绝对路径、用户名、workspace/root identity、Provider 原始请求/响应全文、MCP handle、approval capability 和未选择内容禁止进入遥测或日志。
4. validator 对未知指标版本/枚举 fail closed；旧 usage record 使用旧 reader，不从新 artifact 反推敏感字段。

**验收**

- spy logger/telemetry 测试证明上述敏感值和正文均不存在。
- 本地 Inspector 仍能按 checksum/event ref 解释 Run 状态，但不能反查 Provider secret 或内容全文。

**Batch 2 门禁与建议提交**

```powershell
npm exec vitest -- run packages/agent-engine/test/provider-semantic-version-set.test.ts packages/agent-engine/test/canonical-round-manifest.test.ts packages/agent-engine/test/context-snapshot.test.ts packages/agent-engine/test/packed-agent-context.test.ts packages/agent-engine/test/context-compaction.test.ts packages/agent-engine/test/context-draft.test.ts packages/agent-engine/test/context-budget.test.ts packages/agent-engine/test/agent-usage-record.test.ts packages/application/test/agent-prompt-materializer.test.ts packages/application/test/agent-context-session.test.ts packages/application/test/agent-context-session-compaction.test.ts packages/application/test/agent-conversation-session.test.ts packages/application/test/agent-context-budget.test.ts packages/application/test/agent-model-sharing.test.ts packages/application/test/agent-send-preview-session.test.ts packages/application/test/agent-run-session.test.ts packages/application/test/agent-run-model-driver.test.ts packages/application/test/agent-prompt-cache.test.ts packages/application/test/agent-usage-session.test.ts packages/repository/test/agent-send-ledger-repository.test.ts packages/repository/test/agent-usage-repository.test.ts packages/repository/test/agent-run-repository.test.ts packages/ui/test/agent-context-menu.test.tsx apps/desktop/test/workspace-context-policy-store.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-runtime-manager.test.ts --no-file-parallelism
npm run typecheck
npm run lint
npm run build
npm run test:e2e:built -- apps/desktop/test/agent-context-runtime.e2e.ts
git diff --check
```

建议提交：

1. `feat(agent): add message protocol and envelope v2`
2. `feat(agent): freeze model sharing and deterministic context packing`
3. `feat(agent): bind send preview and round ledger`
4. `fix(agent): stop runs on capability and artifact drift`
5. `feat(agent): record privacy-safe local run metrics`

## 9. Batch 3：工作台命名和能力摘要 UI

### Task 3.1：准确命名工作台和能力摘要

**修改文件**

- `packages/ui/src/workbench-switcher.tsx`
- `packages/ui/src/agent-conversation-inspector.tsx`
- `packages/ui/src/agent-activity-summary.tsx`
- `packages/ui/src/agent-run-panel.tsx`
- `packages/ui/test/workbench-switcher.test.tsx`
- `packages/ui/test/agent-run-panel.test.tsx`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/agent-run-bridge.ts`
- `apps/desktop/test/agent-run-bridge.test.ts`

**实施步骤**

1. 用户可见名称改为“创作工作台 / 写作 / 故事资料 / 项目文件”“创作项目 · 文件模式”和“工程工作区”；内部 enum 暂不迁移。
2. 能力标签从 Permission Summary + final directory 生成，至少区分只读规划、只读执行、需审批提案、有限预授权、Standalone。
3. writing domain 和 engineering file operations 逐项展示；engineering 始终显示“无 Shell/任务/Git”。
4. catalog-time 展示 approval rules；proposal 后展示本组实际 requirement/reason codes。hard-denied 是不可用，不显示成可申请批准。
5. dirty/stale/unknown editor state 在目标级显示阻塞，不保留误导性“可提案”标签。

**Batch 3 门禁与建议提交**

```powershell
npm exec vitest -- run packages/ui/test/agent-composer.test.tsx packages/ui/test/workbench-switcher.test.tsx packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-run-bridge.test.ts --no-file-parallelism
npm run typecheck
npm run lint
npm run build
npm run test:e2e:built -- apps/desktop/test/agent-permission-plan.e2e.ts
git diff --check
```

建议提交：`feat(agent-ui): expose accurate Agent capabilities and workbench labels`

## 10. Batch 4：Writing 领域 CRUD

### Task 4.1：新增章节查询和正式创建路径

**新增文件**

- `packages/application/src/chapter-agent-tool-session.ts`
- `packages/application/src/chapter-ordering.ts`
- `packages/application/src/chapter-order-migration.ts`
- `packages/application/test/chapter-agent-tool-session.test.ts`
- `packages/application/test/chapter-ordering.test.ts`
- `packages/application/test/chapter-order-migration.test.ts`

**修改文件**

- `packages/application/src/project-workspace-session.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/version-group-session.ts`
- `packages/shared/src/chapter.ts`
- `packages/repository/src/chapter-repository.ts`
- `packages/repository/src/history-repository.ts`
- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/test/chapter-repository.test.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`

**实施步骤**

1. 保留现有 UI 使用的 `listChapters()` 行为，另实现内部全状态 catalog 和 Agent `list_chapters(statuses,cursor,limit,includeDeleted)`；默认隐藏 tombstone，显式恢复任务才允许列 deleted。
2. list/read 返回 stable ref、完整 frontmatter projection、effective outline volume、persisted-byte resource revision、body checksum 和 catalog revision；outline 不再冒充完整目录，也不为增加 revision 字段改写章节文件。
3. chapter create 只走正式 ChapterRepository/Application；ID、物理路径、时间、默认 status 和 order 由应用生成。
4. order 在包含 tombstone 的全量章节中保持唯一正整数；连续创建、删末章后创建、恢复都不能重复。
5. 检测 legacy duplicate/invalid order 后保持读取可用，但所有 order-sensitive mutation 返回 `CHAPTER_ORDER_MIGRATION_REQUIRED`；不在 Agent 调用中静默重排历史数据。
6. 提供独立 app-owned migration preview：确定性列出受影响 active/tombstone metadata、outline/history/proof checksum 与 inverse，在用户确认后通过 transaction/version group 原子修复并可恢复；迁移完成前不公开 reorder/restore 等依赖唯一 order 的工具。
7. catalog 2.0 注册 `list_chapters` 和收窄后的 `create_resource(kind=chapter)`；新目录不公开同义 `propose_chapter_create`，但 legacy catalog/internal dispatch 仍可把旧名映射到同一领域 command。目录快照、Provider schema 和 session dispatch 分别测试。
8. chapter create 与 order migration 分别先经 `ChangeSetSession` 冻结 proposal，再由 `VersionGroupSession -> AgentWriteTransaction` 应用；首笔写入前持久化 `RecoveryRepository` 所需完整 metadata/outline/order inverse，失败不得留下半创建章节或半迁移顺序。
9. 所有 writing apply 只消费 Task 1.2b 的 Change Set/Approval Binding/Ledger 2.0 reservation；`approvalBindingV2` 关闭或可信确认来源不可用时可保留只读/提案预览，但不得落盘或标记 Complete，绝不回退旧 token。

**验收**

- 分页/status/tombstone 查询、stable ref 可读性和 stale cursor 有合同测试。
- Agent 创建与手工创建共享同一 repository invariants，不再出现 `order=1` 快捷路径。
- chapter create/migration 的 Change Set、version group、transaction、recovery 和 legacy tool mapping 均有直接合同测试。
- writing approval 跨 Run/revision/version-set/rule-set 重放与旧 token apply 均拒绝。

### Task 4.2：章节 rename/reorder/status/delete/restore 和完整 inverse

**新增文件**

- `packages/agent-engine/src/chapter-status-transition-proof.ts`
- `packages/agent-engine/test/chapter-status-transition-proof.test.ts`
- `packages/repository/src/chapter-write-coordinator.ts`
- `packages/repository/test/chapter-write-coordinator.test.ts`

**修改文件**

- `packages/application/src/chapter-agent-tool-session.ts`
- `packages/application/src/project-workspace-session.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/version-group-session.ts`
- `packages/application/test/chapter-agent-tool-session.test.ts`
- `packages/application/test/change-set-session.test.ts`
- `packages/application/test/version-group-session.test.ts`
- `packages/repository/src/chapter-repository.ts`
- `packages/repository/src/history-repository.ts`
- `packages/repository/test/history-versions.test.ts`
- `packages/repository/src/ports.ts`
- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/test/agent-write-transaction.test.ts`

**实施步骤**

1. `rename_chapter` 只改标题；`reorder_chapter` 只接 stable neighbor refs 和可选 target volume ref，模型不能提交 order/frontmatter 系统字段或物理路径。
2. Story Bible outline 的 `volumes[].chapterIds` 是卷归属真值；chapter `volumeId` 作为同一 consistency group 更新的镜像。无可写 outline 时跨卷工具不公开。
3. archive 是普通状态；delete 才创建 tombstone。delete 保存前状态、完整 metadata revision/checksum、outline revision/checksum、原卷、稳定邻居、引用影响和 version group，并从 active outline 移除 ID，保留 tombstone order。
4. restore 只接受 deleted + 完整 transition proof，恢复证明中的非 deleted 状态和可审阅 reinsertion；outline/邻居变化时生成新预览，不猜位置。
5. 为 ChangeSetSession 增加一次准备 file + domain operation 的原子 mixed proposal batch；正文、metadata、outline、order 和引用不能分成可独立应用的提案。
6. 间隙不足时同组确定性重排非 deleted 章节并避开 tombstone order；跨卷和引用更新任一步失败整体补偿。
7. transition proof 必须进入 Change Set clone/selection/validation、transaction、Version Group 和 history；history/journal 保存认证 metadata + outline membership inverse，旧只含 body 的 history不作为 lifecycle restore 证明。
8. rename/reorder/status/delete/restore 永远 `always_human`；正文/create 仅在注册条件 proof 完整时可有限 auto-review。

**验收**

- 首/尾/中间 reorder、间隙耗尽、跨卷、neighbor stale、重复 delete/restore、proof 损坏和 undo 全覆盖。
- 任何失败不会留下 metadata、order、outline 或引用半更新。
- archive 能普通 transition 离开；restore 不接受 archived。

### Task 4.3：Story Bible proposal proof、两类 dirty editor 与 UI 同步

**新增文件**

- `apps/desktop/src/main/writing-editor-state-registry.ts`
- `apps/desktop/test/writing-editor-state-registry.test.ts`
- `apps/desktop/test/agent-writing-domain.e2e.ts`

**修改文件**

- `packages/application/src/story-bible-agent-tool-session.ts`
- `packages/application/src/story-bible-explicit-inverse-session.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/chapter-editor-session.ts`
- `packages/application/test/chapter-editor-session.test.ts`
- `packages/application/test/story-bible-agent-tool-session.test.ts`
- `packages/application/test/story-bible-explicit-inverse-session.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/chapter-editor-bridge.ts`
- `apps/desktop/src/renderer/story-bible-bridge.ts`
- `apps/desktop/test/agent-write-editor-sync.test.ts`
- `apps/desktop/test/story-bible-draft-guard.test.ts`

**实施步骤**

1. Story Bible create/patch proof 绑定字段/relations 数量、总字节、引用影响和状态边界；有引用影响、未知或超阈值一律人工。
2. chapter/Story Bible editor 分别向 Main 报 workspace/resource/editor instance、单调 revision/ack、dirty 和 buffer checksum；断连或未知状态返回 `EDITOR_STATE_UNKNOWN`。
3. planning 及 analysis/brainstorm 等非 mutation intent 可把带 app-owned revision 的 dirty buffer 作为 `editor_buffer` 数据启动，并同时区分持久化磁盘版本；dirty buffer 永远不能直接成为 mutation base。
4. 已知 execution target/引用依赖在第一次 Provider 调用前要求保存、放弃或取消；处理后重读并重建 snapshot/proposal/approval。
5. 迟发现或运行中变 dirty 返回 `TARGET_DIRTY`，不自动 rebase、merge 或盲重试。
6. apply/rollback/undo/startup recovery commit 后刷新 chapter list、title/order/status/selection、Story Bible outline、普通创作文件 tree 和 editor；dirty buffer 保留并进入 conflict/recovery UI。

**Batch 4 门禁与建议提交**

```powershell
npm exec vitest -- run packages/application/test/agent-run-session.test.ts packages/application/test/chapter-agent-tool-session.test.ts packages/application/test/chapter-ordering.test.ts packages/application/test/chapter-order-migration.test.ts packages/application/test/chapter-editor-session.test.ts packages/application/test/story-bible-agent-tool-session.test.ts packages/application/test/story-bible-explicit-inverse-session.test.ts packages/application/test/change-set-session.test.ts packages/application/test/version-group-session.test.ts packages/repository/test/chapter-repository.test.ts packages/repository/test/history-versions.test.ts packages/repository/test/chapter-write-coordinator.test.ts packages/repository/test/agent-write-transaction.test.ts packages/repository/test/approval-authorization-ledger.test.ts packages/agent-engine/test/approval-binding-v2.test.ts packages/agent-engine/test/change-set.test.ts packages/agent-engine/test/approval-gate.test.ts packages/agent-engine/test/chapter-status-transition-proof.test.ts packages/agent-engine/test/tool-registry.test.ts apps/desktop/test/writing-editor-state-registry.test.ts apps/desktop/test/agent-write-editor-sync.test.ts apps/desktop/test/story-bible-draft-guard.test.ts --no-file-parallelism
npm run schema:story-bible
$storyBibleSchemaDiffBefore = (git diff --binary -- packages/schemas/schema | Out-String)
npm run schema:story-bible
$storyBibleSchemaDiffAfter = (git diff --binary -- packages/schemas/schema | Out-String)
if ($storyBibleSchemaDiffBefore -ne $storyBibleSchemaDiffAfter) { throw "Story Bible schema generation is not stable." }
npm run test:contract
npm run typecheck
npm run lint
npm run build
# 这两个审批/写作 journey 只允许在 ADR-0004 资格化、由 Authenticode 覆盖的真实包中运行；
# 普通 Playwright 配置显式排除它们，禁止用 development Electron/Renderer 注入替代可信表面。
$env:NOVEL_STUDIO_QUALIFIED_PACKAGE_EXE = "<qualified-package-dir>\Novel Studio.exe"
npm run test:e2e:packaged -- --workers=1
git diff --check
```

建议提交：

1. `feat(writing): add chapter query and repository-backed creation`
2. `feat(writing): add reviewed chapter lifecycle and ordering`
3. `feat(writing): guard managed editors and synchronize domain changes`

## 11. Batch 5：creative_general 与文风规则 2.0

### Task 5.1：资格化普通文本 replacement 与完整 lifecycle

**修改文件**

- `packages/application/src/creative-project-file-session.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/agent-engine/src/agent-tool-capabilities.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/test/creative-project-file-session.test.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `packages/repository/src/trusted-creative-file-operations.ts`
- `packages/repository/src/agent-project-search-repository.ts`
- `packages/repository/test/agent-file-operation-race.test.ts`
- `apps/desktop/src/main/agent-feature-flags.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/renderer/creative-project-files-bridge.ts`
- `apps/desktop/src/renderer/plain-file-editor-bridge.ts`
- `apps/desktop/test/plain-file-editor-bridge.test.ts`
- `apps/desktop/test/agent-write.e2e.ts`

**实施步骤**

1. `creative_general` 只接受项目 policy 允许的普通 UTF-8 文本 `file:` ref；managed chapter/Story Bible/app-state 路径在 schema 和后端双重拒绝。
2. 生产 capability 从当前 bundled `phaseB_fileLifecycleEnabled` 迁移为逐 operation gates；资格顺序先 replacement，再分别开放 create/move/delete，旧 broad flag 不再自动开放任何 operation。Batch 5 完成时四项必须全部通过，过程中未通过项保持 fail closed。
3. replacement 绑定 Main 重读的 clean base checksum、selection/replacement 和 candidate checksum；dirty/stale/target race 生成新预览，不覆盖。
4. 只有被选择分享或被解析为写入目标的 dirty 普通文件在 start 前要求保存/放弃/取消；未分享且无关的 dirty 文件不阻止只读运行。处理后由 Main 重读，Renderer buffer 不作为 base。
5. 保持格式、缩进、EOL 和未修改区域，只提交请求所需最小 replacement；完整 apply/readback 后才报告已写入。
6. 文件系统 search 只发可由 `read_resource` 继续读取的 `file:` ref；writing 的不可读 `memory:` 命中不进入 Provider result。
7. create/move/delete 各自建立独立 capability/测试/evidence，Provider 名称固定为 `create_resource(kind=file)`、`propose_file_move`、`propose_file_delete`，不复活宽泛 `manage_path`。每项绑定 exact base/absence/source/destination proof、共享 v2 approval reservation、transaction/recovery、undo 和 editor/tree sync；未通过者保持关闭，但缺少任一项都不能结束本计划或标记 Agent Core Complete。
8. `trusted_creative` 的安全描述保持现有边界，不宣传为抵御恶意同用户路径竞态的 hardened native。
9. catalog 2.0 snapshot 精确断言 creative replacement 使用 `edit_text(file:)`；同一目录不存在 `propose_file_write`/`manage_path` 或其他 legacy 同义入口，未资格化 lifecycle 名称完全缺席。
10. creative replacement/lifecycle apply 只消费 Task 1.2b 的共享 v2 approval reservation；binding flag 或可信确认来源不可用时保持只读/提案预览，不得回退旧 token。

**验收**

- list/read/search/replace/create/move/delete 在真实 Desktop 生产接线和安装包 E2E 通过；managed path、project switch、dirty/stale、symlink/reparse 和竞态 fail closed。
- replacement 与全部 lifecycle operation 具备 Change Set、审批、version group、transaction/recovery、undo 和 editor sync。
- catalog exact-name/no-legacy-synonym 测试在逐项开放 lifecycle 时持续通过，最终目录包含且只包含已完成资格的四项 mutation。

### Task 5.2：实现 task intent 与 diff-aware 文风检测

**新增文件**

- `packages/application/src/ai-writing-style-evaluator.ts`
- `packages/application/test/fixtures/writing-style-corpus.json`
- `packages/application/test/fixtures/writing-style-corpus-manifest.json`
- `packages/application/test/fixtures/writing-style-annotation-rubric.md`
- `packages/application/test/ai-writing-style-evaluator.test.ts`

**修改文件**

- `packages/application/src/ai-writing-style-rules.ts`
- `packages/application/src/agent-guidance-registry.ts`
- `packages/application/src/agent-prompt-materializer.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-prompt-cache.ts`
- `packages/application/test/agent-guidance-registry.test.ts`
- `packages/application/test/agent-guidance-budget.test.ts`
- `packages/application/test/agent-prompt-materializer.test.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/application/test/agent-prompt-cache.test.ts`
- `packages/agent-engine/test/provider-semantic-version-set.test.ts`
- `packages/agent-engine/test/canonical-round-manifest.test.ts`
- `packages/ui/src/change-set-review.tsx`
- `packages/ui/test/change-set-review.test.tsx`

**实施步骤**

1. system 只保留默认原则；本任务首次在 registry 注册不可变 generation fragment `2.0`，仅在 frozen `WritingTaskIntent.bodyGeneration=true` 时进入动态层。注册前的 Artifact 一律为 `not_applicable`；注册后 fragment version 通过同一 `ProviderSemanticVersionSetV1` checksum 进入 Prompt Artifact、materialized proof、canonical round manifest、cache identity 和 budget proof，hydrate 不按当前规则重新选择，也不修改已冻结 2.0 正文。
2. `冷冷`、`压下去` 裸短语为 guidance-only；其他情绪套语单次低置信不计可见 hit，重复/聚集才提高。
3. baseline/candidate 使用同一 rule version，结果按 diff 分为 introduced/pre-existing；默认折叠 pre-existing。
4. offset 使用 UTF-16 start/end，另算 1-based line/column 和 grapheme-safe excerpt；不把 code unit 标成“字”。
5. AI writing workflow 和 Agent chapter Change Set 共用 evaluator；提醒不自动替换、不阻断保存或审批。
6. 建立版本化 annotation rubric 和至少 200 条人工标注语料，仅使用合成/明确许可/可再分发内容，不使用用户项目正文。每条由两名独立人工标注者标出 rule/span/confidence/rationale，分歧由 product/editorial quality owner 在不知道规则输出的情况下裁决。
7. corpus manifest 冻结 rubric/corpus/rule version、样例/gold-label checksum、development/qualification split、固定 negative set、匹配算法版本和 quality owner sign-off；qualification split 不参与调参。CI 仅以该 split 的 medium/high 结果计算 precision，`>=90%` 且固定负例零误报后才可签发发布资格；任何语料、标签、规则或匹配算法变化都生成新版本并重跑。

**验收**

- 每个 gold sample 都有两份原始人工标注或可审计的一致结论，以及必要的盲审裁决记录；manifest checksum 可复现。
- release evidence 记录 corpus/rubric/rule/matcher 版本、precision 分子分母、fixed-negative false positives 和 quality owner 结论。
- 复审四 profile 最大正文快照；writing 仍 `<=1200`、其余 profile `<=900`，fragment/version-set 变化同步使 artifact/round/cache identity 改变。

**Batch 5 门禁与建议提交**

```powershell
npm exec vitest -- run packages/application/test/creative-project-file-session.test.ts packages/application/test/agent-file-operation-session.test.ts packages/application/test/agent-guidance-registry.test.ts packages/application/test/agent-guidance-budget.test.ts packages/application/test/agent-prompt-materializer.test.ts packages/application/test/agent-run-session.test.ts packages/application/test/agent-prompt-cache.test.ts packages/application/test/ai-writing-style-evaluator.test.ts packages/agent-engine/test/provider-semantic-version-set.test.ts packages/agent-engine/test/canonical-round-manifest.test.ts packages/agent-engine/test/approval-binding-v2.test.ts packages/agent-engine/test/change-set.test.ts packages/agent-engine/test/approval-gate.test.ts packages/agent-engine/test/tool-registry.test.ts packages/repository/test/approval-authorization-ledger.test.ts packages/repository/test/agent-file-operation-race.test.ts packages/ui/test/change-set-review.test.tsx apps/desktop/test/plain-file-editor-bridge.test.ts --no-file-parallelism
npm run typecheck
npm run lint
npm run build
npm run test:e2e:built -- apps/desktop/test/agent-write.e2e.ts apps/desktop/test/creative-project-files.e2e.ts apps/desktop/test/ai-writing-workflow.e2e.ts
git diff --check
```

建议提交：

1. `feat(agent): qualify trusted creative text lifecycle`
2. `feat(writing): add task-scoped diff-aware style guidance`

## 12. Batch 6：Engineering hardened access、索引与当前文件

### Task 6.1：实现单一 native addon 的 access 与后续 mutation/recovery primitives

**新增文件**

- ADR-0003 指定的 native host/source/build/probe 文件
- `.github/workflows/engineering-file-access-native.yml`
- `packages/agent-engine/src/canonical-leaf-name.ts`
- `packages/agent-engine/src/engineering-path-policy.ts`
- `packages/agent-engine/test/canonical-leaf-name.test.ts`
- `packages/agent-engine/test/engineering-path-policy.test.ts`
- `packages/repository/src/engineering-workspace-access-port.ts`
- `packages/repository/test/engineering-workspace-access-port.test.ts`
- `apps/desktop/src/main/engineering-workspace-access-runtime.ts`
- `apps/desktop/test/engineering-workspace-access-runtime.test.ts`

**修改文件**

- `packages/repository/src/engineering-workspace-repository.ts`
- `packages/repository/src/no-follow-file-operations.ts`
- `packages/repository/src/index.ts`
- `apps/desktop/src/main/application-composition.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/electron-builder.config.cjs`
- `scripts/package-check.mjs`
- ADR 指定的构建/签名文件
- `.github/workflows/ci.yml`

**实施步骤**

1. Main 打开 root handle 并冻结 rootBindingId、volume/device、directory identity、canonical path identity 和 workspace kind；root 替换立即 `ROOT_CHANGED/capability_changed`。
2. list/open/read 逐段 root-relative 遍历，只接受 workspace policy 允许、默认不超过 5 MiB 的普通 UTF-8/UTF-8 BOM 文本；拒绝 symlink/junction/mount/reparse、二进制/超限/稀疏特殊文件、hard-denied 和根外对象，不先 realpath 后用 pathname API 读取。
3. `CanonicalLeafName` 统一用于 schema/proposal/access/mutation/UI：NFC、长度、控制/bidi/format、路径分隔、ADS、设备/保留名、尾随点空格和 collision 均严格处理。
4. 路径分类固定 deny-first：hard_denied > policy_managed > ignored_generated > ordinary；source/target/祖先/操作后名称都检查。
5. `.git` 节点及后代、app state/journal/recovery namespace、真实 secret/private-key 类对象为 hard-denied，任何项目文本或普通 UI grant 都不能覆盖；命中仅产生稳定错误码/本地计数，不向 Provider 泄露名称或规则。
6. `AGENTS.md`、`.gitignore` 等 policy-managed 默认只读；若产品明确允许编辑，只能在用户显式目标下生成独立、始终人工审批的精确 Change Set，应用后终止旧 Run 并重新派生能力。ignored-generated 仅接受 Main UI 的本 Run 精确路径 grant，且 mutation 始终人工。
7. access snapshot/snippet/ref 绑定 root/policy revision；发送前重验，stale index 清空，不能泄露已变 hard-denied 的名称/正文。
8. 资格 probe 同时覆盖 Windows reparse 和 POSIX symlink；只有实际支持平台通过才生成 `hardened_native`。
9. access、mutation、receipt 与 recovery primitives 共用 ADR-0003 的唯一 addon/source/CMake/manifest/sign/probe 路径。可以在本任务提前实现并测试后续 primitive，但 Batch 6 attestation 只授予 root/access/read/index；任何 mutation flag、tool、runtime fact 和 UI 仍保持关闭。
10. `.github/workflows/engineering-file-access-native.yml` 在 `windows-latest` 构建唯一 addon，记录 runner/toolchain/Node-API/source identity，运行 ABI/load、正向保护、故意关闭保护的负对照和 fault probe，并上传 `.node`、manifest、SHA-256 与 probe report。开发机可以只下载校验后的 artifact，不要求安装本地 C++ 工具链。
11. 未签名 CI artifact 不能产生 production attestation。正式资格仍以安装包内 digest、Authenticode publisher、detached CMS、owner trust store 与 packaged probe 为准；任何 access/mutation/recovery source 变化都重建同一 artifact 并重跑完整 probe。

**验收**

- 安装包正/负 probe 覆盖 root replacement、nested reparse/symlink、ADS/device/UNC、hard link、special file 和 stale index，断言零根外读取/名称泄露。
- pathname repository 只作迁移参考/普通 UI 后端，不可注入 Agent hardened capability。
- Windows CI artifact 的 source/toolchain/manifest/probe identity 可复现；本机下载产物与 CI SHA-256 不一致时拒绝加载，且未签名产物始终保持 production capability off。

### Task 6.2：迁移工程 list/read/search/index 到同一 access port

**修改文件**

- `packages/application/src/engineering-workspace-session.ts`
- `packages/application/src/agent-search-tool-session.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/test/engineering-workspace-session.test.ts`
- `packages/application/test/agent-search-tool-session.test.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/repository/src/agent-project-read-repository.ts`
- `packages/repository/src/agent-project-search-repository.ts`
- `packages/repository/src/workspace-outline-index-repository.ts`
- `packages/repository/test/agent-project-read-repository.test.ts`
- `packages/repository/test/agent-project-search-repository.test.ts`
- `packages/repository/test/workspace-outline-index-repository.test.ts`
- `apps/desktop/test/engineering-agent-runtime.test.ts`

**实施步骤**

1. engineering outline、list、read、search、index 只消费 access port 签发的 root/policy-bound snapshot/ref。
2. Provider ref 只暴露 app-owned opaque identity 和必要 relative label；绝对路径/root identity 不进入 schema、result 或错误。
3. search 命中在返回前重验可读性；internal-only/hidden 命中只作本地 ranking/count。
4. access attestation 不可用时工程 Agent 明确只读受限或 unavailable；不 fallback 旧 reader 继续声称 hardened。

### Task 6.3：工程当前文件、sharing 和 editor state registry

**新增文件**

- `apps/desktop/src/main/engineering-editor-state-registry.ts`
- `apps/desktop/test/engineering-editor-state-registry.test.ts`

**修改文件**

- `apps/desktop/src/renderer/workspace-file-editor-runtime.ts`
- `apps/desktop/src/renderer/plain-file-editor-bridge.ts`
- `apps/desktop/src/renderer/agent-run-bridge.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- `apps/desktop/test/workspace-file-editor-runtime.test.tsx`
- `apps/desktop/test/plain-file-editor-bridge.test.ts`
- `apps/desktop/test/agent-context-runtime.e2e.ts`

**实施步骤**

1. activeResource automatic 或 run explicit grant 时，Main 经 hardened reader 冻结已保存当前文件；active=off 时不读取/物化。
2. 被选择分享的 dirty 文件在 start 前要求保存/放弃/取消；未分享且非目标 dirty 文件不阻止只读 Run。
3. 当前文件属于动态 context/cache suffix；外部 checksum 变化进入 `context_stale`。
4. registry 以 rootBindingId + relative identity + editor instance + monotonic revision/ack 记录 open/dirty/buffer checksum；Renderer 断连/未知状态对 mutation fail closed。
5. dirty buffer 只作显式可分享读取数据，第一版不作为 mutation base。

**Batch 6 门禁与建议提交**

```powershell
npm exec vitest -- run packages/repository/test/engineering-workspace-access-port.test.ts packages/repository/test/agent-project-read-repository.test.ts packages/repository/test/agent-project-search-repository.test.ts packages/repository/test/workspace-outline-index-repository.test.ts packages/agent-engine/test/canonical-leaf-name.test.ts packages/agent-engine/test/engineering-path-policy.test.ts packages/application/test/engineering-workspace-session.test.ts packages/application/test/agent-search-tool-session.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/engineering-workspace-access-runtime.test.ts apps/desktop/test/engineering-editor-state-registry.test.ts apps/desktop/test/engineering-agent-runtime.test.ts apps/desktop/test/workspace-file-editor-runtime.test.tsx apps/desktop/test/plain-file-editor-bridge.test.ts --no-file-parallelism
npm run typecheck
npm run lint
npm run package:check
npm run package:dir:built
npm run test:e2e:built -- apps/desktop/test/agent-context-runtime.e2e.ts
git diff --check
```

另运行 ADR 指定的 packaged black-box access qualification 命令和负对照。任一平台未通过时，该平台保持 engineering read-only，不能进入 Batch 7 发布资格。

native source 可以从专用 Windows CI 构建并下载实际 artifact；本地 Visual Studio/Build Tools 不是门禁。无论产物在本机还是 CI 构建，package/probe/签名/manifest 资格完全相同。

建议提交：

1. `feat(engineering): add qualified root-handle workspace access`
2. `feat(engineering): route Agent discovery through hardened access`
3. `feat(engineering): bind current file sharing and editor state`

## 13. Batch 7：Engineering mutation V2 与 replace/create

### Task 7.1：将 Engineering proposals 接入共享审批 v2

**修改文件**

- `packages/agent-engine/test/approval-binding-v2.test.ts`
- `packages/repository/test/approval-authorization-ledger.test.ts`
- `packages/application/src/agent-write-authorization.ts`
- `packages/application/src/change-set-session.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/test/change-set-session.test.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/test/engineering-agent-runtime.test.ts`

**实施步骤**

1. Engineering proposal 只消费 Task 1.2b 的 Change Set 2.0、Approval Binding 2.0 和 Authorization Ledger 2.0；不得创建工程专用 apply token，也不得回退 deterministic `approvalToken`。
2. 把 root binding、raw-byte before/absence/candidate manifest、operation order、rule/proof、policy/capability revision 和 provider version-set checksum接入共享 binding/ledger；任一变化使提案或授权 stale。
3. 首次 replace/create 仍逐 Change Set 人工确认；`user_preapproved_run` 只有在 Task 1.2/1.5 的 rule proof 和可信确认来源同时合格后才可能签发共享 capability。
4. 工程 runtime/IPC 只接收 Renderer 的 approve/reject 与 display binding，不向 Renderer 或 Provider暴露 capability、ledger reservation、root identity 或 WAL handle。

**验收**

- Engineering 的 display checksum、Main-only capability、reserve/consume/revoke 和 legacy-token拒绝与 writing/creative 使用同一合同与 repository。
- 跨 root/Run/revision/version-set/rule-set 的授权重放全部拒绝。
- ADR-0004 或共享审批核心不可用时 engineering mutation apply 关闭，不 fallback。

### Task 7.2：实现 raw-byte EngineeringFileMutationPortV2 和事务 manifest

**新增文件**

- `packages/repository/src/engineering-file-mutation-port-v2.ts`
- `packages/repository/src/engineering-mutation-receipt.ts`
- `packages/repository/src/engineering-mutation-blob-store.ts`
- `packages/repository/src/engineering-write-transaction-v2.ts`
- `packages/repository/src/engineering-wal-repository.ts`
- `packages/repository/src/engineering-recovery-gate.ts`
- `packages/repository/test/engineering-file-mutation-port-v2.test.ts`
- `packages/repository/test/engineering-mutation-receipt.test.ts`
- `packages/repository/test/engineering-mutation-blob-store.test.ts`
- `packages/repository/test/engineering-write-transaction-v2.test.ts`
- `packages/repository/test/engineering-wal-repository.test.ts`
- `packages/repository/test/engineering-recovery-gate.test.ts`
- `apps/desktop/src/main/engineering-recovery-runtime.ts`
- `apps/desktop/test/engineering-recovery-runtime.test.ts`
- 扩展 Task 6.1 同一 addon/source stream 的 mutation/receipt/recovery exports 与 probe cases

**修改文件**

- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/src/no-follow-file-operations.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/test/agent-write-transaction.test.ts`
- `packages/repository/test/agent-file-operation-race.test.ts`
- `apps/desktop/src/main/application-composition.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/ipc-handlers.ts`

**实施步骤**

1. V2 输入绑定 content root、tx/op、before/after raw-byte manifest、不可变 candidate/before blob、预分配 staging/recovery object；delete 的 recovery root 留给 Batch 8。
2. manifest 保存 bytes SHA-256、size、encoding/BOM/EOL、identity 和必要 metadata；JS string/void legacy port 永远不能取得 engineering 资格。
3. native 在 Task 6.1 的同一 addon/root-handle session 内完成 handle-relative revalidation + mutation，返回绑定 root/tx/op/observed before/after/durability 的 receipt；不得创建第二个 native host、构建链或 probe harness，外层验证 receipt 后才推进 Engineering V2 Journal。
4. 复用共享 Change Set、Approval Binding/Ledger、runtime/session、Version Group、save coordinator 和 editor/tree/index sync；仅 Engineering V2 Journal、raw-byte receipt/blob/staging/WAL/recovery schema、repository 与 strict parser 保持独立，不复用 writing/creative journal。Engineering V2 Journal writer 固定 `schemaVersion: "2.0"` 并绑定 Change Set/approval ledger 的同一 `providerSemanticVersionSetChecksum`，unknown/mismatch 拒绝，legacy journal 只由 legacy recovery reader 处理且不能迁移后继续 apply。prepared record、blob、staging ID 和 inverse 在首笔 mutation 前 durable，步骤顺序固定为文件/目录 flush -> receipt/after 验证 -> progress record flush。
5. replace 保留 BOM、EOL、逐字节未修改区域和已资格化 metadata；已有多 hard-link 叶节点默认拒绝，或仅使用另行资格化的 copy-on-replace 切断别名，绝不原地改外部 alias。create 使用固定安全 metadata，不接收 mode/owner。
6. commit marker 前重验完整 after manifest；外部新编辑导致 neither/unknown 时零覆盖进入 recovery review。
7. 测试每个 blob/WAL/staging/rename/receipt/progress/commit 崩溃点，不能把多文件称作文件系统原子写。
8. 在任何 engineering mutation 工具可见前实现 root-bound 全 workspace recovery gate：启动时枚举该 content root 的 v2/legacy WAL、recovery record、blob/staging 和孤立 reservation；prepared/unknown/无法认证/根不可用时整根 mutation unavailable，旧 WAL 只走对应 legacy reader，不能被新事务接管。
9. gate 状态由 Main runtime 持有并进入 capability revision；Renderer/模型不能解除。只读浏览可带恢复状态继续，replace/create apply 必须在 gate clear 且同一 root lease 有效时开始。

**验收**

- clean root 可进入 replace/create preflight；prepared、unknown、orphan、legacy mismatch 或 root unavailable 均在零新写入时阻止整个 root。
- startup scan、gate state、capability flag 和工具目录一致；重启不能在 recovery 未解决时重新公开 mutation。

### Task 7.3：逐项开放 replace/create 工具

**修改文件**

- `packages/agent-engine/src/agent-tool-capabilities.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `packages/application/src/agent-run-session.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/test/agent-run-session.test.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/renderer/workspace-file-editor-runtime.ts`
- `apps/desktop/src/renderer/plain-file-editor-bridge.ts`
- `apps/desktop/test/engineering-agent-runtime.test.ts`
- `apps/desktop/test/agent-write-save-coordinator.test.ts`
- `apps/desktop/test/agent-write-editor-sync.test.ts`
- `apps/desktop/test/workspace-file-editor-runtime.test.tsx`
- `apps/desktop/test/plain-file-editor-bridge.test.ts`
- `packages/ui/src/change-set-review.tsx`
- `packages/ui/test/change-set-review.test.tsx`

**实施步骤**

1. engineering schema 公开 effect-specific `propose_file_write` 和 `propose_file_create`；只接受 app-owned file/parent ref、单段名称和有界 replacement/candidate。
2. replace 由 Main 刚读取 raw bytes 并绑定 base/candidate/BOM/EOL；create 绑定同一 native 边界签发的 absence proof且严格 create-only。
3. provider 参数禁止 absolute/root/cwd/glob/recursive/force/overwrite/token/journal/quarantine/Shell/Git。
4. 首次发布 replace/create 的当前 rule-set 全人工；独立 auto-review 资格完成后注册新的不可变 rule-set version，才把对应 operation 映射到 `ordinary_clean_file_replace_v1`/`ordinary_create_only_v1`。不得原地修改旧 version；旧 Run 转为 `capability_changed`。
5. policy-managed/ignored-generated grant/未知/混合组始终人工；hard-denied 不生成 Change Set。
6. 同一 toolCallId 只有相同 canonical payload 可幂等查询；参数变化返回稳定 conflict。
7. 每次 replace/create 在首笔写前重验 Task 7.2 的 workspace recovery gate，获取 root-bound 独占 lease，使用现有 `AgentWriteSaveCoordinator` pause/drain 该 root 的 save/autosave，并检查全部触及路径 editor state；dirty/unknown/disconnected 或 lease/gate 变化均零写入停止。
8. commit/rollback/recovery 后刷新目标 editor、workspace tree 和 index；replace 保留 clean editor selection/scroll，create 显示新节点。同步失败不得把磁盘成功伪装成未执行，但必须进入可恢复的 `sync_required` 状态并阻止下一 mutation。

**验收**

- replace/create 的 startup recovery、root lease、save/autosave race、dirty/unknown editor、commit 后同步和 crash resume 有直接测试与 packaged E2E。
- recovery gate、lease 或 save coordinator 未资格化时 flags/tools/facts/UI 同时关闭，不能仅依赖 Batch 8 后续补齐。

**Batch 7 门禁与建议提交**

```powershell
npm exec vitest -- run packages/agent-engine/test/approval-binding-v2.test.ts packages/agent-engine/test/transaction-journal.test.ts packages/agent-engine/test/change-set.test.ts packages/agent-engine/test/approval-gate.test.ts packages/agent-engine/test/tool-registry.test.ts packages/repository/test/approval-authorization-ledger.test.ts packages/repository/test/engineering-file-mutation-port-v2.test.ts packages/repository/test/engineering-mutation-receipt.test.ts packages/repository/test/engineering-mutation-blob-store.test.ts packages/repository/test/engineering-write-transaction-v2.test.ts packages/repository/test/engineering-wal-repository.test.ts packages/repository/test/engineering-recovery-gate.test.ts packages/repository/test/agent-write-transaction.test.ts packages/repository/test/agent-file-operation-race.test.ts packages/application/test/change-set-session.test.ts packages/application/test/version-group-session.test.ts packages/application/test/agent-run-session.test.ts packages/application/test/agent-file-operation-session.test.ts apps/desktop/test/engineering-recovery-runtime.test.ts apps/desktop/test/engineering-agent-runtime.test.ts apps/desktop/test/agent-write-save-coordinator.test.ts apps/desktop/test/agent-write-editor-sync.test.ts apps/desktop/test/workspace-file-editor-runtime.test.tsx apps/desktop/test/plain-file-editor-bridge.test.ts packages/ui/test/change-set-review.test.tsx --no-file-parallelism
npm run typecheck
npm run lint
npm run package:check
npm run package:dir:built
git diff --check
```

另运行 ADR 指定的 packaged mutation V2 正/负 qualification、raw-byte/BOM/EOL、reparse race、startup recovery、save/autosave 竞争、editor sync 和 receipt fault injection。失败时关闭 replace/create，不 fallback。

建议提交：

1. `feat(engineering): bind proposals to shared approval v2`
2. `feat(engineering): add raw-byte mutation receipts and durable manifests`
3. `feat(engineering): qualify reviewed file replace and create`

## 14. Batch 8：Engineering move/delete、恢复门禁与同步

### Task 8.1：实现 move/rename 和 case-only 两步恢复

**修改文件**

- `packages/repository/src/engineering-file-mutation-port-v2.ts`
- 扩展 Task 6.1 同一 addon/source stream 的 move/case-rename exports 与 probe cases
- `packages/repository/test/engineering-file-mutation-port-v2.test.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `packages/agent-engine/src/tool-registry.ts`
- `packages/agent-engine/test/tool-registry.test.ts`
- `apps/desktop/test/engineering-agent-runtime.test.ts`

**实施步骤**

1. `propose_file_move` 只接受 sourceRef + targetParentRef + canonical targetName；绑定 source identity/hash 与 destination `absent | same_object_case_only` proof。
2. 普通 move 同根同卷、no overwrite；重复/祖先冲突、alias、循环、跨卷、Unicode-normalization-only rename 拒绝。
3. case-only 仅同父目录、collision key 相同且 destination handle identity 等于 source；使用 WAL 预分配唯一中间名，两次 rename 每个崩溃点可恢复。
4. move 永远人工审批；source/target/祖先/策略/editor 任一变化使旧 proof/approval stale。
5. move/case-only 继续受 Task 7 的 root recovery gate、独占 lease 和 save coordinator 保护；任一中间崩溃记录在恢复完成前阻止整个 root 的后续 mutation。move flag 只在本 Batch 8 全部门禁完成后启用。

### Task 8.2：实现 VolumeLocalRecoveryBinding、delete 和 restore review

**新增文件**

- `packages/repository/src/volume-local-recovery-binding.ts`
- `packages/repository/src/engineering-recovery-root-repository.ts`
- `packages/repository/test/volume-local-recovery-binding.test.ts`
- `packages/repository/test/engineering-recovery-root-repository.test.ts`

**修改文件**

- `packages/agent-engine/src/approval-binding-v2.ts`
- `packages/agent-engine/test/approval-binding-v2.test.ts`
- `packages/repository/src/engineering-file-mutation-port-v2.ts`
- `packages/repository/src/engineering-recovery-gate.ts`
- `packages/repository/test/engineering-recovery-gate.test.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/test/agent-write-transaction.test.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/engineering-recovery-runtime.ts`
- `apps/desktop/test/engineering-recovery-runtime.test.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/preload/api.ts`
- `apps/desktop/src/preload/index.cts`
- `apps/desktop/src/renderer/agent-run-bridge.ts`
- `packages/ui/src/recovery-review.tsx`
- `packages/ui/test/recovery-review.test.tsx`

**实施步骤**

1. delete 工具仅在 Task 7 的 workspace recovery gate clear，且 content root 同卷存在独立授权、identity-disjoint、app-owned recovery root handle 时公开；父目录可写不是第二根授权。
2. 扩展既有 gate 校验 volume-local recovery authority、容量、manifest/孤儿状态。recovery binding 冻结 root ID、volume/device、directory identity、grant/authority revision、ownership marker 和 ACL/mode qualification，并进入 approval side-effect preview、Engineering V2 Journal record、native input 和 receipt；delete Approval Binding 2.0 强制绑定 `recoveryRootBindingId + recoveryGrantRevision + recoverySideEffectChecksum` 与既有 provider version-set checksum，任一缺失/变化要求重审批。
3. delete 语义是原子移动到同卷 quarantine，不 unlink；Provider 无法列出、寻址、restore 或 purge quarantine。
4. Engineering V2 global record 与 volume-local object manifest 双向绑定并扫描孤儿；二者都属于 Engineering V2 Journal，capacity/retention/pin 可审计，未完成 recovery/undo window 内不可 purge。
5. restore 仅在原路径仍允许且不存在时生成用户预览；冲突/策略变化不覆盖。永久 purge 只属独立本地用户操作或到期策略。
6. 受信 UI 显示用户可识别的 recovery storage label、authority/grant 状态、容量和保留期。当 app `stateRoot` 与 content root 不同卷时，安装程序预配置位置或用户通过独立 OS 目录授权选择的位置仍必须位于 content root 所在卷；“跨卷”只表示它相对 app `stateRoot` 的位置，绝不允许 quarantine 与 content root 跨卷。实际路径、handle 和 quarantine object 不进入 Provider 或 Renderer 可编辑状态。
7. move/delete 始终人工；“替我审批”不扩大 recovery root、path 或 sharing grant。

**验收**

- 覆盖 state/content 同卷、两者跨卷时 content volume 有/无明确第二根授权、错误选择与 content root 跨卷的 recovery root、grant 撤销、根祖先关系、namespace 预占/reparse、marker/ACL mismatch、双写各崩溃点和 restore conflict。
- quarantine 不可用时 delete 工具、facts 和 UI 全部不可用。

### Task 8.3：扩展 workspace recovery gate、实现多文件 compensation 和完整同步

**修改文件**

- `packages/repository/src/agent-write-transaction.ts`
- `packages/repository/src/recovery-repository.ts`
- `packages/repository/src/engineering-recovery-gate.ts`
- `packages/repository/test/engineering-recovery-gate.test.ts`
- `packages/repository/test/agent-write-transaction.test.ts`
- `packages/repository/test/agent-file-operation-race.test.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/application/src/version-group-session.ts`
- `packages/application/test/agent-file-operation-session.test.ts`
- `packages/application/test/version-group-session.test.ts`
- `apps/desktop/src/main/agent-run-runtime.ts`
- `apps/desktop/src/main/ipc-handlers.ts`
- `apps/desktop/src/renderer/workspace-file-editor-runtime.ts`
- `apps/desktop/src/renderer/plain-file-editor-bridge.ts`
- `apps/desktop/test/agent-write-save-coordinator.test.ts`
- `apps/desktop/test/agent-write-editor-sync.test.ts`
- `apps/desktop/test/workspace-file-editor-runtime.test.tsx`
- `packages/ui/src/recovery-review.tsx`

**实施步骤**

1. 扩展 Task 7 已启用的 root recovery gate、root-bound 独占 lease 和 `ipc-handlers.ts` 中 `AgentWriteSaveCoordinator`（若后续抽取为独立文件，则在本任务明确新增并保持原导出兼容），覆盖 move/delete、多文件 consistency group、volume-local recovery object 和 project lifecycle；mutation 前继续 pause/drain 所有 save/autosave 并检查全部触及路径 editor state。
2. preflight 在首笔写前验证 operation DAG、path/root policy、空间/大小、approval reservation、base/absence/candidate 和 recovery side effect。
3. 无 commit marker 的启动决策固定：全 before -> 标记回退；已完成 after + 未完成 before -> 仅逆序补偿 after；neither/unknown/root unavailable/policy drift -> 零写入进入 review。
4. gate 未解除时阻止 Agent、普通 save/autosave、project lifecycle 和普通 undo/restore；read-only UI 可带恢复横幅打开。
5. 补偿只覆盖仍精确匹配本 transaction after-state 的对象；外部新编辑不覆盖。
6. commit 后统一刷新 editor/tree/index；rollback/undo/recovery 同步同样路径。已提交 undo 使用当前 hash 生成新 inverse Change Set 并重新审批。
7. Renderer 延迟 dirty event、crash/unknown state、跨 workspace 同名路径和 apply 中途变 dirty 都 fail closed。

### Task 8.4：资格化 create-directory（独立门）

**修改文件**

- `packages/agent-engine/src/tool-registry.ts`
- `packages/application/src/agent-file-operation-session.ts`
- `packages/repository/src/engineering-file-mutation-port-v2.ts`
- 对应单元、runtime 和安装包 E2E 测试

**实施步骤**

1. 只允许 parentRef + 单一 canonical leaf；不支持 recursive、parents、overwrite 或目录删除。
2. 始终人工审批；内部补偿可使用 `remove_empty_directory`，但 Provider 不公开该工具。
3. 未单独通过 native/transaction/recovery/UI/E2E 时 flag 保持关闭；但本计划和 Agent Core Complete 要求该独立门最终通过，不能以其他文件 CRUD 已完成替代。

**Batch 8 门禁与建议提交**

```powershell
npm exec vitest -- run packages/agent-engine/test/approval-binding-v2.test.ts packages/agent-engine/test/tool-registry.test.ts packages/repository/test/engineering-file-mutation-port-v2.test.ts packages/repository/test/volume-local-recovery-binding.test.ts packages/repository/test/engineering-recovery-root-repository.test.ts packages/repository/test/engineering-recovery-gate.test.ts packages/repository/test/engineering-write-transaction-v2.test.ts packages/repository/test/agent-write-transaction.test.ts packages/repository/test/agent-file-operation-race.test.ts packages/application/test/agent-file-operation-session.test.ts packages/application/test/version-group-session.test.ts apps/desktop/test/engineering-recovery-runtime.test.ts apps/desktop/test/engineering-agent-runtime.test.ts apps/desktop/test/agent-write-save-coordinator.test.ts apps/desktop/test/agent-write-editor-sync.test.ts apps/desktop/test/workspace-file-editor-runtime.test.tsx apps/desktop/test/plain-file-editor-bridge.test.ts packages/ui/test/recovery-review.test.tsx --no-file-parallelism
npm run typecheck
npm run lint
npm run package:check
npm run package:dir:built
git diff --check
```

另运行 ADR 指定的安装包 E2E：root replacement、read/write reparse race、hard-link、case-only 两步崩溃、`stateRoot`/content root 跨卷但 recovery root 与 content root 同卷的场景、每个 durable flush/receipt/commit 故障点、startup hydrate/autosave 竞争、multi-file compensation 和 undo。

只有 replace/create/move/delete/create-directory 全部通过，engineering 才计入 Agent Core Complete。任一项资格失败时仍按逐 operation fail closed 展示真实能力，但不得把本计划或 Agent Core 标为完成。

建议提交：

1. `feat(engineering): add reviewed file move and case rename recovery`
2. `feat(engineering): add volume-local recoverable deletion`
3. `feat(engineering): gate workspace recovery and synchronize editors`
4. `feat(engineering): qualify directory creation`（独立资格提交）

## 15. Batch 9：评测、打包验证与发布收口

### Task 9.1：建立合法组合合同矩阵和安全/隐私语料

**新增文件**

- `packages/application/test/agent-guidance-v3-matrix.test.ts`
- `packages/application/test/agent-safety-corpus.test.ts`
- `apps/desktop/test/agent-provider-privacy.e2e.ts`
- `apps/desktop/test/agent-engineering-crud.e2e.ts`
- `apps/desktop/test/fixtures/agent-safety-corpus.json`

**修改文件**

- `packages/application/test/native-provider-agent-contract.test.ts`
- `apps/desktop/test/agent-context-runtime.e2e.ts`
- `apps/desktop/test/agent-permission-plan.e2e.ts`
- `apps/desktop/test/agent-run-autonomy.e2e.ts`
- `apps/desktop/test/agent-write.e2e.ts`

**实施步骤**

1. 对合法 profile × mode × capability × operations × policy × task intent × context × Provider 组合做 pairwise/边界矩阵；非法组合单独 fail closed，不跑无意义全笛卡尔积。
2. 安全语料覆盖项目约定、章节、Story Bible、普通文件、摘要、tool/recovery、网页、MCP schema、Unicode 控制和闭合攻击。
3. spy Provider 验证单一 authority、准确 tools、无本地 metadata/未选择正文/敏感名称；三类 adapter 分别验证 native serialization，其中 generic OpenAI-compatible 与官方 OpenAI 选择都由 `openai-compatible-provider.ts` 承担，但作为两个 provider/config case 单独覆盖。
4. writing 固定场景覆盖分析/构思无 Change Set、续写不改前缀、选区润色、事实冲突、POV/时态/知识边界和完整领域 lifecycle。
5. engineering 固定场景覆盖只读诚实性、无验证工具时“未运行”、逐 operation capability、两种审批策略、raw-byte/path/recovery/editor race。

### Task 9.2：真实安装包资格与发布证据

**修改文件**

- `apps/desktop/electron-builder.config.cjs`
- `scripts/package-check.mjs`
- `scripts/artifact-secret-scan.mjs`
- `scripts/release-check.mjs`
- `apps/desktop/test/package-artifact.test.ts`
- `apps/desktop/test/m98-v1-ship-readiness.test.ts`
- `docs/releases/stage5-agent-tool-evidence.json`
- `ROADMAP.md`
- `CHANGELOG.md`（只在准备实际发布时）

**实施步骤**

1. package check 验证 native backend/probe/manifest/signature/digest 与平台匹配，源码测试产物不进入安装包。
2. 安装包 E2E 从真实用户入口覆盖 preview -> Provider -> proposal -> approval/auto-review -> apply -> restart/recovery -> undo。
3. 网络/MCP 若启用，补真实设置、外发审批、descriptor sanitizer、撤销和 `outcome_unknown` E2E；否则证据明确 Disabled。
4. evidence 每项记录生产入口、用户控制、安全资格、测试和 packaged artifact ref；缺任何一项不得 Complete。
5. ROADMAP 只在门禁通过后把 Agent Core 标完成；Full Engineering Execution Agent 继续明确未实现。

### Task 9.3：最终回归与人工验收

按顺序执行，任何失败先修复对应批次，不用文档豁免：

```powershell
npm run schema:story-bible
$storyBibleSchemaDiffBefore = (git diff --binary -- packages/schemas/schema | Out-String)
npm run schema:story-bible
$storyBibleSchemaDiffAfter = (git diff --binary -- packages/schemas/schema | Out-String)
if ($storyBibleSchemaDiffBefore -ne $storyBibleSchemaDiffAfter) { throw "Story Bible schema generation is not stable." }
npm run test:contract
npm test -- --no-file-parallelism
npm run typecheck
npm run lint
$env:FORMAT_BASE_SHA = "5c234d475e95442a9916aa53b4debeec205b152d"
npm run format:changed
npm run build
npm run test:e2e:built -- --workers=1
npm run alpha:verify
npm run package:check
npm run release:check
npm audit --omit=dev --audit-level=high
npm run package:dir:built
npm run package:artifact-check
$agentPackageDir = (Get-Content -Encoding UTF8 -Path "release/latest-package-dir.txt").Trim()
npm run release:gate -- $agentPackageDir
git diff --check 5c234d4..HEAD
git diff --check
```

还必须执行 ADR-0003 中的 native qualification、负对照和故障注入命令。真实 Provider 公网 canary 依赖用户凭据和网络，可作为发布人工步骤，但不能替代本地 spy/native payload 合同。

人工验收至少覆盖：

1. 四 profile 的名称、能力标签和 system/context/tool 预览准确。
2. Plan 可见未来审批策略但当前只读；Act 边界重新确认；新 Run 不继承有限预授权。
3. writing 完成章节/Story Bible 查增改、archive、逻辑删除/恢复、改名/排序，dirty 内容不丢失。
4. creative file replacement/create/move/delete 可审阅、应用、恢复和撤销；每项都通过真实安装包入口，未通过时整个 Agent Core release gate 保持阻塞。
5. engineering 完成文件查增改删移动/重命名与单层目录创建，删除可恢复，重启 recovery gate 有效，且 UI 明示无 Shell/任务/Git。
6. 首次预览与首轮一致，后续发送账本可审计，未选择内容和敏感 metadata 不上传。
7. 旧 2.1 Run 可逐字恢复；未知/篡改版本、旧 token 和旧 pending Change Set 不能越权应用。

建议提交：

1. `test(agent): add guidance safety and provider privacy matrices`
2. `test(agent): add packaged writing and engineering Agent journeys`
3. `docs(release): record qualified Agent Core evidence`

## 16. 分层测试节奏

### 开发中

- agent-engine 改动先跑对应 `packages/agent-engine/test/*.test.ts`。
- application 依赖新 agent-engine 输出时，先 `npx tsc -b packages/agent-engine`，再跑 application 定向测试。
- Repository mutation/恢复每个故障点使用定向测试，不在每次小改后跑全仓。
- UI 先跑 component/bridge 测试；首次 preview、approval、editor sync 和 recovery 必须再跑 Desktop E2E。

### 批次门禁

- 每批次一次相关 suite + `typecheck` + `lint` + `git diff --check`。
- `git diff --check` 不覆盖未跟踪文件；每批次先核对 `git status --short`，对新增文件单独运行 Prettier，并在只暂存本批次文件后补跑 `git diff --cached --check`，不得顺带暂存用户或其他批次改动。
- 改依赖/lockfile 的批次额外跑 `npm audit`；无依赖变化不重复。
- Batch 0 运行 package check，并仅在意外/提前产生候选 native artifact 时追加真实产物 probe 与负对照；Batch 6、7、8、9 必须运行 package check、对应真实产物 probe 和负对照。
- 全仓测试、build、完整 E2E、artifact scan 和 strict release gate 集中在 Batch 9。

### 不可替代的安全证据

- authority/registry 篡改、unknown version 和孤立恢复；
- Provider metadata 泄漏与第二 authority；
- approval proof/binding replay、reserve/WAL 对账和 old-token 拒绝；
- root replacement、reparse/symlink/hard-link、stale index 和 root-external canary；
- raw-byte BOM/EOL、receipt mismatch、每个 durability/commit 故障点；
- dirty/unknown editor、save race、startup recovery gate 和外部新编辑保护；
- delete 双 root authority/quarantine/restore/purge 边界；
- 首次 preview TOCTOU 与后续 round ledger。

普通 unit mock、源码字符串检查、typecheck 和“工具未报错”都不能替代上述证据。

## 17. 最终完成定义

只有以下全部满足，才能把当前产品标为 **Agent Core Complete**：

1. 每个 canonical request 恰好一个注册的 app authority；各 Provider 恰好一个 native 等价物。
2. system runtime facts、Permission Summary、UI 和 Provider tools 对真实能力逐项一致。
3. Plan 当前只读；未来 Act 策略可见但不授权；进入 Act 只在 Accepted ADR-0004 指定的可信表面显式确认，有限预授权仍只适用合格 proposal proof；TCB 资格缺失时按合同禁用。
4. writing 完成章节和 Story Bible 领域查增改、archive、tombstone delete/restore、章节 rename/reorder/volume，且事务/history/dirty/editor sync 完整。
5. `creative_general` 完成普通 UTF-8 文本 list/read/search/replace/create/move/delete 的生产闭环；缺少任一项时不能标记 Agent Core Complete。
6. engineering 在支持平台通过 hardened list/read/search/index 和 UTF-8 文件 replace/create/move/delete/create-directory；所有 mutation 使用 v2 receipt、审批 binding、独立 Engineering V2 Journal、恢复、undo 和 editor/tree sync。
7. context 可预览、可预算、最小披露；未授权正文、敏感名称和本地 identity 不进入 Provider，四 profile materialized authority 通过固定 estimator token 上限。
8. start/preview/refresh/exclude/compact/hydrate/handoff 不改变 authority、版本、能力或审批分类。
9. completion、blocking、pending、apply、verification 和 recovery 都有可持久化证据；模型不能只靠文字声明完成。
10. 核心合同、安全、隐私、恢复、跨 Provider 和安装包 E2E 全绿，发布证据没有超报。

以下仍不属于 Agent Core：Shell、任务、Git、插件、本地 MCP。只有另立设计并完成独立安全资格后，才能声明 **Full Engineering Execution Agent Complete**。

## 18. 实施结束时的文档状态

- 本计划保持 Candidate，执行过程中只在每个批次真实完成后记录提交和证据，不预先改 Complete。
- `docs/releases/stage5-agent-tool-evidence.json` 是发布能力真值；设计/计划中的目标文字不能替代它。
- ADR-0003、ADR-0004、schema migration notes、legacy recovery policy 和 packaged qualification report 必须随实现存在。
- 未通过的真正 optional capability 明确记录为 Disabled/Deferred，并保持 flag/tool/UI 三处关闭；creative lifecycle 与 engineering create-directory 不属于可省略项。
