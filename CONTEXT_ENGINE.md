# CONTEXT ENGINE - Novel Studio

Version: 1.0 | Status: Accepted for M7.2 | Phase: 7 Formal Development

## 1. Purpose

The Context Engine builds auditable context bundles for AI workflow steps. It selects bounded,
source-referenced project context, enforces a token budget, records excluded candidates with reasons,
and filters memories by confidence.

The Context Engine does not call models, execute agents, advance workflow state, write project files,
or blindly pack the full novel into a prompt.

## 2. Scope For M7.2

M7.2 implements:

- Context bundle construction from provided chapter, memory, character, world, timeline, and goal
  candidates.
- Deterministic token budget enforcement.
- Exclusion trace records for candidates that are skipped or trimmed out.
- Memory confidence filtering so unconfirmed memories are excluded by default.
- Source reference trace for every included item.
- A guard against full-novel blind stuffing by requiring explicit candidate refs and by rejecting
  bulk chapter candidates that exceed configured policy.

M7.2 does not implement:

- Semantic vector retrieval.
- Cache or SQLite index reads.
- Prompt rendering.
- Agent execution.
- Workflow state transitions.
- Repository project scanning.
- UI context trace panels.

## 3. Package Boundary

The implementation lives in `packages/context-engine`.

Allowed dependencies:

- `@novel-studio/shared` for `Result`, `UnifiedError`, and JSON value types.

Disallowed dependencies:

- `@novel-studio/agent-engine`
- `@novel-studio/llm-adapter`
- `@novel-studio/repository`
- UI, Electron, Application, or Service packages

The package is deterministic. Callers inject candidate context and token estimation behavior. Future
Repository-backed retrieval belongs in Service or Repository-facing ports outside this package.

## 4. Core Data Flow

```text
Context build input
-> explicit candidates
-> memory confidence filter
-> full-novel stuffing guard
-> priority ordering
-> token budget selection
-> Context Bundle with trace
```

## 5. Build Input Contract

A build request includes:

- `schemaVersion`: currently `1.0`.
- `contextBundleId`: stable id beginning with `ctx_`.
- `workflowRunId`: workflow run id for traceability.
- `traceId`: error correlation id.
- `goal`: planner or workflow step goal.
- `budget.maxTokens`: hard upper bound for included item token estimates.
- `policy.memoryConfidence`: allowed memory confidence values.
- `policy.maxChapterCandidates`: maximum explicit chapter candidates accepted for one bundle.
- `candidates`: ordered context candidates supplied by upper layers.

Candidates include:

- `refType`: `chapter`, `memory`, `character`, `world`, `timeline`, or `goal`.
- `refId`: stable project entity id.
- `content`: text fragment or structured summary already selected by the caller.
- `priority`: positive integer; lower values are selected first.
- `sourceRefs`: source references that explain where the content came from.
- `memoryConfidence`: required only for memory candidates.

The engine treats candidate content as already validated project data from upper layers. It still
validates its own contract and returns `UnifiedError` on invalid build input.

## 6. Context Bundle Output

The output follows `schema.context-bundle.v1` and includes:

- `schemaVersion`
- `contextBundleId`
- `workflowRunId`
- `budget.maxTokens`
- `budget.estimatedTokens`
- `items`
- `trace.selectionReason`
- `trace.includedRefs`
- `trace.excludedRefs`

Every included item records:

- `refType`
- `refId`
- `content`
- `tokenEstimate`
- `sourceRefs`

Every excluded item records:

- `refType`
- `refId`
- `reason`
- `tokenEstimate`

## 7. Budget Policy

Token estimates are deterministic. The default estimator is intentionally conservative and local:

```text
ceil(non-whitespace character count / 4)
```

Callers may inject a different deterministic estimator later. The engine never exceeds
`budget.maxTokens`. If an item cannot fit, it is excluded with `budget_exceeded`; it is not partially
included in M7.2.

## 8. Memory Confidence Policy

By default, only memories with `confidence: "confirmed"` are eligible. Memories marked
`"ai-unconfirmed"` or `"low"` are excluded with `memory_confidence_filtered` unless the caller
explicitly allows those confidence values in the build policy.

This protects user-owned canon from unconfirmed AI-generated memory pollution.

## 9. Full-Novel Stuffing Guard

The engine rejects build requests that attempt to pass too many chapter candidates at once. M7.2 uses
`policy.maxChapterCandidates` with a conservative default of `3`.

If the request exceeds the limit, the engine returns `CONTEXT_FULL_NOVEL_STUFFING_BLOCKED`. This is a
hard failure because silent truncation would hide a dangerous context strategy.

## 10. Error Handling

Context Engine errors use `UnifiedError` with category `ValidationError`.

Required stable codes:

- `CONTEXT_BUILD_INPUT_INVALID`
- `CONTEXT_BUDGET_INVALID`
- `CONTEXT_FULL_NOVEL_STUFFING_BLOCKED`

Errors include `traceId` and redacted structured detail. User manuscript content must not be placed in
error details.

## 11. Testing Requirements

M7.2 tests must cover:

- Context bundle build from chapter, memory, character, world, timeline, and goal candidates.
- Budget enforcement.
- Exclusion trace.
- Memory confidence filtering.
- No full-novel blind stuffing.
- Source reference trace for included items.
- Package boundary does not depend on Agent, LLM Adapter, or Repository packages.

## 12. Definition Of Done

M7.2 is complete when:

- `CONTEXT_ENGINE.md` exists and is indexed.
- `packages/context-engine` exists and is included in the root TypeScript build graph.
- Public context engine interfaces are exported from one package entrypoint.
- Tests cover budget, trace, memory filtering, source refs, and full-novel guard.
- Documentation, roadmap, index, and changelog are updated.
- `typecheck`, `lint`, `format`, `test`, `test:contract`, and `npm audit` pass.

## 13. Changelog

- v1.0 - 2026-07-04: Created M7.2 Context Engine contract.
