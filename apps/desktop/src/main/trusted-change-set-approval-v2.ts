import { randomBytes } from "node:crypto";

import {
  approvalDecisionProofChecksum,
  checksumChangeSetSelection,
  checksumChangeSetText,
  createApprovalBindingV2,
  type ApprovalBindingV2Bom,
  type ApprovalBindingV2Eol,
  type ApprovalBindingV2Encoding,
  type ChangeSetOperation,
  type ChangeSetV2,
  type DecideChangeSetApprovalV2Input,
  type ProviderVisibleWriteOperation
} from "@novel-studio/agent-engine";
import type {
  AgentRunChangeSetApprovalV2Port,
  AgentRunChangeSetApprovalV2ApprovalContext
} from "@novel-studio/application";
import { buildEngineeringApprovalBindingV2 } from "@novel-studio/application";
import type { ApprovalAuthorizationLedger } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createTrustedApprovalSafeDisplayDto,
  type MainApprovalConfirmationCoordinator,
  type TrustedApprovalDisplayOperationV1,
  type TrustedApprovalSafeDisplayDtoV1,
  type TrustedApprovalSurfaceQualificationV1
} from "./agent-approval-confirmation.js";
import type {
  ApprovalModalWindowLike,
  TrustedApprovalModalController
} from "./trusted-approval-modal-window.js";

const APPROVAL_EXPIRY_MS = 5 * 60 * 1_000;

export interface TrustedChangeSetApprovalV2Options {
  readonly authorizationLedger: ApprovalAuthorizationLedger;
  readonly coordinator: Pick<
    MainApprovalConfirmationCoordinator,
    "prepare" | "waitForDecision" | "revoke"
  >;
  readonly modalController: Pick<TrustedApprovalModalController, "open">;
  readonly resolveParentWindow: () => ApprovalModalWindowLike | undefined;
  readonly surfaceQualification: TrustedApprovalSurfaceQualificationV1;
  readonly workspaceLabel: string;
  readonly now?: () => string;
  readonly createTransactionId?: () => string;
}

/**
 * Completes the Main-only half of Change Set 2.0 approval. Renderer input selects only the
 * already-frozen Change Set revision; every binding, preview, capability, and reservation below is
 * reconstructed from Application/Main state.
 */
export function createTrustedChangeSetApprovalV2Port(
  options: TrustedChangeSetApprovalV2Options
): AgentRunChangeSetApprovalV2Port {
  const now = options.now ?? (() => new Date().toISOString());
  const createTransactionId =
    options.createTransactionId ?? (() => `transaction_${randomBytes(16).toString("hex")}`);

  return Object.freeze({
    async prepare(input: Parameters<AgentRunChangeSetApprovalV2Port["prepare"]>[0]) {
      if (input.command.decision !== "apply_selected") {
        return failure(
          "CHANGE_SET_TRUSTED_APPROVAL_DECISION_INVALID",
          "The trusted confirmation surface only authorizes applying the current selection."
        );
      }
      const parent = options.resolveParentWindow();
      if (parent === undefined || parent.isDestroyed()) {
        return failure(
          "CHANGE_SET_TRUSTED_SURFACE_UNAVAILABLE",
          "The Main-owned workbench window is unavailable for confirmation."
        );
      }

      const built = buildTrustedApprovalPreparation({
        changeSet: input.changeSet,
        context: input.approvalContext,
        workspaceLabel: options.workspaceLabel,
        issuedAt: now()
      });
      if (!built.ok) return built;

      const prepared = options.coordinator.prepare({
        parentWebContentsId: parent.webContents.id,
        action: "change_set",
        displayChecksum: built.value.display.displayChecksum,
        display: built.value.display,
        canonicalChecksum: input.changeSet.checksum,
        binding: built.value.binding,
        bundleDigest: options.surfaceQualification.bundleDigest,
        qualificationRevision: options.surfaceQualification.qualificationRevision,
        expiresAt: built.value.binding.expiresAt
      });
      if (!prepared.ok) return prepared;

      const opened = await options.modalController.open(parent, prepared.value.previewId);
      if (!opened.ok) {
        options.coordinator.revoke(prepared.value.previewId, "approval_modal_open_failed");
        return opened;
      }
      const decision = await options.coordinator.waitForDecision(prepared.value.previewId);
      if (!decision.ok) return decision;
      if (decision.value.status !== "issued") {
        return failure(
          decision.value.status === "dismissed"
            ? "CHANGE_SET_TRUSTED_APPROVAL_DISMISSED"
            : "CHANGE_SET_TRUSTED_APPROVAL_REVOKED",
          "The Change Set remains pending because trusted confirmation was not completed."
        );
      }

      const reservationTransactionId =
        input.approvalContext.engineeringReservationTransactionId ?? createTransactionId();
      const reserved = await options.authorizationLedger.reserve({
        authorizationId: decision.value.issued.authorizationId,
        transactionId: reservationTransactionId
      });
      if (!reserved.ok) {
        options.coordinator.revoke(prepared.value.previewId, "authorization_reservation_failed");
        return reserved;
      }

      return ok({
        changeSet: input.changeSet,
        decision: "apply_selected",
        displayBindingChecksum: input.changeSet.displayBindingChecksum,
        binding: built.value.binding,
        authorizationId: decision.value.issued.authorizationId,
        reservationTransactionId,
        trustedConfirmationQualified: true,
        resolvedAt: now()
      } satisfies DecideChangeSetApprovalV2Input);
    }
  });
}

export function buildTrustedApprovalPreparation(input: {
  readonly changeSet: ChangeSetV2;
  readonly context: AgentRunChangeSetApprovalV2ApprovalContext;
  readonly workspaceLabel: string;
  readonly issuedAt: string;
}): Result<
  {
    readonly binding: ReturnType<typeof createApprovalBindingV2>;
    readonly display: TrustedApprovalSafeDisplayDtoV1;
  },
  UnifiedError
> {
  const { changeSet, context } = input;
  const selectedOperationIds = selectedIds(changeSet);
  const expectedSelectionChecksum = selectedSelectionChecksum(changeSet);
  const engineeringFacts = context.engineeringApprovalFacts;
  const engineeringLifecycle =
    engineeringFacts !== undefined &&
    (context.operation === "move_file" ||
      context.operation === "delete_file" ||
      context.operation === "create_directory");
  const engineeringReservationMatches = engineeringLifecycle
    ? typeof context.engineeringReservationTransactionId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(context.engineeringReservationTransactionId)
    : context.engineeringReservationTransactionId === undefined;
  const engineeringFactsMatch =
    engineeringFacts === undefined ||
    (engineeringFacts.workspaceBindingId === context.workspaceBindingId &&
      engineeringFacts.operationKind === context.operation &&
      engineeringFacts.approvalRuleSetVersion === context.approvalRuleSet.version &&
      engineeringFacts.approvalRuleSetChecksum === context.approvalRuleSet.checksum &&
      engineeringFacts.proof.proofId === context.proofRef.proofId &&
      approvalDecisionProofChecksum(engineeringFacts.proof) === context.proofRef.proofChecksum &&
      engineeringFacts.selectionChecksum === context.preview.selectionChecksum &&
      engineeringFacts.baseManifestChecksum === context.preview.baseManifestChecksum &&
      engineeringFacts.candidateManifestChecksum === context.preview.candidateManifestChecksum &&
      engineeringFacts.providerSemanticVersionSetChecksum ===
        context.preview.providerSemanticVersionSetChecksum);
  if (
    selectedOperationIds.length === 0 ||
    context.preview.changeSetId !== changeSet.changeSetId ||
    context.preview.revision !== changeSet.revision ||
    context.preview.checksum !== changeSet.checksum ||
    context.preview.displayBindingChecksum !== changeSet.displayBindingChecksum ||
    context.preview.providerSemanticVersionSetChecksum !==
      changeSet.providerSemanticVersionSetChecksum ||
    context.capabilityBoundary.providerSemanticVersionSetChecksum !==
      changeSet.providerSemanticVersionSetChecksum ||
    expectedSelectionChecksum === undefined ||
    context.preview.selectionChecksum !== expectedSelectionChecksum ||
    !engineeringReservationMatches ||
    !engineeringFactsMatch ||
    !operationMatchesBindingKind(context.operation, context.approvalBindingOperationKind) ||
    changeSet.files.some((file) => file.selected && !file.validation.valid)
  ) {
    return failure(
      "CHANGE_SET_TRUSTED_APPROVAL_CONTEXT_STALE",
      "The frozen approval context does not match the current Change Set."
    );
  }

  const operationKind = context.approvalBindingOperationKind;
  if (operationKind === "chapter_delete") {
    return failure(
      "CHANGE_SET_TRUSTED_APPROVAL_RECOVERY_BINDING_REQUIRED",
      "Delete remains unavailable until its volume-local recovery binding is qualified."
    );
  }

  const selectedFiles = changeSet.files.filter((file) => file.selected);
  const sourceRef = changeSet.domainOperation?.sourceRef ?? refForSelectedTarget(selectedFiles[0]);
  const targetRef =
    changeSet.domainOperation?.targetRef ?? refForSelectedTarget(selectedFiles.at(-1));
  const selectionChecksum =
    changeSet.domainOperation?.selectionChecksum ?? context.preview.selectionChecksum;
  const operationOrderChecksum = checksumChangeSetText(selectedOperationIds.join("\n"));
  const issuedAtMs = Date.parse(input.issuedAt);
  if (!Number.isFinite(issuedAtMs)) {
    return failure(
      "CHANGE_SET_TRUSTED_APPROVAL_CLOCK_INVALID",
      "The Main approval clock is unavailable."
    );
  }
  const expiresAt = new Date(issuedAtMs + APPROVAL_EXPIRY_MS).toISOString();
  const fileBinding = fileEncodingBinding(selectedFiles);

  let binding: ReturnType<typeof createApprovalBindingV2>;
  try {
    if (context.engineeringApprovalFacts !== undefined) {
      const seed = buildEngineeringApprovalBindingV2({
        schemaVersion: "2.0",
        changeSet,
        facts: context.engineeringApprovalFacts,
        issuedAt: input.issuedAt,
        expiresAt
      });
      if (!seed.ok) return seed;
      binding = createApprovalBindingV2(seed.value);
    } else {
      binding = createApprovalBindingV2({
        workspaceBindingId: context.workspaceBindingId,
        rootBindingId: context.capabilityBoundary.canonicalRootIdentityChecksum,
        runId: changeSet.runId,
        changeSetId: changeSet.changeSetId,
        changeSetRevision: changeSet.revision,
        changeSetChecksum: changeSet.checksum,
        providerSemanticVersionSetChecksum: changeSet.providerSemanticVersionSetChecksum,
        operationKind,
        selectionChecksum,
        selectedOperationIds,
        operationOrderChecksum,
        sourceRef,
        targetRef,
        baseChecksum:
          selectedFiles.length === 1
            ? (selectedFiles[0]?.baseChecksum ?? context.preview.baseManifestChecksum)
            : context.preview.baseManifestChecksum,
        candidateChecksum:
          selectedFiles.length === 1
            ? (selectedFiles[0]?.candidateChecksum ?? context.preview.candidateManifestChecksum)
            : context.preview.candidateManifestChecksum,
        baseManifestChecksum: context.preview.baseManifestChecksum,
        candidateManifestChecksum: context.preview.candidateManifestChecksum,
        ...fileBinding,
        approvalRuleSetVersion: context.approvalRuleSet.version,
        approvalRuleSetChecksum: context.approvalRuleSet.checksum,
        proofId: context.proofRef.proofId,
        proofChecksum: context.proofRef.proofChecksum,
        executionWritePolicy: changeSet.writePolicy ?? "write_before_confirmation",
        policyRevision: context.capabilityBoundary.policyRevision,
        capabilityRevision: context.approvalRuleSet.catalogRevision,
        approvalSource: "human_confirmation",
        issuedAt: input.issuedAt,
        expiresAt
      });
    }
  } catch {
    return failure(
      "CHANGE_SET_TRUSTED_APPROVAL_BINDING_INVALID",
      "The Main-owned Approval Binding could not be constructed."
    );
  }

  const display = createTrustedApprovalSafeDisplayDto({
    schemaVersion: "1.0",
    workspaceLabel: input.workspaceLabel,
    changeSetId: changeSet.changeSetId,
    changeSetRevision: changeSet.revision,
    selectedOperations: displayOperations(changeSet, context.operation),
    canonicalDiff: canonicalChangeSetDiff(changeSet),
    recoverySideEffect: recoverySideEffect(changeSet, context.operation)
  });
  return display.ok ? ok({ binding, display: display.value }) : display;
}

/** Recomputes the exact selection identity; a bridge may never recycle a prior selection proof. */
function selectedSelectionChecksum(changeSet: ChangeSetV2): string | undefined {
  if (changeSet.domainOperation !== undefined) {
    const selectedPaths = changeSet.files
      .filter((file) => file.selected)
      .map((file) => file.relativePath);
    return selectedPaths.length === changeSet.domainOperation.selectedRelativePaths.length &&
      selectedPaths.every(
        (path, index) => path === changeSet.domainOperation?.selectedRelativePaths[index]
      ) &&
      changeSet.domainOperation.selectionChecksum ===
        checksumChangeSetText(changeSet.domainOperation.selectedRelativePaths.join("\n"))
      ? changeSet.domainOperation.selectionChecksum
      : undefined;
  }
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

/** The proof operation and apply operation must be an intentional documented projection. */
function operationMatchesBindingKind(
  operation: ProviderVisibleWriteOperation,
  bindingKind: AgentRunChangeSetApprovalV2ApprovalContext["approvalBindingOperationKind"]
): boolean {
  if (bindingKind === "story_bible_mutation") return operation.startsWith("story_bible_");
  if (bindingKind === "chapter_delete") return operation === "chapter_status";
  return operation === bindingKind;
}

function selectedIds(changeSet: ChangeSetV2): readonly string[] {
  return [
    ...changeSet.files.filter((file) => file.selected).map((file) => file.relativePath),
    ...(changeSet.operations ?? [])
      .filter((operation) => operation.selected !== false)
      .map((operation) => operation.operationId)
  ];
}

function refForSelectedTarget(file: ChangeSetV2["files"][number] | undefined): string {
  if (file?.assetType === "chapter" && file.assetId !== undefined) return `chapter:${file.assetId}`;
  if (file?.assetId !== undefined) return `story_bible:${file.assetId}`;
  return file === undefined ? "change_set:not_applicable" : `file:${file.relativePath}`;
}

function fileEncodingBinding(files: readonly ChangeSetV2["files"][number][]): {
  readonly encoding: ApprovalBindingV2Encoding;
  readonly bom: ApprovalBindingV2Bom;
  readonly eol: ApprovalBindingV2Eol;
} {
  if (files.length === 0) {
    return { encoding: "not_applicable", bom: "not_applicable", eol: "not_applicable" };
  }
  const contents = files.flatMap((file) => [file.baseContent, file.candidateContent]);
  const hasBom = contents.some((content) => content.startsWith("\uFEFF"));
  const hasCrLf = contents.some((content) => content.includes("\r\n"));
  const hasBareLf = contents.some((content) => /(^|[^\r])\n/u.test(content));
  return {
    encoding: "utf-8",
    bom: hasBom ? "present" : "absent",
    eol: hasCrLf && hasBareLf ? "mixed" : hasCrLf ? "crlf" : "lf"
  };
}

function displayOperations(
  changeSet: ChangeSetV2,
  operation: ProviderVisibleWriteOperation
): readonly TrustedApprovalDisplayOperationV1[] {
  const fileOperations = changeSet.files
    .filter((file) => file.selected)
    .map((file) => ({
      operationId: file.relativePath,
      operationKind: operation,
      paths: [{ role: "affected" as const, path: file.relativePath }],
      summary: `${file.assetType} candidate ${file.baseChecksum} -> ${file.candidateChecksum}`
    }));
  const lifecycleOperations = (changeSet.operations ?? [])
    .filter((candidate) => candidate.selected !== false)
    .map((candidate) => ({
      operationId: candidate.operationId,
      operationKind: operation,
      paths: displayPaths(candidate),
      summary: operationSummary(candidate)
    }));
  return Object.freeze([...fileOperations, ...lifecycleOperations]);
}

function displayPaths(operation: ChangeSetOperation): TrustedApprovalDisplayOperationV1["paths"] {
  switch (operation.kind) {
    case "modify":
    case "create_file":
    case "delete_file":
    case "create_directory":
      return [{ role: "target", path: operation.relativePath }];
    case "move_file":
      return [
        { role: "source", path: operation.sourcePath },
        { role: "target", path: operation.targetPath }
      ];
  }
}

function operationSummary(operation: ChangeSetOperation): string {
  switch (operation.kind) {
    case "modify":
      return "Modify the selected existing file.";
    case "create_file":
      return `Create a UTF-8 file (${Buffer.byteLength(operation.content, "utf8")} bytes).`;
    case "move_file":
      return `Move the source to the reviewed target; source checksum ${operation.sourceChecksum}.`;
    case "delete_file":
      return `Move the reviewed file to qualified recovery storage; base checksum ${operation.baseChecksum}.`;
    case "create_directory":
      return "Create the reviewed directory.";
  }
}

function canonicalChangeSetDiff(changeSet: ChangeSetV2): string {
  const fileDiffs = changeSet.files
    .filter((file) => file.selected)
    .map((file) =>
      [
        `--- ${file.relativePath} (${file.baseChecksum})`,
        `+++ ${file.relativePath} (${file.candidateChecksum})`,
        "@@ complete base @@",
        file.baseContent,
        "@@ complete candidate @@",
        file.candidateContent
      ].join("\n")
    );
  const operationDiffs = (changeSet.operations ?? [])
    .filter((operation) => operation.selected !== false)
    .map((operation) => `operation ${operation.operationId}: ${JSON.stringify(operation)}`);
  return [...fileDiffs, ...operationDiffs].join("\n\n") || "No selected mutation.";
}

function recoverySideEffect(
  changeSet: ChangeSetV2,
  operation: ProviderVisibleWriteOperation
): string {
  if (operation === "delete_file") {
    return "Delete requires a separately qualified volume-local recovery binding; this preview cannot authorize it.";
  }
  if (operation === "chapter_restore" || operation === "story_bible_restore") {
    return "Restore writes the reviewed historical candidate and records a reversible version group.";
  }
  const paths = selectedIds(changeSet).join(", ");
  return `Apply records a reversible version group for: ${paths}.`;
}

function failure<T = never>(code: string, message: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "AgentError",
      message,
      recoverability: "user-action",
      suggestedAction: "Refresh the current Change Set and open a new trusted confirmation.",
      traceId: "desktop-trusted-change-set-approval-v2"
    })
  );
}
