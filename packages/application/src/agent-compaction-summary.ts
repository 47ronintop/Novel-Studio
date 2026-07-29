import { createHash } from "node:crypto";

import {
  createDeterministicTokenEstimator,
  type AgentContextPrecision,
  type AgentContextProfileId,
  type AgentTokenEstimator
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export const AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION = "1.0" as const;

const PROFILE_FIELDS = Object.freeze({
  standalone: ["userGoal", "decisions", "constraints", "openQuestions", "nextSteps"],
  writing: ["plotFacts", "characterStates", "foreshadowing", "userDecisions"],
  creative_general: ["currentFiles", "userDecisions", "unfinishedItems", "nextSteps"],
  engineering: ["modifiedFiles", "changeIntent", "todos", "errorHighlights", "nextSteps"]
} satisfies Record<AgentContextProfileId, readonly string[]>);

export interface CompactionSummaryPrompt {
  readonly templateVersion: typeof AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION;
  readonly profileId: AgentContextProfileId;
  readonly systemPrompt: string;
}

export interface CompactionSummaryProvenance {
  readonly kind: "model_assisted";
  readonly provider: string;
  readonly model: string;
  readonly modelProfileId: string;
  readonly templateVersion: typeof AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION;
  readonly inputChecksum: string;
}

export interface CompactionSummaryResult {
  readonly body: string;
  readonly provenance: CompactionSummaryProvenance;
  readonly tokenCount: number;
  readonly checksum: string;
  readonly precision: AgentContextPrecision;
}

export interface AgentCompactionSummaryArtifact extends CompactionSummaryResult {
  readonly schemaVersion: "1.0";
  readonly artifactId: string;
  readonly runId: string;
  readonly compactionId: string;
  readonly contextProfileId: AgentContextProfileId;
  readonly sourceSnapshotId: string;
  readonly throughSequence: number;
  readonly inputManifestChecksum: string;
  readonly createdAt: string;
  readonly artifactChecksum: string;
}

export function buildCompactionSummaryPrompt(
  profileId: AgentContextProfileId
): CompactionSummaryPrompt {
  const fields = PROFILE_FIELDS[profileId];
  const standaloneConstraint =
    profileId === "standalone"
      ? " Do not infer or invent file, project, workspace, tool, or repository facts."
      : "";
  return Object.freeze({
    templateVersion: AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION,
    profileId,
    systemPrompt:
      `Summarize only the supplied conversation evidence. Return one canonical JSON object with exactly these keys: ${fields.join(", ")}. ` +
      `Every value must be an array of concise strings, except userGoal which is one string.${standaloneConstraint} ` +
      "Do not add prose, markdown, code fences, or keys. Preserve user decisions and unresolved work; omit unsupported claims."
  });
}

export function validateCompactionSummaryResult(input: {
  readonly profileId: AgentContextProfileId;
  readonly result: CompactionSummaryResult;
  readonly maxSummaryTokens: number;
  readonly expectedInputChecksum?: string;
  readonly expectedProvider?: string;
  readonly expectedModel?: string;
  readonly expectedModelProfileId?: string;
  readonly estimator?: AgentTokenEstimator;
}): Result<CompactionSummaryResult, UnifiedError> {
  const result = input.result;
  const estimator = input.estimator ?? createDeterministicTokenEstimator();
  if (
    !Number.isSafeInteger(input.maxSummaryTokens) ||
    input.maxSummaryTokens < 0 ||
    typeof result.body !== "string" ||
    result.body.length === 0 ||
    (result.precision !== "reported" && result.precision !== "estimated") ||
    !isProvenance(result.provenance) ||
    (input.expectedInputChecksum !== undefined &&
      result.provenance.inputChecksum !== input.expectedInputChecksum) ||
    (input.expectedProvider !== undefined &&
      result.provenance.provider !== input.expectedProvider) ||
    (input.expectedModel !== undefined && result.provenance.model !== input.expectedModel) ||
    (input.expectedModelProfileId !== undefined &&
      result.provenance.modelProfileId !== input.expectedModelProfileId)
  ) {
    return err(summaryError("AGENT_COMPACTION_SUMMARY_INVALID"));
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(result.body) as unknown;
    if (!isRecord(value)) return err(summaryError("AGENT_COMPACTION_SUMMARY_INVALID"));
    parsed = value;
  } catch {
    return err(summaryError("AGENT_COMPACTION_SUMMARY_INVALID"));
  }
  const fields = PROFILE_FIELDS[input.profileId];
  if (
    Object.keys(parsed).length !== fields.length ||
    !fields.every((field) => Object.prototype.hasOwnProperty.call(parsed, field)) ||
    !Object.entries(parsed).every(([field, value]) =>
      input.profileId === "standalone" && field === "userGoal"
        ? typeof value === "string"
        : Array.isArray(value) && value.every((item) => typeof item === "string")
    )
  ) {
    return err(summaryError("AGENT_COMPACTION_SUMMARY_INVALID"));
  }
  const canonicalBody = JSON.stringify(
    Object.fromEntries(fields.map((field) => [field, parsed[field]]))
  );
  if (canonicalBody !== result.body) {
    return err(summaryError("AGENT_COMPACTION_SUMMARY_INVALID"));
  }
  const count = estimator.count(result.body, result.provenance.modelProfileId);
  const expectedChecksum = checksum(result.body);
  if (
    !Number.isSafeInteger(result.tokenCount) ||
    result.tokenCount < 0 ||
    result.tokenCount !== count.tokens ||
    result.checksum !== expectedChecksum ||
    result.precision !== count.precision
  ) {
    return err(summaryError("AGENT_COMPACTION_SUMMARY_INVALID"));
  }
  if (result.tokenCount > input.maxSummaryTokens) {
    return err(summaryError("AGENT_COMPACTION_SUMMARY_TARGET_MISSED"));
  }
  return ok(deepFreeze({ ...result }));
}

export function createCompactionSummaryArtifact(input: {
  readonly artifactId: string;
  readonly runId: string;
  readonly compactionId: string;
  readonly contextProfileId: AgentContextProfileId;
  readonly sourceSnapshotId: string;
  readonly throughSequence: number;
  readonly inputManifestChecksum: string;
  readonly result: CompactionSummaryResult;
  readonly createdAt: string;
}): AgentCompactionSummaryArtifact {
  const unsigned = {
    schemaVersion: "1.0" as const,
    artifactId: input.artifactId,
    runId: input.runId,
    compactionId: input.compactionId,
    contextProfileId: input.contextProfileId,
    sourceSnapshotId: input.sourceSnapshotId,
    throughSequence: input.throughSequence,
    inputManifestChecksum: input.inputManifestChecksum,
    body: input.result.body,
    provenance: input.result.provenance,
    tokenCount: input.result.tokenCount,
    checksum: input.result.checksum,
    precision: input.result.precision,
    createdAt: input.createdAt
  };
  return deepFreeze({
    ...unsigned,
    artifactChecksum: checksum(stableSerialize(unsigned))
  });
}

export function parseCompactionSummaryArtifact(value: JsonObject): AgentCompactionSummaryArtifact {
  const provenance = value["provenance"];
  const result: CompactionSummaryResult = {
    body: typeof value["body"] === "string" ? value["body"] : "",
    provenance: provenance as unknown as CompactionSummaryProvenance,
    tokenCount: typeof value["tokenCount"] === "number" ? value["tokenCount"] : -1,
    checksum: typeof value["checksum"] === "string" ? value["checksum"] : "",
    precision: value["precision"] as AgentContextPrecision
  };
  const profileId = value["contextProfileId"];
  if (
    value["schemaVersion"] !== "1.0" ||
    !isNonEmptyString(value["artifactId"]) ||
    !isNonEmptyString(value["runId"]) ||
    !isNonEmptyString(value["compactionId"]) ||
    !isProfileId(profileId) ||
    !isNonEmptyString(value["sourceSnapshotId"]) ||
    !Number.isSafeInteger(value["throughSequence"]) ||
    Number(value["throughSequence"]) < 0 ||
    !isChecksum(value["inputManifestChecksum"]) ||
    !isNonEmptyString(value["createdAt"]) ||
    !isChecksum(value["artifactChecksum"])
  ) {
    throw new Error("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID");
  }
  const validated = validateCompactionSummaryResult({
    profileId,
    result,
    maxSummaryTokens: result.tokenCount
  });
  if (!validated.ok) throw new Error("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID");
  const artifact = createCompactionSummaryArtifact({
    artifactId: value["artifactId"],
    runId: value["runId"],
    compactionId: value["compactionId"],
    contextProfileId: profileId,
    sourceSnapshotId: value["sourceSnapshotId"],
    throughSequence: Number(value["throughSequence"]),
    inputManifestChecksum: value["inputManifestChecksum"],
    result: validated.value,
    createdAt: value["createdAt"]
  });
  if (artifact.artifactChecksum !== value["artifactChecksum"]) {
    throw new Error("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID");
  }
  return artifact;
}

function isProvenance(value: unknown): value is CompactionSummaryProvenance {
  return (
    isRecord(value) &&
    value["kind"] === "model_assisted" &&
    isNonEmptyString(value["provider"]) &&
    isNonEmptyString(value["model"]) &&
    isNonEmptyString(value["modelProfileId"]) &&
    value["templateVersion"] === AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION &&
    isChecksum(value["inputChecksum"])
  );
}

function isProfileId(value: unknown): value is AgentContextProfileId {
  return (
    value === "standalone" ||
    value === "writing" ||
    value === "creative_general" ||
    value === "engineering"
  );
}

function summaryError(
  code: "AGENT_COMPACTION_SUMMARY_INVALID" | "AGENT_COMPACTION_SUMMARY_TARGET_MISSED"
): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "The model-assisted context summary could not be verified.",
    recoverability: "retryable",
    suggestedAction: "Keep the previous context revision and retry compaction.",
    traceId: "agent-compaction-summary"
  });
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
