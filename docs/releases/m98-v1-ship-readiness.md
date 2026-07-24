# M98 V1 Ship Readiness

Version: 1.1 | Status: CONDITIONAL - live provider manual verification pending | Date: 2026-07-24

## Ship Decision

V1 ship decision: CONDITIONAL HOLD

Novel Studio cannot be called fully provider ship-ready until a real desktop run is manually verified with a user-owned API key. The default startup path now injects a real provider runtime, stores pasted API keys through encrypted desktop secret storage, and performs real network connection tests, but this document must not claim final GO until the manual DeepSeek/OpenAI verification below passes.

No M99/M100 is authorized unless M98 finds a v1 blocker.

## Core Writing Journey Evidence

Core writing journey evidence:

| User behavior                                                                       | Evidence                                                                                                                                                                                                                                                                                                                  | Decision                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Create/open a project, write a chapter, save, close, reopen, and continue writing   | `npm run test:e2e` includes the core writing journey across save, close, reopen, and continued editing                                                                                                                                                                                                                    | Pass                                                 |
| Generate an AI writing suggestion, review it, and apply it only after confirmation  | `npm run test:e2e` includes AI suggestion generation and explicit apply confirmation                                                                                                                                                                                                                                      | Pass                                                 |
| Preserve drafts and recovery state when the app exits or has dirty autosave records | `npm run test:e2e` includes autosave recovery draft review; unit tests cover recovery, version, and lock boundaries                                                                                                                                                                                                       | Pass                                                 |
| Configure common public API providers                                               | M95 provider router supports OpenAI-compatible providers for DeepSeek, GLM, Tongyi, and OpenAI-style APIs. Default desktop startup now uses encrypted secret storage, real connection tests, and verified-key provider routing. Claude still requires Anthropic/native runtime injection or an explicit compatible proxy. | Automated pass; manual live-key verification pending |
| See minimum Story Bible consistency warnings and jump to the related entry          | M96 Story Bible consistency report and UI tests cover explicit conflict markers with jump targets                                                                                                                                                                                                                         | Pass                                                 |
| Verify public Windows install readiness before handing an installer to users        | `npm run release:check`, `npm run package:artifact-check`, and M97 public install gate document cover release-channel, artifact scanning, and signing policy                                                                                                                                                              | Pass                                                 |

## Verification Commands

The M98 gate requires these commands before a public handoff decision:

- `npm run format`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npx vitest run apps/desktop/test/m95-real-provider-runtime.test.ts apps/desktop/test/settings-bridge.test.ts apps/desktop/test/m15-model-profile-settings.test.ts packages/llm-adapter/test/openai-compatible-provider.test.ts apps/desktop/test/m95-provider-runtime-routing.test.ts --passWithNoTests`
- `npm run release:check`
- `npm run test:e2e`
- `git diff --check`

`npm run package:installer` remains a release-operator action, not an automatic M98 action, because M98 does not publish or upload artifacts.

## Known Limits

Known limitations do not block the core writing loop.

| Limit                                                                     | Why it does not block v1 ship                                                                                                                                                                                                    | Follow-up                                                                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The editor default remains textarea                                       | The core journey can write, save, recover, and review AI changes; textarea has not failed the v1 acceptance scenario                                                                                                             | Keep CodeMirror default migration in v2/backlog until real writing or long-document evidence requires it                                              |
| Story Bible consistency is explicit-marker based                          | v1 only needs a clear conflict warning and jump link, not full knowledge graph inference                                                                                                                                         | Improve detection after real users show missed conflicts that block writing                                                                           |
| Live provider manual verification is not yet completed in this workspace  | Automated tests prove secret storage, real HTTP request construction, verified-key routing, and non-mock AI output through injected fetch; they do not prove a real user key works against DeepSeek/OpenAI from the packaged app | User must run desktop dev or packaged app, save a real API key, test connection, generate an AI suggestion, restart, and confirm the profile persists |
| Claude requires native provider injection or an explicit compatible proxy | Common OpenAI-compatible providers cover the main v1 path; Claude support is documented as a runtime integration requirement                                                                                                     | Add a tested Anthropic/native runtime before claiming first-class Claude live support                                                                 |
| Windows signing material is outside the repository                        | M97 documents the public signing policy; private certificate storage cannot live in git                                                                                                                                          | Release operator must sign public artifacts using external certificate handling                                                                       |
| No hosted auto-update or macOS notarization                               | v1 public scope is Windows public install readiness; hosted updates and macOS artifacts are not in scope                                                                                                                         | Reopen only when those distribution channels are selected                                                                                             |

## Structural Risk Review

Structural risk review:

| File                                                      | M98 line count | Gate                                                 | Decision                                             |
| --------------------------------------------------------- | -------------: | ---------------------------------------------------- | ---------------------------------------------------- |
| `packages/ui/src/workspace-shell.tsx`                     |            900 | UI hard split threshold: 1200 lines                  | Below hard split threshold after M92 follow-up split |
| `apps/desktop/src/renderer/App.tsx`                       |           1017 | UI/renderer hard split threshold: 1200 lines         | Below hard split threshold after M92 follow-up split |
| `packages/application/src/ai-writing-workflow-session.ts` |            984 | Application session hard split threshold: 1000 lines | Not a v1 blocker, but near the threshold             |

These files are below the forced split gates that M92 established. They should not receive broad v1.1 feature work before another scope review.

## V2/Backlog Deferred Scope

V2/backlog deferred scope:

| Deferred item                                                                                   | Reason                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Plugin marketplace, production third-party plugin isolation, and real external plugin execution | No current third-party plugin developer blocks the writing loop                                               |
| Workflow Designer full visual editing and complex graph E2E                                     | JSON/form editing plus existing graph projection do not block the core writing journey                        |
| CodeMirror default migration and complete inline diff review editor                             | textarea remains acceptable for v1 and the current AI apply path has confirmation tests                       |
| Timeline deep editing, drag sorting, and body bidirectional positioning                         | v1 only requires minimum Story Bible conflict warnings with jump links                                        |
| Provider streaming, live benchmark, and long-tail provider translators                          | The AI suggestion loop works without live streaming; reopen only if public users report degraded writing flow |
| Coverage threshold, dependency boundary tools, and schema codegen                               | Useful engineering hardening, but current gates cover v1 behavior; reopen if regressions prove the need       |
| macOS notarization and hosted auto-update                                                       | Not in the selected public Windows install scope                                                              |

## Reading Aloud Decision

Reading aloud decision: GO for v1.1 backlog, NO for v1 blocker.

Reading preview and character voice reading do not decide whether an author can write, use AI assistance, save safely, reopen, and continue the same chapter. They are approved only as a v1.1 candidate after v1 ship readiness, with this first-slice boundary:

- Chapter reading preview inside the chapter preview/reader surface.
- Story Bible character voice settings.
- System voice as the default baseline.
- Edge TTS behind an explicit experimental provider switch.
- No audiobook export, no emotional acting system, no automatic speaker inference, and no paid cloud TTS integration until real users ask for audio deliverables.

## Manual Provider Verification Required

Before changing this document back to GO, a human must verify:

1. Run the desktop app in dev mode or from a packaged Windows build.
2. In Settings, paste a real DeepSeek or OpenAI API key, save the profile, and make it default.
3. Click "Test connection" and confirm the result comes from a real network request.
4. Return to the editor, generate one AI writing suggestion, and confirm the text is not the mock "AI continuation draft" path.
5. Restart the app and confirm the saved profile remains while the API key itself is not visible in settings.json.

## Final Gate

M98 final gate: conditional hold until manual live provider verification passes. Non-core gaps remain deferred, and reading aloud is scoped to v1.1 backlog instead of v1.

## Stage 5 Agent 工具补全状态（2026-07-24）

Stage 5 将 Agent 静态工具从 9 个扩展到 22 个，并引入插件/MCP 动态工具框架。以下是当前发布状态：

| 能力                   | 状态      | 说明                                                                                                                                           |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目搜索/引用 (A)      | Available | `search_project_text`/`find_project_references` 已接线，受 `phaseA_searchEnabled` flag 门控                                                    |
| 文件生命周期 (B)       | Available | 6 个工具经 Change Set v1.1 暂存，DAG preflight 验证，no-follow 路径校验；受 `phaseB_fileLifecycleEnabled` flag 门控                            |
| 网络读取 (D)           | Available | SSRF 安全 dialer、`web_search`/`fetch_url`；受 `phaseD_networkReadEnabled` flag 门控                                                           |
| 远程 MCP (E.3)         | Available | 严格 schema/description 校验，`outcome_unknown` 一等终态；受 `phaseE_remoteMcpEnabled` + Phase D 网络门控                                      |
| 任务沙箱 (C.0-C.3)    | Fail-closed | 原生 host stub 仍输出 unavailable — 正确行为，等待真实 Windows AppContainer 二进制打包；`run_project_task` 在此之前不可用                       |
| Git 只读 (C.4)         | Fail-closed | 打包 Git runtime stub（`manifest.json` 占位符）→ `AGENT_GIT_ADAPTER_UNAVAILABLE`，等待真实 Git binary 打包                                    |
| 插件工具 (E.1)         | Fail-closed | `PluginSandboxPort` 合同和 `authorizePluginToolCall` 已实现；注入启动器 adapter always-unavailable，等待 C.0 真实 host 打包                    |
| 本地 stdio MCP (E.2)   | Fail-closed | `local-mcp-runtime.ts` 和 `McpSettingsFileRepository` 已实现；`LocalMcpHostLauncher` always-unavailable，等待 C.0 真实 host 打包               |
| E.4 来源管理 UI        | Partial   | `externalToolDescriptors` 注入口和调度分支已就位；`agent-tool-source-panel.tsx` 和对应 IPC 通道尚未交付（TD-037）                               |

fail-closed 状态是按计划原则9的正确行为（"任一安全能力为 missing 时均按 unavailable 处理"），不是 v1 核心写作旅程的阻塞项。
