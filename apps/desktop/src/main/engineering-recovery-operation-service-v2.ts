import { randomUUID } from "node:crypto";
import {
  ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION,
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationPortV2,
  type EngineeringFileMutationRootBindingV2,
  type EngineeringFileRestoreReceiptV2,
  type EngineeringFileRestoreRequestV2,
  type EngineeringLifecycleRecoveryRootBindingV2,
  type EngineeringQuarantinePurgeInputV2,
  type EngineeringRecoveryOperationAuthenticatorV2,
  type EngineeringRecoveryRestorePreviewV2,
  type EngineeringRecoveryRootRepositoryV2
} from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopEngineeringRestoreTargetObservationV2 {
  readonly targetState: "absent" | "present";
  readonly pathAllowed: boolean;
  readonly policyCurrent: boolean;
}

export interface DesktopEngineeringPurgeDecisionInputV2 {
  readonly recoveryObjectId: string;
  readonly actor: "local_user" | "retention_policy";
  readonly reason: "user_confirmed" | "retention_expired";
  readonly decidedAt: string;
  readonly contentRootBindingId: string;
  readonly recoveryRootBindingId: string;
  readonly recoveryGrantRevision: string;
  readonly recoverySideEffectChecksum: string;
}

export interface DesktopEngineeringDurablePurgeDecisionV2 {
  readonly decisionChecksum: string;
}

export interface DesktopEngineeringRecoveryOperationPortV2 {
  readonly inspectQuarantine: NonNullable<EngineeringFileMutationPortV2["inspectQuarantine"]>;
  readonly restore: NonNullable<EngineeringFileMutationPortV2["restore"]>;
  readonly purge: NonNullable<EngineeringFileMutationPortV2["purge"]>;
}

export interface DesktopEngineeringRecoveryOperationServiceV2Options {
  readonly repository: EngineeringRecoveryRootRepositoryV2;
  readonly contentRootBinding: EngineeringFileMutationRootBindingV2;
  readonly recoveryBinding: EngineeringLifecycleRecoveryRootBindingV2;
  readonly createPort: (
    authenticateRecoveryOperation: EngineeringRecoveryOperationAuthenticatorV2
  ) => DesktopEngineeringRecoveryOperationPortV2;
  readonly inspectRestoreTarget: (
    relativeIdentity: string
  ) => Promise<Result<DesktopEngineeringRestoreTargetObservationV2, UnifiedError>>;
  /**
   * Main must verify the current quarantined/unpinned manifest (including retention expiry for
   * policy decisions) and must not resolve until that exact decision is durable.
   */
  readonly persistPurgeDecision: (
    input: DesktopEngineeringPurgeDecisionInputV2
  ) => Promise<Result<DesktopEngineeringDurablePurgeDecisionV2, UnifiedError>>;
  readonly now?: () => string;
  readonly allocateId?: (kind: "transaction" | "operation" | "staging") => string;
  readonly traceId?: string;
}

export interface DesktopEngineeringRecoveryOperationServiceV2 {
  previewRestore(
    input: unknown
  ): Promise<Result<EngineeringRecoveryRestorePreviewV2, UnifiedError>>;
  restore(input: unknown): Promise<Result<EngineeringFileRestoreReceiptV2, UnifiedError>>;
  purge(input: unknown): Promise<Result<void, UnifiedError>>;
}

/** Main-only restore/purge boundary. It is intentionally not exported through IPC or tools. */
export function createDesktopEngineeringRecoveryOperationServiceV2(
  options: DesktopEngineeringRecoveryOperationServiceV2Options
): DesktopEngineeringRecoveryOperationServiceV2 {
  const traceId = options.traceId ?? "desktop-engineering-recovery-operation-service-v2";
  const now = options.now ?? (() => new Date().toISOString());
  const allocateId =
    options.allocateId ??
    ((kind: "transaction" | "operation" | "staging") =>
      `${kind}_${randomUUID().replaceAll("-", "")}`);
  let authorization: OneShotRecoveryAuthorizationV2 | undefined;
  const authenticateRecoveryOperation: EngineeringRecoveryOperationAuthenticatorV2 = (input) => {
    const current = authorization;
    if (current === undefined || current.consumed || authorizationKey(input) !== current.key) {
      return err(unauthorized(traceId));
    }
    current.consumed = true;
    return ok(undefined);
  };
  const port = options.createPort(authenticateRecoveryOperation);

  async function previewRestore(
    input: unknown
  ): Promise<Result<EngineeringRecoveryRestorePreviewV2, UnifiedError>> {
    const parsed = parseRestorePreviewInput(input, traceId);
    if (!parsed.ok) return parsed;
    const root = await options.repository.scanRoot();
    if (!root.ok) return root;
    if (root.value.status !== "clear") return err(blocked(traceId));
    const record = await options.repository.read(parsed.value.recoveryObjectId);
    if (!record.ok) return record;
    if (record.value === undefined) return err(missing(traceId));
    const metadata = await options.repository.createRestorePreview({
      recoveryObjectId: parsed.value.recoveryObjectId,
      targetState: "present",
      pathAllowed: false,
      policyCurrent: false
    });
    if (!metadata.ok) return metadata;
    const observation = await safelyInspectRestoreTarget(
      options.inspectRestoreTarget,
      metadata.value.relativeIdentity,
      traceId
    );
    if (!observation.ok) return observation;
    return options.repository.createRestorePreview({
      recoveryObjectId: parsed.value.recoveryObjectId,
      targetState: observation.value.targetState,
      pathAllowed: observation.value.pathAllowed,
      policyCurrent: observation.value.policyCurrent
    });
  }

  return Object.freeze({
    previewRestore,

    async restore(input: unknown): Promise<Result<EngineeringFileRestoreReceiptV2, UnifiedError>> {
      const parsed = parseRestoreInput(input, traceId);
      if (!parsed.ok) return parsed;
      const preview = await previewRestore({ recoveryObjectId: parsed.value.recoveryObjectId });
      if (!preview.ok) return preview;
      if (
        preview.value.state !== "ready" ||
        preview.value.previewChecksum !== parsed.value.previewChecksum
      ) {
        return err(stalePreview(traceId));
      }
      const inventory = await port.inspectQuarantine(options.recoveryBinding);
      if (!inventory.ok) return inventory;
      const object = inventory.value.objects.find(
        (candidate) => candidate.recoveryObjectId === parsed.value.recoveryObjectId
      );
      if (object === undefined || object.sha256 !== preview.value.sourceSha256) {
        return err(blocked(traceId));
      }
      const request: EngineeringFileRestoreRequestV2 = Object.freeze({
        schemaVersion: ENGINEERING_FILE_LIFECYCLE_V2_SCHEMA_VERSION,
        operationKind: "restore_file",
        transactionId: allocateId("transaction"),
        operationId: allocateId("operation"),
        contentRootBindingId: options.contentRootBinding.contentRootBindingId,
        relativeSource: "",
        relativeTarget: preview.value.relativeIdentity,
        sourceFileIdentity: object.fileIdentity,
        sourceSha256: object.sha256,
        targetProof: "absent",
        recoveryRootBindingId: options.recoveryBinding.recoveryRootBindingId,
        recoveryGrantRevision: options.recoveryBinding.grantRevision,
        recoverySideEffectChecksum: options.recoveryBinding.sideEffectChecksum,
        recoveryObjectId: object.recoveryObjectId,
        stagingObjectId: allocateId("staging"),
        expectedState: "wal_prepared"
      });
      const expected = {
        kind: "restore" as const,
        rootBinding: options.contentRootBinding,
        recoveryBinding: options.recoveryBinding,
        request
      };
      const restored = await invokeAuthorized(expected, () =>
        port.restore({ request, recoveryBinding: options.recoveryBinding })
      );
      if (!restored.ok) return restored;
      const marked = await options.repository.markRestored({
        recoveryObjectId: object.recoveryObjectId,
        at: now(),
        preview: preview.value
      });
      return marked.ok ? restored : err(marked.error);
    },

    async purge(input: unknown): Promise<Result<void, UnifiedError>> {
      const parsed = parsePurgeInput(input, traceId);
      if (!parsed.ok) return parsed;
      const root = await options.repository.scanRoot();
      if (!root.ok) return root;
      if (root.value.status !== "clear") return err(blocked(traceId));
      const record = await options.repository.read(parsed.value.recoveryObjectId);
      if (!record.ok) return record;
      if (record.value === undefined || record.value.state !== "quarantined") {
        return err(missing(traceId));
      }
      const decisionInput: DesktopEngineeringPurgeDecisionInputV2 = Object.freeze({
        ...parsed.value,
        contentRootBindingId: options.contentRootBinding.contentRootBindingId,
        recoveryRootBindingId: options.recoveryBinding.recoveryRootBindingId,
        recoveryGrantRevision: options.recoveryBinding.grantRevision,
        recoverySideEffectChecksum: options.recoveryBinding.sideEffectChecksum
      });
      const durableDecision = await safelyPersistPurgeDecision(
        options.persistPurgeDecision,
        decisionInput,
        traceId
      );
      if (!durableDecision.ok) return durableDecision;
      if (
        !hasExactKeys(durableDecision.value, ["decisionChecksum"]) ||
        !isSha256(durableDecision.value.decisionChecksum)
      ) {
        return err(invalid("ENGINEERING_RECOVERY_PURGE_DECISION_INVALID", traceId));
      }
      const retentionDecision: EngineeringQuarantinePurgeInputV2["retentionDecision"] =
        Object.freeze({
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          kind: "engineering_quarantine_retention_decision",
          contentRootBindingId: decisionInput.contentRootBindingId,
          recoveryRootBindingId: decisionInput.recoveryRootBindingId,
          recoveryGrantRevision: decisionInput.recoveryGrantRevision,
          recoverySideEffectChecksum: decisionInput.recoverySideEffectChecksum,
          recoveryObjectId: decisionInput.recoveryObjectId,
          state: "purge_authorized",
          decisionChecksum: durableDecision.value.decisionChecksum
        });
      const expected = {
        kind: "purge" as const,
        rootBinding: options.contentRootBinding,
        recoveryBinding: options.recoveryBinding,
        retentionDecision
      };
      const purged = await invokeAuthorized(expected, () =>
        port.purge({ recoveryBinding: options.recoveryBinding, retentionDecision })
      );
      if (!purged.ok) return purged;
      const marked = await options.repository.markPurged({
        recoveryObjectId: decisionInput.recoveryObjectId,
        actor: decisionInput.actor,
        reason: decisionInput.reason,
        at: decisionInput.decidedAt
      });
      return marked.ok ? ok(undefined) : err(marked.error);
    }
  });

  async function invokeAuthorized<T>(
    expected: Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0],
    invoke: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    if (authorization !== undefined) return err(unauthorized(traceId));
    authorization = { key: authorizationKey(expected), consumed: false };
    try {
      const result = await invoke();
      if (!authorization.consumed) return err(unauthorized(traceId));
      return result;
    } catch {
      return err(nativeFailure(traceId));
    } finally {
      authorization = undefined;
    }
  }
}

interface OneShotRecoveryAuthorizationV2 {
  readonly key: string;
  consumed: boolean;
}

function authorizationKey(
  input: Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0]
): string {
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json({
      kind: input.kind,
      rootBinding: {
        contentRootBindingId: input.rootBinding.contentRootBindingId,
        rootId: String(input.rootBinding.rootId)
      },
      recoveryBinding: {
        recoveryRootBindingId: input.recoveryBinding.recoveryRootBindingId,
        recoveryRootId: String(input.recoveryBinding.recoveryRootId),
        grantRevision: input.recoveryBinding.grantRevision,
        sideEffectChecksum: input.recoveryBinding.sideEffectChecksum
      },
      ...(input.request === undefined ? {} : { request: input.request }),
      ...(input.retentionDecision === undefined
        ? {}
        : { retentionDecision: input.retentionDecision })
    })
  );
}

async function safelyInspectRestoreTarget(
  inspect: DesktopEngineeringRecoveryOperationServiceV2Options["inspectRestoreTarget"],
  relativeIdentity: string,
  traceId: string
): Promise<Result<DesktopEngineeringRestoreTargetObservationV2, UnifiedError>> {
  try {
    const result = await inspect(relativeIdentity);
    if (!result.ok) return result;
    return isRestoreTargetObservation(result.value)
      ? result
      : err(invalid("ENGINEERING_RECOVERY_RESTORE_OBSERVATION_INVALID", traceId));
  } catch {
    return err(blocked(traceId));
  }
}

async function safelyPersistPurgeDecision(
  persist: DesktopEngineeringRecoveryOperationServiceV2Options["persistPurgeDecision"],
  input: DesktopEngineeringPurgeDecisionInputV2,
  traceId: string
): Promise<Result<DesktopEngineeringDurablePurgeDecisionV2, UnifiedError>> {
  try {
    return await persist(input);
  } catch {
    return err(invalid("ENGINEERING_RECOVERY_PURGE_DECISION_NOT_DURABLE", traceId));
  }
}

function parseRestorePreviewInput(
  input: unknown,
  traceId: string
): Result<{ readonly recoveryObjectId: string }, UnifiedError> {
  if (!hasExactKeys(input, ["recoveryObjectId"]) || !isStableId(input["recoveryObjectId"])) {
    return err(invalid("ENGINEERING_RECOVERY_RESTORE_INPUT_INVALID", traceId));
  }
  return ok({ recoveryObjectId: input["recoveryObjectId"] as string });
}

function parseRestoreInput(
  input: unknown,
  traceId: string
): Result<{ readonly recoveryObjectId: string; readonly previewChecksum: string }, UnifiedError> {
  if (
    !hasExactKeys(input, ["previewChecksum", "recoveryObjectId"]) ||
    !isStableId(input["recoveryObjectId"]) ||
    !isSha256(input["previewChecksum"])
  ) {
    return err(invalid("ENGINEERING_RECOVERY_RESTORE_INPUT_INVALID", traceId));
  }
  return ok({
    recoveryObjectId: input["recoveryObjectId"] as string,
    previewChecksum: input["previewChecksum"] as string
  });
}

function parsePurgeInput(
  input: unknown,
  traceId: string
): Result<
  Pick<
    DesktopEngineeringPurgeDecisionInputV2,
    "recoveryObjectId" | "actor" | "reason" | "decidedAt"
  >,
  UnifiedError
> {
  if (
    !hasExactKeys(input, ["actor", "decidedAt", "reason", "recoveryObjectId"]) ||
    !isStableId(input["recoveryObjectId"]) ||
    (input["actor"] !== "local_user" && input["actor"] !== "retention_policy") ||
    (input["reason"] !== "user_confirmed" && input["reason"] !== "retention_expired") ||
    (input["actor"] === "local_user" && input["reason"] !== "user_confirmed") ||
    (input["actor"] === "retention_policy" && input["reason"] !== "retention_expired") ||
    !isCanonicalUtcTimestamp(input["decidedAt"])
  ) {
    return err(invalid("ENGINEERING_RECOVERY_PURGE_INPUT_INVALID", traceId));
  }
  return ok({
    recoveryObjectId: input["recoveryObjectId"] as string,
    actor: input["actor"] as "local_user" | "retention_policy",
    reason: input["reason"] as "user_confirmed" | "retention_expired",
    decidedAt: input["decidedAt"] as string
  });
}

function isRestoreTargetObservation(
  value: unknown
): value is DesktopEngineeringRestoreTargetObservationV2 {
  return (
    hasExactKeys(value, ["pathAllowed", "policyCurrent", "targetState"]) &&
    (value["targetState"] === "absent" || value["targetState"] === "present") &&
    typeof value["pathAllowed"] === "boolean" &&
    typeof value["policyCurrent"] === "boolean"
  );
}

function hasExactKeys<const K extends readonly string[]>(
  value: unknown,
  keys: K
): value is Record<K[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    new Date(value).toISOString() === value
  );
}

function invalid(code: string, traceId: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "Engineering recovery operation evidence is invalid.",
    recoverability: "user-action",
    suggestedAction: "Refresh the Main-owned recovery review before retrying.",
    traceId
  });
}

function unauthorized(traceId: string): UnifiedError {
  return createUnifiedError({
    code: "ENGINEERING_RECOVERY_OPERATION_UNAUTHORIZED",
    category: "UserError",
    message: "Engineering recovery operation does not have an exact one-shot authorization.",
    recoverability: "user-action",
    suggestedAction: "Restart the trusted local recovery action from a current preview.",
    traceId
  });
}

function blocked(traceId: string): UnifiedError {
  return createUnifiedError({
    code: "ENGINEERING_RECOVERY_ROOT_BLOCKED",
    category: "StorageError",
    message: "Engineering recovery storage requires review before mutation can continue.",
    recoverability: "user-action",
    suggestedAction: "Review and reconcile recovery storage before retrying.",
    traceId
  });
}

function missing(traceId: string): UnifiedError {
  return createUnifiedError({
    code: "ENGINEERING_RECOVERY_OBJECT_MISSING",
    category: "UserError",
    message: "Engineering recovery object is unavailable.",
    recoverability: "user-action",
    suggestedAction: "Refresh the recovery review.",
    traceId
  });
}

function stalePreview(traceId: string): UnifiedError {
  return createUnifiedError({
    code: "ENGINEERING_RECOVERY_RESTORE_PREVIEW_STALE",
    category: "ValidationError",
    message: "Engineering restore preview is stale or no longer safe to apply.",
    recoverability: "user-action",
    suggestedAction: "Review a fresh restore preview.",
    traceId
  });
}

function nativeFailure(traceId: string): UnifiedError {
  return createUnifiedError({
    code: "ENGINEERING_RECOVERY_NATIVE_FAILURE",
    category: "StorageError",
    message: "Engineering recovery native operation failed.",
    recoverability: "retryable",
    suggestedAction: "Keep the recovery root blocked and retry through Main recovery review.",
    traceId
  });
}
