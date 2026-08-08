import {
  EngineeringRecoveryGateV2,
  createEngineeringStartupRecoveryGateV2,
  type EngineeringRecoveryGateV2Options,
  type EngineeringStartupRecoveryGateSnapshotV2,
  type EngineeringStartupRecoveryGateV2
} from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopEngineeringRecoveryRuntimeV2Options extends Omit<
  EngineeringRecoveryGateV2Options,
  "now" | "traceId"
> {
  readonly contentRootBindingId: string;
  readonly now?: () => string;
  readonly traceId?: string;
}

export interface DesktopEngineeringRecoveryRuntimeV2 {
  readonly status: "clear" | "blocked";
  /** Startup-aware gate used by the Desktop apply coordinator and feature-state owner. */
  readonly startupGate: EngineeringStartupRecoveryGateV2;
  /** Prepared-record lease authority used only by EngineeringWriteTransactionV2. */
  readonly transactionGate: EngineeringRecoveryGateV2;
  readonly snapshot: EngineeringStartupRecoveryGateSnapshotV2;
  readonly capabilityRevision: string;
}

/**
 * Main-only B7 startup composition. It is unavailable until the complete root scan has finished;
 * a blocked scan is returned as data so Main can keep flags/tools/facts/UI closed without losing
 * the recovery reason. There is deliberately no Renderer/model clear operation.
 */
export async function createDesktopEngineeringRecoveryRuntimeV2(
  options: DesktopEngineeringRecoveryRuntimeV2Options
): Promise<Result<DesktopEngineeringRecoveryRuntimeV2, UnifiedError>> {
  const transactionGate = new EngineeringRecoveryGateV2({
    walRepository: options.walRepository,
    blobStore: options.blobStore,
    verifyContentRootAvailable: options.verifyContentRootAvailable,
    verifyPreparedAuthorization: options.verifyPreparedAuthorization,
    scanLegacyRecovery: options.scanLegacyRecovery,
    scanStaging: options.scanStaging,
    scanReservations: options.scanReservations,
    ...(options.now === undefined ? {} : { now: options.now }),
    traceId: options.traceId ?? "desktop-engineering-recovery-gate-v2"
  });
  const startupGate = createEngineeringStartupRecoveryGateV2({
    rootGate: transactionGate,
    ...(options.now === undefined ? {} : { now: options.now }),
    traceId: options.traceId ?? "desktop-engineering-startup-recovery-gate-v2"
  });
  const initialized = await startupGate.initialize({
    contentRootBindingIds: [options.contentRootBindingId]
  });
  if (!initialized.ok) return err(initialized.error);
  const root = startupGate.rootSnapshot(options.contentRootBindingId);
  if (root === undefined) {
    return err(
      createUnifiedError({
        code: "ENGINEERING_RECOVERY_RUNTIME_ROOT_MISSING",
        category: "StorageError",
        message: "Engineering recovery startup did not produce the requested root snapshot.",
        recoverability: "user-action",
        suggestedAction: "Keep Engineering mutation disabled and rerun Main startup recovery.",
        traceId: options.traceId ?? "desktop-engineering-recovery-runtime-v2"
      })
    );
  }
  return ok(
    Object.freeze({
      status: root.status,
      startupGate,
      transactionGate,
      snapshot: initialized.value,
      capabilityRevision: root.capabilityRevision
    })
  );
}
