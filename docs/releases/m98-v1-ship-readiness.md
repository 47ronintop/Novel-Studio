# M98 V1 Ship Readiness

Version: 1.1 | Status: CONDITIONAL - live provider manual verification pending | Date: 2026-07-07

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
