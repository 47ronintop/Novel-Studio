import { createHash } from "node:crypto";

import {
  createApprovalRuleSetProjection,
  createProviderSemanticVersionSetV1,
  providerSemanticVersionSetChecksum,
  type AgentContextPrecision,
  type AgentTokenEstimator,
  type ProviderSemanticVersionSetV1
} from "@novel-studio/agent-engine";

import {
  resolveAgentContextProfile,
  type AgentContextProfile,
  type AgentContextProfileId
} from "./agent-context-profile.js";
import {
  parseProviderVisibleAgentRuntimeFacts,
  type ProviderVisibleAgentRuntimeFacts,
  type ProviderVisibleWorkspaceFileOperation,
  type ProviderVisibleWritingOperation
} from "./agent-runtime-facts.js";
import {
  materializeCurrentAgentGuidance,
  verifyCurrentAgentGuidance,
  type MaterializedAgentGuidanceV3,
  type NormalizedRegisteredGuidanceBuildInputV3,
  type RegisteredGuidanceBuildInputV3
} from "./agent-guidance-registry.js";
import {
  parseWritingTaskIntent,
  type WritingTaskIntent,
  type WritingTaskIntentKind
} from "./writing-task-intent.js";

export const AGENT_GUIDANCE_BUDGET_SCHEMA_VERSION = "1.0" as const;
export const AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID = "agent-token-estimator" as const;
export const AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION = "guidance-budget-v1" as const;
export const AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID = "guidance-budget-v1" as const;
export const AGENT_GUIDANCE_BUDGET_WRITING_TOKEN_LIMIT = 1_200;
export const AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT = 900;

const GUIDANCE_BUDGET_BYTES_PER_TOKEN = 4;

export interface GuidanceBudgetTokenEstimator extends AgentTokenEstimator {
  readonly estimatorId: typeof AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID;
  readonly estimatorVersion: typeof AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION;
  readonly profileId: typeof AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID;
}

/**
 * This estimator is deliberately independent from provider/model runtime estimates. It rounds each
 * four UTF-8 bytes up to one estimated token. Guidance is a release-gated bundled template, so the
 * profile identity and byte-to-token rule stay fixed with the proof.
 */
export const AGENT_GUIDANCE_BUDGET_TOKEN_ESTIMATOR: GuidanceBudgetTokenEstimator = Object.freeze({
  estimatorId: AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID,
  estimatorVersion: AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION,
  profileId: AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID,
  count(
    text: string,
    modelProfileId: string
  ): {
    readonly tokens: number;
    readonly precision: AgentContextPrecision;
  } {
    if (modelProfileId !== AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID) {
      throw new Error("AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_INVALID");
    }
    return Object.freeze({
      tokens: Math.ceil(Buffer.byteLength(text, "utf8") / GUIDANCE_BUDGET_BYTES_PER_TOKEN),
      precision: "estimated" as const
    });
  }
});

export interface AgentGuidanceBudgetProofV1 {
  readonly schemaVersion: typeof AGENT_GUIDANCE_BUDGET_SCHEMA_VERSION;
  readonly estimatorId: typeof AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID;
  readonly estimatorVersion: typeof AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION;
  readonly estimatorProfileId: typeof AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID;
  readonly providerSemanticVersionSetChecksum: string;
  readonly normalizedInputChecksum: string;
  readonly materializedGuidanceChecksum: string;
  readonly tokenCount: number;
  readonly tokenPrecision: AgentContextPrecision;
}

/**
 * A release-evidence snapshot. It deliberately retains the normalized app-owned input and exact
 * body so a current registry can re-materialize and reject any stale or forged proof.
 */
export interface AgentGuidanceBudgetSnapshotV1 extends AgentGuidanceBudgetProofV1 {
  readonly caseId: string;
  readonly profileId: AgentContextProfileId;
  readonly operationMode: AgentContextProfile["operationMode"];
  readonly tokenLimit: number;
  readonly normalizedInput: NormalizedRegisteredGuidanceBuildInputV3;
  readonly materializedGuidance: string;
}

export interface CreateAgentGuidanceBudgetSnapshotInput {
  readonly caseId: string;
  readonly materialization: MaterializedAgentGuidanceV3;
}

interface MaximalGuidanceBudgetCase {
  readonly caseId: string;
  readonly profile: AgentContextProfile;
  readonly runtimeFacts: ProviderVisibleAgentRuntimeFacts;
  readonly writingTaskIntents: readonly (WritingTaskIntent | null)[];
}

const MAXIMAL_WRITING_OPERATIONS: readonly ProviderVisibleWritingOperation[] = Object.freeze([
  "chapter_replace",
  "chapter_create",
  "chapter_rename",
  "chapter_reorder",
  "chapter_status",
  "chapter_restore",
  "story_bible_create",
  "story_bible_patch",
  "story_bible_status",
  "story_bible_restore"
]);

const MAXIMAL_WORKSPACE_FILE_OPERATIONS: readonly ProviderVisibleWorkspaceFileOperation[] =
  Object.freeze(["replace_file", "create_file", "move_file", "delete_file", "create_directory"]);

const MAXIMAL_WRITING_TASK_INTENTS: readonly WritingTaskIntent[] = Object.freeze(
  (
    [
      "analysis",
      "brainstorm",
      "continue",
      "rewrite",
      "story_bible",
      "mixed",
      "unknown"
    ] as const satisfies readonly WritingTaskIntentKind[]
  ).map((kind) =>
    parseWritingTaskIntent({
      schemaVersion: "1.0",
      kind,
      bodyGeneration: kind === "continue" || kind === "rewrite" || kind === "mixed",
      source: "bounded_request_classifier"
    })
  )
);

const MAXIMAL_GUIDANCE_BUDGET_CASES: readonly MaximalGuidanceBudgetCase[] = Object.freeze([
  maximalCase(
    "standalone-conversation-max",
    resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    )
  ),
  maximalCase(
    "writing-planning-max",
    resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "guidance-budget-writing"
      },
      "planning",
      "writing"
    )
  ),
  maximalCase(
    "writing-execution-max",
    resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "guidance-budget-writing"
      },
      "execution",
      "writing"
    )
  ),
  maximalCase(
    "creative-general-planning-max",
    resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "guidance-budget-creative"
      },
      "planning",
      "general_file"
    )
  ),
  maximalCase(
    "creative-general-execution-max",
    resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "guidance-budget-creative"
      },
      "execution",
      "general_file"
    )
  ),
  maximalCase(
    "engineering-planning-max",
    resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "engineeringWorkspace",
        workspaceId: "guidance-budget-engineering"
      },
      "planning",
      "general_file"
    )
  ),
  maximalCase(
    "engineering-execution-max",
    resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "engineeringWorkspace",
        workspaceId: "guidance-budget-engineering"
      },
      "execution",
      "general_file"
    )
  )
]);

/**
 * Every legal profile/mode is represented. Execution uses every currently declared domain
 * operation and the only registered immutable approval rule-set; planning intentionally has none.
 */
export const AGENT_GUIDANCE_BUDGET_SNAPSHOTS: readonly AgentGuidanceBudgetSnapshotV1[] =
  Object.freeze(
    MAXIMAL_GUIDANCE_BUDGET_CASES.map((budgetCase) =>
      createAgentGuidanceBudgetSnapshot({
        caseId: budgetCase.caseId,
        materialization: maximalMaterialization(budgetCase)
      })
    )
  );

export function listAgentGuidanceBudgetSnapshots(): readonly AgentGuidanceBudgetSnapshotV1[] {
  return AGENT_GUIDANCE_BUDGET_SNAPSHOTS;
}

export function agentGuidanceBudgetTokenLimit(profileId: AgentContextProfileId): number {
  if (!isProfileId(profileId)) throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  return profileId === "writing"
    ? AGENT_GUIDANCE_BUDGET_WRITING_TOKEN_LIMIT
    : AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT;
}

export function assertAgentGuidanceBudgetWithinLimit(
  profileId: AgentContextProfileId,
  tokenCount: number
): void {
  if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  if (tokenCount > agentGuidanceBudgetTokenLimit(profileId)) {
    throw new Error("AGENT_GUIDANCE_BUDGET_EXCEEDED");
  }
}

export function createAgentGuidanceBudgetProof(
  materialization: MaterializedAgentGuidanceV3
): AgentGuidanceBudgetProofV1 {
  const verified = verifiedMaterialization(materialization);
  const providerChecksum = providerSemanticVersionSetChecksum(
    verified.normalizedInput.providerSemanticVersionSet
  );
  const normalizedChecksum = checksum(stableSerialize(verified.normalizedInput));
  const bodyChecksum = checksum(verified.materializedGuidance);
  if (
    verified.proof.providerSemanticVersionSetChecksum !== providerChecksum ||
    verified.proof.normalizedInputChecksum !== normalizedChecksum ||
    verified.proof.materializedGuidanceChecksum !== bodyChecksum
  ) {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  const count = AGENT_GUIDANCE_BUDGET_TOKEN_ESTIMATOR.count(
    verified.materializedGuidance,
    AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID
  );
  if (!Number.isSafeInteger(count.tokens) || count.tokens < 0 || count.precision !== "estimated") {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  assertAgentGuidanceBudgetWithinLimit(verified.normalizedInput.profile.profileId, count.tokens);
  return deepFreeze({
    schemaVersion: AGENT_GUIDANCE_BUDGET_SCHEMA_VERSION,
    estimatorId: AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID,
    estimatorVersion: AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION,
    estimatorProfileId: AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID,
    providerSemanticVersionSetChecksum: providerChecksum,
    normalizedInputChecksum: normalizedChecksum,
    materializedGuidanceChecksum: bodyChecksum,
    tokenCount: count.tokens,
    tokenPrecision: count.precision
  });
}

export function createAgentGuidanceBudgetSnapshot(
  input: CreateAgentGuidanceBudgetSnapshotInput
): AgentGuidanceBudgetSnapshotV1 {
  if (!isCaseId(input.caseId)) throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  const verified = verifiedMaterialization(input.materialization);
  const proof = createAgentGuidanceBudgetProof(verified);
  return deepFreeze({
    ...proof,
    caseId: input.caseId,
    profileId: verified.normalizedInput.profile.profileId,
    operationMode: verified.normalizedInput.profile.operationMode,
    tokenLimit: agentGuidanceBudgetTokenLimit(verified.normalizedInput.profile.profileId),
    normalizedInput: structuredClone(verified.normalizedInput),
    materializedGuidance: verified.materializedGuidance
  });
}

export function parseAgentGuidanceBudgetSnapshot(value: unknown): AgentGuidanceBudgetSnapshotV1 {
  if (!isRecord(value) || !hasExactlyFields(value, SNAPSHOT_FIELDS)) {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  const caseId = value["caseId"];
  const profileId = value["profileId"];
  const operationMode = value["operationMode"];
  const tokenLimit = value["tokenLimit"];
  const materializedGuidance = value["materializedGuidance"];
  if (
    !isCaseId(caseId) ||
    !isProfileId(profileId) ||
    !isOperationMode(operationMode) ||
    typeof tokenLimit !== "number" ||
    !Number.isSafeInteger(tokenLimit) ||
    tokenLimit < 0 ||
    typeof materializedGuidance !== "string" ||
    value["schemaVersion"] !== AGENT_GUIDANCE_BUDGET_SCHEMA_VERSION ||
    value["estimatorId"] !== AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID ||
    value["estimatorVersion"] !== AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION ||
    value["estimatorProfileId"] !== AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID ||
    !isChecksum(value["providerSemanticVersionSetChecksum"]) ||
    !isChecksum(value["normalizedInputChecksum"]) ||
    !isChecksum(value["materializedGuidanceChecksum"]) ||
    !Number.isSafeInteger(value["tokenCount"]) ||
    (value["tokenPrecision"] !== "estimated" && value["tokenPrecision"] !== "reported")
  ) {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  const normalizedInput = parseNormalizedInput(value["normalizedInput"]);
  const rematerialized = materializeForBudget(normalizedInput);
  const expectedProof = createAgentGuidanceBudgetProof(rematerialized);
  if (
    stableSerialize(value["normalizedInput"]) !== stableSerialize(rematerialized.normalizedInput) ||
    profileId !== rematerialized.normalizedInput.profile.profileId ||
    operationMode !== rematerialized.normalizedInput.profile.operationMode ||
    tokenLimit !== agentGuidanceBudgetTokenLimit(profileId) ||
    materializedGuidance !== rematerialized.materializedGuidance ||
    value["providerSemanticVersionSetChecksum"] !==
      expectedProof.providerSemanticVersionSetChecksum ||
    value["normalizedInputChecksum"] !== expectedProof.normalizedInputChecksum ||
    value["materializedGuidanceChecksum"] !== expectedProof.materializedGuidanceChecksum ||
    value["tokenCount"] !== expectedProof.tokenCount ||
    value["tokenPrecision"] !== expectedProof.tokenPrecision
  ) {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  return deepFreeze({
    ...expectedProof,
    caseId,
    profileId,
    operationMode,
    tokenLimit,
    normalizedInput: structuredClone(rematerialized.normalizedInput),
    materializedGuidance
  });
}

export function verifyAgentGuidanceBudgetSnapshot(
  snapshot: AgentGuidanceBudgetSnapshotV1
): AgentGuidanceBudgetSnapshotV1 {
  return parseAgentGuidanceBudgetSnapshot(snapshot);
}

function maximalCase(caseId: string, profile: AgentContextProfile): MaximalGuidanceBudgetCase {
  return deepFreeze({
    caseId,
    profile,
    runtimeFacts: maximalRuntimeFacts(profile),
    writingTaskIntents:
      profile.profileId === "writing" ? MAXIMAL_WRITING_TASK_INTENTS : Object.freeze([null])
  });
}

function maximalRuntimeFacts(profile: AgentContextProfile): ProviderVisibleAgentRuntimeFacts {
  const execution = profile.operationMode === "execution";
  const writingOperations =
    execution && profile.profileId === "writing" ? MAXIMAL_WRITING_OPERATIONS : [];
  const workspaceFileOperations =
    execution && profile.profileId !== "writing" && profile.profileId !== "standalone"
      ? MAXIMAL_WORKSPACE_FILE_OPERATIONS
      : [];
  const allOperations = [...workspaceFileOperations, ...writingOperations];
  const approvalRuleSet =
    allOperations.length === 0 ? null : createApprovalRuleSetProjection(allOperations);
  return parseProviderVisibleAgentRuntimeFacts({
    schemaVersion: "1.0",
    profileId: profile.profileId,
    operationMode: profile.operationMode,
    workspaceBound: profile.workspaceBound,
    workspaceKind: profile.scope.kind === "workspace" ? profile.scope.workspaceKind : "none",
    writeCapability: allOperations.length === 0 ? "none" : "propose",
    writingOperations,
    workspaceFileOperations,
    writeApprovalPolicy: allOperations.length === 0 ? "not_applicable" : "confirm_each_change_set",
    approvalRuleSetVersion: approvalRuleSet === null ? "not_applicable" : approvalRuleSet.version,
    approvalRuleSetChecksum: approvalRuleSet === null ? "not_applicable" : approvalRuleSet.checksum,
    approvalRules: approvalRuleSet === null ? [] : approvalRuleSet.rules,
    networkRead: profile.profileId !== "standalone",
    externalTools: profile.profileId === "standalone" ? "none" : "remote_mcp",
    activeResourceKind:
      profile.profileId === "writing"
        ? "story_bible"
        : profile.profileId === "standalone"
          ? "none"
          : "project_file"
  });
}

function maximalMaterialization(
  budgetCase: MaximalGuidanceBudgetCase
): MaterializedAgentGuidanceV3 {
  let maximum: MaterializedAgentGuidanceV3 | undefined;
  let maximumTokens = -1;
  let maximumBytes = -1;
  for (const writingTaskIntent of budgetCase.writingTaskIntents) {
    const writingGenerationGuidanceVersion =
      writingTaskIntent?.bodyGeneration === true ? "2.0" : "not_applicable";
    const materialization = materializeCurrentAgentGuidance({
      profile: budgetCase.profile,
      runtimeFacts: budgetCase.runtimeFacts,
      writingTaskIntent,
      writingGenerationGuidanceVersion,
      providerSemanticVersionSet: providerVersionSet(budgetCase.runtimeFacts, writingTaskIntent)
    });
    const tokenCount = AGENT_GUIDANCE_BUDGET_TOKEN_ESTIMATOR.count(
      materialization.materializedGuidance,
      AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID
    ).tokens;
    const byteCount = Buffer.byteLength(materialization.materializedGuidance, "utf8");
    if (tokenCount > maximumTokens || (tokenCount === maximumTokens && byteCount > maximumBytes)) {
      maximum = materialization;
      maximumTokens = tokenCount;
      maximumBytes = byteCount;
    }
  }
  if (maximum === undefined) throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  return maximum;
}

function providerVersionSet(
  runtimeFacts: ProviderVisibleAgentRuntimeFacts,
  writingTaskIntent: WritingTaskIntent | null
): ProviderSemanticVersionSetV1 {
  return createProviderSemanticVersionSetV1({
    writingTaskIntentSchemaVersion: writingTaskIntent === null ? "not_applicable" : "1.0",
    writingGenerationGuidanceVersion:
      writingTaskIntent?.bodyGeneration === true ? "2.0" : "not_applicable",
    approvalRuleSetVersion: runtimeFacts.approvalRuleSetVersion,
    approvalRuleSetChecksum: runtimeFacts.approvalRuleSetChecksum
  });
}

function verifiedMaterialization(
  materialization: MaterializedAgentGuidanceV3
): MaterializedAgentGuidanceV3 {
  try {
    return verifyCurrentAgentGuidance(materialization);
  } catch {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
}

function parseNormalizedInput(value: unknown): RegisteredGuidanceBuildInputV3 {
  if (
    !isRecord(value) ||
    !hasExactlyFields(value, [
      "profile",
      "runtimeFacts",
      "writingTaskIntent",
      "writingGenerationGuidanceVersion",
      "providerSemanticVersionSet"
    ])
  ) {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
  return value as unknown as RegisteredGuidanceBuildInputV3;
}

function materializeForBudget(input: RegisteredGuidanceBuildInputV3): MaterializedAgentGuidanceV3 {
  try {
    return materializeCurrentAgentGuidance(input);
  } catch {
    throw new Error("AGENT_GUIDANCE_BUDGET_INVALID");
  }
}

const SNAPSHOT_FIELDS = Object.freeze([
  "schemaVersion",
  "estimatorId",
  "estimatorVersion",
  "estimatorProfileId",
  "providerSemanticVersionSetChecksum",
  "normalizedInputChecksum",
  "materializedGuidanceChecksum",
  "tokenCount",
  "tokenPrecision",
  "caseId",
  "profileId",
  "operationMode",
  "tokenLimit",
  "normalizedInput",
  "materializedGuidance"
]);

function isProfileId(value: unknown): value is AgentContextProfileId {
  return (
    value === "standalone" ||
    value === "writing" ||
    value === "creative_general" ||
    value === "engineering"
  );
}

function isOperationMode(value: unknown): value is AgentContextProfile["operationMode"] {
  return value === "conversation" || value === "planning" || value === "execution";
}

function isCaseId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,127}$/u.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checksum(value: string): string {
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
