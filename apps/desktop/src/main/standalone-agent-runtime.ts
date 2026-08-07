import { createHash, randomBytes } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  createAgentContextSession,
  createAgentConversationSession,
  createAgentPlanExecutionSession,
  createAgentPricingRegistry,
  createAgentRunDraftSession,
  createAgentRunSession,
  createAgentSendPreviewSession,
  createAgentUsageSession,
  buildAgentSystemPrompt,
  canonicalAgentFirstRoundSemanticPayloadChecksumV2,
  materializeCanonicalAgentRound,
  materializeAgentPrompt,
  readResolvedContextBudgetUsageLimits,
  resolveBudgetInputs as resolveCanonicalBudgetInputs,
  resolveAgentContextProfile,
  type AgentContextBudgetInputs,
  type AgentContextBudgetInputsPort,
  type AgentConversationLifecyclePort,
  type AgentConversationPersistencePort,
  type AgentFirstRoundSemanticPayloadV2,
  type AgentPermissionSession,
  type AgentRunDraftSession,
  type AgentRunModelDriver,
  type AgentRunStartFacts,
  type AgentRunStartModelFacts,
  type AgentRunStartPreflightPort,
  type AgentSendPreviewDtoV2,
  type AgentSendPreviewPreparedMaterialV2,
  type AgentSendPreviewValidationFactsV2,
  type ConfirmAgentSendPreviewCommandV2
} from "@novel-studio/application";
import {
  STANDALONE_AGENT_CONTEXT_SCOPE,
  agentContextScopeKey,
  computeAgentRunToolCatalogRevision,
  createProviderSemanticVersionSetV1,
  createEffectiveCapabilityState,
  freezeAgentToolCapabilitySnapshot,
  normalizeAgentRunSnapshot,
  serializeCanonicalRoundManifestV2,
  validateAgentRunToolCatalogSnapshot,
  type AgentContextScope,
  type AgentRunSnapshot,
  type StartAgentRunCommand,
  type AgentUsageRecord
} from "@novel-studio/agent-engine";
import type { LlmModelProfile, LlmParameters } from "@novel-studio/llm-adapter";
import {
  AgentConversationFileRepository,
  AgentRunFileRepository,
  AgentUsageFileRepository
} from "@novel-studio/repository";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type { DesktopStandaloneAgentRuntime } from "./agent-runtime-manager.js";
import { createDesktopCompactionSources } from "./agent-compaction-composer.js";
import { createDesktopCompactionModelAssistant } from "./agent-run-runtime.js";

/**
 * Application-owned storage segment for conversations that are intentionally not attached to a
 * project. This is never accepted from the renderer and therefore cannot be redirected into a
 * workspace state root.
 */
export const STANDALONE_AGENT_STATE_DIRECTORY = join("agent", "standalone");

export interface StandaloneAgentStateRoot {
  readonly scopeId: "standalone";
  readonly stateRoot: string;
}

export interface CreateStandaloneAgentRuntimeOptions {
  readonly userDataRoot: string;
  readonly createRuntime: (
    state: StandaloneAgentStateRoot
  ) => DesktopStandaloneAgentRuntime | Promise<DesktopStandaloneAgentRuntime>;
}

/**
 * Main-owned model dependencies for the application-scoped conversation runtime. The type has no
 * project, root, file, network, or tool ports by design.
 */
export interface StandaloneAgentModelPorts {
  /** A test host or an already-adapted provider driver may supply the complete text stream. */
  readonly modelDriver?: AgentRunModelDriver;
  /** Production resolves the selected stored model profile through this Main-owned port. */
  readonly resolveModelProfile?: (
    profileId: string,
    modelName?: string
  ) => Promise<
    | {
        readonly modelProfile: LlmModelProfile;
        readonly parameters?: LlmParameters;
      }
    | undefined
  >;
  /** Creates a provider driver only after Main has resolved the profile above. */
  readonly createAgentModelDriver?: (input: {
    readonly modelProfile: LlmModelProfile;
    readonly parameters?: LlmParameters;
    readonly promptCacheScopeKey?: string;
  }) => AgentRunModelDriver;
  /** Server-authoritative capability facts for the selected text model. */
  readonly resolveModelStartFacts?: (
    profileId: string,
    modelName?: string
  ) => Promise<AgentRunStartModelFacts | undefined>;
  /** Optional Main-owned resource cleanup for a provider transport. */
  readonly dispose?: () => void;
  /** Invalidates Main-owned Provider cache resources when standalone is hidden or disposed. */
  readonly releasePromptCacheScope?: () => void;
}

export interface CreateDesktopStandaloneAgentRuntimeOptions extends StandaloneAgentModelPorts {
  readonly userDataRoot: string;
  readonly now?: () => string;
  readonly createRunId?: () => string;
  readonly createConversationId?: (commandId: string) => string;
  readonly createDraftId?: () => string;
  /** Main-owned rollout gate; false unless explicitly enabled by the host. */
  readonly agentGuidanceV3?: boolean;
}

/**
 * Immutable standalone-only facts used by the composition and focused tests. The v2 revision is
 * deliberately computed from an empty descriptor list: it is not a disabled workspace catalog.
 */
export const STANDALONE_AGENT_SCOPE = STANDALONE_AGENT_CONTEXT_SCOPE;
export const STANDALONE_EMPTY_TOOL_CATALOG = Object.freeze({
  facadeVersion: "v2" as const,
  descriptors: Object.freeze([]),
  catalogRevision: computeAgentRunToolCatalogRevision("v2", [])
});

const STANDALONE_CAPABILITY_SNAPSHOT = freezeAgentToolCapabilitySnapshot({
  // AgentToolCapabilitySnapshot predates application scope and has no standalone enum. This value
  // is never exposed as workspace identity; listAgentTools rejects standalone_chat before reading it.
  workspaceKind: "creativeProject",
  searchEnabled: false,
  fileLifecycleEnabled: false,
  controlledExecutionEnabled: false,
  gitReadEnabled: false,
  networkReadEnabled: false,
  pluginToolsEnabled: false,
  mcpToolsEnabled: false,
  featureFlagRevision: "standalone-empty-v2"
});

/**
 * Derive the sole standalone state root from Electron's user-data directory. Both roots are
 * canonicalised after creation and the child relationship is checked again so a symlink cannot
 * redirect standalone records into an opened workspace.
 */
export async function resolveStandaloneAgentStateRoot(
  userDataRoot: string
): Promise<Result<StandaloneAgentStateRoot, UnifiedError>> {
  if (
    typeof userDataRoot !== "string" ||
    userDataRoot.trim().length === 0 ||
    !isAbsolute(userDataRoot)
  ) {
    return err(standaloneRuntimeError("AGENT_STANDALONE_STATE_ROOT_INVALID"));
  }

  try {
    const requestedUserDataRoot = resolve(userDataRoot);
    await mkdir(requestedUserDataRoot, { recursive: true });
    const canonicalUserDataRoot = await realpath(requestedUserDataRoot);
    const requestedStateRoot = resolve(canonicalUserDataRoot, STANDALONE_AGENT_STATE_DIRECTORY);
    if (!isNestedPath(canonicalUserDataRoot, requestedStateRoot)) {
      return err(standaloneRuntimeError("AGENT_STANDALONE_STATE_ROOT_INVALID"));
    }

    await mkdir(requestedStateRoot, { recursive: true });
    const canonicalStateRoot = await realpath(requestedStateRoot);
    if (!isNestedPath(canonicalUserDataRoot, canonicalStateRoot)) {
      return err(standaloneRuntimeError("AGENT_STANDALONE_STATE_ROOT_INVALID"));
    }
    return ok({ scopeId: "standalone", stateRoot: canonicalStateRoot });
  } catch {
    return err(standaloneRuntimeError("AGENT_STANDALONE_STATE_ROOT_UNAVAILABLE"));
  }
}

/**
 * Compose a standalone runtime from the guarded state root. The callback receives only the
 * application-owned scope/root pair; it cannot receive a workspace root, project ID, or renderer
 * path. Main should pass this function directly to the runtime-manager factory.
 */
export async function createStandaloneAgentRuntime(
  options: CreateStandaloneAgentRuntimeOptions
): Promise<Result<DesktopStandaloneAgentRuntime, UnifiedError>> {
  const state = await resolveStandaloneAgentStateRoot(options.userDataRoot);
  if (!state.ok) return state;
  try {
    const runtime = await options.createRuntime(state.value);
    if (runtime.scopeId === "standalone") return ok(runtime);
    runtime.dispose?.();
    return err(standaloneRuntimeError("AGENT_STANDALONE_RUNTIME_INVALID"));
  } catch {
    return err(standaloneRuntimeError("AGENT_STANDALONE_RUNTIME_CREATE_FAILED"));
  }
}

/**
 * Compose the real persistent standalone runtime. This path intentionally does not import or
 * construct a workspace application, project reader, file mutation backend, Change Set service,
 * shell/task/Git executor, network client, or MCP transport. All state is below the guarded
 * application-owned root and all model access enters through explicit ports above.
 */
export async function createDesktopStandaloneAgentRuntime(
  options: CreateDesktopStandaloneAgentRuntimeOptions
): Promise<Result<DesktopStandaloneAgentRuntime, UnifiedError>> {
  const state = await resolveStandaloneAgentStateRoot(options.userDataRoot);
  if (!state.ok) return state;

  try {
    return ok(composeDesktopStandaloneAgentRuntime(state.value, options));
  } catch {
    return err(standaloneRuntimeError("AGENT_STANDALONE_RUNTIME_CREATE_FAILED"));
  }
}

function composeDesktopStandaloneAgentRuntime(
  state: StandaloneAgentStateRoot,
  options: CreateDesktopStandaloneAgentRuntimeOptions
): DesktopStandaloneAgentRuntime {
  const scope = STANDALONE_AGENT_SCOPE;
  const runRepository = new AgentRunFileRepository({
    projectRoot: state.stateRoot,
    traceId: "desktop-standalone-agent-run-store"
  });
  const conversationRepository = new AgentConversationFileRepository({
    projectRoot: state.stateRoot,
    scope,
    traceId: "desktop-standalone-agent-conversation-store"
  });
  // AgentUsageFileRepository names this root after its original application-level location. Passing
  // the dedicated standalone state root preserves the required scope isolation.
  const usageRepository = new AgentUsageFileRepository({
    userDataRoot: state.stateRoot,
    traceId: "desktop-standalone-agent-usage-store"
  });
  const now = options.now ?? (() => new Date().toISOString());
  const usageTime = () => standaloneUsageTime(now);
  const pricingRegistry = createAgentPricingRegistry({ version: "stage-5-default", entries: [] });
  const modelDriver = createStandaloneModelDriver(options);
  const conversationPersistence = createStandaloneConversationPersistence(conversationRepository);

  const conversationSession = createAgentConversationSession({
    scope,
    repository: conversationPersistence,
    runReader: {
      // Workspace compatibility callers cannot accidentally enumerate standalone records.
      async listRunSnapshots() {
        return err(standaloneRuntimeError("AGENT_STANDALONE_SCOPE_REQUIRED"));
      },
      async listRunSnapshotsForScope(requestedScope) {
        const listed = await listStandaloneRunSnapshots(runRepository, requestedScope);
        return listed.ok
          ? ok(listed.value.map((snapshot) => snapshot as unknown as JsonObject))
          : err(listed.error);
      },
      readRunEvents: (runId) => readStandaloneConversationRunEvents(runRepository, runId),
      async hasPendingReview() {
        return err(standaloneRuntimeError("AGENT_STANDALONE_SCOPE_REQUIRED"));
      },
      async hasPendingReviewForScope(input) {
        if (!sameStandaloneScope(input.scope)) {
          return err(standaloneRuntimeError("AGENT_STANDALONE_SCOPE_MISMATCH"));
        }
        const listed = await listStandaloneRunSnapshots(runRepository, input.scope);
        if (!listed.ok) return listed;
        for (const snapshot of listed.value) {
          if (snapshot.conversationId !== input.conversationId) continue;
          if (
            snapshot.status === "awaiting_user_input" ||
            snapshot.status === "awaiting_write_approval" ||
            snapshot.status === "awaiting_plan_revision" ||
            snapshot.status === "applying_changes" ||
            snapshot.status === "stopping_after_transaction"
          ) {
            return ok(true);
          }
        }
        return ok(false);
      }
    },
    ...(options.createConversationId === undefined
      ? {}
      : { createConversationId: options.createConversationId }),
    now
  });
  const draftSession = createAgentRunDraftSession({
    repository: {
      writeRunDraft: (draft) => conversationRepository.writeRunDraft(draft),
      readLatestRunDraft: (conversationId) =>
        conversationRepository.readLatestRunDraft(conversationId),
      writeContextDraft: (draft) => conversationRepository.writeContextDraft(draft),
      readLatestContextDraft: (conversationId) =>
        conversationRepository.readLatestContextDraft(conversationId)
    },
    scope,
    ...(options.createDraftId === undefined ? {} : { createId: options.createDraftId }),
    now
  });
  const contextSession = createAgentContextSession({
    draftSession,
    budgetInputs: createStandaloneBudgetInputs(options, (conversationId) =>
      conversationSession.loadContext({ scope, conversationId })
    ),
    compactionSources: createDesktopCompactionSources({
      repository: runRepository,
      pricingRegistry,
      usageTime,
      now
    }),
    runRepository: {
      writeCompactionManifest: (manifest) => runRepository.writeCompactionManifest(manifest),
      writeCompactionRevision: (revision) => runRepository.writeCompactionRevision(revision),
      writeCompactionSummaryArtifact: (runId, artifact) =>
        runRepository.writeCompactionSummaryArtifact(runId, artifact),
      readCompactionSummaryArtifact: (runId, artifactId) =>
        runRepository.readCompactionSummaryArtifact(runId, artifactId),
      writePromptMaterialization: (runId, artifact) =>
        runRepository.writePromptMaterialization(runId, artifact),
      writeContextSnapshot: (snapshot) => runRepository.writeContextSnapshot(snapshot),
      writeBudgetSnapshot: (runId, snapshot) => runRepository.writeBudgetSnapshot(runId, snapshot),
      commitCompaction: (snapshot) => runRepository.commitCompaction(snapshot),
      writeCommandReceipt: (runId, commandId, receipt) =>
        runRepository.writeCommandReceipt(runId, `compaction_${commandId}`, receipt),
      readCommandReceipt: (runId, commandId) =>
        runRepository.readCommandReceipt(runId, `compaction_${commandId}`),
      readSnapshot: (runId) => runRepository.readSnapshot(runId),
      readCompactionRevision: (runId, compactionId) =>
        runRepository.readCompactionRevision(runId, compactionId)
    },
    usageSink: {
      writeFinal: (record) => usageRepository.writeFinal(record)
    },
    modelAssistant: createDesktopCompactionModelAssistant({
      repository: runRepository,
      modelDriver
    }),
    now
  });
  const planExecutionSession = createAgentPlanExecutionSession({ repository: runRepository, now });
  const usageSession = createAgentUsageSession({
    repository: usageRepository,
    now: () => usageTime().timestamp,
    todayLocalDate: () => usageTime().localDate
  });
  const conversationLifecycle: AgentConversationLifecyclePort = {
    async assertRunMayStart(input) {
      const result = await conversationSession.assertRunMayStart({
        scope: requireStandaloneScope(input.scope),
        conversationId: input.conversationId
      });
      return result.ok ? ok(result.value as unknown as JsonObject) : err(result.error);
    },
    cancelRunStart(input) {
      return conversationSession.cancelRunStart({
        scope: requireStandaloneScope(input.scope),
        conversationId: input.conversationId
      });
    },
    async loadContext(input) {
      const result = await conversationSession.loadContext({
        scope: requireStandaloneScope(input.scope),
        conversationId: input.conversationId
      });
      return result;
    },
    async noteRunStarted(snapshot) {
      const result = await conversationSession.noteRunStarted(snapshot as never);
      return result.ok ? ok(undefined) : err(result.error);
    },
    noteRunTerminal: (snapshot) => conversationSession.noteRunTerminal(snapshot as never)
  };
  const startPreflight = createStandaloneStartPreflight({
    draftSession,
    modelPorts: options
  });
  const session = createAgentRunSession({
    scope,
    repository: runRepository,
    modelDriver,
    readToolExecutor: {
      async execute() {
        return err(standaloneRuntimeError("AGENT_STANDALONE_TOOL_FORBIDDEN"));
      }
    },
    startPreflight,
    newRunToolFacadeVersion: "v2",
    agentGuidanceV3: options.agentGuidanceV3 === true,
    capabilitySnapshot: STANDALONE_CAPABILITY_SNAPSHOT,
    effectiveCapabilityState: createEffectiveCapabilityState(STANDALONE_CAPABILITY_SNAPSHOT),
    usageSink: {
      async writeFinal(record: AgentUsageRecord) {
        const written = await usageRepository.writeFinal(record as unknown as JsonObject);
        return written.ok ? ok(written.value as unknown as AgentUsageRecord) : err(written.error);
      }
    },
    usageMetricSink: usageSession,
    pricingRegistry,
    usageTime,
    usageBudgetResolver: (snapshot: AgentRunSnapshot) =>
      resolveStandaloneUsageBudget(runRepository, snapshot),
    conversationLifecycle,
    contextCompactor: contextSession,
    contextSourceReader: {
      async readCurrentSources() {
        return ok([]);
      }
    },
    // No permission, Change Set, lifecycle, search, task, Git, network, or external-tool port is
    // passed. The v2 catalog has already been frozen empty for standalone_chat.
    coordinatorOptions: {
      ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
      now
    }
  });
  const previewBindings = new Map<string, StandaloneSendPreviewBinding>();
  const latestPreviewBindingByDraft = new Map<string, StandaloneSendPreviewBinding>();
  const startCommandsByReservedRun = new Map<string, StartAgentRunCommand>();
  const materializePreview = async (binding: StandaloneSendPreviewBinding) =>
    materializeStandaloneSendPreview({
      binding,
      draftSession,
      conversationSession,
      startPreflight
    });
  const agentSendPreviewSession = createAgentSendPreviewSession<AgentRunSnapshot>({
    materializer: {
      async materializeFirstRound(command) {
        const binding = previewBindings.get(command.commandId);
        if (binding === undefined) return err(standaloneRuntimeError("AGENT_SEND_PREVIEW_INVALID"));
        const materialized = await materializePreview(binding);
        if (materialized.ok) {
          latestPreviewBindingByDraft.set(command.runDraftId, binding);
          startCommandsByReservedRun.set(binding.reservedRunId, binding.startCommand);
        }
        return materialized;
      },
      async resolveCurrentValidationFacts(input) {
        const binding = latestPreviewBindingByDraft.get(input.runDraftId);
        if (binding === undefined) return err(standaloneRuntimeError("AGENT_SEND_PREVIEW_STALE"));
        const materialized = await materializePreview(binding);
        return materialized.ok ? ok(materialized.value.validationFacts) : materialized;
      }
    },
    async sendFrozenFirstRound(input) {
      const startCommand = startCommandsByReservedRun.get(
        input.validationFacts.target.connectionId
      );
      if (startCommand === undefined)
        return err(standaloneRuntimeError("AGENT_SEND_PREVIEW_STALE"));
      // The standalone surface has no project context or tools. Its run session independently
      // re-resolves the same immutable draft before the provider receives the first round.
      return session.startAgentRun(startCommand);
    },
    now,
    traceId: "desktop-standalone-agent-send-preview"
  });
  const prepareAgentSendPreview = async (command: {
    readonly schemaVersion: "2.0";
    readonly commandId: string;
    readonly startCommand: StartAgentRunCommand;
  }): Promise<Result<AgentSendPreviewDtoV2, UnifiedError>> => {
    if (!isValidStandalonePreviewStart(command)) {
      return err(standaloneRuntimeError("AGENT_SEND_PREVIEW_INVALID"));
    }
    const binding: StandaloneSendPreviewBinding = {
      commandId: command.commandId,
      startCommand: command.startCommand,
      reservedRunId: `agent_run_preview_${randomBytes(12).toString("hex")}`
    };
    previewBindings.set(command.commandId, binding);
    const prepared = await agentSendPreviewSession.preparePreview({
      schemaVersion: "2.0",
      commandId: command.commandId,
      runDraftId: command.startCommand.runDraftId,
      expectedRunDraftRevision: command.startCommand.runDraftRevision,
      runDraftChecksum: command.startCommand.runDraftChecksum
    });
    if (!prepared.ok) previewBindings.delete(command.commandId);
    return prepared;
  };
  const confirmAgentSendPreview = async (
    command: ConfirmAgentSendPreviewCommandV2
  ): Promise<Result<AgentRunSnapshot, UnifiedError>> => {
    const confirmed = await agentSendPreviewSession.confirmAndSend(command);
    return confirmed.ok ? ok(confirmed.value.value) : confirmed;
  };

  let disposed = false;
  let prepareResult: Promise<Result<void, UnifiedError>> | undefined;
  const prepare = () =>
    (prepareResult ??= (async () => {
      if (disposed) return err(standaloneRuntimeError("AGENT_STANDALONE_RUNTIME_DISPOSED"));
      return usageRepository.enforceRetention(localDateFor(now()));
    })());
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.releasePromptCacheScope?.();
    options.dispose?.();
  };

  return {
    scopeId: "standalone",
    stateRoot: state.stateRoot,
    agentRunSession: session,
    agentConversationSession: conversationSession,
    agentRunDraftSession: draftSession,
    agentContextSession: contextSession,
    agentPermissionSession: createUnavailableStandalonePermissionSession(),
    agentPlanExecutionSession: planExecutionSession,
    agentUsageSession: usageSession,
    prepareAgentSendPreview,
    confirmAgentSendPreview,
    prepare,
    listRunSnapshots: () => listStandaloneRunSnapshots(runRepository, scope),
    ...(options.releasePromptCacheScope === undefined
      ? {}
      : { releasePromptCacheResources: options.releasePromptCacheScope }),
    dispose
  };
}

interface StandaloneSendPreviewBinding {
  readonly commandId: string;
  readonly startCommand: StartAgentRunCommand;
  /** Main-owned nonce; also binds the preview to the only start command it may confirm. */
  readonly reservedRunId: string;
}

function isValidStandalonePreviewStart(value: {
  readonly schemaVersion: "2.0";
  readonly commandId: string;
  readonly startCommand: StartAgentRunCommand;
}): boolean {
  const command = value.startCommand;
  return (
    value.schemaVersion === "2.0" &&
    isMachineToken(value.commandId) &&
    isMachineToken(command.commandId) &&
    isMachineToken(command.conversationId) &&
    isMachineToken(command.runDraftId) &&
    Number.isSafeInteger(command.runDraftRevision) &&
    command.runDraftRevision >= 0 &&
    isSha256(command.runDraftChecksum) &&
    sameStandaloneScope(command.scope) &&
    command.projectId === undefined
  );
}

async function materializeStandaloneSendPreview(input: {
  readonly binding: StandaloneSendPreviewBinding;
  readonly draftSession: AgentRunDraftSession;
  readonly conversationSession: ReturnType<typeof createAgentConversationSession>;
  readonly startPreflight: AgentRunStartPreflightPort;
}): Promise<Result<AgentSendPreviewPreparedMaterialV2, UnifiedError>> {
  const start = input.binding.startCommand;
  const draft = await input.draftSession.resolveStartDraft({
    scope: STANDALONE_AGENT_SCOPE,
    conversationId: start.conversationId,
    runDraftId: start.runDraftId,
    runDraftRevision: start.runDraftRevision,
    runDraftChecksum: start.runDraftChecksum
  });
  if (!draft.ok) return draft;
  const facts = await input.startPreflight.resolveStart(start);
  if (!facts.ok) return facts;
  const profile = resolveAgentContextProfile(
    STANDALONE_AGENT_SCOPE,
    "conversation",
    "standalone_chat"
  );
  const conversation = await input.conversationSession.loadContext({
    scope: STANDALONE_AGENT_SCOPE,
    conversationId: start.conversationId
  });
  if (!conversation.ok) return conversation;
  const providerSemanticVersionSet = createProviderSemanticVersionSetV1({
    writingTaskIntentSchemaVersion: "not_applicable",
    writingGenerationGuidanceVersion: "not_applicable",
    approvalRuleSetVersion: "not_applicable",
    approvalRuleSetChecksum: "not_applicable"
  });
  const systemPrompt = buildAgentSystemPrompt(profile);
  const canonical = materializeCanonicalAgentRound({
    roundId: `round_${input.binding.reservedRunId}_0`,
    runId: input.binding.reservedRunId,
    roundNumber: 0,
    profile,
    systemPrompt,
    toolCatalogRevision: STANDALONE_EMPTY_TOOL_CATALOG.catalogRevision,
    userRequest: facts.value.userRequest,
    conversationSummaryMessages: conversation.value,
    projectedToolDescriptors: [],
    sharing: { defaultsRevision: "not_applicable", runGrantRevision: "not_applicable" },
    providerSemanticVersionSet
  });
  const semanticPayload = standaloneSemanticPayload(canonical);
  const payloadChecksum = canonicalAgentFirstRoundSemanticPayloadChecksumV2(semanticPayload);
  const manifest = canonical.canonicalRoundManifest;
  const target = {
    providerId: standaloneMachineIdentity(facts.value.model.provider, "provider"),
    modelId: standaloneMachineIdentity(facts.value.model.modelName, "model"),
    connectionId: input.binding.reservedRunId,
    accountIdentityChecksum: standaloneChecksum("account-identity-unavailable"),
    adapterPolicyRevision: "standalone-llm-adapter-v2",
    adapterPolicyChecksum: standaloneChecksum("standalone-llm-adapter-v2")
  };
  const validationFacts: AgentSendPreviewValidationFactsV2 = {
    schemaVersion: "2.0",
    scopeBindingChecksum: standaloneChecksum(agentContextScopeKey(STANDALONE_AGENT_SCOPE)),
    runDraftId: start.runDraftId,
    runDraftRevision: start.runDraftRevision,
    runDraftChecksum: start.runDraftChecksum,
    requestRevision: String(start.runDraftRevision),
    requestChecksum: standaloneChecksum(facts.value.userRequest),
    target,
    sourceBindings: [],
    sharingDefaultsRevision: "not_applicable",
    sharingGrantRevision: "not_applicable",
    sharingGrantChecksum: "not_applicable",
    taskIntentChecksum: "not_applicable",
    capabilityRevision: "standalone-empty-v2",
    capabilityChecksum: standaloneChecksum(STANDALONE_EMPTY_TOOL_CATALOG.catalogRevision),
    toolProjectionRevision: manifest.tools.catalogRevision,
    toolProjectionChecksum: manifest.tools.projectionChecksum,
    providerSemanticVersionSetChecksum: manifest.providerSemanticVersionSetChecksum,
    canonicalRoundManifestChecksum: manifest.manifestChecksum,
    canonicalPayloadChecksum: payloadChecksum
  };
  return ok({
    semanticPayload,
    canonicalRoundManifestJson: serializeCanonicalRoundManifestV2(manifest),
    validationFacts,
    display: {
      schemaVersion: "2.0",
      target: {
        providerLabel: facts.value.model.provider,
        modelLabel: facts.value.model.modelName,
        connectionLabel: facts.value.model.profileId,
        adapterPolicyLabel: "standalone-llm-adapter-v2"
      },
      guidance: {
        version: "2.0",
        profileId: profile.profileId,
        runtimeFacts: { scope: "standalone", tools: "none" }
      },
      sources: [],
      retainedLocalProvenanceKinds: ["provider_account_identity"],
      providerNativeSemanticChecksum: null
    }
  });
}

function standaloneSemanticPayload(
  canonical: ReturnType<typeof materializeCanonicalAgentRound>
): AgentFirstRoundSemanticPayloadV2 {
  return {
    schemaVersion: "2.0",
    systemPrompt: canonical.prompt.systemPrompt,
    messages: canonical.canonicalRoundManifest.messages.map((message) => {
      if (message.role === "assistant") {
        return {
          schemaVersion: "2.0" as const,
          role: "assistant" as const,
          content: message.content,
          toolCalls: message.toolCalls.map((call) => ({
            schemaVersion: "2.0" as const,
            toolCallId: call.id,
            name: call.name,
            argumentsText: call.arguments
          }))
        };
      }
      if (message.role === "tool") {
        if (message.toolCallId === null) throw new Error("AGENT_SEND_PREVIEW_INVALID");
        return {
          schemaVersion: "2.0" as const,
          role: "tool" as const,
          content: message.content,
          toolCallId: message.toolCallId
        };
      }
      return { schemaVersion: "2.0" as const, role: "user" as const, content: message.content };
    }),
    tools: [],
    parameters: {}
  };
}

function standaloneChecksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function standaloneMachineIdentity(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:@/-]/gu, "_").slice(0, 256);
  return isMachineToken(normalized) ? normalized : fallback;
}

function isMachineToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function createStandaloneConversationPersistence(
  repository: AgentConversationFileRepository
): AgentConversationPersistencePort {
  return {
    createConversation: (record) => repository.createConversation(record as never),
    readConversation: (conversationId, scope) => repository.readConversation(conversationId, scope),
    listConversations: (input) => repository.listConversations(input),
    updateConversation: (input) => repository.updateConversation(input as never),
    writeCommandReceipt: (conversationId, commandId, receipt, scope) =>
      repository.writeCommandReceipt(conversationId, commandId, receipt, scope),
    readCommandReceipt: (conversationId, commandId, scope) =>
      repository.readCommandReceipt(conversationId, commandId, scope),
    readLatestSummary: (conversationId) => repository.readLatestSummary(conversationId),
    writeSummary: (summary) => repository.writeSummary(summary as never),
    searchConversations: (input) => repository.searchConversations(input as never)
  };
}

function createStandaloneStartPreflight(input: {
  readonly draftSession: AgentRunDraftSession;
  readonly modelPorts: StandaloneAgentModelPorts;
}): AgentRunStartPreflightPort {
  return {
    async resolveStart(command) {
      if (!sameStandaloneScope(command.scope) || command.projectId !== undefined) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_SCOPE_MISMATCH"));
      }
      if (
        input.modelPorts.modelDriver === undefined &&
        (input.modelPorts.resolveModelProfile === undefined ||
          input.modelPorts.createAgentModelDriver === undefined)
      ) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_MODEL_UNAVAILABLE"));
      }
      if (input.modelPorts.resolveModelStartFacts === undefined) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_MODEL_UNAVAILABLE"));
      }
      const draft = await input.draftSession.resolveStartDraft({
        scope: STANDALONE_AGENT_SCOPE,
        conversationId: command.conversationId,
        runDraftId: command.runDraftId,
        runDraftRevision: command.runDraftRevision,
        runDraftChecksum: command.runDraftChecksum
      } as Parameters<AgentRunDraftSession["resolveStartDraft"]>[0]);
      if (!draft.ok) return err(draft.error);
      const runDraft = draft.value.runDraft;
      const contextDraft = draft.value.contextDraft;
      if (
        !sameStandaloneScope(runDraft.scope) ||
        !sameStandaloneScope(contextDraft.scope) ||
        runDraft.operationMode !== "conversation" ||
        runDraft.contextMode !== "standalone_chat" ||
        contextDraft.contextMode !== "standalone_chat" ||
        runDraft.writePolicy !== "write_before_confirmation" ||
        runDraft.writePolicyAcknowledged ||
        contextDraft.refs.length !== 0 ||
        contextDraft.activeResourceRef !== null
      ) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_DRAFT_INVALID"));
      }
      const model = await input.modelPorts.resolveModelStartFacts(
        runDraft.modelProfileId,
        runDraft.modelName
      );
      if (model === undefined) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_MODEL_UNAVAILABLE"));
      }
      const facts: AgentRunStartFacts = {
        scope: STANDALONE_AGENT_SCOPE,
        operationMode: "conversation",
        contextMode: "standalone_chat",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        userRequest: runDraft.userRequest,
        model,
        initialContextSources: []
      };
      return ok(facts);
    }
  };
}

function createStandaloneBudgetInputs(
  modelPorts: StandaloneAgentModelPorts,
  loadConversationContext: (conversationId: string) => Promise<
    Result<
      readonly {
        readonly role: "system" | "user" | "assistant" | "tool";
        readonly content: string;
      }[],
      UnifiedError
    >
  >
): AgentContextBudgetInputsPort {
  return {
    async resolveBudgetInputs(input) {
      if (
        !sameStandaloneScope(input.scope) ||
        input.projectId !== undefined ||
        !sameStandaloneScope(input.draft.scope) ||
        !sameStandaloneScope(input.contextDraft.scope) ||
        input.draft.operationMode !== "conversation" ||
        input.draft.contextMode !== "standalone_chat" ||
        input.contextDraft.contextMode !== "standalone_chat" ||
        input.contextDraft.refs.length !== 0 ||
        input.contextDraft.activeResourceRef !== null ||
        modelPorts.resolveModelStartFacts === undefined
      ) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_DRAFT_INVALID"));
      }
      const model = await modelPorts.resolveModelStartFacts(
        input.draft.modelProfileId,
        input.draft.modelName
      );
      if (model === undefined) {
        return err(standaloneRuntimeError("AGENT_STANDALONE_MODEL_UNAVAILABLE"));
      }
      const profile = resolveAgentContextProfile(
        STANDALONE_AGENT_SCOPE,
        "conversation",
        "standalone_chat"
      );
      const catalogRevision = STANDALONE_EMPTY_TOOL_CATALOG.catalogRevision;
      const systemPrompt = buildAgentSystemPrompt(profile);
      const conversation = await loadConversationContext(input.conversationId);
      if (!conversation.ok) return err(conversation.error);
      const prompt = materializeAgentPrompt({
        profile,
        systemPrompt,
        toolCatalogRevision: catalogRevision,
        userRequest: input.draft.userRequest,
        conversationSummaryMessages: conversation.value
      });
      const resolved = resolveCanonicalBudgetInputs({
        provider: model.provider,
        model: model.modelName,
        modelProfileId: input.draft.modelProfileId,
        ...(model.capabilities.contextWindow === undefined
          ? {}
          : { contextWindow: model.capabilities.contextWindow }),
        requiredContextTokens: model.requiredContextTokens,
        profile,
        prompt,
        contextSources: [],
        toolCatalog: STANDALONE_EMPTY_TOOL_CATALOG
      });
      if (!resolved.ok) return err(resolved.error);
      const budget: AgentContextBudgetInputs = {
        model: {
          provider: model.provider,
          model: model.modelName,
          contextWindow: resolved.value.contextWindow,
          toolReserve: resolved.value.toolReserve,
          systemReserve: resolved.value.systemReserve,
          requiredContextTokens: model.requiredContextTokens
        },
        contents: [],
        resolved: resolved.value,
        // Standalone has no project sources, but packed-context preview still requires a complete
        // Main-owned packing tuple before the renderer may bind it to a run start.
        profile,
        modelProfileId: input.draft.modelProfileId,
        activeSources: [],
        excludedSources: []
      };
      return ok(budget);
    }
  };
}

async function resolveStandaloneUsageBudget(
  repository: AgentRunFileRepository,
  snapshot: AgentRunSnapshot
) {
  const budgetId = snapshot.contextBudgetSnapshotId;
  const catalogSnapshotId = snapshot.toolCatalogSnapshotId;
  const catalogRevision = snapshot.toolCatalogRevision;
  const facadeVersion = snapshot.toolFacadeVersion;
  if (
    budgetId === null ||
    typeof catalogSnapshotId !== "string" ||
    catalogRevision === null ||
    catalogRevision === undefined ||
    (facadeVersion !== "v1" && facadeVersion !== "v2")
  ) {
    return err(standaloneRuntimeError("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
  }
  const storedCatalog = await repository.readToolCatalog(snapshot.runId, catalogSnapshotId);
  if (!storedCatalog.ok || storedCatalog.value === undefined) {
    return err(standaloneRuntimeError("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
  }
  const catalog = validateAgentRunToolCatalogSnapshot(storedCatalog.value);
  if (
    !catalog.ok ||
    catalog.value.runId !== snapshot.runId ||
    catalog.value.toolCatalogSnapshotId !== catalogSnapshotId ||
    catalog.value.catalogRevision !== catalogRevision ||
    catalog.value.facadeVersion !== facadeVersion
  ) {
    return err(standaloneRuntimeError("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
  }
  const stored = await repository.readBudgetSnapshot(snapshot.runId, budgetId);
  if (!stored.ok) return err(stored.error);
  if (stored.value === undefined) {
    return err(standaloneRuntimeError("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
  }
  return readResolvedContextBudgetUsageLimits(stored.value, {
    contextBudgetSnapshotId: budgetId,
    provider: snapshot.providerCapabilitySnapshot.provider,
    model: snapshot.providerCapabilitySnapshot.modelName,
    modelProfileId: snapshot.providerCapabilitySnapshot.profileId,
    contextWindow: snapshot.providerCapabilitySnapshot.contextWindow,
    facadeVersion,
    schemaVersion: catalog.value.schemaVersion,
    catalogRevision
  });
}

function createStandaloneModelDriver(options: StandaloneAgentModelPorts): AgentRunModelDriver {
  if (options.modelDriver !== undefined) return options.modelDriver;
  return {
    async *streamRound(input) {
      if (
        options.resolveModelProfile === undefined ||
        options.createAgentModelDriver === undefined
      ) {
        throw new Error("AGENT_STANDALONE_MODEL_UNAVAILABLE");
      }
      const profile = await options.resolveModelProfile(
        input.snapshot.providerCapabilitySnapshot.profileId,
        input.snapshot.providerCapabilitySnapshot.modelName
      );
      if (profile === undefined) throw new Error("AGENT_STANDALONE_MODEL_UNAVAILABLE");
      yield* options
        .createAgentModelDriver({
          ...profile,
          promptCacheScopeKey: agentContextScopeKey(input.snapshot.scope)
        })
        .streamRound(input);
    }
  };
}

function createUnavailableStandalonePermissionSession(): AgentPermissionSession {
  const unavailable = () => err(standaloneRuntimeError("AGENT_STANDALONE_PERMISSION_UNAVAILABLE"));
  return {
    prepareForDraft: async () => unavailable(),
    verifyForStart: async () => unavailable(),
    prepareForPlanHandoff: async () => unavailable(),
    bindToRun: async () => unavailable(),
    readForRun: async () => unavailable()
  };
}

async function listStandaloneRunSnapshots(
  repository: AgentRunFileRepository,
  scope: AgentContextScope
): Promise<Result<readonly AgentRunSnapshot[], UnifiedError>> {
  if (!sameStandaloneScope(scope)) {
    return err(standaloneRuntimeError("AGENT_STANDALONE_SCOPE_MISMATCH"));
  }
  const listed = await repository.listSnapshots();
  if (!listed.ok) return listed;
  const snapshots: AgentRunSnapshot[] = [];
  for (const candidate of listed.value) {
    try {
      const normalized = normalizeAgentRunSnapshot(candidate);
      if (sameStandaloneScope(normalized.scope)) snapshots.push(normalized);
    } catch {
      return err(standaloneRuntimeError("AGENT_STANDALONE_RUN_RECORD_INVALID"));
    }
  }
  return ok(snapshots);
}

function sameStandaloneScope(scope: AgentContextScope | undefined): boolean {
  return (
    scope !== undefined &&
    agentContextScopeKey(scope) === agentContextScopeKey(STANDALONE_AGENT_SCOPE)
  );
}

function requireStandaloneScope(scope: AgentContextScope | undefined): AgentContextScope {
  if (!sameStandaloneScope(scope)) throw standaloneRuntimeError("AGENT_STANDALONE_SCOPE_MISMATCH");
  return STANDALONE_AGENT_SCOPE;
}

function localDateFor(timestamp: string): string {
  const current = new Date(timestamp);
  const year = String(current.getFullYear()).padStart(4, "0");
  const month = String(current.getMonth() + 1).padStart(2, "0");
  const day = String(current.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function standaloneUsageTime(now: () => string) {
  const current = new Date(now());
  return {
    timestamp: current.toISOString(),
    localDate: localDateFor(current.toISOString()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    utcOffsetMinutes: -current.getTimezoneOffset()
  };
}

function isNestedPath(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith("..\\") &&
    !relativePath.startsWith("../") &&
    !isAbsolute(relativePath)
  );
}

async function readStandaloneConversationRunEvents(
  repository: AgentRunFileRepository,
  runId: string
): Promise<Result<JsonObject[], UnifiedError>> {
  const snapshot = await repository.readSnapshotV20(runId);
  if (snapshot.ok && snapshot.value !== undefined) {
    const events = await repository.readEventsV20(runId);
    return events.ok ? ok(events.value as unknown as JsonObject[]) : err(events.error);
  }
  if (!snapshot.ok && snapshot.error.code === "AGENT_RUN_SNAPSHOT_V20_LEGACY_RECORD") {
    return repository.readEvents(runId);
  }
  return snapshot.ok
    ? err(standaloneRuntimeError("AGENT_RUN_NOT_FOUND"))
    : err(snapshot.error);
}

function standaloneRuntimeError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: "Standalone Agent storage could not be initialized.",
    recoverability: "user-action",
    suggestedAction: "Check the application data directory and retry.",
    traceId: "desktop-standalone-agent-runtime"
  });
}
