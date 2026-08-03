import { createHash } from "node:crypto";

import type { AgentWritePolicy } from "./agent-run-types.js";
import type { ProviderVisibleWriteOperation } from "./agent-tool-capabilities.js";
import {
  approvalRuleForOperation,
  resolveApprovalEffectRuleDefinition,
  resolveRegisteredApprovalRuleSet,
  type ProviderVisibleConditionalApprovalRuleId,
  type ProviderVisibleApprovalRule
} from "./approval-rule-registry.js";

export const APPROVAL_DECISION_PROOF_SCHEMA_VERSION = "1.0" as const;

export type ApprovalDecision = "auto_review_eligible" | "human_confirmation" | "rejected";

export type ProviderSafeApprovalReasonCode =
  | "run_policy_requires_confirmation"
  | "operation_always_human"
  | "target_not_clean_or_stable"
  | "path_requires_confirmation"
  | "reference_impact"
  | "state_boundary"
  | "limit_exceeded"
  | "mixed_or_incomplete_evidence"
  | "operation_rejected";

export interface ApprovalDecisionProofBindingV1 {
  readonly workspaceBindingId: string;
  readonly rootBindingId?: string;
  readonly recoveryRootBindingId?: string;
  readonly recoveryGrantRevision?: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly consistencyGroupChecksum: string;
  readonly proposalPayloadChecksum: string;
  readonly baseManifestChecksum?: string;
  readonly candidateManifestChecksum?: string;
  readonly referenceImpactChecksum?: string;
  readonly recoverySideEffectChecksum?: string;
  readonly executionWritePolicy: AgentWritePolicy;
  readonly policyRevision: string;
  readonly capabilityRevision: string;
}

export interface ApprovalDecisionProofEvidenceV1 {
  readonly pathClass:
    | "not_applicable"
    | "ordinary"
    | "policy_managed"
    | "ignored_generated"
    | "hard_denied"
    | "mixed"
    | "unknown";
  readonly targetFreshness: "not_applicable" | "clean_stable" | "dirty" | "stale" | "unknown";
  readonly createOnly: "not_applicable" | "proven" | "not_proven";
  readonly referenceImpact: "not_applicable" | "none" | "present" | "unknown";
  readonly limits: "within" | "exceeded" | "unknown";
  readonly stateBoundary: "not_applicable" | "ordinary" | "archive" | "delete" | "restore";
}

/**
 * Main-owned audit record for one frozen proposal. This object is intentionally never sent to a
 * provider: only its checksum and the provider-safe summary may leave the Main process.
 */
export interface MainOnlyApprovalDecisionProofV1 {
  readonly schemaVersion: typeof APPROVAL_DECISION_PROOF_SCHEMA_VERSION;
  readonly proofId: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly operation: ProviderVisibleWriteOperation;
  readonly effectRuleId?: ProviderVisibleConditionalApprovalRuleId;
  readonly decision: ApprovalDecision;
  readonly reasonCodes: readonly ProviderSafeApprovalReasonCode[];
  readonly binding: ApprovalDecisionProofBindingV1;
  readonly evidence: ApprovalDecisionProofEvidenceV1;
}

export interface CreateMainOnlyApprovalDecisionProofV1Input {
  readonly proofId: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly operation: ProviderVisibleWriteOperation;
  readonly effectRuleId?: ProviderVisibleConditionalApprovalRuleId;
  readonly binding: ApprovalDecisionProofBindingV1;
  readonly evidence: ApprovalDecisionProofEvidenceV1;
}

export interface ApprovalDecisionProofRefV1 {
  readonly proofId: string;
  readonly proofChecksum: string;
}

export interface ProviderVisibleApprovalDecisionSummaryV1 {
  readonly schemaVersion: typeof APPROVAL_DECISION_PROOF_SCHEMA_VERSION;
  readonly operation: ProviderVisibleWriteOperation;
  readonly approvalRequirement: ApprovalDecision;
  readonly reasonCodes: readonly ProviderSafeApprovalReasonCode[];
  readonly proofChecksum: string;
}

export interface EvaluateApprovalDecisionInput {
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly operation: ProviderVisibleWriteOperation;
  readonly effectRuleId?: ProviderVisibleConditionalApprovalRuleId;
  readonly executionWritePolicy: AgentWritePolicy;
  readonly evidence: ApprovalDecisionProofEvidenceV1;
}

export interface ApprovalDecisionEvaluation {
  readonly decision: ApprovalDecision;
  readonly reasonCodes: readonly ProviderSafeApprovalReasonCode[];
}

export interface ApprovalDecisionProofBindingVerification {
  readonly isCurrent: boolean;
  readonly stale: boolean;
  readonly mismatchedFields: readonly (keyof ApprovalDecisionProofBindingV1)[];
}

export interface ResolveApprovalDecisionProofGroupInput {
  readonly proofs: readonly MainOnlyApprovalDecisionProofV1[];
  /** Expected number of proposal proofs in this consistency group, when Main has that fact. */
  readonly expectedProofCount?: number;
  /** A caller with incomplete group collection must explicitly prevent auto review. */
  readonly complete?: boolean;
  /** Main may mark a group mixed before individual proof construction has completed. */
  readonly mixed?: boolean;
}

export interface ApprovalDecisionProofGroupResolution {
  readonly decision: ApprovalDecision;
  readonly reasonCodes: readonly ProviderSafeApprovalReasonCode[];
}

const CHECKSUM = /^[a-f0-9]{64}$/u;
const MAX_STRING_LENGTH = 4096;

const TOP_LEVEL_BASE_FIELDS = Object.freeze([
  "schemaVersion",
  "proofId",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "operation",
  "decision",
  "reasonCodes",
  "binding",
  "evidence"
] as const);
const TOP_LEVEL_CONDITIONAL_FIELDS = Object.freeze([...TOP_LEVEL_BASE_FIELDS, "effectRuleId"]);
const BINDING_FIELDS = Object.freeze([
  "workspaceBindingId",
  "rootBindingId",
  "recoveryRootBindingId",
  "recoveryGrantRevision",
  "runId",
  "changeSetId",
  "changeSetRevision",
  "changeSetChecksum",
  "consistencyGroupChecksum",
  "proposalPayloadChecksum",
  "baseManifestChecksum",
  "candidateManifestChecksum",
  "referenceImpactChecksum",
  "recoverySideEffectChecksum",
  "executionWritePolicy",
  "policyRevision",
  "capabilityRevision"
] as const);
const BINDING_REQUIRED_FIELDS = Object.freeze([
  "workspaceBindingId",
  "runId",
  "changeSetId",
  "changeSetRevision",
  "changeSetChecksum",
  "consistencyGroupChecksum",
  "proposalPayloadChecksum",
  "executionWritePolicy",
  "policyRevision",
  "capabilityRevision"
] as const);
const EVIDENCE_FIELDS = Object.freeze([
  "pathClass",
  "targetFreshness",
  "createOnly",
  "referenceImpact",
  "limits",
  "stateBoundary"
] as const);
const REASON_CODE_ORDER = Object.freeze([
  "run_policy_requires_confirmation",
  "operation_always_human",
  "target_not_clean_or_stable",
  "path_requires_confirmation",
  "reference_impact",
  "state_boundary",
  "limit_exceeded",
  "mixed_or_incomplete_evidence",
  "operation_rejected"
] as const satisfies readonly ProviderSafeApprovalReasonCode[]);

const EFFECT_RULE_OPERATION: Readonly<Record<string, ProviderVisibleWriteOperation>> =
  Object.freeze({
    clean_chapter_body_v1: "chapter_replace",
    bounded_chapter_create_v1: "chapter_create",
    bounded_story_bible_create_v1: "story_bible_create",
    no_reference_impact_story_bible_patch_v1: "story_bible_patch",
    ordinary_clean_file_replace_v1: "replace_file",
    ordinary_create_only_v1: "create_file"
  });

/** Build a canonical proof and derive its decision from Main-authored facts. */
export function createMainOnlyApprovalDecisionProofV1(
  input: CreateMainOnlyApprovalDecisionProofV1Input
): MainOnlyApprovalDecisionProofV1 {
  const evaluation = evaluateApprovalDecision({
    approvalRuleSetVersion: input.approvalRuleSetVersion,
    approvalRuleSetChecksum: input.approvalRuleSetChecksum,
    operation: input.operation,
    ...(input.effectRuleId === undefined ? {} : { effectRuleId: input.effectRuleId }),
    executionWritePolicy: input.binding.executionWritePolicy,
    evidence: input.evidence
  });
  return parseMainOnlyApprovalDecisionProofV1({
    schemaVersion: APPROVAL_DECISION_PROOF_SCHEMA_VERSION,
    proofId: input.proofId,
    approvalRuleSetVersion: input.approvalRuleSetVersion,
    approvalRuleSetChecksum: input.approvalRuleSetChecksum,
    operation: input.operation,
    ...(input.effectRuleId === undefined ? {} : { effectRuleId: input.effectRuleId }),
    decision: evaluation.decision,
    reasonCodes: evaluation.reasonCodes,
    binding: input.binding,
    evidence: input.evidence
  });
}

/** Compatibility name for callers that describe construction as writing a proof. */
export const createApprovalDecisionProofV1 = createMainOnlyApprovalDecisionProofV1;

/**
 * Strictly parse a proof-shaped value. The rule set is resolved at parse time, so an unknown,
 * drifted, or operation-mismatched registry identity cannot become a persisted proof.
 */
export function parseMainOnlyApprovalDecisionProofV1(
  value: unknown
): MainOnlyApprovalDecisionProofV1 {
  if (!isRecord(value) || !hasOnlyFields(value, TOP_LEVEL_CONDITIONAL_FIELDS)) invalidProof();
  if (value["schemaVersion"] !== APPROVAL_DECISION_PROOF_SCHEMA_VERSION) invalidProof();

  const proofId = parseNonEmptyString(value["proofId"]);
  const approvalRuleSetVersion = parseNonEmptyString(value["approvalRuleSetVersion"]);
  const approvalRuleSetChecksum = parseChecksum(value["approvalRuleSetChecksum"]);
  const operation = parseOperation(value["operation"]);
  const rule = resolveRule(approvalRuleSetVersion, approvalRuleSetChecksum, operation);

  const hasEffectRuleId = Object.hasOwn(value, "effectRuleId");
  let effectRuleId: ProviderVisibleConditionalApprovalRuleId | undefined;
  if (rule.reviewMode === "always_human") {
    if (hasEffectRuleId || !hasExactlyFields(value, TOP_LEVEL_BASE_FIELDS)) invalidProof();
  } else {
    if (!hasEffectRuleId || !hasExactlyFields(value, TOP_LEVEL_CONDITIONAL_FIELDS)) invalidProof();
    effectRuleId = parseEffectRuleId(value["effectRuleId"]);
    if (effectRuleId !== rule.effectRuleId) invalidProof();
    assertDocumentedEffectRuleOperation(effectRuleId, operation);
  }

  const binding = parseBinding(value["binding"]);
  const evidence = parseEvidence(value["evidence"]);
  const decision = parseDecision(value["decision"]);
  const reasonCodes = parseReasonCodes(value["reasonCodes"]);
  const evaluation = evaluateResolvedRule(rule, binding.executionWritePolicy, evidence);
  if (decision !== evaluation.decision || !sameStringArray(reasonCodes, evaluation.reasonCodes)) {
    invalidProof();
  }

  return deepFreeze({
    schemaVersion: APPROVAL_DECISION_PROOF_SCHEMA_VERSION,
    proofId,
    approvalRuleSetVersion,
    approvalRuleSetChecksum,
    operation,
    ...(effectRuleId === undefined ? {} : { effectRuleId }),
    decision,
    reasonCodes,
    binding,
    evidence
  });
}

export const parseApprovalDecisionProofV1 = parseMainOnlyApprovalDecisionProofV1;

/** Parse canonical JSON text. Whitespace, duplicate keys, and noncanonical key ordering are rejected. */
export function parseApprovalDecisionProofV1Json(text: string): MainOnlyApprovalDecisionProofV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    invalidProof();
  }
  const proof = parseMainOnlyApprovalDecisionProofV1(raw);
  if (text !== canonicalizeProof(proof)) invalidProof();
  return proof;
}

export function serializeMainOnlyApprovalDecisionProofV1(
  value: MainOnlyApprovalDecisionProofV1
): string {
  return canonicalizeProof(parseMainOnlyApprovalDecisionProofV1(value));
}

export const serializeApprovalDecisionProofV1 = serializeMainOnlyApprovalDecisionProofV1;

export function approvalDecisionProofChecksum(value: MainOnlyApprovalDecisionProofV1): string {
  return createHash("sha256")
    .update(serializeMainOnlyApprovalDecisionProofV1(value), "utf8")
    .digest("hex");
}

export const checksumApprovalDecisionProofV1 = approvalDecisionProofChecksum;

export function buildApprovalDecisionProofRefV1(
  value: MainOnlyApprovalDecisionProofV1
): ApprovalDecisionProofRefV1 {
  const proof = parseMainOnlyApprovalDecisionProofV1(value);
  return deepFreeze({
    proofId: proof.proofId,
    proofChecksum: approvalDecisionProofChecksum(proof)
  });
}

export const createApprovalDecisionProofRefV1 = buildApprovalDecisionProofRefV1;

/** Return the only proof projection allowed to cross the provider/tool boundary. */
export function providerVisibleApprovalDecisionSummaryV1(
  value: MainOnlyApprovalDecisionProofV1
): ProviderVisibleApprovalDecisionSummaryV1 {
  const proof = parseMainOnlyApprovalDecisionProofV1(value);
  return deepFreeze({
    schemaVersion: APPROVAL_DECISION_PROOF_SCHEMA_VERSION,
    operation: proof.operation,
    approvalRequirement: proof.decision,
    reasonCodes: [...proof.reasonCodes],
    proofChecksum: approvalDecisionProofChecksum(proof)
  });
}

export const createProviderVisibleApprovalDecisionSummaryV1 =
  providerVisibleApprovalDecisionSummaryV1;

/** Evaluate a rule-set-bound proposal without trusting a caller-supplied decision or reason list. */
export function evaluateApprovalDecision(
  input: EvaluateApprovalDecisionInput
): ApprovalDecisionEvaluation {
  const rule = resolveRule(
    parseNonEmptyString(input.approvalRuleSetVersion),
    parseChecksum(input.approvalRuleSetChecksum),
    parseOperation(input.operation)
  );
  if (rule.reviewMode === "always_human") {
    if (input.effectRuleId !== undefined) invalidProof();
  } else {
    if (input.effectRuleId !== rule.effectRuleId) invalidProof();
    assertDocumentedEffectRuleOperation(input.effectRuleId, input.operation);
  }
  return evaluateResolvedRule(
    rule,
    parseWritePolicy(input.executionWritePolicy),
    parseEvidence(input.evidence)
  );
}

/**
 * Compares every binding fact, including absent-vs-present optional values. Invalid current facts
 * are stale by definition; callers never get a false-current result from a malformed recomputation.
 */
export function verifyApprovalDecisionProofBinding(
  proofValue: MainOnlyApprovalDecisionProofV1,
  currentBinding: ApprovalDecisionProofBindingV1
): ApprovalDecisionProofBindingVerification {
  const proof = parseMainOnlyApprovalDecisionProofV1(proofValue);
  let current: ApprovalDecisionProofBindingV1;
  try {
    current = parseBinding(currentBinding);
  } catch {
    return deepFreeze({
      isCurrent: false,
      stale: true,
      mismatchedFields: [...BINDING_FIELDS]
    });
  }
  const mismatchedFields = BINDING_FIELDS.filter(
    (field) => proof.binding[field] !== current[field]
  );
  return deepFreeze({
    isCurrent: mismatchedFields.length === 0,
    stale: mismatchedFields.length !== 0,
    mismatchedFields
  });
}

export function isApprovalDecisionProofBindingCurrent(
  proof: MainOnlyApprovalDecisionProofV1,
  currentBinding: ApprovalDecisionProofBindingV1
): boolean {
  return verifyApprovalDecisionProofBinding(proof, currentBinding).isCurrent;
}

/**
 * Collapse a consistency group using the strict decision ordering. A partially collected or mixed
 * group is never eligible for automatic review, even if every proof supplied so far is eligible.
 */
export function resolveApprovalDecisionProofGroup(
  input: ResolveApprovalDecisionProofGroupInput | readonly MainOnlyApprovalDecisionProofV1[]
): ApprovalDecisionProofGroupResolution {
  let normalized: ResolveApprovalDecisionProofGroupInput;
  if (Array.isArray(input)) {
    normalized = { proofs: input as readonly MainOnlyApprovalDecisionProofV1[] };
  } else {
    normalized = input as ResolveApprovalDecisionProofGroupInput;
  }
  const reasons: ProviderSafeApprovalReasonCode[] = [];
  let decision: ApprovalDecision = "auto_review_eligible";
  let mixedOrIncomplete =
    normalized.complete !== true ||
    normalized.mixed === true ||
    normalized.proofs.length === 0 ||
    normalized.expectedProofCount === undefined ||
    !Number.isSafeInteger(normalized.expectedProofCount) ||
    normalized.expectedProofCount < 1 ||
    normalized.expectedProofCount !== normalized.proofs.length;

  let expectedGroupChecksum: string | undefined;
  let expectedRunId: string | undefined;
  let expectedChangeSetId: string | undefined;
  let expectedChangeSetRevision: number | undefined;
  for (const candidate of normalized.proofs) {
    let proof: MainOnlyApprovalDecisionProofV1;
    try {
      proof = parseMainOnlyApprovalDecisionProofV1(candidate);
    } catch {
      mixedOrIncomplete = true;
      continue;
    }
    reasons.push(...proof.reasonCodes);
    if (proof.decision === "rejected") {
      decision = "rejected";
    } else if (proof.decision === "human_confirmation" && decision !== "rejected") {
      decision = "human_confirmation";
    }
    if (expectedGroupChecksum === undefined) {
      expectedGroupChecksum = proof.binding.consistencyGroupChecksum;
      expectedRunId = proof.binding.runId;
      expectedChangeSetId = proof.binding.changeSetId;
      expectedChangeSetRevision = proof.binding.changeSetRevision;
    } else if (
      expectedGroupChecksum !== proof.binding.consistencyGroupChecksum ||
      expectedRunId !== proof.binding.runId ||
      expectedChangeSetId !== proof.binding.changeSetId ||
      expectedChangeSetRevision !== proof.binding.changeSetRevision
    ) {
      mixedOrIncomplete = true;
    }
  }
  if (mixedOrIncomplete) {
    reasons.push("mixed_or_incomplete_evidence");
    if (decision === "auto_review_eligible") decision = "human_confirmation";
  }
  return deepFreeze({ decision, reasonCodes: canonicalReasonCodes(reasons) });
}

/** RFC 8785/JCS-compatible serialization for this restricted JSON domain. */
export function canonicalizeApprovalDecisionProofJson(value: unknown): string {
  return canonicalizeJson(value, new WeakSet<object>());
}

function evaluateResolvedRule(
  rule: ProviderVisibleApprovalRule,
  executionWritePolicy: AgentWritePolicy,
  evidence: ApprovalDecisionProofEvidenceV1
): ApprovalDecisionEvaluation {
  const reasons: ProviderSafeApprovalReasonCode[] = [];
  if (evidence.pathClass === "hard_denied") {
    return deepFreeze({ decision: "rejected", reasonCodes: ["operation_rejected"] });
  }
  if (executionWritePolicy !== "user_preapproved_run") {
    reasons.push("run_policy_requires_confirmation");
  }
  if (rule.reviewMode === "always_human") {
    reasons.push("operation_always_human");
  }
  if (evidence.targetFreshness === "dirty" || evidence.targetFreshness === "stale") {
    reasons.push("target_not_clean_or_stable");
  }
  if (evidence.pathClass === "policy_managed" || evidence.pathClass === "ignored_generated") {
    reasons.push("path_requires_confirmation");
  }
  if (evidence.referenceImpact === "present") reasons.push("reference_impact");
  if (
    evidence.stateBoundary === "archive" ||
    evidence.stateBoundary === "delete" ||
    evidence.stateBoundary === "restore"
  ) {
    reasons.push("state_boundary");
  }
  if (evidence.limits === "exceeded") reasons.push("limit_exceeded");
  if (hasUnknownOrMixedEvidence(evidence)) reasons.push("mixed_or_incomplete_evidence");

  if (rule.reviewMode === "conditional_auto_review") {
    assertDocumentedEffectRuleOperation(rule.effectRuleId, rule.operation);
    if (hasUnexplainedEffectRuleMismatch(rule.effectRuleId, evidence)) {
      reasons.push("mixed_or_incomplete_evidence");
    }
  }
  const canonicalReasons = canonicalReasonCodes(reasons);
  return deepFreeze({
    decision: canonicalReasons.length === 0 ? "auto_review_eligible" : "human_confirmation",
    reasonCodes: canonicalReasons
  });
}

function matchesEffectRuleEvidence(
  effectRuleId: ProviderVisibleConditionalApprovalRuleId,
  evidence: ApprovalDecisionProofEvidenceV1
): boolean {
  const definition = resolveApprovalEffectRuleDefinition(effectRuleId);
  return EVIDENCE_FIELDS.every(
    (field) =>
      evidence[field] === (definition.evaluatorContract.eligibleValues[field] ?? "not_applicable")
  );
}

function hasUnexplainedEffectRuleMismatch(
  effectRuleId: ProviderVisibleConditionalApprovalRuleId,
  evidence: ApprovalDecisionProofEvidenceV1
): boolean {
  if (matchesEffectRuleEvidence(effectRuleId, evidence)) return false;
  const definition = resolveApprovalEffectRuleDefinition(effectRuleId);
  return EVIDENCE_FIELDS.some((field) => {
    const value = evidence[field];
    const expected = definition.evaluatorContract.eligibleValues[field] ?? "not_applicable";
    return value !== expected && !isProviderSafeKnownBlocker(field, value);
  });
}

function isProviderSafeKnownBlocker(
  field: keyof ApprovalDecisionProofEvidenceV1,
  value: ApprovalDecisionProofEvidenceV1[keyof ApprovalDecisionProofEvidenceV1]
): boolean {
  return (
    (field === "pathClass" &&
      (value === "policy_managed" || value === "ignored_generated" || value === "hard_denied")) ||
    (field === "targetFreshness" && (value === "dirty" || value === "stale")) ||
    (field === "referenceImpact" && value === "present") ||
    (field === "limits" && value === "exceeded") ||
    (field === "stateBoundary" &&
      (value === "archive" || value === "delete" || value === "restore"))
  );
}

function hasUnknownOrMixedEvidence(evidence: ApprovalDecisionProofEvidenceV1): boolean {
  return (
    evidence.pathClass === "mixed" ||
    evidence.pathClass === "unknown" ||
    evidence.targetFreshness === "unknown" ||
    evidence.createOnly === "not_proven" ||
    evidence.referenceImpact === "unknown" ||
    evidence.limits === "unknown"
  );
}

function resolveRule(
  version: string,
  checksum: string,
  operation: ProviderVisibleWriteOperation
): ProviderVisibleApprovalRule {
  let rule: ProviderVisibleApprovalRule;
  try {
    const projection = resolveRegisteredApprovalRuleSet(version, checksum);
    rule = approvalRuleForOperation(operation, projection.version);
  } catch {
    invalidProof();
  }
  if (rule.operation !== operation) invalidProof();
  return rule;
}

function assertDocumentedEffectRuleOperation(
  effectRuleId: ProviderVisibleConditionalApprovalRuleId,
  operation: ProviderVisibleWriteOperation
): void {
  try {
    resolveApprovalEffectRuleDefinition(effectRuleId);
  } catch {
    invalidProof();
  }
  if (EFFECT_RULE_OPERATION[effectRuleId] !== operation) invalidProof();
}

function parseBinding(value: unknown): ApprovalDecisionProofBindingV1 {
  if (!isRecord(value) || !hasOnlyFields(value, BINDING_FIELDS)) invalidProof();
  for (const field of BINDING_REQUIRED_FIELDS) {
    if (!Object.hasOwn(value, field)) invalidProof();
  }
  assertOptionalString(value, "rootBindingId");
  assertOptionalString(value, "recoveryRootBindingId");
  assertOptionalString(value, "recoveryGrantRevision");
  assertOptionalChecksum(value, "baseManifestChecksum");
  assertOptionalChecksum(value, "candidateManifestChecksum");
  assertOptionalChecksum(value, "referenceImpactChecksum");
  assertOptionalChecksum(value, "recoverySideEffectChecksum");

  const recoveryFieldsPresent = [
    "recoveryRootBindingId",
    "recoveryGrantRevision",
    "recoverySideEffectChecksum"
  ].filter((field) => Object.hasOwn(value, field));
  if (recoveryFieldsPresent.length !== 0 && recoveryFieldsPresent.length !== 3) invalidProof();

  return deepFreeze({
    workspaceBindingId: parseNonEmptyString(value["workspaceBindingId"]),
    ...(value["rootBindingId"] === undefined
      ? {}
      : { rootBindingId: parseNonEmptyString(value["rootBindingId"]) }),
    ...(value["recoveryRootBindingId"] === undefined
      ? {}
      : { recoveryRootBindingId: parseNonEmptyString(value["recoveryRootBindingId"]) }),
    ...(value["recoveryGrantRevision"] === undefined
      ? {}
      : { recoveryGrantRevision: parseNonEmptyString(value["recoveryGrantRevision"]) }),
    runId: parseNonEmptyString(value["runId"]),
    changeSetId: parseNonEmptyString(value["changeSetId"]),
    changeSetRevision: parsePositiveInteger(value["changeSetRevision"]),
    changeSetChecksum: parseChecksum(value["changeSetChecksum"]),
    consistencyGroupChecksum: parseChecksum(value["consistencyGroupChecksum"]),
    proposalPayloadChecksum: parseChecksum(value["proposalPayloadChecksum"]),
    ...(value["baseManifestChecksum"] === undefined
      ? {}
      : { baseManifestChecksum: parseChecksum(value["baseManifestChecksum"]) }),
    ...(value["candidateManifestChecksum"] === undefined
      ? {}
      : { candidateManifestChecksum: parseChecksum(value["candidateManifestChecksum"]) }),
    ...(value["referenceImpactChecksum"] === undefined
      ? {}
      : { referenceImpactChecksum: parseChecksum(value["referenceImpactChecksum"]) }),
    ...(value["recoverySideEffectChecksum"] === undefined
      ? {}
      : { recoverySideEffectChecksum: parseChecksum(value["recoverySideEffectChecksum"]) }),
    executionWritePolicy: parseWritePolicy(value["executionWritePolicy"]),
    policyRevision: parseNonEmptyString(value["policyRevision"]),
    capabilityRevision: parseNonEmptyString(value["capabilityRevision"])
  });
}

function parseEvidence(value: unknown): ApprovalDecisionProofEvidenceV1 {
  if (!isRecord(value) || !hasExactlyFields(value, EVIDENCE_FIELDS)) invalidProof();
  const evidence: ApprovalDecisionProofEvidenceV1 = {
    pathClass: parsePathClass(value["pathClass"]),
    targetFreshness: parseTargetFreshness(value["targetFreshness"]),
    createOnly: parseCreateOnly(value["createOnly"]),
    referenceImpact: parseReferenceImpact(value["referenceImpact"]),
    limits: parseLimits(value["limits"]),
    stateBoundary: parseStateBoundary(value["stateBoundary"])
  };
  return deepFreeze(evidence);
}

function parseReasonCodes(value: unknown): readonly ProviderSafeApprovalReasonCode[] {
  if (!Array.isArray(value)) invalidProof();
  const reasonCodes = value.map(parseReasonCode);
  if (new Set(reasonCodes).size !== reasonCodes.length) invalidProof();
  const canonical = canonicalReasonCodes(reasonCodes);
  if (!sameStringArray(reasonCodes, canonical)) invalidProof();
  return Object.freeze(canonical);
}

function canonicalReasonCodes(
  values: readonly ProviderSafeApprovalReasonCode[]
): readonly ProviderSafeApprovalReasonCode[] {
  const present = new Set(values);
  return Object.freeze(REASON_CODE_ORDER.filter((code) => present.has(code)));
}

function parseDecision(value: unknown): ApprovalDecision {
  if (value !== "auto_review_eligible" && value !== "human_confirmation" && value !== "rejected") {
    invalidProof();
  }
  return value;
}

function parseReasonCode(value: unknown): ProviderSafeApprovalReasonCode {
  if (!REASON_CODE_ORDER.some((code) => code === value)) invalidProof();
  return value as ProviderSafeApprovalReasonCode;
}

function parseOperation(value: unknown): ProviderVisibleWriteOperation {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STRING_LENGTH) {
    invalidProof();
  }
  return value as ProviderVisibleWriteOperation;
}

function parseEffectRuleId(value: unknown): ProviderVisibleConditionalApprovalRuleId {
  if (typeof value !== "string" || !Object.hasOwn(EFFECT_RULE_OPERATION, value)) invalidProof();
  return value as ProviderVisibleConditionalApprovalRuleId;
}

function parseWritePolicy(value: unknown): AgentWritePolicy {
  if (value !== "write_before_confirmation" && value !== "user_preapproved_run") invalidProof();
  return value;
}

function parsePathClass(value: unknown): ApprovalDecisionProofEvidenceV1["pathClass"] {
  if (
    value !== "not_applicable" &&
    value !== "ordinary" &&
    value !== "policy_managed" &&
    value !== "ignored_generated" &&
    value !== "hard_denied" &&
    value !== "mixed" &&
    value !== "unknown"
  ) {
    invalidProof();
  }
  return value;
}

function parseTargetFreshness(value: unknown): ApprovalDecisionProofEvidenceV1["targetFreshness"] {
  if (
    value !== "not_applicable" &&
    value !== "clean_stable" &&
    value !== "dirty" &&
    value !== "stale" &&
    value !== "unknown"
  ) {
    invalidProof();
  }
  return value;
}

function parseCreateOnly(value: unknown): ApprovalDecisionProofEvidenceV1["createOnly"] {
  if (value !== "not_applicable" && value !== "proven" && value !== "not_proven") invalidProof();
  return value;
}

function parseReferenceImpact(value: unknown): ApprovalDecisionProofEvidenceV1["referenceImpact"] {
  if (
    value !== "not_applicable" &&
    value !== "none" &&
    value !== "present" &&
    value !== "unknown"
  ) {
    invalidProof();
  }
  return value;
}

function parseLimits(value: unknown): ApprovalDecisionProofEvidenceV1["limits"] {
  if (value !== "within" && value !== "exceeded" && value !== "unknown") invalidProof();
  return value;
}

function parseStateBoundary(value: unknown): ApprovalDecisionProofEvidenceV1["stateBoundary"] {
  if (
    value !== "not_applicable" &&
    value !== "ordinary" &&
    value !== "archive" &&
    value !== "delete" &&
    value !== "restore"
  ) {
    invalidProof();
  }
  return value;
}

function parseNonEmptyString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STRING_LENGTH ||
    hasUnpairedSurrogate(value)
  ) {
    invalidProof();
  }
  return value;
}

function parseChecksum(value: unknown): string {
  if (typeof value !== "string" || !CHECKSUM.test(value)) invalidProof();
  return value;
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalidProof();
  return value as number;
}

function assertOptionalString(value: Record<string, unknown>, field: string): void {
  if (!Object.hasOwn(value, field)) return;
  if (value[field] === undefined) invalidProof();
  parseNonEmptyString(value[field]);
}

function assertOptionalChecksum(value: Record<string, unknown>, field: string): void {
  if (!Object.hasOwn(value, field)) return;
  if (value[field] === undefined) invalidProof();
  parseChecksum(value[field]);
}

function canonicalizeProof(value: MainOnlyApprovalDecisionProofV1): string {
  return canonicalizeApprovalDecisionProofJson(value);
}

function canonicalizeJson(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) invalidProof();
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidProof();
    const serialized = JSON.stringify(value);
    if (serialized === undefined) invalidProof();
    return serialized;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) invalidProof();
    seen.add(value);
    const children: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) invalidProof();
      children.push(canonicalizeJson(value[index], seen));
    }
    seen.delete(value);
    return `[${children.join(",")}]`;
  }
  if (!isRecord(value)) invalidProof();
  if (seen.has(value)) invalidProof();
  seen.add(value);
  const keys = Object.keys(value).sort();
  const members = keys.map((key) => {
    if (hasUnpairedSurrogate(key)) invalidProof();
    return `${JSON.stringify(key)}:${canonicalizeJson(value[key], seen)}`;
  });
  seen.delete(value);
  return `{${members.join(",")}}`;
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalidProof(): never {
  throw new Error("APPROVAL_DECISION_PROOF_INVALID");
}
