import { createHash, randomBytes } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export const APPROVAL_BINDING_V2_SCHEMA_VERSION = "2.0" as const;

export type ApprovalBindingV2OperationKind =
  | "replace_file"
  | "create_file"
  | "move_file"
  | "delete_file"
  | "create_directory"
  | "chapter_replace"
  | "chapter_create"
  | "story_bible_mutation";

export type ApprovalBindingV2Source =
  "human_confirmation" | "user_preapproved_run" | "project_safe_auto_update";

export type ApprovalBindingV2WritePolicy = "write_before_confirmation" | "user_preapproved_run";

export type ApprovalBindingV2Encoding = "utf-8" | "not_applicable";
export type ApprovalBindingV2Bom = "present" | "absent" | "not_applicable";
export type ApprovalBindingV2Eol = "lf" | "crlf" | "mixed" | "not_applicable";

/**
 * Main-owned authorization evidence. `capability` is deliberately opaque and
 * must never be copied into a renderer/provider DTO. All deterministic facts
 * that are safe to display are represented by checksums or stable references.
 */
export interface ApprovalBindingV2 {
  readonly schemaVersion: typeof APPROVAL_BINDING_V2_SCHEMA_VERSION;
  readonly bindingId: string;
  readonly capability: string;
  readonly workspaceBindingId: string;
  readonly rootBindingId: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly operationKind: ApprovalBindingV2OperationKind;
  readonly selectionChecksum: string;
  readonly selectedOperationIds: readonly string[];
  readonly operationOrderChecksum: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseManifestChecksum: string;
  readonly candidateManifestChecksum: string;
  readonly encoding: ApprovalBindingV2Encoding;
  readonly bom: ApprovalBindingV2Bom;
  readonly eol: ApprovalBindingV2Eol;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly proofId: string;
  readonly proofChecksum: string;
  readonly executionWritePolicy: ApprovalBindingV2WritePolicy;
  readonly policyRevision: string;
  readonly capabilityRevision: string;
  readonly approvalSource: ApprovalBindingV2Source;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly recoveryRootBindingId?: string;
  readonly recoveryGrantRevision?: string;
  readonly recoverySideEffectChecksum?: string;
}

export type CreateApprovalBindingV2Input = Omit<
  ApprovalBindingV2,
  "schemaVersion" | "bindingId" | "capability" | "nonce"
> & {
  readonly bindingId?: string;
  readonly capability?: string;
  readonly nonce?: string;
};

export interface ApprovalBindingV2DisplayProjection {
  readonly schemaVersion: typeof APPROVAL_BINDING_V2_SCHEMA_VERSION;
  readonly bindingId: string;
  readonly workspaceBindingId: string;
  readonly rootBindingId: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly operationKind: ApprovalBindingV2OperationKind;
  readonly selectionChecksum: string;
  readonly selectedOperationIds: readonly string[];
  readonly operationOrderChecksum: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseManifestChecksum: string;
  readonly candidateManifestChecksum: string;
  readonly encoding: ApprovalBindingV2Encoding;
  readonly bom: ApprovalBindingV2Bom;
  readonly eol: ApprovalBindingV2Eol;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly proofId: string;
  readonly proofChecksum: string;
  readonly executionWritePolicy: ApprovalBindingV2WritePolicy;
  readonly policyRevision: string;
  readonly capabilityRevision: string;
  readonly approvalSource: ApprovalBindingV2Source;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly recoveryRootBindingId?: string;
  readonly recoveryGrantRevision?: string;
  readonly recoverySideEffectChecksum?: string;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,256}$/u;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{32,512}$/u;

const COMMON_KEYS = [
  "schemaVersion",
  "bindingId",
  "capability",
  "workspaceBindingId",
  "rootBindingId",
  "runId",
  "changeSetId",
  "changeSetRevision",
  "changeSetChecksum",
  "providerSemanticVersionSetChecksum",
  "operationKind",
  "selectionChecksum",
  "selectedOperationIds",
  "operationOrderChecksum",
  "sourceRef",
  "targetRef",
  "baseChecksum",
  "candidateChecksum",
  "baseManifestChecksum",
  "candidateManifestChecksum",
  "encoding",
  "bom",
  "eol",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "proofId",
  "proofChecksum",
  "executionWritePolicy",
  "policyRevision",
  "capabilityRevision",
  "approvalSource",
  "issuedAt",
  "expiresAt",
  "nonce"
] as const;

const DELETE_KEYS = [
  "recoveryRootBindingId",
  "recoveryGrantRevision",
  "recoverySideEffectChecksum"
] as const;

export function createApprovalBindingV2(input: CreateApprovalBindingV2Input): ApprovalBindingV2 {
  const value: ApprovalBindingV2 = {
    schemaVersion: APPROVAL_BINDING_V2_SCHEMA_VERSION,
    bindingId: input.bindingId ?? `binding_${randomBytes(16).toString("hex")}`,
    capability: input.capability ?? randomBytes(32).toString("base64url"),
    workspaceBindingId: input.workspaceBindingId,
    rootBindingId: input.rootBindingId,
    runId: input.runId,
    changeSetId: input.changeSetId,
    changeSetRevision: input.changeSetRevision,
    changeSetChecksum: input.changeSetChecksum,
    providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
    operationKind: input.operationKind,
    selectionChecksum: input.selectionChecksum,
    selectedOperationIds: [...input.selectedOperationIds],
    operationOrderChecksum: input.operationOrderChecksum,
    sourceRef: input.sourceRef,
    targetRef: input.targetRef,
    baseChecksum: input.baseChecksum,
    candidateChecksum: input.candidateChecksum,
    baseManifestChecksum: input.baseManifestChecksum,
    candidateManifestChecksum: input.candidateManifestChecksum,
    encoding: input.encoding,
    bom: input.bom,
    eol: input.eol,
    approvalRuleSetVersion: input.approvalRuleSetVersion,
    approvalRuleSetChecksum: input.approvalRuleSetChecksum,
    proofId: input.proofId,
    proofChecksum: input.proofChecksum,
    executionWritePolicy: input.executionWritePolicy,
    policyRevision: input.policyRevision,
    capabilityRevision: input.capabilityRevision,
    approvalSource: input.approvalSource,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce ?? randomBytes(18).toString("base64url"),
    ...(input.recoveryRootBindingId === undefined
      ? {}
      : { recoveryRootBindingId: input.recoveryRootBindingId }),
    ...(input.recoveryGrantRevision === undefined
      ? {}
      : { recoveryGrantRevision: input.recoveryGrantRevision }),
    ...(input.recoverySideEffectChecksum === undefined
      ? {}
      : { recoverySideEffectChecksum: input.recoverySideEffectChecksum })
  };
  const validation = validateApprovalBindingV2(value);
  if (!validation.ok) throw new Error(validation.error.message);
  return deepFreeze(value);
}

export function parseApprovalBindingV2(value: unknown): ApprovalBindingV2 {
  const validation = validateApprovalBindingV2(value);
  if (!validation.ok) throw new Error(validation.error.message);
  return deepFreeze(value as ApprovalBindingV2);
}

export function validateApprovalBindingV2(
  value: unknown,
  now = Date.now(),
  options: { readonly allowExpired?: boolean } = {}
): Result<ApprovalBindingV2, UnifiedError> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("APPROVAL_BINDING_V2_INVALID", "Approval Binding 2.0 must be an object.");
  }
  const record = value as Record<string, unknown>;
  const operationKind = record["operationKind"];
  const allowed = new Set<string>([
    ...COMMON_KEYS,
    ...(operationKind === "delete_file" ? DELETE_KEYS : [])
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return invalid(
      "APPROVAL_BINDING_V2_UNKNOWN_FIELD",
      "Approval Binding 2.0 contains an unknown field."
    );
  }
  if (record["schemaVersion"] !== APPROVAL_BINDING_V2_SCHEMA_VERSION) {
    return invalid(
      "APPROVAL_BINDING_V2_VERSION_UNSUPPORTED",
      "Only Approval Binding schema 2.0 can authorize a new mutation."
    );
  }
  const requiredStrings = [
    "bindingId",
    "capability",
    "workspaceBindingId",
    "rootBindingId",
    "runId",
    "changeSetId",
    "changeSetChecksum",
    "providerSemanticVersionSetChecksum",
    "selectionChecksum",
    "operationOrderChecksum",
    "sourceRef",
    "targetRef",
    "baseChecksum",
    "candidateChecksum",
    "baseManifestChecksum",
    "candidateManifestChecksum",
    "encoding",
    "bom",
    "eol",
    "approvalRuleSetVersion",
    "approvalRuleSetChecksum",
    "proofId",
    "proofChecksum",
    "policyRevision",
    "capabilityRevision",
    "issuedAt",
    "expiresAt",
    "nonce"
  ];
  if (requiredStrings.some((key) => typeof record[key] !== "string" || record[key] === "")) {
    return invalid(
      "APPROVAL_BINDING_V2_REQUIRED",
      "Approval Binding 2.0 is missing a required field."
    );
  }
  for (const key of [
    "changeSetChecksum",
    "providerSemanticVersionSetChecksum",
    "selectionChecksum",
    "operationOrderChecksum",
    "baseChecksum",
    "candidateChecksum",
    "baseManifestChecksum",
    "candidateManifestChecksum",
    "approvalRuleSetChecksum",
    "proofChecksum"
  ]) {
    if (record[key] !== "not_applicable" && !HASH_PATTERN.test(record[key] as string)) {
      return invalid("APPROVAL_BINDING_V2_CHECKSUM_INVALID", `Invalid checksum field: ${key}.`);
    }
  }
  if (
    !ID_PATTERN.test(record["bindingId"] as string) ||
    !CAPABILITY_PATTERN.test(record["capability"] as string)
  ) {
    return invalid(
      "APPROVAL_BINDING_V2_OPAQUE_ID_INVALID",
      "Binding id or capability is not a valid opaque identifier."
    );
  }
  if (!NONCE_PATTERN.test(record["nonce"] as string)) {
    return invalid("APPROVAL_BINDING_V2_NONCE_INVALID", "Approval Binding nonce is invalid.");
  }
  if (
    !Number.isSafeInteger(record["changeSetRevision"]) ||
    (record["changeSetRevision"] as number) < 1
  ) {
    return invalid(
      "APPROVAL_BINDING_V2_REVISION_INVALID",
      "Change Set revision must be a positive integer."
    );
  }
  if (
    !Array.isArray(record["selectedOperationIds"]) ||
    (record["selectedOperationIds"] as unknown[]).some(
      (id) => typeof id !== "string" || !OPERATION_ID_PATTERN.test(id)
    )
  ) {
    return invalid(
      "APPROVAL_BINDING_V2_SELECTION_INVALID",
      "Selected operation ids must be a stable ordered list."
    );
  }
  if ((record["selectedOperationIds"] as unknown[]).length === 0) {
    return invalid(
      "APPROVAL_BINDING_V2_SELECTION_EMPTY",
      "A mutation authorization must bind at least one selected operation."
    );
  }
  if (
    !isOperationKind(operationKind) ||
    !isSource(record["approvalSource"]) ||
    !isPolicy(record["executionWritePolicy"])
  ) {
    return invalid(
      "APPROVAL_BINDING_V2_ENUM_INVALID",
      "Approval Binding contains an unsupported operation, source, or policy."
    );
  }
  if (!isEncoding(record["encoding"]) || !isBom(record["bom"]) || !isEol(record["eol"])) {
    return invalid(
      "APPROVAL_BINDING_V2_ENCODING_INVALID",
      "Encoding, BOM, or EOL binding is invalid."
    );
  }
  if (
    record["approvalSource"] === "user_preapproved_run" &&
    record["executionWritePolicy"] !== "user_preapproved_run"
  ) {
    return invalid(
      "APPROVAL_BINDING_V2_POLICY_MISMATCH",
      "Preapproval source requires the limited run policy."
    );
  }
  const issued = Date.parse(record["issuedAt"] as string);
  const expires = Date.parse(record["expiresAt"] as string);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) {
    return invalid(
      "APPROVAL_BINDING_V2_EXPIRY_INVALID",
      "Approval Binding expiry window is invalid."
    );
  }
  if (!options.allowExpired && expires <= now) {
    return invalid("APPROVAL_BINDING_V2_EXPIRED", "Approval Binding has expired.");
  }
  const deleteFields = DELETE_KEYS.map((key) => record[key]);
  if (operationKind === "delete_file") {
    if (
      deleteFields.some((field) => typeof field !== "string" || field === "") ||
      !HASH_PATTERN.test(record["recoverySideEffectChecksum"] as string)
    ) {
      return invalid(
        "APPROVAL_BINDING_V2_RECOVERY_REQUIRED",
        "Delete authorization must bind its recovery root, grant, and side effect."
      );
    }
  } else if (deleteFields.some((field) => field !== undefined)) {
    return invalid(
      "APPROVAL_BINDING_V2_RECOVERY_FORBIDDEN",
      "Recovery binding fields are only valid for delete authorization."
    );
  }
  return ok(value as ApprovalBindingV2);
}

export function serializeApprovalBindingV2(binding: ApprovalBindingV2): string {
  parseApprovalBindingV2(binding);
  return canonicalJson(binding);
}

export function approvalBindingV2Checksum(binding: ApprovalBindingV2): string {
  return createHash("sha256").update(serializeApprovalBindingV2(binding), "utf8").digest("hex");
}

/** Renderer-safe projection. The opaque capability and nonce are intentionally absent. */
export function projectApprovalBindingV2ForDisplay(
  binding: ApprovalBindingV2
): ApprovalBindingV2DisplayProjection {
  parseApprovalBindingV2(binding);
  const display = Object.fromEntries(
    Object.entries(binding).filter(([key]) => key !== "capability" && key !== "nonce")
  ) as unknown as ApprovalBindingV2DisplayProjection;
  return deepFreeze(display);
}

export function isApprovalBindingV2(value: unknown): value is ApprovalBindingV2 {
  return validateApprovalBindingV2(value).ok;
}

function isOperationKind(value: unknown): value is ApprovalBindingV2OperationKind {
  return [
    "replace_file",
    "create_file",
    "move_file",
    "delete_file",
    "create_directory",
    "chapter_replace",
    "chapter_create",
    "story_bible_mutation"
  ].includes(value as ApprovalBindingV2OperationKind);
}

function isSource(value: unknown): value is ApprovalBindingV2Source {
  return (
    value === "human_confirmation" ||
    value === "user_preapproved_run" ||
    value === "project_safe_auto_update"
  );
}

function isPolicy(value: unknown): value is ApprovalBindingV2WritePolicy {
  return value === "write_before_confirmation" || value === "user_preapproved_run";
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

function invalid(code: string, message: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction: "Regenerate the preview and obtain a fresh Main-owned approval.",
      traceId: "approval-binding-v2"
    })
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
