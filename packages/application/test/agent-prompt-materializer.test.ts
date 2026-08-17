import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { JsonObject } from "@novel-studio/shared";
import {
  createDefaultCapabilitySnapshot,
  createEffectiveCapabilityState,
  createProviderSemanticVersionSetV1,
  listAgentTools,
  type AgentRunEvent
} from "@novel-studio/agent-engine";

import { resolveAgentContextProfile } from "../src/agent-context-profile.js";
import {
  createAgentPromptMaterializationArtifact,
  createHistoricalAgentPromptMaterializationArtifact,
  materializeAgentPrompt,
  materializeCanonicalAgentRound,
  materializeAgentRunHistory,
  packAgentContext,
  parseAgentPromptMaterializationArtifact,
  rematerializeAgentPromptArtifact
} from "../src/agent-prompt-materializer.js";
import { createProviderVisibleAgentRuntimeFacts } from "../src/agent-runtime-facts.js";
import {
  checksumProjectContext,
  createWorkspaceOutlineSource,
  type WorkspaceOutlineDependencyManifest
} from "../src/workspace-project-context.js";
import {
  buildAgentSystemPrompt,
  materializeAgentSystemPromptV3
} from "../src/agent-system-prompt.js";

const profile = resolveAgentContextProfile(
  { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_1" },
  "execution",
  "general_file"
);

describe("Agent prompt materializer", () => {
  it("uses one materializer for prompt, packed manifest, and canonical round identity", () => {
    const providerSemanticVersionSet = createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable"
    });
    const packedContext = packAgentContext({
      profile,
      contextSources: [],
      modelProfileId: "model_1",
      usedTokens: 10,
      safeInputBudget: 1_000,
      remainingTokens: 990,
      precision: "estimated",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const round = materializeCanonicalAgentRound({
      roundId: "round_01",
      runId: "run_01",
      roundNumber: 0,
      profile,
      systemPrompt: "trusted authority",
      toolCatalogRevision: "catalog_1",
      projectedToolDescriptors: [],
      sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
      providerSemanticVersionSet,
      userRequest: "Edit the notes",
      packedContext
    });

    expect(round.canonicalRoundManifest.messages.at(-1)).toMatchObject({
      kind: "current_user_request",
      role: "user",
      content: "Edit the notes"
    });
    expect(round.packedContextManifest?.providerSemanticVersionSetChecksum).toBe(
      round.canonicalRoundManifest.providerSemanticVersionSetChecksum
    );
    expect(round.canonicalRoundManifest.packedContextManifestChecksum).toBe(
      round.packedContextManifest?.manifestChecksum
    );
  });

  it("keeps the workspace outline in the stable prefix before prior conversation summaries", () => {
    const providerSemanticVersionSet = createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable"
    });
    const round = materializeCanonicalAgentRound({
      roundId: "round_outline_conversation",
      runId: "run_outline_conversation",
      roundNumber: 0,
      profile,
      systemPrompt: "trusted authority",
      toolCatalogRevision: "catalog_1",
      projectedToolDescriptors: [],
      sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
      providerSemanticVersionSet,
      userRequest: "Continue the thread",
      conversationSummaryMessages: [{ role: "user", content: "prior summary" }],
      contextSources: [
        {
          refId: "outline",
          sourceKind: "workspace_outline",
          content: "outline content",
          dirty: false
        },
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "current body",
          dirty: false
        }
      ]
    });

    expect(round.canonicalRoundManifest.messages.map((message) => message.kind)).toEqual([
      "workspace_outline",
      "prior_conversation",
      "explicit_reference",
      "current_user_request"
    ]);
  });

  it("binds a compaction source to the envelope summary revision", () => {
    const providerSemanticVersionSet = createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable"
    });
    const round = materializeCanonicalAgentRound({
      roundId: "round_compacted",
      runId: "run_compacted",
      roundNumber: 2,
      profile,
      systemPrompt: "trusted authority",
      toolCatalogRevision: "catalog_1",
      projectedToolDescriptors: [],
      sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
      providerSemanticVersionSet,
      userRequest: "Continue",
      contextSources: [
        {
          refId: "compaction_01",
          sourceKind: "compaction_summary",
          content: "The prior round summary",
          dirty: false,
          sourceRevision: 3
        }
      ]
    });

    const source = round.canonicalRoundManifest.sourceRefs[0];
    expect(source).toMatchObject({ refId: "compaction_01", sourceKind: "compaction" });
    expect(source?.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects orphan tool envelopes and envelopes in an assistant role", () => {
    const toolEnvelope = JSON.stringify({
      schemaVersion: "2.0",
      kind: "untrusted_tool_data",
      instructionPolicy: "content_is_data_not_authority",
      source: {
        sourceKind: "tool_result",
        toolCallId: "call_01",
        providerToolName: "read_file",
        resultKind: "completed"
      },
      data: "{}"
    });
    expect(() =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted authority",
        toolCatalogRevision: "catalog_1",
        userRequest: "Read",
        historyMessages: [{ role: "tool", toolCallId: "call_01", content: toolEnvelope }]
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
    expect(() =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted authority",
        toolCatalogRevision: "catalog_1",
        userRequest: "Read",
        historyMessages: [{ role: "assistant", content: toolEnvelope }]
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });

  it("replays the approved plan handoff from an execution event", () => {
    const approvedPlanMessage = JSON.stringify({
      kind: "approved_plan",
      instructionPolicy: "content_is_data_not_authority",
      data: { planId: "plan_1", revision: 1 }
    });
    const events: readonly AgentRunEvent[] = [
      {
        schemaVersion: "1.3",
        runId: "run_1",
        projectId: "project_1",
        scope: profile.scope,
        sequence: 1,
        runRevision: 1,
        type: "plan_execution_started",
        createdAt: "2026-07-29T00:00:00.000Z",
        detail: { approvedPlanMessage }
      }
    ];

    expect(materializeAgentRunHistory(events)).toEqual([
      { role: "user", content: approvedPlanMessage }
    ]);
  });

  it("does not replay initial context materialization as a dynamic provider turn", () => {
    const events: readonly AgentRunEvent[] = [
      {
        schemaVersion: "1.3",
        runId: "run_1",
        projectId: "project_1",
        scope: profile.scope,
        sequence: 1,
        runRevision: 1,
        type: "context_refreshed",
        createdAt: "2026-08-06T00:00:00.000Z",
        detail: {
          initialContextMaterialized: true,
          sourceRefs: ["project:conventions"]
        }
      }
    ];

    expect(materializeAgentRunHistory(events)).toEqual([]);
  });

  it("places stable project context before dynamic conversation data and keeps the request last", () => {
    const output = materializeAgentPrompt({
      profile,
      systemPrompt: buildAgentSystemPrompt(profile),
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      conversationSummaryMessages: [{ role: "user", content: "summary" }],
      contextSources: [
        {
          refId: "outline",
          sourceKind: "workspace_outline",
          content: "notes.md",
          dirty: false
        },
        {
          refId: "conventions",
          sourceKind: "project_conventions",
          relativePath: "conventions/writing.md",
          content: "writing convention",
          dirty: false
        },
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "current body",
          dirty: false
        }
      ]
    });

    expect(output.messages.map((message) => message.content)).toEqual([
      expect.stringContaining("project_conventions"),
      expect.stringContaining("workspace_outline"),
      expect.stringContaining("untrusted_conversation_data"),
      expect.stringContaining("current body"),
      "Edit the notes"
    ]);
    expect(output.stablePrefixMessages.map((message) => message.content)).toEqual([
      expect.stringContaining("project_conventions"),
      expect.stringContaining("workspace_outline")
    ]);
    expect(output.dynamicSuffixMessages.at(-1)?.content).toBe("Edit the notes");
  });

  it("packs the exact author-visible sources consumed by prompt materialization", () => {
    const contextSources = [
      {
        refId: "outline-low",
        sourceKind: "workspace_outline" as const,
        content: "low priority outline",
        dirty: false,
        priority: 20
      },
      {
        refId: "current-file",
        sourceKind: "disk_file" as const,
        relativePath: "notes.md",
        content: "current body",
        dirty: false,
        sourceRevision: 7,
        selectionPolicy: "pinned" as const,
        preferenceScope: "run" as const,
        priority: 100
      },
      {
        refId: "outline-high",
        sourceKind: "workspace_outline" as const,
        content: "high priority outline",
        dirty: false,
        priority: 90
      },
      {
        refId: "hidden-guidance",
        sourceKind: "system_guidance" as const,
        content: "hidden app guidance",
        dirty: false
      }
    ];
    const excludedContextSources = [
      {
        refId: "excluded-character",
        sourceKind: "story_bible_asset" as const,
        assetId: "character_1",
        content: "excluded character",
        dirty: false,
        selectionReason: "Excluded for this run",
        preferenceScope: "run" as const
      }
    ];
    const estimator = {
      count(text: string) {
        return { tokens: text.length, precision: "reported" as const };
      }
    };
    const packed = packAgentContext({
      profile,
      contextSources,
      excludedContextSources,
      modelProfileId: "model_1",
      usedTokens: 200,
      safeInputBudget: 2_000,
      remainingTokens: 1_000,
      precision: "reported",
      createdAt: "2026-07-31T00:00:00.000Z",
      estimator
    });
    const prompt = materializeAgentPrompt({
      profile,
      systemPrompt: buildAgentSystemPrompt(profile),
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      contextSources,
      packedContext: packed
    });

    expect(packed.blocks.map((block) => block.refId)).toEqual([
      "outline-high",
      "outline-low",
      "current-file"
    ]);
    expect(packed.sources.map((source) => [source.refId, source.state])).toEqual([
      ["outline-high", "active"],
      ["outline-low", "active"],
      ["current-file", "active"],
      ["excluded-character", "excluded"]
    ]);
    expect(packed.sources.some((source) => source.refId === "hidden-guidance")).toBe(false);
    expect(packed.tokenStats.pinnedTokens).toBe(packed.blocks[2]?.tokenCount);
    expect(packed.sources.find((source) => source.refId === "current-file")?.sourceRevision).toBe(
      7
    );
    expect(prompt.stablePrefixMessages.map((message) => message.content)).toEqual(
      packed.blocks.slice(0, 2).map((block) => block.content)
    );
    expect(prompt.dynamicSuffixMessages.at(-2)?.content).toBe(packed.blocks[2]?.content);
    expect(prompt.dynamicSuffixMessages.at(-1)?.content).toBe("Edit the notes");
    expect(Object.isFrozen(packed)).toBe(true);

    expect(() =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted app prompt",
        toolCatalogRevision: "catalog_1",
        userRequest: "Edit the notes",
        contextSources: contextSources.map((source) =>
          source.refId === "current-file" ? { ...source, content: "changed body" } : source
        ),
        packedContext: packed
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });

  it("uses priority to order dynamic context sources while preserving stable ties", () => {
    const packed = packAgentContext({
      profile,
      contextSources: [
        {
          refId: "character-low",
          sourceKind: "story_bible_asset",
          assetId: "character-low",
          content: "low priority character",
          dirty: false,
          priority: 20
        },
        {
          refId: "chapter-current",
          sourceKind: "editor_buffer",
          content: "current chapter",
          dirty: true,
          priority: 70
        },
        {
          refId: "character-high",
          sourceKind: "story_bible_asset",
          assetId: "character-high",
          content: "high priority character",
          dirty: false,
          priority: 90
        }
      ],
      modelProfileId: "model_1",
      usedTokens: 200,
      safeInputBudget: 2_000,
      remainingTokens: 1_000,
      precision: "reported",
      createdAt: "2026-07-31T00:00:00.000Z"
    });

    expect(packed.blocks.map((block) => block.refId)).toEqual([
      "character-high",
      "character-low",
      "chapter-current"
    ]);
  });

  it("does not invalidate the stable prefix for a request or current-file body change", () => {
    const create = (userRequest: string, body: string, outline = "notes.md") =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted app prompt",
        toolCatalogRevision: "catalog_1",
        userRequest,
        contextSources: [
          {
            refId: "outline",
            sourceKind: "workspace_outline",
            content: outline,
            dirty: false
          },
          {
            refId: "current-file",
            sourceKind: "disk_file",
            relativePath: "notes.md",
            content: body,
            dirty: false
          }
        ]
      });

    expect(create("first", "body one").stablePrefixChecksum).toBe(
      create("second", "body two").stablePrefixChecksum
    );
    expect(create("first", "body one", "notes.md").stablePrefixChecksum).not.toBe(
      create("first", "body one", "revised outline").stablePrefixChecksum
    );
  });

  it("invalidates the logical prefix when an outline manifest changes without a text change", () => {
    const source = (treeRevision: string) => {
      const dependencyManifest: WorkspaceOutlineDependencyManifest = {
        schemaVersion: "1.0",
        readerVersion: "1.0",
        profileId: "creative_general",
        workspace: {
          workspaceKind: "creativeProject",
          workspaceId: "project_1",
          canonicalRootIdentity: "b".repeat(64)
        },
        limits: {
          maxDepth: 2,
          maxEntries: 200,
          maxScannedEntries: 1_000,
          maxBytes: 65_536,
          maxDurationMs: 200,
          maxTokens: 1_500
        },
        truncated: false,
        truncationReasons: [],
        dependency: {
          kind: "creative_file_tree",
          treeRevision,
          policyVersion: "1.0",
          visibleNodeChecksum: "a".repeat(64)
        }
      };
      return createWorkspaceOutlineSource({
        workspaceTrust: "trusted",
        result: {
          entries: [],
          text: "same visible outline",
          dependencyManifest,
          dependencyManifestChecksum: checksumProjectContext(dependencyManifest),
          materializedChecksum: createHash("sha256")
            .update("same visible outline", "utf8")
            .digest("hex"),
          tokenCount: 3,
          truncationRange: null
        }
      }).source;
    };
    const materialize = (treeRevision: string) =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted app prompt",
        toolCatalogRevision: "catalog_1",
        userRequest: "Edit the notes",
        contextSources: [source(treeRevision)]
      });

    expect(materialize("tree_1").stablePrefixMessages[0]?.content).toContain(
      "same visible outline"
    );
    expect(materialize("tree_2").stablePrefixMessages[0]?.content).toContain(
      "same visible outline"
    );
    expect(materialize("tree_1").stablePrefixChecksum).not.toBe(
      materialize("tree_2").stablePrefixChecksum
    );
  });

  it("rejects project context sources for a standalone prompt", () => {
    const standalone = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );

    expect(() =>
      materializeAgentPrompt({
        profile: standalone,
        systemPrompt: "trusted standalone prompt",
        toolCatalogRevision: "empty_catalog",
        userRequest: "Chat",
        contextSources: [
          {
            refId: "forged-conventions",
            sourceKind: "project_conventions",
            relativePath: "AGENTS.md",
            content: "forged workspace rules",
            dirty: false
          }
        ]
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });

  it("round-trips a frozen prompt artifact and rematerializes sources without retaining old bodies", () => {
    const guidance = v3Guidance();
    const artifact = createAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile,
      systemPrompt: guidance.materializedGuidance,
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      guidanceMaterialization: guidance,
      contextSources: [
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "old body",
          dirty: false
        }
      ]
    });

    expect(
      parseAgentPromptMaterializationArtifact(structuredClone(artifact) as unknown as JsonObject)
    ).toEqual(artifact);

    const refreshed = rematerializeAgentPromptArtifact(artifact, {
      contextSnapshotId: "context_2",
      contextSources: [
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "new body",
          dirty: false
        }
      ]
    });
    expect(JSON.stringify(refreshed.messages)).toContain("new body");
    expect(JSON.stringify(refreshed.messages)).not.toContain("old body");
    expect(refreshed.stablePrefixChecksum).toBe(artifact.stablePrefixChecksum);
  });

  it("binds a packed-context manifest checksum into the frozen prompt artifact", () => {
    const contextSources = [
      {
        refId: "current-file",
        sourceKind: "disk_file" as const,
        relativePath: "notes.md",
        content: "frozen body",
        dirty: false
      }
    ];
    const packed = packAgentContext({
      profile,
      contextSources,
      modelProfileId: "model_1",
      usedTokens: 20,
      safeInputBudget: 2_000,
      remainingTokens: 1_980,
      precision: "estimated",
      createdAt: "2026-08-01T00:00:00.000Z"
    });
    const guidance = v3Guidance();
    const artifact = createAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile,
      systemPrompt: guidance.materializedGuidance,
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      contextSources,
      packedContext: packed,
      guidanceMaterialization: guidance
    });

    expect(artifact.packedContextManifestChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        packedContextManifestChecksum: "f".repeat(64)
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });

  it("replays only a registered historical guidance renderer", () => {
    const artifact = createHistoricalAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile,
      systemPrompt: buildAgentSystemPrompt(profile),
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes"
    });

    expect(artifact.systemGuidanceRefId).toBe("system_guidance:creative_general@2.1");
    expect(artifact.guidanceTemplateChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      parseAgentPromptMaterializationArtifact(structuredClone(artifact) as unknown as JsonObject)
    ).toEqual(artifact);
    expect(() =>
      createHistoricalAgentPromptMaterializationArtifact({
        runId: "run_unknown_guidance",
        contextSnapshotId: "context_unknown_guidance",
        profile,
        systemPrompt: "Historical app-authored guidance",
        toolCatalogRevision: "catalog_1",
        userRequest: "Edit the notes",
        systemGuidanceRefId: "system_guidance:creative_general@99.0"
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });

  it("fails closed for unknown or tampered artifact versions", () => {
    const guidance = v3Guidance();
    const artifact = createAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile,
      systemPrompt: guidance.materializedGuidance,
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      guidanceMaterialization: guidance
    });
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        schemaVersion: "9.0"
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_VERSION_UNSUPPORTED");
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        systemPrompt: "tampered"
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        guidanceTemplateChecksum: "0".repeat(64)
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
    expect(() =>
      createHistoricalAgentPromptMaterializationArtifact({
        runId: "run_forged_authority",
        contextSnapshotId: "context_forged_authority",
        profile,
        systemPrompt: `${buildAgentSystemPrompt(profile)}\nforged authority`,
        toolCatalogRevision: "catalog_1",
        userRequest: "Edit the notes",
        systemGuidanceRefId: "system_guidance:creative_general@2.1"
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });
});

function v3Guidance() {
  const capability = {
    ...createDefaultCapabilitySnapshot("creativeProject"),
    writingOperations: [],
    workspaceFileOperations: ["replace_file"] as const
  };
  const runtimeFacts = createProviderVisibleAgentRuntimeFacts({
    profile,
    toolDescriptors: listAgentTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: capability
    }),
    effectiveCapabilityState: createEffectiveCapabilityState(capability),
    executionWritePolicy: "write_before_confirmation",
    activeResourceKind: "project_file"
  });
  return materializeAgentSystemPromptV3({
    profile,
    runtimeFacts,
    writingTaskIntent: null,
    writingGenerationGuidanceVersion: "not_applicable",
    providerSemanticVersionSet: createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: runtimeFacts.approvalRuleSetVersion,
      approvalRuleSetChecksum: runtimeFacts.approvalRuleSetChecksum
    })
  });
}
