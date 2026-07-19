import {
  createAgentConversationSession,
  createAgentContextSession,
  createAgentPricingRegistry,
  createAgentPermissionSession,
  createAgentPlanExecutionSession,
  createAgentRunDraftSession,
  createAgentRunSession,
  createAgentUsageSession,
  createChangeSetSession,
  createVersionGroupSession,
  estimateAgentSystemReserveTokens,
  type AgentContextBudgetInputs,
  type AgentContextBudgetInputsPort,
  type AgentContextSession,
  type AgentPermissionSession,
  type AgentPlanExecutionSession,
  type AgentModelRoundInput,
  type AgentModelStreamEvent,
  type AgentConversationLifecyclePort,
  type AgentConversationPersistencePort,
  type AgentConversationSession,
  type AgentReadToolExecutor,
  type AgentRunModelDriver,
  type AgentRunSession,
  type AgentRunStartFacts,
  type AgentRunStartModelFacts,
  type AgentRunStartPreflightPort,
  type AgentPricingRegistry,
  type AgentUsageTimeFacts,
  type AgentUsageSession,
  type AgentVersionGroupExecutor,
  type VersionGroupSessionTransactionPort,
  type VersionGroupTransactionApplyInput
} from "@novel-studio/application";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createDesktopCompactionSources } from "./agent-compaction-composer.js";
import type { LlmModelProfile, LlmParameters } from "@novel-studio/llm-adapter";
import type {
  AgentContextSourceInput,
  AgentRunSnapshot,
  AgentUsageRecord,
  AgentToolName,
  ChangeSet,
  StartAgentRunCommand,
  VersionGroup
} from "@novel-studio/agent-engine";
import { calculateContextBudget } from "@novel-studio/agent-engine";
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
  AgentProjectReadRepository,
  AgentRunFileRepository,
  AgentUsageFileRepository,
  ChapterFileRepository,
  HistoryRepository,
  ProjectLockFileRepository,
  RecoveryRepository,
  StoryBibleFileRepository,
  validateWithSchema,
  writeTextAtomically,
  type AgentTransactionJournal,
  type AgentConversationRecord,
  type AgentWriteReplaceInput,
  type AgentWriteTransactionInput,
  type UpdateAgentConversationRecordInput
} from "@novel-studio/repository";

export interface DesktopAgentRunSessionOptions {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly projectId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly activeChapterId?: string;
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
    profileId: string
  ) => Promise<
    { readonly modelProfile: LlmModelProfile; readonly parameters?: LlmParameters } | undefined
  >;
  readonly createAgentModelDriver?: (input: {
    readonly modelProfile: LlmModelProfile;
    readonly parameters?: LlmParameters;
  }) => AgentRunModelDriver;
  readonly resolveModelStartFacts?: (
    profileId: string
  ) => Promise<AgentRunStartModelFacts | undefined>;
  readonly readEditorBuffer?: (refId: string) => Promise<string | undefined>;
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
  readonly surfaceTransactionRecoveryReview?: (group: VersionGroup) => Promise<void>;
  readonly projectLockOwnerId?: string;
  readonly failAgentWriteAt?: number;
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

function createDesktopAgentRuntimeServices(
  options: DesktopAgentRunSessionOptions,
  enforceConversationBinding: boolean
): DesktopAgentRuntimeServices {
  const projectReads = new AgentProjectReadRepository({
    projectRoot: options.contentRoot,
    traceId: "desktop-agent-project-read"
  });
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
    traceId: "desktop-agent-conversation-store"
  });
  const chapterRepository =
    options.workspaceKind === "creativeProject"
      ? new ChapterFileRepository({
          projectRoot: options.contentRoot,
          traceId: "desktop-agent-chapter"
        })
      : undefined;
  const readToolExecutor = createDesktopReadToolExecutor(
    projectReads,
    chapterRepository,
    storyBible
  );
  const changeSetSession = createDesktopChangeSetSession({
    projectId: options.projectId,
    projectReads,
    ...(chapterRepository === undefined ? {} : { chapterRepository }),
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
          ...(options.surfaceTransactionRecoveryReview === undefined
            ? {}
            : { surfaceTransactionRecoveryReview: options.surfaceTransactionRecoveryReview }),
          ...(options.failAgentWriteAt === undefined
            ? {}
            : { failAgentWriteAt: options.failAgentWriteAt })
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
    ...(storyBible === undefined ? {} : { storyBible }),
    ...(options.readEditorBuffer === undefined
      ? {}
      : { readEditorBuffer: options.readEditorBuffer }),
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
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const planExecutionSession = createAgentPlanExecutionSession({ repository });
  const session = createAgentRunSession({
    repository,
    modelDriver,
    readToolExecutor,
    startPreflight,
    permission: permissionSession,
    planExecutionSession,
    changeSetSession,
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
            resolveDesktopUsageBudget(repository, snapshot, options.now)
        }),
    ...(enforceConversationBinding ? { conversationLifecycle } : {}),
    ...(versionGroupServices === undefined
      ? {}
      : { versionGroupExecutor: versionGroupServices.executor }),
    contextSourceReader: {
      async readCurrentSources(input) {
        const current: { refId: string; content: string }[] = [];
        for (const source of input.sources) {
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
            if (!asset.ok) return asset;
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
  const contextSession = createDesktopAgentContextSession({
    draftSession,
    repository,
    ...(usageRepository === undefined ? {} : { usageRepository }),
    ...(chapterRepository === undefined ? {} : { chapterRepository }),
    projectReads,
    ...(storyBible === undefined ? {} : { storyBible }),
    ...(options.pricingRegistry === undefined ? {} : { pricingRegistry: options.pricingRegistry }),
    ...(options.usageTime === undefined ? {} : { usageTime: options.usageTime }),
    ...(options.readEditorBuffer === undefined
      ? {}
      : { readEditorBuffer: options.readEditorBuffer }),
    ...(options.readEditorState === undefined ? {} : { readEditorState: options.readEditorState }),
    ...(options.resolveModelStartFacts === undefined
      ? {}
      : { resolveModelStartFacts: options.resolveModelStartFacts }),
    ...(options.now === undefined ? {} : { now: options.now })
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
    prepare
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
  snapshot: AgentRunSnapshot,
  now?: () => string
) {
  if (snapshot.contextBudgetSnapshotId !== null) {
    const stored = await repository.readBudgetSnapshot(
      snapshot.runId,
      snapshot.contextBudgetSnapshotId
    );
    if (!stored.ok) return err(stored.error);
    if (stored.value !== undefined) {
      const contextWindow = readUsageTokenCount(stored.value["contextWindow"]);
      const safeInputBudget = readUsageTokenCount(stored.value["safeInputBudget"]);
      if (contextWindow !== undefined && safeInputBudget !== undefined) {
        return ok({ contextWindow, safeInputBudget });
      }
    }
  }
  const capability = snapshot.providerCapabilitySnapshot;
  const calculated = calculateContextBudget({
    contextBudgetSnapshotId: `usage_budget_${snapshot.runId}_${snapshot.lastSequence}`,
    provider: capability.provider,
    model: capability.modelName,
    contextWindow: capability.contextWindow,
    toolReserve: 0,
    systemReserve: estimateAgentSystemReserveTokens(snapshot.contextMode),
    requiredContextTokens: capability.requiredContextTokens,
    usedTokens: 0,
    precision: "unknown",
    calculatedAt: now?.() ?? new Date().toISOString()
  });
  return calculated.ok
    ? ok({
        contextWindow: calculated.value.contextWindow,
        safeInputBudget: calculated.value.safeInputBudget
      })
    : err(calculated.error);
}

function readUsageTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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
 * ref content server-side (renderer previews are never trusted), so the session stays pure arithmetic
 * over already-resolved material. `toolReserve`/`systemReserve` are 0 until Task 1.7 counts the
 * system-guidance/tool-schema tokens. Compaction is wired only when a usage sink exists (i.e.
 * `userDataRoot` was threaded in): the run repository owns the revision/result/budget artifacts and the
 * pointer-last commit marker, the usage repository owns the redacted final record. Without a usage sink
 * `compactContext` returns its `AGENT_CONTEXT_COMPACTION_UNAVAILABLE` guard.
 */
function createDesktopAgentContextSession(input: {
  readonly draftSession: AgentRunDraftSession;
  readonly repository: AgentRunFileRepository;
  readonly usageRepository?: AgentUsageFileRepository;
  readonly chapterRepository?: ChapterFileRepository;
  readonly projectReads: AgentProjectReadRepository;
  readonly storyBible?: StoryBibleFileRepository;
  readonly pricingRegistry?: AgentPricingRegistry;
  readonly usageTime?: () => AgentUsageTimeFacts;
  readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
  readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
  readonly resolveModelStartFacts?: NonNullable<
    DesktopAgentRunSessionOptions["resolveModelStartFacts"]
  >;
  readonly now?: () => string;
}): AgentContextSession {
  const budgetInputs: AgentContextBudgetInputsPort = {
    async resolveBudgetInputs({ draft, contextDraft }) {
      if (input.resolveModelStartFacts === undefined) {
        return err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED"));
      }
      const model = await input.resolveModelStartFacts(draft.modelProfileId);
      if (model === undefined) {
        return err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED"));
      }
      const sources = await resolveContextDraftSources(contextDraft.refs, input);
      if (!sources.ok) return err(sources.error);
      const inputs: AgentContextBudgetInputs = {
        model: {
          provider: model.provider,
          model: model.modelName,
          contextWindow: model.capabilities.contextWindow ?? 0,
          toolReserve: 0,
          // Count the mode-specific system guidance the run will inject (Task 1.7) so the safe input
          // budget reserves room for it. The estimator here mirrors the deterministic fallback the
          // session uses; a provider tokenizer would refine it without changing the accounting shape.
          systemReserve: estimateAgentSystemReserveTokens(draft.contextMode),
          requiredContextTokens: model.requiredContextTokens
        },
        contents: sources.value.map((source) => ({
          refId: source.refId,
          content: source.content
        }))
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
            writeContextSnapshot: (snapshot: JsonObject) =>
              repository.writeContextSnapshot(snapshot),
            writeBudgetSnapshot: (runId: string, snapshot: JsonObject) =>
              repository.writeBudgetSnapshot(runId, snapshot),
            commitCompaction: (snapshot: JsonObject) => repository.commitCompaction(snapshot),
            writeCommandReceipt: (runId: string, commandId: string, receipt: JsonObject) =>
              repository.writeCommandReceipt(runId, commandId, receipt),
            readCommandReceipt: (runId: string, commandId: string) =>
              repository.readCommandReceipt(runId, commandId),
            readSnapshot: (runId: string) => repository.readSnapshot(runId),
            readCompactionRevision: (runId: string, compactionId: string) =>
              repository.readCompactionRevision(runId, compactionId)
          },
          usageSink: {
            writeFinal: (record: JsonObject) => usageRepository.writeFinal(record)
          }
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
  readonly projectReads: AgentProjectReadRepository;
  readonly chapterRepository?: ChapterFileRepository;
  readonly readEditorState?: DesktopAgentRunSessionOptions["readEditorState"];
  readonly pauseAutosave?: DesktopAgentRunSessionOptions["pauseAutosave"];
  readonly resumeAutosave?: DesktopAgentRunSessionOptions["resumeAutosave"];
  readonly preserveDirtyBuffers?: DesktopAgentRunSessionOptions["preserveDirtyBuffers"];
  readonly syncSavedEditor?: DesktopAgentRunSessionOptions["syncSavedEditor"];
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
    ...(input.failAgentWriteAt === undefined
      ? {}
      : {
          replaceFile: createFailureInjectingReplaceFile(input.failAgentWriteAt)
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
        return applied.value.transactionStatus === "applied"
          ? ok(asJsonObject(applied.value))
          : err(versionGroupFailure(applied.value));
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
        return undone.value.transactionStatus === "applied" ||
          undone.value.transactionStatus === "awaiting_review" ||
          undone.value.transactionStatus === "partial_failure"
          ? ok(asJsonObject(undone.value))
          : err(versionGroupFailure(undone.value));
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
    }))
  });
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
    files
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

function createFailureInjectingReplaceFile(failAt: number) {
  let applyCount = 0;
  return async (input: AgentWriteReplaceInput): Promise<Result<void, UnifiedError>> => {
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
    return writeTextAtomically({
      targetPath: input.targetPath,
      content: input.content,
      traceId: "desktop-agent-write",
      beforeReplace: input.verifyImmediatelyBeforeReplace
    });
  };
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function runtimeError(code: string, redactedDetail?: JsonObject): UnifiedError {
  return createUnifiedError({
    code,
    category: code.includes("WRITE") ? "StorageError" : "ValidationError",
    message:
      code === "AGENT_VERSION_GROUP_PARTIAL_FAILURE"
        ? "Agent writing partially failed and requires transaction recovery review."
        : code === "AGENT_VERSION_GROUP_WRITE_ROLLED_BACK"
          ? "Agent writing failed and applied files were rolled back."
          : "The Agent write request could not be completed safely.",
    recoverability: "user-action",
    suggestedAction: "Review the Change Set, current files, and transaction recovery status.",
    traceId: "desktop-agent-run-runtime",
    ...(redactedDetail === undefined ? {} : { redactedDetail })
  });
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
  readonly storyBible?: StoryBibleFileRepository;
  readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
  readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
  readonly resolveModelStartFacts?: NonNullable<
    DesktopAgentRunSessionOptions["resolveModelStartFacts"]
  >;
}): AgentRunStartPreflightPort {
  return {
    async resolveStart(command) {
      const intent = readResolvedIntent(command as StartAgentRunCommand & Record<string, unknown>);
      if (intent !== undefined) {
        return input.workspaceKind === "engineeringWorkspace" && intent.contextMode === "writing"
          ? err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"))
          : ok(intent);
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
    readonly storyBible?: StoryBibleFileRepository;
    readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
    readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
    readonly resolveModelStartFacts?: NonNullable<
      DesktopAgentRunSessionOptions["resolveModelStartFacts"]
    >;
  }
): Promise<Result<AgentRunStartFacts, UnifiedError>> {
  const resolved = await input.draftSession.resolveStartDraft({
    projectId: command.projectId,
    conversationId: command.conversationId,
    runDraftId: command.runDraftId,
    runDraftRevision: command.runDraftRevision,
    runDraftChecksum: command.runDraftChecksum
  });
  if (!resolved.ok) return err(resolved.error);
  const { runDraft, contextDraft } = resolved.value;
  if (input.workspaceKind === "engineeringWorkspace" && runDraft.contextMode === "writing") {
    return err(runtimeError("AGENT_CONTEXT_MODE_UNAVAILABLE"));
  }
  if (input.resolveModelStartFacts === undefined) {
    return err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED"));
  }
  const model = await input.resolveModelStartFacts(runDraft.modelProfileId);
  if (model === undefined) {
    return err(runtimeError("AGENT_MODEL_CAPABILITY_UNSUPPORTED"));
  }
  const sources = await resolveContextDraftSources(contextDraft.refs, input);
  if (!sources.ok) return err(sources.error);
  return ok({
    operationMode: runDraft.operationMode,
    contextMode: runDraft.contextMode,
    writePolicy: runDraft.writePolicy,
    writePolicyAcknowledged: runDraft.writePolicyAcknowledged,
    userRequest: runDraft.userRequest,
    ...(runDraft.reasoningEffort === undefined
      ? {}
      : { requestedReasoningEffort: runDraft.reasoningEffort }),
    model,
    initialContextSources: sources.value
  });
}

/** Read the concrete content behind each Context Draft ref into an ordered source list. */
async function resolveContextDraftSources(
  refs: readonly {
    readonly kind: string;
    readonly refId: string;
    readonly chapterId?: string;
    readonly assetId?: string;
    readonly relativePath?: string;
  }[],
  input: {
    readonly chapterRepository?: ChapterFileRepository;
    readonly projectReads: AgentProjectReadRepository;
    readonly storyBible?: StoryBibleFileRepository;
    readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
    readonly readEditorState?: NonNullable<DesktopAgentRunSessionOptions["readEditorState"]>;
  }
): Promise<Result<AgentContextSourceInput[], UnifiedError>> {
  const sources: AgentContextSourceInput[] = [];
  for (const ref of refs) {
    if (
      (ref.kind === "chapter" || ref.kind === "editor_selection") &&
      ref.chapterId !== undefined
    ) {
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
      const read = await input.projectReads.readText(ref.relativePath);
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
        content: JSON.stringify(asset.value),
        dirty: false
      });
    }
  }
  return ok(sources);
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
        roundInput.snapshot.providerCapabilitySnapshot.profileId
      );
      if (profile === undefined) {
        throw new Error("The selected Agent model profile is unavailable.");
      }
      const driver = input.createAgentModelDriver(profile);
      yield* driver.streamRound(roundInput);
    }
  };
}

function createDesktopReadToolExecutor(
  projectReads: AgentProjectReadRepository,
  chapterRepository: ChapterFileRepository | undefined,
  storyBible: StoryBibleFileRepository | undefined
): AgentReadToolExecutor {
  return {
    async execute(input) {
      if (input.name === "list_project_entries") {
        const relativeDirectory = readOptionalString(input.arguments, "path") ?? "";
        const listed = await projectReads.listEntries(relativeDirectory);
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
        const content = JSON.stringify(asset.value);
        return ok({
          summary: `已读取 Story Bible 资产 ${assetId}`,
          data: { asset: asset.value },
          source: {
            refId: `story-bible:${assetId}`,
            sourceKind: "story_bible_asset",
            assetId,
            content,
            dirty: false
          }
        });
      }
      return invalidToolArguments(input.name);
    }
  };
}

function createDesktopScriptedAgentDriver(
  activeChapterId: string | undefined
): AgentRunModelDriver {
  return {
    async *streamRound(input: AgentModelRoundInput): AsyncIterable<AgentModelStreamEvent> {
      const toolResultCount = input.messages.filter((message) => message.role === "tool").length;
      if (toolResultCount === 0) {
        yield { type: "assistant_text_delta", delta: "我会先读取项目结构和当前章节。" };
        yield toolCall("desktop_list_entries", "list_project_entries", { path: "chapters" });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (
        toolResultCount === 1 &&
        input.snapshot.contextMode === "writing" &&
        activeChapterId !== undefined
      ) {
        yield toolCall("desktop_read_chapter", "read_chapter", { chapterId: activeChapterId });
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

function toolCall(toolCallId: string, name: AgentToolName, argumentsValue: JsonObject) {
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
    ...(snapshot.value.timeline === undefined ? [] : [snapshot.value.timeline]),
    ...snapshot.value.memories
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

function invalidToolArguments(name: AgentToolName) {
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
