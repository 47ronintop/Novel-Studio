import {
  approvalBindingV2Checksum,
  approvalDecisionProofChecksum,
  checksumChangeSetText,
  createApprovalBindingV2,
  parseApprovalBindingV2,
  parseChangeSetV2,
  parseMainOnlyApprovalDecisionProofV1,
  validateApprovalBindingV2,
  validateAgentRelativePath,
  type ApprovalBindingV2,
  type ApprovalBindingV2Bom,
  type ApprovalBindingV2Encoding,
  type ApprovalBindingV2Eol,
  type ChangeSetV2,
  type CreateApprovalBindingV2Input,
  type MainOnlyApprovalDecisionProofV1,
  type ProviderVisibleWorkspaceFileOperation
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { hasApprovalBindingV2Authorization } from "./agent-write-authorization.js";

/**
 * Main-only adapter for the engineering half of the shared Change Set / Binding / Ledger v2
 * contract. Raw byte manifests stay owned by the repository V2 port; this boundary receives only
 * their already-validated, canonical checksums and binds them to the human approval proof.
 */
export const ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION = "2.0" as const;

export type EngineeringFileApprovalOperationKindV2 = ProviderVisibleWorkspaceFileOperation;
export type EngineeringApprovalBeforeKindV2 = "present" | "absent";

/**
 * Canonical facts derived from a validated EngineeringFileMutationRequestV2. In particular,
 * `baseManifestChecksum` is the raw-byte manifest checksum for replace and the absence-proof
 * checksum for create. It is not a renderer/provider supplied hash.
 */
export interface EngineeringApprovalBindingFactsV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION;
  readonly workspaceBindingId: string;
  readonly rootBindingId: string;
  readonly operationKind: EngineeringFileApprovalOperationKindV2;
  readonly relativeIdentity: string;
  readonly selectedOperationIds: readonly string[];
  readonly selectionChecksum: string;
  readonly operationOrderChecksum: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly beforeKind: EngineeringApprovalBeforeKindV2;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseManifestChecksum: string;
  readonly candidateManifestChecksum: string;
  readonly encoding: ApprovalBindingV2Encoding;
  readonly bom: ApprovalBindingV2Bom;
  readonly eol: ApprovalBindingV2Eol;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly proof: MainOnlyApprovalDecisionProofV1;
  /** Main-created checksum of the complete raw-byte proposal payload. */
  readonly proposalPayloadChecksum: string;
  readonly executionWritePolicy: "write_before_confirmation" | "user_preapproved_run";
  readonly policyRevision: string;
  readonly capabilityRevision: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly recoveryRootBindingId?: string;
  readonly recoveryGrantRevision?: string;
  readonly recoverySideEffectChecksum?: string;
}

/** All stable Binding v2 fields; capability, nonce, and binding id are Main-generated later. */
export type EngineeringApprovalBindingSeedV2 = Omit<
  CreateApprovalBindingV2Input,
  "bindingId" | "capability" | "nonce"
>;

export interface BuildEngineeringApprovalBindingV2Input {
  readonly schemaVersion: typeof ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION;
  readonly changeSet: ChangeSetV2;
  readonly facts: EngineeringApprovalBindingFactsV2;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ValidateEngineeringApprovalBindingV2Input {
  readonly schemaVersion: typeof ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION;
  readonly changeSet: ChangeSetV2;
  readonly facts: EngineeringApprovalBindingFactsV2;
  readonly binding: ApprovalBindingV2;
  readonly now?: number;
}

/** Minimal structural port so application remains independent of the repository package graph. */
export interface EngineeringApprovalLedgerV2Port {
  query(
    authorizationId: string,
    transactionId?: string
  ): Promise<Result<EngineeringApprovalLedgerRecordV2, UnifiedError>>;
}

/** The reserved Ledger 2.0 record required immediately before a native mutation begins. */
export interface EngineeringApprovalLedgerRecordV2 {
  readonly schemaVersion: "2.0";
  readonly authorizationId: string;
  readonly binding: ApprovalBindingV2;
  readonly providerSemanticVersionSetChecksum: string;
  readonly state: "issued" | "reserved" | "consumed" | "revoked";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly reservedTransactionId?: string;
  readonly reservedAt?: string;
  /** Main-only WAL identifier. Never return this from an external projection. */
  readonly reserveWalId?: string;
  readonly consumedAt?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

export interface ValidateEngineeringApprovalApplyV2Input {
  readonly schemaVersion: typeof ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION;
  /** Supplied only by the qualified Main-owned ADR-0004 coordinator/runtime. */
  readonly trustedApprovalQualified: boolean;
  readonly changeSet: ChangeSetV2;
  readonly facts: EngineeringApprovalBindingFactsV2;
  readonly binding: ApprovalBindingV2;
  readonly authorizationId: string;
  readonly reservationTransactionId: string;
  readonly ledger: EngineeringApprovalLedgerV2Port;
  readonly now?: number;
}

/** Main-only result. It deliberately retains the opaque binding for the native apply path. */
export interface ValidatedEngineeringApprovalApplyV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION;
  readonly changeSet: ChangeSetV2;
  readonly binding: ApprovalBindingV2;
  readonly authorizationId: string;
  readonly reservationTransactionId: string;
}

/** Safe for a Provider or ordinary Renderer: no root/workspace/run/capability/reservation/WAL data. */
export interface EngineeringApprovalExternalProjectionV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly displayBindingChecksum: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly operationKind: EngineeringFileApprovalOperationKindV2;
  readonly selectedOperationIds: readonly string[];
  readonly selectionChecksum: string;
  readonly operationOrderChecksum: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseManifestChecksum: string;
  readonly candidateManifestChecksum: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly proofChecksum: string;
  readonly executionWritePolicy: "write_before_confirmation" | "user_preapproved_run";
  readonly issuedAt: string;
  readonly expiresAt: string;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const FACT_KEYS = [
  "schemaVersion",
  "workspaceBindingId",
  "rootBindingId",
  "operationKind",
  "relativeIdentity",
  "selectedOperationIds",
  "selectionChecksum",
  "operationOrderChecksum",
  "sourceRef",
  "targetRef",
  "beforeKind",
  "baseChecksum",
  "candidateChecksum",
  "baseManifestChecksum",
  "candidateManifestChecksum",
  "encoding",
  "bom",
  "eol",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "proof",
  "proposalPayloadChecksum",
  "executionWritePolicy",
  "policyRevision",
  "capabilityRevision",
  "providerSemanticVersionSetChecksum",
  "recoveryRootBindingId",
  "recoveryGrantRevision",
  "recoverySideEffectChecksum"
] as const;

const BUILD_KEYS = ["schemaVersion", "changeSet", "facts", "issuedAt", "expiresAt"] as const;
const BINDING_KEYS = ["schemaVersion", "changeSet", "facts", "binding", "now"] as const;
const BINDING_REQUIRED_KEYS = BINDING_KEYS.filter((key) => key !== "now");
const APPLY_KEYS = [
  "schemaVersion",
  "trustedApprovalQualified",
  "changeSet",
  "facts",
  "binding",
  "authorizationId",
  "reservationTransactionId",
  "ledger",
  "now"
] as const;
const APPLY_REQUIRED_KEYS = APPLY_KEYS.filter((key) => key !== "now");
const LEDGER_KEYS = [
  "schemaVersion",
  "authorizationId",
  "binding",
  "providerSemanticVersionSetChecksum",
  "state",
  "issuedAt",
  "expiresAt",
  "reservedTransactionId",
  "reservedAt",
  "reserveWalId",
  "consumedAt",
  "revokedAt",
  "revocationReason"
] as const;
const LEGACY_TOKEN_KEYS = [
  "approvalToken",
  "engineeringApprovalToken",
  "engineeringApplyToken",
  "deterministicApprovalToken"
] as const;

/**
 * Creates the deterministic part of an Approval Binding 2.0 from validated engineering facts.
 * The trusted Main coordinator remains responsible for adding the opaque capability and issuing
 * it through the shared authorization ledger.
 */
export function buildEngineeringApprovalBindingV2(
  input: BuildEngineeringApprovalBindingV2Input
): Result<EngineeringApprovalBindingSeedV2, UnifiedError> {
  if (hasLegacyToken(input) || hasLegacyToken(input.changeSet) || hasLegacyToken(input.facts)) {
    return legacyTokenRejected();
  }
  if (!hasExactKeys(input, BUILD_KEYS))
    return invalidInput("Engineering approval input is invalid.");
  if (
    input.schemaVersion !== ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION ||
    !isCanonicalTimestamp(input.issuedAt) ||
    !isCanonicalTimestamp(input.expiresAt) ||
    Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
  ) {
    return invalidInput("Engineering approval timing or schema is invalid.");
  }

  const changeSet = parseEngineeringChangeSet(input.changeSet);
  if (!changeSet.ok) return changeSet;
  const facts = validateFacts(input.facts, changeSet.value);
  if (!facts.ok) return facts;

  const seed: EngineeringApprovalBindingSeedV2 = {
    workspaceBindingId: facts.value.workspaceBindingId,
    rootBindingId: facts.value.rootBindingId,
    runId: changeSet.value.runId,
    changeSetId: changeSet.value.changeSetId,
    changeSetRevision: changeSet.value.revision,
    changeSetChecksum: changeSet.value.checksum,
    providerSemanticVersionSetChecksum: facts.value.providerSemanticVersionSetChecksum,
    operationKind: facts.value.operationKind,
    selectionChecksum: facts.value.selectionChecksum,
    selectedOperationIds: [...facts.value.selectedOperationIds],
    operationOrderChecksum: facts.value.operationOrderChecksum,
    sourceRef: facts.value.sourceRef,
    targetRef: facts.value.targetRef,
    baseChecksum: facts.value.baseChecksum,
    candidateChecksum: facts.value.candidateChecksum,
    baseManifestChecksum: facts.value.baseManifestChecksum,
    candidateManifestChecksum: facts.value.candidateManifestChecksum,
    encoding: facts.value.encoding,
    bom: facts.value.bom,
    eol: facts.value.eol,
    approvalRuleSetVersion: facts.value.approvalRuleSetVersion,
    approvalRuleSetChecksum: facts.value.approvalRuleSetChecksum,
    proofId: facts.value.proof.proofId,
    proofChecksum: approvalDecisionProofChecksum(facts.value.proof),
    executionWritePolicy: facts.value.executionWritePolicy,
    policyRevision: facts.value.policyRevision,
    capabilityRevision: facts.value.capabilityRevision,
    ...(facts.value.recoveryRootBindingId === undefined
      ? {}
      : { recoveryRootBindingId: facts.value.recoveryRootBindingId }),
    ...(facts.value.recoveryGrantRevision === undefined
      ? {}
      : { recoveryGrantRevision: facts.value.recoveryGrantRevision }),
    ...(facts.value.recoverySideEffectChecksum === undefined
      ? {}
      : { recoverySideEffectChecksum: facts.value.recoverySideEffectChecksum }),
    // Batch 7's replace/create rule proof must still lead to a qualified human confirmation.
    approvalSource: "human_confirmation",
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  };
  try {
    // Reuse the shared schema validator before the trusted coordinator allocates opaque values.
    createApprovalBindingV2({
      ...seed,
      bindingId: "engineering_binding_validation",
      capability: "a".repeat(32),
      nonce: "a".repeat(22)
    });
  } catch {
    return invalidInput("Engineering approval facts cannot form an Approval Binding 2.0.");
  }
  return ok(freeze(seed));
}

/** Validates a concrete shared Approval Binding 2.0 against current engineering proposal facts. */
export function validateEngineeringApprovalBindingV2(
  input: ValidateEngineeringApprovalBindingV2Input
): Result<ApprovalBindingV2, UnifiedError> {
  if (
    hasLegacyToken(input) ||
    hasLegacyToken(input.changeSet) ||
    hasLegacyToken(input.facts) ||
    hasLegacyToken(input.binding)
  ) {
    return legacyTokenRejected();
  }
  if (!hasRequiredAndOnlyKeys(input, BINDING_REQUIRED_KEYS, BINDING_KEYS)) {
    return invalidInput("Engineering approval binding input is invalid.");
  }
  if (
    input.schemaVersion !== ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION ||
    (input.now !== undefined && !Number.isFinite(input.now))
  ) {
    return invalidInput("Engineering approval binding schema is invalid.");
  }

  const binding = validateApprovalBindingV2(input.binding, input.now);
  if (!binding.ok) return binding;
  if (binding.value.approvalSource !== "human_confirmation") {
    return proofNotHuman();
  }

  const seed = buildEngineeringApprovalBindingV2({
    schemaVersion: ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
    changeSet: input.changeSet,
    facts: input.facts,
    issuedAt: binding.value.issuedAt,
    expiresAt: binding.value.expiresAt
  });
  if (!seed.ok) return seed;
  if (!bindingMatchesSeed(binding.value, seed.value)) return bindingStale();
  return ok(binding.value);
}

/**
 * Revalidates immediately before native apply. Missing ADR qualification, Main provenance, ledger,
 * reservation, or any stale binding fact leaves the mutation unavailable with no fallback.
 */
export async function validateEngineeringApprovalApplyV2(
  input: ValidateEngineeringApprovalApplyV2Input
): Promise<Result<ValidatedEngineeringApprovalApplyV2, UnifiedError>> {
  if (
    hasLegacyToken(input) ||
    hasLegacyToken(input.changeSet) ||
    hasLegacyToken(input.facts) ||
    hasLegacyToken(input.binding)
  ) {
    return legacyTokenRejected();
  }
  if (!hasRequiredAndOnlyKeys(input, APPLY_REQUIRED_KEYS, APPLY_KEYS)) {
    return invalidInput("Engineering apply approval input is invalid.");
  }
  if (
    input.schemaVersion !== ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION ||
    input.trustedApprovalQualified !== true ||
    (input.now !== undefined && !Number.isFinite(input.now)) ||
    !isStableId(input.authorizationId) ||
    !isStableId(input.reservationTransactionId) ||
    !isRecord(input.ledger) ||
    typeof input.ledger.query !== "function"
  ) {
    return coreUnavailable();
  }

  const binding = validateEngineeringApprovalBindingV2({
    schemaVersion: ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
    changeSet: input.changeSet,
    facts: input.facts,
    binding: input.binding,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  if (!binding.ok) return binding;
  if (!hasApprovalBindingV2Authorization(binding.value)) return coreUnavailable();

  let queried: Result<EngineeringApprovalLedgerRecordV2, UnifiedError>;
  try {
    queried = await input.ledger.query(input.authorizationId, input.reservationTransactionId);
  } catch {
    return coreUnavailable();
  }
  if (!queried.ok) return ledgerRejected();
  const record = validateReservedLedgerRecord(
    queried.value,
    input.authorizationId,
    input.reservationTransactionId,
    binding.value,
    input.now
  );
  if (!record.ok) return record;

  return ok(
    freeze({
      schemaVersion: ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
      changeSet: parseChangeSetV2(input.changeSet),
      binding: binding.value,
      authorizationId: input.authorizationId,
      reservationTransactionId: input.reservationTransactionId
    })
  );
}

/**
 * The only projection suitable for a Provider or ordinary Renderer. It intentionally has no
 * authorization id, reservation transaction, WAL identifier, root identity, capability, or nonce.
 */
export function projectEngineeringApprovalApplyV2ForExternal(
  value: ValidatedEngineeringApprovalApplyV2
): EngineeringApprovalExternalProjectionV2 {
  const binding = parseApprovalBindingV2(value.binding);
  if (!isEngineeringOperation(binding.operationKind)) {
    throw new Error("ENGINEERING_FILE_APPROVAL_V2_EXTERNAL_PROJECTION_INVALID");
  }
  return freeze({
    schemaVersion: ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
    changeSetId: value.changeSet.changeSetId,
    changeSetRevision: value.changeSet.revision,
    changeSetChecksum: value.changeSet.checksum,
    displayBindingChecksum: value.changeSet.displayBindingChecksum,
    providerSemanticVersionSetChecksum: binding.providerSemanticVersionSetChecksum,
    operationKind: binding.operationKind,
    selectedOperationIds: freeze([...binding.selectedOperationIds]),
    selectionChecksum: binding.selectionChecksum,
    operationOrderChecksum: binding.operationOrderChecksum,
    baseChecksum: binding.baseChecksum,
    candidateChecksum: binding.candidateChecksum,
    baseManifestChecksum: binding.baseManifestChecksum,
    candidateManifestChecksum: binding.candidateManifestChecksum,
    approvalRuleSetVersion: binding.approvalRuleSetVersion,
    approvalRuleSetChecksum: binding.approvalRuleSetChecksum,
    proofChecksum: binding.proofChecksum,
    executionWritePolicy: binding.executionWritePolicy,
    issuedAt: binding.issuedAt,
    expiresAt: binding.expiresAt
  });
}

function parseEngineeringChangeSet(value: unknown): Result<ChangeSetV2, UnifiedError> {
  if (hasLegacyToken(value)) return legacyTokenRejected();
  try {
    return ok(parseChangeSetV2(value));
  } catch {
    return failure(
      "ENGINEERING_FILE_APPROVAL_V2_CHANGE_SET_REQUIRED",
      "Engineering approval accepts only a strict Change Set 2.0 record."
    );
  }
}

function validateFacts(
  value: unknown,
  changeSet: ChangeSetV2
): Result<EngineeringApprovalBindingFactsV2, UnifiedError> {
  if (hasLegacyToken(value)) return legacyTokenRejected();
  if (!hasRequiredAndOnlyKeys(value, FACT_KEYS.slice(0, -3), FACT_KEYS)) {
    return invalidInput("Engineering approval facts contain an unknown or missing field.");
  }
  const facts = value as unknown as EngineeringApprovalBindingFactsV2;
  const lifecycle =
    facts.operationKind === "move_file" ||
    facts.operationKind === "delete_file" ||
    facts.operationKind === "create_directory";
  const isDelete = facts.operationKind === "delete_file";
  const recoveryKeysPresent = [
    facts.recoveryRootBindingId,
    facts.recoveryGrantRevision,
    facts.recoverySideEffectChecksum
  ].some((field) => field !== undefined);
  if (
    facts.schemaVersion !== ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION ||
    !isStableId(facts.workspaceBindingId) ||
    !isStableId(facts.rootBindingId) ||
    !isEngineeringOperation(facts.operationKind) ||
    !validateAgentRelativePath(facts.relativeIdentity).ok ||
    !Array.isArray(facts.selectedOperationIds) ||
    facts.selectedOperationIds.length === 0 ||
    facts.selectedOperationIds.some((id) => !isOperationId(id)) ||
    !isHash(facts.selectionChecksum) ||
    !isHash(facts.operationOrderChecksum) ||
    !isNonEmptyString(facts.sourceRef) ||
    !isNonEmptyString(facts.targetRef) ||
    !isBeforeKind(facts.beforeKind) ||
    !isBaseChecksumValid(facts.baseChecksum, facts.beforeKind, lifecycle) ||
    !isEngineeringChecksum(facts.candidateChecksum, lifecycle) ||
    !isEngineeringChecksum(facts.baseManifestChecksum, lifecycle) ||
    !isEngineeringChecksum(facts.candidateManifestChecksum, lifecycle) ||
    !isEncoding(facts.encoding) ||
    !isBom(facts.bom) ||
    !isEol(facts.eol) ||
    !isNonEmptyString(facts.approvalRuleSetVersion) ||
    !isHash(facts.approvalRuleSetChecksum) ||
    !isHash(facts.proposalPayloadChecksum) ||
    !isPolicy(facts.executionWritePolicy) ||
    !isStableId(facts.policyRevision) ||
    !isStableId(facts.capabilityRevision) ||
    !isHash(facts.providerSemanticVersionSetChecksum)
  ) {
    return invalidInput("Engineering approval facts are invalid.");
  }

  if (isDelete) {
    if (
      !isStableId(facts.recoveryRootBindingId) ||
      !isStableId(facts.recoveryGrantRevision) ||
      !isHash(facts.recoverySideEffectChecksum)
    ) {
      return invalidInput(
        "Delete approval facts must bind the recovery root, grant, and side effect."
      );
    }
  } else if (recoveryKeysPresent) {
    return invalidInput("Recovery binding facts are only valid for delete authorization.");
  }

  const selectedOperationIds = selectedIds(changeSet);
  if (
    selectedOperationIds.length !== facts.selectedOperationIds.length ||
    selectedOperationIds.some((id, index) => id !== facts.selectedOperationIds[index]) ||
    facts.operationOrderChecksum !== checksumChangeSetText(selectedOperationIds.join("\n")) ||
    facts.providerSemanticVersionSetChecksum !== changeSet.providerSemanticVersionSetChecksum ||
    facts.executionWritePolicy !== (changeSet.writePolicy ?? "write_before_confirmation")
  ) {
    return bindingStale();
  }

  if (
    ((facts.operationKind === "replace_file" ||
      facts.operationKind === "move_file" ||
      facts.operationKind === "delete_file") &&
      facts.beforeKind !== "present") ||
    ((facts.operationKind === "create_file" || facts.operationKind === "create_directory") &&
      facts.beforeKind !== "absent")
  ) {
    return invalidInput("Engineering lifecycle facts have an invalid before or absence binding.");
  }

  let proof: MainOnlyApprovalDecisionProofV1;
  try {
    proof = parseMainOnlyApprovalDecisionProofV1(facts.proof);
  } catch {
    return proofStale();
  }
  if (
    proof.operation !== facts.operationKind ||
    proof.decision !== "human_confirmation" ||
    proof.approvalRuleSetVersion !== facts.approvalRuleSetVersion ||
    proof.approvalRuleSetChecksum !== facts.approvalRuleSetChecksum ||
    proof.binding.workspaceBindingId !== facts.workspaceBindingId ||
    proof.binding.rootBindingId !== facts.rootBindingId ||
    proof.binding.runId !== changeSet.runId ||
    proof.binding.changeSetId !== changeSet.changeSetId ||
    proof.binding.changeSetRevision !== changeSet.revision ||
    proof.binding.changeSetChecksum !== changeSet.checksum ||
    proof.binding.consistencyGroupChecksum !== facts.selectionChecksum ||
    proof.binding.proposalPayloadChecksum !== facts.proposalPayloadChecksum ||
    proof.binding.baseManifestChecksum !== facts.baseManifestChecksum ||
    proof.binding.candidateManifestChecksum !== facts.candidateManifestChecksum ||
    proof.binding.executionWritePolicy !== facts.executionWritePolicy ||
    proof.binding.policyRevision !== facts.policyRevision ||
    proof.binding.capabilityRevision !== facts.capabilityRevision
  ) {
    return proofStale();
  }
  return ok(
    freeze({ ...facts, selectedOperationIds: freeze([...facts.selectedOperationIds]), proof })
  );
}

function validateReservedLedgerRecord(
  value: unknown,
  authorizationId: string,
  transactionId: string,
  binding: ApprovalBindingV2,
  now: number | undefined
): Result<EngineeringApprovalLedgerRecordV2, UnifiedError> {
  if (hasLegacyToken(value) || !hasOnlyKeys(value, LEDGER_KEYS)) return ledgerRejected();
  const record = value as unknown as EngineeringApprovalLedgerRecordV2;
  if (
    record.schemaVersion !== "2.0" ||
    record.authorizationId !== authorizationId ||
    record.state !== "reserved" ||
    record.reservedTransactionId !== transactionId ||
    !isStableId(record.reserveWalId) ||
    !isCanonicalTimestamp(record.reservedAt) ||
    !isCanonicalTimestamp(record.issuedAt) ||
    !isCanonicalTimestamp(record.expiresAt) ||
    record.issuedAt !== binding.issuedAt ||
    record.expiresAt !== binding.expiresAt ||
    record.providerSemanticVersionSetChecksum !== binding.providerSemanticVersionSetChecksum
  ) {
    return ledgerRejected();
  }
  const ledgerBinding = validateApprovalBindingV2(record.binding, now);
  if (
    !ledgerBinding.ok ||
    approvalBindingV2Checksum(ledgerBinding.value) !== approvalBindingV2Checksum(binding)
  ) {
    return ledgerRejected();
  }
  return ok(freeze(record));
}

function bindingMatchesSeed(
  binding: ApprovalBindingV2,
  seed: EngineeringApprovalBindingSeedV2
): boolean {
  return (
    binding.workspaceBindingId === seed.workspaceBindingId &&
    binding.rootBindingId === seed.rootBindingId &&
    binding.runId === seed.runId &&
    binding.changeSetId === seed.changeSetId &&
    binding.changeSetRevision === seed.changeSetRevision &&
    binding.changeSetChecksum === seed.changeSetChecksum &&
    binding.providerSemanticVersionSetChecksum === seed.providerSemanticVersionSetChecksum &&
    binding.operationKind === seed.operationKind &&
    binding.selectionChecksum === seed.selectionChecksum &&
    sameStringArray(binding.selectedOperationIds, seed.selectedOperationIds) &&
    binding.operationOrderChecksum === seed.operationOrderChecksum &&
    binding.sourceRef === seed.sourceRef &&
    binding.targetRef === seed.targetRef &&
    binding.baseChecksum === seed.baseChecksum &&
    binding.candidateChecksum === seed.candidateChecksum &&
    binding.baseManifestChecksum === seed.baseManifestChecksum &&
    binding.candidateManifestChecksum === seed.candidateManifestChecksum &&
    binding.encoding === seed.encoding &&
    binding.bom === seed.bom &&
    binding.eol === seed.eol &&
    binding.approvalRuleSetVersion === seed.approvalRuleSetVersion &&
    binding.approvalRuleSetChecksum === seed.approvalRuleSetChecksum &&
    binding.proofId === seed.proofId &&
    binding.proofChecksum === seed.proofChecksum &&
    binding.executionWritePolicy === seed.executionWritePolicy &&
    binding.policyRevision === seed.policyRevision &&
    binding.capabilityRevision === seed.capabilityRevision &&
    binding.approvalSource === seed.approvalSource &&
    binding.issuedAt === seed.issuedAt &&
    binding.expiresAt === seed.expiresAt &&
    binding.recoveryRootBindingId === seed.recoveryRootBindingId &&
    binding.recoveryGrantRevision === seed.recoveryGrantRevision &&
    binding.recoverySideEffectChecksum === seed.recoverySideEffectChecksum
  );
}

function selectedIds(changeSet: ChangeSetV2): readonly string[] {
  return [
    ...changeSet.files.filter((file) => file.selected).map((file) => file.relativePath),
    ...(changeSet.operations ?? [])
      .filter((operation) => operation.selected !== false)
      .map((operation) => operation.operationId)
  ];
}

function hasLegacyToken(value: unknown): boolean {
  return isRecord(value) && LEGACY_TOKEN_KEYS.some((key) => Object.hasOwn(value, key));
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return hasRequiredAndOnlyKeys(value, keys, keys);
}

function hasRequiredAndOnlyKeys(
  value: unknown,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.every((key) => allowedKeys.includes(key)) &&
    requiredKeys.every((key) => Object.hasOwn(value, key))
  );
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function isEngineeringOperation(value: unknown): value is EngineeringFileApprovalOperationKindV2 {
  return (
    value === "replace_file" ||
    value === "create_file" ||
    value === "move_file" ||
    value === "delete_file" ||
    value === "create_directory"
  );
}

function isBeforeKind(value: unknown): value is EngineeringApprovalBeforeKindV2 {
  return value === "present" || value === "absent";
}

function isBaseChecksumValid(
  value: unknown,
  beforeKind: EngineeringApprovalBeforeKindV2,
  lifecycle: boolean
): boolean {
  return lifecycle || beforeKind === "present"
    ? isHash(value) || value === "not_applicable"
    : value === "not_applicable";
}

function isEngineeringChecksum(value: unknown, lifecycle: boolean): boolean {
  return lifecycle ? isHash(value) || value === "not_applicable" : isHash(value);
}

function isEncoding(value: unknown): value is ApprovalBindingV2Encoding {
  return value === "utf-8" || value === "not_applicable";
}

function isBom(value: unknown): value is ApprovalBindingV2Bom {
  return value === "present" || value === "absent" || value === "not_applicable";
}

function isEol(value: unknown): value is ApprovalBindingV2Eol {
  return value === "lf" || value === "crlf" || value === "mixed" || value === "not_applicable";
}

function isPolicy(value: unknown): value is "write_before_confirmation" | "user_preapproved_run" {
  return value === "write_before_confirmation" || value === "user_preapproved_run";
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID_PATTERN.test(value);
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CANONICAL_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidInput(message: string): Result<never, UnifiedError> {
  return failure("ENGINEERING_FILE_APPROVAL_V2_INPUT_INVALID", message);
}

function bindingStale(): Result<never, UnifiedError> {
  return failure(
    "ENGINEERING_FILE_APPROVAL_V2_BINDING_STALE",
    "The Engineering root, Change Set, manifest, rule, policy, capability, or Provider version set changed."
  );
}

function proofStale(): Result<never, UnifiedError> {
  return failure(
    "ENGINEERING_FILE_APPROVAL_V2_PROOF_STALE",
    "The immutable Engineering approval rule proof does not match the current proposal."
  );
}

function proofNotHuman(): Result<never, UnifiedError> {
  return failure(
    "ENGINEERING_FILE_APPROVAL_V2_HUMAN_CONFIRMATION_REQUIRED",
    "Engineering replace/create remains pending until the immutable rule proof and ADR-0004 surface require human confirmation."
  );
}

function ledgerRejected(): Result<never, UnifiedError> {
  return failure(
    "ENGINEERING_FILE_APPROVAL_V2_LEDGER_REJECTED",
    "The shared Authorization Ledger 2.0 record is missing, stale, or not reserved by this transaction."
  );
}

function coreUnavailable(): Result<never, UnifiedError> {
  return failure(
    "ENGINEERING_FILE_APPROVAL_V2_CORE_UNAVAILABLE",
    "The ADR-0004 qualified Main confirmation surface or shared approval core is unavailable; Engineering mutation remains read-only."
  );
}

function legacyTokenRejected(): Result<never, UnifiedError> {
  return failure(
    "ENGINEERING_FILE_APPROVAL_V2_LEGACY_TOKEN_REJECTED",
    "Legacy deterministic approval tokens and Engineering-specific apply tokens cannot authorize a v2 mutation."
  );
}

function failure(code: string, message: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction:
        "Regenerate the current Engineering proposal and complete a fresh Main-owned approval.",
      traceId: "engineering-file-approval-v2"
    })
  );
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
