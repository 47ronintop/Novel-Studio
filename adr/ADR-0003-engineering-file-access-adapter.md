# ADR-0003：工程文件访问 native Repository adapter

**Date:** 2026-08-02

**Status:** Accepted

**Decision owner:** Security Architecture Owner

**Implementation owners:** Desktop Main Owner、Native Adapter Owner、Release Engineering Owner

## 背景与范围

工程工作区的 list/read/search/index 和后续文件 CRUD 需要抵抗路径替换、reparse、别名、
raw-byte 漂移及恢复根混淆。普通 Node pathname API、现有 `trusted_creative` port、测试 port
都不能取得 `hardened_native` 资格。

本决定只重新打开受限工程文件 access/mutation Repository adapter。它不恢复 ADR-0002 的任务
sandbox，也不恢复已取消的 Rust host、AppContainer、Shell、子进程、Git、插件进程或本地
stdio MCP。

## 决定

### 1. 实现和平台

- 初始 production target 仅为 `win32-x64`。
- adapter 使用 C++20 Node-API addon；它是 ADR-0001 TypeScript Strict Core 下方的受限
  Repository adapter，不是新的 Core Engine、sidecar 或通用原生宿主。
- addon 只能由 Electron Main 的固定 loader 加载。Renderer、preload、模型、项目文件、插件和
  普通 IPC 都不能加载 addon、创建 qualification、提交 probe 或刷新 attestation。
- addon 不公开命令执行、进程、网络、Git、任务、插件或 MCP API；其导出面只允许冻结的
  root/access/mutation/recovery DTO。
- 其他平台统一为 `unsupported_platform`。不得 fallback 到 pathname reader/writer。

Windows 实现使用目录 handle 与 handle-relative 操作：根目录由 Main 打开并保持；逐段打开使用
以根 handle 为 `RootDirectory` 的 NT/Win32 handle API，并在每一段查询 reparse tag、volume、
file identity、link count 和普通文件类型。rename/disposition 使用 handle-based file information
API；raw bytes 通过 handle 读写；数据、文件和受影响目录必须完成可验证 flush。某文件系统或
API 组合无法证明这些语义时，该 capability 为 `unavailable`，不能以较弱实现降级。

### 2. 精确源码、构建、签名和打包路径

以下路径是唯一允许的候选路径；Batch 0 只冻结路径，不创建这些文件：

| 用途                        | 精确路径                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| source root                 | `native/engineering-file-access-win32`                                                                                              |
| C++ source                  | `native/engineering-file-access-win32/src/engineering_file_access.cc`                                                               |
| build definition            | `native/engineering-file-access-win32/CMakeLists.txt`                                                                               |
| build driver                | `scripts/build-engineering-file-access-win32.mjs`                                                                                   |
| sign driver                 | `scripts/sign-engineering-file-access-win32.mjs`                                                                                    |
| package probe driver        | `scripts/probe-engineering-file-access-package.mjs`                                                                                 |
| candidate addon             | `native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node`                                                  |
| canonical manifest          | `native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json`                                         |
| detached CMS signature      | `native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s`                                          |
| Main qualification boundary | `apps/desktop/src/main/engineering-file-access-qualification.ts`                                                                    |
| packaged probe E2E          | `apps/desktop/test/engineering-file-access-package.e2e.ts`                                                                          |
| installed addon             | `release/win-unpacked/resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node` |

`apps/desktop/electron-builder.config.cjs` 只能逐项列出上述三份 candidate 文件，并通过
`asarUnpack` 放入 `app.asar.unpacked`；禁止 native 宽 glob 和 `extraResources` 复制规则。
`scripts/package-check.mjs` 对这组三文件执行精确 allowlist 和 all-or-none 检查。Batch 0 若发现任一
候选文件即失败关闭；若实施期间确实提前产生完整候选，则必须补做真实 `package:dir:built`、
packaged 正/负 probe 后才能接受该候选。

当前 `win.forceCodeSigning: false` 只支持本地 beta 打包，绝不构成 production 资格。production
qualification 必须对实际安装包中解包后的 `.node` 重算 SHA-256，使用 `WinVerifyTrust` 验证
Authenticode publisher，验证 detached CMS manifest 签名，并核对 manifest 中 target、Node-API
ABI、source revision、publisher policy checksum 和三份 artifact digest。开发/未签名 host 只能
得到 unavailable，不能产生 production attestation。

### 3. Root、raw-byte、receipt 与 recovery 合同

`packages/agent-engine/src/engineering-file-contracts.ts` 冻结以下 `1.0` DTO：

- `EngineeringWorkspaceRootBindingV1`：绑定 workspace kind/id、volume、directory identity、
  canonical path identity checksum 和 path-policy revision；不向模型公开绝对路径或 handle。
- `EngineeringRecoveryRootBindingV1`：独立绑定同卷 recovery root、content root、grant revision、
  directory identity 和 side-effect checksum；不能从 content path 推导。
- `EngineeringRawByteBlobV1`：Main-owned immutable blob、byte length、SHA-256、UTF-8/BOM/EOL。
- `EngineeringFileMutationReceiptV1`：绑定 tx/op、content/recovery root、relative identity、
  before/after digest、recovery object 和 `data_and_directory_flushed`。

Main 必须在同一次 native 调用中重验 root、每个相对 segment、source/target identity、blob manifest
和 recovery binding；Main 验证 receipt 后，事务才能推进。字符串 pathname port 和 JS string
正文不能满足这些 DTO。

### 4. Qualification authority 和状态机

`EngineeringFileQualificationAttestationV1.attestationChecksum` 与 probe checksum 只用于确定性身份
和损坏检测，不是签名或授权。即使攻击者重算普通 SHA，serialized attestation 也不能开启能力。
有效授权还必须是 `engineering-file-access-qualification.ts` 在 Electron Main 本进程签发并保留的
opaque in-memory provenance；序列化、spread、IPC 往返或项目持久化都会丢失 provenance。

Main service 是 one-shot 且进程内缓存，没有 Renderer refresh 方法：

```text
unobserved
  -> unsupported / missing / partial / unknown / error -> unavailable (terminal for process)
  -> complete candidate (Batch 0)                       -> unavailable/candidate_unqualified

Batch 6 only:
complete packaged candidate
  -> digest + Authenticode + CMS + manifest validation
  -> positive probes + disabled-protection canaries
  -> fresh Main-owned production attestation
  -> available until process restart, expiry, policy drift or explicit Main revocation
```

`available` shape必须同时满足：production、`win32-x64`、candidate present、root/access available、
空 failure list、artifact/manifest/probe digest 完整；recovery available 时 mutation 也必须 available。
shape validator 仍不授予权限，只有 Main-owned provenance guard 能授予。flag 只能和该 guard 取交集，
不能覆盖它。

### 5. Probe 与故意削弱的负对照

production report 的 canonical UTC 时间必须满足
`generatedAt <= Main checkedAt < expiresAt`，有效期最多一小时。以下六项正向保护全部为 `passed`：

1. root-relative traversal；
2. no-follow/reparse rejection；
3. raw-byte identity；
4. receipt binding；
5. data + directory durability；
6. recovery-root binding。

probe 必须另运行六个只存在于测试构建/注入路径的削弱版本。逐项关闭对应保护时，
`rootRelativeDisabled`、`noFollowDisabled`、`rawByteIdentityDisabled`、
`receiptBindingDisabled`、`durabilityDisabled`、`recoveryRootBindingDisabled` 必须暴露预期 canary。
canary 未暴露表示负对照无效，整个 report 为 `negative_control_failed`。削弱构建和注入开关禁止打包。

### 6. 失败关闭表

| 事实                              | 规范化结果                                            | Main/UI 行为                                                           | Owner               |
| --------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------- |
| OS/arch 不支持                    | `unsupported_platform`                                | 全部 engineering native capability off                                 | Desktop Main        |
| 三件套全缺                        | `host_missing`                                        | engineering 可保留现有非 native 只读产品行为；不得声称 hardened access | Desktop Main        |
| 三件套部分存在                    | `host_partial`                                        | package check 与 runtime 都失败关闭                                    | Release Engineering |
| evidence 未知、异常或过期         | `evidence_unknown` / `probe_error` / `evidence_stale` | 全 capability off，无缓存回退                                          | Desktop Main        |
| digest/signature/publisher 不匹配 | 对应 mismatch                                         | 全 capability off，并阻止发布                                          | Security + Release  |
| 正 probe 或负 canary 失败         | 对应 probe failure                                    | 不产生 production attestation                                          | Native Adapter      |
| 只有普通 SHA 自洽或来自 IPC       | provenance 不成立                                     | 不进入 feature flag/capability                                         | Desktop Main        |

任何 unavailable 都强制 root/access/mutation/recovery 为 unavailable，engineering mutation tools 和 UI
能力全部关闭；不得借 `phaseB_fileLifecycleEnabled`、`trusted_creative`、测试 port 或 Node pathname API
回退。

## Batch 0 可执行门禁

- `packages/agent-engine/test/engineering-file-contracts.test.ts`：严格 schema、时间、target、
  signature/digest、正向保护和负 canary。
- `apps/desktop/test/engineering-file-access-qualification.test.ts`：missing/partial/present/unknown/error、
  one-shot cache、Main provenance、serialized/自算 SHA 伪造拒绝。
- `apps/desktop/test/agent-feature-flags.test.ts`：所有新 engineering flag 默认 off，伪造或 unavailable
  attestation 无法开启。
- `apps/desktop/test/engineering-agent-runtime.test.ts` 与
  `apps/desktop/test/desktop-agent-run-runtime.test.ts`：旧 Phase B flag、显式 capability snapshot 或测试
  lifecycle port 均不能为 engineering 公开 mutation tool，也不能标成 `hardened_native`。
- `scripts/package-check.mjs`：候选三件套精确 allowlist、无宽 native resource、无已取消执行边界。

Batch 0 的成功只表示合同 Accepted 且“缺失 host -> unavailable”通过；不表示 native backend 已构建、
签名、打包或资格化。真实 packaged probe 和 production attestation 属于 Batch 6。

## 与 ADR-0001 的关系

ADR-0001 的 TypeScript Strict Core 决定不变。C++ addon 仅实现受限 Repository adapter；所有 policy、
capability、approval、事务状态机、DTO 校验和产品用例仍属于 TypeScript Core/Main。

## Owner 接受记录

| Role                        | 接受内容                                                                 | 状态     |
| --------------------------- | ------------------------------------------------------------------------ | -------- |
| Security Architecture Owner | trust boundary、publisher policy、probe/canary 和 fail-close 规则        | Accepted |
| Desktop Main Owner          | sole loader/issuer、opaque provenance、flag intersection、无 IPC refresh | Accepted |
| Native Adapter Owner        | handle-relative API、raw-byte/receipt/recovery 实现和削弱负对照          | Accepted |
| Release Engineering Owner   | reproducible build/sign、精确打包和真实 packaged evidence                | Accepted |
