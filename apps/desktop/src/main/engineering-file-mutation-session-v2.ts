import { createHash, randomBytes } from "node:crypto";

import {
  approvalBindingV2Checksum,
  checksumChangeSetSelection,
  checksumChangeSetText,
  type ChangeSetApprovalV2,
  type ChangeSetV2,
  type MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import {
  ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
  ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION,
  validateEngineeringApprovalApplyV2,
  type EngineeringApprovalBindingFactsV2,
  type EngineeringApprovalLedgerV2Port,
  type EngineeringApprovalProofInputV2,
  type EngineeringFileMutationSessionV2,
  type EngineeringPreparedFileMutationProposalV2
} from "@novel-studio/application";
import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  createEngineeringRawByteManifestV2,
  engineeringRawByteManifestChecksumV2,
  engineeringSideEffectSubjectChecksumV2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationProposalPortV2,
  type EngineeringFileMutationRequestV2,
  type EngineeringMutationBlobStoreV2,
  type EngineeringMutationProposalRecordV2,
  type EngineeringMutationProposalRepositoryV2,
  type EngineeringWriteTransactionInputV2
} from "@novel-studio/repository";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createEngineeringMutationRefRegistryV2,
  type EngineeringMutationRefRegistryV2
} from "./engineering-mutation-ref-registry-v2.js";
import {
  type EngineeringMutationProposalApprovalPortV2,
  type EngineeringMutationRuntimeApplyRequestV2,
  type EngineeringMutationRuntimeResultV2,
  type EngineeringMutationRuntimeV2
} from "./engineering-mutation-runtime-v2.js";

const CREATE_SAFE_METADATA_CHECKSUM = sha256EngineeringMutationTextV2(
  "engineering_file_metadata_v2\nattributes=128"
);

export interface DesktopEngineeringFileMutationSessionV2Options {
  readonly projectId: string;
  readonly workspaceBindingId: string;
  readonly contentRootBindingId: string;
  readonly pathPolicyRevision: string;
  readonly refCapabilityRevision: string;
  readonly proposalPort: EngineeringFileMutationProposalPortV2;
  readonly blobStore: EngineeringMutationBlobStoreV2;
  readonly proposalRepository: EngineeringMutationProposalRepositoryV2;
  readonly authorizationLedger: EngineeringApprovalLedgerV2Port & {
    consume(authorizationId: string, transactionId: string): Promise<Result<unknown, UnifiedError>>;
  };
  readonly trustedApprovalQualified: () => boolean;
  readonly readApprovalDecisionProof: (
    runId: string,
    proofId: string
  ) => Promise<Result<MainOnlyApprovalDecisionProofV1 | undefined, UnifiedError>>;
  readonly createRuntime: (
    proposalApproval: EngineeringMutationProposalApprovalPortV2
  ) => EngineeringMutationRuntimeV2;
  /** Main-only bridge that distinguishes this live reserve→WAL handoff from a startup orphan. */
  readonly activateAuthorizationReservation?: (input: {
    readonly authorizationId: string;
    readonly transactionId: string;
  }) => (() => void) | undefined;
  /**
   * Resolves the reserve→prepared-WAL handoff after a runtime failure while the live exemption is
   * still held. The Main-only implementation must revoke a reservation only when its Engineering
   * V2 prepared WAL is provably absent; a prepared WAL remains owned by recovery.
   */
  readonly reconcileFailedAuthorizationReservation: (input: {
    readonly authorizationId: string;
    readonly transactionId: string;
    readonly contentRootBindingId: string;
  }) => Promise<Result<"revoked" | "prepared", UnifiedError>>;
  readonly refRegistry?: EngineeringMutationRefRegistryV2;
  readonly now?: () => string;
  readonly randomId?: () => string;
}

export interface DesktopEngineeringFileMutationSessionV2Bundle {
  readonly session: EngineeringFileMutationSessionV2;
  readonly runtime: EngineeringMutationRuntimeV2;
  readonly refRegistry: EngineeringMutationRefRegistryV2;
}

interface PendingApply {
  readonly record: EngineeringMutationProposalRecordV2;
  readonly changeSet: ChangeSetV2;
  readonly approval: ReservedChangeSetApprovalV2;
  readonly facts: EngineeringApprovalBindingFactsV2;
  readonly transactionInput: EngineeringWriteTransactionInputV2;
}

type ReservedChangeSetApprovalV2 = ChangeSetApprovalV2 & {
  readonly authorizationId: string;
  readonly reservationTransactionId: string;
};

/** Main-only B7 session. No path, root handle, ledger reservation, or WAL identity is projected. */
export function createDesktopEngineeringFileMutationSessionV2(
  options: DesktopEngineeringFileMutationSessionV2Options
): DesktopEngineeringFileMutationSessionV2Bundle {
  const now = options.now ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => randomBytes(24).toString("hex"));
  const refRegistry = options.refRegistry ?? createEngineeringMutationRefRegistryV2();
  const pendingByTransaction = new Map<string, PendingApply>();

  const proposalApproval: EngineeringMutationProposalApprovalPortV2 = Object.freeze({
    async revalidate(request: EngineeringMutationRuntimeApplyRequestV2) {
      const pending = pendingByTransaction.get(readTransactionId(request.transactionInput) ?? "");
      if (pending === undefined) return unavailable("ENGINEERING_MUTATION_APPLY_CONTEXT_MISSING");
      const rebuilt = await buildPendingApply(pending.changeSet, pending.approval);
      if (!rebuilt.ok) return rebuilt;
      if (
        rebuilt.value.record.recordChecksum !== pending.record.recordChecksum ||
        !sameCanonical(rebuilt.value.transactionInput, pending.transactionInput)
      ) {
        return stale();
      }
      return ok(
        Object.freeze({ ...request, transactionId: pending.approval.reservationTransactionId })
      );
    }
  });
  const runtime = options.createRuntime(proposalApproval);

  const session: EngineeringFileMutationSessionV2 = Object.freeze({
    async prepare(input: Parameters<EngineeringFileMutationSessionV2["prepare"]>[0]) {
      if (
        input.projectId !== options.projectId ||
        input.boundary.workspaceBindingId !== options.workspaceBindingId ||
        input.boundary.policyRevision.length === 0 ||
        input.boundary.providerSemanticVersionSetChecksum.length === 0 ||
        input.boundary.capabilityRevision.length === 0
      ) {
        return stale();
      }
      const existing = await options.proposalRepository.getByRunToolCall({
        runId: input.runId,
        toolCallId: input.toolCallId
      });
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return existing.value.canonicalPayloadChecksum === input.canonicalPayloadChecksum
          ? preparedProjection(existing.value, input.arguments, options.blobStore)
          : conflict();
      }

      const prepared =
        input.toolName === "propose_file_write"
          ? await prepareReplace(input)
          : await prepareCreate(input);
      if (!prepared.ok) return prepared;
      const created = await options.proposalRepository.create(prepared.value.record);
      return created.ok
        ? preparedProjection(created.value, input.arguments, options.blobStore)
        : created;
    },

    async bindChangeSet({
      prepared,
      changeSet
    }: Parameters<EngineeringFileMutationSessionV2["bindChangeSet"]>[0]) {
      const record = await options.proposalRepository.getByProposalId(prepared.proposalId);
      if (!record.ok) return record;
      if (
        record.value === undefined ||
        record.value.canonicalPayloadChecksum !== prepared.canonicalPayloadChecksum
      ) {
        return stale();
      }
      const selectedOperationIds = selectedIds(changeSet);
      const selectionChecksum = selectionChecksumFor(changeSet);
      if (selectionChecksum === undefined) return stale();
      const bound = await options.proposalRepository.bindChangeSet({
        proposalId: prepared.proposalId,
        changeSet,
        selectionChecksum,
        operationOrderChecksum: checksumChangeSetText(selectedOperationIds.join("\n")),
        selectedOperationIds
      });
      return bound.ok ? ok(undefined) : bound;
    },

    async prepareApprovalProofInput(
      input: Parameters<EngineeringFileMutationSessionV2["prepareApprovalProofInput"]>[0]
    ) {
      const record = await currentRecord(input.changeSet);
      if (!record.ok) return record;
      const current = validateCurrentBoundary(
        record.value,
        input,
        options.contentRootBindingId,
        options.workspaceBindingId,
        options.pathPolicyRevision
      );
      if (!current.ok) return current;
      const preparedProofInput = proofInput(record.value);
      return preparedProofInput === undefined ? stale() : ok(preparedProofInput);
    },

    async finalizeApprovalFacts(
      input: Parameters<EngineeringFileMutationSessionV2["finalizeApprovalFacts"]>[0]
    ) {
      const record = await currentRecord(input.changeSet);
      if (!record.ok) return record;
      const current = validateCurrentBoundary(
        record.value,
        input,
        options.contentRootBindingId,
        options.workspaceBindingId,
        options.pathPolicyRevision
      );
      const preparedProofInput = proofInput(record.value);
      if (
        !current.ok ||
        preparedProofInput === undefined ||
        !sameCanonical(input.proofInput, preparedProofInput)
      ) {
        return stale();
      }
      const facts = factsFor(record.value, input.changeSet, input.proof);
      return facts === undefined ? stale() : ok(facts);
    },

    async apply({ changeSet, approval }: Parameters<EngineeringFileMutationSessionV2["apply"]>[0]) {
      if (
        approval.schemaVersion !== "2.0" ||
        approval.decision !== "apply_selected" ||
        approval.authorizationId === undefined ||
        approval.reservationTransactionId === undefined
      ) {
        return unavailable("ENGINEERING_MUTATION_SHARED_AUTHORIZATION_REQUIRED");
      }
      const pending = await buildPendingApply(changeSet, approval);
      if (!pending.ok) return pending;
      let releaseActiveReservation: (() => void) | undefined;
      if (options.activateAuthorizationReservation !== undefined) {
        try {
          releaseActiveReservation = options.activateAuthorizationReservation({
            authorizationId: approval.authorizationId,
            transactionId: approval.reservationTransactionId
          });
        } catch {
          return unavailable("ENGINEERING_MUTATION_RESERVATION_HANDOFF_UNAVAILABLE");
        }
        if (releaseActiveReservation === undefined) {
          return unavailable("ENGINEERING_MUTATION_RESERVATION_HANDOFF_UNAVAILABLE");
        }
      }
      pendingByTransaction.set(approval.reservationTransactionId, pending.value);
      try {
        let applied: Result<EngineeringMutationRuntimeResultV2, UnifiedError>;
        try {
          applied = await runtime.apply(runtimeRequest(pending.value));
        } catch {
          const reconciled = await reconcileFailedAuthorizationReservation(pending.value);
          return reconciled.ok
            ? unavailable("ENGINEERING_MUTATION_RUNTIME_APPLY_FAILED")
            : reservationReconciliationRequired(reconciled.error);
        }
        if (!applied.ok) {
          const reconciled = await reconcileFailedAuthorizationReservation(pending.value);
          return reconciled.ok ? applied : reservationReconciliationRequired(reconciled.error);
        }
        try {
          const marked = await options.proposalRepository.markApplied(
            pending.value.record.proposalId
          );
          if (!marked.ok) return postCommitRecoveryRequired("mark_applied", marked.error);
        } catch {
          return postCommitRecoveryRequired("mark_applied");
        }
        try {
          const consumed = await options.authorizationLedger.consume(
            approval.authorizationId,
            approval.reservationTransactionId
          );
          if (!consumed.ok)
            return postCommitRecoveryRequired("consume_authorization", consumed.error);
        } catch {
          return postCommitRecoveryRequired("consume_authorization");
        }
        const versionGroupId = `engineering-version-group-${sha256EngineeringMutationTextV2(
          applied.value.transactionId
        )}`;
        return ok({
          schemaVersion: "2.0",
          status: "committed",
          transactionStatus: "committed",
          versionGroupId,
          operationKind: pending.value.record.operationKind,
          operations: [
            {
              operationKind: pending.value.record.operationKind,
              relativePaths: [pending.value.record.relativeIdentity]
            }
          ]
        });
      } finally {
        pendingByTransaction.delete(approval.reservationTransactionId);
        releaseActiveReservation?.();
      }
    },

    async reject({
      changeSet
    }: Parameters<NonNullable<EngineeringFileMutationSessionV2["reject"]>>[0]) {
      const record = await currentRecord(changeSet);
      if (!record.ok) return record;
      const rejected = await options.proposalRepository.reject(record.value.proposalId);
      return rejected.ok ? ok(undefined) : rejected;
    }
  });

  return Object.freeze({ session, runtime, refRegistry });

  async function reconcileFailedAuthorizationReservation(
    pending: PendingApply
  ): Promise<Result<"revoked" | "prepared", UnifiedError>> {
    try {
      return await options.reconcileFailedAuthorizationReservation({
        authorizationId: pending.approval.authorizationId,
        transactionId: pending.approval.reservationTransactionId,
        contentRootBindingId: pending.record.contentRootBindingId
      });
    } catch {
      return unavailable("ENGINEERING_MUTATION_RESERVATION_RECONCILIATION_UNAVAILABLE");
    }
  }

  async function prepareReplace(input: Parameters<EngineeringFileMutationSessionV2["prepare"]>[0]) {
    const fileRef = readString(input.arguments, "fileRef");
    const range = readRange(input.arguments);
    const replacement = readString(input.arguments, "replacement");
    if (fileRef === undefined || range === undefined || replacement === undefined) return invalid();
    const ref = refRegistry.resolveCurrentBoundary({
      opaqueRef: fileRef,
      expectedKind: "file",
      expectedRootBindingId: options.contentRootBindingId,
      expectedPathPolicyRevision: options.pathPolicyRevision,
      expectedCapabilityRevision: options.refCapabilityRevision
    });
    if (ref === undefined) return stale();
    const snapshot = await options.proposalPort.inspectProposalSnapshot({
      relativeIdentity: ref.relativeIdentity
    });
    if (!snapshot.ok) return snapshot;
    if (snapshot.value.state !== "present") return stale();
    if (snapshot.value.rootBindingId !== options.contentRootBindingId) return stale();
    if (
      textSnapshotRefChecksum(
        snapshot.value,
        options.contentRootBindingId,
        options.pathPolicyRevision
      ) !== ref.sourceNativeRefChecksum
    ) {
      return stale();
    }
    const candidate = spliceCandidate(
      snapshot.value.bytes,
      snapshot.value.manifest.bom,
      range,
      replacement
    );
    if (!candidate.ok) return candidate;
    const candidateManifest = createEngineeringRawByteManifestV2({
      identity: {
        kind: "target",
        rootBindingId: options.contentRootBindingId,
        relativeIdentity: ref.relativeIdentity,
        fileIdentity: null
      },
      bytes: candidate.value,
      metadataChecksum: snapshot.value.manifest.metadataChecksum
    });
    const beforeBlob = await options.blobStore.put({
      contentRootBindingId: options.contentRootBindingId,
      bytes: snapshot.value.bytes
    });
    if (!beforeBlob.ok) return beforeBlob;
    const candidateBlob = await options.blobStore.put({
      contentRootBindingId: options.contentRootBindingId,
      bytes: candidate.value
    });
    if (!candidateBlob.ok) return candidateBlob;
    const operationId = ref.relativeIdentity;
    return ok({
      record: {
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        proposalId: `engineering-proposal-${randomId()}`,
        runId: input.runId,
        projectId: input.projectId,
        toolCallId: input.toolCallId,
        canonicalPayloadChecksum: input.canonicalPayloadChecksum,
        operationKind: "replace_file" as const,
        contentRootBindingId: options.contentRootBindingId,
        pathPolicyRevision: options.pathPolicyRevision,
        policyRevision: input.boundary.policyRevision,
        capabilityRevision: input.boundary.capabilityRevision,
        providerSemanticVersionSetChecksum: input.boundary.providerSemanticVersionSetChecksum,
        approvalRuleSetVersion: input.boundary.approvalRuleSetVersion,
        approvalRuleSetChecksum: input.boundary.approvalRuleSetChecksum,
        relativeIdentity: ref.relativeIdentity,
        sourceRef: fileRef,
        targetRef: fileRef,
        before: {
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          kind: "present" as const,
          manifest: snapshot.value.manifest,
          blob: beforeBlob.value
        },
        candidate: {
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          manifest: candidateManifest,
          blob: candidateBlob.value
        },
        operationId,
        stagingObjectId: `engineering-stage-${randomId()}`
      }
    });
  }

  async function prepareCreate(input: Parameters<EngineeringFileMutationSessionV2["prepare"]>[0]) {
    const parentRef = readString(input.arguments, "parentRef");
    const name = readString(input.arguments, "name");
    const candidateText = readString(input.arguments, "candidate");
    if (parentRef === undefined || name === undefined || candidateText === undefined) {
      return invalid();
    }
    const parent = refRegistry.resolveCurrentBoundary({
      opaqueRef: parentRef,
      expectedKind: "directory",
      expectedRootBindingId: options.contentRootBindingId,
      expectedPathPolicyRevision: options.pathPolicyRevision,
      expectedCapabilityRevision: options.refCapabilityRevision
    });
    if (parent === undefined) return stale();
    const relativeIdentity =
      parent.relativeIdentity.length === 0 ? name : `${parent.relativeIdentity}/${name}`;
    const absence = await options.proposalPort.observeCreateAbsence({
      relativeIdentity,
      observedAt: now()
    });
    if (!absence.ok) return absence;
    const candidateBytes = new TextEncoder().encode(candidateText);
    const candidateManifest = createEngineeringRawByteManifestV2({
      identity: {
        kind: "target",
        rootBindingId: options.contentRootBindingId,
        relativeIdentity,
        fileIdentity: null
      },
      bytes: candidateBytes,
      metadataChecksum: CREATE_SAFE_METADATA_CHECKSUM
    });
    const candidateBlob = await options.blobStore.put({
      contentRootBindingId: options.contentRootBindingId,
      bytes: candidateBytes
    });
    if (!candidateBlob.ok) return candidateBlob;
    const operationId = `engineering-create-${randomId()}`;
    const targetRef = `engineering_file_ref:${randomBytes(32).toString("hex")}`;
    return ok({
      record: {
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        proposalId: `engineering-proposal-${randomId()}`,
        runId: input.runId,
        projectId: input.projectId,
        toolCallId: input.toolCallId,
        canonicalPayloadChecksum: input.canonicalPayloadChecksum,
        operationKind: "create_file" as const,
        contentRootBindingId: options.contentRootBindingId,
        pathPolicyRevision: options.pathPolicyRevision,
        policyRevision: input.boundary.policyRevision,
        capabilityRevision: input.boundary.capabilityRevision,
        providerSemanticVersionSetChecksum: input.boundary.providerSemanticVersionSetChecksum,
        approvalRuleSetVersion: input.boundary.approvalRuleSetVersion,
        approvalRuleSetChecksum: input.boundary.approvalRuleSetChecksum,
        relativeIdentity,
        sourceRef: parentRef,
        targetRef,
        before: {
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          kind: "absent" as const,
          absenceProof: absence.value
        },
        candidate: {
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          manifest: candidateManifest,
          blob: candidateBlob.value
        },
        operationId,
        stagingObjectId: `engineering-stage-${randomId()}`
      }
    });
  }

  async function currentRecord(
    changeSet: ChangeSetV2
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    const scan = await options.proposalRepository.scan();
    if (!scan.ok) return scan;
    if (scan.value.unknownObjectCount !== 0 || scan.value.authenticationFailureCount !== 0) {
      return stale();
    }
    const matches = scan.value.proposals.filter(
      (record) =>
        record.changeSetBinding?.changeSetId === changeSet.changeSetId &&
        record.changeSetBinding.revision === changeSet.revision &&
        record.changeSetBinding.checksum === changeSet.checksum
    );
    return matches.length === 1 && matches[0]?.status === "proposed" ? ok(matches[0]) : stale();
  }

  async function buildPendingApply(
    changeSet: ChangeSetV2,
    approval: ChangeSetApprovalV2
  ): Promise<Result<PendingApply, UnifiedError>> {
    const record = await currentRecord(changeSet);
    if (!record.ok) return record;
    const proof = await options.readApprovalDecisionProof(
      changeSet.runId,
      approval.binding.proofId
    );
    if (!proof.ok) return proof;
    if (proof.value === undefined) return stale();
    const facts = factsFor(record.value, changeSet, proof.value);
    if (facts === undefined) return stale();
    const authorizationId = approval.authorizationId;
    const reservationTransactionId = approval.reservationTransactionId;
    if (authorizationId === undefined || reservationTransactionId === undefined) {
      return unavailable("ENGINEERING_MUTATION_SHARED_AUTHORIZATION_REQUIRED");
    }
    const reservedApproval: ReservedChangeSetApprovalV2 = Object.freeze({
      ...approval,
      authorizationId,
      reservationTransactionId
    });
    const authorized = await validateEngineeringApprovalApplyV2({
      schemaVersion: ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
      trustedApprovalQualified: options.trustedApprovalQualified(),
      changeSet,
      facts,
      binding: approval.binding,
      authorizationId,
      reservationTransactionId,
      ledger: options.authorizationLedger
    });
    if (!authorized.ok) return authorized;
    const transactionInput = await transactionInputFor(record.value, reservedApproval);
    if (!transactionInput.ok) return transactionInput;
    return ok({
      record: record.value,
      changeSet,
      approval: reservedApproval,
      facts,
      transactionInput: transactionInput.value
    });
  }

  async function transactionInputFor(
    record: EngineeringMutationProposalRecordV2,
    approval: ReservedChangeSetApprovalV2
  ): Promise<Result<EngineeringWriteTransactionInputV2, UnifiedError>> {
    const candidate = await options.blobStore.get(record.candidate.blob);
    if (!candidate.ok) return candidate;
    let transactionBefore: EngineeringWriteTransactionInputV2["operations"][number]["before"];
    if (record.before.kind === "present") {
      const before = await options.blobStore.get(record.before.blob);
      if (!before.ok) return before;
      transactionBefore = {
        kind: "present",
        manifest: record.before.manifest,
        bytes: before.value
      };
    } else {
      transactionBefore = {
        kind: "absent",
        absenceProof: record.before.absenceProof
      };
    }
    const transactionId = approval.reservationTransactionId;
    const request = requestFor(record, transactionId);
    const approvalChecksum = approvalBindingV2Checksum(approval.binding);
    const input: EngineeringWriteTransactionInputV2 = {
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      transactionId,
      contentRootBindingId: record.contentRootBindingId,
      providerSemanticVersionSetChecksum: record.providerSemanticVersionSetChecksum,
      authorization: {
        authorizationId: approval.authorizationId,
        approvalBindingId: approval.binding.bindingId,
        approvalBindingChecksum: approvalChecksum,
        sideEffectSubjectChecksum: engineeringSideEffectSubjectChecksumV2({
          transactionId,
          contentRootBindingId: record.contentRootBindingId,
          providerSemanticVersionSetChecksum: record.providerSemanticVersionSetChecksum,
          operations: [request]
        }),
        changeSetId: approval.binding.changeSetId,
        changeSetRevision: approval.binding.changeSetRevision,
        changeSetChecksum: approval.binding.changeSetChecksum
      },
      operations: [
        {
          operationKind: record.operationKind,
          operationId: record.operationId,
          relativeIdentity: record.relativeIdentity,
          before: transactionBefore,
          candidate: { manifest: record.candidate.manifest, bytes: candidate.value },
          stagingObjectId: record.stagingObjectId
        }
      ],
      preparedAt: record.createdAt
    };
    return ok(input);
  }
}

async function preparedProjection(
  record: EngineeringMutationProposalRecordV2,
  args: JsonObject,
  blobStore: EngineeringMutationBlobStoreV2
): Promise<Result<EngineeringPreparedFileMutationProposalV2, UnifiedError>> {
  if (record.operationKind === "replace_file") {
    const range = readRange(args);
    const replacement = readString(args, "replacement");
    if (range === undefined || replacement === undefined || record.before.kind !== "present") {
      return invalid();
    }
    const beforeBytes = await blobStore.get(record.before.blob);
    if (!beforeBytes.ok) return beforeBytes;
    let baseContent: string;
    try {
      baseContent = decodeRaw(record.before, beforeBytes.value);
    } catch {
      return invalid();
    }
    return ok({
      schemaVersion: ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION,
      proposalId: record.proposalId,
      toolCallId: record.toolCallId,
      canonicalPayloadChecksum: record.canonicalPayloadChecksum,
      operationKind: record.operationKind,
      relativeIdentity: record.relativeIdentity,
      changeSetMutation: {
        kind: "replace_file",
        path: record.relativeIdentity,
        range,
        baseHash: checksumChangeSetText(baseContent),
        replacement
      }
    });
  }
  const candidate = readString(args, "candidate");
  if (candidate === undefined) return invalid();
  return ok({
    schemaVersion: ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION,
    proposalId: record.proposalId,
    toolCallId: record.toolCallId,
    canonicalPayloadChecksum: record.canonicalPayloadChecksum,
    operationKind: record.operationKind,
    relativeIdentity: record.relativeIdentity,
    changeSetMutation: {
      kind: "create_file",
      operation: {
        operationId: record.operationId,
        kind: "create_file",
        relativePath: record.relativeIdentity,
        content: candidate,
        toolCallIdempotencyKey: record.toolCallId,
        selected: true
      }
    }
  });
}

function proofInput(
  record: EngineeringMutationProposalRecordV2
): EngineeringApprovalProofInputV2 | undefined {
  const changeSetBinding = record.changeSetBinding;
  if (changeSetBinding === null) return undefined;
  return Object.freeze({
    schemaVersion: ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION,
    operationKind: record.operationKind,
    rootBindingId: record.contentRootBindingId,
    selectionChecksum: changeSetBinding.selectionChecksum,
    proposalPayloadChecksum: record.proposalPayloadChecksum,
    baseManifestChecksum:
      record.before.kind === "present"
        ? engineeringRawByteManifestChecksumV2(record.before.manifest)
        : record.before.absenceProof.absenceProofChecksum,
    candidateManifestChecksum: engineeringRawByteManifestChecksumV2(record.candidate.manifest),
    evidence: Object.freeze({
      pathClass: "ordinary",
      targetFreshness: "clean_stable",
      createOnly: record.operationKind === "create_file" ? "proven" : "not_applicable",
      referenceImpact: "not_applicable",
      limits: "within",
      stateBoundary: "ordinary"
    }) as EngineeringApprovalProofInputV2["evidence"]
  });
}

function factsFor(
  record: EngineeringMutationProposalRecordV2,
  changeSet: ChangeSetV2,
  proof: MainOnlyApprovalDecisionProofV1
): EngineeringApprovalBindingFactsV2 | undefined {
  const binding = record.changeSetBinding;
  if (binding === null) return undefined;
  const proofFacts = proofInput(record);
  if (proofFacts === undefined) return undefined;
  if (
    proof.binding.rootBindingId !== record.contentRootBindingId ||
    proof.binding.proposalPayloadChecksum !== record.proposalPayloadChecksum ||
    proof.binding.baseManifestChecksum !== proofFacts.baseManifestChecksum ||
    proof.binding.candidateManifestChecksum !== proofFacts.candidateManifestChecksum
  ) {
    return undefined;
  }
  const before = record.before.kind === "present" ? record.before.manifest : undefined;
  return Object.freeze({
    schemaVersion: ENGINEERING_FILE_APPROVAL_V2_SCHEMA_VERSION,
    workspaceBindingId: proof.binding.workspaceBindingId,
    rootBindingId: record.contentRootBindingId,
    operationKind: record.operationKind,
    relativeIdentity: record.relativeIdentity,
    selectedOperationIds: binding.selectedOperationIds,
    selectionChecksum: binding.selectionChecksum,
    operationOrderChecksum: binding.operationOrderChecksum,
    sourceRef: record.sourceRef,
    targetRef: record.targetRef,
    beforeKind: record.before.kind,
    baseChecksum: before?.sha256 ?? "not_applicable",
    candidateChecksum: record.candidate.manifest.sha256,
    baseManifestChecksum: proofFacts.baseManifestChecksum,
    candidateManifestChecksum: proofFacts.candidateManifestChecksum,
    encoding: "utf-8",
    bom: before?.bom === "utf-8" ? "present" : "absent",
    eol: approvalEol((before ?? record.candidate.manifest).eol),
    approvalRuleSetVersion: record.approvalRuleSetVersion,
    approvalRuleSetChecksum: record.approvalRuleSetChecksum,
    proof,
    proposalPayloadChecksum: record.proposalPayloadChecksum,
    executionWritePolicy: changeSet.writePolicy ?? "write_before_confirmation",
    policyRevision: record.policyRevision,
    capabilityRevision: record.capabilityRevision,
    providerSemanticVersionSetChecksum: record.providerSemanticVersionSetChecksum
  });
}

function validateCurrentBoundary(
  record: EngineeringMutationProposalRecordV2,
  input: {
    readonly changeSet: ChangeSetV2;
    readonly boundary: {
      readonly policyRevision: string;
      readonly providerSemanticVersionSetChecksum: string;
    };
    readonly workspaceBindingId: string;
    readonly approvalRuleSet: {
      readonly version: string;
      readonly checksum: string;
      readonly catalogRevision: string;
    };
  },
  expectedRootBindingId: string,
  expectedWorkspaceBindingId: string,
  expectedPathPolicyRevision: string
): Result<void, UnifiedError> {
  return record.changeSetBinding !== null &&
    record.contentRootBindingId === expectedRootBindingId &&
    record.pathPolicyRevision === expectedPathPolicyRevision &&
    record.policyRevision === input.boundary.policyRevision &&
    record.providerSemanticVersionSetChecksum ===
      input.boundary.providerSemanticVersionSetChecksum &&
    record.providerSemanticVersionSetChecksum ===
      input.changeSet.providerSemanticVersionSetChecksum &&
    record.capabilityRevision === input.approvalRuleSet.catalogRevision &&
    record.approvalRuleSetVersion === input.approvalRuleSet.version &&
    record.approvalRuleSetChecksum === input.approvalRuleSet.checksum &&
    input.workspaceBindingId === expectedWorkspaceBindingId
    ? ok(undefined)
    : stale();
}

function runtimeRequest(pending: PendingApply) {
  const binding = pending.approval.binding;
  return {
    schemaVersion: "2.0" as const,
    operationKind: pending.record.operationKind,
    contentRootBindingId: pending.record.contentRootBindingId,
    relativeIdentities: [pending.record.relativeIdentity],
    proposalRevision: `proposal:${pending.record.recordChecksum}`,
    proposalBindingChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(pending.record.changeSetBinding)
    ),
    approvalBindingId: binding.bindingId,
    approvalBindingChecksum: approvalBindingV2Checksum(binding),
    capabilityRevision: pending.record.capabilityRevision,
    transactionInput: pending.transactionInput
  };
}

function requestFor(
  record: EngineeringMutationProposalRecordV2,
  transactionId: string
): EngineeringFileMutationRequestV2 {
  return {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    operationKind: record.operationKind,
    contentRootBindingId: record.contentRootBindingId,
    transactionId,
    operationId: record.operationId,
    providerSemanticVersionSetChecksum: record.providerSemanticVersionSetChecksum,
    relativeIdentity: record.relativeIdentity,
    before: record.before,
    candidate: record.candidate,
    stagingObjectId: record.stagingObjectId
  };
}

function spliceCandidate(
  bytes: Uint8Array,
  bom: "none" | "utf-8",
  range: { readonly unit: "character"; readonly start: number; readonly end: number },
  replacement: string
): Result<Uint8Array, UnifiedError> {
  const bomLength = bom === "utf-8" ? 3 : 0;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(bomLength)
    );
  } catch {
    return invalid();
  }
  if (
    range.start > range.end ||
    range.end > text.length ||
    splitsSurrogate(text, range.start) ||
    splitsSurrogate(text, range.end)
  ) {
    return invalid();
  }
  const eol = detectEol(text);
  if (
    (eol === "mixed" && /[\r\n]/u.test(replacement)) ||
    (eol === "crlf" && /(^|[^\r])\n|\r(?!\n)/u.test(replacement)) ||
    (eol === "lf" && /\r/u.test(replacement))
  ) {
    return invalid();
  }
  const start = bomLength + new TextEncoder().encode(text.slice(0, range.start)).byteLength;
  const end = bomLength + new TextEncoder().encode(text.slice(0, range.end)).byteLength;
  const inserted = new TextEncoder().encode(replacement);
  const candidate = new Uint8Array(start + inserted.byteLength + bytes.byteLength - end);
  candidate.set(bytes.subarray(0, start), 0);
  candidate.set(inserted, start);
  candidate.set(bytes.subarray(end), start + inserted.byteLength);
  return ok(candidate);
}

function decodeRaw(
  before: Extract<EngineeringMutationProposalRecordV2["before"], { readonly kind: "present" }>,
  bytes: Uint8Array
): string {
  const offset = before.manifest.bom === "utf-8" ? 3 : 0;
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset));
}

function textSnapshotRefChecksum(
  snapshot: {
    readonly relativeIdentity: string;
    readonly bytes: Uint8Array;
    readonly manifest: { readonly sha256: string; readonly byteLength: number };
  },
  rootBindingId: string,
  pathPolicyRevision: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "text_snapshot",
        binding: {
          rootBindingId,
          pathPolicyRevision
        },
        relativeIdentity: snapshot.relativeIdentity,
        byteLength: snapshot.manifest.byteLength,
        sha256: snapshot.manifest.sha256
      })
    )
    .digest("hex");
}

function selectionChecksumFor(changeSet: ChangeSetV2): string | undefined {
  const groupIds = [
    ...changeSet.files
      .filter((file) => file.selected && file.hunks.some((hunk) => hunk.selected))
      .flatMap((file) => (file.consistencyGroupId === undefined ? [] : [file.consistencyGroupId])),
    ...(changeSet.operations ?? [])
      .filter((operation) => operation.selected !== false)
      .flatMap((operation) =>
        operation.consistencyGroupId === undefined ? [] : [operation.consistencyGroupId]
      )
  ];
  try {
    return checksumChangeSetSelection(changeSet, groupIds);
  } catch {
    return undefined;
  }
}

function selectedIds(changeSet: ChangeSetV2): readonly string[] {
  return [
    ...changeSet.files.filter((file) => file.selected).map((file) => file.relativePath),
    ...(changeSet.operations ?? [])
      .filter((operation) => operation.selected !== false)
      .map((operation) => operation.operationId)
  ];
}

function readRange(value: JsonObject) {
  const range = value["range"];
  if (
    range === null ||
    typeof range !== "object" ||
    Array.isArray(range) ||
    range["unit"] !== "character" ||
    !Number.isSafeInteger(range["start"]) ||
    !Number.isSafeInteger(range["end"])
  ) {
    return undefined;
  }
  return {
    unit: "character" as const,
    start: range["start"] as number,
    end: range["end"] as number
  };
}

function readString(value: JsonObject, key: string): string | undefined {
  const result = value[key];
  return typeof result === "string" ? result : undefined;
}

function readTransactionId(value: unknown): string | undefined {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)["transactionId"] === "string"
    ? ((value as Record<string, unknown>)["transactionId"] as string)
    : undefined;
}

function detectEol(value: string): "none" | "lf" | "crlf" | "mixed" {
  const hasCrLf = /\r\n/u.test(value);
  const withoutCrLf = value.replaceAll("\r\n", "");
  const hasLf = /\n/u.test(withoutCrLf);
  const hasCr = /\r/u.test(withoutCrLf);
  if (!hasCrLf && !hasLf && !hasCr) return "none";
  if (hasCr || (hasCrLf && hasLf)) return "mixed";
  return hasCrLf ? "crlf" : "lf";
}

function approvalEol(value: "none" | "lf" | "crlf" | "mixed") {
  return value === "none" ? ("not_applicable" as const) : value;
}

function splitsSurrogate(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return false;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function invalid<T = never>(): Result<T, UnifiedError> {
  return err(engineeringError("ENGINEERING_FILE_MUTATION_V2_ARGUMENTS_INVALID"));
}

function stale<T = never>(): Result<T, UnifiedError> {
  return err(engineeringError("ENGINEERING_FILE_MUTATION_V2_STALE"));
}

function conflict<T = never>(): Result<T, UnifiedError> {
  return err(engineeringError("ENGINEERING_TOOL_CALL_ID_PAYLOAD_CONFLICT"));
}

function unavailable<T = never>(code: string): Result<T, UnifiedError> {
  return err(engineeringError(code));
}

function postCommitRecoveryRequired<T = never>(
  failedFinalization: "mark_applied" | "consume_authorization",
  cause?: UnifiedError
): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_FILE_MUTATION_V2_POST_COMMIT_RECOVERY_REQUIRED",
      category: "StorageError",
      message:
        "The Engineering mutation committed to disk, but its approval finalization did not complete.",
      recoverability: "user-action",
      suggestedAction:
        "Do not retry the mutation. Keep the root blocked and resolve the committed transaction through recovery.",
      traceId: "desktop-engineering-file-mutation-session-v2",
      redactedDetail: {
        diskCommitted: true,
        recoveryRequired: true,
        failedFinalization,
        ...(cause === undefined ? {} : { causeCode: cause.code })
      }
    })
  );
}

function reservationReconciliationRequired<T = never>(
  cause?: UnifiedError
): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_FILE_MUTATION_V2_RESERVATION_RECONCILIATION_REQUIRED",
      category: "StorageError",
      message:
        "The Engineering mutation did not complete and its reserved authorization could not be reconciled safely.",
      recoverability: "user-action",
      suggestedAction:
        "Do not retry the mutation. Keep the root blocked until recovery verifies the reservation and WAL state.",
      traceId: "desktop-engineering-file-mutation-session-v2",
      redactedDetail: {
        diskCommitted: false,
        recoveryRequired: true,
        failedFinalization: "reconcile_authorization_reservation",
        ...(cause === undefined ? {} : { causeCode: cause.code })
      }
    })
  );
}

function engineeringError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "Engineering file mutation V2 is unavailable or stale.",
    recoverability: "user-action",
    suggestedAction: "Refresh the Engineering root and prepare a new reviewed Change Set.",
    traceId: "desktop-engineering-file-mutation-session-v2"
  });
}
