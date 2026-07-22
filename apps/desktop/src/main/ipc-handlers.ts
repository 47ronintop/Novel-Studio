import { createDesktopApplication, toProjectWorkspaceSnapshotDto } from "@novel-studio/application";
import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  AgentConversationSession,
  AgentContextSession,
  AgentPermissionSession,
  AgentRunDraftSession,
  AgentRunSession,
  AgentUsageQuery,
  ClearAgentUsageCommand,
  AnswerAgentUserInputCommand,
  ApplicationIpcChannel,
  CompactContextCommand,
  DesktopApplication,
  ProjectCreationPreviewDto,
  WorkspaceActivationDto,
  PreviewContextBudgetCommand,
  ReadAgentPermissionSummaryQuery,
  ReadAgentRunDraftCommand,
  RefreshContextDraftCommand,
  SyncStartDraftCommand,
  UpdateAgentRunDraftCommand,
  UpdateContextDraftCommand
} from "@novel-studio/application";
import type {
  AgentRunEvent,
  DecideChangeSetCommand,
  DecideAgentPlanCommand,
  DecidePlanRevisionCommand,
  RefreshAgentContextCommand,
  ResumeAgentRunCommand,
  RetryAgentRunStepCommand,
  RetryRunTargetCommand,
  StartAgentRunCommand,
  StopAgentRunCommand,
  UndoRunCommand
} from "@novel-studio/agent-engine";
import { ok, type JsonObject, type JsonValue } from "@novel-studio/shared";
import type {
  AiWritingSuggestionStreamEvent,
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetType,
  ChangeAgentConversationStatusCommand,
  CreateAgentConversationCommand,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamPushEvent,
  AiWritingSuggestionStreamStartRequest,
  ModelProfile,
  MemoryRecord,
  ListAgentConversationsQuery,
  ReadAgentConversationQuery,
  SearchAgentConversationsQuery,
  ProjectSearchQuery,
  ProjectWorkspaceSnapshot,
  StoryBibleAsset,
  StoryBibleContextCandidateOptions,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type {
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
  Result,
  UnifiedError
} from "@novel-studio/shared";
import { createUnifiedError, err } from "@novel-studio/shared";
import type { ModelSecretStore } from "./model-runtime.js";
import type { DesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import type { WorkspaceActivationCoordinator } from "./workspace-activation.js";

export type ApplicationIpcHandlers = {
  readonly [Channel in ApplicationIpcChannel]: (...args: readonly unknown[]) => Promise<unknown>;
};

export interface ApplicationIpcHandlerOptions {
  readonly chooseOpenProjectDirectory?: () => Promise<string | undefined>;
  readonly chooseCreateProjectDirectory?: () => Promise<string | undefined>;
  readonly chooseEngineeringDirectory?: () => Promise<string | undefined>;
  readonly workspaceActivationCoordinator?: WorkspaceActivationCoordinator;
  readonly modelSecretStore?: ModelSecretStore;
  readonly publishAiSuggestionStreamEvent?: (event: AiWritingSuggestionStreamPushEvent) => void;
  readonly agentRunSession?: AgentRunSession;
  readonly agentRuntimeManager?: DesktopAgentRuntimeManager;
  readonly publishAgentRunEvent?: (event: AgentRunEvent) => void;
  readonly agentWriteSaveCoordinator?: AgentWriteSaveCoordinator;
}

export interface AgentWriteSaveCoordinator {
  pauseAutosave(relativePaths: readonly string[]): Promise<void>;
  resumeAutosave(relativePaths: readonly string[]): Promise<void>;
  beginSave(
    relativePath: string
  ): { readonly ok: false } | { readonly ok: true; readonly release: () => void };
}

interface SavePathState {
  pauseCount: number;
  activeSaveCount: number;
  readonly drainWaiters: Set<() => void>;
}

interface DirectorySelection {
  readonly path: string;
  readonly purpose: "creative-open" | "creative-create-parent" | "engineering-open";
  readonly displayName: string;
  readonly expiresAt: number;
}

export function createAgentWriteSaveCoordinator(): AgentWriteSaveCoordinator {
  const stateByPath = new Map<string, SavePathState>();
  const getState = (relativePath: string): SavePathState => {
    const current = stateByPath.get(relativePath);
    if (current !== undefined) return current;
    const created: SavePathState = {
      pauseCount: 0,
      activeSaveCount: 0,
      drainWaiters: new Set()
    };
    stateByPath.set(relativePath, created);
    return created;
  };

  return {
    async pauseAutosave(relativePaths) {
      const uniquePaths = [...new Set(relativePaths)];
      const states = uniquePaths.map((relativePath) => {
        const state = getState(relativePath);
        state.pauseCount += 1;
        return state;
      });
      await Promise.all(
        states.map(
          (state) =>
            state.activeSaveCount === 0 ||
            new Promise<void>((resolve) => state.drainWaiters.add(resolve))
        )
      );
    },
    async resumeAutosave(relativePaths) {
      for (const relativePath of new Set(relativePaths)) {
        const state = stateByPath.get(relativePath);
        if (state === undefined) continue;
        state.pauseCount = Math.max(0, state.pauseCount - 1);
        if (state.pauseCount === 0 && state.activeSaveCount === 0) {
          stateByPath.delete(relativePath);
        }
      }
    },
    beginSave(relativePath) {
      const state = getState(relativePath);
      if (state.pauseCount > 0) return { ok: false };
      state.activeSaveCount += 1;
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          state.activeSaveCount -= 1;
          if (state.activeSaveCount === 0) {
            const waiters = [...state.drainWaiters];
            state.drainWaiters.clear();
            for (const resolve of waiters) resolve();
            if (state.pauseCount === 0) stateByPath.delete(relativePath);
          }
        }
      };
    }
  };
}

interface ActiveAiSuggestionStream {
  readonly abortController: AbortController;
  readonly iterator: AsyncIterator<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
}

interface ActiveAiSuggestionPushStream {
  readonly abortController: AbortController;
  readonly iterator: AsyncIterator<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
}

export function createApplicationIpcHandlers(
  application: DesktopApplication = createDesktopApplication(),
  options: ApplicationIpcHandlerOptions = {}
): ApplicationIpcHandlers {
  const activeAiSuggestionStreams = new Map<string, ActiveAiSuggestionStream>();
  const activeAiSuggestionPushStreams = new Map<string, ActiveAiSuggestionPushStream>();
  const directorySelections = new Map<string, DirectorySelection>();
  let nextAiSuggestionStreamId = 0;
  const publishAgentRunEvent = (event: AgentRunEvent): void => {
    try {
      options.publishAgentRunEvent?.(structuredClone(event));
    } catch {
      // AgentRunSession owns contract failure handling; never forward a non-cloneable payload.
    }
  };
  options.agentRunSession?.subscribe(publishAgentRunEvent);
  options.agentRuntimeManager?.subscribeAgentRunEvents(publishAgentRunEvent);
  const currentAgentRunSession = (): AgentRunSession | undefined =>
    options.agentRuntimeManager?.current()?.agentRunSession ?? options.agentRunSession;
  const currentAgentConversationSession = (): AgentConversationSession | undefined =>
    options.agentRuntimeManager?.current()?.agentConversationSession;
  const currentAgentRunDraftSession = (): AgentRunDraftSession | undefined =>
    options.agentRuntimeManager?.current()?.agentRunDraftSession;
  const currentAgentContextSession = (): AgentContextSession | undefined =>
    options.agentRuntimeManager?.current()?.agentContextSession;
  const currentAgentPermissionSession = (): AgentPermissionSession | undefined =>
    options.agentRuntimeManager?.current()?.agentPermissionSession;

  async function chooseDirectory(
    purpose: DirectorySelection["purpose"],
    choose: (() => Promise<string | undefined>) | undefined
  ): Promise<
    Result<
      {
        readonly canceled: boolean;
        readonly selectionId?: string;
        readonly displayName?: string;
      },
      UnifiedError
    >
  > {
    const selected = await choose?.();
    if (selected === undefined) return ok({ canceled: true });
    try {
      const canonicalPath = await realpath(selected);
      const selectionId = `selection_${randomUUID().replaceAll("-", "")}`;
      const displayName = basename(canonicalPath);
      directorySelections.set(selectionId, {
        path: canonicalPath,
        purpose,
        displayName,
        expiresAt: Date.now() + 10 * 60 * 1000
      });
      return ok({ canceled: false, selectionId, displayName });
    } catch {
      return err(directorySelectionFailed());
    }
  }

  function resolveDirectorySelection(
    selectionId: unknown,
    purpose: DirectorySelection["purpose"]
  ): Result<DirectorySelection, UnifiedError> {
    if (typeof selectionId !== "string") return err(directorySelectionInvalid());
    const selection = directorySelections.get(selectionId);
    if (
      selection === undefined ||
      selection.purpose !== purpose ||
      selection.expiresAt <= Date.now()
    ) {
      directorySelections.delete(selectionId);
      return err(directorySelectionInvalid());
    }
    return ok(selection);
  }

  return {
    "application:get-shell-state": () => Promise.resolve(application.getShellState()),
    "application:list-commands": () => Promise.resolve(application.listCommands()),
    "application:execute-command": (commandId: unknown) => {
      if (typeof commandId !== "string") {
        return Promise.resolve(application.executeCommand(""));
      }

      return Promise.resolve(application.executeCommand(commandId));
    },
    "application:project:choose-open-creative-directory": () =>
      chooseDirectory("creative-open", options.chooseOpenProjectDirectory),
    "application:project:choose-create-parent-directory": () =>
      chooseDirectory("creative-create-parent", options.chooseCreateProjectDirectory),
    "application:project:get-active-workspace": () =>
      Promise.resolve(projectSnapshotResultToDto(application.getActiveProjectWorkspace())),
    "application:project:open-creative-project": async (selectionId: unknown) => {
      const selection = resolveDirectorySelection(selectionId, "creative-open");
      if (!selection.ok) return selection;
      if (options.workspaceActivationCoordinator === undefined) {
        return workspaceActivationUnavailable<WorkspaceActivationDto>();
      }
      return options.workspaceActivationCoordinator.openCreativeProject(selection.value.path);
    },
    "application:project:preview-creative-project": async (input: unknown) => {
      const request = toCreativePreviewRequest(input);
      if (request === undefined) return invalidWorkspaceRequest<ProjectCreationPreviewDto>();
      const selection = resolveDirectorySelection(
        request.parentSelectionId,
        "creative-create-parent"
      );
      if (!selection.ok) return selection;
      return application.previewCreativeProject({
        parentDirectory: selection.value.path,
        folderName: request.folderName
      });
    },
    "application:project:create-creative-project": async (input: unknown) => {
      const request = toCreateCreativeProjectRequest(input);
      if (request === undefined) return invalidWorkspaceRequest<WorkspaceActivationDto>();
      const selection = resolveDirectorySelection(
        request.parentSelectionId,
        "creative-create-parent"
      );
      if (!selection.ok) return selection;
      if (options.workspaceActivationCoordinator === undefined) {
        return workspaceActivationUnavailable<WorkspaceActivationDto>();
      }
      return options.workspaceActivationCoordinator.createCreativeProject({
        parentDirectory: selection.value.path,
        folderName: request.folderName,
        projectId: request.projectId,
        title: request.title,
        language: request.language,
        ...(request.projectType === undefined ? {} : { projectType: request.projectType }),
        ...(request.targetWordCount === undefined
          ? {}
          : { targetWordCount: request.targetWordCount })
      });
    },
    "application:workspace:choose-engineering-directory": () =>
      chooseDirectory("engineering-open", options.chooseEngineeringDirectory),
    "application:workspace:open-engineering-workspace": async (selectionId: unknown) => {
      const selection = resolveDirectorySelection(selectionId, "engineering-open");
      if (!selection.ok) return selection;
      if (options.workspaceActivationCoordinator === undefined) {
        return workspaceActivationUnavailable<WorkspaceActivationDto>();
      }
      return options.workspaceActivationCoordinator.openEngineeringWorkspace(selection.value.path);
    },
    "application:workspace:attach-active-creative-project": () =>
      application.attachActiveCreativeProjectEngineeringWorkspace(),
    "application:workspace:refresh-engineering-tree": () => application.refreshEngineeringTree(),
    "application:workspace:read-text-file": (path: unknown) =>
      typeof path === "string"
        ? application.readEngineeringTextFile(path)
        : Promise.resolve(invalidWorkspaceRequest()),
    "application:workspace:save-text-file": (input: unknown) => {
      const request = toEngineeringTextFileSaveRequest(input);
      return request === undefined
        ? Promise.resolve(invalidWorkspaceRequest())
        : application.saveEngineeringTextFile(request);
    },
    "application:project:list-chapters": () => application.listProjectChapters(),
    "application:project:create-chapter": async (input: unknown) => {
      const createInput = toCreateChapterInput(input);
      if (createInput === undefined) {
        return projectSnapshotResultToDto(
          await application.createProjectChapter({
            chapterId: "",
            title: ""
          })
        );
      }

      return projectSnapshotResultToDto(await application.createProjectChapter(createInput));
    },
    "application:project:rename-chapter": async (input: unknown) => {
      return projectSnapshotResultToDto(
        await application.renameProjectChapter(toRenameChapterInput(input))
      );
    },
    "application:project:duplicate-chapter": async (input: unknown) => {
      return projectSnapshotResultToDto(
        await application.duplicateProjectChapter(toDuplicateChapterInput(input))
      );
    },
    "application:project:delete-chapter": async (input: unknown) => {
      return projectSnapshotResultToDto(
        await application.deleteProjectChapter(toDeleteChapterInput(input))
      );
    },
    "application:project:select-chapter": async (chapterId: unknown) => {
      if (typeof chapterId !== "string") {
        return projectSnapshotResultToDto(await application.selectProjectChapter(""));
      }

      return projectSnapshotResultToDto(await application.selectProjectChapter(chapterId));
    },
    "application:project:select-chapter-and-load": async (chapterId: unknown) => {
      const selected = await application.selectProjectChapterAndLoad(
        typeof chapterId === "string" ? chapterId : ""
      );
      return selected.ok
        ? ok({
            workspace: toProjectWorkspaceSnapshotDto(selected.value.workspace),
            chapterEditor: selected.value.chapterEditor
          })
        : selected;
    },
    "application:project:preview-recovery-draft": (sessionId: unknown) => {
      if (typeof sessionId !== "string") {
        return application.previewRecoveryDraft("");
      }

      return application.previewRecoveryDraft(sessionId);
    },
    "application:project:apply-recovery-draft": async (sessionId: unknown) => {
      const applied = await application.applyRecoveryDraft(
        typeof sessionId === "string" ? sessionId : ""
      );
      return applied.ok
        ? ok({
            workspace: toProjectWorkspaceSnapshotDto(applied.value.workspace),
            chapterEditor: applied.value.chapterEditor
          })
        : applied;
    },
    "application:project:discard-recovery-draft": async (sessionId: unknown) => {
      return projectSnapshotResultToDto(
        await application.discardRecoveryDraft(typeof sessionId === "string" ? sessionId : "")
      );
    },
    "application:search:rebuild-index": () => application.rebuildProjectSearchIndex(),
    "application:search:query": (input: unknown) => application.searchProject(toSearchQuery(input)),
    "application:ai:generate-chapter-suggestion": (request: unknown) => {
      return application.generateActiveChapterSuggestion(toAiWritingSuggestionRequest(request));
    },
    "application:ai:start-chapter-suggestion-stream": (request: unknown) => {
      const abortController = new AbortController();
      nextAiSuggestionStreamId += 1;
      const streamId = `ai_stream_${nextAiSuggestionStreamId}`;
      const suggestionStream = application.streamActiveChapterSuggestion({
        ...toAiWritingSuggestionRequest(request),
        abortSignal: abortController.signal
      });
      const iterator = suggestionStream[Symbol.asyncIterator]();
      activeAiSuggestionStreams.set(streamId, {
        abortController,
        iterator
      });

      return Promise.resolve(ok({ streamId }));
    },
    "application:ai:next-chapter-suggestion-stream": async (streamId: unknown) => {
      const id = readStreamId(streamId);
      const stream = id === undefined ? undefined : activeAiSuggestionStreams.get(id);
      if (id === undefined || stream === undefined) {
        return streamNotFound();
      }

      let next: IteratorResult<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
      try {
        next = await stream.iterator.next();
      } catch (error) {
        activeAiSuggestionStreams.delete(id);
        return thrownAiStreamError(error);
      }
      if (next.done === true) {
        activeAiSuggestionStreams.delete(id);
        return ok({ done: true });
      }
      if (!next.value.ok) {
        activeAiSuggestionStreams.delete(id);
        return next.value;
      }

      return ok({
        done: false,
        event: next.value.value
      });
    },
    "application:ai:cancel-chapter-suggestion-stream": (streamId: unknown) => {
      const id = readStreamId(streamId);
      const stream = id === undefined ? undefined : activeAiSuggestionStreams.get(id);
      if (id === undefined || stream === undefined) {
        return Promise.resolve(ok(undefined));
      }

      stream.abortController.abort();
      void stream.iterator.return?.();
      activeAiSuggestionStreams.delete(id);
      return Promise.resolve(ok(undefined));
    },
    "application:ai:start-chapter-suggestion-push-stream": (request: unknown) => {
      const parsed = toAiWritingSuggestionStreamStartRequest(request);
      if (parsed === undefined) {
        return Promise.resolve(
          err(
            createUnifiedError({
              code: "AI_STREAM_REQUEST_INVALID",
              category: "ValidationError",
              message: "The AI stream request is invalid.",
              recoverability: "user-action",
              suggestedAction: "Start the AI writing stream again.",
              traceId: "desktop-ipc-handlers"
            })
          )
        );
      }

      if (activeAiSuggestionPushStreams.has(parsed.streamId)) {
        return Promise.resolve(ok({ streamId: parsed.streamId }));
      }

      const abortController = new AbortController();
      const { streamId, ...normalizedRequest } = parsed;
      const suggestionStream = application.streamActiveChapterSuggestion({
        ...normalizedRequest,
        abortSignal: abortController.signal
      });
      const iterator = suggestionStream[Symbol.asyncIterator]();
      activeAiSuggestionPushStreams.set(streamId, { abortController, iterator });
      void pumpAiSuggestionPushStream(
        streamId,
        iterator,
        abortController,
        options.publishAiSuggestionStreamEvent,
        () => activeAiSuggestionPushStreams.delete(streamId)
      );
      return Promise.resolve(ok({ streamId }));
    },
    "application:ai:cancel-chapter-suggestion-push-stream": (streamId: unknown) => {
      const id = readStreamId(streamId);
      const stream = id === undefined ? undefined : activeAiSuggestionPushStreams.get(id);
      if (id === undefined || stream === undefined) {
        return Promise.resolve(ok(undefined));
      }

      stream.abortController.abort();
      void stream.iterator.return?.();
      activeAiSuggestionPushStreams.delete(id);
      return Promise.resolve(ok(undefined));
    },
    "application:ai:generate-selection-preview": (request: unknown) => {
      return application.generateActiveSelectionPreview(
        toAiWritingSelectionPreviewRequest(request)
      );
    },
    "application:ai:apply-selection-preview": (previewId: unknown) => {
      if (typeof previewId !== "string") {
        return application.applyActiveSelectionPreview("");
      }

      return application.applyActiveSelectionPreview(previewId);
    },
    "application:ai:apply-chapter-suggestion": (suggestionId: unknown) => {
      if (typeof suggestionId !== "string") {
        return application.applyActiveChapterSuggestion("");
      }

      return application.applyActiveChapterSuggestion(suggestionId);
    },
    "application:ai:list-workflow-runs": () => application.listWorkflowRuns(),
    "application:ai:read-workflow-run": (workflowRunId: unknown) => {
      if (typeof workflowRunId !== "string") {
        return application.readWorkflowRun("");
      }

      return application.readWorkflowRun(workflowRunId);
    },
    "application:agent-run:prepare-start": (command: unknown) => {
      // Persist the renderer's pre-run intent (user choices only) as the current draft, returning a
      // reference the draft-only start command can carry. Server resolves capabilities/content later.
      const parsed = toSyncStartDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.syncStartDraft(parsed);
    },
    "application:agent-run:read-run-draft": (command: unknown) => {
      const parsed = toReadAgentRunDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.readAgentRunDraft(parsed);
    },
    "application:agent-run:update-run-draft": (command: unknown) => {
      const parsed = toUpdateAgentRunDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.updateAgentRunDraft(parsed);
    },
    "application:agent-run:update-context-draft": (command: unknown) => {
      const parsed = toUpdateContextDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.updateContextDraft(parsed);
    },
    "application:agent-run:refresh-context-draft": (command: unknown) => {
      const parsed = toRefreshContextDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.refreshContextDraft(parsed);
    },
    "application:agent-run:preview-context-budget": (command: unknown) => {
      const parsed = toPreviewContextBudgetCommand(command);
      const contextSession = currentAgentContextSession();
      return parsed === undefined || contextSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : contextSession.previewContextBudget(parsed);
    },
    "application:agent-run:compact-context": (command: unknown) => {
      const parsed = toCompactContextCommand(command);
      const contextSession = currentAgentContextSession();
      return parsed === undefined || contextSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : contextSession.compactContext(parsed);
    },
    "application:agent-run:start": (command: unknown) => {
      const parsed = toStartAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.startAgentRun(parsed);
    },
    "application:agent-run:stop": (command: unknown) => {
      const parsed = toStopAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.stopAgentRun(parsed);
    },
    "application:agent-run:answer-user-input": (command: unknown) => {
      const parsed = toAnswerAgentUserInputCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.answerUserInput(parsed);
    },
    "application:agent-run:resume": (command: unknown) => {
      const parsed = toResumeAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.resumeAgentRun(parsed);
    },
    "application:agent-run:retry-step": (command: unknown) => {
      const parsed = toRetryAgentRunStepCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.retryStep(parsed);
    },
    "application:agent-run:retry-target": (command: unknown) => {
      const parsed = toRetryRunTargetCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.retryRunTarget(parsed);
    },
    "application:agent-run:decide-plan": (command: unknown) => {
      const parsed = toDecideAgentPlanCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.decidePlan(parsed);
    },
    "application:agent-run:read-permission-summary": async (query: unknown) => {
      const parsed = toReadAgentPermissionSummaryQuery(query);
      const runtime = options.agentRuntimeManager?.current();
      const permissionSession = currentAgentPermissionSession();
      if (
        parsed === undefined ||
        runtime === undefined ||
        permissionSession === undefined ||
        parsed.projectId !== runtime.workspaceId
      ) {
        return invalidAgentRunCommand();
      }
      if (parsed.kind === "run") {
        return permissionSession.readForRun({
          runId: parsed.runId,
          permissionSummaryId: parsed.permissionSummaryId
        });
      }
      const draftSession = currentAgentRunDraftSession();
      if (draftSession === undefined) return agentRunUnavailable();
      const draft = await draftSession.resolveStartDraft({
        projectId: parsed.projectId,
        conversationId: parsed.conversationId,
        runDraftId: parsed.runDraftId,
        runDraftRevision: parsed.runDraftRevision,
        runDraftChecksum: parsed.runDraftChecksum
      });
      if (!draft.ok) return draft;
      return permissionSession.prepareForDraft({
        projectId: parsed.projectId,
        runDraftId: draft.value.runDraft.runDraftId,
        runDraftRevision: draft.value.runDraft.revision,
        operationMode: draft.value.runDraft.operationMode,
        contextMode: draft.value.runDraft.contextMode,
        writePolicy: draft.value.runDraft.writePolicy
      });
    },
    "application:agent-run:decide-plan-revision": (command: unknown) => {
      const parsed = toDecidePlanRevisionCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.decidePlanRevision(parsed);
    },
    "application:agent-run:refresh-context": (command: unknown) => {
      const parsed = toRefreshAgentContextCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.refreshContext(parsed);
    },
    "application:agent-run:decide-change-set": (command: unknown) => {
      const parsed = toDecideChangeSetCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.decideChangeSet(parsed);
    },
    "application:agent-run:undo": (command: unknown) => {
      const parsed = toUndoAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.undoRun(parsed);
    },
    "application:agent-run:read": (runId: unknown) => {
      const session = currentAgentRunSession();
      return typeof runId !== "string" || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.readAgentRun(runId);
    },
    "application:agent-run:list": (projectId: unknown) => {
      const session = currentAgentRunSession();
      return typeof projectId !== "string" || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.listAgentRuns(projectId);
    },
    "application:agent-conversation:create": (command: unknown) => {
      const parsed = toCreateAgentConversationCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.createConversation(parsed);
    },
    "application:agent-conversation:list": (query: unknown) => {
      const parsed = toListAgentConversationsQuery(query);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.listConversations(parsed);
    },
    "application:agent-conversation:read": (query: unknown) => {
      const parsed = toReadAgentConversationQuery(query);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.readConversation(parsed);
    },
    "application:agent-conversation:archive": (command: unknown) => {
      const parsed = toChangeAgentConversationStatusCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.archiveConversation(parsed);
    },
    "application:agent-conversation:restore": (command: unknown) => {
      const parsed = toChangeAgentConversationStatusCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.restoreConversation(parsed);
    },
    "application:agent-conversation:delete": (command: unknown) => {
      const parsed = toChangeAgentConversationStatusCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.deleteConversation(parsed);
    },
    "application:agent-conversation:search": (query: unknown) => {
      const parsed = toSearchAgentConversationsQuery(query);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.searchConversations(parsed);
    },
    "application:chapter:load": () => application.loadActiveChapter(),
    "application:chapter:edit": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return application.editActiveChapter("");
      }

      return application.editActiveChapter(nextBody);
    },
    "application:chapter:save": () =>
      saveActiveChapterWithCoordinator(application, options.agentWriteSaveCoordinator),
    "application:chapter:list-versions": () => application.listActiveChapterVersions(),
    "application:chapter:preview-version": (versionId: unknown) => {
      if (typeof versionId !== "string") {
        return application.previewActiveChapterVersion("");
      }

      return application.previewActiveChapterVersion(versionId);
    },
    "application:chapter:restore-version": (versionId: unknown) => {
      if (typeof versionId !== "string") {
        return application.restoreActiveChapterVersion("");
      }

      return application.restoreActiveChapterVersion(versionId);
    },
    "application:chapter:preview-suggestion-diff": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return Promise.resolve(application.previewActiveChapterSuggestionDiff(""));
      }

      return Promise.resolve(application.previewActiveChapterSuggestionDiff(nextBody));
    },
    "application:settings:list-model-profiles": () => application.listModelProfiles(),
    "application:settings:discover-models": (profileId: unknown) => {
      if (typeof profileId !== "string") {
        return application.discoverModelOptions("");
      }

      return application.discoverModelOptions(profileId);
    },
    "application:settings:save-model-profile": (profile: unknown, options: unknown) => {
      const modelProfile = toModelProfile(profile);
      if (modelProfile === undefined) {
        return application.saveModelProfile(emptyModelProfile(), {});
      }

      return application.saveModelProfile(
        modelProfile,
        isSaveModelProfileOptions(options) ? options : {}
      );
    },
    "application:settings:save-model-secret": (secretRef: unknown, secret: unknown) => {
      if (options.modelSecretStore === undefined) {
        return Promise.resolve(
          err(
            createUnifiedError({
              code: "MODEL_SECRET_STORE_UNAVAILABLE",
              category: "StorageError",
              message: "No model secret store is configured.",
              recoverability: "user-action",
              suggestedAction: "Run the desktop app with Electron safeStorage enabled.",
              traceId: "desktop-ipc-handlers"
            })
          )
        );
      }
      if (typeof secretRef !== "string" || typeof secret !== "string") {
        return options.modelSecretStore.saveSecret("", "");
      }

      return options.modelSecretStore.saveSecret(secretRef, secret);
    },
    "application:settings:test-model-profile": (profileId: unknown) => {
      if (typeof profileId !== "string") {
        return application.testModelProfileConnection("");
      }

      return application.testModelProfileConnection(profileId);
    },
    "application:settings:list-agent-usage": (query: unknown) =>
      application.listAgentUsage(query as AgentUsageQuery),
    "application:settings:clear-agent-usage": (command: unknown) =>
      application.clearAgentUsage(command as ClearAgentUsageCommand),
    "application:plugins:load-registry": () => application.loadPluginRegistry(),
    "application:plugins:set-enabled": (pluginId: unknown, enabled: unknown) => {
      if (typeof pluginId !== "string" || typeof enabled !== "boolean") {
        return application.setPluginEnabled("", false);
      }

      return application.setPluginEnabled(pluginId, enabled);
    },
    "application:story-bible:load": () => application.loadStoryBible(),
    "application:story-bible:save-asset": (asset: unknown) => {
      const storyBibleAsset = toStoryBibleAsset(asset);
      if (storyBibleAsset === undefined) {
        return application.saveStoryBibleAsset(emptyStoryBibleAsset());
      }

      return application.saveStoryBibleAsset(storyBibleAsset);
    },
    "application:story-bible:save-memory": (memory: unknown) => {
      const storyBibleMemory = toMemoryRecord(memory);
      if (storyBibleMemory === undefined) {
        return application.saveStoryBibleMemory(emptyMemoryRecord());
      }

      return application.saveStoryBibleMemory(storyBibleMemory);
    },
    "application:story-bible:build-consistency-report": () =>
      application.buildStoryBibleConsistencyReport(),
    "application:story-bible:build-context-candidates": (options: unknown) =>
      application.buildStoryBibleContextCandidates(toStoryBibleContextCandidateOptions(options)),
    "application:studio:load-config-asset": (assetType: unknown, assetId: unknown) => {
      if (!isConfigAssetType(assetType) || typeof assetId !== "string") {
        return application.loadConfigAsset("prompt", "");
      }

      return application.loadConfigAsset(assetType, assetId);
    },
    "application:studio:save-config-asset": (input: unknown) => {
      const saveInput = toConfigAssetSaveInput(input);
      if (saveInput === undefined) {
        return application.saveConfigAsset({
          assetType: "prompt",
          assetId: "",
          content: {}
        });
      }

      return application.saveConfigAsset(saveInput);
    },
    "application:studio:restore-config-version": (input: unknown) => {
      const restoreInput = toConfigAssetRestoreInput(input);
      if (restoreInput === undefined) {
        return application.restoreConfigAssetVersion({
          assetType: "prompt",
          assetId: "",
          versionId: ""
        });
      }

      return application.restoreConfigAssetVersion(restoreInput);
    },
    "application:preferences:load": () => application.loadUserPreferences(),
    "application:preferences:save": (input: unknown) =>
      application.saveUserPreferences(toUserPreferencesSaveInput(input))
  };
}

function toStartAgentRunCommand(value: unknown): StartAgentRunCommand | undefined {
  if (!isRecord(value)) return undefined;
  // Draft-only by contract: the renderer may submit only a reference to a persisted run draft. Mode,
  // model, capabilities, the user request, and context sources are resolved server-side by the start
  // preflight — the renderer cannot author any of them. Reject the pre-Stage-5 wide field set.
  if (
    !hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "expectedRunRevision",
      "runDraftId",
      "runDraftRevision",
      "runDraftChecksum",
      "limits",
      "sourcePlanId",
      "sourcePlanRevision"
    ]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    value["expectedRunRevision"] !== 0 ||
    !isSafeId(value["runDraftId"]) ||
    !isPositiveInteger(value["runDraftRevision"]) ||
    !isNonEmptyString(value["runDraftChecksum"]) ||
    (value["limits"] !== undefined && !isRecord(value["limits"])) ||
    (value["sourcePlanId"] !== undefined && !isSafeId(value["sourcePlanId"])) ||
    (value["sourcePlanRevision"] !== undefined && !isPositiveInteger(value["sourcePlanRevision"]))
  ) {
    return undefined;
  }
  return value as unknown as StartAgentRunCommand;
}

function toSyncStartDraftCommand(value: unknown): SyncStartDraftCommand | undefined {
  if (!isRecord(value)) return undefined;
  // Intent = user choices only. Provider, model capabilities, context window, and document content
  // are never accepted here; the start preflight resolves them server-side from the persisted draft.
  if (
    !hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "userRequest",
      "operationMode",
      "contextMode",
      "writePolicy",
      "writePolicyAcknowledged",
      "modelProfileId",
      "modelName",
      "reasoningEffort",
      "contextRefs"
    ]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    typeof value["userRequest"] !== "string" ||
    (value["operationMode"] !== "planning" && value["operationMode"] !== "execution") ||
    (value["contextMode"] !== "writing" && value["contextMode"] !== "general_file") ||
    (value["writePolicy"] !== "write_before_confirmation" &&
      value["writePolicy"] !== "user_preapproved_run") ||
    typeof value["writePolicyAcknowledged"] !== "boolean" ||
    !isNonEmptyString(value["modelProfileId"]) ||
    (value["modelName"] !== undefined && !isNonEmptyString(value["modelName"])) ||
    (value["reasoningEffort"] !== undefined && !isNonEmptyString(value["reasoningEffort"])) ||
    !Array.isArray(value["contextRefs"])
  ) {
    return undefined;
  }
  return value as unknown as SyncStartDraftCommand;
}

function toReadAgentRunDraftCommand(value: unknown): ReadAgentRunDraftCommand | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["projectId", "conversationId", "initialize"]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["conversationId"]) ||
    !isRecord(value["initialize"])
  ) {
    return undefined;
  }
  const initialize = value["initialize"];
  if (
    !isNonEmptyString(initialize["modelProfileId"]) ||
    (initialize["modelName"] !== undefined && !isNonEmptyString(initialize["modelName"])) ||
    (initialize["reasoningEffort"] !== undefined &&
      !isNonEmptyString(initialize["reasoningEffort"])) ||
    (initialize["operationMode"] !== "planning" && initialize["operationMode"] !== "execution") ||
    (initialize["contextMode"] !== "writing" && initialize["contextMode"] !== "general_file") ||
    (initialize["writePolicy"] !== "write_before_confirmation" &&
      initialize["writePolicy"] !== "user_preapproved_run") ||
    (initialize["writePolicyAcknowledged"] !== undefined &&
      typeof initialize["writePolicyAcknowledged"] !== "boolean") ||
    (initialize["contextRefs"] !== undefined && !Array.isArray(initialize["contextRefs"]))
  ) {
    return undefined;
  }
  return value as unknown as ReadAgentRunDraftCommand;
}

function toUpdateAgentRunDraftCommand(value: unknown): UpdateAgentRunDraftCommand | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "expectedDraftRevision",
      "mutation"
    ]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    !isPositiveInteger(value["expectedDraftRevision"]) ||
    !isAgentRunDraftMutation(value["mutation"])
  ) {
    return undefined;
  }
  return value as unknown as UpdateAgentRunDraftCommand;
}

function toUpdateContextDraftCommand(value: unknown): UpdateContextDraftCommand | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "contextDraftId",
      "expectedDraftRevision",
      "mutation"
    ]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    !isSafeId(value["contextDraftId"]) ||
    !isPositiveInteger(value["expectedDraftRevision"]) ||
    !isContextDraftMutation(value["mutation"])
  ) {
    return undefined;
  }
  return value as unknown as UpdateContextDraftCommand;
}

function toRefreshContextDraftCommand(value: unknown): RefreshContextDraftCommand | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "contextDraftId",
      "expectedDraftRevision"
    ]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["conversationId"]) &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["contextDraftId"]) &&
    isPositiveInteger(value["expectedDraftRevision"])
    ? (value as unknown as RefreshContextDraftCommand)
    : undefined;
}

function toPreviewContextBudgetCommand(value: unknown): PreviewContextBudgetCommand | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "runDraftId",
      "expectedDraftRevision",
      "runDraftChecksum"
    ]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["conversationId"]) &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["runDraftId"]) &&
    isPositiveInteger(value["expectedDraftRevision"]) &&
    isNonEmptyString(value["runDraftChecksum"])
    ? (value as unknown as PreviewContextBudgetCommand)
    : undefined;
}

function toCompactContextCommand(value: unknown): CompactContextCommand | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "projectId",
      "runId",
      "commandId",
      "expectedRunRevision",
      "contextBudgetSnapshotId",
      "trigger"
    ]) &&
    isSafeId(value["projectId"]) &&
    isNonEmptyString(value["runId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedRunRevision"]) &&
    isNonEmptyString(value["contextBudgetSnapshotId"]) &&
    (value["trigger"] === "manual" ||
      value["trigger"] === "automatic" ||
      value["trigger"] === "recovery")
    ? (value as unknown as CompactContextCommand)
    : undefined;
}

function isAgentRunDraftMutation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "set_request":
      return typeof value["request"] === "string" && hasOnlyKeys(value, ["kind", "request"]);
    case "set_operation_mode":
      return (
        (value["operationMode"] === "planning" || value["operationMode"] === "execution") &&
        hasOnlyKeys(value, ["kind", "operationMode"])
      );
    case "set_context_mode":
      return (
        (value["contextMode"] === "writing" || value["contextMode"] === "general_file") &&
        hasOnlyKeys(value, ["kind", "contextMode"])
      );
    case "set_write_policy":
      return (
        (value["writePolicy"] === "write_before_confirmation" ||
          value["writePolicy"] === "user_preapproved_run") &&
        typeof value["acknowledged"] === "boolean" &&
        hasOnlyKeys(value, ["kind", "writePolicy", "acknowledged"])
      );
    case "set_model":
      return (
        isNonEmptyString(value["modelProfileId"]) &&
        (value["modelName"] === undefined || isNonEmptyString(value["modelName"])) &&
        (value["reasoningEffort"] === undefined || isNonEmptyString(value["reasoningEffort"])) &&
        hasOnlyKeys(value, ["kind", "modelProfileId", "modelName", "reasoningEffort"])
      );
    case "set_reasoning":
      return (
        isNonEmptyString(value["reasoningEffort"]) &&
        hasOnlyKeys(value, ["kind", "reasoningEffort"])
      );
    default:
      return false;
  }
}

function isContextDraftMutation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "add_ref":
      return isRecord(value["ref"]) && hasOnlyKeys(value, ["kind", "ref"]);
    case "remove_ref":
      return isNonEmptyString(value["refId"]) && hasOnlyKeys(value, ["kind", "refId"]);
    case "set_selection":
      return (
        (value["ref"] === null || isRecord(value["ref"])) && hasOnlyKeys(value, ["kind", "ref"])
      );
    default:
      return false;
  }
}

function toCreateAgentConversationCommand(
  value: unknown
): CreateAgentConversationCommand | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, ["projectId", "commandId"]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["commandId"])
    ? { projectId: value["projectId"], commandId: value["commandId"] }
    : undefined;
}

function toListAgentConversationsQuery(value: unknown): ListAgentConversationsQuery | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["projectId", "includeArchived", "cursor", "limit"]) ||
    !isSafeId(value["projectId"]) ||
    (value["includeArchived"] !== undefined && typeof value["includeArchived"] !== "boolean") ||
    (value["cursor"] !== undefined && !isCursor(value["cursor"])) ||
    (value["limit"] !== undefined &&
      (!isPositiveInteger(value["limit"]) || Number(value["limit"]) > 100))
  ) {
    return undefined;
  }
  return {
    projectId: value["projectId"],
    ...(value["includeArchived"] === undefined
      ? {}
      : { includeArchived: value["includeArchived"] }),
    ...(value["cursor"] === undefined ? {} : { cursor: value["cursor"] }),
    ...(value["limit"] === undefined ? {} : { limit: value["limit"] })
  };
}

function toReadAgentConversationQuery(value: unknown): ReadAgentConversationQuery | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, ["projectId", "conversationId"]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["conversationId"])
    ? { projectId: value["projectId"], conversationId: value["conversationId"] }
    : undefined;
}

function toChangeAgentConversationStatusCommand(
  value: unknown
): ChangeAgentConversationStatusCommand | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "projectId",
      "conversationId",
      "commandId",
      "expectedConversationRevision"
    ]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["conversationId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedConversationRevision"])
    ? {
        projectId: value["projectId"],
        conversationId: value["conversationId"],
        commandId: value["commandId"],
        expectedConversationRevision: value["expectedConversationRevision"]
      }
    : undefined;
}

function toSearchAgentConversationsQuery(
  value: unknown
): SearchAgentConversationsQuery | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["projectId", "query", "includeArchived", "cursor", "limit"]) ||
    typeof value["query"] !== "string" ||
    value["query"].length > 512
  ) {
    return undefined;
  }
  const list = toListAgentConversationsQuery({
    projectId: value["projectId"],
    ...(value["includeArchived"] === undefined
      ? {}
      : { includeArchived: value["includeArchived"] }),
    ...(value["cursor"] === undefined ? {} : { cursor: value["cursor"] }),
    ...(value["limit"] === undefined ? {} : { limit: value["limit"] })
  });
  return list === undefined ? undefined : { ...list, query: value["query"] };
}

function toStopAgentRunCommand(value: unknown): StopAgentRunCommand | undefined {
  return isRecord(value) ? (value as unknown as StopAgentRunCommand) : undefined;
}

function toAnswerAgentUserInputCommand(value: unknown): AnswerAgentUserInputCommand | undefined {
  return isRecord(value) ? (value as unknown as AnswerAgentUserInputCommand) : undefined;
}

function toResumeAgentRunCommand(value: unknown): ResumeAgentRunCommand | undefined {
  return isRecord(value) ? (value as unknown as ResumeAgentRunCommand) : undefined;
}

function toRetryAgentRunStepCommand(value: unknown): RetryAgentRunStepCommand | undefined {
  return isRecord(value) ? (value as unknown as RetryAgentRunStepCommand) : undefined;
}

function toRetryRunTargetCommand(value: unknown): RetryRunTargetCommand | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "runId",
      "projectId",
      "commandId",
      "expectedRunRevision",
      "errorId",
      "target"
    ]) ||
    !isSafeId(value["runId"]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["commandId"]) ||
    !Number.isSafeInteger(value["expectedRunRevision"]) ||
    Number(value["expectedRunRevision"]) < 0 ||
    !isSafeId(value["errorId"]) ||
    !isRecord(value["target"]) ||
    !hasOnlyKeys(value["target"], ["kind", "id"]) ||
    !isOpaqueRetryTargetId(value["target"]["id"]) ||
    (value["target"]["kind"] !== "model_round" &&
      value["target"]["kind"] !== "tool_call" &&
      value["target"]["kind"] !== "checkpoint" &&
      value["target"]["kind"] !== "plan_step")
  ) {
    return undefined;
  }
  return value as unknown as RetryRunTargetCommand;
}

function toDecideAgentPlanCommand(value: unknown): DecideAgentPlanCommand | undefined {
  return isRecord(value) ? (value as unknown as DecideAgentPlanCommand) : undefined;
}

function toReadAgentPermissionSummaryQuery(
  value: unknown
): ReadAgentPermissionSummaryQuery | undefined {
  if (!isRecord(value) || !isSafeId(value["projectId"])) return undefined;
  if (value["kind"] === "draft") {
    return hasOnlyKeys(value, [
      "kind",
      "projectId",
      "conversationId",
      "runDraftId",
      "runDraftRevision",
      "runDraftChecksum"
    ]) &&
      isSafeId(value["conversationId"]) &&
      isSafeId(value["runDraftId"]) &&
      isPositiveInteger(value["runDraftRevision"]) &&
      isNonEmptyString(value["runDraftChecksum"])
      ? (value as unknown as ReadAgentPermissionSummaryQuery)
      : undefined;
  }
  if (value["kind"] === "run") {
    return hasOnlyKeys(value, ["kind", "projectId", "runId", "permissionSummaryId"]) &&
      isSafeId(value["runId"]) &&
      isSafeId(value["permissionSummaryId"])
      ? (value as unknown as ReadAgentPermissionSummaryQuery)
      : undefined;
  }
  return undefined;
}

function toDecidePlanRevisionCommand(value: unknown): DecidePlanRevisionCommand | undefined {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "runId",
      "projectId",
      "commandId",
      "expectedRunRevision",
      "requestId",
      "planId",
      "planRevision",
      "decision"
    ]) &&
    isSafeId(value["runId"]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedRunRevision"]) &&
    isSafeId(value["requestId"]) &&
    isSafeId(value["planId"]) &&
    isPositiveInteger(value["planRevision"]) &&
    (value["decision"] === "approve" || value["decision"] === "reject")
    ? (value as unknown as DecidePlanRevisionCommand)
    : undefined;
}

function toRefreshAgentContextCommand(value: unknown): RefreshAgentContextCommand | undefined {
  return isRecord(value) ? (value as unknown as RefreshAgentContextCommand) : undefined;
}

function toDecideChangeSetCommand(value: unknown): DecideChangeSetCommand | undefined {
  if (!isRecord(value)) return undefined;
  const decision = value["decision"];
  const allowedKeys = new Set([
    "runId",
    "projectId",
    "commandId",
    "expectedRunRevision",
    "changeSetId",
    "revision",
    "checksum",
    "decision",
    "files"
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return undefined;
  if (
    !isNonEmptyString(value["runId"]) ||
    !isNonEmptyString(value["projectId"]) ||
    !isNonEmptyString(value["commandId"]) ||
    !isNonNegativeInteger(value["expectedRunRevision"]) ||
    !isNonEmptyString(value["changeSetId"]) ||
    !isPositiveInteger(value["revision"]) ||
    !isNonEmptyString(value["checksum"]) ||
    (decision !== "update_selection" && decision !== "apply_selected" && decision !== "reject_all")
  ) {
    return undefined;
  }
  if (decision !== "update_selection" && value["files"] !== undefined) return undefined;
  const files =
    decision === "update_selection" ? toChangeSetFileSelections(value["files"]) : undefined;
  if (decision === "update_selection" && files === undefined) return undefined;
  const base = {
    runId: value["runId"],
    projectId: value["projectId"],
    commandId: value["commandId"],
    expectedRunRevision: value["expectedRunRevision"],
    changeSetId: value["changeSetId"],
    revision: value["revision"],
    checksum: value["checksum"]
  };
  return decision === "update_selection"
    ? { ...base, decision, files: files ?? [] }
    : { ...base, decision };
}

function toChangeSetFileSelections(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const selections: Array<{
    readonly relativePath: string;
    readonly selected: boolean;
    readonly selectedHunkIds?: readonly string[];
  }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    if (
      Object.keys(entry).some(
        (key) => !["relativePath", "selected", "selectedHunkIds"].includes(key)
      )
    ) {
      return undefined;
    }
    const selectedHunkIds = entry["selectedHunkIds"];
    if (
      !isNonEmptyString(entry["relativePath"]) ||
      typeof entry["selected"] !== "boolean" ||
      (selectedHunkIds !== undefined &&
        (!Array.isArray(selectedHunkIds) || !selectedHunkIds.every(isNonEmptyString)))
    ) {
      return undefined;
    }
    selections.push({
      relativePath: entry["relativePath"],
      selected: entry["selected"],
      ...(selectedHunkIds === undefined ? {} : { selectedHunkIds })
    });
  }
  return selections;
}

function toUndoAgentRunCommand(value: unknown): UndoRunCommand | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNonEmptyString(value["runId"]) ||
    !isNonEmptyString(value["projectId"]) ||
    !isNonEmptyString(value["commandId"]) ||
    !isNonNegativeInteger(value["expectedRunRevision"]) ||
    (value["action"] !== "request" && value["action"] !== "resolve")
  ) {
    return undefined;
  }
  const base = {
    runId: value["runId"],
    projectId: value["projectId"],
    commandId: value["commandId"],
    expectedRunRevision: value["expectedRunRevision"]
  };
  if (value["action"] === "request") {
    return Object.keys(value).some(
      (key) => !["action", "runId", "projectId", "commandId", "expectedRunRevision"].includes(key)
    )
      ? undefined
      : { ...base, action: "request" };
  }
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "action",
          "runId",
          "projectId",
          "commandId",
          "expectedRunRevision",
          "reviewId",
          "decisions",
          "retryFailedOnly"
        ].includes(key)
    ) ||
    !isNonEmptyString(value["reviewId"]) ||
    (value["retryFailedOnly"] !== undefined && value["retryFailedOnly"] !== true)
  ) {
    return undefined;
  }
  const decisions = toRollbackReviewDecisions(value["decisions"]);
  if (decisions === undefined || (decisions.length === 0 && value["retryFailedOnly"] !== true)) {
    return undefined;
  }
  return {
    ...base,
    action: "resolve",
    reviewId: value["reviewId"],
    ...(decisions.length === 0 ? {} : { decisions }),
    ...(value["retryFailedOnly"] === true ? { retryFailedOnly: true } : {})
  };
}

function toRollbackReviewDecisions(
  value: unknown
):
  | { readonly relativePath: string; readonly decision: "keep_current" | "restore_baseline" }[]
  | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const decisions: {
    relativePath: string;
    decision: "keep_current" | "restore_baseline";
  }[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some((key) => !["relativePath", "decision"].includes(key)) ||
      !isNonEmptyString(entry["relativePath"]) ||
      (entry["decision"] !== "keep_current" && entry["decision"] !== "restore_baseline")
    ) {
      return undefined;
    }
    decisions.push({ relativePath: entry["relativePath"], decision: entry["decision"] });
  }
  return new Set(decisions.map((decision) => decision.relativePath)).size === decisions.length
    ? decisions
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isOpaqueRetryTargetId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function isCursor(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,2048}$/u.test(value);
}

function projectSnapshotResultToDto(
  result: Result<ProjectWorkspaceSnapshot, UnifiedError>
): Result<ReturnType<typeof toProjectWorkspaceSnapshotDto>, UnifiedError> {
  return result.ok ? ok(toProjectWorkspaceSnapshotDto(result.value)) : result;
}

function agentConversationUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONVERSATION_IPC_UNAVAILABLE",
    category: "AgentError",
    message: "The Agent Conversation service is unavailable.",
    recoverability: "user-action",
    suggestedAction: "Open a project and retry.",
    traceId: "desktop-agent-conversation-ipc"
  });
}

function agentRunUnavailable(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_RUN_IPC_UNAVAILABLE",
      category: "AgentError",
      message: "The Agent Run service is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Open a project and retry the Agent run.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

function invalidAgentRunCommand(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_RUN_IPC_INVALID_COMMAND",
      category: "ValidationError",
      message: "The Agent Run command payload is invalid.",
      recoverability: "user-action",
      suggestedAction: "Refresh the Agent Run and retry the command.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

function toUserPreferencesSaveInput(value: unknown): UserPreferencesSaveInput {
  if (!isRecord(value)) {
    return {};
  }

  return value as UserPreferencesSaveInput;
}

async function pumpAiSuggestionPushStream(
  streamId: string,
  iterator: AsyncIterator<Result<AiWritingSuggestionStreamEvent, UnifiedError>>,
  abortController: AbortController,
  publish: ((event: AiWritingSuggestionStreamPushEvent) => void) | undefined,
  onDone: () => void
): Promise<void> {
  let sequence = 0;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done === true) {
        break;
      }
      sequence += 1;
      if (next.value.ok) {
        const event: AiWritingSuggestionStreamPushEvent = {
          streamId,
          sequence,
          type: "event",
          event: next.value.value
        };
        if (!publishCloneSafeAiSuggestionEvent(event, publish)) {
          publishCloneSafeAiSuggestionEvent(
            {
              streamId,
              sequence,
              type: "error",
              error: createUnifiedError({
                code: "AI_STREAM_PAYLOAD_NOT_CLONEABLE",
                category: "ValidationError",
                message: "The AI stream produced an invalid IPC payload.",
                recoverability: "retryable",
                suggestedAction: "Retry the request and inspect the stream contract diagnostics.",
                traceId: "desktop-ipc-handlers"
              })
            },
            publish
          );
          break;
        }
      } else {
        publishCloneSafeAiSuggestionEvent(
          {
            streamId,
            sequence,
            type: "error",
            error: next.value.error
          },
          publish
        );
        break;
      }
      if (abortController.signal.aborted) {
        break;
      }
    }
  } catch (error) {
    sequence += 1;
    const failure = thrownAiStreamError(error);
    publishCloneSafeAiSuggestionEvent(
      {
        streamId,
        sequence,
        type: "error",
        error: failure.ok
          ? createUnifiedError({
              code: "AI_STREAM_FAILED",
              category: "LLMAdapterError",
              message: "AI streaming failed.",
              recoverability: "retryable",
              suggestedAction: "Check the model provider response and retry.",
              traceId: "desktop-ipc-handlers"
            })
          : failure.error
      },
      publish
    );
  } finally {
    sequence += 1;
    publishCloneSafeAiSuggestionEvent({ streamId, sequence, type: "completed" }, publish);
    onDone();
  }
}

function publishCloneSafeAiSuggestionEvent(
  event: AiWritingSuggestionStreamPushEvent,
  publish: ((event: AiWritingSuggestionStreamPushEvent) => void) | undefined
): boolean {
  if (publish === undefined) {
    return true;
  }
  try {
    publish(structuredClone(event));
    return true;
  } catch {
    return false;
  }
}

function readStreamId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function streamNotFound<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AI_STREAM_NOT_FOUND",
      category: "UserError",
      message: "The AI stream is no longer active.",
      recoverability: "user-action",
      suggestedAction: "Start a new AI writing stream.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

async function saveActiveChapterWithCoordinator(
  application: DesktopApplication,
  coordinator: AgentWriteSaveCoordinator | undefined
): Promise<unknown> {
  if (coordinator === undefined) return application.saveActiveChapter();
  const activeChapter = await application.readActiveChapterState();
  if (!activeChapter.ok) return activeChapter;
  const chapterId = activeChapter.value.state.chapter.frontmatter.id;
  const permit = coordinator.beginSave(`chapters/${chapterId}.md`);
  if (!permit.ok) return chapterSavePausedForAgentWrite();
  try {
    return await application.saveActiveChapter();
  } finally {
    permit.release();
  }
}

function chapterSavePausedForAgentWrite<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_SAVE_PAUSED_FOR_AGENT_WRITE",
      category: "UserError",
      message: "Chapter saving is temporarily paused while Agent changes are applied.",
      recoverability: "user-action",
      suggestedAction: "Wait for the Agent transaction to finish, then save again.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

function thrownAiStreamError<T>(error: unknown): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AI_STREAM_FAILED",
      category: "LLMAdapterError",
      message: readErrorMessage(error, "AI streaming failed."),
      recoverability: "retryable",
      suggestedAction: "Check the model provider response and retry.",
      traceId: "desktop-ipc-handlers",
      redactedDetail: readThrownStreamErrorDetail(error)
    })
  );
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

function readThrownStreamErrorDetail(error: unknown): JsonObject {
  if (!isRecord(error)) {
    return {};
  }

  const detail: JsonObject = {};
  if (typeof error.status === "number") {
    detail.status = error.status;
  }
  if (isJsonValue(error.body)) {
    detail.body = error.body;
  }
  if (isJsonObject(error.headers)) {
    detail.headers = error.headers;
  }

  return detail;
}

function toStoryBibleAsset(value: unknown): StoryBibleAsset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.id !== "string" ||
    !isStoryBibleAssetType(value.type) ||
    typeof value.title !== "string" ||
    !isStoryBibleEntityStatus(value.status) ||
    typeof value.summary !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isOptionalStringArray(value.aliases) ||
    !isOptionalJsonObject(value.details) ||
    !isOptionalStringArray(value.relatedEntityIds)
  ) {
    return undefined;
  }

  return {
    schemaVersion: "1.0",
    id: value.id,
    type: value.type,
    title: value.title,
    status: value.status,
    summary: value.summary,
    ...(value.aliases === undefined ? {} : { aliases: value.aliases }),
    ...(value.details === undefined ? {} : { details: value.details }),
    ...(value.relatedEntityIds === undefined ? {} : { relatedEntityIds: value.relatedEntityIds }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function toMemoryRecord(value: unknown): MemoryRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.id !== "string" ||
    !isMemoryRecordType(value.type) ||
    typeof value.title !== "string" ||
    !isStoryBibleEntityStatus(value.status) ||
    !isMemoryOrigin(value.origin) ||
    !isMemoryConfidence(value.confidence) ||
    typeof value.content !== "string" ||
    !isOptionalJsonObjectArray(value.sourceRefs) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return undefined;
  }

  return {
    schemaVersion: "1.0",
    id: value.id,
    type: value.type,
    title: value.title,
    status: value.status,
    origin: value.origin,
    confidence: value.confidence,
    content: value.content,
    ...(value.sourceRefs === undefined ? {} : { sourceRefs: value.sourceRefs }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function toStoryBibleContextCandidateOptions(
  value: unknown
): StoryBibleContextCandidateOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (!isOptionalStoryBibleStatusArray(value.includeStatuses)) {
    return undefined;
  }

  return {
    ...(value.includeStatuses === undefined ? {} : { includeStatuses: value.includeStatuses })
  };
}

function toCreativePreviewRequest(
  value: unknown
): { readonly parentSelectionId: string; readonly folderName: string } | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["parentSelectionId", "folderName"]) ||
    !isNonEmptyString(value["parentSelectionId"]) ||
    !isNonEmptyString(value["folderName"])
  ) {
    return undefined;
  }
  return {
    parentSelectionId: value["parentSelectionId"],
    folderName: value["folderName"]
  };
}

function toCreateCreativeProjectRequest(value: unknown):
  | {
      readonly parentSelectionId: string;
      readonly folderName: string;
      readonly projectId: string;
      readonly title: string;
      readonly language: string;
      readonly projectType?: string;
      readonly targetWordCount?: number;
    }
  | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "parentSelectionId",
      "folderName",
      "projectId",
      "title",
      "language",
      "projectType",
      "targetWordCount"
    ]) ||
    !isNonEmptyString(value["parentSelectionId"]) ||
    !isNonEmptyString(value["folderName"]) ||
    !isSafeId(value["projectId"]) ||
    !isNonEmptyString(value["title"]) ||
    !isNonEmptyString(value["language"]) ||
    (value["projectType"] !== undefined && !isNonEmptyString(value["projectType"])) ||
    (value["targetWordCount"] !== undefined && !isNonNegativeInteger(value["targetWordCount"]))
  ) {
    return undefined;
  }
  return {
    parentSelectionId: value["parentSelectionId"],
    folderName: value["folderName"],
    projectId: value["projectId"],
    title: value["title"],
    language: value["language"],
    ...(value["projectType"] === undefined ? {} : { projectType: value["projectType"] }),
    ...(value["targetWordCount"] === undefined ? {} : { targetWordCount: value["targetWordCount"] })
  };
}

function toEngineeringTextFileSaveRequest(
  value: unknown
):
  | { readonly path: string; readonly content: string; readonly expectedChecksum: string }
  | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["path", "content", "expectedChecksum"]) ||
    !isNonEmptyString(value["path"]) ||
    typeof value["content"] !== "string" ||
    !isNonEmptyString(value["expectedChecksum"])
  ) {
    return undefined;
  }
  return {
    path: value["path"],
    content: value["content"],
    expectedChecksum: value["expectedChecksum"]
  };
}

function invalidWorkspaceRequest<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKSPACE_REQUEST_INVALID",
      category: "ValidationError",
      message: "The workspace request is invalid.",
      recoverability: "user-action",
      suggestedAction: "Review the workspace selection and try again.",
      traceId: "desktop-workspace-ipc"
    })
  );
}

function workspaceActivationUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKSPACE_ACTIVATION_UNAVAILABLE",
      category: "StorageError",
      message: "Workspace activation is unavailable.",
      recoverability: "retryable",
      suggestedAction: "Restart Novel Studio and try again.",
      traceId: "desktop-workspace-ipc"
    })
  );
}

function directorySelectionFailed(): UnifiedError {
  return createUnifiedError({
    code: "DIRECTORY_SELECTION_FAILED",
    category: "StorageError",
    message: "The selected directory could not be resolved.",
    recoverability: "user-action",
    suggestedAction: "Choose an existing directory and try again.",
    traceId: "desktop-directory-selection"
  });
}

function directorySelectionInvalid(): UnifiedError {
  return createUnifiedError({
    code: "DIRECTORY_SELECTION_INVALID",
    category: "ValidationError",
    message: "The directory selection has expired or is invalid.",
    recoverability: "user-action",
    suggestedAction: "Choose the directory again.",
    traceId: "desktop-directory-selection"
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigAssetType(value: unknown): value is ConfigAssetType {
  return value === "prompt" || value === "agent" || value === "workflow";
}

function toModelProfile(value: unknown): ModelProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.apiKeyRef !== "string" ||
    typeof value.modelName !== "string" ||
    typeof value.temperature !== "number" ||
    typeof value.maxTokens !== "number" ||
    typeof value.timeoutMs !== "number"
  ) {
    return undefined;
  }
  if (
    !isOptionalString(value.baseUrl) ||
    !isOptionalPositiveSafeInteger(value.contextWindow) ||
    !isOptionalNumber(value.topP) ||
    !isOptionalNumber(value.frequencyPenalty) ||
    !isOptionalNumber(value.presencePenalty) ||
    !isOptionalBoolean(value.reasoningEffortEnabled)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    provider: value.provider,
    displayName: value.displayName,
    ...(value.baseUrl === undefined ? {} : { baseUrl: value.baseUrl }),
    apiKeyRef: value.apiKeyRef,
    modelName: value.modelName,
    ...(value.contextWindow === undefined ? {} : { contextWindow: value.contextWindow }),
    temperature: value.temperature,
    maxTokens: value.maxTokens,
    ...(value.topP === undefined ? {} : { topP: value.topP }),
    timeoutMs: value.timeoutMs,
    ...(value.frequencyPenalty === undefined ? {} : { frequencyPenalty: value.frequencyPenalty }),
    ...(value.presencePenalty === undefined ? {} : { presencePenalty: value.presencePenalty }),
    ...(value.reasoningEffortEnabled === undefined
      ? {}
      : { reasoningEffortEnabled: value.reasoningEffortEnabled })
  };
}

function isSaveModelProfileOptions(value: unknown): value is { readonly makeDefault?: boolean } {
  if (!isRecord(value)) {
    return false;
  }
  return value.makeDefault === undefined || typeof value.makeDefault === "boolean";
}

function toConfigAssetSaveInput(value: unknown): ConfigAssetSaveInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isConfigAssetType(value.assetType) ||
    typeof value.assetId !== "string" ||
    !isJsonObject(value.content) ||
    !isOptionalConfigCreatedBy(value.createdBy)
  ) {
    return undefined;
  }

  return {
    assetType: value.assetType,
    assetId: value.assetId,
    content: value.content,
    ...(value.createdBy === undefined ? {} : { createdBy: value.createdBy })
  };
}

function toCreateChapterInput(value: unknown): CreateChapterInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.chapterId !== "string" ||
    typeof value.title !== "string" ||
    !isOptionalString(value.body) ||
    !isOptionalNumber(value.order) ||
    !isOptionalChapterStatus(value.status)
  ) {
    return undefined;
  }

  return {
    chapterId: value.chapterId,
    title: value.title,
    ...(value.body === undefined ? {} : { body: value.body }),
    ...(value.order === undefined ? {} : { order: value.order }),
    ...(value.status === undefined ? {} : { status: value.status })
  };
}

function toRenameChapterInput(value: unknown): RenameChapterInput {
  if (!isRecord(value) || typeof value.chapterId !== "string" || typeof value.title !== "string") {
    return { chapterId: "", title: "" };
  }

  return {
    chapterId: value.chapterId,
    title: value.title
  };
}

function toDuplicateChapterInput(value: unknown): DuplicateChapterInput {
  if (
    !isRecord(value) ||
    typeof value.sourceChapterId !== "string" ||
    typeof value.chapterId !== "string" ||
    typeof value.title !== "string"
  ) {
    return { sourceChapterId: "", chapterId: "", title: "" };
  }

  return {
    sourceChapterId: value.sourceChapterId,
    chapterId: value.chapterId,
    title: value.title
  };
}

function toDeleteChapterInput(value: unknown): DeleteChapterInput {
  if (!isRecord(value) || typeof value.chapterId !== "string") {
    return { chapterId: "" };
  }

  return {
    chapterId: value.chapterId
  };
}

function toAiWritingSuggestionRequest(value: unknown): AiWritingSuggestionRequest {
  if (!isRecord(value) || typeof value.instruction !== "string") {
    return { instruction: "" };
  }

  return {
    instruction: value.instruction,
    ...(isLlmReasoningEffort(value.reasoningEffort)
      ? { reasoningEffort: value.reasoningEffort }
      : {})
  };
}

function toAiWritingSuggestionStreamStartRequest(
  value: unknown
): AiWritingSuggestionStreamStartRequest | undefined {
  if (!isRecord(value) || typeof value.streamId !== "string" || value.streamId.length === 0) {
    return undefined;
  }
  const request = toAiWritingSuggestionRequest(value);
  if (request.instruction.length === 0) {
    return undefined;
  }
  return {
    streamId: value.streamId,
    ...request
  };
}

function isLlmReasoningEffort(
  value: unknown
): value is NonNullable<AiWritingSuggestionRequest["reasoningEffort"]> {
  return isNonEmptyString(value);
}

function toAiWritingSelectionPreviewRequest(value: unknown): AiWritingSelectionPreviewRequest {
  if (
    !isRecord(value) ||
    typeof value.instruction !== "string" ||
    !isRecord(value.selection) ||
    typeof value.selection.startOffset !== "number" ||
    typeof value.selection.endOffset !== "number" ||
    typeof value.selection.selectedText !== "string"
  ) {
    return {
      instruction: "",
      selection: {
        startOffset: 0,
        endOffset: 0,
        selectedText: ""
      }
    };
  }

  return {
    instruction: value.instruction,
    selection: {
      startOffset: value.selection.startOffset,
      endOffset: value.selection.endOffset,
      selectedText: value.selection.selectedText
    }
  };
}

function toSearchQuery(value: unknown): ProjectSearchQuery {
  if (!isRecord(value) || typeof value.query !== "string") {
    return { query: "" };
  }

  return {
    query: value.query,
    ...(typeof value.limit === "number" ? { limit: value.limit } : {})
  };
}

function toConfigAssetRestoreInput(value: unknown): ConfigAssetRestoreInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isConfigAssetType(value.assetType) ||
    typeof value.assetId !== "string" ||
    typeof value.versionId !== "string" ||
    !isOptionalConfigCreatedBy(value.createdBy)
  ) {
    return undefined;
  }

  return {
    assetType: value.assetType,
    assetId: value.assetId,
    versionId: value.versionId,
    ...(value.createdBy === undefined ? {} : { createdBy: value.createdBy })
  };
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isOptionalPositiveSafeInteger(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  );
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalChapterStatus(value: unknown): value is CreateChapterInput["status"] {
  return (
    value === undefined ||
    value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived" ||
    value === "deleted"
  );
}

function isOptionalConfigCreatedBy(value: unknown): value is ConfigAssetSaveInput["createdBy"] {
  return value === undefined || value === "user" || value === "system" || value === "migration";
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

function isOptionalJsonObject(value: unknown): value is JsonObject | undefined {
  return value === undefined || isJsonObject(value);
}

function isOptionalJsonObjectArray(value: unknown): value is JsonObject[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isJsonObject));
}

function isStoryBibleAssetType(value: unknown): value is StoryBibleAsset["type"] {
  return (
    value === "character" ||
    value === "world.location" ||
    value === "world.faction" ||
    value === "world.rule" ||
    value === "world.glossary" ||
    value === "outline" ||
    value === "timeline.events"
  );
}

function isStoryBibleEntityStatus(value: unknown): value is StoryBibleAsset["status"] {
  return value === "active" || value === "draft" || value === "archived" || value === "deleted";
}

function isOptionalStoryBibleStatusArray(
  value: unknown
): value is StoryBibleAsset["status"][] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isStoryBibleEntityStatus));
}

function isMemoryRecordType(value: unknown): value is MemoryRecord["type"] {
  return value === "memory.long-term" || value === "memory.style" || value === "memory.summary";
}

function isMemoryOrigin(value: unknown): value is MemoryRecord["origin"] {
  return value === "user" || value === "user-confirmed-ai" || value === "ai-unconfirmed";
}

function isMemoryConfidence(value: unknown): value is MemoryRecord["confidence"] {
  return value === "confirmed" || value === "needs-review" || value === "deprecated";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

function emptyModelProfile(): ModelProfile {
  return {
    id: "",
    provider: "",
    displayName: "",
    apiKeyRef: "secret://invalid",
    modelName: "",
    temperature: 0,
    maxTokens: 1,
    timeoutMs: 1000
  };
}

function emptyStoryBibleAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "",
    type: "character",
    title: "",
    status: "draft",
    summary: "",
    createdAt: "",
    updatedAt: ""
  };
}

function emptyMemoryRecord(): MemoryRecord {
  return {
    schemaVersion: "1.0",
    id: "",
    type: "memory.long-term",
    title: "",
    status: "draft",
    origin: "user",
    confidence: "needs-review",
    content: "",
    createdAt: "",
    updatedAt: ""
  };
}
