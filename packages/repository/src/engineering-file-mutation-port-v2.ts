import { createHash } from "node:crypto";

import { classifyEngineeringPath, type EngineeringPathPolicy } from "@novel-studio/agent-engine";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError, validationError } from "./errors.js";
import type { EngineeringMutationBlobReferenceV2 } from "./engineering-mutation-blob-store.js";
import {
  validateEngineeringMutationReceiptV2,
  verifyEngineeringMutationReceiptBindingV2,
  type EngineeringMutationReceiptV2
} from "./engineering-mutation-receipt.js";

/**
 * Engineering mutations deliberately have their own durable protocol.  This version does not
 * normalize or accept legacy string-content mutation requests.
 */
export const ENGINEERING_MUTATION_V2_SCHEMA_VERSION = "2.0" as const;
/**
 * B8 lifecycle requests have a distinct native ABI.  They deliberately retain their own fixed
 * schema marker so a raw-byte V2 request can never be interpreted as a move/delete/mkdir request.
 * The containing Engineering V2 WAL remains schema 2.0.
 */
export const ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION = "3.0" as const;
export const ENGINEERING_MUTATION_V2_MAX_RAW_BYTES = 5 * 1024 * 1024;

export type EngineeringRawByteEncodingV2 = "utf-8";
export type EngineeringRawByteBomV2 = "none" | "utf-8";
export type EngineeringRawByteEolV2 = "none" | "lf" | "crlf" | "mixed";
export type EngineeringFileMutationOperationKindV2 = "replace_file" | "create_file";

/** B8 handle-relative lifecycle operations. These are intentionally separate from raw-byte V2. */
export type EngineeringFileLifecycleOperationKindV2 =
  "move_file" | "delete_file" | "create_directory";

export interface EngineeringFileLifecycleRequestV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION;
  readonly operationKind: EngineeringFileLifecycleOperationKindV2;
  readonly transactionId: string;
  readonly operationId: string;
  readonly contentRootBindingId: string;
  readonly relativeSource: string;
  readonly relativeTarget: string;
  readonly sourceFileIdentity: string;
  readonly sourceSha256: string;
  readonly targetProof: "absent" | "same_object_case_only";
  readonly recoveryRootBindingId: string;
  readonly recoveryGrantRevision: string;
  readonly recoverySideEffectChecksum: string;
  readonly recoveryObjectId: string;
  readonly stagingObjectId: string;
  readonly expectedState: "wal_prepared";
}

export interface EngineeringFileLifecycleReceiptV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION;
  readonly kind: "engineering_file_lifecycle_receipt";
  readonly operationKind: EngineeringFileLifecycleOperationKindV2;
  readonly transactionId: string;
  readonly operationId: string;
  readonly contentRootBindingId: string;
  readonly relativeSource: string;
  readonly relativeTarget: string;
  readonly state: "committed" | "quarantined";
  readonly recoveryObjectId: string;
  readonly durability: "data_and_directory_flushed";
}

/** Restore is Main-only recovery work, not an Agent lifecycle operation. */
export interface EngineeringFileRestoreRequestV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION;
  readonly operationKind: "restore_file";
  readonly transactionId: string;
  readonly operationId: string;
  readonly contentRootBindingId: string;
  readonly relativeSource: "";
  readonly relativeTarget: string;
  readonly sourceFileIdentity: string;
  readonly sourceSha256: string;
  readonly targetProof: "absent";
  readonly recoveryRootBindingId: string;
  readonly recoveryGrantRevision: string;
  readonly recoverySideEffectChecksum: string;
  readonly recoveryObjectId: string;
  readonly stagingObjectId: string;
  readonly expectedState: "wal_prepared";
}

export interface EngineeringFileRestoreReceiptV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION;
  readonly kind: "engineering_file_lifecycle_receipt";
  readonly operationKind: "restore_file";
  readonly transactionId: string;
  readonly operationId: string;
  readonly contentRootBindingId: string;
  readonly relativeSource: "";
  readonly relativeTarget: string;
  readonly state: "restored";
  readonly recoveryObjectId: string;
  readonly durability: "data_and_directory_flushed";
}

export interface EngineeringLifecycleRecoveryRootBindingV2 {
  readonly recoveryRootBindingId: string;
  readonly recoveryRootId: string | bigint;
  readonly grantRevision: string;
  readonly sideEffectChecksum: string;
}

/**
 * A purge can only be requested after Main has durably decided retention.  The decision record
 * is authenticated by `authenticateRecoveryOperation` before the native unlink is reached.
 */
export interface EngineeringQuarantinePurgeInputV2 {
  readonly recoveryBinding: EngineeringLifecycleRecoveryRootBindingV2;
  readonly retentionDecision: {
    readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
    readonly kind: "engineering_quarantine_retention_decision";
    readonly contentRootBindingId: string;
    readonly recoveryRootBindingId: string;
    readonly recoveryGrantRevision: string;
    readonly recoverySideEffectChecksum: string;
    readonly recoveryObjectId: string;
    readonly state: "purge_authorized";
    readonly decisionChecksum: string;
  };
}

/**
 * An observed identity names the native object that was read.  A target identity intentionally
 * does not pretend that a future atomic replace/create has already allocated a native object.
 */
export type EngineeringRawByteIdentityV2 =
  | Readonly<{
      readonly kind: "observed_file";
      readonly rootBindingId: string;
      readonly relativeIdentity: string;
      readonly fileIdentity: string;
    }>
  | Readonly<{
      readonly kind: "target";
      readonly rootBindingId: string;
      readonly relativeIdentity: string;
      readonly fileIdentity: null;
    }>;

export interface EngineeringRawByteManifestV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly identity: EngineeringRawByteIdentityV2;
  readonly sha256: string;
  readonly byteLength: number;
  readonly encoding: EngineeringRawByteEncodingV2;
  readonly bom: EngineeringRawByteBomV2;
  readonly eol: EngineeringRawByteEolV2;
  /** Main/native-qualified metadata is represented only by an immutable checksum. */
  readonly metadataChecksum: string;
}

export interface EngineeringRawByteInspectionV2 {
  readonly sha256: string;
  readonly byteLength: number;
  readonly encoding: EngineeringRawByteEncodingV2;
  readonly bom: EngineeringRawByteBomV2;
  readonly eol: EngineeringRawByteEolV2;
}

/**
 * A fresh proposal-time observation made through the same Main-owned native root handle that
 * later performs reconciliation and mutation. `rootId` is deliberately not part of this
 * projection; it is checked while decoding the native response and remains Main-only.
 */
export type EngineeringFileMutationProposalSnapshotV2 =
  | Readonly<{
      readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
      readonly kind: "engineering_file_mutation_target_snapshot";
      readonly rootBindingId: string;
      readonly relativeIdentity: string;
      readonly parentDirectoryIdentity: string;
      readonly state: "present";
      readonly bytes: Uint8Array;
      readonly manifest: EngineeringRawByteManifestV2;
    }>
  | Readonly<{
      readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
      readonly kind: "engineering_file_mutation_target_snapshot";
      readonly rootBindingId: string;
      readonly relativeIdentity: string;
      readonly parentDirectoryIdentity: string;
      readonly state: "absent";
      readonly bytes: null;
      readonly manifest: null;
    }>;

export interface EngineeringFileMutationProposalSnapshotInputV2 {
  readonly relativeIdentity: string;
}

export interface EngineeringCreateAbsenceObservationInputV2 {
  readonly relativeIdentity: string;
  readonly observedAt: string;
}

/** A create-only proof is distinct from a missing/empty file manifest. */
export interface EngineeringAbsenceProofV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "absence_proof";
  readonly rootBindingId: string;
  readonly relativeIdentity: string;
  readonly parentDirectoryIdentity: string;
  readonly observedAt: string;
  readonly absenceProofChecksum: string;
}

export type EngineeringMutationBeforeImageV2 =
  | Readonly<{
      readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
      readonly kind: "present";
      readonly manifest: EngineeringRawByteManifestV2;
      readonly blob: EngineeringMutationBlobReferenceV2;
    }>
  | Readonly<{
      readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
      readonly kind: "absent";
      readonly absenceProof: EngineeringAbsenceProofV2;
    }>;

export interface EngineeringMutationCandidateImageV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly manifest: EngineeringRawByteManifestV2;
  readonly blob: EngineeringMutationBlobReferenceV2;
}

/**
 * The only raw-byte request accepted by the B7 repository seam.  There are intentionally no
 * move/delete/create-directory or recovery-root fields in this exact schema.
 */
export interface EngineeringFileMutationRequestV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly operationKind: EngineeringFileMutationOperationKindV2;
  readonly contentRootBindingId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly relativeIdentity: string;
  readonly before: EngineeringMutationBeforeImageV2;
  readonly candidate: EngineeringMutationCandidateImageV2;
  /** Allocated before prepare; native code must never invent it after a mutation. */
  readonly stagingObjectId: string;
}

/** Main-only native-root binding.  It is never serialized into a provider-visible request. */
export interface EngineeringFileMutationRootBindingV2 {
  readonly contentRootBindingId: string;
  readonly rootId: string | bigint;
}

/** Raw bytes are supplied by Main only after a verified immutable-blob re-read. */
export interface EngineeringFileMutationApplyInputV2 {
  readonly request: EngineeringFileMutationRequestV2;
  readonly beforeBytes: Uint8Array | null;
  readonly candidateBytes: Uint8Array;
}

export type EngineeringMutationOperationStateV2 =
  | Readonly<{
      readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
      readonly kind: "engineering_mutation_operation_state";
      readonly state: "before" | "neither" | "unknown";
      readonly requestChecksum: string;
      readonly receipt: null;
    }>
  | Readonly<{
      readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
      readonly kind: "engineering_mutation_operation_state";
      readonly state: "after";
      readonly requestChecksum: string;
      readonly receipt: EngineeringMutationReceiptV2;
    }>;

/**
 * This hook is deliberately Main-only.  Checksums make evidence tamper-evident, not authenticated;
 * production wiring must verify the native root-session evidence before it is accepted.
 */
export type EngineeringNativeEvidenceAuthenticatorV2 = (input: {
  readonly rootBinding: EngineeringFileMutationRootBindingV2;
  readonly request: EngineeringFileMutationRequestV2;
  readonly kind: "receipt" | "operation_state";
  readonly value: unknown;
}) => Result<void, UnifiedError>;

/**
 * Proposal evidence is independently authenticated before it can be used to construct a
 * Change Set or an approval binding. This callback is Main-only: it receives no pathname and
 * must never be exposed through a provider or Renderer projection.
 */
export type EngineeringNativeProposalEvidenceAuthenticatorV2 = (input: {
  readonly rootBinding: EngineeringFileMutationRootBindingV2;
  readonly kind: "snapshot" | "absence_proof";
  readonly value: EngineeringFileMutationProposalSnapshotV2 | EngineeringAbsenceProofV2;
}) => Result<void, UnifiedError>;

/** Main verifies recovery-root authority and durable recovery/retention evidence here. */
export type EngineeringRecoveryOperationAuthenticatorV2 = (input: {
  readonly kind: "restore" | "purge";
  readonly rootBinding: EngineeringFileMutationRootBindingV2;
  readonly recoveryBinding: EngineeringLifecycleRecoveryRootBindingV2;
  readonly request?: EngineeringFileRestoreRequestV2;
  readonly retentionDecision?: EngineeringQuarantinePurgeInputV2["retentionDecision"];
}) => Result<void, UnifiedError>;

/** The one native mutation entry point added to the B6 addon source stream. */
export interface EngineeringFileMutationNativeAddonV2 {
  applyEngineeringFileMutationV2(
    rootId: string | bigint,
    request: EngineeringFileMutationRequestV2,
    beforeBytesOrNull: Uint8Array | null,
    candidateBytes: Uint8Array
  ): unknown;
  inspectEngineeringFileMutationTargetV2(
    rootId: string | bigint,
    request: EngineeringFileMutationRequestV2,
    beforeBytesOrNull: Uint8Array | null,
    candidateBytes: Uint8Array
  ): unknown;
}

export interface EngineeringFileLifecycleNativeAddonV2 {
  moveEngineeringPathV2(
    rootId: string | bigint,
    request: EngineeringFileLifecycleRequestV2
  ): unknown;
  quarantineEngineeringFileV2(
    rootId: string | bigint,
    recoveryRootId: string | bigint,
    request: EngineeringFileLifecycleRequestV2
  ): unknown;
  restoreEngineeringFileV2(
    rootId: string | bigint,
    recoveryRootId: string | bigint,
    request: EngineeringFileRestoreRequestV2
  ): unknown;
  purgeEngineeringQuarantineObjectV2(
    recoveryRootId: string | bigint,
    recoveryObjectId: string
  ): unknown;
  createEngineeringDirectoryV2(
    rootId: string | bigint,
    request: EngineeringFileLifecycleRequestV2
  ): unknown;
}

/**
 * The proposal-time subset of the same native addon/root-handle ABI. There is intentionally no
 * pathname-backed alternative for either operation.
 */
export interface EngineeringFileMutationProposalNativeAddonV2 {
  inspectEngineeringFileSnapshotV2(rootId: string | bigint, relativeIdentity: string): unknown;
  observeCreateAbsenceV2(
    rootId: string | bigint,
    rootBindingId: string,
    relativeIdentity: string,
    observedAt: string
  ): unknown;
}

export interface EngineeringFileMutationProposalPortV2 {
  inspectProposalSnapshot(
    input: unknown
  ): Promise<Result<EngineeringFileMutationProposalSnapshotV2, UnifiedError>>;
  observeCreateAbsence(input: unknown): Promise<Result<EngineeringAbsenceProofV2, UnifiedError>>;
}

export interface EngineeringFileMutationPortV2 {
  /**
   * Optional only to preserve the existing transaction seam for non-native test/recovery
   * implementations. The port created below always supplies both proposal-time methods.
   */
  readonly inspectProposalSnapshot?: EngineeringFileMutationProposalPortV2["inspectProposalSnapshot"];
  readonly observeCreateAbsence?: EngineeringFileMutationProposalPortV2["observeCreateAbsence"];
  apply(input: unknown): Promise<Result<EngineeringMutationReceiptV2, UnifiedError>>;
  reconcile(input: unknown): Promise<Result<EngineeringMutationOperationStateV2, UnifiedError>>;
  readonly move?: (
    input: unknown
  ) => Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>>;
  readonly quarantine?: (
    input: unknown
  ) => Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>>;
  readonly createDirectory?: (
    input: unknown
  ) => Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>>;
  /** Main-only recovery action. It is intentionally not part of the Provider lifecycle surface. */
  readonly restore?: (
    input: unknown
  ) => Promise<Result<EngineeringFileRestoreReceiptV2, UnifiedError>>;
  /** Main-only permanent deletion after a local retention decision. */
  readonly purge?: (input: unknown) => Promise<Result<void, UnifiedError>>;
}

export type EngineeringQualifiedFileMutationPortV2 = Omit<
  EngineeringFileMutationPortV2,
  keyof EngineeringFileMutationProposalPortV2 | "move" | "quarantine" | "createDirectory"
> &
  EngineeringFileMutationProposalPortV2 & {
    move(input: unknown): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>>;
    quarantine(input: unknown): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>>;
    createDirectory(
      input: unknown
    ): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>>;
  };

export interface EngineeringFileMutationPortV2Options {
  readonly addon: unknown;
  /** Opaque native session/root identity issued and retained by Main. */
  readonly rootBinding?: EngineeringFileMutationRootBindingV2;
  /** Required before a native result is treated as qualified evidence. */
  readonly authenticateNativeEvidence?: EngineeringNativeEvidenceAuthenticatorV2;
  /** Required before a native proposal snapshot or absence proof is treated as qualified. */
  readonly authenticateNativeProposalEvidence?: EngineeringNativeProposalEvidenceAuthenticatorV2;
  /** Required before a restore or permanent quarantine purge can invoke native code. */
  readonly authenticateRecoveryOperation?: EngineeringRecoveryOperationAuthenticatorV2;
  readonly pathPolicy?: EngineeringPathPolicy;
  readonly traceId?: string;
}

/**
 * Thin TypeScript-facing facade over the single qualified native addon.  It deliberately has no
 * pathname fallback: a missing/partial addon leaves engineering mutation unavailable.
 */
export function createEngineeringFileMutationPortV2(
  options: EngineeringFileMutationPortV2Options
): EngineeringQualifiedFileMutationPortV2 {
  const addon = parseNativeAddon(options.addon);
  const proposalAddon = parseProposalNativeAddon(options.addon);
  const lifecycleAddon = parseLifecycleNativeAddon(options.addon);
  const traceId = options.traceId ?? "engineering-file-mutation-port-v2";

  const lifecycle = {
    async move(input: unknown): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>> {
      const request = validateEngineeringFileLifecycleRequestV2(
        input,
        "move_file",
        options.pathPolicy
      );
      if (!request.ok) return request;
      if (lifecycleAddon === undefined || options.rootBinding === undefined)
        return unavailable(traceId);
      if (request.value.contentRootBindingId !== options.rootBinding.contentRootBindingId)
        return unavailable(traceId);
      let raw: unknown;
      try {
        raw = await lifecycleAddon.moveEngineeringPathV2(options.rootBinding.rootId, request.value);
      } catch (cause) {
        return lifecycleNativeFailure(cause, traceId);
      }
      return validateEngineeringFileLifecycleReceiptV2(raw, request.value);
    },
    async quarantine(
      input: unknown
    ): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>> {
      if (!hasExactKeys(input, lifecycleQuarantineInputKeys)) return lifecycleInvalid(traceId);
      const request = validateEngineeringFileLifecycleRequestV2(
        input["request"],
        "delete_file",
        options.pathPolicy
      );
      if (!request.ok) return request;
      const recovery = parseLifecycleRecoveryBinding(input["recoveryBinding"]);
      if (
        recovery === undefined ||
        lifecycleAddon === undefined ||
        options.rootBinding === undefined
      )
        return unavailable(traceId);
      if (
        request.value.contentRootBindingId !== options.rootBinding.contentRootBindingId ||
        request.value.recoveryRootBindingId !== recovery.recoveryRootBindingId ||
        request.value.recoveryGrantRevision !== recovery.grantRevision ||
        request.value.recoverySideEffectChecksum !== recovery.sideEffectChecksum
      )
        return lifecycleInvalid(traceId);
      let raw: unknown;
      try {
        raw = await lifecycleAddon.quarantineEngineeringFileV2(
          options.rootBinding.rootId,
          recovery.recoveryRootId,
          request.value
        );
      } catch (cause) {
        return lifecycleNativeFailure(cause, traceId);
      }
      return validateEngineeringFileLifecycleReceiptV2(raw, request.value);
    },
    async createDirectory(
      input: unknown
    ): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>> {
      const request = validateEngineeringFileLifecycleRequestV2(
        input,
        "create_directory",
        options.pathPolicy
      );
      if (!request.ok) return request;
      if (
        lifecycleAddon === undefined ||
        options.rootBinding === undefined ||
        request.value.contentRootBindingId !== options.rootBinding.contentRootBindingId
      )
        return unavailable(traceId);
      let raw: unknown;
      try {
        raw = await lifecycleAddon.createEngineeringDirectoryV2(
          options.rootBinding.rootId,
          request.value
        );
      } catch (cause) {
        return lifecycleNativeFailure(cause, traceId);
      }
      return validateEngineeringFileLifecycleReceiptV2(raw, request.value);
    },
    async restore(input: unknown): Promise<Result<EngineeringFileRestoreReceiptV2, UnifiedError>> {
      if (!hasExactKeys(input, lifecycleRestoreInputKeys)) return lifecycleInvalid(traceId);
      const request = validateEngineeringFileRestoreRequestV2(input["request"], options.pathPolicy);
      if (!request.ok) return request;
      const recovery = parseLifecycleRecoveryBinding(input["recoveryBinding"]);
      if (
        recovery === undefined ||
        lifecycleAddon === undefined ||
        options.rootBinding === undefined ||
        options.authenticateRecoveryOperation === undefined
      )
        return unavailable(traceId);
      if (
        request.value.contentRootBindingId !== options.rootBinding.contentRootBindingId ||
        request.value.recoveryRootBindingId !== recovery.recoveryRootBindingId ||
        request.value.recoveryGrantRevision !== recovery.grantRevision ||
        request.value.recoverySideEffectChecksum !== recovery.sideEffectChecksum
      )
        return lifecycleInvalid(traceId);
      const authenticated = authenticateRecoveryOperation(
        options.authenticateRecoveryOperation,
        {
          kind: "restore",
          rootBinding: options.rootBinding,
          recoveryBinding: recovery,
          request: request.value
        },
        traceId
      );
      if (!authenticated.ok) return authenticated;
      let raw: unknown;
      try {
        raw = await lifecycleAddon.restoreEngineeringFileV2(
          options.rootBinding.rootId,
          recovery.recoveryRootId,
          request.value
        );
      } catch (cause) {
        return lifecycleNativeFailure(cause, traceId);
      }
      return validateEngineeringFileRestoreReceiptV2(raw, request.value);
    },
    async purge(input: unknown): Promise<Result<void, UnifiedError>> {
      const parsed = validateEngineeringQuarantinePurgeInputV2(input);
      if (!parsed.ok) return parsed;
      const recovery = parseLifecycleRecoveryBinding(parsed.value.recoveryBinding);
      if (
        recovery === undefined ||
        lifecycleAddon === undefined ||
        options.rootBinding === undefined ||
        options.authenticateRecoveryOperation === undefined ||
        parsed.value.retentionDecision.contentRootBindingId !==
          options.rootBinding.contentRootBindingId ||
        parsed.value.retentionDecision.recoveryRootBindingId !== recovery.recoveryRootBindingId ||
        parsed.value.retentionDecision.recoveryGrantRevision !== recovery.grantRevision ||
        parsed.value.retentionDecision.recoverySideEffectChecksum !== recovery.sideEffectChecksum
      )
        return lifecycleInvalid(traceId);
      const authenticated = authenticateRecoveryOperation(
        options.authenticateRecoveryOperation,
        {
          kind: "purge",
          rootBinding: options.rootBinding,
          recoveryBinding: recovery,
          retentionDecision: parsed.value.retentionDecision
        },
        traceId
      );
      if (!authenticated.ok) return authenticated;
      try {
        await lifecycleAddon.purgeEngineeringQuarantineObjectV2(
          recovery.recoveryRootId,
          parsed.value.retentionDecision.recoveryObjectId
        );
      } catch (cause) {
        return lifecycleNativeFailure(cause, traceId);
      }
      return ok(undefined);
    }
  };

  return Object.freeze({
    async inspectProposalSnapshot(
      input: unknown
    ): Promise<Result<EngineeringFileMutationProposalSnapshotV2, UnifiedError>> {
      const parsed = validateEngineeringFileMutationProposalSnapshotInputV2(
        input,
        options.pathPolicy
      );
      if (!parsed.ok) return parsed;
      if (options.rootBinding === undefined || !isRootBinding(options.rootBinding)) {
        return unavailable(traceId);
      }
      return inspectProposalSnapshotThroughNativeV2({
        addon: proposalAddon,
        rootBinding: options.rootBinding,
        authenticate: options.authenticateNativeProposalEvidence,
        relativeIdentity: parsed.value.relativeIdentity,
        traceId
      });
    },

    async observeCreateAbsence(
      input: unknown
    ): Promise<Result<EngineeringAbsenceProofV2, UnifiedError>> {
      const parsed = validateEngineeringCreateAbsenceObservationInputV2(input, options.pathPolicy);
      if (!parsed.ok) return parsed;
      if (options.rootBinding === undefined || !isRootBinding(options.rootBinding)) {
        return unavailable(traceId);
      }

      const snapshot = await inspectProposalSnapshotThroughNativeV2({
        addon: proposalAddon,
        rootBinding: options.rootBinding,
        authenticate: options.authenticateNativeProposalEvidence,
        relativeIdentity: parsed.value.relativeIdentity,
        traceId
      });
      if (!snapshot.ok) return snapshot;
      if (snapshot.value.state !== "absent") return createTargetPresent(traceId);
      if (proposalAddon === undefined) return unavailable(traceId);
      if (options.authenticateNativeProposalEvidence === undefined) {
        return evidenceUnavailable(traceId);
      }

      let rawProof: unknown;
      try {
        rawProof = await proposalAddon.observeCreateAbsenceV2(
          options.rootBinding.rootId,
          options.rootBinding.contentRootBindingId,
          parsed.value.relativeIdentity,
          parsed.value.observedAt
        );
      } catch (cause) {
        return proposalNativeFailure(cause, traceId);
      }

      const proof = validateEngineeringAbsenceProofV2(rawProof);
      if (
        !proof.ok ||
        proof.value.rootBindingId !== snapshot.value.rootBindingId ||
        proof.value.relativeIdentity !== snapshot.value.relativeIdentity ||
        proof.value.parentDirectoryIdentity !== snapshot.value.parentDirectoryIdentity ||
        proof.value.observedAt !== parsed.value.observedAt
      ) {
        return nativeProposalProtocolFailure(traceId);
      }
      const authenticated = authenticateProposalEvidence(
        options.authenticateNativeProposalEvidence,
        options.rootBinding,
        "absence_proof",
        proof.value,
        traceId
      );
      return authenticated.ok ? ok(proof.value) : authenticated;
    },

    async apply(input: unknown): Promise<Result<EngineeringMutationReceiptV2, UnifiedError>> {
      const parsed = validateEngineeringFileMutationApplyInputV2(
        input,
        options.rootBinding,
        options.pathPolicy
      );
      if (!parsed.ok) return parsed;
      if (addon === undefined || options.rootBinding === undefined) return unavailable(traceId);
      if (options.authenticateNativeEvidence === undefined) return evidenceUnavailable(traceId);

      let rawReceipt: unknown;
      try {
        rawReceipt = await addon.applyEngineeringFileMutationV2(
          options.rootBinding.rootId,
          parsed.value.request,
          parsed.value.beforeBytes,
          parsed.value.candidateBytes
        );
      } catch (cause) {
        return nativeFailure(cause, traceId);
      }

      const receipt = validateEngineeringMutationReceiptV2(rawReceipt);
      if (!receipt.ok) return nativeProtocolFailure(traceId);
      const bound = verifyEngineeringMutationReceiptBindingV2(receipt.value, parsed.value.request);
      if (!bound.ok) return nativeProtocolFailure(traceId);
      const authenticated = authenticateEvidence(
        options.authenticateNativeEvidence,
        options.rootBinding,
        parsed.value.request,
        "receipt",
        receipt.value,
        traceId
      );
      return authenticated.ok ? ok(receipt.value) : authenticated;
    },

    async reconcile(
      input: unknown
    ): Promise<Result<EngineeringMutationOperationStateV2, UnifiedError>> {
      const parsed = validateEngineeringFileMutationApplyInputV2(
        input,
        options.rootBinding,
        options.pathPolicy
      );
      if (!parsed.ok) return parsed;
      if (addon === undefined || options.rootBinding === undefined) return unavailable(traceId);
      if (options.authenticateNativeEvidence === undefined) return evidenceUnavailable(traceId);

      let rawState: unknown;
      try {
        rawState = await addon.inspectEngineeringFileMutationTargetV2(
          options.rootBinding.rootId,
          parsed.value.request,
          parsed.value.beforeBytes,
          parsed.value.candidateBytes
        );
      } catch (cause) {
        return nativeFailure(cause, traceId);
      }
      const state = validateEngineeringMutationOperationStateV2(rawState, parsed.value.request);
      if (!state.ok) return nativeProtocolFailure(traceId);
      const authenticated = authenticateEvidence(
        options.authenticateNativeEvidence,
        options.rootBinding,
        parsed.value.request,
        "operation_state",
        state.value,
        traceId
      );
      if (!authenticated.ok) return authenticated;
      if (state.value.state !== "after") return state;
      const receiptAuthenticated = authenticateEvidence(
        options.authenticateNativeEvidence,
        options.rootBinding,
        parsed.value.request,
        "receipt",
        state.value.receipt,
        traceId
      );
      return receiptAuthenticated.ok ? state : receiptAuthenticated;
    },
    ...lifecycle
  });
}

export function validateEngineeringFileLifecycleRequestV2(
  value: unknown,
  expectedKind?: EngineeringFileLifecycleOperationKindV2,
  pathPolicy?: EngineeringPathPolicy
): Result<EngineeringFileLifecycleRequestV2, UnifiedError> {
  if (!hasExactKeys(value, lifecycleRequestKeys)) return lifecycleInvalid();
  const source = value["relativeSource"];
  const target = value["relativeTarget"];
  const kind = value["operationKind"];
  if (
    value["schemaVersion"] !== ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION ||
    !isLifecycleKind(kind) ||
    (expectedKind !== undefined && kind !== expectedKind) ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["stagingObjectId"]) ||
    value["expectedState"] !== "wal_prepared" ||
    !isSha256(value["sourceSha256"]) ||
    (kind !== "create_directory" && !isStableId(value["sourceFileIdentity"])) ||
    (value["targetProof"] !== "absent" && value["targetProof"] !== "same_object_case_only") ||
    (kind === "create_directory"
      ? source !== "" || !isCanonicalOrdinaryRelativeIdentity(target, pathPolicy)
      : !isCanonicalOrdinaryRelativeIdentity(source, pathPolicy)) ||
    (kind === "delete_file"
      ? target !== ""
      : !isCanonicalOrdinaryRelativeIdentity(target, pathPolicy))
  )
    return lifecycleInvalid();
  if (
    kind === "delete_file" &&
    (target !== "" ||
      value["targetProof"] !== "absent" ||
      !isStableId(value["recoveryRootBindingId"]) ||
      !isStableId(value["recoveryGrantRevision"]) ||
      !isSha256(value["recoverySideEffectChecksum"]) ||
      !isStableId(value["recoveryObjectId"]))
  )
    return lifecycleInvalid();
  if (
    kind === "create_directory" &&
    (value["targetProof"] !== "absent" ||
      value["sourceSha256"] !== "0".repeat(64) ||
      value["sourceFileIdentity"] !== "")
  )
    return lifecycleInvalid();
  if (kind === "move_file" && source === target) return lifecycleInvalid();
  if (
    kind === "move_file" &&
    value["targetProof"] === "same_object_case_only" &&
    !isCaseOnlyMove(source as string, target as string)
  )
    return lifecycleInvalid();
  return ok(freeze(value as unknown as EngineeringFileLifecycleRequestV2));
}

export function validateEngineeringFileLifecycleReceiptV2(
  value: unknown,
  request?: EngineeringFileLifecycleRequestV2
): Result<EngineeringFileLifecycleReceiptV2, UnifiedError> {
  if (
    !hasExactKeys(value, lifecycleReceiptKeys) ||
    value["schemaVersion"] !== ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_file_lifecycle_receipt" ||
    !isLifecycleKind(value["operationKind"]) ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    (!isCanonicalOrdinaryRelativeIdentity(value["relativeSource"]) &&
      !(value["operationKind"] === "create_directory" && value["relativeSource"] === "")) ||
    (!isCanonicalOrdinaryRelativeIdentity(value["relativeTarget"]) &&
      value["relativeTarget"] !== "") ||
    !(value["recoveryObjectId"] === "" || isStableId(value["recoveryObjectId"])) ||
    value["durability"] !== "data_and_directory_flushed" ||
    !["committed", "quarantined"].includes(value["state"] as string)
  )
    return lifecycleInvalid();
  if (
    (value["operationKind"] === "delete_file" &&
      (value["state"] !== "quarantined" || !isStableId(value["recoveryObjectId"]))) ||
    (value["operationKind"] !== "delete_file" &&
      (value["state"] !== "committed" || value["recoveryObjectId"] !== ""))
  )
    return lifecycleInvalid();
  if (
    request !== undefined &&
    (value["operationKind"] !== request.operationKind ||
      value["transactionId"] !== request.transactionId ||
      value["operationId"] !== request.operationId ||
      value["contentRootBindingId"] !== request.contentRootBindingId ||
      value["relativeSource"] !== request.relativeSource ||
      value["relativeTarget"] !== request.relativeTarget ||
      (request.operationKind === "delete_file" &&
        value["recoveryObjectId"] !== request.recoveryObjectId))
  )
    return lifecycleInvalid();
  return ok(freeze(value as unknown as EngineeringFileLifecycleReceiptV2));
}

export function validateEngineeringFileRestoreRequestV2(
  value: unknown,
  pathPolicy?: EngineeringPathPolicy
): Result<EngineeringFileRestoreRequestV2, UnifiedError> {
  if (
    !hasExactKeys(value, lifecycleRequestKeys) ||
    value["schemaVersion"] !== ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION ||
    value["operationKind"] !== "restore_file" ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    value["relativeSource"] !== "" ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeTarget"], pathPolicy) ||
    !isStableId(value["sourceFileIdentity"]) ||
    !isSha256(value["sourceSha256"]) ||
    value["targetProof"] !== "absent" ||
    !isStableId(value["recoveryRootBindingId"]) ||
    !isStableId(value["recoveryGrantRevision"]) ||
    !isSha256(value["recoverySideEffectChecksum"]) ||
    !isStableId(value["recoveryObjectId"]) ||
    !isStableId(value["stagingObjectId"]) ||
    value["expectedState"] !== "wal_prepared"
  )
    return lifecycleInvalid();
  return ok(freeze(value as unknown as EngineeringFileRestoreRequestV2));
}

export function validateEngineeringFileRestoreReceiptV2(
  value: unknown,
  request?: EngineeringFileRestoreRequestV2
): Result<EngineeringFileRestoreReceiptV2, UnifiedError> {
  if (
    !hasExactKeys(value, lifecycleReceiptKeys) ||
    value["schemaVersion"] !== ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_file_lifecycle_receipt" ||
    value["operationKind"] !== "restore_file" ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    value["relativeSource"] !== "" ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeTarget"]) ||
    value["state"] !== "restored" ||
    !isStableId(value["recoveryObjectId"]) ||
    value["durability"] !== "data_and_directory_flushed"
  )
    return lifecycleInvalid();
  if (
    request !== undefined &&
    (value["transactionId"] !== request.transactionId ||
      value["operationId"] !== request.operationId ||
      value["contentRootBindingId"] !== request.contentRootBindingId ||
      value["relativeTarget"] !== request.relativeTarget ||
      value["recoveryObjectId"] !== request.recoveryObjectId)
  )
    return lifecycleInvalid();
  return ok(freeze(value as unknown as EngineeringFileRestoreReceiptV2));
}

export function validateEngineeringQuarantinePurgeInputV2(
  value: unknown
): Result<EngineeringQuarantinePurgeInputV2, UnifiedError> {
  if (!hasExactKeys(value, lifecyclePurgeInputKeys)) return lifecycleInvalid();
  const recoveryBinding = parseLifecycleRecoveryBinding(value["recoveryBinding"]);
  const decision = value["retentionDecision"];
  if (
    recoveryBinding === undefined ||
    !hasExactKeys(decision, retentionDecisionKeys) ||
    decision["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    decision["kind"] !== "engineering_quarantine_retention_decision" ||
    !isStableId(decision["contentRootBindingId"]) ||
    !isStableId(decision["recoveryRootBindingId"]) ||
    !isStableId(decision["recoveryGrantRevision"]) ||
    !isSha256(decision["recoverySideEffectChecksum"]) ||
    !isStableId(decision["recoveryObjectId"]) ||
    decision["state"] !== "purge_authorized" ||
    !isSha256(decision["decisionChecksum"]) ||
    decision["recoveryRootBindingId"] !== recoveryBinding.recoveryRootBindingId
  )
    return lifecycleInvalid();
  return ok(
    freeze({
      recoveryBinding,
      retentionDecision: {
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        kind: "engineering_quarantine_retention_decision" as const,
        contentRootBindingId: decision["contentRootBindingId"] as string,
        recoveryRootBindingId: decision["recoveryRootBindingId"] as string,
        recoveryGrantRevision: decision["recoveryGrantRevision"] as string,
        recoverySideEffectChecksum: decision["recoverySideEffectChecksum"] as string,
        recoveryObjectId: decision["recoveryObjectId"] as string,
        state: "purge_authorized" as const,
        decisionChecksum: decision["decisionChecksum"] as string
      }
    })
  );
}

export function validateEngineeringFileMutationProposalSnapshotInputV2(
  value: unknown,
  pathPolicy?: EngineeringPathPolicy
): Result<EngineeringFileMutationProposalSnapshotInputV2, UnifiedError> {
  if (
    !hasExactKeys(value, proposalSnapshotInputKeys) ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"], pathPolicy)
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_INPUT_INVALID",
      "Engineering mutation proposal snapshot input is invalid."
    );
  }
  return ok(
    freeze({
      relativeIdentity: value["relativeIdentity"] as string
    })
  );
}

export function validateEngineeringCreateAbsenceObservationInputV2(
  value: unknown,
  pathPolicy?: EngineeringPathPolicy
): Result<EngineeringCreateAbsenceObservationInputV2, UnifiedError> {
  if (
    !hasExactKeys(value, createAbsenceObservationInputKeys) ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"], pathPolicy) ||
    !isCanonicalUtcTimestamp(value["observedAt"])
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_INPUT_INVALID",
      "Engineering create absence observation input is invalid."
    );
  }
  return ok(
    freeze({
      relativeIdentity: value["relativeIdentity"] as string,
      observedAt: value["observedAt"] as string
    })
  );
}

export function validateEngineeringFileMutationProposalSnapshotV2(
  value: unknown
): Result<EngineeringFileMutationProposalSnapshotV2, UnifiedError> {
  if (!hasExactKeys(value, proposalSnapshotKeys)) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_SNAPSHOT_INVALID",
      "Engineering mutation proposal snapshot is invalid."
    );
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_file_mutation_target_snapshot" ||
    !isStableId(value["rootBindingId"]) ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"]) ||
    !isStableId(value["parentDirectoryIdentity"])
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_SNAPSHOT_INVALID",
      "Engineering mutation proposal snapshot is invalid."
    );
  }
  if (value["state"] === "absent") {
    if (value["bytes"] !== null || value["manifest"] !== null) {
      return invalid(
        "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_SNAPSHOT_INVALID",
        "Engineering mutation proposal snapshot is invalid."
      );
    }
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        kind: "engineering_file_mutation_target_snapshot" as const,
        rootBindingId: value["rootBindingId"] as string,
        relativeIdentity: value["relativeIdentity"] as string,
        parentDirectoryIdentity: value["parentDirectoryIdentity"] as string,
        state: "absent" as const,
        bytes: null,
        manifest: null
      })
    );
  }
  if (value["state"] !== "present" || !(value["bytes"] instanceof Uint8Array)) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_SNAPSHOT_INVALID",
      "Engineering mutation proposal snapshot is invalid."
    );
  }
  const manifest = validateEngineeringRawByteManifestV2(value["manifest"]);
  if (
    !manifest.ok ||
    manifest.value.identity.kind !== "observed_file" ||
    manifest.value.identity.rootBindingId !== value["rootBindingId"] ||
    manifest.value.identity.relativeIdentity !== value["relativeIdentity"] ||
    !bytesMatchManifest(value["bytes"], manifest.value)
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_SNAPSHOT_INVALID",
      "Engineering mutation proposal snapshot is invalid."
    );
  }
  return ok(
    freeze({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      kind: "engineering_file_mutation_target_snapshot" as const,
      rootBindingId: value["rootBindingId"] as string,
      relativeIdentity: value["relativeIdentity"] as string,
      parentDirectoryIdentity: value["parentDirectoryIdentity"] as string,
      state: "present" as const,
      bytes: new Uint8Array(value["bytes"]),
      manifest: manifest.value
    })
  );
}

export function validateEngineeringFileMutationApplyInputV2(
  value: unknown,
  rootBinding?: EngineeringFileMutationRootBindingV2,
  pathPolicy?: EngineeringPathPolicy
): Result<EngineeringFileMutationApplyInputV2, UnifiedError> {
  if (
    rootBinding === undefined ||
    !isRootBinding(rootBinding) ||
    !hasExactKeys(value, mutationApplyInputKeys)
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_APPLY_INPUT_INVALID",
      "Engineering mutation apply input is invalid."
    );
  }
  const request = validateEngineeringFileMutationRequestV2(value["request"], pathPolicy);
  const candidateBytes = value["candidateBytes"];
  const beforeBytes = value["beforeBytes"];
  if (
    !request.ok ||
    request.value.contentRootBindingId !== rootBinding.contentRootBindingId ||
    !(candidateBytes instanceof Uint8Array) ||
    !bytesMatchManifest(candidateBytes, request.value.candidate.manifest) ||
    (request.value.before.kind === "present" &&
      (!(beforeBytes instanceof Uint8Array) ||
        !bytesMatchManifest(beforeBytes, request.value.before.manifest))) ||
    (request.value.before.kind === "absent" && beforeBytes !== null)
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_APPLY_INPUT_INVALID",
      "Engineering mutation apply input is invalid."
    );
  }
  return ok(
    freeze({
      request: request.value,
      beforeBytes: beforeBytes === null ? null : new Uint8Array(beforeBytes as Uint8Array),
      candidateBytes: new Uint8Array(candidateBytes)
    })
  );
}

export function validateEngineeringMutationOperationStateV2(
  value: unknown,
  requestValue: unknown
): Result<EngineeringMutationOperationStateV2, UnifiedError> {
  const request = validateEngineeringFileMutationRequestV2(requestValue);
  if (!request.ok || !hasExactKeys(value, operationStateKeys)) {
    return invalid(
      "ENGINEERING_MUTATION_OPERATION_STATE_INVALID",
      "Engineering mutation operation state is invalid."
    );
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_mutation_operation_state" ||
    !isSha256(value["requestChecksum"]) ||
    value["requestChecksum"] !== engineeringFileMutationRequestChecksumV2(request.value)
  ) {
    return invalid(
      "ENGINEERING_MUTATION_OPERATION_STATE_INVALID",
      "Engineering mutation operation state is invalid."
    );
  }
  const state = value["state"];
  if (state === "after") {
    const receipt = verifyEngineeringMutationReceiptBindingV2(value["receipt"], request.value);
    return receipt.ok
      ? ok(
          freeze({
            schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
            kind: "engineering_mutation_operation_state" as const,
            state: "after" as const,
            requestChecksum: value["requestChecksum"] as string,
            receipt: receipt.value
          })
        )
      : invalid(
          "ENGINEERING_MUTATION_OPERATION_STATE_INVALID",
          "Engineering mutation operation state is invalid."
        );
  }
  if (
    (state === "before" || state === "neither" || state === "unknown") &&
    value["receipt"] === null
  ) {
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        kind: "engineering_mutation_operation_state" as const,
        state,
        requestChecksum: value["requestChecksum"] as string,
        receipt: null
      })
    );
  }
  return invalid(
    "ENGINEERING_MUTATION_OPERATION_STATE_INVALID",
    "Engineering mutation operation state is invalid."
  );
}

export function inspectEngineeringRawBytesV2(
  bytes: Uint8Array
): Result<EngineeringRawByteInspectionV2, UnifiedError> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > ENGINEERING_MUTATION_V2_MAX_RAW_BYTES) {
    return invalid(
      "ENGINEERING_RAW_BYTE_INPUT_INVALID",
      "Raw-byte content is invalid or too large."
    );
  }
  const bom = hasUtf8Bom(bytes) ? "utf-8" : "none";
  const body = bytes.subarray(bom === "utf-8" ? 3 : 0);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return invalid("ENGINEERING_RAW_BYTE_ENCODING_INVALID", "Raw-byte content is not valid UTF-8.");
  }
  return ok(
    freeze({
      sha256: sha256EngineeringMutationBytesV2(bytes),
      byteLength: bytes.byteLength,
      encoding: "utf-8" as const,
      bom,
      eol: detectEol(decoded)
    })
  );
}

export function createEngineeringRawByteManifestV2(input: {
  readonly identity: EngineeringRawByteIdentityV2;
  readonly bytes: Uint8Array;
  readonly metadataChecksum: string;
}): EngineeringRawByteManifestV2 {
  const inspected = inspectEngineeringRawBytesV2(input.bytes);
  if (!inspected.ok) throw new Error("ENGINEERING_RAW_BYTE_MANIFEST_INVALID");
  const manifest = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    identity: input.identity,
    ...inspected.value,
    metadataChecksum: input.metadataChecksum
  } as const;
  const validated = validateEngineeringRawByteManifestV2(manifest);
  if (!validated.ok) throw new Error("ENGINEERING_RAW_BYTE_MANIFEST_INVALID");
  return validated.value;
}

export function validateEngineeringRawByteManifestV2(
  value: unknown
): Result<EngineeringRawByteManifestV2, UnifiedError> {
  if (!hasExactKeys(value, rawByteManifestKeys)) {
    return invalid("ENGINEERING_RAW_BYTE_MANIFEST_INVALID", "Raw-byte manifest is invalid.");
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isRawByteIdentity(value["identity"]) ||
    !isSha256(value["sha256"]) ||
    !isNonNegativeByteLength(value["byteLength"]) ||
    value["encoding"] !== "utf-8" ||
    !isBom(value["bom"]) ||
    !isEol(value["eol"]) ||
    !isSha256(value["metadataChecksum"])
  ) {
    return invalid("ENGINEERING_RAW_BYTE_MANIFEST_INVALID", "Raw-byte manifest is invalid.");
  }
  return ok(freeze(value as unknown as EngineeringRawByteManifestV2));
}

export function engineeringRawByteManifestChecksumV2(
  manifest: EngineeringRawByteManifestV2
): string {
  const validated = validateEngineeringRawByteManifestV2(manifest);
  if (!validated.ok) throw new Error("ENGINEERING_RAW_BYTE_MANIFEST_INVALID");
  return sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(validated.value));
}

export function createEngineeringAbsenceProofV2(
  input: Omit<EngineeringAbsenceProofV2, "schemaVersion" | "kind" | "absenceProofChecksum">
): EngineeringAbsenceProofV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "absence_proof" as const,
    rootBindingId: input.rootBindingId,
    relativeIdentity: input.relativeIdentity,
    parentDirectoryIdentity: input.parentDirectoryIdentity,
    observedAt: input.observedAt
  };
  const proof = {
    ...unsigned,
    absenceProofChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  } as const;
  const validated = validateEngineeringAbsenceProofV2(proof);
  if (!validated.ok) throw new Error("ENGINEERING_ABSENCE_PROOF_INVALID");
  return validated.value;
}

export function validateEngineeringAbsenceProofV2(
  value: unknown
): Result<EngineeringAbsenceProofV2, UnifiedError> {
  if (!hasExactKeys(value, absenceProofKeys)) {
    return invalid("ENGINEERING_ABSENCE_PROOF_INVALID", "Create absence proof is invalid.");
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "absence_proof" ||
    !isStableId(value["rootBindingId"]) ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"]) ||
    !isStableId(value["parentDirectoryIdentity"]) ||
    !isCanonicalUtcTimestamp(value["observedAt"]) ||
    !isSha256(value["absenceProofChecksum"])
  ) {
    return invalid("ENGINEERING_ABSENCE_PROOF_INVALID", "Create absence proof is invalid.");
  }
  const unsigned = withoutKey(value, "absenceProofChecksum");
  if (
    value["absenceProofChecksum"] !==
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  ) {
    return invalid("ENGINEERING_ABSENCE_PROOF_INVALID", "Create absence proof is invalid.");
  }
  return ok(freeze(value as unknown as EngineeringAbsenceProofV2));
}

export function validateEngineeringFileMutationRequestV2(
  value: unknown,
  pathPolicy?: EngineeringPathPolicy
): Result<EngineeringFileMutationRequestV2, UnifiedError> {
  if (!hasExactKeys(value, mutationRequestKeys)) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_REQUEST_INVALID",
      "Engineering mutation request is invalid."
    );
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isOperationKind(value["operationKind"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"], pathPolicy) ||
    !isStableId(value["stagingObjectId"])
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_REQUEST_INVALID",
      "Engineering mutation request is invalid."
    );
  }

  const before = parseBeforeImage(value["before"]);
  const candidate = parseCandidateImage(value["candidate"]);
  if (before === undefined || candidate === undefined) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_REQUEST_INVALID",
      "Engineering mutation request is invalid."
    );
  }

  const request = value as Omit<EngineeringFileMutationRequestV2, "before" | "candidate"> & {
    readonly before: EngineeringMutationBeforeImageV2;
    readonly candidate: EngineeringMutationCandidateImageV2;
  };
  if (
    !candidateMatchesRequest(candidate, request) ||
    !beforeMatchesRequest(before, request) ||
    (request.operationKind === "replace_file" && before.kind !== "present") ||
    (request.operationKind === "create_file" && before.kind !== "absent")
  ) {
    return invalid(
      "ENGINEERING_FILE_MUTATION_V2_REQUEST_INVALID",
      "Engineering mutation request is invalid."
    );
  }
  return ok(freeze({ ...request, before, candidate }));
}

export function validateEngineeringMutationBeforeImageV2(
  value: unknown
): Result<EngineeringMutationBeforeImageV2, UnifiedError> {
  const parsed = parseBeforeImage(value);
  return parsed === undefined
    ? invalid("ENGINEERING_MUTATION_BEFORE_IMAGE_INVALID", "Mutation before-image is invalid.")
    : ok(parsed);
}

export function validateEngineeringMutationCandidateImageV2(
  value: unknown
): Result<EngineeringMutationCandidateImageV2, UnifiedError> {
  const parsed = parseCandidateImage(value);
  return parsed === undefined
    ? invalid(
        "ENGINEERING_MUTATION_CANDIDATE_IMAGE_INVALID",
        "Mutation candidate image is invalid."
      )
    : ok(parsed);
}

export function engineeringFileMutationRequestChecksumV2(
  request: EngineeringFileMutationRequestV2
): string {
  const validated = validateEngineeringFileMutationRequestV2(request);
  if (!validated.ok) throw new Error("ENGINEERING_FILE_MUTATION_V2_REQUEST_INVALID");
  return sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(validated.value));
}

/** Content-addressed ids are deterministic and therefore cannot be caller-selected aliases. */
export function engineeringMutationBlobIdForSha256V2(sha256: string): string {
  if (!isSha256(sha256)) throw new Error("ENGINEERING_MUTATION_BLOB_SHA256_INVALID");
  return `blob_${sha256}`;
}

export function doesEngineeringMutationBlobMatchManifestV2(
  blob: EngineeringMutationBlobReferenceV2,
  manifest: EngineeringRawByteManifestV2,
  contentRootBindingId: string
): boolean {
  return (
    isBlobReference(blob) &&
    blob.contentRootBindingId === contentRootBindingId &&
    blob.blobId === engineeringMutationBlobIdForSha256V2(manifest.sha256) &&
    blob.sha256 === manifest.sha256 &&
    blob.byteLength === manifest.byteLength &&
    blob.encoding === manifest.encoding &&
    blob.bom === manifest.bom &&
    blob.eol === manifest.eol
  );
}

/** Canonical JSON for the restricted JSON domain used by all Engineering V2 checksums. */
export function canonicalizeEngineeringMutationV2Json(value: unknown): string {
  return canonicalize(value, new WeakSet<object>());
}

export function sha256EngineeringMutationTextV2(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256EngineeringMutationBytesV2(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function inspectProposalSnapshotThroughNativeV2(input: {
  readonly addon: EngineeringFileMutationProposalNativeAddonV2 | undefined;
  readonly rootBinding: EngineeringFileMutationRootBindingV2;
  readonly authenticate: EngineeringNativeProposalEvidenceAuthenticatorV2 | undefined;
  readonly relativeIdentity: string;
  readonly traceId: string;
}): Promise<Result<EngineeringFileMutationProposalSnapshotV2, UnifiedError>> {
  if (input.addon === undefined) return unavailable(input.traceId);
  if (input.authenticate === undefined) return evidenceUnavailable(input.traceId);

  let rawSnapshot: unknown;
  try {
    rawSnapshot = await input.addon.inspectEngineeringFileSnapshotV2(
      input.rootBinding.rootId,
      input.relativeIdentity
    );
  } catch (cause) {
    return proposalNativeFailure(cause, input.traceId);
  }

  const snapshot = parseNativeProposalSnapshotV2(
    rawSnapshot,
    input.rootBinding,
    input.relativeIdentity
  );
  if (snapshot === undefined) return nativeProposalProtocolFailure(input.traceId);
  const authenticated = authenticateProposalEvidence(
    input.authenticate,
    input.rootBinding,
    "snapshot",
    snapshot,
    input.traceId
  );
  return authenticated.ok ? ok(snapshot) : authenticated;
}

function parseNativeAddon(value: unknown): EngineeringFileMutationNativeAddonV2 | undefined {
  return isRecord(value) &&
    typeof value["applyEngineeringFileMutationV2"] === "function" &&
    typeof value["inspectEngineeringFileMutationTargetV2"] === "function"
    ? (value as unknown as EngineeringFileMutationNativeAddonV2)
    : undefined;
}

function parseLifecycleNativeAddon(
  value: unknown
): EngineeringFileLifecycleNativeAddonV2 | undefined {
  return isRecord(value) &&
    typeof value["moveEngineeringPathV2"] === "function" &&
    typeof value["quarantineEngineeringFileV2"] === "function" &&
    typeof value["restoreEngineeringFileV2"] === "function" &&
    typeof value["purgeEngineeringQuarantineObjectV2"] === "function" &&
    typeof value["createEngineeringDirectoryV2"] === "function"
    ? (value as unknown as EngineeringFileLifecycleNativeAddonV2)
    : undefined;
}

function parseLifecycleRecoveryBinding(
  value: unknown
): EngineeringLifecycleRecoveryRootBindingV2 | undefined {
  return isRecord(value) &&
    isStableId(value["recoveryRootBindingId"]) &&
    (typeof value["recoveryRootId"] === "string" || typeof value["recoveryRootId"] === "bigint") &&
    isStableId(value["grantRevision"]) &&
    isSha256(value["sideEffectChecksum"])
    ? freeze({
        recoveryRootBindingId: value["recoveryRootBindingId"] as string,
        recoveryRootId: value["recoveryRootId"] as string | bigint,
        grantRevision: value["grantRevision"] as string,
        sideEffectChecksum: value["sideEffectChecksum"] as string
      })
    : undefined;
}

function isLifecycleKind(value: unknown): value is EngineeringFileLifecycleOperationKindV2 {
  return value === "move_file" || value === "delete_file" || value === "create_directory";
}

function isCaseOnlyMove(source: string, target: string): boolean {
  const sourceSegments = source.split("/");
  const targetSegments = target.split("/");
  const sourceLeaf = sourceSegments.pop();
  const targetLeaf = targetSegments.pop();
  if (
    sourceLeaf === undefined ||
    targetLeaf === undefined ||
    sourceSegments.join("/") !== targetSegments.join("/") ||
    sourceLeaf === targetLeaf ||
    sourceLeaf.toLocaleLowerCase("en-US") !== targetLeaf.toLocaleLowerCase("en-US")
  )
    return false;
  // Unicode-normalization-only renames are not case-only renames.
  return sourceLeaf.normalize("NFC") !== targetLeaf.normalize("NFC");
}

function lifecycleInvalid<T = never>(
  traceId = "engineering-file-mutation-port-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_FILE_LIFECYCLE_V2_INVALID",
      message: "Engineering file lifecycle request or receipt is invalid.",
      suggestedAction: "Regenerate the Main-owned lifecycle operation.",
      traceId
    })
  );
}

function lifecycleNativeFailure<T = never>(
  cause: unknown,
  traceId: string
): Result<T, UnifiedError> {
  const code =
    isRecord(cause) && typeof cause["code"] === "string"
      ? cause["code"]
      : "ENGINEERING_FILE_LIFECYCLE_V2_OUTCOME_UNKNOWN";
  return err(
    storageError({
      code,
      message: "The native engineering lifecycle outcome is unknown.",
      suggestedAction: "Enter recovery review before retrying the operation.",
      traceId
    })
  );
}

function parseProposalNativeAddon(
  value: unknown
): EngineeringFileMutationProposalNativeAddonV2 | undefined {
  return isRecord(value) &&
    typeof value["inspectEngineeringFileSnapshotV2"] === "function" &&
    typeof value["observeCreateAbsenceV2"] === "function"
    ? (value as unknown as EngineeringFileMutationProposalNativeAddonV2)
    : undefined;
}

function parseNativeProposalSnapshotV2(
  value: unknown,
  rootBinding: EngineeringFileMutationRootBindingV2,
  expectedRelativeIdentity: string
): EngineeringFileMutationProposalSnapshotV2 | undefined {
  if (!hasExactKeys(value, nativeProposalSnapshotKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_file_mutation_target_snapshot" ||
    value["rootId"] !== rootBinding.rootId ||
    value["relativeIdentity"] !== expectedRelativeIdentity ||
    !isStableId(value["parentDirectoryIdentity"])
  ) {
    return undefined;
  }
  if (value["state"] === "absent") {
    if (value["bytes"] !== null || value["manifest"] !== null) return undefined;
    const snapshot = validateEngineeringFileMutationProposalSnapshotV2({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      kind: "engineering_file_mutation_target_snapshot",
      rootBindingId: rootBinding.contentRootBindingId,
      relativeIdentity: expectedRelativeIdentity,
      parentDirectoryIdentity: value["parentDirectoryIdentity"],
      state: "absent",
      bytes: null,
      manifest: null
    });
    return snapshot.ok ? snapshot.value : undefined;
  }
  if (
    value["state"] !== "present" ||
    !(value["bytes"] instanceof Uint8Array) ||
    !hasExactKeys(value["manifest"], nativeProposalSnapshotManifestKeys)
  ) {
    return undefined;
  }
  const rawManifest = value["manifest"];
  const manifest = validateEngineeringRawByteManifestV2({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    identity: {
      kind: "observed_file",
      rootBindingId: rootBinding.contentRootBindingId,
      relativeIdentity: expectedRelativeIdentity,
      fileIdentity: rawManifest["fileIdentity"]
    },
    sha256: rawManifest["sha256"],
    byteLength: rawManifest["byteLength"],
    encoding: rawManifest["encoding"],
    bom: rawManifest["bom"],
    eol: rawManifest["eol"],
    metadataChecksum: rawManifest["metadataChecksum"]
  });
  if (!manifest.ok) return undefined;
  const snapshot = validateEngineeringFileMutationProposalSnapshotV2({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_file_mutation_target_snapshot",
    rootBindingId: rootBinding.contentRootBindingId,
    relativeIdentity: expectedRelativeIdentity,
    parentDirectoryIdentity: value["parentDirectoryIdentity"],
    state: "present",
    bytes: new Uint8Array(value["bytes"]),
    manifest: manifest.value
  });
  return snapshot.ok ? snapshot.value : undefined;
}

function isRootBinding(value: unknown): value is EngineeringFileMutationRootBindingV2 {
  return (
    isRecord(value) &&
    hasExactKeys(value, rootBindingKeys) &&
    isStableId(value["contentRootBindingId"]) &&
    (typeof value["rootId"] === "string" || typeof value["rootId"] === "bigint")
  );
}

function bytesMatchManifest(bytes: Uint8Array, manifest: EngineeringRawByteManifestV2): boolean {
  const inspected = inspectEngineeringRawBytesV2(bytes);
  return (
    inspected.ok &&
    inspected.value.sha256 === manifest.sha256 &&
    inspected.value.byteLength === manifest.byteLength &&
    inspected.value.encoding === manifest.encoding &&
    inspected.value.bom === manifest.bom &&
    inspected.value.eol === manifest.eol
  );
}

function authenticateEvidence(
  authenticate: EngineeringNativeEvidenceAuthenticatorV2,
  rootBinding: EngineeringFileMutationRootBindingV2,
  request: EngineeringFileMutationRequestV2,
  kind: "receipt" | "operation_state",
  value: unknown,
  traceId: string
): Result<void, UnifiedError> {
  try {
    const result = authenticate({ rootBinding, request, kind, value });
    return result.ok ? ok(undefined) : result;
  } catch {
    return err(
      storageError({
        code: "ENGINEERING_FILE_MUTATION_V2_EVIDENCE_AUTHENTICATION_FAILED",
        message: "Engineering native evidence could not be authenticated.",
        suggestedAction: "Enter recovery review; do not retry the mutation.",
        traceId
      })
    );
  }
}

function authenticateProposalEvidence(
  authenticate: EngineeringNativeProposalEvidenceAuthenticatorV2,
  rootBinding: EngineeringFileMutationRootBindingV2,
  kind: "snapshot" | "absence_proof",
  value: EngineeringFileMutationProposalSnapshotV2 | EngineeringAbsenceProofV2,
  traceId: string
): Result<void, UnifiedError> {
  try {
    const result = authenticate({ rootBinding, kind, value });
    return result.ok ? ok(undefined) : result;
  } catch {
    return err(
      storageError({
        code: "ENGINEERING_FILE_MUTATION_V2_EVIDENCE_AUTHENTICATION_FAILED",
        message: "Engineering native proposal evidence could not be authenticated.",
        suggestedAction: "Regenerate the proposal before trying again.",
        traceId
      })
    );
  }
}

function authenticateRecoveryOperation(
  authenticate: EngineeringRecoveryOperationAuthenticatorV2,
  input: Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0],
  traceId: string
): Result<void, UnifiedError> {
  try {
    const result = authenticate(input);
    return result.ok ? ok(undefined) : result;
  } catch {
    return err(
      storageError({
        code: "ENGINEERING_FILE_LIFECYCLE_V2_RECOVERY_AUTHENTICATION_FAILED",
        message: "The Main-owned recovery operation could not be authenticated.",
        suggestedAction: "Keep recovery operations disabled and review the recovery root.",
        traceId
      })
    );
  }
}

function parseBeforeImage(value: unknown): EngineeringMutationBeforeImageV2 | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION) {
    return undefined;
  }
  if (value["kind"] === "present") {
    if (!hasExactKeys(value, beforePresentKeys)) return undefined;
    const manifest = validateEngineeringRawByteManifestV2(value["manifest"]);
    if (!manifest.ok || !isBlobReference(value["blob"])) return undefined;
    return freeze({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      kind: "present" as const,
      manifest: manifest.value,
      blob: value["blob"] as EngineeringMutationBlobReferenceV2
    });
  }
  if (value["kind"] === "absent") {
    if (!hasExactKeys(value, beforeAbsentKeys)) return undefined;
    const absenceProof = validateEngineeringAbsenceProofV2(value["absenceProof"]);
    return absenceProof.ok
      ? freeze({
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          kind: "absent" as const,
          absenceProof: absenceProof.value
        })
      : undefined;
  }
  return undefined;
}

function parseCandidateImage(value: unknown): EngineeringMutationCandidateImageV2 | undefined {
  if (!hasExactKeys(value, candidateKeys)) return undefined;
  const manifest = validateEngineeringRawByteManifestV2(value["manifest"]);
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !manifest.ok ||
    !isBlobReference(value["blob"])
  ) {
    return undefined;
  }
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    manifest: manifest.value,
    blob: value["blob"] as EngineeringMutationBlobReferenceV2
  });
}

function candidateMatchesRequest(
  candidate: EngineeringMutationCandidateImageV2,
  request: Pick<EngineeringFileMutationRequestV2, "contentRootBindingId" | "relativeIdentity">
): boolean {
  return (
    candidate.manifest.identity.kind === "target" &&
    candidate.manifest.identity.rootBindingId === request.contentRootBindingId &&
    candidate.manifest.identity.relativeIdentity === request.relativeIdentity &&
    doesEngineeringMutationBlobMatchManifestV2(
      candidate.blob,
      candidate.manifest,
      request.contentRootBindingId
    )
  );
}

function beforeMatchesRequest(
  before: EngineeringMutationBeforeImageV2,
  request: Pick<EngineeringFileMutationRequestV2, "contentRootBindingId" | "relativeIdentity">
): boolean {
  if (before.kind === "absent") {
    return (
      before.absenceProof.rootBindingId === request.contentRootBindingId &&
      before.absenceProof.relativeIdentity === request.relativeIdentity
    );
  }
  return (
    before.manifest.identity.kind === "observed_file" &&
    before.manifest.identity.rootBindingId === request.contentRootBindingId &&
    before.manifest.identity.relativeIdentity === request.relativeIdentity &&
    doesEngineeringMutationBlobMatchManifestV2(
      before.blob,
      before.manifest,
      request.contentRootBindingId
    )
  );
}

function isBlobReference(value: unknown): value is EngineeringMutationBlobReferenceV2 {
  return (
    hasExactKeys(value, blobReferenceKeys) &&
    value["schemaVersion"] === ENGINEERING_MUTATION_V2_SCHEMA_VERSION &&
    isStableId(value["contentRootBindingId"]) &&
    typeof value["blobId"] === "string" &&
    isSha256(value["sha256"]) &&
    value["blobId"] === engineeringMutationBlobIdForSha256V2(value["sha256"]) &&
    value["storage"] === "main_owned_immutable_blob" &&
    isNonNegativeByteLength(value["byteLength"]) &&
    value["encoding"] === "utf-8" &&
    isBom(value["bom"]) &&
    isEol(value["eol"])
  );
}

function isRawByteIdentity(value: unknown): value is EngineeringRawByteIdentityV2 {
  if (!isRecord(value)) return false;
  if (value["kind"] === "observed_file") {
    return (
      hasExactKeys(value, observedIdentityKeys) &&
      isStableId(value["rootBindingId"]) &&
      isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"]) &&
      isStableId(value["fileIdentity"])
    );
  }
  return (
    hasExactKeys(value, targetIdentityKeys) &&
    value["kind"] === "target" &&
    isStableId(value["rootBindingId"]) &&
    isCanonicalOrdinaryRelativeIdentity(value["relativeIdentity"]) &&
    value["fileIdentity"] === null
  );
}

function isCanonicalOrdinaryRelativeIdentity(
  value: unknown,
  pathPolicy?: EngineeringPathPolicy
): value is string {
  const classified = classifyEngineeringPath(value, pathPolicy);
  return classified.ok && classified.classification === "ordinary";
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

function isNonNegativeByteLength(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= ENGINEERING_MUTATION_V2_MAX_RAW_BYTES
  );
}

function isBom(value: unknown): value is EngineeringRawByteBomV2 {
  return value === "none" || value === "utf-8";
}

function isEol(value: unknown): value is EngineeringRawByteEolV2 {
  return value === "none" || value === "lf" || value === "crlf" || value === "mixed";
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function detectEol(value: string): EngineeringRawByteEolV2 {
  let lf = false;
  let crlf = false;
  let bareCr = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\r") {
      if (value[index + 1] === "\n") {
        crlf = true;
        index += 1;
      } else {
        bareCr = true;
      }
    } else if (value[index] === "\n") {
      lf = true;
    }
  }
  if (!lf && !crlf && !bareCr) return "none";
  if (lf && !crlf && !bareCr) return "lf";
  if (crlf && !lf && !bareCr) return "crlf";
  return "mixed";
}

function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ENGINEERING_MUTATION_CANONICAL_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((child) => canonicalize(child, seen)).join(",")}]`;
  if (typeof value !== "object" || value === undefined) {
    throw new Error("ENGINEERING_MUTATION_CANONICAL_INVALID");
  }
  if (seen.has(value)) throw new Error("ENGINEERING_MUTATION_CANONICAL_INVALID");
  seen.add(value);
  try {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return (
    keys.length === canonicalExpected.length &&
    keys.every((key, index) => key === canonicalExpected[index])
  );
}

function freeze<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return value;
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
      traceId: "engineering-file-mutation-port-v2"
    })
  );
}

function nativeProtocolFailure<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_NATIVE_PROTOCOL_INVALID",
      message: "The engineering mutation service returned an invalid receipt.",
      suggestedAction: "Reload the workspace before trying again.",
      traceId
    })
  );
}

function nativeProposalProtocolFailure<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_EVIDENCE_INVALID",
      message: "The engineering proposal evidence returned by native code is invalid.",
      suggestedAction: "Regenerate the proposal before trying again.",
      traceId
    })
  );
}

function createTargetPresent<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_CREATE_TARGET_PRESENT",
      message: "The create target is no longer absent.",
      suggestedAction: "Refresh the workspace and create a new proposal.",
      traceId
    })
  );
}

function unavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE",
      message: "The qualified engineering mutation service is unavailable.",
      suggestedAction: "Reload the workspace before trying again.",
      traceId
    })
  );
}

function evidenceUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_EVIDENCE_UNQUALIFIED",
      message: "Qualified Main-owned native evidence authentication is unavailable.",
      suggestedAction: "Keep engineering mutations disabled until native evidence is qualified.",
      traceId
    })
  );
}

function nativeFailure<T = never>(cause: unknown, traceId: string): Result<T, UnifiedError> {
  const code = isRecord(cause) && typeof cause["code"] === "string" ? cause["code"] : undefined;
  if (code === "ENGINEERING_ACCESS_ROOT_CHANGED") {
    return err(
      storageError({
        code: "ENGINEERING_FILE_MUTATION_V2_ROOT_CHANGED",
        message: "The engineering workspace root changed while the mutation was applying.",
        suggestedAction: "Reopen the workspace and regenerate the approved proposal.",
        traceId
      })
    );
  }
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_OUTCOME_UNKNOWN",
      message: "The native engineering mutation outcome is unknown after invocation.",
      suggestedAction:
        "Enter recovery review and reconcile the prepared transaction before writing.",
      traceId
    })
  );
}

function proposalNativeFailure<T = never>(
  cause: unknown,
  traceId: string
): Result<T, UnifiedError> {
  const code = isRecord(cause) && typeof cause["code"] === "string" ? cause["code"] : undefined;
  if (code === "ENGINEERING_ACCESS_ROOT_CHANGED") {
    return err(
      storageError({
        code: "ENGINEERING_FILE_MUTATION_V2_ROOT_CHANGED",
        message: "The engineering workspace root changed while proposal evidence was observed.",
        suggestedAction: "Reopen the workspace and regenerate the proposal.",
        traceId
      })
    );
  }
  return err(
    storageError({
      code: "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_EVIDENCE_UNAVAILABLE",
      message: "Fresh native engineering proposal evidence is unavailable.",
      suggestedAction: "Keep engineering mutations disabled until native evidence is available.",
      traceId
    })
  );
}

const rawByteManifestKeys = [
  "bom",
  "byteLength",
  "encoding",
  "eol",
  "identity",
  "metadataChecksum",
  "schemaVersion",
  "sha256"
] as const;
const proposalSnapshotInputKeys = ["relativeIdentity"] as const;
const createAbsenceObservationInputKeys = ["observedAt", "relativeIdentity"] as const;
const proposalSnapshotKeys = [
  "bytes",
  "kind",
  "manifest",
  "parentDirectoryIdentity",
  "relativeIdentity",
  "rootBindingId",
  "schemaVersion",
  "state"
] as const;
const nativeProposalSnapshotKeys = [
  "bytes",
  "kind",
  "manifest",
  "parentDirectoryIdentity",
  "relativeIdentity",
  "rootId",
  "schemaVersion",
  "state"
] as const;
const nativeProposalSnapshotManifestKeys = [
  "bom",
  "byteLength",
  "encoding",
  "eol",
  "fileIdentity",
  "metadataChecksum",
  "sha256"
] as const;
const observedIdentityKeys = ["fileIdentity", "kind", "relativeIdentity", "rootBindingId"] as const;
const targetIdentityKeys = ["fileIdentity", "kind", "relativeIdentity", "rootBindingId"] as const;
const absenceProofKeys = [
  "absenceProofChecksum",
  "kind",
  "observedAt",
  "parentDirectoryIdentity",
  "relativeIdentity",
  "rootBindingId",
  "schemaVersion"
] as const;
const beforePresentKeys = ["blob", "kind", "manifest", "schemaVersion"] as const;
const beforeAbsentKeys = ["absenceProof", "kind", "schemaVersion"] as const;
const candidateKeys = ["blob", "manifest", "schemaVersion"] as const;
const blobReferenceKeys = [
  "blobId",
  "bom",
  "byteLength",
  "contentRootBindingId",
  "encoding",
  "eol",
  "schemaVersion",
  "sha256",
  "storage"
] as const;
const mutationRequestKeys = [
  "before",
  "candidate",
  "contentRootBindingId",
  "operationId",
  "operationKind",
  "providerSemanticVersionSetChecksum",
  "relativeIdentity",
  "schemaVersion",
  "stagingObjectId",
  "transactionId"
] as const;
const rootBindingKeys = ["contentRootBindingId", "rootId"] as const;
const mutationApplyInputKeys = ["beforeBytes", "candidateBytes", "request"] as const;
const lifecycleRequestKeys = [
  "contentRootBindingId",
  "expectedState",
  "operationId",
  "operationKind",
  "recoveryGrantRevision",
  "recoveryObjectId",
  "recoveryRootBindingId",
  "recoverySideEffectChecksum",
  "relativeSource",
  "relativeTarget",
  "schemaVersion",
  "sourceFileIdentity",
  "sourceSha256",
  "stagingObjectId",
  "targetProof",
  "transactionId"
] as const;
const lifecycleReceiptKeys = [
  "contentRootBindingId",
  "durability",
  "kind",
  "operationId",
  "operationKind",
  "recoveryObjectId",
  "relativeSource",
  "relativeTarget",
  "schemaVersion",
  "state",
  "transactionId"
] as const;
const lifecycleQuarantineInputKeys = ["recoveryBinding", "request"] as const;
const lifecycleRestoreInputKeys = ["recoveryBinding", "request"] as const;
const lifecyclePurgeInputKeys = ["recoveryBinding", "retentionDecision"] as const;
const retentionDecisionKeys = [
  "contentRootBindingId",
  "decisionChecksum",
  "kind",
  "recoveryObjectId",
  "recoveryGrantRevision",
  "recoveryRootBindingId",
  "recoverySideEffectChecksum",
  "schemaVersion",
  "state"
] as const;
const operationStateKeys = [
  "kind",
  "receipt",
  "requestChecksum",
  "schemaVersion",
  "state"
] as const;
