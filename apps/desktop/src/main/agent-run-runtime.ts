import {
  createAgentConversationSession,
  createAgentRunDraftSession,
  createAgentRunSession,
  createChangeSetSession,
  createVersionGroupSession,
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
  type AgentVersionGroupExecutor,
  type VersionGroupSessionTransactionPort,
  type VersionGroupTransactionApplyInput
} from "@novel-studio/application";
import type { LlmModelProfile, LlmParameters } from "@novel-studio/llm-adapter";
import type {
  AgentContextSourceInput,
  AgentToolName,
  ChangeSet,
  StartAgentRunCommand,
  VersionGroup
} from "@novel-studio/agent-engine";
import type {
  AgentRunDraftSession,
  SyncStartDraftCommand
} from "@novel-studio/application";
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
  readonly projectRoot: string;
  readonly projectId: string;
  readonly activeChapterId: string;
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
  readonly projectId: string;
  readonly projectRoot: string;
  readonly agentRunSession: AgentRunSession;
  readonly agentConversationSession: AgentConversationSession;
  readonly agentRunDraftSession: AgentRunDraftSession;
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
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-project-read"
  });
  const storyBible = new StoryBibleFileRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-story-bible"
  });
  const repository = new AgentRunFileRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-run-store"
  });
  const conversationRepository = new AgentConversationFileRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-conversation-store"
  });
  const chapterRepository = new ChapterFileRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-chapter"
  });
  const readToolExecutor = createDesktopReadToolExecutor(
    projectReads,
    chapterRepository,
    storyBible
  );
  const changeSetSession = createDesktopChangeSetSession({
    projectId: options.projectId,
    projectReads,
    chapterRepository,
    repository,
    ...(options.readEditorState === undefined ? {} : { readEditorState: options.readEditorState })
  });
  const versionGroupServices =
    options.projectLockOwnerId === undefined
      ? undefined
      : createDesktopVersionGroupServices({
          projectRoot: options.projectRoot,
          projectId: options.projectId,
          projectLockOwnerId: options.projectLockOwnerId,
          projectReads,
          chapterRepository,
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
    draftSession,
    chapterRepository,
    projectReads,
    storyBible,
    ...(options.readEditorBuffer === undefined
      ? {}
      : { readEditorBuffer: options.readEditorBuffer }),
    ...(options.resolveModelStartFacts === undefined
      ? {}
      : { resolveModelStartFacts: options.resolveModelStartFacts })
  });
  const session = createAgentRunSession({
    repository,
    modelDriver,
    readToolExecutor,
    startPreflight,
    changeSetSession,
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
            if (source.refId.startsWith("chapter:")) {
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
          if (source.assetId !== undefined) {
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
  void versionGroupServices?.recoverOnStartup();
  return {
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    agentRunSession: session,
    agentConversationSession: conversationSession,
    agentRunDraftSession: draftSession
  };
}

function createDesktopChangeSetSession(input: {
  readonly projectId: string;
  readonly projectReads: AgentProjectReadRepository;
  readonly chapterRepository: ChapterFileRepository;
  readonly repository: AgentRunFileRepository;
  readonly readEditorState?: DesktopAgentRunSessionOptions["readEditorState"];
}) {
  return createChangeSetSession({
    port: {
      async readChapterTarget({ projectId, chapterId }) {
        if (projectId !== input.projectId) return err(runtimeError("CHANGE_SET_PROJECT_MISMATCH"));
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
  readonly projectRoot: string;
  readonly projectId: string;
  readonly projectLockOwnerId: string;
  readonly projectReads: AgentProjectReadRepository;
  readonly chapterRepository: ChapterFileRepository;
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
    projectRoot: input.projectRoot,
    traceId: "desktop-agent-recovery"
  });
  const transaction = new AgentWriteTransaction({
    projectRoot: input.projectRoot,
    projectLock: new ProjectLockFileRepository({
      projectRoot: input.projectRoot,
      ownerId: input.projectLockOwnerId,
      traceId: "desktop-agent-project-lock"
    }),
    historyRepository: new HistoryRepository({
      projectRoot: input.projectRoot,
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
      ...(input.readEditorState === undefined
        ? {}
        : { readEditorState: input.readEditorState }),
      async preserveDirtyBuffers(relativePaths) {
        await input.preserveDirtyBuffers?.(relativePaths);
      },
      async markRecoveryClean(relativePaths) {
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
    ...(journal.approvalSource === undefined
      ? {}
      : { approvalSource: journal.approvalSource }),
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
    readonly chapterRepository: ChapterFileRepository;
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
  readonly draftSession: AgentRunDraftSession;
  readonly chapterRepository: ChapterFileRepository;
  readonly projectReads: AgentProjectReadRepository;
  readonly storyBible: StoryBibleFileRepository;
  readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
  readonly resolveModelStartFacts?: NonNullable<
    DesktopAgentRunSessionOptions["resolveModelStartFacts"]
  >;
}): AgentRunStartPreflightPort {
  return {
    async resolveStart(command) {
      const intent = readResolvedIntent(command as StartAgentRunCommand & Record<string, unknown>);
      if (intent !== undefined) return ok(intent);
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
      (command["writePolicy"] as AgentRunStartFacts["writePolicy"]) ??
      "write_before_confirmation",
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
    readonly draftSession: AgentRunDraftSession;
    readonly chapterRepository: ChapterFileRepository;
    readonly projectReads: AgentProjectReadRepository;
    readonly storyBible: StoryBibleFileRepository;
    readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
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
    readonly chapterRepository: ChapterFileRepository;
    readonly projectReads: AgentProjectReadRepository;
    readonly storyBible: StoryBibleFileRepository;
    readonly readEditorBuffer?: NonNullable<DesktopAgentRunSessionOptions["readEditorBuffer"]>;
  }
): Promise<Result<AgentContextSourceInput[], UnifiedError>> {
  const sources: AgentContextSourceInput[] = [];
  for (const ref of refs) {
    if ((ref.kind === "chapter" || ref.kind === "editor_selection") && ref.chapterId !== undefined) {
      const refId = `chapter:${ref.chapterId}`;
      const relativePath = `chapters/${ref.chapterId}.md`;
      const buffered = await input.readEditorBuffer?.(refId);
      if (buffered !== undefined) {
        sources.push({ refId, sourceKind: "editor_buffer", relativePath, content: buffered, dirty: true });
        continue;
      }
      const chapter = await input.chapterRepository.readChapter(ref.chapterId);
      if (!chapter.ok) return err(chapter.error);
      sources.push({ refId, sourceKind: "disk_file", relativePath, content: chapter.value.body, dirty: false });
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
  chapterRepository: ChapterFileRepository,
  storyBible: StoryBibleFileRepository
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

function createDesktopScriptedAgentDriver(activeChapterId: string): AgentRunModelDriver {
  return {
    async *streamRound(input: AgentModelRoundInput): AsyncIterable<AgentModelStreamEvent> {
      const toolResultCount = input.messages.filter((message) => message.role === "tool").length;
      if (toolResultCount === 0) {
        yield { type: "assistant_text_delta", delta: "我会先读取项目结构和当前章节。" };
        yield toolCall("desktop_list_entries", "list_project_entries", { path: "chapters" });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (toolResultCount === 1 && input.snapshot.contextMode === "writing") {
        yield toolCall("desktop_read_chapter", "read_chapter", { chapterId: activeChapterId });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (input.snapshot.operationMode === "planning") {
        yield toolCall("desktop_finish_plan", "finish_plan", {
          planId: `plan_${input.runId}`,
          goal: input.snapshot.userRequest,
          successCriteria: ["完成只读上下文核对"],
          nonGoals: ["本次规划不修改任何项目文件"],
          facts: ["已读取项目结构和当前章节"],
          assumptions: [],
          openQuestions: [],
          targetRefs: [{ refId: `chapter:${activeChapterId}`, intent: "按用户目标规划修订" }],
          steps: [
            {
              stepId: "step_review_chapter",
              title: "复核当前章节",
              verification: "重新读取并核对目标与上下文"
            }
          ],
          risks: ["执行前上下文可能变化"],
          verification: ["执行前刷新 Context Snapshot"],
          sourceRefs: [`chapter:${activeChapterId}`]
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
import { createHash } from "node:crypto";
