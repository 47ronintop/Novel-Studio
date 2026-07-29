import {
  agentContextScopeKey,
  buildCompactionInputManifest,
  createContextCompactionRevision,
  createDeterministicTokenEstimator,
  createPlanExecutionProtectedFact,
  planDeterministicEviction,
  isAgentContextScope,
  validateCompactionResultProgress,
  type AgentContextPrecision,
  type AgentContextProfileId,
  type AgentContextScope,
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
import {
  calculateResolvedContextBudget,
  type ResolvedAgentContextBudgetInputs
} from "./agent-context-budget.js";
import {
  buildCompactionSummaryPrompt,
  createCompactionSummaryArtifact,
  parseCompactionSummaryArtifact,
  validateCompactionSummaryResult,
  type AgentCompactionSummaryArtifact,
  type CompactionSummaryResult
} from "./agent-compaction-summary.js";

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
  /** C4 canonical operands. Preview fails closed unless this complete proof is present. */
  readonly resolved: ResolvedAgentContextBudgetInputs;
}

/**
 * The port that turns a resolved draft into the concrete budget facts: the model window/reserves and
 * the resolved content of every context reference. This is where content reading lives, so the
 * session stays pure arithmetic + estimation over already-resolved material.
 */
export interface AgentContextBudgetInputsPort {
  resolveBudgetInputs(input: {
    readonly projectId?: string;
    readonly scope?: AgentContextScope;
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
  readonly modelSummary?: {
    readonly profileId: AgentContextProfileId;
    readonly evidence: string;
    readonly evidenceChecksum: string;
    readonly maxSummaryTokens: number;
    readonly provider: string;
    readonly model: string;
    readonly modelProfileId: string;
  };
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
  /**
   * Frozen prompt base bound to `resultSnapshot`. When present it must be persisted before the
   * Context Snapshot pointer becomes reachable, so a crash cannot leave hydrate pointing at a
   * prompt artifact that does not exist.
   */
  readonly promptMaterialization?: JsonObject;
  readonly budgetSnapshot: JsonObject;
  readonly usageRecord: JsonObject;
  readonly runSnapshot: JsonObject;
}

export interface CompactionArtifactRequest {
  readonly command: CompactContextCommand;
  readonly manifest: CompactionInputManifest;
  readonly strategy: "deterministic" | "model_assisted";
  readonly evictedSourceIds: readonly string[];
  readonly targetTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly precision: AgentContextPrecision;
  readonly summaryChecksum: string;
  readonly summaryArtifact?: AgentCompactionSummaryArtifact;
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
  writeCompactionSummaryArtifact?(
    runId: string,
    artifact: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  readCompactionSummaryArtifact?(
    runId: string,
    artifactId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writePromptMaterialization?(
    runId: string,
    artifact: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  writeContextSnapshot(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeBudgetSnapshot(
    runId: string,
    snapshot: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  commitCompaction(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeCommandReceipt?(
    runId: string,
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  readCommandReceipt?(
    runId: string,
    commandId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  readSnapshot?(runId: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
  readCompactionRevision?(
    runId: string,
    compactionId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
}

export interface CompactionUsageSinkPort {
  writeFinal(record: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
}

/** A no-tools model summarizer over the evictable material. Protected facts are never sent to it. */
export interface CompactionModelAssistantPort {
  summarizeEvictable(input: {
    readonly runId: string;
    readonly evictableSources: readonly EvictableContextSource[];
    readonly profileId: AgentContextProfileId;
    readonly templateVersion: string;
    readonly systemPrompt: string;
    readonly evidence: string;
    readonly evidenceChecksum: string;
    readonly maxSummaryTokens: number;
  }): Promise<
    Result<
      {
        readonly inputTokens: number;
        readonly summary: CompactionSummaryResult;
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

interface PendingCompactionReceipt {
  readonly schemaVersion: "1.0";
  readonly kind: "context_compaction";
  readonly status: "pending";
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly runId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly contextBudgetSnapshotId: string;
  readonly trigger: CompactContextCommand["trigger"];
  readonly compactionId: string;
  readonly startedAt: string;
}

interface CompactionModelResult {
  readonly summaryArtifactId: string;
  readonly summaryChecksum: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly precision: AgentContextPrecision;
}

interface ModelCompletedCompactionReceipt extends Omit<PendingCompactionReceipt, "status"> {
  readonly status: "model_completed";
  readonly modelResult: CompactionModelResult;
}

interface CompletedCompactionReceipt extends Omit<PendingCompactionReceipt, "status"> {
  readonly status: "completed";
  readonly modelResult?: CompactionModelResult;
  readonly result: CompactContextResult;
}

type InProgressCompactionReceipt = PendingCompactionReceipt | ModelCompletedCompactionReceipt;
type CompactionCommandReceipt = InProgressCompactionReceipt | CompletedCompactionReceipt;

export function createAgentContextSession(
  options: CreateAgentContextSessionOptions
): AgentContextSession {
  const estimator = options.estimator ?? createDeterministicTokenEstimator();
  const now = options.now ?? (() => new Date().toISOString());
  const createBudgetSnapshotId = options.createBudgetSnapshotId ?? createDefaultBudgetSnapshotId;
  const receipts = new Map<string, Result<ContextBudgetSnapshot, UnifiedError>>();
  const compactionReceipts = new Map<string, CompactionCommandReceipt>();
  const inFlightCompactions = new Map<
    string,
    Promise<Result<CompactContextResult, UnifiedError>>
  >();

  const createCompactionId = options.createCompactionId ?? createDefaultCompactionId;

  return {
    async previewContextBudget(command) {
      const resolved = await resolvePreviewDraft(command);
      if (!resolved.ok) return err(resolved.error);
      const key = `${agentContextScopeKey(resolved.value.runDraft.scope)}:${command.conversationId}:${command.commandId}`;
      const cached = receipts.get(key);
      if (cached !== undefined) return cached;
      const result = await preview(command, resolved.value);
      receipts.set(key, result);
      return result;
    },

    compactContext(command) {
      const key = compactionReceiptKey(command);
      const active = inFlightCompactions.get(key);
      if (active !== undefined) return active;
      const request = compact(command);
      inFlightCompactions.set(key, request);
      const clear = () => {
        if (inFlightCompactions.get(key) === request) inFlightCompactions.delete(key);
      };
      void request.then(clear, clear);
      return request;
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

    const prior = await readCompactionReceipt(runRepository, command);
    if (!prior.ok) return err(prior.error);
    if (prior.value !== undefined && !receiptMatchesCommand(prior.value, command)) {
      return err(compactionCommandConflict());
    }
    if (prior.value?.status === "completed") return ok(prior.value.result);
    if (prior.value !== undefined) {
      const recovered = await recoverCommittedCompaction(runRepository, prior.value);
      if (!recovered.ok) return err(recovered.error);
      if (recovered.value !== undefined) {
        return persistCompletedCompactionReceipt(runRepository, prior.value, recovered.value);
      }
    }
    let inProgress: InProgressCompactionReceipt =
      prior.value !== undefined
        ? prior.value
        : createPendingCompactionReceipt(command, createCompactionId(), now());
    if (prior.value === undefined) {
      const persisted = await persistCompactionReceipt(runRepository, inProgress);
      if (!persisted.ok) return err(persisted.error);
    }

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

    const compactionId = inProgress.compactionId;
    const manifestResult = buildCompactionInputManifest({
      compactionId,
      runId: command.runId,
      sourceSnapshotId: inputs.sourceSnapshotId,
      throughSequence: inputs.throughSequence,
      protectedFacts,
      evictableSources: inputs.evictableSources,
      createdAt: inProgress.startedAt
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
    let summaryArtifact: AgentCompactionSummaryArtifact | undefined;
    if (!plan.reachedTarget && inProgress.status === "model_completed") {
      const restoredSummary = await readPersistedSummaryArtifact(
        runRepository,
        command.runId,
        inProgress.modelResult,
        inputs,
        manifest
      );
      if (!restoredSummary.ok) return failed(restoredSummary.error);
      summaryArtifact = restoredSummary.value;
      strategy = "model_assisted";
      inputTokens = inProgress.modelResult.inputTokens;
      outputTokens = summaryArtifact.tokenCount;
      precision = summaryArtifact.precision;
      summaryChecksum = summaryArtifact.checksum;
    } else if (!plan.reachedTarget) {
      const modelSummary = inputs.modelSummary;
      if (
        options.modelAssistant === undefined ||
        modelSummary === undefined ||
        runRepository.writeCompactionSummaryArtifact === undefined
      ) {
        return failed(compactionTargetUnreached());
      }
      const summaryPrompt = buildCompactionSummaryPrompt(modelSummary.profileId);
      const summarized = await options.modelAssistant.summarizeEvictable({
        runId: command.runId,
        evictableSources: inputs.evictableSources,
        profileId: modelSummary.profileId,
        templateVersion: summaryPrompt.templateVersion,
        systemPrompt: summaryPrompt.systemPrompt,
        evidence: modelSummary.evidence,
        evidenceChecksum: modelSummary.evidenceChecksum,
        maxSummaryTokens: modelSummary.maxSummaryTokens
      });
      if (!summarized.ok) return failed(summarized.error);
      if (!isNonNegativeInteger(summarized.value.inputTokens)) {
        return failed(compactionModelResultInvalid());
      }
      const validatedSummary = validateCompactionSummaryResult({
        profileId: modelSummary.profileId,
        result: summarized.value.summary,
        maxSummaryTokens: modelSummary.maxSummaryTokens,
        expectedInputChecksum: modelSummary.evidenceChecksum,
        expectedProvider: modelSummary.provider,
        expectedModel: modelSummary.model,
        expectedModelProfileId: modelSummary.modelProfileId,
        estimator
      });
      if (!validatedSummary.ok) return failed(validatedSummary.error);
      summaryArtifact = createCompactionSummaryArtifact({
        artifactId: `summary_${compactionId}`,
        runId: command.runId,
        compactionId,
        contextProfileId: modelSummary.profileId,
        sourceSnapshotId: inputs.sourceSnapshotId,
        throughSequence: inputs.throughSequence,
        inputManifestChecksum: manifest.checksum,
        result: validatedSummary.value,
        createdAt: inProgress.startedAt
      });
      const artifactWritten = await runRepository.writeCompactionSummaryArtifact(
        command.runId,
        summaryArtifact as unknown as JsonObject
      );
      if (!artifactWritten.ok) return failed(artifactWritten.error);
      const modelResult: CompactionModelResult = {
        summaryArtifactId: summaryArtifact.artifactId,
        summaryChecksum: summaryArtifact.checksum,
        inputTokens: summarized.value.inputTokens,
        outputTokens: summaryArtifact.tokenCount,
        precision: summaryArtifact.precision
      };
      const modelCompleted: ModelCompletedCompactionReceipt = {
        ...inProgress,
        status: "model_completed",
        modelResult
      };
      const persisted = await persistCompactionReceipt(runRepository, modelCompleted);
      if (!persisted.ok) return failed(persisted.error);
      inProgress = modelCompleted;
      strategy = "model_assisted";
      inputTokens = modelCompleted.modelResult.inputTokens;
      outputTokens = modelCompleted.modelResult.outputTokens;
      precision = modelCompleted.modelResult.precision;
      summaryChecksum = modelCompleted.modelResult.summaryChecksum;
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
      targetTokens: inputs.targetTokens,
      inputTokens,
      outputTokens,
      precision,
      summaryChecksum,
      ...(summaryArtifact === undefined ? {} : { summaryArtifact })
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
      createdAt: inProgress.startedAt
    });

    // The cross-repository commit, in strict order. A crash at any point before the final commit
    // marker leaves orphaned-but-harmless artifacts and the prior activeCompactionId intact.
    const usageWritten = await usageSink.writeFinal(artifacts.value.usageRecord);
    if (!usageWritten.ok) return failed(usageWritten.error);
    const revisionWritten = await runRepository.writeCompactionRevision(
      revision as unknown as JsonObject
    );
    if (!revisionWritten.ok) return failed(revisionWritten.error);
    if (artifacts.value.promptMaterialization !== undefined) {
      if (runRepository.writePromptMaterialization === undefined) {
        return failed(compactionPromptMaterializationUnavailable());
      }
      const promptWritten = await runRepository.writePromptMaterialization(
        command.runId,
        artifacts.value.promptMaterialization
      );
      if (!promptWritten.ok) return failed(promptWritten.error);
    }
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
    return persistCompletedCompactionReceipt(runRepository, inProgress, {
      compactionId,
      revision,
      runSnapshot: committed.value
    });
  }

  async function readCompactionReceipt(
    repository: CompactionRunRepositoryPort,
    command: CompactContextCommand
  ): Promise<Result<CompactionCommandReceipt | undefined, UnifiedError>> {
    const key = compactionReceiptKey(command);
    const cached = compactionReceipts.get(key);
    if (cached !== undefined) return ok(cached);
    if (repository.readCommandReceipt === undefined) return ok(undefined);
    const stored = await repository.readCommandReceipt(command.runId, command.commandId);
    if (!stored.ok) return err(stored.error);
    if (stored.value === undefined) return ok(undefined);
    const parsed = parseCompactionReceipt(stored.value);
    if (parsed === undefined) return err(compactionCommandConflict());
    compactionReceipts.set(key, parsed);
    return ok(parsed);
  }

  async function persistCompactionReceipt(
    repository: CompactionRunRepositoryPort,
    receipt: CompactionCommandReceipt
  ): Promise<Result<CompactionCommandReceipt, UnifiedError>> {
    if (repository.writeCommandReceipt !== undefined) {
      const written = await repository.writeCommandReceipt(
        receipt.runId,
        receipt.commandId,
        receipt as unknown as JsonObject
      );
      if (!written.ok) return err(written.error);
    }
    compactionReceipts.set(`${receipt.runId}:${receipt.commandId}`, receipt);
    return ok(receipt);
  }

  async function persistCompletedCompactionReceipt(
    repository: CompactionRunRepositoryPort,
    inProgress: InProgressCompactionReceipt,
    result: CompactContextResult
  ): Promise<Result<CompactContextResult, UnifiedError>> {
    const receipt: CompletedCompactionReceipt = {
      ...inProgress,
      status: "completed",
      result
    };
    const persisted = await persistCompactionReceipt(repository, receipt);
    return persisted.ok ? ok(result) : err(persisted.error);
  }

  async function emitCompaction(event: CompactionEvent): Promise<void> {
    if (options.onCompactionEvent === undefined) return;
    await options.onCompactionEvent(event);
  }

  async function preview(
    command: PreviewContextBudgetCommand,
    view: AgentRunDraftView
  ): Promise<Result<ContextBudgetSnapshot, UnifiedError>> {
    const inputs = await options.budgetInputs.resolveBudgetInputs({
      ...(command.scope === undefined ? {} : { scope: command.scope }),
      ...(command.projectId === undefined ? {} : { projectId: command.projectId }),
      conversationId: command.conversationId,
      draft: view.runDraft,
      contextDraft: view.contextDraft
    });
    if (!inputs.ok) return err(inputs.error);
    if (inputs.value.resolved === undefined) return err(contextBudgetInputsIncomplete());
    return calculateResolvedContextBudget({
      contextBudgetSnapshotId: createBudgetSnapshotId(),
      resolved: inputs.value.resolved,
      calculatedAt: now()
    });
  }

  function resolvePreviewDraft(
    command: PreviewContextBudgetCommand
  ): Promise<Result<AgentRunDraftView, UnifiedError>> {
    // Read-only: verify the referenced identity, draft revision, and checksum before cache lookup.
    return options.draftSession.resolveStartDraft({
      ...(command.scope === undefined ? {} : { scope: command.scope }),
      ...(command.projectId === undefined ? {} : { projectId: command.projectId }),
      conversationId: command.conversationId,
      runDraftId: command.runDraftId,
      runDraftRevision: command.expectedDraftRevision,
      runDraftChecksum: command.runDraftChecksum
    });
  }
}

function compactionReceiptKey(command: Pick<CompactContextCommand, "runId" | "commandId">): string {
  return `${command.runId}:${command.commandId}`;
}

function createPendingCompactionReceipt(
  command: CompactContextCommand,
  compactionId: string,
  startedAt: string
): PendingCompactionReceipt {
  return {
    schemaVersion: "1.0",
    kind: "context_compaction",
    status: "pending",
    ...(command.scope === undefined ? {} : { scope: command.scope }),
    ...(command.projectId === undefined ? {} : { projectId: command.projectId }),
    runId: command.runId,
    commandId: command.commandId,
    expectedRunRevision: command.expectedRunRevision,
    contextBudgetSnapshotId: command.contextBudgetSnapshotId,
    trigger: command.trigger,
    compactionId,
    startedAt
  };
}

function receiptMatchesCommand(
  receipt: CompactionCommandReceipt,
  command: CompactContextCommand
): boolean {
  return (
    scopeIdentitiesMatch(receipt, command) &&
    receipt.runId === command.runId &&
    receipt.commandId === command.commandId &&
    receipt.expectedRunRevision === command.expectedRunRevision &&
    receipt.contextBudgetSnapshotId === command.contextBudgetSnapshotId &&
    receipt.trigger === command.trigger
  );
}

function parseCompactionReceipt(value: JsonObject): CompactionCommandReceipt | undefined {
  const identity = parseScopeIdentity(value);
  if (
    value["schemaVersion"] !== "1.0" ||
    value["kind"] !== "context_compaction" ||
    (value["status"] !== "pending" &&
      value["status"] !== "model_completed" &&
      value["status"] !== "completed") ||
    identity === undefined ||
    typeof value["runId"] !== "string" ||
    typeof value["commandId"] !== "string" ||
    !Number.isSafeInteger(value["expectedRunRevision"]) ||
    typeof value["contextBudgetSnapshotId"] !== "string" ||
    (value["trigger"] !== "manual" &&
      value["trigger"] !== "automatic" &&
      value["trigger"] !== "recovery") ||
    typeof value["compactionId"] !== "string" ||
    typeof value["startedAt"] !== "string"
  ) {
    return undefined;
  }
  const base: PendingCompactionReceipt = {
    schemaVersion: "1.0",
    kind: "context_compaction",
    status: "pending",
    ...identity,
    runId: value["runId"],
    commandId: value["commandId"],
    expectedRunRevision: Number(value["expectedRunRevision"]),
    contextBudgetSnapshotId: value["contextBudgetSnapshotId"],
    trigger: value["trigger"],
    compactionId: value["compactionId"],
    startedAt: value["startedAt"]
  };
  if (value["status"] === "pending") return base;
  const modelResult = parseCompactionModelResult(value["modelResult"]);
  if (value["status"] === "model_completed") {
    return modelResult === undefined
      ? undefined
      : { ...base, status: "model_completed", modelResult };
  }
  const result = parseCompactContextResult(value["result"], base.compactionId);
  if (result === undefined || (value["modelResult"] !== undefined && modelResult === undefined)) {
    return undefined;
  }
  return {
    ...base,
    status: "completed",
    ...(modelResult === undefined ? {} : { modelResult }),
    result
  };
}

interface ScopeIdentity {
  readonly scope?: AgentContextScope;
  readonly projectId?: string;
}

function parseScopeIdentity(value: JsonObject): ScopeIdentity | undefined {
  const scope = value["scope"];
  const projectId = value["projectId"];
  if (scope !== undefined && !isAgentContextScope(scope)) return undefined;
  if (projectId !== undefined && typeof projectId !== "string") return undefined;
  const identity: ScopeIdentity = {
    ...(scope === undefined ? {} : { scope }),
    ...(projectId === undefined ? {} : { projectId })
  };
  return scopeIdentityKey(identity) === undefined ? undefined : identity;
}

function scopeIdentityKey(identity: ScopeIdentity): string | undefined {
  if (identity.scope !== undefined) {
    if (
      identity.projectId !== undefined &&
      (identity.scope.kind !== "workspace" || identity.scope.workspaceId !== identity.projectId)
    ) {
      return undefined;
    }
    return agentContextScopeKey(identity.scope);
  }
  return identity.projectId === undefined ? undefined : `workspace:legacy:${identity.projectId}`;
}

function scopeIdentitiesMatch(left: ScopeIdentity, right: ScopeIdentity): boolean {
  const leftKey = scopeIdentityKey(left);
  const rightKey = scopeIdentityKey(right);
  if (leftKey === undefined || rightKey === undefined) return false;
  if (leftKey === rightKey) return true;
  const leftProjectId = left.scope?.kind === "workspace" ? left.scope.workspaceId : left.projectId;
  const rightProjectId =
    right.scope?.kind === "workspace" ? right.scope.workspaceId : right.projectId;
  return (
    leftProjectId !== undefined &&
    rightProjectId !== undefined &&
    leftProjectId === rightProjectId &&
    left.scope?.kind !== "standalone" &&
    right.scope?.kind !== "standalone"
  );
}

function parseCompactionModelResult(value: unknown): CompactionModelResult | undefined {
  if (!isJsonObject(value)) return undefined;
  const precision = value["precision"];
  if (
    typeof value["summaryArtifactId"] !== "string" ||
    value["summaryArtifactId"].length === 0 ||
    typeof value["summaryChecksum"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value["summaryChecksum"]) ||
    !isNonNegativeInteger(value["inputTokens"]) ||
    !isNonNegativeInteger(value["outputTokens"]) ||
    (precision !== "reported" && precision !== "estimated" && precision !== "unknown")
  ) {
    return undefined;
  }
  return {
    summaryArtifactId: value["summaryArtifactId"],
    summaryChecksum: value["summaryChecksum"],
    inputTokens: value["inputTokens"],
    outputTokens: value["outputTokens"],
    precision
  };
}

async function readPersistedSummaryArtifact(
  repository: CompactionRunRepositoryPort,
  runId: string,
  modelResult: CompactionModelResult,
  inputs: CompactionInputs,
  manifest: CompactionInputManifest
): Promise<Result<AgentCompactionSummaryArtifact, UnifiedError>> {
  const modelSummary = inputs.modelSummary;
  if (repository.readCompactionSummaryArtifact === undefined || modelSummary === undefined) {
    return err(compactionModelResultInvalid());
  }
  const stored = await repository.readCompactionSummaryArtifact(
    runId,
    modelResult.summaryArtifactId
  );
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined) return err(compactionModelResultInvalid());
  try {
    const artifact = parseCompactionSummaryArtifact(stored.value);
    const validated = validateCompactionSummaryResult({
      profileId: modelSummary.profileId,
      result: artifact,
      maxSummaryTokens: modelSummary.maxSummaryTokens,
      expectedInputChecksum: modelSummary.evidenceChecksum,
      expectedProvider: modelSummary.provider,
      expectedModel: modelSummary.model,
      expectedModelProfileId: modelSummary.modelProfileId
    });
    if (
      !validated.ok ||
      artifact.artifactId !== modelResult.summaryArtifactId ||
      artifact.runId !== runId ||
      artifact.compactionId !== manifest.compactionId ||
      artifact.contextProfileId !== modelSummary.profileId ||
      artifact.sourceSnapshotId !== inputs.sourceSnapshotId ||
      artifact.throughSequence !== inputs.throughSequence ||
      artifact.inputManifestChecksum !== manifest.checksum ||
      artifact.checksum !== modelResult.summaryChecksum ||
      artifact.tokenCount !== modelResult.outputTokens ||
      artifact.precision !== modelResult.precision
    ) {
      return err(compactionModelResultInvalid());
    }
    return ok(artifact);
  } catch {
    return err(compactionModelResultInvalid());
  }
}

function parseCompactContextResult(
  value: unknown,
  compactionId: string
): CompactContextResult | undefined {
  if (!isJsonObject(value) || value["compactionId"] !== compactionId) return undefined;
  const revision = value["revision"];
  const runSnapshot = value["runSnapshot"];
  if (
    !isJsonObject(revision) ||
    revision["compactionId"] !== compactionId ||
    revision["status"] !== "completed" ||
    !isJsonObject(runSnapshot) ||
    runSnapshot["activeCompactionId"] !== compactionId
  ) {
    return undefined;
  }
  return {
    compactionId,
    revision: revision as unknown as ContextCompactionRevision,
    runSnapshot
  };
}

async function recoverCommittedCompaction(
  repository: CompactionRunRepositoryPort,
  receipt: InProgressCompactionReceipt
): Promise<Result<CompactContextResult | undefined, UnifiedError>> {
  if (repository.readSnapshot === undefined || repository.readCompactionRevision === undefined) {
    return ok(undefined);
  }
  const snapshot = await repository.readSnapshot(receipt.runId);
  if (!snapshot.ok) return err(snapshot.error);
  if (snapshot.value?.["activeCompactionId"] !== receipt.compactionId) return ok(undefined);
  const revision = await repository.readCompactionRevision(receipt.runId, receipt.compactionId);
  if (!revision.ok) return err(revision.error);
  const result = parseCompactContextResult(
    {
      compactionId: receipt.compactionId,
      revision: revision.value,
      runSnapshot: snapshot.value
    },
    receipt.compactionId
  );
  return result === undefined ? err(compactionRecoveryInvalid()) : ok(result);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

function contextBudgetInputsIncomplete(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID",
    category: "ValidationError",
    message: "The server-authoritative context budget inputs are incomplete or invalid.",
    recoverability: "user-action",
    suggestedAction: "Choose a model with verified budget capabilities and retry.",
    traceId: "agent-context-session"
  });
}

function compactionPromptMaterializationUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_PROMPT_MATERIALIZATION_UNAVAILABLE",
    category: "AgentError",
    message: "The compacted prompt materialization cannot be persisted.",
    recoverability: "user-action",
    suggestedAction: "Retry once the prompt materialization repository is available.",
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

function compactionCommandConflict(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_COMPACTION_COMMAND_CONFLICT",
    category: "ValidationError",
    message: "The compaction command ID is already bound to different inputs.",
    recoverability: "user-action",
    suggestedAction: "Refresh the run and submit a new compaction command ID.",
    traceId: "agent-context-session"
  });
}

function compactionRecoveryInvalid(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_COMPACTION_RECOVERY_INVALID",
    category: "AgentError",
    message: "The committed compaction could not be reconstructed from persisted artifacts.",
    recoverability: "user-action",
    suggestedAction: "Reload the run before retrying context compaction.",
    traceId: "agent-context-session"
  });
}

function compactionModelResultInvalid(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_COMPACTION_MODEL_RESULT_INVALID",
    category: "ValidationError",
    message: "The model-assisted compaction result is invalid.",
    recoverability: "user-action",
    suggestedAction: "Retry context compaction with a valid model result.",
    traceId: "agent-context-session"
  });
}

function compactionTargetUnreached(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_COMPACTION_TARGET_UNREACHED",
    category: "AgentError",
    message: "Context compaction could not reach its verified token target.",
    recoverability: "user-action",
    suggestedAction: "Refresh or exclude context before retrying compaction.",
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
