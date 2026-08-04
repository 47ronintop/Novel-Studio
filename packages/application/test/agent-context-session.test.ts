import { ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import { beforeEach, describe, expect, test } from "vitest";

import {
  createAgentContextSession,
  type AgentContextBudgetInputs,
  type AgentContextBudgetInputsPort,
  type PackedAgentContextBinding
} from "../src/agent-context-session.js";
import { resolveAgentContextProfile } from "../src/agent-context-profile.js";
import {
  createAgentRunDraftSession,
  type AgentRunDraftSession,
  type SyncStartDraftCommand
} from "../src/agent-run-draft-session.js";
import type {
  AgentContextSourceInput,
  AgentRunDraft,
  AgentRunDraftV20,
  PreviewContextBudgetCommand
} from "@novel-studio/agent-engine";
import { createProviderSemanticVersionSetV1 } from "@novel-studio/agent-engine";
import {
  freezeRunModelSharingGrant,
  freezeWorkspaceModelSharingDefaults
} from "../src/agent-model-sharing.js";

function createMemoryRepository() {
  const runDrafts = new Map<string, Map<number, JsonObject>>();
  const contextDrafts = new Map<string, Map<number, JsonObject>>();

  function write(
    store: Map<string, Map<number, JsonObject>>,
    draft: JsonObject
  ): Result<JsonObject, UnifiedError> {
    const conversationId = draft["conversationId"] as string;
    const revision = draft["revision"] as number;
    const byRevision = store.get(conversationId) ?? new Map<number, JsonObject>();
    byRevision.set(revision, draft);
    store.set(conversationId, byRevision);
    return ok(draft);
  }

  function readLatest(
    store: Map<string, Map<number, JsonObject>>,
    conversationId: string
  ): Result<JsonObject | undefined, UnifiedError> {
    const byRevision = store.get(conversationId);
    if (byRevision === undefined || byRevision.size === 0) return ok(undefined);
    const latest = [...byRevision.keys()].sort((left, right) => right - left).at(0);
    if (latest === undefined) return ok(undefined);
    return ok(byRevision.get(latest));
  }

  return {
    writeRunDraft: (draft: JsonObject) => Promise.resolve(write(runDrafts, draft)),
    readLatestRunDraft: (conversationId: string) =>
      Promise.resolve(readLatest(runDrafts, conversationId)),
    writeContextDraft: (draft: JsonObject) => Promise.resolve(write(contextDrafts, draft)),
    readLatestContextDraft: (conversationId: string) =>
      Promise.resolve(readLatest(contextDrafts, conversationId))
  };
}

const syncCommand: SyncStartDraftCommand = {
  projectId: "project_01",
  conversationId: "conv_01",
  commandId: "sync_01",
  userRequest: "写下一章",
  operationMode: "execution",
  contextMode: "writing",
  writePolicy: "write_before_confirmation",
  writePolicyAcknowledged: false,
  modelProfileId: "profile_01",
  contextRefs: []
};

function budgetInputsPort(
  inputs: AgentContextBudgetInputs,
  onCall?: () => void
): AgentContextBudgetInputsPort {
  return {
    async resolveBudgetInputs() {
      onCall?.();
      return ok(inputs);
    }
  };
}

const facts128k: AgentContextBudgetInputs = {
  model: {
    provider: "demo",
    model: "large",
    contextWindow: 128000,
    maxOutputTokens: 8000,
    toolReserve: 2000,
    systemReserve: 1000,
    requiredContextTokens: 8000
  },
  contents: [],
  resolved: resolvedBudget({
    provider: "demo",
    model: "large",
    contextWindow: 128000,
    maxOutputTokens: 8000,
    toolReserve: 2000,
    systemReserve: 1000,
    requiredContextTokens: 8000
  })
};

function resolvedBudget(
  model: AgentContextBudgetInputs["model"],
  usedTokens = 32,
  precision: AgentContextBudgetInputs["resolved"]["precision"] = "estimated"
): AgentContextBudgetInputs["resolved"] {
  return {
    schemaVersion: "1.0",
    provider: model.provider,
    model: model.model,
    modelProfileId: "profile_01",
    contextWindow: model.contextWindow,
    ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
    requiredContextTokens: model.requiredContextTokens,
    toolReserve: model.toolReserve,
    systemReserve: model.systemReserve,
    usedTokens,
    precision,
    toolCatalog: {
      facadeVersion: "v2",
      catalogRevision: "a".repeat(64),
      descriptorChecksum: "b".repeat(64),
      descriptorCount: 1
    },
    systemMaterializationChecksum: "c".repeat(64),
    usedMaterializationChecksum: "d".repeat(64),
    operandsChecksum: "e".repeat(64)
  };
}

async function seedDraft(draftSession: AgentRunDraftSession) {
  const synced = await draftSession.syncStartDraft(syncCommand);
  if (!synced.ok) throw synced.error;
  return synced.value.runDraft;
}

function packingInputs(
  draft: AgentRunDraft | AgentRunDraftV20,
  options: {
    readonly activeSources?: readonly AgentContextSourceInput[];
    readonly excludedSources?: readonly AgentContextSourceInput[];
    readonly usedTokens?: number;
  } = {}
): AgentContextBudgetInputs {
  return {
    ...facts128k,
    resolved: resolvedBudget(facts128k.model, options.usedTokens ?? facts128k.resolved.usedTokens),
    profile: resolveAgentContextProfile(draft.scope, draft.operationMode, draft.contextMode),
    modelProfileId: draft.modelProfileId,
    activeSources: options.activeSources ?? [],
    excludedSources: options.excludedSources ?? []
  };
}

describe("Agent Context session — previewContextBudget", () => {
  let draftSession: AgentRunDraftSession;

  beforeEach(() => {
    draftSession = createAgentRunDraftSession({
      repository: createMemoryRepository(),
      now: () => "2026-07-16T00:00:00.000Z",
      createId: (() => {
        let n = 0;
        return () => `id_${(n += 1)}`;
      })()
    });
  });

  function previewCommand(
    draft: { runDraftId: string; revision: number; checksum: string },
    overrides: Partial<PreviewContextBudgetCommand> = {}
  ): PreviewContextBudgetCommand {
    return {
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "preview_01",
      runDraftId: draft.runDraftId,
      expectedDraftRevision: draft.revision,
      runDraftChecksum: draft.checksum,
      ...overrides
    };
  }

  test("resolves a budget from the draft's model facts and estimated content", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k),
      createBudgetSnapshotId: () => "budget_preview",
      now: () => "2026-07-16T00:00:00.000Z"
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contextBudgetSnapshotId).toBe("budget_preview");
    expect(result.value.safeInputBudget).toBe(128000 - 8000 - 2000 - 1000);
    expect(result.value.usedTokens).toBeGreaterThan(0);
    expect(result.value.precision).toBe("estimated");
  });

  test("uses the single canonical used-token operand", async () => {
    const draft = await seedDraft(draftSession);
    const inputs: AgentContextBudgetInputs = {
      model: facts128k.model,
      contents: [
        { refId: "chapter:ch_01", content: "x".repeat(400) },
        { refId: "story_bible:asset_01", content: "y".repeat(400) }
      ],
      resolved: resolvedBudget(facts128k.model, 237)
    };
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(inputs),
      now: () => "2026-07-16T00:00:00.000Z"
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usedTokens).toBe(237);
    expect(result.value.remainingTokens).toBe(
      result.value.safeInputBudget - result.value.usedTokens
    );
  });

  test("preserves the canonical tokenizer precision", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort({
        ...facts128k,
        resolved: resolvedBudget(facts128k.model, 10, "reported")
      }),
      now: () => "2026-07-16T00:00:00.000Z"
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.precision).toBe("reported");
  });

  test("rejects a stale draft revision without reaching the budget inputs", async () => {
    const draft = await seedDraft(draftSession);
    let called = false;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k, () => {
        called = true;
      })
    });
    const result = await session.previewContextBudget(
      previewCommand(draft, {
        expectedDraftRevision: draft.revision + 1,
        commandId: "preview_stale"
      })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_REVISION_CONFLICT" }
    });
    expect(called).toBe(false);
  });

  test("rejects a checksum mismatch", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k)
    });
    const result = await session.previewContextBudget(
      previewCommand(draft, { runDraftChecksum: "deadbeef", commandId: "preview_checksum" })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_CHECKSUM_MISMATCH" }
    });
  });

  test("propagates an insufficient-window rejection from the calculator", async () => {
    const draft = await seedDraft(draftSession);
    const tiny: AgentContextBudgetInputs = {
      model: {
        provider: "demo",
        model: "tiny",
        contextWindow: 12000,
        maxOutputTokens: 4000,
        toolReserve: 500,
        systemReserve: 500,
        requiredContextTokens: 8000
      },
      contents: [],
      resolved: resolvedBudget({
        provider: "demo",
        model: "tiny",
        contextWindow: 12000,
        maxOutputTokens: 4000,
        toolReserve: 500,
        systemReserve: 500,
        requiredContextTokens: 8000
      })
    };
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(tiny)
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_INSUFFICIENT" }
    });
  });

  test("is idempotent per command id", async () => {
    const draft = await seedDraft(draftSession);
    let calls = 0;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k, () => {
        calls += 1;
      }),
      createBudgetSnapshotId: (() => {
        let n = 0;
        return () => `budget_${(n += 1)}`;
      })()
    });
    const first = await session.previewContextBudget(previewCommand(draft));
    const second = await session.previewContextBudget(previewCommand(draft));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.contextBudgetSnapshotId).toBe(second.value.contextBudgetSnapshotId);
    expect(calls).toBe(1);
  });

  test("normalizes legacy and explicit workspace identities before preview cache lookup", async () => {
    const draft = await seedDraft(draftSession);
    let calls = 0;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k, () => {
        calls += 1;
      }),
      createBudgetSnapshotId: () => "budget_identity"
    });
    const legacy = await session.previewContextBudget(previewCommand(draft));
    const scoped = await session.previewContextBudget(
      previewCommand(draft, {
        scope: {
          kind: "workspace",
          workspaceKind: "creativeProject",
          workspaceId: "project_01"
        }
      })
    );

    expect(legacy).toEqual(scoped);
    expect(calls).toBe(1);
  });

  test("fails closed when the budget port omits canonical operands", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort({
        model: facts128k.model,
        contents: []
      } as unknown as AgentContextBudgetInputs)
    });

    await expect(session.previewContextBudget(previewCommand(draft))).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID" }
    });
  });
});

describe("Agent Context session — previewPackedContext", () => {
  let draftSession: AgentRunDraftSession;

  beforeEach(() => {
    draftSession = createAgentRunDraftSession({
      repository: createMemoryRepository(),
      now: () => "2026-07-16T00:00:00.000Z",
      createId: (() => {
        let n = 0;
        return () => `packed_id_${(n += 1)}`;
      })()
    });
  });

  function command(
    draft: Pick<AgentRunDraft, "runDraftId" | "revision" | "checksum">,
    commandId = "preview_packed_01"
  ): PreviewContextBudgetCommand {
    return {
      projectId: "project_01",
      conversationId: "conv_01",
      commandId,
      runDraftId: draft.runDraftId,
      expectedDraftRevision: draft.revision,
      runDraftChecksum: draft.checksum
    };
  }

  test("returns raw author content while retaining the exact frozen provider payload", async () => {
    const draft = await seedDraft(draftSession);
    const activeSource: AgentContextSourceInput = {
      refId: "story_bible:characters",
      sourceKind: "story_bible_asset",
      assetId: "characters",
      content: "RAW_AUTHOR_STORY_BIBLE_CONTENT",
      dirty: false,
      selectionReason: "Pinned by the author",
      selectionPolicy: "pinned",
      preferenceScope: "run",
      priority: 95
    };
    const excludedSource: AgentContextSourceInput = {
      refId: "story_bible:world",
      sourceKind: "story_bible_asset",
      assetId: "world",
      content: "EXCLUDED_AUTHOR_CONTENT",
      dirty: false,
      selectionReason: "Excluded for this run",
      selectionPolicy: "explicit",
      preferenceScope: "run",
      priority: 40
    };
    let captured: PackedAgentContextBinding | undefined;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(
        packingInputs(draft, {
          activeSources: [activeSource],
          excludedSources: [excludedSource]
        })
      ),
      createBudgetSnapshotId: () => "budget_packed",
      now: () => "2026-07-16T01:00:00.000Z",
      onPackedContext(binding) {
        captured = binding;
      }
    });

    const result = await session.previewPackedContext(command(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budget.contextBudgetSnapshotId).toBe("budget_packed");
    expect(result.value.blocks).toHaveLength(1);
    expect(result.value.blocks[0]).toMatchObject({
      refId: activeSource.refId,
      sourceKind: activeSource.sourceKind,
      order: 0,
      content: activeSource.content
    });
    expect(Object.keys(result.value.blocks[0] ?? {})).not.toContain("role");
    expect(Object.keys(result.value.blocks[0] ?? {})).not.toContain("materialization");
    expect(JSON.stringify(result.value.blocks)).not.toContain("untrusted_project_data");
    expect(result.value.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ refId: activeSource.refId, state: "active" }),
        expect.objectContaining({ refId: excludedSource.refId, state: "excluded" })
      ])
    );
    expect(result.value.blocks.some((block) => block.content === excludedSource.content)).toBe(
      false
    );

    expect(captured).toBeDefined();
    if (captured === undefined) return;
    expect(captured.packedContext.packedContextId).toBe(result.value.packedContextId);
    expect(captured.packedContext.payloadChecksum).toBe(result.value.payloadChecksum);
    expect(captured.packedContext.blocks[0]?.checksum).toBe(result.value.blocks[0]?.checksum);
    expect(captured.packedContext.blocks[0]?.content).toContain("untrusted_project_data");
    expect(captured.runDraft).toEqual({
      runDraftId: draft.runDraftId,
      revision: draft.revision,
      checksum: draft.checksum
    });
    expect(captured.contextDraft.contextDraftId).toBe(draft.contextDraftId);
    expect(captured.activeSources[0]?.content).toBe(activeSource.content);
    expect(captured.excludedSources[0]?.content).toBe(excludedSource.content);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.packedContext)).toBe(true);
    expect(Object.isFrozen(captured.activeSources)).toBe(true);
  });

  test("is concurrent-idempotent without resolving or publishing twice", async () => {
    const draft = await seedDraft(draftSession);
    let draftResolutions = 0;
    let budgetResolutions = 0;
    let publications = 0;
    const resolvingDraftSession = {
      resolveStartDraft(input: Parameters<AgentRunDraftSession["resolveStartDraft"]>[0]) {
        draftResolutions += 1;
        return draftSession.resolveStartDraft(input);
      }
    };
    const session = createAgentContextSession({
      draftSession: resolvingDraftSession,
      budgetInputs: budgetInputsPort(packingInputs(draft), () => {
        budgetResolutions += 1;
      }),
      onPackedContext() {
        publications += 1;
      }
    });

    const [first, second] = await Promise.all([
      session.previewPackedContext(command(draft)),
      session.previewPackedContext(command(draft))
    ]);
    const third = await session.previewPackedContext(command(draft));

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(draftResolutions).toBe(1);
    expect(budgetResolutions).toBe(1);
    expect(publications).toBe(1);
  });

  test("fails closed without packing material while legacy budget preview remains compatible", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k)
    });

    await expect(
      session.previewContextBudget(command(draft, "legacy_budget"))
    ).resolves.toMatchObject({ ok: true });
    await expect(
      session.previewPackedContext(command(draft, "missing_packing"))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PACKED_CONTEXT_INPUTS_INVALID" }
    });
  });

  test("keeps aggregate pressure distinct from pinned-source overflow", async () => {
    const draft = await seedDraft(draftSession);
    const usedTokens = 120_000;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(packingInputs(draft, { usedTokens }))
    });

    const result = await session.previewPackedContext(command(draft, "fixed_overflow"));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONTEXT_PACKING_REQUIRED_OVERFLOW" }
    });
  });

  test("marks pinned sources as fixed overflow even when aggregate used tokens fit", async () => {
    const draft = await seedDraft(draftSession);
    const pinnedSource: AgentContextSourceInput = {
      refId: "story_bible:timeline",
      sourceKind: "story_bible_asset",
      assetId: "timeline",
      content: "PINNED_TIMELINE",
      dirty: false,
      selectionReason: "Pinned by the author",
      selectionPolicy: "pinned",
      preferenceScope: "run",
      priority: 100
    };
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(
        packingInputs(draft, {
          activeSources: [pinnedSource]
        })
      ),
      estimator: {
        count() {
          return { tokens: 120_000, precision: "reported" };
        }
      }
    });

    const result = await session.previewPackedContext(command(draft, "pinned_overflow"));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONTEXT_PACKING_ACTIVE_OR_PINNED_OVERFLOW" }
    });
  });

  test("binds strict sharing, packed manifest 2.0, and canonical round to one version set", async () => {
    const draft = await seedDraft(draftSession);
    const source: AgentContextSourceInput = {
      refId: "story_bible:timeline",
      sourceKind: "story_bible_asset",
      assetId: "timeline",
      content: "The timeline",
      dirty: false,
      selectionPolicy: "pinned"
    };
    const editor: AgentContextSourceInput = {
      refId: "editor:current",
      sourceKind: "editor_buffer",
      content: "current editor text",
      dirty: false,
      selectionPolicy: "explicit"
    };
    const defaults = freezeWorkspaceModelSharingDefaults({
      workspaceBindingId: "project_01",
      defaultsRevision: "1".repeat(64),
      defaults: {
        outlineMetadata: "automatic",
        activeResource: "automatic",
        conversationSummary: "ask",
        toolReadResults: "ask"
      }
    });
    expect(defaults.ok).toBe(true);
    if (!defaults.ok) return;
    const grant = freezeRunModelSharingGrant({
      profileId: "writing",
      workspaceBindingId: "project_01",
      grant: {
        runDraftRevision: String(draft.revision),
        defaultsRevision: defaults.value.defaultsRevision,
        includedRefIds: [source.refId, editor.refId],
        excludedRefIds: [],
        approvedResultKinds: []
      }
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const providerSemanticVersionSet = createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable"
    });
    const inputs = packingInputs(draft, { activeSources: [editor, source] });
    const strictInputs: AgentContextBudgetInputs = {
      ...inputs,
      resolved: {
        ...inputs.resolved,
        sharing: {
          defaultsRevision: defaults.value.defaultsRevision,
          grantRevision: grant.value.grantRevision
        }
      },
      modelSharing: {
        defaults: defaults.value,
        grant: grant.value,
        summaryTokenLimit: 2_048
      },
      canonicalRound: {
        roundId: "round_preview_01",
        runId: "run_preview_01",
        roundNumber: 0,
        systemPrompt: "trusted authority",
        toolCatalogRevision: inputs.resolved.toolCatalog.catalogRevision,
        projectedToolDescriptors: [],
        sharing: {
          defaultsRevision: defaults.value.defaultsRevision,
          runGrantRevision: grant.value.grantRevision
        },
        providerSemanticVersionSet,
        userRequest: draft.userRequest,
        contextSnapshot: {
          contextSnapshotId: "snapshot_preview_01",
          createdAt: "2026-08-04T00:00:00.000Z",
          guidanceTemplateChecksum: "2".repeat(64)
        }
      }
    };
    let binding: PackedAgentContextBinding | undefined;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(strictInputs),
      requireCanonicalRound: true,
      requireModelSharing: true,
      onPackedContext(value) {
        binding = value;
      }
    });

    const result = await session.previewPackedContext(command(draft, "strict_round"));
    expect(result.ok).toBe(true);
    if (!result.ok || binding === undefined) return;
    expect(result.value.packedContextManifestV2?.schemaVersion).toBe("2.0");
    expect(result.value.canonicalRoundManifest?.schemaVersion).toBe("2.0");
    expect(result.value.contextSnapshotV2?.schemaVersion).toBe("2.0");
    expect(result.value.canonicalRoundManifest?.messages.at(-1)).toMatchObject({
      kind: "current_user_request",
      content: draft.userRequest
    });
    expect(result.value.packedContextManifestV2?.providerSemanticVersionSetChecksum).toBe(
      result.value.canonicalRoundManifest?.providerSemanticVersionSetChecksum
    );
    expect(result.value.contextSnapshotV2?.providerSemanticVersionSetChecksum).toBe(
      result.value.canonicalRoundManifest?.providerSemanticVersionSetChecksum
    );
    expect(result.value.contextSnapshotV2?.sources.map(({ refId }) => refId)).toEqual([
      source.refId,
      editor.refId
    ]);
    expect(binding.canonicalRoundManifest?.manifestChecksum).toBe(
      result.value.canonicalRoundManifest?.manifestChecksum
    );
  });

  test("strict workspace preview fails before publishing without a sharing grant", async () => {
    const draft = await seedDraft(draftSession);
    let published = false;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(packingInputs(draft)),
      requireModelSharing: true,
      onPackedContext() {
        published = true;
      }
    });

    await expect(
      session.previewPackedContext(command(draft, "sharing_missing"))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_MODEL_SHARING_BINDING_INVALID" }
    });
    expect(published).toBe(false);
  });
});
