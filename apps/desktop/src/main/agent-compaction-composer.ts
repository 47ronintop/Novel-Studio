import { createHash } from "node:crypto";

import {
  agentContextScopeKey,
  createAgentContextSnapshot,
  createAgentContextSnapshotV2,
  createPackedAgentContextManifest,
  normalizeAgentContextSnapshot,
  normalizeAgentRunEvent,
  normalizeAgentRunSnapshot,
  parseAgentContextSnapshotV2,
  parseAgentRunSnapshotV20,
  usageRecordIdempotencyKey,
  validateAgentUsageRecord,
  validateAgentRunToolCatalogSnapshot,
  type AgentContextLayer,
  type AgentContextSnapshot,
  type AgentContextSnapshotV20,
  type AgentContextSource,
  type AgentRunSnapshot,
  type AgentRunEvent,
  type AgentRunToolCatalogSnapshot,
  type AgentUsageRecord,
  type CompactContextCommand,
  type ContextBudgetSnapshotV11,
  type PlanExecutionRecord,
  type PlanExecutionStepStatus
} from "@novel-studio/agent-engine";
import {
  calculateResolvedContextBudget,
  createAgentPromptMaterializationArtifact,
  deriveAgentPromptCacheIdentityChecksum,
  deriveAgentPromptCacheIdentityChecksumV2,
  resolveBudgetInputs,
  materializeCanonicalAgentRound,
  parseAgentPromptMaterializationArtifact,
  parseCompactionSummaryArtifact,
  materializeAgentRunHistory,
  packAgentContext,
  promptMaterializationArtifactId,
  rematerializeAgentPromptArtifact,
  type AgentPromptMaterializationArtifact,
  type AgentCompactionSummaryArtifact,
  CompactContextSourcesPort,
  CompactionArtifactRequest,
  CompactionArtifacts,
  CompactionInputs,
  AgentPricingRegistry,
  AgentUsageTimeFacts,
  EvictableContextSource,
  ProtectedContextFact
} from "@novel-studio/application";
import type { AgentRunFileRepository } from "@novel-studio/repository";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

/**
 * How much of the safe input budget a compaction targets. Compaction fires at 85% pressure; the
 * target sits well below the 70% warning so a single compaction buys real headroom for the next round.
 */
const COMPACTION_TARGET_RATIO = 0.6;
/** The token cost of the pointer stub that replaces an evicted, re-readable body. */
const POINTER_TOKENS = 24;

/** Only tool-result material is evictable; every other layer is a protected fact preserved verbatim. */
const PROTECTED_FACT_KIND: Partial<Record<AgentContextLayer, ProtectedContextFact["kind"]>> = {
  user_request: "run_goal",
  conversation_summary: "user_decision",
  plan: "approved_plan",
  explicit_ref: "explicit_ref",
  editor: "explicit_ref",
  change_set_summary: "pending_change_set"
};

export interface DesktopCompactionComposerOptions {
  readonly repository: AgentRunFileRepository;
  readonly now?: () => string;
  readonly pricingRegistry?: AgentPricingRegistry;
  readonly usageTime?: () => AgentUsageTimeFacts;
}

/**
 * The desktop content provider for context compaction. It classifies the run's live Context Snapshot
 * into protected facts (everything but raw tool results) and evictable sources (tool results), and
 * builds the content-bearing artifacts the Application session commits in strict order. It is stateless
 * between `loadInputs` and `buildArtifacts` — both re-read the run + snapshot — and recomputes the
 * budget from the run's `providerCapabilitySnapshot`, so no run-start budget persistence is required.
 */
export function createDesktopCompactionSources(
  options: DesktopCompactionComposerOptions
): CompactContextSourcesPort {
  const now = options.now ?? (() => new Date().toISOString());
  const repository = options.repository;

  return {
    async loadInputs(command) {
      const loaded = await readRunContext(repository, command.runId);
      if (!loaded.ok) return err(loaded.error);
      if (!compactionCommandMatchesRun(command, loaded.value.normalizedRun)) {
        return err(composerError("AGENT_CONTEXT_COMPACTION_SCOPE_MISMATCH"));
      }
      const { run, snapshot } = loaded.value;
      const planExecution = await readPlanExecution(repository, run);
      if (!planExecution.ok) return err(planExecution.error);
      const classified = classifySources(snapshot.sources);
      const material = await loadFrozenBudgetMaterial(repository, loaded.value);
      if (!material.ok) return err(material.error);
      const budget = calculateCompactionBudget({
        context: loaded.value,
        material: material.value,
        contextBudgetSnapshotId: command.contextBudgetSnapshotId,
        calculatedAt: now(),
        artifactPointers: budgetArtifactPointers(snapshot.sources)
      });
      if (!budget.ok) return err(budget.error);
      const nextRevision = snapshot.compactionRevision + 1;
      const targetTokens = Math.floor(budget.value.safeInputBudget * COMPACTION_TARGET_RATIO);
      const evidence = stableSerialize({
        schemaVersion: "1.0",
        profileId: material.value.prompt.profileId,
        messages: [...material.value.prompt.messages, ...material.value.historyMessages]
      });
      const inputs: CompactionInputs = {
        sourceSnapshotId: snapshot.contextSnapshotId,
        throughSequence: readNonNegative(run["lastSequence"]),
        nextRevision,
        protectedFacts: classified.protectedFacts,
        ...(planExecution.value === undefined ? {} : { planExecutionRecord: planExecution.value }),
        evictableSources: classified.evictableSources,
        currentTokens: budget.value.usedTokens,
        targetTokens,
        modelSummary: {
          profileId: material.value.prompt.profileId,
          evidence,
          evidenceChecksum: checksumSha256(evidence),
          maxSummaryTokens: targetTokens,
          provider: loaded.value.normalizedRun.providerCapabilitySnapshot.provider,
          model: loaded.value.normalizedRun.providerCapabilitySnapshot.modelName,
          modelProfileId: loaded.value.normalizedRun.providerCapabilitySnapshot.profileId
        }
      };
      const prior = await readPriorProtected(repository, run);
      return ok(prior === undefined ? inputs : { ...inputs, prior });
    },

    async buildArtifacts(request) {
      const loaded = await readRunContext(repository, request.command.runId);
      if (!loaded.ok) return err(loaded.error);
      if (!compactionCommandMatchesRun(request.command, loaded.value.normalizedRun)) {
        return err(composerError("AGENT_CONTEXT_COMPACTION_SCOPE_MISMATCH"));
      }
      const createdAt = request.manifest.createdAt;
      return buildArtifacts(
        loaded.value,
        request,
        createdAt,
        options.pricingRegistry,
        options.usageTime?.() ?? usageTimeFor(createdAt),
        repository
      );
    }
  };
}

function compactionCommandMatchesRun(
  command: CompactContextCommand,
  run: AgentRunSnapshot
): boolean {
  if (command.scope !== undefined) {
    if (
      command.projectId !== undefined &&
      (command.scope.kind !== "workspace" || command.scope.workspaceId !== command.projectId)
    ) {
      return false;
    }
    return agentContextScopeKey(command.scope) === agentContextScopeKey(run.scope);
  }
  return (
    command.projectId !== undefined &&
    run.scope.kind === "workspace" &&
    run.scope.workspaceId === command.projectId
  );
}

interface RunContext {
  readonly run: JsonObject;
  readonly normalizedRun: AgentRunSnapshot;
  readonly snapshot: AgentContextSnapshot | AgentContextSnapshotV20;
  readonly protocol: "legacy" | "v2";
}

/** Read a legacy snapshot without upgrading it, or strictly parse a protocol-2 snapshot. */
async function readRunContext(
  repository: AgentRunFileRepository,
  runId: string
): Promise<Result<RunContext, UnifiedError>> {
  const legacyRead = await repository.readSnapshot(runId);
  let run: JsonObject | undefined;
  if (legacyRead.ok) {
    run = legacyRead.value;
  } else if (legacyRead.error.code === "AGENT_RUN_SNAPSHOT_VERSION_UNSUPPORTED") {
    // V2 records deliberately bypass the compatibility reader. Compaction is a V2-aware caller,
    // so it must obtain the strict envelope rather than weakening the repository boundary.
    const strictRead = await repository.readSnapshotV20(runId);
    if (!strictRead.ok) return err(strictRead.error);
    run = strictRead.value as unknown as JsonObject | undefined;
  } else {
    return err(legacyRead.error);
  }
  if (run === undefined) return err(composerError("AGENT_CONTEXT_COMPACTION_RUN_NOT_FOUND"));
  const contextSnapshotId = run["contextSnapshotId"];
  if (typeof contextSnapshotId !== "string") {
    return err(composerError("AGENT_CONTEXT_COMPACTION_NO_SNAPSHOT"));
  }
  const stored = await repository.readContextSnapshot(runId, contextSnapshotId);
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_NO_SNAPSHOT"));
  }
  try {
    const runIsV2 = run["schemaVersion"] === "2.0";
    const snapshotIsV2 = stored.value["schemaVersion"] === "2.0";
    if (runIsV2 !== snapshotIsV2) {
      throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
    }
    const normalizedRun = runIsV2 ? parseAgentRunSnapshotV20(run) : normalizeAgentRunSnapshot(run);
    const snapshot = snapshotIsV2
      ? parseAgentContextSnapshotV2(stored.value)
      : normalizeAgentContextSnapshot(stored.value, {
          scope: normalizedRun.scope,
          contextProfileId: normalizedRun.contextProfileId,
          profileVersion: normalizedRun.profileVersion,
          guidanceTemplateChecksum: normalizedRun.guidanceTemplateChecksum,
          stablePrefixChecksum: normalizedRun.cachePrefixChecksum
        });
    if (!runContextBindingsMatch(normalizedRun, snapshot)) {
      throw new Error("AGENT_CONTEXT_COMPACTION_SNAPSHOT_MISMATCH");
    }
    return ok({
      run,
      normalizedRun,
      snapshot,
      protocol: snapshotIsV2 ? "v2" : "legacy"
    });
  } catch {
    return err(composerError("AGENT_CONTEXT_COMPACTION_SNAPSHOT_INVALID"));
  }
}

function runContextBindingsMatch(
  run: AgentRunSnapshot,
  snapshot: AgentContextSnapshot | AgentContextSnapshotV20
): boolean {
  if (
    snapshot.runId !== run.runId ||
    agentContextScopeKey(snapshot.scope) !== agentContextScopeKey(run.scope) ||
    snapshot.contextProfileId !== run.contextProfileId ||
    snapshot.materialization.profileVersion !== run.profileVersion ||
    snapshot.materialization.guidanceTemplateChecksum !== run.guidanceTemplateChecksum ||
    snapshot.materialization.stablePrefixChecksum !== run.cachePrefixChecksum
  ) {
    return false;
  }
  return snapshot.schemaVersion === "2.0"
    ? run.schemaVersion === "2.0" &&
        snapshot.providerSemanticVersionSetChecksum === run.providerSemanticVersionSetChecksum
    : run.schemaVersion !== "2.0";
}

async function readPlanExecution(
  repository: AgentRunFileRepository,
  run: JsonObject
): Promise<Result<PlanExecutionRecord | undefined, UnifiedError>> {
  const planExecutionId = run["planExecutionId"];
  const planExecutionRevision = run["planExecutionRevision"];
  if (planExecutionId === null && planExecutionRevision === null) return ok(undefined);
  if (
    typeof planExecutionId !== "string" ||
    !Number.isSafeInteger(planExecutionRevision) ||
    Number(planExecutionRevision) < 1
  ) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_PLAN_EXECUTION_INVALID"));
  }
  const stored = await repository.readPlanExecutionRecord(
    String(run["runId"]),
    planExecutionId,
    Number(planExecutionRevision)
  );
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined || !isPlanExecutionRecord(stored.value)) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_PLAN_EXECUTION_NOT_FOUND"));
  }
  return ok(stored.value as unknown as PlanExecutionRecord);
}

interface ClassifiedSources {
  readonly protectedFacts: readonly ProtectedContextFact[];
  readonly evictableSources: readonly EvictableContextSource[];
}

/** Split snapshot sources into protected facts and re-readable/replaceable bodies. */
function classifySources(sources: readonly AgentContextSource[]): ClassifiedSources {
  const protectedFacts: ProtectedContextFact[] = [];
  const evictableSources: EvictableContextSource[] = [];
  for (const source of sources) {
    if (source.state === "excluded") continue;
    // App-authored system guidance is accounted for by the frozen prompt and system reserve.
    // It is neither user data nor a body compaction is allowed to evict.
    if (source.sourceKind === "system_guidance") continue;
    // Project conventions are a durable user-data fact even if an old snapshot happened to
    // persist an incorrect layer. The source kind is the C2 authority boundary here.
    let protectedKind = PROTECTED_FACT_KIND[source.layer];
    if (source.sourceKind === "project_conventions") {
      protectedKind = "explicit_ref";
    } else if (source.sourceKind === "workspace_outline") {
      protectedKind = undefined;
    }
    if (protectedKind !== undefined) {
      protectedFacts.push({
        kind: protectedKind,
        factId: `fact_${checksumHex(source.refId)}`,
        sourceId: source.refId,
        checksum: source.checksum,
        sourceRevision: source.sourceRevision
      });
      continue;
    }
    const tokenCount = source.tokenCount ?? 0;
    evictableSources.push({
      sourceId: source.refId,
      sourceRevision: source.sourceRevision,
      layer: source.layer,
      checksum: source.checksum,
      tokenCount,
      evictionReason:
        source.sourceKind === "workspace_outline" ||
        source.relativePath !== undefined ||
        source.assetId !== undefined
          ? "rereadable_body"
          : "raw_result",
      pointerTokenCount: Math.min(POINTER_TOKENS, tokenCount)
    });
  }
  return { protectedFacts, evictableSources };
}

interface FrozenBudgetMaterial {
  readonly prompt: AgentPromptMaterializationArtifact;
  readonly historyMessages: ReturnType<typeof materializeAgentRunHistory>;
  readonly toolCatalog: AgentRunToolCatalogSnapshot;
}

async function loadFrozenBudgetMaterial(
  repository: AgentRunFileRepository,
  context: RunContext
): Promise<Result<FrozenBudgetMaterial, UnifiedError>> {
  const prompt = await readPromptMaterialization(repository, context.snapshot);
  if (!prompt.ok) return err(prompt.error);
  const catalogId = context.normalizedRun.toolCatalogSnapshotId;
  if (catalogId === null || catalogId === undefined) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_TOOL_CATALOG_MISSING"));
  }
  const storedCatalog = await repository.readToolCatalog(context.normalizedRun.runId, catalogId);
  if (!storedCatalog.ok) return err(storedCatalog.error);
  if (storedCatalog.value === undefined) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_TOOL_CATALOG_MISSING"));
  }
  const catalog = validateAgentRunToolCatalogSnapshot(storedCatalog.value);
  if (
    !catalog.ok ||
    catalog.value.runId !== context.normalizedRun.runId ||
    catalog.value.toolCatalogSnapshotId !== catalogId ||
    catalog.value.facadeVersion !== context.normalizedRun.toolFacadeVersion ||
    catalog.value.catalogRevision !== context.normalizedRun.toolCatalogRevision ||
    catalog.value.catalogRevision !== prompt.value.toolCatalogRevision
  ) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_TOOL_CATALOG_INVALID"));
  }
  if (context.protocol === "v2") {
    const run = context.normalizedRun;
    const snapshot = context.snapshot;
    if (
      run.schemaVersion !== "2.0" ||
      snapshot.schemaVersion !== "2.0" ||
      prompt.value.schemaVersion !== "2.0" ||
      catalog.value.schemaVersion !== "2.0" ||
      run.catalog.snapshotId !== catalog.value.toolCatalogSnapshotId ||
      run.catalog.revision !== catalog.value.catalogRevision ||
      run.catalog.checksum !== catalog.value.catalogRevision ||
      run.authority.registryKey !== prompt.value.guidanceRegistryKey ||
      run.authority.guidanceChecksum !== checksumSha256(prompt.value.systemPrompt) ||
      prompt.value.guidanceProof.providerSemanticVersionSetChecksum !==
        snapshot.providerSemanticVersionSetChecksum ||
      stableSerialize(prompt.value.providerSemanticVersionSet) !==
        stableSerialize(snapshot.providerSemanticVersionSet) ||
      snapshot.providerSemanticVersionSet.approvalRuleSetVersion !==
        catalog.value.approvalRuleSetVersion ||
      snapshot.providerSemanticVersionSet.approvalRuleSetChecksum !==
        catalog.value.approvalRuleSetChecksum
    ) {
      return err(composerError("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH"));
    }
  } else if (prompt.value.schemaVersion === "2.0" || catalog.value.schemaVersion === "2.0") {
    return err(composerError("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH"));
  }
  let events: readonly AgentRunEvent[];
  if (context.protocol === "v2") {
    const storedEvents = await repository.readEventsV20(context.normalizedRun.runId);
    if (!storedEvents.ok) return err(storedEvents.error);
    events = storedEvents.value;
  } else {
    const storedEvents = await repository.readEvents(context.normalizedRun.runId);
    if (!storedEvents.ok) return err(storedEvents.error);
    try {
      const legacyWorkspaceKind =
        context.normalizedRun.scope.kind === "workspace"
          ? context.normalizedRun.scope.workspaceKind
          : undefined;
      events = storedEvents.value.map((event) =>
        normalizeAgentRunEvent(event, legacyWorkspaceKind)
      );
    } catch {
      return err(composerError("AGENT_CONTEXT_COMPACTION_EVENTS_INVALID"));
    }
  }
  const historyThroughSequence = prompt.value.contextSources
    .filter((source) => source.sourceKind === "compaction_summary")
    .reduce((latest, source) => Math.max(latest, source.sourceRevision ?? 0), 0);
  return ok({
    prompt: prompt.value,
    historyMessages: materializeAgentRunHistory(events, historyThroughSequence),
    toolCatalog: catalog.value
  });
}

function calculateCompactionBudget(input: {
  readonly context: RunContext;
  readonly material: FrozenBudgetMaterial;
  readonly contextBudgetSnapshotId: string;
  readonly calculatedAt: string;
  readonly prompt?: AgentPromptMaterializationArtifact;
  readonly historyMessages?: FrozenBudgetMaterial["historyMessages"];
  readonly artifactPointers: readonly {
    readonly artifactId: string;
    readonly kind: string;
    readonly checksum: string;
  }[];
}): Result<ContextBudgetSnapshotV11, UnifiedError> {
  const prompt = input.prompt ?? input.material.prompt;
  const capability = input.context.normalizedRun.providerCapabilitySnapshot;
  const resolved = resolveBudgetInputs({
    provider: capability.provider,
    model: capability.modelName,
    modelProfileId: capability.profileId,
    contextWindow: capability.contextWindow,
    requiredContextTokens: capability.requiredContextTokens,
    profile: prompt.profile,
    prompt,
    contextSources: prompt.contextSources,
    historyMessages: input.historyMessages ?? input.material.historyMessages,
    ...(input.artifactPointers.length === 0 ? {} : { artifactPointers: input.artifactPointers }),
    toolCatalog: {
      facadeVersion: input.material.toolCatalog.facadeVersion,
      schemaVersion: input.material.toolCatalog.schemaVersion,
      catalogRevision: input.material.toolCatalog.catalogRevision,
      descriptors: input.material.toolCatalog.descriptors
    }
  });
  if (!resolved.ok) return err(resolved.error);
  return calculateResolvedContextBudget({
    contextBudgetSnapshotId: input.contextBudgetSnapshotId,
    resolved: resolved.value,
    calculatedAt: input.calculatedAt
  });
}

function budgetArtifactPointers(sources: readonly AgentContextSource[]) {
  return sources.flatMap((source) => {
    if (source.evictionPointer !== null) {
      return [
        {
          artifactId: source.evictionPointer.artifactId,
          kind: `${source.sourceKind}_eviction`,
          checksum: source.evictionPointer.dependencyManifestChecksum
        }
      ];
    }
    if (source.sourceKind === "compaction_summary" && source.assetId !== undefined) {
      return [
        {
          artifactId: source.assetId,
          kind: "compaction_summary",
          checksum: source.checksum
        }
      ];
    }
    return [];
  });
}

/** Load the prior committed compaction's protected facts so progress can be validated (no regress). */
async function readPriorProtected(
  repository: AgentRunFileRepository,
  run: JsonObject
): Promise<CompactionInputs["prior"]> {
  const activeCompactionId = run["activeCompactionId"];
  if (typeof activeCompactionId !== "string") return undefined;
  const manifest = await repository.readCompactionManifest(
    String(run["runId"]),
    activeCompactionId
  );
  if (!manifest.ok || manifest.value === undefined) return undefined;
  const priorFacts = manifest.value["protectedFacts"];
  return {
    throughSequence: readNonNegative(manifest.value["throughSequence"]),
    protectedFacts: Array.isArray(priorFacts)
      ? (priorFacts as unknown as ProtectedContextFact[])
      : []
  };
}

/** Build the content-bearing artifacts. Each carries the id the session reads back. */
async function buildArtifacts(
  context: RunContext,
  request: CompactionArtifactRequest,
  createdAt: string,
  pricingRegistry: AgentPricingRegistry | undefined,
  usageTime: AgentUsageTimeFacts,
  repository: AgentRunFileRepository
): Promise<Result<CompactionArtifacts, UnifiedError>> {
  const { run, snapshot } = context;
  const material = await loadFrozenBudgetMaterial(repository, context);
  if (!material.ok) return err(material.error);
  const evicted = new Set(request.evictedSourceIds);
  const nextRevision = snapshot.compactionRevision + 1;
  const resultSnapshotId = `${snapshot.contextSnapshotId}_c${nextRevision}`;
  const budgetSnapshotId = `budget_${String(run["runId"])}_c${nextRevision}`;
  const boundSummaryArtifact = bindCompactionSummaryArtifact(snapshot, request);
  if (!boundSummaryArtifact.ok) return err(boundSummaryArtifact.error);
  const summaryArtifact = boundSummaryArtifact.value;

  const promptMaterialization = buildCompactedPromptMaterialization(
    material.value.prompt,
    snapshot,
    resultSnapshotId,
    evicted,
    summaryArtifact
  );
  if (!promptMaterialization.ok) return promptMaterialization;
  let nextPrompt = promptMaterialization.value;
  const promptBoundRefs = new Set([
    nextPrompt.systemGuidanceRefId,
    ...nextPrompt.contextSources.map((source) => source.refId)
  ]);

  // The result snapshot keeps every source but marks evicted ones excluded — the pointer stays,
  // the raw body is dropped. Protected facts and non-evicted sources pass through unchanged.
  const resultSources: AgentContextSource[] = [];
  for (const source of snapshot.sources) {
    if (summaryArtifact !== undefined && source.sourceKind === "compaction_summary") {
      continue;
    }
    if (evicted.has(source.refId)) {
      const evictionPointer = workspaceOutlineEvictionPointer(source);
      if (source.sourceKind === "workspace_outline" && evictionPointer === undefined) {
        // Losing a directed block without its dependency manifest would make a later hydrate
        // neither reproducible nor safely re-readable.
        return err(composerError("AGENT_CONTEXT_COMPACTION_OUTLINE_POINTER_INVALID"));
      }
      resultSources.push({
        ...source,
        state: "excluded",
        artifactId: null,
        evictionPointer: evictionPointer ?? null
      });
      continue;
    }
    resultSources.push(
      promptBoundRefs.has(source.refId) ? { ...source, artifactId: nextPrompt.artifactId } : source
    );
  }
  if (summaryArtifact !== undefined) {
    const summarySource = nextPrompt.contextSources.find(
      (source) => source.sourceKind === "compaction_summary"
    );
    if (summarySource === undefined) {
      return err(composerError("AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID"));
    }
    const generated = createAgentContextSnapshot({
      contextSnapshotId: resultSnapshotId,
      runId: snapshot.runId,
      scope: snapshot.scope,
      contextProfileId: snapshot.contextProfileId,
      materialization: {
        schemaVersion: "1.0",
        profileVersion: snapshot.materialization.profileVersion,
        guidanceTemplateChecksum: snapshot.materialization.guidanceTemplateChecksum,
        stablePrefixChecksum: nextPrompt.stablePrefixChecksum,
        messageOrderVersion: "1.0"
      },
      createdAt,
      sources: [summarySource],
      materializationArtifactId: nextPrompt.artifactId,
      materializationArtifactSourceRefs: [summarySource.refId]
    }).sources[0];
    if (generated === undefined) {
      return err(composerError("AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID"));
    }
    resultSources.push({
      ...generated,
      tokenCount: summaryArtifact.tokenCount,
      precision: summaryArtifact.precision,
      materializationOrder: resultSources.length
    });
  }
  const beforeBudget = calculateCompactionBudget({
    context,
    material: material.value,
    contextBudgetSnapshotId: request.command.contextBudgetSnapshotId,
    calculatedAt: createdAt,
    artifactPointers: budgetArtifactPointers(snapshot.sources)
  });
  if (!beforeBudget.ok) return err(beforeBudget.error);
  const budget = calculateCompactionBudget({
    context,
    material: material.value,
    contextBudgetSnapshotId: budgetSnapshotId,
    calculatedAt: createdAt,
    prompt: nextPrompt,
    historyMessages: summaryArtifact === undefined ? material.value.historyMessages : [],
    artifactPointers: budgetArtifactPointers(resultSources)
  });
  if (!budget.ok) return err(budget.error);
  if (budget.value.usedTokens > request.targetTokens) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_TARGET_UNREACHED"));
  }
  const retainedExcluded =
    snapshot.packedContextManifest?.schemaVersion === "1.2" ||
    snapshot.packedContextManifest?.schemaVersion === "2.0"
      ? snapshot.packedContextManifest.sources.filter((source) => source.state === "excluded")
      : [];
  const canCreatePackedContext =
    snapshot.packedContextManifest?.schemaVersion === "1.2" ||
    snapshot.packedContextManifest?.schemaVersion === "2.0" ||
    snapshot.excludedSources.length === 0;
  let packedContextManifest:
    | AgentContextSnapshot["packedContextManifest"]
    | AgentContextSnapshotV20["packedContextManifest"] = null;
  if (canCreatePackedContext) {
    try {
      const packedContext = packAgentContext({
        profile: nextPrompt.profile,
        contextSources: nextPrompt.contextSources,
        excludedContextSources: material.value.prompt.contextSources.filter((source) =>
          evicted.has(source.refId)
        ),
        excludedSourceManifests: retainedExcluded,
        modelProfileId: context.normalizedRun.providerCapabilitySnapshot.profileId,
        usedTokens: budget.value.usedTokens,
        safeInputBudget: budget.value.safeInputBudget,
        remainingTokens: budget.value.remainingTokens,
        precision: budget.value.precision,
        createdAt
      });
      if (context.protocol === "v2") {
        if (snapshot.schemaVersion !== "2.0" || nextPrompt.schemaVersion !== "2.0") {
          throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
        }
        const canonicalRound = materializeCanonicalAgentRound({
          roundId: snapshot.roundId,
          runId: snapshot.runId,
          roundNumber: material.value.historyMessages.filter(
            (message) => message.role === "assistant"
          ).length,
          profile: nextPrompt.profile,
          systemPrompt: nextPrompt.systemPrompt,
          toolCatalogRevision: nextPrompt.toolCatalogRevision,
          projectedToolDescriptors: structuredClone(
            material.value.toolCatalog.descriptors
          ) as unknown as readonly JsonObject[],
          sharing: snapshot.sharing,
          providerSemanticVersionSet: snapshot.providerSemanticVersionSet,
          userRequest: nextPrompt.userRequest,
          contextSources: nextPrompt.contextSources,
          conversationSummaryMessages: nextPrompt.conversationSummaryMessages,
          historyMessages: summaryArtifact === undefined ? material.value.historyMessages : [],
          packedContext
        });
        if (canonicalRound.packedContextManifest === null) {
          throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
        }
        packedContextManifest = canonicalRound.packedContextManifest;
        nextPrompt = bindV2PackedPromptManifest(
          nextPrompt,
          resultSnapshotId,
          canonicalRound.packedContextManifest.manifestChecksum
        );
        if (
          canonicalRound.prompt.stablePrefixChecksum !== nextPrompt.stablePrefixChecksum ||
          stableSerialize(canonicalRound.prompt.messages.slice(0, nextPrompt.messages.length)) !==
            stableSerialize(nextPrompt.messages)
        ) {
          throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
        }
      } else {
        nextPrompt = rematerializeAgentPromptArtifact(nextPrompt, {
          contextSnapshotId: resultSnapshotId,
          contextSources: nextPrompt.contextSources,
          packedContext
        });
        packedContextManifest = createPackedAgentContextManifest(packedContext);
      }
    } catch {
      return err(composerError("AGENT_CONTEXT_COMPACTION_SNAPSHOT_INVALID"));
    }
  }
  const resultExcludedSources = [
    ...new Set([...(snapshot.excludedSources ?? []), ...request.evictedSourceIds])
  ];
  const resultSnapshot = buildResultContextSnapshot({
    context,
    nextPrompt,
    resultSnapshotId,
    nextRevision,
    createdAt,
    resultSources,
    resultExcludedSources,
    packedContextManifest
  });
  if (!resultSnapshot.ok) return err(resultSnapshot.error);
  const beforeTokens = beforeBudget.value.usedTokens;
  const afterTokens = budget.value.usedTokens;

  const usageRecord = buildUsageRecord({
    run: context.normalizedRun,
    request,
    budget: budget.value,
    beforeTokens,
    afterTokens,
    ...(pricingRegistry === undefined ? {} : { pricingRegistry }),
    usageTime
  });
  if (!usageRecord.ok) return err(usageRecord.error);
  const promptCacheIdentity = deriveCompactedPromptCacheIdentity(
    context,
    nextPrompt.stablePrefixChecksum
  );
  if (!promptCacheIdentity.ok) return err(promptCacheIdentity.error);

  const runSnapshot: JsonObject = {
    ...run,
    activeCompactionId: request.manifest.compactionId,
    contextSnapshotId: resultSnapshotId,
    contextBudgetSnapshotId: budgetSnapshotId,
    cachePrefixChecksum: nextPrompt.stablePrefixChecksum,
    promptCacheIdentityChecksum: promptCacheIdentity.value,
    promptCacheStablePrefixMessageCount: 1 + nextPrompt.stablePrefixMessages.length,
    updatedAt: createdAt
  };

  return ok({
    resultSnapshot: resultSnapshot.value,
    promptMaterialization: nextPrompt as unknown as JsonObject,
    budgetSnapshot: budget.value as unknown as JsonObject,
    usageRecord: usageRecord.value as unknown as JsonObject,
    runSnapshot
  });
}

function bindV2PackedPromptManifest(
  prior: AgentPromptMaterializationArtifact,
  contextSnapshotId: string,
  packedContextManifestChecksum: string
): AgentPromptMaterializationArtifact {
  if (prior.schemaVersion !== "2.0") {
    throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
  }
  return createAgentPromptMaterializationArtifact({
    runId: prior.runId,
    contextSnapshotId,
    profile: prior.profile,
    systemPrompt: prior.systemPrompt,
    toolCatalogRevision: prior.toolCatalogRevision,
    userRequest: prior.userRequest,
    contextSources: prior.contextSources,
    conversationSummaryMessages: prior.conversationSummaryMessages,
    systemGuidanceRefId: prior.systemGuidanceRefId,
    packedContextManifestChecksum,
    guidanceMaterialization: {
      normalizedInput: prior.normalizedGuidanceInput,
      materializedGuidance: prior.systemPrompt,
      proof: prior.guidanceProof
    }
  });
}

function buildResultContextSnapshot(input: {
  readonly context: RunContext;
  readonly nextPrompt: AgentPromptMaterializationArtifact;
  readonly resultSnapshotId: string;
  readonly nextRevision: number;
  readonly createdAt: string;
  readonly resultSources: readonly AgentContextSource[];
  readonly resultExcludedSources: readonly string[];
  readonly packedContextManifest:
    | AgentContextSnapshot["packedContextManifest"]
    | AgentContextSnapshotV20["packedContextManifest"];
}): Result<JsonObject, UnifiedError> {
  const { context, nextPrompt } = input;
  if (context.protocol === "legacy") {
    if (input.packedContextManifest?.schemaVersion === "2.0") {
      return err(composerError("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH"));
    }
    return ok({
      ...(context.snapshot as unknown as JsonObject),
      contextSnapshotId: input.resultSnapshotId,
      compactionRevision: input.nextRevision,
      createdAt: input.createdAt,
      materialization: {
        ...context.snapshot.materialization,
        stablePrefixChecksum: nextPrompt.stablePrefixChecksum
      },
      sources: input.resultSources as unknown as JsonObject["sources"],
      excludedSources: input.resultExcludedSources as unknown as JsonObject["excludedSources"],
      packedContextManifest: input.packedContextManifest as unknown as JsonObject
    });
  }
  if (
    context.snapshot.schemaVersion !== "2.0" ||
    nextPrompt.schemaVersion !== "2.0" ||
    input.packedContextManifest?.schemaVersion !== "2.0"
  ) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH"));
  }
  try {
    const sourceByRef = new Map(input.resultSources.map((source) => [source.refId, source]));
    const systemSources = input.resultSources.filter(
      (source) => source.sourceKind === "system_guidance"
    );
    if (
      systemSources.length !== 1 ||
      systemSources[0]?.refId !== nextPrompt.systemGuidanceRefId ||
      systemSources[0]?.checksum !== checksumSha256(nextPrompt.systemPrompt)
    ) {
      throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
    }
    const orderedSources = [
      ...systemSources,
      ...input.packedContextManifest.sources.map((source) => {
        const matched = sourceByRef.get(source.refId);
        if (matched === undefined || matched.sourceKind === "system_guidance") {
          throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
        }
        return matched;
      })
    ].map((source, materializationOrder) => ({ ...source, materializationOrder }));
    if (orderedSources.length !== input.resultSources.length) {
      throw new Error("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH");
    }
    // The strict writer validates the immutable protocol bindings. Compaction then re-signs the
    // same writer output after carrying forward source audit fields (eviction pointers, precision,
    // and excluded bodies are intentionally not reconstructed from content).
    const shell = createAgentContextSnapshotV2({
      contextSnapshotId: input.resultSnapshotId,
      runId: context.snapshot.runId,
      scope: context.snapshot.scope,
      contextProfileId: context.snapshot.contextProfileId,
      materialization: {
        ...context.snapshot.materialization,
        stablePrefixChecksum: nextPrompt.stablePrefixChecksum
      },
      createdAt: input.createdAt,
      compactionRevision: input.nextRevision,
      sources: [],
      excludedSources: [],
      roundId: context.snapshot.roundId,
      sharing: context.snapshot.sharing,
      providerSemanticVersionSet: context.snapshot.providerSemanticVersionSet,
      packedContextManifest: null
    });
    const { snapshotChecksum: _shellChecksum, ...shellUnsigned } = shell;
    void _shellChecksum;
    const unsigned = {
      ...shellUnsigned,
      sources: orderedSources,
      excludedSources: [...input.packedContextManifest.excludedSources],
      packedContextManifest: input.packedContextManifest
    };
    const parsed = parseAgentContextSnapshotV2({
      ...unsigned,
      snapshotChecksum: checksumSha256(stableSerialize(unsigned))
    });
    return ok(parsed as unknown as JsonObject);
  } catch {
    return err(composerError("AGENT_CONTEXT_COMPACTION_SNAPSHOT_INVALID"));
  }
}

function deriveCompactedPromptCacheIdentity(
  context: RunContext,
  stablePrefixChecksum: string
): Result<string, UnifiedError> {
  const identityBaseChecksum = context.run["promptCacheIdentityBaseChecksum"];
  if (!isChecksum(identityBaseChecksum) || !isChecksum(stablePrefixChecksum)) {
    return context.protocol === "legacy"
      ? ok("legacy")
      : err(composerError("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH"));
  }
  try {
    return ok(
      context.protocol === "v2"
        ? deriveAgentPromptCacheIdentityChecksumV2(identityBaseChecksum, stablePrefixChecksum)
        : deriveAgentPromptCacheIdentityChecksum(identityBaseChecksum, stablePrefixChecksum)
    );
  } catch {
    return err(composerError("AGENT_CONTEXT_COMPACTION_PROTOCOL_MISMATCH"));
  }
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function bindCompactionSummaryArtifact(
  snapshot: AgentContextSnapshot | AgentContextSnapshotV20,
  request: CompactionArtifactRequest
): Result<AgentCompactionSummaryArtifact | undefined, UnifiedError> {
  if (request.summaryArtifact === undefined) {
    return request.strategy === "model_assisted"
      ? err(composerError("AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID"))
      : ok(undefined);
  }
  if (request.strategy !== "model_assisted") {
    return err(composerError("AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID"));
  }
  try {
    const artifact = parseCompactionSummaryArtifact(
      request.summaryArtifact as unknown as JsonObject
    );
    if (
      request.command.runId !== snapshot.runId ||
      request.manifest.runId !== snapshot.runId ||
      request.manifest.sourceSnapshotId !== snapshot.contextSnapshotId ||
      artifact.runId !== snapshot.runId ||
      artifact.compactionId !== request.manifest.compactionId ||
      artifact.contextProfileId !== snapshot.contextProfileId ||
      artifact.sourceSnapshotId !== snapshot.contextSnapshotId ||
      artifact.throughSequence !== request.manifest.throughSequence ||
      artifact.inputManifestChecksum !== request.manifest.checksum ||
      artifact.checksum !== request.summaryChecksum ||
      artifact.tokenCount !== request.outputTokens ||
      artifact.precision !== request.precision
    ) {
      throw new Error("AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID");
    }
    return ok(artifact);
  } catch {
    return err(composerError("AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID"));
  }
}

/** Build the only persisted form of an evicted directed block; it never carries its old body. */
function workspaceOutlineEvictionPointer(source: AgentContextSource):
  | {
      readonly schemaVersion: "1.0";
      readonly artifactId: string;
      readonly dependencyManifestChecksum: string;
      readonly rereadHint: string;
    }
  | undefined {
  if (
    source.sourceKind !== "workspace_outline" ||
    source.sourceMaterialization?.kind !== "workspace_outline"
  ) {
    return undefined;
  }
  return {
    schemaVersion: "1.0",
    artifactId: source.sourceMaterialization.artifactId,
    dependencyManifestChecksum: source.sourceMaterialization.dependencyManifestChecksum,
    rereadHint: source.sourceMaterialization.rereadHint
  };
}

function buildCompactedPromptMaterialization(
  prior: AgentPromptMaterializationArtifact,
  snapshot: AgentContextSnapshot | AgentContextSnapshotV20,
  resultSnapshotId: string,
  evicted: ReadonlySet<string>,
  summaryArtifact: AgentCompactionSummaryArtifact | undefined
): Result<AgentPromptMaterializationArtifact, UnifiedError> {
  if (
    prior.runId !== snapshot.runId ||
    prior.contextSnapshotId !== snapshot.contextSnapshotId ||
    (summaryArtifact !== undefined &&
      (summaryArtifact.runId !== snapshot.runId ||
        summaryArtifact.sourceSnapshotId !== snapshot.contextSnapshotId))
  ) {
    return err(composerError("AGENT_PROMPT_MATERIALIZATION_INVALID"));
  }
  const contextSources = prior.contextSources.filter(
    (source) =>
      !evicted.has(source.refId) &&
      (summaryArtifact === undefined || source.sourceKind !== "compaction_summary")
  );
  if (summaryArtifact !== undefined) {
    contextSources.push({
      refId: "compaction_summary",
      sourceKind: "compaction_summary",
      assetId: summaryArtifact.artifactId,
      content: summaryArtifact.body,
      dirty: false,
      sourceRevision: summaryArtifact.throughSequence
    });
  }
  try {
    return ok(
      rematerializeAgentPromptArtifact(prior, {
        contextSnapshotId: resultSnapshotId,
        contextSources
      })
    );
  } catch {
    return err(composerError("AGENT_PROMPT_MATERIALIZATION_INVALID"));
  }
}

async function readPromptMaterialization(
  repository: AgentRunFileRepository,
  snapshot: AgentContextSnapshot | AgentContextSnapshotV20
): Promise<Result<AgentPromptMaterializationArtifact, UnifiedError>> {
  const artifactIds = [
    ...new Set(
      snapshot.sources.flatMap((source) => (source.artifactId === null ? [] : [source.artifactId]))
    )
  ];
  const expectedArtifactId = promptMaterializationArtifactId(snapshot.contextSnapshotId);
  if (artifactIds.length !== 1 || artifactIds[0] !== expectedArtifactId) {
    return err(composerError("AGENT_PROMPT_MATERIALIZATION_INVALID"));
  }
  const stored = await repository.readPromptMaterialization(snapshot.runId, expectedArtifactId);
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined) {
    return err(composerError("AGENT_PROMPT_MATERIALIZATION_MISSING"));
  }
  try {
    const prior = parseAgentPromptMaterializationArtifact(stored.value);
    const guidanceSources = snapshot.sources.filter(
      (source) => source.sourceKind === "system_guidance"
    );
    if (
      prior.runId !== snapshot.runId ||
      prior.contextSnapshotId !== snapshot.contextSnapshotId ||
      prior.profile.profileId !== snapshot.contextProfileId ||
      prior.profileVersion !== snapshot.materialization.profileVersion ||
      prior.guidanceTemplateChecksum !== snapshot.materialization.guidanceTemplateChecksum ||
      prior.stablePrefixChecksum !== snapshot.materialization.stablePrefixChecksum ||
      guidanceSources.length !== 1 ||
      guidanceSources[0]?.refId !== prior.systemGuidanceRefId ||
      guidanceSources[0]?.checksum !== checksumSha256(prior.systemPrompt) ||
      (snapshot.schemaVersion === "2.0") !== (prior.schemaVersion === "2.0") ||
      (snapshot.schemaVersion === "2.0" &&
        (prior.schemaVersion !== "2.0" ||
          (snapshot.packedContextManifest !== null &&
            prior.packedContextManifestChecksum !==
              snapshot.packedContextManifest.manifestChecksum) ||
          prior.guidanceProof.providerSemanticVersionSetChecksum !==
            snapshot.providerSemanticVersionSetChecksum ||
          stableSerialize(prior.providerSemanticVersionSet) !==
            stableSerialize(snapshot.providerSemanticVersionSet)))
    ) {
      return err(composerError("AGENT_PROMPT_MATERIALIZATION_INVALID"));
    }
    return ok(prior);
  } catch {
    return err(composerError("AGENT_PROMPT_MATERIALIZATION_INVALID"));
  }
}

/** A redacted final usage record for the compaction round: only token/budget facts, never content. */
function buildUsageRecord(input: {
  readonly run: AgentRunSnapshot;
  readonly request: CompactionArtifactRequest;
  readonly budget: ContextBudgetSnapshotV11;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly pricingRegistry?: AgentPricingRegistry;
  readonly usageTime: AgentUsageTimeFacts;
}): Result<AgentUsageRecord, UnifiedError> {
  const { run, request, budget } = input;
  const scope = run.scope;
  const capability = run.providerCapabilitySnapshot;
  const compactionId = request.manifest.compactionId;
  const runId = String(run["runId"]);
  const finalSequence = readNonNegative(run["lastSequence"]);
  const inputTokens = readNonNegative(request.inputTokens);
  const outputTokens = readNonNegative(request.outputTokens);
  const usageStatus = request.strategy === "model_assisted" ? "estimated" : "missing";
  const pricing = input.pricingRegistry?.price({
    provider: capability.provider,
    model: capability.modelName,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      usageStatus,
      cost: { amount: 0, currency: "", status: "unknown" }
    }
  }) ?? {
    pricingVersion: null,
    unitPrices: null,
    cost: { amount: 0, currency: "", status: "unknown" as const }
  };
  const record: AgentUsageRecord = {
    schemaVersion: "1.2",
    scope,
    usageId: usageRecordIdempotencyKey({ runId, roundId: compactionId, finalSequence }),
    runId,
    conversationId: String(run["conversationId"] ?? ""),
    roundId: compactionId,
    finalSequence,
    provider: capability.provider,
    model: capability.modelName,
    inputTokens,
    outputTokens,
    cacheOutcome: "unknown",
    cacheUsageStatus: "unavailable",
    cacheInputTokenSemantics: "unavailable",
    cacheMode: null,
    cachePrefixChecksum: null,
    totalTokens: inputTokens + outputTokens,
    usageStatus,
    precision: request.precision,
    pricingVersion: pricing.pricingVersion,
    unitPrices: pricing.unitPrices,
    cost: pricing.cost,
    contextWindow: budget.contextWindow,
    safeInputBudget: budget.safeInputBudget,
    compactionBeforeTokens: input.beforeTokens,
    compactionAfterTokens: input.afterTokens,
    terminationReason: "context_compaction",
    timestamp: input.usageTime.timestamp,
    localDate: input.usageTime.localDate,
    timezone: input.usageTime.timezone,
    utcOffsetMinutes: input.usageTime.utcOffsetMinutes
  };
  return validateAgentUsageRecord(record);
}

function usageTimeFor(timestamp: string): AgentUsageTimeFacts {
  const current = new Date(timestamp);
  const year = String(current.getFullYear()).padStart(4, "0");
  const month = String(current.getMonth() + 1).padStart(2, "0");
  const day = String(current.getDate()).padStart(2, "0");
  return {
    timestamp: current.toISOString(),
    localDate: `${year}-${month}-${day}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    utcOffsetMinutes: -current.getTimezoneOffset()
  };
}

function checksumHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function checksumSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanExecutionRecord(value: JsonObject): boolean {
  const steps = value["steps"];
  return (
    value["schemaVersion"] === "1.0" &&
    typeof value["planExecutionId"] === "string" &&
    typeof value["runId"] === "string" &&
    typeof value["planId"] === "string" &&
    Number.isSafeInteger(value["planRevision"]) &&
    Number(value["planRevision"]) > 0 &&
    Number.isSafeInteger(value["revision"]) &&
    Number(value["revision"]) > 0 &&
    Array.isArray(steps) &&
    steps.every((step: unknown) => {
      if (!isRecord(step)) return false;
      return (
        typeof step["stepId"] === "string" &&
        typeof step["title"] === "string" &&
        isPlanExecutionStepStatus(step["status"]) &&
        Array.isArray(step["verification"]) &&
        (step["verification"] as unknown[]).every((item) => typeof item === "string")
      );
    })
  );
}

function isPlanExecutionStepStatus(value: unknown): value is PlanExecutionStepStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
  );
}

function composerError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message: "Context compaction could not read the run's live context.",
    recoverability: "user-action",
    suggestedAction: "Retry after the run has produced a context snapshot.",
    traceId: "desktop-agent-compaction-composer"
  });
}
