# Novel Studio Agent Tool P0/P1 优化设计

**日期：** 2026-08-19
**状态：** Proposed
**范围：** Agent 工具目录、工程文件能力、项目路径发现、发布证据、活动工具集与只读调用调度
**相关基线：** `docs/superpowers/specs/2026-08-02-agent-completion-and-system-guidance-v3-design.md`

## 1. 结论

本设计补齐当前 Agent 工具体系的五个高优先级缺口：

1. 工程工作区已经声明文件移动、删除和建目录能力，但生产 capability projection 仍只允许 replace/create。
2. `search_project` 只能进行正文搜索或引用反查，缺少类似 `find` 的独立路径发现能力。
3. 机器可读发布证据与源码、用户控制和实际发布目录之间尚未形成自动一致性门禁。
4. 当前工具目录按 profile/capability 冻结，但缺少用户可见、每次运行可进一步缩小的 active-tool allowlist。
5. 本地安全读取工具仍按模型调用顺序串行执行，多个独立 list/read/search 调用存在不必要等待。

优化只借鉴小型活动工具集、路径发现和安全读取并行，不恢复任意 Shell、Agent Git、项目任务、插件进程或本地 stdio MCP。Novel Studio 继续保留比通用编码 Agent 更严格的项目边界、稳定引用、Change Set、审批、事务、恢复、撤销和数据外发控制。

## 2. 当前基线

| 领域      | 当前事实                                                                                              | 主要缺口                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 工程 CRUD | Catalog 2.0 能描述 replace/create/move/delete/create-directory；Desktop 生产过滤只保留 replace/create | feature、backend、资格和目录投影没有形成五项逐操作单一真值                           |
| 项目发现  | `list_project_entries` 浏览单层目录；`search_project` 支持 `text/references`                          | 大项目缺少按文件名、目录名和 glob 快速定位路径的能力                                 |
| 发布证据  | `stage5-agent-tool-evidence.json` 记录 phase 状态                                                     | release catalog 没有强制与 `releaseEligible`、安全资格、用户控制和 packaged E2E 求交 |
| 活动工具  | Main 根据 profile 和 capability 生成并冻结工具目录                                                    | 用户不能在本次运行前进一步关闭不需要的网络、MCP 或 mutation 工具                     |
| 调度      | 工具调用统一顺序执行；副作用顺序安全                                                                  | 多个纯本地、无外发、可安全重试的读取调用不能并行                                     |

现有 V2 Catalog 2.0、Effective Capability State、Permission Summary、provider-name mapping、Prompt Artifact、首次发送预览和发送账本继续作为实现基础，不建立第二套权限或工具真值。

## 3. 目标与非目标

### 3.1 目标

- 工程五项 workspace operation 从 Main feature 到 UI 的投影逐项一致、只缩权、可测试。
- Agent 能在不执行 Shell 的前提下按路径模式发现项目内文件和目录。
- 公共发布版只能公开已经完成生产接线、安全资格、用户控制和 packaged E2E 的工具。
- 用户能在首次发送前查看并进一步缩小本次运行的活动工具集。
- 多个独立本地读取调用可以有界并行，同时保持事件、持久化和 Provider tool-result 顺序确定。

### 3.2 非目标

- 不实现任意 `bash`、PowerShell、`cmd.exe` 或模型提交的命令字符串。
- 不恢复 `run_project_task`、Agent Git、内置 Git runtime、插件进程或本地 stdio MCP。
- 不允许 active-tool 选择扩大 Main 已解析的 Effective Capability State。
- 不允许路径 glob 进入 mutation schema，也不允许路径发现结果绕过稳定引用和 fresh-base 校验。
- 不因源码、类型、测试 stub 或 feature flag 存在而自动把工具标记为可发布。

## 4. 共用安全不变量

1. Desktop Main 是 capability、活动工具目录和发布资格的唯一运行时 authority；Renderer、模型、项目文件和外部工具描述只能请求缩权。
2. 工具目录在第一次 Provider 请求前冻结。当前 Run 只允许 capability 撤销或工具移除，不允许新增工具、恢复已移除工具或替换 schema。
3. 所有 mutation 继续使用现有稳定引用、Change Set、Approval Binding、事务、恢复和撤销，不提供直接文件写入旁路。
4. 项目文件、搜索结果、网页、MCP 描述和工具输出都是不可信数据，不能授权路径、工具或发布能力。
5. Provider-visible system guidance、tools、Permission Summary、首次预览、发送账本和 UI 能力摘要必须来自同一冻结活动目录。
6. 发布证据只能限制发布能力，不能授予运行时 capability；运行时 capability 也不能绕过发布证据进入公共构建。

## 5. P0：能力真值、路径发现与发布门禁

### 5.1 P0-A：工程 CRUD 逐操作生产投影

工程 workspace operation 固定为：

- `replace_file`
- `create_file`
- `move_file`
- `delete_file`
- `create_directory`

每个 operation 的公开条件必须使用同一张 Main-owned 资格表计算：

```text
operationVisible =
  featureEnabled
  && backendCapabilityPresent
  && approvalQualificationCurrent
  && recoveryQualificationCurrent
  && releaseEvidenceEligible
  && effectiveCapabilityNotRevoked
```

上式定义的是公共 production projection；开发/测试 projection 只有在显式 non-public feature flag 下才可省略 `releaseEvidenceEligible`，并且生成的目录必须带 non-public 标记，绝不能流入 `publicReleaseTools` 或公共发布包。

投影链固定为：

```text
Production Feature Facts
-> Requested Capability Snapshot
-> Runtime Capability Intersection
-> Catalog 2.0 Descriptor
-> Permission Summary
-> System Runtime Facts
-> Provider Tools / Preview / Send Ledger
-> UI Capability Summary
```

要求：

1. 使用 operation-keyed 表驱动投影替代 engineering 分支中只允许 replace/create 的硬编码判断。
2. `requestedCapabilitySnapshot` 只能请求 Main 已证明的 operation；`buildRuntimeCapabilitySnapshot` 只能继续求交，不得增加 operation。
3. move/delete/create-directory 必须继续使用 effect-specific 工具名，不恢复宽泛 `manage_path`。
4. move、delete 和 create-directory 始终人工确认；replace/create 是否具备条件审阅资格继续由版本化 approval rule 决定。
5. 任一 backend、qualification、root binding、recovery 或 release evidence 撤销后，当前 Run 进入 `capability_changed`，不继续发送旧目录。
6. 对五项 operation 建立跨层矩阵测试，覆盖单项开启、组合开启、全部关闭、资格过期、executor 缺失和运行中撤销。

### 5.2 P0-B：有界路径发现工具

首选扩展现有 `search_project`：

```json
{
  "mode": "paths",
  "query": "src/**/*.ts",
  "kind": "file",
  "cursor": "optional-opaque-cursor",
  "maxResults": 50
}
```

只有 Provider schema 兼容性无法接受第三个 discriminated branch 时，才拆分为 `find_project_paths`；两种形式不得同时进入同一工具目录。

结果合同：

```json
{
  "kind": "untrusted_project_data",
  "items": [
    {
      "relativePath": "src/index.ts",
      "entryKind": "file",
      "ref": "file:src/index.ts"
    },
    {
      "relativePath": "src/components",
      "entryKind": "directory"
    }
  ],
  "nextCursor": null,
  "truncated": false,
  "indexRevision": "..."
}
```

约束：

- 只接受项目相对、长度和深度有界的 glob；拒绝绝对路径、`..`、UNC、设备路径、ADS 和 Windows 保留名。
- `kind` 只允许 `file | directory | any`；`maxResults` 必须有硬上限，cursor 为 Main 签发的不透明值。
- cursor 必须绑定 project、workspace kind、effective-capability/catalog revision、root binding revision、sharing/path-policy revision、规范化 query、kind、index revision、页位置和有效期；任一绑定变化后稳定拒绝，不能跨项目、跨查询或跨授权重放。
- 只返回当前 workspace、sharing grant 和 path policy 允许公开的条目；`hard_denied`、不允许的 managed/ignored 路径及其名称不能泄露。
- engineering 复用 hardened root-handle list/index authority，并拒绝 symlink、junction、mount point、reparse point、特殊文件和 stale index。
- creative project 继续过滤章节、Story Bible、设置和其他受管路径，不能借路径发现进入错误 profile。
- file 命中必须返回可由当前 `read_resource` 解析的 `file:` ref；directory 命中不得伪造 file ref，只能将 `relativePath` 交给当前 `list_project_entries` 再次校验和展开。
- path 结果只用于后续 `read_resource`、`list_project_entries` 或 effect-specific proposal；不能作为写授权或 fresh-base 证明。
- glob 仅属于只读发现工具，不能出现在 create/move/delete 等 mutation schema 中。

### 5.3 P0-C：发布证据与发布目录一致性

公共发布工具目录增加最终交集：

```text
publicReleaseTools = runtimeQualifiedTools ∩ evidenceEligibleTools
```

要求：

1. `stage5-agent-tool-evidence.json` 为机器可读发布状态源，必须更新 `assessedAt`，并逐 phase 记录 production runtime、用户控制、安全资格、packaged E2E 和 `releaseEligible`。
2. manifest 增加 `catalogClaims`，把固定 core descriptor 以 `toolId + contextProfileId + optional writeOperation` 唯一映射到一个或多个 `phaseIds`，并绑定已验收的 `descriptorDigest`；动态 remote MCP 使用 `sourceClass=remote_mcp` 的类级 claim，同时要求每来源 runtime qualification 绑定实际 descriptor digest。
3. `evidenceEligibleTools` 只能从 descriptor 与 claim 身份/digest 完全匹配、且 claim 引用的全部 phase 均为 `Complete && releaseEligible=true` 推导。缺失、重复、digest 漂移、引用不存在 phase 或同一 descriptor 命中多个 claim 时一律 fail closed，不允许按 label、说明文本或数组位置猜测。
4. 协议工具也必须有明确 claim；若某 profile 所需的 `finish`/`finish_plan` 或 `request_user_input` 不合格，应阻止该 Agent surface/Run 启动并返回稳定错误，不能发送缺少协议工具的残缺目录。
5. 开发/测试构建可以在显式 feature flag 下保留未发布实现；公共构建必须隐藏 evidence 不合格的工具。
6. CI 必须拒绝以下状态：
   - 工具进入公共目录，但对应 evidence 为 `Partial`、`Blocked`、`Unavailable` 或 `releaseEligible=false`；
   - evidence 宣称 Complete，但 executor、用户控制、安全资格或 packaged E2E 任一缺失；
   - catalog descriptor 缺少唯一 claim，或 claim 的 tool/profile/operation/digest 与实际 descriptor 不一致；
   - System、Permission Summary、Provider tools、UI 与 evidence 对公开能力的判断不一致。
7. evidence 刷新只记录事实，不因源码存在、单元测试通过或类型已声明而自动升级状态。
8. 工具被紧急撤销时，先从 public release projection 移除；证据文件随后记录撤销原因和 revision，不能保持陈旧 Complete。

### 5.4 P0 验收标准

- 五项 engineering operation 在 feature、backend、qualification、evidence、catalog、Permission Summary、system 和 UI 中逐项一致。
- move/delete/create-directory 资格齐全时不会被 replace/create 专用过滤器误删，资格不全时绝不进入 Provider tools。
- 路径发现覆盖 glob、分页、截断、大小写、Unicode、stale index、root replacement、reparse、managed/ignored/hard-denied 和跨 profile 负例。
- file 命中可由 `read_resource` 解析，directory 命中可由 `list_project_entries` 展开；不能产生不可解析、类型错误或越权 ref。
- 公共构建的工具目录与机器可读 evidence 无矛盾；开发 flag 不改变公共发布判断。
- 每个公共 descriptor 都命中且只命中一个 catalog claim；缺失、歧义和错误 phase 引用均被 CI 与 Main 拒绝。

## 6. P1：活动工具集与只读批次并行

### 6.1 P1-A：每次运行的 shrink-only active-tool allowlist

活动目录生成顺序：

```text
Effective Capability State
-> Qualified Catalog
-> Profile-required Tools
-> User / Task shrink-only selection
-> Frozen Active Catalog
```

选择规则：

1. 用户、task intent 和 profile 只能从 Qualified Catalog 中移除工具，不能构造新 descriptor、恢复已撤销工具或扩大 operation。
2. `finish`/`finish_plan` 与 `request_user_input` 属于对应 workspace Agent 模式的协议工具，不允许被普通 allowlist 删除；Standalone 继续保持空工具目录。
3. 用户可以关闭可选网络、远程 MCP、mutation 或不需要的读取工具。关闭 mutation 不改变 write policy，只会使实际写能力为空。
4. Main 在首次发送预览前冻结有序 active tool IDs、descriptor revision、provider mapping revision 和 active-set checksum。
5. active-set checksum 对有序 canonical tool ID、provider name、descriptor digest 和 selection-policy revision 的规范 JSON 求 SHA-256，不包含可变展示文本；它进入 Permission Summary、Prompt Artifact、cache identity、首次 preview、Canonical Round Manifest 和后续发送账本。
6. 当前 Run 禁止新增或重新启用工具。启用新工具、MCP 来源或新 schema 必须创建新 Run/显式 handoff，并重新生成 context、guidance、审批和 preview。
7. capability 撤销仍可在运行中缩小 active set；撤销后遵循现有 `capability_changed` 终止边界，不在旧 Run 内静默继续。
8. 新 Run 的持久化 schema 必须包含 active set 和 checksum。缺少这些字段的旧 Run 只按其原始有序 frozen catalog 派生 `legacy_full_catalog` 兼容 checksum，不从当前代码重新选工具、不开放 allowlist，也不原地重写历史 artifact。

UI 至少显示：

- 本次活动工具；
- 因 profile、用户选择、发布证据、资格或运行中撤销而未激活的工具及原因；
- 网络、MCP 和 mutation 的独立关闭入口；
- “更改将在新 Run 生效”的明确提示。

### 6.2 P1-B：纯本地读取批次有界并行

只有整批工具调用全部满足以下条件时才允许并行：

```text
effect == read
&& dataEgress == none
&& retrySemantics == safe
&& requiresApproval(descriptor, currentPolicy) == false
&& capabilityRevisionUnchanged
&& catalogRevisionUnchanged
```

`requiresApproval` 是 Main 根据 descriptor、当前数据外发策略和版本化 approval rules 得出的现有运行时判定，不新增模型或 Renderer 可写的 `approvalRequirement` 字段。

首批并行范围仅包括本地 list/read/search/path-find。`web_search`、`fetch_url` 和 MCP 即使语义上是读取，也属于数据外发或远程副作用，不进入本批次。

执行协议：

1. 先按模型源顺序完成 provider-name 解析、严格 schema 校验、capability 重检和重复 tool-call ID 检查。
2. 按源顺序持久化 `tool_started`，之后在固定并发上限内执行；首版上限为 4，并允许通过 Main-owned 常量降为 1。
3. 每项结果只写入内存缓冲；全部完成后按原 tool-call 顺序持久化 `tool_completed/tool_failed` 并生成 Provider tool messages。
4. 单项读取失败形成该调用自己的稳定错误包络，不改变其他已验证读取的结果；是否重试继续服从现有 safe-read retry 合同，本设计不新增自动重试。
5. 用户取消时同时 abort 所有未完成读取，停止下一次 Provider 调用，并按原顺序完成持久化终态。
6. crash/hydrate 不根据完成顺序重排结果；未形成持久化完成证据的读取按现有恢复策略处理，不能因并行引入重复 mutation 或外发风险。

以下任一情况使整个批次保持现有串行路径：

- 包含 `propose`、`execute`、`external_read`、`external_action` 或 `control`；
- 需要用户审批、写入预授权或数据外发许可；
- 动态目录、capability、root binding、sharing grant 或 catalog revision 已变化；
- 工具声明非安全重试、结果未知或执行顺序具有业务语义。

### 6.3 P1 验收标准

- 相同 request、profile、capability 和用户选择生成逐字相同的活动目录与 checksum。
- 被关闭工具不进入 system guidance、Provider tools、Permission Summary、cache key、首次 preview 或后续发送账本。
- 运行中扩权只能通过新 Run；旧 Run 的工具调用无法引用新启用工具或新 schema。
- 缺少 active-set 字段的旧 Run 只恢复其原始 frozen catalog，派生 checksum 稳定且不会获得当前版本新增工具。
- 1、2、4 个本地读取调用的并行结果与串行基线在 Provider-visible 内容和顺序上完全一致。
- 含任一副作用、外发、控制或审批调用的批次保持串行。
- 取消、失败、重载和 crash recovery 测试不存在结果错配、重复执行、事件乱序或错误 retry eligibility。

## 7. 主要修改落点

| 领域                   | 主要文件                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具 schema/目录       | `packages/agent-engine/src/tool-registry.ts`、`packages/agent-engine/src/agent-run-tool-catalog.ts`                                                                                                             |
| Capability 投影        | `packages/agent-engine/src/agent-tool-capabilities.ts`、`packages/agent-engine/src/effective-capability-state.ts`、`apps/desktop/src/main/agent-feature-flags.ts`、`apps/desktop/src/main/agent-run-runtime.ts` |
| Permission/system 真值 | `packages/agent-engine/src/permission-summary.ts`、`packages/application/src/agent-runtime-facts.ts`、`packages/application/src/agent-system-prompt.ts`                                                         |
| 路径发现               | `packages/application/src/agent-search-tool-session.ts`、`packages/repository/src/agent-project-search-repository.ts`、engineering hardened access/index adapter                                                |
| Tool 调度              | `packages/application/src/agent-tool-call-pipeline.ts`、`packages/application/src/agent-run-session.ts`                                                                                                         |
| Preview/账本/cache     | Prompt Artifact、Canonical Round Manifest、send ledger 与 prompt cache consumers                                                                                                                                |
| UI                     | `packages/ui/src/agent-capability-summary.tsx`、Agent composer/permission surface、MCP tool-source panel                                                                                                        |
| 发布证据               | `docs/releases/stage5-agent-tool-evidence.json`、`scripts/release-check.mjs`、packaged E2E                                                                                                                      |

## 8. 推进顺序与回滚

1. 先落 P0-A 的共享 operation projection 和跨层不变量测试，不立即扩大任何工具。
2. 接入 P0-B 路径发现并保持 feature 默认关闭；通过安全矩阵后再进入开发目录。
3. 完成 P0-C evidence/public-release intersection，再逐项开放已具备完整证据的能力。
4. P1-A 先提供只读活动目录预览，再开放用户缩权；旧 frozen Run 不迁移 active set。
5. P1-B 以并发上限 1 建立等价基线，通过确定性测试后切换为 4。

回滚只允许缩权：关闭路径发现、active-tool selection 或并行读取 feature 后，新 Run 回到旧目录或串行调度；新格式 frozen Run 按其持久化 catalog 和 active-set revision 恢复，旧格式 Run 按原始有序 frozen catalog 派生 `legacy_full_catalog` 兼容绑定，均不按当前代码重新选工具。任何无法证明安全回滚的状态进入 `capability_changed` 或稳定 blocked/error，不静默降级为更宽权限实现。

## 9. 风险与决定

### 9.1 工程 CRUD 被错误扩大

风险：把后端端口存在误当成安全资格，导致 move/delete/create-directory 提前进入目录。

决定：逐 operation 同时要求 feature、backend capability、approval/recovery qualification、release evidence 和未撤销状态；缺一即隐藏。

### 9.2 路径名称泄露

风险：即使不读取正文，文件名和目录结构也可能泄露 hard-denied 或未分享信息。

决定：路径发现与正文搜索使用同一 root/path/sharing authority，并在生成 ref、名称、计数、`truncated`、分页或 cursor 前过滤；任何返回元数据都不能泄露过滤前命中及其数量。

### 9.3 Active tools 变成扩权入口

风险：Renderer 或任务分类器通过选择工具绕过 Main capability。

决定：allowlist 只做集合交集；任何新增工具都要求新 Run、全新目录 checksum 和发送预览。

### 9.4 并行读取破坏确定性

风险：真实完成顺序改变事件顺序、Provider messages 或恢复结果。

决定：并行只发生在执行阶段，验证、开始事件、最终持久化和 Provider-visible 结果始终按模型源顺序；不能证明等价时使用串行路径。

### 9.5 为追求 pi 对齐引入任意 Shell

风险：直接复制 `bash` 或直接文件写入破坏 Novel Studio 的本地项目安全与作者最终决定权。

决定：本设计不实现 Shell、任务或 Git。若未来需要 Full Engineering Execution Agent，必须另立安全设计、执行环境、凭据/网络策略和 packaged qualification。

## 10. 完成定义

P0 Complete 必须同时满足：工程五项 operation 投影无矛盾、路径发现安全矩阵通过、公共发布目录与 evidence 一致，并且没有新增 Shell/Git/进程旁路。

P1 Complete 必须同时满足：活动工具集可预览、可缩权、不可在旧 Run 中扩权；所有相关 checksum/preview/cache/ledger 绑定一致；纯本地读取并行与串行结果确定性等价，任何副作用或外发批次继续串行。
