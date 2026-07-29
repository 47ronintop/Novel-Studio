import {
  createAgentConversationSession,
  createAgentContextSession,
  createAgentFileOperationSession,
  createAgentPricingRegistry,
  createAgentPermissionSession,
  createAgentPlanExecutionSession,
  createAgentRunDraftSession,
  createAgentSearchToolSession,
  freezeProviderNameMapping,
  createAgentRunSession,
  createAgentUsageSession,
  createChangeSetSession,
  createWorkspaceOutlineSource,
  createVersionGroupSession,
  DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT,
  DEFAULT_WORKSPACE_OUTLINE_LIMITS,
  buildAgentSystemPrompt,
  materializeAgentConversationContext,
  materializeAgentPrompt,
  AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION,
  preflightAgentModelCapabilities,
  readResolvedContextBudgetUsageLimits,
  resolveBudgetInputs as resolveCanonicalBudgetInputs,
  resolveAgentContextProfile,
  workspaceOutlineDependencyRevisionChecksum,
  type AgentContextBudgetInputs,
  type AgentContextBudgetInputsPort,
  type AgentContextSession,
  type CompactionModelAssistantPort,
  type AgentPermissionSession,
  type AgentPlanExecutionSession,
  type AgentModelRoundInput,
  type AgentModelMessage,
  type AgentModelStreamEvent,
  type AgentConversationLifecyclePort,
  type AgentConversationPersistencePort,
  type AgentConversationSession,
  type AgentReadToolExecutor,
  type AgentSearchToolExecutor,
  type AgentNetworkToolExecutor,
  type AgentNetworkPolicy,
  type AgentExternalToolExecutor,
  type AgentFileOperationSessionPort,
  type AgentRunModelDriver,
  type AgentRunSession,
  type AgentRunStartFacts,
  type AgentRunStartModelFacts,
  type AgentRunStartPreflightPort,
  type AgentPricingRegistry,
  type AgentUsageTimeFacts,
  type AgentUsageSession,
  type AgentVersionGroupExecutor,
  type ProjectConventionsReader,
  type WorkspaceOutlineDependencyManifest,
  type WorkspaceOutlineReader,
  type WorkspaceProjectContextIdentity,
  type WorkspaceProjectContextProfileId,
  type WorkspaceProjectContextResolution,
  type VersionGroupSessionTransactionPort,
  type VersionGroupTransactionApplyInput
} from "@novel-studio/application";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createDesktopCompactionSources } from "./agent-compaction-composer.js";
import { createDesktopProjectConventionsReader } from "./project-conventions-reader.js";
import { createDesktopWorkspaceOutlineReader } from "./workspace-outline-reader.js";
import { createDesktopCreativeProjectFileReceiptStore } from "./creative-project-file-receipt-store.js";
import { DEFAULT_AGENT_FEATURE_FLAGS, type AgentFeatureFlags } from "./agent-feature-flags.js";
import type { LlmModelProfile, LlmParameters } from "@novel-studio/llm-adapter";
import type {
  AgentContextSourceIdentity,
  AgentContextSourceInput,
  AgentContextMode,
  ContextDraftRef,
  AgentRunSnapshot,
  AgentUsageRecord,
  AgentToolCapabilitySnapshot,
  AgentToolDescriptor,
  AgentWriteMutationTrust,
  ChangeSet,
  StartAgentRunCommand,
  VersionGroup
} from "@novel-studio/agent-engine";
import {
  agentContextScopeKey,
  computeAgentRunToolCatalogRevision,
  createDeterministicTokenEstimator,
  createEffectiveCapabilityState,
  freezeAgentToolCapabilitySnapshot,
  listAgentTools,
  normalizeAgentRunSnapshot,
  revokeCapability,
  type EffectiveCapabilityState
} from "@novel-studio/agent-engine";
import type { AgentRunDraftSession } from "@novel-studio/application";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import {
  AgentConversationFileRepository,
  AgentWriteTransaction,
  CreativeProjectFileRepository,
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  createTrustedCreativeFileOperationsPort,
  normalizeCreativeProjectFilePath,
  type AgentWriteLifecycleOperationPort,
  type AgentWriteTrustedCreativeMutationPort,
  AgentProjectReadRepository,
  AgentProjectSearchRepository,
  AgentRunFileRepository,
  AgentUsageFileRepository,
  ChapterFileRepository,
  HistoryRepository,
  ProjectLockFileRepository,
  RecoveryRepository,
  StoryBibleFileRepository,
  WorkspaceOutlineIndexRepository,
  WorkspaceOutlineProjectEntryRepository,
  WorkspaceOutlineProjectMetadataRepository,
  validateWithSchema,
  type AgentTransactionJournal,
  type AgentConversationRecord,
  type AgentWriteTransactionInput,
  type CreativeProjectFileDocument,
  type CreativeProjectFileTreeSnapshot,
  type UpdateAgentConversationRecordInput
} from "@novel-studio/repository";

export interface DesktopAgentRunSessionOptions {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly projectId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly activeChapterId?: string;
  /** Main-owned trust gate for project-authored convention data. */
  readonly workspaceTrust?: "trusted" | "untrusted";
  /** Main-owned explicit convention switch. Defaults to disabled until Main persists consent. */
  readonly projectConventionsEnabled?: boolean;
  /**
   * Returns the already-materialized C1C creative file tree. The outline reader must never refresh
   * or rescan the creative project on its own.
   */
  readonly getCreativeProjectFileTreeSnapshot?: () => CreativeProjectFileTreeSnapshot | undefined;
  /**
   * Main-owned C1C tree re-attestation used by every creative-general outline materialization.
   * It may only refresh the active creative session; it must never scan an arbitrary root.
   */
  readonly reattestCreativeProjectFileTreeSnapshot?: () => Promise<
    Result<CreativeProjectFileTreeSnapshot | undefined, UnifiedError>
  >;
  /**
   * The Electron user-data root the redacted usage sink writes under. It is app-global (not per
   * project), so it arrives via the `createRuntime` closure in `main/index.ts`, mirroring how the
   * preferences repository threads the same root through application composition. When omitted (demo
   * driver, runtime tests), the usage sink is not constructed and compaction wiring stays deferred.
   */
  readonly userDataRoot?: string;
  readonly pricingRegistry?: AgentPricingRegistry;
  readonly usageTime?: () => AgentUsageTimeFacts;
  readonly createRunId?: () => string;
  readonly now?: () => string;
  readonly modelDriver?: AgentRunModelDriver;
  readonly resolveModelProfile?: (
    profileId: string,
    modelName?: string
  ) => Promise<
    { readonly modelProfile: LlmModelProfile; readonly parameters?: LlmParameters } | undefined
  >;
  readonly createAgentModelDriver?: (input: {
    readonly modelProfile: LlmModelProfile;
    readonly parameters?: LlmParameters;
    readonly promptCacheScopeKey?: string;
  }) => AgentRunModelDriver;
  readonly resolveModelStartFacts?: (
    profileId: string,
    modelName?: string
  ) => Promise<AgentRunStartModelFacts | undefined>;
  readonly readEditorBuffer?: (refId: string) => Promise<string | undefined>;
  /** Main-owned creative file session reader used for active/general project files. */
  readonly readCreativeProjectFile?: (
    relativePath: string
  ) => Promise<Result<CreativeProjectFileDocument, UnifiedError>>;
  /** Main-owned proof gate for the active resource required by creative general-file context. */
  readonly verifyCreativeGeneralActiveResource?: (
    reference: Extract<ContextDraftRef, { readonly kind: "project_file" }> | null
  ) => Promise<Result<void, UnifiedError>>;
  readonly readEditorState?: (relativePath: string) => Promise<
    | {
        readonly dirty: boolean;
        readonly content: string;
      }
    | undefined
  >;
  readonly pauseAutosave?: (relativePaths: readonly string[]) => Promise<void>;
  readonly resumeAutosave?: (relativePaths: readonly string[]) => Promise<void>;
  readonly preserveDirtyBuffers?: (relativePaths: readonly string[]) => Promise<void>;
  readonly syncSavedEditor?: (
    relativePath: string,
    options?: { readonly expectedDirtyChecksum?: string }
  ) => Promise<void>;
  readonly notifyProjectFilesChanged?: (input: {
    readonly reason: "agent-change-set-apply" | "agent-run-undo";
    readonly relativePaths: readonly string[];
  }) => Promise<void>;
  readonly surfaceTransactionRecoveryReview?: (group: VersionGroup) => Promise<void>;
  readonly projectLockOwnerId?: string;
  readonly failAgentWriteAt?: number;
  /**
   * Main-owned release gates. These only request a capability; the runtime also requires the
   * corresponding concrete port to be present before exposing a tool to the model.
   */
  readonly featureFlags?: AgentFeatureFlags;
  /**
   * Explicit snapshot for deterministic composition tests and pre-qualified hosts. It is reduced
   * against the supplied concrete ports before being frozen into the run session.
   */
  readonly capabilitySnapshot?: AgentToolCapabilitySnapshot;
  /** Test/host override. Production constructs a repository-backed search executor. */
  readonly searchToolExecutor?: AgentSearchToolExecutor;
  /** Only inject a network executor that has already passed the Main security qualification. */
  readonly networkToolExecutor?: AgentNetworkToolExecutor;
  /** Main-owned egress policy frozen into this workspace runtime. */
  readonly dataEgressPolicy?: AgentNetworkPolicy["dataEgressPolicy"];
  /** File lifecycle stays hidden unless the host has an atomic no-follow transaction backend. */
  readonly fileOperationSession?: AgentFileOperationSessionPort;
  readonly lifecycleOperations?: AgentWriteLifecycleOperationPort;
  /** Standard-trust existing-text replacement for app-managed creative projects only. */
  readonly trustedCreativeMutations?: AgentWriteTrustedCreativeMutationPort;
  /** Remote MCP capabilities are hidden unless the Main-owned transport is injected. */
  readonly externalToolExecutor?: AgentExternalToolExecutor;
  readonly externalToolDescriptors?: readonly AgentToolDescriptor[];
  /** Closes Main-owned external transports when this workspace runtime is replaced. */
  readonly disposeExternalTools?: () => void;
  /** Invalidates Main-owned Provider cache resources when this scope is revoked or replaced. */
  readonly releasePromptCacheScope?: () => void;
}

export interface PreparedAgentRunStart {
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly runDraftChecksum: string;
  readonly contextDraftId: string;
  readonly contextDraftRevision: number;
}

export interface DesktopAgentRuntimeServices {
  readonly workspaceId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly agentRunSession: AgentRunSession;
  readonly agentConversationSession: AgentConversationSession;
  readonly agentRunDraftSession: AgentRunDraftSession;
  readonly agentContextSession: AgentContextSession;
  readonly agentPermissionSession: AgentPermissionSession;
  readonly agentPlanExecutionSession: AgentPlanExecutionSession;
  /** Present only when the Electron user-data usage store is configured. */
  readonly agentUsageSession?: AgentUsageSession;
  readonly prepare: () => Promise<Result<void, UnifiedError>>;
  readonly dispose?: () => void;
  readonly releasePromptCacheResources?: () => void;
  /** Immediately fail-close network and external tool capabilities after a settings mutation. */
  readonly revokeSettingsCapabilities: () => void;
}

export function createDesktopAgentRunSession(
  options: DesktopAgentRunSessionOptions
): AgentRunSession {
  return createDesktopAgentRuntimeServices(options, false).agentRunSession;
}

export function createDesktopAgentRuntime(
  options: DesktopAgentRunSessionOptions
): DesktopAgentRuntimeServices {
  return createDesktopAgentRuntimeServices(options, true);
}

interface DesktopWorkspaceProjectContextServices {
  readonly conventionsReader: ProjectConventionsReader;
  readonly outlineReader: WorkspaceOutlineReader;
  readonly readIdentity: () => Promise<Result<WorkspaceProjectContextIdentity, UnifiedError>>;
  readonly resolveConventions: (input: {
    readonly contextMode: AgentContextMode;
    readonly modelProfileId: string;
  }) => Promise<Result<WorkspaceProjectContextResolution, UnifiedError>>;
  readonly resolve: (input: {
    readonly contextMode: AgentContextMode;
    readonly modelProfileId: string;
  }) => Promise<Result<WorkspaceProjectContextResolution, UnifiedError>>;
}

function createDesktopWorkspaceProjectContextServices(
  options: DesktopAgentRunSessionOptions,
  projectReads: AgentProjectReadRepository
): DesktopWorkspaceProjectContextServices {
  const conventionsReader = createDesktopProjectConventionsReader({ projectReads });
  const index = new WorkspaceOutlineIndexRepository({
    ...(options.workspaceKind === "engineeringWorkspace"
      ? {
          engineeringEntries: new WorkspaceOutlineProjectEntryRepository({
            projectRoot: options.contentRoot,
            traceId: "desktop-agent-workspace-outline-entries"
          })
        }
      : {
          writingMetadata: new WorkspaceOutlineProjectMetadataRepository({
            projectRoot: options.contentRoot,
            traceId: "desktop-agent-workspace-outline-writing-metadata"
          })
        })
  });
  const outlineReader = createDesktopWorkspaceOutlineReader({
    ...(options.workspaceKind === "engineeringWorkspace"
      ? { engineeringIndex: index }
      : {
          writingIndex: index,
          creativeProjectFiles: {
            reattestTreeSnapshot: async () =>
              options.reattestCreativeProjectFileTreeSnapshot === undefined
                ? ok(undefined)
                : options.reattestCreativeProjectFileTreeSnapshot(),
            policy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY
          }
        })
  });
  const identity = (async (): Promise<Result<WorkspaceProjectContextIdentity, UnifiedError>> => {
    try {
      const canonicalRoot = await realpath(options.contentRoot);
      return ok({
        workspaceKind: options.workspaceKind,
        workspaceId: options.projectId,
        canonicalRootIdentity: createHash("sha256").update(canonicalRoot, "utf8").digest("hex")
      });
    } catch {
      return err(
        runtimeError("AGENT_PROJECT_CONTEXT_ROOT_UNAVAILABLE", {
          workspaceKind: options.workspaceKind
        })
      );
    }
  })();

  const resolveConventions = async (input: {
    readonly contextMode: AgentContextMode;
    readonly modelProfileId: string;
  }): Promise<Result<WorkspaceProjectContextResolution, UnifiedError>> => {
    const profileId = resolveWorkspaceProjectContextProfile(
      options.workspaceKind,
      input.contextMode
    );
    if (!profileId.ok) return profileId;
    const workspace = await identity;
    if (!workspace.ok) return workspace;
    const conventions = await conventionsReader.read({
      workspace: workspace.value,
      profileId: profileId.value,
      workspaceTrust: options.workspaceTrust ?? "untrusted",
      enabled: options.projectConventionsEnabled ?? false,
      maxTokens: DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT,
      modelProfileId: input.modelProfileId
    });
    if (!conventions.ok) return conventions;
    return conventions.value.status === "available"
      ? ok({ sources: [conventions.value.source], artifacts: [conventions.value.artifact] })
      : ok({ sources: [], artifacts: [] });
  };

  return {
    conventionsReader,
    outlineReader,
    readIdentity: () => identity,
    resolveConventions,
    async resolve(input) {
      const profileId = resolveWorkspaceProjectContextProfile(
        options.workspaceKind,
        input.contextMode
      );
      if (!profileId.ok) return profileId;
      const workspace = await identity;
      if (!workspace.ok) return workspace;
      const conventions = await resolveConventions(input);
      if (!conventions.ok) return conventions;
      const outline = await outlineReader.read({
        workspace: workspace.value,
        profileId: profileId.value,
        modelProfileId: input.modelProfileId,
        limits: DEFAULT_WORKSPACE_OUTLINE_LIMITS
      });
      if (!outline.ok) return outline;
      const outlineSource = createWorkspaceOutlineSource({
        workspaceTrust: options.workspaceTrust ?? "untrusted",
        result: outline.value
      });
      return ok({
        sources: [...conventions.value.sources, outlineSource.source],
        artifacts: [...conventions.value.artifacts, outlineSource.artifact]
      });
    }
  };
}

function resolveWorkspaceProjectContextProfile(
  workspaceKind: DesktopAgentRunSessionOptions["workspaceKind"],
  contextMode: AgentContextMode
): Result<WorkspaceProjectContextProfileId, UnifiedError> {
  if (workspaceKind === "engineeringWorkspace" && contextMode === "general_file") {
    return ok("engineering");
  }
  if (workspaceKind === "creativeProject" && contextMode === "writing") return ok("writing");
  if (workspaceKind === "creativeProject" && contextMode === "general_file") {
    return ok("creative_general");
  }
  return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
}

function requestedCapabilitySnapshot(
  options: DesktopAgentRunSessionOptions
): AgentToolCapabilitySnapshot {
  const explicit = options.capabilitySnapshot;
  if (explicit !== undefined) {
    if (explicit.workspaceKind !== options.workspaceKind) {
      throw new Error(
        "Desktop Agent capability snapshot workspace kind does not match the runtime."
      );
    }
    return freezeAgentToolCapabilitySnapshot(explicit);
  }

  const flags = options.featureFlags ?? DEFAULT_AGENT_FEATURE_FLAGS;
  return freezeAgentToolCapabilitySnapshot({
    workspaceKind: options.workspaceKind,
    searchEnabled: flags.phaseA_searchEnabled,
    fileLifecycleEnabled: flags.phaseB_fileLifecycleEnabled,
    controlledExecutionEnabled: false,
    gitReadEnabled: false,
    networkReadEnabled: flags.phaseD_networkReadEnabled,
    pluginToolsEnabled: false,
    mcpToolsEnabled: flags.phaseE_remoteMcpEnabled,
    featureFlagRevision: flags.revision
  });
}

function buildRuntimeCapabilitySnapshot(input: {
  readonly requested: AgentToolCapabilitySnapshot;
  readonly searchToolExecutor?: AgentSearchToolExecutor;
  readonly networkToolExecutor?: AgentNetworkToolExecutor;
  readonly fileOperationSession?: AgentFileOperationSessionPort;
  readonly lifecycleOperations?: AgentWriteLifecycleOperationPort;
  readonly trustedCreativeMutations?: AgentWriteTrustedCreativeMutationPort;
  readonly hasVersionGroupExecutor: boolean;
  readonly externalToolExecutor?: AgentExternalToolExecutor;
  readonly externalToolDescriptors?: readonly AgentToolDescriptor[];
}): AgentToolCapabilitySnapshot {
  const descriptors = input.externalToolDescriptors ?? [];
  const hasMcpDescriptor = descriptors.some((descriptor) => descriptor.id?.startsWith("mcp:"));
  return freezeAgentToolCapabilitySnapshot({
    workspaceKind: input.requested.workspaceKind,
    searchEnabled: input.requested.searchEnabled && input.searchToolExecutor !== undefined,
    fileLifecycleEnabled:
      input.requested.fileLifecycleEnabled &&
      input.fileOperationSession !== undefined &&
      (input.lifecycleOperations !== undefined ||
        input.trustedCreativeMutations?.mutate !== undefined) &&
      input.hasVersionGroupExecutor,
    controlledExecutionEnabled: false,
    gitReadEnabled: false,
    networkReadEnabled:
      input.requested.networkReadEnabled && input.networkToolExecutor !== undefined,
    pluginToolsEnabled: false,
    mcpToolsEnabled:
      input.requested.mcpToolsEnabled &&
      input.externalToolExecutor !== undefined &&
      hasMcpDescriptor,
    featureFlagRevision: input.requested.featureFlagRevision
  });
}

function buildRuntimeProviderNameMapping(
  capabilitySnapshot: AgentToolCapabilitySnapshot,
  externalToolDescriptors: readonly AgentToolDescriptor[] | undefined
) {
  const descriptors = new Map<string, AgentToolDescriptor>();
  for (const facadeVersion of ["v1", "v2"] as const) {
    for (const variant of [
      { operationMode: "planning" as const, contextMode: "writing" as const },
      { operationMode: "planning" as const, contextMode: "general_file" as const },
      { operationMode: "execution" as const, contextMode: "writing" as const },
      { operationMode: "execution" as const, contextMode: "general_file" as const }
    ]) {
      for (const descriptor of listAgentTools({
        ...variant,
        facadeVersion,
        writePolicy: "write_before_confirmation",
        capabilitySnapshot,
        ...(externalToolDescriptors === undefined ? {} : { externalToolDescriptors })
      })) {
        descriptors.set(String(descriptor.id ?? descriptor.name), descriptor);
      }
    }
  }
  return freezeProviderNameMapping(
    [...descriptors.values()].map((descriptor) => {
      const id = String(descriptor.id ?? descriptor.name);
      const candidate = descriptor.providerName ?? descriptor.name;
      return {
        id,
        providerName: /^[A-Za-z0-9_-]+$/u.test(candidate)
          ? candidate
          : id.replace(/[^A-Za-z0-9_-]/gu, "__").slice(0, 64)
      };
    })
  );
}

function createDesktopAgentRuntimeServices(
  options: DesktopAgentRunSessionOptions,
  enforceConversationBinding: boolean
): DesktopAgentRuntimeServices {
  const runtimeScope = {
    kind: "workspace" as const,
    workspaceKind: options.workspaceKind,
    workspaceId: options.projectId
  };
  const requestedCapabilities = requestedCapabilitySnapshot(options);
  const trustedCreativeMutations =
    options.workspaceKind === "creativeProject" && options.lifecycleOperations === undefined
      ? (options.trustedCreativeMutations ??
        createTrustedCreativeFileOperationsPort({
          workspaceKind: "creativeProject",
          projectRoot: options.contentRoot
        }))
      : undefined;
  const fileOperationSession =
    options.fileOperationSession ??
    (options.lifecycleOperations !== undefined || trustedCreativeMutations?.mutate !== undefined
      ? createAgentFileOperationSession({ traceId: "desktop-agent-file-operations" })
      : undefined);
  const projectReads = new AgentProjectReadRepository({
    projectRoot: options.contentRoot,
    traceId: "desktop-agent-project-read"
  });
  const workspaceProjectContext = createDesktopWorkspaceProjectContextServices(
    options,
    projectReads
  );
  const creativeProjectFiles =
    options.workspaceKind === "creativeProject"
      ? new CreativeProjectFileRepository({
          projectRoot: options.contentRoot,
          projectId: options.projectId,
          workspaceId: options.projectId,
          traceId: "desktop-agent-creative-project-files",
          receiptStore: createDesktopCreativeProjectFileReceiptStore({
            stateRoot: options.stateRoot,
            projectId: options.projectId,
            workspaceId: options.projectId
          })
        })
      : undefined;
  const readCreativeProjectFile =
    options.readCreativeProjectFile ??
    (creativeProjectFiles === undefined
      ? undefined
      : (relativePath: string) => creativeProjectFiles.readTextFile(relativePath));
  const storyBible =
    options.workspaceKind === "creativeProject"
      ? new StoryBibleFileRepository({
          projectRoot: options.contentRoot,
          traceId: "desktop-agent-story-bible"
        })
      : undefined;
  const repository = new AgentRunFileRepository({
    projectRoot: options.stateRoot,
    traceId: "desktop-agent-run-store"
  });
  const usageRepository =
    options.userDataRoot === undefined
      ? undefined
      : new AgentUsageFileRepository({
          userDataRoot: options.userDataRoot,
          traceId: "desktop-agent-usage-store"
        });
  const usageSession =
    usageRepository === undefined
      ? undefined
      : createAgentUsageSession({
          repository: usageRepository,
          now: () => desktopUsageTime(options).timestamp,
          todayLocalDate: () => desktopUsageTime(options).localDate
        });
  const conversationRepository = new AgentConversationFileRepository({
    projectRoot: options.stateRoot,
    scope: runtimeScope,
    traceId: "desktop-agent-conversation-store"
  });
  const chapterRepository =
    options.workspaceKind === "creativeProject"
      ? new ChapterFileRepository({
          projectRoot: options.contentRoot,
          traceId: "desktop-agent-chapter"
        })
      : undefined;
  const baseSearchToolExecutor = requestedCapabilities.searchEnabled
    ? (options.searchToolExecutor ??
      createAgentSearchToolSession({
        searchRepository: new AgentProjectSearchRepository({
          projectRoot: options.contentRoot,
          workspaceKind: options.workspaceKind,
          traceId: "desktop-agent-project-search"
        })
      }))
    : undefined;
  const creativeGeneralSearchToolExecutor =
    requestedCapabilities.searchEnabled &&
    options.searchToolExecutor === undefined &&
    creativeProjectFiles !== undefined
      ? createAgentSearchToolSession({
          searchRepository: new AgentProjectSearchRepository({
            projectRoot: options.contentRoot,
            workspaceKind: options.workspaceKind,
            creativeProjectFilePolicy: creativeProjectFiles.getPolicy(),
            traceId: "desktop-agent-creative-project-file-search"
          })
        })
      : baseSearchToolExecutor;
  const searchToolExecutor =
    baseSearchToolExecutor === undefined
      ? undefined
      : creativeProjectFiles === undefined
        ? baseSearchToolExecutor
        : routeCreativeSearch(creativeGeneralSearchToolExecutor ?? baseSearchToolExecutor);
  const readToolExecutor = createDesktopReadToolExecutor(
    projectReads,
    creativeProjectFiles,
    readCreativeProjectFile,
    chapterRepository,
    storyBible
  );
  const changeSetSession = createDesktopChangeSetSession({
    projectId: options.projectId,
    projectReads,
    ...(chapterRepository === undefined ? {} : { chapterRepository }),
    ...(storyBible === undefined ? {} : { storyBible }),
    repository,
    ...(options.readEditorState === undefined ? {} : { readEditorState: options.readEditorState })
  });
  const versionGroupServices =
    options.projectLockOwnerId === undefined
      ? undefined
      : createDesktopVersionGroupServices({
          contentRoot: options.contentRoot,
          stateRoot: options.stateRoot,
          projectId: options.projectId,
          projectLockOwnerId: options.projectLockOwnerId,
          ...(options.lifecycleOperations === undefined
            ? {}
            : { lifecycleOperations: options.lifecycleOperations }),
          ...(trustedCreativeMutations === undefined ? {} : { trustedCreativeMutations }),
          projectReads,
          ...(chapterRepository === undefined ? {} : { chapterRepository }),
          ...(options.readEditorState === undefined
            ? {}
            : { readEditorState: options.readEditorState }),
          ...(options.pauseAutosave === undefined ? {} : { pauseAutosave: options.pauseAutosave }),
          ...(options.resumeAutosave === undefined
            ? {}
            : { resumeAutosave: options.resumeAutosave }),
          ...(options.preserveDirtyBuffers === undefined
            ? {}
            : { preserveDirtyBuffers: options.preserveDirtyBuffers }),
          ...(options.syncSavedEditor === undefined
            ? {}
            : { syncSavedEditor: options.syncSavedEditor }),
          ...(options.notifyProjectFilesChanged === undefined
            ? {}
            : { notifyProjectFilesChanged: options.notifyProjectFilesChanged }),
          ...(options.surfaceTransactionRecoveryReview === undefined
            ? {}
            : { surfaceTransactionRecoveryReview: options.surfaceTransactionRecoveryReview }),
          ...(options.failAgentWriteAt === undefined
            ? {}
            : { failAgentWriteAt: options.failAgentWriteAt })
        });
  const writeMutationTrust: AgentWriteMutationTrust =
    versionGroupServices === undefined
      ? "unavailable"
      : options.lifecycleOperations !== undefined
        ? "hardened_native"
        : trustedCreativeMutations !== undefined
          ? "standard_trusted_creative"
          : "unavailable";

  const capabilitySnapshot = buildRuntimeCapabilitySnapshot({
    requested: requestedCapabilities,
    ...(searchToolExecutor === undefined ? {} : { searchToolExecutor }),
    ...(options.networkToolExecutor === undefined
      ? {}
      : { networkToolExecutor: options.networkToolExecutor }),
    ...(fileOperationSession === undefined ? {} : { fileOperationSession }),
    ...(options.lifecycleOperations === undefined
      ? {}
      : { lifecycleOperations: options.lifecycleOperations }),
    ...(trustedCreativeMutations === undefined ? {} : { trustedCreativeMutations }),
    hasVersionGroupExecutor: versionGroupServices !== undefined,
    ...(options.externalToolExecutor === undefined
      ? {}
      : { externalToolExecutor: options.externalToolExecutor }),
    ...(options.externalToolDescriptors === undefined
      ? {}
      : { externalToolDescriptors: options.externalToolDescriptors })
  });

  const scriptedDriver = createDesktopScriptedAgentDriver(options.activeChapterId);
  const modelDriver =
    options.modelDriver ??
    (options.resolveModelProfile === undefined || options.createAgentModelDriver === undefined
      ? scriptedDriver
      : createDesktopAdaptiveAgentDriver({
          scriptedDriver,
          resolveModelProfile: options.resolveModelProfile,
          createAgentModelDriver: options.createAgentModelDriver
        }));

  const conversationPersistence: AgentConversationPersistencePort = {
    createConversation(record) {
      return conversationRepository.createConversation(record as AgentConversationRecord);
    },
    readConversation(conversationId) {
      return conversationRepository.readConversation(conversationId);
    },
    listConversations(input) {
      return conversationRepository.listConversations(input);
    },
    updateConversation(input) {
      return conversationRepository.updateConversation(
        input as unknown as UpdateAgentConversationRecordInput
      );
    },
    writeCommandReceipt(conversationId, commandId, receipt) {
      return conversationRepository.writeCommandReceipt(conversationId, commandId, receipt);
    },
    readCommandReceipt(conversationId, commandId) {
      return conversationRepository.readCommandReceipt(conversationId, commandId);
    },
    readLatestSummary(conversationId) {
      return conversationRepository.readLatestSummary(conversationId);
    },
    writeSummary(summary) {
      return conversationRepository.writeSummary(
        summary as Parameters<typeof conversationRepository.writeSummary>[0]
      );
    },
    searchConversations(input) {
      return conversationRepository.searchConversations(
        input as Parameters<typeof conversationRepository.searchConversations>[0]
      );
    }
  };
  const conversationSession = createAgentConversationSession({
    scope: runtimeScope,
    projectId: options.projectId,
    repository: conversationPersistence,
    runReader: {
      listRunSnapshots(projectId) {
        return repository.listSnapshots(projectId);
      },
      readRunEvents(runId) {
        return repository.readEvents(runId);
      },
      async hasPendingReview(input) {
        const listed = await repository.listSnapshots(input.projectId);
        if (!listed.ok) return listed;
        for (const snapshot of listed.value) {
          if (snapshot["conversationId"] !== input.conversationId) continue;
          const runId = snapshot["runId"];
          if (typeof runId !== "string") continue;
          const read = await session.readAgentRun(runId);
          if (!read.ok) return err(read.error);
          if (
            read.value.pendingUserInput !== undefined ||
            read.value.rollbackReview !== undefined ||
            read.value.changeSet?.status === "awaiting_approval"
          ) {
            return ok(true);
          }
        }
        return ok(false);
      }
    },
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const conversationLifecycle: AgentConversationLifecyclePort = {
    async assertRunMayStart(input) {
      const result = await conversationSession.assertRunMayStart(input);
      return result.ok ? ok(asJsonObject(result.value)) : err(result.error);
    },
    cancelRunStart(input) {
      return conversationSession.cancelRunStart(input);
    },
    loadContext(input) {
      return conversationSession.loadContext(input);
    },
    async noteRunStarted(snapshot) {
      const result = await conversationSession.noteRunStarted(asJsonObject(snapshot));
      return result.ok ? ok(undefined) : err(result.error);
    },
    noteRunTerminal(snapshot) {
      return conversationSession.noteRunTerminal(asJsonObject(snapshot));
    }
  };
  const draftSession = createAgentRunDraftSession({
    scope: runtimeScope,
    repository: {
      writeRunDraft: (draft) => conversationRepository.writeRunDraft(draft),
      readLatestRunDraft: (conversationId) =>
        conversationRepository.readLatestRunDraft(conversationId),
      writeContextDraft: (draft) => conversationRepository.writeContextDraft(draft),
      readLatestContextDraft: (conversationId) =>
        conversationRepository.readLatestContextDraft(conversationId)
    },
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const startPreflight = createDesktopStartPreflight({
    workspaceKind: options.workspaceKind,
    draftSession,
    ...(chapterRepository === undefined ? {} : { chapterRepository }),
    projectReads,
    resolveWorkspaceProjectContext: workspaceProjectContext.resolve,
    ...(storyBible === undefined ? {} : { storyBible }),
    ...(options.readEditorBuffer === undefined
      ? {}
      : { readEditorBuffer: options.readEditorBuffer }),
    ...(readCreativeProjectFile === undefined ? {} : { readCreativeProjectFile }),
    ...(options.verifyCreativeGeneralActiveResource === undefined
      ? {}
      : { verifyCreativeGeneralActiveResource: options.verifyCreativeGeneralActiveResource }),
    ...(options.readEditorState === undefined ? {} : { readEditorState: options.readEditorState }),
    ...(options.resolveModelStartFacts === undefined
      ? {}
      : { resolveModelStartFacts: options.resolveModelStartFacts })
  });
  const permissionSession = createAgentPermissionSession({
    repository: {
      writePermissionSummary: (runId, summary) => repository.writePermissionSummary(runId, summary),
      readPermissionSummary: (runId, permissionSummaryId) =>
        repository.readPermissionSummary(runId, permissionSummaryId)
    },
    rootFingerprint: {
      async resolveRootFingerprint(projectId) {
        if (projectId !== options.projectId) {
          return err(permissionRootError("AGENT_PERMISSION_PROJECT_MISMATCH"));
        }
        try {
          const canonicalRoot = await realpath(options.contentRoot);
          return ok(createHash("sha256").update(canonicalRoot, "utf8").digest("hex"));
        } catch {
          return err(permissionRootError("AGENT_PERMISSION_PROJECT_ROOT_UNAVAILABLE"));
        }
      }
    },
    writeMutationTrust,
    defaultCapabilitySnapshot: capabilitySnapshot,
    ...(options.externalToolDescriptors === undefined
      ? {}
      : { defaultExternalToolDescriptors: options.externalToolDescriptors }),
    listTools: (input) => listAgentTools({ ...input, facadeVersion: "v2" }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const planExecutionSession = createAgentPlanExecutionSession({ repository });
  const contextSession = createDesktopAgentContextSession({
    projectId: options.projectId,
    workspaceKind: options.workspaceKind,
    draftSession,
    repository,
    ...(usageRepository === undefined ? {} : { usageRepository }),
    ...(chapterRepository === undefined ? {} : { chapterRepository }),
    projectReads,
    resolveWorkspaceProjectContext: workspaceProjectContext.resolve,
    capabilitySnapshot,
    ...(options.externalToolDescriptors === undefined
      ? {}
      : { externalToolDescriptors: options.externalToolDescriptors }),
    loadConversationContext: (conversationId: string) =>
      conversationSession.loadContext({
        scope: runtimeScope,
        projectId: options.projectId,
        conversationId
      }),
    modelDriver,
    ...(storyBible === undefined ? {} : { storyBible }),
    ...(options.pricingRegistry === undefined ? {} : { pricingRegistry: options.pricingRegistry }),
    ...(options.usageTime === undefined ? {} : { usageTime: options.usageTime }),
    ...(options.readEditorBuffer === undefined
      ? {}
      : { readEditorBuffer: options.readEditorBuffer }),
    ...(readCreativeProjectFile === undefined ? {} : { readCreativeProjectFile }),
    ...(options.verifyCreativeGeneralActiveResource === undefined
      ? {}
      : { verifyCreativeGeneralActiveResource: options.verifyCreativeGeneralActiveResource }),
    ...(options.readEditorState === undefined ? {} : { readEditorState: options.readEditorState }),
    ...(options.resolveModelStartFacts === undefined
      ? {}
      : { resolveModelStartFacts: options.resolveModelStartFacts }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  let effectiveCapabilityState: EffectiveCapabilityState =
    createEffectiveCapabilityState(capabilitySnapshot);
  const revokeSettingsCapabilities = (): void => {
    const revokedAt = options.now?.() ?? new Date().toISOString();
    effectiveCapabilityState = revokeCapability(
      effectiveCapabilityState,
      "network",
      "user_revoked",
      revokedAt
    );
    options.releasePromptCacheScope?.();
    effectiveCapabilityState = revokeCapability(
      effectiveCapabilityState,
      "mcp_tools",
      "user_revoked",
      revokedAt
    );
  };
  const providerNameMapping = buildRuntimeProviderNameMapping(
    capabilitySnapshot,
    options.externalToolDescriptors
  );
  const session = createAgentRunSession({
    scope: runtimeScope,
    repository,
    modelDriver,
    readToolExecutor,
    startPreflight,
    newRunToolFacadeVersion: "v2",
    capabilitySnapshot,
    effectiveCapabilityState,
    getEffectiveCapabilityState: () => effectiveCapabilityState,
    providerNameMapping,
    permission: permissionSession,
    planExecutionSession,
    contextCompactor: contextSession,
    changeSetSession,
    ...(searchToolExecutor === undefined ? {} : { searchToolExecutor }),
    ...(creativeProjectFiles === undefined
      ? {}
      : {
          generalFilePathPolicy: (path: string, kind: "file" | "directory") =>
            normalizeCreativeProjectFilePath(path, kind)
        }),
    ...(options.networkToolExecutor === undefined
      ? {}
      : { networkToolExecutor: options.networkToolExecutor }),
    ...(options.dataEgressPolicy === undefined
      ? {}
      : { dataEgressPolicy: options.dataEgressPolicy }),
    ...(fileOperationSession === undefined ? {} : { fileOperationSession }),
    ...(options.externalToolExecutor === undefined
      ? {}
      : { externalToolExecutor: options.externalToolExecutor }),
    ...(options.externalToolDescriptors === undefined
      ? {}
      : { externalToolDescriptors: options.externalToolDescriptors }),
    ...(usageRepository === undefined
      ? {}
      : {
          usageSink: {
            async writeFinal(record: AgentUsageRecord) {
              const written = await usageRepository.writeFinal(record as unknown as JsonObject);
              return written.ok
                ? ok(written.value as unknown as AgentUsageRecord)
                : err(written.error);
            }
          },
          pricingRegistry:
            options.pricingRegistry ??
            createAgentPricingRegistry({ version: "stage-5-default", entries: [] }),
          ...(options.usageTime === undefined ? {} : { usageTime: options.usageTime }),
          usageBudgetResolver: (snapshot: AgentRunSnapshot) =>
            resolveDesktopUsageBudget(repository, snapshot)
        }),
    ...(enforceConversationBinding ? { conversationLifecycle } : {}),
    ...(versionGroupServices === undefined
      ? {}
      : { versionGroupExecutor: versionGroupServices.executor }),
    contextSourceReader: {
      async readCurrentSources(input) {
        const current: {
          refId: string;
          status?: "available" | "missing";
          content?: string;
          comparisonChecksum?: string;
          sourceIdentity?: AgentContextSourceIdentity;
          source?: AgentContextSourceInput;
        }[] = [];
        const refreshModelProfileId =
          input.purpose === "refresh"
            ? await readRunModelProfileId(repository, input.runId)
            : undefined;
        if (refreshModelProfileId?.ok === false) return refreshModelProfileId;
        const currentIdentity = await workspaceProjectContext.readIdentity();
        if (!currentIdentity.ok) return currentIdentity;
        for (const source of input.sources) {
          const materialization = source.materialization;
          if (materialization?.kind === "project_conventions") {
            const reread = await workspaceProjectContext.conventionsReader.read({
              workspace: currentIdentity.value,
              profileId: materialization.sourceIdentity.contextProfileId,
              workspaceTrust: materialization.workspaceTrust,
              enabled: options.projectConventionsEnabled ?? false,
              maxTokens: DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT,
              modelProfileId: refreshModelProfileId?.value ?? "agent-context-staleness"
            });
            if (!reread.ok) return reread;
            if (reread.value.status !== "available") {
              current.push({ refId: source.refId, status: "missing" });
              continue;
            }
            const rereadMaterialization = reread.value.source.materialization;
            if (rereadMaterialization?.kind !== "project_conventions") {
              return err(runtimeError("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID"));
            }
            current.push({
              refId: source.refId,
              status: "available",
              comparisonChecksum: rereadMaterialization.originalChecksum,
              sourceIdentity: rereadMaterialization.sourceIdentity,
              ...(input.purpose === "refresh"
                ? { source: { ...reread.value.source, refId: source.refId } }
                : {})
            });
            continue;
          }
          if (materialization?.kind === "workspace_outline") {
            const previousManifest =
              materialization.dependencyManifest as unknown as WorkspaceOutlineDependencyManifest;
            const workspace = currentIdentity.value;
            if (input.purpose === "staleness") {
              const manifest = await workspaceProjectContext.outlineReader.readDependencyManifest({
                workspace,
                profileId: materialization.sourceIdentity.contextProfileId,
                limits: previousManifest.limits
              });
              if (!manifest.ok) return manifest;
              current.push({
                refId: source.refId,
                status: "available",
                comparisonChecksum: workspaceOutlineDependencyRevisionChecksum(manifest.value)
              });
              continue;
            }
            const reread = await workspaceProjectContext.outlineReader.read({
              workspace,
              profileId: materialization.sourceIdentity.contextProfileId,
              limits: previousManifest.limits,
              modelProfileId: refreshModelProfileId?.value ?? "agent-context-refresh"
            });
            if (!reread.ok) return reread;
            const refreshed = createWorkspaceOutlineSource({
              workspaceTrust: materialization.workspaceTrust,
              result: reread.value
            });
            const refreshedMaterialization = refreshed.source.materialization;
            if (refreshedMaterialization?.kind !== "workspace_outline") {
              return err(runtimeError("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID"));
            }
            current.push({
              refId: source.refId,
              status: "available",
              comparisonChecksum: refreshedMaterialization.dependencyRevisionChecksum,
              source: { ...refreshed.source, refId: source.refId }
            });
            continue;
          }
          if (source.sourceKind === "editor_buffer") {
            const editorContent = await options.readEditorBuffer?.(source.refId);
            current.push({
              refId: source.refId,
              content: editorContent ?? source.content
            });
            continue;
          }
          if (source.relativePath !== undefined) {
            if (source.refId.startsWith("chapter:") && chapterRepository !== undefined) {
              const chapter = await chapterRepository.readChapter(
                source.refId.slice("chapter:".length)
              );
              if (chapter.ok && !source.content.startsWith("---")) {
                current.push({ refId: source.refId, content: chapter.value.body });
                continue;
              }
            }
            const read = await projectReads.readText(source.relativePath);
            if (!read.ok) return read;
            current.push({ refId: source.refId, content: read.value.content });
            continue;
          }
          if (source.assetId !== undefined && storyBible !== undefined) {
            const asset = await findStoryBibleAsset(storyBible, source.assetId);
            if (!asset.ok) {
              if (asset.error.code === "AGENT_STORY_BIBLE_ASSET_NOT_FOUND") {
                current.push({ refId: source.refId, status: "missing" });
                continue;
              }
              return asset;
            }
            current.push({ refId: source.refId, content: JSON.stringify(asset.value) });
          }
        }
        return ok(current);
      }
    },
    createContextSnapshotId: (runId) => `context_${runId}_1`,
    coordinatorOptions: {
      ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
      ...(options.now === undefined ? {} : { now: options.now })
    }
  });
  let prepareResult: Promise<Result<void, UnifiedError>> | undefined;
  const prepare = () =>
    (prepareResult ??= (async () => {
      if (usageRepository !== undefined) {
        const retained = await usageRepository.enforceRetention(
          desktopUsageTime(options).localDate
        );
        if (!retained.ok) return retained;
      }
      if (versionGroupServices !== undefined) {
        const recovered = await versionGroupServices.recoverOnStartup();
        if (!recovered.ok) return err(recovered.error);
      }
      return ok(undefined);
    })());
  return {
    workspaceId: options.projectId,
    contentRoot: options.contentRoot,
    stateRoot: options.stateRoot,
    agentRunSession: session,
    agentConversationSession: conversationSession,
    agentRunDraftSession: draftSession,
    agentContextSession: contextSession,
    agentPermissionSession: permissionSession,
    agentPlanExecutionSession: planExecutionSession,
    ...(usageSession === undefined ? {} : { agentUsageSession: usageSession }),
    prepare,
    revokeSettingsCapabilities,
    ...(options.releasePromptCacheScope === undefined
      ? {}
      : { releasePromptCacheResources: options.releasePromptCacheScope }),
    ...(options.disposeExternalTools === undefined && options.releasePromptCacheScope === undefined
      ? {}
      : {
          dispose: () => {
            options.releasePromptCacheScope?.();
            options.disposeExternalTools?.();
          }
        })
  };
}

function desktopUsageTime(options: DesktopAgentRunSessionOptions): AgentUsageTimeFacts {
  if (options.usageTime !== undefined) return options.usageTime();
  const current = new Date(options.now?.() ?? new Date().toISOString());
  const year = String(current.getFullYear()).padStart(4, "0");
  const month = String(current.getMonth() + 1).padStart(2, "0");
  const day = String(current.getDate()).padStart(2, "0");
  return {
    timestamp: current.toISOString(),
    localDate: `${year}-${month}-${day}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    utcOffsetMinutes: -current.getTimezoneOffset()
  };
}

async function resolveDesktopUsageBudget(
  repository: AgentRunFileRepository,
  snapshot: AgentRunSnapshot
) {
  const budgetId = snapshot.contextBudgetSnapshotId;
  const catalogRevision = snapshot.toolCatalogRevision;
  const facadeVersion = snapshot.toolFacadeVersion;
  if (
    budgetId === null ||
    catalogRevision === null ||
    catalogRevision === undefined ||
    (facadeVersion !== "v1" && facadeVersion !== "v2")
  ) {
    return err(runtimeError("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
  }
  const stored = await repository.readBudgetSnapshot(snapshot.runId, budgetId);
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined) {
    return err(runtimeError("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
  }
  return readResolvedContextBudgetUsageLimits(stored.value, {
    contextBudgetSnapshotId: budgetId,
    provider: snapshot.providerCapabilitySnapshot.provider,
    model: snapshot.providerCapabilitySnapshot.modelName,
    modelProfileId: snapshot.providerCapabilitySnapshot.profileId,
    contextWindow: snapshot.providerCapabilitySnapshot.contextWindow,
    facadeVersion,
    catalogRevision
  });
}

async function readRunModelProfileId(
  repository: AgentRunFileRepository,
  runId: string
): Promise<Result<string, UnifiedError>> {
  const read = await repository.readSnapshot(runId);
  if (!read.ok) return read;
  const provider = read.value?.["providerCapabilitySnapshot"];
  const profileId = isRecord(provider) ? provider["profileId"] : undefined;
  return typeof profileId === "string" && profileId.length > 0
    ? ok(profileId)
    : err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED", { runId }));
}

function permissionRootError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message: "The canonical Agent project root cannot be fingerprinted.",
    recoverability: "user-action",
    suggestedAction: "Reopen the project and retry.",
    traceId: "desktop-agent-permission-root"
  });
}

/**
 * Build the read-only context session for the desktop. `previewContextBudget` resolves model facts +
 * ref content server-side (renderer previews are never trusted). The shared C4 resolver accounts for
 * the complete provider wrapper, C2 conventions, and frozen tool catalog. Compaction is wired only
 * when a usage sink exists (i.e.
 * `userDataRoot` was threaded in): the run repository owns the revision/result/budget artifacts and the
 * pointer-last commit marker, the usage repository owns the redacted final record. Without a usage sink
 * `compactContext` returns its `AGENT_CONTEXT_COMPACTION_UNAVAILABLE` guard.
 */
function createDesktopAgentContextSession(input: {
  readonly projectId: string;
  readonly workspaceKind: DesktopAgentRunSessionOptions["workspaceKind"];
  readonly draftSession: AgentRunDraftSession;
  readonly repository: AgentRunFileRepository;
  readonly usageRepository?: AgentUsageFileRepository;
  readonly chapterRepository?: ChapterFileRepository;
  readonly projectReads: AgentProjectReadRepository;
  readonly resolveWorkspaceProjectContext: DesktopWorkspaceProjectContextServices["resolve"];
  readonly capabilitySnapshot: AgentToolCapabilitySnapshot;
  readonly externalToolDescriptors?: readonly AgentToolDescriptor[];
  readonly loadConversationContext: (
    conversationId: string
  ) => Promise<Result<readonly AgentModelMessage[], UnifiedError>>;
  readonly modelDriver: AgentRunModelDriver;
  readonly storyBible?: StoryBibleFileRepository;
  readonly pricingRegistry?: AgentPricingRegistry;
  readonly usageTime?: () => AgentUsageTimeFacts;
  readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
  readonly readCreativeProjectFile?: NonNullable<
    DesktopAgentRunSessionOptions["readCreativeProjectFile"]
  >;
  readonly verifyCreativeGeneralActiveResource?: NonNullable<
    DesktopAgentRunSessionOptions["verifyCreativeGeneralActiveResource"]
  >;
  readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
  readonly resolveModelStartFacts?: NonNullable<
    DesktopAgentRunSessionOptions["resolveModelStartFacts"]
  >;
  readonly now?: () => string;
}): AgentContextSession {
  const budgetInputs: AgentContextBudgetInputsPort = {
    async resolveBudgetInputs({ conversationId, draft, contextDraft }) {
      if (input.resolveModelStartFacts === undefined) {
        return err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED"));
      }
      const model = await input.resolveModelStartFacts(draft.modelProfileId, draft.modelName);
      if (model === undefined) {
        return err(
          runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED", {
            profileId: draft.modelProfileId,
            modelName: draft.modelName ?? null,
            missingCapabilities: ["modelProfile"]
          })
        );
      }
      const capability = preflightAgentModelCapabilities({
        profileId: model.profileId,
        provider: model.provider,
        modelName: model.modelName,
        capabilities: model.capabilities,
        requiredContextTokens: model.requiredContextTokens
      });
      if (!capability.ok) return err(capability.error);
      if (
        input.workspaceKind === "creativeProject" &&
        contextDraft.contextMode === "general_file"
      ) {
        if (input.verifyCreativeGeneralActiveResource === undefined) {
          return err(runtimeError("AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED"));
        }
        const verified = await input.verifyCreativeGeneralActiveResource(
          contextDraft.activeResourceRef
        );
        if (!verified.ok) return verified;
      }
      const sources = await resolveContextDraftSources(contextDraft.refs, {
        ...input,
        contextMode: contextDraft.contextMode,
        activeResourceRef: contextDraft.activeResourceRef
      });
      if (!sources.ok) return err(sources.error);
      const projectContext = await input.resolveWorkspaceProjectContext({
        contextMode: contextDraft.contextMode,
        modelProfileId: draft.modelProfileId
      });
      if (!projectContext.ok) return err(projectContext.error);
      const profile = resolveAgentContextProfile(
        {
          kind: "workspace",
          workspaceKind: input.workspaceKind,
          workspaceId: input.projectId
        },
        draft.operationMode,
        draft.contextMode
      );
      const allSources = mergeWorkspaceProjectContextSources(
        projectContext.value.sources,
        sources.value
      );
      const toolDescriptors = listAgentTools({
        facadeVersion: "v2",
        operationMode: draft.operationMode,
        contextMode: draft.contextMode,
        writePolicy: draft.writePolicy,
        capabilitySnapshot: input.capabilitySnapshot,
        ...(input.externalToolDescriptors === undefined
          ? {}
          : { externalToolDescriptors: input.externalToolDescriptors })
      });
      const catalogRevision = computeAgentRunToolCatalogRevision("v2", toolDescriptors);
      const conversation = await input.loadConversationContext(conversationId);
      if (!conversation.ok) return err(conversation.error);
      const systemPrompt = buildAgentSystemPrompt(profile);
      const prompt = materializeAgentPrompt({
        profile,
        systemPrompt,
        toolCatalogRevision: catalogRevision,
        userRequest: draft.userRequest,
        contextSources: allSources,
        conversationSummaryMessages: materializeAgentConversationContext(conversation.value)
      });
      const resolvedBudget = resolveCanonicalBudgetInputs({
        provider: model.provider,
        model: model.modelName,
        modelProfileId: draft.modelProfileId,
        ...(model.capabilities.contextWindow === undefined
          ? {}
          : { contextWindow: model.capabilities.contextWindow }),
        requiredContextTokens: model.requiredContextTokens,
        profile,
        prompt,
        contextSources: allSources,
        toolCatalog: {
          facadeVersion: "v2",
          catalogRevision,
          descriptors: toolDescriptors
        }
      });
      if (!resolvedBudget.ok) return err(resolvedBudget.error);
      const inputs: AgentContextBudgetInputs = {
        model: {
          provider: model.provider,
          model: model.modelName,
          contextWindow: capability.value.contextWindow,
          toolReserve: resolvedBudget.value.toolReserve,
          systemReserve: resolvedBudget.value.systemReserve,
          requiredContextTokens: model.requiredContextTokens
        },
        contents: allSources.map((source) => ({ refId: source.refId, content: source.content })),
        resolved: resolvedBudget.value
      };
      return ok(inputs);
    }
  };
  const repository = input.repository;
  const usageRepository = input.usageRepository;
  const compaction =
    usageRepository === undefined
      ? {}
      : {
          compactionSources: createDesktopCompactionSources({
            repository,
            ...(input.pricingRegistry === undefined
              ? {}
              : { pricingRegistry: input.pricingRegistry }),
            ...(input.usageTime === undefined ? {} : { usageTime: input.usageTime }),
            ...(input.now === undefined ? {} : { now: input.now })
          }),
          runRepository: {
            writeCompactionManifest: (manifest: JsonObject) =>
              repository.writeCompactionManifest(manifest),
            writeCompactionRevision: (revision: JsonObject) =>
              repository.writeCompactionRevision(revision),
            writeCompactionSummaryArtifact: (runId: string, artifact: JsonObject) =>
              repository.writeCompactionSummaryArtifact(runId, artifact),
            readCompactionSummaryArtifact: (runId: string, artifactId: string) =>
              repository.readCompactionSummaryArtifact(runId, artifactId),
            writePromptMaterialization: (runId: string, artifact: JsonObject) =>
              repository.writePromptMaterialization(runId, artifact),
            writeContextSnapshot: (snapshot: JsonObject) =>
              repository.writeContextSnapshot(snapshot),
            writeBudgetSnapshot: (runId: string, snapshot: JsonObject) =>
              repository.writeBudgetSnapshot(runId, snapshot),
            commitCompaction: (snapshot: JsonObject) => repository.commitCompaction(snapshot),
            writeCommandReceipt: (runId: string, commandId: string, receipt: JsonObject) =>
              repository.writeCommandReceipt(runId, `compaction_${commandId}`, receipt),
            readCommandReceipt: (runId: string, commandId: string) =>
              repository.readCommandReceipt(runId, `compaction_${commandId}`),
            readSnapshot: (runId: string) => repository.readSnapshot(runId),
            readCompactionRevision: (runId: string, compactionId: string) =>
              repository.readCompactionRevision(runId, compactionId)
          },
          usageSink: {
            writeFinal: (record: JsonObject) => usageRepository.writeFinal(record)
          },
          modelAssistant: createDesktopCompactionModelAssistant({
            repository,
            modelDriver: input.modelDriver
          })
        };
  return createAgentContextSession({
    draftSession: input.draftSession,
    budgetInputs,
    ...compaction,
    ...(input.now === undefined ? {} : { now: input.now })
  });
}

function createDesktopChangeSetSession(input: {
  readonly projectId: string;
  readonly projectReads: AgentProjectReadRepository;
  readonly chapterRepository?: ChapterFileRepository;
  readonly storyBible?: StoryBibleFileRepository;
  readonly repository: AgentRunFileRepository;
  readonly readEditorState?: DesktopAgentRunSessionOptions["readEditorState"];
}) {
  return createChangeSetSession({
    port: {
      async readChapterTarget({ projectId, chapterId }) {
        if (projectId !== input.projectId) return err(runtimeError("CHANGE_SET_PROJECT_MISMATCH"));
        if (input.chapterRepository === undefined) {
          return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
        }
        const chapter = await input.chapterRepository.readChapter(chapterId);
        if (!chapter.ok) return chapter;
        const relativePath = `chapters/${chapterId}.md`;
        const editor = await input.readEditorState?.(relativePath);
        return ok({
          relativePath,
          assetType: "chapter" as const,
          assetId: chapterId,
          content: chapter.value.body,
          checksum: checksumText(chapter.value.body),
          dirty: editor?.dirty ?? false,
          supported: true
        });
      },
      async readFileTarget({ projectId, relativePath }) {
        if (projectId !== input.projectId) return err(runtimeError("CHANGE_SET_PROJECT_MISMATCH"));
        const read = await input.projectReads.readText(relativePath);
        if (!read.ok) return read;
        const editor = await input.readEditorState?.(relativePath);
        return ok({
          relativePath: read.value.relativePath,
          assetType: "text" as const,
          content: read.value.content,
          checksum: read.value.checksum,
          dirty: editor?.dirty ?? false,
          supported: true
        });
      },
      async readStoryBibleTarget({ projectId, assetId }) {
        if (projectId !== input.projectId) return err(runtimeError("CHANGE_SET_PROJECT_MISMATCH"));
        if (input.storyBible === undefined) {
          return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
        }
        const asset = await findStoryBibleAsset(input.storyBible, assetId);
        if (!asset.ok) return asset;
        const relativePath = resolveStoryBibleAssetRelativePath(asset.value);
        if (!relativePath.ok) return relativePath;
        const read = await input.projectReads.readText(relativePath.value);
        if (!read.ok) return read;
        const editor = await input.readEditorState?.(relativePath.value);
        return ok({
          relativePath: relativePath.value,
          assetType: "text" as const,
          assetId,
          content: read.value.content,
          checksum: read.value.checksum,
          dirty: editor?.dirty ?? false,
          supported: true
        });
      },
      async validateCandidate(candidate) {
        if (candidate.assetType === "chapter") {
          if (input.chapterRepository === undefined) {
            return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
          }
          if (candidate.assetId === undefined) {
            return err(runtimeError("CHANGE_SET_CHAPTER_ID_MISSING"));
          }
          const chapter = await input.chapterRepository.readChapter(candidate.assetId);
          if (!chapter.ok) return chapter;
          return ok({
            schema: { status: "valid" as const },
            asset: { status: "valid" as const }
          });
        }
        const schemaName = schemaNameForProjectText(candidate.relativePath);
        if (schemaName !== undefined) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(candidate.candidateContent);
          } catch {
            return ok({});
          }
          const validation = await validateWithSchema(schemaName, parsed);
          return ok({
            schema: validation.valid
              ? { status: "valid" as const }
              : {
                  status: "invalid" as const,
                  message: `Candidate does not match the ${schemaName} schema at ${validation.issues
                    .slice(0, 3)
                    .map((issue) => issue.instancePath || "/")
                    .join(", ")}.`
                }
          });
        }
        return ok({});
      },
      async persistChangeSet(changeSet) {
        const persisted = await input.repository.writeChangeSet(asJsonObject(changeSet));
        return persisted.ok ? ok(changeSet) : persisted;
      },
      async readChangeSet(changeSetId, revision) {
        const read = await input.repository.readChangeSet(changeSetId, revision);
        return read.ok ? ok(read.value as unknown as ChangeSet | undefined) : read;
      },
      async readLatestChangeSet(binding) {
        const read = await input.repository.readLatestChangeSet(binding);
        return read.ok ? ok(read.value as unknown as ChangeSet | undefined) : read;
      }
    }
  });
}

function schemaNameForProjectText(relativePath: string): string | undefined {
  const fixedPaths: Readonly<Record<string, string>> = {
    "project.json": "project",
    "settings.json": "settings",
    "plugins/plugins.json": "plugin-registry",
    "outline/outline.json": "story-asset",
    "timeline/events.json": "story-asset"
  };
  const fixed = fixedPaths[relativePath];
  if (fixed !== undefined) return fixed;
  if (/^(characters|world)\/[^/]+\.json$/u.test(relativePath)) return "story-asset";
  if (/^memories\/(long-term|style|summary)\/[^/]+\.json$/u.test(relativePath)) {
    return "memory";
  }
  if (/^prompts\/[^/]+\.json$/u.test(relativePath)) return "prompt-template";
  if (/^agents\/[^/]+\.json$/u.test(relativePath)) return "agent-config";
  if (/^workflow\/[^/]+\.json$/u.test(relativePath)) return "workflow-definition";
  if (/^plugins\/[^/]+\/plugin\.json$/u.test(relativePath)) return "plugin-manifest";
  return undefined;
}

function createDesktopVersionGroupServices(input: {
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly projectId: string;
  readonly projectLockOwnerId: string;
  readonly lifecycleOperations?: AgentWriteLifecycleOperationPort;
  readonly trustedCreativeMutations?: AgentWriteTrustedCreativeMutationPort;
  readonly projectReads: AgentProjectReadRepository;
  readonly chapterRepository?: ChapterFileRepository;
  readonly readEditorState?: DesktopAgentRunSessionOptions["readEditorState"];
  readonly pauseAutosave?: DesktopAgentRunSessionOptions["pauseAutosave"];
  readonly resumeAutosave?: DesktopAgentRunSessionOptions["resumeAutosave"];
  readonly preserveDirtyBuffers?: DesktopAgentRunSessionOptions["preserveDirtyBuffers"];
  readonly syncSavedEditor?: DesktopAgentRunSessionOptions["syncSavedEditor"];
  readonly notifyProjectFilesChanged?: DesktopAgentRunSessionOptions["notifyProjectFilesChanged"];
  readonly surfaceTransactionRecoveryReview?: DesktopAgentRunSessionOptions["surfaceTransactionRecoveryReview"];
  readonly failAgentWriteAt?: number;
}): {
  readonly executor: AgentVersionGroupExecutor;
  readonly recoverOnStartup: () => Promise<Result<readonly VersionGroup[], UnifiedError>>;
} {
  const recoveryRepository = new RecoveryRepository({
    projectRoot: input.stateRoot,
    traceId: "desktop-agent-recovery"
  });
  const transaction = new AgentWriteTransaction({
    projectRoot: input.contentRoot,
    projectLock: new ProjectLockFileRepository({
      projectRoot: input.stateRoot,
      ownerId: input.projectLockOwnerId,
      traceId: "desktop-agent-project-lock"
    }),
    historyRepository: new HistoryRepository({
      projectRoot: input.stateRoot,
      traceId: "desktop-agent-history"
    }),
    recoveryRepository,
    ...(input.lifecycleOperations === undefined
      ? {}
      : {
          lifecycleOperations:
            input.failAgentWriteAt === undefined
              ? input.lifecycleOperations
              : createFailureInjectingLifecycleOperations(
                  input.lifecycleOperations,
                  input.failAgentWriteAt
                )
        }),
    ...(input.trustedCreativeMutations === undefined
      ? {}
      : {
          trustedCreativeMutations:
            input.failAgentWriteAt === undefined
              ? input.trustedCreativeMutations
              : createFailureInjectingTrustedCreativeMutations(
                  input.trustedCreativeMutations,
                  input.failAgentWriteAt
                )
        }),
    traceId: "desktop-agent-write"
  });
  const transactionPort: VersionGroupSessionTransactionPort = {
    listIncompleteTransactionPaths: () => transaction.listIncompleteTransactionPaths(),
    async apply(changeSetInput) {
      const prepared = await prepareTransactionInput(changeSetInput, input);
      return prepared.ok ? transaction.apply(prepared.value) : prepared;
    },
    recoverIncompleteTransactions: () => transaction.recoverIncompleteTransactions(),
    undoVersionGroup: (undoInput) => transaction.undoVersionGroup(undoInput),
    undoWrite: (undoInput) => transaction.undoWrite(undoInput),
    undoRun: (undoInput) => transaction.undoRun(undoInput)
  };
  const versionGroupSession = createVersionGroupSession({
    transaction: transactionPort,
    hooks: {
      async pauseAutosave(relativePaths) {
        await input.pauseAutosave?.(relativePaths);
      },
      async resumeAutosave(relativePaths) {
        await input.resumeAutosave?.(relativePaths);
      },
      async syncSavedEditor(editor) {
        await input.syncSavedEditor?.(editor.relativePath, {
          ...(editor.expectedDirtyChecksum === undefined
            ? {}
            : { expectedDirtyChecksum: editor.expectedDirtyChecksum })
        });
      },
      ...(input.readEditorState === undefined ? {} : { readEditorState: input.readEditorState }),
      async preserveDirtyBuffers(relativePaths) {
        await input.preserveDirtyBuffers?.(relativePaths);
      },
      async markRecoveryClean(relativePaths) {
        if (input.chapterRepository === undefined) return;
        await markRecoveryRecordsClean(
          recoveryRepository,
          input.chapterRepository,
          input.projectId,
          relativePaths
        );
      },
      async surfaceTransactionRecoveryReview(group) {
        await input.surfaceTransactionRecoveryReview?.(group);
      },
      async reportPostCommitSyncFailure({ group }) {
        await input.surfaceTransactionRecoveryReview?.(group);
      }
    }
  });
  let recoveryResult: Promise<Result<readonly VersionGroup[], UnifiedError>> | undefined;
  const recover = () => (recoveryResult ??= versionGroupSession.recoverOnStartup());

  return {
    executor: {
      async apply({ changeSet, approval }) {
        const recovered = await recover();
        if (!recovered.ok) return recovered;
        const dirty = await dirtySelectedPaths(changeSet, input.readEditorState);
        if (dirty.length > 0) {
          return err(
            runtimeError("AGENT_WRITE_DIRTY_EDITOR", {
              dirtyTargetPaths: dirty
            })
          );
        }
        const applied = await versionGroupSession.applyApproved({ changeSet, approval });
        if (!applied.ok) return applied;
        if (applied.value.transactionStatus !== "applied") {
          return err(versionGroupFailure(applied.value));
        }
        await notifyProjectFilesChanged(
          input.notifyProjectFilesChanged,
          "agent-change-set-apply",
          versionGroupRelativePaths(applied.value)
        );
        return ok(asJsonObject(applied.value));
      },
      async undoRun({ runId, commandId, action, reviewId, decisions, retryFailedOnly }) {
        const recovered = await recover();
        if (!recovered.ok) return recovered;
        const journals = await recoveryRepository.listAgentTransactionJournals();
        if (!journals.ok) return journals;
        const relativePaths = [
          ...new Set(
            journals.value
              .filter((journal) => journal.kind === "apply" && journal.runId === runId)
              .flatMap((journal) => journal.entries.map((entry) => entry.relativePath))
          )
        ];
        const undone = await versionGroupSession.undoRun({
          runId,
          relativePaths,
          commandId,
          ...(action === "resolve" && reviewId !== undefined
            ? {
                reviewId,
                ...(decisions === undefined ? {} : { decisions }),
                ...(retryFailedOnly === true ? { retryFailedOnly: true } : {})
              }
            : {})
        });
        if (!undone.ok) return undone;
        const accepted =
          undone.value.transactionStatus === "applied" ||
          undone.value.transactionStatus === "awaiting_review" ||
          undone.value.transactionStatus === "partial_failure";
        if (!accepted) {
          return err(versionGroupFailure(undone.value));
        }
        await notifyProjectFilesChanged(
          input.notifyProjectFilesChanged,
          "agent-run-undo",
          versionGroupRelativePaths(undone.value)
        );
        return ok(asJsonObject(undone.value));
      },
      async readRollbackReview({ runId }) {
        const review = await recoveryRepository.readRollbackReview(runId);
        if (!review.ok) return review;
        return ok(review.value === undefined ? undefined : asJsonObject(review.value));
      },
      async recoverRun({ runId }) {
        const recovered = await recover();
        if (!recovered.ok) return recovered;
        const listed = await recoveryRepository.listAgentTransactionJournals();
        if (!listed.ok) return listed;
        const latest = listed.value
          .filter((journal) => journal.kind === "apply" && journal.runId === runId)
          .sort((left, right) => right.runSequence - left.runSequence)[0];
        if (latest === undefined) return ok({ status: "none" as const });
        const status =
          latest.transactionStatus === "applied"
            ? ("applied" as const)
            : latest.transactionStatus === "partial_failure"
              ? ("partial_failure" as const)
              : ("rolled_back" as const);
        return ok({ status, versionGroup: recoveredVersionGroup(latest, status) });
      }
    },
    recoverOnStartup: recover
  };
}

function versionGroupRelativePaths(group: VersionGroup): readonly string[] {
  return [
    ...new Set([
      ...group.writes.map((write) => write.relativePath),
      ...(group.operations ?? []).flatMap((operation) => operation.relativePaths)
    ])
  ];
}

async function notifyProjectFilesChanged(
  notify: DesktopAgentRunSessionOptions["notifyProjectFilesChanged"],
  reason: "agent-change-set-apply" | "agent-run-undo",
  relativePaths: readonly string[]
): Promise<void> {
  if (notify === undefined || relativePaths.length === 0) {
    return;
  }
  try {
    await notify({ reason, relativePaths });
  } catch {
    // The Version Group already committed; search invalidation is retried by later project reads.
  }
}

function recoveredVersionGroup(
  journal: AgentTransactionJournal,
  transactionStatus: "applied" | "rolled_back" | "partial_failure"
): JsonObject {
  return asJsonObject({
    schemaVersion: "1.0",
    versionGroupId: journal.versionGroupId,
    runId: journal.runId,
    checkpointId: journal.checkpointId,
    changeSetId: journal.changeSetId,
    changeSetRevision: journal.changeSetRevision,
    changeSetChecksum: journal.changeSetChecksum,
    ...(journal.writePolicy === undefined ? {} : { writePolicy: journal.writePolicy }),
    ...(journal.approvalSource === undefined ? {} : { approvalSource: journal.approvalSource }),
    transactionStatus,
    writes: journal.entries.map((entry) => ({
      writeId: entry.writeId,
      relativePath: entry.relativePath,
      assetType: entry.assetType,
      beforeChecksum: entry.beforeChecksum,
      afterChecksum: entry.candidateChecksum,
      beforeVersionId: entry.beforeVersionId,
      status: entry.status,
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode })
    })),
    ...(journal.operations === undefined
      ? {}
      : {
          operations: journal.operations.map((entry) => ({
            operationId: entry.operationId,
            kind: entry.operation.kind,
            relativePaths: lifecycleOperationPaths(entry.operation),
            status: entry.status,
            ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode })
          }))
        })
  });
}

function lifecycleOperationPaths(
  operation: NonNullable<AgentTransactionJournal["operations"]>[number]["operation"]
): readonly string[] {
  return operation.kind === "move_file"
    ? [operation.sourcePath, operation.targetPath]
    : [operation.relativePath];
}

async function prepareTransactionInput(
  input: VersionGroupTransactionApplyInput,
  services: {
    readonly projectReads: AgentProjectReadRepository;
    readonly chapterRepository?: ChapterFileRepository;
  }
): Promise<Result<AgentWriteTransactionInput, UnifiedError>> {
  const files: AgentWriteTransactionInput["files"][number][] = [];
  for (const file of input.files) {
    if (file.assetType === "text") {
      files.push(file);
      continue;
    }
    if (file.assetId === undefined) {
      return err(runtimeError("AGENT_WRITE_CHAPTER_ID_MISSING"));
    }
    if (services.chapterRepository === undefined) {
      return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
    }
    const chapter = await services.chapterRepository.readChapter(file.assetId);
    if (!chapter.ok) return chapter;
    if (
      chapter.value.body !== file.baseContent ||
      checksumText(chapter.value.body) !== file.baseChecksum
    ) {
      return err(
        runtimeError("AGENT_WRITE_BASE_CONFLICT", {
          relativePath: file.relativePath,
          baseHashConflictPaths: [file.relativePath]
        })
      );
    }
    const raw = await services.projectReads.readText(file.relativePath);
    if (!raw.ok) return raw;
    const candidateContent = replaceChapterBody(raw.value.content, file.candidateContent);
    if (!candidateContent.ok) return candidateContent;
    files.push({
      relativePath: file.relativePath,
      assetType: "chapter",
      assetId: file.assetId,
      baseChecksum: raw.value.checksum,
      candidateChecksum: checksumText(candidateContent.value),
      baseContent: raw.value.content,
      candidateContent: candidateContent.value,
      historyBaseContent: file.baseContent,
      historyCandidateContent: file.candidateContent
    });
  }
  return ok({
    runId: input.runId,
    checkpointId: input.checkpointId,
    changeSetId: input.changeSetId,
    revision: input.revision,
    checksum: input.checksum,
    writePolicy: input.writePolicy,
    approvalSource: input.approvalSource,
    approvalToken: input.approvalToken,
    files,
    ...(input.operations === undefined ? {} : { operations: input.operations })
  });
}

function replaceChapterBody(
  fileContent: string,
  candidateBody: string
): Result<string, UnifiedError> {
  const frontmatter = /^(---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?)/.exec(fileContent)?.[1];
  return frontmatter === undefined
    ? err(runtimeError("AGENT_WRITE_CHAPTER_INVALID"))
    : ok(`${frontmatter}${candidateBody}`);
}

async function dirtySelectedPaths(
  changeSet: ChangeSet,
  readEditorState: DesktopAgentRunSessionOptions["readEditorState"]
): Promise<string[]> {
  if (readEditorState === undefined) return [];
  const dirty: string[] = [];
  for (const file of changeSet.files.filter((candidate) => candidate.selected)) {
    if ((await readEditorState(file.relativePath))?.dirty === true) {
      dirty.push(file.relativePath);
    }
  }
  return dirty;
}

async function markRecoveryRecordsClean(
  recoveryRepository: RecoveryRepository,
  chapterRepository: ChapterFileRepository,
  projectId: string,
  relativePaths: readonly string[]
): Promise<void> {
  const chapterIds = new Set(
    relativePaths.flatMap((relativePath) => {
      const match = /^chapters\/([A-Za-z0-9_-]+)\.md$/.exec(relativePath);
      return match?.[1] === undefined ? [] : [match[1]];
    })
  );
  if (chapterIds.size === 0) return;
  const records = await recoveryRepository.listRecoveryRecords();
  if (!records.ok) return;
  for (const record of records.value) {
    if (
      record.projectId !== projectId ||
      record.assetType !== "chapter" ||
      !chapterIds.has(record.openAssetId)
    ) {
      continue;
    }
    const chapter = await chapterRepository.readChapter(record.openAssetId);
    if (!chapter.ok) continue;
    await recoveryRepository.writeRecoveryRecord({
      ...record,
      dirty: false,
      draftContentRef: { strategy: "inline", content: chapter.value.body },
      updatedAt: new Date().toISOString()
    });
  }
}

function versionGroupFailure(group: VersionGroup): UnifiedError {
  const partial = group.transactionStatus === "partial_failure";
  const baseHashConflictPaths = group.writes
    .filter((write) => write.errorCode?.includes("BASE_CONFLICT") === true)
    .map((write) => write.relativePath);
  return runtimeError(
    partial
      ? "AGENT_VERSION_GROUP_PARTIAL_FAILURE"
      : group.failureKind === "undo_conflict"
        ? "AGENT_VERSION_GROUP_UNDO_CONFLICT"
        : "AGENT_VERSION_GROUP_WRITE_ROLLED_BACK",
    {
      versionGroupId: group.versionGroupId,
      transactionStatus: group.transactionStatus,
      failureKind: group.failureKind ?? "write_failure",
      baseHashConflictPaths,
      writes: group.writes.map((write) => ({
        relativePath: write.relativePath,
        status: write.status,
        ...(write.errorCode === undefined ? {} : { errorCode: write.errorCode })
      }))
    }
  );
}

function createFailureInjectingLifecycleOperations(
  lifecycle: AgentWriteLifecycleOperationPort,
  failAt: number
): AgentWriteLifecycleOperationPort {
  let applyCount = 0;
  return {
    async mutate(input) {
      if (input.kind === "replace_file" && input.phase === "apply") {
        applyCount += 1;
        if (applyCount === failAt) {
          return err(
            runtimeError("AGENT_WRITE_INJECTED_FAILURE", {
              relativePath: input.relativePath,
              failAt
            })
          );
        }
      }
      return lifecycle.mutate(input);
    }
  };
}

function createFailureInjectingTrustedCreativeMutations(
  mutations: AgentWriteTrustedCreativeMutationPort,
  failAt: number
): AgentWriteTrustedCreativeMutationPort {
  let applyCount = 0;
  return {
    trustLevel: "standard_trusted_creative",
    async replace(input) {
      if (input.phase === "apply") {
        applyCount += 1;
        if (applyCount === failAt) {
          return err(
            runtimeError("AGENT_WRITE_INJECTED_FAILURE", {
              relativePath: input.relativePath,
              failAt
            })
          );
        }
      }
      return mutations.replace(input);
    }
  };
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function runtimeError(code: string, redactedDetail?: JsonObject): UnifiedError {
  const descriptor = runtimeErrorDescriptor(code);
  return createUnifiedError({
    code,
    category: descriptor.category,
    message: descriptor.message,
    recoverability: "user-action",
    suggestedAction: descriptor.suggestedAction,
    traceId: "desktop-agent-run-runtime",
    ...(redactedDetail === undefined ? {} : { redactedDetail })
  });
}

function runtimeErrorDescriptor(code: string): {
  readonly category: "StorageError" | "ValidationError";
  readonly message: string;
  readonly suggestedAction: string;
} {
  if (code === "AGENT_MODEL_CAPABILITY_UNSUPPORTED") {
    return {
      category: "ValidationError",
      message:
        "The selected Agent model does not expose the context capabilities required to start this request.",
      suggestedAction: "Choose a supported model in Settings, refresh its model list, then retry."
    };
  }
  if (code === "AGENT_CONTEXT_MODE_UNAVAILABLE") {
    return {
      category: "ValidationError",
      message: "The selected Agent context mode is not available in the current workspace.",
      suggestedAction:
        "Open a compatible project or choose a context mode supported by this workspace."
    };
  }
  if (code === "AGENT_CONTEXT_STALE") {
    return {
      category: "ValidationError",
      message: "The active project file changed after its saved context was captured.",
      suggestedAction: "Save or reopen the active project file, then retry the Agent request."
    };
  }
  if (code.startsWith("CHANGE_SET_")) {
    return {
      category: "ValidationError",
      message: "The proposed change set no longer matches the current project state.",
      suggestedAction: "Refresh the affected files, review the Change Set, and retry."
    };
  }
  if (code === "AGENT_VERSION_GROUP_PARTIAL_FAILURE") {
    return {
      category: "StorageError",
      message: "Agent writing partially failed and requires transaction recovery review.",
      suggestedAction: "Review the transaction recovery details before making further edits."
    };
  }
  if (code === "AGENT_VERSION_GROUP_WRITE_ROLLED_BACK") {
    return {
      category: "StorageError",
      message: "Agent writing failed and applied files were rolled back.",
      suggestedAction: "Review the Change Set and current files, then retry."
    };
  }
  if (code.includes("WRITE")) {
    return {
      category: "StorageError",
      message: "The Agent could not safely apply the requested file changes.",
      suggestedAction: "Review the affected files and Change Set, then retry."
    };
  }
  return {
    category: "ValidationError",
    message: "The Agent request could not be validated before it started.",
    suggestedAction: "Review the selected model, workspace, and context, then retry."
  };
}

/**
 * The server-authoritative start preflight. Two shapes reach it:
 *  - A draft-only command over IPC (the `toStartAgentRunCommand` guard strips wide fields): reload
 *    the run draft + Context Draft, resolve model facts from the draft's `modelProfileId`, and turn
 *    the Context Draft refs into concrete sources by reading chapter/editor/file/asset content.
 *  - A resolved-intent command from an in-process caller (demo driver, runtime tests): read the
 *    intent directly. The IPC guard makes this branch unreachable from the renderer.
 */
function createDesktopStartPreflight(input: {
  readonly workspaceKind: DesktopAgentRunSessionOptions["workspaceKind"];
  readonly draftSession: AgentRunDraftSession;
  readonly chapterRepository?: ChapterFileRepository;
  readonly projectReads: AgentProjectReadRepository;
  readonly resolveWorkspaceProjectContext: DesktopWorkspaceProjectContextServices["resolve"];
  readonly storyBible?: StoryBibleFileRepository;
  readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
  readonly readCreativeProjectFile?: NonNullable<
    DesktopAgentRunSessionOptions["readCreativeProjectFile"]
  >;
  readonly verifyCreativeGeneralActiveResource?: NonNullable<
    DesktopAgentRunSessionOptions["verifyCreativeGeneralActiveResource"]
  >;
  readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
  readonly resolveModelStartFacts?: NonNullable<
    DesktopAgentRunSessionOptions["resolveModelStartFacts"]
  >;
}): AgentRunStartPreflightPort {
  return {
    async resolveStart(command) {
      const intent = readResolvedIntent(command as StartAgentRunCommand & Record<string, unknown>);
      if (intent !== undefined) {
        if (input.workspaceKind === "engineeringWorkspace" && intent.contextMode === "writing") {
          return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
        }
        const projectContext = await input.resolveWorkspaceProjectContext({
          contextMode: intent.contextMode,
          modelProfileId: intent.model.profileId
        });
        return projectContext.ok
          ? ok({
              ...intent,
              initialContextSources: mergeWorkspaceProjectContextSources(
                projectContext.value.sources,
                intent.initialContextSources
              )
            })
          : projectContext;
      }
      return resolveStartFromDraft(command, input);
    }
  };
}

/**
 * Read a start command that already carries resolved intent (wide fields). Returns undefined when
 * the command is draft-only, deferring to the persisted-draft path.
 */
function readResolvedIntent(
  command: StartAgentRunCommand & Record<string, unknown>
): AgentRunStartFacts | undefined {
  const snapshot = command["providerCapabilitySnapshot"];
  if (
    typeof command["operationMode"] !== "string" ||
    typeof command["userRequest"] !== "string" ||
    !isRecord(snapshot)
  ) {
    return undefined;
  }
  const sources = Array.isArray(command["initialContextSources"])
    ? (command["initialContextSources"] as AgentContextSourceInput[])
    : [];
  return {
    operationMode: command["operationMode"] as AgentRunStartFacts["operationMode"],
    contextMode: (command["contextMode"] as AgentRunStartFacts["contextMode"]) ?? "writing",
    writePolicy:
      (command["writePolicy"] as AgentRunStartFacts["writePolicy"]) ?? "write_before_confirmation",
    writePolicyAcknowledged: command["writePolicyAcknowledged"] === true,
    userRequest: command["userRequest"],
    model: {
      profileId: String(snapshot["profileId"] ?? ""),
      provider: String(snapshot["provider"] ?? ""),
      modelName: String(snapshot["modelName"] ?? ""),
      capabilities: {
        streaming: snapshot["streaming"] === true,
        toolCalling: snapshot["toolCalling"] === true,
        structuredArguments: snapshot["structuredArguments"] === true,
        contextWindow: Number(snapshot["contextWindow"] ?? 0)
      },
      requiredContextTokens: Number(snapshot["requiredContextTokens"] ?? 8000),
      reasoningStrength: { status: "hidden", reason: "resolved-intent start" }
    },
    initialContextSources: sources
  };
}

async function resolveStartFromDraft(
  command: StartAgentRunCommand,
  input: {
    readonly workspaceKind: DesktopAgentRunSessionOptions["workspaceKind"];
    readonly draftSession: AgentRunDraftSession;
    readonly chapterRepository?: ChapterFileRepository;
    readonly projectReads: AgentProjectReadRepository;
    readonly resolveWorkspaceProjectContext: DesktopWorkspaceProjectContextServices["resolve"];
    readonly storyBible?: StoryBibleFileRepository;
    readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
    readonly readCreativeProjectFile?: NonNullable<
      DesktopAgentRunSessionOptions["readCreativeProjectFile"]
    >;
    readonly verifyCreativeGeneralActiveResource?: NonNullable<
      DesktopAgentRunSessionOptions["verifyCreativeGeneralActiveResource"]
    >;
    readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
    readonly resolveModelStartFacts?: NonNullable<
      DesktopAgentRunSessionOptions["resolveModelStartFacts"]
    >;
  }
): Promise<Result<AgentRunStartFacts, UnifiedError>> {
  const workspaceId =
    command.scope?.kind === "workspace" ? command.scope.workspaceId : command.projectId;
  if (
    workspaceId === undefined ||
    command.scope?.kind === "standalone" ||
    (command.projectId !== undefined && command.projectId !== workspaceId)
  ) {
    return err(runtimeError("AGENT_CONTEXT_SCOPE_INVALID"));
  }
  const resolved = await input.draftSession.resolveStartDraft({
    projectId: workspaceId,
    scope: {
      kind: "workspace",
      workspaceKind: input.workspaceKind,
      workspaceId
    },
    conversationId: command.conversationId,
    runDraftId: command.runDraftId,
    runDraftRevision: command.runDraftRevision,
    runDraftChecksum: command.runDraftChecksum
  });
  if (!resolved.ok) return err(resolved.error);
  const { runDraft, contextDraft } = resolved.value;
  if (
    runDraft.scope.kind !== "workspace" ||
    runDraft.scope.workspaceKind !== input.workspaceKind ||
    runDraft.scope.workspaceId !== workspaceId
  ) {
    return err(runtimeError("AGENT_CONTEXT_SCOPE_INVALID"));
  }
  if (input.workspaceKind === "engineeringWorkspace" && runDraft.contextMode === "writing") {
    return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
  }
  if (input.workspaceKind === "creativeProject" && runDraft.contextMode === "general_file") {
    if (input.verifyCreativeGeneralActiveResource === undefined) {
      return err(runtimeError("AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED"));
    }
    const verified = await input.verifyCreativeGeneralActiveResource(
      contextDraft.activeResourceRef
    );
    if (!verified.ok) return verified;
  }
  if (input.resolveModelStartFacts === undefined) {
    return err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED"));
  }
  const model = await input.resolveModelStartFacts(runDraft.modelProfileId, runDraft.modelName);
  if (model === undefined) {
    return err(
      runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED", {
        profileId: runDraft.modelProfileId,
        modelName: runDraft.modelName ?? null,
        missingCapabilities: ["modelProfile"]
      })
    );
  }
  const sources = await resolveContextDraftSources(contextDraft.refs, {
    ...input,
    projectId: workspaceId,
    contextMode: contextDraft.contextMode,
    activeResourceRef: contextDraft.activeResourceRef
  });
  if (!sources.ok) return err(sources.error);
  const projectContext = await input.resolveWorkspaceProjectContext({
    contextMode: runDraft.contextMode,
    modelProfileId: runDraft.modelProfileId
  });
  if (!projectContext.ok) return err(projectContext.error);
  return ok({
    scope: {
      kind: "workspace",
      workspaceKind: input.workspaceKind,
      workspaceId
    },
    operationMode: runDraft.operationMode,
    contextMode: runDraft.contextMode,
    writePolicy: runDraft.writePolicy,
    writePolicyAcknowledged: runDraft.writePolicyAcknowledged,
    userRequest: runDraft.userRequest,
    ...(runDraft.reasoningEffort === undefined
      ? {}
      : { requestedReasoningEffort: runDraft.reasoningEffort }),
    model,
    initialContextSources: mergeWorkspaceProjectContextSources(
      projectContext.value.sources,
      sources.value
    )
  });
}

function mergeWorkspaceProjectContextSources(
  projectSources: readonly AgentContextSourceInput[],
  dynamicSources: readonly AgentContextSourceInput[]
): readonly AgentContextSourceInput[] {
  return [
    ...projectSources,
    ...dynamicSources.filter(
      (source) =>
        source.sourceKind !== "project_conventions" && source.sourceKind !== "workspace_outline"
    )
  ];
}

/** Read manual refs followed by the active file, freezing each body from Main-owned storage. */
async function resolveContextDraftSources(
  refs: readonly ContextDraftRef[],
  input: {
    readonly chapterRepository?: ChapterFileRepository;
    readonly projectReads: AgentProjectReadRepository;
    readonly storyBible?: StoryBibleFileRepository;
    readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
    readonly readCreativeProjectFile?: NonNullable<
      DesktopAgentRunSessionOptions["readCreativeProjectFile"]
    >;
    readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
    readonly projectId?: string;
    readonly workspaceKind: DesktopAgentRunSessionOptions["workspaceKind"];
    readonly contextMode: "standalone_chat" | "writing" | "general_file";
    readonly activeResourceRef?: Extract<ContextDraftRef, { readonly kind: "project_file" }> | null;
  }
): Promise<Result<AgentContextSourceInput[], UnifiedError>> {
  const sources: AgentContextSourceInput[] = [];
  const activeResourceRef = input.activeResourceRef ?? null;
  const manualRefs =
    activeResourceRef === null ? refs : refs.filter((ref) => ref.refId !== activeResourceRef.refId);
  for (const ref of manualRefs) {
    if (ref.kind === "chapter") {
      if (input.chapterRepository === undefined) {
        return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
      }
      const refId = `chapter:${ref.chapterId}`;
      const relativePath = `chapters/${ref.chapterId}.md`;
      const editorState = await input.readEditorState?.(relativePath);
      const buffered = editorState?.dirty
        ? editorState.content
        : editorState === undefined
          ? await input.readEditorBuffer?.(refId)
          : undefined;
      if (buffered !== undefined) {
        sources.push({
          refId,
          sourceKind: "editor_buffer",
          relativePath,
          content: buffered,
          dirty: true
        });
        continue;
      }
      const chapter = await input.chapterRepository.readChapter(ref.chapterId);
      if (!chapter.ok) return err(chapter.error);
      sources.push({
        refId,
        sourceKind: "disk_file",
        relativePath,
        content: chapter.value.body,
        dirty: false
      });
      continue;
    }
    if (ref.kind === "project_file" && ref.relativePath !== undefined) {
      const read =
        input.workspaceKind === "creativeProject"
          ? await input.readCreativeProjectFile?.(ref.relativePath)
          : await input.projectReads.readText(ref.relativePath);
      if (read === undefined) return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
      if (!read.ok) return err(read.error);
      sources.push({
        refId: ref.refId,
        sourceKind: "disk_file",
        relativePath: ref.relativePath,
        content: read.value.content,
        dirty: false
      });
      continue;
    }
    if (ref.kind === "story_bible" && ref.assetId !== undefined) {
      if (input.storyBible === undefined) {
        return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
      }
      const asset = await findStoryBibleAsset(input.storyBible, ref.assetId);
      if (!asset.ok) return err(asset.error);
      sources.push({
        refId: ref.refId,
        sourceKind: "disk_file",
        assetId: ref.assetId,
        content: JSON.stringify(asset.value),
        dirty: false
      });
    }
  }
  if (activeResourceRef !== null) {
    const activeSource = await resolveActiveCreativeProjectFileSource(activeResourceRef, input);
    if (!activeSource.ok) return err(activeSource.error);
    // The current file must stay in the dynamic prompt suffix after the request and manual refs.
    sources.push(activeSource.value);
  }
  return ok(sources);
}

async function resolveActiveCreativeProjectFileSource(
  ref: Extract<ContextDraftRef, { readonly kind: "project_file" }>,
  input: {
    readonly projectId?: string;
    readonly readCreativeProjectFile?: NonNullable<
      DesktopAgentRunSessionOptions["readCreativeProjectFile"]
    >;
    readonly workspaceKind: DesktopAgentRunSessionOptions["workspaceKind"];
    readonly contextMode: "standalone_chat" | "writing" | "general_file";
  }
): Promise<Result<AgentContextSourceInput, UnifiedError>> {
  const expectedChecksum = ref.expectedChecksum;
  if (
    input.workspaceKind !== "creativeProject" ||
    input.contextMode !== "general_file" ||
    input.readCreativeProjectFile === undefined
  ) {
    return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
  }
  if (!isExpectedDiskChecksum(expectedChecksum)) {
    return err(activeProjectFileStaleError("expected_checksum_missing"));
  }

  // The active creative-file session owns both the current project identity and the file policy.
  const read = await input.readCreativeProjectFile(ref.relativePath);
  if (!read.ok) return err(read.error);
  if (
    (input.projectId !== undefined && read.value.workspaceId !== input.projectId) ||
    read.value.path !== ref.relativePath ||
    read.value.checksum !== expectedChecksum
  ) {
    return err(activeProjectFileStaleError("disk_checksum_or_identity_mismatch"));
  }
  return ok({
    refId: ref.refId,
    sourceKind: "disk_file",
    relativePath: read.value.path,
    content: read.value.content,
    dirty: false
  });
}

function isExpectedDiskChecksum(value: string | undefined): value is string {
  return value !== undefined && /^[a-f0-9]{64}$/u.test(value);
}

function activeProjectFileStaleError(reason: string): UnifiedError {
  return runtimeError("AGENT_CONTEXT_STALE", {
    contextSource: "active_project_file",
    reason
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDesktopAdaptiveAgentDriver(input: {
  readonly scriptedDriver: AgentRunModelDriver;
  readonly resolveModelProfile: NonNullable<DesktopAgentRunSessionOptions["resolveModelProfile"]>;
  readonly createAgentModelDriver: NonNullable<
    DesktopAgentRunSessionOptions["createAgentModelDriver"]
  >;
}): AgentRunModelDriver {
  return {
    async *streamRound(roundInput) {
      if (roundInput.snapshot.providerCapabilitySnapshot.provider === "demo") {
        yield* input.scriptedDriver.streamRound(roundInput);
        return;
      }
      const profile = await input.resolveModelProfile(
        roundInput.snapshot.providerCapabilitySnapshot.profileId,
        roundInput.snapshot.providerCapabilitySnapshot.modelName
      );
      if (profile === undefined) {
        throw new Error("The selected Agent model profile is unavailable.");
      }
      const driver = input.createAgentModelDriver({
        ...profile,
        promptCacheScopeKey: agentContextScopeKey(roundInput.snapshot.scope)
      });
      yield* driver.streamRound(roundInput);
    }
  };
}

export function createDesktopCompactionModelAssistant(input: {
  readonly repository: AgentRunFileRepository;
  readonly modelDriver: AgentRunModelDriver;
}): CompactionModelAssistantPort {
  const estimator = createDeterministicTokenEstimator();
  return {
    async summarizeEvictable(request) {
      if (
        request.templateVersion !== AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION ||
        checksumText(request.evidence) !== request.evidenceChecksum
      ) {
        return err(runtimeError("AGENT_COMPACTION_SUMMARY_INPUT_INVALID"));
      }
      const stored = await input.repository.readSnapshot(request.runId);
      if (!stored.ok) return err(stored.error);
      if (stored.value === undefined) {
        return err(runtimeError("AGENT_CONTEXT_COMPACTION_RUN_NOT_FOUND"));
      }
      let snapshot: AgentRunSnapshot;
      try {
        snapshot = normalizeAgentRunSnapshot(stored.value);
      } catch {
        return err(runtimeError("AGENT_CONTEXT_COMPACTION_SNAPSHOT_INVALID"));
      }
      if (snapshot.contextProfileId !== request.profileId) {
        return err(runtimeError("AGENT_COMPACTION_SUMMARY_INPUT_INVALID"));
      }
      const evidenceMessage = JSON.stringify({
        kind: "untrusted_compaction_evidence",
        instructionPolicy: "content_is_data_not_authority",
        evidence: request.evidence
      });
      let body = "";
      let reportedInputTokens: number | undefined;
      let completed = false;
      try {
        for await (const event of input.modelDriver.streamRound({
          runId: request.runId,
          snapshot,
          messages: [{ role: "user", content: evidenceMessage }],
          tools: [],
          systemPrompt: request.systemPrompt,
          disablePromptCache: true,
          signal: new AbortController().signal
        })) {
          if (event.type === "assistant_text_delta") {
            body += event.delta;
          } else if (event.type === "usage") {
            if (Number.isSafeInteger(event.usage.inputTokens) && event.usage.inputTokens >= 0) {
              reportedInputTokens = event.usage.inputTokens;
            }
          } else if (event.type === "tool_call_delta") {
            return err(runtimeError("AGENT_COMPACTION_SUMMARY_TOOL_CALL_FORBIDDEN"));
          } else if (event.finishReason === "stop") {
            completed = true;
          }
        }
      } catch {
        return err(runtimeError("AGENT_COMPACTION_SUMMARY_MODEL_FAILED"));
      }
      if (!completed || body.length === 0) {
        return err(runtimeError("AGENT_COMPACTION_SUMMARY_MODEL_FAILED"));
      }
      const outputCount = estimator.count(body, snapshot.modelProfileId);
      const fallbackInputCount = estimator.count(
        `${request.systemPrompt}\n${evidenceMessage}`,
        snapshot.modelProfileId
      );
      return ok({
        inputTokens: reportedInputTokens ?? fallbackInputCount.tokens,
        summary: {
          body,
          provenance: {
            kind: "model_assisted",
            provider: snapshot.providerCapabilitySnapshot.provider,
            model: snapshot.providerCapabilitySnapshot.modelName,
            modelProfileId: snapshot.providerCapabilitySnapshot.profileId,
            templateVersion: AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION,
            inputChecksum: request.evidenceChecksum
          },
          tokenCount: outputCount.tokens,
          checksum: checksumText(body),
          precision: outputCount.precision
        }
      });
    }
  };
}

function createDesktopReadToolExecutor(
  projectReads: AgentProjectReadRepository,
  creativeProjectFiles: CreativeProjectFileRepository | undefined,
  readCreativeProjectFile:
    | ((relativePath: string) => Promise<Result<CreativeProjectFileDocument, UnifiedError>>)
    | undefined,
  chapterRepository: ChapterFileRepository | undefined,
  storyBible: StoryBibleFileRepository | undefined
): AgentReadToolExecutor {
  return {
    async execute(input) {
      if (input.name === "list_project_entries") {
        const relativeDirectory = readOptionalString(input.arguments, "path") ?? "";
        const listed =
          creativeProjectFiles !== undefined
            ? await listCreativeProjectFileEntries(creativeProjectFiles, relativeDirectory)
            : await projectReads.listEntries(relativeDirectory);
        return listed.ok
          ? ok({
              summary: `已列出 ${relativeDirectory || "项目根目录"} 的 ${listed.value.length} 个条目`,
              data: asJsonObject({ entries: listed.value })
            })
          : listed;
      }
      if (input.name === "read_chapter") {
        if (chapterRepository === undefined) {
          return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
        }
        const chapterId = readRequiredId(input.arguments, "chapterId");
        if (chapterId === undefined) return invalidToolArguments(input.name);
        const relativePath = `chapters/${chapterId}.md`;
        const chapter = await chapterRepository.readChapter(chapterId);
        return chapter.ok
          ? ok({
              summary: `已读取章节 ${chapterId}`,
              data: {
                content: chapter.value.body,
                checksum: checksumText(chapter.value.body)
              },
              source: {
                refId: `chapter:${chapterId}`,
                sourceKind: "disk_file",
                relativePath,
                content: chapter.value.body,
                dirty: false
              }
            })
          : chapter;
      }
      if (input.name === "read_project_text") {
        const relativePath = readOptionalString(input.arguments, "path");
        if (relativePath === undefined) return invalidToolArguments(input.name);
        if (readCreativeProjectFile !== undefined) {
          const read = await readCreativeProjectFile(relativePath);
          return read.ok
            ? ok({
                summary: `已读取 ${relativePath}`,
                data: { content: read.value.content, checksum: read.value.checksum },
                source: {
                  refId: `file:${relativePath}`,
                  sourceKind: "disk_file" as const,
                  relativePath,
                  content: read.value.content,
                  dirty: false
                }
              })
            : read;
        }
        const read = await projectReads.readText(relativePath);
        return read.ok
          ? ok({
              summary: `已读取 ${relativePath}`,
              data: { content: read.value.content, checksum: read.value.checksum },
              source: {
                refId: `file:${relativePath}`,
                sourceKind: "disk_file",
                relativePath,
                content: read.value.content,
                dirty: false
              }
            })
          : read;
      }
      if (input.name === "read_story_bible") {
        if (storyBible === undefined) {
          return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
        }
        const assetId = readRequiredId(input.arguments, "assetId");
        if (assetId === undefined) return invalidToolArguments(input.name);
        const asset = await findStoryBibleAsset(storyBible, assetId);
        if (!asset.ok) return asset;
        const relativePath = resolveStoryBibleAssetRelativePath(asset.value);
        if (!relativePath.ok) return relativePath;
        const read = await projectReads.readText(relativePath.value);
        if (!read.ok) return read;
        return ok({
          summary: `已读取 Story Bible 资产 ${assetId}`,
          data: {
            asset: asset.value,
            content: read.value.content,
            checksum: read.value.checksum
          },
          source: {
            refId: `story_bible:${assetId}`,
            sourceKind: "story_bible_asset",
            assetId,
            relativePath: relativePath.value,
            content: read.value.content,
            dirty: false
          }
        });
      }
      return invalidToolArguments(input.name);
    }
  };
}

async function listCreativeProjectFileEntries(
  repository: CreativeProjectFileRepository,
  relativeDirectory: string
) {
  if (
    relativeDirectory.length > 0 &&
    !normalizeCreativeProjectFilePath(relativeDirectory, "directory").ok
  ) {
    return err(runtimeError("AGENT_PROJECT_PATH_REJECTED"));
  }
  const snapshot = await repository.getTreeSnapshot();
  if (!snapshot.ok) return snapshot;
  const nodes =
    relativeDirectory.length === 0
      ? snapshot.value.nodes
      : findCreativeProjectFileNode(snapshot.value.nodes, relativeDirectory)?.children;
  if (nodes === undefined) return err(runtimeError("AGENT_PROJECT_PATH_REJECTED"));
  return ok(
    nodes.map((node) => ({
      name: node.name,
      relativePath: node.path,
      kind: node.kind
    }))
  );
}

function findCreativeProjectFileNode(
  nodes: readonly import("@novel-studio/repository").CreativeProjectFileTreeNode[],
  path: string
): import("@novel-studio/repository").CreativeProjectFileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findCreativeProjectFileNode(node.children ?? [], path);
    if (child !== undefined) return child;
  }
  return undefined;
}

function routeCreativeSearch(
  generalFileExecutor: AgentSearchToolExecutor
): AgentSearchToolExecutor {
  return {
    async searchText(input) {
      return filterCreativeSearchResult(await generalFileExecutor.searchText(input));
    },
    async findReferences(input) {
      const path = input.stableRef.startsWith("file:")
        ? input.stableRef.slice("file:".length)
        : input.stableRef;
      const allowed = normalizeCreativeProjectFilePath(path, "file");
      if (!allowed.ok) return allowed;
      return filterCreativeSearchResult(await generalFileExecutor.findReferences(input));
    }
  };
}

function filterCreativeSearchResult(
  result: Awaited<ReturnType<AgentSearchToolExecutor["searchText"]>>
): Awaited<ReturnType<AgentSearchToolExecutor["searchText"]>> {
  if (!result.ok) return result;
  const items = result.value.items.filter(
    (item) => normalizeCreativeProjectFilePath(item.relativePath, "file").ok
  );
  return ok({
    ...result.value,
    items,
    totalHits: items.length,
    truncated: result.value.truncated || items.length !== result.value.items.length
  });
}

function createDesktopScriptedAgentDriver(
  activeChapterId: string | undefined
): AgentRunModelDriver {
  return {
    async *streamRound(input: AgentModelRoundInput): AsyncIterable<AgentModelStreamEvent> {
      const toolResultCount = input.messages.filter((message) => message.role === "tool").length;
      if (toolResultCount === 0) {
        yield { type: "assistant_text_delta", delta: "我会先读取项目结构和当前章节。" };
        yield toolCall("desktop_list_entries", "list_project_entries", {
          path: ""
        });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (
        toolResultCount === 1 &&
        input.snapshot.contextMode === "writing" &&
        activeChapterId !== undefined
      ) {
        const usesV2 = input.tools.some((tool) => tool.name === "read_resource");
        yield usesV2
          ? toolCall("desktop_read_chapter", "read_resource", {
              ref: `chapter:${activeChapterId}`
            })
          : toolCall("desktop_read_chapter", "read_chapter", { chapterId: activeChapterId });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (input.snapshot.operationMode === "planning") {
        const targetRefs =
          activeChapterId === undefined
            ? []
            : [{ refId: `chapter:${activeChapterId}`, intent: "按用户目标规划修订" }];
        yield toolCall("desktop_finish_plan", "finish_plan", {
          planId: `plan_${input.runId}`,
          goal: input.snapshot.userRequest,
          successCriteria: ["完成只读上下文核对"],
          nonGoals: ["本次规划不修改任何项目文件"],
          facts: ["已读取项目结构和当前章节"],
          assumptions: [],
          openQuestions: [],
          targetRefs,
          steps: [
            {
              stepId: "step_review_chapter",
              title: "复核当前章节",
              verification: "重新读取并核对目标与上下文"
            }
          ],
          risks: ["执行前上下文可能变化"],
          verification: ["执行前刷新 Context Snapshot"],
          sourceRefs: targetRefs.map((target) => target.refId)
        });
      } else {
        yield toolCall("desktop_finish", "finish", { summary: "只读 Agent run 已完成。" });
      }
      yield { type: "round_completed", finishReason: "tool_calls" };
    }
  };
}

function toolCall(toolCallId: string, name: string, argumentsValue: JsonObject) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(argumentsValue)
  };
}

async function findStoryBibleAsset(repository: StoryBibleFileRepository, assetId: string) {
  const snapshot = await repository.readStoryBible();
  if (!snapshot.ok) return snapshot;
  const assets = [
    ...snapshot.value.characters,
    ...snapshot.value.worldAssets,
    ...(snapshot.value.outline === undefined ? [] : [snapshot.value.outline]),
    ...(snapshot.value.timeline === undefined ? [] : [snapshot.value.timeline])
  ];
  const asset = assets.find((candidate) => candidate.id === assetId);
  return asset === undefined
    ? err(
        createUnifiedError({
          code: "AGENT_STORY_BIBLE_ASSET_NOT_FOUND",
          category: "ValidationError",
          message: "The Story Bible asset does not exist.",
          recoverability: "user-action",
          suggestedAction: "Choose an existing Story Bible asset ID.",
          traceId: "desktop-agent-run-runtime"
        })
      )
    : ok(asset);
}

function resolveStoryBibleAssetRelativePath(asset: {
  readonly id: string;
  readonly type: string;
}): Result<string, UnifiedError> {
  switch (asset.type) {
    case "character":
      return ok(`characters/${asset.id}.json`);
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
      return ok(`world/${asset.id}.json`);
    case "outline":
      return ok("outline/outline.json");
    case "timeline.events":
      return ok("timeline/events.json");
    default:
      return err(
        createUnifiedError({
          code: "AGENT_STORY_BIBLE_ASSET_TYPE_INVALID",
          category: "ValidationError",
          message: "The Story Bible asset type is not editable.",
          recoverability: "user-action",
          suggestedAction: "Refresh the Story Bible and choose a supported asset.",
          traceId: "desktop-agent-run-runtime"
        })
      );
  }
}

function invalidToolArguments(name: string) {
  return err(
    createUnifiedError({
      code: "AGENT_TOOL_ARGUMENTS_INVALID",
      category: "ValidationError",
      message: `Arguments for ${name} are invalid.`,
      recoverability: "user-action",
      suggestedAction: "Use the documented project-relative arguments.",
      traceId: "desktop-agent-run-runtime"
    })
  );
}

function readOptionalString(value: JsonObject, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function readRequiredId(value: JsonObject, key: string): string | undefined {
  const candidate = readOptionalString(value, key);
  return candidate !== undefined && /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : undefined;
}

function asJsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}
