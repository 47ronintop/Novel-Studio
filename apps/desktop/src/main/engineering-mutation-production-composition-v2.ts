import type {
  EngineeringPathPolicy,
  MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import type {
  EngineeringApprovalLedgerRecordV2,
  EngineeringApprovalLedgerV2Port,
  EngineeringFileMutationSessionV2
} from "@novel-studio/application";
import {
  EngineeringWriteTransactionV2,
  EngineeringLifecycleWriteTransactionV2,
  EngineeringRecoveryRootRepositoryV2,
  FileEngineeringRecoveryGlobalRecordStoreV2,
  FileEngineeringRecoveryObjectManifestStoreV2,
  FileEngineeringRecoveryPurgeDecisionStoreV2,
  FileEngineeringLifecycleWalRepositoryV2,
  FileEngineeringMutationBlobStoreV2,
  FileEngineeringMutationProposalRepositoryV2,
  FileEngineeringMutationSyncRequiredStoreV2,
  FileEngineeringWalRepositoryV2,
  createEngineeringFileMutationPortV2,
  volumeLocalRecoverySideEffectChecksumV2,
  type AuthorizationReservationWalV2,
  type EngineeringFileMutationRootBindingV2,
  type EngineeringFullAfterManifestVerifierV2,
  type EngineeringLegacyRecoveryScanV2,
  type EngineeringMutationBlobStoreV2,
  type EngineeringMutationProposalRepositoryV2,
  type EngineeringNativeEvidenceAuthenticatorV2,
  type EngineeringNativeProposalEvidenceAuthenticatorV2,
  type EngineeringQualifiedFileMutationPortV2,
  type EngineeringRawByteManifestV2,
  type EngineeringRecoveryReservationScanV2,
  type EngineeringRecoveryStagingScanV2,
  type EngineeringV2StagingReservationValidator,
  type EngineeringWriteTransactionPreparedV2,
  type EngineeringLifecycleWriteTransactionInputV2,
  type EngineeringLifecycleRecoveryRootBindingV2,
  type EngineeringWorkspaceNativeRootIdentity
} from "@novel-studio/repository";
import type { EngineeringWorkspaceAccessSession } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createEngineeringFileAccessAddonLoader,
  createEngineeringStateDurabilityPortV2,
  type EngineeringFileAccessAddonLoader
} from "./engineering-file-access-adapter.js";
import type { EngineeringFileAccessQualificationService } from "./engineering-file-access-qualification.js";
import { createDesktopEngineeringFileMutationSessionV2 } from "./engineering-file-mutation-session-v2.js";
import type { EngineeringEditorStateRegistry } from "./engineering-editor-state-registry.js";
import {
  createEngineeringMutationRuntimeV2,
  type EngineeringMutationEditorStatePortV2,
  type EngineeringMutationRootLeasePortV2,
  type EngineeringMutationSaveCoordinatorPortV2,
  type EngineeringMutationSyncPortV2,
  type EngineeringMutationRuntimeV2
} from "./engineering-mutation-runtime-v2.js";
import type { EngineeringMutationRendererSyncCoordinatorV2 } from "./engineering-mutation-renderer-sync-v2.js";
import {
  createEngineeringMutationRefRegistryV2,
  type EngineeringMutationRefRegistryV2
} from "./engineering-mutation-ref-registry-v2.js";
import {
  createDesktopEngineeringRecoveryRuntimeV2,
  type DesktopEngineeringRecoveryRuntimeV2
} from "./engineering-recovery-runtime.js";
import {
  createDesktopEngineeringRecoveryOperationServiceV2,
  type DesktopEngineeringRecoveryOperationPortV2,
  type DesktopEngineeringRecoveryOperationServiceV2
} from "./engineering-recovery-operation-service-v2.js";
import {
  openDesktopEngineeringAppStateRecoveryAuthorityV2,
  type DesktopEngineeringVolumeLocalRecoveryAuthorityV2
} from "./engineering-volume-local-recovery-authority-v2.js";

/**
 * Main-only save authority from the existing IPC coordinator. Keeping this structural avoids
 * giving the mutation composition a dependency on the IPC handler module itself.
 */
export interface DesktopEngineeringMutationSaveAuthorityV2 {
  pauseAndDrainEngineeringRoot(
    rootBindingId: string
  ): Promise<Readonly<{ readonly release: () => void }>>;
}

/**
 * The recovery scanner's dependencies are deliberately Main-owned. In particular, staging and
 * authorization scans must come from the same durable authorities used by the write path.
 */
export interface DesktopEngineeringMutationRecoveryDependenciesV2 {
  readonly verifyPreparedAuthorization: (
    prepared: EngineeringWriteTransactionPreparedV2,
    expectedState: "reserved" | "consumed"
  ) => Promise<Result<void, UnifiedError>>;
  readonly scanLegacyRecovery: (
    contentRootBindingId: string
  ) => Promise<Result<EngineeringLegacyRecoveryScanV2, UnifiedError>>;
}

/** The shared approval ledger must also expose its reservation WAL inventory for startup scans. */
export interface DesktopEngineeringMutationAuthorizationLedgerV2 extends EngineeringApprovalLedgerV2Port {
  consume(authorizationId: string, transactionId: string): Promise<Result<unknown, UnifiedError>>;
  revoke(
    authorizationId: string,
    reason?: string
  ): Promise<Result<EngineeringApprovalLedgerRecordV2, UnifiedError>>;
  listReservationWals(): Promise<Result<readonly AuthorizationReservationWalV2[], UnifiedError>>;
}

export interface DesktopEngineeringMutationProductionCompositionV2Options {
  readonly projectId: string;
  readonly workspaceBindingId: string;
  /** Main-owned app state root; it is never derived from the content root. */
  readonly stateRoot: string;
  /** The already-qualified B6 session whose native handle is reused by B7. */
  readonly workspaceAccessSession: EngineeringWorkspaceAccessSession;
  /** Main-only identity captured from the exact native content-root handle during B6 open. */
  readonly contentRootNativeIdentity?: EngineeringWorkspaceNativeRootIdentity;
  /** The exact Main-owned policy bound to the B6 session's path-policy revision. */
  readonly pathPolicy: EngineeringPathPolicy;
  /** Main-owned capability revision used to bind opaque source references. */
  readonly refCapabilityRevision: string;
  readonly qualificationService: EngineeringFileAccessQualificationService;
  /** Shared with trusted approval; never create a separate ledger for the transaction path. */
  readonly authorizationLedger: DesktopEngineeringMutationAuthorizationLedgerV2;
  readonly trustedApprovalQualified: () => boolean;
  readonly readApprovalDecisionProof: (
    runId: string,
    proofId: string
  ) => Promise<Result<MainOnlyApprovalDecisionProofV1 | undefined, UnifiedError>>;
  /** Authenticates receipt and operation-state evidence from the qualified native addon. */
  readonly authenticateNativeEvidence: EngineeringNativeEvidenceAuthenticatorV2;
  /** Authenticates proposal-time snapshot and absence-proof evidence from that same addon. */
  readonly authenticateNativeProposalEvidence: EngineeringNativeProposalEvidenceAuthenticatorV2;
  readonly recovery: DesktopEngineeringMutationRecoveryDependenciesV2;
  readonly verifyPreparedLifecycleAuthorization?: (
    prepared: EngineeringLifecycleWriteTransactionInputV2,
    acceptableStates?: readonly ("reserved" | "consumed")[]
  ) => Promise<Result<void, UnifiedError>>;
  /** Main-owned recovery binding resolver. Omission keeps delete/quarantine fail closed. */
  readonly resolveLifecycleRecoveryBinding?: (
    operation: EngineeringLifecycleWriteTransactionInputV2["operations"][number]
  ) => Promise<Result<EngineeringLifecycleRecoveryRootBindingV2, UnifiedError>>;
  /** Proposal-time recovery facts. Omission keeps delete out of the Engineering tool catalog. */
  readonly prepareLifecycleRecoveryBinding?: (input: {
    readonly contentRootBindingId: string;
    readonly plannedTransactionId: string;
    readonly operationId: string;
    readonly recoveryObjectId: string;
    readonly relativeIdentity: string;
    readonly sourceSha256: string;
    readonly sourceRef: string;
  }) => Promise<
    Result<
      {
        readonly recoveryRootBindingId: string;
        readonly recoveryGrantRevision: string;
        readonly recoverySideEffectChecksum: string;
        readonly recoveryObjectId: string;
      },
      UnifiedError
    >
  >;
  /** Full B8 crash recovery/compensation qualification. Omission keeps every lifecycle gate off. */
  readonly lifecycleRecoveryQualified?: () => boolean;
  /** Signed/current native qualification revision used to derive the app-state recovery grant. */
  readonly lifecycleRecoveryQualificationRevision?: string;
  /** Validates the native preallocated staging object for the exact prepared operation. */
  readonly validateStagingReservation: EngineeringV2StagingReservationValidator;
  readonly saveAuthority: DesktopEngineeringMutationSaveAuthorityV2;
  readonly editorStateRegistry: Pick<EngineeringEditorStateRegistry, "observe">;
  /** Main-owned one-shot renderer synchronization request/acknowledgement coordinator. */
  readonly rendererSynchronizer: Pick<EngineeringMutationRendererSyncCoordinatorV2, "request">;
  /** Main can hide mutation affordances while preserving the qualified B6 read session. */
  readonly onMutationUnavailable?: () => void;
  /** Main/test seam. The default is the sole cached ADR-0003 addon loader. */
  readonly addonLoader?: EngineeringFileAccessAddonLoader;
  readonly now?: () => string;
  readonly traceId?: string;
}

/**
 * The complete Main-only B7 bundle. None of these values are safe to project to Renderer or a
 * provider: callers hand only `session`/`runtime` to the existing Main agent runtime seams.
 */
export interface DesktopEngineeringMutationProductionCompositionV2 {
  readonly session: EngineeringFileMutationSessionV2;
  readonly runtime: EngineeringMutationRuntimeV2;
  readonly refRegistry: EngineeringMutationRefRegistryV2;
  readonly refCapabilityRevision: string;
  readonly proposalRepository: FileEngineeringMutationProposalRepositoryV2;
  readonly blobStore: FileEngineeringMutationBlobStoreV2;
  readonly walRepository: FileEngineeringWalRepositoryV2;
  readonly syncRequiredStore: FileEngineeringMutationSyncRequiredStoreV2;
  readonly transaction: EngineeringWriteTransactionV2;
  readonly lifecycleWalRepository: FileEngineeringLifecycleWalRepositoryV2;
  readonly lifecycleTransaction: EngineeringLifecycleWriteTransactionV2;
  readonly recoveryRootRepository?: EngineeringRecoveryRootRepositoryV2;
  /** Main-only local recovery review operations; never projected into Agent tools or IPC. */
  readonly recoveryOperationService?: DesktopEngineeringRecoveryOperationServiceV2;
  readonly lifecycleCapabilities: Readonly<{
    readonly move: boolean;
    readonly delete: boolean;
    readonly createDirectory: boolean;
  }>;
  readonly recoveryRuntime: DesktopEngineeringRecoveryRuntimeV2;
  /** Revokes this composition when its workspace is replaced or Main shuts down. */
  dispose(): void;
}

interface EngineeringBatch7NativeAddon {
  readonly applyEngineeringFileMutationV2: (...args: readonly unknown[]) => unknown;
  readonly inspectEngineeringFileMutationTargetV2: (...args: readonly unknown[]) => unknown;
  readonly inspectEngineeringFileSnapshotV2: (...args: readonly unknown[]) => unknown;
  readonly observeCreateAbsenceV2: (...args: readonly unknown[]) => unknown;
  /** A same-root-handle scan; it also proves that the retained native handle is still current. */
  readonly scanMutationRecovery: (rootId: string | bigint) => unknown;
}

interface NativeRecoveryScan {
  readonly status: "clear" | "pending";
  readonly pendingStagingCount: bigint;
  readonly inProcessPendingWalCount: bigint;
  readonly scanTruncated: boolean;
}

/**
 * Builds the production B7 mutation path from the qualified B6 session and one cached addon.
 *
 * The function is deliberately all-or-nothing. A missing/expired B7 qualification, absent native
 * ABI/state durability/root handle, or blocked startup scan returns `undefined`; it never returns
 * a session that can later select an alternate filesystem or native backend.
 */
export async function createDesktopEngineeringMutationProductionCompositionV2(
  options: DesktopEngineeringMutationProductionCompositionV2Options
): Promise<DesktopEngineeringMutationProductionCompositionV2 | undefined> {
  if (!(await hasCurrentBatch7Qualification(options.qualificationService))) return undefined;

  const rootBinding = readRootBinding(options.workspaceAccessSession);
  if (rootBinding === undefined) return undefined;
  // The Repository native facade deliberately exact-validates this two-field shape. Keep the
  // B6 policy revision in the surrounding Main binding, but do not leak it into the native ABI.
  const mutationRootBinding: EngineeringFileMutationRootBindingV2 = Object.freeze({
    contentRootBindingId: rootBinding.contentRootBindingId,
    rootId: rootBinding.rootId
  });

  const addonLoader = options.addonLoader ?? createEngineeringFileAccessAddonLoader();
  const loaded = addonLoader.load();
  if (
    loaded.status !== "loaded" ||
    (loaded.metadata.batch !== "7" && loaded.metadata.batch !== "8") ||
    loaded.metadata.mutation !== "available" ||
    loaded.metadata.recovery !== "available"
  ) {
    return undefined;
  }
  const addon = asBatch7NativeAddon(loaded.addon);
  if (addon === undefined) return undefined;
  const lifecycleNativeCapabilities = readLifecycleNativeCapabilities(loaded.addon);
  const lifecycleRecoveryQualified = options.lifecycleRecoveryQualified?.() === true;

  // This calls the same cached loader above; there is no separate state host or Node fs fallback.
  const durability = createEngineeringStateDurabilityPortV2({
    stateRoot: options.stateRoot,
    addonLoader
  });
  if (durability === undefined) return undefined;

  let durabilityReleased = false;
  const releaseDurability = (): void => {
    if (durabilityReleased) return;
    durabilityReleased = true;
    try {
      durability.dispose();
    } catch {
      // The adapter marks the native descriptor closed before crossing the addon boundary.
      // Composition cleanup therefore remains idempotent even when native close reports failure.
    }
  };
  let compositionOwnsDurability = false;
  let volumeRecoveryAuthority: DesktopEngineeringVolumeLocalRecoveryAuthorityV2 | undefined;
  const releaseVolumeRecoveryAuthority = (): void => {
    const authority = volumeRecoveryAuthority;
    volumeRecoveryAuthority = undefined;
    try {
      authority?.dispose();
    } catch {
      // The authority closes its retained descriptor before surfacing a native cleanup failure.
    }
  };

  try {
    const traceId = options.traceId ?? "desktop-engineering-mutation-production-composition-v2";
    const refRegistry = createEngineeringMutationRefRegistryV2();
    const activeReservations = new Map<string, string>();
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const deactivate = (): void => {
      if (!active) return;
      active = false;
      activeReservations.clear();
      refRegistry.revokeRootBinding(rootBinding.contentRootBindingId);
    };
    const activateAuthorizationReservation = (input: {
      readonly authorizationId: string;
      readonly transactionId: string;
    }): (() => void) | undefined => {
      if (
        !active ||
        !isStableId(input.authorizationId) ||
        !isStableId(input.transactionId) ||
        activeReservations.has(input.authorizationId)
      ) {
        return undefined;
      }
      activeReservations.set(input.authorizationId, input.transactionId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (activeReservations.get(input.authorizationId) === input.transactionId) {
          activeReservations.delete(input.authorizationId);
        }
      };
    };

    try {
      unsubscribe = options.qualificationService.subscribeRevocation(deactivate);
    } catch {
      return undefined;
    }
    if (!active || !(await hasCurrentBatch7Qualification(options.qualificationService))) {
      unsubscribe();
      return undefined;
    }

    const scanNativeRecovery = async (): Promise<Result<NativeRecoveryScan, UnifiedError>> => {
      const current = readRootBinding(options.workspaceAccessSession);
      if (!sameRootBinding(current, rootBinding)) {
        deactivate();
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_HANDLE_UNAVAILABLE", traceId);
      }
      try {
        const parsed = parseNativeRecoveryScan(
          await Promise.resolve(addon.scanMutationRecovery(rootBinding.rootId))
        );
        if (parsed === undefined) {
          deactivate();
          return unavailable("ENGINEERING_MUTATION_PRODUCTION_RECOVERY_SCAN_INVALID", traceId);
        }
        return ok(parsed);
      } catch {
        deactivate();
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_RECOVERY_SCAN_UNAVAILABLE", traceId);
      }
    };

    const verifyRootAvailable = async (): Promise<Result<void, UnifiedError>> => {
      if (!active || !(await hasCurrentBatch7Qualification(options.qualificationService))) {
        deactivate();
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_QUALIFICATION_UNAVAILABLE", traceId);
      }
      const scanned = await scanNativeRecovery();
      return scanned.ok ? ok(undefined) : scanned;
    };

    const baseMutationPort = createEngineeringFileMutationPortV2({
      addon: loaded.addon,
      rootBinding: mutationRootBinding,
      pathPolicy: options.pathPolicy,
      authenticateNativeEvidence: (input) =>
        active
          ? options.authenticateNativeEvidence(input)
          : unavailable("ENGINEERING_MUTATION_PRODUCTION_QUALIFICATION_UNAVAILABLE", traceId),
      authenticateNativeProposalEvidence: (input) =>
        active
          ? options.authenticateNativeProposalEvidence(input)
          : unavailable("ENGINEERING_MUTATION_PRODUCTION_QUALIFICATION_UNAVAILABLE", traceId),
      traceId
    });
    const mutationPort = revokeOnRootLoss(baseMutationPort, deactivate);

    const proposalRepository = new FileEngineeringMutationProposalRepositoryV2({
      stateRoot: options.stateRoot,
      durability,
      traceId: `${traceId}:proposal`,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const blobStore = new FileEngineeringMutationBlobStoreV2({
      stateRoot: options.stateRoot,
      durability,
      traceId: `${traceId}:blob`
    });
    const walRepository = new FileEngineeringWalRepositoryV2({
      stateRoot: options.stateRoot,
      durability,
      traceId: `${traceId}:wal`
    });
    const lifecycleWalRepository = new FileEngineeringLifecycleWalRepositoryV2({
      stateRoot: options.stateRoot,
      durability,
      traceId: `${traceId}:lifecycle-wal`
    });
    const syncRequiredStore = new FileEngineeringMutationSyncRequiredStoreV2({
      stateRoot: options.stateRoot,
      durability,
      traceId: `${traceId}:sync-required`
    });
    let recoveryRootRepository: EngineeringRecoveryRootRepositoryV2 | undefined;
    let productionPrepareLifecycleRecoveryBinding:
      | NonNullable<
          DesktopEngineeringMutationProductionCompositionV2Options["prepareLifecycleRecoveryBinding"]
        >
      | undefined;
    let productionResolveLifecycleRecoveryBinding:
      | NonNullable<
          DesktopEngineeringMutationProductionCompositionV2Options["resolveLifecycleRecoveryBinding"]
        >
      | undefined;
    if (
      lifecycleRecoveryQualified &&
      lifecycleNativeCapabilities.delete &&
      options.contentRootNativeIdentity !== undefined &&
      typeof rootBinding.rootId === "bigint" &&
      isStableId(options.lifecycleRecoveryQualificationRevision)
    ) {
      const contentRootNativeIdentity = options.contentRootNativeIdentity;
      const openedRecovery = await openDesktopEngineeringAppStateRecoveryAuthorityV2({
        stateRoot: options.stateRoot,
        contentRoot: {
          contentRootBindingId: rootBinding.contentRootBindingId,
          rootId: rootBinding.rootId,
          volumeIdentity: contentRootNativeIdentity.volumeIdentity,
          directoryIdentity: contentRootNativeIdentity.directoryIdentity
        },
        qualificationRevision: options.lifecycleRecoveryQualificationRevision,
        addonLoader,
        authenticateEvidence: (evidence) =>
          active &&
          evidence.contentRootBindingId === rootBinding.contentRootBindingId &&
          evidence.contentVolumeIdentity === contentRootNativeIdentity.volumeIdentity &&
          evidence.recoveryVolumeIdentity === contentRootNativeIdentity.volumeIdentity &&
          evidence.contentDirectoryIdentity === contentRootNativeIdentity.directoryIdentity &&
          evidence.recoveryDirectoryIdentity !== contentRootNativeIdentity.directoryIdentity
            ? ok(undefined)
            : unavailable("ENGINEERING_MUTATION_PRODUCTION_RECOVERY_EVIDENCE_UNAVAILABLE", traceId),
        ...(options.now === undefined ? {} : { now: options.now }),
        traceId: `${traceId}:volume-recovery-authority`
      });
      if (openedRecovery.ok) {
        const authority = openedRecovery.value.authority;
        volumeRecoveryAuthority = authority;
        const globalRecords = new FileEngineeringRecoveryGlobalRecordStoreV2({
          stateRoot: options.stateRoot,
          binding: authority.binding,
          durability,
          traceId: `${traceId}:recovery-global-records`
        });
        const manifests = new FileEngineeringRecoveryObjectManifestStoreV2({
          recoveryRoot: openedRecovery.value.recoveryRoot,
          binding: authority.binding,
          durability: authority.durability,
          traceId: `${traceId}:recovery-manifests`
        });
        const repository = new EngineeringRecoveryRootRepositoryV2({
          binding: authority.binding,
          globalRecords,
          manifests,
          inspectQuarantine: async (binding) => {
            const current = await authority.assertCurrent();
            if (!current.ok) return current;
            if (current.value.bindingChecksum !== binding.bindingChecksum) {
              return unavailable(
                "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_BINDING_MISMATCH",
                traceId
              );
            }
            const resolved = await authority.resolveLifecycleBinding(binding.bindingChecksum);
            const inspectQuarantine = mutationPort.inspectQuarantine;
            return !resolved.ok
              ? resolved
              : inspectQuarantine === undefined
                ? unavailable(
                    "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_INVENTORY_UNAVAILABLE",
                    traceId
                  )
                : inspectQuarantine(resolved.value);
          },
          isGrantCurrent: async (binding) => {
            const current = await authority.assertCurrent();
            return current.ok && current.value.bindingChecksum === binding.bindingChecksum;
          },
          ...(options.now === undefined ? {} : { now: options.now }),
          traceId: `${traceId}:recovery-root`
        });
        recoveryRootRepository = repository;
        productionPrepareLifecycleRecoveryBinding = async (input) => {
          if (input.contentRootBindingId !== rootBinding.contentRootBindingId) {
            return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", traceId);
          }
          const current = await authority.assertCurrent();
          if (!current.ok) return current;
          const scan = await repository.scanRoot();
          if (!scan.ok) return scan;
          if (scan.value.status !== "clear" || scan.value.reasons.length > 0) {
            return unavailable("ENGINEERING_MUTATION_PRODUCTION_RECOVERY_ROOT_BLOCKED", traceId);
          }
          let recoverySideEffectChecksum: string;
          try {
            recoverySideEffectChecksum = volumeLocalRecoverySideEffectChecksumV2({
              binding: current.value,
              transactionId: input.plannedTransactionId,
              operationId: input.operationId,
              recoveryObjectId: input.recoveryObjectId,
              relativeIdentity: input.relativeIdentity,
              sourceSha256: input.sourceSha256
            });
          } catch {
            return unavailable(
              "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_SIDE_EFFECT_INVALID",
              traceId
            );
          }
          const resolved = await authority.resolveLifecycleBinding(recoverySideEffectChecksum);
          if (!resolved.ok) return resolved;
          return ok(
            Object.freeze({
              recoveryRootBindingId: current.value.recoveryRootBindingId,
              recoveryGrantRevision: current.value.grantRevision,
              recoverySideEffectChecksum,
              recoveryObjectId: input.recoveryObjectId
            })
          );
        };
        productionResolveLifecycleRecoveryBinding = async (operation) => {
          if (
            operation.request.operationKind !== "delete_file" ||
            operation.recoveryBinding === null
          ) {
            return unavailable(
              "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_BINDING_UNAVAILABLE",
              traceId
            );
          }
          const current = await authority.assertCurrent();
          if (!current.ok) return current;
          let expectedSideEffectChecksum: string;
          try {
            expectedSideEffectChecksum = volumeLocalRecoverySideEffectChecksumV2({
              binding: current.value,
              transactionId: operation.request.transactionId,
              operationId: operation.request.operationId,
              recoveryObjectId: operation.request.recoveryObjectId,
              relativeIdentity: operation.request.relativeSource,
              sourceSha256: operation.request.sourceSha256
            });
          } catch {
            return unavailable(
              "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_SIDE_EFFECT_INVALID",
              traceId
            );
          }
          if (
            operation.request.recoveryRootBindingId !== current.value.recoveryRootBindingId ||
            operation.request.recoveryGrantRevision !== current.value.grantRevision ||
            operation.request.recoverySideEffectChecksum !== expectedSideEffectChecksum ||
            operation.recoveryBinding.recoveryRootBindingId !==
              current.value.recoveryRootBindingId ||
            operation.recoveryBinding.grantRevision !== current.value.grantRevision ||
            operation.recoveryBinding.sideEffectChecksum !== expectedSideEffectChecksum
          ) {
            return unavailable(
              "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_BINDING_MISMATCH",
              traceId
            );
          }
          return authority.resolveLifecycleBinding(expectedSideEffectChecksum);
        };
      }
    }
    const prepareLifecycleRecoveryBinding =
      productionPrepareLifecycleRecoveryBinding ?? options.prepareLifecycleRecoveryBinding;
    const resolveLifecycleRecoveryBinding =
      productionResolveLifecycleRecoveryBinding ?? options.resolveLifecycleRecoveryBinding;
    // Proposal blobs are intentionally durable before a transaction WAL exists. Recovery must
    // retain only the strictly scanned proposal references while it checks for genuine orphans.
    const recoveryBlobStore = createRecoveryBlobStore({
      blobStore,
      proposalRepository,
      traceId
    });
    const volumeLocalRecoveryRepository = recoveryRootRepository;
    const scanVolumeLocalRecovery =
      volumeLocalRecoveryRepository === undefined
        ? undefined
        : async (contentRootBindingId: string) =>
            contentRootBindingId === rootBinding.contentRootBindingId
              ? volumeLocalRecoveryRepository.scanRoot()
              : unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", traceId);

    const recoveryRuntime = await createDesktopEngineeringRecoveryRuntimeV2({
      contentRootBindingId: rootBinding.contentRootBindingId,
      walRepository,
      blobStore: recoveryBlobStore,
      verifyContentRootAvailable: verifyRootAvailable,
      verifyPreparedAuthorization: async (prepared, expectedState) => {
        const root = await verifyRootAvailable();
        if (!root.ok) return root;
        return safelyCall(
          () => options.recovery.verifyPreparedAuthorization(prepared, expectedState),
          "ENGINEERING_MUTATION_PRODUCTION_AUTHORIZATION_UNAVAILABLE",
          traceId
        );
      },
      scanLegacyRecovery: async (contentRootBindingId) => {
        if (contentRootBindingId !== rootBinding.contentRootBindingId) {
          return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", traceId);
        }
        const legacy = await safelyCall(
          () => options.recovery.scanLegacyRecovery(contentRootBindingId),
          "ENGINEERING_MUTATION_PRODUCTION_LEGACY_RECOVERY_UNAVAILABLE",
          traceId
        );
        if (!legacy.ok || !isLegacyRecoveryScan(legacy.value)) {
          return legacy.ok
            ? unavailable("ENGINEERING_MUTATION_PRODUCTION_LEGACY_RECOVERY_INVALID", traceId)
            : legacy;
        }
        return legacy;
      },
      scanStaging: createNativeStagingScanner({
        contentRootBindingId: rootBinding.contentRootBindingId,
        scanNativeRecovery,
        traceId
      }),
      scanReservations: createLedgerReservationScanner({
        contentRootBindingId: rootBinding.contentRootBindingId,
        ledger: options.authorizationLedger,
        isActiveReservation: (authorizationId, transactionId) =>
          activeReservations.get(authorizationId) === transactionId,
        traceId
      }),
      ...(scanVolumeLocalRecovery === undefined ? {} : { scanVolumeLocalRecovery }),
      scanLifecycleRecovery: async (contentRootBindingId) => {
        if (contentRootBindingId !== rootBinding.contentRootBindingId)
          return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", traceId);
        const scan = await lifecycleWalRepository.scanRoot(contentRootBindingId);
        if (!scan.ok) return scan;
        const incomplete = scan.value.journals.some((journal) => journal.synchronizedAt === null);
        return ok({
          status:
            incomplete ||
            scan.value.unknownRecordCount > 0 ||
            scan.value.authenticationFailureCount > 0
              ? ("blocked" as const)
              : ("clear" as const),
          unknownRecordCount: scan.value.unknownRecordCount,
          authenticationFailureCount: scan.value.authenticationFailureCount
        });
      },
      verifyLifecycleLease: async (input) => {
        if (input.contentRootBindingId !== rootBinding.contentRootBindingId) return ok(false);
        const journal = await lifecycleWalRepository.read({
          contentRootBindingId: input.contentRootBindingId,
          transactionId: input.transactionId
        });
        if (!journal.ok) return journal;
        return ok(
          journal.value !== undefined &&
            journal.value.committedAt === null &&
            journal.value.rolledBackAt === null &&
            journal.value.preparedChecksum === input.preparedChecksum
        );
      },
      traceId: `${traceId}:recovery`,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    if (!recoveryRuntime.ok) {
      unsubscribe();
      deactivate();
      return undefined;
    }
    let recoveryRuntimeValue = recoveryRuntime.value;
    const syncRequiredClear = await safelyCall(
      () => syncRequiredStore.assertNoSyncRequired(rootBinding.contentRootBindingId),
      "ENGINEERING_MUTATION_PRODUCTION_SYNC_REQUIRED_CHECK_UNAVAILABLE",
      traceId
    );
    if (!syncRequiredClear.ok) {
      unsubscribe();
      deactivate();
      return undefined;
    }

    const rootLease = createRootHandleLeasePort({
      contentRootBindingId: rootBinding.contentRootBindingId,
      verifyRootAvailable
    });
    const saveCoordinator = createSaveCoordinator({
      contentRootBindingId: rootBinding.contentRootBindingId,
      authority: options.saveAuthority,
      traceId
    });
    const editorState = createEditorStatePort({
      contentRootBindingId: rootBinding.contentRootBindingId,
      registry: options.editorStateRegistry,
      traceId
    });
    const synchronizer = createRendererSynchronizerPort({
      contentRootBindingId: rootBinding.contentRootBindingId,
      coordinator: options.rendererSynchronizer,
      workspaceAccessSession: options.workspaceAccessSession,
      traceId
    });
    const fullAfterManifestVerifier = createFullAfterManifestVerifier({
      mutationPort,
      blobStore,
      traceId
    });
    const transaction = new EngineeringWriteTransactionV2({
      walRepository,
      blobStore,
      mutationPort,
      recoveryGate: recoveryRuntimeValue.transactionGate,
      validateReservedAuthorization: async (prepared) => {
        const root = await verifyRootAvailable();
        if (!root.ok) return root;
        return safelyCall(
          () => options.recovery.verifyPreparedAuthorization(prepared, "reserved"),
          "ENGINEERING_MUTATION_PRODUCTION_AUTHORIZATION_UNAVAILABLE",
          traceId
        );
      },
      validateStagingReservation: async (input) => {
        const root = await verifyRootAvailable();
        if (!root.ok) return root;
        return safelyCall(
          () => options.validateStagingReservation(input),
          "ENGINEERING_MUTATION_PRODUCTION_STAGING_RESERVATION_UNAVAILABLE",
          traceId
        );
      },
      verifyFullAfterManifest: fullAfterManifestVerifier,
      traceId: `${traceId}:transaction`,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const lifecycleTransaction = new EngineeringLifecycleWriteTransactionV2({
      walRepository: lifecycleWalRepository,
      mutationPort,
      recoveryGate: recoveryRuntimeValue.transactionGate,
      validateReservedAuthorization: async (prepared) => {
        const root = await verifyRootAvailable();
        if (!root.ok) return root;
        if (options.verifyPreparedLifecycleAuthorization === undefined)
          return unavailable(
            "ENGINEERING_MUTATION_PRODUCTION_LIFECYCLE_AUTHORIZATION_UNAVAILABLE",
            traceId
          );
        const verifyPreparedLifecycleAuthorization = options.verifyPreparedLifecycleAuthorization;
        return safelyCall(
          () => verifyPreparedLifecycleAuthorization(prepared),
          "ENGINEERING_MUTATION_PRODUCTION_AUTHORIZATION_UNAVAILABLE",
          traceId
        );
      },
      validateTerminalAuthorization: async (prepared) => {
        const root = await verifyRootAvailable();
        if (!root.ok) return root;
        if (options.verifyPreparedLifecycleAuthorization === undefined)
          return unavailable(
            "ENGINEERING_MUTATION_PRODUCTION_LIFECYCLE_AUTHORIZATION_UNAVAILABLE",
            traceId
          );
        const verifyPreparedLifecycleAuthorization = options.verifyPreparedLifecycleAuthorization;
        return safelyCall(
          () => verifyPreparedLifecycleAuthorization(prepared, ["reserved", "consumed"]),
          "ENGINEERING_MUTATION_PRODUCTION_AUTHORIZATION_UNAVAILABLE",
          traceId
        );
      },
      ...(resolveLifecycleRecoveryBinding === undefined
        ? {}
        : { resolveRecoveryBinding: resolveLifecycleRecoveryBinding }),
      ...(volumeLocalRecoveryRepository === undefined
        ? {}
        : {
            recordQuarantine: (input) => volumeLocalRecoveryRepository.recordQuarantine(input),
            recordQuarantineCompensation: ({ operation, receipt }) => {
              if (
                operation.request.operationKind !== "delete_file" ||
                receipt.operationKind !== "delete_file" ||
                receipt.recoveryObjectId !== operation.request.recoveryObjectId ||
                receipt.transactionId !== operation.request.transactionId ||
                receipt.operationId !== operation.request.operationId
              ) {
                return Promise.resolve(
                  unavailable(
                    "ENGINEERING_MUTATION_PRODUCTION_RECOVERY_COMPENSATION_MISMATCH",
                    traceId
                  )
                );
              }
              return volumeLocalRecoveryRepository.markCompensated({
                recoveryObjectId: operation.request.recoveryObjectId,
                transactionId: operation.request.transactionId,
                operationId: operation.request.operationId,
                sourceSha256: operation.request.sourceSha256,
                at: (options.now ?? (() => new Date().toISOString()))()
              });
            }
          }),
      traceId: `${traceId}:lifecycle-transaction`,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    if (lifecycleRecoveryQualified) {
      const recovered = await recoverLifecycleJournalsAtStartup({
        contentRootBindingId: rootBinding.contentRootBindingId,
        walRepository: lifecycleWalRepository,
        transaction: lifecycleTransaction,
        rootLease,
        saveCoordinator,
        editorState,
        synchronizer,
        syncRequiredStore,
        now: options.now ?? (() => new Date().toISOString()),
        traceId
      });
      if (!recovered.ok) {
        unsubscribe();
        deactivate();
        return undefined;
      }
      if (recovered.value) {
        const refreshed = await recoveryRuntimeValue.startupGate.initialize({
          contentRootBindingIds: [rootBinding.contentRootBindingId]
        });
        const refreshedRoot = recoveryRuntimeValue.startupGate.rootSnapshot(
          rootBinding.contentRootBindingId
        );
        if (!refreshed.ok || refreshedRoot === undefined) {
          unsubscribe();
          deactivate();
          return undefined;
        }
        recoveryRuntimeValue = Object.freeze({
          status: refreshedRoot.status,
          startupGate: recoveryRuntimeValue.startupGate,
          transactionGate: recoveryRuntimeValue.transactionGate,
          snapshot: refreshed.value,
          capabilityRevision: refreshedRoot.capabilityRevision
        });
      }
    }
    if (recoveryRuntimeValue.status !== "clear") {
      unsubscribe();
      deactivate();
      return undefined;
    }
    const startupClear = await recoveryRuntimeValue.startupGate.assertMutationAllowed(
      rootBinding.contentRootBindingId
    );
    if (!startupClear.ok) {
      unsubscribe();
      deactivate();
      return undefined;
    }
    let recoveryOperationService: DesktopEngineeringRecoveryOperationServiceV2 | undefined;
    const recoveryAuthority = volumeRecoveryAuthority;
    if (volumeLocalRecoveryRepository !== undefined && recoveryAuthority !== undefined) {
      const recoveryBinding = await recoveryAuthority.resolveLifecycleBinding(
        recoveryAuthority.binding.bindingChecksum
      );
      if (recoveryBinding.ok) {
        const purgeDecisionStore = new FileEngineeringRecoveryPurgeDecisionStoreV2({
          stateRoot: options.stateRoot,
          durability,
          traceId: `${traceId}:purge-decisions`
        });
        recoveryOperationService = createDesktopEngineeringRecoveryOperationServiceV2({
          repository: volumeLocalRecoveryRepository,
          contentRootBinding: mutationRootBinding,
          recoveryBinding: recoveryBinding.value,
          createPort: (authenticateRecoveryOperation) => {
            const port = revokeOnRootLoss(
              createEngineeringFileMutationPortV2({
                addon: loaded.addon,
                rootBinding: mutationRootBinding,
                pathPolicy: options.pathPolicy,
                authenticateNativeEvidence: (input) =>
                  active
                    ? options.authenticateNativeEvidence(input)
                    : unavailable(
                        "ENGINEERING_MUTATION_PRODUCTION_QUALIFICATION_UNAVAILABLE",
                        traceId
                      ),
                authenticateNativeProposalEvidence: (input) =>
                  active
                    ? options.authenticateNativeProposalEvidence(input)
                    : unavailable(
                        "ENGINEERING_MUTATION_PRODUCTION_QUALIFICATION_UNAVAILABLE",
                        traceId
                      ),
                authenticateRecoveryOperation,
                traceId: `${traceId}:recovery-operations`
              }),
              deactivate
            );
            return createRecoveryOperationPort(port, traceId);
          },
          inspectRestoreTarget: async (relativeIdentity) => {
            const root = await verifyRootAvailable();
            if (!root.ok) return root;
            const authority = await recoveryAuthority.assertCurrent();
            if (!authority.ok) return authority;
            const snapshot = await mutationPort.inspectProposalSnapshot({ relativeIdentity });
            return snapshot.ok
              ? ok(
                  Object.freeze({
                    targetState: snapshot.value.state,
                    pathAllowed: true,
                    policyCurrent: true
                  })
                )
              : snapshot;
          },
          acquireRestoreGuard: async (relativeIdentity) => {
            const gate = await recoveryRuntimeValue.startupGate.assertMutationAllowed(
              rootBinding.contentRootBindingId
            );
            if (!gate.ok) return gate;
            const lease = await rootLease.acquire(rootBinding.contentRootBindingId);
            if (!lease.ok) return lease;
            const pause = await saveCoordinator.pauseAndDrainRoot({
              contentRootBindingId: rootBinding.contentRootBindingId,
              relativeIdentities: [relativeIdentity]
            });
            if (!pause.ok) {
              await releaseRestoreResources(undefined, lease.value);
              return pause;
            }
            const inspectEditor = async (): Promise<Result<void, UnifiedError>> => {
              const editor = await editorState.inspectAll({
                contentRootBindingId: rootBinding.contentRootBindingId,
                relativeIdentities: [relativeIdentity]
              });
              return editor.ok && editor.value.status === "ready"
                ? ok(undefined)
                : editor.ok
                  ? unavailable("ENGINEERING_MUTATION_PRODUCTION_RESTORE_EDITOR_NOT_READY", traceId)
                  : editor;
            };
            const assertCurrent = async (): Promise<Result<void, UnifiedError>> => {
              const currentGate = await recoveryRuntimeValue.startupGate.assertMutationAllowed(
                rootBinding.contentRootBindingId
              );
              if (!currentGate.ok) return currentGate;
              const currentLease = await lease.value.assertCurrent();
              if (!currentLease.ok) return currentLease;
              const currentAuthority = await recoveryAuthority.assertCurrent();
              if (!currentAuthority.ok) return currentAuthority;
              return inspectEditor();
            };
            const ready = await assertCurrent();
            if (!ready.ok) {
              await releaseRestoreResources(pause.value, lease.value);
              return ready;
            }
            let released = false;
            return ok(
              Object.freeze({
                assertCurrent,
                async release() {
                  if (released) return;
                  released = true;
                  await releaseRestoreResources(pause.value, lease.value);
                }
              })
            );
          },
          synchronizeRestore: async (input) => {
            const synchronized = await synchronizer.synchronize({
              contentRootBindingId: input.contentRootBindingId,
              operationKind: "create_file",
              relativeIdentities: [input.relativeIdentity],
              transactionId: input.transactionId
            });
            if (synchronized.ok) return synchronized;
            const recorded = await syncRequiredStore.writeSyncRequired({
              schemaVersion: "2.0",
              kind: "sync_required",
              contentRootBindingId: input.contentRootBindingId,
              transactionId: input.transactionId,
              operationKind: "create_file",
              relativeIdentities: [input.relativeIdentity],
              recordedAt: (options.now ?? (() => new Date().toISOString()))()
            });
            deactivate();
            try {
              options.onMutationUnavailable?.();
            } catch {
              // Durable sync-required state remains the authority when the notification fails.
            }
            return recorded.ok ? synchronized : recorded;
          },
          persistPurgeDecision: async (input) => {
            const eligible = await volumeLocalRecoveryRepository.validatePurgeDecision({
              recoveryObjectId: input.recoveryObjectId,
              actor: input.actor,
              reason: input.reason,
              at: input.decidedAt
            });
            if (!eligible.ok) return eligible;
            const stored = await purgeDecisionStore.persist(input);
            return stored.ok
              ? ok(Object.freeze({ decisionChecksum: stored.value.decisionChecksum }))
              : stored;
          },
          ...(options.now === undefined ? {} : { now: options.now }),
          traceId: `${traceId}:recovery-operation-service`
        });
      }
    }
    const sessionBundle = createDesktopEngineeringFileMutationSessionV2({
      projectId: options.projectId,
      workspaceBindingId: options.workspaceBindingId,
      contentRootBindingId: rootBinding.contentRootBindingId,
      pathPolicyRevision: rootBinding.pathPolicyRevision,
      refCapabilityRevision: options.refCapabilityRevision,
      proposalPort: mutationPort,
      blobStore,
      proposalRepository,
      authorizationLedger: options.authorizationLedger,
      trustedApprovalQualified: () => active && options.trustedApprovalQualified(),
      readApprovalDecisionProof: options.readApprovalDecisionProof,
      refRegistry,
      activateAuthorizationReservation,
      reconcileFailedAuthorizationReservation: async (input) => {
        if (input.contentRootBindingId !== rootBinding.contentRootBindingId) {
          return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", traceId);
        }
        const journal = await safelyCall(
          () =>
            walRepository.read({
              contentRootBindingId: input.contentRootBindingId,
              transactionId: input.transactionId
            }),
          "ENGINEERING_MUTATION_PRODUCTION_WAL_RECONCILIATION_UNAVAILABLE",
          traceId
        );
        if (!journal.ok) return journal;
        if (journal.value !== undefined) {
          return journal.value.prepared.authorization.authorizationId === input.authorizationId
            ? ok("prepared" as const)
            : unavailable("ENGINEERING_MUTATION_PRODUCTION_WAL_AUTHORIZATION_MISMATCH", traceId);
        }
        const lifecycleJournal = await safelyCall(
          () =>
            lifecycleWalRepository.read({
              contentRootBindingId: input.contentRootBindingId,
              transactionId: input.transactionId
            }),
          "ENGINEERING_MUTATION_PRODUCTION_LIFECYCLE_WAL_RECONCILIATION_UNAVAILABLE",
          traceId
        );
        if (!lifecycleJournal.ok) return lifecycleJournal;
        if (lifecycleJournal.value !== undefined) {
          return lifecycleJournal.value.prepared.authorization.authorizationId ===
            input.authorizationId
            ? ok("prepared" as const)
            : unavailable(
                "ENGINEERING_MUTATION_PRODUCTION_LIFECYCLE_WAL_AUTHORIZATION_MISMATCH",
                traceId
              );
        }

        const reserved = await safelyCall(
          () => options.authorizationLedger.query(input.authorizationId, input.transactionId),
          "ENGINEERING_MUTATION_PRODUCTION_AUTHORIZATION_UNAVAILABLE",
          traceId
        );
        if (
          !reserved.ok ||
          reserved.value.state !== "reserved" ||
          reserved.value.reservedTransactionId !== input.transactionId
        ) {
          return reserved.ok
            ? unavailable("ENGINEERING_MUTATION_PRODUCTION_RESERVATION_MISMATCH", traceId)
            : reserved;
        }
        const revoked = await safelyCall(
          () =>
            options.authorizationLedger.revoke(
              input.authorizationId,
              "engineering_v2_prepare_not_durable"
            ),
          "ENGINEERING_MUTATION_PRODUCTION_RESERVATION_REVOKE_UNAVAILABLE",
          traceId
        );
        return revoked.ok && revoked.value.state === "revoked"
          ? ok("revoked" as const)
          : revoked.ok
            ? unavailable("ENGINEERING_MUTATION_PRODUCTION_RESERVATION_REVOKE_INVALID", traceId)
            : revoked;
      },
      createRuntime: (proposalApproval) =>
        createEngineeringMutationRuntimeV2({
          recoveryGate: recoveryRuntimeValue.startupGate,
          rootLease,
          saveCoordinator,
          editorState,
          proposalApproval,
          transaction,
          lifecycleTransaction,
          markLifecycleSynchronized: async (input) => {
            const marked = await lifecycleWalRepository.markSynchronized(input);
            return marked.ok ? ok(undefined) : marked;
          },
          synchronizer,
          syncRequired: syncRequiredStore,
          ...(options.onMutationUnavailable === undefined
            ? {}
            : { onMutationUnavailable: options.onMutationUnavailable }),
          traceId: `${traceId}:runtime`,
          ...(options.now === undefined ? {} : { now: options.now })
        }),
      ...(prepareLifecycleRecoveryBinding === undefined
        ? {}
        : { resolveLifecycleRecoveryBinding: prepareLifecycleRecoveryBinding }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    const composition = Object.freeze({
      session: sessionBundle.session,
      runtime: sessionBundle.runtime,
      refRegistry: sessionBundle.refRegistry,
      refCapabilityRevision: options.refCapabilityRevision,
      proposalRepository,
      blobStore,
      walRepository,
      lifecycleWalRepository,
      syncRequiredStore,
      transaction,
      lifecycleTransaction,
      ...(volumeLocalRecoveryRepository === undefined
        ? {}
        : { recoveryRootRepository: volumeLocalRecoveryRepository }),
      ...(recoveryOperationService === undefined ? {} : { recoveryOperationService }),
      lifecycleCapabilities: Object.freeze({
        move:
          lifecycleRecoveryQualified &&
          lifecycleNativeCapabilities.move &&
          options.verifyPreparedLifecycleAuthorization !== undefined,
        delete:
          lifecycleRecoveryQualified &&
          lifecycleNativeCapabilities.delete &&
          options.verifyPreparedLifecycleAuthorization !== undefined &&
          prepareLifecycleRecoveryBinding !== undefined &&
          resolveLifecycleRecoveryBinding !== undefined &&
          volumeLocalRecoveryRepository !== undefined &&
          recoveryOperationService !== undefined,
        createDirectory:
          lifecycleRecoveryQualified &&
          lifecycleNativeCapabilities.createDirectory &&
          options.verifyPreparedLifecycleAuthorization !== undefined
      }),
      recoveryRuntime: recoveryRuntimeValue,
      dispose() {
        try {
          unsubscribe?.();
        } catch {
          // Shutdown still has to release both native roots when a revocation listener misbehaves.
        }
        unsubscribe = undefined;
        deactivate();
        releaseVolumeRecoveryAuthority();
        releaseDurability();
      }
    });
    compositionOwnsDurability = true;
    return composition;
  } finally {
    if (!compositionOwnsDurability) {
      releaseVolumeRecoveryAuthority();
      releaseDurability();
    }
  }
}

async function hasCurrentBatch7Qualification(
  qualificationService: EngineeringFileAccessQualificationService
): Promise<boolean> {
  try {
    const [mutation, recovery] = await Promise.all([
      qualificationService.hasCapability("mutation"),
      qualificationService.hasCapability("recovery")
    ]);
    return mutation && recovery;
  } catch {
    return false;
  }
}

function createRecoveryOperationPort(
  port: EngineeringQualifiedFileMutationPortV2,
  traceId: string
): DesktopEngineeringRecoveryOperationPortV2 {
  return Object.freeze({
    async inspectQuarantine(
      input: Parameters<DesktopEngineeringRecoveryOperationPortV2["inspectQuarantine"]>[0]
    ) {
      const operation = port.inspectQuarantine;
      return operation === undefined
        ? unavailable("ENGINEERING_MUTATION_PRODUCTION_RECOVERY_INVENTORY_UNAVAILABLE", traceId)
        : operation(input);
    },
    async restore(input: Parameters<DesktopEngineeringRecoveryOperationPortV2["restore"]>[0]) {
      const operation = port.restore;
      return operation === undefined
        ? unavailable("ENGINEERING_MUTATION_PRODUCTION_RESTORE_UNAVAILABLE", traceId)
        : operation(input);
    },
    async purge(input: Parameters<DesktopEngineeringRecoveryOperationPortV2["purge"]>[0]) {
      const operation = port.purge;
      return operation === undefined
        ? unavailable("ENGINEERING_MUTATION_PRODUCTION_PURGE_UNAVAILABLE", traceId)
        : operation(input);
    }
  });
}

async function releaseRestoreResources(
  pause: { release(): Promise<void> | void } | undefined,
  lease: { release(): Promise<void> | void }
): Promise<void> {
  try {
    await pause?.release();
  } catch {
    // Both Main adapters mark their resource released before surfacing cleanup failures.
  }
  try {
    await lease.release();
  } catch {
    // A failed close cannot expand the retained root authority.
  }
}

function readRootBinding(
  session: EngineeringWorkspaceAccessSession
):
  | (EngineeringFileMutationRootBindingV2 & Readonly<{ readonly pathPolicyRevision: string }>)
  | undefined {
  try {
    const binding = session.getMainOnlyRootHandleBindingV2?.();
    if (
      binding === undefined ||
      binding.contentRootBindingId !== session.binding.rootBindingId ||
      binding.pathPolicyRevision !== session.binding.pathPolicyRevision ||
      (typeof binding.rootId !== "string" && typeof binding.rootId !== "bigint")
    ) {
      return undefined;
    }
    return Object.freeze({
      contentRootBindingId: binding.contentRootBindingId,
      rootId: binding.rootId,
      pathPolicyRevision: binding.pathPolicyRevision
    });
  } catch {
    return undefined;
  }
}

function sameRootBinding(
  value:
    | (EngineeringFileMutationRootBindingV2 & Readonly<{ readonly pathPolicyRevision: string }>)
    | undefined,
  expected: EngineeringFileMutationRootBindingV2 & Readonly<{ readonly pathPolicyRevision: string }>
): boolean {
  return (
    value !== undefined &&
    value.contentRootBindingId === expected.contentRootBindingId &&
    value.rootId === expected.rootId &&
    value.pathPolicyRevision === expected.pathPolicyRevision
  );
}

function asBatch7NativeAddon(value: unknown): EngineeringBatch7NativeAddon | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const required = [
    "applyEngineeringFileMutationV2",
    "inspectEngineeringFileMutationTargetV2",
    "inspectEngineeringFileSnapshotV2",
    "observeCreateAbsenceV2",
    "scanMutationRecovery"
  ] as const;
  return required.every((name) => typeof record[name] === "function")
    ? (value as EngineeringBatch7NativeAddon)
    : undefined;
}

function readLifecycleNativeCapabilities(value: unknown): Readonly<{
  readonly move: boolean;
  readonly delete: boolean;
  readonly createDirectory: boolean;
}> {
  if (value === null || typeof value !== "object") {
    return Object.freeze({ move: false, delete: false, createDirectory: false });
  }
  const record = value as Record<string, unknown>;
  const lifecycleRecovery =
    typeof record["inspectEngineeringFileLifecycleOperationV2"] === "function" &&
    typeof record["resumeEngineeringFileLifecycleOperationV2"] === "function" &&
    typeof record["compensateEngineeringFileLifecycleOperationV2"] === "function" &&
    typeof record["finalizeEngineeringFileLifecycleOperationV2"] === "function";
  return Object.freeze({
    move: lifecycleRecovery && typeof record["moveEngineeringPathV2"] === "function",
    delete:
      lifecycleRecovery &&
      typeof record["quarantineEngineeringFileV2"] === "function" &&
      typeof record["restoreEngineeringFileV2"] === "function" &&
      typeof record["purgeEngineeringQuarantineObjectV2"] === "function" &&
      typeof record["openEngineeringRecoveryRootV2"] === "function" &&
      typeof record["closeEngineeringRecoveryRootV2"] === "function" &&
      typeof record["inspectEngineeringRecoveryRootCapacityV2"] === "function" &&
      typeof record["openEngineeringStateRootBoundToRecoveryV2"] === "function" &&
      typeof record["inspectEngineeringQuarantineV2"] === "function",
    createDirectory:
      lifecycleRecovery && typeof record["createEngineeringDirectoryV2"] === "function"
  });
}

function parseNativeRecoveryScan(value: unknown): NativeRecoveryScan | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const expected = [
    "durableWalRequirement",
    "inProcessPendingWalCount",
    "pendingStagingCount",
    "scanScope",
    "scanTruncated",
    "state"
  ];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    (record["state"] !== "clear" && record["state"] !== "recovery_required") ||
    typeof record["pendingStagingCount"] !== "bigint" ||
    typeof record["inProcessPendingWalCount"] !== "bigint" ||
    record["pendingStagingCount"] < 0n ||
    record["inProcessPendingWalCount"] < 0n ||
    typeof record["scanTruncated"] !== "boolean" ||
    record["scanScope"] !== "native_staging_and_in_process_wal_only" ||
    record["durableWalRequirement"] !== "external_durable_wal_scan_required"
  ) {
    return undefined;
  }
  if (record["state"] === "clear") {
    return record["pendingStagingCount"] === 0n &&
      record["inProcessPendingWalCount"] === 0n &&
      record["scanTruncated"] === false
      ? Object.freeze({
          status: "clear" as const,
          pendingStagingCount: record["pendingStagingCount"],
          inProcessPendingWalCount: record["inProcessPendingWalCount"],
          scanTruncated: record["scanTruncated"]
        })
      : undefined;
  }
  return Object.freeze({
    status: "pending" as const,
    pendingStagingCount: record["pendingStagingCount"],
    inProcessPendingWalCount: record["inProcessPendingWalCount"],
    scanTruncated: record["scanTruncated"]
  });
}

/**
 * Proposal preparation persists immutable blobs before it is eligible to create a transaction
 * WAL. Give recovery a narrowly scoped view that treats only strictly scanned, root-bound
 * proposal blobs as referenced; the write path continues to use the unwrapped store.
 */
function createRecoveryBlobStore(input: {
  readonly blobStore: EngineeringMutationBlobStoreV2;
  readonly proposalRepository: EngineeringMutationProposalRepositoryV2;
  readonly traceId: string;
}): EngineeringMutationBlobStoreV2 {
  return Object.freeze({
    put(request: unknown) {
      return input.blobStore.put(request);
    },
    get(request: unknown) {
      return input.blobStore.get(request);
    },
    listRoot(contentRootBindingId: string) {
      return input.blobStore.listRoot(contentRootBindingId);
    },
    async scanRoot(request: unknown) {
      const parsed = parseRecoveryBlobScanInput(request);
      // Leave invalid input to the authoritative blob store so its public contract and error
      // codes remain exact; recovery only ever supplies the valid shape below.
      if (parsed === undefined) return input.blobStore.scanRoot(request);

      const proposalScan = await safelyCall(
        () => input.proposalRepository.scan(),
        "ENGINEERING_MUTATION_PRODUCTION_PROPOSAL_SCAN_UNAVAILABLE",
        input.traceId
      );
      if (!proposalScan.ok) return err(proposalScan.error);
      if (
        proposalScan.value.unknownObjectCount > 0 ||
        proposalScan.value.authenticationFailureCount > 0
      ) {
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_PROPOSAL_SCAN_BLOCKED", input.traceId);
      }

      const proposalBlobIds = collectRootBoundProposalBlobIds(
        proposalScan.value,
        parsed.contentRootBindingId
      );
      if (proposalBlobIds === undefined) {
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_PROPOSAL_SCAN_INVALID", input.traceId);
      }
      return input.blobStore.scanRoot({
        contentRootBindingId: parsed.contentRootBindingId,
        referencedBlobIds: Object.freeze(
          [...new Set([...parsed.referencedBlobIds, ...proposalBlobIds])].sort()
        )
      });
    }
  });
}

function parseRecoveryBlobScanInput(value: unknown):
  | Readonly<{
      readonly contentRootBindingId: string;
      readonly referencedBlobIds: readonly string[];
    }>
  | undefined {
  if (!hasExactKeys(value, ["contentRootBindingId", "referencedBlobIds"])) return undefined;
  const contentRootBindingId = value["contentRootBindingId"];
  const rawReferencedBlobIds = value["referencedBlobIds"];
  if (
    !isStableId(contentRootBindingId) ||
    !Array.isArray(rawReferencedBlobIds) ||
    rawReferencedBlobIds.some((blobId) => !isStableId(blobId))
  ) {
    return undefined;
  }
  const referencedBlobIds = rawReferencedBlobIds as string[];
  if (new Set(referencedBlobIds).size !== referencedBlobIds.length) return undefined;
  return Object.freeze({
    contentRootBindingId,
    referencedBlobIds: Object.freeze([...referencedBlobIds].sort())
  });
}

function collectRootBoundProposalBlobIds(
  scan: unknown,
  contentRootBindingId: string
): readonly string[] | undefined {
  if (
    !hasExactKeys(scan, [
      "authenticationFailureCount",
      "proposals",
      "schemaVersion",
      "unknownObjectCount"
    ]) ||
    scan["schemaVersion"] !== "2.0" ||
    !Array.isArray(scan["proposals"]) ||
    !isNonNegativeSafeInteger(scan["unknownObjectCount"]) ||
    !isNonNegativeSafeInteger(scan["authenticationFailureCount"])
  ) {
    return undefined;
  }

  const blobIds = new Set<string>();
  for (const proposal of scan["proposals"]) {
    if (!isRecord(proposal) || !isStableId(proposal["contentRootBindingId"])) return undefined;
    const proposalRootBindingId = proposal["contentRootBindingId"];
    const candidate = proposal["candidate"];
    if (
      !hasExactKeys(candidate, ["blob", "manifest", "schemaVersion"]) ||
      candidate["schemaVersion"] !== "2.0" ||
      !isRecord(candidate["manifest"])
    ) {
      return undefined;
    }
    const candidateBlobId = rootBoundProposalBlobId(candidate["blob"], proposalRootBindingId);
    if (candidateBlobId === undefined) return undefined;
    const before = proposal["before"];
    if (!isRecord(before) || (before["kind"] !== "present" && before["kind"] !== "absent")) {
      return undefined;
    }
    const beforeBlobId =
      before["kind"] === "present"
        ? rootBoundProposalBlobId(before["blob"], proposalRootBindingId)
        : null;
    if (before["kind"] === "present" && beforeBlobId === undefined) return undefined;
    if (proposalRootBindingId !== contentRootBindingId) continue;
    blobIds.add(candidateBlobId);
    if (beforeBlobId !== null && beforeBlobId !== undefined) blobIds.add(beforeBlobId);
  }
  return Object.freeze([...blobIds].sort());
}

function rootBoundProposalBlobId(value: unknown, contentRootBindingId: string): string | undefined {
  return isRecord(value) &&
    value["contentRootBindingId"] === contentRootBindingId &&
    isStableId(value["blobId"])
    ? value["blobId"]
    : undefined;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function createNativeStagingScanner(input: {
  readonly contentRootBindingId: string;
  readonly scanNativeRecovery: () => Promise<Result<NativeRecoveryScan, UnifiedError>>;
  readonly traceId: string;
}): (request: {
  readonly contentRootBindingId: string;
  readonly referencedStagingObjectIds: readonly string[];
}) => Promise<Result<EngineeringRecoveryStagingScanV2, UnifiedError>> {
  return async (request) => {
    if (request.contentRootBindingId !== input.contentRootBindingId) {
      return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", input.traceId);
    }
    const referencedObjectIds = canonicalStableIds(request.referencedStagingObjectIds);
    if (referencedObjectIds === undefined) {
      return unavailable(
        "ENGINEERING_MUTATION_PRODUCTION_STAGING_REFERENCE_INVALID",
        input.traceId
      );
    }
    const native = await input.scanNativeRecovery();
    if (!native.ok) return native;

    // The native API reports aggregate recovery state only. A clear scan proves there is no
    // unresolved native staging state; the durable WAL remains the authority for referenced ids.
    // A pending scan cannot attribute the native objects to individual WAL ids, so it remains an
    // intentionally blocking unknown result while still returning the gate's exact partition.
    if (native.value.status === "clear") {
      return ok(
        Object.freeze({
          verifiedObjectIds: Object.freeze([...referencedObjectIds]),
          missingObjectIds: Object.freeze([]),
          orphanObjectIds: Object.freeze([]),
          unknownObjectCount: 0,
          authenticationFailureCount: 0
        })
      );
    }
    return ok(
      Object.freeze({
        verifiedObjectIds: Object.freeze([...referencedObjectIds]),
        missingObjectIds: Object.freeze([]),
        orphanObjectIds: Object.freeze([]),
        unknownObjectCount: 1,
        authenticationFailureCount: 0
      })
    );
  };
}

function createLedgerReservationScanner(input: {
  readonly contentRootBindingId: string;
  readonly ledger: DesktopEngineeringMutationAuthorizationLedgerV2;
  /** A session-held reserve→WAL handoff; it is never populated during startup scanning. */
  readonly isActiveReservation: (authorizationId: string, transactionId: string) => boolean;
  readonly traceId: string;
}): (request: {
  readonly contentRootBindingId: string;
  readonly referencedAuthorizationIds: readonly string[];
}) => Promise<Result<EngineeringRecoveryReservationScanV2, UnifiedError>> {
  return async (request) => {
    if (request.contentRootBindingId !== input.contentRootBindingId) {
      return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", input.traceId);
    }
    const referencedAuthorizationIds = canonicalStableIds(request.referencedAuthorizationIds);
    if (referencedAuthorizationIds === undefined) {
      return unavailable(
        "ENGINEERING_MUTATION_PRODUCTION_RESERVATION_REFERENCE_INVALID",
        input.traceId
      );
    }

    const listed = await safelyCall(
      () => input.ledger.listReservationWals(),
      "ENGINEERING_MUTATION_PRODUCTION_RESERVATION_WAL_SCAN_UNAVAILABLE",
      input.traceId
    );
    if (!listed.ok) return listed;
    if (!Array.isArray(listed.value)) {
      return unavailable(
        "ENGINEERING_MUTATION_PRODUCTION_RESERVATION_WAL_SCAN_INVALID",
        input.traceId
      );
    }

    const referenced = new Set(referencedAuthorizationIds);
    const validRootWals = new Map<string, AuthorizationReservationWalV2[]>();
    const invalidRootAuthorizationIds = new Set<string>();
    const seenWalIds = new Set<string>();
    let unknownRecordCount = 0;
    let authenticationFailureCount = 0;

    for (const candidate of listed.value as readonly unknown[]) {
      const wal = parseReservationWal(candidate);
      if (wal === undefined) {
        unknownRecordCount += 1;
        continue;
      }
      const duplicateWalId = seenWalIds.has(wal.walId);
      seenWalIds.add(wal.walId);
      if (duplicateWalId) unknownRecordCount += 1;

      // Query through the same shared ledger using the reservation's transaction id: a reserved
      // record is intentionally private to that id, and no unauthenticated inventory can stand
      // in for it during startup recovery.
      const queried = await safelyCall(
        () => input.ledger.query(wal.authorizationId, wal.transactionId),
        "ENGINEERING_MUTATION_PRODUCTION_RESERVATION_QUERY_UNAVAILABLE",
        input.traceId
      );
      if (!queried.ok) {
        unknownRecordCount += 1;
        continue;
      }
      if (!isLedgerReservationRecord(queried.value, wal.authorizationId)) {
        authenticationFailureCount += 1;
        continue;
      }
      if (queried.value.binding.rootBindingId !== input.contentRootBindingId) {
        if (referenced.has(wal.authorizationId)) {
          invalidRootAuthorizationIds.add(wal.authorizationId);
          authenticationFailureCount += 1;
        }
        continue;
      }
      if (duplicateWalId || !reservationWalMatchesRecord(wal, queried.value)) {
        invalidRootAuthorizationIds.add(wal.authorizationId);
        authenticationFailureCount += 1;
        continue;
      }
      const existing = validRootWals.get(wal.authorizationId);
      if (existing === undefined) {
        validRootWals.set(wal.authorizationId, [wal]);
      } else {
        // An authorization has exactly one durable reservation WAL. Preserve a valid gate shape,
        // but mark this ambiguous inventory as blocking rather than guessing which WAL is real.
        existing.push(wal);
        invalidRootAuthorizationIds.add(wal.authorizationId);
        unknownRecordCount += 1;
      }
    }

    const verifiedAuthorizationIds: string[] = [];
    const missingAuthorizationIds: string[] = [];
    for (const authorizationId of referencedAuthorizationIds) {
      if (validRootWals.has(authorizationId) && !invalidRootAuthorizationIds.has(authorizationId)) {
        verifiedAuthorizationIds.push(authorizationId);
      } else {
        missingAuthorizationIds.push(authorizationId);
      }
    }

    const orphanAuthorizationIds = [...validRootWals.entries()]
      .filter(
        ([authorizationId, wals]) =>
          !referenced.has(authorizationId) &&
          !invalidRootAuthorizationIds.has(authorizationId) &&
          wals.some(
            (wal) =>
              wal.state === "prepared" &&
              !input.isActiveReservation(wal.authorizationId, wal.transactionId)
          )
      )
      .map(([authorizationId]) => authorizationId)
      .sort();

    return ok(
      Object.freeze({
        verifiedAuthorizationIds: Object.freeze(verifiedAuthorizationIds),
        missingAuthorizationIds: Object.freeze(missingAuthorizationIds),
        orphanAuthorizationIds: Object.freeze(orphanAuthorizationIds),
        unknownRecordCount,
        authenticationFailureCount
      })
    );
  };
}

function canonicalStableIds(value: readonly string[]): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((candidate) => !isStableId(candidate))) return undefined;
  const normalized = [...value].sort();
  return normalized.length === value.length &&
    new Set(normalized).size === normalized.length &&
    normalized.every((candidate, index) => candidate === value[index])
    ? Object.freeze(normalized)
    : undefined;
}

function parseReservationWal(value: unknown): AuthorizationReservationWalV2 | undefined {
  if (!hasExactKeys(value, reservationWalKeys)) return undefined;
  const record = value as Record<string, unknown>;
  return record["schemaVersion"] === "2.0" &&
    isStableId(record["walId"]) &&
    isStableId(record["authorizationId"]) &&
    isStableId(record["transactionId"]) &&
    (record["state"] === "prepared" ||
      record["state"] === "committed" ||
      record["state"] === "aborted") &&
    isNonEmptyString(record["createdAt"]) &&
    isNonEmptyString(record["updatedAt"])
    ? (Object.freeze({
        schemaVersion: "2.0" as const,
        walId: record["walId"],
        authorizationId: record["authorizationId"],
        transactionId: record["transactionId"],
        state: record["state"],
        createdAt: record["createdAt"],
        updatedAt: record["updatedAt"]
      }) as AuthorizationReservationWalV2)
    : undefined;
}

function isLedgerReservationRecord(
  value: unknown,
  expectedAuthorizationId: string
): value is EngineeringApprovalLedgerRecordV2 {
  if (!isRecord(value)) return false;
  const record = value as Record<string, unknown>;
  const binding = record["binding"];
  if (
    !ledgerRecordRequiredKeys.every((key) => Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !ledgerRecordKeys.includes(key)) ||
    record["schemaVersion"] !== "2.0" ||
    record["authorizationId"] !== expectedAuthorizationId ||
    !isStableId(record["authorizationId"]) ||
    !isRecord(binding) ||
    !isStableId(binding["rootBindingId"]) ||
    !isNonEmptyString(record["providerSemanticVersionSetChecksum"]) ||
    !isNonEmptyString(record["issuedAt"]) ||
    !isNonEmptyString(record["expiresAt"]) ||
    !isLedgerState(record["state"]) ||
    !isOptionalStableId(record["reservedTransactionId"]) ||
    !isOptionalStableId(record["reserveWalId"]) ||
    !isOptionalString(record["reservedAt"]) ||
    !isOptionalString(record["consumedAt"]) ||
    !isOptionalString(record["revokedAt"]) ||
    !isOptionalString(record["revocationReason"])
  ) {
    return false;
  }
  return true;
}

function reservationWalMatchesRecord(
  wal: AuthorizationReservationWalV2,
  record: EngineeringApprovalLedgerRecordV2
): boolean {
  if (record.reservedTransactionId !== wal.transactionId || record.reserveWalId !== wal.walId) {
    return false;
  }
  return (
    (wal.state === "prepared" && record.state === "reserved") ||
    (wal.state === "committed" && record.state === "consumed") ||
    (wal.state === "aborted" && record.state === "revoked")
  );
}

function isLedgerState(value: unknown): value is EngineeringApprovalLedgerRecordV2["state"] {
  return value === "issued" || value === "reserved" || value === "consumed" || value === "revoked";
}

function isOptionalStableId(value: unknown): boolean {
  return value === undefined || isStableId(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isLegacyRecoveryScan(value: unknown): value is EngineeringLegacyRecoveryScanV2 {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["status"] !== undefined &&
    ((value as Record<string, unknown>)["status"] === "clean" ||
      (value as Record<string, unknown>)["status"] === "pending" ||
      (value as Record<string, unknown>)["status"] === "unknown") &&
    Object.keys(value).length === 1
  );
}

function revokeOnRootLoss(
  port: EngineeringQualifiedFileMutationPortV2,
  deactivate: () => void
): EngineeringQualifiedFileMutationPortV2 {
  const observe = <T>(result: Result<T, UnifiedError>): Result<T, UnifiedError> => {
    if (!result.ok && result.error.code === "ENGINEERING_FILE_MUTATION_V2_ROOT_CHANGED") {
      deactivate();
    }
    return result;
  };
  return Object.freeze({
    async inspectProposalSnapshot(
      input: Parameters<EngineeringQualifiedFileMutationPortV2["inspectProposalSnapshot"]>[0]
    ) {
      return observe(await port.inspectProposalSnapshot(input));
    },
    async observeCreateAbsence(
      input: Parameters<EngineeringQualifiedFileMutationPortV2["observeCreateAbsence"]>[0]
    ) {
      return observe(await port.observeCreateAbsence(input));
    },
    async apply(input: Parameters<EngineeringQualifiedFileMutationPortV2["apply"]>[0]) {
      return observe(await port.apply(input));
    },
    async reconcile(input: Parameters<EngineeringQualifiedFileMutationPortV2["reconcile"]>[0]) {
      return observe(await port.reconcile(input));
    },
    async move(input: Parameters<EngineeringQualifiedFileMutationPortV2["move"]>[0]) {
      return observe(await port.move(input));
    },
    async quarantine(input: Parameters<EngineeringQualifiedFileMutationPortV2["quarantine"]>[0]) {
      return observe(await port.quarantine(input));
    },
    async createDirectory(
      input: Parameters<EngineeringQualifiedFileMutationPortV2["createDirectory"]>[0]
    ) {
      return observe(await port.createDirectory(input));
    },
    async reconcileLifecycle(
      input: Parameters<
        NonNullable<EngineeringQualifiedFileMutationPortV2["reconcileLifecycle"]>
      >[0]
    ) {
      return port.reconcileLifecycle === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.reconcileLifecycle(input));
    },
    async resumeLifecycle(
      input: Parameters<NonNullable<EngineeringQualifiedFileMutationPortV2["resumeLifecycle"]>>[0]
    ) {
      return port.resumeLifecycle === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.resumeLifecycle(input));
    },
    async compensateLifecycle(
      input: Parameters<
        NonNullable<EngineeringQualifiedFileMutationPortV2["compensateLifecycle"]>
      >[0]
    ) {
      return port.compensateLifecycle === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.compensateLifecycle(input));
    },
    async finalizeLifecycle(
      input: Parameters<NonNullable<EngineeringQualifiedFileMutationPortV2["finalizeLifecycle"]>>[0]
    ) {
      return port.finalizeLifecycle === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.finalizeLifecycle(input));
    },
    async inspectQuarantine(
      input: Parameters<NonNullable<EngineeringQualifiedFileMutationPortV2["inspectQuarantine"]>>[0]
    ) {
      return port.inspectQuarantine === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.inspectQuarantine(input));
    },
    async restore(input: unknown) {
      return port.restore === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.restore(input));
    },
    async purge(input: unknown) {
      return port.purge === undefined
        ? unavailable("ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE")
        : observe(await port.purge(input));
    }
  });
}

async function recoverLifecycleJournalsAtStartup(input: {
  readonly contentRootBindingId: string;
  readonly walRepository: FileEngineeringLifecycleWalRepositoryV2;
  readonly transaction: EngineeringLifecycleWriteTransactionV2;
  readonly rootLease: EngineeringMutationRootLeasePortV2;
  readonly saveCoordinator: EngineeringMutationSaveCoordinatorPortV2;
  readonly editorState: EngineeringMutationEditorStatePortV2;
  readonly synchronizer: EngineeringMutationSyncPortV2;
  readonly syncRequiredStore: FileEngineeringMutationSyncRequiredStoreV2;
  readonly now: () => string;
  readonly traceId: string;
}): Promise<Result<boolean, UnifiedError>> {
  const scanned = await input.walRepository.scanRoot(input.contentRootBindingId);
  if (!scanned.ok) return scanned;
  if (scanned.value.unknownRecordCount > 0 || scanned.value.authenticationFailureCount > 0) {
    return unavailable("ENGINEERING_MUTATION_PRODUCTION_LIFECYCLE_RECOVERY_INVALID", input.traceId);
  }
  const pendingJournals = scanned.value.journals.filter(
    (journal) => journal.synchronizedAt === null
  );
  if (pendingJournals.length === 0) return ok(false);

  const relativeIdentities = Object.freeze(
    [
      ...new Set(
        pendingJournals.flatMap((journal) =>
          journal.prepared.operations.flatMap((operation) =>
            lifecycleOperationRelativeIdentities(operation.request)
          )
        )
      )
    ].sort((left, right) => left.localeCompare(right))
  );
  const lease = await input.rootLease.acquire(input.contentRootBindingId);
  if (!lease.ok) return lease;
  let pause:
    Awaited<ReturnType<EngineeringMutationSaveCoordinatorPortV2["pauseAndDrainRoot"]>> | undefined;
  try {
    const current = await lease.value.assertCurrent();
    if (!current.ok) return current;
    pause = await input.saveCoordinator.pauseAndDrainRoot({
      contentRootBindingId: input.contentRootBindingId,
      relativeIdentities
    });
    if (!pause.ok) return pause;
    const editor = await input.editorState.inspectAll({
      contentRootBindingId: input.contentRootBindingId,
      relativeIdentities
    });
    if (!editor.ok) return editor;
    if (editor.value.status !== "ready") {
      return unavailable(
        "ENGINEERING_MUTATION_PRODUCTION_LIFECYCLE_RECOVERY_EDITOR_UNSAFE",
        input.traceId
      );
    }

    for (const journal of pendingJournals) {
      const stillCurrent = await lease.value.assertCurrent();
      if (!stillCurrent.ok) return stillCurrent;
      const recovered = await input.transaction.recover({
        contentRootBindingId: input.contentRootBindingId,
        transactionId: journal.prepared.transactionId
      });
      if (!recovered.ok) return recovered;

      for (const operation of journal.prepared.operations) {
        const operationPaths = lifecycleOperationRelativeIdentities(operation.request);
        const synchronized = await input.synchronizer.synchronize({
          contentRootBindingId: input.contentRootBindingId,
          operationKind: operation.request.operationKind,
          relativeIdentities: operationPaths,
          transactionId: journal.prepared.transactionId
        });
        if (!synchronized.ok) {
          const recorded = await input.syncRequiredStore.writeSyncRequired({
            schemaVersion: "2.0",
            kind: "sync_required",
            contentRootBindingId: input.contentRootBindingId,
            transactionId: journal.prepared.transactionId,
            operationKind: operation.request.operationKind,
            relativeIdentities: operationPaths,
            recordedAt: input.now()
          });
          return recorded.ok ? synchronized : recorded;
        }
      }
      const marked = await input.walRepository.markSynchronized({
        contentRootBindingId: input.contentRootBindingId,
        transactionId: journal.prepared.transactionId,
        synchronizedAt: input.now()
      });
      if (!marked.ok) return marked;
    }
    return ok(true);
  } finally {
    try {
      if (pause?.ok) await pause.value.release();
    } catch {
      // The root remains unavailable after recovery cleanup failure.
    }
    try {
      await lease.value.release();
    } catch {
      // The process-local root lease is discarded with the failed composition.
    }
  }
}

function lifecycleOperationRelativeIdentities(
  request: EngineeringLifecycleWriteTransactionInputV2["operations"][number]["request"]
): readonly string[] {
  const identities =
    request.operationKind === "move_file"
      ? [request.relativeSource, request.relativeTarget]
      : request.operationKind === "delete_file"
        ? [request.relativeSource]
        : [request.relativeTarget];
  return Object.freeze([...new Set(identities)].sort((left, right) => left.localeCompare(right)));
}

function createRootHandleLeasePort(input: {
  readonly contentRootBindingId: string;
  readonly verifyRootAvailable: () => Promise<Result<void, UnifiedError>>;
}): EngineeringMutationRootLeasePortV2 {
  let held = false;
  return Object.freeze({
    async acquire(contentRootBindingId: string) {
      if (contentRootBindingId !== input.contentRootBindingId || held) {
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_LEASE_UNAVAILABLE");
      }
      const verified = await input.verifyRootAvailable();
      if (!verified.ok) return verified;
      held = true;
      let released = false;
      return ok(
        Object.freeze({
          contentRootBindingId: input.contentRootBindingId,
          assertCurrent: async () =>
            released || !held
              ? unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_LEASE_UNAVAILABLE")
              : input.verifyRootAvailable(),
          release() {
            if (released) return;
            released = true;
            held = false;
          }
        })
      );
    }
  });
}

function createSaveCoordinator(input: {
  readonly contentRootBindingId: string;
  readonly authority: DesktopEngineeringMutationSaveAuthorityV2;
  readonly traceId: string;
}): EngineeringMutationSaveCoordinatorPortV2 {
  return Object.freeze({
    async pauseAndDrainRoot(
      request: Parameters<EngineeringMutationSaveCoordinatorPortV2["pauseAndDrainRoot"]>[0]
    ) {
      if (request.contentRootBindingId !== input.contentRootBindingId) {
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", input.traceId);
      }
      try {
        const pause = await input.authority.pauseAndDrainEngineeringRoot(
          input.contentRootBindingId
        );
        if (pause === null || typeof pause !== "object" || typeof pause.release !== "function") {
          return unavailable(
            "ENGINEERING_MUTATION_PRODUCTION_SAVE_COORDINATOR_INVALID",
            input.traceId
          );
        }
        return ok(Object.freeze({ release: pause.release }));
      } catch {
        return unavailable(
          "ENGINEERING_MUTATION_PRODUCTION_SAVE_COORDINATOR_UNAVAILABLE",
          input.traceId
        );
      }
    }
  });
}

function createEditorStatePort(input: {
  readonly contentRootBindingId: string;
  readonly registry: Pick<EngineeringEditorStateRegistry, "observe">;
  readonly traceId: string;
}): EngineeringMutationEditorStatePortV2 {
  return Object.freeze({
    async inspectAll(request: Parameters<EngineeringMutationEditorStatePortV2["inspectAll"]>[0]) {
      if (request.contentRootBindingId !== input.contentRootBindingId) {
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", input.traceId);
      }
      try {
        let hasDirtyEditor = false;
        let hasDisconnectedEditor = false;
        let hasUnknownEditor = false;
        for (const relativePath of request.relativeIdentities) {
          const observation = input.registry.observe({
            rootBindingId: input.contentRootBindingId,
            relativePath
          });
          if (observation.status === "connected") {
            hasDirtyEditor ||= observation.state.dirty;
          } else if (observation.status === "disconnected") {
            hasDisconnectedEditor = true;
          } else if (observation.reason !== "missing") {
            // A target with no open editor is normal for create operations. Every other unknown
            // state (including acknowledgement drift) is unsafe to mutate through.
            hasUnknownEditor = true;
          }
        }
        if (hasUnknownEditor) return ok({ status: "unknown" as const });
        if (hasDisconnectedEditor) return ok({ status: "disconnected" as const });
        return ok({ status: hasDirtyEditor ? ("dirty" as const) : ("ready" as const) });
      } catch {
        return unavailable(
          "ENGINEERING_MUTATION_PRODUCTION_EDITOR_STATE_UNAVAILABLE",
          input.traceId
        );
      }
    }
  });
}

function createRendererSynchronizerPort(input: {
  readonly contentRootBindingId: string;
  readonly coordinator: Pick<EngineeringMutationRendererSyncCoordinatorV2, "request">;
  readonly workspaceAccessSession: EngineeringWorkspaceAccessSession;
  readonly traceId: string;
}): EngineeringMutationSyncPortV2 {
  return Object.freeze({
    async synchronize(request: Parameters<EngineeringMutationSyncPortV2["synchronize"]>[0]) {
      if (request.contentRootBindingId !== input.contentRootBindingId) {
        return unavailable("ENGINEERING_MUTATION_PRODUCTION_ROOT_MISMATCH", input.traceId);
      }
      const acknowledged = await safelyCall(
        () =>
          input.coordinator.request({
            operationKind: request.operationKind,
            relativePaths: request.relativeIdentities
          }),
        "ENGINEERING_MUTATION_PRODUCTION_RENDERER_SYNC_UNAVAILABLE",
        input.traceId
      );
      if (!acknowledged.ok) return acknowledged;
      const rebuilt = await safelyCall(
        () => input.workspaceAccessSession.buildIndex(),
        "ENGINEERING_MUTATION_PRODUCTION_INDEX_REBUILD_UNAVAILABLE",
        input.traceId
      );
      return rebuilt.ok ? ok(undefined) : rebuilt;
    }
  });
}

function createFullAfterManifestVerifier(input: {
  readonly mutationPort: EngineeringQualifiedFileMutationPortV2;
  readonly blobStore: EngineeringMutationBlobStoreV2;
  readonly traceId: string;
}): EngineeringFullAfterManifestVerifierV2 {
  return async ({ prepared, receipts }) => {
    if (prepared.operations.length !== receipts.length) {
      return unavailable("ENGINEERING_MUTATION_PRODUCTION_AFTER_MANIFEST_INVALID", input.traceId);
    }
    const manifests: EngineeringRawByteManifestV2[] = [];
    for (const operation of prepared.operations) {
      const candidate = await input.blobStore.get(operation.candidate.blob);
      if (!candidate.ok) return candidate;
      const before =
        operation.before.kind === "present"
          ? await input.blobStore.get(operation.before.blob)
          : undefined;
      if (before !== undefined && !before.ok) return before;
      const reconciled = await input.mutationPort.reconcile({
        request: operation,
        beforeBytes: before === undefined ? null : before.value,
        candidateBytes: candidate.value
      });
      if (!reconciled.ok) return reconciled;
      if (reconciled.value.state !== "after") {
        return unavailable(
          "ENGINEERING_MUTATION_PRODUCTION_AFTER_MANIFEST_MISMATCH",
          input.traceId
        );
      }
      manifests.push(reconciled.value.receipt.observedAfter);
    }
    return ok(Object.freeze(manifests));
  };
}

async function safelyCall<T>(
  operation: () => Promise<Result<T, UnifiedError>>,
  code: string,
  traceId: string
): Promise<Result<T, UnifiedError>> {
  try {
    const result = await operation();
    return isResult(result) ? result : unavailable(code, traceId);
  } catch {
    return unavailable(code, traceId);
  }
}

function isResult<T>(value: unknown): value is Result<T, UnifiedError> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["ok"] === "boolean"
  );
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

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function unavailable<T = never>(
  code: string,
  traceId = "desktop-engineering-mutation-production-composition-v2"
): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "StorageError",
      message: "The qualified engineering mutation composition is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Keep Engineering mutation disabled and reopen the qualified workspace.",
      traceId
    })
  );
}

const reservationWalKeys: readonly string[] = [
  "authorizationId",
  "createdAt",
  "schemaVersion",
  "state",
  "transactionId",
  "updatedAt",
  "walId"
];

const ledgerRecordKeys: readonly string[] = [
  "authorizationId",
  "binding",
  "consumedAt",
  "expiresAt",
  "issuedAt",
  "providerSemanticVersionSetChecksum",
  "reserveWalId",
  "reservedAt",
  "reservedTransactionId",
  "revocationReason",
  "revokedAt",
  "schemaVersion",
  "state"
];

const ledgerRecordRequiredKeys: readonly string[] = [
  "authorizationId",
  "binding",
  "expiresAt",
  "issuedAt",
  "providerSemanticVersionSetChecksum",
  "schemaVersion",
  "state"
];
