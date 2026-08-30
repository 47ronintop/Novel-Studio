import { createHash } from "node:crypto";

import {
  computeAgentRunToolCatalogRevision,
  computeAgentRunToolCatalogRevisionV2,
  createDeterministicTokenEstimator,
  freezeAgentToolCapabilitySnapshot,
  listAgentTools,
  type AgentToolDescriptor,
  type AgentToolFacadeVersion
} from "@novel-studio/agent-engine";
import type { JsonObject } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import {
  AGENT_CONTEXT_BUDGET_CONTRACT_VERSION,
  calculateResolvedContextBudget,
  readResolvedContextBudgetUsageLimits,
  resolveBudgetInputs
} from "../src/agent-context-budget.js";
import { materializeAgentPrompt } from "../src/agent-prompt-materializer.js";
import { buildAgentSystemPrompt } from "../src/agent-system-prompt.js";
import { resolveAgentContextProfile } from "../src/agent-context-profile.js";

const capability = freezeAgentToolCapabilitySnapshot({
  workspaceKind: "engineeringWorkspace",
  searchEnabled: true,
  fileLifecycleEnabled: true,
  controlledExecutionEnabled: false,
  gitReadEnabled: false,
  networkReadEnabled: true,
  pluginToolsEnabled: false,
  mcpToolsEnabled: true,
  featureFlagRevision: "c4-test"
});

function externalDescriptor(
  id: NonNullable<AgentToolDescriptor["id"]>,
  providerName: string
): AgentToolDescriptor {
  const sourceId = id.split(":")[1]?.split("/")[0] ?? "server";
  return {
    id,
    name: providerName,
    providerName,
    displayName: providerName,
    description: `Remote descriptor ${id}`,
    kind: "external_tool",
    effect: "external_read",
    dataEgress: "remote_tool_arguments",
    destructive: false,
    retrySemantics: "safe",
    source: { kind: "mcp", id: sourceId },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    descriptorDigest: "0".repeat(64)
  };
}

function descriptors(
  facadeVersion: AgentToolFacadeVersion,
  externalToolDescriptors: readonly AgentToolDescriptor[] = []
) {
  return listAgentTools({
    facadeVersion,
    operationMode: "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    capabilitySnapshot: capability,
    externalToolDescriptors
  });
}

function resolve(
  overrides: {
    provider?: string;
    facadeVersion?: AgentToolFacadeVersion;
    descriptors?: readonly AgentToolDescriptor[];
    contextWindow?: number;
    omitContextWindow?: boolean;
    requiredContextTokens?: number;
    maxOutputTokens?: number;
    catalogRevision?: string;
    omitToolCatalog?: boolean;
    omitOutlineFromPrompt?: boolean;
    sharing?: { readonly defaultsRevision: string; readonly grantRevision: string };
  } = {}
) {
  const profile = resolveAgentContextProfile(
    {
      kind: "workspace",
      workspaceKind: "engineeringWorkspace",
      workspaceId: "workspace_01"
    },
    "execution",
    "general_file"
  );
  const facadeVersion = overrides.facadeVersion ?? "v2";
  const toolDescriptors = overrides.descriptors ?? descriptors(facadeVersion);
  const systemPrompt = buildAgentSystemPrompt(profile);
  const contextSources = [
    {
      refId: "conventions_01",
      sourceKind: "project_conventions" as const,
      relativePath: "AGENTS.md",
      content: "Run focused tests.",
      dirty: false
    },
    {
      refId: "outline_01",
      sourceKind: "workspace_outline" as const,
      content: "src/\n  index.ts",
      dirty: false
    }
  ];
  const prompt = materializeAgentPrompt({
    profile,
    systemPrompt,
    toolCatalogRevision:
      overrides.catalogRevision ??
      computeAgentRunToolCatalogRevision(facadeVersion, toolDescriptors),
    userRequest: "Fix the parser.",
    contextSources: overrides.omitOutlineFromPrompt
      ? contextSources.filter((source) => source.sourceKind !== "workspace_outline")
      : contextSources
  });
  const input = {
    provider: overrides.provider ?? "openai-compatible",
    model: "model-c4",
    modelProfileId: "profile-c4",
    ...(overrides.omitContextWindow === true
      ? {}
      : { contextWindow: overrides.contextWindow ?? 128_000 }),
    requiredContextTokens: overrides.requiredContextTokens ?? 8_000,
    ...(overrides.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: overrides.maxOutputTokens }),
    profile,
    prompt,
    contextSources,
    toolCatalog: {
      facadeVersion,
      catalogRevision:
        overrides.catalogRevision ??
        computeAgentRunToolCatalogRevision(facadeVersion, toolDescriptors),
      descriptors: toolDescriptors
    },
    ...(overrides.sharing === undefined ? {} : { sharing: overrides.sharing }),
    estimator: createDeterministicTokenEstimator()
  };
  return resolveBudgetInputs(
    overrides.omitToolCatalog ? { ...input, toolCatalog: undefined as never } : input
  );
}

describe("C4 shared budget inputs", () => {
  test("freezes auditable operands and includes real prompt wrappers", () => {
    const result = resolve();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(AGENT_CONTEXT_BUDGET_CONTRACT_VERSION);
    expect(result.value.systemReserve).toBeGreaterThan(0);
    expect(result.value.usedTokens).toBeGreaterThan(0);
    expect(result.value.toolReserve).toBeGreaterThan(0);
    expect(result.value.toolCatalog.descriptorCount).toBeGreaterThan(0);
    expect(result.value.operandsChecksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("binds sharing defaults and Run grant revisions into operands and persisted proof", () => {
    const sharing = {
      defaultsRevision: "a".repeat(64),
      grantRevision: "b".repeat(64)
    };
    const withSharing = resolve({ sharing });
    const withoutSharing = resolve();
    expect(withSharing.ok && withoutSharing.ok).toBe(true);
    if (!withSharing.ok || !withoutSharing.ok) return;
    expect(withSharing.value.sharing).toEqual(sharing);
    expect(withSharing.value.operandsChecksum).not.toBe(withoutSharing.value.operandsChecksum);

    const snapshot = calculateResolvedContextBudget({
      contextBudgetSnapshotId: "budget_sharing",
      resolved: withSharing.value,
      calculatedAt: "2026-08-04T00:00:00.000Z"
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.audit.sharing).toEqual(sharing);
    const expected = {
      contextBudgetSnapshotId: snapshot.value.contextBudgetSnapshotId,
      provider: withSharing.value.provider,
      model: withSharing.value.model,
      modelProfileId: withSharing.value.modelProfileId,
      contextWindow: withSharing.value.contextWindow,
      facadeVersion: withSharing.value.toolCatalog.facadeVersion,
      catalogRevision: withSharing.value.toolCatalog.catalogRevision,
      sharing
    };
    expect(
      readResolvedContextBudgetUsageLimits(snapshot.value as unknown as JsonObject, expected)
    ).toMatchObject({ ok: true });
    expect(
      readResolvedContextBudgetUsageLimits(snapshot.value as unknown as JsonObject, {
        ...expected,
        sharing: { ...sharing, grantRevision: "c".repeat(64) }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID" } });
  });

  test("provider transport shapes change tool reserve deterministically", () => {
    const openai = resolve({ provider: "openai-compatible" });
    const anthropic = resolve({ provider: "anthropic" });
    const gemini = resolve({ provider: "google-gemini" });
    expect(openai.ok && anthropic.ok && gemini.ok).toBe(true);
    if (!openai.ok || !anthropic.ok || !gemini.ok) return;
    expect(
      new Set([openai.value.toolReserve, anthropic.value.toolReserve, gemini.value.toolReserve])
        .size
    ).toBeGreaterThan(1);
    expect(resolve({ provider: "anthropic" })).toEqual(anthropic);
  });

  test("uses the resolved profile output cap for the safe input budget", () => {
    const result = resolve({ maxOutputTokens: 64_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxOutputTokens).toBe(64_000);

    const snapshot = calculateResolvedContextBudget({
      contextBudgetSnapshotId: "budget_max_output",
      resolved: result.value,
      calculatedAt: "2026-08-30T00:00:00.000Z"
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.outputReserve).toBe(64_000);
    expect(snapshot.value.safeInputBudget).toBe(
      snapshot.value.contextWindow -
        64_000 -
        snapshot.value.toolReserve -
        snapshot.value.systemReserve
    );
    expect(snapshot.value.audit.requestedMaxOutputTokens).toBe(64_000);
    const expected = {
      contextBudgetSnapshotId: snapshot.value.contextBudgetSnapshotId,
      provider: result.value.provider,
      model: result.value.model,
      modelProfileId: result.value.modelProfileId,
      contextWindow: result.value.contextWindow,
      maxOutputTokens: 64_000,
      facadeVersion: result.value.toolCatalog.facadeVersion,
      catalogRevision: result.value.toolCatalog.catalogRevision
    };
    expect(
      readResolvedContextBudgetUsageLimits(snapshot.value as unknown as JsonObject, expected)
    ).toMatchObject({ ok: true });
    expect(
      readResolvedContextBudgetUsageLimits(snapshot.value as unknown as JsonObject, {
        ...expected,
        maxOutputTokens: 63_999
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID" }
    });
  });

  test("v1/v2 and network/MCP descriptors affect the frozen reserve", () => {
    const v1 = resolve({ facadeVersion: "v1", descriptors: descriptors("v1") });
    const v2 = resolve({ facadeVersion: "v2", descriptors: descriptors("v2") });
    const withNetworkDescriptors = descriptors("v2");
    const withoutNetworkDescriptors = withNetworkDescriptors.filter(
      (tool) => tool.kind !== "network_tool"
    );
    const withNetwork = resolve({ facadeVersion: "v2", descriptors: withNetworkDescriptors });
    const withoutNetwork = resolve({
      facadeVersion: "v2",
      descriptors: withoutNetworkDescriptors
    });
    const withMcp = [
      ...withNetworkDescriptors,
      externalDescriptor("mcp:docs/search", "mcp__docs__search")
    ];
    const withRemote = resolve({ facadeVersion: "v2", descriptors: withMcp });
    expect(v1.ok && v2.ok && withNetwork.ok && withoutNetwork.ok && withRemote.ok).toBe(true);
    if (!v1.ok || !v2.ok || !withNetwork.ok || !withoutNetwork.ok || !withRemote.ok) return;
    expect(v1.value.toolReserve).not.toBe(v2.value.toolReserve);
    expect(withNetwork.value.toolReserve).toBeGreaterThan(withoutNetwork.value.toolReserve);
    expect(withRemote.value.toolReserve).toBeGreaterThan(withNetwork.value.toolReserve);
  });

  test("proves standalone zero reserve with the frozen empty catalog checksum", () => {
    const profile = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );
    const descriptors: readonly AgentToolDescriptor[] = [];
    const catalogRevision = computeAgentRunToolCatalogRevision("v2", descriptors);
    const systemPrompt = buildAgentSystemPrompt(profile);
    const prompt = materializeAgentPrompt({
      profile,
      systemPrompt,
      toolCatalogRevision: catalogRevision,
      userRequest: "Help me think this through."
    });
    const result = resolveBudgetInputs({
      provider: "anthropic",
      model: "claude-test",
      modelProfileId: "profile-standalone",
      contextWindow: 32_768,
      requiredContextTokens: 8_000,
      profile,
      prompt,
      contextSources: [],
      toolCatalog: { facadeVersion: "v2", catalogRevision, descriptors }
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        toolReserve: 0,
        toolCatalog: { descriptorCount: 0, catalogRevision }
      }
    });
    if (result.ok) expect(result.value.systemReserve).toBeGreaterThan(0);
  });

  test("budgets a persisted standalone compaction summary without admitting project sources", () => {
    const profile = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );
    const toolDescriptors: readonly AgentToolDescriptor[] = [];
    const catalogRevision = computeAgentRunToolCatalogRevision("v2", toolDescriptors);
    const summaryBody = JSON.stringify({
      userGoal: "Continue the discussion",
      decisions: [],
      constraints: [],
      openQuestions: [],
      nextSteps: []
    });
    const contextSources = [
      {
        refId: "compaction_summary",
        sourceKind: "compaction_summary" as const,
        assetId: "summary_compaction_01",
        content: summaryBody,
        dirty: false
      }
    ];
    const prompt = materializeAgentPrompt({
      profile,
      systemPrompt: buildAgentSystemPrompt(profile),
      toolCatalogRevision: catalogRevision,
      userRequest: "Help me think this through.",
      contextSources
    });

    expect(
      resolveBudgetInputs({
        provider: "anthropic",
        model: "claude-test",
        modelProfileId: "profile-standalone",
        contextWindow: 32_768,
        requiredContextTokens: 8_000,
        profile,
        prompt,
        contextSources,
        artifactPointers: [
          {
            artifactId: "summary_compaction_01",
            kind: "compaction_summary",
            checksum: createHash("sha256").update(summaryBody, "utf8").digest("hex")
          }
        ],
        toolCatalog: {
          facadeVersion: "v2",
          catalogRevision,
          descriptors: toolDescriptors
        }
      })
    ).toMatchObject({ ok: true, value: { toolReserve: 0 } });
  });

  test("rejects a standalone compaction summary without its immutable artifact pointer", () => {
    const profile = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );
    const toolDescriptors: readonly AgentToolDescriptor[] = [];
    const catalogRevision = computeAgentRunToolCatalogRevision("v2", toolDescriptors);
    const contextSources = [
      {
        refId: "compaction_summary",
        sourceKind: "compaction_summary" as const,
        assetId: "summary_compaction_missing_pointer",
        content:
          '{"userGoal":"Continue","decisions":[],"constraints":[],"openQuestions":[],"nextSteps":[]}',
        dirty: false
      }
    ];
    const prompt = materializeAgentPrompt({
      profile,
      systemPrompt: buildAgentSystemPrompt(profile),
      toolCatalogRevision: catalogRevision,
      userRequest: "Continue.",
      contextSources
    });

    expect(
      resolveBudgetInputs({
        provider: "anthropic",
        model: "claude-test",
        modelProfileId: "profile-standalone",
        contextWindow: 32_768,
        requiredContextTokens: 8_000,
        profile,
        prompt,
        contextSources,
        toolCatalog: {
          facadeVersion: "v2",
          catalogRevision,
          descriptors: toolDescriptors
        }
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID",
        redactedDetail: { field: "standalone.compactionSummaryPointer" }
      }
    });
  });

  test("rejects workspace sources missing from the frozen prompt", () => {
    expect(resolve({ omitOutlineFromPrompt: true })).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID",
        redactedDetail: { field: "prompt.contextSources" }
      }
    });
  });

  test.each([
    ["project sources", "standalone.contextSources"],
    ["tools", "standalone.toolCatalog"]
  ])("rejects standalone %s", (kind, field) => {
    const profile = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );
    const toolDescriptors = kind === "tools" ? descriptors("v2").slice(0, 1) : [];
    const catalogRevision = computeAgentRunToolCatalogRevision("v2", toolDescriptors);
    const contextSources =
      kind === "project sources"
        ? [
            {
              refId: "outline_forbidden",
              sourceKind: "workspace_outline" as const,
              content: "src/",
              dirty: false
            }
          ]
        : [];
    const prompt = materializeAgentPrompt({
      profile,
      systemPrompt: buildAgentSystemPrompt(profile),
      toolCatalogRevision: catalogRevision,
      userRequest: "Help me think this through."
    });
    expect(
      resolveBudgetInputs({
        provider: "anthropic",
        model: "claude-test",
        modelProfileId: "profile-standalone",
        contextWindow: 32_768,
        requiredContextTokens: 8_000,
        profile,
        prompt,
        contextSources,
        toolCatalog: { facadeVersion: "v2", catalogRevision, descriptors: toolDescriptors }
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID", redactedDetail: { field } }
    });
  });

  test.each([
    ["unknown context window", "contextWindow"],
    ["negative required tokens", "requiredContextTokens"],
    ["missing catalog proof", "toolCatalog.catalogRevision"],
    ["missing tool catalog", "toolCatalog"]
  ])("fails closed for %s", (name, field) => {
    const result =
      name === "unknown context window"
        ? resolve({ omitContextWindow: true })
        : name === "negative required tokens"
          ? resolve({ requiredContextTokens: -1 })
          : name === "missing catalog proof"
            ? resolve({ catalogRevision: "" })
            : resolve({ omitToolCatalog: true });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID",
        redactedDetail: { field }
      }
    });
  });

  test("fails closed when resolved reserves make the safe budget negative", () => {
    const resolved = resolve({ contextWindow: 1_024, requiredContextTokens: 0 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(
      calculateResolvedContextBudget({
        contextBudgetSnapshotId: "budget_negative",
        resolved: resolved.value,
        calculatedAt: "2026-07-28T00:00:00.000Z"
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_CONTEXT_BUDGET_INSUFFICIENT",
        redactedDetail: { safeInputBudget: expect.any(Number) }
      }
    });
  });

  test("reuses only an intact proof-bearing persisted budget", () => {
    const resolved = resolve();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const snapshot = calculateResolvedContextBudget({
      contextBudgetSnapshotId: "budget_persisted",
      resolved: resolved.value,
      calculatedAt: "2026-07-28T00:00:00.000Z"
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const expected = {
      contextBudgetSnapshotId: snapshot.value.contextBudgetSnapshotId,
      provider: resolved.value.provider,
      model: resolved.value.model,
      modelProfileId: resolved.value.modelProfileId,
      contextWindow: resolved.value.contextWindow,
      facadeVersion: resolved.value.toolCatalog.facadeVersion,
      catalogRevision: resolved.value.toolCatalog.catalogRevision
    };
    expect(
      readResolvedContextBudgetUsageLimits(snapshot.value as unknown as JsonObject, expected)
    ).toEqual({
      ok: true,
      value: {
        contextWindow: snapshot.value.contextWindow,
        safeInputBudget: snapshot.value.safeInputBudget
      }
    });
    expect(
      readResolvedContextBudgetUsageLimits(
        {
          ...snapshot.value,
          safeInputBudget: snapshot.value.safeInputBudget + 1
        } as unknown as JsonObject,
        expected
      )
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID" }
    });
    const tamperedToolReserve = snapshot.value.toolReserve + 1;
    const tamperedSafeInputBudget = snapshot.value.safeInputBudget - 1;
    expect(
      readResolvedContextBudgetUsageLimits(
        {
          ...snapshot.value,
          toolReserve: tamperedToolReserve,
          safeInputBudget: tamperedSafeInputBudget,
          remainingTokens: Math.max(0, tamperedSafeInputBudget - snapshot.value.usedTokens),
          audit: {
            ...snapshot.value.audit,
            operandsChecksum: "f".repeat(64)
          }
        } as unknown as JsonObject,
        expected
      )
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID" }
    });
  });

  test("round-trips a persisted Catalog 2.0 budget with its schema identity", () => {
    const standaloneProfile = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );
    const v2Descriptors: readonly AgentToolDescriptor[] = [];
    const catalogRevision = computeAgentRunToolCatalogRevisionV2({
      descriptors: v2Descriptors,
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable",
      approvalRules: []
    });
    const prompt = materializeAgentPrompt({
      profile: standaloneProfile,
      systemPrompt: buildAgentSystemPrompt(standaloneProfile),
      toolCatalogRevision: catalogRevision,
      userRequest: "Help me think this through."
    });
    const resolved = resolveBudgetInputs({
      provider: "anthropic",
      model: "claude-test",
      modelProfileId: "profile-standalone",
      contextWindow: 32_768,
      requiredContextTokens: 8_000,
      profile: standaloneProfile,
      prompt,
      contextSources: [],
      toolCatalog: {
        facadeVersion: "v2",
        schemaVersion: "2.0",
        catalogRevision,
        descriptors: v2Descriptors
      }
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const snapshot = calculateResolvedContextBudget({
      contextBudgetSnapshotId: "budget_catalog_v2",
      resolved: resolved.value,
      calculatedAt: "2026-08-03T00:00:00.000Z"
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    expect(
      readResolvedContextBudgetUsageLimits(snapshot.value as unknown as JsonObject, {
        contextBudgetSnapshotId: snapshot.value.contextBudgetSnapshotId,
        provider: resolved.value.provider,
        model: resolved.value.model,
        modelProfileId: resolved.value.modelProfileId,
        contextWindow: resolved.value.contextWindow,
        facadeVersion: "v2",
        schemaVersion: "2.0",
        catalogRevision
      })
    ).toEqual({
      ok: true,
      value: {
        contextWindow: snapshot.value.contextWindow,
        safeInputBudget: snapshot.value.safeInputBudget
      }
    });
  });
});
