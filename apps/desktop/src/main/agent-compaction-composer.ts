import { createHash } from "node:crypto";

import {
  calculateContextBudget,
  normalizeAgentContextSnapshot,
  type AgentContextLayer,
  type AgentContextSnapshot,
  type AgentContextSource,
  type ContextBudgetSnapshot
} from "@novel-studio/agent-engine";
import type {
  CompactContextSourcesPort,
  CompactionArtifactRequest,
  CompactionArtifacts,
  CompactionInputs,
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
      const { run, snapshot } = loaded.value;
      const classified = classifySources(snapshot.sources);
      const budget = recomputeBudget(run, command.contextBudgetSnapshotId, currentTokens(run, snapshot), now());
      if (!budget.ok) return err(budget.error);
      const nextRevision = snapshot.compactionRevision + 1;
      const inputs: CompactionInputs = {
        sourceSnapshotId: snapshot.contextSnapshotId,
        throughSequence: readNonNegative(run["lastSequence"]),
        nextRevision,
        protectedFacts: classified.protectedFacts,
        evictableSources: classified.evictableSources,
        currentTokens: currentTokens(run, snapshot),
        targetTokens: Math.floor(budget.value.safeInputBudget * COMPACTION_TARGET_RATIO)
      };
      const prior = await readPriorProtected(repository, run);
      return ok(prior === undefined ? inputs : { ...inputs, prior });
    },

    async buildArtifacts(request) {
      const loaded = await readRunContext(repository, request.command.runId);
      if (!loaded.ok) return err(loaded.error);
      return buildArtifacts(loaded.value, request, now());
    }
  };
}

interface RunContext {
  readonly run: JsonObject;
  readonly snapshot: AgentContextSnapshot;
}

/** Read the run.json and its live Context Snapshot, normalized to v1.1. */
async function readRunContext(
  repository: AgentRunFileRepository,
  runId: string
): Promise<Result<RunContext, UnifiedError>> {
  const run = await repository.readSnapshot(runId);
  if (!run.ok) return err(run.error);
  if (run.value === undefined) return err(composerError("AGENT_CONTEXT_COMPACTION_RUN_NOT_FOUND"));
  const contextSnapshotId = run.value["contextSnapshotId"];
  if (typeof contextSnapshotId !== "string") {
    return err(composerError("AGENT_CONTEXT_COMPACTION_NO_SNAPSHOT"));
  }
  const stored = await repository.readContextSnapshot(runId, contextSnapshotId);
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined) {
    return err(composerError("AGENT_CONTEXT_COMPACTION_NO_SNAPSHOT"));
  }
  return ok({ run: run.value, snapshot: normalizeAgentContextSnapshot(stored.value) });
}

interface ClassifiedSources {
  readonly protectedFacts: readonly ProtectedContextFact[];
  readonly evictableSources: readonly EvictableContextSource[];
}

/** Split snapshot sources into protected facts (kept verbatim) and evictable tool results. */
function classifySources(sources: readonly AgentContextSource[]): ClassifiedSources {
  const protectedFacts: ProtectedContextFact[] = [];
  const evictableSources: EvictableContextSource[] = [];
  for (const source of sources) {
    if (source.state === "excluded") continue;
    const protectedKind = PROTECTED_FACT_KIND[source.layer];
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
        source.relativePath !== undefined || source.assetId !== undefined
          ? "rereadable_body"
          : "raw_result",
      pointerTokenCount: Math.min(POINTER_TOKENS, tokenCount)
    });
  }
  return { protectedFacts, evictableSources };
}

/** The run's current input token count: the authoritative usage summary, else the per-source sum. */
function currentTokens(run: JsonObject, snapshot: AgentContextSnapshot): number {
  const summary = run["usageSummary"];
  if (isRecord(summary) && isTokenCount(summary["inputTokens"])) {
    return summary["inputTokens"];
  }
  return snapshot.sources.reduce((total, source) => total + (source.tokenCount ?? 0), 0);
}

/** Recompute the budget from the run's provider capability snapshot (renderer previews never trusted). */
function recomputeBudget(
  run: JsonObject,
  contextBudgetSnapshotId: string,
  usedTokens: number,
  calculatedAt: string
): Result<ContextBudgetSnapshot, UnifiedError> {
  const capability = run["providerCapabilitySnapshot"];
  if (!isRecord(capability)) return err(composerError("AGENT_CONTEXT_COMPACTION_NO_CAPABILITY"));
  return calculateContextBudget({
    contextBudgetSnapshotId,
    provider: String(capability["provider"] ?? ""),
    model: String(capability["modelName"] ?? ""),
    contextWindow: readNonNegative(capability["contextWindow"]),
    toolReserve: 0,
    systemReserve: 0,
    requiredContextTokens: readNonNegative(capability["requiredContextTokens"]),
    usedTokens,
    precision: "estimated",
    calculatedAt
  });
}

/** Load the prior committed compaction's protected facts so progress can be validated (no regress). */
async function readPriorProtected(
  repository: AgentRunFileRepository,
  run: JsonObject
): Promise<CompactionInputs["prior"]> {
  const activeCompactionId = run["activeCompactionId"];
  if (typeof activeCompactionId !== "string") return undefined;
  const manifest = await repository.readCompactionManifest(String(run["runId"]), activeCompactionId);
  if (!manifest.ok || manifest.value === undefined) return undefined;
  const priorFacts = manifest.value["protectedFacts"];
  return {
    throughSequence: readNonNegative(manifest.value["throughSequence"]),
    protectedFacts: Array.isArray(priorFacts)
      ? (priorFacts as unknown as ProtectedContextFact[])
      : []
  };
}

/** Build the four content-bearing artifacts. Each carries the id the session reads back. */
function buildArtifacts(
  context: RunContext,
  request: CompactionArtifactRequest,
  createdAt: string
): Result<CompactionArtifacts, UnifiedError> {
  const { run, snapshot } = context;
  const evicted = new Set(request.evictedSourceIds);
  const nextRevision = snapshot.compactionRevision + 1;
  const resultSnapshotId = `${snapshot.contextSnapshotId}_c${nextRevision}`;
  const budgetSnapshotId = `budget_${String(run["runId"])}_c${nextRevision}`;

  // The result snapshot keeps every source but marks evicted ones excluded — the pointer stays,
  // the raw body is dropped. Protected facts and non-evicted sources pass through unchanged.
  const resultSources = snapshot.sources.map((source) =>
    evicted.has(source.refId) ? { ...source, state: "excluded" as const } : source
  );
  const resultSnapshot: JsonObject = {
    ...(snapshot as unknown as JsonObject),
    contextSnapshotId: resultSnapshotId,
    compactionRevision: nextRevision,
    createdAt,
    sources: resultSources as unknown as JsonObject["sources"],
    excludedSources: [
      ...new Set([...(snapshot.excludedSources ?? []), ...request.evictedSourceIds])
    ]
  };

  const afterTokens = resultSources.reduce(
    (total, source) =>
      source.state === "excluded" ? total : total + (source.tokenCount ?? 0),
    0
  );
  const budget = recomputeBudget(run, budgetSnapshotId, afterTokens, createdAt);
  if (!budget.ok) return err(budget.error);
  const beforeTokens = currentTokens(run, snapshot);

  const usageRecord = buildUsageRecord({
    run,
    request,
    budget: budget.value,
    beforeTokens,
    afterTokens,
    createdAt
  });

  const runSnapshot: JsonObject = {
    ...run,
    activeCompactionId: request.manifest.compactionId,
    contextSnapshotId: resultSnapshotId,
    contextBudgetSnapshotId: budgetSnapshotId,
    updatedAt: createdAt
  };

  return ok({
    resultSnapshot,
    budgetSnapshot: budget.value as unknown as JsonObject,
    usageRecord,
    runSnapshot
  });
}

/** A redacted final usage record for the compaction round: only token/budget facts, never content. */
function buildUsageRecord(input: {
  readonly run: JsonObject;
  readonly request: CompactionArtifactRequest;
  readonly budget: ContextBudgetSnapshot;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly createdAt: string;
}): JsonObject {
  const { run, request, budget } = input;
  const capability = isRecord(run["providerCapabilitySnapshot"])
    ? run["providerCapabilitySnapshot"]
    : {};
  const compactionId = request.manifest.compactionId;
  const date = new Date(input.createdAt);
  const inputTokens = readNonNegative(request.inputTokens);
  const outputTokens = readNonNegative(request.outputTokens);
  return {
    schemaVersion: "1.0",
    usageId: `usage_${compactionId}`,
    runId: String(run["runId"]),
    conversationId: String(run["conversationId"] ?? ""),
    projectId: String(run["projectId"]),
    roundId: compactionId,
    finalSequence: readNonNegative(run["lastSequence"]),
    provider: String(capability["provider"] ?? ""),
    model: String(capability["modelName"] ?? ""),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usageStatus: request.strategy === "model_assisted" ? "estimated" : "missing",
    precision: request.precision,
    pricingVersion: null,
    unitPrices: null,
    cost: { amount: 0, currency: "", status: "unknown" },
    contextWindow: budget.contextWindow,
    safeInputBudget: budget.safeInputBudget,
    compactionBeforeTokens: input.beforeTokens,
    compactionAfterTokens: input.afterTokens,
    terminationReason: "context_compaction",
    timestamp: input.createdAt,
    localDate: input.createdAt.slice(0, 10),
    timezone: "UTC",
    utcOffsetMinutes: Number.isNaN(date.getTime()) ? 0 : 0
  };
}

function checksumHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function readNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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


