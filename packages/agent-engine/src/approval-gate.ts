import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  checksumChangeSetText,
  isChangeSetV2,
  inspectChangeSetConsistencyGroups,
  type ChangeSet,
  type ChangeSetV2
} from "./change-set.js";
import {
  parseApprovalBindingV2,
  validateApprovalBindingV2,
  type ApprovalBindingV2,
  type ApprovalBindingV2Source
} from "./approval-binding-v2.js";

export interface ChangeSetApprovalBinding {
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly approvalToken?: string | undefined;
  readonly selectedConsistencyGroupIds?: readonly string[];
  readonly selectionChecksum?: string;
}

export interface ChangeSetApproval {
  readonly schemaVersion: "1.0" | "1.1";
  readonly decision: "apply_selected" | "reject_all";
  readonly approvalSource:
    "human_confirmation" | "user_preapproved_run" | "project_safe_auto_update";
  readonly resolvedAt: string;
  readonly binding: ChangeSetApprovalBinding;
}

export interface ChangeSetApprovalV2 {
  readonly schemaVersion: "2.0";
  readonly decision: "apply_selected" | "reject_all";
  readonly approvalSource: ApprovalBindingV2Source;
  readonly resolvedAt: string;
  readonly displayBindingChecksum: string;
  readonly authorizationId?: string;
  readonly reservationTransactionId?: string;
  readonly binding: ApprovalBindingV2;
}

export interface DecideChangeSetApprovalV2Input {
  readonly changeSet: ChangeSetV2;
  readonly decision: ChangeSetApprovalV2["decision"];
  readonly displayBindingChecksum: string;
  readonly binding: ApprovalBindingV2;
  readonly authorizationId?: string;
  readonly reservationTransactionId?: string;
  /** ADR-0004 qualified Main/isolated confirmation evidence. */
  readonly trustedConfirmationQualified?: boolean;
  readonly resolvedAt: string;
  readonly now?: number;
}

/** Main-owned v2 gate. Renderer-visible display checksums are evidence only. */
export function decideChangeSetApprovalV2(
  input: DecideChangeSetApprovalV2Input
): Result<ChangeSetApprovalV2, UnifiedError> {
  if (!isChangeSetV2(input.changeSet)) {
    return failure(
      "CHANGE_SET_V2_REQUIRED",
      "Only a strict Change Set 2.0 can enter the v2 approval gate.",
      "Regenerate the proposal from the current runtime facts."
    );
  }
  if (input.displayBindingChecksum !== input.changeSet.displayBindingChecksum) {
    return failure(
      "CHANGE_SET_DISPLAY_BINDING_MISMATCH",
      "The approval does not match the displayed Change Set preview.",
      "Refresh the preview and approve the current revision."
    );
  }
  const bindingResult = validateApprovalBindingV2(input.binding, input.now);
  if (!bindingResult.ok) return bindingResult;
  const binding = parseApprovalBindingV2(input.binding);
  if (binding.approvalSource !== "human_confirmation") {
    return failure(
      "CHANGE_SET_TRUSTED_SURFACE_UNAVAILABLE",
      "Limited run preapproval is disabled until the ADR-0004 trusted surface is qualified.",
      "Use a human confirmation from the qualified Main approval surface."
    );
  }
  if (
    binding.workspaceBindingId.length === 0 ||
    binding.rootBindingId.length === 0 ||
    binding.runId !== input.changeSet.runId ||
    binding.changeSetId !== input.changeSet.changeSetId ||
    binding.changeSetRevision !== input.changeSet.revision ||
    binding.changeSetChecksum !== input.changeSet.checksum ||
    binding.providerSemanticVersionSetChecksum !==
      input.changeSet.providerSemanticVersionSetChecksum ||
    binding.executionWritePolicy !== (input.changeSet.writePolicy ?? "write_before_confirmation") ||
    binding.approvalSource !== input.binding.approvalSource
  ) {
    return failure(
      "CHANGE_SET_V2_BINDING_MISMATCH",
      "The Approval Binding 2.0 does not match this Change Set, run, or policy.",
      "Regenerate the binding from the current Main-owned preview."
    );
  }
  const selectedOperationIds = [
    ...input.changeSet.files.filter((file) => file.selected).map((file) => file.relativePath),
    ...(input.changeSet.operations ?? [])
      .filter((operation) => operation.selected !== false)
      .map((operation) => operation.operationId)
  ];
  if (
    input.decision === "apply_selected" &&
    (selectedOperationIds.length === 0 ||
      input.changeSet.files.some((file) => file.selected && !file.validation.valid) ||
      selectedOperationIds.length !== binding.selectedOperationIds.length ||
      selectedOperationIds.some((id, index) => id !== binding.selectedOperationIds[index]))
  ) {
    return failure(
      "CHANGE_SET_V2_SELECTION_INVALID",
      "The selected Change Set operations do not match the signed binding.",
      "Review the exact selection and request a new approval."
    );
  }
  if (
    input.decision === "apply_selected" &&
    (typeof input.authorizationId !== "string" ||
      typeof input.reservationTransactionId !== "string")
  ) {
    return failure(
      "CHANGE_SET_V2_RESERVATION_REQUIRED",
      "Applying a Change Set 2.0 requires a Main-owned authorization reservation.",
      "Reserve the current approval binding before crossing the mutation boundary."
    );
  }
  return ok(
    deepFreeze({
      schemaVersion: "2.0" as const,
      decision: input.decision,
      approvalSource: binding.approvalSource,
      resolvedAt: input.resolvedAt,
      displayBindingChecksum: input.displayBindingChecksum,
      ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId }),
      ...(input.reservationTransactionId === undefined
        ? {}
        : { reservationTransactionId: input.reservationTransactionId }),
      binding
    })
  );
}

export interface DecideChangeSetApprovalInput {
  readonly changeSet: ChangeSet;
  readonly decision: ChangeSetApproval["decision"];
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly resolvedAt: string;
}

export interface ChangeSetGroupApprovalTokenInput {
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly applyBatchId: string;
  readonly consistencyGroupId: string;
  readonly selectionChecksum: string;
}

export function deriveChangeSetGroupApprovalToken(input: ChangeSetGroupApprovalTokenInput): string {
  const approvalToken = checksumChangeSetText(
    `${input.changeSetId}:${input.revision}:${input.checksum}`
  );
  return checksumChangeSetText(
    [
      "change-set-group-approval-v1",
      approvalToken,
      input.applyBatchId,
      input.consistencyGroupId,
      input.selectionChecksum
    ].join(":")
  );
}

export function decideChangeSetApproval(
  input: DecideChangeSetApprovalInput
): Result<ChangeSetApproval, UnifiedError> {
  if (input.changeSet.schemaVersion === "2.0" || input.changeSet.approvalToken === undefined) {
    return failure(
      "CHANGE_SET_V2_APPROVAL_REQUIRED",
      "A Change Set 2.0 cannot be approved with a legacy deterministic token.",
      "Issue a Main-owned Approval Binding 2.0 for the current preview."
    );
  }
  if (
    input.changeSet.changeSetId !== input.changeSetId ||
    input.changeSet.revision !== input.revision ||
    input.changeSet.checksum !== input.checksum
  ) {
    return failure(
      "CHANGE_SET_BINDING_MISMATCH",
      "The approval does not match the displayed Change Set revision.",
      "Refresh the Change Set and decide the current revision."
    );
  }
  if (input.decision === "apply_selected") {
    const selectedFiles = input.changeSet.files.filter((file) => file.selected);
    const selectedOperations = (input.changeSet.operations ?? []).filter(
      (operation) => operation.selected !== false
    );
    if (selectedFiles.length === 0 && selectedOperations.length === 0) {
      return failure(
        "CHANGE_SET_EMPTY_SELECTION",
        "No Change Set files or operations are selected.",
        "Select at least one valid file, operation, or reject the Change Set."
      );
    }
    if (selectedFiles.some((file) => !file.validation.valid)) {
      return failure(
        "CHANGE_SET_INVALID",
        "The selected Change Set content did not pass validation.",
        "Revise the selection or proposal until validation succeeds."
      );
    }
  }

  const consistencyGroups = inspectChangeSetConsistencyGroups(input.changeSet);
  if (consistencyGroups.splitGroupIds.length > 0) {
    return failure(
      "CHANGE_SET_CONSISTENCY_GROUP_SPLIT",
      "A consistency group cannot be partially selected.",
      "Select or reject every change in the consistency group together."
    );
  }
  const groupedBinding =
    consistencyGroups.selectionChecksum === undefined
      ? {}
      : {
          selectedConsistencyGroupIds: consistencyGroups.selectedGroupIds,
          selectionChecksum: consistencyGroups.selectionChecksum
        };

  return ok(
    deepFreeze({
      schemaVersion:
        input.changeSet.schemaVersion === "1.1" || consistencyGroups.allGroupIds.length > 0
          ? "1.1"
          : "1.0",
      decision: input.decision,
      approvalSource: "human_confirmation",
      resolvedAt: input.resolvedAt,
      binding: {
        changeSetId: input.changeSet.changeSetId,
        revision: input.changeSet.revision,
        checksum: input.changeSet.checksum,
        approvalToken: input.changeSet.approvalToken,
        ...groupedBinding
      }
    })
  );
}

function failure(
  code: string,
  message: string,
  suggestedAction: string
): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction,
      traceId: "change-set-approval"
    })
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
