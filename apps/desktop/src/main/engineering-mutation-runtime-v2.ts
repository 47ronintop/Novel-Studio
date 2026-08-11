import {
  validateEngineeringRelativePath,
  type EngineeringRelativePathValidation
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

/** Main-only orchestration contract for the B7 replace/create release. */
export const ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION = "2.0" as const;

export type EngineeringMutationRuntimeOperationKindV2 =
  "replace_file" | "create_file" | "move_file" | "delete_file" | "create_directory";

export interface EngineeringMutationRuntimeApplyRequestV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION;
  readonly operationKind: EngineeringMutationRuntimeOperationKindV2;
  readonly contentRootBindingId: string;
  /** Canonical, ordered, deduplicated target identities supplied by Main's frozen proposal. */
  readonly relativeIdentities: readonly string[];
  readonly proposalRevision: string;
  readonly proposalBindingChecksum: string;
  readonly approvalBindingId: string;
  readonly approvalBindingChecksum: string;
  readonly capabilityRevision: string;
  /** Opaque Main-owned input passed unchanged to EngineeringWriteTransactionV2.apply(). */
  readonly transactionInput: unknown;
}

export interface EngineeringMutationRuntimeValidatedRequestV2 extends EngineeringMutationRuntimeApplyRequestV2 {
  /** Bound transaction identity used only in local sync/recovery records. */
  readonly transactionId: string;
}

export interface EngineeringMutationRuntimeResultV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION;
  readonly status: "committed";
  readonly contentRootBindingId: string;
  readonly transactionId: string;
}

export interface EngineeringMutationRootLeaseV2 {
  readonly contentRootBindingId: string;
  /** Revalidates the exact native-root lease immediately before a mutation. */
  assertCurrent(): Promise<Result<void, UnifiedError>>;
  release(): Promise<void> | void;
}

export interface EngineeringMutationRootLeasePortV2 {
  acquire(
    contentRootBindingId: string
  ): Promise<Result<EngineeringMutationRootLeaseV2, UnifiedError>>;
}

export interface EngineeringMutationRecoveryGatePortV2 {
  assertMutationAllowed(contentRootBindingId: string): Promise<Result<void, UnifiedError>>;
}

export interface EngineeringMutationSavePauseV2 {
  release(): Promise<void> | void;
}

/** Must pause and drain every ordinary save/autosave attached to this root, not just targets. */
export interface EngineeringMutationSaveCoordinatorPortV2 {
  pauseAndDrainRoot(input: {
    readonly contentRootBindingId: string;
    readonly relativeIdentities: readonly string[];
  }): Promise<Result<EngineeringMutationSavePauseV2, UnifiedError>>;
}

export type EngineeringMutationEditorPreflightV2 =
  | Readonly<{ readonly status: "ready" }>
  | Readonly<{ readonly status: "dirty" }>
  | Readonly<{ readonly status: "unknown" }>
  | Readonly<{ readonly status: "disconnected" }>;

/** The renderer never supplies this decision directly; Main's registry owns the port. */
export interface EngineeringMutationEditorStatePortV2 {
  inspectAll(input: {
    readonly contentRootBindingId: string;
    readonly relativeIdentities: readonly string[];
  }): Promise<Result<EngineeringMutationEditorPreflightV2, UnifiedError>>;
}

/** Rechecks frozen proposal, approval binding, capability revision, and all raw-byte evidence. */
export interface EngineeringMutationProposalApprovalPortV2 {
  revalidate(
    request: EngineeringMutationRuntimeApplyRequestV2
  ): Promise<Result<EngineeringMutationRuntimeValidatedRequestV2, UnifiedError>>;
}

/** Structural adapter for the independent Repository V2 coordinator, which is intentionally not re-exported yet. */
export interface EngineeringWriteTransactionV2ApplyPort {
  apply(input: unknown): Promise<Result<unknown, UnifiedError>>;
}

export interface EngineeringMutationSyncPortV2 {
  synchronize(input: {
    readonly contentRootBindingId: string;
    readonly operationKind: EngineeringMutationRuntimeOperationKindV2;
    readonly relativeIdentities: readonly string[];
    readonly transactionId: string;
  }): Promise<Result<void, UnifiedError>>;
}

export interface EngineeringMutationSyncRequiredRecordV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION;
  readonly kind: "sync_required";
  readonly contentRootBindingId: string;
  readonly transactionId: string;
  readonly operationKind: EngineeringMutationRuntimeOperationKindV2;
  readonly relativeIdentities: readonly string[];
  readonly recordedAt: string;
}

/** Durable Main-owned state. It intentionally has no renderer/provider clear operation. */
export interface EngineeringMutationSyncRequiredPortV2 {
  assertNoSyncRequired(contentRootBindingId: string): Promise<Result<void, UnifiedError>>;
  writeSyncRequired(
    record: EngineeringMutationSyncRequiredRecordV2
  ): Promise<Result<void, UnifiedError>>;
}

export interface EngineeringMutationRuntimeV2Options {
  readonly recoveryGate: EngineeringMutationRecoveryGatePortV2;
  readonly rootLease: EngineeringMutationRootLeasePortV2;
  readonly saveCoordinator: EngineeringMutationSaveCoordinatorPortV2;
  readonly editorState: EngineeringMutationEditorStatePortV2;
  readonly proposalApproval: EngineeringMutationProposalApprovalPortV2;
  readonly transaction: EngineeringWriteTransactionV2ApplyPort;
  /** B8 lifecycle writes must cross the same root/save/editor/sync coordinator. */
  readonly lifecycleTransaction?: EngineeringWriteTransactionV2ApplyPort;
  readonly synchronizer: EngineeringMutationSyncPortV2;
  readonly syncRequired: EngineeringMutationSyncRequiredPortV2;
  /** Main uses this to synchronously hide mutation tools while preserving qualified read access. */
  readonly onMutationUnavailable?: () => void;
  readonly now?: () => string;
  readonly traceId?: string;
}

export interface EngineeringMutationRuntimeV2 {
  apply(input: unknown): Promise<Result<EngineeringMutationRuntimeResultV2, UnifiedError>>;
}

/**
 * Main-only apply coordinator. All side-effecting dependencies are injected so the Desktop
 * composition can wire qualified native/runtime ports later without adding IPC or Renderer control.
 */
export function createEngineeringMutationRuntimeV2(
  options: EngineeringMutationRuntimeV2Options
): EngineeringMutationRuntimeV2 {
  const now = options.now ?? (() => new Date().toISOString());
  const traceId = options.traceId ?? "engineering-mutation-runtime-v2";
  const locallyBlockedRoots = new Set<string>();
  const inFlightRoots = new Set<string>();

  return Object.freeze({
    async apply(input: unknown): Promise<Result<EngineeringMutationRuntimeResultV2, UnifiedError>> {
      const request = parseApplyRequest(input);
      if (request === undefined)
        return invalid("ENGINEERING_MUTATION_RUNTIME_INPUT_INVALID", traceId);
      if (locallyBlockedRoots.has(request.contentRootBindingId)) {
        notifyMutationUnavailable(options);
        return syncRequiredBlocked(traceId);
      }
      if (inFlightRoots.has(request.contentRootBindingId)) {
        return unavailable("ENGINEERING_MUTATION_RUNTIME_ROOT_BUSY", traceId);
      }
      inFlightRoots.add(request.contentRootBindingId);
      try {
        return await applyRequest(request, options, now, traceId, locallyBlockedRoots);
      } finally {
        inFlightRoots.delete(request.contentRootBindingId);
      }
    }
  });
}

async function applyRequest(
  request: EngineeringMutationRuntimeApplyRequestV2,
  options: EngineeringMutationRuntimeV2Options,
  now: () => string,
  traceId: string,
  locallyBlockedRoots: Set<string>
): Promise<Result<EngineeringMutationRuntimeResultV2, UnifiedError>> {
  // 1. A startup scan/gate must be clear before a root lease or pause is attempted.
  const gate = await safely(
    () => options.recoveryGate.assertMutationAllowed(request.contentRootBindingId),
    traceId
  );
  if (!gate.ok) {
    notifyMutationUnavailable(options);
    return gate;
  }
  const syncClear = await safely(
    () => options.syncRequired.assertNoSyncRequired(request.contentRootBindingId),
    traceId
  );
  if (!syncClear.ok) {
    notifyMutationUnavailable(options);
    return syncClear;
  }

  // 2. Acquire a lease bound to exactly this root; a different-root lease is a protocol failure.
  const acquired = await safely(
    () => options.rootLease.acquire(request.contentRootBindingId),
    traceId
  );
  if (!acquired.ok) return acquired;
  const lease = acquired.value;
  if (lease.contentRootBindingId !== request.contentRootBindingId) {
    await releaseSafely(lease);
    return unavailable("ENGINEERING_MUTATION_RUNTIME_LEASE_ROOT_MISMATCH", traceId);
  }

  try {
    const leaseAtStart = await safely(() => lease.assertCurrent(), traceId);
    if (!leaseAtStart.ok) return leaseAtStart;

    // 3. This port pauses and drains all saves for the root before inspecting any editor state.
    const paused = await safely(
      () =>
        options.saveCoordinator.pauseAndDrainRoot({
          contentRootBindingId: request.contentRootBindingId,
          relativeIdentities: request.relativeIdentities
        }),
      traceId
    );
    if (!paused.ok) return paused;
    const savePause = paused.value;

    try {
      // 4. Every affected editor must be connected, acknowledged and clean.
      const editors = await safely(
        () =>
          options.editorState.inspectAll({
            contentRootBindingId: request.contentRootBindingId,
            relativeIdentities: request.relativeIdentities
          }),
        traceId
      );
      if (!editors.ok) return editors;
      const editorFailure = editorPreflightFailure(editors.value, traceId);
      if (editorFailure !== undefined) return editorFailure;

      // 5. Revalidate frozen proposal + approval only after save/editor state is stable.
      const validated = await safely(() => options.proposalApproval.revalidate(request), traceId);
      if (!validated.ok) return validated;
      if (!validatedResponseMatchesRequest(validated.value, request)) {
        return unavailable("ENGINEERING_MUTATION_RUNTIME_REVALIDATION_MISMATCH", traceId);
      }

      // The immediately-pre-apply rechecks close gate/lease drift between preflight and native work.
      const gateBeforeApply = await safely(
        () => options.recoveryGate.assertMutationAllowed(request.contentRootBindingId),
        traceId
      );
      if (!gateBeforeApply.ok) {
        notifyMutationUnavailable(options);
        return gateBeforeApply;
      }
      const leaseBeforeApply = await safely(() => lease.assertCurrent(), traceId);
      if (!leaseBeforeApply.ok) return leaseBeforeApply;

      // 6. Repository V2 owns the durable blob/prepared/native/receipt/progress/commit sequence.
      const transactionPort = isLifecycleOperation(request.operationKind)
        ? options.lifecycleTransaction
        : options.transaction;
      if (transactionPort === undefined) {
        return unavailable("ENGINEERING_LIFECYCLE_TRANSACTION_UNAVAILABLE", traceId);
      }
      const transaction = await safely(
        () => transactionPort.apply(validated.value.transactionInput),
        traceId
      );
      if (!transaction.ok) {
        const gateAfterFailure = await safely(
          () => options.recoveryGate.assertMutationAllowed(request.contentRootBindingId),
          traceId
        );
        if (!gateAfterFailure.ok) notifyMutationUnavailable(options);
        return transaction;
      }
      const committed = parseCommittedTransaction(transaction.value, validated.value);
      if (committed === undefined) {
        return unavailable("ENGINEERING_MUTATION_RUNTIME_TRANSACTION_PROTOCOL_INVALID", traceId);
      }

      // 7. Disk has committed: editor/tree/index synchronization is now mandatory, not best effort.
      const synchronized = await safely(
        () =>
          options.synchronizer.synchronize({
            contentRootBindingId: request.contentRootBindingId,
            operationKind: request.operationKind,
            relativeIdentities: request.relativeIdentities,
            transactionId: committed.transactionId
          }),
        traceId
      );
      if (!synchronized.ok) {
        locallyBlockedRoots.add(request.contentRootBindingId);
        const recorded = await safely(
          () =>
            options.syncRequired.writeSyncRequired({
              schemaVersion: ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
              kind: "sync_required",
              contentRootBindingId: request.contentRootBindingId,
              transactionId: committed.transactionId,
              operationKind: request.operationKind,
              relativeIdentities: request.relativeIdentities,
              recordedAt: now()
            }),
          traceId
        );
        notifyMutationUnavailable(options);
        return recorded.ok
          ? syncRequiredFailure(traceId)
          : unavailable("ENGINEERING_MUTATION_RUNTIME_SYNC_REQUIRED_PERSIST_FAILED", traceId);
      }

      return ok(
        Object.freeze({
          schemaVersion: ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
          status: "committed" as const,
          contentRootBindingId: request.contentRootBindingId,
          transactionId: committed.transactionId
        })
      );
    } finally {
      await releaseSafely(savePause);
    }
  } finally {
    // 8. Release happens only after all sync/sync-required work has settled.
    await releaseSafely(lease);
  }
}

function notifyMutationUnavailable(options: EngineeringMutationRuntimeV2Options): void {
  try {
    options.onMutationUnavailable?.();
  } catch {
    // The runtime remains fail-closed even when the host cannot refresh its UI projection.
  }
}

function parseApplyRequest(value: unknown): EngineeringMutationRuntimeApplyRequestV2 | undefined {
  if (!hasExactKeys(value, applyRequestKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION ||
    !isOperationKind(value["operationKind"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isCanonicalTargetList(value["relativeIdentities"]) ||
    !isStableId(value["proposalRevision"]) ||
    !isSha256(value["proposalBindingChecksum"]) ||
    !isStableId(value["approvalBindingId"]) ||
    !isSha256(value["approvalBindingChecksum"]) ||
    !isStableId(value["capabilityRevision"])
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
    operationKind: value["operationKind"] as EngineeringMutationRuntimeOperationKindV2,
    contentRootBindingId: value["contentRootBindingId"] as string,
    relativeIdentities: Object.freeze([...(value["relativeIdentities"] as string[])]),
    proposalRevision: value["proposalRevision"] as string,
    proposalBindingChecksum: value["proposalBindingChecksum"] as string,
    approvalBindingId: value["approvalBindingId"] as string,
    approvalBindingChecksum: value["approvalBindingChecksum"] as string,
    capabilityRevision: value["capabilityRevision"] as string,
    transactionInput: value["transactionInput"]
  });
}

function validatedResponseMatchesRequest(
  value: unknown,
  request: EngineeringMutationRuntimeApplyRequestV2
): value is EngineeringMutationRuntimeValidatedRequestV2 {
  if (!hasExactKeys(value, validatedRequestKeys)) return false;
  return (
    value["schemaVersion"] === ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION &&
    value["operationKind"] === request.operationKind &&
    value["contentRootBindingId"] === request.contentRootBindingId &&
    sameTargetList(value["relativeIdentities"], request.relativeIdentities) &&
    value["proposalRevision"] === request.proposalRevision &&
    value["proposalBindingChecksum"] === request.proposalBindingChecksum &&
    value["approvalBindingId"] === request.approvalBindingId &&
    value["approvalBindingChecksum"] === request.approvalBindingChecksum &&
    value["capabilityRevision"] === request.capabilityRevision &&
    isStableId(value["transactionId"])
  );
}

function parseCommittedTransaction(
  value: unknown,
  request: EngineeringMutationRuntimeValidatedRequestV2
): Readonly<{ transactionId: string }> | undefined {
  if (!isRecord(value) || !isRecord(value["prepared"])) return undefined;
  const prepared = value["prepared"];
  if (
    prepared["transactionId"] !== request.transactionId ||
    prepared["contentRootBindingId"] !== request.contentRootBindingId
  ) {
    return undefined;
  }
  const commit = value["commit"];
  if (
    isRecord(commit) &&
    commit["transactionId"] === request.transactionId &&
    commit["contentRootBindingId"] === request.contentRootBindingId
  ) {
    return Object.freeze({ transactionId: request.transactionId });
  }
  return value["kind"] === "engineering_lifecycle_write_ahead_log" &&
    isCanonicalTimestamp(value["committedAt"]) &&
    value["rolledBackAt"] === null &&
    Array.isArray(prepared["operations"]) &&
    Array.isArray(value["receipts"]) &&
    value["receipts"].length === prepared["operations"].length
    ? Object.freeze({ transactionId: request.transactionId })
    : undefined;
}

function editorPreflightFailure(
  decision: EngineeringMutationEditorPreflightV2,
  traceId: string
): Result<never, UnifiedError> | undefined {
  if (decision.status === "ready") return undefined;
  if (decision.status === "dirty") {
    return unavailable("ENGINEERING_MUTATION_RUNTIME_EDITOR_DIRTY", traceId);
  }
  return unavailable("ENGINEERING_MUTATION_RUNTIME_EDITOR_STATE_UNKNOWN", traceId);
}

function isCanonicalTargetList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  const targets: string[] = [];
  for (const candidate of value) {
    const validation: EngineeringRelativePathValidation =
      validateEngineeringRelativePath(candidate);
    if (!validation.ok) return false;
    targets.push(validation.relativeIdentity);
  }
  return (
    new Set(targets).size === targets.length &&
    targets.every((target, index) => {
      if (index === 0) return true;
      const previous = targets[index - 1];
      return previous !== undefined && previous.localeCompare(target) < 0;
    })
  );
}

function sameTargetList(value: unknown, expected: readonly string[]): boolean {
  return (
    isCanonicalTargetList(value) &&
    value.length === expected.length &&
    value.every((target, index) => target === expected[index])
  );
}

function isOperationKind(value: unknown): value is EngineeringMutationRuntimeOperationKindV2 {
  return (
    value === "replace_file" ||
    value === "create_file" ||
    value === "move_file" ||
    value === "delete_file" ||
    value === "create_directory"
  );
}

function isLifecycleOperation(value: EngineeringMutationRuntimeOperationKindV2): boolean {
  return value === "move_file" || value === "delete_file" || value === "create_directory";
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

async function safely<T>(
  action: () => Promise<Result<T, UnifiedError>>,
  traceId: string
): Promise<Result<T, UnifiedError>> {
  try {
    return await action();
  } catch {
    return unavailable("ENGINEERING_MUTATION_RUNTIME_PORT_UNAVAILABLE", traceId);
  }
}

async function releaseSafely(value: { release(): Promise<void> | void }): Promise<void> {
  try {
    await value.release();
  } catch {
    // A qualified root lease/save coordinator owns its own persistent cleanup failure handling.
  }
}

function invalid<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "ValidationError",
      message: "Engineering mutation runtime input is invalid.",
      recoverability: "user-action",
      suggestedAction: "Regenerate the Main-owned replace or create proposal.",
      traceId
    })
  );
}

function unavailable<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "StorageError",
      message: "Engineering mutation is currently unavailable.",
      recoverability: "user-action",
      suggestedAction: "Resolve the Main-owned preflight condition before retrying.",
      traceId
    })
  );
}

function syncRequiredBlocked<T = never>(traceId: string): Result<T, UnifiedError> {
  return unavailable("ENGINEERING_MUTATION_RUNTIME_SYNC_REQUIRED", traceId);
}

function syncRequiredFailure<T = never>(traceId: string): Result<T, UnifiedError> {
  return unavailable("ENGINEERING_MUTATION_RUNTIME_SYNC_REQUIRED", traceId);
}

const applyRequestKeys = [
  "approvalBindingChecksum",
  "approvalBindingId",
  "capabilityRevision",
  "contentRootBindingId",
  "operationKind",
  "proposalBindingChecksum",
  "proposalRevision",
  "relativeIdentities",
  "schemaVersion",
  "transactionInput"
] as const;
const validatedRequestKeys = [...applyRequestKeys, "transactionId"] as const;
