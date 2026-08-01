import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  checksumChangeSetText,
  inspectChangeSetConsistencyGroups,
  type ChangeSet
} from "./change-set.js";

export interface ChangeSetApprovalBinding {
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly approvalToken: string;
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
