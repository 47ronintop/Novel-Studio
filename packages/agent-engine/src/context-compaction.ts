import { createHash } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { AgentContextLayer, AgentContextPrecision } from "./context-snapshot.js";
import type { PlanExecutionRecord, PlanExecutionStepStatus } from "./plan-execution.js";

/** The categories of fact that must survive compaction unchanged (never summarized or evicted). */
export type ProtectedContextFactKind =
  | "run_goal"
  | "user_decision"
  | "approved_plan"
  | "plan_execution"
  | "unresolved_question"
  | "explicit_ref"
  | "pending_change_set"
  | "recovery"
  | "undo";

interface ProtectedContextFactBase {
  readonly kind: ProtectedContextFactKind;
  readonly factId: string;
  readonly sourceId: string;
  readonly checksum: string;
  readonly planExecution?: PlanExecutionProtectedValue;
}

export interface PlanExecutionProtectedStep {
  readonly stepId: string;
  readonly status: PlanExecutionStepStatus;
  readonly verification: readonly string[];
  readonly checkpointId: string | null;
  readonly eventSequence: number | null;
}

export interface PlanExecutionProtectedValue {
  readonly planExecutionId: string;
  readonly revision: number;
  readonly steps: readonly PlanExecutionProtectedStep[];
}

/** A protected fact carries exactly one provenance: a source revision OR an event sequence. */
export type ProtectedContextFact =
  | (ProtectedContextFactBase & { readonly sourceRevision: number; readonly eventSequence?: never })
  | (ProtectedContextFactBase & {
      readonly sourceRevision?: never;
      readonly eventSequence: number;
    });

export type PlanExecutionProtectedFact = ProtectedContextFact & {
  readonly kind: "plan_execution";
  readonly sourceRevision: number;
  readonly eventSequence?: never;
  readonly planExecution: PlanExecutionProtectedValue;
};

/** A context source the deterministic/model-assisted pass may replace with a pointer. */
export interface EvictableContextSource {
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly layer: AgentContextLayer;
  readonly checksum: string;
  readonly tokenCount: number;
  readonly evictionReason: "duplicate" | "raw_result" | "rereadable_body" | "superseded_transient";
  readonly pointerTokenCount: number;
}

export interface CompactionInputManifest {
  readonly schemaVersion: "1.0";
  readonly compactionId: string;
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly throughSequence: number;
  readonly protectedFacts: readonly ProtectedContextFact[];
  readonly evictableSources: readonly EvictableContextSource[];
  readonly checksum: string;
  readonly createdAt: string;
}

export interface ContextCompactionRevision {
  readonly schemaVersion: "1.0";
  readonly compactionId: string;
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly resultSnapshotId: string | null;
  readonly budgetSnapshotId: string | null;
  readonly inputManifestId: string;
  readonly inputManifestChecksum: string;
  readonly revision: number;
  readonly throughSequence: number;
  readonly trigger: "manual" | "automatic" | "recovery";
  readonly strategy: "deterministic" | "model_assisted";
  readonly protectedFactIds: readonly string[];
  readonly evictedSourceIds: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usageRecordId: string | null;
  readonly precision: AgentContextPrecision;
  readonly summaryChecksum: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly createdAt: string;
}

export interface BuildCompactionInputManifestInput {
  readonly compactionId: string;
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly throughSequence: number;
  readonly protectedFacts: readonly ProtectedContextFact[];
  readonly evictableSources: readonly EvictableContextSource[];
  readonly createdAt: string;
}

// The eviction priority: exact duplicates first, then raw tool output whose summary is retained,
// then re-readable file bodies, and finally superseded transient material.
const EVICTION_ORDER: Record<EvictableContextSource["evictionReason"], number> = {
  duplicate: 0,
  raw_result: 1,
  rereadable_body: 2,
  superseded_transient: 3
};

const CHECKSUM = /^[0-9a-f]{64}$/;

export function createPlanExecutionProtectedFact(
  record: PlanExecutionRecord
): PlanExecutionProtectedFact {
  const planExecution: PlanExecutionProtectedValue = {
    planExecutionId: record.planExecutionId,
    revision: record.revision,
    steps: record.steps.map((step) => ({
      stepId: step.stepId,
      status: step.status,
      verification: [...step.verification],
      checkpointId: step.checkpointId,
      eventSequence: step.eventSequence
    }))
  };
  return deepFreeze({
    kind: "plan_execution",
    factId: `plan_execution:${record.planExecutionId}`,
    sourceId: record.planExecutionId,
    sourceRevision: record.revision,
    checksum: checksumText(stableSerialize(planExecution)),
    planExecution
  });
}

/**
 * Build the compaction input manifest from canonical stores before any deterministic pass or provider
 * call. Every protected fact must carry exactly one provenance (source revision xor event sequence)
 * and a well-formed checksum; every evictable source must have a valid token count and a pointer no
 * larger than the body it replaces. The manifest checksum makes the exact input auditable and lets a
 * replayed commit prove it compacted the same material.
 */
export function buildCompactionInputManifest(
  input: BuildCompactionInputManifestInput
): Result<CompactionInputManifest, UnifiedError> {
  if (!Number.isSafeInteger(input.throughSequence) || input.throughSequence < 0) {
    return err(manifestInvalid("throughSequence"));
  }
  for (const fact of input.protectedFacts) {
    const hasRevision = fact.sourceRevision !== undefined;
    const hasSequence = fact.eventSequence !== undefined;
    if (hasRevision === hasSequence) {
      return err(manifestInvalid(`protectedFact:${fact.factId}:provenance`));
    }
    if (
      hasRevision &&
      (!Number.isSafeInteger(fact.sourceRevision) || (fact.sourceRevision ?? -1) < 0)
    ) {
      return err(manifestInvalid(`protectedFact:${fact.factId}:sourceRevision`));
    }
    if (
      hasSequence &&
      (!Number.isSafeInteger(fact.eventSequence) || (fact.eventSequence ?? -1) < 0)
    ) {
      return err(manifestInvalid(`protectedFact:${fact.factId}:eventSequence`));
    }
    if (typeof fact.checksum !== "string" || !CHECKSUM.test(fact.checksum)) {
      return err(manifestInvalid(`protectedFact:${fact.factId}:checksum`));
    }
    if (fact.kind === "plan_execution") {
      if (!isPlanExecutionProtectedFact(fact)) {
        return err(manifestInvalid(`protectedFact:${fact.factId}:planExecution`));
      }
    } else if (fact.planExecution !== undefined) {
      return err(manifestInvalid(`protectedFact:${fact.factId}:planExecutionKind`));
    }
  }
  for (const source of input.evictableSources) {
    if (!Number.isSafeInteger(source.tokenCount) || source.tokenCount < 0) {
      return err(manifestInvalid(`evictable:${source.sourceId}:tokenCount`));
    }
    if (
      !Number.isSafeInteger(source.pointerTokenCount) ||
      source.pointerTokenCount < 0 ||
      source.pointerTokenCount > source.tokenCount
    ) {
      return err(manifestInvalid(`evictable:${source.sourceId}:pointerTokenCount`));
    }
    if (typeof source.checksum !== "string" || !CHECKSUM.test(source.checksum)) {
      return err(manifestInvalid(`evictable:${source.sourceId}:checksum`));
    }
  }
  const checksum = checksumText(
    stableSerialize({
      compactionId: input.compactionId,
      runId: input.runId,
      sourceSnapshotId: input.sourceSnapshotId,
      throughSequence: input.throughSequence,
      protectedFacts: input.protectedFacts,
      evictableSources: input.evictableSources
    })
  );
  return ok({
    schemaVersion: "1.0",
    compactionId: input.compactionId,
    runId: input.runId,
    sourceSnapshotId: input.sourceSnapshotId,
    throughSequence: input.throughSequence,
    protectedFacts: input.protectedFacts,
    evictableSources: input.evictableSources,
    checksum,
    createdAt: input.createdAt
  });
}

/** Order evictable sources by the documented eviction priority, stable within a reason. */
export function orderEvictableSources(
  sources: readonly EvictableContextSource[]
): EvictableContextSource[] {
  return sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) => {
      const byReason =
        EVICTION_ORDER[left.source.evictionReason] - EVICTION_ORDER[right.source.evictionReason];
      return byReason !== 0 ? byReason : left.index - right.index;
    })
    .map((entry) => entry.source);
}

export interface DeterministicEvictionInput {
  readonly evictableSources: readonly EvictableContextSource[];
  readonly currentTokens: number;
  readonly targetTokens: number;
}

export interface DeterministicEvictionPlan {
  readonly evictedSourceIds: readonly string[];
  readonly projectedTokens: number;
  readonly reachedTarget: boolean;
}

/**
 * Plan a deterministic eviction: walk evictable sources in the documented order, evicting each (which
 * frees `tokenCount - pointerTokenCount`) until the projected token count reaches the target or the
 * evictable set is exhausted. `reachedTarget` tells the caller whether a model-assisted pass is still
 * needed on whatever remains.
 */
export function planDeterministicEviction(
  input: DeterministicEvictionInput
): DeterministicEvictionPlan {
  let projected = input.currentTokens;
  const evicted: string[] = [];
  if (projected <= input.targetTokens) {
    return { evictedSourceIds: [], projectedTokens: projected, reachedTarget: true };
  }
  for (const source of orderEvictableSources(input.evictableSources)) {
    evicted.push(source.sourceId);
    projected -= source.tokenCount - source.pointerTokenCount;
    if (projected <= input.targetTokens) break;
  }
  return {
    evictedSourceIds: evicted,
    projectedTokens: projected,
    reachedTarget: projected <= input.targetTokens
  };
}

export interface CompactionResultProgressInput {
  readonly candidateThroughSequence: number;
  readonly candidateProtectedFacts: readonly ProtectedContextFact[];
  readonly prior?: {
    readonly throughSequence: number;
    readonly protectedFacts: readonly ProtectedContextFact[];
  };
}

/**
 * Guard a compaction result against regression: `throughSequence` may only advance, and every
 * protected fact from the prior compaction must still be present with an identical checksum (facts are
 * immutable by id — a missing or altered fact means the summary dropped something it must keep).
 * With no prior compaction any candidate is accepted.
 */
export function validateCompactionResultProgress(
  input: CompactionResultProgressInput
): Result<CompactionResultProgressInput, UnifiedError> {
  if (input.prior === undefined) return ok(input);
  if (input.candidateThroughSequence < input.prior.throughSequence) {
    return err(regressed("throughSequence"));
  }
  const candidateById = new Map(input.candidateProtectedFacts.map((fact) => [fact.factId, fact]));
  for (const fact of input.prior.protectedFacts) {
    if (fact.kind === "plan_execution") {
      const candidate = input.candidateProtectedFacts.find(
        (entry) => entry.kind === "plan_execution" && entry.sourceId === fact.sourceId
      );
      const regression = validatePlanExecutionProgress(fact, candidate);
      if (regression !== undefined) return err(regressed(regression));
      continue;
    }
    const candidate = candidateById.get(fact.factId);
    if (candidate === undefined || candidate.checksum !== fact.checksum) {
      return err(regressed(`protectedFact:${fact.factId}`));
    }
  }
  return ok(input);
}

export interface CreateContextCompactionRevisionInput {
  readonly manifest: CompactionInputManifest;
  readonly revision: number;
  readonly trigger: "manual" | "automatic" | "recovery";
  readonly strategy: "deterministic" | "model_assisted";
  readonly resultSnapshotId: string | null;
  readonly budgetSnapshotId: string | null;
  readonly evictedSourceIds: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usageRecordId: string | null;
  readonly precision: AgentContextPrecision;
  readonly summaryChecksum: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly createdAt: string;
}

/** Assemble an immutable compaction revision bound to the manifest that produced it. */
export function createContextCompactionRevision(
  input: CreateContextCompactionRevisionInput
): ContextCompactionRevision {
  return {
    schemaVersion: "1.0",
    compactionId: input.manifest.compactionId,
    runId: input.manifest.runId,
    sourceSnapshotId: input.manifest.sourceSnapshotId,
    resultSnapshotId: input.resultSnapshotId,
    budgetSnapshotId: input.budgetSnapshotId,
    inputManifestId: input.manifest.compactionId,
    inputManifestChecksum: input.manifest.checksum,
    revision: input.revision,
    throughSequence: input.manifest.throughSequence,
    trigger: input.trigger,
    strategy: input.strategy,
    protectedFactIds: input.manifest.protectedFacts.map((fact) => fact.factId),
    evictedSourceIds: [...input.evictedSourceIds],
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    usageRecordId: input.usageRecordId,
    precision: input.precision,
    summaryChecksum: input.summaryChecksum,
    status: input.status,
    createdAt: input.createdAt
  };
}

function manifestInvalid(field: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_COMPACTION_MANIFEST_INVALID",
    category: "ValidationError",
    message: "The context compaction manifest could not be built from the canonical stores.",
    recoverability: "user-action",
    suggestedAction:
      "Rebuild the compaction manifest from valid protected facts and evictable sources.",
    traceId: "context-compaction",
    redactedDetail: { field }
  });
}

function regressed(field: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_COMPACTION_REGRESSED",
    category: "AgentError",
    message: "The compaction result regressed protected context and was rejected.",
    recoverability: "retryable",
    suggestedAction: "Discard the compaction result and keep the last committed context.",
    traceId: "context-compaction",
    redactedDetail: { field }
  });
}

function validatePlanExecutionProgress(
  prior: ProtectedContextFact,
  candidate: ProtectedContextFact | undefined
): string | undefined {
  if (!isPlanExecutionProtectedFact(prior) || !isPlanExecutionProtectedFact(candidate)) {
    return `planExecution:${prior.sourceId}:missing`;
  }
  if (
    candidate.planExecution.planExecutionId !== prior.planExecution.planExecutionId ||
    candidate.planExecution.revision < prior.planExecution.revision ||
    candidate.sourceRevision < prior.sourceRevision
  ) {
    return `planExecution:${prior.sourceId}:revision`;
  }
  const candidateSteps = new Map(candidate.planExecution.steps.map((step) => [step.stepId, step]));
  for (const priorStep of prior.planExecution.steps) {
    const candidateStep = candidateSteps.get(priorStep.stepId);
    if (
      candidateStep === undefined ||
      stepProgress(candidateStep.status) < stepProgress(priorStep.status)
    ) {
      return `planExecution:${prior.sourceId}:step:${priorStep.stepId}:status`;
    }
    if (priorStep.verification.some((evidence) => !candidateStep.verification.includes(evidence))) {
      return `planExecution:${prior.sourceId}:step:${priorStep.stepId}:verification`;
    }
    if (
      priorStep.eventSequence !== null &&
      (candidateStep.eventSequence === null ||
        candidateStep.eventSequence < priorStep.eventSequence)
    ) {
      return `planExecution:${prior.sourceId}:step:${priorStep.stepId}:eventSequence`;
    }
    if (priorStep.checkpointId !== null && candidateStep.checkpointId === null) {
      return `planExecution:${prior.sourceId}:step:${priorStep.stepId}:checkpointId`;
    }
  }
  return undefined;
}

function isPlanExecutionProtectedFact(
  fact: ProtectedContextFact | undefined
): fact is PlanExecutionProtectedFact {
  if (
    fact === undefined ||
    fact.kind !== "plan_execution" ||
    fact.sourceRevision === undefined ||
    fact.planExecution === undefined ||
    fact.planExecution.planExecutionId !== fact.sourceId ||
    fact.planExecution.revision !== fact.sourceRevision ||
    !Number.isSafeInteger(fact.planExecution.revision) ||
    fact.planExecution.revision < 1 ||
    !Array.isArray(fact.planExecution.steps)
  ) {
    return false;
  }
  const stepIds = new Set<string>();
  return fact.planExecution.steps.every((step) => {
    if (
      typeof step.stepId !== "string" ||
      step.stepId.length === 0 ||
      stepIds.has(step.stepId) ||
      !isPlanExecutionStepStatus(step.status) ||
      !Array.isArray(step.verification) ||
      !step.verification.every((value: unknown) => typeof value === "string") ||
      (step.checkpointId !== null && typeof step.checkpointId !== "string") ||
      (step.eventSequence !== null &&
        (!Number.isSafeInteger(step.eventSequence) || step.eventSequence < 0))
    ) {
      return false;
    }
    stepIds.add(step.stepId);
    return true;
  });
}

function isPlanExecutionStepStatus(value: string): value is PlanExecutionStepStatus {
  return ["pending", "running", "completed", "blocked", "skipped"].includes(value);
}

function stepProgress(status: PlanExecutionStepStatus): number {
  return status === "pending" ? 0 : status === "running" ? 1 : 2;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
