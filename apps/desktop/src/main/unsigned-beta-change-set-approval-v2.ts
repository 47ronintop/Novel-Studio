import { randomBytes } from "node:crypto";

import { type DecideChangeSetApprovalV2Input } from "@novel-studio/agent-engine";
import type { AgentRunChangeSetApprovalV2Port } from "@novel-studio/application";
import type { ApprovalAuthorizationLedger } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  hasCurrentUnsignedBetaAuthorization,
  type UnsignedBetaAuthorizationV1
} from "./unsigned-beta-qualification.js";
import { buildTrustedApprovalPreparation } from "./trusted-change-set-approval-v2.js";
import type { TrustedApprovalSafeDisplayDtoV1 } from "./agent-approval-confirmation.js";

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export interface UnsignedBetaChangeSetApprovalV2Options {
  /** Main-owned in-memory ledger. The renderer never supplies or controls this object. */
  readonly authorizationLedger: Pick<ApprovalAuthorizationLedger, "issue" | "reserve" | "revoke">;
  /** Main-owned current grant; disk state is intentionally not accepted here. */
  readonly getCurrentAuthorization: () => UnsignedBetaAuthorizationV1 | undefined;
  readonly packageIdentityChecksum: string;
  readonly workspaceBindingId: string;
  readonly projectId: string;
  /** Direct native confirmation, injected for tests and the unsigned beta shell. */
  readonly confirm: (display: TrustedApprovalSafeDisplayDtoV1) => Promise<boolean>;
  readonly workspaceLabel: string;
  readonly now?: () => string;
  readonly createTransactionId?: () => string;
}

/**
 * Main-owned Change Set 2.0 approval for the unsigned local beta. This is a beta gate only:
 * it creates the normal durable ledger reservation, but deliberately does not assert trusted
 * production qualification.
 */
export function createUnsignedBetaChangeSetApprovalV2Port(
  options: UnsignedBetaChangeSetApprovalV2Options
): AgentRunChangeSetApprovalV2Port {
  const now = options.now ?? (() => new Date().toISOString());
  const createTransactionId =
    options.createTransactionId ??
    (() => `transaction_unsigned_beta_${randomBytes(16).toString("hex")}`);

  return Object.freeze({
    async prepare(input: Parameters<AgentRunChangeSetApprovalV2Port["prepare"]>[0]) {
      if (input.command.decision !== "apply_selected") {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_DECISION_INVALID",
          "Unsigned beta confirmation only authorizes applying the current selection."
        );
      }

      if (
        input.changeSet.projectId !== options.projectId ||
        input.approvalContext.workspaceBindingId !== options.workspaceBindingId ||
        !isAllowedOperation(input.approvalContext.operation)
      ) {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_SCOPE_REJECTED",
          "Unsigned beta approval is limited to the current creative workspace and operation set."
        );
      }

      const issuedAt = readNow(now);
      if (issuedAt === undefined) return clockFailure();
      const built = buildTrustedApprovalPreparation({
        changeSet: input.changeSet,
        context: input.approvalContext,
        workspaceLabel: options.workspaceLabel,
        issuedAt
      });
      if (!built.ok) return built;

      const authorizationBefore = currentGrant(options, issuedAt, built.value.binding.expiresAt);
      if (authorizationBefore === undefined) {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_REQUIRED",
          "Unsigned beta authorization is missing, revoked, expired, or ends before this approval."
        );
      }

      let confirmed = false;
      try {
        confirmed = await options.confirm(built.value.display);
      } catch {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_CONFIRMATION_FAILED",
          "Unsigned beta confirmation could not be completed."
        );
      }
      if (!confirmed) {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_APPROVAL_DISMISSED",
          "The Change Set remains pending because unsigned beta confirmation was cancelled."
        );
      }

      const confirmedAt = readNow(now);
      if (confirmedAt === undefined) return clockFailure();
      const authorizationAfter = currentGrant(options, confirmedAt, built.value.binding.expiresAt);
      if (authorizationAfter === undefined || authorizationAfter !== authorizationBefore) {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_STALE",
          "Unsigned beta authorization changed or expired while confirmation was open."
        );
      }

      let issued: Awaited<ReturnType<typeof options.authorizationLedger.issue>>;
      try {
        issued = await options.authorizationLedger.issue(built.value.binding);
      } catch {
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_ISSUE_FAILED",
          "Unsigned beta authorization could not be issued."
        );
      }
      if (!issued.ok) return issued;
      let transactionId: string;
      try {
        transactionId = createTransactionId();
      } catch {
        await safeRevoke(options, issued.value.authorizationId, "transaction_id_failed");
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_TRANSACTION_INVALID",
          "Main could not create a valid authorization transaction."
        );
      }
      if (!STABLE_ID.test(transactionId)) {
        await safeRevoke(options, issued.value.authorizationId, "transaction_id_invalid");
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_TRANSACTION_INVALID",
          "Main could not create a valid authorization transaction."
        );
      }
      let reserved: Awaited<ReturnType<typeof options.authorizationLedger.reserve>>;
      try {
        reserved = await options.authorizationLedger.reserve({
          authorizationId: issued.value.authorizationId,
          transactionId
        });
      } catch {
        await safeRevoke(options, issued.value.authorizationId, "authorization_reservation_failed");
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_RESERVATION_FAILED",
          "Unsigned beta authorization could not be reserved."
        );
      }
      if (!reserved.ok) {
        await safeRevoke(options, issued.value.authorizationId, "authorization_reservation_failed");
        return reserved;
      }

      const reservedAt = readNow(now);
      const authorizationReserved =
        reservedAt === undefined
          ? undefined
          : currentGrant(options, reservedAt, built.value.binding.expiresAt);
      if (authorizationReserved !== authorizationBefore) {
        await safeRevoke(options, issued.value.authorizationId, "beta_authorization_stale");
        return failure(
          "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_STALE",
          "Unsigned beta authorization changed or expired before the reservation completed."
        );
      }

      const resolvedAt = readNow(now);
      if (resolvedAt === undefined) {
        await safeRevoke(options, issued.value.authorizationId, "clock_invalid");
        return clockFailure();
      }

      return ok({
        changeSet: input.changeSet,
        decision: "apply_selected",
        displayBindingChecksum: input.changeSet.displayBindingChecksum,
        binding: built.value.binding,
        authorizationId: issued.value.authorizationId,
        reservationTransactionId: transactionId,
        resolvedAt
      } satisfies DecideChangeSetApprovalV2Input);
    }
  });
}

function currentGrant(
  options: UnsignedBetaChangeSetApprovalV2Options,
  observedAt: string,
  bindingExpiresAt: string
): UnsignedBetaAuthorizationV1 | undefined {
  let authorization: UnsignedBetaAuthorizationV1 | undefined;
  try {
    authorization = options.getCurrentAuthorization();
  } catch {
    return undefined;
  }
  if (
    !hasCurrentUnsignedBetaAuthorization(authorization, options.packageIdentityChecksum, observedAt)
  ) {
    return undefined;
  }
  const grantExpiresAt = Date.parse(authorization.expiresAt);
  const requiredExpiryAt = Date.parse(bindingExpiresAt);
  return Number.isFinite(grantExpiresAt) &&
    Number.isFinite(requiredExpiryAt) &&
    grantExpiresAt >= requiredExpiryAt
    ? authorization
    : undefined;
}

function isAllowedOperation(operation: string): boolean {
  return (
    operation === "replace_file" ||
    operation === "create_file" ||
    operation === "move_file" ||
    operation === "create_directory"
  );
}

function readNow(now: () => string): string | undefined {
  try {
    const value = now();
    return Number.isFinite(Date.parse(value)) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function safeRevoke(
  options: UnsignedBetaChangeSetApprovalV2Options,
  authorizationId: string,
  reason: string
): Promise<void> {
  try {
    await options.authorizationLedger.revoke(authorizationId, reason);
  } catch {
    // The caller still fails closed; ledger persistence owns recovery of an interrupted revoke.
  }
}

function clockFailure<T = never>(): Result<T, UnifiedError> {
  return failure(
    "CHANGE_SET_UNSIGNED_BETA_CLOCK_INVALID",
    "The Main approval clock is unavailable."
  );
}

function failure<T = never>(code: string, message: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "AgentError",
      message,
      recoverability: "user-action",
      suggestedAction:
        "Authorize this unsigned beta package again and retry the current Change Set.",
      traceId: "desktop-unsigned-beta-change-set-approval-v2"
    })
  );
}
