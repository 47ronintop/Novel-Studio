import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { AgentWritePolicy } from "./agent-run-types.js";
import type { ChangeSet } from "./change-set.js";

export interface ChangeSetApprovalBinding {
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly approvalToken: string;
}

export interface ChangeSetApproval {
  readonly schemaVersion: "1.0";
  readonly decision: "apply_selected" | "reject_all";
  readonly approvalSource: "human_confirmation";
  readonly resolvedAt: string;
  readonly binding: ChangeSetApprovalBinding;
}

export interface DecideChangeSetApprovalInput {
  readonly changeSet: ChangeSet;
  readonly writePolicy: AgentWritePolicy;
  readonly decision: ChangeSetApproval["decision"];
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly resolvedAt: string;
}

export function decideChangeSetApproval(
  input: DecideChangeSetApprovalInput
): Result<ChangeSetApproval, UnifiedError> {
  if (input.writePolicy !== "write_before_confirmation") {
    return failure(
      "CHANGE_SET_WRITE_POLICY_REJECTED",
      "Stage 2 requires explicit human confirmation before every write.",
      "Use the write-before-confirmation policy."
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
    if (selectedFiles.length === 0) {
      return failure(
        "CHANGE_SET_EMPTY_SELECTION",
        "No Change Set hunks are selected.",
        "Select at least one valid hunk or reject the Change Set."
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

  return ok(
    deepFreeze({
      schemaVersion: "1.0",
      decision: input.decision,
      approvalSource: "human_confirmation",
      resolvedAt: input.resolvedAt,
      binding: {
        changeSetId: input.changeSet.changeSetId,
        revision: input.changeSet.revision,
        checksum: input.changeSet.checksum,
        approvalToken: input.changeSet.approvalToken
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
