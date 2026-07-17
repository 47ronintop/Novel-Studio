import {
  aggregateContextPrecision,
  buildCompactionInputManifest,
  calculateContextBudget,
  createContextCompactionRevision,
  createDeterministicTokenEstimator,
  createPlanExecutionProtectedFact,
  planDeterministicEviction,
  validateCompactionResultProgress,
  type AgentContextPrecision,
  type AgentRunDraft,
  type AgentTokenEstimator,
  type CompactContextCommand,
  type CompactionInputManifest,
  type ContextBudgetSnapshot,
  type ContextCompactionRevision,
  type ContextDraft,
  type EvictableContextSource,
  type PlanExecutionRecord,
  type PreviewContextBudgetCommand,
  type ProtectedContextFact
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type { AgentRunDraftSession, AgentRunDraftView } from "./agent-run-draft-session.js";

/**
 * The provider-aware facts a budget is calculated from. Resolved server-side from the draft's
 * `modelProfileId` — never authored by the renderer. `toolReserve`/`systemReserve` are token counts,
 * not text; the guidance/tool-schema text they represent is measured where it is authored.
 */
export interface AgentContextBudgetModelFacts {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly toolReserve: number;
  readonly systemReserve: number;
  readonly requiredContextTokens: number;
}

/** One resolved piece of input content the budget should account for (a referenced source's text). */
export interface AgentContextBudgetContent {
  readonly refId: string;
  readonly content: string;
}

export interface AgentContextBudgetInputs {
  readonly model: AgentContextBudgetModelFacts;
  readonly contents: readonly AgentContextBudgetContent[];
}

/**
 * The port that turns a resolved draft into the concrete budget facts: the model window/reserves and
 * the resolved content of every context reference. This is where content reading lives, so the
 * session stays pure arithmetic + estimation over already-resolved material.
 */
export interface AgentContextBudgetInputsPort {
  resolveBudgetInputs(input: {
    readonly projectId: string;
    readonly conversationId: string;
    readonly draft: AgentRunDraft;
    readonly contextDraft: ContextDraft;
  }): Promise<Result<AgentContextBudgetInputs, UnifiedError>>;
}

/** The canonical material a compaction runs over, resolved server-side before any provider call. */
export interface CompactionInputs {
  readonly sourceSnapshotId: string;
  readonly throughSequence: number;
  readonly nextRevision: number;
  readonly protectedFacts: readonly ProtectedContextFact[];
  readonly planExecutionRecord?: PlanExecutionRecord;
  readonly evictableSources: readonly EvictableContextSource[];
  readonly currentTokens: number;
  readonly targetTokens: number;
  readonly prior?: {
    readonly throughSequence: number;
    readonly protectedFacts: readonly ProtectedContextFact[];
  };
}

/**
 * The content-bearing artifacts a compaction commits. Built by the port because it owns the document
 * content and the coordinator's run snapshot — the session owns only the commit ORDER, not the bytes.
 * Each carries its own id: `resultSnapshot.contextSnapshotId`, `budgetSnapshot.contextBudgetSnapshotId`,
 * `usageRecord.usageId`, and `runSnapshot.activeCompactionId` (the commit marker).
 */
export interface CompactionArtifacts {
  readonly resultSnapshot: JsonObject;
  readonly budgetSnapshot: JsonObject;
  readonly usageRecord: JsonObject;
  readonly runSnapshot: JsonObject;
}

export interface CompactionArtifactRequest {
  readonly command: CompactContextCommand;
  readonly manifest: CompactionInputManifest;
  readonly strategy: "deterministic" | "model_assisted";
  readonly evictedSourceIds: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly precision: AgentContextPrecision;
  readonly summaryChecksum: string;
}

/** Server-authoritative source of compaction material and artifacts (desktop provides the content). */
export interface CompactContextSourcesPort {
  loadInputs(command: CompactContextCommand): Promise<Result<CompactionInputs, UnifiedError>>;
  buildArtifacts(
    request: CompactionArtifactRequest
  ): Promise<Result<CompactionArtifacts, UnifiedError>>;
}

/** The narrow run-repository surface the commit sequence needs. */
export interface CompactionRunRepositoryPort {
  writeCompactionManifest(manifest: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeCompactionRevision(revision: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeContextSnapshot(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeBudgetSnapshot(
    runId: string,
    snapshot: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  commitCompaction(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
}

export interface CompactionUsageSinkPort {
  writeFinal(record: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
}

/** A no-tools model summarizer over the evictable material. Protected facts are never sent to it. */
export interface CompactionModelAssistantPort {
  summarizeEvictable(input: {
    readonly runId: string;
    readonly evictableSources: readonly EvictableContextSource[];
  }): Promise<
    Result<
      {
        readonly summaryChecksum: string;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly precision: AgentContextPrecision;
      },
      UnifiedError
    >
  >;
}

export type CompactionEvent =
  | {
      readonly type: "context_compaction_started";
      readonly compactionId: string;
      readonly trigger: string;
    }
  | {
      readonly type: "context_compaction_completed";
      readonly compactionId: string;
      readonly revision: ContextCompactionRevision;
    }
  | {
      readonly type: "context_compaction_failed";
      readonly compactionId: string;
      readonly code: string;
    };

export interface CompactContextResult {
  readonly compactionId: string;
  readonly revision: ContextCompactionRevision;
  readonly runSnapshot: JsonObject;
}

export interface AgentContextSession {
  previewContextBudget(
    command: PreviewContextBudgetCommand
  ): Promise<Result<ContextBudgetSnapshot, UnifiedError>>;
  compactContext(
    command: CompactContextCommand
  ): Promise<Result<CompactContextResult, UnifiedError>>;
}

export interface CreateAgentContextSessionOptions {
  readonly draftSession: Pick<AgentRunDraftSession, "resolveStartDraft">;
  readonly budgetInputs: AgentContextBudgetInputsPort;
  readonly estimator?: AgentTokenEstimator;
  readonly createBudgetSnapshotId?: () => string;
  readonly now?: () => string;
  readonly compactionSources?: CompactContextSourcesPort;
  readonly runRepository?: CompactionRunRepositoryPort;
  readonly usageSink?: CompactionUsageSinkPort;
  readonly modelAssistant?: CompactionModelAssistantPort;
  readonly createCompactionId?: () => string;
  readonly onCompactionEvent?: (event: CompactionEvent) => Promise<void> | void;
}

export function createAgentContextSession(
  options: CreateAgentContextSessionOptions
): AgentContextSession {
  const estimator = options.estimator ?? createDeterministicTokenEstimator();
  const now = options.now ?? (() => new Date().toISOString());
  const createBudgetSnapshotId = options.createBudgetSnapshotId ?? createDefaultBudgetSnapshotId;
  const receipts = new Map<string, Result<ContextBudgetSnapshot, UnifiedError>>();

  const createCompactionId = options.createCompactionId ?? createDefaultCompactionId;

  return {
    async previewContextBudget(command) {
      const key = `${command.projectId}:${command.conversationId}:${command.commandId}`;
      const cached = receipts.get(key);
      if (cached !== undefined) return cached;
      const result = await preview(command);
      receipts.set(key, result);
      return result;
    },

    async compactContext(command) {
      return compact(command);
    }
  };

  async function compact(
    command: CompactContextCommand
  ): Promise<Result<CompactContextResult, UnifiedError>> {
    if (
      options.compactionSources === undefined ||
      options.runRepository === undefined ||
      options.usageSink === undefined
    ) {
      return err(compactionUnavailable());
    }
    const sources = options.compactionSources;
    const runRepository = options.runRepository;
    const usageSink = options.usageSink;

    const loaded = await sources.loadInputs(command);
    if (!loaded.ok) return err(loaded.error);
    const inputs = loaded.value;
    if (
      inputs.planExecutionRecord !== undefined &&
      inputs.planExecutionRecord.runId !== command.runId
    ) {
      return err(compactionPlanExecutionMismatch());
    }
    const protectedFacts =
      inputs.planExecutionRecord === undefined
        ? inputs.protectedFacts
        : mergePlanExecutionFact(inputs.protectedFacts, inputs.planExecutionRecord);

    const compactionId = createCompactionId();
    const manifestResult = buildCompactionInputManifest({
      compactionId,
      runId: command.runId,
      sourceSnapshotId: inputs.sourceSnapshotId,
      throughSequence: inputs.throughSequence,
      protectedFacts,
      evictableSources: inputs.evictableSources,
      createdAt: now()
    });
    if (!manifestResult.ok) return err(manifestResult.error);
    const manifest = manifestResult.value;

    // Persist the manifest BEFORE announcing the compaction: the started event must never reference a
    // manifest that was not durably written first.
    const manifestWritten = await runRepository.writeCompactionManifest(
      manifest as unknown as JsonObject
    );
    if (!manifestWritten.ok) return err(manifestWritten.error);
    await emitCompaction({
      type: "context_compaction_started",
      compactionId,
      trigger: command.trigger
    });

    const failed = async (
      error: UnifiedError
    ): Promise<Result<CompactContextResult, UnifiedError>> => {
      // A failed or cancelled compaction never commits; the last committed snapshot/budget stand.
      await emitCompaction({ type: "context_compaction_failed", compactionId, code: error.code });
      return err(error);
    };

    const plan = planDeterministicEviction({
      evictableSources: inputs.evictableSources,
      currentTokens: inputs.currentTokens,
      targetTokens: inputs.targetTokens
    });
    let strategy: "deterministic" | "model_assisted" = "deterministic";
    let inputTokens = 0;
    let outputTokens = 0;
    let precision: AgentContextPrecision = "estimated";
    let summaryChecksum = "";
    if (!plan.reachedTarget && options.modelAssistant !== undefined) {
      const summarized = await options.modelAssistant.summarizeEvictable({
        runId: command.runId,
        evictableSources: inputs.evictableSources
      });
      if (!summarized.ok) return failed(summarized.error);
      strategy = "model_assisted";
      inputTokens = summarized.value.inputTokens;
      outputTokens = summarized.value.outputTokens;
      precision = summarized.value.precision;
      summaryChecksum = summarized.value.summaryChecksum;
    }

    // Regression guard runs regardless of strategy: protected facts and throughSequence may never go
    // backwards relative to the last committed compaction.
    const progress = validateCompactionResultProgress({
      candidateThroughSequence: manifest.throughSequence,
      candidateProtectedFacts: manifest.protectedFacts,
      ...(inputs.prior === undefined ? {} : { prior: inputs.prior })
    });
    if (!progress.ok) return failed(progress.error);

    const artifacts = await sources.buildArtifacts({
      command,
      manifest,
      strategy,
      evictedSourceIds: plan.evictedSourceIds,
      inputTokens,
      outputTokens,
      precision,
      summaryChecksum
    });
    if (!artifacts.ok) return failed(artifacts.error);

    const revision = createContextCompactionRevision({
      manifest,
      revision: inputs.nextRevision,
      trigger: command.trigger,
      strategy,
      resultSnapshotId: readId(artifacts.value.resultSnapshot, "contextSnapshotId"),
      budgetSnapshotId: readId(artifacts.value.budgetSnapshot, "contextBudgetSnapshotId"),
      evictedSourceIds: plan.evictedSourceIds,
      inputTokens,
      outputTokens,
      usageRecordId: readId(artifacts.value.usageRecord, "usageId"),
      precision,
      summaryChecksum,
      status: "completed",
      createdAt: now()
    });

    // The cross-repository commit, in strict order. A crash at any point before the final commit
    // marker leaves orphaned-but-harmless artifacts and the prior activeCompactionId intact.
    const usageWritten = await usageSink.writeFinal(artifacts.value.usageRecord);
    if (!usageWritten.ok) return failed(usageWritten.error);
    const revisionWritten = await runRepository.writeCompactionRevision(
      revision as unknown as JsonObject
    );
    if (!revisionWritten.ok) return failed(revisionWritten.error);
    const resultWritten = await runRepository.writeContextSnapshot(artifacts.value.resultSnapshot);
    if (!resultWritten.ok) return failed(resultWritten.error);
    const budgetWritten = await runRepository.writeBudgetSnapshot(
      command.runId,
      artifacts.value.budgetSnapshot
    );
    if (!budgetWritten.ok) return failed(budgetWritten.error);
    const committed = await runRepository.commitCompaction(artifacts.value.runSnapshot);
    if (!committed.ok) return failed(committed.error);

    await emitCompaction({ type: "context_compaction_completed", compactionId, revision });
    return ok({ compactionId, revision, runSnapshot: committed.value });
  }

  async function emitCompaction(event: CompactionEvent): Promise<void> {
    if (options.onCompactionEvent === undefined) return;
    await options.onCompactionEvent(event);
  }

  async function preview(
    command: PreviewContextBudgetCommand
  ): Promise<Result<ContextBudgetSnapshot, UnifiedError>> {
    // Read-only: verify the referenced draft revision + checksum before trusting anything on it.
    const resolved = await options.draftSession.resolveStartDraft({
      projectId: command.projectId,
      conversationId: command.conversationId,
      runDraftId: command.runDraftId,
      runDraftRevision: command.expectedDraftRevision,
      runDraftChecksum: command.runDraftChecksum
    });
    if (!resolved.ok) return err(resolved.error);
    const view: AgentRunDraftView = resolved.value;
    const inputs = await options.budgetInputs.resolveBudgetInputs({
      projectId: command.projectId,
      conversationId: command.conversationId,
      draft: view.runDraft,
      contextDraft: view.contextDraft
    });
    if (!inputs.ok) return err(inputs.error);

    const profileId = view.runDraft.modelProfileId;
    const counts = [
      estimator.count(view.runDraft.userRequest, profileId),
      ...inputs.value.contents.map((content) => estimator.count(content.content, profileId))
    ];
    const usedTokens = counts.reduce((total, count) => total + count.tokens, 0);
    const precision: AgentContextPrecision = aggregateContextPrecision(
      counts.map((count) => count.precision)
    );

    return calculateContextBudget({
      contextBudgetSnapshotId: createBudgetSnapshotId(),
      provider: inputs.value.model.provider,
      model: inputs.value.model.model,
      contextWindow: inputs.value.model.contextWindow,
      ...(inputs.value.model.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: inputs.value.model.maxOutputTokens }),
      toolReserve: inputs.value.model.toolReserve,
      systemReserve: inputs.value.model.systemReserve,
      requiredContextTokens: inputs.value.model.requiredContextTokens,
      usedTokens,
      precision,
      calculatedAt: now()
    });
  }
}

function readId(value: JsonObject, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function compactionUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_COMPACTION_UNAVAILABLE",
    category: "AgentError",
    message: "Context compaction is not available for this run.",
    recoverability: "user-action",
    suggestedAction: "Retry once the compaction services are configured for this project.",
    traceId: "agent-context-session"
  });
}

function compactionPlanExecutionMismatch(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_COMPACTION_PLAN_EXECUTION_MISMATCH",
    category: "AgentError",
    message: "The plan execution record does not belong to the run being compacted.",
    recoverability: "user-action",
    suggestedAction: "Reload the run and its latest plan execution record before compacting.",
    traceId: "agent-context-session"
  });
}

function mergePlanExecutionFact(
  facts: readonly ProtectedContextFact[],
  record: PlanExecutionRecord
): readonly ProtectedContextFact[] {
  const latest = createPlanExecutionProtectedFact(record);
  let replaced = false;
  const merged = facts.map((fact) => {
    if (fact.kind !== "plan_execution" || fact.sourceId !== latest.sourceId) return fact;
    replaced = true;
    return latest;
  });
  return replaced ? merged : [...merged, latest];
}

function createDefaultBudgetSnapshotId(): string {
  return `budget_${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultCompactionId(): string {
  return `compaction_${Math.random().toString(36).slice(2, 10)}`;
}
