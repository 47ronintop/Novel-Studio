# ADR-0004：Agent 审批 UI 信任边界

**Date:** 2026-08-02

**Status:** Accepted

**Decision owner:** Security Architecture Owner

**Implementation owner:** Desktop Main Owner

## 背景

普通工作台 Renderer 会展示项目正文、diff、模型输出、网页和外部工具内容。这些内容全部不可信；
nonce、MAC 或 display checksum 可以绑定数据、防篡改和防 replay，但不能证明一次普通 Renderer IPC
点击来自看过准确内容的人类。

本 ADR 在 Task 1.5 冻结 Plan/Act IPC、Task 1.2b 签发 Approval Binding/Ledger，以及任何
`limited_run_preapproval` 开启之前，固定人工 Change Set、Plan-to-Act 和一次性 Act 预授权的可信
输入来源。

## 决定

### 1. TCB 边界

普通工作台 Renderer **不属于审批 TCB**。它可以请求打开审阅、显示非权威预览和发送 opaque
preview ID，但不能提交可授权的 approve 决定、diff、operation、policy、capability、nonce 或 MAC。

审批 TCB 仅包含：

1. Electron Main 中的 approval coordinator、canonical preview record、authorization ledger；
2. 由 Main 创建且绑定父窗口的单用途隔离 approval modal；
3. modal 的 app-bundled、签名覆盖的固定 HTML/JS/preload；
4. Electron/操作系统窗口、输入和代码签名边界。

实现落点冻结为 `apps/desktop/src/main/agent-approval-confirmation.ts` 和独立 approval bundle；不得复用
普通 `packages/ui` workbench tree。Main 创建 `modal: true` 的独立窗口，固定
`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webviewTag: false`、无 remote
navigation、无 opener、无普通 preload API、独立非持久 session。最终“批准/拒绝”再由 Main-owned
platform-native modal 收口。只有该隔离 surface 完成下述资格测试后，它才进入 TCB；仅创建窗口文件
不代表 qualified。

### 2. 三类可信确认

| 场景                   | 可信表面                                                | 必须显示并绑定                                                                                                                      | 缺失/失败行为                                                         |
| ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 人工 Change Set        | isolated review modal + Main-owned native final confirm | workspace label、Change Set ID/revision、全部 operation/路径的安全显示、完整 canonical diff、recovery side effect、display checksum | 保持 `awaiting_write_approval`；无写入                                |
| Plan -> Act            | 同一 surface 的独立 flow                                | Plan ID/revision、workspace/root、最终 operation 子集、capability/policy revision、执行审批策略                                     | 不创建 execution Run                                                  |
| `user_preapproved_run` | 同一 surface 的强化确认 flow                            | 当前 Run、允许自动审阅的 effect rules、始终人工/禁止项、到期/重置边界；按钮明确写“仅本次执行”                                       | 规范化为 `write_before_confirmation`；若人工 surface 也未资格化则只读 |

Plan Composer 中的选择只是 `executionWritePolicyDraft`，不进入 planning Provider payload，也不生成
human-intent evidence。用户手动切 Act 或批准 Plan 时必须重新打开可信表面。新 Run、Plan revision、
workspace/root、capability/policy、operation 子集或 preview 内容变化都会使旧确认失效。

### 3. 内容隔离与 human-intent evidence

Main 从自身 canonical Change Set/Plan record 生成只读 display DTO。所有来自项目、模型或外部内容的
名称和正文只按 escaped plain text 渲染：禁止 HTML/Markdown 执行、链接、图片、字体、CSS、脚本和
远程资源；control、bidi、不可见字符使用稳定转义。固定的 app identity、风险标题、按钮和 checksum
位于不可信内容容器之外，项目内容不能覆盖、遮挡、滚动替换或仿冒控件。超出经过测试的窗口、文本、
operation 或 diff 上限时 fail closed，不截断后继续批准。

Main 只接收来自当前 approval modal `webContents.id`、当前 modal instance 和固定 preload channel 的
内部事件；普通 Renderer 即使知道 channel 名或 preview ID 也被拒绝。最终 native modal callback 由
Main 直接消费，不经普通 Renderer 转发。

可信决定形成 Main-only `MainOnlyHumanIntentEvidenceV1`，至少绑定：

- `source = main_owned_isolated_modal_v1`、modal instance ID、一次性随机 nonce；
- action、created/displayed/decided time、expiry；
- workspace/content root kind + identity、run ID；
- Change Set 或 Plan ID/revision/checksum、ordered operation/hunk selection；
- display DTO checksum、approval rule set、capability/policy revision；
- 对 delete 的 recovery root/grant/side-effect checksum；
- approval surface bundle digest 和 qualification revision。

evidence 只存 Main authorization ledger/journal，不进入 Provider、工具参数/结果、Renderer state、项目
文件、遥测或普通恢复摘要。display checksum 仍只证明预览一致；真正授权来自 qualified surface 的
Main-owned evidence 和后续 opaque capability/MAC。

### 4. 决定状态机和 replay 边界

```text
prepared(Main canonical record)
  -> displayed(current qualified modal + exact bundle/window identity)
  -> decided(approve | reject | cancel)
  -> issued(Main-only evidence, approve only)
  -> reserved(one transaction)
  -> consumed | revoked
```

- 只有当前 `displayed` record 可以决定一次；重复 click、IPC replay 或窗口重建后的旧事件拒绝。
- sender/window/modal/preview/revision/checksum/expiry 任一不符即 revoke，零授权。
- approve 后内容或能力变化使 evidence revoke；不能“补算”新 checksum 延续旧人类决定。
- close、Esc、系统取消、失焦策略触发、Renderer/modal crash、Main restart、签名/qualification 漂移均按
  cancel/revoke 处理。
- issued capability 只能为一个 transaction 原子 reserve；跨 Run/workspace/operation/revision replay
  拒绝。nonce/MAC 不会把普通 Renderer 的事件升级为 human intent。

### 5. 缺失 surface 时的产品行为

Accepted 决定和 surface qualification 是两个独立状态。当前 Batch 0 只接受决定，尚未实现或资格化
surface，因此：

- `limited_run_preapproval` 必须保持 off；Guidance 3.0 的 `user_preapproved_run` 不得形成有效选项、
  acknowledgement 或授权；
- 只有独立资格化的人工 surface 才能保留“请求批准”；在此之前 Guidance 3.0 的 mutation capability、
  tools 和可用 UI 全部关闭为只读；
- UI 不显示可点击的“替我审批”。若为解释未来策略而展示，只能是禁用态，并明确“可信确认尚不可用”；
- planning 永远只读。历史 Guidance 2.1 仍只 hydrate/view/export/replay，本 ADR 不把历史文案变成 3.0
  权限或批准合同。

现有 pre-v2 `decideChangeSet` Renderer IPC 和 legacy `user_preapproved_run` 流程不是本 ADR 的可信
evidence，也不能被新 ledger/parser 读取成 v2 授权。Task 1.2b/1.5 负责在任何 Guidance 3.0 writer
或 mutation capability 开启前关闭该迁移缝并接入上述 surface；Batch 0 不宣称 legacy 流程已经符合
本 ADR，也不提前实现 Batch 1 的 IPC/ledger。

不得以普通 Renderer IPC、测试 port、development flag、workspace trust、项目约定、用户自然语言、
display checksum、nonce 或 MAC 绕过上述关闭行为。

## Qualification 门禁

Desktop Main Owner 必须为同一个 surface qualification revision 提供以下自动化证据；Security
Architecture Owner 审核后才能把人工确认标为 available：

1. 普通 Renderer 伪造 approve/reject、猜中 preview ID、复制合法 payload均被拒绝；
2. duplicate、stale、wrong Run/workspace/root/plan/change-set/revision/operation/policy/capability replay
   均被拒绝；
3. modal navigation、remote load、window opener、DevTools 注入、第二个 preload channel 和非当前
   `webContents.id` 被拒绝；
4. HTML/Markdown、脚本、图片、链接、CSS、超长文本、control/bidi/Unicode alias 只显示为安全文本，
   不能覆盖固定 chrome 或控件；
5. modal/父窗口身份、置顶/模态、焦点、默认按钮和 cancel 行为符合合同；approve 不能是默认按钮；
6. 键盘-only、screen reader 名称/角色/顺序、高对比度、200%/400% 缩放、简体中文/英文和超长路径
   都能完整审阅并明确取消；截断或不可达时禁止批准；
7. modal、Main 或普通 Renderer 在 prepared/displayed/decided/issued 各点崩溃后，孤立 evidence 不可用；
8. 未签名/development bundle、bundle digest 漂移或 qualification 缺失时，UI 与 capability 同时关闭；
9. `user_preapproved_run` 只覆盖当前 execution Run 中通过条件 rule 的整组；always-human、未知、混合组、
   move/delete/create-directory、policy-managed 和 grant 变化仍暂停人工确认。

消费路径固定为：Task 1.2b 的 authorization ledger、Task 1.5 的 Plan/Act IPC、Task 7.1 的 engineering
approval binding，以及 Batch 9 packaged release gate。任一路径不得另定义可信来源。

## Owner 责任和接受记录

| Role                        | 可执行责任                                                                                    | 失败时关闭行为                                        | 状态                          |
| --------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| Security Architecture Owner | 接受 TCB、威胁模型、qualification cases；审核 surface revision                                | 不签发 qualification；所有新 mutation/preapproval off | Accepted                      |
| Desktop Main Owner          | 实现唯一 coordinator/surface/evidence issuer、sender/window binding、ledger 和 crash recovery | 只读；不信任普通 Renderer fallback                    | Accepted                      |
| UI/Accessibility Owner      | 固定 chrome、隔离渲染、键盘/screen reader/缩放证据                                            | surface unavailable                                   | Required before qualification |
| Release Engineering Owner   | 验证 bundle digest、签名和 packaged E2E                                                       | 阻止发布/启用                                         | Required before qualification |

本 ADR 的 `Accepted` 表示边界已经确定，不表示 trusted approval surface 已实现或资格化。
