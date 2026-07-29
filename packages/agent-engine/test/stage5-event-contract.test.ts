import type { JsonObject } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import {
  EMPTY_AGENT_RUN_USAGE_SUMMARY,
  createAgentContextSnapshot,
  normalizeAgentContextSnapshot,
  normalizeAgentRunEvent,
  normalizeAgentRunSnapshot,
  type AgentRunSnapshotV10,
  type AgentRunSnapshotV11
} from "../src/index.js";

/** Parsed-from-disk records reach the normalizers as JsonObject; cast fixtures through it. */
const asJson = (value: unknown): JsonObject => value as JsonObject;

const v10Snapshot: AgentRunSnapshotV10 = {
  schemaVersion: "1.0",
  runId: "run_01",
  projectId: "project_01",
  conversationId: "conv_01",
  operationMode: "planning",
  contextMode: "writing",
  writePolicy: "write_before_confirmation",
  userRequest: "Continue the chapter.",
  status: "planning_model",
  runRevision: 1,
  lastSequence: 1,
  startedAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
  providerCapabilitySnapshot: {
    profileId: "model_01",
    provider: "openai-compatible",
    modelName: "tool-model",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 32_000,
    requiredContextTokens: 8_000
  },
  pendingUserInputId: null,
  contextSnapshotId: null,
  sourcePlanId: null,
  sourcePlanRevision: null
};

describe("Stage 5 run/context contract normalization", () => {
  test("normalizes a v1.0 run snapshot into the cache-aware v1.3 view", () => {
    const normalized = normalizeAgentRunSnapshot(asJson(v10Snapshot));

    expect(normalized.schemaVersion).toBe("1.3");
    expect(normalized.scope).toEqual({
      kind: "workspace",
      workspaceKind: "creativeProject",
      workspaceId: "project_01"
    });
    expect(JSON.stringify(normalized)).not.toContain('"projectId"');
    // modelProfileId is a deliberate hoist of providerCapabilitySnapshot.profileId.
    expect(normalized.modelProfileId).toBe("model_01");
    expect(normalized.reasoningEffort).toBeUndefined();
    expect(normalized.permissionSummaryId).toBeNull();
    expect(normalized.permissionSummaryChecksum).toBeNull();
    expect(normalized.contextBudgetSnapshotId).toBeNull();
    expect(normalized.activeCompactionId).toBeNull();
    expect(normalized.planExecutionId).toBeNull();
    expect(normalized.planExecutionRevision).toBeNull();
    expect(normalized.activeErrorId).toBeNull();
    expect(normalized.recoveryState).toBe("none");
    expect(normalized.usageSummary).toEqual(EMPTY_AGENT_RUN_USAGE_SUMMARY);
    expect(normalized.providerCapabilitySnapshot.promptCache).toEqual({
      mode: "none",
      policyVersion: "none@1.0",
      minimumCacheableTokens: 0,
      ttlSeconds: null,
      inputTokenSemantics: "unavailable",
      reportsCacheReadTokens: false,
      reportsCacheWriteTokens: false
    });
    expect(normalized.promptCacheArtifactId).toBeNull();
    expect(normalized.promptCacheIdentityChecksum).toBe("legacy");
    // v1.0 fields are preserved.
    expect(normalized.userRequest).toBe("Continue the chapter.");
    expect(normalized.conversationId).toBe("conv_01");
  });

  test("backfills conversationId to null for a v1.0 record missing it", () => {
    const { conversationId: _drop, ...withoutConversation } = v10Snapshot;
    void _drop;
    const normalized = normalizeAgentRunSnapshot(asJson(withoutConversation));
    expect(normalized.conversationId).toBeNull();
  });

  test("preserves v1.1 fields while adding the v1.3 scope and cache fields", () => {
    const v11: AgentRunSnapshotV11 = {
      ...v10Snapshot,
      schemaVersion: "1.1",
      status: "context_compacting",
      modelProfileId: "model_01",
      reasoningEffort: "high",
      permissionSummaryId: "perm_01",
      permissionSummaryChecksum: "checksum_01",
      contextBudgetSnapshotId: "budget_01",
      activeCompactionId: "compaction_01",
      planExecutionId: "exec_01",
      planExecutionRevision: 2,
      activeErrorId: null,
      recoveryState: "recovery_review",
      toolFacadeVersion: "v1",
      toolCatalogSnapshotId: null,
      toolCatalogRevision: null,
      usageSummary: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        usageStatus: "actual",
        cacheOutcome: "unknown",
        cacheUsageStatus: "unavailable",
        cacheInputTokenSemantics: "unavailable"
      }
    };
    const normalized = normalizeAgentRunSnapshot(asJson(v11));
    expect(normalized).toMatchObject({
      schemaVersion: "1.3",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project_01"
      },
      permissionSummaryId: "perm_01",
      activeCompactionId: "compaction_01",
      recoveryState: "recovery_review",
      usageSummary: v11.usageSummary
    });
    // The v1.1 waiting states survive normalization.
    expect(normalized.status).toBe("context_compacting");
  });

  test("normalizes a v1.2 run snapshot into a cache-disabled v1.3 view", () => {
    const v12 = {
      ...v10Snapshot,
      schemaVersion: "1.2",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project_01"
      },
      contextProfileId: "writing",
      profileVersion: "2.0",
      guidanceTemplateChecksum: "a".repeat(64),
      conventionsArtifactId: null,
      promptCachePolicyVersion: "none@1.0",
      cachePrefixChecksum: "b".repeat(64),
      modelProfileId: "model_01",
      reasoningEffort: undefined,
      permissionSummaryId: null,
      permissionSummaryChecksum: null,
      contextBudgetSnapshotId: null,
      activeCompactionId: null,
      planExecutionId: null,
      planExecutionRevision: null,
      activeErrorId: null,
      recoveryState: "none",
      toolFacadeVersion: "v1",
      toolCatalogSnapshotId: null,
      toolCatalogRevision: null,
      usageSummary: EMPTY_AGENT_RUN_USAGE_SUMMARY,
      pendingToolApproval: null
    };

    expect(normalizeAgentRunSnapshot(asJson(v12))).toMatchObject({
      schemaVersion: "1.3",
      promptCacheArtifactId: null,
      promptCacheIdentityBaseChecksum: "legacy",
      promptCacheIdentityChecksum: "legacy",
      promptCacheStablePrefixMessageCount: 0,
      providerCapabilitySnapshot: {
        promptCache: {
          mode: "none",
          policyVersion: "none@1.0"
        }
      }
    });
  });

  test("normalizes legacy events to the scope-aware v1.3 view", () => {
    const v10Event = {
      schemaVersion: "1.0",
      runId: "run_01",
      projectId: "project_01",
      sequence: 3,
      runRevision: 3,
      type: "tool_started",
      createdAt: "2026-07-13T00:00:01.000Z"
    };
    expect(normalizeAgentRunEvent(v10Event)).toMatchObject({
      schemaVersion: "1.3",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project_01"
      }
    });

    const v11Event = {
      schemaVersion: "1.1",
      runId: "run_01",
      projectId: "project_01",
      sequence: 4,
      runRevision: 4,
      type: "context_compaction_started",
      createdAt: "2026-07-13T00:00:02.000Z"
    };
    expect(normalizeAgentRunEvent(v11Event)).toMatchObject({
      schemaVersion: "1.3",
      type: "context_compaction_started",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project_01"
      }
    });
  });

  test("normalizes a v1.0 context snapshot into per-source v1.1 accounting fields", () => {
    const v10Context = {
      schemaVersion: "1.0",
      contextSnapshotId: "context_01",
      runId: "run_01",
      createdAt: "2026-07-13T00:00:00.000Z",
      compactionRevision: 0,
      sources: [
        {
          refId: "chapter_01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/ch_01.md",
          checksum: "a".repeat(64),
          dirty: true,
          capturedAt: "2026-07-13T00:00:00.000Z"
        }
      ],
      excludedSources: []
    };
    const normalized = normalizeAgentContextSnapshot(asJson(v10Context), {
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing"
    });
    expect(normalized.schemaVersion).toBe("1.3");
    const source = normalized.sources[0];
    expect(source).toMatchObject({
      layer: "tool_result",
      sourceRevision: 0,
      tokenCount: null,
      precision: "unknown",
      state: "active"
    });
    // The v1.0 fields are preserved.
    expect(source?.refId).toBe("chapter_01");
    expect(source?.checksum).toBe("a".repeat(64));
  });

  test("createAgentContextSnapshot authors a v1.3 snapshot", () => {
    const snapshot = createAgentContextSnapshot({
      contextSnapshotId: "context_02",
      runId: "run_01",
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing",
      materialization: {
        schemaVersion: "1.0",
        profileVersion: "1.0",
        guidanceTemplateChecksum: "guidance",
        stablePrefixChecksum: "prefix",
        messageOrderVersion: "1.0"
      },
      createdAt: "2026-07-13T00:00:00.000Z",
      sources: [
        {
          refId: "chapter_01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/ch_01.md",
          content: "Current chapter draft",
          dirty: true
        }
      ]
    });
    expect(snapshot.schemaVersion).toBe("1.3");
    expect(snapshot.sources[0]?.layer).toBe("editor");
    expect(snapshot.sources[0]?.state).toBe("active");
  });

  test("every normalized DTO survives structuredClone", () => {
    const runView = normalizeAgentRunSnapshot(asJson(v10Snapshot));
    const eventView = normalizeAgentRunEvent({
      schemaVersion: "1.0",
      runId: "run_01",
      projectId: "project_01",
      sequence: 1,
      runRevision: 1,
      type: "run_started",
      createdAt: "2026-07-13T00:00:00.000Z"
    });
    const contextView = createAgentContextSnapshot({
      contextSnapshotId: "context_03",
      runId: "run_01",
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing",
      materialization: {
        schemaVersion: "1.0",
        profileVersion: "1.0",
        guidanceTemplateChecksum: "guidance",
        stablePrefixChecksum: "prefix",
        messageOrderVersion: "1.0"
      },
      createdAt: "2026-07-13T00:00:00.000Z",
      sources: []
    });
    expect(structuredClone(runView)).toEqual(runView);
    expect(structuredClone(eventView)).toEqual(eventView);
    expect(structuredClone(contextView)).toEqual(contextView);
  });
});
