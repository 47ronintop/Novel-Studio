import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  approvalBindingV2Checksum,
  parseApprovalBindingV2,
  validateApprovalBindingV2,
  type ApprovalBindingV2
} from "@novel-studio/agent-engine";
import { TRUSTED_APPROVAL_IPC_CHANNELS } from "@novel-studio/application";
import type { ApprovalAuthorizationLedger } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

/** These channels are intentionally absent from the ordinary workbench preload allowlist. */
export { TRUSTED_APPROVAL_IPC_CHANNELS };

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const TRUSTED_APPROVAL_DISPLAY_LIMITS = Object.freeze({
  workspaceLabelUtf8Bytes: 1_024,
  operationCount: 512,
  pathsPerOperation: 64,
  pathUtf8Bytes: 8_192,
  operationSummaryUtf8Bytes: 16_384,
  canonicalDiffUtf8Bytes: 1_048_576,
  recoverySideEffectUtf8Bytes: 32_768,
  totalUtf8Bytes: 1_572_864
});

export interface TrustedApprovalDisplayPathV1 {
  readonly role: "source" | "target" | "affected" | "recovery";
  readonly path: string;
}

export interface TrustedApprovalDisplayOperationV1 {
  readonly operationId: string;
  readonly operationKind: string;
  readonly paths: readonly TrustedApprovalDisplayPathV1[];
  readonly summary: string;
}

export interface TrustedApprovalDisplayContentV1 {
  readonly schemaVersion: "1.0";
  readonly workspaceLabel: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly selectedOperations: readonly TrustedApprovalDisplayOperationV1[];
  /** Complete canonical diff/plain-text representation. It is never truncated. */
  readonly canonicalDiff: string;
  readonly recoverySideEffect: string;
}

export interface TrustedApprovalSafeDisplayDtoV1 extends TrustedApprovalDisplayContentV1 {
  readonly displayChecksum: string;
}

export interface TrustedApprovalSurfaceQualificationV1 {
  readonly schemaVersion: "1.0";
  readonly status: "qualified";
  readonly bundleDigest: string;
  readonly qualificationRevision: string;
  readonly sourceRevision: string;
  readonly approvalArtifactManifestChecksum: string;
  readonly qualificationMatrixRevision: string;
  readonly qualificationMatrixChecksum: string;
  readonly automatedReportChecksum: string;
  readonly ownerApprovalId: string;
  readonly ownerKeyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly attestationChecksum: string;
}

export interface TrustedApprovalPreviewInput {
  readonly parentWebContentsId: number;
  readonly action: "plan_to_act" | "change_set";
  readonly displayChecksum: string;
  /** Main-owned canonical content. prepare sanitizes and verifies its checksum before storing it. */
  readonly display: TrustedApprovalSafeDisplayDtoV1;
  /** Main's canonical Plan/Change Set checksum; never accepted from modal IPC. */
  readonly canonicalChecksum: string;
  readonly binding: ApprovalBindingV2;
  readonly bundleDigest: string;
  readonly qualificationRevision: string;
  readonly expiresAt: string;
}

export interface TrustedApprovalPreview {
  readonly previewId: string;
  readonly action: TrustedApprovalPreviewInput["action"];
  readonly displayChecksum: string;
  readonly expiresAt: string;
  /** Binds the preview to the complete Main-owned qualification identity. */
  readonly attestationChecksum: string;
}

export interface TrustedApprovalModalPayload extends TrustedApprovalPreview {
  readonly modalInstanceId: string;
  readonly nonce: string;
  readonly display: TrustedApprovalSafeDisplayDtoV1;
}

export interface TrustedApprovalDecision {
  readonly previewId: string;
  readonly modalInstanceId: string;
  readonly nonce: string;
  readonly decision: "approve" | "reject" | "cancel";
}

/** Main-only result. registerTrustedApprovalIpc deliberately does not return it to the modal. */
export interface TrustedApprovalIssued {
  readonly authorizationId: string;
  readonly humanIntentEvidenceId: string;
  readonly displayChecksum: string;
  readonly bindingChecksum: string;
}

export type TrustedApprovalMainDecision =
  | { readonly status: "issued"; readonly issued: TrustedApprovalIssued }
  | { readonly status: "dismissed"; readonly reason: "reject" | "cancel" | "native_cancel" }
  | { readonly status: "revoked"; readonly reason: string };

export interface MainOnlyHumanIntentEvidenceV1 {
  readonly schemaVersion: "1.0";
  readonly source: "main_owned_isolated_modal_v1";
  readonly evidenceId: string;
  readonly authorizationId: string;
  readonly previewId: string;
  readonly action: TrustedApprovalPreviewInput["action"];
  readonly parentWebContentsId: number;
  readonly modalWebContentsId: number;
  readonly modalInstanceId: string;
  readonly nonce: string;
  readonly createdAt: string;
  readonly displayedAt: string;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly workspaceBindingId: string;
  readonly rootBindingId: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly selectedOperationIds: readonly string[];
  readonly selectionChecksum: string;
  readonly operationOrderChecksum: string;
  readonly displayChecksum: string;
  readonly canonicalChecksum: string;
  readonly bindingChecksum: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly capabilityRevision: string;
  readonly policyRevision: string;
  readonly bundleDigest: string;
  readonly qualificationRevision: string;
  readonly sourceRevision: string;
  readonly approvalArtifactManifestChecksum: string;
  readonly qualificationMatrixRevision: string;
  readonly qualificationMatrixChecksum: string;
  readonly automatedReportChecksum: string;
  readonly ownerApprovalId: string;
  readonly ownerKeyId: string;
  readonly issuedAt: string;
  readonly qualificationExpiresAt: string;
  readonly attestationChecksum: string;
  readonly recoveryRootBindingId?: string;
  readonly recoveryGrantRevision?: string;
  readonly recoverySideEffectChecksum?: string;
}

/** Durable, Main-only journal. It must never be projected into Renderer or Provider state. */
export interface MainOnlyHumanIntentEvidenceJournal {
  issue(evidence: MainOnlyHumanIntentEvidenceV1): Promise<Result<void, UnifiedError>>;
  revoke(evidenceId: string, reason: string): Promise<Result<void, UnifiedError>>;
}

export interface MainApprovalConfirmationOptions {
  readonly authorizationLedger: ApprovalAuthorizationLedger;
  readonly nativeConfirm: (preview: TrustedApprovalPreview) => Promise<boolean>;
  /** App-owned attestation lookup. Caller-supplied preview claims never qualify a surface. */
  readonly getSurfaceQualification?: () => TrustedApprovalSurfaceQualificationV1 | undefined;
  /** Required before a qualified surface can issue an authorization. */
  readonly humanIntentEvidenceJournal?: MainOnlyHumanIntentEvidenceJournal;
  readonly now?: () => string;
  readonly createId?: () => string;
}

/**
 * Builds the only display DTO accepted by the trusted modal. Text is normalized and
 * dangerous/invisible code points are rendered as visible escapes; content is never truncated.
 */
export function createTrustedApprovalSafeDisplayDto(
  input: TrustedApprovalDisplayContentV1
): Result<TrustedApprovalSafeDisplayDtoV1, UnifiedError> {
  if (
    !isExactRecord(input, [
      "schemaVersion",
      "workspaceLabel",
      "changeSetId",
      "changeSetRevision",
      "selectedOperations",
      "canonicalDiff",
      "recoverySideEffect"
    ])
  ) {
    return invalidDisplay("Trusted approval display content has an invalid shape.");
  }
  if (
    input.schemaVersion !== "1.0" ||
    !isNonEmptyString(input.workspaceLabel) ||
    !isStableId(input.changeSetId) ||
    !Number.isSafeInteger(input.changeSetRevision) ||
    input.changeSetRevision < 1 ||
    !Array.isArray(input.selectedOperations) ||
    input.selectedOperations.length === 0 ||
    !isNonEmptyString(input.canonicalDiff) ||
    !isNonEmptyString(input.recoverySideEffect)
  ) {
    return invalidDisplay("Trusted approval display content is missing a required value.");
  }
  if (input.selectedOperations.length > TRUSTED_APPROVAL_DISPLAY_LIMITS.operationCount) {
    return displayTooLarge();
  }

  const workspaceLabel = escapeApprovalDisplayText(input.workspaceLabel);
  const canonicalDiff = escapeApprovalDisplayText(input.canonicalDiff);
  const recoverySideEffect = escapeApprovalDisplayText(input.recoverySideEffect);
  if (
    exceeds(workspaceLabel, TRUSTED_APPROVAL_DISPLAY_LIMITS.workspaceLabelUtf8Bytes) ||
    exceeds(canonicalDiff, TRUSTED_APPROVAL_DISPLAY_LIMITS.canonicalDiffUtf8Bytes) ||
    exceeds(recoverySideEffect, TRUSTED_APPROVAL_DISPLAY_LIMITS.recoverySideEffectUtf8Bytes)
  ) {
    return displayTooLarge();
  }

  const selectedOperations: TrustedApprovalDisplayOperationV1[] = [];
  for (const operation of input.selectedOperations) {
    if (
      !isExactRecord(operation, ["operationId", "operationKind", "paths", "summary"]) ||
      !isOperationId(operation.operationId) ||
      typeof operation.operationKind !== "string" ||
      !/^[a-z][a-z0-9_]{0,63}$/u.test(operation.operationKind) ||
      !Array.isArray(operation.paths) ||
      !isNonEmptyString(operation.summary)
    ) {
      return invalidDisplay("Trusted approval display operation is invalid.");
    }
    if (operation.paths.length > TRUSTED_APPROVAL_DISPLAY_LIMITS.pathsPerOperation) {
      return displayTooLarge();
    }
    const paths: TrustedApprovalDisplayPathV1[] = [];
    for (const displayPath of operation.paths) {
      if (
        !isExactRecord(displayPath, ["role", "path"]) ||
        !isDisplayPathRole(displayPath.role) ||
        !isNonEmptyString(displayPath.path)
      ) {
        return invalidDisplay("Trusted approval display path is invalid.");
      }
      const path = escapeApprovalDisplayText(displayPath.path);
      if (exceeds(path, TRUSTED_APPROVAL_DISPLAY_LIMITS.pathUtf8Bytes)) {
        return displayTooLarge();
      }
      paths.push(freeze({ role: displayPath.role, path }));
    }
    const summary = escapeApprovalDisplayText(operation.summary);
    if (exceeds(summary, TRUSTED_APPROVAL_DISPLAY_LIMITS.operationSummaryUtf8Bytes)) {
      return displayTooLarge();
    }
    selectedOperations.push(
      freeze({
        operationId: operation.operationId,
        operationKind: operation.operationKind,
        paths: freeze(paths),
        summary
      })
    );
  }

  const content = freeze({
    schemaVersion: "1.0" as const,
    workspaceLabel,
    changeSetId: input.changeSetId,
    changeSetRevision: input.changeSetRevision,
    selectedOperations: freeze(selectedOperations),
    canonicalDiff,
    recoverySideEffect
  });
  const serialized = canonicalJson(content);
  if (exceeds(serialized, TRUSTED_APPROVAL_DISPLAY_LIMITS.totalUtf8Bytes)) {
    return displayTooLarge();
  }
  return ok(
    freeze({
      ...content,
      displayChecksum: createHash("sha256").update(serialized, "utf8").digest("hex")
    })
  );
}

type PreviewState = "prepared" | "displayed" | "decided" | "issued" | "revoked";

interface PreviewRecord {
  readonly preview: TrustedApprovalPreview;
  readonly parentWebContentsId: number;
  readonly canonicalChecksum: string;
  readonly binding: ApprovalBindingV2;
  readonly bindingChecksum: string;
  readonly display: TrustedApprovalSafeDisplayDtoV1;
  readonly qualification: TrustedApprovalSurfaceQualificationV1;
  readonly createdAt: string;
  state: PreviewState;
  modalWebContentsId?: number;
  modalInstanceId?: string;
  nonce?: string;
  displayedAt?: string;
  decidedAt?: string;
  authorizationId?: string;
  evidenceId?: string;
  revocationReason?: string;
  readonly decisionPromise: Promise<TrustedApprovalMainDecision>;
  readonly resolveDecision: (decision: TrustedApprovalMainDecision) => void;
  decisionOutcome?: TrustedApprovalMainDecision;
  watchTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Main-owned ADR-0004 confirmation state machine. It never accepts a binding,
 * checksum, qualification claim, or authoritative decision from the workbench Renderer.
 */
export class MainApprovalConfirmationCoordinator {
  private readonly records = new Map<string, PreviewRecord>();
  private readonly currentPreviewByParent = new Map<number, string>();
  private readonly currentPreviewByModal = new Map<number, string>();
  private readonly now: () => string;
  private readonly createId: () => string;

  public constructor(private readonly options: MainApprovalConfirmationOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => randomBytes(18).toString("base64url"));
  }

  public prepare(input: TrustedApprovalPreviewInput): Result<TrustedApprovalPreview, UnifiedError> {
    const qualification = this.readQualification();
    if (qualification === undefined || this.options.humanIntentEvidenceJournal === undefined) {
      return this.unavailable();
    }
    const validation = this.validatePreparation(input, qualification);
    if (!validation.ok) return validation;

    const previousId = this.currentPreviewByParent.get(input.parentWebContentsId);
    if (previousId !== undefined) this.revoke(previousId, "superseded");

    const previewId = this.nextStableId("preview");
    if (!previewId.ok) return previewId;
    const createdAt = this.now();
    const preview = freeze({
      previewId: previewId.value,
      action: input.action,
      displayChecksum: input.displayChecksum,
      expiresAt: input.expiresAt,
      attestationChecksum: qualification.attestationChecksum
    });
    const binding = cloneBinding(input.binding);
    let resolveDecision!: (decision: TrustedApprovalMainDecision) => void;
    const decisionPromise = new Promise<TrustedApprovalMainDecision>((resolve) => {
      resolveDecision = resolve;
    });
    this.records.set(preview.previewId, {
      preview,
      parentWebContentsId: input.parentWebContentsId,
      canonicalChecksum: input.canonicalChecksum,
      binding,
      bindingChecksum: approvalBindingV2Checksum(binding),
      display: validation.value,
      qualification: freeze({ ...qualification }),
      createdAt,
      state: "prepared",
      decisionPromise,
      resolveDecision,
      watchTimer: undefined
    });
    this.currentPreviewByParent.set(input.parentWebContentsId, preview.previewId);
    return ok(preview);
  }

  /** Main-only handoff. It never crosses the isolated-modal IPC boundary. */
  public async waitForDecision(
    previewId: string
  ): Promise<Result<TrustedApprovalMainDecision, UnifiedError>> {
    const record = this.records.get(previewId);
    if (record === undefined) return this.notFound();
    if (record.decisionOutcome !== undefined) return ok(record.decisionOutcome);
    const current = this.ensureCurrent(record);
    if (!current.ok) {
      const outcome = record.decisionOutcome;
      return outcome === undefined ? current : ok(outcome);
    }
    this.watchUntilTerminal(record);
    return ok(await record.decisionPromise);
  }

  /** Ordinary Renderer capability: it may identify only its own opaque prepared preview. */
  public openFromRenderer(
    senderWebContentsId: number,
    previewId: string,
    modalWebContentsId: number
  ): Result<TrustedApprovalModalPayload, UnifiedError> {
    if (!this.surfaceAvailable()) return this.unavailable();
    const record = this.records.get(previewId);
    if (record === undefined) return this.notFound();
    if (record.state !== "prepared") return this.replay();
    if (
      senderWebContentsId !== record.parentWebContentsId ||
      this.currentPreviewByParent.get(record.parentWebContentsId) !== previewId
    ) {
      this.revoke(previewId, "renderer_sender_mismatch");
      return this.boundaryMismatch("TRUSTED_APPROVAL_RENDERER_MISMATCH");
    }
    if (
      !Number.isSafeInteger(modalWebContentsId) ||
      modalWebContentsId <= 0 ||
      modalWebContentsId === senderWebContentsId ||
      this.currentPreviewByModal.has(modalWebContentsId)
    ) {
      this.revoke(previewId, "modal_identity_invalid");
      return this.boundaryMismatch("TRUSTED_APPROVAL_MODAL_INVALID");
    }
    const current = this.ensureCurrent(record);
    if (!current.ok) return current;

    const modalInstanceId = this.nextStableId("modal");
    if (!modalInstanceId.ok) {
      this.revoke(previewId, "id_generation_failed");
      return modalInstanceId;
    }
    const nonceSeed = this.createId();
    if (!isStableId(nonceSeed)) {
      this.revoke(previewId, "nonce_generation_failed");
      return this.failure("TRUSTED_APPROVAL_ID_INVALID", "Approval nonce generation failed.");
    }
    const displayedAt = this.now();
    record.state = "displayed";
    record.modalWebContentsId = modalWebContentsId;
    record.modalInstanceId = modalInstanceId.value;
    record.nonce = createHash("sha256")
      .update(`trusted-approval-nonce\n${previewId}\n${nonceSeed}`, "utf8")
      .digest("base64url");
    record.displayedAt = displayedAt;
    this.currentPreviewByModal.set(modalWebContentsId, previewId);
    return ok(this.modalPayload(record));
  }

  /** The modal may read only its own display record; workbench senders cannot attach to it. */
  public readFromModal(
    senderWebContentsId: number,
    previewId: string
  ): Result<TrustedApprovalModalPayload, UnifiedError> {
    if (!this.surfaceAvailable()) return this.unavailable();
    const record = this.records.get(previewId);
    if (record === undefined) return this.notFound();
    if (record.state !== "displayed") return this.replay();
    if (
      senderWebContentsId !== record.modalWebContentsId ||
      this.currentPreviewByModal.get(senderWebContentsId) !== previewId
    ) {
      this.revoke(previewId, "modal_sender_mismatch");
      return this.boundaryMismatch("TRUSTED_APPROVAL_MODAL_MISMATCH");
    }
    const current = this.ensureCurrent(record);
    return current.ok ? ok(this.modalPayload(record)) : current;
  }

  /** Only the current dedicated approval modal sender may make a one-time decision. */
  public async decideFromModal(
    senderWebContentsId: number,
    decision: TrustedApprovalDecision
  ): Promise<Result<TrustedApprovalIssued | undefined, UnifiedError>> {
    const record = this.records.get(decision.previewId);
    if (record === undefined) return this.surfaceAvailable() ? this.notFound() : this.unavailable();
    const current = this.ensureCurrent(record);
    if (!current.ok) return current;
    if (record.state !== "displayed") return this.replay();
    if (
      senderWebContentsId !== record.modalWebContentsId ||
      this.currentPreviewByModal.get(senderWebContentsId) !== decision.previewId ||
      decision.modalInstanceId !== record.modalInstanceId ||
      decision.nonce !== record.nonce
    ) {
      this.revoke(decision.previewId, "decision_binding_mismatch");
      return this.boundaryMismatch("TRUSTED_APPROVAL_DECISION_MISMATCH");
    }
    record.state = "decided";
    record.decidedAt = this.now();
    if (decision.decision !== "approve") {
      this.dismiss(record, decision.decision);
      return ok(undefined);
    }

    let confirmed: boolean;
    try {
      confirmed = await this.options.nativeConfirm(record.preview);
    } catch {
      this.revoke(decision.previewId, "native_confirmation_failed");
      return this.failure(
        "TRUSTED_APPROVAL_NATIVE_CONFIRM_FAILED",
        "The Main-owned final confirmation failed."
      );
    }
    if (!confirmed) {
      this.dismiss(record, "native_cancel");
      return ok(undefined);
    }
    if (record.state !== "decided") return this.revoked();
    const afterConfirm = this.ensureCurrent(record);
    if (!afterConfirm.ok) return afterConfirm;

    const authorizationId = this.nextStableId("auth");
    const evidenceId = this.nextStableId("intent");
    if (!authorizationId.ok) {
      this.revoke(decision.previewId, "id_generation_failed");
      return err(authorizationId.error);
    }
    if (!evidenceId.ok) {
      this.revoke(decision.previewId, "id_generation_failed");
      return err(evidenceId.error);
    }
    record.authorizationId = authorizationId.value;
    record.evidenceId = evidenceId.value;
    const journal = this.options.humanIntentEvidenceJournal;
    if (journal === undefined) {
      this.revoke(decision.previewId, "evidence_journal_unavailable");
      return this.unavailable();
    }
    const evidence = this.createEvidence(record, authorizationId.value, evidenceId.value);
    const evidenceIssued = await journal.issue(evidence);
    if (!evidenceIssued.ok) {
      this.revoke(decision.previewId, "evidence_issue_failed");
      return evidenceIssued;
    }
    if (record.state !== "decided") {
      await journal.revoke(evidenceId.value, "approval_revoked_during_issue");
      return this.revoked();
    }

    const authorization = await this.options.authorizationLedger.issue({
      binding: record.binding,
      authorizationId: authorizationId.value
    });
    if (!authorization.ok) {
      await journal.revoke(evidenceId.value, "authorization_issue_failed");
      this.revoke(decision.previewId, "authorization_issue_failed");
      return authorization;
    }
    if (record.state !== "decided") {
      await this.options.authorizationLedger.revoke(
        authorizationId.value,
        "approval_revoked_during_issue"
      );
      await journal.revoke(evidenceId.value, "approval_revoked_during_issue");
      return this.revoked();
    }
    record.state = "issued";
    const issued = freeze({
      authorizationId: authorizationId.value,
      humanIntentEvidenceId: evidenceId.value,
      displayChecksum: record.preview.displayChecksum,
      bindingChecksum: record.bindingChecksum
    });
    this.settleDecision(record, freeze({ status: "issued", issued }));
    return ok(issued);
  }

  /** Main-only close/crash/supersession hook. Revocation is fail closed and idempotent. */
  public revoke(previewId: string, reason = "revoked"): void {
    const record = this.records.get(previewId);
    if (record === undefined || record.state === "revoked") return;
    record.state = "revoked";
    record.revocationReason = reason;
    this.settleDecision(record, freeze({ status: "revoked", reason }));
    if (this.currentPreviewByParent.get(record.parentWebContentsId) === previewId) {
      this.currentPreviewByParent.delete(record.parentWebContentsId);
    }
    if (
      record.modalWebContentsId !== undefined &&
      this.currentPreviewByModal.get(record.modalWebContentsId) === previewId
    ) {
      this.currentPreviewByModal.delete(record.modalWebContentsId);
    }
    if (record.authorizationId !== undefined) {
      void this.options.authorizationLedger
        .revoke(record.authorizationId, reason)
        .catch(() => undefined);
    }
    if (record.evidenceId !== undefined && this.options.humanIntentEvidenceJournal !== undefined) {
      void this.options.humanIntentEvidenceJournal
        .revoke(record.evidenceId, reason)
        .catch(() => undefined);
    }
  }

  /** Main lifecycle hook for workspace/runtime/window replacement and application shutdown. */
  public revokeAll(reason = "coordinator_replaced"): void {
    for (const previewId of this.records.keys()) this.revoke(previewId, reason);
  }

  private dismiss(record: PreviewRecord, reason: "reject" | "cancel" | "native_cancel"): void {
    record.state = "revoked";
    record.revocationReason = reason;
    if (this.currentPreviewByParent.get(record.parentWebContentsId) === record.preview.previewId) {
      this.currentPreviewByParent.delete(record.parentWebContentsId);
    }
    if (
      record.modalWebContentsId !== undefined &&
      this.currentPreviewByModal.get(record.modalWebContentsId) === record.preview.previewId
    ) {
      this.currentPreviewByModal.delete(record.modalWebContentsId);
    }
    this.settleDecision(record, freeze({ status: "dismissed", reason }));
  }

  private settleDecision(record: PreviewRecord, outcome: TrustedApprovalMainDecision): void {
    if (record.decisionOutcome !== undefined) return;
    record.decisionOutcome = outcome;
    if (record.watchTimer !== undefined) clearTimeout(record.watchTimer);
    record.watchTimer = undefined;
    record.resolveDecision(outcome);
  }

  private watchUntilTerminal(record: PreviewRecord): void {
    if (record.decisionOutcome !== undefined || record.watchTimer !== undefined) return;
    const tick = (): void => {
      record.watchTimer = undefined;
      if (record.decisionOutcome !== undefined) return;
      const current = this.ensureCurrent(record);
      if (!current.ok || record.decisionOutcome !== undefined) return;
      record.watchTimer = setTimeout(tick, 100);
      record.watchTimer.unref?.();
    };
    record.watchTimer = setTimeout(tick, 100);
    record.watchTimer.unref?.();
  }

  private validatePreparation(
    input: TrustedApprovalPreviewInput,
    qualification: TrustedApprovalSurfaceQualificationV1
  ): Result<TrustedApprovalSafeDisplayDtoV1, UnifiedError> {
    const now = Date.parse(this.now());
    const expiresAt = Date.parse(input.expiresAt);
    if (
      !Number.isSafeInteger(input.parentWebContentsId) ||
      input.parentWebContentsId <= 0 ||
      (input.action !== "plan_to_act" && input.action !== "change_set") ||
      !isHash(input.displayChecksum) ||
      !isHash(input.canonicalChecksum) ||
      !isHash(input.bundleDigest) ||
      !isStableId(input.qualificationRevision) ||
      !Number.isFinite(now) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now
    ) {
      return this.failure("TRUSTED_APPROVAL_PREVIEW_INVALID", "Approval preview is invalid.");
    }
    const display = parseTrustedApprovalSafeDisplayDto(input.display);
    if (!display.ok) return display;
    if (display.value.displayChecksum !== input.displayChecksum) {
      return this.failure(
        "TRUSTED_APPROVAL_DISPLAY_CHECKSUM_MISMATCH",
        "Approval display checksum does not match the Main-owned safe display DTO."
      );
    }
    if (
      input.bundleDigest !== qualification.bundleDigest ||
      input.qualificationRevision !== qualification.qualificationRevision
    ) {
      return this.failure(
        "TRUSTED_APPROVAL_QUALIFICATION_MISMATCH",
        "Approval surface qualification does not match the app-owned attestation."
      );
    }
    const binding = validateApprovalBindingV2(input.binding, now);
    if (!binding.ok) return binding;
    if (
      input.binding.approvalSource !== "human_confirmation" ||
      input.binding.changeSetChecksum !== input.canonicalChecksum ||
      input.binding.expiresAt !== input.expiresAt ||
      display.value.changeSetId !== input.binding.changeSetId ||
      display.value.changeSetRevision !== input.binding.changeSetRevision ||
      display.value.selectedOperations.length !== input.binding.selectedOperationIds.length ||
      display.value.selectedOperations.some(
        (operation, index) => operation.operationId !== input.binding.selectedOperationIds[index]
      )
    ) {
      return this.failure(
        "TRUSTED_APPROVAL_BINDING_MISMATCH",
        "Approval preview does not match its canonical Main-owned binding."
      );
    }
    return display;
  }

  private ensureCurrent(record: PreviewRecord): Result<void, UnifiedError> {
    const now = Date.parse(this.now());
    const qualification = this.readQualification();
    if (
      qualification === undefined ||
      !sameQualificationIdentity(qualification, record.qualification)
    ) {
      this.revoke(record.preview.previewId, "qualification_changed");
      return this.failure(
        "TRUSTED_APPROVAL_QUALIFICATION_CHANGED",
        "Approval surface qualification changed before authorization."
      );
    }
    if (!Number.isFinite(now) || Date.parse(record.preview.expiresAt) <= now) {
      this.revoke(record.preview.previewId, "expired");
      return this.failure("TRUSTED_APPROVAL_EXPIRED", "Approval preview expired.");
    }
    const binding = validateApprovalBindingV2(record.binding, now);
    if (!binding.ok) {
      this.revoke(record.preview.previewId, "binding_stale");
      return binding;
    }
    if (
      approvalBindingV2Checksum(record.binding) !== record.bindingChecksum ||
      record.binding.changeSetChecksum !== record.canonicalChecksum ||
      record.binding.expiresAt !== record.preview.expiresAt ||
      record.display.displayChecksum !== record.preview.displayChecksum ||
      trustedApprovalDisplayChecksum(record.display) !== record.preview.displayChecksum
    ) {
      this.revoke(record.preview.previewId, "binding_changed");
      return this.failure(
        "TRUSTED_APPROVAL_BINDING_CHANGED",
        "Approval binding changed after the preview was prepared."
      );
    }
    return ok(undefined);
  }

  private readQualification(): TrustedApprovalSurfaceQualificationV1 | undefined {
    let value: TrustedApprovalSurfaceQualificationV1 | undefined;
    try {
      value = this.options.getSurfaceQualification?.();
    } catch {
      return undefined;
    }
    const now = Date.parse(this.now());
    return isTrustedApprovalSurfaceQualification(value) &&
      Number.isFinite(now) &&
      Date.parse(value.issuedAt) <= now &&
      now < Date.parse(value.expiresAt)
      ? value
      : undefined;
  }

  private surfaceAvailable(): boolean {
    return (
      this.options.humanIntentEvidenceJournal !== undefined &&
      this.readQualification() !== undefined
    );
  }

  private modalPayload(record: PreviewRecord): TrustedApprovalModalPayload {
    return freeze({
      ...record.preview,
      modalInstanceId: record.modalInstanceId ?? "",
      nonce: record.nonce ?? "",
      display: record.display
    });
  }

  private createEvidence(
    record: PreviewRecord,
    authorizationId: string,
    evidenceId: string
  ): MainOnlyHumanIntentEvidenceV1 {
    const binding = record.binding;
    return freeze({
      schemaVersion: "1.0",
      source: "main_owned_isolated_modal_v1",
      evidenceId,
      authorizationId,
      previewId: record.preview.previewId,
      action: record.preview.action,
      parentWebContentsId: record.parentWebContentsId,
      modalWebContentsId: record.modalWebContentsId ?? 0,
      modalInstanceId: record.modalInstanceId ?? "",
      nonce: record.nonce ?? "",
      createdAt: record.createdAt,
      displayedAt: record.displayedAt ?? record.createdAt,
      decidedAt: record.decidedAt ?? this.now(),
      expiresAt: record.preview.expiresAt,
      workspaceBindingId: binding.workspaceBindingId,
      rootBindingId: binding.rootBindingId,
      runId: binding.runId,
      changeSetId: binding.changeSetId,
      changeSetRevision: binding.changeSetRevision,
      changeSetChecksum: binding.changeSetChecksum,
      selectedOperationIds: freeze([...binding.selectedOperationIds]),
      selectionChecksum: binding.selectionChecksum,
      operationOrderChecksum: binding.operationOrderChecksum,
      displayChecksum: record.preview.displayChecksum,
      canonicalChecksum: record.canonicalChecksum,
      bindingChecksum: record.bindingChecksum,
      approvalRuleSetVersion: binding.approvalRuleSetVersion,
      approvalRuleSetChecksum: binding.approvalRuleSetChecksum,
      capabilityRevision: binding.capabilityRevision,
      policyRevision: binding.policyRevision,
      bundleDigest: record.qualification.bundleDigest,
      qualificationRevision: record.qualification.qualificationRevision,
      sourceRevision: record.qualification.sourceRevision,
      approvalArtifactManifestChecksum: record.qualification.approvalArtifactManifestChecksum,
      qualificationMatrixRevision: record.qualification.qualificationMatrixRevision,
      qualificationMatrixChecksum: record.qualification.qualificationMatrixChecksum,
      automatedReportChecksum: record.qualification.automatedReportChecksum,
      ownerApprovalId: record.qualification.ownerApprovalId,
      ownerKeyId: record.qualification.ownerKeyId,
      issuedAt: record.qualification.issuedAt,
      qualificationExpiresAt: record.qualification.expiresAt,
      attestationChecksum: record.qualification.attestationChecksum,
      ...(binding.recoveryRootBindingId === undefined
        ? {}
        : { recoveryRootBindingId: binding.recoveryRootBindingId }),
      ...(binding.recoveryGrantRevision === undefined
        ? {}
        : { recoveryGrantRevision: binding.recoveryGrantRevision }),
      ...(binding.recoverySideEffectChecksum === undefined
        ? {}
        : { recoverySideEffectChecksum: binding.recoverySideEffectChecksum })
    });
  }

  private nextStableId(prefix: string): Result<string, UnifiedError> {
    const seed = this.createId();
    const value = `${prefix}_${seed}`;
    return isStableId(seed) && isStableId(value)
      ? ok(value)
      : this.failure("TRUSTED_APPROVAL_ID_INVALID", "Approval id generation failed.");
  }

  private unavailable<T = never>(): Result<T, UnifiedError> {
    return this.failure(
      "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE",
      "The ADR-0004 qualified confirmation surface is unavailable; mutation remains read-only."
    );
  }

  private notFound<T = never>(): Result<T, UnifiedError> {
    return this.failure("TRUSTED_APPROVAL_PREVIEW_NOT_FOUND", "Approval preview was not found.");
  }

  private replay<T = never>(): Result<T, UnifiedError> {
    return this.failure(
      "TRUSTED_APPROVAL_REPLAY_REJECTED",
      "Approval preview is not in the one-time displayed state."
    );
  }

  private revoked<T = never>(): Result<T, UnifiedError> {
    return this.failure("TRUSTED_APPROVAL_REVOKED", "Approval was revoked before issuance.");
  }

  private boundaryMismatch<T = never>(code: string): Result<T, UnifiedError> {
    return this.failure(code, "Approval sender or one-time modal binding does not match.");
  }

  private failure<T = never>(code: string, message: string): Result<T, UnifiedError> {
    return err(
      createUnifiedError({
        code,
        category: "AgentError",
        message,
        recoverability: "user-action",
        suggestedAction: "Open a new confirmation from the current Main-owned preview.",
        traceId: "desktop-trusted-approval-confirmation"
      })
    );
  }
}

export interface TrustedApprovalIpcMain {
  handle(
    channel: string,
    listener: (event: { sender: { id: number } }, ...args: unknown[]) => unknown
  ): void;
}

/** Register only on the isolated approval window's ipcMain boundary. */
export function registerTrustedApprovalIpc(
  ipc: TrustedApprovalIpcMain,
  coordinator: Pick<MainApprovalConfirmationCoordinator, "readFromModal" | "decideFromModal">
): void {
  ipc.handle(TRUSTED_APPROVAL_IPC_CHANNELS.getPreview, (event, previewId: unknown) =>
    typeof previewId === "string"
      ? coordinator.readFromModal(event.sender.id, previewId)
      : err(invalidIpcArgument())
  );
  ipc.handle(TRUSTED_APPROVAL_IPC_CHANNELS.decide, async (event, decision: unknown) => {
    if (!isDecision(decision)) return err(invalidIpcArgument());
    const result = await coordinator.decideFromModal(event.sender.id, decision);
    if (!result.ok) return result;
    // The isolated modal learns only whether its flow completed. Authorization/evidence stay Main-only.
    return ok({ status: result.value === undefined ? "dismissed" : "approved" });
  });
}

function isDecision(value: unknown): value is TrustedApprovalDecision {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const required = ["previewId", "modalInstanceId", "nonce", "decision"];
  return (
    Object.keys(candidate).length === required.length &&
    required.every((key) => key in candidate) &&
    isNonEmptyString(candidate["previewId"]) &&
    isNonEmptyString(candidate["modalInstanceId"]) &&
    isNonEmptyString(candidate["nonce"]) &&
    (candidate["decision"] === "approve" ||
      candidate["decision"] === "reject" ||
      candidate["decision"] === "cancel")
  );
}

function parseTrustedApprovalSafeDisplayDto(
  value: unknown
): Result<TrustedApprovalSafeDisplayDtoV1, UnifiedError> {
  if (
    !isExactRecord(value, [
      "schemaVersion",
      "workspaceLabel",
      "changeSetId",
      "changeSetRevision",
      "selectedOperations",
      "canonicalDiff",
      "recoverySideEffect",
      "displayChecksum"
    ]) ||
    !isHash(value["displayChecksum"])
  ) {
    return invalidDisplay("Trusted approval safe display DTO has an invalid shape.");
  }
  const rebuilt = createTrustedApprovalSafeDisplayDto({
    schemaVersion: value["schemaVersion"] as "1.0",
    workspaceLabel: value["workspaceLabel"] as string,
    changeSetId: value["changeSetId"] as string,
    changeSetRevision: value["changeSetRevision"] as number,
    selectedOperations: value["selectedOperations"] as readonly TrustedApprovalDisplayOperationV1[],
    canonicalDiff: value["canonicalDiff"] as string,
    recoverySideEffect: value["recoverySideEffect"] as string
  });
  if (!rebuilt.ok) return rebuilt;
  return rebuilt.value.displayChecksum === value["displayChecksum"]
    ? rebuilt
    : invalidDisplay("Trusted approval safe display DTO checksum is invalid.");
}

function trustedApprovalDisplayChecksum(display: TrustedApprovalSafeDisplayDtoV1): string {
  const content: TrustedApprovalDisplayContentV1 = {
    schemaVersion: display.schemaVersion,
    workspaceLabel: display.workspaceLabel,
    changeSetId: display.changeSetId,
    changeSetRevision: display.changeSetRevision,
    selectedOperations: display.selectedOperations,
    canonicalDiff: display.canonicalDiff,
    recoverySideEffect: display.recoverySideEffect
  };
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}

function escapeApprovalDisplayText(value: string): string {
  const normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n");
  let escaped = "";
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\n") {
      escaped += character;
      continue;
    }
    if (character === "<" || character === ">" || character === "&") {
      escaped += visibleCodePoint(codePoint);
      continue;
    }
    if (
      /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(character) ||
      (character !== " " && /\p{Zs}/u.test(character))
    ) {
      escaped += visibleCodePoint(codePoint);
      continue;
    }
    escaped += character;
  }
  return escaped;
}

function visibleCodePoint(codePoint: number): string {
  const width = codePoint <= 0xffff ? 4 : 6;
  return `\\u{${codePoint.toString(16).toUpperCase().padStart(width, "0")}}`;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isDisplayPathRole(value: unknown): value is TrustedApprovalDisplayPathV1["role"] {
  return value === "source" || value === "target" || value === "affected" || value === "recovery";
}

function exceeds(value: string, limit: number): boolean {
  return Buffer.byteLength(value, "utf8") > limit;
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

function invalidDisplay(message: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "TRUSTED_APPROVAL_DISPLAY_INVALID",
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction: "Regenerate the complete Main-owned approval preview.",
      traceId: "desktop-trusted-approval-display"
    })
  );
}

function displayTooLarge(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "TRUSTED_APPROVAL_DISPLAY_LIMIT_EXCEEDED",
      category: "ValidationError",
      message: "Trusted approval content exceeds a reviewed display limit and was not truncated.",
      recoverability: "user-action",
      suggestedAction: "Reduce the Change Set and open a new complete confirmation.",
      traceId: "desktop-trusted-approval-display"
    })
  );
}

function cloneBinding(binding: ApprovalBindingV2): ApprovalBindingV2 {
  return parseApprovalBindingV2(JSON.parse(JSON.stringify(binding)) as unknown);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID_PATTERN.test(value);
}

function isTrustedApprovalSurfaceQualification(
  value: unknown
): value is TrustedApprovalSurfaceQualificationV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const qualification = value as TrustedApprovalSurfaceQualificationV1;
  return (
    qualification.schemaVersion === "1.0" &&
    qualification.status === "qualified" &&
    isHash(qualification.bundleDigest) &&
    isStableId(qualification.qualificationRevision) &&
    /^[a-f0-9]{40}$/u.test(qualification.sourceRevision) &&
    isHash(qualification.approvalArtifactManifestChecksum) &&
    isStableId(qualification.qualificationMatrixRevision) &&
    isHash(qualification.qualificationMatrixChecksum) &&
    isHash(qualification.automatedReportChecksum) &&
    isStableId(qualification.ownerApprovalId) &&
    isStableId(qualification.ownerKeyId) &&
    isCanonicalTimestamp(qualification.issuedAt) &&
    isCanonicalTimestamp(qualification.expiresAt) &&
    isHash(qualification.attestationChecksum)
  );
}

function sameQualificationIdentity(
  left: TrustedApprovalSurfaceQualificationV1,
  right: TrustedApprovalSurfaceQualificationV1
): boolean {
  return (
    left.bundleDigest === right.bundleDigest &&
    left.qualificationRevision === right.qualificationRevision &&
    left.sourceRevision === right.sourceRevision &&
    left.approvalArtifactManifestChecksum === right.approvalArtifactManifestChecksum &&
    left.qualificationMatrixRevision === right.qualificationMatrixRevision &&
    left.qualificationMatrixChecksum === right.qualificationMatrixChecksum &&
    left.automatedReportChecksum === right.automatedReportChecksum &&
    left.ownerApprovalId === right.ownerApprovalId &&
    left.ownerKeyId === right.ownerKeyId &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt &&
    left.attestationChecksum === right.attestationChecksum
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CANONICAL_UTC_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalidIpcArgument(): UnifiedError {
  return createUnifiedError({
    code: "TRUSTED_APPROVAL_IPC_INVALID",
    category: "ValidationError",
    message: "The isolated confirmation IPC payload is invalid.",
    recoverability: "user-action",
    suggestedAction: "Open a new confirmation.",
    traceId: "desktop-trusted-approval-confirmation"
  });
}
