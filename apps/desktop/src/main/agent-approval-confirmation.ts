import type { ApprovalBindingV2 } from "@novel-studio/agent-engine";
import { TRUSTED_APPROVAL_IPC_CHANNELS } from "@novel-studio/application";
import type { ApprovalAuthorizationLedger } from "@novel-studio/repository";
import { createUnifiedError, err, type Result, type UnifiedError } from "@novel-studio/shared";

/** These channels are intentionally absent from the ordinary workbench preload allowlist. */
export { TRUSTED_APPROVAL_IPC_CHANNELS };

export interface TrustedApprovalPreviewInput {
  readonly parentWebContentsId: number;
  readonly action: "plan_to_act" | "change_set";
  readonly displayChecksum: string;
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
}

export interface TrustedApprovalModalPayload extends TrustedApprovalPreview {
  readonly modalInstanceId: string;
  readonly nonce: string;
}

export interface TrustedApprovalDecision {
  readonly previewId: string;
  readonly modalInstanceId: string;
  readonly nonce: string;
  readonly decision: "approve" | "reject" | "cancel";
}

export interface TrustedApprovalIssued {
  readonly authorizationId: string;
  readonly displayChecksum: string;
  readonly binding: ApprovalBindingV2;
}

export interface MainApprovalConfirmationOptions {
  readonly authorizationLedger: ApprovalAuthorizationLedger;
  readonly nativeConfirm: (preview: TrustedApprovalPreview) => Promise<boolean>;
  readonly now?: () => string;
  readonly createId?: () => string;
}

/**
 * Main-owned ADR-0004 confirmation state machine. It never accepts a binding,
 * checksum, or decision from the ordinary workbench renderer.
 */
export class MainApprovalConfirmationCoordinator {
  public constructor(options: MainApprovalConfirmationOptions) {
    void options;
  }

  public prepare(input: TrustedApprovalPreviewInput): Result<TrustedApprovalPreview, UnifiedError> {
    void input;
    return this.unavailable();
  }

  /** Ordinary renderer capability: it can request its own opaque prepared preview only. */
  public openFromRenderer(
    senderWebContentsId: number,
    previewId: string,
    modalWebContentsId: number
  ): Result<TrustedApprovalModalPayload, UnifiedError> {
    void senderWebContentsId;
    void previewId;
    void modalWebContentsId;
    return this.unavailable();
  }

  /** The modal may read only its own display record; workbench senders cannot attach to it. */
  public readFromModal(
    senderWebContentsId: number,
    previewId: string
  ): Result<TrustedApprovalModalPayload, UnifiedError> {
    void senderWebContentsId;
    void previewId;
    return this.unavailable();
  }

  /** Only the dedicated approval modal sender may make a one-time decision. */
  public async decideFromModal(
    senderWebContentsId: number,
    decision: TrustedApprovalDecision
  ): Promise<Result<TrustedApprovalIssued | undefined, UnifiedError>> {
    void senderWebContentsId;
    void decision;
    return this.unavailable();
  }

  public revoke(previewId: string): void {
    void previewId;
  }

  private unavailable<T = never>(): Result<T, UnifiedError> {
    return this.failure(
      "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE",
      "The ADR-0004 qualified confirmation surface is unavailable; mutation remains read-only."
    );
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
  coordinator: MainApprovalConfirmationCoordinator
): void {
  ipc.handle(TRUSTED_APPROVAL_IPC_CHANNELS.getPreview, (event, previewId: unknown) =>
    typeof previewId === "string"
      ? coordinator.readFromModal(event.sender.id, previewId)
      : err(invalidIpcArgument())
  );
  ipc.handle(TRUSTED_APPROVAL_IPC_CHANNELS.decide, (event, decision: unknown) => {
    if (!isDecision(decision)) return err(invalidIpcArgument());
    return coordinator.decideFromModal(event.sender.id, decision);
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
