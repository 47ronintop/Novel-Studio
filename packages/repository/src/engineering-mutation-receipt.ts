import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  engineeringFileMutationRequestChecksumV2,
  sha256EngineeringMutationTextV2,
  validateEngineeringFileMutationRequestV2,
  validateEngineeringMutationBeforeImageV2,
  validateEngineeringFileLifecycleReceiptV2,
  validateEngineeringFileLifecycleRequestV2,
  validateEngineeringRawByteManifestV2,
  type EngineeringFileMutationOperationKindV2,
  type EngineeringFileLifecycleReceiptV2,
  type EngineeringFileLifecycleRequestV2,
  type EngineeringMutationBeforeImageV2,
  type EngineeringRawByteManifestV2
} from "./engineering-file-mutation-port-v2.js";
import { validationError } from "./errors.js";

export const ENGINEERING_MUTATION_RECEIPT_V2_DURABILITY = "data_and_directory_flushed" as const;

/**
 * Native receipt returned only after the file and affected directory have reached their platform
 * durability boundary.  The checksum covers every binding field, not merely the before/after hash.
 */
export interface EngineeringMutationReceiptV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_mutation_receipt";
  readonly transactionId: string;
  readonly operationId: string;
  readonly operationKind: EngineeringFileMutationOperationKindV2;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly relativeIdentity: string;
  readonly requestChecksum: string;
  readonly observedBefore: EngineeringMutationBeforeImageV2;
  readonly observedAfter: EngineeringRawByteManifestV2;
  readonly stagingObjectId: string;
  /** B7 has no recovery-root operation.  A non-null value is rejected rather than ignored. */
  readonly recoveryObjectId: null;
  readonly durability: typeof ENGINEERING_MUTATION_RECEIPT_V2_DURABILITY;
  readonly nativeReceiptChecksum: string;
}

export function createEngineeringMutationReceiptV2(
  input: Omit<EngineeringMutationReceiptV2, "schemaVersion" | "kind" | "nativeReceiptChecksum">
): EngineeringMutationReceiptV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_mutation_receipt" as const,
    transactionId: input.transactionId,
    operationId: input.operationId,
    operationKind: input.operationKind,
    contentRootBindingId: input.contentRootBindingId,
    providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
    relativeIdentity: input.relativeIdentity,
    requestChecksum: input.requestChecksum,
    observedBefore: input.observedBefore,
    observedAfter: input.observedAfter,
    stagingObjectId: input.stagingObjectId,
    recoveryObjectId: null,
    durability: ENGINEERING_MUTATION_RECEIPT_V2_DURABILITY
  };
  const receipt = {
    ...unsigned,
    nativeReceiptChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  } as const;
  const validated = validateEngineeringMutationReceiptV2(receipt);
  if (!validated.ok) throw new Error("ENGINEERING_MUTATION_RECEIPT_V2_INVALID");
  return validated.value;
}

export function validateEngineeringMutationReceiptV2(
  value: unknown
): Result<EngineeringMutationReceiptV2, UnifiedError> {
  if (!hasExactKeys(value, receiptKeys)) {
    return invalid(
      "ENGINEERING_MUTATION_RECEIPT_V2_INVALID",
      "Engineering mutation receipt is invalid."
    );
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_mutation_receipt" ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isOperationKind(value["operationKind"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isCanonicalRelativeIdentity(value["relativeIdentity"]) ||
    !isSha256(value["requestChecksum"]) ||
    !isStableId(value["stagingObjectId"]) ||
    value["recoveryObjectId"] !== null ||
    value["durability"] !== ENGINEERING_MUTATION_RECEIPT_V2_DURABILITY ||
    !isSha256(value["nativeReceiptChecksum"])
  ) {
    return invalid(
      "ENGINEERING_MUTATION_RECEIPT_V2_INVALID",
      "Engineering mutation receipt is invalid."
    );
  }

  const before = validateEngineeringMutationBeforeImageV2(value["observedBefore"]);
  const after = validateEngineeringRawByteManifestV2(value["observedAfter"]);
  if (!before.ok || !after.ok || after.value.identity.kind !== "observed_file") {
    return invalid(
      "ENGINEERING_MUTATION_RECEIPT_V2_INVALID",
      "Engineering mutation receipt is invalid."
    );
  }
  const receipt = {
    ...(value as Omit<EngineeringMutationReceiptV2, "observedBefore" | "observedAfter">),
    observedBefore: before.value,
    observedAfter: after.value
  } as EngineeringMutationReceiptV2;
  if (!observedStateMatchesReceipt(receipt)) {
    return invalid(
      "ENGINEERING_MUTATION_RECEIPT_V2_INVALID",
      "Engineering mutation receipt is invalid."
    );
  }
  const unsigned = withoutKey(
    receipt as unknown as Record<string, unknown>,
    "nativeReceiptChecksum"
  );
  if (
    receipt.nativeReceiptChecksum !==
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  ) {
    return invalid(
      "ENGINEERING_MUTATION_RECEIPT_V2_AUTHENTICATION_FAILED",
      "Engineering mutation receipt authentication failed."
    );
  }
  return ok(freeze(receipt));
}

/**
 * Verifies that a syntactically authenticated native receipt proves exactly this prepared request.
 * The outer transaction advances WAL progress only after this check succeeds.
 */
export function verifyEngineeringMutationReceiptBindingV2(
  receiptValue: unknown,
  requestValue: unknown
): Result<EngineeringMutationReceiptV2, UnifiedError> {
  const receipt = validateEngineeringMutationReceiptV2(receiptValue);
  const request = validateEngineeringFileMutationRequestV2(requestValue);
  if (!receipt.ok) return receipt;
  if (!request.ok) return request;
  const current = receipt.value;
  const expected = request.value;
  if (
    current.transactionId !== expected.transactionId ||
    current.operationId !== expected.operationId ||
    current.operationKind !== expected.operationKind ||
    current.contentRootBindingId !== expected.contentRootBindingId ||
    current.providerSemanticVersionSetChecksum !== expected.providerSemanticVersionSetChecksum ||
    current.relativeIdentity !== expected.relativeIdentity ||
    current.stagingObjectId !== expected.stagingObjectId ||
    current.requestChecksum !== engineeringFileMutationRequestChecksumV2(expected) ||
    !sameCanonicalJson(current.observedBefore, expected.before) ||
    !sameCandidateAfter(current.observedAfter, expected.candidate.manifest)
  ) {
    return invalid(
      "ENGINEERING_MUTATION_RECEIPT_V2_BINDING_MISMATCH",
      "Engineering mutation receipt is not bound to the prepared request."
    );
  }
  return ok(current);
}

export function engineeringMutationReceiptChecksumV2(
  receipt: EngineeringMutationReceiptV2
): string {
  const validated = validateEngineeringMutationReceiptV2(receipt);
  if (!validated.ok) throw new Error("ENGINEERING_MUTATION_RECEIPT_V2_INVALID");
  return validated.value.nativeReceiptChecksum;
}

/** WAL binding for B8 lifecycle receipts, whose native ABI does not expose an untrusted checksum. */
export function verifyEngineeringFileLifecycleReceiptBindingV2(
  receiptValue: unknown,
  requestValue: unknown
): Result<EngineeringFileLifecycleReceiptV2, UnifiedError> {
  const request = validateEngineeringFileLifecycleRequestV2(requestValue);
  if (!request.ok) return request;
  return validateEngineeringFileLifecycleReceiptV2(receiptValue, request.value);
}

export function engineeringFileLifecycleReceiptChecksumV2(
  receipt: EngineeringFileLifecycleReceiptV2,
  request: EngineeringFileLifecycleRequestV2
): string {
  const bound = verifyEngineeringFileLifecycleReceiptBindingV2(receipt, request);
  if (!bound.ok) throw new Error("ENGINEERING_FILE_LIFECYCLE_RECEIPT_INVALID");
  return sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(bound.value));
}

function observedStateMatchesReceipt(receipt: EngineeringMutationReceiptV2): boolean {
  const afterIdentity = receipt.observedAfter.identity;
  if (
    afterIdentity.rootBindingId !== receipt.contentRootBindingId ||
    afterIdentity.relativeIdentity !== receipt.relativeIdentity
  ) {
    return false;
  }
  if (receipt.operationKind === "replace_file") {
    return (
      receipt.observedBefore.kind === "present" &&
      receipt.observedBefore.manifest.identity.kind === "observed_file" &&
      receipt.observedBefore.manifest.identity.rootBindingId === receipt.contentRootBindingId &&
      receipt.observedBefore.manifest.identity.relativeIdentity === receipt.relativeIdentity
    );
  }
  return (
    receipt.observedBefore.kind === "absent" &&
    receipt.observedBefore.absenceProof.rootBindingId === receipt.contentRootBindingId &&
    receipt.observedBefore.absenceProof.relativeIdentity === receipt.relativeIdentity
  );
}

function sameCandidateAfter(
  observed: EngineeringRawByteManifestV2,
  candidate: EngineeringRawByteManifestV2
): boolean {
  return (
    candidate.identity.kind === "target" &&
    observed.identity.kind === "observed_file" &&
    observed.identity.rootBindingId === candidate.identity.rootBindingId &&
    observed.identity.relativeIdentity === candidate.identity.relativeIdentity &&
    observed.sha256 === candidate.sha256 &&
    observed.byteLength === candidate.byteLength &&
    observed.encoding === candidate.encoding &&
    observed.bom === candidate.bom &&
    observed.eol === candidate.eol &&
    observed.metadataChecksum === candidate.metadataChecksum
  );
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function isOperationKind(value: unknown): value is EngineeringFileMutationOperationKindV2 {
  return value === "replace_file" || value === "create_file";
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isStableOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isCanonicalRelativeIdentity(value: unknown): value is string {
  // The request/manifest validators perform the full path-policy validation.  This rejects
  // separator aliases here without duplicating policy classification in the receipt module.
  return (
    typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.includes("//")
  );
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid<T = never>(code: string, message: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message,
      suggestedAction: "Regenerate the Main-owned Engineering V2 mutation request.",
      traceId: "engineering-mutation-receipt-v2"
    })
  );
}

const receiptKeys = [
  "contentRootBindingId",
  "durability",
  "kind",
  "nativeReceiptChecksum",
  "observedAfter",
  "observedBefore",
  "operationId",
  "operationKind",
  "providerSemanticVersionSetChecksum",
  "recoveryObjectId",
  "relativeIdentity",
  "requestChecksum",
  "schemaVersion",
  "stagingObjectId",
  "transactionId"
] as const;
