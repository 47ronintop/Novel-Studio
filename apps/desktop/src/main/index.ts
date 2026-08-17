import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  type BrowserWindowConstructorOptions
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBootstrappedDefaultDesktopApplicationWithSnapshot,
  createProjectLockOwnerId,
  createUnboundDesktopApplication,
  DEFAULT_FIXTURE_CHAPTER_ID
} from "./application-composition.js";
import { createDesktopAgentRuntime } from "./agent-run-runtime.js";
import { createDesktopStandaloneAgentRuntime } from "./standalone-agent-runtime.js";
import { createDesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import type { DesktopAgentRuntime, DesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import {
  createDesktopNetworkSettingsSession,
  createDesktopNetworkToolExecutor
} from "./agent-network-runtime.js";
import {
  createProductionAgentFeatureFlags,
  hasCurrentMainOwnedApprovalSurfaceQualification
} from "./agent-feature-flags.js";
import { createCreativeFileOperationQualificationService } from "./creative-file-operation-qualification.js";
import { createMainOwnedCreativeFileOperationCandidateInspector } from "./creative-file-operation-fresh-probe.js";
import { createMainOwnedEngineeringFileAccessFreshProbe } from "./engineering-file-access-fresh-probe.js";
import {
  createEngineeringFileAccessQualificationService,
  hasMainOwnedEngineeringFileQualification
} from "./engineering-file-access-qualification.js";
import { createEngineeringFileAccessAddonLoader } from "./engineering-file-access-adapter.js";
import { createEngineeringWorkspaceAccessRuntime } from "./engineering-workspace-access-runtime.js";
import { createEngineeringMutationRendererSyncCoordinatorV2 } from "./engineering-mutation-renderer-sync-v2.js";
import { createDesktopEngineeringMutationProductionCompositionV2 } from "./engineering-mutation-production-composition-v2.js";
import {
  MainApprovalConfirmationCoordinator,
  registerTrustedApprovalIpc
} from "./agent-approval-confirmation.js";
import { ApprovalHumanIntentEvidenceJournal } from "./approval-human-intent-evidence-journal.js";
import { bindApprovalParentWindowFailClosedLifecycle } from "./approval-parent-window-lifecycle.js";
import {
  createSignedAsarPackageCoverageInspector,
  createSystemExecutableCodeSignatureInspector,
  loadApprovalSurfaceQualification,
  readApprovalElectronFuseState
} from "./approval-surface-qualification.js";
import {
  createMainOwnedNativeConfirmation,
  TrustedApprovalModalController,
  type ApprovalModalWindowLike,
  type TrustedApprovalModalWindowOptions
} from "./trusted-approval-modal-window.js";
import { createTrustedChangeSetApprovalV2Port } from "./trusted-change-set-approval-v2.js";
import {
  createDesktopAgentNetworkSettingsPort,
  createDesktopMcpSettingsPort
} from "./agent-tool-settings-store.js";
import { createDesktopCreativeProjectFileReceiptStore } from "./creative-project-file-receipt-store.js";
import { createDesktopWorkspaceContextPolicyStore } from "./workspace-context-policy-store.js";
import { createCreativeGeneralActiveResourceProof } from "./creative-general-active-resource-proof.js";
import { connectRemoteMcp, createRemoteMcpDispatch } from "./remote-mcp-runtime.js";
import { createAgentWriteSaveCoordinator, createApplicationIpcHandlers } from "./ipc-handlers.js";
import {
  createWritingEditorStateRegistry,
  type WritingEditorResourceIdentity,
  type WritingEditorStateRegistry
} from "./writing-editor-state-registry.js";
import {
  createEngineeringEditorStateRegistry,
  type EngineeringEditorStateRegistry
} from "./engineering-editor-state-registry.js";
import { createWorkspaceActivationCoordinator } from "./workspace-activation.js";
import { createApplicationMenuTemplate } from "./menu.js";
import { createDesktopModelRuntime, createEncryptedFileModelSecretStore } from "./model-runtime.js";
import { createSecureWebPreferences } from "./security.js";
import {
  createAgentPricingRegistry,
  createAgentExternalToolSession,
  createCreativeProjectFileSession,
  createMcpSettingsSession,
  mangleToolId,
  reasoningStrengthForModel,
  resolveAgentPromptCacheCapability,
  resolveCatalogAgentModelCapabilities
} from "@novel-studio/application";
import {
  ApprovalAuthorizationLedger,
  ApprovalDecisionProofFileRepository,
  CreativeProjectFileRepository,
  RecoveryRepository,
  canonicalizeEngineeringMutationV2Json,
  engineeringLifecycleSideEffectSubjectChecksumV2,
  engineeringSideEffectSubjectChecksumV2,
  type EngineeringFileMutationRequestV2,
  type EngineeringLifecycleWriteTransactionInputV2,
  type EngineeringWorkspaceNativeRootIdentity,
  type EngineeringWriteTransactionPreparedV2
} from "@novel-studio/repository";
import type {
  AgentRunChangeSetApprovalV2Port,
  AgentNetworkPolicy,
  AgentNetworkSettingsPort,
  AgentNetworkSettingsSession,
  AgentNetworkToolExecutor,
  AgentExternalToolExecutor,
  DesktopApplication,
  McpServerConfig,
  McpSettingsData,
  McpSettingsSession
} from "@novel-studio/application";
import type { LlmModelProfile, LlmProviderId } from "@novel-studio/llm-adapter";
import {
  STANDALONE_AGENT_CONTEXT_SCOPE,
  agentContextScopeKey,
  approvalBindingV2Checksum,
  computeAgentToolDescriptorDigest,
  MAX_EXTERNAL_TOOL_DESCRIPTORS,
  NO_AGENT_PROMPT_CACHE_CAPABILITY,
  defaultEngineeringPathPolicy,
  validateExternalToolDescriptors,
  type EngineeringWorkspaceRootBindingV1
} from "@novel-studio/agent-engine";
import type { AgentToolDescriptor } from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type { DesktopModelRuntime, ModelSecretStore } from "./model-runtime.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const desktopDistributionDirectory = join(currentDirectory, "..");
const approvalRendererPath = join(desktopDistributionDirectory, "approval", "index.html");
const approvalPreloadPath = join(desktopDistributionDirectory, "preload", "approval-preload.cjs");
let activeDesktopApplication: DesktopApplication | undefined;
let activeAgentRuntimeManager: DesktopAgentRuntimeManager | undefined;
let activeDesktopModelRuntime: DesktopModelRuntime | undefined;
let activeMainWindow: BrowserWindow | undefined;
let activeApprovalCoordinator: MainApprovalConfirmationCoordinator | undefined;
let trustedApprovalIpcRegistered = false;
let shutdownInProgress = false;

const ENGINEERING_PATH_POLICY_REVISION = createHash("sha256")
  .update(
    JSON.stringify({
      ignoredRelativeIdentityKeys: [
        ...defaultEngineeringPathPolicy.ignoredRelativeIdentityKeys
      ].sort(),
      ignoredRootKeys: [...defaultEngineeringPathPolicy.ignoredRootKeys].sort(),
      policyManagedLeafKeys: [...defaultEngineeringPathPolicy.policyManagedLeafKeys].sort()
    }),
    "utf8"
  )
  .digest("hex");

const ENGINEERING_ROOT_BINDING_ID_DOMAIN = "novel-studio-engineering-content-root-binding-v2";

export function issueStableEngineeringWorkspaceRootBindingV2(input: {
  readonly workspaceId: string;
  readonly nativeIdentity: EngineeringWorkspaceNativeRootIdentity | undefined;
  readonly pathPolicyRevision: string;
  readonly issuedAt?: string;
}): EngineeringWorkspaceRootBindingV1 | undefined {
  const { workspaceId, nativeIdentity, pathPolicyRevision } = input;
  if (
    nativeIdentity === undefined ||
    !isRootBindingIdentityPart(workspaceId) ||
    !isRootBindingIdentityPart(nativeIdentity.volumeIdentity) ||
    !isRootBindingIdentityPart(nativeIdentity.directoryIdentity) ||
    !isSha256(nativeIdentity.canonicalPathIdentityChecksum) ||
    !isRootBindingIdentityPart(pathPolicyRevision)
  ) {
    return undefined;
  }
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  if (!isCanonicalUtcTimestamp(issuedAt)) return undefined;

  const rootBindingId = `engineering_root_v2_${createHash("sha256")
    .update(ENGINEERING_ROOT_BINDING_ID_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(
      JSON.stringify([
        workspaceId,
        nativeIdentity.volumeIdentity,
        nativeIdentity.directoryIdentity,
        nativeIdentity.canonicalPathIdentityChecksum,
        pathPolicyRevision
      ]),
      "utf8"
    )
    .digest("hex")}`;

  return Object.freeze({
    schemaVersion: "1.0" as const,
    rootBindingId,
    workspaceId,
    workspaceKind: "engineeringWorkspace" as const,
    volumeIdentity: nativeIdentity.volumeIdentity,
    directoryIdentity: nativeIdentity.directoryIdentity,
    canonicalPathIdentityChecksum: nativeIdentity.canonicalPathIdentityChecksum,
    pathPolicyRevision,
    issuedAt
  });
}

function isRootBindingIdentityPart(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes("\0") &&
    isWellFormedUnicode(value)
  );
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

const activeApprovalCoordinatorProxy = new Proxy(
  Object.create(
    MainApprovalConfirmationCoordinator.prototype
  ) as MainApprovalConfirmationCoordinator,
  {
    get(_target, property) {
      if (property === "readFromModal") {
        return (senderWebContentsId: number, previewId: string) => {
          const coordinator = activeApprovalCoordinator;
          return coordinator === undefined
            ? trustedApprovalUnavailable()
            : coordinator.readFromModal(senderWebContentsId, previewId);
        };
      }
      if (property === "decideFromModal") {
        return async (
          senderWebContentsId: number,
          decision: Parameters<MainApprovalConfirmationCoordinator["decideFromModal"]>[1]
        ) => {
          const coordinator = activeApprovalCoordinator;
          return coordinator === undefined
            ? trustedApprovalUnavailable()
            : coordinator.decideFromModal(senderWebContentsId, decision);
        };
      }
      return undefined;
    }
  }
);

function registerTrustedApprovalIpcOnce(): void {
  if (trustedApprovalIpcRegistered) return;
  registerTrustedApprovalIpc(
    {
      handle: (channel, listener) => {
        ipcMain.handle(channel, (event, ...args) => listener(event, ...args));
      }
    },
    activeApprovalCoordinatorProxy
  );
  trustedApprovalIpcRegistered = true;
}

function replaceActiveApprovalCoordinator(
  coordinator: MainApprovalConfirmationCoordinator | undefined,
  reason: string
): void {
  if (activeApprovalCoordinator === coordinator) return;
  activeApprovalCoordinator?.revokeAll(reason);
  activeApprovalCoordinator = coordinator;
}

function trustedApprovalUnavailable<T = never>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE",
      category: "AgentError",
      message: "The active Main-owned approval coordinator is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Open the current workspace and request a new confirmation.",
      traceId: "desktop-trusted-approval-ipc-proxy"
    })
  );
}

export async function registerApplicationIpcHandlers(): Promise<void> {
  registerTrustedApprovalIpcOnce();
  const userDataRoot = process.env["NOVEL_STUDIO_USER_DATA_ROOT"] ?? app.getPath("userData");
  const fixtureProjectRoot = process.env["NOVEL_STUDIO_PROJECT_ROOT"];
  const appRoot = app.getAppPath();
  let embeddedAsarIntegrityValidationEnabled = false;
  let onlyLoadAppFromAsarEnabled = false;
  if (app.isPackaged) {
    const fuseState = await readApprovalElectronFuseState(process.execPath);
    embeddedAsarIntegrityValidationEnabled =
      fuseState?.embeddedAsarIntegrityValidationEnabled === true;
    onlyLoadAppFromAsarEnabled = fuseState?.onlyLoadAppFromAsarEnabled === true;
  }
  const packageSignatureInspector = app.isPackaged
    ? createSignedAsarPackageCoverageInspector({
        appPath: appRoot,
        resourcesPath: process.resourcesPath,
        executablePath: process.execPath,
        embeddedAsarIntegrityValidationEnabled: () => embeddedAsarIntegrityValidationEnabled,
        onlyLoadAppFromAsarEnabled: () => onlyLoadAppFromAsarEnabled,
        executableCodeSignatureInspector: createSystemExecutableCodeSignatureInspector(
          process.platform
        )
      })
    : undefined;
  const approvalQualificationResult = await loadApprovalSurfaceQualification({
    rootDirectory: appRoot,
    buildManifestPath: join(appRoot, "apps", "desktop", "dist", "build-manifest.json"),
    mode: app.isPackaged ? "production" : "development",
    ...(packageSignatureInspector === undefined ? {} : { packageSignatureInspector })
  });
  const approvalSurfaceQualification = approvalQualificationResult.ok
    ? approvalQualificationResult.value
    : undefined;
  const creativeFileOperationQualification = createCreativeFileOperationQualificationService({
    packageKind: app.isPackaged ? "production" : "development",
    ...(app.isPackaged && approvalSurfaceQualification !== undefined
      ? {
          candidateInspector: createMainOwnedCreativeFileOperationCandidateInspector({
            packageIdentityChecksum: approvalSurfaceQualification.attestationChecksum
          })
        }
      : {})
  });
  // This Main-only authority never treats a locally built or unsigned CI artifact as production.
  const engineeringFileAccessQualification = createEngineeringFileAccessQualificationService({
    packageKind: app.isPackaged ? "production" : "development",
    // The probe owns no paths or trust decisions. Qualification supplies only the fixed installed
    // artifact set after validating its manifest, signatures, and immutable publisher policy.
    productionProbe: createMainOwnedEngineeringFileAccessFreshProbe()
  });
  const engineeringFileAccessAddonLoader = createEngineeringFileAccessAddonLoader();
  let creativeQualificationExpiresAt: number | undefined;
  let creativeQualificationExpiryTimer: NodeJS.Timeout | undefined;
  const modelSecretStore = createEncryptedFileModelSecretStore({
    userDataRoot,
    cipher: safeStorage
  });
  const modelRuntime = createDesktopModelRuntime({
    userDataRoot,
    secretStore: modelSecretStore
  });
  activeDesktopModelRuntime = modelRuntime;
  const projectLockOwnerId = createProjectLockOwnerId();
  const agentWriteSaveCoordinator = createAgentWriteSaveCoordinator();
  const writingEditorStateRegistry = createWritingEditorStateRegistry();
  const engineeringEditorStateRegistry = createEngineeringEditorStateRegistry();
  const engineeringMutationRendererSync = createEngineeringMutationRendererSyncCoordinatorV2({
    resolveTarget: () => {
      const window = activeMainWindow;
      return window === undefined || window.isDestroyed() ? undefined : window.webContents;
    }
  });
  const engineeringRootBindingIdByRuntime = new WeakMap<DesktopAgentRuntime, string>();
  const engineeringRecoveryGateByRuntime = new WeakMap<
    DesktopAgentRuntime,
    () => Promise<Result<void, UnifiedError>>
  >();
  let activeEngineeringEditorRootBindingId: string | undefined;
  const workspaceContextPolicyStore = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
  const creativeGeneralActiveResourceProof = createCreativeGeneralActiveResourceProof();
  const approvalCoordinatorByRuntime = new WeakMap<object, MainApprovalConfirmationCoordinator>();
  const creativeProjectFileSession = createCreativeProjectFileSession({
    createRepository: (activation) =>
      new CreativeProjectFileRepository({
        projectRoot: activation.projectRoot,
        ...(activation.displayRoot === undefined ? {} : { displayRoot: activation.displayRoot }),
        workspaceLayout: activation.workspaceLayout ?? "standalone",
        projectId: activation.projectId,
        workspaceId: activation.workspaceId,
        receiptStore: createDesktopCreativeProjectFileReceiptStore({
          stateRoot: activation.stateRoot ?? activation.projectRoot,
          projectId: activation.projectId,
          workspaceId: activation.workspaceId
        })
      })
  });
  const agentPricingRegistry = createAgentPricingRegistry({
    version: "stage-5-2026-07-15",
    entries: []
  });
  const agentNetworkSettingsPort = createDesktopAgentNetworkSettingsPort({ userDataRoot });
  const agentNetworkSettingsSession = createDesktopNetworkSettingsSession({
    settingsPort: agentNetworkSettingsPort,
    resolveSecret: async (secretRef) => {
      const secret = await modelSecretStore.readSecret(secretRef);
      return secret.ok ? secret.value : undefined;
    }
  });
  const agentMcpSettingsPort = createDesktopMcpSettingsPort({ userDataRoot });
  const agentMcpSettingsSession = createMcpSettingsSession({
    port: agentMcpSettingsPort,
    testRemoteConnection: (config) =>
      testDesktopRemoteMcpConnection({
        config,
        networkSettingsSession: agentNetworkSettingsSession,
        readMcpSettings: () => agentMcpSettingsPort.readMcpSettings(),
        modelSecretStore
      })
  });
  const bootstrapped =
    fixtureProjectRoot === undefined
      ? undefined
      : await createBootstrappedDefaultDesktopApplicationWithSnapshot({
          projectRoot: fixtureProjectRoot,
          userDataRoot,
          projectLockOwnerId,
          modelConnectionTester: modelRuntime.modelConnectionTester,
          modelDiscoveryPort: modelRuntime.modelDiscoveryPort,
          createAiProvider: modelRuntime.createAiProvider
        });
  const application =
    bootstrapped?.application ??
    (await createUnboundDesktopApplication({
      userDataRoot,
      projectLockOwnerId,
      modelConnectionTester: modelRuntime.modelConnectionTester,
      modelDiscoveryPort: modelRuntime.modelDiscoveryPort,
      createAiProvider: modelRuntime.createAiProvider
    }));
  activeDesktopApplication = application;
  const failAgentWriteAt = readPositiveInteger(
    process.env["NOVEL_STUDIO_TEST_AGENT_WRITE_FAIL_AT"]
  );
  const resolveAgentModelProfile = (profileId: string, modelNameOverride?: string) =>
    resolveDesktopAgentModelProfile(activeDesktopApplication, profileId, modelNameOverride);
  const resolveAgentModelStartFacts = (profileId: string, modelNameOverride?: string) =>
    resolveDesktopAgentModelStartFacts(
      activeDesktopApplication,
      modelSecretStore,
      profileId,
      modelNameOverride
    );
  const agentRuntimeManager = createDesktopAgentRuntimeManager({
    createRuntime: async (binding) => {
      const workspaceContextPolicy = await workspaceContextPolicyStore.read({
        workspaceKind: binding.kind,
        workspaceId: binding.workspaceId,
        contentRoot: binding.contentRoot
      });
      const networkRuntime = await resolveDesktopNetworkRuntime({
        settingsSession: agentNetworkSettingsSession,
        settingsPort: agentNetworkSettingsPort,
        modelSecretStore
      });
      const mcpRuntime = await resolveDesktopMcpRuntime({
        settingsSession: agentMcpSettingsSession,
        networkSettingsSession: agentNetworkSettingsSession,
        modelSecretStore
      });
      const authorizationLedger = new ApprovalAuthorizationLedger({
        projectRoot: binding.stateRoot,
        traceId: "desktop-agent-authorization-ledger"
      });
      const approvalDecisionProofRepository = new ApprovalDecisionProofFileRepository({
        projectRoot: binding.stateRoot,
        traceId: "desktop-agent-approval-decision-proof-repository"
      });
      let changeSetApprovalV2: AgentRunChangeSetApprovalV2Port | undefined;
      let nextApprovalCoordinator: MainApprovalConfirmationCoordinator | undefined;
      if (hasCurrentMainOwnedApprovalSurfaceQualification(approvalSurfaceQualification)) {
        const nativeConfirmation = createMainOwnedNativeConfirmation(
          dialog,
          () => BrowserWindow.getFocusedWindow() ?? activeMainWindow,
          () => app.getLocale()
        );
        const coordinator = new MainApprovalConfirmationCoordinator({
          authorizationLedger,
          nativeConfirm: nativeConfirmation.confirm,
          getSurfaceQualification: () => approvalSurfaceQualification,
          humanIntentEvidenceJournal: new ApprovalHumanIntentEvidenceJournal({
            userDataRoot
          })
        });
        const modalController = new TrustedApprovalModalController({
          factory: {
            create: createApprovalModalWindow
          },
          coordinator,
          approvalRendererPath,
          approvalPreloadPath,
          preserveAfterNativeConfirmation: nativeConfirmation.hasAccepted
        });
        changeSetApprovalV2 = createTrustedChangeSetApprovalV2Port({
          authorizationLedger,
          coordinator,
          modalController,
          resolveParentWindow: () => activeMainWindow,
          surfaceQualification: approvalSurfaceQualification,
          workspaceLabel: basename(binding.contentRoot) || binding.workspaceId
        });
        nextApprovalCoordinator = coordinator;
      }
      const creativeOperationQualifications =
        binding.kind === "creativeProject"
          ? await creativeFileOperationQualification.readAll()
          : undefined;
      const creativeQualificationExpiries =
        creativeOperationQualifications === undefined
          ? []
          : Object.values(creativeOperationQualifications)
              .filter((attestation) => attestation.status === "qualified")
              .map((attestation) => Date.parse(attestation.expiresAt))
              .filter((expiresAt) => Number.isFinite(expiresAt));
      creativeQualificationExpiresAt =
        creativeQualificationExpiries.length === 0
          ? undefined
          : Math.min(...creativeQualificationExpiries);
      scheduleCreativeQualificationExpiry();
      const engineeringRuntimeForRootBinding: { current: DesktopAgentRuntime | undefined } = {
        current: undefined
      };
      const revokeEngineeringRootBinding = (rootBindingId: string): void => {
        const runtime = engineeringRuntimeForRootBinding.current;
        if (
          runtime === undefined ||
          engineeringRootBindingIdByRuntime.get(runtime) !== rootBindingId
        ) {
          return;
        }
        engineeringRootBindingIdByRuntime.delete(runtime);
        engineeringEditorStateRegistry.clearRootBinding(rootBindingId);
        if (activeEngineeringEditorRootBindingId === rootBindingId) {
          activeEngineeringEditorRootBindingId = undefined;
        }
        runtime.revokeEngineeringAccessCapabilities?.();
        // The capability state is synchronously revoked above. Persist the absorbing V2 terminal
        // event as well, so a root replacement cannot leave an old run visually/live-state active.
        void (async () => {
          const listed = await runtime.agentRunSession.listAgentRuns(runtime.workspaceId);
          if (!listed.ok) return;
          await Promise.allSettled(
            listed.value.map((snapshot) =>
              runtime.agentRunSession.invalidateAgentRunCapabilities({
                projectId: runtime.workspaceId,
                runId: snapshot.runId,
                commandId: `engineering_root_changed_${randomUUID().replaceAll("-", "")}`,
                expectedRunRevision: snapshot.runRevision,
                reason: "engineering_root_changed"
              })
            )
          );
        })();
      };
      let issuedEngineeringContentRootNativeIdentity:
        Readonly<EngineeringWorkspaceNativeRootIdentity> | undefined;
      const engineeringWorkspaceAccessResult =
        binding.kind !== "engineeringWorkspace"
          ? undefined
          : await createEngineeringWorkspaceAccessRuntime({
              qualificationService: engineeringFileAccessQualification,
              addonLoader: engineeringFileAccessAddonLoader,
              pathPolicy: defaultEngineeringPathPolicy,
              onRootChanged: ({ rootBindingId }) => revokeEngineeringRootBinding(rootBindingId),
              onQualificationRevoked: ({ rootBindingId }) =>
                revokeEngineeringRootBinding(rootBindingId),
              issueRootBinding: (nativeIdentity) => {
                const rootBinding = issueStableEngineeringWorkspaceRootBindingV2({
                  workspaceId: binding.workspaceId,
                  nativeIdentity,
                  pathPolicyRevision: ENGINEERING_PATH_POLICY_REVISION
                });
                if (rootBinding !== undefined) {
                  issuedEngineeringContentRootNativeIdentity = Object.freeze({
                    volumeIdentity: nativeIdentity.volumeIdentity,
                    directoryIdentity: nativeIdentity.directoryIdentity,
                    canonicalPathIdentityChecksum: nativeIdentity.canonicalPathIdentityChecksum
                  });
                }
                return rootBinding;
              }
            }).openWorkspace({ rootPath: binding.contentRoot });
      const engineeringWorkspaceAccessSession =
        engineeringWorkspaceAccessResult?.status === "available"
          ? engineeringWorkspaceAccessResult.session
          : undefined;
      const engineeringContentRootNativeIdentity =
        engineeringWorkspaceAccessSession === undefined
          ? undefined
          : issuedEngineeringContentRootNativeIdentity;
      const engineeringQualification =
        binding.kind === "engineeringWorkspace"
          ? await engineeringFileAccessQualification.readAttestation()
          : undefined;
      const engineeringMutationRootBinding = (() => {
        if (engineeringWorkspaceAccessSession === undefined) return undefined;
        try {
          return engineeringWorkspaceAccessSession.getMainOnlyRootHandleBindingV2?.();
        } catch {
          return undefined;
        }
      })();
      const engineeringMutationRefCapabilityRevision =
        engineeringMutationRootBinding === undefined || engineeringQualification === undefined
          ? undefined
          : `engineering-ref:${createHash("sha256")
              .update(
                `${engineeringMutationRootBinding.contentRootBindingId}:${engineeringMutationRootBinding.pathPolicyRevision}:${engineeringQualification.attestationChecksum}`,
                "utf8"
              )
              .digest("hex")}`;
      const legacyEngineeringRecovery = new RecoveryRepository({
        projectRoot: binding.stateRoot,
        traceId: "desktop-engineering-legacy-recovery-scan"
      });
      const authenticateEngineeringNativeBoundary = (input: {
        readonly rootBinding: {
          readonly contentRootBindingId: string;
          readonly rootId: string | bigint;
        };
      }): Result<void, UnifiedError> => {
        let current;
        try {
          current = engineeringWorkspaceAccessSession?.getMainOnlyRootHandleBindingV2?.();
        } catch {
          current = undefined;
        }
        return current !== undefined &&
          current.contentRootBindingId === input.rootBinding.contentRootBindingId &&
          current.rootId === input.rootBinding.rootId &&
          hasMainOwnedEngineeringFileQualification(engineeringQualification, "mutation") &&
          hasMainOwnedEngineeringFileQualification(engineeringQualification, "recovery")
          ? ok(undefined)
          : err(engineeringMutationAuthorityError("ENGINEERING_MUTATION_NATIVE_EVIDENCE_REJECTED"));
      };
      const engineeringMutationComposition =
        binding.kind === "engineeringWorkspace" &&
        engineeringWorkspaceAccessSession !== undefined &&
        engineeringContentRootNativeIdentity !== undefined &&
        engineeringQualification !== undefined &&
        engineeringMutationRefCapabilityRevision !== undefined &&
        changeSetApprovalV2 !== undefined
          ? await createDesktopEngineeringMutationProductionCompositionV2({
              projectId: binding.workspaceId,
              workspaceBindingId: binding.workspaceId,
              stateRoot: binding.stateRoot,
              workspaceAccessSession: engineeringWorkspaceAccessSession,
              contentRootNativeIdentity: engineeringContentRootNativeIdentity,
              pathPolicy: defaultEngineeringPathPolicy,
              refCapabilityRevision: engineeringMutationRefCapabilityRevision,
              qualificationService: engineeringFileAccessQualification,
              authorizationLedger,
              trustedApprovalQualified: () =>
                hasCurrentMainOwnedApprovalSurfaceQualification(approvalSurfaceQualification),
              readApprovalDecisionProof: (runId, proofId) =>
                approvalDecisionProofRepository.readApprovalDecisionProof(runId, proofId),
              authenticateNativeEvidence: authenticateEngineeringNativeBoundary,
              authenticateNativeProposalEvidence: authenticateEngineeringNativeBoundary,
              recovery: {
                verifyPreparedAuthorization: (prepared, expectedState) =>
                  verifyEngineeringPreparedAuthorization(
                    authorizationLedger,
                    prepared,
                    expectedState
                  ),

                scanLegacyRecovery: async () => {
                  const [records, journals] = await Promise.all([
                    legacyEngineeringRecovery.listRecoveryRecords(),
                    legacyEngineeringRecovery.listAgentTransactionJournals()
                  ]);
                  if (!records.ok) return records;
                  if (!journals.ok) return journals;
                  return ok({
                    status:
                      records.value.length === 0 && journals.value.length === 0
                        ? ("clean" as const)
                        : ("pending" as const)
                  });
                }
              },
              verifyPreparedLifecycleAuthorization: (prepared, acceptableStates) =>
                verifyEngineeringPreparedLifecycleAuthorization(
                  authorizationLedger,
                  prepared,
                  acceptableStates
                ),
              lifecycleRecoveryQualified: () =>
                hasMainOwnedEngineeringFileQualification(engineeringQualification, "mutation") &&
                hasMainOwnedEngineeringFileQualification(engineeringQualification, "recovery"),
              lifecycleRecoveryQualificationRevision: engineeringQualification.attestationChecksum,
              validateStagingReservation: validateEngineeringStagingReservation,
              saveAuthority: agentWriteSaveCoordinator,
              editorStateRegistry: engineeringEditorStateRegistry,
              rendererSynchronizer: engineeringMutationRendererSync,
              onMutationUnavailable: () => {
                const runtime = engineeringRuntimeForRootBinding.current;
                runtime?.revokeEngineeringMutationCapabilities?.();
                const refreshTimer = setTimeout(() => {
                  void agentRuntimeManager.refreshCurrentWorkspace().catch(() => undefined);
                }, 0);
                refreshTimer.unref();
              },
              addonLoader: engineeringFileAccessAddonLoader
            })
          : undefined;
      const featureFlags = createProductionAgentFeatureFlags(
        {
          agentGuidanceV3: true,
          phaseA_searchEnabled: true,
          // The legacy broad lifecycle switch must not authorize a Catalog 2.0
          // operation.  Each creative mutation is projected only from its
          // Main-owned operation qualification below.
          phaseB_fileLifecycleEnabled: false,
          engineeringHardenedAccessV1: engineeringWorkspaceAccessSession !== undefined,
          engineeringReplaceV2: engineeringMutationComposition !== undefined,
          engineeringCreateV2: engineeringMutationComposition !== undefined,
          engineeringMoveV2: engineeringMutationComposition?.lifecycleCapabilities.move === true,
          engineeringDeleteV2:
            engineeringMutationComposition?.lifecycleCapabilities.delete === true,
          engineeringDirectoryCreateV1:
            engineeringMutationComposition?.lifecycleCapabilities.createDirectory === true,
          ...(binding.kind === "creativeProject"
            ? {
                creativeTrustedReplaceV2: changeSetApprovalV2 !== undefined,
                creativeFileCreateV2: changeSetApprovalV2 !== undefined,
                creativeFileMoveV2: changeSetApprovalV2 !== undefined,
                creativeFileDeleteV2: changeSetApprovalV2 !== undefined
              }
            : {}),
          approvalBindingV2: changeSetApprovalV2 !== undefined,
          writingDomainCrudV2: changeSetApprovalV2 !== undefined,
          phaseD_networkReadEnabled: networkRuntime.executor !== undefined,
          phaseE_remoteMcpEnabled: mcpRuntime.executor !== undefined,
          revision: `desktop-main:${networkRuntime.policyRevision}:${mcpRuntime.settingsRevision}:workspace-context-${workspaceContextPolicy.policyRevision}:engineering-recovery-${engineeringMutationComposition?.recoveryRuntime.capabilityRevision ?? "unavailable"}`
        },
        approvalSurfaceQualification,
        engineeringQualification,
        undefined,
        creativeOperationQualifications
      );
      const runtime = createDesktopAgentRuntime({
        workspaceKind: binding.kind,
        projectId: binding.workspaceId,
        contentRoot: binding.contentRoot,
        stateRoot: binding.stateRoot,
        ...(engineeringWorkspaceAccessSession === undefined
          ? {}
          : { engineeringWorkspaceAccessSession }),
        ...(engineeringMutationComposition === undefined
          ? {}
          : {
              engineeringFileMutationV2: engineeringMutationComposition.session,
              engineeringMutationRuntimeV2: engineeringMutationComposition.runtime,
              engineeringMutationRefRegistryV2: engineeringMutationComposition.refRegistry,
              engineeringMutationRefCapabilityRevision:
                engineeringMutationComposition.refCapabilityRevision,
              disposeEngineeringMutationV2: engineeringMutationComposition.dispose
            }),
        workspaceTrust: workspaceContextPolicy.workspaceTrust,
        projectConventionsEnabled: workspaceContextPolicy.projectConventionsEnabled,
        contextSourcePreferences: workspaceContextPolicy.sourcePreferences,
        sharingDefaults: workspaceContextPolicy.sharingDefaults,
        sharingDefaultsRevision: workspaceContextPolicy.sharingDefaultsRevision,
        workspacePolicyRevision: workspaceContextPolicy.policyRevision,
        ...(binding.activeChapterId === undefined
          ? {}
          : { activeChapterId: binding.activeChapterId }),
        userDataRoot,
        featureFlags,
        authorizationLedger,
        approvalDecisionProofRepository,
        ...(changeSetApprovalV2 === undefined ? {} : { changeSetApprovalV2 }),
        ...(networkRuntime.executor === undefined
          ? {}
          : { networkToolExecutor: networkRuntime.executor }),
        dataEgressPolicy: networkRuntime.dataEgressPolicy,
        ...(mcpRuntime.executor === undefined
          ? {}
          : {
              externalToolExecutor: mcpRuntime.executor,
              externalToolDescriptors: mcpRuntime.descriptors,
              disposeExternalTools: mcpRuntime.dispose
            }),
        pricingRegistry: agentPricingRegistry,
        projectLockOwnerId,
        pauseAutosave: agentWriteSaveCoordinator.pauseAutosave,
        resumeAutosave: agentWriteSaveCoordinator.resumeAutosave,
        ...(failAgentWriteAt === undefined ? {} : { failAgentWriteAt }),
        createAgentModelDriver: modelRuntime.createAgentModelDriver,
        releasePromptCacheScope: () =>
          modelRuntime.releasePromptCacheScope(
            agentContextScopeKey({
              kind: "workspace",
              workspaceKind: binding.kind,
              workspaceId: binding.workspaceId
            })
          ),
        ...(binding.kind !== "creativeProject"
          ? {}
          : {
              notifyProjectFilesChanged: async (input) => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (
                  identity === undefined ||
                  identity.projectId !== binding.workspaceId ||
                  identity.workspaceId !== binding.workspaceId
                ) {
                  throw new Error("CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED");
                }
                const refreshed = await creativeProjectFileSession.refresh(identity);
                if (!refreshed.ok) throw new Error(refreshed.error.code);
                await application.notifyProjectSearchSourcesChanged({
                  projectId: binding.workspaceId,
                  reason: input.reason,
                  relativePaths: input.relativePaths
                });
              },
              getCreativeProjectFileTreeSnapshot: () => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                const snapshot = creativeProjectFileSession.getSnapshot();
                return identity?.workspaceId === binding.workspaceId &&
                  snapshot?.workspaceId === binding.workspaceId
                  ? snapshot
                  : undefined;
              },
              reattestCreativeProjectFileTreeSnapshot: async () => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (
                  identity === undefined ||
                  identity.projectId !== binding.workspaceId ||
                  identity.workspaceId !== binding.workspaceId
                ) {
                  return err(
                    createUnifiedError({
                      code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED",
                      category: "ValidationError",
                      message: "The active creative project file session does not match this run.",
                      recoverability: "user-action",
                      suggestedAction: "Reopen the creative project and retry.",
                      traceId: "desktop-agent-creative-project-file-reattest"
                    })
                  );
                }
                return creativeProjectFileSession.refresh(identity);
              },
              readCreativeProjectFile: async (relativePath: string) => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (identity === undefined || identity.workspaceId !== binding.workspaceId) {
                  return err(
                    createUnifiedError({
                      code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED",
                      category: "ValidationError",
                      message: "The active creative project file session does not match this run.",
                      recoverability: "user-action",
                      suggestedAction: "Reopen the creative project and retry.",
                      traceId: "desktop-agent-creative-project-file-reader"
                    })
                  );
                }
                return creativeProjectFileSession.readTextFile({ ...identity, path: relativePath });
              },
              verifyCreativeGeneralActiveResource: async (reference) => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (identity === undefined || identity.workspaceId !== binding.workspaceId) {
                  return err(
                    createUnifiedError({
                      code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED",
                      category: "ValidationError",
                      message: "The active creative project file session does not match this run.",
                      recoverability: "user-action",
                      suggestedAction: "Reopen the creative project and retry.",
                      traceId: "desktop-agent-creative-project-file-proof"
                    })
                  );
                }
                const proofInput = { identity, session: creativeProjectFileSession };
                return reference === null
                  ? creativeGeneralActiveResourceProof.verifyFilesSurface(proofInput)
                  : creativeGeneralActiveResourceProof.verifyReference({
                      ...proofInput,
                      reference
                    });
              }
            }),
        ...(binding.kind === "engineeringWorkspace"
          ? engineeringWorkspaceAccessSession === undefined
            ? {}
            : {
                readEditorBuffer: (refId: string) =>
                  readEngineeringEditorBuffer({
                    registry: engineeringEditorStateRegistry,
                    rootBindingId: engineeringWorkspaceAccessSession.binding.rootBindingId,
                    refId
                  }),
                readEditorState: (relativePath: string) =>
                  readEngineeringEditorState({
                    registry: engineeringEditorStateRegistry,
                    rootBindingId: engineeringWorkspaceAccessSession.binding.rootBindingId,
                    relativePath
                  })
              }
          : {
              readEditorBuffer: (refId: string) =>
                readWritingEditorBuffer({
                  registry: writingEditorStateRegistry,
                  workspaceId: binding.workspaceId,
                  refId
                }),
              readEditorState: (relativePath: string) =>
                readWritingEditorState({
                  registry: writingEditorStateRegistry,
                  workspaceId: binding.workspaceId,
                  relativePath
                })
            }),
        syncSavedEditor: async (relativePath, options) => {
          await syncSavedEditorForPath(activeDesktopApplication, relativePath, options);
        },
        resolveModelProfile: resolveAgentModelProfile,
        resolveModelStartFacts: resolveAgentModelStartFacts
      });
      engineeringRuntimeForRootBinding.current = runtime;
      if (nextApprovalCoordinator !== undefined) {
        approvalCoordinatorByRuntime.set(runtime, nextApprovalCoordinator);
      }
      if (engineeringWorkspaceAccessSession !== undefined) {
        engineeringRootBindingIdByRuntime.set(
          runtime,
          engineeringWorkspaceAccessSession.binding.rootBindingId
        );
      }
      if (engineeringMutationComposition !== undefined) {
        const contentRootBindingId = engineeringMutationRootBinding?.contentRootBindingId;
        if (contentRootBindingId === undefined) throw new Error("Engineering root binding missing");
        engineeringRecoveryGateByRuntime.set(runtime, () =>
          engineeringMutationComposition.recoveryRuntime.startupGate.assertMutationAllowed(
            contentRootBindingId
          )
        );
      }
      return runtime;
    },
    createStandaloneRuntime: async () => {
      const created = await createDesktopStandaloneAgentRuntime({
        userDataRoot,
        createAgentModelDriver: modelRuntime.createAgentModelDriver,
        releasePromptCacheScope: () =>
          modelRuntime.releasePromptCacheScope(
            agentContextScopeKey(STANDALONE_AGENT_CONTEXT_SCOPE)
          ),
        resolveModelProfile: resolveAgentModelProfile,
        resolveModelStartFacts: resolveAgentModelStartFacts
      });
      if (!created.ok) throw new Error(created.error.message);
      return created.value;
    },
    onActiveRuntimeChanged: (active) => {
      engineeringMutationRendererSync.dispose();
      const nextEngineeringEditorRootBindingId =
        active?.scope === "workspace" && active.binding.kind === "engineeringWorkspace"
          ? engineeringRootBindingIdByRuntime.get(active.runtime)
          : undefined;
      if (activeEngineeringEditorRootBindingId !== nextEngineeringEditorRootBindingId) {
        if (activeEngineeringEditorRootBindingId !== undefined) {
          engineeringEditorStateRegistry.clearRootBinding(activeEngineeringEditorRootBindingId);
        }
        activeEngineeringEditorRootBindingId = nextEngineeringEditorRootBindingId;
      }
      replaceActiveApprovalCoordinator(
        active?.scope === "workspace"
          ? approvalCoordinatorByRuntime.get(active.runtime)
          : undefined,
        active?.scope === "standalone"
          ? "standalone_runtime_activated"
          : "workspace_runtime_replaced"
      );
    }
  });
  function scheduleCreativeQualificationExpiry(): void {
    if (creativeQualificationExpiryTimer !== undefined) {
      clearTimeout(creativeQualificationExpiryTimer);
      creativeQualificationExpiryTimer = undefined;
    }
    const expiresAt = creativeQualificationExpiresAt;
    if (expiresAt === undefined) return;
    const expireQualification = (): void => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        creativeQualificationExpiryTimer = setTimeout(
          expireQualification,
          Math.min(remaining, 2_147_483_647)
        );
        creativeQualificationExpiryTimer.unref();
        return;
      }
      creativeQualificationExpiresAt = undefined;
      activeApprovalCoordinator?.revokeAll("qualification_expired");
      agentRuntimeManager.revokeCurrentApprovalCapabilities();
      void agentRuntimeManager.refreshCurrentWorkspace().catch(() => undefined);
    };
    expireQualification();
  }
  const approvalQualificationExpiresAt = hasCurrentMainOwnedApprovalSurfaceQualification(
    approvalSurfaceQualification
  )
    ? Date.parse(approvalSurfaceQualification.expiresAt)
    : undefined;
  if (approvalQualificationExpiresAt !== undefined) {
    const expireQualification = (): void => {
      const remaining = approvalQualificationExpiresAt - Date.now();
      if (remaining > 0) {
        const timer = setTimeout(expireQualification, Math.min(remaining, 2_147_483_647));
        timer.unref();
        return;
      }
      activeApprovalCoordinator?.revokeAll("qualification_expired");
      agentRuntimeManager.revokeCurrentApprovalCapabilities();
      void agentRuntimeManager.refreshCurrentWorkspace().catch(() => undefined);
    };
    expireQualification();
  }
  if (bootstrapped !== undefined) {
    const workspaceId = bootstrapped.workspace.project.projectId;
    const fileSession = await creativeProjectFileSession.activate({
      projectId: workspaceId,
      workspaceId,
      projectRoot: bootstrapped.workspace.projectRoot
    });
    if (!fileSession.ok) {
      agentRuntimeManager.dispose();
      await modelRuntime.dispose();
      await application.shutdown();
      activeDesktopApplication = undefined;
      activeDesktopModelRuntime = undefined;
      throw new Error(fileSession.error.message);
    }
    const initialBinding = await agentRuntimeManager.bindWorkspace({
      kind: "creativeProject",
      workspaceId,
      contentRoot: bootstrapped.workspace.projectRoot,
      stateRoot: bootstrapped.workspace.projectRoot,
      activeChapterId:
        bootstrapped.workspace.activeChapterId ??
        bootstrapped.workspace.chapters[0]?.id ??
        DEFAULT_FIXTURE_CHAPTER_ID
    });
    if (!initialBinding.ok) {
      creativeProjectFileSession.deactivate();
      agentRuntimeManager.dispose();
      await modelRuntime.dispose();
      await application.shutdown();
      activeDesktopApplication = undefined;
      activeDesktopModelRuntime = undefined;
      throw new Error(initialBinding.error.message);
    }
  } else {
    const standalonePrepared = await agentRuntimeManager.prepareStandalone();
    if (!standalonePrepared.ok) {
      process.emitWarning(standalonePrepared.error.message, {
        code: standalonePrepared.error.code,
        detail: "Standalone Agent is disabled; workspace open/create remains available."
      });
    } else {
      const standaloneActivated = await agentRuntimeManager.activateStandalone();
      if (!standaloneActivated.ok) {
        process.emitWarning(standaloneActivated.error.message, {
          code: standaloneActivated.error.code,
          detail: "Standalone Agent is disabled; workspace open/create remains available."
        });
      }
    }
  }
  activeAgentRuntimeManager = agentRuntimeManager;
  const workspaceActivationCoordinator = createWorkspaceActivationCoordinator({
    application,
    runtimeManager: agentRuntimeManager,
    creativeProjectFileSession,
    clearCreativeGeneralActiveResourceProof: () => creativeGeneralActiveResourceProof.clear(),
    reportCleanupFailure: (error) => {
      process.emitWarning(error.message, {
        code: error.code,
        detail: `Workspace cleanup will be retried during shutdown (${error.traceId}).`
      });
    }
  });
  const handlers = createApplicationIpcHandlers(activeDesktopApplication, {
    chooseOpenProjectDirectory: () => chooseProjectDirectory("Open Novel Studio project"),
    chooseCreateProjectDirectory: () => chooseProjectDirectory("Create Novel Studio project"),
    chooseEngineeringDirectory: () => chooseProjectDirectory("Open engineering workspace"),
    chooseProjectTextFile: (workspaceRoot) => chooseProjectTextFile(workspaceRoot),
    workspaceActivationCoordinator,
    modelSecretStore,
    publishAiSuggestionStreamEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:ai:chapter-suggestion-push-event", event);
        }
      }
    },
    agentRuntimeManager,
    workspaceContextPolicyStore,
    creativeProjectFileSession,
    creativeGeneralActiveResourceProof,
    agentWriteSaveCoordinator,
    writingEditorStateRegistry,
    getActiveWritingEditorWorkspaceId: () => {
      const active = agentRuntimeManager.active();
      return active?.scope === "workspace" && active.binding.kind === "creativeProject"
        ? active.binding.workspaceId
        : undefined;
    },
    engineeringEditorStateRegistry,
    getActiveEngineeringEditorRootBindingId: () => activeEngineeringEditorRootBindingId,
    assertEngineeringRecoveryAllowed: async () => {
      const active = agentRuntimeManager.active();
      if (active?.scope !== "workspace" || active.binding.kind !== "engineeringWorkspace") {
        return ok(undefined);
      }
      const assertAllowed = engineeringRecoveryGateByRuntime.get(active.runtime);
      if (assertAllowed === undefined) {
        return err(
          createUnifiedError({
            code: "ENGINEERING_RECOVERY_GATE_UNAVAILABLE",
            category: "StorageError",
            message: "Engineering recovery has not completed for this workspace.",
            recoverability: "user-action",
            suggestedAction: "Keep engineering writes and lifecycle changes disabled.",
            traceId: "desktop-engineering-recovery-gate-main"
          })
        );
      }
      return assertAllowed();
    },
    engineeringMutationRendererSync,
    agentNetworkSettingsSession,
    agentMcpSettingsSession,
    onAgentSettingsChanged: async () => {
      // The durable setting has already changed. Revoke Main-owned network/MCP access before any
      // asynchronous stop/list/refresh work so the prior frozen runtime cannot dispatch again.
      agentRuntimeManager.revokeCurrentSettingsCapabilities();
      const refreshed = await agentRuntimeManager.refreshCurrentWorkspace();
      return refreshed;
    },
    publishAgentRunEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:agent-run:event", event);
        }
      }
    },
    publishStoryAnalysisCompletionEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:story-analysis:completion", event);
        }
      }
    }
  });

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: readonly unknown[]) => handler(...args));
  }
}

async function verifyEngineeringPreparedAuthorization(
  ledger: ApprovalAuthorizationLedger,
  prepared: EngineeringWriteTransactionPreparedV2,
  expectedState: "reserved" | "consumed"
): Promise<Result<void, UnifiedError>> {
  const queried = await ledger.query(
    prepared.authorization.authorizationId,
    prepared.transactionId
  );
  if (!queried.ok) return queried;
  const record = queried.value;
  let bindingChecksum: string;
  let sideEffectSubjectChecksum: string;
  try {
    bindingChecksum = approvalBindingV2Checksum(record.binding);
    sideEffectSubjectChecksum = engineeringSideEffectSubjectChecksumV2({
      transactionId: prepared.transactionId,
      contentRootBindingId: prepared.contentRootBindingId,
      providerSemanticVersionSetChecksum: prepared.providerSemanticVersionSetChecksum,
      operations: prepared.operations
    });
  } catch {
    return err(
      engineeringMutationAuthorityError("ENGINEERING_MUTATION_AUTHORIZATION_BINDING_INVALID")
    );
  }
  return record.state === expectedState &&
    record.reservedTransactionId === prepared.transactionId &&
    record.providerSemanticVersionSetChecksum === prepared.providerSemanticVersionSetChecksum &&
    record.binding.bindingId === prepared.authorization.approvalBindingId &&
    record.binding.rootBindingId === prepared.contentRootBindingId &&
    record.binding.changeSetId === prepared.authorization.changeSetId &&
    record.binding.changeSetRevision === prepared.authorization.changeSetRevision &&
    record.binding.changeSetChecksum === prepared.authorization.changeSetChecksum &&
    bindingChecksum === prepared.authorization.approvalBindingChecksum &&
    sideEffectSubjectChecksum === prepared.authorization.sideEffectSubjectChecksum
    ? ok(undefined)
    : err(engineeringMutationAuthorityError("ENGINEERING_MUTATION_AUTHORIZATION_BINDING_STALE"));
}

export async function verifyEngineeringPreparedLifecycleAuthorization(
  ledger: ApprovalAuthorizationLedger,
  prepared: EngineeringLifecycleWriteTransactionInputV2,
  acceptableStates: readonly ("reserved" | "consumed")[] = ["reserved"]
): Promise<Result<void, UnifiedError>> {
  const queried = await ledger.query(
    prepared.authorization.authorizationId,
    prepared.transactionId
  );
  if (!queried.ok) return queried;
  const record = queried.value;
  let bindingChecksum: string;
  let sideEffectSubjectChecksum: string;
  try {
    bindingChecksum = approvalBindingV2Checksum(record.binding);
    sideEffectSubjectChecksum = engineeringLifecycleSideEffectSubjectChecksumV2({
      transactionId: prepared.transactionId,
      contentRootBindingId: prepared.contentRootBindingId,
      providerSemanticVersionSetChecksum: prepared.providerSemanticVersionSetChecksum,
      operations: prepared.operations.map((operation) => operation.request)
    });
  } catch {
    return err(
      engineeringMutationAuthorityError("ENGINEERING_MUTATION_AUTHORIZATION_BINDING_INVALID")
    );
  }
  const stateAccepted =
    (record.state === "reserved" || record.state === "consumed") &&
    acceptableStates.includes(record.state);
  return stateAccepted &&
    record.reservedTransactionId === prepared.transactionId &&
    record.providerSemanticVersionSetChecksum === prepared.providerSemanticVersionSetChecksum &&
    record.binding.bindingId === prepared.authorization.approvalBindingId &&
    record.binding.rootBindingId === prepared.contentRootBindingId &&
    record.binding.changeSetId === prepared.authorization.changeSetId &&
    record.binding.changeSetRevision === prepared.authorization.changeSetRevision &&
    record.binding.changeSetChecksum === prepared.authorization.changeSetChecksum &&
    bindingChecksum === prepared.authorization.approvalBindingChecksum &&
    sideEffectSubjectChecksum === prepared.authorization.sideEffectSubjectChecksum
    ? ok(undefined)
    : err(engineeringMutationAuthorityError("ENGINEERING_MUTATION_AUTHORIZATION_BINDING_STALE"));
}

async function validateEngineeringStagingReservation(input: {
  readonly prepared: EngineeringWriteTransactionPreparedV2;
  readonly operation: EngineeringFileMutationRequestV2;
}): Promise<Result<void, UnifiedError>> {
  const stagingIds = input.prepared.operations.map((operation) => operation.stagingObjectId);
  const matchingOperations = input.prepared.operations.filter(
    (operation) =>
      operation.operationId === input.operation.operationId &&
      canonicalizeEngineeringMutationV2Json(operation) ===
        canonicalizeEngineeringMutationV2Json(input.operation)
  );
  return new Set(stagingIds).size === stagingIds.length && matchingOperations.length === 1
    ? ok(undefined)
    : err(engineeringMutationAuthorityError("ENGINEERING_MUTATION_STAGING_RESERVATION_STALE"));
}

function engineeringMutationAuthorityError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: "Engineering mutation authority is unavailable or stale.",
    recoverability: "user-action",
    suggestedAction: "Keep Engineering mutation disabled and reopen the qualified workspace.",
    traceId: "desktop-engineering-mutation-authority-v2"
  });
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function resolveDesktopAgentModelProfile(
  application: DesktopApplication | undefined,
  profileId: string,
  modelNameOverride?: string
) {
  const profiles = await application?.listModelProfiles();
  if (profiles === undefined || !profiles.ok) return undefined;
  const profile = profiles.value.profiles.find((entry) => entry.id === profileId);
  if (profile === undefined) return undefined;
  const selectedModelName = modelNameOverride ?? profile.modelName;
  const discovery = await application?.discoverModelOptions(profileId);
  const reasoningStrength =
    discovery !== undefined && discovery.ok
      ? (discovery.value.models.find((model) => model.id === selectedModelName)
          ?.reasoningStrength ??
        (selectedModelName === profile.modelName
          ? discovery.value.reasoningStrength
          : reasoningStrengthForModel(
              profile.provider,
              selectedModelName,
              profile.baseUrl,
              profile.reasoningEffortEnabled
            )))
      : undefined;
  const modelProfile: LlmModelProfile = {
    id: profile.id,
    provider: profile.provider as LlmProviderId,
    displayName: profile.displayName,
    modelName: selectedModelName,
    ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
    ...(profile.apiKeyRef.length === 0 ? {} : { apiKeyRef: profile.apiKeyRef }),
    timeoutMs: profile.timeoutMs,
    ...(profile.reasoningEffortEnabled === true ? { reasoningEffortEnabled: true } : {}),
    ...(reasoningStrength === undefined
      ? {}
      : {
          reasoningCapability:
            reasoningStrength.status === "available"
              ? {
                  providerParamName: reasoningStrength.providerParamName,
                  allowedValues: reasoningStrength.allowedValues,
                  defaultValue: reasoningStrength.defaultValue
                }
              : null
        })
  };
  return {
    modelProfile,
    parameters: {
      temperature: profile.temperature,
      ...(profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens }),
      ...(profile.topP === undefined ? {} : { topP: profile.topP })
    }
  };
}

async function resolveDesktopAgentModelStartFacts(
  application: DesktopApplication | undefined,
  modelSecretStore: ModelSecretStore,
  profileId: string,
  modelNameOverride?: string
) {
  const profiles = await application?.listModelProfiles();
  if (profiles === undefined || !profiles.ok) return undefined;
  const profile = profiles.value.profiles.find((entry) => entry.id === profileId);
  if (profile === undefined) return undefined;
  const selectedModelName = modelNameOverride?.trim() || profile.modelName;
  const storedSecret =
    profile.apiKeyRef.trim().length === 0
      ? ({ ok: true as const, value: undefined } as const)
      : await modelSecretStore.readSecret(profile.apiKeyRef);
  if (
    profile.provider === "demo" ||
    profile.apiKeyRef.trim().length === 0 ||
    (storedSecret.ok && storedSecret.value === undefined)
  ) {
    const connectionIdentityChecksum = agentModelConnectionIdentityChecksum({
      profileId: profile.id,
      provider: "demo",
      modelName: "desktop-scripted-agent",
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      apiKeyRef: profile.apiKeyRef
    });
    return {
      profileId: profile.id,
      provider: "demo",
      modelName: "desktop-scripted-agent",
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128_000
      },
      requiredContextTokens: 8_000,
      reasoningStrength: reasoningStrengthForModel("demo", "desktop-scripted-agent"),
      connectionIdentityChecksum,
      accountIsolationChecksum: createHash("sha256")
        .update(`demo-account\u0000${profile.id}`, "utf8")
        .digest("hex")
    };
  }

  const discovery = await application?.discoverModelOptions(profileId);
  const discovered =
    discovery !== undefined && discovery.ok
      ? discovery.value.models.find((model) => model.id === selectedModelName)
      : undefined;
  const catalogCapabilities = resolveCatalogAgentModelCapabilities(
    profile.provider,
    selectedModelName
  );
  const contextWindow =
    discovered?.contextWindow !== undefined && discovered.contextWindow > 0
      ? discovered.contextWindow
      : selectedModelName === profile.modelName &&
          profile.contextWindow !== undefined &&
          profile.contextWindow > 0
        ? profile.contextWindow
        : catalogCapabilities?.contextWindow;
  const streaming = discovered?.streaming ?? catalogCapabilities?.streaming;
  const toolCalling = discovered?.toolCalling ?? catalogCapabilities?.toolCalling;
  const structuredArguments =
    discovered?.structuredArguments ?? catalogCapabilities?.structuredArguments;
  const reasoningStrength =
    discovered?.reasoningStrength ??
    (selectedModelName === profile.modelName && discovery !== undefined && discovery.ok
      ? discovery.value.reasoningStrength
      : reasoningStrengthForModel(
          profile.provider,
          selectedModelName,
          profile.baseUrl,
          profile.reasoningEffortEnabled
        ));
  return {
    profileId: profile.id,
    provider: profile.provider,
    modelName: selectedModelName,
    capabilities: {
      ...(streaming === undefined ? {} : { streaming }),
      ...(toolCalling === undefined ? {} : { toolCalling }),
      ...(structuredArguments === undefined ? {} : { structuredArguments }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      promptCache:
        storedSecret.ok && storedSecret.value !== undefined
          ? resolveAgentPromptCacheCapability({
              provider: profile.provider,
              modelName: selectedModelName,
              ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
              preference: profile.promptCachePreference ?? "auto"
            })
          : NO_AGENT_PROMPT_CACHE_CAPABILITY
    },
    requiredContextTokens: 8_000,
    reasoningStrength,
    connectionIdentityChecksum: agentModelConnectionIdentityChecksum({
      profileId: profile.id,
      provider: profile.provider,
      modelName: selectedModelName,
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      apiKeyRef: profile.apiKeyRef
    }),
    accountIsolationChecksum: createHash("sha256")
      .update(
        storedSecret.ok && storedSecret.value !== undefined
          ? `provider-account\u0000${profile.provider}\u0000${storedSecret.value}`
          : `provider-account-unavailable\u0000${profile.id}`,
        "utf8"
      )
      .digest("hex")
  };
}

function agentModelConnectionIdentityChecksum(input: {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly baseUrl?: string;
  readonly apiKeyRef: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profileId: input.profileId,
        provider: input.provider.trim().toLowerCase(),
        modelName: input.modelName,
        baseUrl: (input.baseUrl ?? "").trim().replace(/\/+$/u, ""),
        apiKeyRef: input.apiKeyRef
      }),
      "utf8"
    )
    .digest("hex");
}

async function resolveDesktopNetworkRuntime(input: {
  readonly settingsSession: AgentNetworkSettingsSession;
  readonly settingsPort: AgentNetworkSettingsPort;
  readonly modelSecretStore: ModelSecretStore;
}): Promise<{
  readonly executor?: AgentNetworkToolExecutor;
  readonly policyRevision: string;
  readonly dataEgressPolicy: AgentNetworkPolicy["dataEgressPolicy"];
}> {
  const settings = await input.settingsSession.getNetworkSettings();
  if (!settings.ok || !settings.value.enabled || settings.value.allowedHosts.length === 0) {
    return {
      policyRevision: settings.ok ? settings.value.policyRevision : "unavailable",
      dataEgressPolicy: settings.ok ? settings.value.dataEgressPolicy : "require_confirmation"
    };
  }

  const secrets = new Map<string, string>();
  await Promise.all(
    [...new Set(settings.value.providerProfiles.map((profile) => profile.apiKeyRef))].map(
      async (secretRef) => {
        const secret = await input.modelSecretStore.readSecret(secretRef);
        if (secret.ok && secret.value !== undefined) secrets.set(secretRef, secret.value);
      }
    )
  );
  const created = await createDesktopNetworkToolExecutor({
    settingsPort: input.settingsPort,
    resolveSecret: (secretRef) => secrets.get(secretRef)
  });
  return {
    ...(created.ok ? { executor: created.value } : {}),
    policyRevision: settings.value.policyRevision,
    dataEgressPolicy: settings.value.dataEgressPolicy
  };
}

interface DesktopMcpRuntime {
  readonly settingsRevision: string;
  readonly executor?: AgentExternalToolExecutor;
  readonly descriptors?: readonly AgentToolDescriptor[];
  readonly dispose?: () => void;
}

async function resolveDesktopMcpRuntime(input: {
  readonly settingsSession: McpSettingsSession;
  readonly networkSettingsSession: AgentNetworkSettingsSession;
  readonly modelSecretStore: ModelSecretStore;
}): Promise<DesktopMcpRuntime> {
  const [settings, policy] = await Promise.all([
    input.settingsSession.getMcpSettings(),
    input.networkSettingsSession.getEffectivePolicy()
  ]);
  const settingsRevision = settings.ok ? settings.value.revision : "unavailable";
  if (!settings.ok || !policy.ok || !policy.value.enabled) return { settingsRevision };
  const remoteServers = settings.value.servers.filter(isEnabledRemoteMcpServer);
  if (remoteServers.length === 0) return { settingsRevision };

  const secrets = await resolveMcpSecrets(remoteServers, input.modelSecretStore);
  const attempts = await Promise.all(
    remoteServers.map(async (config) =>
      connectRemoteMcp({
        config,
        policy: policy.value,
        resolveApiKey: (secretRef) => secrets.get(secretRef),
        configRevision: settings.value.revision,
        readCurrentConfig: async () =>
          readCurrentRemoteMcpConfig(input.settingsSession, config.serverId)
      })
    )
  );
  const connections = attempts.filter(
    (attempt): attempt is Extract<(typeof attempts)[number], { readonly ok: true }> => attempt.ok
  );
  if (connections.length === 0) return { settingsRevision };

  const advertisedTools = connections.flatMap((connection) => connection.value.tools);
  if (advertisedTools.length > MAX_EXTERNAL_TOOL_DESCRIPTORS) {
    for (const connection of connections) connection.value.close();
    return { settingsRevision };
  }
  const descriptors = createRemoteMcpAgentDescriptors(advertisedTools);
  const valid = validateExternalToolDescriptors(descriptors);
  if (!valid.ok) {
    for (const connection of connections) connection.value.close();
    return { settingsRevision };
  }

  const dispatches = new Map(
    connections.map((connection) => [
      connection.value.serverId,
      createRemoteMcpDispatch(connection.value)
    ])
  );
  const executor = createAgentExternalToolSession({
    dispatch: {
      async callTool(call) {
        const currentPolicy = await input.networkSettingsSession.getEffectivePolicy();
        if (
          !currentPolicy.ok ||
          !currentPolicy.value.enabled ||
          currentPolicy.value.revision !== policy.value.revision
        ) {
          return {
            status: "error" as const,
            error: mcpRuntimeError(
              "MCP_NETWORK_POLICY_CHANGED",
              "Network access changed after this MCP runtime was created."
            )
          };
        }
        const serverId = remoteServerIdForCanonicalTool(call.canonicalToolId);
        const dispatch = serverId === undefined ? undefined : dispatches.get(serverId);
        if (dispatch === undefined) {
          return {
            status: "error" as const,
            error: mcpRuntimeError(
              "MCP_TOOL_NOT_CONFIGURED",
              "The requested remote MCP tool is not part of this trusted runtime snapshot."
            )
          };
        }
        return dispatch.callTool(call);
      }
    }
  });
  return {
    settingsRevision,
    executor,
    descriptors,
    dispose: () => {
      for (const connection of connections) connection.value.close();
    }
  };
}

async function testDesktopRemoteMcpConnection(input: {
  readonly config: McpServerConfig;
  readonly networkSettingsSession: AgentNetworkSettingsSession;
  readonly readMcpSettings: () => Promise<Result<McpSettingsData, UnifiedError>>;
  readonly modelSecretStore: ModelSecretStore;
}): Promise<Result<{ readonly latencyMs: number }, UnifiedError>> {
  if (!isEnabledRemoteMcpServer(input.config)) {
    return err(
      mcpRuntimeError(
        "MCP_TEST_UNAVAILABLE",
        "Only enabled remote HTTP MCP servers can be tested in this build."
      )
    );
  }
  const [policy, settings] = await Promise.all([
    input.networkSettingsSession.getEffectivePolicy(),
    input.readMcpSettings()
  ]);
  if (!policy.ok) return policy;
  if (!settings.ok) return settings;
  const current = settings.value.servers.find(
    (server) => server.serverId === input.config.serverId
  );
  if (!isEnabledRemoteMcpServer(current)) {
    return err(
      mcpRuntimeError("MCP_CONFIG_CHANGED", "The MCP server configuration is no longer current.")
    );
  }
  const secrets = await resolveMcpSecrets([current], input.modelSecretStore);
  const startedAt = Date.now();
  const connected = await connectRemoteMcp({
    config: current,
    policy: policy.value,
    resolveApiKey: (secretRef) => secrets.get(secretRef),
    configRevision: settings.value.revision,
    readCurrentConfig: async () =>
      readCurrentRemoteMcpConfigFromPort(input.readMcpSettings, current.serverId)
  });
  if (!connected.ok) return connected;
  connected.value.close();
  return ok({ latencyMs: Date.now() - startedAt });
}

function isEnabledRemoteMcpServer(
  config: McpServerConfig | undefined
): config is Extract<McpServerConfig, { readonly transport: "remote_http" }> {
  return config?.transport === "remote_http" && config.enabled;
}

async function resolveMcpSecrets(
  configs: readonly Extract<McpServerConfig, { readonly transport: "remote_http" }>[],
  store: ModelSecretStore
): Promise<Map<string, string>> {
  const secrets = new Map<string, string>();
  await Promise.all(
    [...new Set(configs.map((config) => config.apiKeyRef).filter((value) => value.length > 0))].map(
      async (secretRef) => {
        const secret = await store.readSecret(secretRef);
        if (secret.ok && secret.value !== undefined) secrets.set(secretRef, secret.value);
      }
    )
  );
  return secrets;
}

async function readCurrentRemoteMcpConfig(
  settingsSession: McpSettingsSession,
  serverId: string
): Promise<
  Result<{ readonly revision: string; readonly config: McpServerConfig | undefined }, UnifiedError>
> {
  return readCurrentRemoteMcpConfigFromPort(() => settingsSession.getMcpSettings(), serverId);
}

async function readCurrentRemoteMcpConfigFromPort(
  readSettings: () => Promise<Result<McpSettingsData, UnifiedError>>,
  serverId: string
): Promise<
  Result<{ readonly revision: string; readonly config: McpServerConfig | undefined }, UnifiedError>
> {
  const current = await readSettings();
  if (!current.ok) return current;
  return ok({
    revision: current.value.revision,
    config: current.value.servers.find((server) => server.serverId === serverId)
  });
}

function createRemoteMcpAgentDescriptors(
  tools: readonly {
    readonly canonicalId: string;
    readonly serverId: string;
    readonly displayName: string;
    readonly description: string;
    readonly inputSchema: JsonObject;
    readonly effect: "external_action";
    readonly retrySemantics: "never_automatic";
  }[]
): readonly AgentToolDescriptor[] {
  const providerNames = new Set<string>();
  const descriptors: AgentToolDescriptor[] = [];
  for (const tool of [...tools].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  )) {
    if (!isCanonicalRemoteMcpToolId(tool.canonicalId)) continue;
    const canonicalId = tool.canonicalId as NonNullable<AgentToolDescriptor["id"]>;
    const providerName = uniqueMcpProviderName(tool.canonicalId, providerNames);
    const inputSchema = cloneJsonObject(tool.inputSchema);
    const source = Object.freeze({ kind: "mcp" as const, id: tool.serverId });
    const base: Omit<AgentToolDescriptor, "descriptorDigest"> = {
      id: canonicalId,
      name: providerName,
      providerName,
      displayName: tool.displayName,
      description: tool.description,
      kind: "external_tool",
      effect: tool.effect,
      dataEgress: "remote_tool_arguments",
      destructive: false,
      retrySemantics: tool.retrySemantics,
      source,
      inputSchema
    };
    const descriptor: AgentToolDescriptor = Object.freeze({
      ...base,
      source,
      inputSchema: deepFreezeJson(inputSchema),
      descriptorDigest: computeAgentToolDescriptorDigest(base)
    });
    descriptors.push(descriptor);
  }
  return Object.freeze(descriptors);
}

function uniqueMcpProviderName(canonicalId: string, used: Set<string>): string {
  const initial = mangleToolId(canonicalId);
  if (!used.has(initial)) {
    used.add(initial);
    return initial;
  }
  const digest = createHash("sha256").update(canonicalId, "utf8").digest("hex").slice(0, 10);
  const prefix = initial.slice(0, Math.max(1, 64 - digest.length - 1));
  const candidate = `${prefix}_${digest}`;
  if (used.has(candidate)) {
    throw new Error("Remote MCP provider tool names collided after digest mangling.");
  }
  used.add(candidate);
  return candidate;
}

function isCanonicalRemoteMcpToolId(value: string): boolean {
  return /^mcp:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function remoteServerIdForCanonicalTool(canonicalToolId: string): string | undefined {
  const match = /^mcp:([A-Za-z0-9][A-Za-z0-9._-]{0,63})\//u.exec(canonicalToolId);
  return match?.[1];
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
  return Object.freeze(value);
}

function mcpRuntimeError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the remote MCP and network settings.",
    traceId: "desktop-remote-mcp-runtime"
  });
}

async function readWritingEditorState(input: {
  readonly registry: WritingEditorStateRegistry;
  readonly workspaceId: string;
  readonly relativePath: string;
}) {
  const target = writingEditorIdentityForPath(input.workspaceId, input.relativePath);
  if (target === undefined) return undefined;
  return input.registry.readForMutation(target);
}

async function readWritingEditorBuffer(input: {
  readonly registry: WritingEditorStateRegistry;
  readonly workspaceId: string;
  readonly refId: string;
}): Promise<{ readonly content: string; readonly sourceRevision: number } | undefined> {
  const target = writingEditorIdentityForBufferRef(input.workspaceId, input.refId);
  if (target === undefined) return undefined;
  const observation = input.registry.observe(target);
  return observation.status === "connected" && observation.state.dirty
    ? {
        content: observation.state.bufferContent,
        sourceRevision: observation.state.rendererRevision
      }
    : undefined;
}

/**
 * Reads an engineering draft only from a live, acknowledged, explicitly shared editor state.
 * The native root binding is Main-owned; neither a pathname nor a workspace ID can select it.
 */
async function readEngineeringEditorBuffer(input: {
  readonly registry: EngineeringEditorStateRegistry;
  readonly rootBindingId: string;
  readonly refId: string;
}): Promise<{ readonly content: string; readonly sourceRevision: number } | undefined> {
  const relativePath = engineeringRelativePathForBufferRef(input.refId);
  if (relativePath === undefined) return undefined;
  const shared = input.registry.readForExplicitShare({
    rootBindingId: input.rootBindingId,
    relativePath
  });
  return shared.status === "available"
    ? { content: shared.bufferContent, sourceRevision: shared.rendererRevision }
    : undefined;
}

/**
 * A missing editor is neutral for a read-only context. A reported unknown/ack-pending editor is
 * not: callers receive an explicit unknown state and must fail closed before using stale disk.
 */
async function readEngineeringEditorState(input: {
  readonly registry: EngineeringEditorStateRegistry;
  readonly rootBindingId: string;
  readonly relativePath: string;
}): Promise<
  | {
      readonly status: "known" | "unknown";
      readonly dirty: boolean;
      readonly content: string;
      readonly rendererRevision?: number;
    }
  | undefined
> {
  const target = { rootBindingId: input.rootBindingId, relativePath: input.relativePath };
  const observation = input.registry.observe(target);
  if (observation.status === "unknown") {
    return observation.reason === "missing"
      ? undefined
      : { status: "unknown", dirty: false, content: "" };
  }
  if (observation.status === "disconnected") {
    return { status: "unknown", dirty: false, content: "" };
  }
  if (!observation.state.dirty) {
    return {
      status: "known",
      dirty: false,
      content: "",
      rendererRevision: observation.state.rendererRevision
    };
  }
  const shared = input.registry.readForExplicitShare(target);
  return shared.status === "available"
    ? {
        status: "known",
        dirty: true,
        content: shared.bufferContent,
        rendererRevision: shared.rendererRevision
      }
    : { status: "unknown", dirty: false, content: "" };
}

function engineeringRelativePathForBufferRef(refId: string): string | undefined {
  const prefix = "editor_buffer:engineering:";
  const relativePath = refId.startsWith(prefix) ? refId.slice(prefix.length) : undefined;
  return relativePath === undefined || relativePath.length === 0 ? undefined : relativePath;
}

function writingEditorIdentityForBufferRef(
  workspaceId: string,
  refId: string
): WritingEditorResourceIdentity | undefined {
  const match = /^editor_buffer:(chapter|story_bible):(.+)$/u.exec(refId);
  const resourceKind = match?.[1];
  const resourceId = match?.[2];
  if (
    (resourceKind !== "chapter" && resourceKind !== "story_bible") ||
    resourceId === undefined ||
    resourceId.trim().length === 0
  ) {
    return undefined;
  }
  return { workspaceId, resourceKind, resourceId };
}

function writingEditorIdentityForPath(
  workspaceId: string,
  relativePath: string
): WritingEditorResourceIdentity | undefined {
  const chapter = /^chapters\/([A-Za-z0-9_-]+)\.md$/u.exec(relativePath)?.[1];
  if (chapter !== undefined) {
    return { workspaceId, resourceKind: "chapter", resourceId: chapter };
  }
  if (relativePath === "outline/outline.json") {
    return { workspaceId, resourceKind: "story_bible", resourceId: "outline_main" };
  }
  if (relativePath === "timeline/events.json") {
    return { workspaceId, resourceKind: "story_bible", resourceId: "timeline_main" };
  }
  const storyBible = /^(?:characters|world|foreshadows)\/([A-Za-z0-9_-]+)\.json$/u.exec(
    relativePath
  )?.[1];
  return storyBible === undefined
    ? undefined
    : { workspaceId, resourceKind: "story_bible", resourceId: storyBible };
}

export async function syncSavedEditorForPath(
  application: Pick<DesktopApplication, "readActiveChapterState" | "loadActiveChapter"> | undefined,
  relativePath: string,
  options: { readonly expectedDirtyChecksum?: string } = {}
): Promise<void> {
  const match = /^chapters\/([A-Za-z0-9_-]+)\.md$/.exec(relativePath);
  if (application === undefined || match?.[1] === undefined) return;

  const activeChapter = await application.readActiveChapterState();
  if (activeChapter.ok && activeChapter.value.state.chapter.frontmatter.id === match[1]) {
    if (activeChapter.value.state.dirty) {
      if (options.expectedDirtyChecksum === undefined) {
        throw createUnifiedError({
          code: "AGENT_WRITE_EDITOR_SYNC_DIRTY",
          category: "UserError",
          message: "The active editor changed while Agent changes were being applied.",
          recoverability: "user-action",
          suggestedAction: "Review the preserved editor buffer and transaction recovery status.",
          traceId: "desktop-agent-editor-sync"
        });
      }
      const actualDirtyChecksum = createHash("sha256")
        .update(activeChapter.value.state.chapter.body, "utf8")
        .digest("hex");
      if (actualDirtyChecksum !== options.expectedDirtyChecksum) {
        throw createUnifiedError({
          code: "AGENT_WRITE_EDITOR_SYNC_STALE",
          category: "UserError",
          message: "The active editor changed while Agent changes were being applied.",
          recoverability: "user-action",
          suggestedAction: "Review the preserved editor buffer and transaction recovery status.",
          traceId: "desktop-agent-editor-sync"
        });
      }
    }
    await application.loadActiveChapter();
  }
}

export async function shutdownDesktopApplication(): Promise<void> {
  replaceActiveApprovalCoordinator(undefined, "application_shutdown");
  activeAgentRuntimeManager?.dispose();
  activeAgentRuntimeManager = undefined;
  const modelRuntime = activeDesktopModelRuntime;
  activeDesktopModelRuntime = undefined;
  await modelRuntime?.dispose();
  const application = activeDesktopApplication;
  activeDesktopApplication = undefined;
  if (application !== undefined) {
    await application.shutdown();
  }
}

function createApprovalModalWindow(
  options: TrustedApprovalModalWindowOptions
): ApprovalModalWindowLike {
  const parent = activeMainWindow;
  if (parent === undefined || parent.isDestroyed() || options.parent !== parent) {
    throw new Error("The active Main window changed before approval modal creation.");
  }
  const browserWindowOptions: BrowserWindowConstructorOptions = {
    parent,
    modal: options.modal,
    show: options.show,
    width: options.width,
    height: options.height,
    resizable: options.resizable,
    minimizable: options.minimizable,
    maximizable: options.maximizable,
    autoHideMenuBar: options.autoHideMenuBar,
    title: options.title,
    webPreferences: options.webPreferences
  };
  return new BrowserWindow(browserWindowOptions);
}

async function chooseProjectDirectory(title: string): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseProjectTextFile(workspaceRoot: string): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "Add project file to Agent context",
    defaultPath: workspaceRoot,
    properties: ["openFile"],
    filters: [
      {
        name: "Text and source files",
        extensions: [
          "md",
          "mdx",
          "txt",
          "json",
          "jsonc",
          "yaml",
          "yml",
          "toml",
          "ts",
          "tsx",
          "js",
          "jsx",
          "css",
          "scss",
          "html",
          "xml",
          "py",
          "rs",
          "go",
          "java",
          "c",
          "h",
          "cpp",
          "hpp",
          "cs",
          "sh",
          "ps1"
        ]
      },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

export function createMainWindow(): BrowserWindow {
  if (activeMainWindow !== undefined && !activeMainWindow.isDestroyed()) {
    return activeMainWindow;
  }
  const preloadPath = join(currentDirectory, "..", "preload", "index.cjs");
  const rendererPath = join(currentDirectory, "..", "renderer", "index.html");

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 720,
    minHeight: 640,
    title: "Novel Studio",
    webPreferences: createSecureWebPreferences(preloadPath)
  });

  activeMainWindow = window;
  bindApprovalParentWindowFailClosedLifecycle(window, () => activeApprovalCoordinator);
  window.once("closed", () => {
    if (activeMainWindow !== window) return;
    activeMainWindow = undefined;
    activeApprovalCoordinator?.revokeAll("main_window_closed");
  });

  void window.loadFile(rendererPath);

  return window;
}

export function setApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate({
        onCommand: (commandId) => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          if (window !== undefined && !window.isDestroyed()) {
            window.webContents.send("application:menu:native-command", commandId);
          }
        }
      })
    )
  );
}

if (process.env["VITEST"] !== "true") {
  void app.whenReady().then(async () => {
    await registerApplicationIpcHandlers();
    setApplicationMenu();
    createMainWindow();
  });

  app.on("activate", () => {
    createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (shutdownInProgress) {
      return;
    }

    if (activeDesktopApplication === undefined) {
      replaceActiveApprovalCoordinator(undefined, "application_shutdown");
      return;
    }

    event.preventDefault();
    shutdownInProgress = true;
    void shutdownDesktopApplication().finally(() => {
      app.quit();
    });
  });
}
